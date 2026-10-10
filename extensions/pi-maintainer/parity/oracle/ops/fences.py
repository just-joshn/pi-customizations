"""Oracle operations for Coder.choose_fence."""

from types import SimpleNamespace

from aider.coders.base_coder import Coder, all_fences

from . import op


@op("fences.choose_fence")
def choose_fence(args, _case_dir):
    warnings = []
    readonly = dict(enumerate(args.get("readonly_contents", [])))
    coder = SimpleNamespace(
        get_abs_fnames_content=lambda: enumerate(args.get("contents", [])),
        abs_read_only_fnames=list(readonly),
        io=SimpleNamespace(read_text=readonly.get, tool_warning=warnings.append),
        fences=args.get("fences", all_fences),
    )
    Coder.choose_fence(coder)
    return {"fence": list(coder.fence), "warnings": warnings}
