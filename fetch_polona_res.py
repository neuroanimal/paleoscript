#!/usr/bin/env python3
# pylint: disable=line-too-long,too-many-locals
"""
Pobiera wybrane strony dzieła z Polony (Biblioteka Narodowa) przez manifest IIIF v3.

Dzieło wskazuje się UUID-em albo dowolnym adresem z Polony, który go zawiera.
Strony wskazuje się numerem kolejnym skanu (1 = pierwszy skan w manifeście)
albo etykietą folio z manifestu (np. 1r, 12v).

Przykłady (domyślnie: kodeks biblijny NT, [Niemcy, ca 701-800], strona 14 -
karta z wielkim inicjałem XPI):

    python3 fetch_polona_res.py
    python3 fetch_polona_res.py c8acfe1a-d1e2-43db-9894-818a9533ad5c 14
    python3 fetch_polona_res.py https://polona.pl/item-view/c8acfe1a-d1e2-43db-9894-818a9533ad5c 14 15 20-22
    python3 fetch_polona_res.py c8acfe1a-d1e2-43db-9894-818a9533ad5c --folio 1r 1v
    python3 fetch_polona_res.py c8acfe1a-d1e2-43db-9894-818a9533ad5c 14 --size 2000,
    python3 fetch_polona_res.py c8acfe1a-d1e2-43db-9894-818a9533ad5c --list
"""

import argparse
import os
import re
import sys

import requests
from requests.exceptions import JSONDecodeError, RequestException

# Dzieło zahardkodowane we wcześniejszej wersji skryptu - teraz tylko wartość domyślna
DEFAULT_UUID = "c8acfe1a-d1e2-43db-9894-818a9533ad5c"
DEFAULT_PAGE = "14"

UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json'
}


def extract_uuid(work: str) -> str:
    """Zwraca UUID dzieła z gołego UUID-a albo z adresu Polony."""
    match = UUID_RE.search(work)
    if not match:
        raise ValueError(f"Nie znaleziono UUID-a dzieła w: {work}")
    return match.group(0).lower()


def first_value(lang_map) -> str:
    """Pierwsza wartość z mapy językowej IIIF v3 ({"pl": ["..."]}) albo pusty napis."""
    if isinstance(lang_map, dict):
        for values in lang_map.values():
            if values:
                return str(values[0])
    return ""


def fetch_manifest(uuid: str):
    """Pobiera i parsuje manifest IIIF v3 dzieła. Zwraca dict albo None przy błędzie."""
    # 1. Prawdziwy, zweryfikowany adres manifestu JSON
    manifest_url = f"https://polona.pl/api/search-index/search/iiif/{uuid}/manifest.json"

    print("[*] Pobieranie manifestu IIIF v3...")
    try:
        response = requests.get(manifest_url, headers=HEADERS, timeout=15)
        response.raise_for_status()
    except RequestException as e:
        print(f"[!] Błąd połączenia sieciowego podczas odpytywania API: {e}")
        return None

    # 2. Bezpieczne parsowanie struktury JSON
    try:
        return response.json()
    except JSONDecodeError:
        print("[!] Błąd: Serwer nie zwrócił prawidłowego formatu JSON.")
        return None


def describe(manifest_data) -> None:
    """Wypisuje metadane dzieła (tytuł, datowanie, opis fizyczny)."""
    for entry in manifest_data.get("metadata", []):
        label = first_value(entry.get("label"))
        if label in ("Tytuł ujednolicony", "Tytuł", "Adres wydawniczy", "Opis fizyczny", "Język"):
            print(f"    {label}: {first_value(entry.get('value'))}")


def parse_pages(specs: list[str], total: int) -> list[int]:
    """Zamienia ['14', '20-22'] na listę numerów 1-based, sprawdzając zakres."""
    pages: list[int] = []
    for spec in specs:
        for part in spec.split(","):
            part = part.strip()
            if not part:
                continue
            if "-" in part:
                lo, hi = (int(x) for x in part.split("-", 1))
                pages.extend(range(lo, hi + 1))
            else:
                pages.append(int(part))
    bad = [p for p in pages if p < 1 or p > total]
    if bad:
        raise ValueError(f"Strony spoza zakresu 1-{total}: {bad}")
    return pages


def pages_from_folios(folios: list[str], canvases) -> list[int]:
    """Zamienia etykiety folio (np. 1r) na numery 1-based według etykiet płócien."""
    labels = [first_value(c.get("label")).strip().lower() for c in canvases]
    pages = []
    for folio in folios:
        key = folio.strip().lower()
        if key not in labels:
            raise ValueError(f"Brak folio '{folio}' w manifeście (użyj --list)")
        pages.append(labels.index(key) + 1)
    return pages


def image_url(target_canvas, size: str) -> tuple[str, dict]:
    """Zwraca adres obrazu dla płótna w żądanym rozmiarze IIIF oraz sekcję body."""
    # 4. Parsowanie głębokiego drzewa zagnieżdżeń IIIF v3
    # Droga w JSON: canvas -> items (AnnotationPage) -> items (Annotation) -> body -> id
    annotation_pages = target_canvas.get("items", [])
    if not annotation_pages:
        raise KeyError("Brak sekcji 'items' (AnnotationPage) w wybranym płótnie.")

    annotations = annotation_pages[0].get("items", [])
    if not annotations:
        raise KeyError("Brak sekcji 'items' (Annotation) w wybranej karcie adnotacji.")

    body = annotations[0].get("body", {})
    original_img_url = body.get("id")

    if not original_img_url:
        raise KeyError("Nie odnaleziono parametru 'id' wewnątrz sekcji 'body'.")

    # 5. Podmiana wymiaru na 'max', aby serwer Cantaloupe wydał plik źródłowy w 100% jakości
    # Zmieniamy segment '/full/full/' na '/full/<size>/' (domyślnie 'max'; np. '2000,' = szerokość 2000 px)
    if "/full/full/" in original_img_url:
        return original_img_url.replace("/full/full/", f"/full/{size}/"), body
    return original_img_url, body


def download_polona_page_v3(manifest_data, page_number: int, output_dir: str = "manuscript_pages",
                            size: str = "max", uuid: str = DEFAULT_UUID) -> bool:
    """
    Pobiera konkretną stronę manuskryptu z Polony w maksymalnej rozdzielczości
    na podstawie struktury manifestu IIIF v3.

    :param manifest_data: Sparsowany manifest dzieła
    :param page_number: Numer strony do pobrania (indeksowany od 1)
    :param output_dir: Katalog zapisu pobranych skanów
    :param size: Rozmiar IIIF ('max', '2000,' = szerokość, ',3000' = wysokość, 'pct:25')
    :param uuid: UUID dzieła - pierwsze 8 znaków trafia do nazwy pliku
    """
    # 3. Wyciąganie listy płócien (canvases)
    canvases = manifest_data.get("items", [])
    # Wybieramy żądany arkusz (indeksowanie od zera)
    target_canvas = canvases[page_number - 1]
    folio = first_value(target_canvas.get("label")) or "?"

    try:
        high_res_url, body = image_url(target_canvas, size)
    except (KeyError, IndexError, TypeError) as struct_err:
        print(f"[!] Błąd podczas dekodowania struktury JSON: {struct_err}")
        return False

    # 6. Przygotowanie systemu plików i pobieranie binarne strumieniem
    os.makedirs(output_dir, exist_ok=True)
    safe_folio = re.sub(r"[^0-9A-Za-z]+", "_", folio).strip("_") or "x"
    file_path = os.path.join(output_dir, f"{uuid[:8]}_page_{page_number:04d}_f{safe_folio}.jpg")

    print(f"[*] Strona {page_number} (folio {folio}) - pobieranie grafiki z: {high_res_url}")
    try:
        # Zwiększony timeout (45s), ponieważ pliki o wysokości rzędu 9500+ px generują duże opóźnienia na serwerze
        img_response = requests.get(high_res_url, headers=HEADERS, stream=True, timeout=45)
        img_response.raise_for_status()

        # Pomiary pobierania dużego strumienia w paczkach (32KB)
        with open(file_path, "wb") as f:
            for chunk in img_response.iter_content(chunk_size=32768):
                if chunk:
                    f.write(chunk)

        print("[+] Sukces! Zdjęcie zostało pomyślnie zrzucone na dysk.")
        print(f"[*] Lokalizacja pliku: {os.path.abspath(file_path)}")
        print(f"[*] Wymiary zadeklarowane w API: {body.get('width')} x {body.get('height')} pikseli.")
        print(f"[*] Realny rozmiar pobranego pliku: {os.path.getsize(file_path) / (1024*1024):.2f} MB")
        return True

    except RequestException as img_err:
        print(f"[!] Błąd krytyczny połączenia podczas pobierania binarnego pliku graficznego: {img_err}")
        return False


def main(argv=None) -> int:
    """Punkt wejścia CLI."""
    parser = argparse.ArgumentParser(
        description="Pobiera wybrane strony dzieła z Polony (IIIF v3).",
        epilog=f"Przykład (dotychczasowe ustawienie na sztywno): %(prog)s {DEFAULT_UUID} {DEFAULT_PAGE}",
    )
    parser.add_argument("work", nargs="?", default=DEFAULT_UUID,
                        help=f"UUID dzieła albo adres z Polony (domyślnie {DEFAULT_UUID})")
    parser.add_argument("pages", nargs="*",
                        help=f"numery skanów 1-based: 14, 20-22, 3,5,7 (domyślnie {DEFAULT_PAGE})")
    parser.add_argument("--folio", nargs="+", default=[], help="etykiety folio zamiast numerów, np. 1r 1v")
    parser.add_argument("-o", "--output-dir", default="manuscript_pages", help="katalog zapisu")
    parser.add_argument("--size", default="max",
                        help="rozmiar IIIF: max (domyślnie), '2000,' (szerokość), ',3000', 'pct:25'")
    parser.add_argument("--list", action="store_true", help="wypisz strony i folio, nic nie pobieraj")
    args = parser.parse_args(argv)

    try:
        uuid = extract_uuid(args.work)
    except ValueError as err:
        print(f"[!] {err}")
        return 2

    manifest_data = fetch_manifest(uuid)
    if manifest_data is None:
        return 1

    canvases = manifest_data.get("items", [])
    total_pages = len(canvases)
    if total_pages == 0:
        print("[!] Błąd: Tablica 'items' w manifeście jest pusta.")
        return 1

    print(f"[+] Serwer potwierdził obecność dokumentu. Łączna liczba stron: {total_pages}")
    describe(manifest_data)

    if args.list:
        for i, canvas in enumerate(canvases, 1):
            print(f"{i:5d}  {first_value(canvas.get('label'))}  ({canvas.get('width')}x{canvas.get('height')})")
        return 0

    try:
        if args.folio:
            pages = pages_from_folios(args.folio, canvases)
        else:
            pages = parse_pages(args.pages or [DEFAULT_PAGE], total_pages)
    except ValueError as err:
        print(f"[!] Błąd: {err}")
        return 2

    failed = 0
    for page in pages:
        if not download_polona_page_v3(manifest_data, page, args.output_dir, args.size, uuid):
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    # Bez argumentów: strona 14 (część z wielkim inicjałem XPI) kodeksu domyślnego
    sys.exit(main())
