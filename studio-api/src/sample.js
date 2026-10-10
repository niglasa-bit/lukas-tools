// Free samples (price ladder 10.10.2026): a small public slice of each paid app, served without a
// login at GET /sample?product=. The apps open it with ?sample in the URL, show a "Free sample"
// bar and lock everything that is not in the slice. Only what is listed here is ever public.
import { CONTENT } from "./content.js";
import { CONTENT_AUTOPILOT } from "./content-autopilot.js";
import { CONTENT_ENOUGH } from "./content-enough.js";

const SAMPLES = {
  // The price-tag reader is the taste; the plan, the stage rules and Sunday stay in the full app.
  studio: () => ({
    version: CONTENT.version,
    beforeYouBuy: CONTENT.beforeYouBuy,
    totals: { tools: 3 },
  }),
  // The full audit (it shows what the buyer loses in hours) plus the first recipes and prompts.
  autopilot: () => {
    const c = CONTENT_AUTOPILOT;
    const recipeIds = ["r-news", "a-reply", "p-sleep"]; // one per common tool: email rules, an AI assistant, the phone
    return {
      version: c.version, intro: c.intro, tracks: c.tracks, areas: c.areas, presets: c.presets,
      promptCats: c.promptCats, safety: c.safety, sources: c.sources, disclaimer: c.disclaimer,
      recipes: c.recipes.filter((r) => recipeIds.includes(r.id)),
      prompts: c.prompts.slice(0, 5),
      lessons: c.lessons.slice(0, 1).map(({ script, ...l }) => l),
      totals: { recipes: c.recipes.length, prompts: c.prompts.length, lessons: c.lessons.length },
    };
  },
  // The morning ritual and the first three days.
  enough: () => {
    const c = CONTENT_ENOUGH;
    return {
      version: c.version, intro: c.intro, ritual: c.ritual, catchup: c.catchup, stages: c.stages, sources: c.sources,
      goals: c.goals.slice(0, 3),
      totals: { goals: c.goals.length, days: 66 },
    };
  },
};

export function sampleFor(product) {
  const f = SAMPLES[product];
  return f ? f() : null;
}
