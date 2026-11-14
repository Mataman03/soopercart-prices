// How to list and download price files from each chain's site.
// Four kinds of site cover the six chains: the shared Cerberus portal (Tiv Taam, Rami Levy, Yochananof),
// Shufersal's own site, Carrefour's own site, and Victory's laibcatalog.
const zlib = require("zlib");

// A price file can arrive as gzip, as zip, or plain, in UTF-8 or UTF-16.
function toText(b) {
  if (b[0] === 0x50 && b[1] === 0x4b) b = unzipFirst(b);
  if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b);
  if (b[0] === 0xff && b[1] === 0xfe) return b.slice(2).toString("utf16le");
  let s = b.toString("utf8");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (b[1] === 0 && b[3] === 0) s = b.toString("utf16le");
  return s;
}

// The first file inside a zip, read through the central directory (sizes in local headers may be zero).
function unzipFirst(b) {
  let e = b.length - 22;
  while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("bad zip");
  const cd = b.readUInt32LE(e + 16);
  const method = b.readUInt16LE(cd + 10), size = b.readUInt32LE(cd + 20), local = b.readUInt32LE(cd + 42);
  const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
  const data = b.slice(start, start + size);
  return method === 8 ? zlib.inflateRawSync(data) : data;
}

const bytes = async (url, opt) => { const r = await fetch(url, opt); if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()) };

// Cerberus: log in with the chain's public user name and an empty password, then list everything.
function cerberus(user) {
  const BASE = "https://url.publishedprices.co.il";
  let jar = {}, tok;
  const keep = r => { for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1) } };
  const cookie = () => Object.entries(jar).map(([k, v]) => k + "=" + v).join("; ");
  const csrf = h => (h.match(/name="csrftoken" content="([^"]+)"/) || [])[1];
  return {
    async list() {
      let r = await fetch(BASE + "/login"); keep(r); tok = csrf(await r.text());
      r = await fetch(BASE + "/login/user", { method: "POST", redirect: "manual", headers: { cookie: cookie(), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: user, password: "", Submit: "Sign in", csrftoken: tok }) }); keep(r);
      r = await fetch(BASE + "/file", { headers: { cookie: cookie() } }); keep(r); tok = csrf(await r.text()) || tok;
      r = await fetch(BASE + "/file/json/dir", { method: "POST", headers: { cookie: cookie(), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ sEcho: "1", iDisplayStart: "0", iDisplayLength: "100000", sSearch: "", mDataProp_1: "typeLabel", cd: "/", csrftoken: tok }) });
      return (await r.json()).aaData.map(f => f.name);
    },
    get: async name => toText(await bytes(BASE + "/file/d/" + encodeURIComponent(name), { headers: { cookie: cookie() } })),
  };
}

// Shufersal: a paged HTML table per category, with short-lived links to Azure storage.
// Categories: 2 PriceFull, 5 Stores.
function shufersal() {
  const links = {};
  return {
    async list() {
      for (const cat of [2, 5]) for (let page = 1; page < 40; page++) {
        const h = await (await fetch(`https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=${cat}&storeId=0&page=${page}`)).text();
        const found = [...h.matchAll(/href="(https:\/\/pricesprodpublic[^"]+)"/g)].map(m => m[1].replace(/&amp;/g, "&"));
        if (!found.length) break;
        for (const u of found) links[decodeURIComponent(u.split("?")[0].split("/").pop())] = u;
      }
      return Object.keys(links);
    },
    get: async name => toText(await bytes(links[name])),
  };
}

// Carrefour: one page lists today's files in a script block; files live under /<yyyymmdd>/.
function carrefour() {
  let dir;
  return {
    async list() {
      const h = await (await fetch("https://prices.carrefour.co.il/")).text();
      dir = (h.match(/const path = '(\d+)'/) || [])[1];
      return [...new Set([...h.matchAll(/((?:PriceFull|Stores)[0-9A-Za-z_-]+\.(?:gz|xml|zip))/g)].map(m => m[1]))];
    },
    get: async name => toText(await bytes(`https://prices.carrefour.co.il/${dir}/${name}`)),
  };
}

// Victory: a JSON list of files, each downloadable by name.
function laib(chain) {
  return {
    list: async () => (await (await fetch(`https://laibcatalog.co.il/webapi/api/getfiles?edi=${chain}`)).json()).map(f => f.fileName),
    get: async name => toText(await bytes(`https://laibcatalog.co.il/webapi/${chain}/${name}`)),
  };
}

const CHAINS = {
  shufersal: { he: "שופרסל", site: shufersal },
  tivtaam: { he: "טיב טעם", site: () => cerberus("TivTaam") },
  carrefour: { he: "קרפור", site: carrefour },
  ramilevy: { he: "רמי לוי", site: () => cerberus("RamiLevi") },
  yochananof: { he: "יוחננוף", site: () => cerberus("yohananof") },
  victory: { he: "ויקטורי", site: () => laib("7290696200003") },
};

module.exports = { CHAINS, toText };
