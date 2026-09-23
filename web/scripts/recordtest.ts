/** A clean sweep must stay the RARE way to qualify, at every strength a real
 *  player reaches — not just on average. Before the Swiss lift, 51% of
 *  qualifiers at 72 strength went 3-0 and 75% at 78, so the population average
 *  (27%) hid the problem completely. */
import fs from "node:fs";
import { simulate } from "../src/sim/engine.ts";
import type { Snapshot } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
let bad = 0;
console.log("qualifying record by strength (share of qualifiers):");
console.log("  str   qualify     3-0     3-1     3-2");
for (const s of [63, 66, 69, 72, 75, 78]) {
  const rec = [0, 0, 0]; let adv = 0; const N = 4000;
  for (let i = 0; i < N; i++) {
    const r = simulate(s, snap, `rec${s}_${i}`);
    if (r.advanced) { adv++; rec[r.groupLosses]++; }
  }
  const p = (x: number) => `${(100 * x / adv).toFixed(0)}%`.padStart(8);
  console.log(`  ${s}   ${(100 * adv / N).toFixed(0)}%`.padEnd(14) + p(rec[0]) + p(rec[1]) + p(rec[2]));
  // 3-0 must NEVER be the most common record — a sweep is not the default way in.
  if (adv > N * 0.3 && rec[0] > rec[1]) {
    console.log(`     FAIL: at ${s}, 3-0 (${(100*rec[0]/adv).toFixed(0)}%) beats 3-1 (${(100*rec[1]/adv).toFixed(0)}%)`);
    bad++;
  }
  // Below 78 it must also be rarer than 3-2. At 78 it is allowed past 3-2: a
  // side that strong dropping TWO group games genuinely should be rarer than
  // sweeping, and forcing otherwise would mean an elite team gains nothing in
  // the group stage. 78 is under 1% of drafts.
  if (s <= 75 && adv > N * 0.3 && rec[0] > rec[2]) {
    console.log(`     FAIL: at ${s}, 3-0 (${(100*rec[0]/adv).toFixed(0)}%) beats 3-2 (${(100*rec[2]/adv).toFixed(0)}%)`);
    bad++;
  }
}
console.log(bad ? `FAILING: ${bad}` : "a sweep is never the most common way to qualify");
process.exit(bad ? 1 : 0);
