import fs from "node:fs";
import { makeRolls } from "../src/sim/engine.ts";
import { hashSeed, mulberry32 } from "../src/sim/rng.ts";
import type { Snapshot } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));

console.log("clicking 'New' 12 times in a row (endless-0..11):");
let prev: string[] = [];
for (let i = 0; i < 12; i++) {
  const r = makeRolls(snap, `endless-${i}`, prev).map(x => `${x.team.team} ${x.team.year}`);
  console.log(`  ${String(i).padStart(2)}: ${r.join("  |  ")}`);
  prev = r.map(x => x.replace(/ \d{4}$/, ""));
}

console.log("\nmulberry32 first output for sequential seeds:");
for (let i = 0; i < 8; i++) {
  const h = hashSeed(`endless-${i}`);
  const rng = mulberry32(h);
  console.log(`  endless-${i}: hash=${h}  first3=${[rng(),rng(),rng()].map(x=>x.toFixed(4)).join(", ")}`);
}
