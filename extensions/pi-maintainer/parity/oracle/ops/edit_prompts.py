"""Oracle operations for Aider's prompt modules and base_coder's prompt formatting."""

import base64
import dataclasses
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from aider.coders import base_coder, shell
from aider.coders.architect_prompts import ArchitectPrompts
from aider.coders.ask_prompts import AskPrompts
from aider.coders.base_coder import Coder
from aider.coders.base_prompts import CoderPrompts
from aider.coders.chat_chunks import ChatChunks
from aider.coders.context_prompts import ContextPrompts
from aider.coders.editblock_fenced_prompts import EditBlockFencedPrompts
from aider.coders.editblock_prompts import EditBlockPrompts
from aider.coders.editor_diff_fenced_prompts import EditorDiffFencedPrompts
from aider.coders.editor_editblock_prompts import EditorEditBlockPrompts
from aider.coders.editor_whole_prompts import EditorWholeFilePrompts
from aider.coders.patch_prompts import PatchPrompts
from aider.coders.udiff_prompts import UnifiedDiffPrompts
from aider.coders.udiff_simple_prompts import UnifiedDiffSimplePrompts
from aider.coders.wholefile_prompts import WholeFilePrompts
from aider.io import InputOutput
from aider.utils import is_image_file

from . import op

PROMPTS = {
    cls.__name__: cls
    for cls in (
        CoderPrompts,
        EditBlockPrompts,
        EditBlockFencedPrompts,
        WholeFilePrompts,
        UnifiedDiffPrompts,
        UnifiedDiffSimplePrompts,
        PatchPrompts,
        EditorEditBlockPrompts,
        EditorWholeFilePrompts,
        EditorDiffFencedPrompts,
        ArchitectPrompts,
        AskPrompts,
        ContextPrompts,
    )
}

INFO_KEYS = ("max_input_tokens", "supports_vision", "supports_pdf_input", "max_pdf_size_mb")


def public_attributes(source):
    return {name: getattr(source, name) for name in sorted(dir(source)) if not name.startswith("_")}


@op("prompts.attributes")
def attributes(args, _case_dir):
    if args["name"] == "shell":
        return public_attributes(shell)
    return public_attributes(PROMPTS[args["name"]])


def formatting_coder(args):
    """The attributes fmt_system_prompt reads, with the language and platform text given."""
    return SimpleNamespace(
        gpt_prompts=PROMPTS[args["prompts"]](),
        main_model=SimpleNamespace(lazy=args["lazy"], overeager=args["overeager"]),
        fence=tuple(args["fence"]),
        suggest_shell_commands=args["suggest_shell_commands"],
        get_user_language=lambda: args["user_language"],
        get_platform_info=lambda: args["platform"],
    )


@op("prompts.fmt_system_prompt")
def fmt_system_prompt(args, _case_dir):
    coder = formatting_coder(args)
    prompts = coder.gpt_prompts

    def fmt(template):
        return Coder.fmt_system_prompt(coder, template)

    return {
        "main_system": fmt(prompts.main_system),
        "system_reminder": fmt(prompts.system_reminder),
        "example_messages": [fmt(message["content"]) for message in prompts.example_messages],
    }


def fake_os(args):
    env = args["env"]
    return SimpleNamespace(name=args.get("os_name", "posix"), getenv=env.get, environ=env)


def fake_platform(name):
    def platform():
        if name is None:
            raise KeyError("platform")
        return name

    return SimpleNamespace(platform=platform)


def fake_datetime(date):
    noon = datetime.fromisoformat(f"{date}T12:00:00")
    return SimpleNamespace(now=lambda: noon)


def fake_locale(args):
    def getlocale():
        if args.get("locale_raises"):
            raise ValueError("unknown locale")
        return (args["locale"], "UTF-8")

    return SimpleNamespace(getlocale=getlocale)


@op("prompts.get_platform_info")
def get_platform_info(args, _case_dir):
    lint_cmds = args["lint_cmds"]
    coder = SimpleNamespace(
        get_user_language=lambda: args["user_language"],
        repo=object() if args["repo"] else None,
        lint_cmds=None if lint_cmds is None else dict(lint_cmds),
        auto_lint=args["auto_lint"],
        test_cmd=args["test_cmd"],
        auto_test=args["auto_test"],
    )
    with (
        mock.patch.object(base_coder, "platform", fake_platform(args["platform"])),
        mock.patch.object(base_coder, "os", fake_os(args)),
        mock.patch.object(base_coder, "datetime", fake_datetime(args["date"])),
    ):
        return Coder.get_platform_info(coder)


@op("prompts.get_user_language")
def get_user_language(args, _case_dir):
    coder = SimpleNamespace(chat_language=args["chat_language"])
    coder.normalize_language = lambda code: Coder.normalize_language(coder, code)
    with (
        mock.patch.object(base_coder, "locale", fake_locale(args)),
        mock.patch.object(base_coder, "os", fake_os(args)),
    ):
        return Coder.get_user_language(coder)


@op("prompts.normalize_language")
def normalize_language(args, _case_dir):
    return Coder.normalize_language(None, args["code"])


def write_files(root, files):
    paths = []
    for entry in files:
        path = root / entry["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        if is_image_file(entry["path"]):
            path.write_bytes(base64.b64decode(entry["content"]))
        else:
            path.write_bytes(entry["content"].encode("utf-8"))
        paths.append(str(path))
    return paths


def chunks_model(model):
    per_message = model["tokens_per_message"]
    return SimpleNamespace(
        name=model["name"],
        lazy=model["lazy"],
        overeager=model["overeager"],
        examples_as_sys_msg=model["examples_as_sys_msg"],
        reminder=model["reminder"],
        system_prompt_prefix=model["system_prompt_prefix"],
        use_system_prompt=model["use_system_prompt"],
        info={key: model[key] for key in INFO_KEYS},
        token_count=lambda messages: None if per_message is None else per_message * len(messages),
    )


def notice_io(notices):
    io = SimpleNamespace(encoding="utf-8", tool_error=notices.append, tool_warning=notices.append)
    io.read_image = lambda fname: InputOutput.read_image(io, fname)
    io.read_text = lambda fname, silent=False: InputOutput.read_text(io, fname, silent)
    return io


def chunks_coder(args, root, notices):
    """A Coder built without __init__ that holds only what format_chat_chunks reads."""
    coder = object.__new__(Coder)
    coder.io = notice_io(notices)
    coder.root = str(root)
    coder.abs_fnames = write_files(root, args["chat_files"])
    coder.abs_read_only_fnames = write_files(root, args["read_only_files"])
    coder.fences = [tuple(args["fence"])]
    coder.gpt_prompts = PROMPTS[args["prompts"]]()
    coder.main_model = chunks_model(args["model"])
    coder.suggest_shell_commands = args["suggest_shell_commands"]
    coder.get_user_language = lambda: args["user_language"]
    coder.get_platform_info = lambda: args["platform"]
    coder.get_repo_map = lambda: args["repo_map"]
    coder.summarizer_thread = None
    coder.done_messages = args["done"]
    coder.cur_messages = args["cur"]
    return coder


@op("prompts.format_chat_chunks")
def format_chat_chunks(args, case_dir):
    notices = []
    chunks = chunks_coder(args, Path(case_dir), notices).format_chat_chunks()
    if notices:
        raise RuntimeError(f"unexpected notices: {notices}")
    return dataclasses.asdict(chunks)


@op("prompts.all_messages")
def all_messages(args, _case_dir):
    fields = {
        field: [dict(role="user", content=f"{field} {index}") for index in range(count)]
        for field, count in args["counts"].items()
    }
    return ChatChunks(**fields).all_messages()
