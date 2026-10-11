.PHONY: verify verify-lint verify-agents verify-mechanisms verify-toolchain verify-extension verify-parity-audit verify-oauth verify-test-conventions verify-install verify-skill-node verify-xai-oauth-live

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

verify-extension:
	bun run --filter pi-pstack check:resources
	bun run --filter pi-pstack check:native-first
	bun run --filter pi-pstack check:parity
	bun run --filter pi-pstack typecheck
	bun run --filter pi-pstack test:coverage
	bun run --filter pi-pstack test:helpers
	bun run --filter pi-pstack check:journeys

# The clause inventory checks provenance against ~/src/experiments/plugins and its git history, so it needs that
# preserved checkout and stays out of the portable verify-extension target.
verify-parity-audit:
	bun run --filter pi-pstack check:native-parity -- --allow-external

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
