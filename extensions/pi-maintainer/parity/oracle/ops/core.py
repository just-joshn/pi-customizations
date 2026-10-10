import posixpath
from types import SimpleNamespace
from unittest.mock import patch

from aider.coders.base_coder import Coder
from aider.io import ConfirmGroup, InputOutput
from aider.utils import find_common_root

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


@op("core.current_message_text")
def current_message_text(args, _case_dir):
    return Coder.get_cur_message_text(SimpleNamespace(cur_messages=args["messages"]))


@op("core.format_chunks")
def format_chunks(args, _case_dir):
    model = SimpleNamespace(system_prompt_prefix=args.get("prefix", ""),
                            examples_as_sys_msg=args.get("examples_as_system", False),
                            use_system_prompt=args.get("use_system", True),
                            token_count=lambda _messages: None, info={},
                            reminder=args.get("reminder_mode", "sys"))
    coder = SimpleNamespace(
        choose_fence=lambda: None, summarize_end=lambda: None,
        fmt_system_prompt=lambda text: text, main_model=model,
        gpt_prompts=SimpleNamespace(main_system=args["main"],
                                   system_reminder=args.get("reminder", ""),
                                   example_messages=args.get("examples", [])),
        done_messages=args.get("done", []), cur_messages=args.get("current", []),
        get_repo_messages=lambda: args.get("repository", []),
        get_readonly_files_messages=lambda: args.get("readonly", []),
        get_chat_files_messages=lambda: args.get("files", []),
    )
    return [[message["role"], message["content"]]
            for message in Coder.format_chat_chunks(coder).all_messages()]


@op("core.root_path")
def root_path(args, case_dir):
    workspace = case_dir / "workspace"
    workspace.mkdir()
    child = case_dir / "outside" / "child"
    child.mkdir(parents=True)
    (workspace / "link").symlink_to(child, target_is_directory=True)
    if args.get("existing"):
        (case_dir / "outside" / "target.txt").write_text("before")
    full = Coder.abs_root_path(SimpleNamespace(root=str(workspace), abs_root_path_cache={}), args["path"])
    return posixpath.relpath(full, case_dir.resolve())


@op("core.rel_fname")
def rel_fname(args, _case_dir):
    return Coder.get_rel_fname(SimpleNamespace(root=args["root"]), args["path"])


@op("core.inchat_files")
def inchat_files(args, _case_dir):
    coder = SimpleNamespace(abs_fnames=set(args["paths"]),
                            get_rel_fname=lambda name: posixpath.relpath(name, args["root"]))
    return Coder.get_inchat_relative_files(coder)


@op("core.common_root")
def common_root(args, _case_dir):
    return find_common_root(args["paths"])


@op("core.file_mentions")
def file_mentions(args, _case_dir):
    coder = SimpleNamespace(
        get_all_relative_files=lambda: sorted(set(args["addable"])),
        get_addable_relative_files=lambda: set(args["addable"]),
        get_inchat_relative_files=lambda: args.get("inchat", []),
        abs_read_only_fnames=args.get("readonly", []),
        get_rel_fname=lambda name: name,
    )
    return sorted(Coder.get_file_mentions(coder, args["content"], args.get("ignore_current", False)))


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
