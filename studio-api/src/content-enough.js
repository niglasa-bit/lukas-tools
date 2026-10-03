// Premium content for The Enough Habit. Served only to an activated device that owns it
// (GET /content?product=enough). Voice: Lukas · The Systemized Life. Calm, short, one action a day.
// Sources: only well-known ones people may recognize (peer-reviewed studies, classic books).
// Updating the product = editing this file and deploying the Worker (npm run deploy). Bump `version`
// and add a line to `changelog`; buyers see it under More → What's new on their next launch.
//
// Shape: 66 calendar days. 60 goal days in six stages of ten, and a catch-up day after every ten goals
// (calendar days 11, 22, 33, 44, 55, 66). Lally et al. (2010) found that missing one day did not
// materially hurt habit formation, so the catch-up days are part of the design, not a punishment.

export const CONTENT_ENOUGH = {
  version: 1,
  changelog: [
    { version: 1, date: "2026-10-03", notes: ["First edition: 60 daily goals in six stages, six catch-up days, the morning Enough Check and the printable."] },
  ],

  intro: {
    title: "Want less. Keep more. One small thing a day.",
    body: "For the next 66 days you'll do one tiny thing a day. Sixty of the days have a goal: short, concrete, done before bedtime. Six are catch-up days. None of it asks you to be a monk. It asks you to notice, cut one leak at a time, and keep what you save.",
    honest: "What the research really says: a new daily behaviour took a median of 66 days to become automatic in the best-known study, and anywhere from 18 to 254 days for different people. So this isn't magic in 60 days. It's 66 days of the same small morning ritual, with a new goal inside it each day. The ritual is the habit. The goals are what it carries.",
  },

  // The one behaviour repeated every single day, at the same cue. This is what becomes automatic.
  ritual: {
    title: "The Enough Check",
    minutes: 2,
    steps: [
      "At your cue, open today's card. Same moment every day.",
      "Read the goal and decide when today you'll do it.",
      "Ask one question: what will I not buy today?",
      "Tonight, tick the day. If you kept money, write the amount.",
    ],
    cueExamples: [
      "After I pour my first coffee or tea",
      "After I sit down on the bus or train",
      "After I brush my teeth in the morning",
    ],
    cueWhy: "Same time, same place, same trigger. In habit studies the behaviour becomes automatic because the cue keeps showing up, not because you try harder. Mornings tend to work best.",
  },

  catchup: {
    title: "Catch-up day",
    body: "No new goal today. Do your Enough Check as usual, then pick one: finish a goal you skipped, repeat a goal you liked, or just rest. Missing one day doesn't break a habit. Missing the cue for a week does.",
  },

  stages: [
    { id: "see", title: "See it", tagline: "Notice where it goes.", days: [1, 10] },
    { id: "clear", title: "Clear it", tagline: "Own what you use.", days: [11, 20] },
    { id: "leaks", title: "Cut the leaks", tagline: "Stop paying for nothing.", days: [21, 30] },
    { id: "home", title: "Kitchen & home", tagline: "Small money, every day.", days: [31, 40] },
    { id: "buy", title: "Buy better", tagline: "Pause before you pay.", days: [41, 50] },
    { id: "keep", title: "Keep it", tagline: "Enough, on purpose.", days: [51, 60] },
  ],

  // n = goal number (1-60). min = rough minutes. kept = true when it can save money you can log.
  goals: [
    // See it
    { n: 1, title: "Pick your cue", why: "Habits stick to a fixed moment, not to motivation. Choose the exact moment you'll open this card every morning and write it down.", min: 3, kept: false },
    { n: 2, title: "Write your enough line", why: "One sentence: what a good-enough month looks like for you. Without a finish line, 'more' never ends.", min: 5, kept: false },
    { n: 3, title: "Sort 30 days into three piles", why: "Go through last month's spending: needed, loved, meh. The 'meh' pile is where the easy savings hide.", min: 20, kept: false },
    { n: 4, title: "Name your top three 'meh' buys", why: "Write them on a note. Naming a pattern makes it visible the next time it happens.", min: 5, kept: false },
    { n: 5, title: "Do a one-minute photo tour", why: "Film every room for ten seconds. Most of us own far more than we think, and seeing it calms the urge to add.", min: 5, kept: false },
    { n: 6, title: "Unsubscribe from ten shop emails", why: "Every sale email is a prompt to buy. Fewer prompts, fewer impulse buys, with zero willpower.", min: 10, kept: false },
    { n: 7, title: "Move one shopping app off your home screen", why: "Friction beats willpower. Two extra taps are often enough to break the scroll-and-buy loop.", min: 2, kept: false },
    { n: 8, title: "Delete one saved card", why: "Remove your saved card from one online store. Typing the number gives you a free 30-second pause.", min: 3, kept: false },
    { n: 9, title: "Have a no-spend day", why: "Buy nothing you want today, only what you need. It proves to your brain that a day without buying feels fine.", min: 0, kept: true },
    { n: 10, title: "Celebrate one thing you didn't buy", why: "Write it down and smile. Rewarding the 'no' is what makes it repeat.", min: 2, kept: true },
    // Clear it
    { n: 11, title: "Clear one drawer", why: "Keep what you used this year, box the rest. One drawer is small enough to finish today.", min: 15, kept: false },
    { n: 12, title: "Count your cups", why: "Keep enough mugs and glasses for a normal week. Extras are storage you pay for in space and cleaning.", min: 10, kept: false },
    { n: 13, title: "List one thing for sale", why: "Find five things worth selling and list the first one today. Clutter turns back into money.", min: 20, kept: true },
    { n: 14, title: "Turn your hangers backwards", why: "Hang every item the 'wrong' way. When you wear something, hang it back normally. On day 51 you'll see what you never wear.", min: 10, kept: false },
    { n: 15, title: "Make your phone one page", why: "Fit your home screen on one page. Fewer icons, fewer little pulls on your attention and wallet.", min: 10, kept: false },
    { n: 16, title: "Gather the duplicates", why: "Chargers, scissors, pens, bottles. Keep the ones you need. You'll stop rebuying what you already have.", min: 15, kept: false },
    { n: 17, title: "Make a maybe box", why: "Can't decide? Put it in a box, write today's date on it. If you don't open it in a month, you have your answer.", min: 15, kept: false },
    { n: 18, title: "Clear one surface and keep it clear", why: "One empty counter or desk, kept clear tonight. A clear surface is a daily reminder of how good 'less' feels.", min: 10, kept: false },
    { n: 19, title: "Donate one bag", why: "Fill one bag and take it to a charity shop or a neighbour today. Out of the house is out of the decision.", min: 20, kept: false },
    { n: 20, title: "Write your one-in, one-out rule", why: "For clothes, books or gadgets: something new comes in, something leaves. Write it on a note inside your wardrobe.", min: 3, kept: false },
    // Cut the leaks
    { n: 21, title: "List every subscription", why: "Search your bank statement for anything that repeats. Most people find at least one they forgot.", min: 20, kept: false },
    { n: 22, title: "Cancel or pause one", why: "Pick one you didn't use last month and cancel or pause it today. You can always come back.", min: 10, kept: true },
    { n: 23, title: "Ask for a better price", why: "Chat or call one provider: phone, internet or insurance. Ask: 'What's the best price you can offer me to stay?'", min: 20, kept: true },
    { n: 24, title: "Find one fee you pay", why: "Bank account, card, transfers. Look for one fee and switch it off or switch to the free option.", min: 15, kept: true },
    { n: 25, title: "Right-size your phone plan", why: "Check how much data you actually used in the last three months. Pay for that, not for 'just in case'.", min: 15, kept: true },
    { n: 26, title: "Turn off one auto-renew", why: "For anything that renews yearly, turn off auto-renew and set a reminder a week before. Then you decide, not the default.", min: 10, kept: false },
    { n: 27, title: "Rotate your streaming", why: "Keep one service at a time and switch month by month. You'll watch the same amount and pay for one.", min: 10, kept: true },
    { n: 28, title: "Check for double insurance", why: "Phone, travel or purchase cover often comes free with a card or home policy. Look for one you pay twice.", min: 20, kept: true },
    { n: 29, title: "Return or sell one unused buy", why: "Something you bought and never used. Return it if you still can, or list it. Sunk cost is not a reason to keep it.", min: 15, kept: true },
    { n: 30, title: "Move the cut money", why: "Add up what you cut this stage and set up a transfer of that amount to savings. Cut money vanishes into spending unless it moves.", min: 10, kept: true },
    // Kitchen & home
    { n: 31, title: "Cook from what's there", why: "Make one meal using only what's already in the fridge and cupboard. It's a puzzle, and it's free.", min: 30, kept: true },
    { n: 32, title: "Pack tomorrow's lunch tonight", why: "Decide tonight, eat well tomorrow. Bought lunches add up quietly, a few at a time.", min: 10, kept: true },
    { n: 33, title: "Write your five easy dinners", why: "Five meals you can cook tired, without a recipe. It's the list that beats takeaway on a Tuesday.", min: 10, kept: false },
    { n: 34, title: "Shop the list, only the list", why: "Write a list, take it, buy only what's on it. Shops are designed for wandering. Lists aren't.", min: 0, kept: true },
    { n: 35, title: "Make an eat-first shelf", why: "Put what goes off soonest at eye level in the fridge. Less food goes in the bin.", min: 10, kept: true },
    { n: 36, title: "Bring your own coffee", why: "Make it at home and take it with you. Not forever, just today, and notice how it felt.", min: 5, kept: true },
    { n: 37, title: "Cook double, freeze half", why: "Today's dinner is also next week's. Future you on a busy evening will thank you.", min: 15, kept: true },
    { n: 38, title: "Switch off one standby", why: "Turn off at the wall one set of devices that sit on standby, or turn the heating down one notch. Small, every day.", min: 5, kept: false },
    { n: 39, title: "Fix one thing", why: "A loose button, a wobbly chair, a cracked case. Look up how to fix it before you look up where to buy a new one.", min: 20, kept: true },
    { n: 40, title: "Borrow instead of buy", why: "Need a tool, a book or a dress for one evening? Ask a friend, a neighbour or the library first.", min: 10, kept: true },
    // Buy better
    { n: 41, title: "Start a wait list", why: "Every want goes on a list and waits seven days. If you still want it then, you may buy it. Most won't survive the week.", min: 5, kept: false },
    { n: 42, title: "Price one want in hours", why: "Divide its price by what you really earn per hour after costs. 'Six hours of my life' is easier to judge than a number.", min: 10, kept: false },
    { n: 43, title: "Name your spend-gladly three", why: "Three things you love spending on. Spend there without guilt, cut hard everywhere else. Frugal isn't cheap. It's chosen.", min: 10, kept: false },
    { n: 44, title: "Check your wait list", why: "Read the list from day 41. Cross out what you don't want anymore. That's money you kept without saying no once.", min: 5, kept: true },
    { n: 45, title: "Ask 'where will it live?'", why: "Before any purchase today, name the exact spot it will go. No spot, no buy.", min: 0, kept: true },
    { n: 46, title: "Look for used first", why: "For one thing you really need, check second-hand before new. Same use, smaller price, less waste.", min: 15, kept: true },
    { n: 47, title: "Work out a cost per use", why: "Price divided by how many times you'll really use it. A cheap thing used once can cost more than a good thing used daily.", min: 5, kept: false },
    { n: 48, title: "Unfollow five buy-me accounts", why: "Accounts that make you want stuff. Unfollow five. Your feed is an ad you don't have to watch.", min: 5, kept: false },
    { n: 49, title: "Set a guilt-free fun amount", why: "Pick a weekly amount for fun and spend it happily. A budget with no fun breaks. A budget with fun lasts.", min: 5, kept: false },
    { n: 50, title: "Plan one free good time", why: "A walk, a picnic, a library evening, a game night. Put it in the calendar for this week.", min: 10, kept: false },
    // Keep it
    { n: 51, title: "Check your hangers", why: "Look at what's still backwards since day 14. Pick three items you didn't wear and let them go.", min: 15, kept: true },
    { n: 52, title: "Open the maybe box", why: "Anything you missed? Keep it. The rest leaves today. Now you know what 'enough' looks like in your home.", min: 15, kept: false },
    { n: 53, title: "Add up what you kept", why: "Total your log. Then give that money a name: a trip, a buffer, a debt. Named money stays put.", min: 10, kept: false },
    { n: 54, title: "Put it on autopilot", why: "Set a monthly automatic transfer of the amount you now keep. The habit keeps working when you stop thinking about it.", min: 10, kept: false },
    { n: 55, title: "Write your three keeper rules", why: "Which three rules from these weeks will you keep? Write them where you'll see them every day.", min: 10, kept: false },
    { n: 56, title: "Give one thing away", why: "Something you own that someone else would use more. Giving is the nicest way to have less.", min: 10, kept: false },
    { n: 57, title: "Plan a no-spend day", why: "Pick a day next week and plan it: food at home, free fun, nothing in the basket. Planned is easier than spontaneous.", min: 5, kept: true },
    { n: 58, title: "Rewrite your enough line", why: "Read the sentence from day 2. Does it still fit? Rewrite it with what you know now.", min: 5, kept: false },
    { n: 59, title: "Teach one rule to a friend", why: "Explain one rule to someone today. Teaching it is the fastest way to keep it.", min: 5, kept: false },
    { n: 60, title: "Book your next check", why: "Put a monthly Enough Check in your calendar and keep your morning cue. The 60 goals end today. The habit doesn't.", min: 5, kept: false },
  ],

  finale: {
    title: "Day 66. That's the habit.",
    body: "Sixty-six mornings of the same small check. You noticed, cleared, cut, cooked, paused and kept. Print your page, write your total, and keep the cue. The research says this is roughly when a daily habit starts to run by itself.",
  },

  sources: [
    { short: "Lally et al. 2010", text: "Lally, van Jaarsveld, Potts & Wardle, 'How are habits formed: Modelling habit formation in the real world', European Journal of Social Psychology 40 (2010). Median 66 days to reach automaticity, range 18 to 254. Missing one day did not materially affect the process." },
    { short: "Singh et al. 2024", text: "Singh, Murphy, Maher & Smith, 'Time to form a habit', Healthcare 12 (2024), systematic review. Medians of 59 to 66 days, wide individual differences; morning and self-chosen habits tended to be stronger." },
    { short: "Fogg 2019", text: "BJ Fogg, 'Tiny Habits' (2019). Anchor a tiny behaviour to something you already do, then celebrate it." },
    { short: "Clear 2018", text: "James Clear, 'Atomic Habits' (2018). Habit stacking: 'After I [current habit], I will [new habit]'. Never miss twice." },
    { short: "Duhigg 2012", text: "Charles Duhigg, 'The Power of Habit' (2012). The habit loop: cue, routine, reward." },
    { short: "Gollwitzer 1999", text: "Peter Gollwitzer, 'Implementation intentions', American Psychologist (1999). Deciding when and where makes action far more likely." },
  ],
};
