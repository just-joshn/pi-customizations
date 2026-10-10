"""Oracle operations for aider/coders/patch_coder.py.

The coder operations run PatchCoder methods against real files in the case
directory. A ValueError is recorded next to the notices and the resulting tree,
because Aider's partial writes and messages before a failure are part of the
outcome. The case directory changes on every run, so notices name it <root>.
"""

from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace

from aider.coders import patch_coder as pc
from aider.io import InputOutput

from . import op


def action_json(action):
    return {**asdict(action), "type": action.type.value}


def patch_action(data):
    chunks = [pc.Chunk(**chunk) for chunk in data.get("chunks", [])]
    return pc.PatchAction(pc.ActionType(data["type"]), data["path"], data.get("new_content"), chunks, data.get("move_path"))


def recording_io(dry_run, notices):
    io = SimpleNamespace(encoding="utf-8", newline=None, dry_run=dry_run)
    io.tool_output = lambda *messages, **_options: notices.append(["output", " ".join(messages)])
    io.tool_warning = lambda message="", **_options: notices.append(["warning", message])
    io.tool_error = lambda message="", **_options: notices.append(["error", message])
    io.read_text = lambda filename, silent=False: InputOutput.read_text(io, filename, silent)
    io.write_text = lambda filename, content: InputOutput.write_text(io, filename, content)
    return io


def patch_coder(case_dir, args, notices):
    coder = object.__new__(pc.PatchCoder)
    coder.root = str(case_dir)
    coder.abs_root_path_cache = {}
    coder.io = recording_io(args.get("dry_run", False), notices)
    coder.partial_response_content = args.get("reply")
    return coder


def write_tree(case_dir, args):
    for rel in args.get("dirs", []):
        (case_dir / rel).mkdir(parents=True, exist_ok=True)
    for rel, content in args.get("files", {}).items():
        path = case_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content.encode("utf-8"))


def read_tree(case_dir):
    tree = {}
    for path in sorted(case_dir.rglob("*")):
        rel = path.relative_to(case_dir).as_posix()
        if path.is_dir():
            tree[f"{rel}/"] = None
        else:
            tree[rel] = path.read_bytes().decode("utf-8")
    return tree


def anonymized(notices, case_dir):
    root = str(Path(case_dir).resolve())
    return [[kind, message.replace(root, "<root>")] for kind, message in notices]


def attempt(run):
    try:
        return run(), None
    except ValueError as err:
        return None, {"type": type(err).__name__, "message": str(err)}


def edit_pairs(edits):
    return [[path, action_json(action)] for path, action in edits]


@op("patch.find_context_core")
def find_context_core(args, _case_dir):
    return list(pc.find_context_core(args["lines"], args["context"], args["start"]))


@op("patch.find_context")
def find_context(args, _case_dir):
    return list(pc.find_context(args["lines"], args["context"], args["start"], args["eof"]))


@op("patch.peek_next_section")
def peek_next_section(args, _case_dir):
    context, chunks, index, eof = pc.peek_next_section(args["lines"], args["index"])
    return [context, [asdict(chunk) for chunk in chunks], index, eof]


@op("patch.identify_files_needed")
def identify_files_needed(args, _case_dir):
    return sorted(pc.identify_files_needed(args["text"]))


@op("patch.parse_patch_text")
def parse_patch_text(args, case_dir):
    notices = []
    coder = patch_coder(case_dir, args, notices)
    patch, raised = attempt(lambda: coder._parse_patch_text(args["lines"], args["start_index"], args["current_files"]))
    parsed = None if patch is None else {"actions": edit_pairs(patch.actions.items()), "fuzz": patch.fuzz}
    return {"patch": parsed, "raised": raised, "notices": notices}


@op("patch.get_edits")
def get_edits(args, case_dir):
    write_tree(case_dir, args)
    notices = []
    coder = patch_coder(case_dir, args, notices)
    edits, raised = attempt(lambda: edit_pairs(coder.get_edits()))
    return {"edits": edits, "raised": raised, "notices": anonymized(notices, case_dir)}


@op("patch.apply_edits")
def apply_edits(args, case_dir):
    write_tree(case_dir, args)
    notices = []
    coder = patch_coder(case_dir, args, notices)
    edits = [(path, patch_action(data)) for path, data in args["edits"]]
    _, raised = attempt(lambda: coder.apply_edits(edits))
    return {"raised": raised, "notices": anonymized(notices, case_dir), "tree": read_tree(case_dir)}


@op("patch.apply_reply")
def apply_reply(args, case_dir):
    write_tree(case_dir, args)
    notices = []
    coder = patch_coder(case_dir, args, notices)
    _, raised = attempt(lambda: coder.apply_edits(coder.apply_edits_dry_run(coder.get_edits())))
    return {"raised": raised, "notices": anonymized(notices, case_dir), "tree": read_tree(case_dir)}
