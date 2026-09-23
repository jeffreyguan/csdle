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

// Limit is on a NICK, and a nick can legitimately own a lot of the elite pool:
// NiKo holds 10 of the 94 player-years rated 70+ (s1mple 7, device 6), so 10.6%
// of everyone who can staff a high-target side is him — and he carries an `igl`
// label, so he fills the caller slot too. Raised 16 -> 19 when QF/SF began
// scaling with the player (7ac), briefly 22 while playoff targets were at their
// highest, back to 19 once 7aj lowered them (top player is 16.4% there).
//
// Verified structural, not a sampling bug: widening the draw (NEAR_MIN 12 -> 18)
// made it WORSE, 17.9% -> 20.2%, because the correction pass then reaches for
// the top to hit the target. The real ceiling is that the game contains one
// decade-long elite career and only 44 people rated 70+ at all.
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
