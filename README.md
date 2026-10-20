# paleoscript

Generowanie i rozpoznawanie pisma średniowiecznego szerokim piórem, na zasadzie LOGO
(pióro w górze / w dole, kąt stalówki, skręt, nacisk). Epoki od merowińskiej do antykwy,
przejścia między nimi, diachronia pisowni i skróty zależne od epoki, kręgu i gatunku tekstu.

Punkt wyjścia: aplikacja zbudowana przez Groka (`draw_script/`), dalej rozwijana.

## Części

| ścieżka | co to jest |
|---|---|
| `draw_script/` | aplikacja „Calamus” (TypeScript, React, TanStack Start, Vite) - generator i GUI |
| `draw_script/src/scriptorium/` | rdzeń: ręce (`hands.ts`), glify, pisownia i skróty (`shape.ts`), skład, rozpoznawanie |
| `draw_script/src/scriptorium/engine.py` | interpreter programów pióra (LOGO) → SVG, bez zależności |
| `draw_script/scripts/calamus-cli.mjs` | ten sam kod TS z linii komend (ręce jako JSON, program LOGO) |
| `fetch_polona_res.py` | pobieranie stron z Polony (IIIF v3) |
| `recognize_scan.py` | skan → kreski → cechy duktu → ranking epok i ręka do GUI |

## Uruchomienie

```bash
cd draw_script && npm ci && npm run dev        # http://localhost:8080/
pip install -r requirements.txt                # dla skryptów Pythona

python3 fetch_polona_res.py c8acfe1a-d1e2-43db-9894-818a9533ad5c 14 21
python3 recognize_scan.py manuscript_pages/c8acfe1a_page_0021_f4r.jpg \
    --hand-out scan_analysis/f4r_hand.json --base merowinska
```

Wersja statyczna (sam generator w przeglądarce, bez serwera) jest na GitHub Pages:
https://neuroanimal.github.io/paleoscript/ - budowana przez `.github/workflows/pages.yml`
z `draw_script/pages/` (`npm run build:pages`). Skrypty Pythona działają tylko lokalnie.

Rękę z `--hand-out` wczytuje się w GUI przyciskiem „Ręka ze skanu (.json)”; razem z nią
wczytuje się geometria karty (format, marginesy, interlinia, poprzednia karta / blat obok).
`recognize_scan.py --calibrate` sprawdza potok na kartach wygenerowanych przez Calamusa.

Skany (`manuscript_pages/`) i wyniki analizy nie są w repozytorium - patrz `.gitignore`.

Rozpoznawanie to przybliżenie dydaktyczne, nie ekspertyza paleograficzna.
