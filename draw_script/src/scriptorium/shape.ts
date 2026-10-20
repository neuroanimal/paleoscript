import { CULTURE_ABBR, GENRES, type Culture, type Genre, type Hand, type Lang } from "./hands";
import type { Mark, Special } from "./glyphs";

export type Note = { from: string; to: string; why: string };

export type AbbrUse = {
  shown: string;
  expansion: string;
  note: string;
  system: string;
};

export type Piece = {
  ch: string;
  titulus: boolean;
  group: number;
  mark?: Mark;
  special?: Special;
  rubric: boolean;
  longS: boolean;
  rotunda: boolean;
};

export type Word = {
  pieces: Piece[];
  gapAfter: number;
  breakAfter: boolean;
  abbr?: AbbrUse;
  text: string;
};

const LATIN_KEEP = new Set(
  [
    "in", "nomine", "domini", "amen", "dei", "deus", "gratia", "rex", "poloniae", "polonie",
    "notum", "facimus", "universis", "vniuersis", "uniuersis", "quod", "predictus", "dominus",
    "contra", "instrumentum", "non", "venit", "noverint", "universi", "per", "pro", "quodlibet",
    "item", "anno", "et", "est", "sunt", "pater", "noster", "qui", "es", "caelis", "celis",
    "sanctificetur", "nomen", "tuum", "adveniat", "adueniat", "regnum", "fiat", "voluntas", "tua",
    "spiritus", "sanctus", "christus", "iesus", "ihesus", "jesus", "ratum", "nos", "domine",
  ].map((w) => w.toLowerCase()),
);

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

export function roll(key: string): number {
  return unit(hash32(key));
}

function norm(word: string): string {
  let s = word.toLowerCase().replace(/j/g, "i").replace(/v/g, "u");
  s = s.replace(/ci([aeiou])/g, "ti$1");
  s = s.replace(/michi/g, "mihi").replace(/nichil/g, "nihil");
  s = s.replace(/ihesus/g, "iesus");
  return s;
}

function pushNote(notes: Note[], from: string, to: string, why: string) {
  if (!notes.some((n) => n.from === from && n.why === why)) notes.push({ from, to, why });
}

function matchCase(src: string, next: string): string {
  if (src[0] && src[0] === src[0].toUpperCase() && src[0] !== src[0].toLowerCase()) {
    return next[0].toUpperCase() + next.slice(1);
  }
  return next;
}

function latinSpell(word: string, year: number, notes: Note[]): string {
  let w = word;
  const lower = w.toLowerCase();
  if (/ae|oe|æ|œ/.test(lower)) {
    const next = w
      .replace(/æ/g, "e")
      .replace(/œ/g, "e")
      .replace(/Æ/g, "E")
      .replace(/Œ/g, "E")
      .replace(/ae/g, "e")
      .replace(/oe/g, "e")
      .replace(/Ae/g, "E")
      .replace(/Oe/g, "E")
      .replace(/AE/g, "E")
      .replace(/OE/g, "E");
    if (next !== w) {
      pushNote(notes, "ae / oe", "e", "Dyftongi ae i oe w łacinie średniowiecznej zapisuje się zwykle jednym e (caelis → celis).");
      w = next;
    }
  }
  if (year >= 1000) {
    const table: Record<string, string> = { mihi: "michi", nihil: "nichil", iesus: "ihesus", jesus: "ihesus" };
    const hit = table[w.toLowerCase()];
    if (hit) {
      pushNote(notes, w.toLowerCase(), hit, "Wstawne h: michi, nichil, Ihesus — zwyczaj średniowieczny, nie błąd kopisty.");
      w = matchCase(w, hit);
    }
  }
  if (year >= 1150 && /.[tT][iI][aeiouAEIOU]/.test(w)) {
    const next = w.replace(/([bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ])ti([aeiou])/g, "$1ci$2")
      .replace(/([bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ])Ti([aeiou])/g, "$1ci$2")
      .replace(/([BCDFGHJKLMNPQRSTVWXYZ])TI([AEIOU])/g, "$1CI$2");
    if (next !== w) {
      pushNote(notes, "ti + samogłoska", "ci", "Od około XII w. ti przed samogłoską przechodzi w ci: gratia → gracia, etiam → eciam.");
      w = next;
    }
  }
  if (year < 1080) {
    // Minuskuła wczesna zna jedną literę u dla u i v, a j nie istnieje wcale (convenirent →
    // conuenirent, ejus → eius). V pojawia się tylko jako wielka litera - patrz majusculeV().
    const next = w.replace(/v/g, "u").replace(/j/g, "i").replace(/J/g, "I");
    if (next !== w) {
      pushNote(notes, "v / j", "u / i", "Wczesna minuskuła pisze u zarówno za u, jak i za v, a zamiast j zawsze i. Wielka litera to V (majuskuła nie ma U).");
      w = next;
    }
  }
  if (year >= 1080) {
    const chars = [...w];
    let changed = false;
    const out = chars.map((ch, i) => {
      const low = ch.toLowerCase();
      if (low === "u" && i === 0) {
        changed = true;
        return ch === "U" ? "V" : "v";
      }
      if (low === "v" && i > 0) {
        changed = true;
        return ch === "V" ? "U" : "u";
      }
      if (low === "j") {
        changed = true;
        return ch === "J" ? "I" : "i";
      }
      return ch;
    });
    if (changed) {
      pushNote(notes, "u / v / j", "v- / -u- / i", "Jedna para liter: v na początku wyrazu, u w środku. J jeszcze nie istnieje — pisze się i.");
      w = out.join("");
    }
  }
  return w;
}

function polishSpell(word: string, year: number, notes: Note[]): string {
  let w = word;
  const swap = (re: RegExp, to: string, from: string, why: string) => {
    if (!re.test(w)) return;
    const next = w.replace(re, to);
    if (next !== w) {
      pushNote(notes, from, to, why);
      w = next;
    }
  };
  if (year < 1530) {
    swap(/ó/g, "o", "ó", "Kreskowane ó utrwala się późno. W średniowieczu pisano samo o.");
    swap(/Ó/g, "O", "Ó", "Kreskowane ó utrwala się późno. W średniowieczu pisano samo o.");
  }
  if (year < 1500) {
    swap(/ł/g, "l", "ł", "Przekreślone ł jest około XVI wieku. Wcześniej twarde l wygląda jak zwykłe l.");
    swap(/Ł/g, "L", "Ł", "Przekreślone ł jest około XVI wieku. Wcześniej twarde l wygląda jak zwykłe l.");
  }
  if (year < 1380) {
    swap(/ą/g, "an", "ą", "Nosowość zapisywano przez n lub m, nie ogonkiem.");
    swap(/ę/g, "en", "ę", "Nosówkę przednią pisano jako e + n.");
    swap(/Ą/g, "An", "Ą", "Nosowość zapisywano przez n lub m, nie ogonkiem.");
    swap(/Ę/g, "En", "Ę", "Nosówkę przednią pisano jako e + n.");
    swap(/ś/g, "s", "ś", "Miękkość bez kropek: ś, ć, ń, ź, ż spadają do s, c, n, z.");
    swap(/Ś/g, "S", "Ś", "Miękkość bez kropek: ś, ć, ń, ź, ż spadają do s, c, n, z.");
    swap(/ć/g, "c", "ć", "Miękkość bez kropek: ś, ć, ń, ź, ż spadają do s, c, n, z.");
    swap(/Ć/g, "C", "Ć", "Miękkość bez kropek: ś, ć, ń, ź, ż spadają do s, c, n, z.");
    swap(/ń/g, "n", "ń", "Miękkość bez kropek: ś, ć, ń, ź, ż spadają do s, c, n, z.");
    swap(/Ń/g, "N", "Ń", "Miękkość bez kropek: ś, ć, ń, ź, ż spadają do s, c, n, z.");
    swap(/ź/g, "z", "ź", "Miękkość bez kropek: ś, ć, ń, ź, ż spadają do s, c, n, z.");
    swap(/ż/g, "z", "ż", "ż i z długo nie mają osobnych liter.");
    swap(/Ź/g, "Z", "Ź", "Miękkość bez kropek: ś, ć, ń, ź, ż spadają do s, c, n, z.");
    swap(/Ż/g, "Z", "Ż", "ż i z długo nie mają osobnych liter.");
  } else if (year < 1520) {
    swap(/ą/g, "ã", "ą", "Zamiast dzisiejszego ogonka: a z tyldą nosową albo a + n.");
    swap(/ę/g, "ẽ", "ę", "Nosówka przednia jako e z tyldą, nie ogonek.");
    swap(/Ą/g, "Ã", "Ą", "Zamiast dzisiejszego ogonka: a z tyldą nosową albo a + n.");
    swap(/Ę/g, "Ẽ", "Ę", "Nosówka przednia jako e z tyldą, nie ogonek.");
    swap(/ś/g, "sz", "ś", "W XV w. ś często pisano sz. Parkosz chciał osobnych kształtów liter, praktyka była inna.");
    swap(/ć/g, "cz", "ć", "ć bywa cz. System diakrytyczny jest tu późniejszy niż ręka.");
    swap(/ź/g, "z", "ź", "ź i ż jeszcze często spadają do z.");
    swap(/ż/g, "z", "ż", "ź i ż jeszcze często spadają do z.");
    swap(/ń/g, "n", "ń", "ń zwykle bez znaku; miękkość wynika z sąsiedztwa.");
    swap(/Ś/g, "Sz", "Ś", "W XV w. ś często pisano sz.");
    swap(/Ć/g, "Cz", "Ć", "ć bywa cz.");
    swap(/Ź/g, "Z", "Ź", "ź jeszcze często spada do z.");
    swap(/Ż/g, "Z", "Ż", "ż jeszcze często spada do z.");
    swap(/Ń/g, "N", "Ń", "ń zwykle bez znaku.");
  }
  if (year < 1320) {
    swap(/cz/g, "c", "cz", "Wczesna polszczyzna często oddaje cz samym c.");
    swap(/Cz/g, "C", "Cz", "Wczesna polszczyzna często oddaje cz samym c.");
    swap(/sz/g, "ss", "sz", "sz bywa ss albo s.");
    swap(/Sz/g, "Ss", "Sz", "sz bywa ss albo s.");
    swap(/rz/g, "r", "rz", "rz długo pisane samym r.");
    swap(/Rz/g, "R", "Rz", "rz długo pisane samym r.");
  }
  return w;
}

function isPolishToken(token: string, lang: Lang): boolean {
  if (lang === "pl") return !LATIN_KEEP.has(token.toLowerCase().replace(/^[„"'(]+|[”"')]+$/g, ""));
  if (lang === "la") return false;
  if (/[ąćęłńóśźżãẽ]/i.test(token)) return true;
  return false;
}

export function applyOrtho(text: string, year: number, lang: Lang, on: boolean): { text: string; notes: Note[] } {
  if (!on) return { text, notes: [] };
  const notes: Note[] = [];
  const parts = text.split(/(\s+)/);
  const next = parts.map((part) => {
    if (!part || /^\s+$/.test(part)) return part;
    const m = part.match(/^([^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźżÆŒæœ]*)(.*?)([^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźżÆŒæœ]*)$/);
    if (!m) return part;
    const [, pre, core, post] = m;
    if (!core) return part;
    const spelled = isPolishToken(core, lang) ? polishSpell(core, year, notes) : latinSpell(core, year, notes);
    return `${pre}${spelled}${post}`;
  });
  return { text: next.join(""), notes };
}

type Form = {
  shown: string;
  expansion: string;
  note: string;
  system: string;
  pieces: Array<{ ch: string; titulus?: boolean; mark?: Mark; special?: Special }>;
};

function letters(s: string, titulus = false): Form["pieces"] {
  return [...s].map((ch) => ({ ch, titulus }));
}

const WORDS: Record<string, Form> = {
  dominus: {
    shown: "dñs",
    expansion: "dominus",
    note: "Nomen sacrum. Kontrakcja z titulusem, nie brakujące n w środku wyrazu „na oko”.",
    system: "nomina sacra",
    pieces: letters("dns", true),
  },
  domini: {
    shown: "dñi",
    expansion: "domini",
    note: "Dopełniacz od dominus, ten sam zwyczaj nomina sacra.",
    system: "nomina sacra",
    pieces: letters("dni", true),
  },
  deus: {
    shown: "d̃s",
    expansion: "deus",
    note: "Kontrakcja deus. Titulus zastępuje środek wyrazu.",
    system: "nomina sacra",
    pieces: letters("ds", true),
  },
  dei: {
    shown: "d̃i",
    expansion: "dei",
    note: "Nomina sacra, dopełniacz.",
    system: "nomina sacra",
    pieces: letters("di", true),
  },
  christus: {
    shown: "x̃p̃s",
    expansion: "christus",
    note: "xps to chi–rho–sigma. Łacińskie x i p stoją za greckimi literami, nie za „iks pe es”.",
    system: "nomina sacra",
    pieces: letters("xps", true),
  },
  iesus: {
    shown: "ĩhs",
    expansion: "Iesus / Ihesus",
    note: "ihs to iota–eta–sigma. W łacinie średniowiecznej bywa z h: Ihesus.",
    system: "nomina sacra",
    pieces: letters("ihs", true),
  },
  spiritus: {
    shown: "s̃ps",
    expansion: "spiritus",
    note: "Nomina sacra, kontrakcja.",
    system: "nomina sacra",
    pieces: letters("sps", true),
  },
  sanctus: {
    shown: "s̃cs",
    expansion: "sanctus",
    note: "Częsta kontrakcja w tekście liturgicznym.",
    system: "nomina sacra",
    pieces: letters("scs", true),
  },
  noster: {
    shown: "ñr",
    expansion: "noster",
    note: "Kontrakcja zaimka. Bez kontekstu łatwo pomylić z innymi ñ.",
    system: "kontrakcja",
    pieces: letters("nr", true),
  },
  nostri: {
    shown: "ñri",
    expansion: "nostri",
    note: "Kontrakcja.",
    system: "kontrakcja",
    pieces: letters("nri", true),
  },
  amen: {
    shown: "ãm",
    expansion: "amen",
    note: "Suspensja albo krótka kontrakcja w formule kończącej.",
    system: "suspensja",
    pieces: letters("am", true),
  },
  pater: {
    shown: "p̃r",
    expansion: "pater",
    note: "W tekście modlitewnym pater bywa ściągnięte.",
    system: "kontrakcja",
    pieces: letters("pr", true),
  },
  nomen: {
    shown: "ñm",
    expansion: "nomen",
    note: "Kontrakcja. Titulus nie jest tu nosowością polską.",
    system: "kontrakcja",
    pieces: letters("nm", true),
  },
  gratia: {
    shown: "g̃ra",
    expansion: "gratia",
    note: "Formuła Dei gratia. Titulus nad skróconym środkiem.",
    system: "suspensja",
    pieces: letters("gra", true),
  },
  predictus: {
    shown: "pred̃",
    expansion: "predictus",
    note: "Suspensja typowa dla formularza prawnego: koniec wyrazu obcina titulus.",
    system: "suspensja",
    pieces: letters("pred", true),
  },
  instrumentum: {
    shown: "instr̃",
    expansion: "instrumentum",
    note: "Suspensja kancelaryjna.",
    system: "suspensja",
    pieces: letters("instr", true),
  },
  anno: {
    shown: "aõ",
    expansion: "anno",
    note: "Titulus nad n bywa też zwykłym opuszczeniem n. Tu czytam anno.",
    system: "suspensja",
    pieces: [
      { ch: "a" },
      { ch: "n", titulus: true },
      { ch: "o" },
    ],
  },
  non: {
    shown: "ñ",
    expansion: "non",
    note: "Jedna litera z titulusem. Bez kontekstu to także nihil albo noster.",
    system: "suspensja",
    pieces: letters("n", true),
  },
  est: {
    shown: "ẽ",
    expansion: "est",
    note: "ē bywa est. W innym miejscu to samo kreska znaczy tylko pominięte m/n.",
    system: "suspensja",
    pieces: letters("e", true),
  },
  sunt: {
    shown: "s̃t",
    expansion: "sunt",
    note: "Kontrakcja czasownika.",
    system: "kontrakcja",
    pieces: letters("st", true),
  },
  cum: {
    shown: "c̃",
    expansion: "cum",
    note: "Możliwe też znak podobny do odwróconego c. Tu: c z titulusem.",
    system: "suspensja",
    pieces: letters("c", true),
  },
  et: {
    shown: "⁊",
    expansion: "et",
    note: "Nota tyroneńska. W gotyku często z poprzeczką, wtedy myli się z „7” albo z piórem akapitu.",
    system: "nota tyroneńska",
    pieces: [{ ch: "", special: "et" }],
  },
  per: {
    shown: "p̶",
    expansion: "per",
    note: "P z kreską przez laskę. Ta sama rodzina znaku bywa pro — rozstrzyga kontekst.",
    system: "znak specjalny",
    pieces: [{ ch: "p", mark: "per" }],
  },
  pro: {
    shown: "p̊",
    expansion: "pro",
    note: "P z pętlą przy lasce, nie z prostą kreską (to częściej per).",
    system: "znak specjalny",
    pieces: [{ ch: "p", mark: "pro" }],
  },
  quod: {
    shown: "q̶d",
    expansion: "quod",
    note: "Kreska przy q jest wieloznaczna: que, quod albo qui.",
    system: "znak specjalny",
    pieces: [
      { ch: "q", mark: "que" },
      { ch: "d" },
    ],
  },
  contra: {
    shown: "ↄtra",
    expansion: "contra",
    note: "Znak jak dziewiątka albo odwrócone c na początku wyrazu czyta się con- / com-.",
    system: "znak specjalny",
    pieces: [{ ch: "", special: "con" }, ...letters("tra")],
  },
};

const NOMINA = new Set(["dominus", "domini", "deus", "dei", "christus", "iesus", "spiritus", "sanctus"]);

/**
 * Formy odmienne nomina sacra i najczęstsze kontrakcje (Cappelli; poświadczone m.in. na
 * Polonie, BN, NT łac. [Niemcy, ca 701-800], k. 1r: "ihu xpi", "dni", "dm", "xpm", "omnib;").
 * Dotąd słownik znał tylko mianownik (christus → xps), więc "Christi" zostawało pełne.
 * Klucz: forma po norm() (j → i, v → u). Wartość: litery pod titulusem.
 */
const EXTRA_CONTRACTIONS: { system: string; note: string; nomina: boolean; forms: Record<string, string> }[] = [
  {
    system: "nomina sacra",
    note: "xp to chi–rho: łacińskie x i p stoją za greckimi literami. Końcówka przypadka zostaje po kontrakcji.",
    nomina: true,
    forms: { christi: "xpi", christo: "xpo", christum: "xpm", christe: "xpe" },
  },
  {
    system: "nomina sacra",
    note: "ih to iota–eta. Odmiana zostaje w ostatniej literze: ihu, ihm.",
    nomina: true,
    forms: { iesu: "ihu", iesum: "ihm", ihesus: "ihs", ihesu: "ihu", ihesum: "ihm" },
  },
  {
    system: "nomina sacra",
    note: "Dominus w odmianie: d + n + końcówka pod titulusem.",
    nomina: true,
    forms: { domino: "dno", dominum: "dnm", domine: "dne" },
  },
  {
    system: "nomina sacra",
    note: "Deus w odmianie: ds, di, do, dm.",
    nomina: true,
    forms: { deo: "do", deum: "dm" },
  },
  {
    system: "nomina sacra",
    note: "Spiritus w odmianie: sps, spu, spm.",
    nomina: true,
    forms: { spiritu: "spu", spiritum: "spm", spiritui: "spui" },
  },
  {
    system: "nomina sacra",
    note: "Sanctus w odmianie: sc + końcówka.",
    nomina: true,
    forms: {
      sancti: "sci",
      sancto: "sco",
      sanctum: "scm",
      sancta: "sca",
      sancte: "sce",
      sanctae: "sce",
      sanctam: "scam",
      sanctis: "scis",
      sanctorum: "scorum",
    },
  },
  {
    system: "nomina sacra",
    note: "Nazwy święte spoza greckiego kanonu ściąga się tak samo.",
    nomina: true,
    forms: { israhel: "isrl", israel: "isrl", hierusalem: "ihrlm", ierusalem: "ihrlm", iherusalem: "ihrlm" },
  },
  {
    system: "kontrakcja",
    note: "Zaimek noster w odmianie: nr + końcówka.",
    nomina: false,
    forms: { nostro: "nro", nostrum: "nrm", nostra: "nra", nostre: "nre", nostrae: "nre", nostris: "nris", nostram: "nram" },
  },
  {
    system: "kontrakcja",
    note: "Pater w odmianie.",
    nomina: false,
    forms: { patris: "pris", patri: "pri", patrem: "prem" },
  },
  {
    system: "kontrakcja",
    note: "Omnis: środek wyrazu wypada, zostaje o + końcówka.",
    nomina: false,
    forms: { omnia: "oia", omnes: "oms", omnis: "oms", omnium: "oium" },
  },
  {
    system: "kontrakcja",
    note: "Słownictwo kościelne: episcopus, ecclesia.",
    nomina: false,
    forms: {
      episcopus: "eps",
      episcopi: "epi",
      episcopo: "epo",
      ecclesia: "eccla",
      ecclesie: "eccle",
      ecclesiae: "eccle",
      ecclesiam: "ecclam",
    },
  },
  {
    system: "suspensja",
    note: "Częste słowa funkcyjne: titulus nad skróconym końcem albo środkiem.",
    nomina: false,
    forms: { autem: "aut", enim: "en", nihil: "nl", nichil: "nl", tamen: "tn", quoniam: "qm", quam: "q", quia: "qa", secundum: "scdm" },
  },
];

/** Wstawia znak łączący (titulus) za środkową literą: "xpi" → "xp̃i". */
function tildeShown(short: string): string {
  const chars = [...short];
  const at = chars.length <= 1 ? 0 : Math.floor((chars.length - 1) / 2);
  return chars.map((ch, i) => (i === at ? `${ch}\u0303` : ch)).join("");
}

const EXTRA_KEYS = new Set<string>();
for (const group of EXTRA_CONTRACTIONS) {
  for (const [full, short] of Object.entries(group.forms)) {
    if (WORDS[full]) continue;
    WORDS[full] = {
      shown: tildeShown(short),
      expansion: full,
      note: group.note,
      system: group.system,
      pieces: letters(short, true),
    };
    EXTRA_KEYS.add(full);
    if (group.nomina) NOMINA.add(full);
  }
}

const GENRE_OK: Record<string, Genre[] | "all"> = {
  dominus: ["religijne", "urzędowe", "prawnicze", "ziemskie"],
  domini: ["religijne", "urzędowe", "prawnicze", "ziemskie"],
  deus: ["religijne", "urzędowe"],
  dei: ["religijne", "urzędowe"],
  christus: ["religijne"],
  iesus: ["religijne"],
  spiritus: ["religijne"],
  sanctus: ["religijne"],
  noster: "all",
  nostri: "all",
  amen: ["religijne"],
  pater: ["religijne"],
  nomen: ["religijne", "urzędowe"],
  gratia: ["religijne", "urzędowe"],
  predictus: ["prawnicze", "urzędowe", "ziemskie"],
  instrumentum: ["prawnicze", "urzędowe", "ziemskie"],
  anno: ["urzędowe", "ziemskie", "prawnicze"],
  non: "all",
  est: "all",
  sunt: "all",
  cum: "all",
  et: "all",
  per: ["prawnicze", "urzędowe", "ziemskie", "religijne"],
  pro: ["prawnicze", "urzędowe", "ziemskie"],
  quod: ["prawnicze", "urzędowe", "ziemskie", "religijne"],
  contra: ["prawnicze", "urzędowe", "ziemskie"],
};

function genreAllows(id: string, genre: Genre): boolean {
  const g = GENRE_OK[id];
  if (!g) {
    // Formy z EXTRA_CONTRACTIONS dopuszcza się w każdym gatunku; poezję hamuje dalej
    // współczynnik prawdopodobieństwa w prepareWords, nie zakaz.
    return EXTRA_KEYS.has(id);
  }
  return g === "all" || g.includes(genre);
}

/** Wielka litera w źródle → wielka pierwsza litera skrótu ("Christi" → "Xpi"). */
function casePieces(form: Form, source: string): Form["pieces"] {
  const first = [...source.replace(/^[„"'(]+/, "")][0] ?? "";
  const upper = first !== "" && first === first.toUpperCase() && first !== first.toLowerCase();
  if (!upper) return form.pieces;
  const allCaps = source.length > 1 && source === source.toUpperCase();
  return form.pieces.map((p, i) => (p.ch && (i === 0 || allCaps) ? { ...p, ch: p.ch.toUpperCase() } : p));
}

const VOWELS = "aeiouy";

/**
 * Produktywna suspensja nosowa: -m na końcu wyrazu i n/m przed spółgłoską znikają, a nad
 * poprzednią samogłoską staje titulus (autem → autē, inuenta → ĩuenta). To najczęstszy
 * skrót wszystkich epok i dotąd go brakowało, więc tekst spoza słownika wychodził pełny.
 */
function nasalForm(token: string, rate: number, seed: string): Form | null {
  const chars = [...token];
  const pieces: Form["pieces"] = [];
  let used = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const low = ch.toLowerCase();
    const prev = pieces[pieces.length - 1];
    const next = (chars[i + 1] ?? "").toLowerCase();
    const prevVowel = prev && !prev.titulus && VOWELS.includes(prev.ch.toLowerCase());
    const final = i === chars.length - 1;
    const beforeConsonant = next !== "" && /\p{L}/u.test(next) && !VOWELS.includes(next) && next !== "h";
    const candidate = prevVowel && ((low === "m" && final) || ((low === "n" || low === "m") && beforeConsonant && i > 0));
    if (candidate && roll(`${seed}|${i}`) < (final ? rate : rate * 0.55)) {
      pieces[pieces.length - 1] = { ...prev, titulus: true };
      used += 1;
      continue;
    }
    pieces.push({ ch });
  }
  if (!used) return null;
  return {
    shown: pieces.map((p) => (p.titulus ? `${p.ch}\u0304` : p.ch)).join(""),
    expansion: token,
    note: "Kreska nad samogłoską zastępuje opuszczone m albo n — skrót produktywny, nie słownikowy.",
    system: "titulus nosowy",
    pieces,
  };
}

function piecesFrom(form: Form, rubricFirst: boolean, source = ""): Piece[] {
  return casePieces(form, source).map((p, i) => ({
    ch: p.ch,
    titulus: Boolean(p.titulus),
    group: p.titulus ? 1 : 0,
    mark: p.mark,
    special: p.special,
    rubric: rubricFirst && i === 0,
    longS: false,
    rotunda: false,
  }));
}

function plainPieces(word: string, rubric: boolean): Piece[] {
  return [...word].map((ch, i) => ({
    ch,
    titulus: false,
    group: 0,
    rubric: rubric && i === 0,
    longS: false,
    rotunda: false,
  }));
}

function suffixForm(word: string, suf: string, special: Special, shownTail: string, expansion: string, note: string, system: string): Form {
  const stem = word.slice(0, word.length - suf.length);
  return {
    shown: stem + shownTail,
    expansion,
    note,
    system,
    pieces: [...letters(stem), { ch: "", special }],
  };
}

/** Wielkie litery: jak w tekście źródłowym, tylko na początku zdania, albo wcale. */
export type CapsMode = "zrodlo" | "zdanie" | "brak";

/**
 * Wielkość liter wyrazu według zwyczaju epoki. We wczesnym średniowieczu imiona i nazwy
 * własne pisze się małą literą (maria, ioseph); wielka litera, jeśli w ogóle, otwiera zdanie.
 */
function recase(token: string, mode: CapsMode, sentenceStart: boolean, incipit: boolean): string {
  if (incipit) return token.toUpperCase();
  if (mode === "zrodlo") return token;
  const lower = token.toLowerCase();
  if (mode === "zdanie" && sentenceStart) return lower.charAt(0).toUpperCase() + lower.slice(1);
  return lower;
}

/**
 * Łacińska majuskuła nie zna litery U: kapitała, uncjała i wersaliki ksiąg piszą V tam, gdzie
 * minuskuła ma u (XPI AVTEM GENERATIO - Polona, NT łac. [Niemcy, ca 701-800], k. 4r). Dotyczy
 * każdej wielkiej litery w łacinie, także na początku wyrazu w tekście minuskułowym (Uerbum → Verbum).
 */
function majusculeV(token: string): string {
  return token.replace(/U/g, "V");
}

export function prepareWords(opts: {
  text: string;
  year: number;
  lang: Lang;
  genre: Genre;
  culture: Culture;
  hand: Hand;
  ortho: boolean;
  abbreviate: boolean;
  rubric: boolean;
  /** Mnożnik gęstości skrótów z suwaka (1 = jak w epoce). */
  density?: number;
  /** Wielkie litery (domyślnie jak w tekście źródłowym). */
  caps?: CapsMode;
  /** Ile pierwszych wyrazów pisać wersalikami (incipit), 0 = żadnego. */
  incipit?: number;
}): { words: Word[]; notes: Note[]; transformed: string } {
  const ortho = applyOrtho(opts.text, opts.year, opts.lang, opts.ortho);
  const genreRate = GENRES.find((g) => g.id === opts.genre)?.rate ?? 0.5;
  const culture = CULTURE_ABBR[opts.culture];
  const tokens = ortho.text.split(/(\s+|[.,;:!?()„”"“—–-])/);
  const words: Word[] = [];
  let seenLetter = false;
  let index = 0;
  let sentenceStart = true;
  const caps = opts.caps ?? "zrodlo";
  const incipitWords = Math.max(0, opts.incipit ?? 0);
  const notes = ortho.notes;
  const shownParts: string[] = [];

  for (const rawToken of tokens) {
    if (!rawToken) continue;
    if (/^\s+$/.test(rawToken)) {
      if (rawToken.includes("\n") && words.length) words[words.length - 1].breakAfter = true;
      shownParts.push(rawToken);
      continue;
    }
    if (/^[.,;:!?()„”"“—–-]+$/.test(rawToken)) {
      words.push({ pieces: plainPieces(rawToken, false), gapAfter: 0.35, breakAfter: false, text: rawToken });
      if (/[.!?]/.test(rawToken)) sentenceStart = true;
      shownParts.push(rawToken);
      continue;
    }
    let token = recase(rawToken, caps, sentenceStart, index < incipitWords);
    if (token !== rawToken && caps !== "zrodlo" && index >= incipitWords && /\p{Lu}/u.test(rawToken.slice(sentenceStart ? 1 : 0))) {
      pushNote(notes, "Maria, Ioseph", "maria, ioseph", "Imiona i nazwy własne pisano zwykle małą literą; wielka litera, jeśli w ogóle, otwiera zdanie.");
    }
    if (index < incipitWords) {
      pushNote(notes, "incipit", "WERSALIKI", "Pierwsze wyrazy księgi lub rozdziału pisano wersalikami (kapitałą albo uncjałą), często po inicjale.");
    }
    if (!isPolishToken(token, opts.lang) && token.includes("U")) {
      token = majusculeV(token);
      pushNote(notes, "U", "V", "Majuskuła łacińska nie ma U: wielka litera to zawsze V (AVTEM, Verbum).");
    }
    sentenceStart = false;
    shownParts.push(token);
    const allCaps = token.length > 1 && token === token.toUpperCase() && token !== token.toLowerCase();
    const key = norm(token.replace(/^[„"'(]+|[”"')]+$/g, ""));
    let form: Form | null = null;
    const ruleId = WORDS[key] ? key : null;
    const density = opts.density ?? 1;
    const thresholdBase = Math.min(1, genreRate * opts.hand.abbr * culture * density);

    // w wersalikach tylko nomina sacra (XPI, DNS); AVTEM, OMNIA zostają pełne
    if (opts.abbreviate && ruleId && genreAllows(ruleId, opts.genre) && (!allCaps || NOMINA.has(ruleId))) {
      let p = Math.min(1, thresholdBase * (ruleId === "et" ? 1 : 0.92));
      if (opts.genre === "poezja") p *= 0.45;
      // Nomina sacra są ściągane niemal zawsze, także w karolińskiej i u humanistów - to nie
      // skrót oszczędnościowy, tylko zwyczaj szacunku dla imienia. Dotąd przy karolińskiej
      // wychodziło ok. 19% i "Christi" zostawało pełne.
      if (NOMINA.has(ruleId)) p = Math.max(p, Math.min(0.98, (opts.genre === "religijne" ? 0.97 : 0.8) * Math.min(1, density)));
      // W tekście religijnym przy gęstości >= 100% bez losowania: w ewangeliarzu xpi stoi zawsze
      // (Polona, NT łac. k. 4r: "XPI AUTEM GENERATIO"), a 3% pecha dawało pełne "Christi".
      if (NOMINA.has(ruleId) && opts.genre === "religijne" && density >= 1) p = 1;
      if (roll(`${opts.hand.id}|${opts.genre}|${index}|${ruleId}`) < p) form = WORDS[ruleId];
    }

    // wersaliki skraca się tylko kontrakcją nomina sacra (XPI), nie końcówkami ani titulusem
    if (opts.abbreviate && !form && key.length > 4 && !allCaps) {
      const p = thresholdBase * (opts.genre === "poezja" ? 0.35 : 0.85);
      const gate = roll(`${opts.hand.id}|suf|${index}|${key}`);
      if (gate < p && key.endsWith("tur") && !isPolishToken(token, opts.lang)) {
        form = suffixForm(token, "tur", "ur", "²", token + " (−tur)", "Znak jak mała dwójka w indeksie górnym czyta się -ur, często w -tur.", "znak specjalny");
      } else if (gate < p && key.endsWith("rum") && !isPolishToken(token, opts.lang)) {
        form = {
          shown: token.slice(0, -3) + "r̶",
          expansion: token,
          note: "Końcówka -rum: r przekreślone, nie osobne litery.",
          system: "znak specjalny",
          pieces: [...letters(token.slice(0, -3)), { ch: "r", mark: "rum" }],
        };
      } else if (gate < p * 0.9 && key.endsWith("us") && key.length > 3 && !WORDS[key] && !isPolishToken(token, opts.lang)) {
        form = suffixForm(token, "us", "us", "⁹", token, "Końcówka -us / -os jako znak w kształcie dziewiątki u góry.", "znak specjalny");
      } else if (gate < p && key.endsWith("que") && key.length > 3) {
        form = {
          shown: token.slice(0, -3) + "q̶",
          expansion: token,
          note: "que przy q. Ten sam znak bywa quod albo qui.",
          system: "znak specjalny",
          pieces: [...letters(token.slice(0, -3)), { ch: "q", mark: "que" }],
        };
      } else if (gate < p * 0.8 && (key.startsWith("con") || key.startsWith("com")) && key.length > 5 && !WORDS[key]) {
        const rest = token.slice(3);
        form = {
          shown: "⁹" + rest,
          expansion: token,
          note: "con- / com- jako znak początkowy w kształcie 9.",
          system: "znak specjalny",
          pieces: [{ ch: "", special: "con" }, ...letters(rest)],
        };
      }
    }

    if (opts.abbreviate && !form && key.length > 2 && !allCaps && !isPolishToken(token, opts.lang)) {
      form = nasalForm(token, thresholdBase * (opts.genre === "poezja" ? 0.3 : 0.75), `${opts.hand.id}|nas|${index}|${key}`);
    }

    const rubric = opts.rubric && !seenLetter;
    const pieces = form ? piecesFrom(form, rubric, token) : plainPieces(token, rubric);
    if ([...token].some((ch) => /\p{L}/u.test(ch))) seenLetter = true;
    words.push({
      pieces,
      gapAfter: 1,
      breakAfter: false,
      text: token,
      abbr: form
        ? { shown: form.shown, expansion: form.expansion, note: form.note, system: form.system }
        : undefined,
    });
    index += 1;
  }

  // "po diachronii" pokazuje też wielkość liter i V za U - to, co faktycznie trafia na kartę
  return { words, notes, transformed: shownParts.join("") };
}

const RESOLVER: { test: RegExp; hits: { expansion: string; note: string; system: string }[] }[] = [
  { test: /^(7|&|⁊)$/i, hits: [{ expansion: "et", note: "Nota tyroneńska.", system: "nota tyroneńska" }] },
  { test: /^p\/$/i, hits: [{ expansion: "per", note: "Kreska przez p. Sprawdź, czy to nie pro.", system: "znak specjalny" }, { expansion: "pro", note: "Jeśli znak jest pętlą, nie kreską.", system: "znak specjalny" }] },
  { test: /^p\/\/$/i, hits: [{ expansion: "pro", note: "Pętla przy p.", system: "znak specjalny" }] },
  { test: /^9/, hits: [{ expansion: "con- / com-", note: "Znak początkowy. Reszta wyrazu stoi obok.", system: "znak specjalny" }] },
  { test: /q;$/i, hits: [{ expansion: "-que", note: "Także quod i qui.", system: "znak specjalny" }, { expansion: "quod", note: "Gdy obok stoi d albo wymaga tego składnia.", system: "znak specjalny" }, { expansion: "qui", note: "Względne qui bywa tym samym znakiem.", system: "znak specjalny" }] },
  { test: /(9|us)$/i, hits: [{ expansion: "-us", note: "Dziewiątka w indeksie.", system: "znak specjalny" }] },
  { test: /r4$/i, hits: [{ expansion: "-rum", note: "Przekreślone r.", system: "znak specjalny" }] },
  { test: /2$/i, hits: [{ expansion: "-ur", note: "Znak jak dwójka, często w -tur.", system: "znak specjalny" }] },
];

const TILDE_WORDS: Record<string, { expansion: string; note: string; system: string }[]> = {
  dns: [{ expansion: "dominus", note: "Nomina sacra.", system: "nomina sacra" }],
  ds: [{ expansion: "deus", note: "Nomina sacra.", system: "nomina sacra" }],
  di: [{ expansion: "dei", note: "Nomina sacra.", system: "nomina sacra" }],
  dni: [{ expansion: "domini", note: "Nomina sacra.", system: "nomina sacra" }],
  xps: [{ expansion: "christus", note: "Chi–rho–sigma, nie łacińskie x-p-s.", system: "nomina sacra" }],
  ihs: [{ expansion: "Iesus", note: "Iota–eta–sigma.", system: "nomina sacra" }],
  sps: [{ expansion: "spiritus", note: "Nomina sacra.", system: "nomina sacra" }],
  scs: [{ expansion: "sanctus", note: "Kontrakcja liturgiczna.", system: "nomina sacra" }],
  nr: [{ expansion: "noster", note: "Możliwe też inne zaimki przy innym przypadku.", system: "kontrakcja" }],
  am: [{ expansion: "amen", note: "Formuła.", system: "suspensja" }],
  nm: [{ expansion: "nomen", note: "Kontrakcja.", system: "kontrakcja" }],
  gra: [{ expansion: "gratia", note: "Często w Dei gratia.", system: "suspensja" }],
  pred: [{ expansion: "predictus", note: "Suspensja formularza. Bywa też predicta, predicti.", system: "suspensja" }],
  pr: [{ expansion: "pater", note: "Albo per, jeśli kreska przecina laskę p, a nie wisi nad literami.", system: "kontrakcja" }],
  n: [{ expansion: "non", note: "Jedno n z titulusem jest wieloznaczne.", system: "suspensja" }, { expansion: "noster", note: "Gdy obok brakuje reszty zaimka.", system: "kontrakcja" }],
  e: [{ expansion: "est", note: "Albo samo e z opuszczonym n.", system: "suspensja" }],
  st: [{ expansion: "sunt", note: "Kontrakcja.", system: "kontrakcja" }],
  c: [{ expansion: "cum", note: "Albo con, jeśli znak jest odwróconym c.", system: "suspensja" }],
};

export function resolveQuery(input: string): { expansion: string; note: string; system: string }[] {
  const q = input.trim();
  if (!q) return [];
  for (const row of RESOLVER) {
    if (row.test.test(q)) return row.hits;
  }
  const tilde = q.replace(/~/g, "").replace(/¯/g, "").toLowerCase();
  if (q.includes("~") || q.includes("¯") || TILDE_WORDS[tilde]) {
    if (TILDE_WORDS[tilde]) return TILDE_WORDS[tilde];
    return [
      {
        expansion: `${tilde} + pominięte litery`,
        note: "Titulus (~) znaczy kontrakcję albo opuszczone n/m. Bez słownika epoki nie wybieram jednej lektury.",
        system: "titulus",
      },
    ];
  }
  const key = norm(q);
  if (WORDS[key]) {
    return [{ expansion: WORDS[key].expansion, note: WORDS[key].note, system: WORDS[key].system }];
  }
  return [
    {
      expansion: "brak w słowniku modelu",
      note: "Dopisz tyldę (~) dla titulusa, p/ dla per, 7 dla et, 9 na początku dla con-, q; dla que.",
      system: "—",
    },
  ];
}
