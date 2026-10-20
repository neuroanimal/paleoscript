export type PenPt = { x: number; y: number; p: number; nibT: number };

export type Glyph = { w: number; strokes: PenPt[][] };

export const ASC = 4;
export const XH = 42;
export const BASE = 100;
export const DESC = 134;

export type Mark = "per" | "pro" | "que" | "rum";

export type Style = {
  angular: number;
  feet: number;
  loops: number;
  aForm: number;
  uncialD: number;
  lombard: boolean;
};

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

function env(pts: PenPt[]): PenPt[] {
  const n = Math.max(1, pts.length - 1);
  return pts.map((pt, i) => {
    const t = i / n;
    const attack = t < 0.14 ? 0.62 + (t / 0.14) * 0.38 : 1;
    const release = t > 0.86 ? 1 - ((t - 0.86) / 0.14) * 0.28 : 1;
    return { ...pt, p: clamp(pt.p * attack * release, 0.08, 1), nibT: t };
  });
}

function pt(x: number, y: number, p = 1): PenPt {
  return { x, y, p, nibT: 0 };
}

function line(x0: number, y0: number, x1: number, y1: number, n = 7, p = 1): PenPt[] {
  const pts: PenPt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(pt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p));
  }
  return pts;
}

function quad(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  n = 10,
  p = 1,
): PenPt[] {
  const pts: PenPt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push(pt(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1, p));
  }
  return pts;
}

function resample(pts: PenPt[], n: number): PenPt[] {
  if (!pts.length) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const lens = [0];
  for (let i = 1; i < pts.length; i++) {
    lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = lens[lens.length - 1] || 1;
  const out: PenPt[] = [];
  for (let k = 0; k < n; k++) {
    const target = (k / Math.max(1, n - 1)) * total;
    let i = 1;
    while (i < lens.length - 1 && lens[i] < target) i++;
    const span = lens[i] - lens[i - 1] || 1;
    const u = (target - lens[i - 1]) / span;
    const a = pts[i - 1];
    const b = pts[i];
    out.push(pt(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.p + (b.p - a.p) * u));
  }
  return out;
}

function blend(a: PenPt[], b: PenPt[], ang: number): PenPt[] {
  const n = Math.max(a.length, b.length, 2);
  const ra = resample(a, n);
  const rb = resample(b, n);
  const t = clamp(ang);
  return ra.map((p, i) => pt(p.x * (1 - t) + rb[i].x * t, p.y * (1 - t) + rb[i].y * t, p.p * (1 - t) + rb[i].p * t));
}

function minim(x: number, y0: number, y1: number, feet: number): PenPt[] {
  const body = line(x, y0, x + 0.4, y1, 8, 1);
  const flick = 2.2 + feet * 12;
  const foot = line(x + 0.4, y1, x + flick, y1 + feet * 1.6, 3, 0.9);
  return env([...body, ...foot.slice(1)]);
}

function arch(x0: number, x1: number, y: number, ang: number): PenPt[] {
  const mid = (x0 + x1) / 2;
  const round = quad(x0, y + 7, mid, y - 12, x1, y + 8, 12, 0.96);
  const shoulder = x0 + (x1 - x0) * 0.46;
  const broken = [...line(x0, y + 4, shoulder, y - 1, 4, 0.92), ...line(shoulder, y - 1, x1, y + 10, 5, 1).slice(1)];
  return env(blend(round, broken, ang));
}

function bow(x: number, top: number, bot: number, rx: number, ang: number, side: 1 | -1): PenPt[] {
  const cy = (top + bot) / 2;
  const ry = (bot - top) / 2;
  const steps = 12;
  const round: PenPt[] = [];
  for (let i = 0; i <= steps; i++) {
    const th = -Math.PI / 2 + (i / steps) * Math.PI;
    round.push(pt(x + side * Math.cos(th) * rx, cy + Math.sin(th) * ry, 1));
  }
  const yA = top + (bot - top) * 0.22;
  const yB = bot - (bot - top) * 0.2;
  const broken = resample(
    [
      pt(x, top),
      pt(x + side * rx * 0.96, yA),
      pt(x + side * rx * 0.96, yB),
      pt(x, bot),
    ],
    steps + 1,
  );
  return env(blend(round, broken, ang));
}

function oval(cx: number, cy: number, rx: number, ry: number, ang: number): PenPt[] {
  const steps = 18;
  const round: PenPt[] = [];
  for (let i = 0; i <= steps; i++) {
    const th = -Math.PI / 2 + (i / steps) * Math.PI * 2;
    round.push(pt(cx + Math.cos(th) * rx, cy + Math.sin(th) * ry, 1));
  }
  const hex = resample(
    [
      pt(cx - rx * 0.42, cy - ry),
      pt(cx + rx * 0.46, cy - ry),
      pt(cx + rx, cy - ry * 0.12),
      pt(cx + rx * 0.5, cy + ry),
      pt(cx - rx * 0.48, cy + ry),
      pt(cx - rx, cy + ry * 0.08),
      pt(cx - rx * 0.42, cy - ry),
    ],
    steps + 1,
  );
  return env(blend(round, hex, ang));
}

function loopTop(x: number, y: number, s: number): PenPt[] {
  return env(quad(x, y + 8, x - 14 * s, y - 16 * s, x + 1, y + 2, 8, 0.85));
}

function dot(x: number, y: number): PenPt[] {
  return env(line(x - 1.4, y, x + 1.6, y + 1.2, 2, 1));
}

function acute(x: number, y: number): PenPt[] {
  return env(line(x - 3, y + 6, x + 7, y - 6, 3, 0.72));
}

function tilde(x: number, y: number): PenPt[] {
  return env([
    ...quad(x - 8, y, x - 2, y - 7, x + 2, y + 1, 5, 0.6),
    ...quad(x + 2, y + 1, x + 6, y + 6, x + 11, y - 1, 5, 0.6).slice(1),
  ]);
}

function ogonek(x: number): PenPt[] {
  return env(quad(x, BASE + 1, x + 9, BASE + 16, x - 1, BASE + 24, 6, 0.8));
}

function barL(x: number): PenPt[] {
  return env(line(x - 7, XH + 10, x + 11, XH - 8, 3, 0.78));
}

function tittle(x: number, ang: number): PenPt[] {
  if (ang > 0.55) return env(line(x - 6, XH - 6, x + 3, XH - 16, 3, 0.62));
  return dot(x, XH - 14);
}

function empty(): Glyph {
  return { w: 16, strokes: [] };
}

function gC(st: Style): Glyph {
  const arc = bow(38, XH + 3, BASE - 2, 22, st.angular, -1);
  const top = line(30, XH + 6, 40, XH + 10, 3, 0.7);
  return { w: 46, strokes: [env([...top.slice(0, 1), ...arc])] };
}

function gE(st: Style): Glyph {
  const body = gC(st);
  const eye = XH + 18 - st.angular * 6;
  body.strokes.push(env(line(16, eye, 36, eye - 1, 4, 0.88)));
  return body;
}

function gO(st: Style): Glyph {
  const cx = 24;
  const cy = (XH + BASE) / 2 + 1;
  if (st.angular < 0.55) return { w: 50, strokes: [oval(cx, cy, 18, 27, st.angular)] };
  const left = bow(cx + 2, XH + 2, BASE - 1, 18, st.angular, -1);
  const right = bow(cx - 2, XH + 2, BASE - 1, 18, st.angular, 1);
  return { w: 48, strokes: [left, right] };
}

function gA(st: Style): Glyph {
  if (st.aForm < 0.28) {
    const left = bow(24, XH + 8, BASE - 2, 14, st.angular * 0.5, -1);
    const right = bow(30, XH + 14, BASE - 2, 12, st.angular * 0.4, -1);
    return { w: 44, strokes: [left, right] };
  }
  if (st.aForm > 0.84) {
    const bowl = oval(20, (XH + 18 + BASE) / 2, 13, 18, st.angular * 0.45);
    const stem = minim(34, XH + 2, BASE, st.feet * 0.6);
    return { w: 46, strokes: [bowl, stem] };
  }
  const lower = oval(20, XH + 46, 14, 16, st.angular);
  const stem = minim(36, XH + 1, BASE, st.feet);
  const lobe = bow(34, XH + 1, XH + 28, 12, st.angular, -1);
  return { w: 48, strokes: [lower, lobe, stem] };
}

function withLoop(stem: PenPt[], x: number, st: Style): PenPt[][] {
  if (st.loops < 0.45) return [stem];
  return [stem, loopTop(x, ASC + 6, 0.7 + st.loops * 0.4)];
}

function gB(st: Style): Glyph {
  const stem = minim(12, ASC, BASE, st.feet);
  const bowl = bow(14, XH + 4, BASE - 2, 20, st.angular, 1);
  return { w: 46, strokes: [...withLoop(stem, 12, st), bowl] };
}

function gD(st: Style): Glyph {
  const bowl = bow(34, XH + 3, BASE - 2, 20, st.angular, -1);
  const lean = (1 - st.uncialD) * 10;
  const stem = env([
    ...line(36, ASC + lean, 36 - lean * 0.3, XH, 5, 1),
    ...line(36 - lean * 0.3, XH, 36, BASE, 6, 1).slice(1),
    ...line(36, BASE, 36 + 3 + st.feet * 10, BASE + st.feet, 2, 0.85).slice(1),
  ]);
  return { w: 48, strokes: [bowl, stem] };
}

function gF(st: Style): Glyph {
  const stem = env(line(22, ASC, 20, BASE + 10, 10, 1));
  const head = env(quad(22, ASC + 2, 10, ASC - 2, 8, ASC + 14, 5, 0.8));
  const bar = env(line(10, XH + 2, 32, XH - 1, 4, 0.75));
  return { w: 40, strokes: [head, stem, bar] };
}

function gG(st: Style): Glyph {
  const upper = oval(24, XH + 30, 16, 22, st.angular);
  const lower = oval(22, BASE + 16, 14, 16, st.angular);
  const link = env(line(30, XH + 48, 28, BASE + 4, 3, 0.8));
  if (st.angular > 0.6) return { w: 46, strokes: [upper, link, lower] };
  const open = env(quad(30, BASE + 2, 34, DESC, 14, DESC - 4, 7, 0.9));
  return { w: 46, strokes: [upper, open] };
}

function gH(st: Style): Glyph {
  const stem = minim(10, ASC, BASE, st.feet);
  const join = arch(10, 36, XH, st.angular);
  const right = minim(36, XH + 8, BASE, st.feet);
  return { w: 50, strokes: [...withLoop(stem, 10, st), join, right] };
}

function gI(st: Style): Glyph {
  return { w: 22, strokes: [minim(10, XH, BASE, st.feet), tittle(10, st.angular)] };
}

function gJ(st: Style): Glyph {
  const stem = env([
    ...line(12, XH, 12, BASE + 8, 8, 1),
    ...quad(12, BASE + 8, 14, DESC, 2, DESC - 2, 5, 0.9).slice(1),
  ]);
  return { w: 24, strokes: [stem, tittle(12, st.angular)] };
}

function gK(st: Style): Glyph {
  const stem = minim(12, ASC, BASE, st.feet);
  const arm = env(line(14, XH + 24, 36, XH + 2, 5, 0.95));
  const leg = env(line(16, XH + 30, 36, BASE - 2, 5, 0.95));
  const join =
    st.angular > 0.55 ? [env(line(28, XH + 14, 22, XH + 36, 3, 0.7))] : [];
  return { w: 46, strokes: [stem, arm, leg, ...join] };
}

function gL(st: Style): Glyph {
  const stem = minim(14, ASC, BASE, st.feet);
  return { w: 28, strokes: withLoop(stem, 14, st) };
}

function gM(st: Style): Glyph {
  return {
    w: 70,
    strokes: [
      minim(8, XH, BASE, st.feet),
      arch(8, 32, XH, st.angular),
      minim(32, XH + 6, BASE, st.feet),
      arch(32, 56, XH, st.angular),
      minim(56, XH + 6, BASE, st.feet),
    ],
  };
}

function gN(st: Style): Glyph {
  return {
    w: 50,
    strokes: [
      minim(8, XH + 2, BASE, st.feet),
      arch(8, 36, XH, st.angular),
      minim(36, XH + 8, BASE, st.feet),
    ],
  };
}

function gP(st: Style, mark?: Mark): Glyph {
  const stem = env([
    ...line(12, XH, 12, DESC, 10, 1),
    ...line(12, DESC, 12 + 4 + st.feet * 8, DESC + 1, 2, 0.7).slice(1),
  ]);
  const bowl = bow(14, XH + 2, BASE - 2, 18, st.angular, 1);
  const extra: PenPt[][] = [];
  if (mark === "per") extra.push(env(line(4, BASE + 14, 24, BASE + 12, 3, 0.7)));
  if (mark === "pro") extra.push(env(quad(12, XH + 20, -2, XH + 8, 12, XH + 2, 6, 0.8)));
  return { w: 44, strokes: [stem, bowl, ...extra] };
}

function gQ(st: Style, mark?: Mark): Glyph {
  const bowl = oval(20, XH + 30, 15, 24, st.angular);
  const tail = env(quad(30, XH + 46, 38, BASE + 10, 28, DESC, 6, 1));
  const extra: PenPt[][] = [];
  if (mark === "que") extra.push(env(line(24, BASE + 8, 40, DESC - 2, 3, 0.65)));
  return { w: 44, strokes: [bowl, tail, ...extra] };
}

function gR(st: Style, rotunda: boolean): Glyph {
  if (rotunda) {
    const shoulder = env(quad(8, XH + 8, 28, XH - 2, 34, XH + 22, 7, 0.95));
    const leg = env(quad(24, XH + 16, 18, BASE - 4, 30, BASE, 5, 0.9));
    return { w: 40, strokes: [shoulder, leg] };
  }
  const stem = minim(10, XH, BASE, st.feet);
  const flag = env(quad(12, XH + 4, 30, XH - 4, 34, XH + 18, 6, 0.9));
  return { w: 42, strokes: [stem, flag] };
}

function gS(st: Style, long: boolean): Glyph {
  if (long) {
    const stem = env(line(20, ASC + 10, 16, BASE + 16, 12, 1));
    const head = env(quad(20, ASC + 12, 6, ASC + 2, 8, XH - 2, 5, 0.8));
    const foot = env(quad(16, BASE + 10, 28, DESC, 10, BASE + 20, 4, 0.75));
    return { w: 34, strokes: [head, stem, foot] };
  }
  const ang = st.angular;
  const top = quad(34, XH + 16, 20, XH - 4, 12, XH + 28, 8, 1);
  const bot = quad(14, XH + 36, 18, BASE + 6, 36, BASE - 8, 8, 1);
  const brokenTop = line(32, XH + 8, 12, XH + 8, 4, 1).concat(line(12, XH + 8, 18, XH + 36, 4, 1).slice(1));
  const brokenBot = line(18, XH + 36, 36, XH + 40, 3, 1).concat(line(36, XH + 40, 14, BASE - 2, 4, 1).slice(1));
  return { w: 42, strokes: [env(blend(top, brokenTop, ang)), env(blend(bot, brokenBot, ang))] };
}

function gT(st: Style): Glyph {
  const stem = minim(18, XH - 16, BASE, st.feet * 0.7);
  const barY = XH - 4;
  const bar = env(line(6, barY, 32, barY - st.angular * 2, 4, 0.8));
  return { w: 40, strokes: [stem, bar] };
}

function gU(st: Style): Glyph {
  if (st.angular < 0.45) {
    const down = line(10, XH + 2, 12, BASE - 6, 6, 1);
    const bottom = quad(12, BASE - 6, 24, BASE + 8, 36, BASE - 8, 6, 0.85);
    const up = line(36, BASE - 8, 36, XH + 4, 6, 1);
    return { w: 48, strokes: [env([...down, ...bottom.slice(1), ...up.slice(1)])] };
  }
  return {
    w: 48,
    strokes: [
      minim(10, XH + 2, BASE, st.feet),
      minim(34, XH + 2, BASE, st.feet),
      env(line(12, BASE - 1, 32, BASE - 1, 3, 0.45)),
    ],
  };
}

function gV(st: Style): Glyph {
  return {
    w: 42,
    strokes: [
      env(line(8, XH + 2, 20, BASE, 6, 1)),
      env(line(34, XH + 2, 20, BASE, 6, 1)),
    ],
  };
}

function gW(st: Style): Glyph {
  return {
    w: 64,
    strokes: [
      env(line(6, XH + 2, 16, BASE, 5, 1)),
      env(line(28, XH + 4, 16, BASE, 5, 1)),
      env(line(28, XH + 4, 40, BASE, 5, 1)),
      env(line(56, XH + 2, 40, BASE, 5, 1)),
    ],
  };
}

function gX(st: Style): Glyph {
  return {
    w: 42,
    strokes: [
      env(line(8, XH + 2, 34, BASE, 6, 1)),
      env(line(32, XH + 2, 8, BASE, 6, 1)),
    ],
  };
}

function gY(st: Style): Glyph {
  return {
    w: 42,
    strokes: [
      env(line(8, XH + 2, 18, XH + 34, 4, 1)),
      env([
        ...line(34, XH + 2, 18, XH + 34, 4, 1),
        ...quad(18, XH + 34, 16, DESC, 8, DESC - 2, 5, 0.9).slice(1),
      ]),
    ],
  };
}

function gZ(st: Style): Glyph {
  return {
    w: 40,
    strokes: [
      env(line(8, XH + 4, 34, XH + 4, 4, 0.9)),
      env(line(34, XH + 4, 10, BASE - 2, 6, 1)),
      env(line(10, BASE - 2, 36, BASE - 2, 4, 0.9)),
    ],
  };
}

function gLongNot(): Glyph {
  return gS({ angular: 0.2, feet: 0, loops: 0, aForm: 0.5, uncialD: 0.5, lombard: false }, true);
}

function specialEt(): Glyph {
  const stem = env(line(22, XH - 2, 16, BASE, 8, 1));
  const arm = env(quad(22, XH, 8, XH - 14, 6, XH + 8, 5, 0.9));
  const bar = env(line(8, XH + 16, 30, XH + 12, 3, 0.7));
  return { w: 36, strokes: [arm, stem, bar] };
}

function specialUs(): Glyph {
  const loop = oval(14, XH - 2, 7, 8, 0.25);
  const tail = env(line(18, XH + 4, 10, XH + 22, 4, 0.9));
  return { w: 24, strokes: [loop, tail] };
}

function specialCon(): Glyph {
  const body = bow(30, XH + 6, BASE - 6, 16, 0.35, -1);
  const tail = env(line(18, XH + 28, 10, XH + 8, 3, 0.8));
  return { w: 34, strokes: [body, tail] };
}

function specialUr(): Glyph {
  const top = env(quad(6, XH + 6, 16, XH - 10, 24, XH + 8, 5, 0.85));
  const base = env(line(8, XH + 18, 26, XH + 16, 3, 0.7));
  return { w: 30, strokes: [top, base] };
}

function punct(ch: string): Glyph | null {
  if (ch === "." || ch === "·") return { w: 14, strokes: [dot(6, BASE - 2)] };
  if (ch === ",") return { w: 14, strokes: [env(quad(6, BASE - 4, 8, BASE + 10, 2, BASE + 14, 4, 0.8))] };
  if (ch === ":" ) return { w: 14, strokes: [dot(6, XH + 24), dot(6, BASE - 4)] };
  if (ch === ";")
    return { w: 14, strokes: [dot(6, XH + 22), env(quad(6, BASE - 6, 8, BASE + 8, 2, BASE + 12, 4, 0.8))] };
  if (ch === "—") return { w: 36, strokes: [env(line(4, XH + 30, 30, XH + 30, 3, 0.7))] };
  if (ch === "-" || ch === "–") return { w: 22, strokes: [env(line(3, XH + 30, 16, XH + 30, 2, 0.7))] };
  if (ch === "?" )
    return {
      w: 28,
      strokes: [env(quad(8, XH + 18, 22, XH - 6, 18, XH + 36, 7, 0.9)), dot(16, BASE - 4)],
    };
  if (ch === "!") return { w: 16, strokes: [env(line(6, XH, 6, BASE - 12, 5, 1)), dot(6, BASE - 2)] };
  if (ch === "(") return { w: 16, strokes: [bow(12, XH - 6, BASE + 4, 8, 0.2, -1)] };
  if (ch === ")") return { w: 16, strokes: [bow(4, XH - 6, BASE + 4, 8, 0.2, 1)] };
  return null;
}

function digit(d: string, st: Style): Glyph | null {
  const n = "0123456789".indexOf(d);
  if (n < 0) return null;
  const s = minim(14, XH, BASE, st.feet * 0.4);
  if (d === "1" || d === "i") return { w: 22, strokes: [s, acute(10, XH - 4)] };
  if (d === "0") return gO(st);
  const map: Record<string, () => Glyph> = {
    "2": () => ({
      w: 36,
      strokes: [
        env(quad(8, XH + 16, 28, XH - 8, 30, XH + 28, 6, 1)),
        env(line(28, XH + 28, 8, BASE, 4, 1)),
        env(line(8, BASE, 32, BASE, 3, 0.9)),
      ],
    }),
    "3": () => ({
      w: 34,
      strokes: [
        env(quad(8, XH + 8, 32, XH + 4, 16, XH + 30, 6, 1)),
        env(quad(16, XH + 30, 34, XH + 34, 10, BASE, 6, 1)),
      ],
    }),
    "4": () => ({
      w: 36,
      strokes: [env(line(22, XH, 8, XH + 34, 5, 1)), env(line(8, XH + 34, 32, XH + 32, 3, 0.8)), env(line(24, XH + 8, 24, BASE, 5, 1))],
    }),
    "5": () => ({
      w: 34,
      strokes: [
        env(line(28, XH + 4, 10, XH + 6, 3, 0.9)),
        env(line(12, XH + 6, 12, XH + 30, 4, 1)),
        env(quad(12, XH + 30, 34, XH + 28, 14, BASE, 6, 1)),
      ],
    }),
    "6": () => gC({ ...st, angular: st.angular * 0.5 }),
    "7": () => ({
      w: 32,
      strokes: [env(line(6, XH + 4, 28, XH + 4, 3, 0.85)), env(line(26, XH + 4, 12, BASE, 6, 1))],
    }),
    "8": () => gG(st),
    "9": () => specialCon(),
  };
  return (map[d] ?? (() => ({ w: 22, strokes: [s] })))();
}

function versal(ch: string, ang: number, lombard: boolean): Glyph {
  const a = lombard ? ang * 0.25 : ang;
  const st: Style = { angular: a, feet: lombard ? 0.15 : 0.35 + ang * 0.4, loops: 0, aForm: 0.5, uncialD: 0.8, lombard };
  const tall = (x: number) => minim(x, ASC - 6, BASE, st.feet);
  switch (ch) {
    case "A":
      return {
        w: 52,
        strokes: [env(line(6, BASE, 26, ASC - 4, 7, 1)), env(line(46, BASE, 26, ASC - 4, 7, 1)), env(line(14, XH + 16, 38, XH + 14, 3, 0.8))],
      };
    case "B":
      return { w: 48, strokes: [tall(10), bow(12, ASC + 4, XH + 28, 18, a, 1), bow(12, XH + 24, BASE, 20, a, 1)] };
    case "C":
      return { w: 46, strokes: [bow(40, ASC + 6, BASE - 2, 24, a, -1)] };
    case "D":
      return { w: 50, strokes: [tall(10), bow(12, ASC + 6, BASE - 2, 26, a, 1)] };
    case "E":
      return {
        w: 44,
        strokes: [tall(10), env(line(12, ASC + 4, 36, ASC + 6, 3, 0.85)), env(line(12, XH + 10, 30, XH + 10, 3, 0.8)), env(line(12, BASE - 2, 36, BASE - 4, 3, 0.85))],
      };
    case "F":
      return { w: 42, strokes: [tall(10), env(line(12, ASC + 4, 36, ASC + 6, 3, 0.85)), env(line(12, XH + 8, 32, XH + 8, 3, 0.8))] };
    case "G":
      return {
        w: 48,
        strokes: [bow(40, ASC + 6, BASE - 2, 24, a, -1), env(line(28, XH + 20, 42, XH + 20, 3, 0.8)), env(line(36, XH + 12, 36, BASE - 8, 4, 0.9))],
      };
    case "H":
      return { w: 52, strokes: [tall(10), tall(38), env(line(12, XH + 8, 36, XH + 8, 4, 0.85))] };
    case "I":
      return { w: 22, strokes: [tall(10)] };
    case "J":
      return { w: 28, strokes: [env([...line(14, ASC, 14, BASE, 8, 1), ...quad(14, BASE, 16, DESC, 4, DESC - 4, 4, 0.9).slice(1)])] };
    case "K":
      return { w: 50, strokes: [tall(10), env(line(14, XH + 10, 40, ASC + 8, 5, 1)), env(line(18, XH + 16, 42, BASE, 5, 1))] };
    case "L":
      return { w: 42, strokes: [tall(10), env(line(12, BASE - 1, 36, BASE - 2, 3, 0.85))] };
    case "M":
      return {
        w: 64,
        strokes: [tall(8), env(quad(10, ASC + 8, 22, ASC - 8, 32, BASE, 8, 1)), env(quad(32, XH, 42, ASC - 4, 54, BASE, 8, 1))],
      };
    case "N":
      return { w: 52, strokes: [tall(8), tall(38), env(line(12, ASC + 10, 36, BASE - 2, 6, 1))] };
    case "O":
      return { w: 52, strokes: [oval(26, (ASC + BASE) / 2, 20, 46, a)] };
    case "P":
      return { w: 46, strokes: [tall(10), bow(12, ASC + 4, XH + 36, 20, a, 1)] };
    case "Q":
      return { w: 52, strokes: [oval(24, (ASC + BASE) / 2, 18, 42, a), env(line(30, XH + 30, 46, BASE + 8, 4, 0.9))] };
    case "R":
      return { w: 50, strokes: [tall(10), bow(12, ASC + 4, XH + 30, 18, a, 1), env(line(24, XH + 24, 44, BASE, 5, 1))] };
    case "S":
      return {
        w: 42,
        strokes: [
          env(blend(quad(34, ASC + 24, 16, ASC - 2, 10, XH + 10, 8, 1), line(32, ASC + 8, 10, XH + 16, 5, 1), a)),
          env(blend(quad(12, XH + 16, 18, BASE + 8, 36, BASE - 10, 8, 1), line(12, XH + 20, 34, BASE - 4, 5, 1), a)),
        ],
      };
    case "T":
      return { w: 46, strokes: [env(line(4, ASC + 2, 42, ASC + 2, 4, 0.9)), tall(22)] };
    case "U":
      return { w: 48, strokes: [env([...line(10, ASC + 4, 12, BASE - 16, 6, 1), ...quad(12, BASE - 16, 24, BASE + 6, 38, ASC + 6, 7, 1).slice(1)])] };
    case "V":
      return { w: 48, strokes: [env(line(6, ASC + 2, 24, BASE, 7, 1)), env(line(42, ASC + 2, 24, BASE, 7, 1))] };
    case "W":
      return {
        w: 64,
        strokes: [env(line(4, ASC + 2, 14, BASE, 5, 1)), env(line(28, ASC + 6, 14, BASE, 5, 1)), env(line(28, ASC + 6, 40, BASE, 5, 1)), env(line(58, ASC + 2, 40, BASE, 5, 1))],
      };
    case "X":
      return { w: 46, strokes: [env(line(6, ASC + 2, 40, BASE, 6, 1)), env(line(38, ASC + 2, 8, BASE, 6, 1))] };
    case "Y":
      return { w: 46, strokes: [env(line(6, ASC + 2, 22, XH + 10, 5, 1)), env([...line(40, ASC + 2, 22, XH + 10, 5, 1), ...line(22, XH + 10, 16, BASE, 5, 1).slice(1)])] };
    case "Z":
      return { w: 44, strokes: [env(line(6, ASC + 4, 38, ASC + 4, 3, 0.9)), env(line(36, ASC + 4, 8, BASE, 6, 1)), env(line(8, BASE, 40, BASE - 1, 3, 0.9))] };
    default:
      return { w: 36, strokes: [tall(12)] };
  }
}

const BASE_MARK: Record<string, { base: string; mark: "acute" | "tilde" | "ogonek" | "dot" | "stroke" }> = {
  ą: { base: "a", mark: "ogonek" },
  ę: { base: "e", mark: "ogonek" },
  ó: { base: "o", mark: "acute" },
  Ó: { base: "O", mark: "acute" },
  ł: { base: "l", mark: "stroke" },
  Ł: { base: "L", mark: "stroke" },
  ś: { base: "s", mark: "acute" },
  Ś: { base: "S", mark: "acute" },
  ć: { base: "c", mark: "acute" },
  Ć: { base: "C", mark: "acute" },
  ń: { base: "n", mark: "acute" },
  Ń: { base: "N", mark: "acute" },
  ź: { base: "z", mark: "acute" },
  Ź: { base: "Z", mark: "acute" },
  ż: { base: "z", mark: "dot" },
  Ż: { base: "Z", mark: "dot" },
  ã: { base: "a", mark: "tilde" },
  ẽ: { base: "e", mark: "tilde" },
  Ã: { base: "A", mark: "tilde" },
  Ẽ: { base: "E", mark: "tilde" },
};

export type Special = "et" | "us" | "con" | "ur";

export function makeGlyph(
  ch: string,
  style: Style,
  opts?: { longS?: boolean; rotunda?: boolean; mark?: Mark; special?: Special },
): Glyph {
  if (opts?.special === "et") return specialEt();
  if (opts?.special === "us") return specialUs();
  if (opts?.special === "con") return specialCon();
  if (opts?.special === "ur") return specialUr();

  const decorated = BASE_MARK[ch];
  const raw = decorated ? decorated.base : ch;
  const punctG = punct(raw);
  if (punctG) return punctG;
  const dig = digit(raw, style);
  if (dig && /\d/.test(raw)) return dig;

  const upper = raw.toUpperCase() === raw && raw.toLowerCase() !== raw;
  let glyph: Glyph;
  if (upper) glyph = versal(raw.toUpperCase(), style.angular, style.lombard);
  else {
    const c = raw.toLowerCase();
    const st = style;
    if (c === "a") glyph = gA(st);
    else if (c === "b") glyph = gB(st);
    else if (c === "c") glyph = gC(st);
    else if (c === "d") glyph = gD(st);
    else if (c === "e") glyph = gE(st);
    else if (c === "f") glyph = gF(st);
    else if (c === "g") glyph = gG(st);
    else if (c === "h") glyph = gH(st);
    else if (c === "i") glyph = gI(st);
    else if (c === "j") glyph = gJ(st);
    else if (c === "k") glyph = gK(st);
    else if (c === "l") glyph = gL(st);
    else if (c === "m") glyph = gM(st);
    else if (c === "n") glyph = gN(st);
    else if (c === "o") glyph = gO(st);
    else if (c === "p") glyph = gP(st, opts?.mark === "per" || opts?.mark === "pro" ? opts.mark : undefined);
    else if (c === "q") glyph = gQ(st, opts?.mark === "que" ? "que" : undefined);
    else if (c === "r") glyph = gR(st, Boolean(opts?.rotunda));
    else if (c === "s" || c === "ſ") glyph = gS(st, c === "ſ" || Boolean(opts?.longS));
    else if (c === "t") glyph = gT(st);
    else if (c === "u") glyph = gU(st);
    else if (c === "v") glyph = gV(st);
    else if (c === "w") glyph = gW(st);
    else if (c === "x") glyph = gX(st);
    else if (c === "y") glyph = gY(st);
    else if (c === "z") glyph = gZ(st);
    else glyph = { w: 22, strokes: [minim(10, XH, BASE, st.feet)] };
  }

  if (!decorated) return glyph.strokes.length ? glyph : empty();
  const x = glyph.w * 0.35;
  const extra =
    decorated.mark === "acute"
      ? acute(x, upper ? ASC - 2 : XH - 16)
      : decorated.mark === "tilde"
        ? tilde(x, upper ? ASC - 4 : XH - 16)
        : decorated.mark === "dot"
          ? dot(x + 4, upper ? ASC : XH - 14)
          : decorated.mark === "ogonek"
            ? ogonek(x + 4)
            : barL(upper ? 12 : 14);
  return { w: glyph.w, strokes: [...glyph.strokes, extra] };
}

export { gLongNot };
