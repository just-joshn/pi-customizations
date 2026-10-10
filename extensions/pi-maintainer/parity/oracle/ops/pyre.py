"""Oracle operations for Python re semantics that the port spells with JavaScript RegExp."""

import re

from . import op


@op("pyre.whitespace")
def whitespace(_args, _case_dir):
    return [code for code in range(0x110000) if re.match(r"\s", chr(code))]
