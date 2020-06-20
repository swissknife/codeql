import * as setup from "./setup";
import * as autobuild from "./autobuild";
import * as finalize from "./finalize-db";

var args = process.argv.slice(2);

let methodToRun: Function;

switch (args[0]) {
  case "setup":
    methodToRun = setup.run;
    break;
  case "build":
    methodToRun = autobuild.run;
    break;
  case "finalize":
    methodToRun = finalize.run;
    break;
  default:
    console.error("Invalid method, use one of setup, build or finalize");
    process.exit(1);
}

methodToRun().catch((err) => {
  console.log(err);
  process.exit(1);
});
