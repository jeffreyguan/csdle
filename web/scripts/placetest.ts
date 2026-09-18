import fs from "node:fs";
import { makeRolls, evaluate, simulate } from "../src/sim/engine.ts";
import type { Snapshot, Player } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
function draft(seed: string, smart: boolean): Player[] {
  const rolls = makeRolls(snap, seed); const picks: Player[] = [];
  for (const r of rolls) {
    let best = r.options[0], bs = -1e9;
    for (const p of r.options) {
      let s = p.rating;
      if (smart) {
        const ha = picks.some(x=>x.labels.includes("awp"));
        if (!picks.some(x=>x.labels.includes("igl")) && p.labels.includes("igl")) s += 14;
        if (!ha && p.labels.includes("awp")) s += 12;
        if (ha && p.labels.includes("awp")) s -= 8;
      }
      if (s > bs) { bs = s; best = p; }
    }
    picks.push(best);
  }
  return picks;
}
const N = 1000;
for (const smart of [true, false]) {
  const place = new Map<string, number>();
  const st: number[] = [];
  for (let i = 0; i < N; i++) {
    const b = evaluate(draft(`p${i}`, smart), snap);
    st.push(b.total);
    const r = simulate(b.total, snap, `p${i}`);
    place.set(r.placement, (place.get(r.placement) ?? 0) + 1);
  }
  st.sort((a,b)=>a-b);
  console.log(`${smart ? "constraint-aware" : "greedy         "}  strength p10 ${st[100].toFixed(0)} p50 ${st[500].toFixed(0)} p90 ${st[900].toFixed(0)}`);
  const keys=[...place.keys()].sort();
  const grp=keys.filter(k=>k.startsWith("Swiss"));
  let g=0; for (const k of grp) g+=place.get(k)!;
  console.log(`     ${"OUT in Swiss".padEnd(16)} ${(g/N*100).toFixed(1)}%`);
  for (const k of ["Quarter-final","Semi-final","Grand Final","CHAMPION"])
    console.log(`     ${k.padEnd(16)} ${((place.get(k) ?? 0)/N*100).toFixed(1)}%`);
}
