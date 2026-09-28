.PHONY: verify verify-extension verify-python

verify: verify-extension verify-tui-parity verify-python

verify-extension:
	npm --prefix extensions/pi-pstack run check:resources
	npm --prefix extensions/pi-pstack run typecheck
	npm --prefix extensions/pi-pstack run test:coverage

verify-tui-parity:
	npm --prefix extensions/pi-tui-parity run check:docs
	npm --prefix extensions/pi-tui-parity run check:parity
	npm --prefix extensions/pi-tui-parity run typecheck
	npm --prefix extensions/pi-tui-parity run test:coverage

verify-python:
	uv run --no-project --with coverage==7.16.1 coverage erase
	uv run --no-project --with coverage==7.16.1 coverage run -m unittest discover -s skills/doctor/tests -v
	uv run --no-project --with coverage==7.16.1 coverage run -m unittest discover -s skills/implement-cli-from-contract/tests -v
	uv run --no-project --with coverage==7.16.1 coverage run -m unittest discover -s skills/reverse-engineer-cli/tests -v
	uv run --no-project --with coverage==7.16.1 coverage combine
	uv run --no-project --with coverage==7.16.1 coverage report
	uv run --no-project --with coverage==7.16.1 coverage json -o .audit/python-coverage/report.json
	uv run --no-project python -c 'import json; from pathlib import Path; expected = {str(path) for path in Path("skills").glob("*/scripts/*.py")}; measured = set(json.loads(Path(".audit/python-coverage/report.json").read_text())["files"]); assert expected == measured, (expected - measured, measured - expected)'
