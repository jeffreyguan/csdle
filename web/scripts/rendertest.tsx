import fs from "node:fs";
import { renderToString } from "react-dom/server";
import App from "../src/App.tsx";
import { makeRolls, evaluate, simulate, shareText } from "../src/sim/engine.ts";
import type { Snapshot, Player } from "../src/sim/types.ts";

// 1. component mounts without throwing (catches bad JSX / undefined access)
const html = renderToString(<App />);
console.log("renders:", html.includes("loading") ? "ok (boot state)" : "ok");

// 2. the UI calls evaluate() on EVERY render, including with 0..4 picks.
//    An unguarded Math.max()/divide on an empty roster would crash the page.
const snap: Snapshot = JSON.parse(fs.readFileSync("public/snapshot.json", "utf8"));
const rolls = makeRolls(snap, "render-test");
const picks: Player[] = [];
for (let n = 0; n <= 5; n++) {
  const bd = evaluate(picks, snap);
  const bad = [bd.base, bd.total, bd.chemistry, bd.compositionPenalty].some(v => !Number.isFinite(v));
  console.log(`  evaluate(${n} picks): total=${bd.total.toFixed(1)} finite=${!bad}`);
  if (bad) process.exit(1);
  if (n < 5) picks.push(rolls[n].options[0]);
}

// 3. share text + placement across a spread of strengths
for (const s of [30, 50, 70, 90]) {
  const r = simulate(s, snap, `sh-${s}`);
  console.log(`  strength ${s}: ${r.placement.padEnd(13)} ${JSON.stringify(shareText(r, "x").split("\n")[1])}`);
}
console.log("all render paths ok");
