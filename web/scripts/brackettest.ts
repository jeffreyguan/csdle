import fs from "node:fs";
import { simulate } from "../src/sim/engine.ts";
import type { Snapshot } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json","utf8"));

// A 16-team Swiss to 3 wins / 3 losses qualifies exactly two 3-0, three 3-1 and
// three 3-2 sides. Your own record consumes one of them, so the field you can
// still MEET is capped — facing more than that is impossible, not just unlikely.
const FIELD: Record<number, number> = { 0: 2, 1: 3, 2: 3 };
let bad = 0, runs = 0;
const seen: Record<string, number> = {};
for (let i = 0; i < 8000; i++) {
  const r = simulate(66 + (i % 14), snap, `br${i}`);
  if (!r.advanced) continue;
  runs++;
  const met: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
  for (const m of r.matches) {
    if (!m.oppRecord || m.stage.startsWith("Swiss")) continue;
    const losses = Number(m.oppRecord.split("-")[1]);
    met[losses]++;
    seen[`${r.groupLosses} vs ${m.oppRecord}`] = (seen[`${r.groupLosses} vs ${m.oppRecord}`] ?? 0) + 1;
  }
  for (const k of [0, 1, 2]) {
    const avail = FIELD[k] - (r.groupLosses === k ? 1 : 0);
    if (met[k] > avail) {
      if (bad < 4) console.log(`FAIL: qualified 3-${r.groupLosses}, met ${met[k]} teams on 3-${k} (only ${avail} exist)`);
      bad++;
    }
  }
}
console.log(`\n${runs} playoff runs checked`);
console.log("who you meet, by your own qualifying record:");
for (const k of Object.keys(seen).sort()) console.log(`   you 3-${k.padEnd(12)} ${seen[k]}`);
// cross-seeding must still hold: your QF opponent is decided by the bracket,
// so a clean 3-0 can only ever be paired against a 3-2, never another 3-0.
const ALLOWED: Record<number, string[]> = { 0: ["3-2"], 1: ["3-1", "3-2"], 2: ["3-0", "3-1"] };
const qfSeen: Record<string, number> = {};
for (let i = 0; i < 6000; i++) {
  const r = simulate(62 + (i % 16), snap, `x${i}`); if (!r.advanced) continue;
  const qf = r.matches.find(m => m.stage.startsWith("Quarter"));
  if (!qf?.oppRecord) continue;
  qfSeen[`3-${r.groupLosses} -> ${qf.oppRecord}`] = (qfSeen[`3-${r.groupLosses} -> ${qf.oppRecord}`] ?? 0) + 1;
  if (!ALLOWED[r.groupLosses].includes(qf.oppRecord)) {
    if (bad < 8) console.log(`FAIL: qualified 3-${r.groupLosses} but drew a ${qf.oppRecord} in the QF`);
    bad++;
  }
}
console.log("\nquarter-final pairings (bracket cross-seeding):");
for (const k of Object.keys(qfSeen).sort()) console.log(`   ${k.padEnd(16)} ${qfSeen[k]}`);

console.log(bad ? `FAILING: ${bad} impossible fields` : "every playoff field is combinatorially possible");
process.exit(bad ? 1 : 0);
