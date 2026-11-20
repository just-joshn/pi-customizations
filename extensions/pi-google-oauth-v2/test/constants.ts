/** The wire contract Pi and Google see. Tests spell these out so a rename in `src/` fails a test. */
export const PROVIDER_ID = 'google-oauth-v2';
export const PROVIDER_NAME = 'Google AI subscription';
export const PRIVATE_PROJECT_HEADER = 'x-pi-google-oauth-v2-project';
export const CODE_ASSIST_BASE_URL = 'https://daily-cloudcode-pa.googleapis.com/v1internal';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const MANUAL_REDIRECT = 'https://antigravity.google/oauth-callback';
export const LOOPBACK_ORIGIN = 'http://127.0.0.1:';
export const ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
export const SCOPE_BASE = 'https://www.googleapis.com/auth';

/** Route fragments that pick a fake Google responder by request URL. */
export const ROUTE_TOKEN = 'oauth2.googleapis.com/token';
export const ROUTE_LOAD = ':loadCodeAssist';
export const ROUTE_ONBOARD = ':onboardUser';
export const ROUTE_OPERATION = '/operations/';
export const ROUTE_CATALOG = ':fetchAvailableModels';
export const ROUTE_STREAM = ':streamGenerateContent';

export const HTTP_OK = 200;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_FORBIDDEN = 403;
export const HTTP_PAYLOAD_TOO_LARGE = 413;
export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_INTERNAL_ERROR = 500;
export const HTTP_BAD_GATEWAY = 502;

export const MS_PER_SECOND = 1000;
export const CREDENTIAL_TTL_MS = 3_600_000;
export const NEAR_EXPIRY_MS = 1_000;
export const EXPIRES_IN_SECONDS = 3600;
export const LOOPBACK_TIMEOUT_MS = 300_000;
export const POLL_INTERVAL_MS = 5000;
export const MAX_POLLS = 60;
