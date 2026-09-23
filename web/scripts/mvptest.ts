import fs from "node:fs";
import { makeRolls, evaluate, simulate, ROUNDS } from "../src/sim/engine.ts";
import type { Snapshot, Player } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
let bad = 0;

// 1. a fixed roster: does the MVP share track rating?
const pool = Object.values(snap.players) as Player[];
const pick = (n: string, y: number) => pool.find(p => p.nick === n && p.year === y)!;
const side = [pick("s1mple",2018), pick("donk",2024), pick("coldzera",2016),
              pick("NAF",2022), pick("gla1ve",2018)].filter(Boolean);
const tally = new Map<string, number>();
let wins = 0;
for (let i = 0; i < 60000; i++) {
  const r = simulate(95, snap, `mvp${i}`, side);
  if (!r.champion || !r.mvp) continue;
  wins++; tally.set(r.mvp, (tally.get(r.mvp) ?? 0) + 1);
}
console.log(`MVP share over ${wins} titles with a fixed roster:`);
const rows = side.map(p => ({ p, n: tally.get(p.id) ?? 0 }))
  .sort((a, b) => b.p.rating - a.p.rating);
for (const { p, n } of rows)
  console.log(`   ${p.nick.padEnd(10)} rating ${String(p.rating).padStart(3)}  ${(100*n/wins).toFixed(1)}%`);
// better players must win it more often — strictly, by rating order
for (let i = 1; i < rows.length; i++) {
  if (rows[i].p.rating < rows[i-1].p.rating && rows[i].n > rows[i-1].n) {
    console.log(`FAIL: ${rows[i].p.nick} (${rows[i].p.rating}) beat ${rows[i-1].p.nick} (${rows[i-1].p.rating})`);
    bad++;
  }
}

// 2. MVP is set if and only if you win
let champNoMvp = 0, mvpNoChamp = 0, offRoster = 0, n = 0;
for (let i = 0; i < 4000; i++) {
  const rolls = makeRolls(snap, `f${i}`);
  const picks: Player[] = [];
  for (let r = 0; r < ROUNDS; r++) picks.push(rolls[r].options.reduce((a,b)=>a.rating>b.rating?a:b));
  const res = simulate(evaluate(picks, snap).total, snap, `f${i}`, picks);
  n++;
  if (res.champion && !res.mvp) champNoMvp++;
  if (!res.champion && res.mvp) mvpNoChamp++;
  if (res.mvp && !picks.some(p => p.id === res.mvp)) offRoster++;
}
console.log(`\nchampion without an MVP: ${champNoMvp}   MVP without a title: ${mvpNoChamp}   MVP not on your roster: ${offRoster}`);
if (champNoMvp || mvpNoChamp || offRoster) bad++;

// 3. deterministic for a given seed
const a = simulate(95, snap, "same", side).mvp, b = simulate(95, snap, "same", side).mvp;
console.log(`same seed gives the same MVP: ${a === b}`);
if (a !== b) bad++;

console.log(bad ? `FAILING: ${bad}` : "MVP tracks rating, only on a win, always from your five");
process.exit(bad ? 1 : 0);
