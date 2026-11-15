#!/usr/bin/env bash
#   scripts/prove.sh           offline checks: D1, D4, D5 (isolated temp agent dirs)
#   scripts/prove.sh --live    adds D2 and D3, which use your real ~/.pi/agent login
set -uo pipefail

PKG="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$PKG/../.." && pwd)"
ID=anthropic-oauth-v2
MODEL="${PROVE_MODEL:-$ID/claude-sonnet-4-5}"
FAILS=0
pass() { echo "VERIFIED      $1"; }
fail() { echo "NOT VERIFIED  $1"; FAILS=$((FAILS + 1)); }
tmp_agent() { local d; d="$(mktemp -d)"; [ -n "${1:-}" ] && printf '%s' "$1" > "$d/auth.json"; echo "$d"; }
run_pi() { local dir="$1"; shift; PI_OFFLINE=1 PI_CODING_AGENT_DIR="$dir" timeout 60 pi -ne -e "$PKG" "$@" </dev/null 2>&1; }
FUTURE=$(( ($(date +%s) + 86400) * 1000 ))

d=$(tmp_agent "{\"$ID\":{\"type\":\"oauth\",\"access\":\"sk-ant-oat01-fake\",\"refresh\":\"r\",\"expires\":$FUTURE}}")
n=$(run_pi "$d" --list-models "$ID" | grep -cE "^$ID[[:space:]]" || true)
[ "$n" -gt 0 ] && pass "D1 lists $n $ID models" || fail "D1 no $ID models listed"

deny() {
  local label="$1" auth="$2"; shift 2
  local d out; d=$(tmp_agent "$auth")
  out=$(env "$@" PI_CODING_AGENT_DIR="$d" PI_OFFLINE=1 timeout 60 pi -ne -e "$PKG" -p --model "$MODEL" "Reply OK" </dev/null 2>&1)
  if grep -q "No API key found for $ID" <<<"$out" && [ -z "$(run_pi "$d" --list-models "$ID" | grep -E "^$ID[[:space:]]")" ]; then
    pass "D4 $label: pi found no usable auth, no request sent"
  elif grep -q "refusing non-OAuth" <<<"$out" && ! grep -qiE '^OK$|401|authentication_error' <<<"$out"; then
    pass "D4 $label: refused by the request check"
  else
    fail "D4 $label: $(head -c 200 <<<"$out" | tr '\n' ' ')"
  fi
}
deny "env API key/token only" "" ANTHROPIC_API_KEY=sk-ant-api03-bogus ANTHROPIC_OAUTH_TOKEN=sk-ant-api03-bogus ANTHROPIC_AUTH_TOKEN=bogus
deny "stored api_key credential" "{\"$ID\":{\"type\":\"api_key\",\"key\":\"sk-ant-api03-bogus\"}}"
deny "oauth slot holding an API key" "{\"$ID\":{\"type\":\"oauth\",\"access\":\"sk-ant-api03-bogus\",\"refresh\":\"r\",\"expires\":$FUTURE}}"

WIRE="$(mktemp -d)"
node -e '
const fs = require("fs"), [log, portFile] = process.argv.slice(1);
const s = require("http").createServer((q, r) => {
  const k = Object.entries(q.headers).filter(([name, value]) => name !== "authorization" && (/auth|api.?key|token|secret|credential|cookie|subscription|password/.test(name) || String(value).includes("sk-ant-"))).map(([name]) => name);
  fs.appendFileSync(log, JSON.stringify({ a: q.headers.authorization || "", k }) + "\n");
  r.writeHead(401, { "content-type": "application/json" });
  r.end("{\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"x\"}}");
});
s.listen(0, "127.0.0.1", () => fs.writeFileSync(portFile, String(s.address().port)));' "$WIRE/log" "$WIRE/port" &
SRV=$!; trap 'kill $SRV 2>/dev/null' EXIT
for _ in $(seq 25); do [ -s "$WIRE/port" ] && break; sleep 0.2; done
OAUTH="{\"$ID\":{\"type\":\"oauth\",\"access\":\"sk-ant-oat01-fake\",\"refresh\":\"r\",\"expires\":$FUTURE}}"
wire() {
  local d; d=$(tmp_agent "$3"); : > "$WIRE/log"
  printf '{"providers":{"%s":{"baseUrl":"http://127.0.0.1:%s"%s}}}' "$ID" "$(cat "$WIRE/port")" "$2" > "$d/models.json"
  out=$(run_pi "$d" -p --model "${WIRE_MODEL:-$MODEL}" "Reply OK")
  sent=$(grep -c . "$WIRE/log" || true)
  bad=$(jq -s '[.[] | select((.k | length) > 0 or (.a | startswith("Bearer sk-ant-oat") | not))] | length' "$WIRE/log")
}
wire "control" "" "$OAUTH"
[ "$sent" -gt 0 ] && [ "$bad" -eq 0 ] && pass "D4 wire control: server saw the OAuth bearer only" || fail "D4 wire control: sent=$sent bad=$bad"
wire_deny() {
  wire "$@"
  if [ "$bad" -eq 0 ] && grep -qE "refusing non-OAuth|No API key found for $ID" <<<"$out"; then
    pass "D4 $1: refused, nothing non-OAuth on the wire"
  else
    fail "D4 $1: $bad non-OAuth request(s) reached the server"
  fi
}
wire_deny "models.json apiKey" ',"apiKey":"sk-ant-api03-bogus"' ""
wire_deny "models.json apiKey + authHeader" ',"apiKey":"sk-ant-api03-bogus","authHeader":true' ""
wire_deny "models.json x-api-key header" ',"headers":{"x-api-key":"sk-ant-api03-bogus"}' "$OAUTH"
wire_deny "models.json modelOverrides x-api-key header" ",\"modelOverrides\":{\"${MODEL#*/}\":{\"headers\":{\"x-api-key\":\"sk-ant-api03-bogus\"}}}" "$OAUTH"
wire_deny "models.json API key in an innocuous header value" ',"headers":{"x-trace-id":"sk-ant-api03-bogus"}' "$OAUTH"
ANTHROPIC_CUSTOM_HEADERS='anthropic-beta: some-beta-2026-01-01' wire_deny "ANTHROPIC_CUSTOM_HEADERS with only a beta header" "" "$OAUTH"
wire "allowed anthropic-beta" ',"headers":{"anthropic-beta":"some-beta-2026-01-01"}' "$OAUTH"
[ "$sent" -gt 0 ] && [ "$bad" -eq 0 ] && pass "D4 wire: an allowed anthropic-beta header still goes through" || fail "D4 wire allowed anthropic-beta: sent=$sent bad=$bad $(head -c 120 <<<"$out" | tr '\n' ' ')"
for pat in "${MODEL#*/}" sonnet; do
  WIRE_MODEL=$pat wire "bare $pat" "" "$OAUTH"
  [ "$sent" -gt 0 ] && [ "$bad" -eq 0 ] && pass "D1 bare model name '$pat' reaches $ID as the only Claude login" || fail "D1 bare model name '$pat': $(head -c 160 <<<"$out" | tr '\n' ' ')"
done

SRC="$PKG/src/index.ts"
if [ -f "$SRC" ]; then
  grep -qE 'fetch\(|createServer|createAssistantMessageEventStream|node:http|@anthropic-ai/sdk' "$SRC" \
    && fail "D5 hand-rolled HTTP/OAuth/stream code in src" || pass "D5 no hand-rolled HTTP/OAuth/stream code"
else
  fail "D5 $SRC missing"
fi
VM="$(dirname "$(readlink -f "$(command -v pi)")")/../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/virtual-modules.js"
[ -f "$VM" ] || VM="$(ls -d "$HOME"/.pi/agent/install/releases/*/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/virtual-modules.js | sort -V | tail -1)"
bad=$( [ -f "$SRC" ] && cat "$PKG"/src/*.ts | grep -oE "from ['\"][^.'\"][^'\"]*['\"]" | sed -E "s/from ['\"]//; s/['\"]$//" | while read -r m; do grep -qE "^\s+\"?$m\"?: bundled" "$VM" || echo "$m"; done )
[ -f "$SRC" ] && [ -z "$bad" ] && pass "D5 imports only pi-supplied modules" || fail "D5 imports not supplied by pi: ${bad:-src missing}"

for auth in "" "{\"$ID\":{\"type\":\"api_key\",\"key\":\"sk-ant-api03-bogus\"}}"; do
  out=$(run_pi "$(tmp_agent "$auth")" -p "/claude-usage")
  grep -q "Claude is not logged in" <<<"$out" && pass "D6 /claude-usage without an OAuth login asks for /login" || fail "D6 /claude-usage: $(head -c 160 <<<"$out" | tr '\n' ' ')"
done

if [ "${1:-}" = "--live" ]; then
  AUTH="$HOME/.pi/agent/auth.json"
  ask() { PI_CODING_AGENT_DIR="$HOME/.pi/agent" timeout 180 pi -ne -e "$PKG" --no-session -p --model "$MODEL" "$1" </dev/null 2>&1; }
  out=$(PI_CODING_AGENT_DIR="$HOME/.pi/agent" timeout 90 pi -ne -e "$PKG" --no-session -p "/claude-usage" </dev/null 2>&1)
  grep -qE "^Current session: [0-9.]+% used" <<<"$out" && pass "D6 real /claude-usage" || fail "D6 /claude-usage: $(head -c 200 <<<"$out" | tr '\n' ' ')"
  out=$(ask "Reply with exactly the word OK and nothing else.")
  grep -qx "OK" <<<"$out" && pass "D2 real text reply" || fail "D2 text: $(head -c 200 <<<"$out" | tr '\n' ' ')"
  out=$(ask "Run the shell command 'echo PROBE_\$((40+2))' with your bash tool and reply with only its output.")
  grep -q "PROBE_42" <<<"$out" && pass "D2 real tool call" || fail "D2 tool: $(head -c 200 <<<"$out" | tr '\n' ' ')"
  before=$(jq -r ".\"$ID\".access | .[-12:]" "$AUTH")
  jq ".\"$ID\".expires = 0" "$AUTH" > "$AUTH.tmp" && cat "$AUTH.tmp" > "$AUTH" && rm "$AUTH.tmp"
  out=$(ask "Reply with exactly the word OK and nothing else.")
  after=$(jq -r ".\"$ID\".access | .[-12:]" "$AUTH"); exp=$(jq -r ".\"$ID\".expires" "$AUTH")
  if grep -qx "OK" <<<"$out" && [ "$before" != "$after" ] && [ "$exp" -gt "$(( $(date +%s) * 1000 ))" ]; then
    pass "D3 refresh rotated token and request succeeded"
  else
    fail "D3 refresh: reply=$(head -c 120 <<<"$out" | tr '\n' ' ') rotated=$([ "$before" != "$after" ] && echo yes || echo no)"
  fi
fi

echo "---- $FAILS failing"
exit $((FAILS > 0))
