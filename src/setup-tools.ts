import * as path from "path";

export class CodeQLSetup {
  public dist: string;
  public tools: string;
  public cmd: string;
  public platform: string;

  constructor(codeqlDist: string) {
    this.dist = codeqlDist;
    this.tools = path.join(this.dist, "tools");
    this.cmd = path.join(codeqlDist, "codeql");
    // TODO check process.arch ?
    if (process.platform === "win32") {
      this.platform = "win64";
      if (this.cmd.endsWith("codeql")) {
        this.cmd += ".cmd";
      }
    } else if (process.platform === "linux") {
      this.platform = "linux64";
    } else if (process.platform === "darwin") {
      this.platform = "osx64";
    } else {
      throw new Error("Unsupported plaform: " + process.platform);
    }
  }
}

const CODEQL_PATH = process.env.SK_CODEQL_LOCATION || "/var/swissknife/";

export async function setupCodeQL(): Promise<CodeQLSetup> {
  return new CodeQLSetup(path.join(CODEQL_PATH, "codeql"));
}
