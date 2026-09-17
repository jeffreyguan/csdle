import fs from "node:fs";
import { makeRolls, evaluate, simulate } from "../src/sim/engine.ts";
import type { Snapshot, Player } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));

function draft(seed: string): Player[] {
  const rolls = makeRolls(snap, seed); const picks: Player[] = [];
  for (const r of rolls) {
    let best = r.options[0], bs = -1e9;
    for (const p of r.options) {
      let s = p.rating;
      const hasIgl = picks.some(x => x.labels.includes("igl"));
      const hasAwp = picks.some(x => x.labels.includes("awp"));
      if (!hasIgl && p.labels.includes("igl")) s += 14;
      if (!hasAwp && p.labels.includes("awp")) s += 12;
      if (hasIgl && p.labels.includes("igl")) s -= 6;
      if (hasAwp && p.labels.includes("awp")) s -= 8;
      if (s > bs) { bs = s; best = p; }
    }
    picks.push(best);
  }
  return picks;
}
const N = 600;
const strengths = Array.from({length: N}, (_, i) => evaluate(draft(`t${i}`), snap).total);
strengths.sort((a,b)=>a-b);
console.log(`smart-draft strength: p50 ${strengths[N/2|0].toFixed(1)}  p90 ${strengths[N*0.9|0].toFixed(1)}  max ${strengths[N-1].toFixed(1)}`);
const ranked = snap.teams.slice().sort((a,b)=>a.effective_strength-b.effective_strength);
console.log(`field effective_strength: p50 ${ranked[ranked.length/2|0].effective_strength} p85 ${ranked[ranked.length*0.85|0].effective_strength} p95 ${ranked[ranked.length*0.95|0].effective_strength} max ${ranked[ranked.length-1].effective_strength}`);
