// One-time Stripe setup for the shop: products, prices, Payment Links and the webhook endpoint.
// Run it once in test mode, then once in live mode. Safe to re-run: it reuses what already exists.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs                 # dry run, prints the plan
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs --apply --write-config --webhook
//
// Options:
//   --apply          create the missing objects (without it nothing is written to Stripe)
//   --write-config   put the Payment Link URLs and price labels into ../shop/config.js
//   --webhook        create the /stripe-webhook endpoint (prints its whsec_ secret once:
//                    npx wrangler secret put STRIPE_WEBHOOK_SECRET)
//   --prices "Money Plan Studio=19,The Systemized Year=19,The Autopilot Workbook=19,All-Access=49"   (USD)
//   --site https://thesystemizedlife.com      where shop/thanks.html lives (default: GitHub Pages)
//   --api  https://lukas-studio-api....dev    the Worker (default: api in shop/config.js)
//
// Not done here (Stripe dashboard): Managed Payments on, Public details → Terms of service URL
// (<site>/shop/legal.html, needed for the consent checkbox), branding.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONFIG = fileURLToPath(new URL("../../shop/config.js", import.meta.url));
const TERMS = "I want access right away and understand that my 14-day right of withdrawal ends once access is given.";
const EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.refunded", "charge.dispute.created"];
// metadata.product is what the Worker unlocks by (DEFAULT_PRODUCTS in src/index.js).
const CATALOG = [
  { name: "All-Access", product: "all-access" },
  { name: "Money Plan Studio", product: "Money Plan Studio" },
  { name: "The Systemized Year", product: "The Systemized Year" },
  { name: "The Autopilot Workbook", product: "The Autopilot Workbook" },
  { name: "The Enough Habit", product: "The Enough Habit" },
];

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const APPLY = flag("--apply");
const KEY = process.env.STRIPE_SECRET_KEY || "";
const configText = readFileSync(CONFIG, "utf8");
const SITE = opt("--site", "https://niglasa-bit.github.io/lukas-tools").replace(/\/$/, "");
const API = opt("--api", (configText.match(/api:\s*"([^"]+)"/) || [])[1] || "").replace(/\/$/, "");
const PRICES = Object.fromEntries(
  opt("--prices", "Money Plan Studio=19,The Systemized Year=19,The Autopilot Workbook=19,All-Access=49")
    .split(",").map((s) => s.split("=").map((x) => x.trim())).filter(([n, v]) => n && v)
);

if (!/^(sk|rk)_(test|live)_/.test(KEY)) {
  console.error("Set STRIPE_SECRET_KEY to a secret key (sk_test_… first, sk_live_… for launch).");
  process.exit(1);
}
const MODE = KEY.includes("_live_") ? "LIVE" : "test";

function form(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? form(x, `${key}[${i}]`, out) : out.push([`${key}[${i}]`, String(x)])));
    else if (typeof v === "object") form(v, key, out);
    else out.push([key, String(v)]);
  }
  return out;
}

async function stripe(method, path, body) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method,
    headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/x-www-form-urlencoded" },
    body: body ? new URLSearchParams(form(body)).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error?.message || res.status}`);
  return data;
}

async function listAll(path) {
  const items = [];
  let after = "";
  for (;;) {
    const page = await stripe("GET", `${path}${path.includes("?") ? "&" : "?"}limit=100${after ? "&starting_after=" + after : ""}`);
    items.push(...page.data);
    if (!page.has_more) return items;
    after = page.data[page.data.length - 1].id;
  }
}

async function create(label, path, body) {
  if (!APPLY) { console.log(`  would create ${label}`); return null; }
  const o = await stripe("POST", path, body);
  console.log(`  created ${label}: ${o.id}`);
  return o;
}

console.log(`Stripe ${MODE} mode · site ${SITE} · api ${API || "(none)"}${APPLY ? "" : " · DRY RUN"}`);
const products = await listAll("products?active=true");
const links = await listAll("payment_links?active=true");
const results = {};

for (const item of CATALOG) {
  const usd = PRICES[item.name];
  if (!usd) continue;
  const cents = Math.round(Number(usd) * 100);
  if (!(cents > 0)) throw new Error(`Bad price for ${item.name}: ${usd}`);
  console.log(`${item.name} · $${usd}`);

  let product = products.find((p) => p.metadata?.lukas_product === item.product);
  if (product) console.log(`  product ${product.id}`);
  else product = await create("product", "products", { name: `Lukas · ${item.name}`, metadata: { lukas_product: item.product } });

  let price = null;
  if (product) {
    const prices = await listAll(`prices?active=true&product=${product.id}`);
    price = prices.find((p) => p.unit_amount === cents && p.currency === "usd" && !p.recurring);
    if (price) console.log(`  price ${price.id}`);
  }
  if (!price) price = await create("price", "prices", { product: product?.id, currency: "usd", unit_amount: cents, tax_behavior: "inclusive" });

  let link = price && links.find((l) => l.metadata?.product === item.product && l.metadata?.lukas_price === price.id);
  if (link) console.log(`  link ${link.url}`);
  else link = await create("payment link", "payment_links", {
    line_items: [{ price: price?.id, quantity: 1 }],
    metadata: { product: item.product, lukas_price: price?.id },
    after_completion: { type: "redirect", redirect: { url: `${SITE}/shop/thanks.html?session_id={CHECKOUT_SESSION_ID}` } },
    consent_collection: { terms_of_service: "required" },
    custom_text: { terms_of_service_acceptance: { message: TERMS } },
  });
  results[item.name] = { price: `$${usd}`, url: link?.url || "" };
}

if (flag("--webhook")) {
  if (!API) throw new Error("No Worker URL: pass --api");
  const url = `${API}/stripe-webhook`;
  const hooks = await listAll("webhook_endpoints");
  const hook = hooks.find((h) => h.url === url);
  if (hook) console.log(`Webhook exists: ${hook.id} (its secret is in the dashboard)`);
  else {
    const h = await create(`webhook ${url}`, "webhook_endpoints", { url, enabled_events: EVENTS, description: "Lukas shop lock" });
    if (h) console.log(`\nWebhook secret (shown once): run  npx wrangler secret put STRIPE_WEBHOOK_SECRET  and paste:\n${h.secret}\n`);
  }
}

if (flag("--write-config")) {
  let text = configText;
  for (const [name, r] of Object.entries(results)) {
    if (!r.url) continue;
    const re = new RegExp(`(\\{ name: "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^\\n]*?price: )"[^"]*"(, paymentLink: )"[^"]*"`);
    if (!re.test(text)) { console.warn(`config.js: no line for ${name}`); continue; }
    text = text.replace(re, (_, a, b) => `${a}"${r.price}"${b}"${r.url}"`);
  }
  if (APPLY && text !== configText) { writeFileSync(CONFIG, text); console.log("Updated shop/config.js; commit it to publish the buttons."); }
  else if (!APPLY) console.log("Would update shop/config.js.");
}

console.log("\n" + JSON.stringify(results, null, 2));
