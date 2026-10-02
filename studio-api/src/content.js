// Premium content for Money Plan Studio. Served only to an activated device (GET /content).
// Voice: Lukas · The Systemized Life. Short, calm, one action at a time.
// Sources: only well-known ones people may recognize (famous studies, classic books, big institutions).

export const CONTENT = {
  version: 1,
  stages: {
    secure: {
      title: "Secure",
      tagline: "Nothing small can knock you over.",
      lesson: "Money stress is rarely about the big number. It's about the small surprise: a tyre, a dentist, a laptop. The first job of your plan is to make surprises boring. That means a cash buffer you never touch, and no debt that grows faster than you do.",
      rules: [
        "Keep 3 months of essentials in a separate account. Not for fun. For surprises.",
        "Kill any debt above 8% interest before you invest a cent. A guaranteed 20% is the best return you'll ever get.",
        "Automate the transfer the day your pay lands. Willpower is a terrible system.",
      ],
      sellerSide: "Who profits when you have no buffer? Everyone who sells credit. A surprise with no cash behind it becomes a 20% loan in a nice app.",
      source: "The 3-6 month emergency fund rule is standard guidance from large institutions (e.g. Vanguard, the U.S. CFPB). Paying off high-interest debt first is the classic 'debt avalanche'.",
    },
    comfortable: {
      title: "Comfortable",
      tagline: "The system runs without you watching it.",
      lesson: "Comfortable isn't a bigger salary. It's a smaller number of decisions. A 6-month buffer, an automatic 15% into broad index funds, and a bill calendar you check once on Sunday. From here, most money questions answer themselves.",
      rules: [
        "Grow the buffer to 6 months of essentials, then stop. Cash beyond that is a slow leak to inflation.",
        "Invest at least 15% of income automatically, every month, into a broad low-cost index fund.",
        "One money hour a week. Sunday. Then close the app.",
      ],
      sellerSide: "Who profits when you check your portfolio daily? Brokers earn on activity. Your boredom is their revenue. Boring is the goal.",
      source: "The 15% savings rate is Fidelity's widely quoted guideline. 'Save More Tomorrow' (Thaler & Benartzi, 2004) showed automatic, pre-committed increases raised saving rates from 3.5% to 13.6%.",
    },
    rich: {
      title: "Rich",
      tagline: "Your money works more hours than you do.",
      lesson: "Rich, in this plan, has a number: 25 times what you spend in a year. At that point a 4% yearly withdrawal has historically lasted 30+ years. You don't need to reach it to feel it. Every month of expenses your assets can cover is a month of freedom you already own.",
      rules: [
        "Know your number: yearly spending × 25.",
        "Raise the investing rate every pay rise, before lifestyle catches up.",
        "Buy assets that pay you. Status buys you an audience that isn't looking.",
      ],
      sellerSide: "Who profits from 'rich' looking a certain way? Everyone who sells the look. The real thing is quiet.",
      source: "The 4% rule comes from the Trinity Study (Cooley, Hubbard & Walz, 1998) and Bengen (1994). Buffett still lives in the Omaha house he bought in 1958.",
    },
  },
  oneThingToday: {
    secure: [
      "Open a separate savings account and name it 'Surprises'. Five minutes.",
      "Set one automatic transfer for payday. Even a small one. The habit is the asset.",
      "List every debt with its interest rate. Highest on top. That's your order.",
    ],
    comfortable: [
      "Raise the automatic investment by 1% of income. You won't feel it.",
      "Put every bill's due date into one calendar. Check it Sundays only.",
      "Unsubscribe from one thing you haven't used in 30 days.",
    ],
    rich: [
      "Write your number (yearly spending × 25) somewhere you'll see it.",
      "Move the next pay rise, in full, to investing before it reaches your account.",
      "Ask of your next big purchase: would I still buy it if nobody could see it?",
    ],
  },
  sunday: {
    intro: "Ten minutes. Four numbers. One next action. Then close the app and enjoy your Sunday.",
    prompts: {
      buffer: "Cash buffer today",
      invested: "Invested total today",
      wants: "Spent on wants this week",
      win: "One win this week",
      next: "One thing next week",
    },
    nudges: [
      "A streak isn't about perfect weeks. It's about showing up to look.",
      "If the number went down, you still won: you looked.",
      "Spending on wants isn't the enemy. Spending without noticing is.",
      "Compare to last month, not to anyone's feed.",
    ],
  },
  beforeYouBuy: {
    intro: "Read the price tag in the right unit: hours of your life, and what the money becomes if you keep it.",
    checklist: [
      { q: "It earns money or saves more than it costs", hint: "Rent, dividends, a tool that pays for itself." },
      { q: "It will likely be worth more later", hint: "Not a phone, not a car." },
      { q: "I'd still buy it if nobody could see it", hint: "No status tax." },
    ],
    coolDownHours: 48,
    coolDownNote: "Put it on the list. If you still want it in 48 hours, buy it on purpose. Most wants expire quietly.",
    source: "Kiyosaki's asset/liability test (Rich Dad Poor Dad). The 'spotlight effect' (Gilovich, Medvec & Savitsky, 2000): people overestimate how much others notice them.",
  },
  plan: {
    intro: "Thirty minutes, honestly answered, and you'll have the one page most people never write.",
    autoNote: "Pay yourself first means the transfer happens before you see the money. Set it up once. Then it's not a decision anymore.",
    disclaimer: "Illustration based on your inputs and long-run averages. Returns are not guaranteed. Not financial advice.",
  },
};
