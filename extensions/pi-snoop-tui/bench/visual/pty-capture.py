#!/usr/bin/env python3
"""Start Pi in a pseudo-terminal on a session file, wait for the frame to settle, and save the screen as .ansi and .txt.

usage: pty-capture.py <out-prefix> <cols> <rows> <session.jsonl> [--expand] [--page-up=N] -- [pi args...]
With --expand it also sends Ctrl+O, then N PageUp keys, and saves <out-prefix>-expanded. Run it with `uv run --with pyte`, where tmux cannot open a socket."""
import os
import pty
import select
import signal
import struct
import sys
import time
import fcntl
import termios

import pyte

NAMES = ["black", "red", "green", "brown", "blue", "magenta", "cyan", "white"]


def sgr_color(value: str, base: int) -> str:
    if value == "default":
        return ""
    if value in NAMES:
        return f"{base + NAMES.index(value)};"
    if value.startswith("bright") and value[6:] in NAMES:
        return f"{base + 60 + NAMES.index(value[6:])};"
    return f"{base + 8};2;{int(value[0:2], 16)};{int(value[2:4], 16)};{int(value[4:6], 16)};"


def dump(screen: pyte.Screen, prefix: str) -> None:
    ansi, text = [], []
    for y in range(screen.lines):
        row = screen.buffer[y]
        line, plain = "", ""
        for x in range(screen.columns):
            char = row[x]
            if char.data == "":
                continue
            fg, bg = (char.bg, char.fg) if char.reverse else (char.fg, char.bg)
            line += f"\x1b[0;{'1;' if char.bold else ''}{sgr_color(fg, 30)}{sgr_color(bg, 40)}".rstrip(";") + "m" + char.data
            plain += char.data
        ansi.append(line + "\x1b[0m")
        text.append(plain.rstrip())
    with open(f"{prefix}.ansi", "w") as handle:
        handle.write("\n".join(ansi) + "\n")
    with open(f"{prefix}.txt", "w") as handle:
        handle.write("\n".join(text) + "\n")


def settle(fd: int, stream: pyte.ByteStream, quiet: float, cap: float) -> None:
    deadline, seen = time.monotonic() + cap, False
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], quiet)
        if not ready:
            if seen:
                return
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            return
        seen = True
        stream.feed(data)


def main() -> None:
    split = sys.argv.index("--")
    prefix, cols, rows, session_file, *flags = sys.argv[1:split]
    cols, rows = int(cols), int(rows)
    screen = pyte.Screen(cols, rows)
    stream = pyte.ByteStream(screen)
    env = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor", COLUMNS=str(cols), LINES=str(rows))
    pid, fd = pty.fork()
    if pid == 0:
        os.execvpe("pi", ["pi", *sys.argv[split + 1:], "--session", session_file], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    settle(fd, stream, quiet=1.5, cap=60)
    dump(screen, prefix)
    if "--expand" in flags:
        os.write(fd, b"\x0f")
        settle(fd, stream, quiet=1.5, cap=60)
        pages = next((int(flag.split("=")[1]) for flag in flags if flag.startswith("--page-up=")), 0)
        for _ in range(pages):
            os.write(fd, b"\x1b[5~")
            settle(fd, stream, quiet=0.5, cap=60)
        dump(screen, f"{prefix}-expanded")
    os.close(fd)
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)


main()
