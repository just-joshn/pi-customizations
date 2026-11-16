import re
import sys
import unicodedata

from PIL import Image, ImageDraw, ImageFont

FONT = '/Users/josh-desktop/Library/Fonts/HackNerdFontMono-Regular.ttf'
BOLD = '/Users/josh-desktop/Library/Fonts/HackNerdFontMono-Bold.ttf'
SIZE = 15
BG = (20, 21, 24)
FG = (210, 212, 218)
ANSI16 = [(0, 0, 0), (205, 49, 49), (13, 188, 121), (229, 229, 16), (36, 114, 200), (188, 63, 188), (17, 168, 205), (229, 229, 229),
          (102, 102, 102), (241, 76, 76), (35, 209, 139), (245, 245, 67), (59, 142, 234), (214, 112, 214), (41, 184, 219), (255, 255, 255)]


def xterm256(n):
    if n < 16:
        return ANSI16[n]
    if n < 232:
        n -= 16
        steps = [0, 95, 135, 175, 215, 255]
        return (steps[n // 36], steps[(n // 6) % 6], steps[n % 6])
    v = 8 + (n - 232) * 10
    return (v, v, v)


def parse(text):
    rows = []
    fg, bg, bold, dim = None, None, False, False
    for line in text.split('\n'):
        cells = []
        for token in re.split(r'(\x1b\[[0-9;:]*m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[^\[\]])', line):
            if not token:
                continue
            if token.startswith('\x1b['):
                params = [p for p in re.split('[;:]', token[2:-1])] or ['0']
                i = 0
                while i < len(params):
                    p = int(params[i] or 0)
                    if p == 0:
                        fg, bg, bold, dim = None, None, False, False
                    elif p == 1:
                        bold = True
                    elif p == 2:
                        dim = True
                    elif p == 22:
                        bold, dim = False, False
                    elif p in (38, 48):
                        mode = int(params[i + 1])
                        col = tuple(int(x) for x in params[i + 2:i + 5]) if mode == 2 else xterm256(int(params[i + 2]))
                        i += 4 if mode == 2 else 2
                        if p == 38:
                            fg = col
                        else:
                            bg = col
                    elif p == 39:
                        fg = None
                    elif p == 49:
                        bg = None
                    elif 30 <= p <= 37:
                        fg = ANSI16[p - 30]
                    elif 90 <= p <= 97:
                        fg = ANSI16[p - 82]
                    elif 40 <= p <= 47:
                        bg = ANSI16[p - 40]
                    i += 1
                continue
            if token.startswith('\x1b'):
                continue
            for ch in token:
                color = fg or FG
                if dim:
                    color = tuple(int(c * 0.6 + b * 0.4) for c, b in zip(color, BG))
                cells.append((ch, color, bg, bold))
                if unicodedata.east_asian_width(ch) in ('W', 'F'):
                    cells.append(('', color, bg, bold))
        rows.append(cells)
    return rows


def main(src, dst):
    rows = parse(open(src, encoding='utf-8', errors='replace').read())
    font, bold = ImageFont.truetype(FONT, SIZE), ImageFont.truetype(BOLD, SIZE)
    cw = int(font.getlength('M'))
    ch = int(SIZE * 1.45)
    cols = max((len(r) for r in rows), default=1)
    img = Image.new('RGB', (cols * cw + 32, len(rows) * ch + 32), BG)
    draw = ImageDraw.Draw(img)
    for y, row in enumerate(rows):
        for x, (glyph, color, bg, is_bold) in enumerate(row):
            px, py = 16 + x * cw, 16 + y * ch
            if bg:
                draw.rectangle([px, py, px + cw, py + ch], fill=bg)
            if glyph and glyph != ' ':
                draw.text((px, py + 2), glyph, fill=color, font=bold if is_bold else font)
    img.save(dst)


main(sys.argv[1], sys.argv[2])
