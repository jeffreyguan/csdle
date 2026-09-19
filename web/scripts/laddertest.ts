/** The stage ladder must never dip: the previous version put the Swiss decider
 *  at 63.4 and the quarter-final at 62.0, so entering the playoffs got EASIER. */
import fs from "node:fs";
const s = fs.readFileSync("src/sim/engine.ts", "utf8");
const base = Number(/SWISS_BASE = ([\d.]+)/.exec(s)![1]);
const per = Number(/SWISS_PER_DIFF = ([\d.]+)/.exec(s)![1]);
const qfSeed = Number(/RECORD_STEP = ([\d.]+)/.exec(s)![1]);
const po = [...s.matchAll(/stage: "([^"]+)", target: ([\d.]+)/g)].map(m => [m[1], Number(m[2])] as const);

// Swiss difficulty follows (wins - losses)
const swiss: [string, number][] = [
  ["Swiss 0-0", base], ["Swiss 1-0", base + per], ["Swiss 2-0", base + 2 * per],
  ["Swiss 2-1", base + per], ["Swiss 2-2", base],
  ["Swiss 0-1", base - per], ["Swiss 1-2", base - per],
];
console.log("Swiss, by record:");
for (const [n, t] of swiss) console.log(`   ${n.padEnd(11)} ${t.toFixed(1)}`);
console.log(`\n2-0 (${(base+2*per).toFixed(1)}) > 2-1 (${(base+per).toFixed(1)}) > 2-2 (${base.toFixed(1)}): `
  + `${base + 2*per > base + per && base + per > base}`);
console.log("\nQF seeding by Swiss losses:");
for (const L of [0, 1, 2])
  console.log(`   qualified 3-${L}  ->  QF target ${(po[0][1] + (L - 1) * qfSeed).toFixed(1)}`);
console.log(`   3-0 draws an easier QF than 3-2: ${qfSeed > 0}`);

// A single monotonic ladder no longer applies: QF seeding deliberately gives a
// 3-0 qualifier an EASIER quarter-final than their last Swiss match. That dip is
// the reward. What must hold instead:
const hardestSwiss = base + 2 * per;
const qf = po[0][1], sf = po[1][1], gf = po[2][1];
const qfEasy = qf - qfSeed, qfHard = qf + qfSeed;

console.log("\ninvariants:");
const checks: [string, boolean][] = [
  ["Swiss rises with record (2-0 > 2-1 > 2-2)", base + 2*per > base + per && base + per > base],
  ["a 3-0 run earns an easier QF than its last Swiss match", qfEasy < hardestSwiss],
  ["a 3-2 run draws a harder QF than its last Swiss match", qfHard > base],
  // NOT "above the hardest QF draw": a 3-2 qualifier meeting a 3-0 team is meant
  // to be brutal, often the hardest match in the bracket, exactly as at a real
  // Major. The bracket must escalate on AVERAGE, not for every seed.
  ["semi-final above the median QF draw", sf > qf],
  ["grand final above the semi", gf > sf],
  ["playoff steps steeper than Swiss steps", (gf - qf) / 2 > per],
];
for (const [name, ok] of checks) console.log(`   ${ok ? "ok  " : "FAIL"} ${name}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);

const ladder: [string, number][] = [

  ["Swiss 0-0", base], ["Swiss 1-0", base + per], ["Swiss 2-0", base + 2 * per],
  ...po,
];
console.log("difficulty ladder:");
ladder.forEach(([n, t], i) => {
  const d = i ? ` (${(t - ladder[i - 1][1] >= 0 ? "+" : "") + (t - ladder[i - 1][1]).toFixed(1)})` : "";
  console.log(`   ${n.padEnd(15)} ${t.toFixed(1)}${d}`);
});

