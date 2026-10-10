"""Oracle operations for CPython's difflib, the standard-library module Aider calls.

The reference is the difflib of the Python that runs Aider, not Aider itself.
"""

import difflib

from . import op

NAMED_JUNK = {"IS_LINE_JUNK": difflib.IS_LINE_JUNK, "IS_CHARACTER_JUNK": difflib.IS_CHARACTER_JUNK}


def junk_of(spec):
    """None, the name of a difflib junk function, or a list of the elements that are junk."""
    if spec is None:
        return None
    if isinstance(spec, str):
        return NAMED_JUNK[spec]
    return frozenset(spec).__contains__


def given(args, *names):
    return {name: args[name] for name in names if name in args}


def opcodes_of(codes):
    return [list(code) for code in codes]


@op("difflib.sequence_matcher")
def sequence_matcher(args, _case_dir):
    s = difflib.SequenceMatcher(junk_of(args.get("isjunk")), args["a"], args["b"], args.get("autojunk", True))
    longest = s.find_longest_match(*args.get("longest", []))
    blocks = [block._asdict() for block in s.get_matching_blocks()]
    opcodes = opcodes_of(s.get_opcodes())
    groups = [opcodes_of(group) for group in s.get_grouped_opcodes(args.get("n", 3))]
    return {
        "find_longest_match": longest._asdict(),
        "matching_blocks": blocks,
        "opcodes": opcodes,
        "grouped_opcodes": groups,
        "opcodes_after_grouping": opcodes_of(s.get_opcodes()),
        "ratio": s.ratio(),
        "quick_ratio": s.quick_ratio(),
        "real_quick_ratio": s.real_quick_ratio(),
    }


@op("difflib.get_close_matches")
def get_close_matches(args, _case_dir):
    return difflib.get_close_matches(args["word"], args["possibilities"], **given(args, "n", "cutoff"))


@op("difflib.unified_diff")
def unified_diff(args, _case_dir):
    options = given(args, "fromfile", "tofile", "fromfiledate", "tofiledate", "n", "lineterm")
    return list(difflib.unified_diff(args["a"], args["b"], **options))


@op("difflib.ndiff")
def ndiff(args, _case_dir):
    junk = {name: junk_of(spec) for name, spec in given(args, "linejunk", "charjunk").items()}
    return list(difflib.ndiff(args["a"], args["b"], **junk))


@op("difflib.is_line_junk")
def is_line_junk(args, _case_dir):
    return difflib.IS_LINE_JUNK(args["line"])


@op("difflib.is_character_junk")
def is_character_junk(args, _case_dir):
    return difflib.IS_CHARACTER_JUNK(args["ch"], **given(args, "ws"))
