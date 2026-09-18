import type { Player, Snapshot, TeamYear } from "./types";
import { hashSeed, mulberry32, shuffle, type Rng } from "./rng";

export const ROUNDS = 5;
export const REROLLS = 2;

/** Leadership is applied as a percentage uplift to the IGL's four teammates.
 *  IGL_SCALE is the season-bonus value that earns the full LEAD_MAX_MULT. */
export const IGL_SCALE = 12;
export const LEAD_MAX_MULT = 0.18;
/** No caller at all sits at the BOTTOM of the same leadership axis, not in a
 *  separate flat penalty — see 7u. Proportional, so it scales with the roster
 *  exactly like the bonus does. */
export const NO_IGL_MULT = 0.075;

/* ------------------------------------------------------------------ rolls */

export interface Roll {
  team: TeamYear;
  options: Player[];
}

/** Five (team, year) rolls.
 *
 *  Sampling is uniform over TEAM-YEARS, with two guards added after the draft
 *  felt repetitive despite team-years being well distributed:
 *
 *  1. NO REPEATED ORG WITHIN A DRAFT. 223 team-years but only 69 orgs — G2,
 *     Liquid, MOUZ and NaVi have 11 seasons each — so plain sampling dealt the
 *     same org twice in 21% of drafts.
 *  2. NO ORG CARRIED OVER FROM THE PREVIOUS DRAFT (`avoid`, endless mode only).
 *     Back-to-back repeats are the most noticeable kind of sameness. Daily
 *     passes nothing, so it stays a pure function of the seed and remains
 *     server-verifiable for the leaderboard.
 *
 *  Rejected alternatives, both measured:
 *    - Org-uniform sampling flattened the big names but pulled in many more
 *      tier-2 sides, shrinking the gap between a good and a lazy draft from
 *      1.65x to 1.23x. Variety is not worth losing the strategy.
 *    - One roll per era band looked varied but is not needed once orgs are
 *      deduped.
 *
 *  Feasibility is guaranteed: at least one roll offers an IGL and one an AWP.
 */
export function makeRolls(snap: Snapshot, seed: string, avoid: string[] = []): Roll[] {
  const rng = mulberry32(hashSeed(seed));
  const has = (t: TeamYear, l: string) =>
    t.roster.some((id) => snap.players[id].labels.includes(l as never));

  const blocked = new Set<string>(avoid);
  const chosen: TeamYear[] = [];

  const draw = (pool: TeamYear[], relax: boolean) => {
    const ok = pool.filter(
      (t) => !chosen.some((c) => c.team === t.team) && (relax || !blocked.has(t.team))
    );
    return ok.length ? ok[Math.floor(rng() * ok.length)] : null;
  };

  while (chosen.length < ROUNDS) {
    // relax the carry-over ban rather than deal a short draft
    const t = draw(snap.teams, false) ?? draw(snap.teams, true);
    if (!t) break;
    chosen.push(t);
  }

  // repair feasibility without breaking the one-org-per-draft rule
  const ensure = (label: string) => {
    if (chosen.some((t) => has(t, label))) return;
    for (let i = 0; i < chosen.length; i++) {
      const alts = snap.teams.filter(
        (t) =>
          has(t, label) &&
          !chosen.some((c, j) => j !== i && c.team === t.team)
      );
      if (alts.length) { chosen[i] = alts[Math.floor(rng() * alts.length)]; return; }
    }
  };
  ensure("igl");
  ensure("awp");

  return shuffle(rng, chosen).map((team) => ({
    team,
    options: team.roster.map((id) => snap.players[id]),
  }));
}

/** Replace one round's roll. Deterministic in (seed, round, attempt) so a run is
 *  still reproducible from the picks + reroll counts alone — the leaderboard can
 *  re-derive the exact board a player saw.
 *
 *  Rerolls deliberately do NOT preserve the IGL/AWP guarantee: the initial hand
 *  is always playable, but rerolling away your only caller is a real cost the
 *  player chose. The composition penalty prices it. */
export function rerollAt(
  snap: Snapshot,
  seed: string,
  round: number,
  attempt: number,
  inPlay: string[]
): Roll {
  const rng = mulberry32(hashSeed(`${seed}:r${round}:${attempt}`));
  const pool = snap.teams.filter((t) => !inPlay.includes(t.team));
  const team = (pool.length ? pool : snap.teams)[
    Math.floor(rng() * (pool.length ? pool.length : snap.teams.length))
  ];
  return { team, options: team.roster.map((id) => snap.players[id]) };
}

/* --------------------------------------------------------------- strength */

export interface Breakdown {
  base: number;
  leadership: number;
  compositionPenalty: number;
  total: number;
  notes: string[];
}

export function evaluate(roster: Player[], snap: Snapshot): Breakdown {
  const notes: string[] = [];
  const base = roster.reduce((s, p) => s + p.rating, 0) / Math.max(1, roster.length);

  // --- leadership: MULTIPLICATIVE on the other four, never on the IGL himself.
  //
  // A great caller makes good players better through structure, utility and
  // roles — he cannot make bad players good. A flat bonus said otherwise: +9.6
  // team points was a 24% lift on a 40-rated roster but only 12% on an 80-rated
  // one, so the worst rosters gained most and an elite IGL could carry a weak
  // five. Scaling instead means the same PROPORTIONAL lift at every level.
  //
  // Measured: a 48-rated roster with a max IGL goes 57.6 -> 54.9, while a
  // 72-rated one goes 81.6 -> 82.4. The carry case loses 2.7; the top gains 0.8.
  //
  // Two callers is NOT punished. IGLs already rate ~8.5 points below everyone
  // else, so a second one drags the roster mean on its own — that is the whole
  // cost. Previously it also forfeited the leadership bonus entirely (~4.6 team
  // points, nearly triple the explicit -2 penalty it sat next to), which made a
  // second caller cost ~8.3 points for a choice that is merely suboptimal.
  // The better-credentialed caller simply leads.
  //
  // NO caller sits at the BOTTOM of this same axis rather than in a separate
  // flat penalty (7u). A flat -5 was regressive — it cost a 45-rated roster
  // 11.1% and a 75-rated one 6.7%, so the bonus scaled UP with roster quality
  // while its absence scaled DOWN. Now both ends are proportional, and the
  // step from "no caller" to "unproven caller" is a percentage rather than a
  // cliff that happened to carry the entire value of owning an IGL.
  const igls = roster.filter((p) => p.labels.includes("igl"));
  let leadership = 0;
  if (!igls.length) {
    if (roster.length === ROUNDS) {
      leadership = -roster.reduce((s, p) => s + p.rating, 0) * NO_IGL_MULT / roster.length;
      notes.push(`nobody calls: ${Math.round(NO_IGL_MULT * 100)}% off the whole side`);
    }
  } else {
    // whichever caller won the most that season takes the reins — not the
    // longest-serving one
    let leader = igls[0], best = -1;
    for (const g of igls) {
      const b = snap.teams.find((x) => x.igl === g.id)?.leadership ?? 0;
      if (b > best) { best = b; leader = g; }
    }
    const b = Math.max(0, best);
    if (b > 0) {
      const mult = (b / IGL_SCALE) * LEAD_MAX_MULT;
      const others = roster.filter((p) => p.id !== leader.id);
      leadership = others.reduce((s, p) => s + p.rating, 0) * mult / roster.length;
      notes.push(`${leader.nick} leads: +${Math.round(mult * 100)}% to the other four` +
        (igls.length > 1 ? ` (${igls.length} callers — the most decorated one calls)` : ""));
    }
  }

  // --- composition: 2 anchors + 1 AWP + 2 rotaters, plus exactly one IGL.
  //
  // A SOFT penalty, never a hard constraint — you can always field whatever five
  // you drafted, you just pay for an unbalanced side. Forcing the shape would
  // make some boards unplayable and turn a draft into a puzzle with one answer.
  //
  // Positional labels are hand-curated; a player with neither anchor nor rotater
  // is FLEX and fills whichever slot is short, so an unlabelled pool costs the
  // player nothing. Penalties grow as labelling improves.
  let compositionPenalty = 0;
  const awps = roster.filter((p) => p.labels.includes("awp"));
  if (roster.length === ROUNDS) {
    const anchors = roster.filter((p) => p.labels.includes("anchor")).length;
    const rotaters = roster.filter((p) => p.labels.includes("rotater")).length;
    const flex = roster.length - anchors - rotaters;

    // spend flex players on whichever side is short before charging for a gap
    let needA = Math.max(0, 2 - anchors);
    let needR = Math.max(0, 2 - rotaters);
    const spend = Math.min(flex, needA + needR);
    let left = spend;
    const useA = Math.min(needA, left); needA -= useA; left -= useA;
    const useR = Math.min(needR, left); needR -= useR;

    const overA = Math.max(0, anchors - 2);
    const overR = Math.max(0, rotaters - 2);
    const off = needA + needR + overA + overR;
    if (off) {
      compositionPenalty += 2 * off;
      notes.push(
        `${anchors} anchor / ${rotaters} rotater${flex ? ` / ${flex} flex` : ""}` +
        ` vs 2/2: -${2 * off}`
      );
    }

    if (awps.length === 0) { compositionPenalty += 6; notes.push("no AWPer: -6"); }
    if (awps.length > 1) { compositionPenalty += 3; notes.push("two AWPers: -3"); }
  }

  const total = base + leadership - compositionPenalty;
  return { base, leadership, compositionPenalty, total, notes };
}

/* ------------------------------------------------- opponent construction */

/** Build an opponent: five real players, assembled to a target strength with a
 *  coherent side — exactly one AWPer, exactly one IGL, and the 2-anchor /
 *  2-rotater shape the player is asked for, as far as labels allow.
 *
 *  All opponents are built this way now. Real historical lineups were dropped:
 *  there are only 223 of them, they always field the exact five who played, and
 *  fitting them to a strength target meant the same small pool recycled. An
 *  assembled side can hit any target and is identified by its players, not a
 *  name. */
function buildOpponent(
  snap: Snapshot, target: number, rng: Rng, pool: Player[]
): TeamYear {
  const leadOf = (p: Player) =>
    p.labels.includes("igl")
      ? (snap.teams.find((x) => x.igl === p.id)?.leadership ?? 0)
      : 0;
  const effOf = (r: Player[]) => {
    const lead = Math.max(0, ...r.map(leadOf));
    if (!lead) return r.reduce((a, p) => a + p.rating, 0) / 5;
    // same multiplicative rule the player's roster is scored by
    let leader = r[0], best = -1;
    for (const p of r) { const b = leadOf(p); if (b > best) { best = b; leader = p; } }
    const mult = (lead / IGL_SCALE) * LEAD_MAX_MULT;
    const others = r.filter((p) => p.id !== leader.id);
    return (r.reduce((a, p) => a + p.rating, 0)
            + others.reduce((a, p) => a + p.rating, 0) * mult) / 5;
  };

  const near = (xs: Player[], want: number) => {
    let best = xs[0], bd = Infinity;
    for (let k = 0; k < 70; k++) {
      const c = xs[Math.floor(rng() * xs.length)];
      if (!c) continue;
      const d = Math.abs(c.rating - want);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };

  // Keep the side coherent: everyone within a band of the target. Without this
  // the correction pass reaches for extremes to hit the number and produces
  // nonsense like NiKo (77) beside STYKO (40) on one roster.
  const BAND = 11;
  const inBand = (p: Player) => Math.abs(p.rating - target) <= BAND;
  const band = pool.filter(inBand);
  const src = band.length >= 60 ? band : pool;

  // prefer an AWPer who is not also a caller — FalleN and Jame are both, and
  // taking one as the AWP then adding a separate IGL gives a side two callers
  const awpOnly = src.filter((p) => p.labels.includes("awp") && !p.labels.includes("igl"));
  const awps = awpOnly.length >= 10 ? awpOnly : src.filter((p) => p.labels.includes("awp"));
  // exactly one caller: IGLs are excluded from every other bucket below
  const igls = src.filter((p) => p.labels.includes("igl") && !p.labels.includes("awp"));
  const noRole = (p: Player) => !p.labels.includes("awp") && !p.labels.includes("igl");
  const anchors = src.filter((p) => p.labels.includes("anchor") && noRole(p));
  const rotaters = src.filter((p) => p.labels.includes("rotater") && noRole(p));
  const rest = src.filter(noRole);

  // one AWPer and one IGL first — a side without either is not a real team
  const roster: Player[] = [];
  const awp = near(awps.length ? awps : src, target);
  roster.push(awp);
  // only add a caller if the AWPer is not already one
  if (!awp.labels.includes("igl")) {
    const cands = igls.filter((p) => p.player_id !== awp.player_id);
    roster.push(near(cands.length ? cands : src, target - 6));  // callers rate lower
  }

  // then fill toward 2 anchors / 2 rotaters where labels exist, else anyone
  const want = (bucket: Player[]) =>
    bucket.filter((p) => !roster.some((x) => x.player_id === p.player_id));
  for (const bucket of [anchors, rotaters, rest]) {
    while (roster.length < 5) {
      const src = want(bucket.length >= 10 ? bucket : rest);
      if (!src.length) break;
      const aim = (target * 5 - roster.reduce((a, p) => a + p.rating, 0)) / (5 - roster.length);
      roster.push(near(src, aim));
      if (bucket !== rest) break;      // one from each positional bucket, then fill
    }
  }
  while (roster.length < 5) roster.push(near(want(rest).length ? want(rest) : want(pool), target));

  // correct onto the target — leadership varies from 0 to +9.6 team points
  // depending on which caller was drawn, so a fixed offset cannot work
  for (let i = 0; i < 90 && Math.abs(effOf(roster) - target) > 0.4; i++) {
    const gap = effOf(roster) - target;
    const fixed = roster[0].labels.includes("igl") ? 1 : 2;   // AWP (+IGL) are locked
    const idx = fixed + Math.floor(rng() * (5 - fixed));
    const cur = roster[idx];
    const wanted = cur.rating - gap * 5;
    const cands = want(rest).filter(inBand);
    if (!cands.length) break;
    const cand = near(cands, wanted);
    const trial = roster.slice(); trial[idx] = cand;
    if (Math.abs(effOf(trial) - target) < Math.abs(gap)) roster[idx] = cand;
  }

  const lead = Math.max(0, ...roster.map(leadOf));
  const iglP = roster.find((p) => leadOf(p) === lead && lead > 0)
            ?? roster.find((p) => p.labels.includes("igl"));
  const base = roster.reduce((a, p) => a + p.rating, 0) / 5;
  return {
    team: "", year: 0,
    roster: roster.map((p) => p.id),
    days: 0, confidence: "high",
    strength: Math.round(base * 10) / 10,
    effective_strength: Math.round(effOf(roster) * 10) / 10,
    igl: iglP?.id ?? null,
    leadership: lead,
    leadership_raw: 0,
    custom: true,
  } as TeamYear;
}

/* ------------------------------------------------------------------ bracket */

export interface MatchResult {
  stage: string;
  opponent: TeamYear;
  scoreYou: number;
  scoreThem: number;
  won: boolean;
  maps: boolean[];
  bo: 1 | 3 | 5;
  /** the opponent's group-stage record, e.g. "2-0" */
  oppRecord: string;
}

export interface RunResult {
  matches: MatchResult[];
  groupWins: number;
  groupLosses: number;
  advanced: boolean;
  playoffWins: number;
  placement: string;
  champion: boolean;
}

const SCALE = 7;
const winProb = (a: number, b: number) => 1 / (1 + Math.exp(-(a - b) / SCALE));

function series(rng: Rng, a: number, b: number, bo: 1 | 3 | 5) {
  const need = bo === 1 ? 1 : bo === 3 ? 2 : 3;
  const maps: boolean[] = [];
  let you = 0, them = 0;
  const p = winProb(a, b);
  while (you < need && them < need) {
    const w = rng() < p;
    maps.push(w);
    w ? you++ : them++;
  }
  return { you, them, maps, won: you > them };
}

// Swiss: first to 3 wins advances, 3 losses eliminates. Max 5 matches.
const SWISS_WINS = 3;
const SWISS_LOSSES = 3;
// Swiss pairs you against teams on YOUR record, so difficulty tracks the
// win-loss DIFFERENTIAL, not the win count. 2-0 faces other 2-0 sides and is
// stiff; 2-2 faces other 2-2 sides and is not. Scaling by wins alone made those
// two identical, which is why the 2-x matches all felt the same.
//
//   0-0  60.9     1-0  62.4     2-0  63.9
//                 0-1  59.4     2-1  62.4     2-2  60.9
const SWISS_BASE = 60.9;
const SWISS_PER_DIFF = 1.5;    // per (wins - losses)
const PLAYOFFS: { stage: string; target: number; bo: 3 | 5 }[] = [
  { stage: "Quarter-final", target: 66.3, bo: 3 },
  { stage: "Semi-final", target: 68.8, bo: 3 },
  // Bo5 grand final. A longer series cuts variance, so it favours the stronger
  // side — the target is eased slightly to keep the title near 10%.
  { stage: "Grand Final", target: 72.7, bo: 5 },
];
const JITTER = 2.5;
/** Chance a draw is a "stacked" side well above the stage target, and how far
 *  above it can reach. Uniform jitter alone made every pool feel the same width:
 *  the 2-0 pool topped out at 66.5 and could never produce a 70+ opponent, so a
 *  good group run never delivered a genuine scare. Rare, but possible. */
const SPIKE_CHANCE = 0.12;
const SPIKE_MIN = 2.5;
const SPIKE_MAX = 9.0;

/** Quarter-final seeding. A real Major rewards a clean Swiss run: 3-0 teams are
 *  drawn against 3-2 teams, while a 3-2 qualifier meets a 3-0. So the QF target
 *  moves with how many losses you carried out of the group.
 *
 *  The step has to be wide enough that a 3-0 QF is EASIER than that side's own
 *  last Swiss match (63.9) even after the QF base was raised — otherwise going
 *  unbeaten stops being a reward. 66.3 - 3.3 = 63.0 clears it. */
const QF_SEED_STEP = 3.3;

export function simulate(strength: number, snap: Snapshot, seed: string): RunResult {
  const rng = mulberry32(hashSeed(seed + ":sim"));
  const pool = Object.values(snap.players);
  const matches: MatchResult[] = [];
  const jit = (t: number) => {
    if (rng() < SPIKE_CHANCE) return t + SPIKE_MIN + rng() * (SPIKE_MAX - SPIKE_MIN);
    return t + (rng() - 0.5) * 2 * JITTER;
  };

  // ---- Swiss stage
  let w = 0, l = 0;
  while (w < SWISS_WINS && l < SWISS_LOSSES) {
    const target = jit(SWISS_BASE + (w - l) * SWISS_PER_DIFF);
    const opp = buildOpponent(snap, target, rng, pool);
    // the decider is Bo3, as in a real Swiss stage
    const bo: 1 | 3 | 5 = (w === SWISS_WINS - 1 || l === SWISS_LOSSES - 1) ? 3 : 1;
    const r = series(rng, strength, opp.effective_strength, bo);
    // Swiss pairs teams on the same record, so the opponent carries yours
    matches.push({ stage: `Swiss ${w}-${l}`, opponent: opp, scoreYou: r.you,
                   scoreThem: r.them, won: r.won, maps: r.maps, bo,
                   oppRecord: `${w}-${l}` });
    r.won ? w++ : l++;
  }
  const advanced = w >= SWISS_WINS;

  // ---- playoffs
  let playoffWins = 0;
  if (advanced) {
    for (const st of PLAYOFFS) {
      // only the QF is seeded — by the bracket you are drawn into 3-0 meets 3-2,
      // 3-2 meets 3-0. After that the field has levelled out.
      const seed = st.stage === "Quarter-final" ? (l - 1) * QF_SEED_STEP : 0;
      const opp = buildOpponent(snap, jit(st.target + seed), rng, pool);
      const r = series(rng, strength, opp.effective_strength, st.bo);
      // QF is cross-seeded: you qualified 3-L, so you draw a 3-(2-L).
      // Later rounds are whoever survived, so their record is drawn from the
      // qualifying spread rather than mirrored.
      const oppRecord = st.stage === "Quarter-final"
        ? `3-${2 - l}`
        : `3-${Math.floor(rng() * 3)}`;
      matches.push({ stage: st.stage, opponent: opp, scoreYou: r.you,
                     scoreThem: r.them, won: r.won, maps: r.maps, bo: st.bo,
                     oppRecord });
      if (!r.won) break;
      playoffWins++;
    }
  }

  const PLACE = ["Quarter-final", "Semi-final", "Grand Final", "CHAMPION"];
  return {
    matches, groupWins: w, groupLosses: l, advanced, playoffWins,
    placement: advanced ? PLACE[Math.min(playoffWins, 3)] : `Swiss stage (${w}-${l})`,
    champion: playoffWins === 3,
  };
}

export function shareText(res: RunResult, seed: string): string {
  const n = res.groupWins + res.groupLosses;
  const grp = res.matches.slice(0, n).map((m) => (m.won ? "🟩" : "🟥")).join("");
  const po = res.matches.slice(n).map((m) => (m.won ? "🟩" : "🟥")).join("");
  const w = res.matches.filter((m) => m.won).length;
  return `csdle ${seed}\n${grp}${po ? ` | ${po}` : ""}  ${w}-${res.matches.length - w}\n${res.placement}`;
}
