# Security

Please report vulnerabilities privately to **sales@sevenflowlabs.com** (subject "Security"). Do not open a public issue. We acknowledge reports within 5 business days. Maintainer: Sevenflowlabs Oy (business ID 3660293-5), Finland.

Include what you found, how to reproduce it and the affected URL or version. Do not use other people's data or load-test the service.

Principles:
- Secrets (Stripe, admin token, Apps Script shared secret) live only in `wrangler secret`, never in the repo or the browser.
- The admin page uses a token in a request header, builds rows with the DOM (no HTML injection) and has a strict Content Security Policy.
- Unlock and activation endpoints are rate limited per IP and per email; one-time codes come from `crypto.getRandomValues`.
- Buyer email addresses are personal data: stored only for delivery and support.
- Dependencies are watched by Dependabot; CI checks every script on each push.
