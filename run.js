// Nightly job: download each chain's newest full price file for its Herzliya branch,
// and shrink them into one small file the app can read (prices.json).
// Kept: barcoded products sold in at least two of the chains (the fair comparison),
// and every chain's weighed produce by name (produce has store-internal codes, not barcodes).
// Usage: node run.js [outDir]  — a chain that fails is reported and skipped; the rest still run.
const fs = require("fs"), path = require("path");
const { CHAINS } = require("./chains");

// One branch per chain. Yochananof has no Herzliya branch; Ramat HaSharon is the nearest.
const BRANCH = { shufersal: 374, tivtaam: 52, carrefour: 461, ramilevy: 715, yochananof: 26, victory: 74 };
const OUT = process.argv[2] || path.join(__dirname, "out");

const tag = (s, t) => ((s.match(new RegExp(`<${t}>([^<]*)</${t}>`, "i")) || [])[1] || "").trim();
const storeOf = n => { const m = n.match(/^pricefull\d+-\d+-(\d+)-(\d+)/i); return m && { store: +m[1], date: m[2] } };

async function fetchChain(key) {
  const site = CHAINS[key].site(), names = await site.list();
  const file = names.map(n => ({ n, s: storeOf(n) })).filter(f => f.s && f.s.store === BRANCH[key])
    .sort((a, b) => b.s.date.localeCompare(a.s.date))[0];
  if (!file) throw new Error(`no full price file for branch ${BRANCH[key]} among ${names.length} files`);
  const x = await site.get(file.n);
  const items = [...x.matchAll(/<(Item|Product)>([\s\S]*?)<\/\1>/gi)].map(m => ({
    code: tag(m[2], "ItemCode"), name: tag(m[2], "ItemName").replace(/\s+/g, " "), price: +tag(m[2], "ItemPrice"),
    weighed: tag(m[2], "bIsWeighted") === "1", unit: tag(m[2], "UnitOfMeasure"),
  })).filter(i => i.code && i.price > 0);
  return { file: file.n, date: file.s.date, items };
}

(async () => {
  const got = {}, problems = {};
  for (const key of Object.keys(CHAINS)) {
    const t = Date.now();
    try { got[key] = await fetchChain(key); console.log(`${CHAINS[key].he}: ${got[key].items.length} items (${got[key].file}) ${((Date.now() - t) / 1000).toFixed(1)}s`) }
    catch (e) { problems[key] = e.message; console.log(`${CHAINS[key].he}: FAILED ${e.message}`) }
  }
  const keys = Object.keys(got);
  // Barcodes: real ones are long; short codes are store-internal and mean different things in each chain.
  const byCode = {};
  keys.forEach((k, ci) => { for (const i of got[k].items) if (i.code.length >= 8 && !i.weighed) (byCode[i.code] ||= { n: i.name, p: Array(keys.length).fill(null) }).p[ci] = i.price });
  const items = {};
  for (const [c, v] of Object.entries(byCode)) if (v.p.filter(x => x != null).length >= 2) items[c] = [v.n, ...v.p];
  const produce = {};
  keys.forEach(k => { produce[k] = got[k].items.filter(i => i.weighed).map(i => [i.name, i.price]) });
  const result = {
    updated: new Date().toISOString(), chains: keys.map(k => ({ key: k, he: CHAINS[k].he, branch: BRANCH[k], file: got[k].file })),
    failed: problems, items, produce,
  };
  fs.mkdirSync(OUT, { recursive: true });
  const json = JSON.stringify(result);
  fs.writeFileSync(path.join(OUT, "prices.json"), json);
  console.log(`\nprices.json: ${(json.length / 1024).toFixed(0)} KB, ${Object.keys(items).length} shared barcodes, produce ${keys.map(k => `${k}:${produce[k].length}`).join(" ")}`);
  if (keys.length < 2) process.exit(1);
})();
