"""Oracle operations for aider/coders/udiff_coder.py and its active search_replace.py path."""

from pathlib import Path
from types import MethodType, SimpleNamespace

from aider.coders import search_replace as sr
from aider.coders import udiff_coder as ud
from aider.io import InputOutput

from . import op


@op("udiff.find_diffs")
def find_diffs(args, _case_dir):
    return [[path, hunk] for path, hunk in ud.find_diffs(args["content"])]


@op("udiff.get_edits")
def get_edits(args, _case_dir):
    coder = ud.UnifiedDiffCoder.__new__(ud.UnifiedDiffCoder)
    coder.partial_response_content = args["content"]
    return [[path, hunk] for path, hunk in coder.get_edits()]


@op("udiff.hunk_to_before_after")
def hunk_to_before_after(args, _case_dir):
    before, after = ud.hunk_to_before_after(args["hunk"], lines=args.get("lines", False))
    if args.get("lines"):
        return [before, after]
    return [before, after]


@op("udiff.normalize_hunk")
def normalize_hunk(args, _case_dir):
    return ud.normalize_hunk(args["hunk"])


@op("udiff.cleanup_pure_whitespace_lines")
def cleanup_pure_whitespace_lines(args, _case_dir):
    return ud.cleanup_pure_whitespace_lines(args["lines"])


@op("udiff.diff_lines")
def diff_lines(args, _case_dir):
    return sr.diff_lines(args["search_text"], args["replace_text"])


@op("udiff.search_and_replace")
def search_and_replace(args, _case_dir):
    return sr.search_and_replace((args["search_text"], args["replace_text"], args["original_text"]))


@op("udiff.flexible_search_and_replace")
def flexible_search_and_replace(args, _case_dir):
    texts = (args["search_text"], args["replace_text"], args["original_text"])
    return sr.flexible_search_and_replace(texts, [(sr.search_and_replace, sr.all_preprocs)])


@op("udiff.relative_indent_roundtrip")
def relative_indent_roundtrip(args, _case_dir):
    texts = (args["search_text"], args["replace_text"], args["original_text"])
    ri, relative = sr.relative_indent(texts)
    absolute = [ri.make_absolute(text) for text in relative]
    return {"relative": list(relative), "absolute": absolute, "marker": ri.marker}


@op("udiff.directly_apply_hunk")
def directly_apply_hunk(args, _case_dir):
    return ud.directly_apply_hunk(args["content"], args["hunk"])


@op("udiff.make_new_lines_explicit")
def make_new_lines_explicit(args, _case_dir):
    return ud.make_new_lines_explicit(args["content"], args["hunk"])


@op("udiff.apply_hunk")
def apply_hunk(args, _case_dir):
    return ud.apply_hunk(args["content"], args["hunk"])


@op("udiff.do_replace")
def do_replace(args, case_dir):
    path = Path(case_dir) / args["fname"]
    if args.get("exists"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(args.get("content") or "", encoding="utf-8")
    result = ud.do_replace(path, args.get("content"), args["hunk"])
    return {"result": result, "exists_after": path.exists()}


def plant(root, files):
    for name, content in files.items():
        path = root / name
        if content is None:
            path.mkdir(parents=True, exist_ok=True)
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content.encode("utf-8"))


def tree_state(root):
    return {
        path.relative_to(root).as_posix(): None if path.is_dir() else path.read_bytes().decode("utf-8")
        for path in sorted(root.rglob("*"))
    }


def udiff_coder(args, root, errors):
    io = SimpleNamespace(encoding="utf-8", dry_run=args.get("io_dry_run", False), newline=None, tool_error=errors.append)
    io.read_text = MethodType(InputOutput.read_text, io)
    io.write_text = MethodType(InputOutput.write_text, io)
    coder = ud.UnifiedDiffCoder.__new__(ud.UnifiedDiffCoder)
    coder.root = str(root)
    coder.abs_root_path_cache = {}
    coder.io = io
    return coder


@op("udiff.apply_edits")
def apply_edits(args, case_dir):
    root = Path(case_dir).resolve()
    plant(root, args.get("files", {}))
    errors = []
    coder = udiff_coder(args, root, errors)
    try:
        outcome = {"result": coder.apply_edits([(path, hunk) for path, hunk in args["edits"]])}
    except Exception as err:
        outcome = {"error": {"type": type(err).__name__, "message": str(err)}}
    messages = [message.replace(str(root), "<root>") for message in errors]
    return {"outcome": outcome, "files": tree_state(root), "errors": messages}
