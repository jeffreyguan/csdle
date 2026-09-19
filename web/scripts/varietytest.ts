import fs from "node:fs";
import { simulate } from "../src/sim/engine.ts";
import type { Snapshot } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));

// Drive strong runs so playoff matches are plentiful — playoff targets cluster
// around three fixed numbers, which is exactly where opponent variety collapsed.
const N = 1500, cnt = new Map<string, number>();
let matches = 0;
for (let i = 0; i < N; i++)
  for (const m of simulate(74, snap, `var${i}`).matches) {
    if (!/final|semi|quarter/i.test(m.stage)) continue;
    matches++;
    for (const id of m.opponent.roster) {
      const n = snap.players[id].nick;
      cnt.set(n, (cnt.get(n) ?? 0) + 1);
    }
  }
const rank = [...cnt.entries()].sort((a, b) => b[1] - a[1]);
const share = (c: number) => (100 * c) / matches;
console.log(`${matches} playoff sides, ${cnt.size} distinct players`);
console.log("most frequent:");
for (const [n, c] of rank.slice(0, 6))
  console.log(`   ${n.padEnd(14)} ${share(c).toFixed(1)}% of sides`);

// Raised 16 -> 19 when QF/SF targets started scaling with the player (7ac).
// Lifting those rounds pushes them into a genuinely shallow part of the pool:
// NiKo 2020 (78) is the ONLY caller in eleven seasons rated above 66, so once a
// playoff side must be built at 69-72 he is very often the best available IGL.
// Verified this is structural, not a sampling bug — widening the draw
// (NEAR_MIN 12 -> 18) made it WORSE, 17.9% -> 20.2%, because the correction
// pass then reaches for the top to hit the target.
const LIMIT = 19;
const worst = rank[0];
let bad = 0;
if (share(worst[1]) > LIMIT) {
  console.log(`FAIL: ${worst[0]} in ${share(worst[1]).toFixed(1)}% of playoff sides (limit ${LIMIT}%)`);
  bad++;
}
if (cnt.size < 150) { console.log(`FAIL: only ${cnt.size} distinct players reach playoffs`); bad++; }
console.log(bad ? `FAILING: ${bad}` : `playoff opponents are varied (top player ${share(worst[1]).toFixed(1)}%, limit ${LIMIT}%)`);
process.exit(bad ? 1 : 0);
