// Nightly job: download each chain's newest full price file for its Herzliya branch,
// and shrink them into one small file the app can read (prices.json).
// Kept: barcoded products sold in at least two of the chains (the fair comparison),
// and every chain's weighed produce by name (produce has store-internal codes, not barcodes).
// Usage: node run.js [outDir]  — a chain that fails is reported and skipped; the rest still run.
// On GitHub, PC_FILE points at the home PC's upload (pc.json.gz): Carrefour and Victory block
// cloud servers, so their prices come from there instead (see pc-run.js).
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const { CHAINS } = require("./chains");

// One branch per chain. Yochananof has no Herzliya branch; Ramat HaSharon is the nearest.
const BRANCH = { shufersal: 374, tivtaam: 52, carrefour: 461, ramilevy: 715, yochananof: 26, victory: 74 };
const FROM_PC = ["carrefour", "victory"];
const STALE_DAYS = 3;

const tag = (s, t) => ((s.match(new RegExp(`<${t}>([^<]*)</${t}>`, "i")) || [])[1] || "").trim();
const storeOf = n => { const m = n.match(/^pricefull\d+-\d+-(\d+)-(\d+)/i); return m && { store: +m[1], date: m[2] } };

// Items are kept as [code, name, price, weighed] so the PC upload stays small.
async function fetchChain(key) {
  const site = CHAINS[key].site(), names = await site.list();
  const file = names.map(n => ({ n, s: storeOf(n) })).filter(f => f.s && f.s.store === BRANCH[key])
    .sort((a, b) => b.s.date.localeCompare(a.s.date))[0];
  if (!file) throw new Error(`no full price file for branch ${BRANCH[key]} among ${names.length} files`);
  const x = await site.get(file.n);
  const items = [...x.matchAll(/<(Item|Product)>([\s\S]*?)<\/\1>/gi)]
    .map(m => [tag(m[2], "ItemCode"), tag(m[2], "ItemName").replace(/\s+/g, " "), +tag(m[2], "ItemPrice"), tag(m[2], "bIsWeighted") === "1" ? 1 : 0])
    .filter(i => i[0] && i[2] > 0);
  return { file: file.n, date: file.s.date, items };
}

async function main(out) {
  const got = {}, problems = {}, warnings = {};
  const pc = process.env.PC_FILE && fs.existsSync(process.env.PC_FILE) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(process.env.PC_FILE))) : null;
  for (const key of Object.keys(CHAINS)) {
    const t = Date.now();
    if (process.env.PC_FILE && FROM_PC.includes(key)) {
      const c = pc && pc.chains[key];
      if (!c) { problems[key] = "no data from the home PC yet"; console.log(`${CHAINS[key].he}: FAILED ${problems[key]}`); continue }
      got[key] = c;
      const days = (Date.now() - Date.parse(pc.made)) / 864e5;
      if (days > STALE_DAYS) warnings[key] = `home PC data is ${days.toFixed(1)} days old`;
      console.log(`${CHAINS[key].he}: ${c.items.length} items from the home PC (${c.file}, uploaded ${pc.made})`);
      continue;
    }
    try { got[key] = await fetchChain(key); console.log(`${CHAINS[key].he}: ${got[key].items.length} items (${got[key].file}) ${((Date.now() - t) / 1000).toFixed(1)}s`) }
    catch (e) { problems[key] = e.message; console.log(`${CHAINS[key].he}: FAILED ${e.message}`) }
  }
  const keys = Object.keys(got);
  // Barcodes: real ones are long; short codes are store-internal and mean different things in each chain.
  const byCode = {};
  keys.forEach((k, ci) => { for (const [code, name, price, w] of got[k].items) if (code.length >= 8 && !w) (byCode[code] ||= { n: name, p: Array(keys.length).fill(null) }).p[ci] = price });
  const items = {};
  for (const [c, v] of Object.entries(byCode)) if (v.p.filter(x => x != null).length >= 2) items[c] = [v.n, ...v.p];
  const produce = {};
  keys.forEach(k => { produce[k] = got[k].items.filter(i => i[3]).map(i => [i[1], i[2]]) });
  const result = {
    updated: new Date().toISOString(),
    // date: when the chain published the file (yyyymmdd), so the app can say how fresh each chain's prices are.
    chains: keys.map(k => ({ key: k, he: CHAINS[k].he, branch: BRANCH[k], file: got[k].file, date: got[k].date })),
    failed: problems, warnings, items, produce,
  };
  fs.mkdirSync(out, { recursive: true });
  const json = JSON.stringify(result);
  fs.writeFileSync(path.join(out, "prices.json"), json);
  console.log(`\nprices.json: ${(json.length / 1024).toFixed(0)} KB, ${Object.keys(items).length} shared barcodes, produce ${keys.map(k => `${k}:${produce[k].length}`).join(" ")}`);
  if (keys.length < 2) process.exit(1);
}

module.exports = { BRANCH, FROM_PC, fetchChain };
if (require.main === module) main(process.argv[2] || path.join(__dirname, "out"));
