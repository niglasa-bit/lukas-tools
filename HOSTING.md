# Hosting

The site is served by the Cloudflare Worker `thesystemizedlife-site` (static assets, `wrangler.jsonc`).
Cloudflare Workers Builds deploys it automatically on every push to `main`. `.assetsignore` keeps repo-only files
(scripts, docs, config) off the site. `404.html` is the not-found page. GitHub Pages is no longer used.
