// Publish a blog draft in one step: drop the draft bar and noindex, set the date, list the post on blog/index.html
// (newest first under "Latest posts"), add it to scripts/seo.mjs PAGES and regenerate the seo blocks and sitemap.
// Run:   node scripts/publish-post.mjs <slug> [YYYY-MM-DD]     (date defaults to today; safe to run twice)
// Then commit; the push to main is the publish.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [slug, dateArg] = process.argv.slice(2);
if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
  console.error("usage: node scripts/publish-post.mjs <slug> [YYYY-MM-DD]");
  process.exit(2);
}
const iso = dateArg || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("date must be YYYY-MM-DD");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const [y, m, d] = iso.split("-").map(Number);
const human = d + " " + MONTHS[m - 1] + " " + y;

const postFile = "blog/" + slug + "/index.html";
if (!existsSync(postFile)) throw new Error("no such post: " + postFile);
let post = readFileSync(postFile, "utf8");
post = post.replace(/<meta name="robots" content="noindex">\n?/, "").replace(/<div class="draft">[^<]*<\/div>\n?/, "");
post = post.replace(/(<p class="meta"><span class="tag">[^<]*<\/span> · )[^·<]+( · )/, "$1" + human + "$2");
writeFileSync(postFile, post);

const pick = (re) => (post.match(re) || [])[1] || "";
const tag = pick(/<p class="meta"><span class="tag">([^<]*)<\/span>/);
const title = pick(/<h1>([\s\S]*?)<\/h1>/).trim();
const desc = pick(/<meta name="description" content="([^"]*)">/);
const read = pick(/<p class="meta">[^\n]*· (\d+ min read)<\/p>/);
if (!tag || !title || !desc) throw new Error("post is missing tag, h1 or meta description");

let index = readFileSync("blog/index.html", "utf8");
if (!index.includes('href="' + slug + '/"')) {
  const card = '<a class="card" href="' + slug + '/"><span class="tag">' + tag + "</span><b>" + title + "</b><span>" + desc +
    '</span><span class="meta">' + human + (read ? " · " + read : "") + "</span></a>\n";
  const label = '<p class="label">Latest posts</p>\n';
  if (!index.includes(label)) index = index.replace('<p class="label">What we write about</p>', label + '\n<p class="label">What we write about</p>');
  index = index.replace(label, label + card);
  writeFileSync("blog/index.html", index);
}

let seo = readFileSync("scripts/seo.mjs", "utf8");
const entry = '  { path: "blog/' + slug + '/", kind: "article", published: "' + iso + '", priority: "0.8" },\n';
if (!seo.includes('path: "blog/' + slug + '/"')) {
  const lines = seo.split("\n");
  const last = lines.map((l, i) => (/^\s*\{ path: "blog\//.test(l) ? i : -1)).filter((i) => i >= 0).pop();
  lines.splice(last + 1, 0, entry.trimEnd());
  seo = lines.join("\n");
  writeFileSync("scripts/seo.mjs", seo);
}
execFileSync(process.execPath, ["scripts/seo.mjs"], { stdio: "inherit" });
console.log("published " + slug + " · " + human + " (commit and push to main to go live)");
