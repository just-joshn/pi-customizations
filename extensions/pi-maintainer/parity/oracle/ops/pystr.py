"""Oracle operations for Python str builtins that the port reimplements."""

from . import op


@op("pystr.splitlines")
def splitlines(args, _case_dir):
    return args["text"].splitlines(args.get("keepends", False))


@op("pystr.strip")
def strip(args, _case_dir):
    text, chars = args["text"], args.get("chars")
    return {"strip": text.strip(chars), "lstrip": text.lstrip(chars), "rstrip": text.rstrip(chars)}


@op("pystr.isspace")
def isspace(args, _case_dir):
    return args["text"].isspace()


@op("pystr.split")
def split(args, _case_dir):
    return args["text"].split()


@op("pystr.count")
def count(args, _case_dir):
    return args["text"].count(args["sub"])


@op("pystr.replace")
def replace(args, _case_dir):
    return args["text"].replace(args["old"], args["new"])


@op("pystr.expandtabs")
def expandtabs(args, _case_dir):
    return args["text"].expandtabs(args.get("tabsize", 8))
