export type Culture =
  | "merowinski"
  | "karolinski"
  | "zachodni"
  | "polski"
  | "ziemski"
  | "humanistyczny";

export type Genre = "religijne" | "prawnicze" | "urzędowe" | "ziemskie" | "poezja";

export type Lang = "la" | "pl" | "mix";

export type Hand = {
  id: string;
  name: string;
  latin: string;
  years: readonly [number, number];
  blurb: string;
  culture: Culture;
  nib: number;
  nibJitter: number;
  weight: number;
  slant: number;
  angular: number;
  compress: number;
  tremor: number;
  wander: number;
  feet: number;
  loops: number;
  biting: number;
  longS: number;
  rRotunda: number;
  uncialD: number;
  aForm: number;
  wordGap: number;
  abbr: number;
  continua: number;
  twist: number;
};

export const CULTURES: { id: Culture; name: string; note: string }[] = [
  {
    id: "merowinski",
    name: "Krąg merowiński",
    note: "Kancelarie frankijskie i skryptoria przed reformą karolińską. Dużo suspensji, mało odstępów.",
  },
  {
    id: "karolinski",
    name: "Dwór karoliński",
    note: "Czytelność jako program. Skrótów świadomie mniej niż przedtem i potem.",
  },
  {
    id: "zachodni",
    name: "Zachód łaciński",
    note: "Książka gotycka, kapituła, klasztor. Nomina sacra i gęsta kontrakcja.",
  },
  {
    id: "polski",
    name: "Kancelaria polska",
    note: "Dyplomy i zapiski Królestwa: łacina formularza obok polszczyzny.",
  },
  {
    id: "ziemski",
    name: "Sądy ziemskie",
    note: "Księgi ziemskie i grodzkie. Pośpiech, formularz, mieszany język.",
  },
  {
    id: "humanistyczny",
    name: "Humanizm",
    note: "Włochy i północ. Rozwija się skróty, wraca antykwa i pełne wyrazy.",
  },
];

export const GENRES: { id: Genre; name: string; rate: number }[] = [
  { id: "religijne", name: "Religijne", rate: 0.95 },
  { id: "prawnicze", name: "Prawnicze", rate: 0.9 },
  { id: "urzędowe", name: "Urzędowe", rate: 0.82 },
  { id: "ziemskie", name: "Ziemskie", rate: 0.7 },
  { id: "poezja", name: "Poezja", rate: 0.18 },
];

export const LANGS: { id: Lang; name: string }[] = [
  { id: "la", name: "Łacina" },
  { id: "pl", name: "Polski" },
  { id: "mix", name: "Mieszany" },
];

const H = (
  partial: Omit<Hand, "nibJitter"> & { nibJitter?: number },
): Hand => ({
  nibJitter: 4,
  ...partial,
});

export const HANDS: Hand[] = [
  H({
    id: "merowinska",
    name: "Merowińska",
    latin: "merovingica",
    years: [620, 780],
    culture: "merowinski",
    blurb:
      "Nierówna linia, ligatury i słabe dzielenie wyrazów. Pióro skręca, kreska drży. A bywa otwarte, jak podwójne c.",
    nib: 24,
    nibJitter: 14,
    weight: 0.13,
    slant: 7,
    angular: 0.18,
    compress: 0.12,
    tremor: 1.8,
    wander: 2.6,
    feet: 0.12,
    loops: 0.2,
    biting: 0.15,
    longS: 0.25,
    rRotunda: 0.08,
    uncialD: 0.3,
    aForm: 0.1,
    wordGap: 0.32,
    abbr: 0.64,
    continua: 0.84,
    twist: 16,
  }),
  H({
    id: "karolinska",
    name: "Minuskuła karolińska",
    latin: "minuscula carolina",
    years: [780, 1120],
    culture: "karolinski",
    blurb:
      "Reforma czytelności: osobne wyrazy, okrągłe łuki, spokojny kąt pióra. Skrótów mniej niż w merowińskim i w gotyku.",
    nib: 30,
    nibJitter: 3,
    weight: 0.12,
    slant: 1,
    angular: 0.1,
    compress: 0.06,
    tremor: 0.32,
    wander: 0.35,
    feet: 0.18,
    loops: 0.02,
    biting: 0.04,
    longS: 0.42,
    rRotunda: 0.12,
    uncialD: 0.58,
    aForm: 0.44,
    wordGap: 1,
    abbr: 0.28,
    continua: 0.06,
    twist: 3,
  }),
  H({
    id: "przejscie-karol-got",
    name: "Przejście karolińsko-gotyckie",
    latin: "transitus saec. XII",
    years: [1100, 1240],
    culture: "zachodni",
    blurb:
      "Łuk jeszcze pamięta koło, ale już pęka. Litery się ścieśniają, pojawia się stopa klinowa i częstsze długie s.",
    nib: 35,
    nibJitter: 5,
    weight: 0.16,
    slant: 2,
    angular: 0.48,
    compress: 0.4,
    tremor: 0.42,
    wander: 0.45,
    feet: 0.55,
    loops: 0.06,
    biting: 0.38,
    longS: 0.7,
    rRotunda: 0.42,
    uncialD: 0.74,
    aForm: 0.56,
    wordGap: 0.88,
    abbr: 0.5,
    continua: 0.1,
    twist: 5,
  }),
  H({
    id: "tekstualis",
    name: "Gotyk tekstualny",
    latin: "gothica textualis",
    years: [1220, 1480],
    culture: "zachodni",
    blurb:
      "Textualis: łamane łuki, gryzienie sąsiednich brzuszków, stopy z szerokiej stalówki. Książka liturgiczna i gęste skróty.",
    nib: 40,
    nibJitter: 2,
    weight: 0.22,
    slant: 0,
    angular: 0.94,
    compress: 0.8,
    tremor: 0.22,
    wander: 0.2,
    feet: 1,
    loops: 0.02,
    biting: 0.9,
    longS: 0.94,
    rRotunda: 0.92,
    uncialD: 0.94,
    aForm: 0.74,
    wordGap: 0.82,
    abbr: 0.92,
    continua: 0.12,
    twist: 2,
  }),
  H({
    id: "bastarda",
    name: "Bastarda",
    latin: "bastarda",
    years: [1340, 1520],
    culture: "zachodni",
    blurb:
      "Między książką a dokumentem. Pętle na l, b i h, umiarkowane łamanie, pochył w prawo.",
    nib: 44,
    nibJitter: 6,
    weight: 0.155,
    slant: 11,
    angular: 0.6,
    compress: 0.52,
    tremor: 0.5,
    wander: 0.55,
    feet: 0.42,
    loops: 0.74,
    biting: 0.36,
    longS: 0.86,
    rRotunda: 0.5,
    uncialD: 0.8,
    aForm: 0.86,
    wordGap: 0.74,
    abbr: 0.7,
    continua: 0.18,
    twist: 8,
  }),
  H({
    id: "kursywa",
    name: "Kursywa gotycka",
    latin: "cursiva gothica",
    years: [1380, 1560],
    culture: "zachodni",
    blurb:
      "Ręka dokumentów: szybkie pętle, zmienny kąt, mocniejszy skręt stalówki w łuku.",
    nib: 50,
    nibJitter: 9,
    weight: 0.125,
    slant: 16,
    angular: 0.46,
    compress: 0.46,
    tremor: 0.72,
    wander: 0.85,
    feet: 0.22,
    loops: 0.92,
    biting: 0.22,
    longS: 0.8,
    rRotunda: 0.32,
    uncialD: 0.68,
    aForm: 0.96,
    wordGap: 0.6,
    abbr: 0.8,
    continua: 0.26,
    twist: 12,
  }),
  H({
    id: "lacinka",
    name: "Łacinka polska",
    latin: "cancellaresca Polonica",
    years: [1280, 1520],
    culture: "polski",
    blurb:
      "Pismo kancelarii polskiej: gotycka kursywa pod łaciński formularz i pod polskie wyrazy, z ich ówczesną pisownią.",
    nib: 47,
    nibJitter: 8,
    weight: 0.14,
    slant: 13,
    angular: 0.56,
    compress: 0.5,
    tremor: 0.62,
    wander: 0.7,
    feet: 0.38,
    loops: 0.8,
    biting: 0.28,
    longS: 0.78,
    rRotunda: 0.38,
    uncialD: 0.76,
    aForm: 0.9,
    wordGap: 0.7,
    abbr: 0.74,
    continua: 0.2,
    twist: 9,
  }),
  H({
    id: "ziemskie",
    name: "Pismo ziemskie",
    latin: "terrae iudicialis",
    years: [1390, 1570],
    culture: "ziemski",
    blurb:
      "Księgi ziemskie i grodzkie. Ta sama rodzina co łacinka, tylko szybsza, mniej równa i pełna formularza.",
    nib: 49,
    nibJitter: 10,
    weight: 0.13,
    slant: 15,
    angular: 0.5,
    compress: 0.44,
    tremor: 0.9,
    wander: 1.05,
    feet: 0.28,
    loops: 0.84,
    biting: 0.2,
    longS: 0.72,
    rRotunda: 0.3,
    uncialD: 0.7,
    aForm: 0.94,
    wordGap: 0.64,
    abbr: 0.68,
    continua: 0.24,
    twist: 11,
  }),
  H({
    id: "przejscie-humanizm",
    name: "Przejście gotycko-humanistyczne",
    latin: "transitus ad antiquam",
    years: [1420, 1510],
    culture: "humanistyczny",
    blurb:
      "Łamanie mięknie, skrótów ubywa, długie s jeszcze nie znika. Okrąg wraca obok klinowej stopy.",
    nib: 33,
    nibJitter: 4,
    weight: 0.135,
    slant: 4,
    angular: 0.38,
    compress: 0.28,
    tremor: 0.36,
    wander: 0.4,
    feet: 0.36,
    loops: 0.16,
    biting: 0.16,
    longS: 0.48,
    rRotunda: 0.28,
    uncialD: 0.6,
    aForm: 0.5,
    wordGap: 0.92,
    abbr: 0.4,
    continua: 0.08,
    twist: 4,
  }),
  H({
    id: "humanistyka",
    name: "Antykwa humanistyczna",
    latin: "antiqua humanistica",
    years: [1450, 1600],
    culture: "humanistyczny",
    blurb:
      "Powrót do karolińskiego duktu. Cienka stalówka, mały pochył, pełne wyrazy. Długie s ustępuje okrągłemu.",
    nib: 28,
    nibJitter: 2,
    weight: 0.105,
    slant: 3,
    angular: 0.08,
    compress: 0.04,
    tremor: 0.28,
    wander: 0.28,
    feet: 0.1,
    loops: 0.03,
    biting: 0.02,
    longS: 0.12,
    rRotunda: 0.05,
    uncialD: 0.42,
    aForm: 0.4,
    wordGap: 1.05,
    abbr: 0.16,
    continua: 0.04,
    twist: 2,
  }),
];

export function handById(id: string): Hand {
  return HANDS.find((h) => h.id === id) ?? HANDS[3];
}

export function lerpHand(a: Hand, b: Hand, t: number): Hand {
  const u = Math.min(1, Math.max(0, t));
  const num = (x: number, y: number) => x + (y - x) * u;
  const midYear = (h: Hand) => (h.years[0] + h.years[1]) / 2;
  return {
    ...a,
    id: u < 0.5 ? a.id : b.id,
    name: u <= 0.02 ? a.name : u >= 0.98 ? b.name : `${a.name} → ${b.name}`,
    latin: u < 0.5 ? a.latin : b.latin,
    years: [
      Math.round(num(a.years[0], b.years[0])),
      Math.round(num(a.years[1], b.years[1])),
    ],
    blurb: u < 0.5 ? a.blurb : b.blurb,
    culture: u < 0.5 ? a.culture : b.culture,
    nib: num(a.nib, b.nib),
    nibJitter: num(a.nibJitter, b.nibJitter),
    weight: num(a.weight, b.weight),
    slant: num(a.slant, b.slant),
    angular: num(a.angular, b.angular),
    compress: num(a.compress, b.compress),
    tremor: num(a.tremor, b.tremor),
    wander: num(a.wander, b.wander),
    feet: num(a.feet, b.feet),
    loops: num(a.loops, b.loops),
    biting: num(a.biting, b.biting),
    longS: num(a.longS, b.longS),
    rRotunda: num(a.rRotunda, b.rRotunda),
    uncialD: num(a.uncialD, b.uncialD),
    aForm: num(a.aForm, b.aForm),
    wordGap: num(a.wordGap, b.wordGap),
    abbr: num(a.abbr, b.abbr),
    continua: num(a.continua, b.continua),
    twist: num(a.twist, b.twist),
  };
}

export function midYear(h: Hand): number {
  return Math.round((h.years[0] + h.years[1]) / 2);
}

export const CULTURE_ABBR: Record<Culture, number> = {
  merowinski: 1.08,
  karolinski: 0.72,
  zachodni: 1,
  polski: 1,
  ziemski: 0.96,
  humanistyczny: 0.62,
};
