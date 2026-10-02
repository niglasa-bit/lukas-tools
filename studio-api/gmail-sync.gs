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
  var threads = GmailApp.search(CONFIG.SEARCH + " -label:" + CONFIG.LABEL, 0, 50);
  var sales = [];
  threads.forEach(function (th) {
    th.getMessages().forEach(function (msg) {
      var s = parseSale(msg.getPlainBody(), msg.getDate());
      if (s) sales.push(s);
    });
  });
  if (sales.length) {
    var res = api("/sync", { sales: sales });
    Logger.log("sync: " + JSON.stringify(res));
    if (!res || res.error) return; // keep unlabeled, retry next run
  }
  threads.forEach(function (th) { th.addLabel(label); });
}

// Beacons' table reads, in plain text, roughly:
//   PRODUCT  The 1-Page Money Plan (Free)
//   TYPE     digital-products
//   AMOUNT   $0.00
//   CUSTOMER Niko
//   CUSTOMER EMAIL niglasa@gmail.com
//   ORDER #  c47d3f10-8a6d-4f86-9376-4fc5c5624a69
function parseSale(text, date) {
  function grab(label) {
    var re = new RegExp(label + "\\s*[:\\n\\r\\t ]+\\s*([^\\n\\r]+)", "i");
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
    MailApp.sendEmail({ to: b.to, subject: b.subject, htmlBody: b.html, name: CONFIG.SENDER_NAME });
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
    try { MailApp.sendEmail({ to: m.to, subject: m.subject, htmlBody: m.html, name: CONFIG.SENDER_NAME }); done.push(m.id); }
    catch (err) { Logger.log("mail failed: " + err); }
  });
  if (done.length) api("/outbox/ack", { ids: done });
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
