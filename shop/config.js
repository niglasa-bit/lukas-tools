// Shop settings. Fill in after the company Stripe account exists (see shop/README.md).
// paymentLink: the Stripe Payment Link URL (https://buy.stripe.com/...). Empty = "Coming soon".
// Each Payment Link must carry metadata  product = the exact name below (All-Access: product = all-access), and its
// confirmation page must redirect to  <this site>/shop/thanks.html?session_id={CHECKOUT_SESSION_ID}
window.SHOP = {
  api: "https://lukas-studio-api.lukas-systemized.workers.dev",
  seller: "Sevenflowlabs Oy", // Business ID 3660293-5, see legal.html
  products: [
    { name: "All-Access", featured: true, emoji: "🗝️", price: "$99", paymentLink: "https://buy.stripe.com/dRm7sMbJPdigbL9aGF3Nm00",
      line: "All four tools in one purchase: Money Plan Studio, The Autopilot Workbook, The Systemized Year and The Enough Habit. $176 if bought separately ($49 + $59 + $39 + $29). One-time payment, the same 3 devices for all four." },
    { name: "Money Plan Studio", app: "studio/", emoji: "🧭", price: "$49", paymentLink: "https://buy.stripe.com/5kQaEY4hn3HG3eD0213Nm01",
      line: "Your whole money plan on one page, a 10-minute Sunday check-in, and a price-tag reader for every purchase." },
    { name: "The Systemized Year", app: "year/", emoji: "🌙", price: "$59", paymentLink: "https://buy.stripe.com/4gM8wQ5lr3HG6qP4ih3Nm02",
      line: "Your whole year on one page: money, time, focus and the things money is actually for. Twelve fifteen-minute check-ins." },
    { name: "The Autopilot Workbook", app: "autopilot/", emoji: "⚙️", price: "$39", paymentLink: "https://buy.stripe.com/cNi00keW1emk16v7ut3Nm03",
      line: "Find the boring tasks that eat your week and hand them to a system. No code. Recipes, fill-in prompts and short lessons." },
    { name: "The Enough Habit", app: "enough/", emoji: "🧾", price: "$29", paymentLink: "https://systemized6.gumroad.com/l/enough-habit", via: "Gumroad",
      line: "One small frugal goal a day for 66 days, inside a two-minute morning check." },
    { name: "The No-Code AI Budget System", emoji: "🤖", price: "$14", paymentLink: "https://systemized6.gumroad.com/l/no-code-ai-budget-system", via: "Gumroad",
      trust: ["8-page PDF + 10 copy-paste prompts", "One-time payment, yours to keep", "14-day refund, no questions"],
      note: "Works with ChatGPT, Claude or Gemini and any bank.",
      line: "A budget that runs itself, built with free AI tools. 7 short steps and 10 prompts. Zero coding." },
    { name: "The Babylon 7", emoji: "🏺", price: "$9", paymentLink: "https://systemized6.gumroad.com/l/babylon7", via: "Gumroad",
      trust: ["12 printable pages, A4 and US Letter", "One-time payment, yours to keep", "14-day refund, no questions"],
      note: "General money education, not personal financial advice.",
      line: "A 100-year-old money book, fact-checked, turned into seven 10-minute tasks. 7 days, 7 rules, 7 numbers." },
    { name: "The Systemized Kitchen", emoji: "🥕", price: "$9", paymentLink: "https://systemized6.gumroad.com/l/systemized-kitchen", via: "Gumroad",
      trust: ["One file, works offline in any browser", "One-time payment, yours to keep", "14-day refund, no questions"],
      note: "Your data stays on your device.",
      line: "Your weekly grocery budget, cooked into recipes that still fit, for 1 to 5 people." },
  ],
  newsletter: "", // MailerLite / Kit sign-up form URL
};
