/** Guards the recurring layout bug: an element mounted conditionally inside a
 *  sized container shifts everything around it. Four instances so far —
 *  reroll button, roll-header logo, mode buttons, honours row. */
import fs from "node:fs";
const src = fs.readFileSync("src/App.tsx", "utf8");

// blocks that must render unconditionally (empty is fine) to hold their space
const MUST_ALWAYS_RENDER = ["c-honours", "c-leads", "org-logo", "mode-new"];
const bad: string[] = [];
for (const cls of MUST_ALWAYS_RENDER) {
  // a conditional immediately preceding the class => guarded mount
  const re = new RegExp(`\\{[^\\n]*&&\\s*\\(?\\s*<div className=(?:"|\\{\`)${cls}`, "g");
  if (re.test(src)) bad.push(cls);
}
console.log(bad.length
  ? `CONDITIONALLY MOUNTED (will shift layout): ${bad.join(", ")}`
  : `layout-reserved blocks all render unconditionally: ${MUST_ALWAYS_RENDER.join(", ")}`);

// every card/slot must emit the same block sequence
const blocks = ["c-honours", "c-head", "c-ratingbox", "c-stats", "c-tags", "c-leads"];
const counts = blocks.map(b => [b, (src.match(new RegExp(`className=(?:"|\\{\`)${b}`, "g")) ?? []).length] as const);
console.log("block occurrences (option card + filled slot = 2 each):");
console.log("   " + counts.map(([b, n]) => `${b}:${n}`).join("  "));
// the two card variants must compute the rating bonus identically — the option
// card once lagged behind the slot and showed team_bonus only, hiding the HLTV
// component entirely
const combined = (src.match(/p\.team_bonus \+ p\.top20_bonus/g) ?? []).length;
const teamOnly = (src.match(/\+\{p\.team_bonus\}/g) ?? []).length;
console.log(`bonus expression: combined in ${combined} places, team-only in ${teamOnly}`);
console.log(combined >= 4 && teamOnly === 0
  ? "card and slot both show team + HLTV bonuses"
  : "MISMATCH: a card variant is not summing both bonuses");

const uneven = counts.filter(([, n]) => n !== 2);
console.log(uneven.length ? `UNEVEN: ${uneven.map(([b, n]) => `${b}=${n}`).join(", ")}`
                          : "card and slot emit identical block sets");
