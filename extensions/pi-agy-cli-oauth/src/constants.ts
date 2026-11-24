/* eslint-disable no-magic-numbers -- Numbers belong in the constants file; every one is named and documented. */
/**
 * Provider identity and the names this extension exposes outside its own modules.
 *
 * `API_ID` is not a wire protocol. It is the provider-private stream implementation
 * id, so a model carrying it can only ever be served by this extension.
 */
export const PROVIDER_ID = 'antigravity-cli';
export const API_ID = 'antigravity-acp';
export const PROVIDER_DISPLAY_NAME = 'Antigravity CLI (Experimental)';

/**
 * A sentinel rather than a URL: every request leaves through a spawned `agy`
 * process, so Pi must never present this value to a network client.
 */
export const PROCESS_BASE_URL = 'process://agy-cli';

/** The executable name the reference CLI installs on `PATH`. */
export const DEFAULT_COMMAND = 'agy';

export const COMMAND_ENV = 'PI_AGY_COMMAND';
export const GEMINI_DIR_ENV = 'PI_AGY_GEMINI_DIR';
export const APP_DATA_DIR_ENV = 'PI_AGY_APP_DATA_DIR';
export const TELEMETRY_ENV = 'PI_AGY_TELEMETRY';

/**
 * The Antigravity CLI reads these to bill a turn to a paid Gemini API key instead
 * of the signed-in plan. Inheriting one silently changes what a request costs, so
 * the child environment drops both unless the operator opts in.
 */
export const API_KEY_ENV_NAMES = ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] as const;
export const INHERIT_API_KEY_ENV = 'PI_AGY_INHERIT_API_KEY';

/** Env values the provider reads through Pi's auth hooks so `models.json` can set them. */
export const PROVIDER_ENV_NAMES = [COMMAND_ENV, GEMINI_DIR_ENV, APP_DATA_DIR_ENV, INHERIT_API_KEY_ENV] as const;

/** Observed on `session/update.usage_update.size` for `gemini-3.8-flash`. */
export const DEFAULT_CONTEXT_WINDOW = 1_048_576;
/** Claude and gpt-oss entries in the same catalog are far smaller; 200K is the conservative floor. */
export const SMALL_CONTEXT_WINDOW = 200_000;
export const DEFAULT_MAX_TOKENS = 64_000;

/**
 * A cancelled prompt still answers with the turn's token counts. The grace window
 * is how long a settled tool turn waits for that answer before reporting none.
 */
export const CANCEL_USAGE_GRACE_MS = 2_500;

/** A probe spawns a process, so an unchanged environment reuses the last answer briefly. */
export const PROBE_TTL_MS = 2 * 60 * 1_000;

/** `initialize` and `session/new` complete in seconds; a prompt may run far longer. */
export const HANDSHAKE_TIMEOUT_MS = 30_000;
/**
 * The CLI reads the keyring on boot, and `session/new` can race that read. Two
 * retries cover the race; `-32000` is also the permanent "signed out" answer, and
 * spending the whole budget on that only makes a status check slow.
 */
export const AUTH_RETRY_DELAY_MS = 2_500;
export const AUTH_RETRIES = 2;
