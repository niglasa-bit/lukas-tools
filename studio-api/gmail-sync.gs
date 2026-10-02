/**
 * Money Plan Studio · Gmail sync (Google Apps Script)
 *
 * Does two jobs from the owner's own Gmail, free, no domain needed:
 *   1. syncSales()  – every 5 min: reads Beacons "You made a sale" emails and posts
 *                     buyer name / email / order # to the Studio API (/sync).
 *   2. doPost(e)    – web app: the API calls this to send the 6-digit login code
 *                     to a buyer, from your Gmail (MailApp). Instant.
 *   (3. sendOutbox() – fallback poller if the web app isn't deployed.)
 *
 * Setup (once):
 *   - script.google.com → New project → paste this file.
 *   - Fill CONFIG below.
 *   - Run setup() once (grants Gmail permission, creates the 5-min trigger).
 *   - Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *     Copy the web app URL →  npx wrangler secret put MAIL_WEBHOOK_URL
 */

var CONFIG = {
  API_URL: "https://lukas-studio-api.YOUR-SUBDOMAIN.workers.dev", // no trailing slash
  SYNC_SECRET: "PASTE_THE_SAME_SYNC_SECRET_AS_IN_WRANGLER",
  SENDER_NAME: "Lukas · The Systemized Life",
  // Optional: send from a Gmail "Send mail as" alias instead of this account's own address.
  // Add the alias in Gmail → Settings → Accounts and Import → "Send mail as", verify it, then
  // paste it here. Leave "" to send from this account (the name above is still shown).
  SENDER_EMAIL: "",
  LABEL: "lukas-studio-synced",
  // The seller notification Beacons sends you:
  SEARCH: 'from:(info.beacons.ai) subject:("You made a sale") newer_than:30d',
};

function setup() {
  GmailApp.getUserLabelByName(CONFIG.LABEL) || GmailApp.createLabel(CONFIG.LABEL);
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("syncSales").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("sendOutbox").timeBased().everyMinutes(1).create();
  Logger.log("Triggers created. Now deploy as web app and set MAIL_WEBHOOK_URL.");
}

function syncSales() {
  var label = GmailApp.getUserLabelByName(CONFIG.LABEL) || GmailApp.createLabel(CONFIG.LABEL);
  // Beacons reuses the subject ("You made a sale — $19.00"), so Gmail stacks new sales into a
  // thread that is already labelled. Track by time instead: read every message newer than the
  // last successful sync, with an hour of overlap (the API ignores orders it already has).
  var props = PropertiesService.getScriptProperties();
  var last = parseInt(props.getProperty("lastSync") || "0", 10);
  var started = Date.now();
  var since = last ? last - 3600 * 1000 : 0;
  var threads = GmailApp.search(CONFIG.SEARCH + (since ? " after:" + Math.floor(since / 1000) : ""), 0, 50);
  var sales = [], unreadable = 0;
  threads.forEach(function (th) {
    th.getMessages().forEach(function (msg) {
      if (since && msg.getDate().getTime() < since) return;
      var s = parseSale(htmlToText(msg.getBody()), msg.getDate()) || parseSale(msg.getPlainBody(), msg.getDate());
      if (s) sales.push(s);
      else { unreadable++; Logger.log("could not read sale mail " + msg.getId() + ": " + msg.getSubject()); }
    });
  });
  if (sales.length) {
    var res = api("/sync", { sales: sales });
    Logger.log("sync: " + JSON.stringify(res));
    if (!res || res.error) return; // lastSync stays put, retry next run
  }
  if (!unreadable) props.setProperty("lastSync", String(started)); // an unreadable mail is retried, not skipped
  threads.forEach(function (th) { th.addLabel(label); });
}

// The seller notification carries the order table in its HTML part only; the plain-text part
// stops at "Order details". Flattened, the table reads one cell per line:
//   Product / Money Plan Studio / Type / digital-products / Amount / $19.00 /
//   Customer / Niko / Customer email / niko@example.com / Order # / c47d3f10-8a6d-...
function htmlToText(html) {
  return String(html || "")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/(td|tr|p|div|h1|h2|table)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]*\r?\n[ \t]*/g, "\n").replace(/\n{2,}/g, "\n");
}

function parseSale(text, date) {
  function grab(label) {
    var re = new RegExp("(?:^|\\n)[ \\t]*" + label + "[ \\t]*[:\\n\\r\\t ]+\\s*([^\\n\\r]+)", "i");
    var m = text.match(re);
    return m ? m[1].trim() : "";
  }
  var order = grab("ORDER\\s*#");
  var email = grab("CUSTOMER\\s*EMAIL");
  var m = email.match(/[\w.+-]+@[\w-]+\.[\w.-]+/); email = m ? m[0] : "";
  if (!order || !email) return null;
  return {
    order: order,
    email: email,
    name: grab("CUSTOMER(?!\\s*EMAIL)"),
    product: grab("PRODUCT"),
    amount: grab("AMOUNT"),
    date: Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"),
  };
}

// Web app endpoint: the API posts {secret,to,subject,html} and we send it from Gmail.
function doPost(e) {
  var out = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  try {
    var b = JSON.parse(e.postData.contents || "{}");
    if (b.secret !== CONFIG.SYNC_SECRET) return out.setContent('{"error":"forbidden"}');
    sendMail(b.to, b.subject, b.html);
    return out.setContent('{"ok":true}');
  } catch (err) {
    return out.setContent(JSON.stringify({ error: String(err) }));
  }
}

// Fallback when MAIL_WEBHOOK_URL isn't set: drain the API's outbox once a minute.
function sendOutbox() {
  var res = api("/outbox", null, "get");
  if (!res || !res.mails || !res.mails.length) return;
  var done = [];
  res.mails.forEach(function (m) {
    try { sendMail(m.to, m.subject, m.html); done.push(m.id); }
    catch (err) { Logger.log("mail failed: " + err); }
  });
  if (done.length) api("/outbox/ack", { ids: done });
}

// Sends from the alias in CONFIG.SENDER_EMAIL when it is set up in Gmail, otherwise from this account.
function sendMail(to, subject, html) {
  var from = String(CONFIG.SENDER_EMAIL || "").trim().toLowerCase();
  if (from && GmailApp.getAliases().map(function (a) { return a.toLowerCase(); }).indexOf(from) >= 0) {
    GmailApp.sendEmail(to, subject, "", { from: from, name: CONFIG.SENDER_NAME, htmlBody: html, replyTo: from });
  } else {
    if (from) Logger.log("SENDER_EMAIL " + from + " is not a verified Gmail alias; sending from the account address.");
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: CONFIG.SENDER_NAME });
  }
}

function api(path, payload, method) {
  var opt = {
    method: method || "post",
    contentType: "application/json",
    headers: { "X-Sync-Secret": CONFIG.SYNC_SECRET },
    muteHttpExceptions: true,
  };
  if (payload) opt.payload = JSON.stringify(payload);
  var r = UrlFetchApp.fetch(CONFIG.API_URL + path, opt);
  try { return JSON.parse(r.getContentText()); } catch (e) { return { error: r.getContentText() }; }
}

// Paste a notification's plain text here to check the parser without waiting for a sale.
function testParse() {
  var sample = "PRODUCT\nThe 1-Page Money Plan (Free)\nTYPE\ndigital-products\nAMOUNT\n$0.00\nCUSTOMER\nNiko\nCUSTOMER EMAIL\nniglasa@gmail.com\nORDER #\nc47d3f10-8a6d-4f86-9376-4fc5c5624a69\n";
  Logger.log(JSON.stringify(parseSale(sample, new Date())));
}
