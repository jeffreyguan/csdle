import fs from "node:fs";
import type { Snapshot } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
let bad = 0;
const by = new Map<number, typeof snap.teams>();
for (const t of snap.teams) { const a = by.get(t.year) ?? []; a.push(t); by.set(t.year, a); }
for (const [year, ts] of by) {
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
    const A = new Set(ts[i].roster.map(id => snap.players[id].player_id));
    const B = ts[j].roster.map(id => snap.players[id].player_id);
    const ov = B.filter(p => A.has(p)).length;
    if (ov === 5) { console.log(`FAIL ${year}: ${ts[i].team} and ${ts[j].team} are the same five`); bad++; }
    else if (ov === 4) console.log(`note ${year}: ${ts[i].team} / ${ts[j].team} share 4/5 (distinct lineups, kept)`);
  }
}
console.log(bad ? `FAILING: ${bad} duplicate boards` : "no two boards in a year field the same five");
process.exit(bad ? 1 : 0);
