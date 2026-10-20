import { makeGlyph, type Glyph, type PenPt, type Style, XH } from "./glyphs";
import type { Hand } from "./hands";
import { prepareWords, type AbbrUse, type Note, type Word } from "./shape";
import type { Culture, Genre, Lang } from "./hands";

export type PagePt = { x: number; y: number; p: number; nib: number };

export type Draw = {
  pts: PagePt[];
  ink: "gall" | "rubric";
  letter: string;
  word: number;
};

export type Frame = {
  x: number;
  y: number;
  p: number;
  nib: number;
  down: boolean;
  draw: number;
  letter: string;
  /** Indeks wyrazu w Page.words - pozwala podświetlić w transkrypcji, co pióro właśnie pisze. */
  word: number;
};

/** Wyraz tak, jak stoi na karcie (ze skrótami), obok tego, co rozwija. */
export type WrittenWord = { shown: string; source: string; abbr: boolean };

export type Page = {
  w: number;
  h: number;
  rules: number[];
  draws: Draw[];
  frames: Frame[];
  notes: Note[];
  abbrs: AbbrUse[];
  transformed: string;
  logo: string;
  weight: number;
  nib: number;
  clipped: boolean;
  words: WrittenWord[];
};

const SCALE = 0.7;
const PAGE_W = 860;
const MARGIN_L = 64;
const MARGIN_R = 56;
const MARGIN_T = 78;
const LINE = 104;
const MAX_LINES = 12;

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unit(n: number): number {
  let x = n || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 10000) / 10000;
}

function jitter(seed: number): number {
  return unit(seed) * 2 - 1;
}

const MARK_SHOWN: Record<string, string> = { per: "ꝑ", pro: "ꝓ", que: "ꝗ", rum: "ꝵ" };
const SPECIAL_SHOWN: Record<string, string> = { et: "⁊", con: "ꝯ", us: "ꝰ", ur: "ᷣ" };

/** Zapis wyrazu z jego kawałków - dokładnie to, co pióro kładzie na kartę. */
function shownOf(pieces: Word["pieces"]): string {
  // Ciąg liter pod titulusem dostaje na karcie jedną kreskę, więc i w zapisie jeden znak
  // łączący - nad środkową literą ciągu ("xp̄i"), a nie nad każdą ("x̄p̄ī").
  const marked = new Set<number>();
  for (let i = 0; i < pieces.length; ) {
    if (!pieces[i].titulus) {
      i++;
      continue;
    }
    let j = i;
    while (j < pieces.length && pieces[j].titulus) j++;
    marked.add(i + Math.floor((j - i - 1) / 2));
    i = j;
  }
  return pieces
    .map((p, i) => {
      if (p.special) return SPECIAL_SHOWN[p.special] ?? "?";
      if (p.mark) return MARK_SHOWN[p.mark] ?? p.ch;
      const ch = p.rotunda ? "ꝛ" : p.longS && p.ch === "s" ? "ſ" : p.ch;
      return marked.has(i) ? `${ch}\u0304` : ch;
    })
    .join("");
}

const ROUND_BEFORE = new Set(["o", "b", "p", "d", "O", "B", "P", "D", "g"]);

function styleOf(hand: Hand, lombard: boolean): Style {
  return {
    angular: lombard ? hand.angular * 0.22 : hand.angular,
    feet: lombard ? 0.12 : hand.feet,
    loops: lombard ? 0 : hand.loops,
    aForm: hand.aForm,
    uncialD: hand.uncialD,
    lombard,
  };
}

function glyphForWord(word: Word, hand: Hand, wi: number): { glyphs: Glyph[]; flags: Word["pieces"] } {
  const flags = word.pieces.map((p, i) => ({ ...p }));
  let prev = "";
  const glyphs = flags.map((p, i) => {
    const letter = p.special ? "" : p.ch;
    const end = flags.slice(i + 1).every((q) => !q.ch || !/\p{L}/u.test(q.ch));
    const longS =
      p.longS ||
      (!p.special &&
        (letter === "ſ" ||
          (letter === "s" && !end && hand.longS > 0.2 && unit(hash32(`${wi}:${i}:s`)) < hand.longS)));
    const rotunda =
      p.rotunda ||
      (!p.special &&
        letter.toLowerCase() === "r" &&
        ROUND_BEFORE.has(prev) &&
        hand.rRotunda > 0.45 &&
        p.mark !== "rum");
    p.longS = longS;
    p.rotunda = rotunda;
    const g = makeGlyph(letter || " ", styleOf(hand, p.rubric), {
      longS,
      rotunda,
      mark: p.mark,
      special: p.special,
    });
    if (letter && /\p{L}/u.test(letter)) prev = letter;
    return g;
  });
  return { glyphs, flags };
}

function mapStroke(
  pts: PenPt[],
  ox: number,
  baseline: number,
  kx: number,
  ky: number,
  shear: number,
  nib: number,
  twist: number,
  amp: number,
  seed: number,
): PagePt[] {
  return pts.map((p, i) => {
    const yLift = (100 - p.y) * ky;
    const x = ox + p.x * kx + yLift * shear + jitter(seed + i * 17) * amp;
    const y = baseline - yLift + jitter(seed + 3 + i * 29) * amp * 0.65;
    return {
      x,
      y,
      p: Math.min(1, Math.max(0.06, p.p * (1 - Math.abs(jitter(seed + 9 + i)) * amp * 0.05))),
      nib: nib + (p.nibT - 0.5) * twist + jitter(seed + 11) * 0.4,
    };
  });
}

function logoNum(n: number): string {
  return n.toFixed(1);
}

export function ribbon(pts: PagePt[], weight: number): string {
  const clean: PagePt[] = [];
  for (const p of pts) {
    const prev = clean[clean.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 0.35) continue;
    clean.push(p);
  }
  if (!clean.length) return "";
  const ends = (p: PagePt) => {
    // Kąt stalówki jak w kaligrafii: dodatni = krawędź wznosi się w prawo (praworęczny skryba),
    // więc przy y w dół kąt na ekranie to -nib. Wcześniej był +nib i wszystkie ręce pisały
    // lustrzanym piórem: przy 30° kreska \ wychodziła włoskowa, a / gruba - odwrotnie niż
    // na rękopisach (sprawdzone na Polonie, NT łac. [Niemcy, ca 701-800], k. 1r i 4r).
    const a = (-p.nib * Math.PI) / 180;
    const half = (weight * Math.max(0.08, p.p)) / 2;
    const dx = Math.cos(a) * half;
    const dy = Math.sin(a) * half;
    return [
      { x: p.x - dx, y: p.y - dy },
      { x: p.x + dx, y: p.y + dy },
    ];
  };
  if (clean.length === 1) {
    const [a, b] = ends(clean[0]);
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  }
  const left = clean.map((p) => ends(p)[0]);
  const right = clean.map((p) => ends(p)[1]);
  const segs = [`M ${left[0].x.toFixed(2)} ${left[0].y.toFixed(2)}`];
  for (const p of left.slice(1)) segs.push(`L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
  for (const p of right.reverse()) segs.push(`L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
  segs.push("Z");
  return segs.join(" ");
}

export function compose(opts: {
  text: string;
  hand: Hand;
  year: number;
  lang: Lang;
  genre: Genre;
  culture: Culture;
  ortho: boolean;
  abbreviate: boolean;
  rubric: boolean;
  study: string | null;
  density?: number;
}): Page {
  const studyChar = opts.study === "ꝛ" ? "r" : opts.study;
  const prepared = studyChar
    ? {
        words: [
          {
            pieces: [
              {
                ch: studyChar,
                titulus: false,
                group: 0,
                rubric: false,
                longS: studyChar === "ſ",
                rotunda: opts.study === "ꝛ",
              },
            ],
            gapAfter: 1,
            breakAfter: false,
            text: opts.study ?? "",
          },
        ] as Word[],
        notes: [] as Note[],
        transformed: opts.study ?? "",
      }
    : prepareWords(opts);

  const hand = opts.hand;
  const kx0 = SCALE * (1 - hand.compress * 0.3);
  const ky0 = SCALE;
  const draws: Draw[] = [];
  const frames: Frame[] = [];
  const abbrs: AbbrUse[] = [];
  const written: WrittenWord[] = [];
  let cursor = MARGIN_L;
  let line = 0;
  let baseline = MARGIN_T + 86;
  const rules = [baseline];
  let clipped = false;
  let last: PagePt | null = null;
  const logo: string[] = [
    `; Calamus — ${hand.name}`,
    `; ${hand.latin}, rok ${opts.year}, ${opts.genre}, krąg: ${opts.culture}`,
    `; PU pióro w górze, PD pióro w dole, NIB kąt stalówki, MV x y nacisk`,
  ];
  let weight = 0;

  const newLine = () => {
    line += 1;
    cursor = MARGIN_L;
    baseline = MARGIN_T + 86 + line * LINE;
    rules.push(baseline);
  };

  const placeGlyph = (g: Glyph, piece: Word["pieces"][number], wi: number, letter: string, huge: boolean) => {
    const lombard = piece.rubric;
    const scale = huge ? 2.15 : lombard ? 1.38 : 1;
    const kx = kx0 * scale;
    const ky = ky0 * scale;
    const shear = Math.tan(((hand.slant + jitter(hash32(`sl${wi}${letter}`)) * hand.nibJitter * 0.15) * Math.PI) / 180);
    const nib = hand.nib + jitter(hash32(`nb${wi}${cursor}`)) * hand.nibJitter;
    const amp = huge ? hand.tremor * 0.4 : hand.tremor;
    const wander = huge ? 0 : Math.sin(wi * 1.3 + line) * hand.wander;
    const baseY = baseline + wander + (lombard ? 2 : 0);
    weight = (100 - XH) * ky * hand.weight * (lombard ? 1.15 : 1);
    const seed = hash32(`${hand.id}:${wi}:${letter}:${cursor | 0}`);
    let nibNow = nib;
    logo.push(`; ${letter || piece.special || "znak"}`);
    // WEIGHT i INK przy każdej literze: inicjał rubryką ma szerszą stalówkę i inny atrament,
    // a pojedyncze WEIGHT na górze programu dawało w eksporcie .py inicjały zbyt cienkie.
    logo.push(`WEIGHT ${weight.toFixed(2)}`);
    logo.push(`INK ${lombard ? "rubric" : "gall"}`);
    logo.push(`NIB ${nib.toFixed(1)}`);

    g.strokes.forEach((stroke, si) => {
      if (!stroke.length) return;
      const mapped = mapStroke(stroke, cursor, baseY, kx, ky, shear, nib, hand.twist, amp, seed + si * 101);
      const start = mapped[0];
      if (last) {
        frames.push({ ...last, down: false, draw: -1, letter, word: wi });
        frames.push({ x: start.x, y: start.y, p: 0, nib: start.nib, down: false, draw: -1, letter, word: wi });
      }
      logo.push("PU");
      logo.push(`MV ${logoNum(start.x)} ${logoNum(start.y)} 0`);
      logo.push("PD");
      const step = Math.max(1, Math.floor(mapped.length / 6));
      mapped.forEach((p, idx) => {
        if (idx % step === 0 || idx === mapped.length - 1) {
          logo.push(`NIB ${p.nib.toFixed(1)}`);
          logo.push(`MV ${logoNum(p.x)} ${logoNum(p.y)} ${p.p.toFixed(2)}`);
        }
        frames.push({ x: p.x, y: p.y, p: p.p, nib: p.nib, down: true, draw: draws.length, letter, word: wi });
      });
      logo.push("PU");
      draws.push({
        pts: mapped,
        ink: lombard ? "rubric" : "gall",
        letter,
        word: wi,
      });
      last = mapped[mapped.length - 1];
      nibNow = mapped[mapped.length - 1]?.nib ?? nibNow;
    });

    if (piece.titulus && piece.group) {
      /* titulus jest kładziony po wyrazie */
    }
    return g.w * kx + (huge ? 0 : 2.4 + (1 - hand.compress) * 2.2);
  };

  if (opts.study && studyChar) {
    const word = prepared.words[0];
    const built = glyphForWord(word, hand, 0);
    const g = built.glyphs[0];
    const width = g.w * kx0 * 2.15;
    cursor = (PAGE_W - width) / 2;
    baseline = MARGIN_T + 210;
    rules.splice(0, rules.length, baseline);
    placeGlyph(g, { ...built.flags[0], rotunda: opts.study === "ꝛ", longS: studyChar === "ſ" || built.flags[0].longS }, 0, opts.study ?? studyChar, true);
    // stroke numbers added by UI from draw order
  } else {
    prepared.words.forEach((word, wi) => {
      if (line >= MAX_LINES) {
        clipped = true;
        return;
      }
      const built = glyphForWord(word, hand, wi);
      const measure = built.glyphs.reduce((sum, g, i) => {
        const sc = built.flags[i].rubric ? 1.38 : 1;
        return sum + g.w * kx0 * sc + 3;
      }, 0);
      const gap = (hand.continua > 0.65 ? 7 : 15) * hand.wordGap;
      if (cursor > MARGIN_L && cursor + measure > PAGE_W - MARGIN_R) newLine();
      if (line >= MAX_LINES) {
        clipped = true;
        return;
      }
      const wordStart = cursor;
      const tops: { x0: number; x1: number; y: number; ink: "gall" | "rubric" }[] = [];
      let groupOpen: { x0: number; ink: "gall" | "rubric" } | null = null;
      built.glyphs.forEach((g, i) => {
        const piece = built.flags[i];
        const prevCh = i > 0 ? built.flags[i - 1].ch.toLowerCase() : "";
        const ch = piece.ch.toLowerCase();
        if (hand.biting > 0.45 && prevCh && "obpdg".includes(prevCh) && "oecd".includes(ch)) {
          cursor -= 9 * hand.biting;
        }
        const before = cursor;
        const adv = placeGlyph(g, piece, wi, piece.special ?? piece.ch, false);
        cursor += Math.max(8, adv);
        if (piece.titulus && !groupOpen) groupOpen = { x0: before + 2, ink: piece.rubric ? "rubric" : "gall" };
        if (groupOpen && (!piece.titulus || i === built.glyphs.length - 1)) {
          const x1 = piece.titulus ? cursor - 4 : before;
          if (x1 - groupOpen.x0 > 6) tops.push({ x0: groupOpen.x0, x1, y: baseline - (100 - XH) * ky0 - 8, ink: groupOpen.ink });
          groupOpen = piece.titulus ? { x0: before + 2, ink: piece.rubric ? "rubric" : "gall" } : null;
        }
      });
      for (const span of tops) {
        const y = span.y + Math.sin(wi) * hand.wander * 0.2;
        const pts: PagePt[] = [0, 1, 2, 3, 4].map((k) => ({
          x: span.x0 + ((span.x1 - span.x0) * k) / 4,
          y: y - Math.sin((k / 4) * Math.PI) * 1.4,
          p: 0.42,
          nib: hand.nib * 0.4,
        }));
        const start = pts[0];
        if (last) frames.push({ ...last, down: false, draw: -1, letter: "¯", word: wi });
        frames.push({ x: start.x, y: start.y, p: 0, nib: start.nib, down: false, draw: -1, letter: "¯", word: wi });
        logo.push("; titulus");
        // titulus kładzie się płaskim kątem; bez NIB eksport .py brał kąt ostatniej litery
        logo.push(`INK ${span.ink}`);
        logo.push(`NIB ${start.nib.toFixed(1)}`);
        logo.push("PU");
        logo.push(`MV ${logoNum(start.x)} ${logoNum(start.y)} 0`);
        logo.push("PD");
        for (const p of pts) {
          logo.push(`MV ${logoNum(p.x)} ${logoNum(p.y)} ${p.p.toFixed(2)}`);
          frames.push({ x: p.x, y: p.y, p: p.p, nib: p.nib, down: true, draw: draws.length, letter: "¯", word: wi });
        }
        logo.push("PU");
        draws.push({ pts, ink: span.ink, letter: "¯", word: wi });
        last = pts[pts.length - 1];
      }
      if (word.abbr) abbrs.push(word.abbr);
      written[wi] = { shown: shownOf(built.flags), source: word.text, abbr: Boolean(word.abbr) };
      cursor = Math.max(cursor, wordStart) + gap * word.gapAfter;
      if (word.breakAfter) newLine();
    });
  }

  const h = Math.max(MARGIN_T + 86 + Math.max(line, opts.study ? 2 : 3) * LINE + 70, opts.study ? 460 : 520);
  if (!weight) weight = (100 - XH) * SCALE * hand.weight;
  logo.splice(3, 0, `WEIGHT ${weight.toFixed(2)}`);

  return {
    w: PAGE_W,
    h,
    rules,
    draws,
    frames,
    notes: prepared.notes,
    abbrs,
    transformed: prepared.transformed,
    logo: logo.join("\n"),
    weight,
    nib: hand.nib,
    clipped,
    // wyrazy ucięte po MAX_LINES nie mają wpisu w written - pokazujemy je pełne
    words: prepared.words.map((w, i) => written[i] ?? { shown: w.text, source: w.text, abbr: false }),
  };
}
