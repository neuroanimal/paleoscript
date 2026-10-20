#!/usr/bin/env node
/**
 * Calamus z linii komend - ten sam kod co w aplikacji (src/scriptorium/*.ts), bez przeglądarki.
 *
 * Vite ładuje moduły TypeScript przez ssrLoadModule, więc nie trzeba osobnego kompilatora
 * ani dodatkowych zależności. Serwer Vite startuje w trybie middleware, bez portu.
 *
 *   node scripts/calamus-cli.mjs hands
 *       wypisuje HANDS jako JSON (parametry rąk - używa ich recognize_scan.py)
 *   node scripts/calamus-cli.mjs compose '{"text":"Christi autem","hand":"karolinska"}'
 *       wypisuje JSON: transkrypcja wyrazów, skróty i program LOGO
 *   node scripts/calamus-cli.mjs logo '{"text":"...","hand":"tekstualis"}' > strona.cal
 *   node scripts/calamus-cli.mjs glyphs
 *       JSON {ręka: {litera: program LOGO}} - pojedyncze litery każdej ręki (wzorce kształtów
 *       dla recognize_scan.py); linia bazowa w y = marginT + 86 = 164
 *       sam program LOGO (do src/scriptorium/engine.py)
 *
 * Pola opcji compose (domyślne w nawiasie): text, hand (tekstualis), year (środek epoki ręki),
 * lang (la), genre (religijne), culture (krąg ręki), ortho (true), abbreviate (true),
 * rubric (true), density (1), caps (zrodlo | zdanie | brak), incipit (0), layout ({} - pola Layout).
 */
import { createServer } from "vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const [cmd = "hands", json = "{}"] = process.argv.slice(2);
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    resolve: { alias: { "@": join(root, "src") } },
  });
  try {
    const hands = await server.ssrLoadModule("/src/scriptorium/hands.ts");
    if (cmd === "hands") {
      process.stdout.write(JSON.stringify(hands.HANDS, null, 1) + "\n");
      return;
    }
    const { compose } = await server.ssrLoadModule("/src/scriptorium/compose.ts");
    if (cmd === "glyphs") {
      const alphabet = [..."abcdefghilmnopqrstuxſ", "ꝛ"];
      const out = {};
      for (const hand of hands.HANDS) {
        out[hand.id] = {};
        for (const ch of alphabet) {
          const page = compose({
            text: ch === "ꝛ" ? "or" : ch,
            hand,
            year: hands.midYear(hand),
            lang: "la",
            genre: "religijne",
            culture: hand.culture,
            ortho: false,
            abbreviate: false,
            rubric: false,
            study: null,
          });
          // "ꝛ" (r rotunda) powstaje tylko po o - bierzemy całe "or", kształt i tak się różni od r
          out[hand.id][ch] = page.logo;
        }
      }
      process.stdout.write(JSON.stringify(out) + "\n");
      return;
    }
    const o = JSON.parse(json);
    const hand = hands.handById(o.hand ?? "tekstualis");
    const page = compose({
      text: o.text ?? "Pater noster qui es in caelis",
      hand,
      year: o.year ?? hands.midYear(hand),
      lang: o.lang ?? "la",
      genre: o.genre ?? "religijne",
      culture: o.culture ?? hand.culture,
      ortho: o.ortho ?? true,
      abbreviate: o.abbreviate ?? true,
      rubric: o.rubric ?? true,
      study: null,
      density: o.density ?? 1,
      caps: o.caps ?? "zrodlo",
      incipit: o.incipit ?? 0,
      layout: o.layout ?? {},
    });
    if (cmd === "logo") {
      process.stdout.write(page.logo + "\n");
      return;
    }
    const out = {
      hand: hand.id,
      transformed: page.transformed,
      written: page.words.map((w) => w.shown).join(" "),
      abbrs: page.abbrs.map((a) => `${a.shown} = ${a.expansion} (${a.system})`),
      strokes: page.draws.length,
    };
    process.stdout.write(JSON.stringify(out, null, 1) + "\n");
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
