// Shop settings. Fill in after the company Stripe account exists (see shop/README.md).
// paymentLink: the Stripe Payment Link URL (https://buy.stripe.com/...). Empty = "Coming soon".
// Each Payment Link must carry metadata  product = the exact name below (All-Access: product = all-access), and its
// confirmation page must redirect to  <this site>/shop/thanks.html?session_id={CHECKOUT_SESSION_ID}
window.SHOP = {
  api: "https://lukas-studio-api.lukas-systemized.workers.dev",
  seller: "Sevenflowlabs Oy", // Business ID 3660293-5 (registration pending), see legal.html
  products: [
    { name: "All-Access", featured: true, emoji: "🗝️", price: "$49", paymentLink: "",
      line: "Money Plan Studio, The Systemized Year and The Autopilot Workbook in one purchase. One-time payment, the same 3 devices for all three." },
    { name: "Money Plan Studio", app: "studio/", emoji: "🧭", price: "", paymentLink: "",
      line: "Your whole money plan on one page, a 10-minute Sunday check-in, and a price-tag reader for every purchase." },
    { name: "The Systemized Year", app: "year/", emoji: "🌙", price: "", paymentLink: "",
      line: "Your whole year on one page: money, time, focus and the things money is actually for. Twelve fifteen-minute check-ins." },
    { name: "The Autopilot Workbook", app: "autopilot/", emoji: "⚙️", price: "", paymentLink: "",
      line: "Find the boring tasks that eat your week and hand them to a system. No code. Recipes, fill-in prompts and short lessons." },
    { name: "The Enough Habit", app: "enough/", emoji: "🧾", price: "", paymentLink: "", hidden: true,
      line: "One small frugal goal a day for 66 days, inside a two-minute morning check." },
  ],
  newsletter: "", // MailerLite / Kit sign-up form URL
};
