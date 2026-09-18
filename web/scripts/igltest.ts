import fs from "node:fs";
import { makeRolls, evaluate } from "../src/sim/engine.ts";
import type { Snapshot, Player } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const pad = (s: string | number, n: number) => String(s).padStart(n);

console.log("a MAX IGL bonus applied to rosters of different quality:\n");
console.log(pad("roster", 8) + pad("flat +9.6", 12) + pad("gain", 8) + pad("x1.18", 10) + pad("gain", 8));
for (const base of [40, 50, 60, 70, 80]) {
  const flat = base + 9.6;
  const mult = base * 0.2 + base * 0.8 * 1.18;
  console.log(pad(base, 8) + pad(flat.toFixed(1), 12) + pad(((flat / base - 1) * 100).toFixed(0) + "%", 8)
    + pad(mult.toFixed(1), 10) + pad(((mult / base - 1) * 100).toFixed(0) + "%", 8));
}

const rows: { base: number; lead: number; total: number }[] = [];
let rescued = 0;
for (let i = 0; i < 1500; i++) {
  const picks: Player[] = [];
  for (const r of makeRolls(snap, `ig${i}`)) {
    let best = r.options[0], bs = -1e9;
    for (const p of r.options) {
      let s = p.rating + (p.leads ?? 0) * 3;           // chase leadership hard
      if (picks.some(x => x.labels.includes("igl")) && p.labels.includes("igl")) s -= 30;
      if (s > bs) { bs = s; best = p; }
    }
    picks.push(best);
  }
  const bd = evaluate(picks, snap);
  const base = picks.reduce((a, p) => a + p.rating, 0) / 5;
  rows.push({ base, lead: bd.leadership, total: bd.total });
  if (base < 58 && bd.total >= 62) rescued++;
}
rows.sort((a, b) => a.base - b.base);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const lo = rows.slice(0, 300), hi = rows.slice(-300);
console.log(`\nover 1500 IGL-chasing drafts:`);
console.log(`  weakest 20%:   base ${mean(lo.map(r => r.base)).toFixed(1)} -> total ${mean(lo.map(r => r.total)).toFixed(1)}  (lead +${mean(lo.map(r => r.lead)).toFixed(1)})`);
console.log(`  strongest 20%: base ${mean(hi.map(r => r.base)).toFixed(1)} -> total ${mean(hi.map(r => r.total)).toFixed(1)}  (lead +${mean(hi.map(r => r.lead)).toFixed(1)})`);
console.log(`  sub-58 rosters reaching 62+: ${rescued} (${(100 * rescued / 1500).toFixed(1)}%)`);
