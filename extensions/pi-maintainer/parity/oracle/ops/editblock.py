"""Oracle operations for aider/coders/editblock_coder.py."""

from pathlib import Path

from aider.coders import editblock_coder as eb

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
