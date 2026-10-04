// Repo check: syntax of every inline and standalone script, manifests, local links and asset paths.
// Run: node scripts/check.mjs   (CI runs it on every push and PR)
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname, resolve, extname } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const skip = new Set(["node_modules", ".git", ".wrangler"]);
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    if (skip.has(n)) continue;
    const p = join(d, n);
    statSync(p).isDirectory() ? walk(p) : files.push(p);
  }
})(root);

const errors = [];
const rel = (p) => p.slice(root.length + 1);
const tmp = mkdtempSync(join(tmpdir(), "check-"));

function syntax(code, label, module) {
  const f = join(tmp, "s" + Math.random().toString(36).slice(2) + (module ? ".mjs" : ".js"));
  writeFileSync(f, code);
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { errors.push(label + ": " + String(e.stderr).split("\n").slice(0, 5).join(" ")); }
}

for (const f of files) {
  const ext = extname(f);
  if (ext === ".js" || ext === ".mjs") syntax(readFileSync(f, "utf8"), rel(f), ext === ".mjs" || f.includes("studio-api/src"));
  if (ext === ".gs") syntax(readFileSync(f, "utf8"), rel(f), false);
  if (ext === ".webmanifest" || ext === ".json") {
    try {
      const m = JSON.parse(readFileSync(f, "utf8"));
      for (const i of m.icons || []) if (!i.src.startsWith("data:") && !existsSync(resolve(dirname(f), i.src))) errors.push(rel(f) + ": missing icon " + i.src);
    } catch (e) { errors.push(rel(f) + ": " + e.message); }
  }
  if (ext === ".html") {
    const html = readFileSync(f, "utf8");
    let i = 0;
    for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
      const attrs = m[1] || "";
      if (/\bsrc=/.test(attrs) || /type=["']?(application\/(ld\+)?json|text\/template)/.test(attrs)) continue;
      syntax(m[2], rel(f) + " <script #" + ++i + ">", /type=["']?module/.test(attrs));
    }
    for (const m of html.matchAll(/\b(?:href|src)=["']([^"'#?]+)[^"']*["']/gi)) {
      const u = m[1];
      if (/^(https?:|mailto:|tel:|data:|javascript:|blob:|\/\/)/.test(u) || u.includes("{") || u.includes("'+") || u.includes('"+')) continue;
      let p = resolve(dirname(f), u);
      if (u.endsWith("/")) p = join(p, "index.html");
      if (!existsSync(p)) errors.push(rel(f) + ": broken local link " + u);
    }
  }
}

// Service workers: every precached file must exist.
for (const f of files.filter((f) => f.endsWith("sw.js"))) {
  const m = readFileSync(f, "utf8").match(/SHELL\s*=\s*\[([^\]]*)\]/);
  if (!m) continue;
  for (const s of m[1].match(/"[^"]+"/g) || []) {
    const u = s.slice(1, -1);
    const p = u === "./" ? join(dirname(f), "index.html") : resolve(dirname(f), u);
    if (!existsSync(p)) errors.push(rel(f) + ": precache file missing " + u);
  }
}

if (errors.length) { console.error(errors.join("\n")); console.error("\n" + errors.length + " problem(s)"); process.exit(1); }
console.log("ok · " + files.length + " files checked");
