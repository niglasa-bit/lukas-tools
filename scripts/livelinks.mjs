// Live link check: every page in sitemap.xml and every outside link on the site must answer.
// Run: node scripts/livelinks.mjs   (the weekly "links" workflow runs it and opens an issue when something is broken)
// Rate limits (429) and sites that refuse robots (403 from YouTube/Google) count as alive: only 404/410/5xx/timeouts fail.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const skip = new Set(["node_modules", ".git", ".wrangler", "studio-api", "scripts"]);
const urls = new Map(); // url -> first page that uses it
(function walk(d) {
  for (const n of readdirSync(d)) {
    if (skip.has(n)) continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!p.endsWith(".html")) continue;
    for (const m of readFileSync(p, "utf8").matchAll(/href=["'](https?:\/\/[^"'#\s]+)["']/gi)) if (!urls.has(m[1])) urls.set(m[1], p.slice(root.length + 1));
  }
})(root);
for (const m of readFileSync(join(root, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)) if (!urls.has(m[1])) urls.set(m[1], "sitemap.xml");

const ALIVE = (s) => (s >= 200 && s < 400) || s === 429 || s === 403 || s === 405;
async function status(u) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(u, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (link check; thesystemizedlife.com)" }, signal: AbortSignal.timeout(15000) });
      if (ALIVE(r.status)) return r.status;
    } catch (e) { if (i) break; }
  }
  // Some servers answer Node's fetch with an error but a browser (and curl) normally; ask once more with curl.
  try { return Number(execFileSync("curl", ["-s", "-o", "/dev/null", "-L", "--max-time", "15", "-w", "%{http_code}", u], { encoding: "utf8" })) || "no answer"; }
  catch { return "no answer"; }
}
const broken = [];
for (const [u, page] of urls) {
  const s = await status(u);
  if (!ALIVE(s)) broken.push(`- ${u} → ${s} (on ${page})`);
}
if (broken.length) { console.log(broken.join("\n")); process.exit(1); }
console.log("ok · " + urls.size + " live links checked");
