// Premium content for The Systemized Year. Served only to an activated device that owns it
// (GET /content?product=year). Voice: Lukas · The Systemized Life. Calm, short, one action at a time.
// Sources: only well-known ones people may recognize (famous studies, classic books, big institutions).

export const CONTENT_YEAR = {
  version: 1,
  reset: {
    intro: "One evening, six short steps, and your whole year fits on one page. Money first, because it's the loudest. Then time, focus, and the part everyone skips: what the money is actually for.",
    start: "Write one sentence about the year you want. Not a resolution. A direction. 'Calm money, slower evenings' beats 'save more and be productive'.",
    money: "Most money stress isn't the monthly bills. It's the yearly ones that arrive like ambushes: insurance, the car, gifts, the dentist. List them now and they turn into one boring monthly transfer.",
    time: "A year is just 52 weeks wearing a coat. Decide three blocks that repeat every week, put them in the calendar, and protect them like meetings with your best client.",
    focus: "You don't need more discipline. You need one less leak. Pick one thing to quit and one thing to guard, and write both down where you'll see them.",
    rich: "Money is a tool, so name the job. Three experiences this year that you'd actually remember in ten years. Put a price and a month on each, and they join the yearly costs.",
    done: "That's your year. Print it, put it somewhere you'll walk past, and come back once a month for fifteen minutes. That's the whole system.",
  },
  areas: {
    money: {
      title: "Money",
      tagline: "Make surprises boring.",
      lesson: "A sinking fund is the oldest trick in household money: take every cost that comes once a year, divide it by twelve, and move that amount every month into its own pot. When the bill arrives, the money is already sitting there. No drama, no credit card, no 'where did this come from'.",
      rules: [
        "Every cost that comes once a year gets a line, a month and a price.",
        "Move the monthly total on payday, automatically, into a separate account.",
        "When a yearly cost hits, pay it from the pot. Never from the buffer, never from a card.",
      ],
      sellerSide: "Who profits when the car service is a surprise? Whoever lends you the money for it. 'Pay in 4' is a business model built on unplanned yearly costs.",
      source: "Sinking funds are standard budgeting guidance from consumer-finance bodies such as the U.S. CFPB. Richard Thaler's work on mental accounting (Nobel Prize 2017) explains why labelled pots of money get spent the way you intended.",
    },
    time: {
      title: "Time",
      tagline: "Fixed blocks first. The rest is free.",
      lesson: "When you decide in advance exactly when and where you'll do something, you're far more likely to do it. Psychologists call these implementation intentions: 'Monday and Thursday, 7:00, gym' beats 'exercise more' every time. Three fixed blocks a week is enough to change a year.",
      rules: [
        "Three blocks that repeat every week. Day, time, what.",
        "Put them in the calendar today, as recurring events.",
        "If you miss one, the rule is simple: never miss twice in a row.",
      ],
      sellerSide: "Who profits from your empty evenings? Every app with an infinite feed. Unplanned time doesn't stay free. Somebody else plans it for you.",
      source: "Implementation intentions: Peter Gollwitzer, American Psychologist (1999), and many later studies. On tracking where your hours go: Laura Vanderkam, '168 Hours' (2010).",
    },
    focus: {
      title: "Focus",
      tagline: "Quit one thing. Guard one thing.",
      lesson: "In a well-known study, people did worse on attention and memory tests when their phone was simply on the desk, face down and silent, than when it was in another room. Focus isn't only about willpower. It's about what's within reach.",
      rules: [
        "Quit one specific thing this year. Specific means you could film it.",
        "Guard one block of deep work, same time every day if you can.",
        "Measure the leak once, then take back half of it. Not all. Half is sustainable.",
      ],
      sellerSide: "Who profits from your scattered attention? Your attention is the product most free apps sell. A focused hour is the one thing they can't monetise.",
      source: "Smartphone 'brain drain': Ward, Duke, Gneezy & Bos, Journal of the Association for Consumer Research (2017). On deep work: Cal Newport, 'Deep Work' (2016).",
    },
    rich: {
      title: "Rich life",
      tagline: "Name what the money is for.",
      lesson: "Research on money and happiness keeps finding the same thing: money helps most when it buys time and experiences, and when you spend it on purpose instead of by default. A large 2023 study found that for most people, happiness keeps rising with income. A plan that never asks what you want is only half a plan.",
      rules: [
        "Three experiences this year. Each gets a month and a price.",
        "Those prices join your yearly costs, so they're paid for before they happen.",
        "Cut hard on what you don't care about, so you can spend freely on what you do.",
      ],
      sellerSide: "Who profits when you don't know what you want? Advertisers, who are happy to tell you. A short list of your own beats a long list of theirs.",
      source: "Killingsworth, Kahneman & Mellers, PNAS (2023) on income and happiness. Van Boven & Gilovich (2003) on experiences vs possessions. Dunn & Norton, 'Happy Money' (2013).",
    },
  },
  month: {
    intro: "Fifteen minutes, once a month. Look at the numbers, write one honest sentence about what worked and one about what leaked, pick one fix, and do the next action before you close the page.",
    prompts: {
      income: "Money in this month",
      spent: "Money out this month",
      buffer: "Cash buffer today",
      debt: "Debt left today",
      worked: "What worked",
      leaked: "What leaked",
      fix: "One fix for next month",
      next: "Next action (do it before you close this page)",
    },
    freshStart: "Researchers found that people start new habits more often right after 'fresh start' dates like a new month, a birthday or Monday. Every check-in is one. Use it.",
    freshStartSource: "Dai, Milkman & Riis, Management Science (2014): the fresh start effect.",
    quotes: [
      "Boring is the goal. If this took more than fifteen minutes, the plan is too complicated.",
      "Goals are the destination. The monthly check-in is the steering wheel. Steer a little.",
      "A bad month on paper is still a good month for the plan. You know where the leak is now.",
      "Nobody gets rich in a month. Plenty of people get calm in one.",
      "If it's not automatic, it's a wish. Make one more thing automatic.",
      "Half the year is still a year. Look at what's already done.",
      "The best budget is the one you open. Fifteen minutes. Done.",
      "Spend like you mean it. Skip like you mean it, too.",
      "Your future self is reading this page. Leave them something good.",
      "The yearly costs are coming. Good thing they're already paid for.",
      "Two months left. Not a sprint. Just keep the transfers boring.",
      "That's a whole year of check-ins. Most people never do one. Look at you.",
    ],
  },
  oneThingToday: [
    "Set up the monthly transfer for your yearly costs. Today, not on payday.",
    "Put your three fixed blocks in the calendar as recurring events.",
    "Charge your phone outside the bedroom tonight.",
    "Open a separate account or pot called 'Yearly costs'.",
    "Book the first of your three experiences, or at least pick the date.",
    "Tape this page somewhere you'll walk past every day.",
  ],
  disclaimer: "General education, not personal financial advice. Your country, taxes and situation matter.",
};
