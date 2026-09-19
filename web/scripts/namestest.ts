import fs from "node:fs";
import { makeRolls, evaluate, simulate } from "../src/sim/engine.ts";
import type { Snapshot, Player } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const src = fs.readFileSync("src/App.tsx", "utf8");

let bad = 0;
if (/\.slice\(0, *3\)\}…/.test(src)) { console.log("FAIL: hardcoded ellipsis still in match row"); bad++; }

// every opponent must expose five resolvable nicks, and the string must be a
// plausible width for the ~750px track
let worst = 0, worstS = "";
for (let i = 0; i < 300; i++) {
  const picks: Player[] = makeRolls(snap, `n${i}`).map(r => r.options[0]);
  const res = simulate(evaluate(picks, snap).total, snap, `n${i}`);
  for (const m of res.matches) {
    const nicks = m.opponent.roster
      .map(id => { const q = snap.players[id]; return q && `${q.nick} ('${String(q.year).slice(2)})`; })
      .filter(Boolean) as string[];
    if (nicks.length !== 5) { console.log(`FAIL: ${nicks.length} nicks resolved`); bad++; }
    const s = nicks.join(", ");
    if (s.length > worst) { worst = s.length; worstS = s; }
  }
}
const px = Math.round(worst * 7.0);   // 13px sans, ~7px average advance
console.log(`longest roster string: ${worst} chars (~${px}px) of a ~750px track`);
console.log(`  ${worstS}`);
console.log(px < 700 ? `fits without ellipsis (${700 - px}px headroom)` : "FAIL: would clip");
if (px >= 700) bad++;
console.log(bad ? `FAILING: ${bad}` : "all five names render");
process.exit(bad ? 1 : 0);
