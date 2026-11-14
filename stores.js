// Find each chain's Herzliya branches from its newest store list.
// Herzliya's government locality code is 6400; some chains write the city as that code instead of a name.
const fs = require("fs"), path = require("path");
const { CHAINS } = require("./chains");
const only = process.argv[2];
const out = {};
(async () => {
  for (const [key, c] of Object.entries(CHAINS)) {
    if (only && key !== only) continue;
    try {
      const site = c.site(), names = await site.list();
      const st = names.filter(n => /^stores/i.test(n)).sort((a, b) => b.split("-").pop().localeCompare(a.split("-").pop()))[0];
      if (!st) { console.log(key, "no store list among", names.length, "files"); continue }
      const x = await site.get(st);
      const stores = [...x.matchAll(/<(Store|STORE|Branch)>([\s\S]*?)<\/\1>/g)].map(m => { const g = t => ((m[2].match(new RegExp(`<${t}>([^<]*)</${t}>`, "i")) || [])[1] || "").trim(); return { id: g("StoreId") || g("StoreID"), name: g("StoreName"), city: g("City"), addr: g("Address") } });
      const hz = stores.filter(s => /הרצלי/.test(s.city + s.name + s.addr) || s.city === "6400");
      out[key] = hz;
      console.log(`\n${c.he}: ${names.length} files, ${stores.length} stores, Herzliya:`);
      for (const s of hz) console.log(`  ${s.id} | ${s.name} | ${s.city} | ${s.addr}`);
    } catch (e) { console.log(key, "ERR", e.message) }
  }
  fs.writeFileSync(path.join(__dirname, "herzliya-stores.json"), JSON.stringify(out, null, 1));
})();
