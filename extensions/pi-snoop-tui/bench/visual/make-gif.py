#!/usr/bin/env python3
"""Render record-demo.py frames to an animated GIF.

usage: uv run --with pillow make-gif.py [frames.json.gz] [out.gif] [--png-dir DIR]
With --png-dir it also writes every frame as <index>-<seconds>.png for review."""
import gzip
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = "/System/Library/Fonts/Menlo.ttc"
SIZE = 15
LINE_HEIGHT = 1.4
CANVAS = (20, 21, 26)
TEXT = (233, 236, 244)
OUTER = (11, 12, 15)
FRAME_EDGE = (44, 46, 56)
PAD, MARGIN, RADIUS = 16, 12, 10
MAX_FRAME_MS = 2500
LAST_FRAME_MS = 2500
COLORS = 256


def rgb(value: str | None, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
    if not value or len(value) != 6:
        return fallback
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


class Renderer:
    def __init__(self, cols: int, rows: int) -> None:
        self.regular = ImageFont.truetype(FONT, SIZE, index=0)
        self.bold = ImageFont.truetype(FONT, SIZE, index=1)
        self.cell_w = round(self.regular.getlength("M"))
        self.cell_h = round(SIZE * LINE_HEIGHT)
        self.inset = MARGIN + PAD
        self.size = (cols * self.cell_w + 2 * self.inset, rows * self.cell_h + 2 * self.inset)
        self.base = Image.new("RGB", self.size, OUTER)
        ImageDraw.Draw(self.base).rounded_rectangle(
            [MARGIN, MARGIN, self.size[0] - MARGIN - 1, self.size[1] - MARGIN - 1], RADIUS, fill=CANVAS, outline=FRAME_EDGE
        )

    def render(self, rows: list[list[list]]) -> Image.Image:
        image = self.base.copy()
        draw = ImageDraw.Draw(image)
        for y, line in enumerate(rows):
            x = 0
            top = self.inset + y * self.cell_h
            for chars, fg, bg, bold, reverse in line:
                fill = rgb(fg, CANVAS if reverse else TEXT)
                if bg or reverse:
                    left = self.inset + x * self.cell_w
                    draw.rectangle([left, top, left + len(chars) * self.cell_w - 1, top + self.cell_h - 1], fill=rgb(bg, TEXT))
                for char in chars:
                    if char not in " \0":
                        draw.text((self.inset + x * self.cell_w, top + 2), char, fill=fill, font=self.bold if bold else self.regular)
                    x += 1
        return image


def timeline(frames: list[dict]) -> list[tuple[list, int]]:
    """Pair each distinct screen with how long it stayed up, capping idle stretches."""
    shown = []
    for frame, following in zip(frames, frames[1:]):
        duration = round((following["t"] - frame["t"]) * 1000)
        if shown and shown[-1][0] == frame["rows"]:
            shown[-1][1] += duration
        else:
            shown.append([frame["rows"], duration])
    timed = [(rows, max(20, min(duration, MAX_FRAME_MS))) for rows, duration in shown]
    timed[-1] = (timed[-1][0], LAST_FRAME_MS)
    return timed


def main() -> None:
    args = [arg for arg in sys.argv[1:] if not arg.startswith("--png-dir")]
    png_dir = next((arg.split("=", 1)[1] for arg in sys.argv[1:] if arg.startswith("--png-dir=")), None)
    src = args[0] if args else os.path.join(HERE, "out", "demo-frames.json.gz")
    dst = args[1] if len(args) > 1 else os.path.join(HERE, "..", "..", "docs", "demo.gif")
    with gzip.open(src, "rt") as handle:
        data = json.load(handle)
    renderer = Renderer(data["cols"], data["rows"])
    timed = timeline(data["frames"])
    images = [renderer.render(rows) for rows, _ in timed]
    durations = [duration for _, duration in timed]
    if png_dir:
        os.makedirs(png_dir, exist_ok=True)
        elapsed = 0
        for index, (image, duration) in enumerate(zip(images, durations)):
            image.save(os.path.join(png_dir, f"{index:03d}-{elapsed / 1000:05.2f}.png"))
            elapsed += duration
    picks, styles = [], set()
    for (rows, _), image in zip(timed, images):
        frame_styles = {tuple(run[1:]) for line in rows for run in line}
        if not frame_styles <= styles:
            styles |= frame_styles
            picks.append(image)
    sample = Image.new("RGB", (renderer.size[0], renderer.size[1] * len(picks)))
    for slot, image in enumerate(picks):
        sample.paste(image, (0, slot * renderer.size[1]))
    exact = sorted({CANVAS, TEXT, OUTER, FRAME_EDGE} | {rgb(value, CANVAS) for style in styles for value in style[:2]})
    shades = sample.quantize(COLORS - len(exact), method=Image.Quantize.MEDIANCUT).getpalette()[: 3 * (COLORS - len(exact))]
    palette = Image.new("P", (1, 1))
    palette.putpalette([channel for color in exact for channel in color] + shades)
    frames = [image.quantize(palette=palette, dither=Image.Dither.NONE) for image in images]
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    frames[0].save(dst, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=False, disposal=1)
    print(f"{dst}: {len(frames)} frames, {sum(durations) / 1000:.1f} s, {os.path.getsize(dst) / 1e6:.2f} MB")


main()
