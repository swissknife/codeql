import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";

import * as analysisPaths from "./analysis-paths";
import * as configUtils from "./config-utils";
import * as setuptools from "./setup-tools";
import * as sharedEnv from "./shared-environment";
import * as util from "./util";

type TracerConfig = {
  spec: string;
  env: { [key: string]: string };
};

const CRITICAL_TRACER_VARS = new Set([
  "SEMMLE_PRELOAD_libtrace",
  ,
  "SEMMLE_RUNNER",
  ,
  "SEMMLE_COPY_EXECUTABLES_ROOT",
  ,
  "SEMMLE_DEPTRACE_SOCKET",
  ,
  "SEMMLE_JAVA_TOOL_OPTIONS",
]);

async function tracerConfig(
  codeql: setuptools.CodeQLSetup,
  database: string,
  compilerSpec?: string
): Promise<TracerConfig> {
  const compilerSpecArg = compilerSpec ? ["--compiler-spec=" + compilerSpec] : [];

  let envFile = path.resolve(database, "working", "env.tmp");
  await exec.exec(codeql.cmd, [
    "database",
    "trace-command",
    database,
    ...compilerSpecArg,
    process.execPath,
    path.resolve(__dirname, "tracer-env.js"),
    envFile,
  ]);

  const env: { [key: string]: string } = JSON.parse(fs.readFileSync(envFile, "utf-8"));

  const config = env["ODASA_TRACER_CONFIGURATION"];
  const info: TracerConfig = { spec: config, env: {} };

  // Extract critical tracer variables from the environment
  for (let entry of Object.entries(env)) {
    const key = entry[0];
    const value = entry[1];
    // skip ODASA_TRACER_CONFIGURATION as it is handled separately
    if (key === "ODASA_TRACER_CONFIGURATION") {
      continue;
    }
    // skip undefined values
    if (typeof value === "undefined") {
      continue;
    }
    // Keep variables that do not exist in current environment. In addition always keep
    // critical and CODEQL_ variables
    if (
      typeof process.env[key] === "undefined" ||
      CRITICAL_TRACER_VARS.has(key) ||
      key.startsWith("CODEQL_")
    ) {
      info.env[key] = value;
    }
  }
  return info;
}

function concatTracerConfigs(configs: { [lang: string]: TracerConfig }): TracerConfig {
  // A tracer config is a map containing additional environment variables and a tracer 'spec' file.
  // A tracer 'spec' file has the following format [log_file, number_of_blocks, blocks_text]

  // Merge the environments
  const env: { [key: string]: string } = {};
  let copyExecutables = false;
  let envSize = 0;
  for (let v of Object.values(configs)) {
    for (let e of Object.entries(v.env)) {
      const name = e[0];
      const value = e[1];
      // skip SEMMLE_COPY_EXECUTABLES_ROOT as it is handled separately
      if (name === "SEMMLE_COPY_EXECUTABLES_ROOT") {
        copyExecutables = true;
      } else if (name in env) {
        if (env[name] !== value) {
          throw Error(
            "Incompatible values in environment parameter " +
              name +
              ": " +
              env[name] +
              " and " +
              value
          );
        }
      } else {
        env[name] = value;
        envSize += 1;
      }
    }
  }

  // Concatenate spec files into a new spec file
  let languages = Object.keys(configs);
  const cppIndex = languages.indexOf("cpp");
  // Make sure cpp is the last language, if it's present since it must be concatenated last
  if (cppIndex !== -1) {
    let lastLang = languages[languages.length - 1];
    languages[languages.length - 1] = languages[cppIndex];
    languages[cppIndex] = lastLang;
  }

  let totalLines: string[] = [];
  let totalCount = 0;
  for (let lang of languages) {
    const lines = fs.readFileSync(configs[lang].spec, "utf8").split(/\r?\n/);
    const count = parseInt(lines[1], 10);
    totalCount += count;
    totalLines.push(...lines.slice(2));
  }

  const tempFolder = util.getRequiredEnvParam("RUNNER_TEMP");
  const newLogFilePath = path.resolve(tempFolder, "compound-build-tracer.log");
  const spec = path.resolve(tempFolder, "compound-spec");
  const compoundTempFolder = path.resolve(tempFolder, "compound-temp");
  const newSpecContent = [newLogFilePath, totalCount.toString(10), ...totalLines];

  if (copyExecutables) {
    env["SEMMLE_COPY_EXECUTABLES_ROOT"] = compoundTempFolder;
    envSize += 1;
  }

  fs.writeFileSync(spec, newSpecContent.join("\n"));

  // Prepare the content of the compound environment file
  let buffer = Buffer.alloc(4);
  buffer.writeInt32LE(envSize, 0);
  for (let e of Object.entries(env)) {
    const key = e[0];
    const value = e[1];
    const lineBuffer = new Buffer(key + "=" + value + "\0", "utf8");
    const sizeBuffer = Buffer.alloc(4);
    sizeBuffer.writeInt32LE(lineBuffer.length, 0);
    buffer = Buffer.concat([buffer, sizeBuffer, lineBuffer]);
  }
  // Write the compound environment
  const envPath = spec + ".environment";
  fs.writeFileSync(envPath, buffer);

  return { env, spec };
}

export async function run() {
  console.log("Starting Setup");
  try {
    // Creating temp dir
    util.mkdirP("/tmp/swissknife/");
    util.saveToCircleEnv("RUNNER_TEMP", "/tmp/swissknife");
    // The config file MUST be parsed in the init action
    const config = await configUtils.loadConfig(process.env.SK_CODEQL_CONFIG || "");

    console.log("Load language configuration");

    const languages = await util.getLanguages();
    // If the languages parameter was not given and no languages were
    // detected then fail here as this is a workflow configuration error.
    if (languages.length === 0) {
      console.error("No language passed in and no languages detected");
      throw new Error("No languages found");
    }

    analysisPaths.includeAndExcludeAnalysisPaths(config, languages);

    const sourceRoot = process.env.CIRCLE_WORKING_DIRECTORY;

    console.log("Setup CodeQL tools");
    const codeqlSetup = await setuptools.setupCodeQL();
    await exec.exec(codeqlSetup.cmd, ["version", "--format=json"]);

    // Setup CODEQL_RAM flag (todo improve this https://github.com/github/dsp-code-scanning/issues/935)
    process.env["CODEQL_RAM"] = process.env["CODEQL_RAM"] || "6500";

    const databaseFolder = path.resolve(configUtils.SWISSKNIFE_DIR, "codeql_databases");
    await util.mkdirP(databaseFolder);

    let tracedLanguages: { [key: string]: TracerConfig } = {};
    let scannedLanguages: string[] = [];

    // TODO: replace this code once CodeQL supports multi-language tracing
    for (let language of languages) {
      const languageDatabase = path.join(databaseFolder, language);

      // Init language database
      await exec.exec(codeqlSetup.cmd, [
        "database",
        "init",
        languageDatabase,
        "--language=" + language,
        "--source-root=" + sourceRoot,
      ]);
      // TODO: add better detection of 'traced languages' instead of using a hard coded list
      if (["cpp", "java", "csharp"].includes(language)) {
        const config: TracerConfig = await tracerConfig(codeqlSetup, languageDatabase);
        tracedLanguages[language] = config;
      } else {
        scannedLanguages.push(language);
      }
    }
    const tracedLanguageKeys = Object.keys(tracedLanguages);
    if (tracedLanguageKeys.length > 0) {
      const mainTracerConfig = concatTracerConfigs(tracedLanguages);
      if (mainTracerConfig.spec) {
        for (let entry of Object.entries(mainTracerConfig.env)) {
          process.env[entry[0]] = entry[1];
        }

        process.env["ODASA_TRACER_CONFIGURATION"] = mainTracerConfig.spec;
        if (process.platform === "darwin") {
          process.env["DYLD_INSERT_LIBRARIES"] = path.join(
            codeqlSetup.tools,
            "osx64",
            "libtrace.dylib"
          );
        } else if (process.platform === "win32") {
          await exec.exec(
            "powershell",
            [
              path.resolve(__dirname, "..", "src", "inject-tracer.ps1"),
              path.resolve(codeqlSetup.tools, "win64", "tracer.exe"),
            ],
            { env: { ODASA_TRACER_CONFIGURATION: mainTracerConfig.spec } }
          );
        } else {
          process.env["LD_PRELOAD"] = path.join(codeqlSetup.tools, "linux64", "${LIB}trace.so");
        }
      }
    }

    // process.env[sharedEnv.CODEQL_ACTION_SCANNED_LANGUAGES] = scannedLanguages.join(",");
    // process.env[sharedEnv.CODEQL_ACTION_TRACED_LANGUAGES] = tracedLanguageKeys.join(",");
    util.saveToCircleEnv(sharedEnv.CODEQL_ACTION_SCANNED_LANGUAGES, scannedLanguages.join(","));
    util.saveToCircleEnv(sharedEnv.CODEQL_ACTION_TRACED_LANGUAGES, tracedLanguageKeys.join(","));

    console.log("Language detection:");
    console.log(
      "CODEQL_ACTION_SCANNED_LANGUAGES:",
      process.env[sharedEnv.CODEQL_ACTION_SCANNED_LANGUAGES]
    );
    console.log(
      "CODEQL_ACTION_TRACED_LANGUAGES:",
      process.env[sharedEnv.CODEQL_ACTION_TRACED_LANGUAGES]
    );

    // TODO: make this a "private" environment variable of the action
    // process.env[sharedEnv.CODEQL_ACTION_DATABASE_DIR] = databaseFolder;
    // process.env[sharedEnv.CODEQL_ACTION_CMD] = codeqlSetup.cmd;
    util.saveToCircleEnv(sharedEnv.CODEQL_ACTION_DATABASE_DIR, databaseFolder);
    util.saveToCircleEnv(sharedEnv.CODEQL_ACTION_CMD, codeqlSetup.cmd);
  } catch (error) {
    console.log(error.message);
    console.log(error);
    throw error;
  }
  console.info("Initializing CodeQL succeeded");
  // process.env[sharedEnv.CODEQL_ACTION_INIT_COMPLETED] = "true";
  util.saveToCircleEnv(sharedEnv.CODEQL_ACTION_INIT_COMPLETED, "true");
}
