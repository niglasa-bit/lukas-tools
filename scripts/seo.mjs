// Search basics for the public pages: title, description, canonical, og:url, structured data (JSON-LD),
// plus sitemap.xml, robots.txt and 404.html. The pages carry the result between <!-- seo --> markers,
// so the script can be rerun any time.
// Run:   node scripts/seo.mjs           (after changing PAGES or SITE; commit the result)
//        node scripts/seo.mjs --check   (CI: fails if a page is out of date)
// Own domain live: set SITE to https://thesystemizedlife.com and rerun.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const SITE = "https://niglasa-bit.github.io/lukas-tools"; // switch to https://thesystemizedlife.com with the domain
const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const base = SITE.replace(/\/$/, "");
const NAME = "The Systemized Life";
const SELLER = "Sevenflowlabs Oy";
const AI_NOTE = "Lukas is an AI-generated character, made by Sevenflow.";

// Search phrase first in the title (same rule as the YouTube titles, lukas-influencer lukas_youtube/HAKUSANAT.md).
// price = USD price from shop/config.js; paid apps are described as software for sale.
const PAGES = [
  { path: "", file: "index.html", kind: "home", priority: "1.0",
    title: "Free Money Calculators and Simple Money Systems · The Systemized Life",
    description: "Free money and focus calculators, plain-English money lessons and simple money systems by Lukas. Educational, not financial advice." },
  { path: "future-cost/", kind: "calculator", priority: "0.9",
    title: "Future Cost Calculator: What a Purchase Really Costs If You Invested It",
    description: "Free calculator: what a purchase really costs if you had invested the money instead, plus the Rich Dad asset test. By Lukas · The Systemized Life." },
  { path: "focus/", kind: "calculator", priority: "0.8",
    title: "Focus Leak Calculator: Hours Lost to Interruptions Every Year",
    description: "Free calculator: how many hours a year interruptions and desk clutter cost you, and what that time is worth. By Lukas · The Systemized Life." },
  { path: "samples/", kind: "page", priority: "0.7",
    title: "Free Printable Money Plan Samples · The Systemized Life",
    description: "Free printable samples of the Money Plan Studio, The Systemized Year and The Autopilot Workbook. Try the system before you buy." },
  { path: "shop/", kind: "page", priority: "0.8",
    title: "Money Planning Apps and Workbooks · Lukas Shop",
    description: "Simple money and time systems by Lukas · The Systemized Life. One-time payment, works on your phone and computer." },
  { path: "studio/", kind: "app", price: "49", priority: "0.8",
    title: "Money Plan Studio: Your Whole Money Plan on One Page",
    description: "Your whole money plan on one page, a 10-minute Sunday check-in, and a price-tag reader for every purchase. By Lukas · The Systemized Life." },
  { path: "year/", kind: "app", price: "59", priority: "0.8",
    title: "The Systemized Year: Yearly Money and Life Planner",
    description: "Your whole year on one page: money, time, focus and the things money is actually for. Twelve fifteen-minute check-ins. By Lukas · The Systemized Life." },
  { path: "autopilot/", kind: "app", price: "39", priority: "0.7",
    title: "The Autopilot Workbook: Automate the Boring Tasks, No Code",
    description: "Find the boring tasks that eat your week and hand them to a system. No code: recipes, fill-in prompts and short lessons. By Lukas · The Systemized Life." },
  { path: "links/", kind: "page", priority: "0.5" },
  { path: "shop/legal.html", kind: "page", priority: "0.2" },
  { path: "privacy/", kind: "page", priority: "0.1" },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const url = (p) => base + "/" + p;
const org = { "@type": "Organization", "@id": base + "/#org", name: NAME, url: base + "/",
  description: "Simple money systems and free calculators. " + AI_NOTE + " Sold by " + SELLER + ".",
  parentOrganization: { "@type": "Organization", name: SELLER, url: "https://sevenflowlabs.com" } };

function jsonld(p, title, description) {
  const graph = [];
  if (p.kind === "home") graph.push(org, { "@type": "WebSite", "@id": base + "/#site", name: NAME, url: base + "/", publisher: { "@id": base + "/#org" }, inLanguage: "en" });
  if (p.kind === "calculator" || p.kind === "app") {
    const offer = { "@type": "Offer", price: p.kind === "calculator" ? "0" : p.price, priceCurrency: "USD", url: p.kind === "calculator" ? url(p.path) : url("shop/") };
    graph.push({ "@type": p.kind === "calculator" ? "WebApplication" : "SoftwareApplication", name: title.split(":")[0].trim(),
      description, url: url(p.path), applicationCategory: "FinanceApplication", operatingSystem: "Any (web browser)",
      isAccessibleForFree: p.kind === "calculator", offers: offer, publisher: { "@id": base + "/#org" } });
  }
  if (p.path) graph.push({ "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: NAME, item: base + "/" },
    { "@type": "ListItem", position: 2, name: (title || p.path).split(/[:·]/)[0].trim(), item: url(p.path) }] });
  return graph.length ? '<script type="application/ld+json">' + JSON.stringify({ "@context": "https://schema.org", "@graph": graph }) + "</script>" : "";
}

const stale = [];
function out(file, text) {
  const f = join(root, file);
  let old = ""; try { old = readFileSync(f, "utf8"); } catch {}
  if (old === text) return;
  if (check) stale.push(file); else writeFileSync(f, text);
}

for (const p of PAGES) {
  const file = p.file || (p.path.endsWith("/") ? p.path + "index.html" : p.path);
  let html = readFileSync(join(root, file), "utf8").replace(/\n?<!-- seo -->[\s\S]*?<!-- \/seo -->\n?/, "");
  let title = p.title, description = p.description;
  if (title) {
    html = html.replace(/<title>[^<]*<\/title>/, "<title>" + esc(title) + "</title>")
      .replace(/(<meta property="og:title" content=")[^"]*/, "$1" + esc(title));
  } else title = (html.match(/<title>([^<]*)<\/title>/) || [, NAME])[1];
  if (description) html = html.replace(/(<meta name="description" content=")[^"]*/, "$1" + esc(description))
    .replace(/(<meta property="og:description" content=")[^"]*/, "$1" + esc(description));
  const tags = ['<link rel="canonical" href="' + url(p.path) + '">', '<meta property="og:url" content="' + url(p.path) + '">'];
  if (description && !/name="description"/.test(html)) tags.push('<meta name="description" content="' + esc(description) + '">');
  if (!/property="og:title"/.test(html)) tags.push('<meta property="og:type" content="website"><meta property="og:site_name" content="' + NAME + '"><meta property="og:title" content="' + esc(title) + '">' + (description ? '<meta property="og:description" content="' + esc(description) + '">' : "") + '<meta name="twitter:card" content="summary">');
  const ld = jsonld(p, title, description || "");
  if (ld) tags.push(ld);
  const i = html.indexOf("</head>");
  if (i < 0) throw new Error(file + ": no </head>");
  out(file, html.slice(0, i) + "\n<!-- seo -->" + tags.join("") + "<!-- /seo -->\n" + html.slice(i));
}

out("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  PAGES.map((p) => "  <url><loc>" + url(p.path) + "</loc><priority>" + p.priority + "</priority></url>").join("\n") + "\n</urlset>\n");
// Buyer pages (start-here, thanks) and the rewards helper stay out of search.
out("robots.txt", "User-agent: *\nDisallow: /shop/thanks.html\nDisallow: /tools/\nDisallow: /*/start-here.html\n\nSitemap: " + url("sitemap.xml") + "\n");
out("404.html", `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · ${NAME}</title><meta name="robots" content="noindex">
<style>body{font:17px/1.6 system-ui,sans-serif;margin:0;background:#faf7f0;color:#222}.wrap{max-width:560px;margin:0 auto;padding:48px 16px}a{color:#7a4b00}li{margin:6px 0}</style>
</head><body><div class="wrap">
<h1>This page moved or never existed</h1>
<p>Try one of these instead:</p>
<ul>
<li><a href="${url("")}">Home: free calculators and money systems</a></li>
<li><a href="${url("future-cost/")}">Future Cost Calculator</a></li>
<li><a href="${url("focus/")}">Focus Leak Calculator</a></li>
<li><a href="${url("samples/")}">Free printable samples</a></li>
<li><a href="${url("shop/")}">Shop</a></li>
</ul>
<p><small>${AI_NOTE} Educational content, not financial advice.</small></p>
</div></body></html>
`);

if (stale.length) { console.error("seo: out of date, run node scripts/seo.mjs:\n" + stale.join("\n")); process.exit(1); }
console.log(check ? "seo ok · " + PAGES.length + " pages" : "seo written · base " + base);
