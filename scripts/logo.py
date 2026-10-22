"""Draws the Minerr logo as pixel art: a pickaxe and 日本語 from top to bottom, on a dark tile. Writes an SVG.

Run: python3 scripts/logo.py docs/logo.svg"""
import math
import sys

SIZE = 48
INK, OUTLINE = '#0f1d24', '#050d0c'
TEAL_LIGHT, TEAL, TEAL_DARK, SHINE = '#5eead4', '#14b8a6', '#0f766e', '#f0fdfa'
WOOD_LIGHT, WOOD, WOOD_DARK, GRIP_LIGHT, GRIP = '#ffcb6b', '#e8952f', '#b0601c', '#ff8a7e', '#e2564a'

grid = {}

def put(x, y, color):
    grid[(x, y)] = color

# The pickaxe, drawn in its own grid and then centered right of the text. The handle is a 3-pixel staircase on the
# diagonal x + y = S, from the middle of the head to the bottom left.
pick = {}
S, R, SPAN = 32, 17.0, 64
apex = (S / 2 + 6.5, S / 2 - 6.5)
cx, cy = apex[0] - R / math.sqrt(2), apex[1] + R / math.sqrt(2)
for x in range(3, 25):
    for dy, color in ((-1, WOOD_LIGHT), (0, WOOD), (1, WOOD_DARK)):
        pick[(x, S - x + dy)] = color
for x in range(4, 9):
    for dy, color in ((-1, GRIP_LIGHT), (0, GRIP), (1, GRIP)):
        pick[(x, S - x + dy)] = color
for y in range(-4, 40):
    for x in range(-4, 40):
        dx, dy = x + 0.5 - cx, cy - (y + 0.5)
        d = math.hypot(dx, dy)
        angle = math.degrees(math.atan2(dy, dx))
        off = abs(angle - 45)
        if off > SPAN:
            continue
        thickness = 1.0 + 4.6 * math.cos(math.pi / 2 * off / SPAN)
        if R - thickness <= d <= R:
            depth = (R - d) / thickness
            light = depth < 0.34 and angle > 18
            dark = depth > 0.72 or angle < 6
            pick[(x, y)] = TEAL_LIGHT if light else TEAL_DARK if dark else TEAL
# Two shine pixels on the outer edge, near the middle of the head.
mid = [(x, y) for (x, y), c in pick.items() if c == TEAL_LIGHT and abs(math.degrees(math.atan2(cy - y - 0.5, x + 0.5 - cx)) - 52) < 4]
for x, y in sorted(mid)[:2]:
    pick[(x, y)] = SHINE
xs = [x for x, _ in pick]
ys = [y for _, y in pick]
AREA = (17, 3, 45, 45)
ox = (AREA[0] + AREA[2] - (max(xs) - min(xs))) // 2 - min(xs)
oy = (AREA[1] + AREA[3] - (max(ys) - min(ys))) // 2 - min(ys)
for (x, y), color in pick.items():
    put(x + ox, y + oy, color)

# 日本語 in pixel kanji, top to bottom, 11 x 11 each.
GLYPHS = [
    ['.#########.', '.#.......#.', '.#.......#.', '.#.......#.', '.#.......#.', '.#########.', '.#.......#.', '.#.......#.', '.#.......#.', '.#.......#.', '.#########.'],
    ['.....#.....', '###########', '.....#.....', '....###....', '...#.#.#...', '..#..#..#..', '.#...#...#.', '#..#####..#', '.....#.....', '.....#.....', '.....#.....'],
    ['.#...######', '####..#....', '......####.', '###...#..#.', '......#..#.', '###..######', '...........', '###...####.', '#.#...#..#.', '#.#...#..#.', '###...####.'],
]
TX, TY, GAP = 3, 4, 3
for i, rows in enumerate(GLYPHS):
    for y, row in enumerate(rows):
        for x, cell in enumerate(row):
            if cell == '#':
                put(TX + x, TY + i * (11 + GAP) + y, 'TEXT')

# A 1-pixel outline around the pickaxe and the text.
filled = set(grid)
for (x, y) in list(filled):
    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if (nx, ny) not in filled:
            grid[(nx, ny)] = OUTLINE

def rects():
    rows = {}
    for (x, y), color in grid.items():
        rows.setdefault((y, color), []).append(x)
    for (y, color), xs in sorted(rows.items()):
        xs.sort()
        start = prev = xs[0]
        for x in xs[1:] + [None]:
            if x == prev + 1:
                prev = x
                continue
            yield color, start, y, prev - start + 1
            if x is not None:
                start = prev = x

assert all(0 <= x < SIZE and 0 <= y < SIZE for x, y in grid), 'a pixel is outside the tile'
parts = [f'<rect x="{x}" y="{y}" width="{w}" height="1" fill="{"url(#text)" if c == "TEXT" else c}"/>' for c, x, y, w in rects()]
r = 3
tile = (f'M{r} 0' + ''.join(f'H{SIZE - r + i}V{i + 1}' for i in range(r)) + f'V{SIZE - r}'
        + ''.join(f'H{SIZE - i - 1}V{SIZE - r + i + 1}' for i in range(r)) + f'H{r}'
        + ''.join(f'V{SIZE - i - 1}H{r - i - 1}' for i in range(r)) + f'V{r}'
        + ''.join(f'H{i + 1}V{r - i - 1}' for i in range(r)) + 'Z')
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" width="512" height="512" shape-rendering="crispEdges">'
       '<title>Minerr</title>'
       '<defs><linearGradient id="text" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6f61"/><stop offset="1" stop-color="#ffb238"/></linearGradient></defs>'
       f'<path d="{tile}" fill="{INK}"/>' + ''.join(parts) + '</svg>\n')
open(sys.argv[1], 'w').write(svg)
