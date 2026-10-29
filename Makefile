.PHONY: verify verify-lint verify-mechanisms verify-toolchain verify-extension verify-maintainer verify-rea verify-oauth verify-test-conventions verify-install verify-sources verify-xai-oauth-live

verify: verify-lint verify-mechanisms verify-toolchain verify-test-conventions verify-extension verify-maintainer verify-rea verify-oauth verify-install

verify-lint:
	bun run ci

verify-mechanisms:
	node scripts/check-pi-mechanisms.mjs

verify-toolchain:
	bun run check:toolchain

verify-test-conventions:
	bun run check:tests

verify-extension:
	bun run --filter @justjoshn/pi-pstack typecheck
	bun run --filter @justjoshn/pi-pstack test:coverage

verify-maintainer:
	bun run --filter @justjoshn/pi-maintainer typecheck
	bun run --filter @justjoshn/pi-maintainer test:coverage

verify-rea:
	bun run --filter @justjoshn/pi-rea typecheck
	bun run --filter @justjoshn/pi-rea test:coverage

verify-oauth:
	bun run --filter @justjoshn/pi-anthropic-oauth typecheck
	bun run --filter @justjoshn/pi-anthropic-oauth test:coverage
	bun run --filter @justjoshn/pi-anthropic-oauth prove
	bun run --filter @justjoshn/pi-antigravity-oauth check:vendor
	bun run --filter @justjoshn/pi-antigravity-oauth check:native-gap
	bun run --filter @justjoshn/pi-antigravity-oauth typecheck
	bun run --filter @justjoshn/pi-antigravity-oauth test:coverage
	bun run --filter @justjoshn/pi-xai-oauth typecheck
	bun run --filter @justjoshn/pi-xai-oauth test:coverage
	bun run --filter @justjoshn/pi-xai-oauth prove:list

# Needs a real `pi` binary and may contact Grok Build, so it stays out of `verify`.
verify-xai-oauth-live:
	bun run --filter @justjoshn/pi-xai-oauth prove

verify-install:
	node scripts/verify-fresh-install.mjs

# Needs network (npx verdaccio plus the npm registry proxy), so it stays out of `verify`.
verify-sources:
	node scripts/verify-install-sources.mjs
