"""Oracle operations for Aider's option resolution: configargparse, PyYAML, and python-dotenv."""

import io
import os
import subprocess
from contextlib import contextmanager
from pathlib import Path

from configargparse import YAMLConfigFileParser
from dotenv import load_dotenv

from aider.args import get_parser

from . import op

CONF = ".aider.conf.yml"
DESTS = [
    "edit_format",
    "auto_accept_architect",
    "editor_model",
    "editor_edit_format",
    "yes_always",
    "dry_run",
    "encoding",
    "line_endings",
    "file",
    "read",
    "apply",
    "suggest_shell_commands",
]


@contextmanager
def environment(values):
    saved = dict(os.environ)
    os.environ.clear()
    os.environ.update(values)
    try:
        yield
    finally:
        os.environ.clear()
        os.environ.update(saved)


@op("settings.yaml_config")
def yaml_config(args, _case_dir):
    parsed = YAMLConfigFileParser().parse(io.StringIO(args["text"]))
    return [[key, value] for key, value in parsed.items()]


@op("settings.dotenv")
def dotenv(args, _case_dir):
    with environment(args.get("environment", {})):
        load_dotenv(stream=io.StringIO(args["text"]), override=True)
        return dict(os.environ)


def write_layout(args, case_dir):
    home = case_dir / "home"
    repo = case_dir / "repo"
    cwd = repo / args.get("subdir", "")
    for path in (home, repo, cwd):
        path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    files = {"home": home, "git": repo, "cwd": cwd}
    for place, text in args.get("configs", {}).items():
        (files[place] / CONF).write_text(text, encoding="utf-8")
    return home, repo, cwd


def argv_of(cli):
    argv = []
    for name, value in cli.items():
        argv += [f"--{name}"] if value is True else [f"--{name}", value]
    return argv


@op("settings.resolve")
def resolve(args, case_dir):
    home, repo, cwd = write_layout(args, case_dir)
    env = {f"AIDER_{key}": value for key, value in args.get("env", {}).items()}
    with environment({"HOME": str(home), "PATH": os.environ.get("PATH", ""), **env}):
        os.chdir(cwd)
        defaults = [str(Path(CONF).resolve())]
        if str(repo.resolve() / CONF) not in defaults:
            defaults.append(str(repo.resolve() / CONF))
        defaults.append(str(Path.home() / CONF))
        defaults.reverse()
        try:
            parser = get_parser(defaults, str(repo.resolve()))
            parsed, _unknown = parser.parse_known_args(argv_of(args.get("cli", {})))
        except SystemExit as exit:  # argparse exits on a bad value; the driver only records Exception
            raise RuntimeError(f"argparse exit {exit.code}") from exit
    values = {dest: getattr(parsed, dest) for dest in DESTS}
    values["file"] = values["file"] or []
    values["read"] = values["read"] or []
    return values


@op("settings.dotenv_search_path")
def dotenv_search_path(args, case_dir):
    from aider.main import generate_search_path_list

    home, repo, cwd = (case_dir / "home", case_dir / "repo", case_dir / "repo" / args.get("subdir", ""))
    for path in (home, repo, cwd):
        path.mkdir(parents=True, exist_ok=True)
    git_root = str(repo) if args.get("git", True) else None
    env_file = args.get("env_file") or (str(repo / ".env") if git_root else ".env")
    with environment({"HOME": str(home)}):
        os.chdir(cwd)
        found = generate_search_path_list(".env", git_root, env_file)
    base = str(case_dir.resolve())
    return [path.replace(base, "<root>") for path in found]
