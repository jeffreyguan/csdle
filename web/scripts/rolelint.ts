/** A team must never field two AWPers — that is a labelling error, and unlike a
 *  doubled IGL it also mis-prices the composition penalty. */
import fs from "node:fs";
import type { Snapshot } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const P = snap.players;

const count = (t: typeof snap.teams[0], l: string) =>
  t.roster.filter(i => P[i].labels.includes(l as never)).length;

const twoAwp = snap.teams.filter(t => count(t, "awp") > 1);
const twoIgl = snap.teams.filter(t => count(t, "igl") > 1);
console.log(`team-years with >1 AWPer: ${twoAwp.length}`);
twoAwp.forEach(t => console.log(`   ${t.year} ${t.team}: `
  + t.roster.filter(i => P[i].labels.includes("awp" as never)).map(i => P[i].nick).join(", ")));

// Doubled IGLs are tolerated: a player-year on two teams is ONE shared object, so
// a team-scoped label leaks to the other side (AdreN 2019 called for FaZe, not
// AVANGAR). The engine already resolves it — only the most decorated caller's
// bonus applies — so this is cosmetic, not a scoring fault.
console.log(`team-years with >1 IGL: ${twoIgl.length} `);
twoIgl.forEach(t => console.log(`   ${t.year} ${t.team}: `
  + t.roster.filter(i => P[i].labels.includes("igl" as never)).map(i => P[i].nick).join(", ")));

if (twoAwp.length) { console.log("FAIL: duplicate AWPers"); process.exit(1); }
console.log("no team fields two AWPers");
