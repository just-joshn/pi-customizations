"""Oracle operations for aider/coders/editblock_coder.py.

The coder operations run EditBlockCoder's own methods on an instance built without
__init__ that carries only the attributes those methods read. abs_fnames is a list instead
of Aider's set, so each case fixes the iteration order that Aider leaves to string hashing.
"""

from pathlib import Path
from types import MethodType, SimpleNamespace

from aider.coders import editblock_coder as eb
from aider.io import InputOutput

from . import op


def fence_of(args):
    fence = args.get("fence")
    return tuple(fence) if fence else eb.DEFAULT_FENCE


@op("editblock.find_original_update_blocks")
def find_original_update_blocks(args, _case_dir):
    blocks = eb.find_original_update_blocks(args["content"], fence_of(args), args.get("valid_fnames"))
    return [list(block) for block in blocks]


@op("editblock.replace_most_similar_chunk")
def replace_most_similar_chunk(args, _case_dir):
    return eb.replace_most_similar_chunk(args["whole"], args["part"], args["replace"])


@op("editblock.do_replace")
def do_replace(args, case_dir):
    path = Path(case_dir) / args["fname"]
    if args.get("exists"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(args.get("content") or "", encoding="utf-8")
    result = eb.do_replace(path, args.get("content"), args["before_text"], args["after_text"], fence_of(args))
    return {"result": result, "exists_after": path.exists()}


@op("editblock.strip_quoted_wrapping")
def strip_quoted_wrapping(args, _case_dir):
    return eb.strip_quoted_wrapping(args["res"], args.get("fname"), fence_of(args))


@op("editblock.find_similar_lines")
def find_similar_lines(args, _case_dir):
    return eb.find_similar_lines(args["search_lines"], args["content_lines"], args.get("threshold", 0.6))


@op("editblock.strip_filename")
def strip_filename(args, _case_dir):
    return eb.strip_filename(args["filename"], fence_of(args))


@op("editblock.find_filename")
def find_filename(args, _case_dir):
    return eb.find_filename(args["lines"], fence_of(args), args.get("valid_fnames"))


@op("editblock.prep")
def prep(args, _case_dir):
    return list(eb.prep(args["content"]))


@op("editblock.perfect_replace")
def perfect_replace(args, _case_dir):
    return eb.perfect_replace(args["whole_lines"], args["part_lines"], args["replace_lines"])


@op("editblock.perfect_or_whitespace")
def perfect_or_whitespace(args, _case_dir):
    return eb.perfect_or_whitespace(args["whole_lines"], args["part_lines"], args["replace_lines"])


@op("editblock.replace_part_with_missing_leading_whitespace")
def replace_part_with_missing_leading_whitespace(args, _case_dir):
    return eb.replace_part_with_missing_leading_whitespace(args["whole_lines"], args["part_lines"], args["replace_lines"])


@op("editblock.match_but_for_leading_whitespace")
def match_but_for_leading_whitespace(args, _case_dir):
    return eb.match_but_for_leading_whitespace(args["whole_lines"], args["part_lines"])


@op("editblock.try_dotdotdots")
def try_dotdotdots(args, _case_dir):
    return eb.try_dotdotdots(args["whole"], args["part"], args["replace"])


def editblock_coder(args, root, errors):
    io = SimpleNamespace(encoding="utf-8", dry_run=args.get("io_dry_run", False), newline=None, tool_error=errors.append)
    io.read_text = MethodType(InputOutput.read_text, io)
    io.write_text = MethodType(InputOutput.write_text, io)
    coder = eb.EditBlockCoder.__new__(eb.EditBlockCoder)
    coder.root = str(root)
    coder.abs_root_path_cache = {}
    coder.abs_fnames = [coder.abs_root_path(name) for name in args.get("chat_files", [])]
    coder.io = io
    coder.fence = fence_of(args)
    coder.shell_commands = []
    return coder


@op("editblock.get_edits")
def get_edits(args, case_dir):
    coder = editblock_coder(args, Path(case_dir).resolve(), [])
    coder.partial_response_content = args["content"]
    edits = coder.get_edits()
    return {"edits": [list(edit) for edit in edits], "shell_commands": coder.shell_commands}


def plant(root, files):
    for name, content in files.items():
        path = root / name
        if content is None:
            path.mkdir(parents=True, exist_ok=True)
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content.encode("utf-8"))


def tree_state(root):
    return {path.relative_to(root).as_posix(): None if path.is_dir() else path.read_bytes().decode("utf-8") for path in sorted(root.rglob("*"))}


def run_coder_method(args, case_dir, method):
    """Records the files and tool errors after the call too, because apply_edits writes
    passing blocks before it raises for failing ones."""
    root = Path(case_dir).resolve()
    plant(root, args.get("files", {}))
    errors = []
    coder = editblock_coder(args, root, errors)
    try:
        outcome = {"result": getattr(coder, method)([tuple(edit) for edit in args["edits"]])}
    except Exception as err:  # recorded the same way aider_oracle.run_case records them
        outcome = {"error": {"type": type(err).__name__, "message": str(err)}}
    messages = [message.replace(str(root), "<root>") for message in errors]
    return {"outcome": outcome, "files": tree_state(root), "errors": messages}


@op("editblock.apply_edits")
def apply_edits(args, case_dir):
    return run_coder_method(args, case_dir, "apply_edits")


@op("editblock.apply_edits_dry_run")
def apply_edits_dry_run(args, case_dir):
    return run_coder_method(args, case_dir, "apply_edits_dry_run")
