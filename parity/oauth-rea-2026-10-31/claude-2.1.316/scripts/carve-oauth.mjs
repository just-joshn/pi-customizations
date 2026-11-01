#!/usr/bin/env node
import { openSync, readSync, closeSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const BIN = process.argv[2];
const OUT = process.argv[3];
const WINDOW = Number(process.argv[4] || 4096);

const MARKERS = [
  { id: "TOKEN_CONFIG", needle: "CLAUDE_AI_AUTHORIZE_URL" },
  { id: "CLIENT_ID_prod", needle: "9d1c250a-e61b-44d9-88ed-5944d1962f5e" },
  { id: "TOKEN_URL", needle: "https://platform.claude.com/v1/oauth/token" },
  { id: "CAI_AUTHORIZE", needle: "https://claude.com/cai/oauth/authorize" },
  { id: "CONSOLE_AUTHORIZE", needle: "https://platform.claude.com/oauth/authorize" },
  { id: "MANUAL_REDIRECT", needle: "https://platform.claude.com/oauth/code/callback" },
  { id: "ALLOWED_beacon", needle: "https://beacon.claude-ai.staging.ant.dev" },
  { id: "ALLOWED_fedstart", needle: "https://claude.fedstart.com" },
  { id: "ALLOWED_fedstart_staging", needle: "https://claude-staging.fedstart.com" },
  { id: "CUSTOM_OAUTH_ERR", needle: "CLAUDE_CODE_CUSTOM_OAUTH_URL is not an approved endpoint." },
  { id: "Invalid_authorization_code", needle: "Authentication failed: Invalid authorization code" },
  { id: "Invalid_code_paste", needle: "Invalid code. Please make sure the full code was copied." },
  { id: "code_not_from_signin", needle: "That code is not from this sign-in" },
  { id: "claudeAiOauth", needle: "claudeAiOauth" },
  { id: "oauthRefreshLatch", needle: "oauthRefreshLatch" },
  { id: "refresh_token_expires_in", needle: "refresh_token_expires_in" },
  { id: "code_challenge_method", needle: "code_challenge_method" },
  { id: "org_create_api_key", needle: "org:create_api_key" },
  { id: "user_plugins", needle: "user:plugins" },
  { id: "user_sessions_claude_code", needle: "user:sessions:claude_code" },
  { id: "oauth_profile", needle: "/api/oauth/profile" },
  { id: "oauth_validate", needle: "/api/oauth/validate" },
  { id: "create_api_key", needle: "/api/oauth/claude_cli/create_api_key" },
  { id: "roles_url", needle: "/api/oauth/claude_cli/roles" },
  { id: "mcp_client_metadata", needle: "https://claude.ai/oauth/claude-code-client-metadata" },
  { id: "DESIGN_CLIENT_ID", needle: "59637612-477b-4836-a601-b0589eda7704" },
  { id: "LOCAL_CLIENT_ID", needle: "22422756-60c9-4084-8eb7-27705fd5cf9a" },
  { id: "oauth_beta", needle: "oauth-2025-04-20" },
  { id: "cc_version", needle: "cc_version=" },
  { id: "isCompactSummary", needle: "isCompactSummary" },
  { id: "CLAUDE_CODE_OAUTH_TOKEN", needle: "CLAUDE_CODE_OAUTH_TOKEN" },
  { id: "ANTHROPIC_AUTH_TOKEN", needle: "ANTHROPIC_AUTH_TOKEN" },
  { id: "ANTHROPIC_OAUTH_TOKEN", needle: "ANTHROPIC_OAUTH_TOKEN" },
  { id: "credentials_json", needle: ".credentials.json" },
  { id: "find_generic_password", needle: "find-generic-password" },
  { id: "ELOCKED", needle: "ELOCKED" },
  { id: "waitForAuthorizationCode", needle: "waitForAuthorizationCode" },
  { id: "ALLOWED_OAUTH_BASE_URLS", needle: "ALLOWED_OAUTH_BASE_URLS" },
  { id: "PLUGINS_SCOPE", needle: "PLUGINS_SCOPE_REGISTERED" },
  { id: "token_type_hint", needle: "token_type_hint" },
  { id: "Token_exchange_failed", needle: "Token exchange failed" },
  { id: "loginWithClaudeAi", needle: "loginWithClaudeAi" },
  { id: "SECURESTORAGE", needle: "CLAUDE_SECURESTORAGE_CONFIG_DIR" },
  { id: "CLAUDE_CONFIG_DIR", needle: "CLAUDE_CONFIG_DIR" },
  { id: "billing_salt_hint", needle: "59cf53e54c78" },
  { id: "pkce_import_crypto", needle: 'import{createHash as' },
  { id: "split_hash_paste", needle: '.split("#")' },
  { id: "expiresAt_plus", needle: "expires_in*1000" },
  { id: "AA_buffer_300000", needle: "300000" },
  { id: "x-app", needle: "x-app" },
  { id: "Claude_Code_service", needle: "Claude Code" },
  { id: "oauthAccount", needle: "oauthAccount" },
  { id: "refreshTokenExpiresAt", needle: "refreshTokenExpiresAt" },
  { id: "subscriptionType", needle: "subscriptionType" },
  { id: "rateLimitTier", needle: "rateLimitTier" },
  { id: "useManualRedirect", needle: "useManualRedirect" },
  { id: "authCodeListener", needle: "authCodeListener" },
];

mkdirSync(join(OUT, "carves"), { recursive: true });
const size = statSync(BIN).size;
const fd = openSync(BIN, "r");

function findAll(needleBuf, maxHits = 32) {
  const hits = [];
  const chunk = 8 * 1024 * 1024;
  const overlap = Math.max(0, needleBuf.length - 1);
  let offset = 0;
  let prevTail = Buffer.alloc(0);
  while (offset < size && hits.length < maxHits) {
    const toRead = Math.min(chunk, size - offset);
    const buf = Buffer.allocUnsafe(toRead);
    readSync(fd, buf, 0, toRead, offset);
    const hay = prevTail.length ? Buffer.concat([prevTail, buf]) : buf;
    const base = offset - prevTail.length;
    let from = 0;
    while (hits.length < maxHits) {
      const i = hay.indexOf(needleBuf, from);
      if (i < 0) break;
      hits.push(base + i);
      from = i + 1;
    }
    prevTail = hay.subarray(Math.max(0, hay.length - overlap));
    offset += toRead;
  }
  return hits;
}

const index = {
  binary: BIN,
  sha256: "64c327e92b2c5e0f78c0a980c5a518121e1f0d140ca771ca5dd4488d1a2dcb3f",
  version: "2.1.316",
  size,
  markers: {},
};

for (const m of MARKERS) {
  const hits = findAll(Buffer.from(m.needle, "utf8"));
  index.markers[m.id] = { needle: m.needle, offsets: hits, count: hits.length };
  console.log(`${m.id}\t${hits.length}\t${hits.slice(0, 8).join(",")}`);
  for (const off of hits.slice(0, 3)) {
    const start = Math.max(0, off - Math.floor(WINDOW / 4));
    const len = Math.min(WINDOW, size - start);
    const win = Buffer.allocUnsafe(len);
    readSync(fd, win, 0, len, start);
    const sha = createHash("sha256").update(win).digest("hex");
    const header = `# offset=${off} window_start=${start} window_len=${len} window_sha256=${sha} needle=${JSON.stringify(m.needle)}\n`;
    const body = win.toString("utf8").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ".");
    writeFileSync(join(OUT, "carves", `carve-${m.id}@${off}.txt`), header + body);
  }
}
closeSync(fd);
writeFileSync(join(OUT, "string-offsets.json"), JSON.stringify(index, null, 2));
console.log("wrote", join(OUT, "string-offsets.json"));
