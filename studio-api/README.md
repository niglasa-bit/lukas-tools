# Lukas products · lock and shop setup

Three parts, all free tiers:

| Part | Where | What it does |
|---|---|---|
| `studio/` | GitHub Pages (this repo) | The app the buyer opens. Public shell, locked content. |
| `studio-api/` | Cloudflare Worker + KV | The lock: activation, codes, device limit, premium content, buyer list, admin page. |
| `studio-api/gmail-sync.gs` | Google Apps Script in your Gmail | Reads Beacons "You made a sale" emails into the buyer list, and sends the 6-digit codes from your Gmail. |
| `shop/` | Same site as the apps | Shop page, thank-you page (shows the order code) and terms. Buttons are Stripe Payment Links. |

## 1 · Deploy the Worker (10 min)

```bash
cd studio-api
npm i
npx wrangler login
npx wrangler kv namespace create STUDIO        # paste the id into wrangler.toml
npx wrangler secret put SIGNING_SECRET          # any long random string
npx wrangler secret put SYNC_SECRET             # another long random string (also goes in the Apps Script)
npx wrangler secret put ADMIN_TOKEN             # another one; opens the admin page
npx wrangler deploy                             # prints https://lukas-studio-api.<you>.workers.dev
```

Then put that URL into `studio/index.html` (`<meta name="studio-api" …>`) and into `gmail-sync.gs` (`CONFIG.API_URL`).

## 2 · Gmail script (5 min)

1. script.google.com → New project → paste `gmail-sync.gs`, fill `CONFIG`.
2. Run `setup()` once and accept the Gmail permission. This creates the 5-minute sync trigger.
3. Deploy → New deployment → **Web app** → Execute as *Me*, Who has access *Anyone*. Copy the URL.
4. `npx wrangler secret put MAIL_WEBHOOK_URL` and paste it. Codes now go out instantly from your Gmail.

Run `testParse()` in the script editor to check the email parser without waiting for a sale.

## 3 · Stripe (the shop)

Stripe Checkout through Payment Links, on the company account, with Managed Payments on (Stripe is the
merchant of record and charges each country's VAT / sales tax). The Gmail/Beacons path keeps working
alongside, so older Beacons orders still unlock.

1. Stripe → Products: one product per app, one-time price. The company account is shared with other Sevenflow products, so name them with the brand, e.g. `Lukas · Money Plan Studio`. The lock reads `metadata.product` (step 2), and the fallback name match still works with the prefix.
2. Stripe → Payment Links, one per product:
   - **Metadata**: `product` = the exact name from the table below (e.g. `Money Plan Studio`). This decides what the order unlocks.
   - **After payment**: "Don't show confirmation page" → redirect to `https://<site>/shop/thanks.html?session_id={CHECKOUT_SESSION_ID}`.
   - **Terms**: require the buyer to agree, with custom text: "I want access right away and understand that my 14-day right of withdrawal ends once access is given."
   - Paste the link into `shop/config.js` (`paymentLink`) together with the price label.
3. Stripe → Developers → Webhooks → Add endpoint `https://lukas-studio-api.<you>.workers.dev/stripe-webhook`, events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created`.
   `npx wrangler secret put STRIPE_WEBHOOK_SECRET` and paste the `whsec_…` signing secret.
4. Set `APP_BASE` and `SELLER` in `wrangler.toml`, add the shop's origin to `ALLOWED_ORIGINS`, `npm run deploy`.
5. Test mode first: a test-mode Payment Link and test webhook secret, buy with card 4242 4242 4242 4242, check the
   thank-you page shows `LK-…`, the purchase email arrives, the app unlocks, and a refund in the dashboard locks it again.

What happens on a sale: the webhook records the order (order code `LK-XXXXXXXX`, derived from the Checkout session),
emails the buyer the code with an "Open the app" button and the withdrawal-right confirmation, and the thank-you page
reads the same code from `/order`. A full refund or a dispute closes that one order (shown on the admin page);
anything else the buyer owns keeps working. Codes and purchase emails go out through Resend once
`RESEND_API_KEY` + `MAIL_FROM` are set on the shop's domain (remove `MAIL_WEBHOOK_URL` to stop using Gmail).

## 3b · Beacons product (older purchases)

1. Open `studio/start-here.html` in Edge → Print → Save as PDF.
2. Create the product in Beacons named **Money Plan Studio**, upload the PDF as the download. The Worker decides what an order unlocks from the product name (`DEFAULT_PRODUCTS` in `src/index.js`), so keep these words in the Beacons product names:

   | Beacons product name contains | Unlocks |
   |---|---|
   | `Money Plan Studio` | the Studio |
   | `The Systemized Year` | the Year app |
   | `Systemized Year Upgrade` (hidden, for Studio buyers) | the Year app, only if the same email already owns the Studio |
   | `Systemized Life Pass` | both |
   | `all-access` (Stripe metadata, the $49 bundle) | Studio, Year and Autopilot |
   | `The Autopilot Workbook` | the Autopilot app (`autopilot/`) |
   | `The Enough Habit` | the Enough Habit app (`enough/`) |
3. In the product's thank-you text, repeat the link and “use the email you bought with + your Order #”.

## Admin

`https://lukas-studio-api.<you>.workers.dev/admin?token=YOUR_ADMIN_TOKEN` shows buyers, their devices and anyone whose activation arrived before the sale synced (one-click approve). Revoke after a refund.

## Several products, one lock

One buyer is one email with one list of devices (`MAX_DEVICES` in total, not per product). An app asks for its product: the Studio sends nothing (means `studio`), the Year app sends `product: "year"` to `/activate` and reads `/content?product=year`. What a buyer owns is worked out from their orders on every request, so when a Studio buyer's Year purchase syncs, the device they already use opens the Year app without a new code. The admin page shows what each buyer owns, and a hand approval lets you pick the product. The Autopilot app sends `product: "autopilot"`, the Enough Habit app `product: "enough"`.

## B2B team licences (The Autopilot Workbook)

Companies buy seats by invoice, not through Beacons. On the admin page, **Add a team**: company name, the contract or invoice number (people type it in the Order # box), an end date, and one email per line. Each person then unlocks with their own work email + the contract number + the emailed code, on up to `MAX_DEVICES` devices of their own. Team members see "for <company>" in the app instead of the Lukas byline, and their code email carries no Lukas signature. Adding the same team again adds seats or moves the end date; after the end date access stops at the next launch without deleting anyone. **End team licence** removes the team's access; anything a member bought personally stays.

## Updating content

Each app's premium content is one file in `src/` (`content.js`, `content-year.js`, `content-autopilot.js`, `content-enough.js`). Edit it, run `npm test`, then `npm run deploy`. Buyers get the new content on their next launch. For the Autopilot Workbook, bump `version` and add a line to `changelog` (shown under More → What's new), and put a lesson's unlisted YouTube id in its `video` field to publish that video.

## How the lock works, honestly

- Beacons sends every buyer the same PDF; the PDF is only a link.
- The app asks for the purchase email + Order #, which only the buyer's receipt has, then emails a one-time code.
- Each purchase can hold `MAX_DEVICES` (3) devices. A device holds a signed token; every launch re-checks it, so a removed or refunded device stops working.
- Lessons, rules and prompts come from the Worker only after that check. The app shell is public and that's fine.
- Every printed plan carries “Licensed to <name> · <email>” and a faint watermark.
- What it does **not** do: stop a buyer from handing their email + receipt to a friend (max 3 devices, visible on the admin page), or stop screenshots. No downloadable product can.

## Local test

```bash
cd studio-api && npm test                 # unit test of the Worker with an in-memory KV
npx wrangler dev                          # API on http://localhost:8787
cd ../studio && python3 -m http.server 8080
# open http://localhost:8080/?api=http://localhost:8787
```
While testing without the Gmail script, codes land in the KV outbox; read them with
`curl -H "X-Sync-Secret: …" http://localhost:8787/outbox`.
