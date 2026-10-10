// Money Plan Studio · license API (Cloudflare Worker)
//
// Lock model, honestly stated: the shop delivers the same link to every buyer,
// so this Worker is the lock. A buyer unlocks the app with the email used at
// purchase + their order code (LK-XXXXXXXX from the Stripe purchase email, or the
// Order # of an older Beacons receipt), confirms with a one-time code sent to that
// email, and may activate up to MAX_DEVICES devices.
//
// Sales arrive two ways and both stay on: Stripe calls /stripe-webhook directly,
// and the Gmail Apps Script posts Beacons sales to /sync.
// Premium content is only served to a device that holds a valid signed token.
//
// Several products share this lock (Money Plan Studio, The Systemized Year, the
// bundle, The Autopilot Workbook). One buyer = one email = one device list; what a buyer may open is
// worked out from their orders on every request (see entitlements()), so a new
// purchase, an upgrade or a refund applies at the next launch without new codes.
//
// KV layout (binding STUDIO):
//   buyer:<email>   {name,email,orders:[{order,product,amount,date}],devices:[{id,name,created}],approved,approvedProducts,team,created}
//                   team = {id,name,order,until} for B2B seats added under /admin (see addTeam)
//   pending:<email> {email,order,product,deviceName,created,attempts}   (activation tried before the sale synced; TTL 14 d)
//   code:<email>    {code,deviceId,deviceName,exp,tries}          (TTL 15 min)
//   mail:<id>       {to,subject,html,created}                     (outbox when no mail route accepted it; code mails TTL 15 min, purchase mails 7 d)
//   rl:<scope>:<id> {n,exp}                                       (rate-limit counter for /activate, TTL = window)
//   session:<id>    {email,order,product}                         (Stripe Checkout session → order code, for the thank-you page; TTL 30 d)
//   pi:<id>         {email,order}                                 (Stripe payment intent → order, so a refund finds it)

import { CONTENT } from "./content.js";
import { CONTENT_YEAR } from "./content-year.js";
import { CONTENT_AUTOPILOT } from "./content-autopilot.js";
import { CONTENT_ENOUGH } from "./content-enough.js";
import { sampleFor } from "./sample.js";

// Product keys an app can ask for, the name used in emails, and the content it gets.
const PRODUCT_INFO = {
  studio: { name: "Money Plan Studio", content: CONTENT },
  year: { name: "The Systemized Year", content: CONTENT_YEAR },
  autopilot: { name: "The Autopilot Workbook", content: CONTENT_AUTOPILOT },
  enough: { name: "The Enough Habit", content: CONTENT_ENOUGH },
};

// Which product names (Beacons product name, or metadata.product on a Stripe Payment Link) unlock which product keys. First matching rule wins,
// matched case-insensitively against the product name in the sale email.
// `requires`: the rule only counts if the buyer already owns that key through
// another order (the hidden upgrade product is only for Studio buyers).
// Override with the PRODUCTS var (same JSON shape). Without it, the old single
// PRODUCT_MATCH keeps working and unlocks the Studio only.
const DEFAULT_PRODUCTS = [
  { match: "all-access", grants: ["studio", "year", "autopilot", "enough"] },
  { match: "autopilot workbook", grants: ["autopilot"] },
  { match: "enough habit", grants: ["enough"] },
  { match: "systemized year upgrade", grants: ["year"], requires: "studio" },
  { match: "systemized life pass", grants: ["studio", "year"] },
  { match: "systemized year", grants: ["year"] },
  { match: "money plan studio", grants: ["studio"] },
];

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const CODE_TTL = 15 * 60;       // seconds
const PENDING_TTL = 14 * 24 * 3600; // a parked activation (may hold a non-buyer's email) disappears after two weeks
const PURCHASE_MAIL_TTL = 7 * 24 * 3600; // the purchase email is the buyer's durable receipt, so it waits longer in the outbox
const MIN_ORDER_LEN = 8;        // shortest order / contract number accepted, same for /activate, B2B teams and the apps
const RATE_WINDOW = 3600;       // /activate limits are per hour: RATE_ACTIVATE_IP (default 60) and RATE_ACTIVATE_EMAIL (default 10)
const TOKEN_MAX_AGE = 400 * 24 * 3600; // ~13 months; re-issued silently on /content

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(env, origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const res = await route(request, env, url);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      console.error("server_error", e && e.stack || e);
      return json({ error: "server_error" }, 500, cors);
    }
  },
};

async function route(request, env, url) {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const m = request.method;

  if (p === "/" && m === "GET") return json({ ok: true, service: "money-plan-studio-api" });
  if (p === "/activate" && m === "POST") return activate(request, env);
  if (p === "/verify" && m === "POST") return verify(request, env);
  if (p === "/content" && m === "GET") return content(request, env, url);
  if (p === "/sample" && m === "GET") return sample(url);
  if (p === "/me" && m === "GET") return me(request, env);
  if (p === "/me/remove-device" && m === "POST") return removeDevice(request, env);
  if (p === "/sync" && m === "POST") return sync(request, env);
  if (p === "/stripe-webhook" && m === "POST") return stripeWebhook(request, env);
  if (p === "/order" && m === "GET") return orderLookup(env, url);
  if (p === "/outbox" && m === "GET") return outbox(request, env);
  if (p === "/outbox/ack" && m === "POST") return outboxAck(request, env);
  if (p.startsWith("/admin")) return admin(request, env, url, p);
  return json({ error: "not_found" }, 404);
}

// ---------- buyer flow ----------

async function activate(request, env) {
  // Every call writes to KV and may send mail, so it is limited per IP and per email before anything else.
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (ip && await rateLimited(env, "ip:" + ip, parseInt(env.RATE_ACTIVATE_IP || "60", 10))) return tooMany();
  const b = await body(request);
  const email = normEmail(b.email);
  const order = normOrder(b.order);
  const deviceId = String(b.deviceId || "").slice(0, 64);
  const deviceName = String(b.deviceName || "device").slice(0, 60);
  const product = productKey(b.product);
  if (!isEmail(email)) return json({ error: "bad_email", message: "Check the email address: use the one you bought with." }, 400);
  if (order.length < MIN_ORDER_LEN) return json({ error: "bad_order", message: "Check the order code: copy it whole from your purchase email (Order #)." }, 400);
  if (!deviceId) return json({ error: "bad_device", message: "This browser blocks storage. Turn off private mode and try again." }, 400);
  if (await rateLimited(env, "email:" + email, parseInt(env.RATE_ACTIVATE_EMAIL || "10", 10))) return tooMany();

  const buyer = await getBuyer(env, email);
  const ok = buyer && orderUnlocks(buyer, order, product, env);
  if (!ok) {
    // Sale may not have synced yet (Gmail script runs every few minutes). Park it;
    // the admin page shows it with a one-click approve. Never reveal whether the email exists.
    const key = "pending:" + email;
    const prev = (await env.STUDIO.get(key, "json")) || { attempts: 0 };
    await env.STUDIO.put(key, JSON.stringify({ email, order, product, deviceName, created: prev.created || now(), last: now(), attempts: (prev.attempts || 0) + 1 }), { expirationTtl: PENDING_TTL });
    return json({ status: "pending", message: "We couldn't match that order yet. New purchases take a few minutes to arrive. Try again shortly, or reply to your receipt email and Lukas will unlock it by hand." });
  }

  const devices = buyer.devices || [];
  const known = devices.find((d) => d.id === deviceId);
  if (known) {
    const token = await sign(env, { e: email, d: deviceId, iat: now() });
    return json({ status: "already_active", token, name: buyer.name || "" });
  }
  const max = parseInt(env.MAX_DEVICES || "3", 10);
  if (devices.length >= max) {
    return json({ status: "device_limit", max, message: `This purchase is already active on ${max} devices. Remove one under More → Devices on an active device, or reply to your receipt email.` });
  }

  // A code sent less than a minute ago to the same device is still on its way: don't mail another one.
  const prevCode = await env.STUDIO.get("code:" + email, "json");
  if (prevCode && prevCode.deviceId === deviceId && prevCode.exp - CODE_TTL > now() - 60) return json({ status: "code_sent", message: "Check your email for a 6-digit code (valid 15 minutes)." });
  const code = oneTimeCode();
  // Wrong guesses carry over to a re-sent code, so asking for new codes doesn't reset the 5-try limit.
  const tries = prevCode && prevCode.exp >= now() ? prevCode.tries || 0 : 0;
  await env.STUDIO.put("code:" + email, JSON.stringify({ code, deviceId, deviceName, exp: now() + CODE_TTL, tries }), { expirationTtl: CODE_TTL });
  await sendMail(env, {
    to: email,
    subject: `${code} is your ${PRODUCT_INFO[product].name} code`,
    html: codeMail(buyer.name, code, deviceName, PRODUCT_INFO[product].name, teamActive(buyer) ? buyer.team.name : ""),
  });
  return json({ status: "code_sent", message: "Check your email for a 6-digit code (valid 15 minutes)." });
}

async function verify(request, env) {
  const b = await body(request);
  const email = normEmail(b.email);
  const code = String(b.code || "").replace(/\D/g, "");
  const deviceId = String(b.deviceId || "").slice(0, 64);
  if (!isEmail(email) || code.length !== 6 || !deviceId) return json({ error: "bad_request", message: "Type the 6-digit code from the email." }, 400);

  const key = "code:" + email;
  const rec = await env.STUDIO.get(key, "json");
  if (!rec || rec.exp < now()) return json({ error: "code_expired", message: "That code has expired. Request a new one." }, 400);
  if (rec.deviceId !== deviceId) return json({ error: "device_mismatch", message: "Request the code from the device you want to unlock." }, 400);
  if (!secretOk(code, rec.code)) {
    rec.tries = (rec.tries || 0) + 1;
    if (rec.tries >= 5) { await env.STUDIO.delete(key); return json({ error: "too_many_tries", message: "Too many attempts. Request a new code." }, 400); }
    await env.STUDIO.put(key, JSON.stringify(rec), { expirationTtl: Math.max(60, rec.exp - now()) });
    return json({ error: "wrong_code", message: "That code doesn't match." }, 400);
  }

  const buyer = await getBuyer(env, email);
  if (!buyer) return json({ error: "no_buyer", message: "We couldn't find that purchase any more. Reply to your receipt email and we'll sort it out." }, 400);
  const max = parseInt(env.MAX_DEVICES || "3", 10);
  buyer.devices = buyer.devices || [];
  if (!buyer.devices.find((d) => d.id === deviceId)) {
    if (buyer.devices.length >= max) return json({ status: "device_limit", max, message: `This purchase is already active on ${max} devices. Remove one under More → Devices on an active device.` }, 400);
    buyer.devices.push({ id: deviceId, name: rec.deviceName || "device", created: now() });
  }
  await putBuyer(env, buyer);
  await env.STUDIO.delete(key);
  const token = await sign(env, { e: email, d: deviceId, iat: now() });
  return json({ status: "ok", token, name: buyer.name || "", email });
}

async function content(request, env, url) {
  const auth = await authed(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  const { buyer, payload } = auth;
  const product = productKey(url.searchParams.get("product"));
  const products = entitlements(buyer, env);
  if (!products.includes(product)) return json({ error: "not_owned", product, products }, 403);
  // Content is the premium part. Nothing here is cached by the app on disk; every launch re-checks the device.
  const res = {
    name: buyer.name || "",
    email: buyer.email,
    devices: (buyer.devices || []).map((d) => ({ id: d.id, name: d.name, created: d.created, this: d.id === payload.d })),
    maxDevices: parseInt(env.MAX_DEVICES || "3", 10),
    products,
    team: teamActive(buyer) ? buyer.team.name : "",
    content: PRODUCT_INFO[product].content,
  };
  // Refresh token quietly when it is getting old.
  if (now() - payload.iat > TOKEN_MAX_AGE / 2) res.token = await sign(env, { e: buyer.email, d: payload.d, iat: now() });
  return json(res);
}

// Free sample: a public slice of the content, no login, no device slot (see sample.js).
function sample(url) {
  const product = String(url.searchParams.get("product") || "").toLowerCase();
  const content = sampleFor(product);
  if (!content) return json({ error: "no_sample" }, 404);
  const res = json({ sample: true, product, content });
  res.headers.set("Cache-Control", "public, max-age=3600");
  return res;
}

async function me(request, env) {
  const auth = await authed(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  return json({ name: auth.buyer.name || "", email: auth.buyer.email, devices: auth.buyer.devices || [], products: entitlements(auth.buyer, env) });
}

// A device can remove another device of the same purchase (so the 3-device limit never traps the buyer).
async function removeDevice(request, env) {
  const auth = await authed(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  const b = await body(request);
  const id = String(b.deviceId || "");
  if (!id || id === auth.payload.d) return json({ error: "cannot_remove_self" }, 400);
  await adminOrSelfRemoveDevice(env, auth.buyer, id);
  return json({ ok: true, devices: auth.buyer.devices.map((d) => ({ id: d.id, name: d.name, created: d.created, this: d.id === auth.payload.d })) });
}
async function adminOrSelfRemoveDevice(env, buyer, deviceId) {
  buyer.devices = (buyer.devices || []).filter((d) => d.id !== deviceId);
  await putBuyer(env, buyer);
}

// ---------- sync from Gmail (Apps Script) ----------

async function sync(request, env) {
  if (!secretOk(request.headers.get("X-Sync-Secret"), env.SYNC_SECRET)) return json({ error: "forbidden" }, 403);
  const b = await body(request);
  const sales = Array.isArray(b.sales) ? b.sales : [];
  let added = 0, updated = 0, skipped = 0;
  for (const s of sales) {
    const r = await recordSale(env, s);
    if (r === "added") added++; else if (r === "updated") updated++; else skipped++;
  }
  return json({ ok: true, added, updated, skipped });
}

// One sale from any source. Returns "added" (first order of a new buyer), "updated" or "skipped" (bad or already known).
async function recordSale(env, s) {
  const email = normEmail(s.email);
  const order = normOrder(s.order);
  if (!isEmail(email) || order.length < 8) return "skipped";
  const buyer = (await getBuyer(env, email)) || { email, name: "", orders: [], devices: [], approved: false, created: now() };
  if (buyer.orders.find((o) => o.order === order)) return "skipped";
  const rec = { order, product: String(s.product || "").slice(0, 120), amount: String(s.amount || "").slice(0, 20), date: String(s.date || "").slice(0, 40), synced: now() };
  if (s.source) rec.source = s.source;
  if (s.pi) rec.pi = String(s.pi).slice(0, 80);
  buyer.orders.push(rec);
  if (!buyer.name && s.name) buyer.name = String(s.name).slice(0, 80);
  await putBuyer(env, buyer);
  await env.STUDIO.delete("pending:" + email);
  return buyer.orders.length === 1 ? "added" : "updated";
}

// ---------- Stripe (Checkout / Payment Links) ----------
// Stripe posts here (Dashboard → Developers → Webhooks, events below). Each Payment Link carries
// metadata.product = the product name ("Money Plan Studio", "The Systemized Year" …), so the same
// name rules as Beacons decide what an order unlocks. Without metadata the line item names are read
// from the Stripe API when STRIPE_SECRET_KEY is set. The buyer's order code is LK-XXXXXXXX, derived
// from the Checkout session id, shown on the thank-you page and in the purchase email.

async function stripeWebhook(request, env) {
  const raw = await request.text();
  if (!(await stripeSignatureOk(raw, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET))) return json({ error: "bad_signature" }, 400);
  let ev; try { ev = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }
  const o = (ev.data && ev.data.object) || {};

  if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
    // Bank-debit style payments complete later: they arrive "unpaid" first, then as async_payment_succeeded.
    if (o.payment_status !== "paid" && o.payment_status !== "no_payment_required") return json({ ok: true, ignored: "unpaid" });
    const email = normEmail((o.customer_details && o.customer_details.email) || o.customer_email);
    if (!isEmail(email) || !o.id) return json({ ok: true, ignored: "no_email" });
    const product = await stripeProductName(env, o);
    // The Stripe account is shared with other Sevenflow products: only Lukas products become buyers here.
    if (!orderRule({ product }, productRules(env))) return json({ ok: true, ignored: "other_product" });
    const order = await orderCode(env, o.id);
    const result = await recordSale(env, {
      email, order, product,
      name: o.customer_details && o.customer_details.name,
      amount: money(o.amount_total, o.currency),
      date: new Date((o.created || now()) * 1000).toISOString().slice(0, 16).replace("T", " "),
      pi: o.payment_intent, source: "stripe",
    });
    await env.STUDIO.put("session:" + o.id, JSON.stringify({ email, order, product }), { expirationTtl: 30 * 24 * 3600 });
    if (o.payment_intent) await env.STUDIO.put("pi:" + o.payment_intent, JSON.stringify({ email, order }));
    // Stripe retries a webhook until it gets a 2xx, so the purchase email goes out only for a new order.
    if (result !== "skipped") {
      const buyer = await getBuyer(env, email);
      await sendMail(env, { to: email, subject: `Your ${product || "Lukas"} order code: ${order.toUpperCase()}`, html: purchaseMail(env, buyer && buyer.name, product, order) }, PURCHASE_MAIL_TTL);
    }
    return json({ ok: true, result });
  }

  if (ev.type === "charge.refunded" || ev.type === "charge.dispute.created") {
    // Full refund or chargeback closes that one order; anything else the buyer owns keeps working.
    if (ev.type === "charge.refunded" && !o.refunded) return json({ ok: true, ignored: "partial_refund" });
    const done = await closeOrder(env, o.payment_intent, ev.type === "charge.refunded" ? "refund" : "dispute");
    return json({ ok: true, closed: done });
  }
  return json({ ok: true, ignored: ev.type || "unknown" });
}

async function closeOrder(env, pi, why) {
  if (!pi) return false;
  const ref = await env.STUDIO.get("pi:" + pi, "json");
  if (!ref) return false;
  const buyer = await getBuyer(env, ref.email);
  const o = buyer && (buyer.orders || []).find((x) => x.order === ref.order);
  if (!o) return false;
  if (!o.closed) { o.closed = why; o.closedAt = now(); await putBuyer(env, buyer); }
  return true;
}

// The thank-you page (success_url …?session_id={CHECKOUT_SESSION_ID}) asks for the order code.
// Session ids are long and unguessable; the email is shown masked.
async function orderLookup(env, url) {
  const id = String(url.searchParams.get("session_id") || "").slice(0, 200);
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json({ error: "bad_session" }, 400);
  const rec = await env.STUDIO.get("session:" + id, "json");
  if (!rec) return json({ status: "waiting" });
  const rules = productRules(env);
  const r = orderRule({ product: rec.product }, rules);
  return json({ status: "ready", order: rec.order.toUpperCase(), product: rec.product, email: maskEmail(rec.email), apps: r ? r.grants.filter((k) => PRODUCT_INFO[k]).map((k) => ({ key: k, name: PRODUCT_INFO[k].name, url: appUrl(env, k) })) : [] });
}

async function stripeProductName(env, o) {
  const meta = o.metadata && o.metadata.product;
  if (meta) return String(meta).slice(0, 120);
  if (!env.STRIPE_SECRET_KEY) return "";
  try {
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(o.id)}/line_items?limit=10`, { headers: { Authorization: "Bearer " + env.STRIPE_SECRET_KEY } });
    const j = await r.json();
    return (j.data || []).map((li) => li.description || "").filter(Boolean).join(" + ").slice(0, 120);
  } catch { return ""; }
}

async function orderCode(env, sessionId) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode("order:" + sessionId));
  return "lk-" + [...new Uint8Array(sig).slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Stripe-Signature: t=<unix>,v1=<hex hmac-sha256 of "t.body">[,v1=…]. Five-minute tolerance against replays.
async function stripeSignatureOk(raw, header, secret) {
  if (!secret || !header) return false;
  const parts = String(header).split(",").map((x) => x.split("="));
  const t = (parts.find(([k]) => k === "t") || [])[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length || !(Math.abs(now() - parseInt(t, 10)) <= 300)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + raw)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((v) => secretOk(v, hex));
}

function money(cents, cur) {
  if (cents == null) return "";
  const c = String(cur || "").toUpperCase();
  return (c === "USD" ? "$" : c === "EUR" ? "€" : c + " ") + (cents / 100).toFixed(2);
}
function maskEmail(e) { const [u, d] = String(e).split("@"); return (u || "").slice(0, 2) + "•••@" + (d || ""); }

const APP_PATHS = { studio: "studio/", year: "year/", autopilot: "autopilot/", enough: "enough/" };
function appUrl(env, key) { return String(env.APP_BASE || "https://niglasa-bit.github.io/lukas-tools").replace(/\/+$/, "") + "/" + APP_PATHS[key]; }

// When there is no MAIL_WEBHOOK_URL, codes wait here and the Apps Script sends them (polls every minute).
async function outbox(request, env) {
  if (!secretOk(request.headers.get("X-Sync-Secret"), env.SYNC_SECRET)) return json({ error: "forbidden" }, 403);
  const list = await env.STUDIO.list({ prefix: "mail:" });
  const mails = [];
  for (const k of list.keys) {
    const m = await env.STUDIO.get(k.name, "json");
    if (m) mails.push({ id: k.name.slice(5), ...m });
  }
  return json({ mails });
}
async function outboxAck(request, env) {
  if (!secretOk(request.headers.get("X-Sync-Secret"), env.SYNC_SECRET)) return json({ error: "forbidden" }, 403);
  const b = await body(request);
  for (const id of (b.ids || [])) await env.STUDIO.delete("mail:" + String(id).slice(0, 80));
  return json({ ok: true });
}

// ---------- admin ----------

async function admin(request, env, url, p) {
  // The page itself holds no data, so it loads without the token; it asks for the token (or reads it from
  // #token=… in the address) and sends it only in the X-Admin-Token header, never in a URL.
  if (p === "/admin" && request.method === "GET" && (request.headers.get("Accept") || "").includes("text/html")) {
    return new Response(ADMIN_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" } });
  }
  const token = request.headers.get("X-Admin-Token") || "";
  if (!secretOk(token, env.ADMIN_TOKEN)) return json({ error: "forbidden" }, 403);

  if (p === "/admin" && request.method === "GET") {
    const buyers = [], pending = [];
    for (const k of (await env.STUDIO.list({ prefix: "buyer:" })).keys) { const b = await env.STUDIO.get(k.name, "json"); if (b) buyers.push({ ...b, products: entitlements(b, env) }); }
    for (const k of (await env.STUDIO.list({ prefix: "pending:" })).keys) { const b = await env.STUDIO.get(k.name, "json"); if (b) pending.push(b); }
    return json({ buyers, pending, productMatch: productRules(env).map((r) => r.match + " → " + r.grants.join("+") + (r.requires ? " (needs " + r.requires + ")" : "")).join(" · "), mailMode: env.MAIL_WEBHOOK_URL ? "webhook" : env.RESEND_API_KEY ? "resend" : "outbox" });
  }
  const b = request.method === "POST" ? await body(request) : {};
  const email = normEmail(b.email);
  if (p === "/admin/approve") {
    if (!isEmail(email)) return json({ error: "bad_email" }, 400);
    const buyer = (await getBuyer(env, email)) || { email, name: "", orders: [], devices: [], created: now() };
    buyer.approved = true;
    // Which products a hand approval opens. Older approvals carry no list and mean the Studio.
    const grants = (Array.isArray(b.products) ? b.products : ["studio"]).filter((k) => PRODUCT_INFO[k]);
    buyer.approvedProducts = [...new Set([...(buyer.approvedProducts || []), ...(grants.length ? grants : ["studio"])])];
    if (b.name) buyer.name = String(b.name).slice(0, 80);
    if (b.order) buyer.orders.push({ order: normOrder(b.order), product: "manual", amount: "", date: "", synced: now() });
    await putBuyer(env, buyer);
    await env.STUDIO.delete("pending:" + email);
    return json({ ok: true });
  }
  if (p === "/admin/reset-devices") {
    const buyer = await getBuyer(env, email); if (!buyer) return json({ error: "no_buyer" }, 404);
    buyer.devices = []; await putBuyer(env, buyer); return json({ ok: true });
  }
  if (p === "/admin/remove-device") {
    const buyer = await getBuyer(env, email); if (!buyer) return json({ error: "no_buyer" }, 404);
    await adminOrSelfRemoveDevice(env, buyer, String(b.deviceId || "")); return json({ ok: true });
  }
  if (p === "/admin/revoke") {
    // Refund or chargeback: remove the buyer entirely. Their devices stop at the next launch.
    await env.STUDIO.delete("buyer:" + email); await env.STUDIO.delete("pending:" + email); return json({ ok: true });
  }
  if (p === "/admin/team") return addTeam(env, b);
  if (p === "/admin/team-remove") return removeTeam(env, b);
  if (p === "/admin/dismiss-pending") { await env.STUDIO.delete("pending:" + email); return json({ ok: true }); }
  return json({ error: "not_found" }, 404);
}

// ---------- B2B team licences ----------
// A company buys N seats by invoice (not through Beacons). The owner pastes the seat emails here with the
// contract number; each person then unlocks with their own email + that contract number + an emailed code,
// on up to MAX_DEVICES devices of their own. `until` (YYYY-MM-DD) ends the licence without deleting anyone.

function teamId(s) { return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }
function teamActive(buyer) { return !!(buyer && buyer.team && (!buyer.team.until || now() <= buyer.team.until)); }

async function addTeam(env, b) {
  const name = String(b.team || "").trim().slice(0, 80);
  const order = normOrder(b.order);
  const id = teamId(name);
  if (!id) return json({ error: "bad_team" }, 400);
  if (order.length < MIN_ORDER_LEN) return json({ error: "bad_order", message: `Use a contract number of at least ${MIN_ORDER_LEN} characters (the apps ask for ${MIN_ORDER_LEN}).` }, 400);
  const grants = (Array.isArray(b.products) ? b.products : ["autopilot"]).filter((k) => PRODUCT_INFO[k]);
  const until = b.until ? Math.floor(Date.parse(String(b.until) + "T23:59:59Z") / 1000) || 0 : 0;
  const emails = [...new Set(String(Array.isArray(b.emails) ? b.emails.join("\n") : b.emails || "").split(/[\s,;]+/).map(normEmail).filter(isEmail))];
  if (!emails.length) return json({ error: "no_emails" }, 400);
  let added = 0, updated = 0;
  for (const email of emails) {
    const prev = await getBuyer(env, email);
    const buyer = prev || { email, name: "", orders: [], devices: [], created: now() };
    buyer.approved = true;
    buyer.approvedProducts = [...new Set([...(buyer.approvedProducts || []), ...grants])];
    buyer.team = { id, name, order, until, products: grants };
    await putBuyer(env, buyer);
    prev ? updated++ : added++;
  }
  return json({ ok: true, team: id, added, updated, seats: emails.length });
}

// Ends a team: members lose the team's products. People who also bought something themselves keep that.
async function removeTeam(env, b) {
  const id = teamId(b.team);
  if (!id) return json({ error: "bad_team" }, 400);
  let removed = 0;
  for (const k of (await env.STUDIO.list({ prefix: "buyer:" })).keys) {
    const buyer = await env.STUDIO.get(k.name, "json");
    if (!buyer || !buyer.team || buyer.team.id !== id) continue;
    const ownOrders = (buyer.orders || []).some((o) => o.product !== "manual");
    if (!ownOrders && !(buyer.approvedProducts || []).some((x) => !(buyer.team.products || []).includes(x))) await env.STUDIO.delete(k.name);
    else {
      buyer.approvedProducts = (buyer.approvedProducts || []).filter((x) => !(buyer.team.products || []).includes(x));
      if (!buyer.approvedProducts.length) buyer.approved = false;
      delete buyer.team;
      await putBuyer(env, buyer);
    }
    removed++;
  }
  return json({ ok: true, removed });
}

// ---------- helpers ----------

async function authed(request, env) {
  const h = request.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const payload = await verifyToken(env, token);
  if (!payload) return { ok: false, error: "bad_token" };
  if (now() - payload.iat > TOKEN_MAX_AGE) return { ok: false, error: "token_expired" };
  const buyer = await getBuyer(env, payload.e);
  if (!buyer) return { ok: false, error: "revoked" };
  if (!(buyer.devices || []).find((d) => d.id === payload.d)) return { ok: false, error: "device_removed" };
  return { ok: true, buyer, payload };
}

function productKey(s) { const k = String(s || "studio").toLowerCase(); return PRODUCT_INFO[k] ? k : "studio"; }

function productRules(env) {
  if (env.PRODUCTS) { try { const r = JSON.parse(env.PRODUCTS); if (Array.isArray(r)) return r; } catch {} }
  if (env.PRODUCT_MATCH && !env.PRODUCTS) return [{ match: env.PRODUCT_MATCH, grants: ["studio"] }];
  return DEFAULT_PRODUCTS;
}

// What one order unlocks on its own, before `requires` is checked.
function orderRule(o, rules) {
  if (o.product === "manual") return null; // hand approvals live in buyer.approvedProducts
  if (o.closed) return null; // refunded or disputed
  const name = String(o.product || "").toLowerCase();
  return rules.find((r) => name.includes(String(r.match).toLowerCase())) || null;
}

// Every product key this buyer may open.
function entitlements(buyer, env) {
  const rules = productRules(env);
  const teamOnly = buyer.team && !teamActive(buyer) ? buyer.team.products || [] : [];
  const owned = new Set(buyer.approved ? (buyer.approvedProducts || ["studio"]).filter((k) => !teamOnly.includes(k)) : []);
  const later = [];
  for (const o of buyer.orders || []) {
    const r = orderRule(o, rules);
    if (!r) continue;
    if (r.requires) later.push(r); else r.grants.forEach((k) => owned.add(k));
  }
  for (const r of later) if (owned.has(r.requires)) r.grants.forEach((k) => owned.add(k));
  return [...owned].filter((k) => PRODUCT_INFO[k]);
}

// Activation: the email + order pair must be real, and the buyer must own the product
// the app is asking for. A hand-approved buyer needs no order match.
function orderUnlocks(buyer, order, product, env) {
  const owned = entitlements(buyer, env);
  if (!owned.includes(product)) return false;
  if (teamActive(buyer) && (buyer.team.products || []).includes(product)) return order === buyer.team.order;
  if (buyer.approved && (buyer.approvedProducts || ["studio"]).includes(product)) return true;
  const rules = productRules(env);
  return (buyer.orders || []).some((o) => o.order === order && orderRule(o, rules));
}

// 6-digit one-time code from the platform CSPRNG; rejection sampling keeps every code equally likely.
function oneTimeCode() {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / 900000) * 900000;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return String(100000 + (buf[0] % 900000));
}

// Fixed-window counter in KV (same pattern as the code tries). KV is eventually consistent, so the limit is
// approximate under a burst, but it caps sustained abuse of KV writes and the mail quota.
async function rateLimited(env, id, limit) {
  if (!(limit > 0)) return false;
  const key = "rl:" + id.slice(0, 160);
  const t = now();
  const rec = await env.STUDIO.get(key, "json");
  const cur = rec && rec.exp > t ? rec : { n: 0, exp: t + RATE_WINDOW };
  if (cur.n >= limit) return true;
  cur.n++;
  await env.STUDIO.put(key, JSON.stringify(cur), { expirationTtl: Math.max(60, cur.exp - t) });
  return false;
}
function tooMany() { return json({ error: "rate_limited", message: "Too many attempts. Wait an hour and try again, or reply to your receipt email." }, 429, { "retry-after": String(RATE_WINDOW) }); }

async function getBuyer(env, email) { return env.STUDIO.get("buyer:" + email, "json"); }
async function putBuyer(env, buyer) { return env.STUDIO.put("buyer:" + buyer.email, JSON.stringify(buyer)); }

function normEmail(s) { return String(s || "").trim().toLowerCase().slice(0, 120); }
// Buyers paste the code with whatever sits in front of it in the receipt: "Order #: x", "#: x", "# x".
function normOrder(s) { return String(s || "").trim().toLowerCase().replace(/^(?:order)?\s*#?\s*:?\s*/i, "").slice(0, 80); }
function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
function now() { return Math.floor(Date.now() / 1000); }
async function body(request) { try { return await request.json(); } catch { return {}; } }
function json(obj, status = 200, extra = {}) { return new Response(JSON.stringify(obj), { status, headers: { ...JSON_HEADERS, ...extra } }); }

function corsHeaders(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.length === 0 || allowed.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? (origin || "*") : "null",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Sync-Secret,X-Admin-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function secretOk(given, expected) {
  if (!expected || !given || given.length !== expected.length) return false;
  let r = 0; for (let i = 0; i < given.length; i++) r |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return r === 0;
}

// --- token: base64url(payload).base64url(hmac-sha256) ---
async function hmacKey(env) {
  if (!env.SIGNING_SECRET) throw new Error("SIGNING_SECRET is not set"); // never sign with an empty key
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function sign(env, payload) {
  const data = b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(data));
  return data + "." + b64u(new Uint8Array(sig));
}
async function verifyToken(env, token) {
  const [data, sig] = String(token).split(".");
  if (!data || !sig) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", await hmacKey(env), unb64u(sig), new TextEncoder().encode(data)); } catch { return null; } // malformed base64
  if (!ok) return null;
  try { return JSON.parse(new TextDecoder().decode(unb64u(data))); } catch { return null; }
}
function b64u(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

// --- mail: Apps Script webhook (instant, free, from the owner's Gmail) → Resend → outbox ---
// Apps Script answers HTTP 200 even when it fails (wrong secret, MailApp quota), so a webhook send only counts
// when the body says {"ok":true}. Anything else falls through to Resend and then to the outbox.
async function sendMail(env, mail, ttl = CODE_TTL) {
  if (env.MAIL_WEBHOOK_URL) {
    try {
      const r = await fetch(env.MAIL_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: env.SYNC_SECRET, ...mail }), redirect: "follow" });
      const text = await r.text();
      let j = null; try { j = JSON.parse(text); } catch {}
      if (r.ok && j && j.ok === true) return "webhook";
      console.error("mail webhook did not confirm", r.status, (j && j.error) || text.slice(0, 200));
    } catch (e) { console.error("mail webhook failed", String(e && e.message || e)); }
  }
  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    try {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + env.RESEND_API_KEY }, body: JSON.stringify({ from: env.MAIL_FROM, to: [mail.to], subject: mail.subject, html: mail.html }) });
      if (r.ok) return "resend";
      console.error("resend failed", r.status);
    } catch (e) { console.error("resend failed", String(e && e.message || e)); }
  }
  await env.STUDIO.put("mail:" + crypto.randomUUID(), JSON.stringify({ ...mail, created: now() }), { expirationTtl: ttl });
  return "outbox";
}

function codeMail(name, code, deviceName, productName, team) {
  const hi = name ? `Hi ${escapeHtml(name.split(" ")[0])},` : "Hi,";
  return `<div style="font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1F3A5F;max-width:480px">
  <p>${hi}</p>
  <p>Your ${escapeHtml(productName || "Money Plan Studio")} code for <b>${escapeHtml(deviceName || "your device")}</b>:</p>
  <p style="font-size:34px;font-weight:800;letter-spacing:.12em;margin:8px 0 16px">${code}</p>
  <p>It works for 15 minutes. If you didn't request this, just ignore the email.</p>
  <p style="color:#5F8A99;font-size:13px">${team ? `${escapeHtml(productName)} · licensed to ${escapeHtml(team)}` : "One small system at a time. ☕<br>Lukas · The Systemized Life"}</p>
</div>`;
}
// Sent once per Stripe order. Also confirms, on a durable medium, that the buyer asked for immediate
// access and so gave up the 14-day withdrawal right (required for digital content in the EU).
function purchaseMail(env, name, product, order) {
  const hi = name ? `Hi ${escapeHtml(String(name).split(" ")[0])},` : "Hi,";
  const r = orderRule({ product }, productRules(env));
  const apps = r ? r.grants.filter((k) => PRODUCT_INFO[k]).map((k) => `<p><a href="${appUrl(env, k)}" style="display:inline-block;background:#2A9D8F;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:700">Open ${escapeHtml(PRODUCT_INFO[k].name)}</a></p>`).join("") : "";
  return `<div style="font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1F3A5F;max-width:480px">
  <p>${hi}</p>
  <p>Thank you for buying <b>${escapeHtml(product || "a Lukas product")}</b>. Your order code:</p>
  <p style="font-size:28px;font-weight:800;letter-spacing:.08em;margin:8px 0 16px">${escapeHtml(order.toUpperCase())}</p>
  ${apps}
  <p>Open the app, enter this email address and the order code, and we'll send you a 6-digit code. Works on up to ${parseInt(env.MAX_DEVICES || "3", 10)} devices.</p>
  <p style="color:#5F8A99;font-size:13px">You asked for immediate access to digital content and acknowledged that the 14-day right of withdrawal ends once access is given.${env.SELLER ? "<br>" + escapeHtml(env.SELLER) : ""}</p>
  <p style="color:#5F8A99;font-size:13px">One small system at a time. ☕<br>Lukas · The Systemized Life</p>
</div>`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

const ADMIN_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Studio admin</title>
<style>body{font:15px/1.45 system-ui,sans-serif;color:#1F3A5F;background:#F3FAF8;margin:0;padding:16px;max-width:900px;margin:auto}h1{font-size:20px}h2{font-size:16px;margin-top:24px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}td,th{padding:8px 10px;border-bottom:1px solid #CFE6E1;text-align:left;font-size:14px;vertical-align:top}th{background:#E6F3F0}
button{font:inherit;border:1px solid #CFE6E1;background:#E6F3F0;border-radius:8px;padding:4px 8px;cursor:pointer;margin:2px}button.p{background:#2A9D8F;color:#fff;border-color:#2A9D8F}input{font:inherit;padding:6px 8px;border:1px solid #CFE6E1;border-radius:8px}
.muted{color:#5F8A99;font-size:13px}</style>
<h1>Lukas products · buyers</h1><p class="muted" id="meta"></p>
<h2>Waiting for approval</h2><table id="pending"><tr><th>Email</th><th>Order # they typed</th><th>For</th><th>Tries</th><th></th></tr></table>
<h2>Buyers</h2><table id="buyers"><tr><th>Buyer</th><th>Owns</th><th>Orders</th><th>Devices</th><th></th></tr></table>
<h2>Add a buyer by hand</h2><p><input id="aEmail" placeholder="email"> <input id="aName" placeholder="name"> <input id="aOrder" placeholder="order # (optional)"> <select id="aProd"><option value="studio">Money Plan Studio</option><option value="year">The Systemized Year</option><option value="studio,year">Studio + Year</option><option value="autopilot">The Autopilot Workbook</option><option value="enough">The Enough Habit</option></select> <button class="p" onclick="approve()">Approve</button></p>
<h2>Add a team (B2B licence)</h2><p class="muted">Company name, the contract or invoice number people type as their Order #, the end date, and one email per line. Re-adding the same team adds seats and updates the end date.</p>
<p><input id="tName" placeholder="company, e.g. Acme Oy"> <input id="tOrder" placeholder="contract #, e.g. AP-2026-001"> <input id="tUntil" type="date" title="licence ends"> <select id="tProd"><option value="autopilot">The Autopilot Workbook</option></select><br><textarea id="tEmails" rows="5" style="width:100%;margin-top:6px;font:inherit" placeholder="anna@acme.fi&#10;mikko@acme.fi"></textarea><br><button class="p" onclick="team()">Add seats</button> <button onclick="if(confirm('End this team licence? Members lose access at their next launch.'))teamRemove()">End team licence</button> <span id="tMsg" class="muted"></span></p>
<script>
// The token comes from #token=… in the address (a fragment never reaches the server or its logs), an older
// ?token=… link, or a prompt; it is kept for this tab only and sent only in the X-Admin-Token header.
const T=(function(){const h=new URLSearchParams(location.hash.slice(1)).get("token"),q=new URLSearchParams(location.search).get("token");let t=h||q||"";
if(h||q) history.replaceState(null,"",location.pathname);
if(!t){try{t=sessionStorage.getItem("adminToken")||"";}catch(e){}}
if(!t) t=prompt("Admin token")||"";
try{sessionStorage.setItem("adminToken",t);}catch(e){}
return t;})();
const H={"content-type":"application/json","X-Admin-Token":T};
// Rows are built with the DOM: data only ever goes through esc() into text, and buttons get their values
// through closures, never through an onclick string (an attribute decodes &#39; back into a quote).
function cell(tr,html){const td=tr.insertCell(); if(html!=null) td.innerHTML=html; return td;}
function btn(td,label,fn,cls){const b=document.createElement("button"); b.textContent=label; if(cls) b.className=cls; b.addEventListener("click",fn); td.appendChild(b); td.appendChild(document.createTextNode(" ")); return b;}
async function load(){const r=await fetch("/admin",{headers:{"X-Admin-Token":T,"Accept":"application/json"}}); const d=await r.json(); if(d.error){try{sessionStorage.removeItem("adminToken");}catch(e){} document.body.innerHTML="<p>Forbidden. Reload the page to enter the token again.</p>";return;}
document.getElementById("meta").textContent="Products: "+(d.productMatch||"(none)")+" · mail mode: "+d.mailMode;
const P=document.getElementById("pending"); P.querySelectorAll("tr+tr").forEach(e=>e.remove());
for(const p of d.pending){const tr=P.insertRow(); cell(tr,esc(p.email)); cell(tr,"<code>"+esc(p.order)+"</code>"); cell(tr,esc(p.product||"studio")); cell(tr,esc(p.attempts||1));
const td=cell(tr); btn(td,"Approve",()=>act("approve",p.email,p.order,null,p.product||"studio"),"p"); btn(td,"Dismiss",()=>act("dismiss-pending",p.email));}
if(!d.pending.length){P.insertRow().innerHTML="<td colspan=5 class=muted>Nothing waiting.</td>";}
const B=document.getElementById("buyers"); B.querySelectorAll("tr+tr").forEach(e=>e.remove());
for(const b of d.buyers){const tr=B.insertRow();
cell(tr,esc(b.name||"")+"<br><span class=muted>"+esc(b.email)+(b.team?" · team "+esc(b.team.name)+(b.team.until?" until "+new Date(b.team.until*1000).toISOString().slice(0,10):""):b.approved?" · manual":"")+"</span>");
cell(tr,esc((b.products||[]).join(", ")||"nothing"));
cell(tr,(b.orders||[]).map(o=>"<code>"+esc(String(o.order||"").slice(0,11))+"</code> "+esc(o.product||"")+" "+esc(o.amount||"")+(o.closed?" <b>("+esc(o.closed)+")</b>":"")).join("<br>"));
const dv=cell(tr); (b.devices||[]).forEach((x,i)=>{if(i) dv.appendChild(document.createElement("br")); dv.appendChild(document.createTextNode(String(x.name||"")+" ")); btn(dv,"×",()=>act("remove-device",b.email,null,x.id));});
const td=cell(tr); btn(td,"Reset devices",()=>act("reset-devices",b.email)); btn(td,"Revoke",()=>{if(confirm("Remove buyer? Use after a refund."))act("revoke",b.email);});}
if(!d.buyers.length){B.insertRow().innerHTML="<td colspan=5 class=muted>No buyers yet.</td>";}}
async function act(a,email,order,deviceId,product){await fetch("/admin/"+a,{method:"POST",headers:H,body:JSON.stringify({email,order,deviceId,products:product?[product]:undefined})}); load();}
async function approve(){await fetch("/admin/approve",{method:"POST",headers:H,body:JSON.stringify({email:aEmail.value,name:aName.value,order:aOrder.value,products:aProd.value.split(",")})}); aEmail.value=aName.value=aOrder.value=""; load();}
async function team(){const r=await fetch("/admin/team",{method:"POST",headers:H,body:JSON.stringify({team:tName.value,order:tOrder.value,until:tUntil.value,products:[tProd.value],emails:tEmails.value})}); const j=await r.json(); tMsg.textContent=j.ok?(j.seats+" seats ("+j.added+" new)"):(j.error||"error"); if(j.ok) tEmails.value=""; load();}
async function teamRemove(){const r=await fetch("/admin/team-remove",{method:"POST",headers:H,body:JSON.stringify({team:tName.value})}); const j=await r.json(); tMsg.textContent=j.ok?(j.removed+" members removed"):(j.error||"error"); load();}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
load();
</script>`;
