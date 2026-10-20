import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Download, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { compose, DEFAULT_LAYOUT, ribbon, XH_UNITS, type Frame, type Layout, type Page } from "@/scriptorium/compose";
import {
  CULTURES,
  GENRES,
  HANDS,
  LANGS,
  handById,
  lerpHand,
  midYear,
  type Culture,
  type Genre,
  type Hand,
  type Lang,
} from "@/scriptorium/hands";
import { resolveQuery, type CapsMode } from "@/scriptorium/shape";
import { matchHands, matchLetters, type Stroke } from "@/scriptorium/recognize";
import enginePy from "@/scriptorium/engine.py?raw";

const SAMPLES: {
  id: string;
  label: string;
  genre: Genre;
  lang: Lang;
  culture: Culture;
  hand: string;
  text: string;
}[] = [
  {
    id: "pater",
    label: "Pater noster",
    genre: "religijne",
    lang: "la",
    culture: "zachodni",
    hand: "tekstualis",
    text: "Pater noster qui es in caelis sanctificetur nomen tuum adveniat regnum tuum fiat voluntas tua. Amen.",
  },
  {
    id: "dyplom",
    label: "Inwokacja dyplomu",
    genre: "urzędowe",
    lang: "mix",
    culture: "polski",
    hand: "lacinka",
    text: "In nomine Domini amen. Nos Dei gratia rex Poloniae notum facimus universis quod predictus dominus contra instrumentum non venit.",
  },
  {
    id: "prawo",
    label: "Formuła prawnicza",
    genre: "prawnicze",
    lang: "la",
    culture: "zachodni",
    hand: "bastarda",
    text: "Noverint universi quod predictus dominus per instrumentum contra quodlibet impedimentum protestatur et quod est ratum.",
  },
  {
    id: "ziemia",
    label: "Zapis ziemski",
    genre: "ziemskie",
    lang: "pl",
    culture: "ziemski",
    hand: "ziemskie",
    text: "Ja Mikołaj dziedzic ze wsi Gniezno sprzedaję włókę roli i łąkę za dwanaście grzywien panu Janowi i jego dziedzicom.",
  },
  {
    id: "bogu",
    label: "Bogurodzica",
    genre: "poezja",
    lang: "pl",
    culture: "polski",
    hand: "lacinka",
    text: "Bogurodzica dziewica Bogiem sławiena Maryja u Twego syna Gospodzina Matko zwolena Maryja zyszczy nam spuści nam.",
  },
  {
    id: "karol",
    label: "Zdanie karolińskie",
    genre: "religijne",
    lang: "la",
    culture: "karolinski",
    hand: "karolinska",
    text: "In nomine Domini. Pater noster qui es in caelis. Amen.",
  },
];

const STUDY = [..."abcdefghijklmnoprstuvwxyzſąęł", "ꝛ"];

type Tab = "duktus" | "skroty" | "czytanie" | "python";

/** Parametry ręki dostępne w "Dostrój rękę": klucz, etykieta, zakres, krok. */
const TUNE: { key: keyof Hand; label: string; min: number; max: number; step: number }[] = [
  { key: "nib", label: "Kąt stalówki °", min: -10, max: 70, step: 1 },
  { key: "twist", label: "Skręt w kresce °", min: 0, max: 30, step: 1 },
  { key: "weight", label: "Szerokość stalówki (× wys. x)", min: 0.05, max: 0.4, step: 0.005 },
  { key: "slant", label: "Pochył °", min: -10, max: 25, step: 0.5 },
  { key: "compress", label: "Ścieśnienie liter", min: 0, max: 1, step: 0.02 },
  { key: "angular", label: "Kanciastość", min: 0, max: 1, step: 0.02 },
  { key: "aForm", label: "a otwarte (cc) ↔ zamknięte", min: 0, max: 1, step: 0.02 },
  { key: "tremor", label: "Drżenie", min: 0, max: 3, step: 0.05 },
  { key: "wander", label: "Falowanie linii", min: 0, max: 4, step: 0.05 },
  { key: "wordGap", label: "Odstęp wyrazów", min: 0.1, max: 1.6, step: 0.02 },
  { key: "continua", label: "Scriptio continua", min: 0, max: 1, step: 0.02 },
  { key: "abbr", label: "Skłonność do skrótów", min: 0, max: 1, step: 0.02 },
];

const CUSTOM_KEY = "calamus.customHands";

/** Suwaki geometrii karty: klucz Layout, etykieta, zakres, krok (jednostki karty, wys. x ≈ 40.6 j.). */
const LAYOUT_TUNE: { key: keyof Layout; label: string; min: number; max: number; step: number }[] = [
  { key: "pageW", label: "Szerokość karty", min: 400, max: 4000, step: 10 },
  { key: "pageH", label: "Wysokość karty (0 = do tekstu)", min: 0, max: 6000, step: 10 },
  { key: "marginL", label: "Margines lewy", min: 0, max: 1000, step: 2 },
  { key: "marginR", label: "Margines prawy", min: 0, max: 1000, step: 2 },
  { key: "marginT", label: "Margines górny", min: 0, max: 1000, step: 2 },
  { key: "marginB", label: "Margines dolny", min: 0, max: 1000, step: 2 },
  { key: "lineSpacing", label: "Interlinia (× wys. x)", min: 1.4, max: 5, step: 0.05 },
  { key: "maxLines", label: "Wierszy na karcie", min: 1, max: 60, step: 1 },
  { key: "leftEdge", label: "Lewa krawędź (− = widać to, co obok)", min: -600, max: 300, step: 2 },
  { key: "rightEdge", label: "Za prawą krawędzią (− = ucięta)", min: -300, max: 600, step: 2 },
];

/** Geometria z pliku ręki (recognize_scan.py zapisuje ją jako "layout"), tylko znane pola. */
function layoutFromJson(raw: unknown): Partial<Layout> | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const out: Partial<Layout> = {};
  for (const [k, v] of Object.entries(DEFAULT_LAYOUT)) {
    const val = src[k];
    if (typeof v === "number" && typeof val === "number" && Number.isFinite(val)) (out as Record<string, number>)[k] = val;
    if (typeof v === "string" && (val === "page" || val === "table")) (out as Record<string, string>)[k] = val;
  }
  return out;
}

/** Ręka z pliku JSON (recognize_scan.py --hand-out albo "Pobierz JSON"): brakujące pola z karolińskiej. */
function handFromJson(raw: unknown): Hand {
  if (!raw || typeof raw !== "object") throw new Error("To nie jest obiekt JSON ręki.");
  const src = raw as Record<string, unknown>;
  const base = handById("karolinska");
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(base)) {
    const val = src[k];
    if (typeof v === "number" && typeof val === "number" && Number.isFinite(val)) out[k] = val;
    if (typeof v === "string" && typeof val === "string") out[k] = val;
  }
  if (Array.isArray(src.years) && src.years.length === 2 && src.years.every((y) => typeof y === "number")) {
    out.years = [src.years[0], src.years[1]];
  }
  if (typeof src.culture === "string" && CULTURES.some((c) => c.id === src.culture)) out.culture = src.culture;
  if (typeof out.id !== "string" || !out.id || HANDS.some((h) => h.id === out.id)) out.id = `wlasna-${Date.now()}`;
  return out as Hand;
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function travelsOf(frames: Frame[], until: number): { x1: number; y1: number; x2: number; y2: number }[] {
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const n = Math.min(frames.length, until);
  for (let i = 1; i < n; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (!a.down && !b.down) out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return out;
}

function partialDraws(page: Page, until: number) {
  const buckets = new Map<number, Page["draws"][number]["pts"]>();
  const order: number[] = [];
  const n = Math.min(page.frames.length, Math.max(0, until));
  for (let i = 0; i < n; i++) {
    const f = page.frames[i];
    if (!f.down || f.draw < 0) continue;
    if (!buckets.has(f.draw)) {
      buckets.set(f.draw, []);
      order.push(f.draw);
    }
    buckets.get(f.draw)?.push({ x: f.x, y: f.y, p: f.p, nib: f.nib });
  }
  return order.map((id) => ({ ...page.draws[id], pts: buckets.get(id) ?? [] }));
}

/** Ruch na sucho (pióro w górze) jest szybszy niż kreska - ręka przenosi pióro, nie pisze. */
const TRAVEL_FACTOR = 2.6;

/** Tempo pióra w jednostkach karty na sekundę. Wysokość x ≈ 40 jednostek ≈ 3 mm na pergaminie. */
const TEMPO_PRESETS: { label: string; speed: number; lift: number; hint: string }[] = [
  { label: "Kaligraf", speed: 140, lift: 260, hint: "księga liturgiczna, każda kreska osobno" },
  { label: "Skryba", speed: 380, lift: 140, hint: "zwykłe tempo przepisywania" },
  { label: "Kancelista", speed: 900, lift: 70, hint: "dokument, pisarz się spieszy" },
  { label: "Podgląd", speed: 4000, lift: 0, hint: "bez pauz, żeby zobaczyć całość" },
];

const TEMPO_MIN = 30;
const TEMPO_MAX = 6000;
const tempoFromSlider = (v: number) => Math.round(TEMPO_MIN * (TEMPO_MAX / TEMPO_MIN) ** (v / 100));
const sliderFromTempo = (speed: number) => Math.round((100 * Math.log(speed / TEMPO_MIN)) / Math.log(TEMPO_MAX / TEMPO_MIN));

/**
 * Czas (w sekundach) dotarcia pióra do każdej klatki. Animacja idzie po czasie, nie po
 * liczbie klatek: długa kreska trwa dłużej niż krótka, a podniesienie pióra to pauza.
 * Wcześniej każda klatka trwała tyle samo, więc tempo zależało od gęstości punktów glifu.
 */
function timeline(frames: Frame[], speed: number, liftMs: number): number[] {
  const t = new Array<number>(frames.length).fill(0);
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    let dt = 0;
    if (a.down && b.down) dt = d / speed;
    else if (!a.down && !b.down) dt = d / (speed * TRAVEL_FACTOR);
    if (a.down && !b.down) dt += liftMs / 1000;
    t[i] = t[i - 1] + dt;
  }
  return t;
}

/** Indeks ostatniej klatki osiągniętej w chwili `time` (wyszukiwanie binarne). */
function frameAt(times: number[], time: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function pageProgram(program: string): string {
  const lib = enginePy.replace(/\nif __name__ == "__main__":[\s\S]*$/, "\n");
  const safe = program.replace(/'''/g, "'''\"'''\"'''");
  return `${lib}
PROGRAM = r'''
${safe}
'''

if __name__ == "__main__":
    svg = to_svg(parse(PROGRAM))
    with open("strona.svg", "w", encoding="utf-8") as fh:
        fh.write(svg)
    print("zapisano strona.svg")
`;
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/x-python;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function Scriptorium() {
  const [handA, setHandA] = useState("tekstualis");
  const [handB, setHandB] = useState("karolinska");
  const [mix, setMix] = useState(0);
  const [year, setYear] = useState(1350);
  const [follow, setFollow] = useState(true);
  const [genre, setGenre] = useState<Genre>("religijne");
  const [culture, setCulture] = useState<Culture>("zachodni");
  const [lang, setLang] = useState<Lang>("la");
  const [text, setText] = useState(SAMPLES[0].text);
  const [ortho, setOrtho] = useState(true);
  const [abbreviate, setAbbreviate] = useState(true);
  const [rubric, setRubric] = useState(true);
  const [showTravel, setShowTravel] = useState(false);
  const [showNib, setShowNib] = useState(true);
  const [study, setStudy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("duktus");
  const [frame, setFrame] = useState(0);
  const [play, setPlay] = useState<"idle" | "run" | "pause">("idle");
  const [speed, setSpeed] = useState(380);
  const [liftMs, setLiftMs] = useState(140);
  const [density, setDensity] = useState(1);
  const [ink, setInk] = useState<Stroke[]>([]);
  const [allHands, setAllHands] = useState(false);
  const [query, setQuery] = useState("dns~");
  const drawing = useRef(false);
  // czas animacji w sekundach (nie indeks klatki - patrz timeline())
  const frameRef = useRef(0);

  // ręce wczytane ze skanu albo zapisane po dostrojeniu - trzymane w localStorage przeglądarki
  const [customHands, setCustomHands] = useState<Hand[]>([]);
  const [tune, setTune] = useState<Partial<Hand>>({});
  const [refImg, setRefImg] = useState<string | null>(null);
  const [refZoom, setRefZoom] = useState(100);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [caps, setCaps] = useState<CapsMode>("zrodlo");
  const [incipit, setIncipit] = useState(0);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");
      if (Array.isArray(saved)) setCustomHands(saved.map(handFromJson));
    } catch {
      /* uszkodzony wpis w localStorage - zaczynamy bez własnych rąk */
    }
  }, []);
  const saveCustom = (list: Hand[]) => {
    setCustomHands(list);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  };
  const allHandList = useMemo(() => [...HANDS, ...customHands], [customHands]);
  const findHand = (id: string) => customHands.find((h) => h.id === id) ?? handById(id);

  const a = findHand(handA);
  const b = findHand(handB);
  const mixed = useMemo(() => (mix <= 0.001 ? a : mix >= 0.999 ? b : lerpHand(a, b, mix)), [a, b, mix]);
  // dostrojenie nakłada się na wybraną rękę (albo mieszankę), nie zmienia jej w HANDS
  const hand = useMemo(() => ({ ...mixed, ...tune }), [mixed, tune]);
  const tuned = Object.keys(tune).length > 0;

  useEffect(() => {
    if (!follow) return;
    const ya = midYear(a);
    const yb = midYear(b);
    setYear(Math.round(ya + (yb - ya) * mix));
  }, [a, b, mix, follow]);

  const page = useMemo(
    () =>
      compose({
        text,
        hand,
        year,
        lang,
        genre,
        culture,
        ortho,
        abbreviate,
        rubric,
        study,
        density,
        caps,
        incipit,
        layout,
      }),
    [text, hand, year, lang, genre, culture, ortho, abbreviate, rubric, study, density, caps, incipit, layout],
  );

  const times = useMemo(() => timeline(page.frames, speed, liftMs), [page.frames, speed, liftMs]);
  const total = times.length ? times[times.length - 1] : 0;

  // zmiana tempa w trakcie pisania: zostajemy na tej samej klatce, przeliczamy tylko czas
  const frameNow = useRef(0);
  frameNow.current = frame;
  useEffect(() => {
    const at = Math.min(times.length - 1, Math.max(0, Math.floor(frameNow.current) - 1));
    frameRef.current = at >= 0 ? times[at] : 0;
  }, [times]);

  useEffect(() => {
    frameRef.current = 0;
    setFrame(0);
    setPlay("idle");
  }, [page]);

  useEffect(() => {
    if (play !== "run") return;
    let raf = 0;
    let last = performance.now();
    const max = page.frames.length;
    const tick = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      frameRef.current += dt / 1000;
      if (frameRef.current >= total) {
        frameRef.current = total;
        setFrame(max);
        setPlay("pause");
        return;
      }
      setFrame(frameAt(times, frameRef.current));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [play, times, total, page.frames.length]);

  const idle = play === "idle";
  const until = idle ? page.frames.length : Math.floor(frame);
  const draws = idle ? page.draws : partialDraws(page, until);
  const travel = showTravel ? travelsOf(page.frames, idle ? page.frames.length : until) : [];
  const cursor = page.frames[Math.min(page.frames.length - 1, Math.max(0, until - 1))];
  const outside = year < hand.years[0] - 40 || year > hand.years[1] + 40;
  const letters = matchLetters(ink, hand, allHands ? HANDS : [hand]);
  const handsRank = matchHands(ink);
  const resolved = resolveQuery(query);
  const nowWord = idle || !cursor ? -1 : until >= page.frames.length ? page.words.length : cursor.word;
  const wordClass = (i: number) => (nowWord < 0 ? "w" : i < nowWord ? "w done" : i === nowWord ? "w now" : "w todo");
  const elapsed = idle ? total : Math.min(total, frameRef.current);
  const letterCount = page.draws.reduce((set, d) => set.add(`${d.word}:${d.letter}`), new Set<string>()).size;

  const pickHand = (id: string) => {
    setHandA(id);
    setMix(0);
    setFollow(true);
    setTune({});
    setCulture(findHand(id).culture);
  };

  const loadHandFile = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      const h = handFromJson(raw);
      // ręka ze skanu niesie też geometrię karty zmierzoną na tym samym skanie
      const lay = layoutFromJson((raw as Record<string, unknown>).layout);
      if (lay && Object.keys(lay).length) setLayout({ ...DEFAULT_LAYOUT, ...lay });
      saveCustom([...customHands.filter((c) => c.id !== h.id), h]);
      setLoadError(null);
      setHandA(h.id);
      setMix(0);
      setFollow(true);
      setTune({});
      setCulture(h.culture);
    } catch (err) {
      setLoadError(`Nie wczytano ręki: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const saveTuned = () => {
    const h: Hand = {
      ...hand,
      id: `wlasna-${Date.now()}`,
      name: tuned ? `${hand.name} (dostrojona)` : hand.name,
    };
    saveCustom([...customHands, h]);
    setHandA(h.id);
    setMix(0);
    setTune({});
  };

  const loadSample = (id: string) => {
    const sample = SAMPLES.find((s) => s.id === id);
    if (!sample) return;
    setText(sample.text);
    setGenre(sample.genre);
    setLang(sample.lang);
    setCulture(sample.culture);
    setHandA(sample.hand);
    setMix(0);
    setFollow(true);
    setStudy(null);
  };

  // "Następna kreska": do końca najbliższej kreski pióra w dole (dawniej +18 klatek,
  // co lądowało w środku kreski albo przeskakiwało kilka naraz)
  const step = () => {
    const frames = page.frames;
    const max = frames.length;
    let i = play === "idle" ? 0 : Math.min(max, Math.floor(frame));
    while (i < max && !frames[i].down) i++;
    const draw = i < max ? frames[i].draw : -1;
    while (i < max && frames[i].down && frames[i].draw === draw) i++;
    frameRef.current = i > 0 ? times[i - 1] : 0;
    setFrame(i);
    setPlay("pause");
  };

  const playToggle = () => {
    if (play === "run") {
      setPlay("pause");
      return;
    }
    if (play === "idle" || frameRef.current >= total) {
      frameRef.current = 0;
      setFrame(0);
    }
    setPlay("run");
  };

  const onPadDown = (event: PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * 300;
    const y = ((event.clientY - box.top) / box.height) * 200;
    drawing.current = true;
    svg.setPointerCapture(event.pointerId);
    setInk((prev) => [...prev, [{ x, y }]]);
  };

  const onPadMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!drawing.current) return;
    const svg = event.currentTarget;
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * 300;
    const y = ((event.clientY - box.top) / box.height) * 200;
    setInk((prev) => {
      if (!prev.length) return prev;
      const copy = prev.slice();
      const last = copy[copy.length - 1];
      const tail = last[last.length - 1];
      if (tail && Math.hypot(tail.x - x, tail.y - y) < 1.4) return prev;
      copy[copy.length - 1] = [...last, { x, y }];
      return copy;
    });
  };

  const nibLine = (() => {
    if (!showNib || !cursor) return null;
    // ten sam znak co w ribbon() (compose.ts): dodatni kąt = krawędź wznosi się w prawo
    const rad = (-cursor.nib * Math.PI) / 180;
    const half = page.weight / 2;
    return {
      x1: cursor.x - Math.cos(rad) * half,
      y1: cursor.y - Math.sin(rad) * half,
      x2: cursor.x + Math.cos(rad) * half,
      y2: cursor.y + Math.sin(rad) * half,
    };
  })();

  return (
    <div className="shell">
      <header className="top">
        <h1 className="brand">
          Cal<em>a</em>mus
        </h1>
        <p className="lede">
          Pióro szerokie jak w LOGO: w górze, w dole, z kątem i skrętem. Epoki od merowińskiej do
          antykwy, razem z przejściami, skrótami i pisownią, która starzeje się razem z rokiem.
        </p>
      </header>
      <div className="layout">
        <section className="col-tools panel">
          {/* tekst na górze kolumny, żeby był widoczny razem z kartą bez przewijania */}
          <label className="field first">
            <span>Tekst zadany</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          </label>
          <div className="samples">
            {SAMPLES.map((sample) => (
              <button key={sample.id} type="button" className="btn small" onClick={() => loadSample(sample.id)}>
                {sample.label}
              </button>
            ))}
          </div>
          <p className="whisper">Po diachronii: {page.transformed || "—"}</p>
          <h2 className="again">Epoka</h2>
          <div className="row-btns">
            <label className="btn small file">
              Ręka ze skanu (.json)
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadHandFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="btn small file">
              Wzorzec: skan (.jpg)
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (refImg) URL.revokeObjectURL(refImg);
                  setRefImg(URL.createObjectURL(f));
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {loadError ? <p className="whisper warn">{loadError}</p> : null}
          <div className="epoch-list">
            {allHandList.map((item) => (
              <button
                key={item.id}
                className={item.id === handA && mix < 0.04 ? "epoch on" : "epoch"}
                onClick={() => pickHand(item.id)}
                type="button"
              >
                <small>
                  {item.years[0]}–{item.years[1]}
                </small>
                {item.name}
                <em>{item.latin}</em>
              </button>
            ))}
          </div>
          <p className="whisper">{hand.blurb}</p>
          {customHands.some((c) => c.id === handA) ? (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                saveCustom(customHands.filter((c) => c.id !== handA));
                pickHand("karolinska");
              }}
            >
              Usuń tę rękę z listy
            </button>
          ) : null}
          <details className="tune" open={tuned}>
            <summary>Dostrój rękę{tuned ? ` · zmieniono ${Object.keys(tune).length}` : ""}</summary>
            <p className="whisper">
              Porównaj kartę ze wzorcem i poprawiaj na oko. Zmiany działają na wybraną rękę lub mieszankę; zapisz je,
              żeby powstała nowa ręka na liście.
            </p>
            {TUNE.map((t) => {
              const value = Number(hand[t.key]);
              return (
                <label key={t.key} className="field tight-v">
                  <span>
                    {t.label}: {t.step < 1 ? value.toFixed(t.step < 0.01 ? 3 : 2) : Math.round(value)}
                    {t.key in tune ? " •" : ""}
                  </span>
                  <input
                    type="range"
                    min={t.min}
                    max={t.max}
                    step={t.step}
                    value={value}
                    onChange={(e) => setTune((prev) => ({ ...prev, [t.key]: Number(e.target.value) }))}
                  />
                </label>
              );
            })}
            <div className="row-btns">
              <button type="button" className="btn small" disabled={!tuned} onClick={() => setTune({})}>
                Wyzeruj
              </button>
              <button type="button" className="btn small primary" onClick={saveTuned}>
                Zapisz jako rękę
              </button>
              <button type="button" className="btn small" onClick={() => downloadJson(`${hand.id}.json`, { ...hand, layout })}>
                Pobierz JSON
              </button>
            </div>
          </details>
          <label className="field">
            <span>Przejście do</span>
            <select value={handB} onChange={(e) => setHandB(e.target.value)}>
              {allHandList.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Mieszanka {Math.round(mix * 100)}%</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(mix * 100)}
              onChange={(e) => {
                setMix(Number(e.target.value) / 100);
                setFollow(true);
              }}
            />
          </label>
          <label className="field">
            <span>Rok {year}</span>
            <input
              type="range"
              min={620}
              max={1600}
              value={year}
              onChange={(e) => {
                setFollow(false);
                setYear(Number(e.target.value));
              }}
            />
          </label>
          {outside ? (
            <p className="whisper">Ten rok leży poza rozkwitem wybranej ręki. Zostawiam go, bo tak wygląda przejście.</p>
          ) : null}
          <label className="field">
            <span>Rodzaj tekstu</span>
            <select value={genre} onChange={(e) => setGenre(e.target.value as Genre)}>
              {GENRES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Krąg</span>
            <select value={culture} onChange={(e) => setCulture(e.target.value as Culture)}>
              {CULTURES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <p className="whisper">{CULTURES.find((c) => c.id === culture)?.note}</p>
          <label className="field">
            <span>Język diachronii</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="toggles">
            <label className="toggle">
              <input type="checkbox" checked={ortho} onChange={(e) => setOrtho(e.target.checked)} />
              Diachronia pisowni
            </label>
            <label className="toggle">
              <input type="checkbox" checked={abbreviate} onChange={(e) => setAbbreviate(e.target.checked)} />
              Skróty epoki
            </label>
            <label className="toggle">
              <input type="checkbox" checked={rubric} onChange={(e) => setRubric(e.target.checked)} />
              Inicjał rubryką
            </label>
            <label className="toggle">
              <input type="checkbox" checked={showTravel} onChange={(e) => setShowTravel(e.target.checked)} />
              Droga pióra w górze
            </label>
            <label className="toggle">
              <input type="checkbox" checked={showNib} onChange={(e) => setShowNib(e.target.checked)} />
              Kąt stalówki
            </label>
          </div>
          <label className="field">
            <span>Gęstość skrótów {Math.round(density * 100)}%</span>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={Math.round(density * 100)}
              disabled={!abbreviate}
              onChange={(e) => setDensity(Number(e.target.value) / 100)}
            />
          </label>
          <p className="whisper">100% = zwyczaj epoki, kręgu i gatunku. Nomina sacra ściąga się prawie zawsze.</p>
          <label className="field">
            <span>Wielkie litery</span>
            <select value={caps} onChange={(e) => setCaps(e.target.value as CapsMode)}>
              <option value="zrodlo">Jak w tekście</option>
              <option value="zdanie">Tylko na początku zdania (imiona małą)</option>
              <option value="brak">Wcale (wszystko małą)</option>
            </select>
          </label>
          <label className="field">
            <span>Incipit wersalikami: {incipit ? `${incipit} wyraz(y)` : "nie"}</span>
            <input type="range" min={0} max={8} value={incipit} onChange={(e) => setIncipit(Number(e.target.value))} />
          </label>
          <p className="whisper">W łacinie wielka litera U jest zawsze pisana jako V (XPI AVTEM).</p>
          <details className="tune">
            <summary>Karta: format i marginesy</summary>
            <p className="whisper">
              Jednostki karty; wysokość x to {XH_UNITS.toFixed(1)} j. Ręka ze skanu ustawia te wartości ze zmierzonej
              karty.
            </p>
            {LAYOUT_TUNE.map((t) => (
              <label key={t.key} className="field tight-v">
                <span>
                  {t.label}: {t.step < 1 ? Number(layout[t.key]).toFixed(2) : Math.round(Number(layout[t.key]))}
                </span>
                <input
                  type="range"
                  min={t.min}
                  max={t.max}
                  step={t.step}
                  value={Number(layout[t.key])}
                  onChange={(e) => setLayout((prev) => ({ ...prev, [t.key]: Number(e.target.value) }))}
                />
              </label>
            ))}
            <label className="field tight-v">
              <span>Po lewej</span>
              <select
                value={layout.leftKind}
                onChange={(e) => setLayout((prev) => ({ ...prev, leftKind: e.target.value as Layout["leftKind"] }))}
              >
                <option value="page">poprzednia karta</option>
                <option value="table">blat stołu</option>
              </select>
            </label>
            <label className="field tight-v">
              <span>Po prawej</span>
              <select
                value={layout.rightKind}
                onChange={(e) => setLayout((prev) => ({ ...prev, rightKind: e.target.value as Layout["rightKind"] }))}
              >
                <option value="table">blat stołu</option>
                <option value="page">następna karta</option>
              </select>
            </label>
            <button type="button" className="btn small" onClick={() => setLayout(DEFAULT_LAYOUT)}>
              Format domyślny
            </button>
          </details>
        </section>

        <section className="col-sheet">
          <div className="transport">
            <button type="button" className={study ? "btn" : "btn primary"} onClick={() => setStudy(null)}>
              Tekst
            </button>
            <button type="button" className="btn" onClick={playToggle} aria-label={play === "run" ? "Pauza" : "Pisz"}>
              {play === "run" ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button type="button" className="btn" onClick={step} aria-label="Następna kreska">
              <SkipForward size={18} />
            </button>
            <button
              type="button"
              className="btn"
              aria-label="Od początku"
              onClick={() => {
                frameRef.current = 0;
                setFrame(0);
                setPlay("pause");
              }}
            >
              <RotateCcw size={18} />
            </button>
            <span className="clock">
              {clock(elapsed)} / {clock(total)}
            </span>
          </div>
          <div className="tempo">
            <label className="field tight">
              <span>
                Tempo pióra {speed} j/s
                {total > 0 ? ` · ≈ ${(letterCount / total).toFixed(1)} liter/s` : ""}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={sliderFromTempo(speed)}
                aria-label="Tempo pióra"
                onChange={(e) => setSpeed(tempoFromSlider(Number(e.target.value)))}
              />
            </label>
            <label className="field tight">
              <span>Pauza przy podniesieniu {liftMs} ms</span>
              <input
                type="range"
                min={0}
                max={600}
                step={10}
                value={liftMs}
                aria-label="Pauza przy podniesieniu pióra"
                onChange={(e) => setLiftMs(Number(e.target.value))}
              />
            </label>
            <div className="presets">
              {TEMPO_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  title={preset.hint}
                  className={speed === preset.speed && liftMs === preset.lift ? "btn small primary" : "btn small"}
                  onClick={() => {
                    setSpeed(preset.speed);
                    setLiftMs(preset.lift);
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          {!study && page.words.length ? (
            <div className="transcript" aria-live="off">
              <p className="kicker">Zadany (po diachronii)</p>
              <p className="row">
                {page.words.map((w, i) => (
                  <span key={`s${i}`} className={wordClass(i)}>
                    {w.source}{" "}
                  </span>
                ))}
              </p>
              <p className="kicker">Na karcie</p>
              <p className="row written">
                {page.words.map((w, i) => (
                  <span
                    key={`w${i}`}
                    className={`${wordClass(i)}${w.abbr ? " abbr" : ""}`}
                    title={w.abbr ? `${w.shown} = ${w.source}` : undefined}
                  >
                    {w.shown}{" "}
                  </span>
                ))}
              </p>
            </div>
          ) : null}
          <div className="letters" aria-label="Studium litery">
            {STUDY.map((ch) => (
              <button
                key={ch}
                type="button"
                className={study === ch ? "on" : undefined}
                onClick={() => setStudy(ch)}
              >
                {ch === "ꝛ" ? "r₂" : ch}
              </button>
            ))}
          </div>
          {refImg ? (
            <div className="reference">
              <div className="row-btns">
                <span className="kicker">Wzorzec ze skanu</span>
                <input
                  type="range"
                  min={50}
                  max={600}
                  step={10}
                  value={refZoom}
                  aria-label="Powiększenie wzorca"
                  onChange={(e) => setRefZoom(Number(e.target.value))}
                />
                <span className="clock">{refZoom}%</span>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    URL.revokeObjectURL(refImg);
                    setRefImg(null);
                  }}
                >
                  Zamknij
                </button>
              </div>
              <div className="ref-view">
                <img src={refImg} alt="Skan wzorcowy" style={{ width: `${refZoom}%` }} />
              </div>
            </div>
          ) : null}
          <article className="sheet">
            <svg
              viewBox={`${page.view.x} 0 ${page.view.w} ${page.h}`}
              role="img"
              aria-label="Karta zapisana piórem"
            >
              <defs>
                <linearGradient id="gutter" x1="0" x2="1">
                  <stop offset="0" stopColor="#000" stopOpacity="0" />
                  <stop offset="1" stopColor="#000" stopOpacity="0.45" />
                </linearGradient>
              </defs>
              {/* sama karta; poza nią (gdy proporcje okna i karty się różnią) widać ciemne tło */}
              <rect className="leaf" x={0} y={0} width={page.w} height={page.h} />
              {page.view.x < 0 ? (
                <g>
                  <rect
                    className={page.layout.leftKind === "table" ? "table" : "neighbour"}
                    x={page.view.x}
                    y={0}
                    width={-page.view.x}
                    height={page.h}
                  />
                  {page.layout.leftKind === "page" ? (
                    <rect x={Math.max(page.view.x, -40)} y={0} width={Math.min(40, -page.view.x)} height={page.h} fill="url(#gutter)" />
                  ) : null}
                </g>
              ) : null}
              {page.view.x + page.view.w > page.w ? (
                <rect
                  className={page.layout.rightKind === "table" ? "table" : "neighbour"}
                  x={page.w}
                  y={0}
                  width={page.view.x + page.view.w - page.w}
                  height={page.h}
                />
              ) : null}
              <line className="margin" x1={page.layout.marginL} x2={page.layout.marginL} y1={0} y2={page.h} />
              <line
                className="margin"
                x1={page.w - page.layout.marginR}
                x2={page.w - page.layout.marginR}
                y1={0}
                y2={page.h}
              />
              {page.rules[0] ? (
                <line
                  className="head-rule"
                  x1={page.layout.marginL - 12}
                  x2={page.w - page.layout.marginR + 8}
                  y1={page.rules[0] - 34}
                  y2={page.rules[0] - 34}
                />
              ) : null}
              {page.rules.map((y) => (
                <line
                  key={y}
                  className="rule"
                  x1={page.layout.marginL - 12}
                  x2={page.w - page.layout.marginR + 8}
                  y1={y}
                  y2={y}
                />
              ))}
              {travel.map((seg, i) => (
                <line key={`t${i}`} className="travel" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} />
              ))}
              {draws.map((draw, i) => {
                const d = ribbon(draw.pts, page.weight);
                if (!d) return null;
                const head = draw.pts[0];
                return (
                  <g key={`${draw.word}-${i}`}>
                    <path d={d} className={draw.ink === "rubric" ? "rub" : "ink"} />
                    {study && head ? (
                      <text className="num" x={head.x - 14} y={head.y + 4}>
                        {i + 1}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {nibLine ? (
                <line className="nib" x1={nibLine.x1} y1={nibLine.y1} x2={nibLine.x2} y2={nibLine.y2} />
              ) : null}
              {!text.trim() && !study ? (
                <text x={72} y={120} fill="currentColor" fontFamily="var(--font-display)" fontSize="28">
                  Wpisz tekst, pióro poprowadzi duktus.
                </text>
              ) : null}
            </svg>
            <footer className="sheet-foot">
              <strong>{hand.name}</strong>
              <span>stalówka {Math.round(hand.nib)}°</span>
              <span>skręt {Math.round(hand.twist)}°</span>
              <span>rok {year}</span>
              <span>{study ? `litera ${study}` : `${page.draws.length} kresek`}</span>
              {page.clipped ? <span>karta ucięta po dwunastu wierszach</span> : null}
            </footer>
          </article>
        </section>

        <aside className="col-side panel">
          <div className="tabs" role="tablist">
            {(
              [
                ["duktus", "Duktus"],
                ["skroty", "Skróty"],
                ["czytanie", "Czytanie"],
                ["python", "Python"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? "tab on" : "tab"} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "duktus" ? (
            <div>
              <p className="side-head">Program pióra</p>
              <p className="whisper">
                PU — pióro w górze, PD — w dole, NIB — kąt krawędzi stalówki, MV — ruch i nacisk. Kąt zmienia
                się w trakcie kreski: to skręt.
              </p>
              <pre className="logo">{page.logo}</pre>
            </div>
          ) : null}

          {tab === "skroty" ? (
            <div>
              <p className="side-head">Co ściągnięto</p>
              {page.abbrs.length ? (
                <ul className="abbr-list">
                  {page.abbrs.map((item, i) => (
                    <li key={`${item.shown}-${i}`}>
                      <strong>{item.shown}</strong>
                      <span className="system">{item.system}</span>
                      <div>→ {item.expansion}</div>
                      <p className="whisper">{item.note}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="whisper">
                  Nic nie skrócono. Karolina i humanistyka robią to rzadko, poezja prawie wcale. Włącz skróty albo
                  weź formularz prawny.
                </p>
              )}
              <p className="side-head again">Rozwiąż znak</p>
              <label className="field">
                <span>Zapis: dns~ &nbsp; p/ &nbsp; 7 &nbsp; 9tra &nbsp; q;</span>
                <input className="ink" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <ul className="abbr-list">
                {resolved.map((item) => (
                  <li key={item.expansion}>
                    <strong>{item.expansion}</strong>
                    <span className="system">{item.system}</span>
                    <p className="whisper">{item.note}</p>
                  </li>
                ))}
              </ul>
              {page.notes.length ? (
                <>
                  <p className="side-head again">Diachronia</p>
                  <ul className="note-list">
                    {page.notes.map((note) => (
                      <li key={note.why}>
                        <strong>
                          {note.from} → {note.to}
                        </strong>
                        <p className="whisper">{note.why}</p>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="whisper">Diachronia nie ruszyła tej pisowni.</p>
              )}
            </div>
          ) : null}

          {tab === "czytanie" ? (
            <div>
              <p className="side-head">Rozpoznaj rękę</p>
              <p className="whisper">
                Narysuj literę środkiem kreski, tak jak idzie duktus, nie obwiednią. To przybliżenie dydaktyczne, nie
                ekspertyza.
              </p>
              <svg
                className="pad"
                viewBox="0 0 300 200"
                onPointerDown={onPadDown}
                onPointerMove={onPadMove}
                onPointerUp={() => {
                  drawing.current = false;
                }}
                onPointerLeave={() => {
                  drawing.current = false;
                }}
              >
                <line className="guide" x1={16} x2={284} y1={150} y2={150} />
                {ink.map((stroke, i) => (
                  <polyline key={i} points={stroke.map((p) => `${p.x},${p.y}`).join(" ")} />
                ))}
              </svg>
              <div className="row-btns">
                <button type="button" className="btn small" onClick={() => setInk([])}>
                  Wyczyść
                </button>
                <label className="toggle">
                  <input type="checkbox" checked={allHands} onChange={(e) => setAllHands(e.target.checked)} />
                  Wszystkie epoki
                </label>
              </div>
              <ul className="abbr-list">
                {letters.map((hit) => (
                  <li key={`${hit.handId}-${hit.ch}`} className="hit">
                    <div>
                      <b>{hit.ch === "ꝛ" ? "r rotunda" : hit.ch}</b>
                      <div className="whisper">
                        {hit.hand} · odległość {hit.score.toFixed(2)}
                        {hit.score > 0.42 ? " · niepewnie" : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        setStudy(null);
                        setText((prev) => prev + (hit.ch === "ꝛ" ? "r" : hit.ch === "ſ" ? "s" : hit.ch));
                      }}
                    >
                      Wstaw
                    </button>
                  </li>
                ))}
              </ul>
              {ink.length ? (
                <>
                  <p className="side-head again">Która epoka</p>
                  {handsRank.slice(0, 4).map((row) => (
                    <div key={row.hand.id}>
                      <div className="whisper">
                        {row.hand.name} · {row.score.toFixed(2)}
                      </div>
                      <div className="meter">
                        <span style={{ width: `${Math.max(8, 100 - row.score * 42)}%` }} />
                      </div>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}

          {tab === "python" ? (
            <div>
              <p className="side-head">Ten sam program poza kartą</p>
              <p className="whisper">
                Silnik czyta komendy LOGO i kładzie szeroką stalówkę: ślad to odcinek o długości WEIGHT × nacisk,
                obrócony o NIB. Y rośnie w dół. Rozpoznawanie w pliku liczy kanciastość, pochył i drżenie środka
                kresek — zalążek lektury, nie jeszcze pełny alfabet w Pythonie.
              </p>
              <div className="row-btns">
                <button type="button" className="btn primary" onClick={() => download("strona.py", pageProgram(page.logo))}>
                  <Download size={16} /> Strona .py
                </button>
                <button type="button" className="btn" onClick={() => download("calamus.py", enginePy)}>
                  Silnik .py
                </button>
              </div>
              <p className="whisper">python strona.py zapisze strona.svg. Sam silnik: python calamus.py program.cal out.svg</p>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
