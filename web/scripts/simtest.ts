import fs from "node:fs";
import { makeRolls, evaluate, simulate } from "../src/sim/engine.ts";
import type { Snapshot, Player } from "../src/sim/types.ts";

const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
console.log(`snapshot: ${snap.teams.length} team-years, ${Object.keys(snap.players).length} players`);

// determinism
const a = makeRolls(snap, "2026-09-17").map(r => `${r.team.team} ${r.team.year}`);
const b = makeRolls(snap, "2026-09-17").map(r => `${r.team.team} ${r.team.year}`);
console.log("deterministic:", JSON.stringify(a) === JSON.stringify(b));
console.log("today's rolls:", a.join(" | "));

// feasibility across many seeds
let noIgl = 0, noAwp = 0;
for (let i = 0; i < 500; i++) {
  const rolls = makeRolls(snap, `s${i}`);
  const igl = rolls.some(r => r.options.some(p => p.labels.includes("igl")));
  const awp = rolls.some(r => r.options.some(p => p.labels.includes("awp")));
  if (!igl) noIgl++; if (!awp) noAwp++;
}
console.log(`feasibility over 500 seeds: missing IGL ${noIgl}, missing AWP ${noAwp}`);

// strategy comparison: greedy-by-rating vs constraint-aware
function draft(seed: string, smart: boolean): Player[] {
  const rolls = makeRolls(snap, seed);
  const picks: Player[] = [];
  for (const r of rolls) {
    let best = r.options[0], bs = -1e9;
    for (const p of r.options) {
      let s = p.rating;
      if (smart) {
        const haveIgl = picks.some(x => x.labels.includes("igl"));
        const haveAwp = picks.some(x => x.labels.includes("awp"));
        if (!haveIgl && p.labels.includes("igl")) s += 14;
        if (!haveAwp && p.labels.includes("awp")) s += 12;
        if (haveIgl && p.labels.includes("igl")) s -= 6;
        const nat = picks.filter(x => x.nationality === p.nationality).length;
        s += nat * 2;
      }
      if (s > bs) { bs = s; best = p; }
    }
    picks.push(best);
  }
  return picks;
}

let gTot = 0, sTot = 0, gWin = 0, sWin = 0;
const N = 400;
for (let i = 0; i < N; i++) {
  const seed = `t${i}`;
  const g = evaluate(draft(seed, false), snap);
  const s = evaluate(draft(seed, true), snap);
  gTot += g.total; sTot += s.total;
  if (simulate(g.total, snap, seed).champion) gWin++;
  if (simulate(s.total, snap, seed).champion) sWin++;
}
console.log(`\ngreedy-by-rating : avg strength ${(gTot/N).toFixed(1)}, championships ${gWin}/${N} (${(100*gWin/N).toFixed(0)}%)`);
console.log(`constraint-aware : avg strength ${(sTot/N).toFixed(1)}, championships ${sWin}/${N} (${(100*sWin/N).toFixed(0)}%)`);

// a worked example
const picks = draft("2026-09-17", true);
const bd = evaluate(picks, snap);
console.log(`\nexample roster: ${picks.map(p=>`${p.nick}(${p.year},${p.rating})`).join(", ")}`);
console.log(`  base ${bd.base.toFixed(1)} | leadership +${bd.leadership.toFixed(1)} | chem +${bd.chemistry} | comp -${bd.compositionPenalty} => ${bd.total.toFixed(1)}`);
bd.notes.forEach(n => console.log("   ·", n));
const res = simulate(bd.total, snap, "2026-09-17");
console.log(`  run: ${res.placement} (${res.wins} wins)`);
res.matches.forEach(m => console.log(`    ${m.won?"W":"L"} ${m.scoreYou}-${m.scoreThem} vs ${m.opponent.team} ${m.opponent.year} (${m.opponent.effective_strength})`));
