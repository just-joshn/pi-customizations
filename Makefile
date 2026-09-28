.PHONY: verify sweep-cursor-ui verify-lint verify-mechanisms verify-toolchain verify-extension verify-oauth verify-tui-parity verify-cursor-ui verify-one-dark-pro-theme verify-test-conventions verify-install verify-python

verify: verify-lint verify-mechanisms verify-toolchain verify-test-conventions verify-extension verify-oauth verify-tui-parity verify-cursor-ui verify-one-dark-pro-theme verify-install verify-python

verify-lint:
	bun run ci

verify-mechanisms:
	node scripts/check-pi-mechanisms.mjs

verify-toolchain:
	bun run check:toolchain

verify-test-conventions:
	bun run check:tests

verify-extension:
	bun run --filter pi-pstack check:resources
	bun run --filter pi-pstack typecheck
	bun run --filter pi-pstack test:coverage
	bun run --filter pi-pstack check:journeys

verify-oauth:
	bun run --filter pi-anthropic-oauth typecheck
	bun run --filter pi-anthropic-oauth test
	bun run --filter pi-antigravity-oauth check:vendor
	bun run --filter pi-antigravity-oauth typecheck
	bun run --filter pi-antigravity-oauth test

verify-tui-parity:
	bun run --filter pi-tui-parity check:docs
	bun run --filter pi-tui-parity check:parity
	bun run --filter pi-tui-parity typecheck
	bun run --filter pi-tui-parity test:coverage

verify-cursor-ui:
	bun run --filter pi-cursor-ui check:skin
	bun run --filter pi-cursor-ui typecheck
	bun run --filter pi-cursor-ui test:coverage

# Needs tmux and a real pi binary, so it stays out of `verify`.
# Runs the fast gates, the live TUI matrix, and seeded randomized sessions,
# then prints `findings: <n>`.
sweep-cursor-ui:
	bun run --filter pi-cursor-ui sweep

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
