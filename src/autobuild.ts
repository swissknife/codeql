import * as exec from "@actions/exec";
import * as path from "path";

import * as sharedEnv from "./shared-environment";
import * as util from "./util";

export async function run() {
  console.log("Starting autobuild");
  try {
    // Attempt to find a language to autobuild
    // We want pick the dominant language in the repo from the ones we're able to build
    // The languages are sorted in order specified by user or by lines of code if we got
    // them from the GitHub API, so try to build the first language on the list.
    const autobuildLanguages =
      process.env[sharedEnv.CODEQL_ACTION_TRACED_LANGUAGES]?.split(",") || [];
    const language = autobuildLanguages[0];

    if (!language) {
      console.log("None of the languages in this project require extra build steps");
      return;
    }

    console.info(`Detected dominant traced language: ${language}`);

    if (autobuildLanguages.length > 1) {
      console.info(
        `We will only automatically build ${language} code. If you wish` +
          ` to scan ${autobuildLanguages.slice(1).join(" and ")}, you must ` +
          `use the custom language option in the swissknife orb.`
      );
    }

    console.info(`Attempting to automatically build ${language} code`);
    // TODO: Move these to circle bash
    const codeqlCmd = util.getRequiredEnvParam(sharedEnv.CODEQL_ACTION_CMD);

    const cmdName = process.platform === "win32" ? "autobuild.cmd" : "autobuild.sh";
    const autobuildCmd = path.join(path.dirname(codeqlCmd), language, "tools", cmdName);

    // Update JAVA_TOOL_OPTIONS to contain '-Dhttp.keepAlive=false'
    // This is because of an issue with Azure pipelines timing out connections after 4 minutes
    // and Maven not properly handling closed connections
    // Otherwise long build processes will timeout when pulling down Java packages
    // https://developercommunity.visualstudio.com/content/problem/292284/maven-hosted-agent-connection-timeout.html
    let javaToolOptions = process.env["JAVA_TOOL_OPTIONS"] || "";
    process.env["JAVA_TOOL_OPTIONS"] = [
      ...javaToolOptions.split(/\s+/),
      "-Dhttp.keepAlive=false",
      "-Dmaven.wagon.http.pool=false",
    ].join(" ");

    await exec.exec(autobuildCmd);
  } catch (error) {
    console.error(
      "We were unable to automatically build your code. Please replace the call to the autobuild action with your custom build steps.  " +
        error.message
    );
    throw error;
  }

  console.info("Autobuild finished successfully");
}
