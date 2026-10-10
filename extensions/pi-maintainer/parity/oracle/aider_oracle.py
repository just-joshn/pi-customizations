"""Runs oracle cases against Aider's own Python from the pinned checkout.

Usage: aider_oracle.py <cases.json>
Each case is {"id", "op", "args"}. Prints a JSON object mapping case id to
{"result": ...} or {"error": {"type", "message"}}.
"""

import json
import os
import sys
import tempfile
from pathlib import Path

from ops import REGISTRY, load_all


def run_case(case, workdir):
    handler = REGISTRY.get(case["op"])
    if handler is None:
        return {"error": {"type": "UnknownOp", "message": case["op"]}}
    case_dir = Path(workdir) / case["id"].replace("/", "_")
    case_dir.mkdir(parents=True, exist_ok=True)
    cwd = os.getcwd()
    os.chdir(case_dir)
    try:
        return {"result": handler(case.get("args", {}), case_dir)}
    except Exception as err:  # the oracle records Aider's exceptions as results
        return {"error": {"type": type(err).__name__, "message": str(err)}}
    finally:
        os.chdir(cwd)


def main(path):
    cases = json.loads(Path(path).read_text(encoding="utf-8"))
    load_all()
    with tempfile.TemporaryDirectory(prefix="pi-maintainer-oracle-") as workdir:
        results = {case["id"]: run_case(case, workdir) for case in cases}
    sys.stdout.write(json.dumps(results, indent=1, sort_keys=True, ensure_ascii=False))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])
