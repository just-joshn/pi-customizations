.PHONY: verify verify-lint verify-agents verify-mechanisms verify-toolchain verify-extension verify-oauth verify-test-conventions verify-install verify-skill-node verify-xai-oauth-live

verify: verify-lint verify-agents verify-mechanisms verify-toolchain verify-test-conventions verify-extension verify-oauth verify-install verify-skill-node

verify-lint:
	bun run ci

verify-agents:
	bun run check:agents

verify-mechanisms:
	node scripts/check-pi-mechanisms.mjs

verify-toolchain:
	bun run check:toolchain

verify-test-conventions:
	bun run check:tests

# check:upstream also exists but needs a cursor/plugins checkout at the pinned commit:
#   bun run --filter pi-pstack check:upstream -- --source /tmp/cursor-plugins
verify-extension:
	bun run --filter pi-pstack typecheck
	bun run --filter pi-pstack test:coverage

verify-oauth:
	bun run --filter pi-anthropic-oauth typecheck
	bun run --filter pi-anthropic-oauth test:coverage
	bun run --filter pi-anthropic-oauth prove
	bun run --filter pi-antigravity-oauth check:vendor
	bun run --filter pi-antigravity-oauth check:native-gap
	bun run --filter pi-antigravity-oauth typecheck
	bun run --filter pi-antigravity-oauth test:coverage
	bun run --filter pi-xai-oauth typecheck
	bun run --filter pi-xai-oauth test:coverage
	bun run --filter pi-xai-oauth prove:list

# Needs a real `pi` binary and may contact Grok Build, so it stays out of `verify`.
verify-xai-oauth-live:
	bun run --filter pi-xai-oauth prove

verify-install:
	node scripts/verify-fresh-install.mjs

verify-skill-node:
	node --test skills/*/tests/*.test.mjs
