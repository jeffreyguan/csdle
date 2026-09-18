import fs from "node:fs";
import { makeRolls, evaluate, simulate } from "../src/sim/engine.ts";
import type { Snapshot, Player } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const P = snap.players;
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
// one worked run
const picks = draft("sw-demo", true);
const bd = evaluate(picks, snap);
const res = simulate(bd.total, snap, "sw-demo");
console.log(`your strength ${bd.total.toFixed(1)}\n`);
for (const m of res.matches) {
  const o = m.opponent;
  const men = o.roster.map(i => P[i]);
  const awp = men.find(p=>p.labels.includes("awp"))?.nick ?? "—";
  const igl = men.find(p=>p.labels.includes("igl"))?.nick ?? "—";
  console.log(`${m.stage.padEnd(14)} Bo${m.bo} ${m.won?"W":"L"} ${m.scoreYou}-${m.scoreThem}  vs ${o.effective_strength}  igl=${igl.padEnd(11)} awp=${awp}`);
  console.log(`   ${men.map(p=>`${p.nick} ${p.year}(${p.rating})`).join(", ")}`);
}
console.log(`-> ${res.placement}\n`);

// role sanity + targeting across many runs
let oneAwp=0, oneIgl=0, tot=0; const err:number[]=[]; const lens=new Map<number,number>();
for (let i=0;i<400;i++){
  const r = simulate(61, snap, `sx${i}`);
  lens.set(r.groupWins+r.groupLosses,(lens.get(r.groupWins+r.groupLosses)??0)+1);
  for (const m of r.matches){
    tot++;
    const men=m.opponent.roster.map(x=>P[x]);
    if (men.filter(p=>p.labels.includes("awp")).length===1) oneAwp++;
    if (men.filter(p=>p.labels.includes("igl")).length===1) oneIgl++;
  }
}
console.log(`opponents with exactly 1 AWP: ${(100*oneAwp/tot).toFixed(0)}%   exactly 1 IGL: ${(100*oneIgl/tot).toFixed(0)}%`);
console.log(`swiss length distribution: ${[...lens.entries()].sort().map(([k,v])=>`${k}m:${(100*v/400).toFixed(0)}%`).join("  ")}`);
