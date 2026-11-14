.PHONY: verify-claude-default-dark verify verify-lint verify-mechanisms verify-toolchain verify-extension verify-maintainer verify-rea verify-oauth verify-skills verify-test-conventions verify-install verify-sources verify-x-subscription-oauth-live

verify: verify-lint verify-mechanisms verify-toolchain verify-test-conventions verify-extension verify-maintainer verify-rea verify-oauth verify-skills verify-install

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

verify-skills:
	bun run --filter './skills/*' typecheck
	REQUIRE_ANDROID_SDK=1 bun run --filter './skills/*' test

verify-oauth:
	bun run --filter @justjoshn/pi-anthropic-oauth typecheck
	bun run --filter @justjoshn/pi-anthropic-oauth test:coverage
	bun run --filter @justjoshn/pi-anthropic-oauth prove
	bun run --filter @justjoshn/pi-antigravity-oauth check:vendor
	bun run --filter @justjoshn/pi-antigravity-oauth check:native-gap
	bun run --filter @justjoshn/pi-antigravity-oauth typecheck
	bun run --filter @justjoshn/pi-antigravity-oauth test:coverage
	bun run --filter @justjoshn/pi-x-subscription-oauth typecheck
	bun run --filter @justjoshn/pi-x-subscription-oauth test:coverage
	bun run --filter @justjoshn/pi-x-subscription-oauth prove:list

# Needs a real `pi` binary and may contact Grok Build, so it stays out of `verify`.
verify-x-subscription-oauth-live:
	bun run --filter @justjoshn/pi-x-subscription-oauth prove

verify-install:
	node scripts/verify-fresh-install.mjs

# Needs network (npx verdaccio plus the npm registry proxy), so it stays out of `verify`.
verify-sources:
	node scripts/verify-install-sources.mjs

verify-claude-default-dark:
	cd extensions/pi-claude-default-dark/development && bun install --frozen-lockfile && bun run typecheck && bun run test
	cd extensions/pi-claude-default-dark/development && node scripts/static-scan.selftest.mjs && node scripts/static-scan.mjs
	cd extensions/pi-claude-default-dark/development && cp ../themes/claude-default-dark.json /tmp/claude-default-dark.committed.json && node scripts/generate-theme.ts && cmp ../themes/claude-default-dark.json /tmp/claude-default-dark.committed.json
	cd extensions/pi-claude-default-dark/development && node scripts/validate-theme.mjs && node scripts/crosswalk.ts && node scripts/compare.ts && node scripts/report.ts && git diff --exit-code -- PARITY_REPORT.md reference-lock.json crosswalk.csv results/SHA256SUMS
