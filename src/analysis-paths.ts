import * as configUtils from "./config-utils";

export function includeAndExcludeAnalysisPaths(config: configUtils.Config, languages: string[]) {
  if (config.paths.length !== 0) {
    process.env["LGTM_INDEX_INCLUDE"] = config.paths.join("\n");
  }

  if (config.pathsIgnore.length !== 0) {
    process.env["LGTM_INDEX_EXCLUDE"] = config.pathsIgnore.join("\n");
  }

  function isInterpretedLanguage(language): boolean {
    return language === "javascript" || language === "python";
  }

  // Index include/exclude only work in javascript and python
  // If some other language is detected/configured show a warning
  if (
    (config.paths.length !== 0 || config.pathsIgnore.length !== 0) &&
    !languages.every(isInterpretedLanguage)
  ) {
    console.warn(
      'The "paths"/"paths-ignore" fields of the config only have effect for Javascript and Python'
    );
  }
}
