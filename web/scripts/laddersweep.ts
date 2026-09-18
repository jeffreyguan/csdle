import fs from "node:fs";
import { makeRolls, evaluate } from "../src/sim/engine.ts";
import { hashSeed, mulberry32 } from "../src/sim/rng.ts";
import type { Snapshot, Player } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const pad = (s: string | number, n: number) => String(s).padStart(n);

function draft(seed: string, smart: boolean): Player[] {
  const picks: Player[] = [];
  for (const r of makeRolls(snap, seed)) {
    let best = r.options[0], bs = -1e9;
    for (const p of r.options) {
      let s = p.rating;
      if (smart) {
        const ha = picks.some(x => x.labels.includes("awp"));
        if (!picks.some(x => x.labels.includes("igl")) && p.labels.includes("igl")) s += 10 + (p.leads ?? 0);
        if (!ha && p.labels.includes("awp")) s += 12;
        if (ha && p.labels.includes("awp")) s -= 8;
      }
      if (s > bs) { bs = s; best = p; }
    }
    picks.push(best);
  }
  return picks;
}
const N = 1200;
const smart = Array.from({ length: N }, (_, i) => evaluate(draft(`L${i}`, true), snap).total);
const greedy = Array.from({ length: N }, (_, i) => evaluate(draft(`L${i}`, false), snap).total);
const WP = (a: number, b: number) => 1 / (1 + Math.exp(-(a - b) / 7));

function run(st: number, seed: string, base: number, per: number, PO: number[]) {
  const rng = mulberry32(hashSeed(seed + ":sim"));
  const jit = (t: number) => t + (rng() - 0.5) * 5;
  const ser = (t: number, need: number) => { let y = 0, o = 0; const p = WP(st, t);
    while (y < need && o < need) { rng() < p ? y++ : o++; } return y > o; };
  let w = 0, l = 0;
  while (w < 3 && l < 3) { const need = (w === 2 || l === 2) ? 2 : 1;
    ser(jit(base + w * per), need) ? w++ : l++; }
  if (w < 3) return 0;
  let pw = 0;
  for (let i = 0; i < PO.length; i++) { if (!ser(jit(PO[i]), i === 2 ? 3 : 2)) return pw + 1; pw++; }
  return 4;
}
const SETS: [string, number, number, number[]][] = [
  ["current 57.4 +3.0 | 62/65/67", 57.4, 3.0, [62, 65, 67]],
  ["E  56.5 +1.5 | 62.0/65.5/69",  56.5, 1.5, [62.0, 65.5, 69]],
  ["I  58.5 +1.5 | 62.5/66.0/69.5",58.5, 1.5, [62.5, 66.0, 69.5]],
  ["J  59.0 +1.2 | 62.5/66.0/69.5",59.0, 1.2, [62.5, 66.0, 69.5]],
  ["K  59.0 +1.5 | 63.0/66.5/70.0",59.0, 1.5, [63.0, 66.5, 70.0]],
];
console.log(pad("config", 31) + pad("swissOut", 10) + pad("QF", 7) + pad("SF", 7) + pad("GF", 7) + pad("CHAMP", 8) + pad("greedy", 8));
for (const [name, base, per, PO] of SETS) {
  const c = [0, 0, 0, 0, 0];
  smart.forEach((s, i) => c[run(s, `L${i}`, base, per, PO)]++);
  const g = greedy.filter((s, i) => run(s, `L${i}`, base, per, PO) === 4).length;
  const pc = (x: number) => `${(100 * x / N).toFixed(1)}%`;
  console.log(pad(name, 31) + pad(pc(c[0]), 10) + pad(pc(c[1]), 7) + pad(pc(c[2]), 7)
    + pad(pc(c[3]), 7) + pad(pc(c[4]), 8) + pad(`${(100 * g / N).toFixed(1)}%`, 8));
}
