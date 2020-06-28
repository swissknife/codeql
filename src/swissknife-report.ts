import * as fs from "fs";
import * as path from "path";

import * as util from "./util";
import _ from "lodash";

// TODO(roopakv): Make this work for bitbucket.
function getFileUriAtCommit(uri: string, lineLoc?: string) {
  const owner = util.getRequiredEnvParam("CIRCLE_PROJECT_USERNAME");
  const repo = util.getRequiredEnvParam("CIRCLE_PROJECT_REPONAME");
  const currentSha = util.getRequiredEnvParam("CIRCLE_SHA1");
  if (!lineLoc) {
    lineLoc = "";
  }
  return `https://github.com/${owner}/${repo}/blob/${currentSha}/${uri}${lineLoc}`;
}

async function fixUpReports(reportFolder: string) {
  try {
    const files = fs.readdirSync(reportFolder);
    for (let report of files) {
      if (!report || !report.endsWith(".sarif")) {
        continue;
      }
      const reportString = fs.readFileSync(path.join(reportFolder, report), "utf-8");
      const reportJson = JSON.parse(reportString);
      // TODO(roopakv): Handle more than first run
      const run = reportJson.runs && reportJson.runs.length > 0 && reportJson.runs[0];
      if (!run) {
        continue;
      }
      for (let result of run.results) {
        console.log(result);
        if (result.relatedLocations && result.relatedLocations.length > 0) {
          for (let rloc of result.relatedLocations) {
            const uri = _.get(rloc, "physicalLocation.artifactLocation.uri");
            const startLine = _.get(rloc, "physicalLocation.region.startLine", "");
            if (uri) {
              _.set(
                rloc,
                "physicalLocation.artifactLocation.uri",
                getFileUriAtCommit(uri, startLine)
              );
            }
          }
        }

        const ploc = _.get(result, "locations.0.physicalLocation");
        const artLoc = ploc && ploc.artifactLocation;
        const artUri = artLoc && artLoc.uri;
        let startLine = _.get(ploc, "region.startLine");
        startLine = startLine ? `#${startLine}` : "";
        if (artUri) {
          _.set(artLoc, "properties.href", getFileUriAtCommit(artUri, startLine));
        }
      }
      fs.writeFileSync(path.join(reportFolder, `${report}.swissknife`), JSON.stringify(reportJson));
    }
  } catch (err) {
    console.error("Couldn't build Swissknife sarif");
    console.log(err);
  }
}

export async function run() {
  const outputFolder = util.getRequiredEnvParam("SK_OUTPUT");
  const reportToSwissknife = process.env.SK_REPORT_TO_SWISSKNIFE;
  if (reportToSwissknife && reportToSwissknife === "true") {
    console.log("Fixing up reports");
    await fixUpReports(outputFolder);
  } else {
    console.log("Nothing to do, not reporting to swissknife");
  }
}
