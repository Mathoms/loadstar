// Audit: for every pool.query(`...$n...`, [ ...values ]) call in the project,
// verify the highest $n placeholder matches the number of array items.
// Run: node ci/check-sql-params.mjs   (exits 1 on any mismatch)
import fs from "node:fs";
import path from "node:path";

const roots = ["api/src", "worker", "worker-browser"];
let failures = 0, checked = 0;

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.name.endsWith(".js") || e.name.endsWith(".mjs")) yield p;
  }
}

/** Split a JS array-literal body into top-level items (respects nesting/strings). */
function countTopLevelItems(body) {
  let depth = 0, items = 0, sawToken = false, inStr = null, esc = false;
  for (const ch of body) {
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === "\\") esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; sawToken = true; continue; }
    if ("([{".includes(ch)) { depth++; sawToken = true; continue; }
    if (")]}".includes(ch)) { depth--; continue; }
    if (ch === "," && depth === 0) { if (sawToken) items++; sawToken = false; continue; }
    if (!/\s/.test(ch)) sawToken = true;
  }
  if (sawToken) items++;
  return items;
}

for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const file of files(root)) {
    const src = fs.readFileSync(file, "utf8");
    const re = /pool\.query\(\s*(?:`([^`]*)`|"([^"]*)")\s*,\s*\[/g;
    let m;
    while ((m = re.exec(src))) {
      const sql = m[1] ?? m[2];
      const ph = [...sql.matchAll(/\$(\d+)/g)].map((x) => Number(x[1]));
      const maxPh = ph.length ? Math.max(...ph) : 0;
      // capture the array literal starting at the `[` we just matched
      let i = re.lastIndex - 1, depth = 0, start = i;
      for (; i < src.length; i++) {
        if (src[i] === "[") depth++;
        else if (src[i] === "]") { depth--; if (depth === 0) break; }
      }
      const items = countTopLevelItems(src.slice(start + 1, i));
      checked++;
      const line = src.slice(0, m.index).split("\n").length;
      if (maxPh !== items) {
        failures++;
        console.error(`✗ ${file}:${line} — SQL expects $${maxPh} params but array has ${items}`);
        console.error(`  ${sql.replace(/\s+/g, " ").slice(0, 110)}…`);
      }
    }
  }
}

console.log(`${checked} parameterized queries checked, ${failures} mismatch(es).`);
process.exit(failures ? 1 : 0);
