import fs from "node:fs";
import { makeRolls, evaluate } from "../src/sim/engine.ts";
import type { Snapshot, Player } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const pad = (s: string | number, n: number) => String(s).padStart(n);

function draft(seed: string, chaseIgl: boolean): Player[] {
  const picks: Player[] = [];
  for (const r of makeRolls(snap, seed)) {
    let best = r.options[0], bs = -1e9;
    for (const p of r.options) {
      let s = p.rating;
      const hi = picks.some(x => x.labels.includes("igl"));
      const ha = picks.some(x => x.labels.includes("awp"));
      if (!hi && p.labels.includes("igl")) s += chaseIgl ? 10 + (p.leads ?? 0) * 2 : 12;
      if (!ha && p.labels.includes("awp")) s += 12;
      if (ha && p.labels.includes("awp")) s -= 8;
      if (s > bs) { bs = s; best = p; }
    }
    picks.push(best);
  }
  return picks;
}
const N = 1200;
console.log(pad("model", 22) + pad("p10", 7) + pad("p50", 7) + pad("p90", 7) + pad("weak+eliteIGL", 15) + pad("strong+eliteIGL", 17));
for (const [name, fn] of [
  ["flat  (current)", (base: number, lead: number) => base + lead * 0.8],
  ["mult  x1.18 max", (base: number, lead: number) => base * (1 + 0.8 * (lead / 12) * 0.18)],
  ["mult  x1.22 max", (base: number, lead: number) => base * (1 + 0.8 * (lead / 12) * 0.22)],
  ["half-and-half",   (base: number, lead: number) => base + lead * 0.4 + base * (0.8 * (lead / 12) * 0.09)],
] as [string, (b: number, l: number) => number][]) {
  const tot: number[] = [];
  for (let i = 0; i < N; i++) {
    const picks = draft(`m${i}`, true);
    const bd = evaluate(picks, snap);
    const base = picks.reduce((a, p) => a + p.rating, 0) / 5;
    tot.push(fn(base, bd.leadership) - (bd.compositionPenalty));
  }
  tot.sort((a, b) => a - b);
  console.log(pad(name, 22) + pad(tot[120].toFixed(1), 7) + pad(tot[600].toFixed(1), 7) + pad(tot[1080].toFixed(1), 7)
    + pad(fn(48, 12).toFixed(1), 15) + pad(fn(72, 12).toFixed(1), 17));
}
