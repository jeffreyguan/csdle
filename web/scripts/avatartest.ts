import fs from "node:fs";
import { avatarFor } from "../src/sim/avatar.ts";
import type { Snapshot, Player } from "../src/sim/types.ts";

const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const ps: Player[] = Object.values(snap.players);

const a1 = avatarFor(ps[0].id, ps[0].nick, ps[0].labels);
const a2 = avatarFor(ps[0].id, ps[0].nick, ps[0].labels);
console.log("deterministic:", JSON.stringify(a1) === JSON.stringify(a2));

const keys = new Set(ps.map(p => { const a = avatarFor(p.id, p.nick, p.labels); return `${a.from}|${a.to}|${a.angle}|${a.initials}`; }));
console.log(`distinct avatars: ${keys.size}/${ps.length}`);

const rings = new Map<string, number>();
for (const p of ps) { const a = avatarFor(p.id, p.nick, p.labels); rings.set(a.ring, (rings.get(a.ring) ?? 0) + 1); }
console.log("ring colour by role:", Object.fromEntries(rings));

console.log("awkward nicks render sensibly:");
for (const n of ["s1mple", "910", "b1t", "gla1ve", "ZywOo", "disco doplan", "NBK-"]) {
  const p = ps.find(x => x.nick === n); if (!p) continue;
  const a = avatarFor(p.id, p.nick, p.labels);
  console.log(`   ${n.padEnd(13)} initials="${a.initials}" ring=${a.ring}`);
}
