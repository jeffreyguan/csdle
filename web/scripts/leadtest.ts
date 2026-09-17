import fs from "node:fs";
import { evaluate } from "../src/sim/engine.ts";
import type { Snapshot, Player } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const P: Player[] = Object.values(snap.players);

const bonusOf = (p: Player) => snap.teams.find(t => t.igl === p.id)?.leadership ?? 0;
const igls = P.filter(p => p.labels.includes("igl")).sort((a, b) => bonusOf(b) - bonusOf(a));
const filler = P.filter(p => !p.labels.includes("igl") && p.labels.includes("awp")).slice(0, 3);

const top = igls[0], second = igls.find(p => bonusOf(p) > 0 && p.nick !== top.nick)!;
console.log(`senior caller : ${top.nick} ${top.year} (leadership +${bonusOf(top)})`);
console.log(`second caller : ${second.nick} ${second.year} (leadership +${bonusOf(second)})\n`);

const one = evaluate([top, ...filler, P.find(p => !p.labels.includes("igl"))!], snap);
const two = evaluate([top, second, ...filler], snap);

console.log(`one IGL  : leadership +${one.leadership.toFixed(1)}`);
console.log(`two IGLs : leadership +${two.leadership.toFixed(1)}`);
const expected = bonusOf(top) * 4 / 5;
console.log(`\nexpected if ONLY the senior caller counts: +${expected.toFixed(1)}`);
console.log(`bonus is applied once, not stacked: ${Math.abs(two.leadership - expected) < 0.01}`);
console.log(`summed would have been: +${((bonusOf(top)+bonusOf(second))*4/5).toFixed(1)}`);
console.log(`\nnotes: ${two.notes.join(" | ")}`);
