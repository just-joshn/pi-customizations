"""Oracle operations for Python's str.format, which the prompt ports reimplement."""

from . import op


@op("pyformat.format")
def format_template(args, _case_dir):
    values = {key: tuple(value) if isinstance(value, list) else value for key, value in args["values"].items()}
    return args["template"].format(**values)
