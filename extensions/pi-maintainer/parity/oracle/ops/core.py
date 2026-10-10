"""Oracle operations for base_coder file context and confirmations."""

import posixpath
from types import SimpleNamespace
from unittest.mock import patch

from aider.coders.base_coder import Coder
from aider.io import ConfirmGroup, InputOutput

from . import op


@op("core.files_content")
def files_content(args, _case_dir):
    coder = SimpleNamespace(
        fence=tuple(args.get("fence", ["```", "```"])),
        abs_fnames=[name for name, _ in args["contents"]],
        get_abs_fnames_content=lambda: iter(args["contents"]),
        get_rel_fname=lambda name: posixpath.relpath(name, args.get("root", "/project")),
    )
    return Coder.get_files_content(coder)


@op("core.confirm")
def confirm(args, _case_dir):
    group = ConfirmGroup(args["group"]) if "group" in args else None
    if group:
        group.preference = args.get("preference")
    io = SimpleNamespace(
        num_user_asks=0, ring_bell=lambda: None, yes=args.get("yes"),
        never_prompts=set(tuple(key) for key in args.get("never", [])),
        tool_output=lambda *a, **kw: None, tool_error=lambda *a, **kw: None,
        _get_style=lambda: None, prompt_session=None,
        user_input=lambda *a, **kw: None, append_chat_history=lambda *a, **kw: None,
    )
    typed = iter(args.get("typed", []))

    def answer(_prompt):
        value = next(typed)
        if value is None:
            raise EOFError()
        return value

    results = []
    with patch("builtins.input", answer):
        for question in args["questions"]:
            results.append(InputOutput.confirm_ask.__wrapped__(
                io, question["question"], default=question.get("default", "y"),
                subject=question.get("subject"), group=group,
                explicit_yes_required=question.get("explicit", False),
                allow_never=question.get("allow_never", False),
            ))
    return {"answers": results, "never": sorted(io.never_prompts),
            "preference": group.preference if group else None}
