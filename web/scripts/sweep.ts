import fs from "node:fs";
import { makeRolls, evaluate } from "../src/sim/engine.ts";
import { hashSeed, mulberry32 } from "../src/sim/rng.ts";
import type { Snapshot, Player } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));

function draft(seed: string, smart: boolean): Player[] {
  const rolls = makeRolls(snap, seed); const picks: Player[] = [];
  for (const r of rolls) {
    let best = r.options[0], bs = -1e9;
    for (const p of r.options) {
      let s = p.rating;
      if (smart) {
        const hi = picks.some(x=>x.labels.includes("igl")), ha = picks.some(x=>x.labels.includes("awp"));
        if (!hi && p.labels.includes("igl")) s += 14;
        if (!ha && p.labels.includes("awp")) s += 12;
        if (ha && p.labels.includes("awp")) s -= 8;
      }
      if (s > bs) { bs = s; best = p; }
    }
    picks.push(best);
  }
  return picks;
}
const ranked = snap.teams.slice().sort((a,b)=>a.effective_strength-b.effective_strength);
function run(strength: number, seed: string, bands: [number,number][], scale: number) {
  const rng = mulberry32(hashSeed(seed + ":sim"));
  const opps = bands.map(([lo,hi]) => {
    const sl = ranked.slice(Math.floor(lo*ranked.length), Math.max(1, Math.floor(hi*ranked.length)));
    return sl[Math.floor(rng()*sl.length)] ?? ranked[ranked.length-1];
  });
  let wins = 0;
  for (const o of opps) {
    const p = 1/(1+Math.exp(-(strength-o.effective_strength)/scale));
    let y=0,t=0; while (y<2 && t<2) { rng() < p ? y++ : t++; }
    if (y<2) break; wins++;
  }
  return wins === opps.length;
}
const N = 800;
const smart = Array.from({length:N},(_,i)=>evaluate(draft(`t${i}`,true),snap).total);
const greedy = Array.from({length:N},(_,i)=>evaluate(draft(`t${i}`,false),snap).total);

const CONFIGS: [string,[number,number][],number][] = [
  ["A 72-87 / 87-96 / 96-100      ", [[.72,.87],[.87,.96],[.96,1]], 7],
  ["B 75-90 / 90-97 / 97-100      ", [[.75,.90],[.90,.97],[.97,1]], 7],
  ["C 75-90 / 90-97 / 97-100 sc6.5", [[.75,.90],[.90,.97],[.97,1]], 6.5],
  ["D 74-89 / 89-96 / 96-100      ", [[.74,.89],[.89,.96],[.96,1]], 7],
  ["E 76-90 / 90-97 / 97-100 sc6  ", [[.76,.90],[.90,.97],[.97,1]], 6],
];
console.log(`${"config".padEnd(34)}${"smart".padStart(7)}${"greedy".padStart(8)}   gap`);
for (const [name, bands, scale] of CONFIGS) {
  const s = smart.filter((st,i)=>run(st,`t${i}`,bands,scale)).length;
  const g = greedy.filter((st,i)=>run(st,`t${i}`,bands,scale)).length;
  console.log(`${name.padEnd(34)}${(100*s/N).toFixed(1).padStart(6)}%${(100*g/N).toFixed(1).padStart(7)}%   ${g?(s/g).toFixed(2):"-"}x`);
}
