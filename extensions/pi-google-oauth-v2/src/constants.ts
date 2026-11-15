export const PROVIDER_ID = 'google-oauth-v2';
export const PROVIDER_DISPLAY_NAME = 'Google AI subscription';
export const API_ID = 'google-code-assist';
export const CODE_ASSIST_BASE_URL = 'https://cloudcode-pa.googleapis.com/v1internal';

/**
 * Carries the Code Assist project id from toAuth() to the stream inside ModelAuth.headers.
 * The stream removes it before dispatch. It is not the apiKey, which stays the bare bearer
 * token, and not options.env, which Pi does not forward on the OAuth path.
 */
export const PROJECT_HEADER = 'x-pi-google-project';
