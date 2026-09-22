// Prüft, dass das Inline-Skript der SPA syntaktisch gültig ist — die App ist
// eine einzelne HTML-Datei, ein Tippfehler würde sonst erst im Browser auffallen.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const file = process.argv[2] || "app/index.html";
const html = readFileSync(file, "utf8");

const blocks = [];
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html))) blocks.push(m[1]);

if (!blocks.length) { console.error(`FAIL  kein Inline-Skript in ${file}`); process.exit(1); }

let fails = 0;
blocks.forEach((code, i) => {
  try {
    new vm.Script(code, { filename: `${file}#script${i + 1}` });
    console.log(`  OK  Inline-Skript ${i + 1} (${code.length} Zeichen) syntaktisch gültig`);
  } catch (e) {
    console.error(`FAIL  Inline-Skript ${i + 1}: ${e.message}`);
    fails++;
  }
});
process.exit(fails ? 1 : 0);
