# Shop

Static pages served next to the apps (same site), so `../studio/` etc. work.

- `index.html` · product cards. Buttons come from `config.js`; an empty `paymentLink` shows "Coming soon".
- `thanks.html` · Stripe redirects here with `?session_id=…`; the page asks the Worker's `/order` for the order code.
- `legal.html` · seller, delivery, withdrawal right, refunds, privacy. **Draft: fill the [brackets] before launch.**
- `../links/` · link-in-bio page for Instagram and TikTok.

Setup of the Payment Links and the webhook: `studio-api/README.md`, section 3.
