export const CODEQL_ACTION_CMD = "CODEQL_ACTION_CMD";
export const CODEQL_ACTION_DATABASE_DIR = "CODEQL_ACTION_DATABASE_DIR";
export const CODEQL_ACTION_LANGUAGES = "CODEQL_ACTION_LANGUAGES";
export const CODEQL_ACTION_ANALYSIS_KEY = "CODEQL_ACTION_ANALYSIS_KEY";
export const ODASA_TRACER_CONFIGURATION = "ODASA_TRACER_CONFIGURATION";
export const CODEQL_ACTION_SCANNED_LANGUAGES = "CODEQL_ACTION_SCANNED_LANGUAGES";
export const CODEQL_ACTION_TRACED_LANGUAGES = "CODEQL_ACTION_TRACED_LANGUAGES";
// The time at which the first action (normally init) started executing.
// If a workflow invokes a different action without first invoking the init
// action (i.e. the upload action is being used by a third-party integrator)
// then this variable will be assigned the start time of the action invoked
// rather that the init action.
export const CODEQL_ACTION_STARTED_AT = "CODEQL_ACTION_STARTED_AT";
// Populated when the init action completes successfully
export const CODEQL_ACTION_INIT_COMPLETED = "CODEQL_ACTION_INIT_COMPLETED";
