.PHONY: verify verify-mechanisms verify-extension verify-oauth verify-tui-parity verify-test-conventions verify-install verify-python

verify: verify-mechanisms verify-test-conventions verify-extension verify-oauth verify-tui-parity verify-install verify-python

verify-mechanisms:
	node scripts/check-pi-mechanisms.mjs

verify-test-conventions:
	npm run check:tests

verify-extension:
	npm --prefix extensions/pi-pstack run check:resources
	npm --prefix extensions/pi-pstack run typecheck
	npm --prefix extensions/pi-pstack run test:coverage
	npm --prefix extensions/pi-pstack run check:journeys

verify-oauth:
	npm --prefix extensions/pi-anthropic-oauth run typecheck
	npm --prefix extensions/pi-anthropic-oauth test
	npm --prefix extensions/pi-antigravity-oauth run check:vendor
	npm --prefix extensions/pi-antigravity-oauth run typecheck
	npm --prefix extensions/pi-antigravity-oauth test

verify-tui-parity:
	npm --prefix extensions/pi-tui-parity run check:docs
	npm --prefix extensions/pi-tui-parity run check:parity
	npm --prefix extensions/pi-tui-parity run typecheck
	npm --prefix extensions/pi-tui-parity run test:coverage

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
