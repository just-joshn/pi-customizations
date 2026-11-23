/** Shared numeric limits for every tool in the layer. */

/** Characters kept for one text read. Larger files stream and truncate at this cap. */
export const MAX_READ_CHARS = 8 * 1024 * 1024;

/** Lines kept for one content search result. */
export const MAX_GREP_RESULT_LINES = 2000;

/** Output lines a paginated search may request, so offset can reach the end of the result window. */
export const MAX_GREP_RESULT_WINDOW_LINES = 50_000;

/** Lines after which a running search is killed. */
export const MAX_GREP_OUTPUT_LINES = 10_000;

/** Bytes of search stdout kept before the search is killed. */
export const MAX_GREP_OUTPUT_BYTES = 8 * 1024 * 1024;

/** Wall clock budget for one search before partial results are returned. */
export const GREP_TIMEOUT_MS = 25_000;

/** Characters kept for one matched line before it is cut and flagged. */
export const GREP_MAX_LINE_LENGTH = 500;

/** Characters of directory entry names kept for one listing. */
export const LS_NAME_BUDGET = 2500;

/** Wall clock budget for one directory listing before the partial tree is returned. */
export const LS_TIMEOUT_MS = 5000;

/** Default and maximum entries returned by a glob search. */
export const GLOB_DEFAULT_LIMIT = 2000;
export const GLOB_MAX_LIMIT = MAX_GREP_OUTPUT_LINES;

/** Files above this size skip the delete content snapshot. */
export const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;

/** Read fence entries kept per session. The oldest entry is dropped once the cap is passed. */
export const MAX_FENCE_ENTRIES = 1000;

/** Bytes fetched by the web fetch tool before the body is reported as truncated. */
export const WEB_FETCH_MAX_BYTES = 2 * 1024 * 1024;

/** Bytes saved to disk before a resource is reported as too large. */
export const RESOURCE_MAX_BYTES = 64 * 1024 * 1024;

/** Directory, relative to the workspace root, where the layer keeps spilled output. */
export const SPILL_DIR = '.pi/agent-tools';

/** Ignore files honored by search, listing, and glob. */
export const DEFAULT_IGNORE_FILES = ['.gitignore', '.ignore', '.piignore'] as const;

/** Configuration file names read from the workspace and from the agent directory. */
export const PROJECT_CONFIG_FILE = '.pi/pi-tools.json';
export const USER_CONFIG_FILE = 'pi-tools.json';
