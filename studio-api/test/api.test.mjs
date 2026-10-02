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

console.log("ok · all API checks passed");
