"""Oracle operations for WholeFileCoder's update parser and writer."""

import posixpath
from types import SimpleNamespace

from aider.coders.wholefile_coder import WholeFileCoder

from . import op


@op("wholefile.get_edits")
def get_edits(args, _case_dir):
    coder = SimpleNamespace(
        fence=tuple(args.get("fence", ["```", "```"])),
        get_multi_response_content_in_progress=lambda: args["content"],
        get_inchat_relative_files=lambda: args.get("chat_files", []),
        abs_root_path=lambda path: path,
    )
    return WholeFileCoder.get_edits(coder)


@op("wholefile.apply_edits")
def apply_edits(args, _case_dir):
    writes = []
    coder = SimpleNamespace(
        abs_root_path=lambda path: posixpath.normpath(posixpath.join("/project", path)),
        io=SimpleNamespace(write_text=lambda path, content: writes.append([path, content])),
    )
    WholeFileCoder.apply_edits(coder, args["edits"])
    return writes
