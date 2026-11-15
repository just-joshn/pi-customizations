export const PROVIDER_ID = 'google-oauth-v2';
export const PROVIDER_DISPLAY_NAME = 'Google AI subscription';
export const API_ID = 'google-code-assist';
// Consumer plans are served by the daily ring. Production cloudcode-pa returns 429 RESOURCE_EXHAUSTED to them.
export const CODE_ASSIST_BASE_URL = 'https://daily-cloudcode-pa.googleapis.com/v1internal';
export const PRIVATE_PROJECT_HEADER = 'x-pi-google-oauth-v2-project';

const OS_TYPES: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
const ARCHITECTURES: Record<string, string> = { arm64: 'arm64', x64: 'amd64' };

export function antigravityUserAgent(platform: string = process.platform, arch: string = process.arch): string {
  return `antigravity/cli/1.5.9 (aidev_client; os_type=${OS_TYPES[platform] ?? platform}; arch=${ARCHITECTURES[arch] ?? arch}; cl=1021519450; auth_method=consumer)`;
}

// Google rejects a Code Assist request without this header as UNSUPPORTED_CLIENT, so every call must send it.
export const ANTIGRAVITY_USER_AGENT = antigravityUserAgent();
