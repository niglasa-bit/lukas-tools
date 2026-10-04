// Runs the Worker in Node with an in-memory KV. `node test/api.test.mjs`
import assert from "node:assert/strict";
import worker from "../src/index.js";

class KV {
  constructor() { this.m = new Map(); }
  async get(k, t) { const v = this.m.get(k); if (v == null) return null; return t === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix }) { return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; }
}
const env = { STUDIO: new KV(), SIGNING_SECRET: "s3cret", SYNC_SECRET: "sync", ADMIN_TOKEN: "admin", PRODUCT_MATCH: "Money Plan Studio", MAX_DEVICES: "2", ALLOWED_ORIGINS: "" };
const call = async (path, { method = "GET", body, headers = {} } = {}) => {
  const r = await worker.fetch(new Request("https://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined }), env, {});
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const ORDER = "c47d3f10-8a6d-4f86-9376-4fc5c5624a69";

// 1. activation before the sale synced → pending, never reveals anything
let r = await call("/activate", { method: "POST", body: { email: "Niko@Example.com", order: ORDER, deviceId: "dev1", deviceName: "Phone" } });
assert.equal(r.j.status, "pending");
assert.ok(await env.STUDIO.get("pending:niko@example.com"));

// 2. sync from Gmail
r = await call("/sync", { method: "POST", headers: { "X-Sync-Secret": "sync" }, body: { sales: [{ email: "niko@example.com", name: "Niko", order: ORDER, product: "Money Plan Studio", amount: "$29.00" }] } });
assert.deepEqual([r.j.added, r.j.skipped], [1, 0]);
assert.equal(await env.STUDIO.get("pending:niko@example.com"), null, "pending cleared by sync");
r = await call("/sync", { method: "POST", headers: { "X-Sync-Secret": "wrong" }, body: {} });
assert.equal(r.status, 403);

// 3. wrong product name does not unlock
await call("/sync", { method: "POST", headers: { "X-Sync-Secret": "sync" }, body: { sales: [{ email: "free@example.com", order: "11111111-free", product: "The 1-Page Money Plan (Free)" }] } });
r = await call("/activate", { method: "POST", body: { email: "free@example.com", order: "11111111-free", deviceId: "d" } });
assert.equal(r.j.status, "pending");

// 4. real buyer → code sent (to outbox, since no mail webhook), then verify
r = await call("/activate", { method: "POST", body: { email: "niko@example.com", order: "Order #: " + ORDER.toUpperCase(), deviceId: "dev1", deviceName: "Phone" } });
assert.equal(r.j.status, "code_sent");
let out = (await call("/outbox", { headers: { "X-Sync-Secret": "sync" } })).j.mails;
assert.equal(out.length, 1); const code = out[0].subject.match(/\d{6}/)[0];
r = await call("/verify", { method: "POST", body: { email: "niko@example.com", code: "000000", deviceId: "dev1" } });
assert.equal(r.j.error, "wrong_code");
r = await call("/verify", { method: "POST", body: { email: "niko@example.com", code, deviceId: "dev2" } });
assert.equal(r.j.error, "device_mismatch");
r = await call("/verify", { method: "POST", body: { email: "niko@example.com", code, deviceId: "dev1" } });
assert.equal(r.j.status, "ok"); const token = r.j.token; assert.equal(r.j.name, "Niko");

// 5. content needs a valid token for a registered device
r = await call("/content", { headers: { Authorization: "Bearer " + token } });
assert.equal(r.status, 200); assert.equal(r.j.content.stages.secure.title, "Secure"); assert.equal(r.j.devices.length, 1);
r = await call("/content", { headers: { Authorization: "Bearer " + token.slice(0, -2) + "xx" } });
assert.equal(r.status, 401);

// 6. same device again → already_active, no new code
r = await call("/activate", { method: "POST", body: { email: "niko@example.com", order: ORDER, deviceId: "dev1" } });
assert.equal(r.j.status, "already_active"); assert.ok(r.j.token);

// 7. device limit (MAX_DEVICES=2): dev2 ok, dev3 blocked, then self-remove frees a slot
await call("/outbox/ack", { method: "POST", headers: { "X-Sync-Secret": "sync" }, body: { ids: out.map((m) => m.id) } });
r = await call("/activate", { method: "POST", body: { email: "niko@example.com", order: ORDER, deviceId: "dev2", deviceName: "Laptop" } });
out = (await call("/outbox", { headers: { "X-Sync-Secret": "sync" } })).j.mails;
r = await call("/verify", { method: "POST", body: { email: "niko@example.com", code: out[0].subject.match(/\d{6}/)[0], deviceId: "dev2" } });
assert.equal(r.j.status, "ok");
r = await call("/activate", { method: "POST", body: { email: "niko@example.com", order: ORDER, deviceId: "dev3" } });
assert.equal(r.j.status, "device_limit");
r = await call("/me/remove-device", { method: "POST", headers: { Authorization: "Bearer " + token }, body: { deviceId: "dev2" } });
assert.equal(r.j.ok, true); assert.equal(r.j.devices.length, 1);
r = await call("/activate", { method: "POST", body: { email: "niko@example.com", order: ORDER, deviceId: "dev3" } });
assert.equal(r.j.status, "code_sent");

// 8. admin: list, approve a pending buyer by hand, revoke kills the token
r = await call("/admin", { headers: { "X-Admin-Token": "admin", Accept: "application/json" } });
assert.equal(r.j.buyers.length, 2); assert.equal(r.j.pending.length, 1);
r = await call("/admin/approve", { method: "POST", headers: { "X-Admin-Token": "admin" }, body: { email: "free@example.com", name: "Free" } });
r = await call("/activate", { method: "POST", body: { email: "free@example.com", order: "anything-at-all", deviceId: "d" } });
assert.equal(r.j.status, "code_sent", "manually approved buyer unlocks without an order match");
r = await call("/admin/revoke", { method: "POST", headers: { "X-Admin-Token": "admin" }, body: { email: "niko@example.com" } });
r = await call("/content", { headers: { Authorization: "Bearer " + token } });
assert.equal(r.j.error, "revoked");
r = await call("/admin", { headers: { "X-Admin-Token": "nope" } });
assert.equal(r.status, 403);

// 9. several products on one lock (default rules, no PRODUCT_MATCH)
delete env.PRODUCT_MATCH; env.STUDIO = new KV();
const sale = (email, order, product) => call("/sync", { method: "POST", headers: { "X-Sync-Secret": "sync" }, body: { sales: [{ email, name: "T", order, product }] } });
const codeFor = async (email) => { const m = (await call("/outbox", { headers: { "X-Sync-Secret": "sync" } })).j.mails.filter((x) => x.to === email).pop(); return m.subject.match(/\d{6}/)[0]; };
const unlock = async (email, order, deviceId, product) => {
  const a = await call("/activate", { method: "POST", body: { email, order, deviceId, product } });
  if (a.j.status !== "code_sent") return a.j;
  return (await call("/verify", { method: "POST", body: { email, code: await codeFor(email), deviceId } })).j;
};
const get = (token, product) => call("/content" + (product ? "?product=" + product : ""), { headers: { Authorization: "Bearer " + token } });

// Studio buyer: Studio opens as before, Year does not
await sale("s@x.com", "studio-order-1", "Money Plan Studio");
r = await unlock("s@x.com", "studio-order-1", "s1");
assert.equal(r.status, "ok"); const sTok = r.token;
r = await get(sTok); assert.equal(r.status, 200); assert.equal(r.j.content.stages.secure.title, "Secure"); assert.deepEqual(r.j.products, ["studio"]);
r = await get(sTok, "year"); assert.equal(r.status, 403); assert.equal(r.j.error, "not_owned");
r = await call("/activate", { method: "POST", body: { email: "s@x.com", order: "studio-order-1", deviceId: "s2", product: "year" } });
assert.equal(r.j.status, "pending", "Studio order does not unlock Year");
assert.equal((await env.STUDIO.get("pending:s@x.com", "json")).product, "year");

// the hidden upgrade syncs → the same device opens Year with no new code
await sale("s@x.com", "upgrade-order-1", "The Systemized Year Upgrade");
r = await get(sTok, "year"); assert.equal(r.status, 200); assert.equal(r.j.content.version, 1); assert.equal(r.j.content.areas.money.title, "Money"); assert.deepEqual(r.j.products.sort(), ["studio", "year"]);
r = await call("/activate", { method: "POST", body: { email: "s@x.com", order: "upgrade-order-1", deviceId: "s1", product: "year" } });
assert.equal(r.j.status, "already_active");

// upgrade bought without the Studio unlocks nothing
await sale("u@x.com", "upgrade-order-2", "The Systemized Year Upgrade");
r = await call("/activate", { method: "POST", body: { email: "u@x.com", order: "upgrade-order-2", deviceId: "u1", product: "year" } });
assert.equal(r.j.status, "pending");

// Year alone: Year opens, the Studio app does not, code email names the product
await sale("y@x.com", "year-order-1", "The Systemized Year");
r = await call("/activate", { method: "POST", body: { email: "y@x.com", order: "year-order-1", deviceId: "y1" } });
assert.equal(r.j.status, "pending", "Studio app (no product) stays locked for a Year-only buyer");
r = await call("/activate", { method: "POST", body: { email: "y@x.com", order: "year-order-1", deviceId: "y1", product: "year" } });
assert.equal(r.j.status, "code_sent");
let ym = (await call("/outbox", { headers: { "X-Sync-Secret": "sync" } })).j.mails.filter((x) => x.to === "y@x.com").pop();
assert.match(ym.subject, /The Systemized Year code/);
r = await call("/verify", { method: "POST", body: { email: "y@x.com", code: ym.subject.match(/\d{6}/)[0], deviceId: "y1" } });
r = await get(r.j.token); assert.equal(r.status, 403);

// bundle opens both; devices are shared across products (limit 2)
await sale("b@x.com", "pass-order-1", "Systemized Life Pass");
r = await unlock("b@x.com", "pass-order-1", "b1", "year"); const bTok = r.token;
assert.equal((await get(bTok)).status, 200); assert.equal((await get(bTok, "year")).status, 200);
r = await unlock("b@x.com", "pass-order-1", "b2"); assert.equal(r.status, "ok");
r = await call("/activate", { method: "POST", body: { email: "b@x.com", order: "pass-order-1", deviceId: "b3", product: "year" } });
assert.equal(r.j.status, "device_limit");

// hand approval: products chosen on the admin page; old approvals mean Studio
r = await call("/admin/approve", { method: "POST", headers: { "X-Admin-Token": "admin" }, body: { email: "h@x.com", products: ["year"] } });
r = await call("/activate", { method: "POST", body: { email: "h@x.com", order: "whatever-123", deviceId: "h1", product: "year" } });
assert.equal(r.j.status, "code_sent");
r = await call("/activate", { method: "POST", body: { email: "h@x.com", order: "whatever-123", deviceId: "h1" } });
assert.equal(r.j.status, "pending");
await env.STUDIO.put("buyer:old@x.com", JSON.stringify({ email: "old@x.com", orders: [], devices: [], approved: true }));
r = await call("/activate", { method: "POST", body: { email: "old@x.com", order: "whatever-123", deviceId: "o1" } });
assert.equal(r.j.status, "code_sent", "approvals made before this change still open the Studio");
r = await call("/admin", { headers: { "X-Admin-Token": "admin", Accept: "application/json" } });
assert.deepEqual(r.j.buyers.find((b) => b.email === "s@x.com").products.sort(), ["studio", "year"]);

// The Autopilot Workbook: its own Beacons product, its own content, shares the buyer's devices
await sale("a@x.com", "auto-order-1", "The Autopilot Workbook");
r = await call("/activate", { method: "POST", body: { email: "a@x.com", order: "auto-order-1", deviceId: "a1", product: "year" } });
assert.equal(r.j.status, "pending", "Autopilot order does not open Year");
r = await unlock("a@x.com", "auto-order-1", "a1", "autopilot"); assert.equal(r.status, "ok"); const aTok = r.token;
ym = (await call("/outbox", { headers: { "X-Sync-Secret": "sync" } })).j.mails.filter((x) => x.to === "a@x.com").pop();
assert.match(ym.subject, /The Autopilot Workbook code/); assert.match(ym.html, /Lukas/);
r = await get(aTok, "autopilot"); assert.equal(r.status, 200); assert.equal(r.j.team, ""); assert.ok(r.j.content.recipes.length >= 20); assert.ok(r.j.content.prompts.length >= 30);
assert.deepEqual(r.j.products, ["autopilot"]);
assert.equal((await get(aTok)).status, 403, "Studio stays locked");
// Studio buyer adds the workbook later: same device opens it without a new code
await sale("s@x.com", "auto-order-2", "The Autopilot Workbook");
assert.equal((await get(sTok, "autopilot")).status, 200);

// The Enough Habit: own Beacons product and content, opens nothing else
await sale("e@x.com", "enough-order-1", "The Enough Habit");
r = await call("/activate", { method: "POST", body: { email: "e@x.com", order: "enough-order-1", deviceId: "e1", product: "autopilot" } });
assert.equal(r.j.status, "pending", "Enough order does not open the Workbook");
r = await unlock("e@x.com", "enough-order-1", "e1", "enough"); assert.equal(r.status, "ok"); const eTok = r.token;
ym = (await call("/outbox", { headers: { "X-Sync-Secret": "sync" } })).j.mails.filter((x) => x.to === "e@x.com").pop();
assert.match(ym.subject, /The Enough Habit code/);
r = await get(eTok, "enough"); assert.equal(r.status, 200); assert.deepEqual(r.j.products, ["enough"]);
{
  const c = r.j.content;
  assert.equal(c.goals.length, 60);
  assert.deepEqual(c.goals.map((g) => g.n), Array.from({ length: 60 }, (_, i) => i + 1), "goals numbered 1-60 in order");
  for (const g of c.goals) assert.ok(g.title && g.why && g.title.length <= 48 && typeof g.min === "number" && typeof g.kept === "boolean", "goal " + g.n);
  assert.equal(c.stages.length, 6);
  assert.deepEqual(c.stages.map((st) => st.days), [[1, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60]]);
  assert.ok(!/\bAI\b|artificial intelligence/i.test(JSON.stringify(c)), "no AI mention in buyer-facing content");
}
assert.equal((await get(eTok, "year")).status, 403, "Year stays locked");
assert.equal((await get(sTok, "enough")).status, 403, "Studio buyer does not get Enough for free");

// B2B team: seats added by the owner, each person unlocks with their own email + contract number
const A = { "X-Admin-Token": "admin" };
r = await call("/admin/team", { method: "POST", headers: A, body: { team: "Acme Oy", order: "AP-2026-001", emails: "anna@acme.fi\nMikko@Acme.fi, bad-email", products: ["autopilot"] } });
assert.equal(r.j.seats, 2); assert.equal(r.j.added, 2);
r = await call("/activate", { method: "POST", body: { email: "anna@acme.fi", order: "wrong-contract", deviceId: "t1", product: "autopilot" } });
assert.equal(r.j.status, "pending", "a seat needs the contract number");
r = await unlock("anna@acme.fi", "ap-2026-001", "t1", "autopilot"); assert.equal(r.status, "ok"); const tTok = r.token;
ym = (await call("/outbox", { headers: { "X-Sync-Secret": "sync" } })).j.mails.filter((x) => x.to === "anna@acme.fi").pop();
assert.match(ym.html, /licensed to Acme Oy/); assert.doesNotMatch(ym.html, /Lukas/);
r = await get(tTok, "autopilot"); assert.equal(r.status, 200); assert.equal(r.j.team, "Acme Oy");
assert.equal((await get(tTok, "year")).status, 403, "a seat opens only the licensed product");
// licence end date in the past: access stops, nobody is deleted
await call("/admin/team", { method: "POST", headers: A, body: { team: "Acme Oy", order: "AP-2026-001", emails: "anna@acme.fi", until: "2020-01-01" } });
r = await get(tTok, "autopilot"); assert.equal(r.status, 403);
await call("/admin/team", { method: "POST", headers: A, body: { team: "Acme Oy", order: "AP-2026-001", emails: "anna@acme.fi", until: "2099-12-31" } });
assert.equal((await get(tTok, "autopilot")).status, 200);
// a seat holder who also bought something personally keeps it when the team ends
await sale("mikko@acme.fi", "mikko-studio-1", "Money Plan Studio");
r = await call("/admin/team-remove", { method: "POST", headers: A, body: { team: "Acme Oy" } });
assert.equal(r.j.removed, 2);
assert.equal(await env.STUDIO.get("buyer:anna@acme.fi"), null);
r = await call("/admin", { headers: { ...A, Accept: "application/json" } });
assert.deepEqual(r.j.buyers.find((b) => b.email === "mikko@acme.fi").products, ["studio"]);

// Stripe: signed webhook → order code, purchase email, thank-you lookup, unlock, full refund closes only that order
{
  const { createHmac } = await import("node:crypto");
  env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  env.SELLER = "Sold via Stripe for Sevenflow Labs Oy";
  const hook = async (ev, { secret = "whsec_test", t = Math.floor(Date.now() / 1000) } = {}) => {
    const raw = JSON.stringify(ev);
    const sig = createHmac("sha256", secret).update(t + "." + raw).digest("hex");
    const res = await worker.fetch(new Request("https://x/stripe-webhook", { method: "POST", headers: { "Stripe-Signature": `t=${t},v1=${sig}` }, body: raw }), env, {});
    return { status: res.status, j: await res.json() };
  };
  const session = (id, product, extra = {}) => ({ type: "checkout.session.completed", data: { object: { id, payment_status: "paid", payment_intent: "pi_" + id, amount_total: 1900, currency: "usd", created: 1790000000, customer_details: { email: "Sara@Example.com", name: "Sara Buyer" }, metadata: { product }, ...extra } } });

  r = await hook(session("cs_test_year1", "The Systemized Year"), { secret: "whsec_wrong" });
  assert.equal(r.status, 400, "bad signature rejected");
  r = await hook(session("cs_test_year1", "The Systemized Year"), { t: Math.floor(Date.now() / 1000) - 3600 });
  assert.equal(r.status, 400, "old timestamp rejected");
  r = await call("/order?session_id=cs_test_year1");
  assert.equal(r.j.status, "waiting");

  r = await hook(session("cs_test_year1", "The Systemized Year"));
  assert.equal(r.j.result, "added");
  r = await hook(session("cs_test_year1", "The Systemized Year"));
  assert.equal(r.j.result, "skipped", "Stripe retry does not duplicate");
  let mails = (await call("/outbox", { headers: { "X-Sync-Secret": "sync" } })).j.mails.filter((m) => m.to === "sara@example.com");
  assert.equal(mails.length, 1, "one purchase email");
  const code = mails[0].subject.match(/LK-[0-9A-F]{8}/)[0];
  assert.match(mails[0].html, /year\//); assert.match(mails[0].html, /right of withdrawal/); assert.match(mails[0].html, /Sevenflow Labs Oy/);

  r = await call("/order?session_id=cs_test_year1");
  assert.equal(r.j.status, "ready"); assert.equal(r.j.order, code); assert.equal(r.j.email, "sa•••@example.com");
  assert.deepEqual(r.j.apps.map((a) => a.key), ["year"]);
  assert.equal((await call("/order?session_id=../x")).status, 400);

  r = await unlock("sara@example.com", code.toLowerCase(), "s1", "year"); assert.equal(r.status, "ok"); const yTok = r.token;
  assert.equal((await get(yTok, "year")).status, 200);

  // unpaid (async) session is ignored until it succeeds
  r = await hook(session("cs_test_late", "Money Plan Studio", { payment_status: "unpaid" }));
  assert.equal(r.j.ignored, "unpaid");
  r = await hook({ ...session("cs_test_late", "Money Plan Studio"), type: "checkout.session.async_payment_succeeded" });
  assert.equal(r.j.result, "updated");

  // partial refund keeps access, full refund closes only the Year order
  r = await hook({ type: "charge.refunded", data: { object: { payment_intent: "pi_cs_test_year1", refunded: false } } });
  assert.equal(r.j.ignored, "partial_refund");
  r = await hook({ type: "charge.refunded", data: { object: { payment_intent: "pi_cs_test_year1", refunded: true } } });
  assert.equal(r.j.closed, true);
  assert.equal((await get(yTok, "year")).status, 403, "refunded product locks");
  assert.equal((await get(yTok, "studio")).status, 200, "other purchase still works");
}

console.log("ok · all API checks passed");
