import fs from "node:fs";
import { simulate, shareText } from "../src/sim/engine.ts";
import type { Snapshot } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const scores = new Map<string, number>();
let finals = 0;
for (let i = 0; i < 600; i++) {
  for (const m of simulate(70, snap, `bo${i}`).matches) {
    if (m.stage !== "Grand Final") continue;
    finals++;
    scores.set(`${m.scoreYou}-${m.scoreThem}`, (scores.get(`${m.scoreYou}-${m.scoreThem}`) ?? 0) + 1);
    if (m.maps.length > 5) console.log("!! more than 5 maps:", m.maps.length);
  }
}
console.log(`${finals} grand finals played`);
console.log("scorelines:", Object.fromEntries([...scores.entries()].sort()));
const valid = [...scores.keys()].every(k => { const [a,b]=k.split("-").map(Number); return Math.max(a,b)===3 && a+b<=5; });
console.log("all scorelines are valid Bo5 (winner on 3, max 5 maps):", valid);
for (let i = 0; i < 400; i++) {
  const r = simulate(70, snap, `q${i}`);
  const gf = r.matches.find(m => m.stage === "Grand Final");
  if (gf) { console.log(`\nexample: ${r.placement} — final ${gf.scoreYou}-${gf.scoreThem} (Bo${gf.bo}, ${gf.maps.length} maps)`);
            console.log(shareText(r, "demo")); break; }
}
