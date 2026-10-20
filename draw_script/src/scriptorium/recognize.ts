import { makeGlyph, type Style } from "./glyphs";
import { HANDS, type Hand } from "./hands";

export type Stroke = { x: number; y: number }[];

const ALPHA = [
  ..."abcdefghijklmnopqrstuvwxyz",
  "ſ",
  "ą",
  "ę",
  "ł",
  "ꝛ",
];

function styleOf(hand: Hand): Style {
  return {
    angular: hand.angular,
    feet: hand.feet,
    loops: hand.loops,
    aForm: hand.aForm,
    uncialD: hand.uncialD,
    lombard: false,
  };
}

function resample(pts: Stroke, n: number): Stroke {
  if (!pts.length) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const lens = [0];
  for (let i = 1; i < pts.length; i++) {
    lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = lens[lens.length - 1] || 1;
  const out: Stroke = [];
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;
    let i = 1;
    while (i < lens.length - 1 && lens[i] < target) i++;
    const span = lens[i] - lens[i - 1] || 1;
    const u = (target - lens[i - 1]) / span;
    const a = pts[i - 1];
    const b = pts[i];
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  return out;
}

export function normalize(strokes: Stroke[]): Stroke[] {
  const all = strokes.flat();
  if (!all.length) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of all) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const s = Math.max(maxX - minX, maxY - minY) || 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return strokes.map((st) => resample(st.map((p) => ({ x: (p.x - cx) / s, y: (p.y - cy) / s })), 22));
}

function chamfer(a: Stroke[], b: Stroke[]): number {
  const A = a.flat();
  const B = b.flat();
  if (!A.length || !B.length) return 9;
  const dir = (from: Stroke, to: Stroke) => {
    let sum = 0;
    for (const p of from) {
      let m = Infinity;
      for (const q of to) {
        const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
        if (d < m) m = d;
      }
      sum += Math.sqrt(m);
    }
    return sum / from.length;
  };
  return (dir(A, B) + dir(B, A)) / 2 + Math.abs(a.length - b.length) * 0.12;
}

function modelStrokes(ch: string, hand: Hand): Stroke[] {
  const rotunda = ch === "ꝛ";
  const longS = ch === "ſ";
  const g = makeGlyph(rotunda ? "r" : ch, styleOf(hand), { rotunda, longS: longS || (ch === "s" && hand.longS > 0.85) });
  return g.strokes.map((s) => s.map((p) => ({ x: p.x, y: p.y })));
}

export type LetterHit = { ch: string; hand: string; handId: string; score: number };

export function matchLetters(drawn: Stroke[], hand: Hand, hands: Hand[] = [hand]): LetterHit[] {
  const D = normalize(drawn.filter((s) => s.length > 1));
  if (!D.length) return [];
  const hits: LetterHit[] = [];
  for (const h of hands) {
    for (const ch of ALPHA) {
      const M = normalize(modelStrokes(ch, h));
      hits.push({ ch, hand: h.name, handId: h.id, score: chamfer(D, M) });
    }
  }
  hits.sort((a, b) => a.score - b.score);
  const seen = new Set<string>();
  const out: LetterHit[] = [];
  for (const hit of hits) {
    const key = hands.length > 1 ? `${hit.ch}:${hit.handId}` : hit.ch;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
    if (out.length >= (hands.length > 1 ? 6 : 5)) break;
  }
  return out;
}

export type Feat = {
  kanciastosc: number;
  pochyl: number;
  zwartosc: number;
  drzenie: number;
  petle: number;
};

function turniness(strokes: Stroke[]): number {
  let n = 0;
  let sum = 0;
  for (const s of strokes) {
    for (let i = 1; i < s.length - 1; i++) {
      const ax = s[i].x - s[i - 1].x;
      const ay = s[i].y - s[i - 1].y;
      const bx = s[i + 1].x - s[i].x;
      const by = s[i + 1].y - s[i].y;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la < 1e-3 || lb < 1e-3) continue;
      const dot = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (la * lb)));
      sum += Math.acos(dot);
      n++;
    }
  }
  return n ? Math.min(1, sum / n / 1.15) : 0;
}

function intersections(strokes: Stroke[]): number {
  const segs: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  for (const s of strokes) {
    const r = resample(s, Math.min(12, s.length));
    for (let i = 1; i < r.length; i++) segs.push({ a: r[i - 1], b: r[i] });
  }
  let hits = 0;
  const cross = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
    d: { x: number; y: number },
  ) => {
    const d1 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x);
    const d2 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x);
    const d3 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d4 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 2; j < segs.length; j++) {
      if (cross(segs[i].a, segs[i].b, segs[j].a, segs[j].b)) hits++;
    }
  }
  return hits;
}

export function featuresOf(strokes: Stroke[]): Feat {
  const all = strokes.flat();
  if (all.length < 3) return { kanciastosc: 0, pochyl: 0, zwartosc: 0, drzenie: 0, petle: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of all) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  let best = 0;
  let slant = 0;
  let jitter = 0;
  let jn = 0;
  for (const s of strokes) {
    if (s.length < 2) continue;
    const dx = s[s.length - 1].x - s[0].x;
    const dy = s[s.length - 1].y - s[0].y;
    const len = Math.hypot(dx, dy);
    if (len > best) {
      best = len;
      slant = Math.abs((Math.atan2(dx, dy) * 180) / Math.PI);
    }
    for (let i = 2; i < s.length; i++) {
      const l1 = Math.hypot(s[i - 1].x - s[i - 2].x, s[i - 1].y - s[i - 2].y);
      const l2 = Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
      jitter += Math.abs(l1 - l2);
      jn++;
    }
  }
  return {
    kanciastosc: turniness(strokes),
    pochyl: Math.min(1, slant / 28),
    zwartosc: Math.min(1, Math.max(0, (height / width - 0.6) / 1.4)),
    drzenie: Math.min(1, (jn ? jitter / jn : 0) / 6),
    petle: Math.min(1, intersections(strokes) / 4),
  };
}

export function handPrototype(hand: Hand): Feat {
  return {
    kanciastosc: hand.angular,
    pochyl: Math.min(1, Math.abs(hand.slant) / 18),
    zwartosc: hand.compress,
    drzenie: Math.min(1, hand.tremor / 1.8),
    petle: hand.loops,
  };
}

export function matchHands(drawn: Stroke[]): { hand: Hand; score: number }[] {
  const feat = featuresOf(drawn);
  const keys: (keyof Feat)[] = ["kanciastosc", "pochyl", "zwartosc", "drzenie", "petle"];
  return HANDS.map((hand) => {
    const proto = handPrototype(hand);
    const score = Math.sqrt(keys.reduce((s, k) => s + (feat[k] - proto[k]) ** 2, 0));
    return { hand, score };
  }).sort((a, b) => a.score - b.score);
}

export { ALPHA, HANDS };
