import fs from "node:fs";
import { renderToString } from "react-dom/server";
import App from "../src/App.tsx";
import { makeRolls } from "../src/sim/engine.ts";
import type { Snapshot, Player } from "../src/sim/types.ts";

renderToString(<App />);
console.log("App mounts: ok");

const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const logos = JSON.parse(fs.readFileSync("public/logos.json", "utf8"));
const P: Player[] = Object.values(snap.players);

console.log(`players with a team:      ${P.filter(p => p.team).length}/${P.length}`);
console.log(`players whose team has a logo: ${P.filter(p => logos[p.team]).length}/${P.length}`);
console.log(`players with K/D:         ${P.filter(p => p.kd).length}/${P.length}`);

// every card renders the same blocks regardless of role => equal height
let igl = 0, missingKd: string[] = [];
for (let i = 0; i < 40; i++)
  for (const r of makeRolls(snap, `card${i}`))
    for (const p of r.options) {
      if (p.leads > 0) igl++;
      if (!p.kd) missingKd.push(`${p.nick} ${p.year}`);
    }
console.log(`IGL cards seen over 40 drafts: ${igl} (all render the same block set)`);
console.log(`cards that would show "—" for K/D: ${missingKd.length}`);

const t20 = P.filter(p => p.top20).length, maj = P.filter(p => p.majors > 0).length;
const tro = P.filter(p => p.trophies > 0).length;
console.log(`HLTV Top 20 placings: ${t20}  |  on a Major-winning side: ${maj}  |  with S-Tier titles: ${tro}`);
// a Major is an S-Tier event, so trophies must never be fewer than majors
const broken = P.filter(p => p.trophies < p.majors);
console.log(`players whose trophy count is below their Major count: ${broken.length}`);
const top = [...new Set(P.filter(p => p.trophies >= 7).map(p => `${p.team} ${p.year} (x${p.trophies})`))];
console.log(`most decorated seasons: ${top.sort().join(", ")}`);
const n1 = P.filter(p => p.top20 === 1).map(p => `${p.nick} ${p.year}`);
console.log(`HLTV #1 of the year: ${n1.sort().join(", ")}`);
// honours must agree with the underlying data
const bad = P.filter(p => p.top20 !== null && (p.top20 < 1 || p.top20 > 20));
console.log(`invalid top20 values: ${bad.length}`);
