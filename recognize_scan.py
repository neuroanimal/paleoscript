#!/usr/bin/env python3
# pylint: disable=line-too-long,too-many-locals,too-many-arguments,too-many-positional-arguments,too-many-statements,too-many-branches
"""
Krok 2: skan rękopisu -> kreski (środki kresek) -> cechy duktu -> ranking epok Calamusa.

Rozpoznawanie w aplikacji (src/scriptorium/recognize.ts) działa na kreskach narysowanych
myszą. Skan z Polony to raster, więc najpierw trzeba z niego odzyskać kreski:

  1. maska karty (odcina czarne tło skanu) i maska atramentu (próg Sauvoli, rubryka osobno),
  2. wiersze z profilu poziomego -> wysokość x (jednostka, w której mierzy się resztę),
  3. szkielet atramentu -> odcinki z kierunkiem; transformata odległości -> grubość kreski,
  4. cechy:
       nib     kąt krawędzi stalówki, dopasowany do modelu szerokiego pióra
               szerokość = W * |sin(kierunek - nib)| (ten sam, którym rysuje engine.py),
       weight  szerokość stalówki W / wysokość x  (= Hand.weight w hands.ts),
       slant   pochył prostych pionów w stopniach (= Hand.slant),
       turn    kanciastość: obrót kierunku na jedną wysokość x,
       space   udział przerw między wyrazami w długości wiersza (scriptio continua -> mało),
       tremor  drżenie: odchylenie szkieletu od jego wygładzonej wersji, na wysokość x.
  5. prototypy rąk: każda ręka z hands.ts jest pisana przez Calamusa (ten sam kod co w
     aplikacji, przez draw_script/scripts/calamus-cli.mjs), rasteryzowana i mierzona tym
     samym potokiem. Skan porównuje się z prototypami, a nie z parametrami "z teorii".

Ten sam potok mierzy więc i karty generowane, i skany - opcja --calibrate sprawdza, czy
z karty wygenerowaną daną ręką odzyskuje jej parametry i czy rozpoznaje właściwą rękę.

Krok 2 - kształty liter: skan tnie się na spójne kawałki atramentu w pasie wiersza (litery,
czasem ligatury), każdy kawałek i każdą literę każdej ręki Calamusa sprowadza do szkieletu
w stałej skali (wysokość x = 16 px, linia bazowa w tym samym rzędzie) i porównuje. Ręka,
której litery najlepiej pasują do kawałków skanu, wygrywa ranking kształtów. Podgląd
dopasowań: <nazwa>_letters.png w --debug-dir.

Geometria karty: krawędzie karty, blok tekstu (mediana początków i końców wierszy, więc
glosy na marginesie i inicjały go nie rozpychają), interlinia, liczba wierszy oraz to, co
widać obok karty (poprzednia karta albo blat). Wszystko w jednostkach karty Calamusa
(wysokość x = 40.6 j.) i zapisywane w ręce z --hand-out jako "layout".

To jest przybliżenie dydaktyczne, nie ekspertyza paleograficzna. Wynik zależy od tego, czy
modele rąk w hands.ts są trafne; tego narzędzie nie sprawdza.

Kalibracja ręki do GUI (opcja --hand-out): pomiar jest systematycznie przesunięty względem
parametrów modelu (np. szerokość stalówki zaniżona o ok. 20%), więc z prototypów liczy się
regresję liniową pomiar -> parametr dla nib, weight i slant i stosuje ją do skanu. Parametry,
których nie mierzymy wprost (kształty liter, skróty, ligatury), są średnią ważoną z
najbliższych prototypów. Wynik to JSON w kształcie Hand z hands.ts - wczytuje się go w
aplikacji przyciskiem "Ręka ze skanu". Kilka skanów naraz = jedna ręka ze średnich cech.

Przykłady:
    python3 recognize_scan.py manuscript_pages/page_0014.jpg
    python3 recognize_scan.py manuscript_pages/c8acfe1a_page_0021_f4r.jpg --hand-out scan_analysis/f4r_hand.json --base merowinska
    python3 recognize_scan.py manuscript_pages/c8acfe1a_page_00{15,16,17,18,19,20,21}_*.jpg --hand-out scan_analysis/nt_hand.json --name "NT łac. VIII w." 
    python3 recognize_scan.py manuscript_pages/page_0014.jpg --debug-dir scan_analysis
    python3 recognize_scan.py skan.jpg --crop 1500,5200,4500,6400
    python3 recognize_scan.py --calibrate
    python3 recognize_scan.py --rebuild-prototypes manuscript_pages/page_0014.jpg
"""

import argparse
import importlib.util
import json
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, signal
from skimage import filters, morphology

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(HERE, "draw_script")
CLI = os.path.join(APP_DIR, "scripts", "calamus-cli.mjs")
ENGINE = os.path.join(APP_DIR, "src", "scriptorium", "engine.py")
PROTO_CACHE = os.path.join(HERE, "hand_prototypes.json")

# wysokość x w jednostkach karty Calamusa: (BASE - XH) * SCALE z glyphs.ts / compose.ts
XH_UNITS = (100 - 42) * 0.7
# pierwsza linia bazowa karty Calamusa = marginT + 86 (compose.ts)
FIRST_BASELINE_OFFSET = 86
DEFAULT_MARGIN_T = 78
# wspólna skala opisu kształtu: wysokość x w pikselach i rozmiar kanwy
SHAPE_XH = 16
SHAPE_N = 64

FEATURES = ("nib", "weight", "slant", "turn", "space", "tremor")

# Tekst do prototypów i osobny do kalibracji - żeby kalibracja nie mierzyła tej samej karty.
PROTO_TEXT = ("In principio erat uerbum et uerbum erat apud deum et deus erat uerbum hoc erat in principio "
              "apud deum omnia per ipsum facta sunt et sine ipso factum est nihil quod factum est in ipso uita erat")
CALIB_TEXT = ("Liber generationis iesu christi filii dauid filii abraham abraham genuit isaac isaac autem genuit "
              "iacob iacob autem genuit iudam et fratres eius iudas autem genuit phares et zaram de thamar")


# --------------------------------------------------------------------------- obraz -> maski

def load_gray(path: str, max_width: int, crop):
    """Wczytuje skan (opcjonalnie kadr x0,y0,x1,y1 w pikselach oryginału) i skaluje do max_width."""
    img = Image.open(path).convert("RGB")
    if crop:
        img = img.crop(crop)
    if img.width > max_width:
        img = img.resize((max_width, round(img.height * max_width / img.width)), Image.Resampling.LANCZOS)
    rgb = np.asarray(img).astype(np.float32) / 255.0
    gray = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    return rgb, gray


def page_mask(gray: np.ndarray, raw: bool = False):
    """Karta = największy jasny obszar; odcina czarne tło i grzbiet. Lekko zwężona od brzegu.

    Z raw=True zwraca też maskę niezwężoną (do pomiaru krawędzi karty)."""
    bright = gray > filters.threshold_otsu(gray)
    # otwarcie rozcina wąskie mostki jasności (np. styk z poprzednią kartą w grzbiecie)
    bright = ndimage.binary_opening(bright, iterations=max(2, int(0.004 * max(gray.shape))))
    lab, n = ndimage.label(bright)
    if n == 0:
        full = np.ones_like(gray, dtype=bool)
        return (full, full) if raw else full
    sizes = ndimage.sum(bright, lab, range(1, n + 1))
    page = lab == (int(np.argmax(sizes)) + 1)
    page = ndimage.binary_fill_holes(page)
    margin = max(3, int(0.012 * max(gray.shape)))
    inner = ndimage.binary_erosion(page, iterations=margin)
    return (inner, page) if raw else inner


def find_gutters(band: np.ndarray, left: int, right: int):
    """Grzbiet między kartami: wyraźny dołek jasności przy brzegu maski karty.

    Pasek poprzedniej (albo następnej) karty jest równie jasny jak karta, więc maska z progu
    Otsu skleja go z nią; rozdziela je dopiero ciemniejszy cień grzbietu. Szuka się dołka w
    skrajnych 8% szerokości: głębszego o 0.06 od jasności po obu stronach."""
    prof = ndimage.uniform_filter1d(np.median(band, axis=0), 5)
    span = max(10, int(0.08 * (right - left)))
    found_l = found_r = False

    def dip(lo, hi):
        """Najgłębszy dołek w [lo, hi) albo None."""
        if hi - lo < 9:
            return None
        k = lo + int(np.argmin(prof[lo:hi]))
        side_a = prof[max(lo, k - span):k].max(initial=0.0) if k > lo else 0.0
        side_b = prof[k + 1:min(hi + span, len(prof))].max(initial=0.0)
        return k if min(side_a, side_b) - prof[k] > 0.06 else None

    k = dip(left, left + span)
    if k is not None:
        left, found_l = k, True
    k = dip(right - span, right + 1)
    if k is not None:
        right, found_r = k, True
    return left, right, found_l, found_r


def page_layout(gray, page_raw, text_ink, centers, xh, pitch):
    """Geometria karty w jednostkach Calamusa (patrz Layout w compose.ts)."""
    units = XH_UNITS / xh
    rows = np.flatnonzero(page_raw.any(axis=1))
    cols = np.flatnonzero(page_raw.any(axis=0))
    top, bottom = int(rows[0]), int(rows[-1])
    # krawędź pionowa: kolumna, w której karta zajmuje choć 30% wysokości (postrzępiony brzeg)
    col_fill = page_raw.sum(axis=0) / max(1, bottom - top)
    solid = np.flatnonzero(col_fill > 0.3)
    left, right = (int(solid[0]), int(solid[-1])) if len(solid) else (int(cols[0]), int(cols[-1]))
    left, right, gutter_l, gutter_r = find_gutters(gray[top:bottom + 1], left, right)
    starts, ends = [], []
    for c in centers:
        band = text_ink[max(0, int(c - xh / 2)):int(c + xh / 2) + 1, left:right + 1]
        idx = np.flatnonzero(band.any(axis=0))
        if len(idx) > 3:
            # glosa na marginesie (np. odsyłacze kanonów) jest oddzielona od tekstu przerwą
            # szerszą niż 3 wysokości x - liczy się tylko najdłuższy ciągły odcinek wiersza
            parts = np.split(idx, np.flatnonzero(np.diff(idx) > 3 * xh) + 1)
            main_part = max(parts, key=len)
            starts.append(left + int(main_part[0]))
            ends.append(left + int(main_part[-1]))
    text_l = float(np.median(starts)) if starts else left + 0.1 * (right - left)
    text_r = float(np.median(ends)) if ends else right - 0.1 * (right - left)
    first_base = (centers[0] + xh / 2) if centers else top + 0.15 * (bottom - top)
    last_base = (centers[-1] + xh / 2) if centers else bottom - 0.15 * (bottom - top)
    thr = filters.threshold_otsu(gray)

    def side_kind(region):
        """Co leży obok karty: jasne = sąsiednia karta, ciemne = blat."""
        return "page" if region.size and float(np.median(region)) > thr else "table"

    band_rows = slice(top, bottom + 1)
    left_kind = "page" if gutter_l else side_kind(gray[band_rows, :left])
    right_kind = "page" if gutter_r else side_kind(gray[band_rows, right + 1:])
    lay = {
        "pageW": round((right - left) * units, 1),
        "pageH": round((bottom - top) * units, 1),
        "marginL": round(max(0.0, text_l - left) * units, 1),
        "marginR": round(max(0.0, right - text_r) * units, 1),
        "marginT": round(max(0.0, (first_base - top) * units - FIRST_BASELINE_OFFSET), 1),
        "marginB": round(max(0.0, bottom - last_base) * units, 1),
        "lineSpacing": round(pitch / xh, 3) if pitch else 2.56,
        "maxLines": len(centers),
        # ujemne = widać, co leży po lewej (cały pas obrazu przed kartą)
        "leftEdge": round(-left * units, 1),
        "leftKind": left_kind,
        "rightEdge": round((gray.shape[1] - 1 - right) * units, 1),
        "rightKind": right_kind,
    }
    return lay


def ink_masks(rgb: np.ndarray, gray: np.ndarray, page: np.ndarray):
    """Atrament (próg lokalny Sauvoli) i rubryka (czerwień) w obrębie karty."""
    window = max(25, (min(gray.shape) // 40) | 1)
    thr = filters.threshold_sauvola(gray, window_size=window, k=0.2)
    ink = (gray < thr) & page
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    rubric = ink & (r - np.maximum(g, b) > 0.16)
    ink = morphology.remove_small_objects(ink, max_size=24)
    ink = morphology.remove_small_holes(ink, max_size=12)
    return ink, rubric


# --------------------------------------------------------------------------- wiersze, wysokość x

def text_lines(ink: np.ndarray):
    """Wiersze z profilu poziomego. Zwraca (środki wierszy, wysokość x, odstęp wierszy)."""
    rows = ink.sum(axis=1).astype(float)
    if rows.max() <= 0:
        return [], 0.0, 0.0
    smooth = ndimage.gaussian_filter1d(rows, sigma=max(2.0, ink.shape[0] / 600))
    # wstępny odstęp z autokorelacji profilu
    ac = np.correlate(smooth - smooth.mean(), smooth - smooth.mean(), mode="full")[len(smooth) - 1:]
    lo = max(8, ink.shape[0] // 200)
    ac_peaks, _ = signal.find_peaks(ac[lo:])
    pitch = float(ac_peaks[0] + lo) if len(ac_peaks) else ink.shape[0] / 20
    peaks, _ = signal.find_peaks(smooth, distance=max(4, int(pitch * 0.6)), height=smooth.max() * 0.15)
    bands = []
    for pk in peaks:
        half = smooth[pk] * 0.5
        a = pk
        while a > 0 and smooth[a] > half:
            a -= 1
        b = pk
        while b < len(smooth) - 1 and smooth[b] > half:
            b += 1
        bands.append(b - a)
    xh = float(np.median(bands)) if bands else pitch * 0.35
    return list(peaks), xh, pitch


def space_ratio(ink: np.ndarray, centers, xh: float) -> float:
    """Udział przerw szerszych niż 0.3 x w długości zapisanych wierszy."""
    gaps_total = 0.0
    span_total = 0.0
    for c in centers:
        a, b = int(c - xh * 0.5), int(c + xh * 0.5)
        band = ink[max(0, a):max(1, b)]
        cols = band.any(axis=0)
        idx = np.flatnonzero(cols)
        if len(idx) < 2:
            continue
        cols = cols[idx[0]:idx[-1] + 1]
        span_total += len(cols)
        run = 0
        for v in cols:
            if not v:
                run += 1
            else:
                if run > 0.3 * xh:
                    gaps_total += run
                run = 0
    return gaps_total / span_total if span_total else 0.0


# --------------------------------------------------------------------------- szkielet -> odcinki

NEIGH = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def skeleton_paths(ink: np.ndarray, min_len: int):
    """Szkielet atramentu pocięty na rozgałęzieniach i ułożony w ciągi punktów (wiersz, kolumna)."""
    skel = morphology.skeletonize(ink)
    deg = ndimage.convolve(skel.astype(np.uint8), np.ones((3, 3), np.uint8), mode="constant") - 1
    simple = skel & (deg <= 2)
    lab, n = ndimage.label(simple, structure=np.ones((3, 3)))
    objs = ndimage.find_objects(lab)
    paths = []
    for k in range(n):
        sl = objs[k]
        sub = lab[sl] == (k + 1)
        pts = np.argwhere(sub)
        if len(pts) < min_len:
            continue
        pts = pts + np.array([sl[0].start, sl[1].start])
        ptset = {(int(r), int(c)) for r, c in pts}
        # koniec ścieżki = punkt z jednym sąsiadem; pętla - dowolny punkt
        start = None
        for r, c in ptset:
            if sum((r + dr, c + dc) in ptset for dr, dc in NEIGH) == 1:
                start = (r, c)
                break
        if start is None:
            start = next(iter(ptset))
        order = [start]
        seen = {start}
        cur = start
        while True:
            nxt = None
            for dr, dc in NEIGH:
                cand = (cur[0] + dr, cur[1] + dc)
                if cand in ptset and cand not in seen:
                    nxt = cand
                    break
            if nxt is None:
                break
            order.append(nxt)
            seen.add(nxt)
            cur = nxt
        if len(order) >= min_len:
            paths.append(np.array(order, dtype=float))
    return paths


def stroke_samples(paths, dist: np.ndarray, xh: float):
    """Kierunek (stopnie, 0..180, y w dół), grubość i krzywizna wzdłuż odcinków."""
    k = max(2, int(round(0.12 * xh)))
    thetas, widths, verticals = [], [], []
    wobble = []
    turn_sum = 0.0
    length_sum = 0.0
    for p in paths:
        if len(p) < 2 * k + 3:
            continue
        # drżenie: drobne wahania wokół gładkiego przebiegu (sigma 0.25 x)
        coarse = ndimage.gaussian_filter1d(p, sigma=max(2.0, 0.25 * xh), axis=0)
        fine = ndimage.gaussian_filter1d(p, sigma=1.0, axis=0)
        wobble.append((float(np.mean(np.hypot(*(fine - coarse).T))), len(p)))
        p = fine
        d = p[2 * k:] - p[:-2 * k]           # cięciwa o długości 2k
        ang = np.degrees(np.arctan2(d[:, 0], d[:, 1])) % 180.0   # atan2(dy, dx), y = wiersz w dół
        mid = p[k:-k]
        w = 2.0 * dist[mid[:, 0].astype(int), mid[:, 1].astype(int)] - 1.0
        # bez końców odcinka: tam transformata odległości zaniża grubość
        core = slice(k, max(k + 1, len(ang) - k))
        thetas.extend(ang[core])
        widths.extend(w[core])
        # obrót kierunku (z kierunkiem, nie mod 180) na jednostkę długości
        full = np.arctan2(d[:, 0], d[:, 1])
        dth = np.abs(np.angle(np.exp(1j * np.diff(full))))
        turn_sum += float(dth.sum())
        length_sum += float(len(d))
        # pion: prosty odcinek bliski pionu, dłuższy niż pół wysokości x
        chord = p[-1] - p[0]
        span = math.hypot(chord[0], chord[1])
        if span > 0.5 * xh and span > 0.85 * len(p):
            th = math.degrees(math.atan2(chord[0], chord[1])) % 180.0
            # tylko prawie piony: przy 55..125 łapały się ukośne kreski v, x, a i zaniżały pochył
            if 70 <= th <= 110:
                verticals.append((th - 90.0, span))
    tremor = (sum(v * n for v, n in wobble) / sum(n for _, n in wobble) / xh) if wobble else 0.0
    return np.array(thetas), np.array(widths), verticals, (turn_sum / length_sum * xh) if length_sum else 0.0, tremor


def fit_nib(thetas: np.ndarray, widths: np.ndarray):
    """Kąt i szerokość stalówki: szerokość = max(włoskowa, W*|sin(kierunek - nib)|)."""
    if len(thetas) < 50:
        return float("nan"), float("nan"), float("nan")
    keep = widths > 0.5
    th, w = np.radians(thetas[keep]), widths[keep]
    hair = float(np.percentile(w, 12))
    best = (float("inf"), 0.0, 0.0)
    for a_deg in range(0, 180):
        s = np.abs(np.sin(th - math.radians(a_deg)))
        sel = s > 0.35
        if sel.sum() < 20:
            continue
        big_w = float((w[sel] * s[sel]).sum() / (s[sel] ** 2).sum())
        pred = np.maximum(hair, big_w * s)
        loss = float(np.mean((w - pred) ** 2))
        if loss < best[0]:
            best = (loss, float(a_deg), big_w)
    loss, a_deg, big_w = best
    # jakość dopasowania: o ile model z kątem jest lepszy od stałej grubości
    base = float(np.var(w)) or 1.0
    # kąt w obrazie (y w dół) -> kąt kaligraficzny jak w hands.ts: dodatni = krawędź
    # wznosi się w prawo; wynik w przedziale (-90, 90]
    nib_cal = (-a_deg + 90.0) % 180.0 - 90.0
    if nib_cal == -90.0:
        nib_cal = 90.0
    return nib_cal, big_w, 1.0 - loss / base


def weighted_median(pairs):
    """Mediana ważona długością (pary wartość, waga)."""
    if not pairs:
        return float("nan")
    pairs = sorted(pairs)
    total = sum(wt for _, wt in pairs)
    acc = 0.0
    for val, wt in pairs:
        acc += wt
        if acc >= total / 2:
            return val
    return pairs[-1][0]


def measure(rgb, gray, debug_dir=None, label="scan", is_render=False):
    """Pełny potok na jednym obrazie. Zwraca (cechy, miary pomocnicze, kontekst dla kształtów)."""
    if is_render:
        page = page_raw = np.ones_like(gray, dtype=bool)
    else:
        page, page_raw = page_mask(gray, raw=True)
    ink, rubric = ink_masks(rgb, gray, page) if not is_render else (gray < 0.5, np.zeros_like(gray, dtype=bool))
    text_ink = ink & ~rubric
    centers, xh, pitch = text_lines(text_ink)
    if xh <= 3:
        raise ValueError("Nie znaleziono wierszy tekstu - za mało atramentu albo zły kadr.")
    dist = ndimage.distance_transform_edt(text_ink)
    paths = skeleton_paths(text_ink, min_len=max(6, int(0.3 * xh)))
    thetas, widths, verticals, turn, tremor = stroke_samples(paths, dist, xh)
    nib, big_w, fit_q = fit_nib(thetas, widths)
    feats = {
        "nib": nib,
        "weight": big_w / xh if math.isfinite(big_w) else float("nan"),
        "slant": weighted_median(verticals),
        "turn": turn,
        "space": space_ratio(text_ink, centers, xh),
        "tremor": tremor,
    }
    info = {
        "x_height_px": round(xh, 1),
        "line_pitch_px": round(pitch, 1),
        "lines": len(centers),
        "segments": len(paths),
        "samples": int(len(thetas)),
        "verticals": len(verticals),
        "nib_fit_quality": round(fit_q, 3),
        "rubric_share": round(float(rubric.sum()) / max(1, int(ink.sum())), 4),
    }
    if not is_render:
        info["layout"] = page_layout(gray, page_raw, text_ink, centers, xh, pitch)
    if debug_dir:
        write_debug(debug_dir, label, gray, text_ink, rubric, paths, centers, xh)
    ctx = {"ink": text_ink, "centers": centers, "xh": xh}
    return feats, info, ctx


def write_debug(debug_dir, label, gray, ink, rubric, paths, centers, xh):
    """Podgląd: atrament szaro, rubryka czerwono, odcinki szkieletu kolorami, wiersze."""
    os.makedirs(debug_dir, exist_ok=True)
    base = np.stack([gray * 255] * 3, axis=-1).astype(np.uint8)
    base[ink] = (base[ink] * 0.4).astype(np.uint8)
    base[rubric] = (200, 40, 30)
    img = Image.fromarray(base)
    draw = ImageDraw.Draw(img)
    for c in centers:
        draw.line([(0, c - xh / 2), (img.width, c - xh / 2)], fill=(40, 120, 200), width=1)
        draw.line([(0, c + xh / 2), (img.width, c + xh / 2)], fill=(40, 120, 200), width=1)
    palette = [(230, 160, 0), (0, 170, 90), (170, 60, 200), (0, 150, 210)]
    for i, p in enumerate(paths):
        draw.line([(float(c), float(r)) for r, c in p], fill=palette[i % len(palette)], width=1)
    out = os.path.join(debug_dir, f"{label}_overlay.png")
    img.save(out)
    print(f"[*] Podgląd analizy: {os.path.abspath(out)}")


# --------------------------------------------------------------------------- prototypy rąk

def load_engine():
    """Importuje src/scriptorium/engine.py (interpreter LOGO) jako moduł."""
    spec = importlib.util.spec_from_file_location("calamus_engine", ENGINE)
    mod = importlib.util.module_from_spec(spec)
    # dataclasses szukają modułu w sys.modules - bez rejestracji import się wywraca
    sys.modules["calamus_engine"] = mod
    spec.loader.exec_module(mod)
    return mod


def run_cli(cmd: str, opts=None) -> str:
    """Woła calamus-cli.mjs - ten sam kod TypeScript co aplikacja."""
    args = ["node", CLI, cmd] + ([json.dumps(opts)] if opts is not None else [])
    res = subprocess.run(args, cwd=APP_DIR, capture_output=True, text=True, check=False, timeout=180)
    if res.returncode != 0:
        raise RuntimeError(f"calamus-cli {cmd} nie powiódł się:\n{res.stderr[-2000:]}")
    return res.stdout


def render_logo(program: str, engine, px_per_unit: float = 1.0, with_origin: bool = False):
    """Rasteryzuje program LOGO szerokim piórem (te same wielokąty co engine.ribbon)."""
    prog = engine.parse(program)
    xs = [p.x for s in prog.ink for p in s.pts]
    ys = [p.y for s in prog.ink for p in s.pts]
    pad = 20
    minx, miny = min(xs) - pad, min(ys) - pad
    w = int((max(xs) - minx + pad) * px_per_unit)
    h = int((max(ys) - miny + pad) * px_per_unit)
    img = Image.new("L", (w, h), 255)
    draw = ImageDraw.Draw(img)
    for s in prog.ink:
        if s.color == "rubric":
            continue      # inicjał rubryką nie wchodzi do pomiaru tekstu, jak przy skanie
        left, right = [], []
        for p in s.pts:
            (x0, y0), (x1, y1) = engine._ends(p, s.weight)  # pylint: disable=protected-access
            left.append(((x0 - minx) * px_per_unit, (y0 - miny) * px_per_unit))
            right.append(((x1 - minx) * px_per_unit, (y1 - miny) * px_per_unit))
        # wielokąt kreski i dodatkowo czworoboki między kolejnymi pozycjami - kreska bez dziur
        for i in range(1, len(left)):
            draw.polygon([left[i - 1], left[i], right[i], right[i - 1]], fill=0)
        if len(left) == 1:
            draw.line([left[0], right[0]], fill=0, width=1)
    gray = np.asarray(img).astype(np.float32) / 255.0
    rgb = np.stack([gray] * 3, axis=-1)
    if with_origin:
        return rgb, gray, (minx, miny)
    return rgb, gray


def hand_page(hand_id: str, text: str, engine, year=None):
    """Karta napisana daną ręką, zrasteryzowana; zwraca (rgb, gray)."""
    opts = {"text": text, "hand": hand_id, "abbreviate": False, "rubric": False}
    if year is not None:
        opts["year"] = year
    program = run_cli("logo", opts)
    # 1.4 px na jednostkę: wysokość x ok. 57 px, podobnie jak skan po przeskalowaniu
    return render_logo(program, engine, px_per_unit=1.4)


def build_prototypes(rebuild: bool):
    """Mierzy każdą rękę z hands.ts tym samym potokiem co skan. Wynik w hand_prototypes.json."""
    if os.path.exists(PROTO_CACHE) and not rebuild:
        with open(PROTO_CACHE, encoding="utf-8") as fh:
            return json.load(fh)
    engine = load_engine()
    hands = json.loads(run_cli("hands"))
    protos = []
    for h in hands:
        rgb, gray = hand_page(h["id"], PROTO_TEXT, engine)
        feats, info, _ = measure(rgb, gray, is_render=True)
        protos.append({"id": h["id"], "name": h["name"], "years": h["years"],
                       "true": {k: h[k] for k in ("nib", "weight", "slant", "angular", "wordGap", "continua")},
                       "features": feats, "info": info})
        print(f"[*] prototyp {h['id']:<22} nib {feats['nib']:5.1f} (model {h['nib']})  "
              f"weight {feats['weight']:.3f} (model {h['weight']})  slant {feats['slant']:5.1f} (model {h['slant']})")
    with open(PROTO_CACHE, "w", encoding="utf-8") as fh:
        json.dump(protos, fh, indent=1, ensure_ascii=False)
    print(f"[*] Prototypy zapisane: {PROTO_CACHE}")
    return protos


def feature_scales(protos):
    """Skala każdej cechy = rozrzut między prototypami (żeby żadna cecha nie dominowała)."""
    scales = {}
    for k in FEATURES:
        vals = np.array([p["features"][k] for p in protos], dtype=float)
        vals = vals[np.isfinite(vals)]
        scales[k] = float(np.std(vals)) if len(vals) > 1 and np.std(vals) > 1e-6 else 1.0
    return scales


def distance(feats, proto_feats, scales) -> float:
    """Odległość ważona skalami; kąt stalówki liczony po okręgu (mod 180)."""
    acc = 0.0
    for k in FEATURES:
        a, b = feats.get(k, float("nan")), proto_feats.get(k, float("nan"))
        if not (np.isfinite(a) and np.isfinite(b)):
            continue
        d = a - b
        if k == "nib":
            d = (d + 90) % 180 - 90
        acc += (d / scales[k]) ** 2
    return math.sqrt(acc)


def rank(feats, protos):
    """Prototypy posortowane od najbliższego."""
    scales = feature_scales(protos)
    scored = [(distance(feats, p["features"], scales), p) for p in protos]
    scored.sort(key=lambda it: it[0])
    return scored


DIRECT = ("nib", "weight", "slant")


def regressions(protos):
    """Dla nib, weight, slant: parametr modelu = a * pomiar + b (najmniejsze kwadraty po prototypach)."""
    out = {}
    for k in DIRECT:
        x = np.array([p["features"][k] for p in protos], dtype=float)
        y = np.array([p["true"][k] for p in protos], dtype=float)
        ok = np.isfinite(x)
        a, b = np.polyfit(x[ok], y[ok], 1)
        pred = a * x[ok] + b
        ss_res = float(((y[ok] - pred) ** 2).sum())
        ss_tot = float(((y[ok] - y[ok].mean()) ** 2).sum()) or 1.0
        out[k] = {"a": float(a), "b": float(b), "r2": 1.0 - ss_res / ss_tot,
                  "rmse": math.sqrt(ss_res / ok.sum())}
    return out


def mean_features(all_feats):
    """Średnia cech z kilku skanów; kąt stalówki uśredniany po okręgu (mod 180)."""
    out = {}
    for k in FEATURES:
        vals = np.array([f[k] for f in all_feats], dtype=float)
        vals = vals[np.isfinite(vals)]
        if vals.size == 0:
            out[k] = float("nan")
        elif k == "nib":
            z = np.exp(2j * np.radians(vals)).mean()
            out[k] = float(np.degrees(np.angle(z)) / 2)
        else:
            out[k] = float(vals.mean())
    return out


def derive_hand(feats, protos, hands, name, label, base_id=None):
    """Ręka do GUI: nib/weight/slant z regresji; reszta z ręki bazowej (--base) albo ważona z 3 najbliższych prototypów."""
    reg = regressions(protos)
    ranked = rank(feats, protos)[:3]
    if base_id:
        # ranking na prawdziwych skanach bywa niewiarygodny, więc kształty liter, skróty i
        # krąg można wziąć z ręki wskazanej przez użytkownika, a nie z "najbliższej"
        chosen = [p for p in protos if p["id"] == base_id]
        if not chosen:
            raise ValueError(f"Nieznana ręka bazowa '{base_id}'. Dostępne: {', '.join(p['id'] for p in protos)}")
        ranked = [(1.0, chosen[0])]
    weights = [1.0 / max(1e-3, d) ** 2 for d, _ in ranked]
    by_id = {h["id"]: h for h in hands}
    base = by_id[ranked[0][1]["id"]]
    hand = dict(base)
    numeric = [k for k, v in base.items() if isinstance(v, (int, float)) and not isinstance(v, bool)]
    for k in numeric:
        hand[k] = sum(w * by_id[p["id"]][k] for w, (_, p) in zip(weights, ranked)) / sum(weights)
    hand["years"] = [round(sum(w * by_id[p["id"]]["years"][i] for w, (_, p) in zip(weights, ranked)) / sum(weights))
                     for i in (0, 1)]
    measured = {}
    for k in DIRECT:
        if np.isfinite(feats[k]):
            measured[k] = reg[k]["a"] * feats[k] + reg[k]["b"]
            hand[k] = measured[k]
    hand["weight"] = float(np.clip(hand["weight"], 0.05, 0.4))
    hand["id"] = f"skan-{label}"
    hand["name"] = name or f"Ze skanu: {label}"
    hand["latin"] = "ex imagine"
    hand["blurb"] = (f"Skalibrowane ze skanu ({label}). Zmierzone: stalówka {hand['nib']:.0f}°, "
                     f"szerokość {hand['weight']:.3f} wysokości x, pochył {hand['slant']:.1f}°. "
                     f"Reszta (kształty liter, skróty) z najbliższych rąk: "
                     + ", ".join(p["name"] for _, p in ranked) + ". To przybliżenie, nie ekspertyza.")
    hand["calibration"] = {"features": feats, "regression": reg, "nearest": [p["id"] for _, p in ranked]}
    return hand


# --------------------------------------------------------------------------- krok 2: kształty liter

def shape_descriptor(crop: np.ndarray, baseline_row: float, xh_px: float):  # pylint: disable=unused-argument
    """Szkielet kawałka atramentu w stałej skali (wysokość x = SHAPE_XH px), wyśrodkowany.

    Szkielet zamiast plamy: rozlany atrament skanu i cienka stalówka generatora dają wtedy
    ten sam opis. Kawałek jest centrowany w pionie po własnym obrysie, a nie po linii
    bazowej: linia bazowa z profilu wiersza myli się o kilka pikseli, a falowanie wiersza
    dokłada swoje, i to przesunięcie zjadało całe dopasowanie (2/12 trafień na kartach
    generowanych zamiast 9/12). Ceną jest słabsze odróżnianie p od d i q od b - wysokość
    i skala zostają, położenie względem linii nie. baseline_row zostaje w podpisie na wypadek
    powrotu do wyrównania po linii, gdy jej pomiar będzie dokładniejszy.
    Zwraca znormalizowany wektor albo None, gdy kawałek nic nie zawiera."""
    k = SHAPE_XH / xh_px
    z = ndimage.zoom(crop.astype(np.float32), k, order=1) > 0.35
    if z.sum() < 4:
        return None
    sk = ndimage.binary_dilation(morphology.skeletonize(z), iterations=1)
    canvas = np.zeros((SHAPE_N, SHAPE_N), dtype=np.float32)
    h, w = sk.shape
    r0 = int(round(SHAPE_N / 2 - h / 2))
    c0 = int(round(SHAPE_N / 2 - w / 2))
    rs, cs = max(0, -r0), max(0, -c0)
    re_, ce = min(h, SHAPE_N - r0), min(w, SHAPE_N - c0)
    if re_ <= rs or ce <= cs:
        return None
    canvas[r0 + rs:r0 + re_, c0 + cs:c0 + ce] = sk[rs:re_, cs:ce]
    vec = ndimage.gaussian_filter(canvas, 1.5).ravel()
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm > 0 else None


def glyph_bank(engine):
    """Opisy kształtów wszystkich liter wszystkich rąk (calamus-cli glyphs)."""
    bank = json.loads(run_cli("glyphs"))
    ppu = 1.4
    rows, labels = [], []
    for hand_id, letters in bank.items():
        for ch, program in letters.items():
            _, gray, (_, miny) = render_logo(program, engine, px_per_unit=ppu, with_origin=True)
            mask = gray < 0.5
            base_px = (DEFAULT_MARGIN_T + FIRST_BASELINE_OFFSET - miny) * ppu
            # Litera tnie się tak samo jak skan - na spójne kawałki atramentu. Kreski glifu
            # nie zawsze się stykają (n to dwie laski i łuk), więc kawałek skanu bywa jedną
            # kreską; porównanie z całą literą karało wtedy właściwą rękę.
            lab, _ = ndimage.label(mask, structure=np.ones((3, 3)))
            for i, sl in enumerate(ndimage.find_objects(lab)):
                if sl is None or (sl[0].stop - sl[0].start) < 0.3 * XH_UNITS * ppu:
                    continue
                vec = shape_descriptor(lab[sl] == (i + 1), base_px - sl[0].start, XH_UNITS * ppu)
                if vec is not None:
                    rows.append(vec)
                    labels.append((hand_id, ch))
    return np.array(rows), labels


def ink_pieces(ctx, limit=1500, seed=0):
    """Kawałki atramentu wielkości litery, przypisane do wiersza: (opis, kadr do podglądu)."""
    ink, centers, xh = ctx["ink"], ctx["centers"], ctx["xh"]
    lab, _ = ndimage.label(ink, structure=np.ones((3, 3)))
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if sl is None:
            continue
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        # od pojedynczej kreski (laska ma ok. 0.15 x szerokości) do litery z ligaturą
        if not (0.6 * xh <= h <= 3.6 * xh and 0.1 * xh <= w <= 2.0 * xh):
            continue
        best, base = 0.0, None
        for c in centers:
            ov = min(sl[0].stop, c + xh / 2) - max(sl[0].start, c - xh / 2)
            if ov > best:
                best, base = ov, c + xh / 2
        if base is None or best < 0.3 * xh:
            continue
        crop = lab[sl] == (i + 1)
        vec = shape_descriptor(crop, base - sl[0].start, xh)
        if vec is not None:
            out.append((vec, crop))
    if len(out) > limit:
        rng = np.random.default_rng(seed)
        out = [out[j] for j in sorted(rng.choice(len(out), limit, replace=False))]
    return out


def shape_rank(ctx, bank, debug_dir=None, label="scan"):
    """Ranking rąk po kształtach liter: średnia najlepszej odległości kawałków od liter ręki."""
    vecs, labels = bank
    pieces = ink_pieces(ctx)
    if not pieces:
        return [], 0
    x = np.array([p[0] for p in pieces])
    dist = 1.0 - x @ vecs.T                    # odległość kosinusowa: kawałek x litera
    hands = sorted({h for h, _ in labels})
    cols = {h: [j for j, (hh, _) in enumerate(labels) if hh == h] for h in hands}
    per_hand = np.stack([dist[:, cols[h]].min(axis=1) for h in hands], axis=1)
    # liczą się kawałki najbardziej literopodobne (połowa najlepiej dopasowanych w ogóle):
    # pozostałe to ligatury, plamy i zlepki, które żadnej ręce nie pasują
    best_any = per_hand.min(axis=1)
    keep = best_any <= np.median(best_any)
    score = per_hand[keep].mean(axis=0)
    votes = np.bincount(per_hand[keep].argmin(axis=1), minlength=len(hands))
    ranking = sorted(({"id": h, "shape": float(score[k]), "votes": int(votes[k])} for k, h in enumerate(hands)),
                     key=lambda r: r["shape"])
    if debug_dir:
        write_letters(debug_dir, label, pieces, dist, labels, keep, ranking[0]["id"], vecs)
    return ranking, int(keep.sum())


def write_letters(debug_dir, label, pieces, dist, labels, keep, top_hand, vecs):
    """Podgląd: kawałek skanu (szkielet) obok najlepszej litery zwycięskiej ręki."""
    os.makedirs(debug_dir, exist_ok=True)
    cols = [j for j, (h, _) in enumerate(labels) if h == top_hand]
    sub = dist[:, cols]
    order = [i for i in np.argsort(sub.min(axis=1)) if keep[i]][:60]
    cell = SHAPE_N * 2 + 6
    img = Image.new("L", (cell * 6, (SHAPE_N + 16) * ((len(order) + 5) // 6)), 255)
    draw = ImageDraw.Draw(img)
    for n, i in enumerate(order):
        j = cols[int(np.argmin(sub[i]))]
        x0, y0 = (n % 6) * cell, (n // 6) * (SHAPE_N + 16)
        for k, vec in enumerate((pieces[i][0], vecs[j])):
            tile = vec.reshape(SHAPE_N, SHAPE_N)
            tile = (255 - 255 * tile / max(1e-6, tile.max())).astype(np.uint8)
            img.paste(Image.fromarray(tile), (x0 + k * SHAPE_N, y0))
        draw.text((x0 + 2, y0 + SHAPE_N + 2), f"{labels[j][1]}  {sub[i].min():.2f}", fill=0)
    out = os.path.join(debug_dir, f"{label}_letters.png")
    img.save(out)
    print(f"[*] Podgląd liter (skan | litera ręki {top_hand}): {os.path.abspath(out)}")


def combined_rank(feats, protos, shapes):
    """Ranking łączny: odległość cech i odległość kształtów, każda przeskalowana do 0..1."""
    feat = {p["id"]: d for d, p in rank(feats, protos)}
    shp = {r["id"]: r["shape"] for r in shapes}

    def scaled(m):
        lo, hi = min(m.values()), max(m.values())
        return {k: (v - lo) / (hi - lo) if hi > lo else 0.0 for k, v in m.items()}

    fs, ss = scaled(feat), scaled(shp) if shp else {}
    by_id = {p["id"]: p for p in protos}
    rows = [(fs[k] + ss.get(k, fs[k]), by_id[k]) for k in fs]
    rows.sort(key=lambda it: it[0])
    return rows


def calibrate(protos, bank=None):
    """Karty generowane innym tekstem: czy potok odzyskuje parametry i rozpoznaje rękę."""
    engine = load_engine()
    hits = 0
    shape_hits = 0
    print(f"{'ręka':<22} {'nib zmierz/model':>17} {'weight':>14} {'slant':>12}  rozpoznana jako")
    for p in protos:
        rgb, gray = hand_page(p["id"], CALIB_TEXT, engine)
        feats, _, ctx = measure(rgb, gray, is_render=True)
        top = rank(feats, protos)[0][1]
        if bank is not None:
            shapes, _ = shape_rank(ctx, bank)
            top_shape = shapes[0]["id"] if shapes else "?"
            shape_hits += top_shape == p["id"]
            top = combined_rank(feats, protos, shapes)[0][1]
        ok = top["id"] == p["id"]
        hits += ok
        t = p["true"]
        print(f"{p['id']:<22} {feats['nib']:7.1f} / {t['nib']:<7} {feats['weight']:6.3f}/{t['weight']:<6} "
              f"{feats['slant']:5.1f}/{t['slant']:<5}  {top['id']}{'' if ok else '  <-- pomyłka'}")
    print(f"[*] Trafność na kartach generowanych: {hits}/{len(protos)}"
          + ("  (ranking łączny: cechy + kształty liter)" if bank is not None else ""))
    if bank is not None:
        print(f"[*] Same kształty liter: {shape_hits}/{len(protos)}")
    print("[*] Regresja pomiar -> parametr modelu (używana przez --hand-out):")
    for k, r in regressions(protos).items():
        print(f"    {k:<7} model = {r['a']:.3f} * pomiar + {r['b']:.3f}   R² {r['r2']:.2f}   błąd średni {r['rmse']:.3f}")
    return hits, len(protos)


# --------------------------------------------------------------------------- CLI

def parse_crop(text: str):
    """'x0,y0,x1,y1' -> krotka int."""
    parts = [int(v) for v in text.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("kadr: x0,y0,x1,y1")
    return tuple(parts)


def main(argv=None) -> int:
    """Punkt wejścia CLI."""
    parser = argparse.ArgumentParser(description="Skan rękopisu -> cechy duktu -> najbliższa epoka Calamusa.")
    parser.add_argument("images", nargs="*", help="skan(y) (np. manuscript_pages/page_0014.jpg); kilka = średnia cech")
    parser.add_argument("--crop", type=parse_crop, help="kadr x0,y0,x1,y1 w pikselach oryginału")
    parser.add_argument("--max-width", type=int, default=2400, help="szerokość robocza w px (domyślnie 2400)")
    parser.add_argument("--debug-dir", help="katalog na podgląd analizy (PNG)")
    parser.add_argument("--json", help="zapisz wynik do pliku JSON")
    parser.add_argument("--rebuild-prototypes", action="store_true", help="przelicz prototypy rąk z hands.ts")
    parser.add_argument("--calibrate", action="store_true", help="sprawdź potok na kartach generowanych")
    parser.add_argument("--hand-out", help="zapisz rękę skalibrowaną ze skanu(ów) jako JSON do wczytania w GUI")
    parser.add_argument("--min-quality", type=float, default=0.15,
                        help="pomiń w średniej skany z nib_fit_quality poniżej progu (tablice kanonów, ornament); domyślnie 0.15")
    parser.add_argument("--base", help="ręka bazowa dla parametrów niemierzonych (np. przedkarolinska, insularna); "
                                       "domyślnie zwycięzca rankingu łącznego (z --no-shapes: średnia 3 najbliższych)")
    parser.add_argument("--name", help="nazwa ręki w GUI (domyślnie 'Ze skanu: <plik>')")
    parser.add_argument("--no-shapes", action="store_true", help="bez kroku 2 (porównania kształtów liter)")
    args = parser.parse_args(argv)

    if not args.images and not args.calibrate:
        parser.error("podaj skan albo --calibrate")

    protos = build_prototypes(args.rebuild_prototypes)
    bank = None if args.no_shapes else glyph_bank(load_engine())
    if args.calibrate:
        calibrate(protos, bank)
    if not args.images:
        return 0

    all_feats, all_layouts, all_ctx = [], [], []
    for image in args.images:
        rgb, gray = load_gray(image, args.max_width, args.crop)
        label = os.path.splitext(os.path.basename(image))[0]
        feats, info, ctx = measure(rgb, gray, debug_dir=args.debug_dir, label=label)
        print(f"\n[+] {image}")
        # strona bez ciągłego tekstu (tablice kanonów, ornament, miniatura) daje model pióra
        # gorszy niż stała grubość - jej cechy nie mówią nic o ręce i psują średnią
        if len(args.images) > 1 and info["nib_fit_quality"] < args.min_quality:
            print(f"    [!] pominięta w średniej: nib_fit_quality {info['nib_fit_quality']} < {args.min_quality} "
                  "(raczej nie ciągły tekst)")
        else:
            all_feats.append(feats)
            all_layouts.append(info["layout"])
            all_ctx.append((ctx, label))
        for k, v in info.items():
            print(f"    {k}: {v}")
        print("    cechy: " + ", ".join(f"{k}={feats[k]:.3f}" for k in FEATURES))

    if not all_feats:
        print("[!] Żaden skan nie przeszedł progu jakości - obniż --min-quality albo wybierz strony z tekstem.")
        return 1
    feats = mean_features(all_feats) if len(all_feats) > 1 else all_feats[0]
    if len(all_feats) > 1:
        print(f"\n[+] średnia z {len(all_feats)} z {len(args.images)} skanów: " + ", ".join(f"{k}={feats[k]:.3f}" for k in FEATURES))
    print("\n    ranking cech duktu (odległość, mniej = bliżej):")
    ranking = rank(feats, protos)
    for d, p in ranking[:6]:
        f = p["features"]
        print(f"    {d:6.2f}  {p['name']:<34} {p['years'][0]}-{p['years'][1]}   "
              f"nib {f['nib']:5.1f}  weight {f['weight']:.3f}  slant {f['slant']:5.1f}  turn {f['turn']:.2f}  space {f['space']:.3f}  tremor {f['tremor']:.3f}")

    shapes = []
    if bank is not None:
        per_scan = [shape_rank(ctx, bank, args.debug_dir, label) for ctx, label in all_ctx]
        totals = {}
        for ranking_s, _ in per_scan:
            for r in ranking_s:
                acc = totals.setdefault(r["id"], {"id": r["id"], "shape": 0.0, "votes": 0})
                acc["shape"] += r["shape"] / len(per_scan)
                acc["votes"] += r["votes"]
        shapes = sorted(totals.values(), key=lambda r: r["shape"])
        names = {p["id"]: p for p in protos}
        used = sum(n for _, n in per_scan)
        print(f"\n    ranking kształtów liter ({used} kawałków atramentu; odległość 0..1, głosy = najlepsza ręka kawałka):")
        for r in shapes[:6]:
            p = names[r["id"]]
            print(f"    {r['shape']:6.3f}  {p['name']:<34} {p['years'][0]}-{p['years'][1]}   głosy {r['votes']}")
        print("\n    ranking łączny (cechy + kształty, 0 = najlepszy w obu):")
        for d, p in combined_rank(feats, protos, shapes)[:6]:
            print(f"    {d:6.2f}  {p['name']:<34} {p['years'][0]}-{p['years'][1]}")

    layout = {}
    for key in all_layouts[0]:
        vals = [lay[key] for lay in all_layouts]
        layout[key] = (round(float(np.median(vals)), 2) if isinstance(vals[0], (int, float))
                       else max(set(vals), key=vals.count))
    layout["maxLines"] = int(round(layout["maxLines"]))
    print(f"\n    karta (jednostki Calamusa, wys. x = {XH_UNITS:.1f} j.): "
          + ", ".join(f"{k}={v}" for k, v in layout.items()))

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({"images": args.images, "features": feats, "layout": layout, "shapes": shapes,
                       "ranking": [{"id": p["id"], "distance": d} for d, p in ranking]}, fh, indent=1, ensure_ascii=False)
        print(f"[*] Wynik: {os.path.abspath(args.json)}")
    if args.hand_out:
        label = os.path.splitext(os.path.basename(args.images[0]))[0] + (f"+{len(args.images) - 1}" if len(args.images) > 1 else "")
        base = args.base
        if not base and shapes:
            # bez --base: ręka bazowa = zwycięzca rankingu łącznego (cechy + kształty liter)
            base = combined_rank(feats, protos, shapes)[0][1]["id"]
        hand = derive_hand(feats, protos, json.loads(run_cli("hands")), args.name, label, base)
        hand["layout"] = layout
        os.makedirs(os.path.dirname(os.path.abspath(args.hand_out)), exist_ok=True)
        with open(args.hand_out, "w", encoding="utf-8") as fh:
            json.dump(hand, fh, indent=1, ensure_ascii=False)
        print(f"\n[+] Ręka do GUI: {hand['name']}  nib {hand['nib']:.1f}°  weight {hand['weight']:.3f}  "
              f"slant {hand['slant']:.1f}°  lata {hand['years'][0]}-{hand['years'][1]}  baza: {base or 'średnia 3 najbliższych'}")
        print(f"[*] Zapisano: {os.path.abspath(args.hand_out)}  - wczytaj w aplikacji: Epoka -> 'Ręka ze skanu'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
