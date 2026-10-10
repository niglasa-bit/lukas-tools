// Runs the Worker in Node with an in-memory KV. `node test/api.test.mjs`
import assert from "node:assert/strict";
import worker from "../src/index.js";

class KV {
  constructor() { this.m = new Map(); }
  async get(k, t) { const v = this.m.get(k); if (v == null) return null; return t === "json" ? JSON.parse(v) : v; }
  async put(k, v, o) { this.m.set(k, v); if (o && o.expirationTtl) (this.ttl ||= new Map()).set(k, o.expirationTtl); }
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
assert.equal(env.STUDIO.ttl.get("pending:niko@example.com"), 14 * 24 * 3600, "a parked activation (maybe a non-buyer's email) expires");

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
// the same order pasted as "# <code>" (copied with the hash from the receipt) matches too
r = await call("/activate", { method: "POST", body: { email: "niko@example.com", order: "# " + ORDER, deviceId: "dev1", deviceName: "Phone" } });
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
  env.SELLER = "Sold via Stripe for Sevenflow Oy";
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
  assert.match(mails[0].html, /year\//); assert.match(mails[0].html, /right of withdrawal/); assert.match(mails[0].html, /Sevenflow Oy/);

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
  // All-Access bundle: one order opens all four apps
  r = await hook({ ...session("cs_test_all", "all-access"), data: { object: { ...session("cs_test_all", "all-access").data.object, customer_details: { email: "all@example.com", name: "All" } } } });
  assert.equal(r.j.result, "added");
  r = await call("/order?session_id=cs_test_all");
  assert.deepEqual(r.j.apps.map((a) => a.key), ["studio", "year", "autopilot", "enough"]);
  r = await unlock("all@example.com", r.j.order.toLowerCase(), "a1", "autopilot"); assert.equal(r.status, "ok"); const aTok = r.token;
  for (const k of ["studio", "year", "autopilot", "enough"]) assert.equal((await get(aTok, k)).status, 200, k + " opens");

  // another Sevenflow product on the shared Stripe account is not a Lukas buyer and gets no Lukas email
  r = await hook({ ...session("cs_test_other", "Pocket Expert Pro"), data: { object: { ...session("cs_test_other", "Pocket Expert Pro").data.object, customer_details: { email: "other@example.com" } } } });
  assert.equal(r.j.ignored, "other_product");
  assert.equal(await env.STUDIO.get("buyer:other@example.com"), null);

  // a PRODUCTS rule with an unknown key (typo) still records the sale and sends the purchase email
  env.PRODUCTS = '[{"match":"typo pack","grants":["year","autopiloot"]}]';
  r = await hook({ ...session("cs_test_typo", "Typo Pack"), data: { object: { ...session("cs_test_typo", "Typo Pack").data.object, customer_details: { email: "typo@example.com" } } } });
  assert.equal(r.j.result, "added");
  assert.equal((await call("/outbox", { headers: { "X-Sync-Secret": "sync" } })).j.mails.filter((m) => m.to === "typo@example.com").length, 1, "purchase email sent");
  assert.deepEqual((await call("/order?session_id=cs_test_typo")).j.apps.map((a) => a.key), ["year"]);
  delete env.PRODUCTS;
}

// hardening: a malformed token is a 401 (not a 500), errors leak no internals, activation is rate limited
{
  const res = await worker.fetch(new Request("https://x/content", { headers: { Authorization: "Bearer x.!!!" } }), env, {});
  assert.equal(res.status, 401);
  for (let i = 0; i < 10; i++) await call("/activate", { method: "POST", body: { email: "guess@example.com", order: "guess-0000-" + i, deviceId: "g" } });
  r = await call("/activate", { method: "POST", body: { email: "guess@example.com", order: "guess-0000-x", deviceId: "g" } });
  assert.equal(r.status, 429, "11th try within the hour slows down");
  r = await call("/admin/team", { method: "POST", headers: { "X-Admin-Token": "admin" }, body: { team: "Short Oy", order: "AP-1", emails: "a@short.fi" } });
  assert.equal(r.j.error, "bad_order", "team contract numbers must be long enough to type in the app");
}

// ---------- hardening: admin page XSS, token handling, rate limit, codes, mail confirmation ----------
{
  env.STUDIO = new KV(); env.ADMIN_TOKEN = "admin"; delete env.MAIL_WEBHOOK_URL;
  const A = { "X-Admin-Token": "admin" };

  // The admin page loads without a token (it holds no data); the data API needs the header, never ?token=.
  const page = await worker.fetch(new Request("https://x/admin", { headers: { Accept: "text/html" } }), env, {});
  assert.equal(page.status, 200); const html = await page.text();
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.doesNotMatch(html, /onclick=\\?"act\(/, "no inline handler built from data");
  r = await call("/admin?token=admin", { headers: { Accept: "application/json" } });
  assert.equal(r.status, 403, "token in the query string is no longer accepted");

  // A hostile pending row: the email passes isEmail and the order has quotes and tags.
  const evilEmail = "a');alert(1);//@x.io", evilOrder = "x');alert(2);//<img src=x onerror=alert(3)>";
  r = await call("/activate", { method: "POST", body: { email: evilEmail, order: evilOrder, deviceId: "d1" } });
  assert.equal(r.j.status, "pending");
  await env.STUDIO.put("buyer:b@x.io", JSON.stringify({ email: "b@x.io", name: "<b>N</b>\"'", orders: [{ order: "o\"'><svg onload=alert(4)>", product: "Money Plan Studio" }], devices: [{ id: "d'\");alert(5);//", name: "<i>Phone</i>" }], created: 1 }));

  // Run the page script against a tiny DOM and check that no data reaches markup unescaped and the buttons send the raw values.
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const markup = [], posts = [];
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this._html = ""; this.textContent = ""; }
    set innerHTML(v) { this._html = v; markup.push(v); } get innerHTML() { return this._html; }
    insertRow() { const e = new El("tr"); this.children.push(e); return e; }
    insertCell() { const e = new El("td"); this.children.push(e); return e; }
    appendChild(c) { this.children.push(c); return c; }
    addEventListener(t, f) { this.listeners[t] = f; }
    querySelectorAll() { return []; }
    remove() {}
    all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
  }
  const els = {}, doc = { body: new El("body"), getElementById: (id) => (els[id] ||= new El("table")), createElement: (t) => new El(t), createTextNode: (t) => ({ text: t }) };
  const fakeFetch = async (path, opt = {}) => {
    if (opt.method === "POST") posts.push({ path, headers: opt.headers, body: JSON.parse(opt.body) });
    const res = await worker.fetch(new Request("https://x" + path, { method: opt.method || "GET", headers: opt.headers, body: opt.body }), env, {});
    return { json: () => res.json() };
  };
  const loc = { hash: "#token=admin", search: "", pathname: "/admin" }; let replaced = null;
  const store = new Map();
  const run = new Function("document", "fetch", "location", "history", "sessionStorage", "prompt", "confirm", script + "\nreturn load;");
  const load = run(doc, fakeFetch, loc, { replaceState: (a, b, u) => { replaced = u; } }, { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, () => "", () => true);
  await load(); await new Promise((res) => setTimeout(res, 0));
  assert.equal(replaced, "/admin", "token removed from the address bar"); assert.equal(store.get("adminToken"), "admin");
  for (const m of markup) assert.doesNotMatch(m, /<(img|svg|i>|b>N)|['"]/, "data is escaped in markup: " + m);
  const buttons = Object.values(els).flatMap((e) => e.all()).filter((e) => e.tag === "button");
  const approve = buttons.find((b) => b.textContent === "Approve");
  await approve.listeners.click(); await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual([posts[0].path, posts[0].body.email, posts[0].body.order, posts[0].headers["X-Admin-Token"]], ["/admin/approve", evilEmail.toLowerCase(), evilOrder.toLowerCase(), "admin"]);
  const rm = buttons.find((b) => b.textContent === "×");
  await rm.listeners.click();
  assert.equal(posts[1].body.deviceId, "d'\");alert(5);//", "device id passed as data, not code");
}
{
  // One-time codes: CSPRNG, always 6 digits.
  const src = (await import("node:fs")).readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /Math\.random/, "no Math.random in the lock");
  env.STUDIO = new KV();
  await sale("c@x.com", "code-order-1", "Money Plan Studio");
  for (let i = 0; i < 8; i++) {
    r = await call("/activate", { method: "POST", body: { email: "c@x.com", order: "code-order-1", deviceId: "c" + i } });
    assert.equal(r.j.status, "code_sent");
  }
  const codes = (await call("/outbox", { headers: { "X-Sync-Secret": "sync" } })).j.mails.map((m) => m.subject.match(/^(\d+) /)[1]);
  for (const c of codes) assert.match(c, /^[1-9]\d{5}$/);
  const codeKey = [...env.STUDIO.ttl.keys()].find((k) => k.startsWith("mail:"));
  assert.equal(env.STUDIO.ttl.get(codeKey), 15 * 60, "code mails expire with the code");

  // Rate limit: 10 activations per email per hour, then 429 with a message; other emails are unaffected.
  for (let i = 0; i < 2; i++) await call("/activate", { method: "POST", body: { email: "c@x.com", order: "code-order-1", deviceId: "c9" } });
  r = await call("/activate", { method: "POST", body: { email: "c@x.com", order: "code-order-1", deviceId: "c9" } });
  assert.equal(r.status, 429); assert.equal(r.j.error, "rate_limited"); assert.ok(r.j.message);
  r = await call("/activate", { method: "POST", body: { email: "other@x.com", order: "code-order-1", deviceId: "c9" } });
  assert.equal(r.j.status, "pending");
  // per IP (Cloudflare sets CF-Connecting-IP): limit from RATE_ACTIVATE_IP
  env.RATE_ACTIVATE_IP = "3";
  for (let i = 0; i < 3; i++) {
    r = await call("/activate", { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.9" }, body: { email: "ip" + i + "@x.com", order: "whatever-1", deviceId: "z" } });
    assert.equal(r.j.status, "pending");
  }
  r = await call("/activate", { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.9" }, body: { email: "ip9@x.com", order: "whatever-1", deviceId: "z" } });
  assert.equal(r.status, 429);
  assert.equal(await env.STUDIO.get("pending:ip9@x.com"), null, "a limited call writes nothing");
  r = await call("/activate", { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.10" }, body: { email: "ip9@x.com", order: "whatever-1", deviceId: "z" } });
  assert.equal(r.j.status, "pending");
  delete env.RATE_ACTIVATE_IP;

  // The shortest team contract number the admin page accepts (MIN_ORDER_LEN = 8) also works in /activate.
  r = await call("/admin/team", { method: "POST", headers: { "X-Admin-Token": "admin" }, body: { team: "Tiny Oy", order: "AP-2026-", emails: "t@tiny.fi", products: ["autopilot"] } });
  assert.equal(r.j.ok, true);
  r = await unlock("t@tiny.fi", "ap-2026-", "t1", "autopilot"); assert.equal(r.status, "ok", "8-character contract number unlocks");
  r = await call("/activate", { method: "POST", body: { email: "t@tiny.fi", order: "ap-2026", deviceId: "t2", product: "autopilot" } });
  assert.equal(r.j.error, "bad_order"); assert.ok(r.j.message);
}
{
  // Mail webhook: Apps Script answers 200 even on failure, so only {"ok":true} counts as sent.
  env.STUDIO = new KV(); env.MAIL_WEBHOOK_URL = "https://script.example/exec";
  const realFetch = globalThis.fetch; let reply = { ok: false, error: "forbidden" }, hits = 0;
  globalThis.fetch = async (u, o) => { if (String(u) === env.MAIL_WEBHOOK_URL) { hits++; return new Response(JSON.stringify(reply), { status: 200 }); } return realFetch(u, o); };
  const errLog = console.error; console.error = () => {};
  try {
    await sale("m@x.com", "mail-order-1", "Money Plan Studio");
    r = await call("/activate", { method: "POST", body: { email: "m@x.com", order: "mail-order-1", deviceId: "m1" } });
    assert.equal(r.j.status, "code_sent"); assert.equal(hits, 1);
    let mails = (await call("/outbox", { headers: { "X-Sync-Secret": "sync" } })).j.mails;
    assert.equal(mails.length, 1, "an unconfirmed webhook send lands in the outbox");
    reply = { ok: true };
    r = await call("/activate", { method: "POST", body: { email: "m@x.com", order: "mail-order-1", deviceId: "m2" } });
    mails = (await call("/outbox", { headers: { "X-Sync-Secret": "sync" } })).j.mails;
    assert.equal(mails.length, 1, "a confirmed send does not queue");
    globalThis.fetch = async (u) => new Response("<html>Script function not found</html>", { status: 200 });
    r = await call("/activate", { method: "POST", body: { email: "m@x.com", order: "mail-order-1", deviceId: "m3" } });
    assert.equal((await call("/outbox", { headers: { "X-Sync-Secret": "sync" } })).j.mails.length, 2, "an HTML error page is not a send");
  } finally { globalThis.fetch = realFetch; console.error = errLog; delete env.MAIL_WEBHOOK_URL; }

  // Purchase emails wait 7 days in the outbox (they are the buyer's receipt), code mails 15 minutes.
  const { createHmac } = await import("node:crypto");
  const ev = { type: "checkout.session.completed", data: { object: { id: "cs_test_ttl", payment_status: "paid", payment_intent: "pi_ttl", amount_total: 1900, currency: "usd", created: 1790000000, customer_details: { email: "ttl@example.com" }, metadata: { product: "Money Plan Studio" } } } };
  const raw = JSON.stringify(ev), t = Math.floor(Date.now() / 1000);
  await worker.fetch(new Request("https://x/stripe-webhook", { method: "POST", headers: { "Stripe-Signature": `t=${t},v1=${createHmac("sha256", "whsec_test").update(t + "." + raw).digest("hex")}` }, body: raw }), env, {});
  const pm = (await call("/outbox", { headers: { "X-Sync-Secret": "sync" } })).j.mails.find((m) => m.to === "ttl@example.com");
  assert.ok(pm); assert.equal(env.STUDIO.ttl.get("mail:" + pm.id), 7 * 24 * 3600);
}

console.log("ok · all API checks passed");
