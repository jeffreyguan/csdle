import fs from "node:fs";
import { makeRolls, rerollAt, REROLLS } from "../src/sim/engine.ts";
import type { Snapshot } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));

const base = makeRolls(snap, "rt-1");
console.log("base board:", base.map(r => `${r.team.team} ${r.team.year}`).join(" | "));

// determinism: same (seed, round, attempt) must give the same team
const a = rerollAt(snap, "rt-1", 0, 1, []);
const b = rerollAt(snap, "rt-1", 0, 1, []);
console.log("reroll deterministic:", a.team.team === b.team.team && a.team.year === b.team.year);

// successive rerolls of one slot should differ
const inPlay = base.map(r => r.team.team);
const seq = [1, 2, 3].map(n => rerollAt(snap, "rt-1", 0, n, inPlay));
console.log("slot 0 rerolled x3:", seq.map(r => `${r.team.team} ${r.team.year}`).join(" -> "));
console.log("  all distinct:", new Set(seq.map(r => r.team.team)).size === 3);
console.log("  none collide with the board:", seq.every(r => !inPlay.includes(r.team.team)));

// reroll never returns an org already on the board, across many seeds
let collide = 0, same = 0;
for (let i = 0; i < 500; i++) {
  const bd = makeRolls(snap, `s${i}`);
  const ip = bd.map(r => r.team.team);
  const rr = rerollAt(snap, `s${i}`, 2, 1, ip);
  if (ip.includes(rr.team.team)) collide++;
  if (rr.team.team === bd[2].team.team) same++;
}
console.log(`\nover 500 rerolls: collisions with board ${collide}, returned the same team ${same}`);
console.log(`REROLLS per draft: ${REROLLS}`);
