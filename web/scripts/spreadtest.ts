import fs from "node:fs";
import { simulate } from "../src/sim/engine.ts";
import type { Snapshot } from "../src/sim/types.ts";
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const pad = (s: string | number, n: number) => String(s).padStart(n);
const byRec = new Map<string, number[]>();
const byStage = new Map<string, number[]>();
for (let i = 0; i < 3000; i++) {
  const r = simulate(63, snap, `sp${i}`);
  const n = r.groupWins + r.groupLosses;
  r.matches.forEach((m, k) => {
    const key = k < n ? m.oppRecord : m.stage;
    (byRec.get(key) ?? byRec.set(key, []).get(key)!).push(m.opponent.effective_strength);
    (byStage.get(m.stage) ?? byStage.set(m.stage, []).get(m.stage)!).push(m.opponent.effective_strength);
  });
}
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))];
console.log(pad("pool", 16) + pad("min", 7) + pad("p50", 7) + pad("p90", 7) + pad("max", 7) + pad(">=65", 7) + pad(">=70", 7));
for (const k of ["0-0", "1-0", "2-0", "2-1", "2-2", "Quarter-final", "Semi-final", "Grand Final"]) {
  const v = byRec.get(k) ?? byStage.get(k); if (!v || v.length < 30) continue;
  const pc = (t: number) => `${(100 * v.filter(x => x >= t).length / v.length).toFixed(0)}%`;
  console.log(pad(k, 16) + pad(q(v, 0).toFixed(1), 7) + pad(q(v, .5).toFixed(1), 7)
    + pad(q(v, .9).toFixed(1), 7) + pad(q(v, 1).toFixed(1), 7) + pad(pc(65), 7) + pad(pc(70), 7));
}
