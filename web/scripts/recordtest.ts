/** Drafting well must PAY, and the field must not re-rate itself around you.
 *
 *  This test used to assert the opposite: "a clean sweep must stay the RARE way
 *  to qualify, at every strength". That was the companion to the strength-
 *  tracking difficulty lift — with 85% of every rating point handed back to the
 *  opponent, a sweep stayed rare at 78 strength only because the 78-rated side
 *  was made to play a 78-rated field. Qualification ran 79.6% at strength 64 and
 *  89.1% at 82, so eighteen points of drafting bought ten points of qualifying.
 *
 *  The lift is gone and the ladder is absolute. A sweep is now SUPPOSED to be
 *  the ordinary result of a genuinely strong draft. What has to hold instead:
 *
 *    1. the sweep rate rises with strength, at every step — the draft is the
 *       thing that moves the outcome;
 *    2. a median draft still rarely sweeps — it is a reward, not a default;
 *    3. an elite draft still does not sweep every time — the group stage keeps
 *       real variance, because the field has a top end that can land on you;
 *    4. the field itself is strength-INDEPENDENT — the regression that started
 *       all this. Group opponents must rate the same whoever enters.
 */
import fs from "node:fs";
import { simulate } from "../src/sim/engine.ts";
import type { Snapshot } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));

const STR = [63, 66, 69, 72, 75, 78];
const N = 4000;
const sweepRate: number[] = [];
const oppMean: number[] = [];
/** Mean opponent in the FIRST group match only. Everyone is 0-0 there, so this
 *  isolates the FIELD from the record ladder. The all-match mean legitimately
 *  rises with strength — a strong side wins more, so it spends more of its
 *  group stage on 2-0, which Swiss pairs harder by design. That is the ladder
 *  working, not the field tracking the player. */
const oppFirst: number[] = [];
let bad = 0;

console.log("qualifying record by strength (share of qualifiers):");
console.log("  str   qualify     3-0     3-1     3-2   | opp: match1  all");
for (const s of STR) {
  const rec = [0, 0, 0]; let adv = 0, oppSum = 0, oppN = 0, firstSum = 0;
  for (let i = 0; i < N; i++) {
    const r = simulate(s, snap, `rec${s}_${i}`);
    if (r.advanced) { adv++; rec[r.groupLosses]++; }
    firstSum += r.matches[0].opponent.effective_strength;
    for (const m of r.matches)
      if (m.stage.startsWith("Swiss")) { oppSum += m.opponent.effective_strength; oppN++; }
  }
  sweepRate.push(100 * rec[0] / adv);
  oppMean.push(oppSum / oppN);
  oppFirst.push(firstSum / N);
  const p = (x: number) => `${(100 * x / adv).toFixed(0)}%`.padStart(8);
  console.log(`  ${s}   ${(100 * adv / N).toFixed(0)}%`.padEnd(14) +
    p(rec[0]) + p(rec[1]) + p(rec[2]) +
    `   | ${(firstSum / N).toFixed(1).padStart(9)} ${(oppSum / oppN).toFixed(1)}`);
}

console.log("\ninvariants:");
const check = (name: string, ok: boolean) => {
  console.log(`   ${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) bad++;
};

// 1. the sweep rate rises at every step
for (let i = 1; i < STR.length; i++)
  check(`sweep rate rises ${STR[i - 1]} -> ${STR[i]}  (${sweepRate[i - 1].toFixed(0)}% -> ${sweepRate[i].toFixed(0)}%)`,
    sweepRate[i] > sweepRate[i - 1]);

// 2. a median draft rarely sweeps (63 is near the median of a competent player)
check(`a 63 draft sweeps under 30% of its qualifications (${sweepRate[0].toFixed(0)}%)`, sweepRate[0] < 30);

// 3. an elite draft still drops group games — a sweep is common, never automatic
check(`a 78 draft sweeps under 85% of its qualifications (${sweepRate[5].toFixed(0)}%)`, sweepRate[5] < 85);

// 4. THE regression guard: at a FIXED record, the field does not track you.
//    Under the old lift the match-1 opponent ran 58.5 at strength 63 and 71.3
//    at 78 — a 12.8-point spread that ate the entire value of the draft.
const spread = Math.max(...oppFirst) - Math.min(...oppFirst);
check(`field is strength-independent: match-1 opponent varies ${spread.toFixed(2)} across 63-78 (< 1.0)`,
  spread < 1.0);
// and the all-match mean may rise ONLY by the record ladder, never more than
// one full ladder step (SWISS_PER_DIFF = 2.6)
const drift = Math.max(...oppMean) - Math.min(...oppMean);
check(`all-match drift is record-ladder only: ${drift.toFixed(2)} (< 2.6)`, drift < 2.6);

console.log(bad ? `\nFAILING: ${bad}` : "\na strong draft is rewarded, and the field is the same for everyone");
process.exit(bad ? 1 : 0);
