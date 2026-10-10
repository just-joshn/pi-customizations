from types import SimpleNamespace

from aider.io import InputOutput

from . import op


@op("io.read")
def read(args, case_dir):
    filename = "source.txt"
    kind = args.get("kind", "file")
    if kind == "file":
        (case_dir / filename).write_bytes(bytes(args["bytes"]))
    elif kind == "directory":
        (case_dir / filename).mkdir()
    errors = []
    io = SimpleNamespace(encoding=args.get("encoding", "utf-8"), tool_error=errors.append)
    text = InputOutput.read_text(io, filename)
    return {"text": text, "errors": errors}
