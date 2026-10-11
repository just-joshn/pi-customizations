.PHONY: verify verify-s50 verify-s50-harness verify-caveman sweep-tui-skin verify-lint verify-agents verify-mechanisms verify-toolchain verify-extension verify-parity-audit verify-oauth verify-tui-skin verify-one-dark-pro-theme verify-test-conventions verify-install verify-python verify-skill-node verify-xai-oauth-live

verify: verify-s50 verify-caveman verify-lint verify-agents verify-mechanisms verify-toolchain verify-test-conventions verify-extension verify-oauth verify-tui-skin verify-one-dark-pro-theme verify-install verify-python verify-skill-node

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

verify-s50:
	bun run --filter pi-s50 typecheck
	bun run --filter pi-s50 test:coverage

# Needs a real pi binary, a configured model, and network access, so it stays out of `verify`.
# Installs pi-s50 into a throwaway project and runs one bounded feature simulation through Pi.
verify-s50-harness:
	node extensions/pi-s50/scripts/verify-pi-harness.mjs

# Portable caveman gates. Live rpc-smoke / e2e:real / e2e:contract need a model and proxy, so they stay out of `verify`.
verify-caveman:
	bun run --filter pi-caveman check:vendor
	bun run --filter pi-caveman typecheck
	bun run --filter pi-caveman test:coverage
	bun run --filter pi-caveman check:parity
	bun run --filter pi-caveman test:runtime

verify-tui-skin:
	bun run --filter pi-tui-skin check:skin
	bun run --filter pi-tui-skin typecheck
	bun run --filter pi-tui-skin test:coverage
	bun run --filter pi-tui-skin check:prompt-parity
	bun run --filter pi-tui-skin check:frame-invariants

# Needs tmux and a real pi binary, so it stays out of `verify`.
# Runs the fast gates, the live TUI matrix, and seeded randomized sessions,
# then prints `findings: <n>`.
sweep-tui-skin:
	bun run --filter pi-tui-skin sweep

verify-one-dark-pro-theme:
	bun run --filter pi-one-dark-pro-theme check:parity
	bun run --filter pi-one-dark-pro-theme typecheck
	bun run --filter pi-one-dark-pro-theme test:coverage

verify-install:
	node scripts/verify-fresh-install.mjs

verify-python:
	uv run --no-project --with coverage==7.16.1 coverage erase
	uv run --no-project --with coverage==7.16.1 coverage run -m unittest discover -s skills/doctor/tests -v
	uv run --no-project --with coverage==7.16.1 coverage run -m unittest discover -s skills/implement-cli-from-contract/tests -v
	uv run --no-project --with coverage==7.16.1 coverage run -m unittest discover -s skills/reverse-engineer-cli/tests -v
	uv run --no-project --with coverage==7.16.1 coverage combine
	uv run --no-project --with coverage==7.16.1 coverage report
	uv run --no-project --with coverage==7.16.1 coverage json -o .audit/python-coverage/report.json
	uv run --no-project python -c 'import json; from pathlib import Path; expected = {str(path) for path in Path("skills").glob("*/scripts/*.py")}; measured = set(json.loads(Path(".audit/python-coverage/report.json").read_text())["files"]); assert expected == measured, (expected - measured, measured - expected)'

verify-skill-node:
	node --test skills/*/tests/*.test.mjs
