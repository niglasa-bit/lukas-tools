// Newsletter: double opt-in signup, list kept in Resend (contacts), welcome email.
//   POST /subscribe            {email, source, website}  -> sends a confirm link (website = honeypot, must stay empty)
//   GET  /subscribe/confirm?e=&t=                         -> adds the Resend contact, sends the welcome email, redirects
//   GET  /unsubscribe?e=&t=                               -> marks the Resend contact unsubscribed, redirects
// Links are signed with SIGNING_SECRET, so nothing waits in KV before the click. KV keeps only the consent
// record news:<email> {at, source} (proof of opt-in), deleted again on unsubscribe.
// Needs RESEND_API_KEY + NEWS_FROM (e.g. "Lukas <hello@thesystemizedlife.com>"); RESEND_AUDIENCE_ID is optional
// (older Resend accounts keep contacts in an audience). Without them /subscribe answers 503 not_ready.

const RESEND = "https://api.resend.com";
const SITE = "https://thesystemizedlife.com";
const RATE_IP = 10, RATE_EMAIL = 3; // per hour
// Whole-service cap on confirmation emails per day, so rotating IPs can't use the form to mail strangers or burn the
// Resend quota. NEWS_PER_DAY overrides it; empty means the default, never unlimited.
const NEWS_PER_DAY = 300;

export async function subscribe(request, env, h) {
  const b = await h.body(request);
  if (b.website) return h.json({ status: "check_email" }); // bot filled the hidden field: pretend success
  const email = h.normEmail(b.email);
  if (!h.isEmail(email)) return h.json({ error: "bad_email", message: "Please enter a valid email address." }, 400);
  if (!ready(env)) return h.json({ error: "not_ready", message: "The newsletter opens soon." }, 503);
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if ((ip && await h.rateLimited(env, "news-ip:" + ip, RATE_IP)) || await h.rateLimited(env, "news-email:" + email, RATE_EMAIL)) return h.tooMany();
  if (await h.rateLimited(env, "news-day", parseInt(env.NEWS_PER_DAY, 10) > 0 ? parseInt(env.NEWS_PER_DAY, 10) : NEWS_PER_DAY, 86400)) return h.tooMany();
  if (await env.STUDIO.get("news:" + email)) return h.json({ status: "subscribed" });
  const source = String(b.source || "site").replace(/[^a-z0-9/_-]/gi, "").slice(0, 40) || "site";
  const link = new URL(request.url).origin + "/subscribe/confirm?e=" + encodeURIComponent(email) + "&s=" + source + "&t=" + await token(env, "confirm:" + email);
  const ok = await send(env, email, "Confirm your subscription to The Systemized Life", confirmMail(link));
  if (!ok) return h.json({ error: "mail_failed", message: "Couldn't send the email. Try again in a moment." }, 502);
  return h.json({ status: "check_email" });
}

export async function confirm(env, url, h) {
  const email = h.normEmail(url.searchParams.get("e"));
  if (!h.isEmail(email) || !h.secretOk(url.searchParams.get("t") || "", await token(env, "confirm:" + email))) return page("This link is not valid", "Sign up again on the blog and use the newest email.");
  if (!ready(env)) return page("The newsletter opens soon", "Please try the link again later.");
  if (!await env.STUDIO.get("news:" + email)) {
    const r = await resend(env, "POST", contactsPath(env), { email, unsubscribed: false }).catch(() => ({ ok: false, status: 0 }));
    if (!r.ok && r.status !== 409) { console.error("resend contact failed", r.status); return page("Something went wrong", "Please click the link again in a minute."); }
    const source = String(url.searchParams.get("s") || "site").replace(/[^a-z0-9/_-]/gi, "").slice(0, 40);
    await env.STUDIO.put("news:" + email, JSON.stringify({ at: h.now(), source }));
    const un = new URL(url).origin + "/unsubscribe?e=" + encodeURIComponent(email) + "&t=" + await token(env, "unsub:" + email);
    await send(env, email, "Welcome to The Systemized Life", welcomeMail(un));
  }
  return new Response(null, { status: 303, headers: { Location: SITE + "/blog/?subscribed=1" } });
}

export async function unsubscribe(env, url, h) {
  const email = h.normEmail(url.searchParams.get("e"));
  if (!h.isEmail(email) || !h.secretOk(url.searchParams.get("t") || "", await token(env, "unsub:" + email))) return page("This link is not valid", "Use the unsubscribe link in the newest email, or reply to it and we'll remove you.");
  if (ready(env)) {
    const r = await resend(env, "PATCH", contactsPath(env) + "/" + encodeURIComponent(email), { unsubscribed: true }).catch(() => ({ ok: false, status: 0 }));
    if (!r.ok && r.status !== 404) { console.error("resend unsubscribe failed", r.status); return page("Something went wrong", "Please click the link again in a minute."); }
  }
  await env.STUDIO.delete("news:" + email);
  return page("You're unsubscribed", "You won't get any more emails from us. One small system at a time.");
}

function ready(env) { return !!(env.RESEND_API_KEY && env.NEWS_FROM); }
function contactsPath(env) { return env.RESEND_AUDIENCE_ID ? "/audiences/" + env.RESEND_AUDIENCE_ID + "/contacts" : "/contacts"; }
function resend(env, method, path, body) {
  return fetch(RESEND + path, { method, headers: { "content-type": "application/json", Authorization: "Bearer " + env.RESEND_API_KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
}
async function send(env, to, subject, html) {
  try { const r = await resend(env, "POST", "/emails", { from: env.NEWS_FROM, to: [to], subject, html }); if (r.ok) return true; console.error("resend send failed", r.status); }
  catch (e) { console.error("resend send failed", String(e && e.message || e)); }
  return false;
}
async function token(env, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("news:" + data)));
  return [...mac.slice(0, 16)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const WRAP = (inner) => `<div style="font:16px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1F3A5F;max-width:520px">${inner}
  <p style="color:#5F8A99;font-size:13px">One small system at a time.<br>Lukas · The Systemized Life · Educational content, not financial advice.</p></div>`;
const BTN = (href, text) => `<p><a href="${href}" style="display:inline-block;background:#2A9D8F;color:#fff;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:700">${text}</a></p>`;

function confirmMail(link) {
  return WRAP(`<p>Hi,</p><p>Someone (hopefully you) asked to get The Systemized Life emails: one short money lesson a week, plus new free tools when they're ready.</p>
  ${BTN(link, "Yes, sign me up")}<p>If this wasn't you, ignore this email and nothing happens.</p>`);
}
function welcomeMail(unsub) {
  return WRAP(`<p>Hi,</p><p>You're in. Once a week you'll get one short, plain-English money lesson. Every claim comes with its sources, and every example number is labelled as an example.</p>
  <p>Start here, it takes two minutes:</p>
  <ul><li><a href="${SITE}/future-cost/">Future Cost Calculator</a>: what a purchase really costs if you had invested the money</li>
  <li><a href="${SITE}/focus/">Focus Leak Calculator</a>: the hours interruptions take from your year</li>
  <li><a href="${SITE}/blog/">The blog</a>: why it exists and what's coming</li></ul>
  <p>Reply any time, a real inbox reads it.</p>
  <p style="font-size:13px"><a href="${unsub}" style="color:#5F8A99">Unsubscribe</a></p>`);
}
function page(title, text) {
  return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{font:17px/1.6 system-ui,sans-serif;margin:0;background:#faf7f0;color:#222}.w{max-width:520px;margin:0 auto;padding:48px 16px}a{color:#7a4b00}</style></head>
<body><div class="w"><h1>${title}</h1><p>${text}</p><p><a href="${SITE}/blog/">← The blog</a></p></div></body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
