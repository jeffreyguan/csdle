import fs from "node:fs";
import { makeRolls } from "../src/sim/engine.ts";
import type { Snapshot } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const ORGS = new Set(snap.teams.map(t => t.team)).size;

const S = 200, DRAFTS = 10, SLOTS = DRAFTS * 5;
let tot = 0, totRepeat = 0;
for (let s = 0; s < S; s++) {
  const seen = new Set<string>(); let prev: string[] = []; let rep = 0;
  for (let i = 0; i < DRAFTS; i++) {
    const bare = makeRolls(snap, `sess${s}-${i}`, prev).map(r => r.team.team);   // as the UI does
    rep += bare.filter(o => prev.includes(o)).length;
    bare.forEach(o => seen.add(o)); prev = bare;
  }
  tot += seen.size; totRepeat += rep;
}
// theoretical max: 50 uniform draws from ORGS distinct orgs
const ideal = ORGS * (1 - Math.pow(1 - 1 / ORGS, SLOTS));
console.log(`pool: ${ORGS} orgs, ${snap.teams.length} team-years`);
console.log(`over ${S} sessions of ${DRAFTS} drafts (${SLOTS} slots each):`);
console.log(`  distinct orgs seen : ${(tot / S).toFixed(1)} avg`);
console.log(`  theoretical ceiling: ${ideal.toFixed(1)}  (uniform sampling with replacement)`);
console.log(`  efficiency         : ${(100 * (tot / S) / ideal).toFixed(0)}% of ceiling`);
console.log(`  org repeats from immediately-previous draft: ${(totRepeat / S).toFixed(1)}/45 avg`);
