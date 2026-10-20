// Withdrawal function (KSL 6:14 a §, directive 2023/2673, in force 19.6.2026): a buyer withdraws from one
// purchase within 14 days without emailing anyone.
//   POST /withdraw {email, order, name}                 -> {status:"confirm", ...summary}  (step 1: identify)
//   POST /withdraw {email, order, name, confirm:true}   -> {status:"withdrawn", at}        (step 2: separate confirmation)
// The order closes at once (the apps stop at the next launch), the payment is refunded through Stripe when
// STRIPE_SECRET_KEY is set (otherwise the admin page shows "withdrawal" and the refund is made by hand within
// 14 days), and the buyer gets a receipt by email with what was withdrawn, the date and the time.
// NOTIFY_EMAIL (optional) gets a copy, so a refund made by hand is not forgotten.

const DAYS = 14;
const RATE_IP = 20, RATE_EMAIL = 10; // per hour

export async function withdraw(request, env, h) {
  const b = await h.body(request);
  const email = h.normEmail(b.email), order = h.normOrder(b.order), name = String(b.name || "").trim().slice(0, 80);
  if (!h.isEmail(email)) return h.json({ error: "bad_email", field: "email", message: "Enter the email address you used for the purchase." }, 400);
  if (!order) return h.json({ error: "bad_order", field: "order", message: "Enter the order code from your purchase email." }, 400);
  if (!name) return h.json({ error: "bad_name", field: "name", message: "Enter your name." }, 400);
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if ((ip && await h.rateLimited(env, "wd-ip:" + ip, RATE_IP)) || await h.rateLimited(env, "wd-email:" + email, RATE_EMAIL)) return h.tooMany();

  const buyer = await h.getBuyer(env, email);
  const o = buyer && (buyer.orders || []).find((x) => x.order === order);
  if (!o) return h.json({ error: "not_found", field: "order", message: "We couldn't find that order code for this email. Check both in your purchase email, or reply to that email." }, 404);
  const summary = { order: o.order.toUpperCase(), product: o.product || "Lukas product", amount: o.amount || "", bought: purchaseDate(o) };
  if (o.withdrawal) return h.json({ status: "already", ...summary, at: iso(o.withdrawal.at) });
  if (o.closed) return h.json({ status: "closed", ...summary, message: "This purchase has already been refunded or cancelled." });
  const deadline = purchaseTime(o) + (DAYS + 1) * 86400; // through the end of the 14th day, whatever the time zone
  if (h.now() > deadline) return h.json({ error: "past_deadline", ...summary, message: `The 14-day withdrawal period for this purchase has ended. If something isn't working, reply to your purchase email and we'll help.` }, 400);
  if (b.confirm !== true) return h.json({ status: "confirm", ...summary, email: h.maskEmail(email) });

  const at = h.now();
  o.withdrawal = { at, name };
  o.closed = "withdrawal";
  o.closedAt = at;
  o.refund = await refund(env, o.pi);
  await h.putBuyer(env, buyer);

  const when = stamp(at);
  await h.sendMail(env, { to: email, subject: `Withdrawal confirmed: ${summary.product} (${summary.order})`, html: receiptMail(env, name, summary, when, o.refund) }, h.PURCHASE_MAIL_TTL);
  if (env.NOTIFY_EMAIL) await h.sendMail(env, { to: env.NOTIFY_EMAIL, subject: `Withdrawal ${summary.order}: refund ${o.refund}`, html: `<p>${h.escapeHtml(name)} &lt;${h.escapeHtml(email)}&gt; withdrew from ${h.escapeHtml(summary.product)} ${h.escapeHtml(summary.amount)} (${summary.order}) on ${when}.</p><p>Refund: <b>${h.escapeHtml(o.refund)}</b>${o.refund === "manual" ? " — refund it in Stripe within 14 days." : ""}</p>` }, h.PURCHASE_MAIL_TTL);
  return h.json({ status: "withdrawn", ...summary, at: iso(at), refund: o.refund === "failed" ? "manual" : o.refund });
}

// Full refund of the payment intent. "manual" = no Stripe key or no payment intent (e.g. an older Beacons sale).
async function refund(env, pi) {
  if (!env.STRIPE_SECRET_KEY || !pi) return "manual";
  try {
    const r = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded", "Idempotency-Key": "withdraw-" + pi },
      body: "payment_intent=" + encodeURIComponent(pi) + "&reason=requested_by_customer&metadata[reason]=withdrawal",
    });
    if (r.ok) return "refunded";
    console.error("stripe refund failed", r.status);
  } catch (e) { console.error("stripe refund failed", String(e && e.message || e)); }
  return "failed";
}

function purchaseTime(o) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(o.date || "");
  const t = m ? Date.parse(m[1] + "T" + (m[2] || "00:00") + ":00Z") / 1000 : NaN;
  return Number.isFinite(t) ? t : (o.synced || 0);
}
function purchaseDate(o) { const t = purchaseTime(o); return t ? new Date(t * 1000).toISOString().slice(0, 10) : ""; }
function iso(t) { return new Date(t * 1000).toISOString(); }
function stamp(t) {
  const d = new Date(t * 1000);
  const fi = d.toLocaleString("en-GB", { timeZone: "Europe/Helsinki", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${fi} (Finnish time), ${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function receiptMail(env, name, s, when, refund) {
  const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = refund === "refunded"
    ? "Your payment has been refunded in full to the card or account you paid with. Depending on your bank it shows up within 5–10 days."
    : "We'll refund your payment in full within 14 days, to the same card or account you paid with.";
  return `<div style="font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1F3A5F;max-width:480px">
  <p>Hi ${esc(name.split(" ")[0])},</p>
  <p>This confirms that you withdrew from your purchase.</p>
  <table style="border-collapse:collapse;font-size:15px">
  <tr><td style="padding:3px 12px 3px 0;color:#5F8A99">Product</td><td>${esc(s.product)}${s.amount ? " · " + esc(s.amount) : ""}</td></tr>
  <tr><td style="padding:3px 12px 3px 0;color:#5F8A99">Order code</td><td>${esc(s.order)}</td></tr>
  <tr><td style="padding:3px 12px 3px 0;color:#5F8A99">Bought</td><td>${esc(s.bought)}</td></tr>
  <tr><td style="padding:3px 12px 3px 0;color:#5F8A99">Withdrawn</td><td>${esc(when)}</td></tr>
  <tr><td style="padding:3px 12px 3px 0;color:#5F8A99">Name</td><td>${esc(name)}</td></tr></table>
  <p>${money} Access to this product has ended; anything else you bought keeps working.</p>
  <p>Questions? Reply to this email.</p>
  <p style="color:#5F8A99;font-size:13px">${env.SELLER ? esc(env.SELLER) + "<br>" : ""}Lukas · The Systemized Life</p>
</div>`;
}
