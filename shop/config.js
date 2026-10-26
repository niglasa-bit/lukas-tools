// Shop settings. Fill in after the company Stripe account exists (see shop/README.md).
// paymentLink: the Stripe Payment Link URL (https://buy.stripe.com/...). Empty = "Coming soon".
// Each Payment Link must carry metadata  product = the exact name below (All-Access: product = all-access), and its
// confirmation page must redirect to  <this site>/shop/thanks.html?session_id={CHECKOUT_SESSION_ID}
window.SHOP = {
  api: "https://lukas-studio-api.lukas-systemized.workers.dev",
  seller: "Sevenflowlabs Oy", // Business ID 3660293-5, see legal.html
  products: [
    { name: "All-Access", featured: true, emoji: "🗝️", price: "$99", paymentLink: "https://buy.stripe.com/dRm7sMbJPdigbL9aGF3Nm00",
      line: "All four tools in one purchase: Money Plan Studio, The Autopilot Workbook, The Systemized Year and The Enough Habit. $176 separately. One-time payment, the same 3 devices for all four." },
    { name: "Money Plan Studio", app: "studio/", emoji: "🧭", price: "$49", paymentLink: "https://buy.stripe.com/5kQaEY4hn3HG3eD0213Nm01",
      line: "Your whole money plan on one page, a 10-minute Sunday check-in, and a price-tag reader for every purchase." },
    { name: "The Systemized Year", app: "year/", emoji: "🌙", price: "$59", paymentLink: "https://buy.stripe.com/4gM8wQ5lr3HG6qP4ih3Nm02",
      line: "Your whole year on one page: money, time, focus and the things money is actually for. Twelve fifteen-minute check-ins." },
    { name: "The Autopilot Workbook", app: "autopilot/", emoji: "⚙️", price: "$39", paymentLink: "https://buy.stripe.com/cNi00keW1emk16v7ut3Nm03",
      line: "Find the boring tasks that eat your week and hand them to a system. No code. Recipes, fill-in prompts and short lessons." },
    { name: "The Enough Habit", app: "enough/", emoji: "🧾", price: "$29", paymentLink: "", hidden: true,
      line: "One small frugal goal a day for 66 days, inside a two-minute morning check." },
  ],
  newsletter: "", // MailerLite / Kit sign-up form URL
};
