// Money Plan Studio · license API (Cloudflare Worker)
//
// Lock model, honestly stated: Beacons delivers the same file to every buyer,
// so this Worker is the lock. A buyer unlocks the app with the email used at
// purchase + the Order # from the Beacons receipt, confirms with a one-time
// code sent to that email, and may activate up to MAX_DEVICES devices.
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
//   pending:<email> {email,order,product,deviceName,created,attempts}   (activation tried before the sale synced)
//   code:<email>    {code,deviceId,deviceName,exp,tries}          (TTL 15 min)
//   mail:<id>       {to,subject,html,created}                     (outbox, only when no MAIL_WEBHOOK_URL)

import { CONTENT } from "./content.js";
import { CONTENT_YEAR } from "./content-year.js";
import { CONTENT_AUTOPILOT } from "./content-autopilot.js";

// Product keys an app can ask for, the name used in emails, and the content it gets.
const PRODUCT_INFO = {
  studio: { name: "Money Plan Studio", content: CONTENT },
  year: { name: "The Systemized Year", content: CONTENT_YEAR },
  autopilot: { name: "The Autopilot Workbook", content: CONTENT_AUTOPILOT },
};

// Which Beacons product names unlock which product keys. First matching rule wins,
// matched case-insensitively against the product name in the sale email.
// `requires`: the rule only counts if the buyer already owns that key through
// another order (the hidden upgrade product is only for Studio buyers).
// Override with the PRODUCTS var (same JSON shape). Without it, the old single
// PRODUCT_MATCH keeps working and unlocks the Studio only.
const DEFAULT_PRODUCTS = [
  { match: "autopilot workbook", grants: ["autopilot"] },
  { match: "systemized year upgrade", grants: ["year"], requires: "studio" },
  { match: "systemized life pass", grants: ["studio", "year"] },
  { match: "systemized year", grants: ["year"] },
  { match: "money plan studio", grants: ["studio"] },
];

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const CODE_TTL = 15 * 60;       // seconds
const TOKEN_MAX_AGE = 400 * 24 * 3600; // ~13 months; re-issued silently on /content

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(env, origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const res = await route(request, env, url);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      return json({ error: "server_error", detail: String(e && e.message || e) }, 500, cors);
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
  if (p === "/me" && m === "GET") return me(request, env);
  if (p === "/me/remove-device" && m === "POST") return removeDevice(request, env);
  if (p === "/sync" && m === "POST") return sync(request, env);
  if (p === "/outbox" && m === "GET") return outbox(request, env);
  if (p === "/outbox/ack" && m === "POST") return outboxAck(request, env);
  if (p.startsWith("/admin")) return admin(request, env, url, p);
  return json({ error: "not_found" }, 404);
}

// ---------- buyer flow ----------

async function activate(request, env) {
  const b = await body(request);
  const email = normEmail(b.email);
  const order = normOrder(b.order);
  const deviceId = String(b.deviceId || "").slice(0, 64);
  const deviceName = String(b.deviceName || "device").slice(0, 60);
  const product = productKey(b.product);
  if (!isEmail(email)) return json({ error: "bad_email" }, 400);
  if (order.length < 8) return json({ error: "bad_order" }, 400);
  if (!deviceId) return json({ error: "bad_device" }, 400);

  const buyer = await getBuyer(env, email);
  const ok = buyer && orderUnlocks(buyer, order, product, env);
  if (!ok) {
    // Sale may not have synced yet (Gmail script runs every few minutes). Park it;
    // the admin page shows it with a one-click approve. Never reveal whether the email exists.
    const key = "pending:" + email;
    const prev = (await env.STUDIO.get(key, "json")) || { attempts: 0 };
    await env.STUDIO.put(key, JSON.stringify({ email, order, product, deviceName, created: prev.created || now(), last: now(), attempts: (prev.attempts || 0) + 1 }));
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

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await env.STUDIO.put("code:" + email, JSON.stringify({ code, deviceId, deviceName, exp: now() + CODE_TTL, tries: 0 }), { expirationTtl: CODE_TTL });
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
  if (!isEmail(email) || code.length !== 6 || !deviceId) return json({ error: "bad_request" }, 400);

  const key = "code:" + email;
  const rec = await env.STUDIO.get(key, "json");
  if (!rec || rec.exp < now()) return json({ error: "code_expired", message: "That code has expired. Request a new one." }, 400);
  if (rec.deviceId !== deviceId) return json({ error: "device_mismatch", message: "Request the code from the device you want to unlock." }, 400);
  if (rec.code !== code) {
    rec.tries = (rec.tries || 0) + 1;
    if (rec.tries >= 5) { await env.STUDIO.delete(key); return json({ error: "too_many_tries", message: "Too many attempts. Request a new code." }, 400); }
    await env.STUDIO.put(key, JSON.stringify(rec), { expirationTtl: Math.max(60, rec.exp - now()) });
    return json({ error: "wrong_code", message: "That code doesn't match." }, 400);
  }

  const buyer = await getBuyer(env, email);
  if (!buyer) return json({ error: "no_buyer" }, 400);
  const max = parseInt(env.MAX_DEVICES || "3", 10);
  buyer.devices = buyer.devices || [];
  if (!buyer.devices.find((d) => d.id === deviceId)) {
    if (buyer.devices.length >= max) return json({ status: "device_limit", max }, 400);
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
    const email = normEmail(s.email);
    const order = normOrder(s.order);
    if (!isEmail(email) || order.length < 8) { skipped++; continue; }
    const buyer = (await getBuyer(env, email)) || { email, name: "", orders: [], devices: [], approved: false, created: now() };
    if (!buyer.orders.find((o) => o.order === order)) {
      buyer.orders.push({ order, product: String(s.product || "").slice(0, 120), amount: String(s.amount || "").slice(0, 20), date: String(s.date || "").slice(0, 40), synced: now() });
      if (!buyer.name && s.name) buyer.name = String(s.name).slice(0, 80);
      buyer.orders.length === 1 ? added++ : updated++;
      await putBuyer(env, buyer);
      await env.STUDIO.delete("pending:" + email);
    } else skipped++;
  }
  return json({ ok: true, added, updated, skipped });
}

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
  const token = request.headers.get("X-Admin-Token") || url.searchParams.get("token") || "";
  if (!secretOk(token, env.ADMIN_TOKEN)) return json({ error: "forbidden" }, 403);

  if (p === "/admin" && request.method === "GET") {
    if ((request.headers.get("Accept") || "").includes("text/html")) return new Response(ADMIN_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
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
  if (order.length < 4) return json({ error: "bad_order" }, 400);
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

async function getBuyer(env, email) { return env.STUDIO.get("buyer:" + email, "json"); }
async function putBuyer(env, buyer) { return env.STUDIO.put("buyer:" + buyer.email, JSON.stringify(buyer)); }

function normEmail(s) { return String(s || "").trim().toLowerCase().slice(0, 120); }
function normOrder(s) { return String(s || "").trim().toLowerCase().replace(/^order\s*#?:?\s*/i, "").slice(0, 80); }
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
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.SIGNING_SECRET || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function sign(env, payload) {
  const data = b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(data));
  return data + "." + b64u(new Uint8Array(sig));
}
async function verifyToken(env, token) {
  const [data, sig] = String(token).split(".");
  if (!data || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(env), unb64u(sig), new TextEncoder().encode(data));
  if (!ok) return null;
  try { return JSON.parse(new TextDecoder().decode(unb64u(data))); } catch { return null; }
}
function b64u(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

// --- mail: Apps Script webhook (instant, free, from the owner's Gmail) → Resend → outbox ---
async function sendMail(env, mail) {
  if (env.MAIL_WEBHOOK_URL) {
    const r = await fetch(env.MAIL_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: env.SYNC_SECRET, ...mail }), redirect: "follow" });
    if (r.ok) return;
  }
  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + env.RESEND_API_KEY }, body: JSON.stringify({ from: env.MAIL_FROM, to: [mail.to], subject: mail.subject, html: mail.html }) });
    if (r.ok) return;
  }
  await env.STUDIO.put("mail:" + crypto.randomUUID(), JSON.stringify({ ...mail, created: now() }), { expirationTtl: CODE_TTL });
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
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

const ADMIN_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Studio admin</title>
<style>body{font:15px/1.45 system-ui,sans-serif;color:#1F3A5F;background:#F3FAF8;margin:0;padding:16px;max-width:900px;margin:auto}h1{font-size:20px}h2{font-size:16px;margin-top:24px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}td,th{padding:8px 10px;border-bottom:1px solid #CFE6E1;text-align:left;font-size:14px;vertical-align:top}th{background:#E6F3F0}
button{font:inherit;border:1px solid #CFE6E1;background:#E6F3F0;border-radius:8px;padding:4px 8px;cursor:pointer;margin:2px}button.p{background:#2A9D8F;color:#fff;border-color:#2A9D8F}input{font:inherit;padding:6px 8px;border:1px solid #CFE6E1;border-radius:8px}
.muted{color:#5F8A99;font-size:13px}</style>
<h1>Lukas products · buyers</h1><p class="muted" id="meta"></p>
<h2>Waiting for approval</h2><table id="pending"><tr><th>Email</th><th>Order # they typed</th><th>For</th><th>Tries</th><th></th></tr></table>
<h2>Buyers</h2><table id="buyers"><tr><th>Buyer</th><th>Owns</th><th>Orders</th><th>Devices</th><th></th></tr></table>
<h2>Add a buyer by hand</h2><p><input id="aEmail" placeholder="email"> <input id="aName" placeholder="name"> <input id="aOrder" placeholder="order # (optional)"> <select id="aProd"><option value="studio">Money Plan Studio</option><option value="year">The Systemized Year</option><option value="studio,year">Studio + Year</option><option value="autopilot">The Autopilot Workbook</option></select> <button class="p" onclick="approve()">Approve</button></p>
<h2>Add a team (B2B licence)</h2><p class="muted">Company name, the contract or invoice number people type as their Order #, the end date, and one email per line. Re-adding the same team adds seats and updates the end date.</p>
<p><input id="tName" placeholder="company, e.g. Acme Oy"> <input id="tOrder" placeholder="contract #, e.g. AP-2026-001"> <input id="tUntil" type="date" title="licence ends"> <select id="tProd"><option value="autopilot">The Autopilot Workbook</option></select><br><textarea id="tEmails" rows="5" style="width:100%;margin-top:6px;font:inherit" placeholder="anna@acme.fi&#10;mikko@acme.fi"></textarea><br><button class="p" onclick="team()">Add seats</button> <button onclick="if(confirm('End this team licence? Members lose access at their next launch.'))teamRemove()">End team licence</button> <span id="tMsg" class="muted"></span></p>
<script>
const T=new URLSearchParams(location.search).get("token"); const H={"content-type":"application/json","X-Admin-Token":T};
async function load(){const r=await fetch("/admin",{headers:{"X-Admin-Token":T,"Accept":"application/json"}}); const d=await r.json(); if(d.error){document.body.innerHTML="<p>Forbidden</p>";return;}
document.getElementById("meta").textContent="Products: "+(d.productMatch||"(none)")+" · mail mode: "+d.mailMode;
const P=document.getElementById("pending"); P.querySelectorAll("tr+tr").forEach(e=>e.remove());
for(const p of d.pending){const tr=P.insertRow(); tr.innerHTML="<td>"+esc(p.email)+"</td><td><code>"+esc(p.order)+"</code></td><td>"+esc(p.product||"studio")+"</td><td>"+(p.attempts||1)+"</td><td><button class=p onclick=\\"act('approve','"+esc(p.email)+"','"+esc(p.order)+"',null,'"+esc(p.product||"studio")+"')\\">Approve</button> <button onclick=\\"act('dismiss-pending','"+esc(p.email)+"')\\">Dismiss</button></td>";}
if(!d.pending.length){P.insertRow().innerHTML="<td colspan=5 class=muted>Nothing waiting.</td>";}
const B=document.getElementById("buyers"); B.querySelectorAll("tr+tr").forEach(e=>e.remove());
for(const b of d.buyers){const tr=B.insertRow(); tr.innerHTML="<td>"+esc(b.name||"")+"<br><span class=muted>"+esc(b.email)+(b.team?" · team "+esc(b.team.name)+(b.team.until?" until "+new Date(b.team.until*1000).toISOString().slice(0,10):""):b.approved?" · manual":"")+"</span></td><td>"+esc((b.products||[]).join(", ")||"nothing")+"</td><td>"+(b.orders||[]).map(o=>"<code>"+esc(o.order.slice(0,8))+"…</code> "+esc(o.product||"")+" "+esc(o.amount||"")).join("<br>")+"</td><td>"+(b.devices||[]).map(x=>esc(x.name)+" <button onclick=\\"act('remove-device','"+esc(b.email)+"',null,'"+esc(x.id)+"')\\">×</button>").join("<br>")+"</td><td><button onclick=\\"act('reset-devices','"+esc(b.email)+"')\\">Reset devices</button> <button onclick=\\"if(confirm('Remove buyer? Use after a refund.'))act('revoke','"+esc(b.email)+"')\\">Revoke</button></td>";}
if(!d.buyers.length){B.insertRow().innerHTML="<td colspan=5 class=muted>No buyers yet.</td>";}}
async function act(a,email,order,deviceId,product){await fetch("/admin/"+a,{method:"POST",headers:H,body:JSON.stringify({email,order,deviceId,products:product?[product]:undefined})}); load();}
async function approve(){await fetch("/admin/approve",{method:"POST",headers:H,body:JSON.stringify({email:aEmail.value,name:aName.value,order:aOrder.value,products:aProd.value.split(",")})}); aEmail.value=aName.value=aOrder.value=""; load();}
async function team(){const r=await fetch("/admin/team",{method:"POST",headers:H,body:JSON.stringify({team:tName.value,order:tOrder.value,until:tUntil.value,products:[tProd.value],emails:tEmails.value})}); const j=await r.json(); tMsg.textContent=j.ok?(j.seats+" seats ("+j.added+" new)"):(j.error||"error"); if(j.ok) tEmails.value=""; load();}
async function teamRemove(){const r=await fetch("/admin/team-remove",{method:"POST",headers:H,body:JSON.stringify({team:tName.value})}); const j=await r.json(); tMsg.textContent=j.ok?(j.removed+" members removed"):(j.error||"error"); load();}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
load();
</script>`;
