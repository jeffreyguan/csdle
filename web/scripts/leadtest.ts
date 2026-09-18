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

const roster = [top, second, ...filler];
const two = evaluate(roster, snap);

// leadership is MULTIPLICATIVE: other_four_total x (bonus/12) x 0.18, and only
// the senior caller's bonus may apply — never both summed.
const mult = (bonusOf(top) / 12) * 0.18;
const others = roster.filter(p => p.id !== top.id);
const expected = others.reduce((s, p) => s + p.rating, 0) * mult / roster.length;
const stacked = ((bonusOf(top) + bonusOf(second)) / 12) * 0.18
                * others.reduce((s, p) => s + p.rating, 0) / roster.length;

console.log(`two IGLs : leadership +${two.leadership.toFixed(2)}`);
console.log(`expected (senior caller only): +${expected.toFixed(2)}`);
console.log(`if the two stacked it would be: +${stacked.toFixed(2)}`);
console.log(`bonus is applied once, not stacked: ${Math.abs(two.leadership - expected) < 0.05}`);
console.log(`leadership scales with roster quality (multiplicative): ${
  evaluate(roster.map(p => ({...p, rating: p.rating * 2})), snap).leadership > two.leadership * 1.9}`);
console.log(`\nnotes: ${two.notes.join(" | ")}`);
