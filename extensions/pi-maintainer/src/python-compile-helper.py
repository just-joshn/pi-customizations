import json, sys, traceback


def main():
    path = sys.argv[1]
    code = open(path, encoding="utf-8", errors="replace").read()
    try:
        compile(code, path, "exec")  # USE TRACEBACK BELOW HERE
        print(json.dumps({"ok": True}))
    except Exception as err:
        end_lineno = getattr(err, "end_lineno", err.lineno)
        line_numbers = list(range(err.lineno - 1, end_lineno))
        tb_lines = traceback.format_exception(type(err), err, err.__traceback__)
        last_file_i = 0

        target = "# USE TRACEBACK"
        target += " BELOW HERE"
        for i in range(len(tb_lines)):
            if target in tb_lines[i]:
                last_file_i = i
                break

        tb_lines = tb_lines[:1] + tb_lines[last_file_i + 1:]

        text = "".join(tb_lines)
        print(json.dumps({"ok": False, "text": text, "lines": line_numbers}))


if __name__ == "__main__":
    main()
