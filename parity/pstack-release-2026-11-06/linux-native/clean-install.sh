#!/usr/bin/env bash
set -eu
REPO=$(git rev-parse --show-toplevel)
E="$REPO/parity/pstack-release-2026-11-06/linux-native"
TOOLCHAIN=$(cat /tmp/pstack-linux-toolchain-location)
ROOT=$(mktemp -d /tmp/pstack-linux-consumer.XXXXXX)
printf '%s\n' "$ROOT" > /tmp/pstack-linux-consumer-location
mkdir -p "$ROOT/home" "$ROOT/work" "$ROOT/artifacts" "$ROOT/work/test"
export HOME="$ROOT/home"
export PATH="$TOOLCHAIN/node-v26.13.0-linux-arm64/bin:$TOOLCHAIN/bin:/usr/bin:/bin"
CLEAN=(env -i HOME="$HOME" PATH="$PATH" LANG=C.UTF-8 CI=1)
printf 'consumer_root=%s\n' "$ROOT"
printf '\n+ npm pack local source into a fresh artifact directory\n'
"${CLEAN[@]}" npm pack "$REPO/extensions/pi-pstack" --pack-destination "$ROOT/artifacts" --json > "$E/pack-manifest.json"
TARBALL=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))[0].filename' "$E/pack-manifest.json")
TARBALL="$ROOT/artifacts/$TARBALL"
sha256sum "$TARBALL" | tee "$E/tarball-sha256.txt"
printf '\n+ clean npm install of stable Pi 1.5.0 and the tarball (no workspace or dev dependencies)\n'
cd "$ROOT/work"
"${CLEAN[@]}" npm install --no-audit --no-fund @earendil-works/pi-coding-agent@1.5.0 "$TARBALL"
printf '\n+ installed package versions and dependency tree\n'
"${CLEAN[@]}" ./node_modules/.bin/pi --version
node --version
npm --version
bun --version
"${CLEAN[@]}" npm ls --all --json > "$E/consumer-dependency-tree.json"
node -e 'for (const name of ["@earendil-works/pi-coding-agent", "@justjoshn/pi-pstack"]) { const p = JSON.parse(require("node:fs").readFileSync(`node_modules/${name}/package.json`)); console.log(`${name}@${p.version}`); }'
printf '\n+ copy only scripted-model.ts from the source test tree\n'
cp "$REPO/extensions/pi-pstack/test/fixtures/scripted-model.ts" "$ROOT/work/test/scripted-model.ts"
sha256sum "$REPO/extensions/pi-pstack/test/fixtures/scripted-model.ts" "$ROOT/work/test/scripted-model.ts"
printf '\n+ register the installed tarball payload using actual pi install\n'
"${CLEAN[@]}" ./node_modules/.bin/pi install "$ROOT/work/node_modules/@justjoshn/pi-pstack"
printf '\n+ verify pi list and settings written by pi install\n'
"${CLEAN[@]}" ./node_modules/.bin/pi list
cat "$HOME/.pi/agent/settings.json"
printf '\n+ add only the deterministic model fixture to the clean user settings\n'
node --input-type=module - "$HOME/.pi/agent/settings.json" "$ROOT/work/test/scripted-model.ts" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [settingsFile, fixture] = process.argv.slice(2);
const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
settings.extensions = [fixture];
settings.quietStartup = true;
writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
NODE
printf '\n+ runtime wire-protocol verification (stdlib-only driver; no checkout runtime imports)\n'
"${CLEAN[@]}" node "$E/clean-runtime.mjs" "$ROOT" "$E"
