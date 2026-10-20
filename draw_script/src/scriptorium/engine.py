# Calamus — szerokie piórko jak w LOGO.
# Komendy (jedna na linię, komentarz po średniku):
#   WEIGHT <szerokość>     szerokość stalówki w jednostkach strony
#   NIB <stopnie>          kąt krawędzi stalówki (0 = poziomo, grube piony;
#                          dodatni = krawędź wznosi się w prawo, jak u praworęcznego skryby)
#   PU                     pióro w górze
#   PD                     pióro w dole
#   MV <x> <y> <nacisk>    ruch; nacisk 0..1. Przy PU to droga na sucho.
#   INK <gall|rubric>      atrament następnych kresek (żelazowo-galasowy albo rubryka)
#
# WEIGHT i INK obowiązują od miejsca wystąpienia, dla każdej kreski osobno.
# PD zaczyna kreskę w bieżącej pozycji pióra (tam, gdzie było w górze).
#
# Ślad stalówki to odcinek długości (WEIGHT * nacisk) obrócony o NIB.
# Y rośnie w dół, jak na karcie. Uruchomienie: python strona.py

from __future__ import annotations

import math
from dataclasses import dataclass, field


@dataclass
class Pt:
    x: float
    y: float
    p: float
    nib: float


@dataclass
class Ink:
    pts: list[Pt] = field(default_factory=list)
    # szerokość stalówki i atrament w chwili PD - inicjał rubryką ma inne niż tekst
    weight: float = 2.4
    color: str = "gall"


INK_COLORS = {"gall": "#1c140e", "rubric": "#9b2d1f"}


@dataclass
class Program:
    weight: float
    ink: list[Ink]
    travel: list[tuple[Pt, Pt]]


def parse(src: str) -> Program:
    weight = 2.4
    nib = 35.0
    color = "gall"
    down = False
    ink: list[Ink] = []
    cur: Ink | None = None
    travel: list[tuple[Pt, Pt]] = []
    last: Pt | None = None

    for raw in src.splitlines():
        line = raw.split(";", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        op = parts[0].upper()
        if op == "WEIGHT" and len(parts) > 1:
            weight = float(parts[1])
        elif op == "INK" and len(parts) > 1:
            color = parts[1].lower()
        elif op == "NIB" and len(parts) > 1:
            nib = float(parts[1])
        elif op == "PU":
            down = False
            if cur and cur.pts:
                ink.append(cur)
            cur = None
        elif op == "PD":
            down = True
            if cur and cur.pts:
                ink.append(cur)
            cur = Ink(weight=weight, color=color)
            # Kreska zaczyna się tam, gdzie pióro stało w górze. Wcześniej ten punkt
            # przepadał i np. "MV 10 10 / PD / MV 10 60" nie rysowało pionu.
            if last is not None:
                cur.pts.append(Pt(last.x, last.y, last.p if last.p > 0 else 0.9, nib))
        elif op == "MV" and len(parts) >= 3:
            x = float(parts[1])
            y = float(parts[2])
            p = float(parts[3]) if len(parts) > 3 else 0.9
            pt = Pt(x, y, max(0.0, min(1.0, p)), nib)
            if down:
                if cur is None:
                    cur = Ink(weight=weight, color=color)
                # pierwszy MV w tym samym miejscu co start kreski zastępuje punkt startowy
                # (tak pisze eksport z aplikacji: MV x y 0 / PD / MV x y nacisk)
                if len(cur.pts) == 1 and abs(cur.pts[0].x - x) < 1e-6 and abs(cur.pts[0].y - y) < 1e-6:
                    cur.pts[0] = pt
                else:
                    cur.pts.append(pt)
            elif last is not None:
                travel.append((last, pt))
            last = pt
        else:
            raise ValueError(f"nieznana komenda: {line}")

    if cur and cur.pts:
        ink.append(cur)
    return Program(weight=weight, ink=ink, travel=travel)


def _ends(pt: Pt, weight: float) -> tuple[tuple[float, float], tuple[float, float]]:
    # dodatni NIB = krawędź wznosi się w prawo (jak w kaligrafii); Y rośnie w dół, stąd minus
    a = math.radians(-pt.nib)
    half = weight * max(0.05, pt.p) * 0.5
    dx = math.cos(a) * half
    dy = math.sin(a) * half
    return (pt.x - dx, pt.y - dy), (pt.x + dx, pt.y + dy)


def ribbon(pts: list[Pt], weight: float) -> str:
    if len(pts) == 1:
        (x0, y0), (x1, y1) = _ends(pts[0], weight)
        return f"M {x0:.2f} {y0:.2f} L {x1:.2f} {y1:.2f}"
    left: list[tuple[float, float]] = []
    right: list[tuple[float, float]] = []
    prev = None
    for pt in pts:
        if prev is not None and abs(pt.x - prev.x) < 0.01 and abs(pt.y - prev.y) < 0.01:
            continue
        a, b = _ends(pt, weight)
        left.append(a)
        right.append(b)
        prev = pt
    if len(left) < 2:
        return ""
    cmds = [f"M {left[0][0]:.2f} {left[0][1]:.2f}"]
    cmds += [f"L {x:.2f} {y:.2f}" for x, y in left[1:]]
    cmds += [f"L {x:.2f} {y:.2f}" for x, y in reversed(right)]
    cmds.append("Z")
    return " ".join(cmds)


def to_svg(prog: Program, pad: float = 16.0) -> str:
    xs: list[float] = []
    ys: list[float] = []
    for s in prog.ink:
        for p in s.pts:
            xs.append(p.x)
            ys.append(p.y)
    if not xs:
        xs, ys = [0.0, 100.0], [0.0, 40.0]
    minx, maxx = min(xs) - pad, max(xs) + pad
    miny, maxy = min(ys) - pad, max(ys) + pad
    w, h = maxx - minx, maxy - miny
    paths = []
    for s in prog.ink:
        d = ribbon(s.pts, s.weight)
        if d:
            paths.append(f'<path d="{d}" fill="{INK_COLORS.get(s.color, INK_COLORS["gall"])}"/>')
    body = "\n  ".join(paths)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{minx:.1f} {miny:.1f} {w:.1f} {h:.1f}">\n'
        f'  <rect x="{minx:.1f}" y="{miny:.1f}" width="{w:.1f}" height="{h:.1f}" fill="#f3e6c9"/>\n'
        f"  {body}\n</svg>\n"
    )


def cechy(strokes: list[list[tuple[float, float]]]) -> dict[str, float]:
    """Cechy środka kresek do porównania ręki. To przybliżenie dydaktyczne."""
    pts = [p for s in strokes for p in s]
    if len(pts) < 3:
        return {"kanciastość": 0, "pochył": 0, "zwartość": 0, "drżenie": 0, "pętle": 0}
    turns = []
    jitter = []
    for s in strokes:
        if len(s) < 3:
            continue
        for i in range(1, len(s) - 1):
            ax, ay = s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]
            bx, by = s[i + 1][0] - s[i][0], s[i + 1][1] - s[i][1]
            la, lb = math.hypot(ax, ay), math.hypot(bx, by)
            if la < 1e-6 or lb < 1e-6:
                continue
            dot = max(-1.0, min(1.0, (ax * bx + ay * by) / (la * lb)))
            turns.append(math.acos(dot))
            jitter.append(abs(la - lb))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    width = max(xs) - min(xs) or 1
    height = max(ys) - min(ys) or 1
    # pochył najdłuższej kreski względem pionu
    best = 0.0
    slant = 0.0
    for s in strokes:
        if len(s) < 2:
            continue
        dx, dy = s[-1][0] - s[0][0], s[-1][1] - s[0][1]
        length = math.hypot(dx, dy)
        if length > best:
            best = length
            slant = abs(math.degrees(math.atan2(dx, dy)))
    return {
        "kanciastość": (sum(turns) / len(turns) / 1.4) if turns else 0.0,
        "pochył": min(1.0, slant / 25.0),
        "zwartość": min(1.5, height / width),
        "drżenie": (sum(jitter) / len(jitter) / 8.0) if jitter else 0.0,
        "pętle": 0.0,
    }


def ranking(feat: dict[str, float], wzorce: dict[str, dict[str, float]]) -> list[tuple[str, float]]:
    scored = []
    keys = ("kanciastość", "pochył", "zwartość", "drżenie")
    for name, proto in wzorce.items():
        dist = math.sqrt(sum((feat.get(k, 0) - proto.get(k, 0)) ** 2 for k in keys))
        scored.append((name, dist))
    scored.sort(key=lambda it: it[1])
    return scored


if __name__ == "__main__":
    import sys

    src = sys.stdin.read() if len(sys.argv) < 2 else open(sys.argv[1], encoding="utf-8").read()
    svg = to_svg(parse(src))
    dest = sys.argv[2] if len(sys.argv) > 2 else "strona.svg"
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write(svg)
    print(dest)
