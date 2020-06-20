import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";

import * as util from "./util";

const NAME_PROPERTY = "name";
const DISPLAY_DEFAULT_QUERIES_PROPERTY = "disable-default-queries";
const QUERIES_PROPERTY = "queries";
const QUERIES_USES_PROPERTY = "uses";
const PATHS_IGNORE_PROPERTY = "paths-ignore";
const PATHS_PROPERTY = "paths";
export const SWISSKNIFE_DIR = `/tmp/swissknife/`;

export class ExternalQuery {
  public repository: string;
  public ref: string;
  public path = "";

  constructor(repository: string, ref: string) {
    this.repository = repository;
    this.ref = ref;
  }
}

// The set of acceptable values for built-in suites from the codeql bundle
const builtinSuites = ["security-extended", "security-and-quality"] as const;
// Derive the union type from the array values
type BuiltInSuite = typeof builtinSuites[number];

export class Config {
  public name = "";
  public disableDefaultQueries = false;
  public additionalQueries: string[] = [];
  public externalQueries: ExternalQuery[] = [];
  public additionalSuites: BuiltInSuite[] = [];
  public pathsIgnore: string[] = [];
  public paths: string[] = [];

  public addQuery(configFile: string, queryUses: string) {
    // The logic for parsing the string is based on what actions does for
    // parsing the 'uses' actions in the workflow file
    queryUses = queryUses.trim();
    if (queryUses === "") {
      throw new Error(getQueryUsesInvalid(configFile));
    }

    // Check for the local path case before we start trying to parse the repository name
    if (queryUses.startsWith("./")) {
      const localQueryPath = queryUses.slice(2);
      // Resolve the local path against the workspace so that when this is
      // passed to codeql it resolves to exactly the path we expect it to resolve to.
      const workspacePath = fs.realpathSync(util.getRequiredEnvParam("CIRCLE_WORKING_DIRECTORY"));
      let absoluteQueryPath = path.join(workspacePath, localQueryPath);

      // Check the file exists
      if (!fs.existsSync(absoluteQueryPath)) {
        throw new Error(getLocalPathDoesNotExist(configFile, localQueryPath));
      }

      // Call this after checking file exists, because it'll fail if file doesn't exist
      absoluteQueryPath = fs.realpathSync(absoluteQueryPath);

      // Check the local path doesn't jump outside the repo using '..' or symlinks
      if (!(absoluteQueryPath + path.sep).startsWith(workspacePath + path.sep)) {
        throw new Error(getLocalPathOutsideOfRepository(configFile, localQueryPath));
      }

      this.additionalQueries.push(absoluteQueryPath);
      return;
    }

    // Check for one of the builtin suites
    if (queryUses.indexOf("/") === -1 && queryUses.indexOf("@") === -1) {
      const suite = builtinSuites.find((suite) => suite === queryUses);
      if (suite) {
        this.additionalSuites.push(suite);
        return;
      } else {
        throw new Error(getQueryUsesInvalid(configFile, queryUses));
      }
    }

    let tok = queryUses.split("@");
    if (tok.length !== 2) {
      throw new Error(getQueryUsesInvalid(configFile, queryUses));
    }

    const ref = tok[1];
    tok = tok[0].split("/");
    // The first token is the owner
    // The second token is the repo
    // The rest is a path, if there is more than one token combine them to form the full path
    if (tok.length < 2) {
      throw new Error(getQueryUsesInvalid(configFile, queryUses));
    }
    if (tok.length > 3) {
      tok = [tok[0], tok[1], tok.slice(2).join("/")];
    }

    // Check none of the parts of the repository name are empty
    if (tok[0].trim() === "" || tok[1].trim() === "") {
      throw new Error(getQueryUsesInvalid(configFile, queryUses));
    }

    let external = new ExternalQuery(tok[0] + "/" + tok[1], ref);
    if (tok.length === 3) {
      external.path = tok[2];
    }
    this.externalQueries.push(external);
  }
}

export function getNameInvalid(configFile: string): string {
  return getConfigFilePropertyError(configFile, NAME_PROPERTY, "must be a non-empty string");
}

export function getDisableDefaultQueriesInvalid(configFile: string): string {
  return getConfigFilePropertyError(
    configFile,
    DISPLAY_DEFAULT_QUERIES_PROPERTY,
    "must be a boolean"
  );
}

export function getQueriesInvalid(configFile: string): string {
  return getConfigFilePropertyError(configFile, QUERIES_PROPERTY, "must be an array");
}

export function getQueryUsesInvalid(configFile: string, queryUses?: string): string {
  return getConfigFilePropertyError(
    configFile,
    QUERIES_PROPERTY + "." + QUERIES_USES_PROPERTY,
    "must be a built-in suite (" +
      builtinSuites.join(" or ") +
      '), a relative path, or be of the form "owner/repo[/path]@ref"' +
      (queryUses !== undefined ? "\n Found: " + queryUses : "")
  );
}

export function getPathsIgnoreInvalid(configFile: string): string {
  return getConfigFilePropertyError(
    configFile,
    PATHS_IGNORE_PROPERTY,
    "must be an array of non-empty strings"
  );
}

export function getPathsInvalid(configFile: string): string {
  return getConfigFilePropertyError(
    configFile,
    PATHS_PROPERTY,
    "must be an array of non-empty strings"
  );
}

export function getLocalPathOutsideOfRepository(configFile: string, localPath: string): string {
  return getConfigFilePropertyError(
    configFile,
    QUERIES_PROPERTY + "." + QUERIES_USES_PROPERTY,
    'is invalid as the local path "' + localPath + '" is outside of the repository'
  );
}

export function getLocalPathDoesNotExist(configFile: string, localPath: string): string {
  return getConfigFilePropertyError(
    configFile,
    QUERIES_PROPERTY + "." + QUERIES_USES_PROPERTY,
    'is invalid as the local path "' + localPath + '" does not exist in the repository'
  );
}

export function getConfigFileOutsideWorkspaceErrorMessage(configFile: string): string {
  return 'The configuration file "' + configFile + '" is outside of the workspace';
}

export function getConfigFileDoesNotExistErrorMessage(configFile: string): string {
  return 'The configuration file "' + configFile + '" does not exist';
}

function getConfigFilePropertyError(configFile: string, property: string, error: string): string {
  return (
    'The configuration file "' + configFile + '" is invalid: property "' + property + '" ' + error
  );
}

function initConfig(pathToConfig): Config {
  const config = new Config();

  // If no config file was provided create an empty one
  if (pathToConfig === "") {
    return config;
  }

  // Treat the config file as relative to the workspace
  const workspacePath = util.getRequiredEnvParam("CIRCLE_WORKING_DIRECTORY");
  pathToConfig = path.resolve(workspacePath, pathToConfig);

  // Error if the config file is now outside of the workspace
  if (!(pathToConfig + path.sep).startsWith(workspacePath + path.sep)) {
    throw new Error(getConfigFileOutsideWorkspaceErrorMessage(pathToConfig));
  }

  // Error if the file does not exist
  if (!fs.existsSync(pathToConfig)) {
    throw new Error(getConfigFileDoesNotExistErrorMessage(pathToConfig));
  }

  const parsedYAML = yaml.safeLoad(fs.readFileSync(pathToConfig, "utf8"));

  if (NAME_PROPERTY in parsedYAML) {
    if (typeof parsedYAML[NAME_PROPERTY] !== "string") {
      throw new Error(getNameInvalid(pathToConfig));
    }
    if (parsedYAML[NAME_PROPERTY].length === 0) {
      throw new Error(getNameInvalid(pathToConfig));
    }
    config.name = parsedYAML[NAME_PROPERTY];
  }

  if (DISPLAY_DEFAULT_QUERIES_PROPERTY in parsedYAML) {
    if (typeof parsedYAML[DISPLAY_DEFAULT_QUERIES_PROPERTY] !== "boolean") {
      throw new Error(getDisableDefaultQueriesInvalid(pathToConfig));
    }
    config.disableDefaultQueries = parsedYAML[DISPLAY_DEFAULT_QUERIES_PROPERTY];
  }

  if (QUERIES_PROPERTY in parsedYAML) {
    if (!(parsedYAML[QUERIES_PROPERTY] instanceof Array)) {
      throw new Error(getQueriesInvalid(pathToConfig));
    }
    parsedYAML[QUERIES_PROPERTY].forEach((query) => {
      if (!(QUERIES_USES_PROPERTY in query) || typeof query[QUERIES_USES_PROPERTY] !== "string") {
        throw new Error(getQueryUsesInvalid(pathToConfig));
      }
      config.addQuery(pathToConfig, query[QUERIES_USES_PROPERTY]);
    });
  }

  if (PATHS_IGNORE_PROPERTY in parsedYAML) {
    if (!(parsedYAML[PATHS_IGNORE_PROPERTY] instanceof Array)) {
      throw new Error(getPathsIgnoreInvalid(pathToConfig));
    }
    parsedYAML[PATHS_IGNORE_PROPERTY].forEach((path) => {
      if (typeof path !== "string" || path === "") {
        throw new Error(getPathsIgnoreInvalid(pathToConfig));
      }
      config.pathsIgnore.push(path);
    });
  }

  if (PATHS_PROPERTY in parsedYAML) {
    if (!(parsedYAML[PATHS_PROPERTY] instanceof Array)) {
      throw new Error(getPathsInvalid(pathToConfig));
    }
    parsedYAML[PATHS_PROPERTY].forEach((path) => {
      if (typeof path !== "string" || path === "") {
        throw new Error(getPathsInvalid(pathToConfig));
      }
      config.paths.push(path);
    });
  }

  return config;
}

export const CODEQL_CONFIG = "codeql_config";

async function saveConfig(config: Config) {
  const configString = JSON.stringify(config);
  util.mkdirP(SWISSKNIFE_DIR);
  fs.writeFileSync(getConfigFile(), configString, "utf8");
}

export function getConfigFile(): string {
  return path.join(SWISSKNIFE_DIR, CODEQL_CONFIG);
}

export async function loadConfig(configPath: string): Promise<Config> {
  const configFile = getConfigFile();
  if (fs.existsSync(configFile)) {
    const configString = fs.readFileSync(configFile, "utf8");
    console.log("Loaded config");
    return JSON.parse(configString);
  } else {
    const config = initConfig(configPath);
    console.log("Initialized config:");
    console.log(JSON.stringify(config));
    await saveConfig(config);
    return config;
  }
}
