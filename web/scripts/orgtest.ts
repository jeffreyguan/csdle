import fs from "node:fs";
import { makeRolls } from "../src/sim/engine.ts";
import type { Snapshot } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));

const byOrg = new Map<string, number>();
for (const t of snap.teams) byOrg.set(t.team, (byOrg.get(t.team) ?? 0) + 1);
console.log(`${snap.teams.length} team-years across ${byOrg.size} orgs`);
console.log("orgs with most seasons:",
  [...byOrg.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>`${k}(${v})`).join(", "));

// how often does ONE draft deal the same org twice?
let dupDrafts = 0, tripDrafts = 0;
const N = 500;
const orgFreq = new Map<string, number>();
for (let i = 0; i < N; i++) {
  const orgs = makeRolls(snap, `endless-${i}`).map(r => r.team.team);
  for (const o of orgs) orgFreq.set(o, (orgFreq.get(o) ?? 0) + 1);
  const c = new Map<string, number>();
  for (const o of orgs) c.set(o, (c.get(o) ?? 0) + 1);
  const max = Math.max(...c.values());
  if (max >= 2) dupDrafts++;
  if (max >= 3) tripDrafts++;
}
console.log(`\nover ${N} drafts:`);
console.log(`  drafts containing the SAME ORG twice or more: ${dupDrafts} (${(100*dupDrafts/N).toFixed(0)}%)`);
console.log(`  ... three or more:                            ${tripDrafts} (${(100*tripDrafts/N).toFixed(0)}%)`);
console.log(`\norgs you see most often (of ${N*5} slots):`);
console.log("  " + [...orgFreq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12)
  .map(([k,v])=>`${k} ${(100*v/(N*5)).toFixed(1)}%`).join(", "));
console.log(`  distinct orgs seen: ${orgFreq.size}/${byOrg.size}`);
