import fs from "node:fs";
import { makeRolls } from "../src/sim/engine.ts";
import type { Snapshot } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const show = (n: number, prev: string[]) =>
  makeRolls(snap, `endless-${n}`, prev).map(r => `${r.team.team} ${r.team.year}`);

console.log("endless: pressing 'New teams' 6 times");
let prev: string[] = []; const seen: string[][] = [];
for (let i = 0; i < 6; i++) {
  const r = show(i, prev); seen.push(r); prev = r.map(x => x.replace(/ \d{4}$/, ""));
  console.log(`  ${i}: ${r.join(" | ")}`);
}
const identical = seen.filter((r, i) => i > 0 && r.join() === seen[i-1].join()).length;
console.log(`\nconsecutive drafts that are identical: ${identical}/5`);
const allSlots = seen.flat();
console.log(`distinct team-years over 6 drafts: ${new Set(allSlots).size}/30`);
