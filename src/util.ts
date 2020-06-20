import * as octokit from "@octokit/rest";
import consoleLogLevel from "console-log-level";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import * as sharedEnv from "./shared-environment";

export function mkdirP(path) {
  fs.mkdirSync(path, { recursive: true });
}

/**
 * Get an environment parameter, but throw an error if it is not set.
 */
export function getRequiredEnvParam(paramName: string): string {
  const value = process.env[paramName];
  if (value === undefined) {
    throw new Error(paramName + " environment variable must be set");
  }
  return value;
}

/**
 * Gets the set of languages in the current repository
 */
async function getLanguagesInRepo(): Promise<string[]> {
  // Translate between GitHub's API names for languages and ours
  const codeqlLanguages = {
    C: "cpp",
    "C++": "cpp",
    "C#": "csharp",
    Go: "go",
    Java: "java",
    JavaScript: "javascript",
    TypeScript: "javascript",
    Python: "python",
  };
  let owner = getRequiredEnvParam("CIRCLE_PROJECT_USERNAME");
  let repo = getRequiredEnvParam("CIRCLE_PROJECT_REPONAME");

  console.debug(`GitHub repo ${owner} ${repo}`);
  let ok = new octokit.Octokit({
    auth: process.env.GITHUB_TOKEN,
    userAgent: "Swissknife CodeQL",
    log: consoleLogLevel({ level: "debug" }),
  });
  const response = await ok.request("GET /repos/:owner/:repo/languages", {
    owner,
    repo,
  });

  console.debug("Languages API response: " + JSON.stringify(response));

  // The GitHub API is going to return languages in order of popularity,
  // When we pick a language to autobuild we want to pick the most popular traced language
  // Since sets in javascript maintain insertion order, using a set here and then splatting it
  // into an array gives us an array of languages ordered by popularity
  let languages: Set<string> = new Set();
  for (let lang in response.data) {
    if (lang in codeqlLanguages) {
      languages.add(codeqlLanguages[lang]);
    }
  }
  return [...languages];
}

/**
 * Get the languages to analyse.
 *
 * The result is obtained from the environment parameter CODEQL_ACTION_LANGUAGES
 * if that has been set, otherwise it is obtained from the action input parameter
 * 'languages' if that has been set, otherwise it is deduced as all languages in the
 * repo that can be analysed.
 *
 * If the languages are obtained from either of the second choices, the
 * CODEQL_ACTION_LANGUAGES environment variable will be exported with the
 * deduced list.
 */
export async function getLanguages(): Promise<string[]> {
  // Obtain from CODEQL_ACTION_LANGUAGES if set
  const langsVar = process.env[sharedEnv.CODEQL_ACTION_LANGUAGES];
  if (langsVar) {
    return langsVar
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }

  // Obtain languages as all languages in the repo that can be analysed
  const languages = await getLanguagesInRepo();
  console.info("Automatically detected languages: " + JSON.stringify(languages));

  saveToCircleEnv(sharedEnv.CODEQL_ACTION_LANGUAGES, languages.join(","));
  return languages;
}

/**
 * Gets the SHA of the commit being processed.
 */
export async function getCommitOid(): Promise<string> {
  return getRequiredEnvParam("CIRCLE_SHA1");
}

/**
 * Get the array of all the tool names contained in the given sarif contents.
 *
 * Returns an array of unique string tool names.
 */
export function getToolNames(sarifContents: string): string[] {
  const sarif = JSON.parse(sarifContents);
  const toolNames = {};

  for (const run of sarif.runs || []) {
    const tool = run.tool || {};
    const driver = tool.driver || {};
    if (typeof driver.name === "string" && driver.name.length > 0) {
      toolNames[driver.name] = true;
    }
  }

  return Object.keys(toolNames);
}

// Creates a random temporary directory, runs the given body, and then deletes the directory.
// Mostly intended for use within tests.
export async function withTmpDir<T>(body: (tmpDir: string) => Promise<T>): Promise<T> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeql-action-"));
  const result = await body(tmpDir);
  fs.rmdirSync(tmpDir, { recursive: true });
  return result;
}

export function saveToCircleEnv(key: string, val: string) {
  const filePath = getRequiredEnvParam("BASH_ENV");
  fs.appendFileSync(filePath, `export ${key}="${val}"\n`);
  process.env[key] = val;
}
