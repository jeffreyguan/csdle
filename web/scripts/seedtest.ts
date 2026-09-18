import fs from "node:fs";
import { simulate } from "../src/sim/engine.ts";
import type { Snapshot } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const pad = (s: string | number, n: number) => String(s).padStart(n);

// does Swiss difficulty follow the RECORD, not just the win count?
const byRec = new Map<string, number[]>();
const qfByQual = new Map<string, number[]>();
for (let i = 0; i < 2500; i++) {
  const r = simulate(62, snap, `seed${i}`);
  const n = r.groupWins + r.groupLosses;
  for (const m of r.matches.slice(0, n)) {
    const k = m.oppRecord;
    (byRec.get(k) ?? byRec.set(k, []).get(k)!).push(m.opponent.effective_strength);
  }
  if (r.advanced) {
    const qf = r.matches[n];
    const k = `3-${r.groupLosses}`;
    if (qf) (qfByQual.get(k) ?? qfByQual.set(k, []).get(k)!).push(qf.opponent.effective_strength);
  }
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log("SWISS — mean opponent strength by your record at the time:");
for (const k of ["0-0", "1-0", "2-0", "0-1", "1-1", "2-1", "1-2", "2-2"]) {
  const v = byRec.get(k); if (!v || v.length < 20) continue;
  console.log(`   ${pad(k, 5)}  ${mean(v).toFixed(1)}   (n=${v.length})`);
}
const g = (k: string) => { const v = byRec.get(k); return v ? mean(v) : NaN; };
console.log(`\n2-0 > 2-1 > 2-2: ${g("2-0") > g("2-1") && g("2-1") > g("2-2")}`);

console.log("\nQUARTER-FINAL — mean opponent strength by how you qualified:");
for (const k of ["3-0", "3-1", "3-2"]) {
  const v = qfByQual.get(k); if (!v) continue;
  console.log(`   qualified ${k}  ->  ${mean(v).toFixed(1)}   (n=${v.length})`);
}
const q = (k: string) => { const v = qfByQual.get(k); return v ? mean(v) : NaN; };
console.log(`\na clean 3-0 earns an easier QF than a 3-2: ${q("3-0") < q("3-2")}`);
