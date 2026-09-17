import type { Player, Snapshot, TeamYear } from "./types";
import { hashSeed, mulberry32, shuffle, type Rng } from "./rng";

export const ROUNDS = 5;
export const REROLLS = 2;

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

  // --- leadership: the IGL's pedigree buffs the OTHER FOUR, never himself.
  //
  // Two callers is NOT punished. IGLs already rate ~8.5 points below everyone
  // else, so a second one drags the roster mean on its own — that is the whole
  // cost. Previously it also forfeited the leadership bonus entirely (~4.6 team
  // points, nearly triple the explicit -2 penalty it sat next to), which made a
  // second caller cost ~8.3 points for a choice that is merely suboptimal.
  // The better-credentialed caller simply leads.
  const igls = roster.filter((p) => p.labels.includes("igl"));
  let leadership = 0;
  if (igls.length) {
    let bestNick = "", best = -1;
    for (const g of igls) {
      const t = snap.teams.find((x) => x.igl === g.id);
      const b = t ? t.leadership : 0;
      if (b > best) { best = b; bestNick = g.nick; }
    }
    const b = Math.max(0, best);
    leadership = (b * (roster.length - 1)) / Math.max(1, roster.length);
    if (b > 0) {
      notes.push(`${bestNick} leads: +${b} to each teammate` +
        (igls.length > 1 ? ` (${igls.length} callers — the senior one calls)` : ""));
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

    if (igls.length === 0) { compositionPenalty += 5; notes.push("no IGL: -5"); }
    if (awps.length === 0) { compositionPenalty += 6; notes.push("no AWPer: -6"); }
    if (awps.length > 1) { compositionPenalty += 3; notes.push("two AWPers: -3"); }
  }

  const total = base + leadership - compositionPenalty;
  return { base, leadership, compositionPenalty, total, notes };
}

/* ------------------------------------------------------------------ bracket */

export interface MatchResult {
  opponent: TeamYear;
  scoreYou: number;
  scoreThem: number;
  won: boolean;
  maps: boolean[];
}

export interface RunResult {
  matches: MatchResult[];
  wins: number;
  placement: string;
  champion: boolean;
}

const SCALE = 7;  // logistic width, in rating points, for a single map
const winProb = (a: number, b: number) => 1 / (1 + Math.exp(-(a - b) / SCALE));

function bo3(rng: Rng, a: number, b: number) {
  const maps: boolean[] = [];
  let you = 0, them = 0;
  const p = winProb(a, b);
  while (you < 2 && them < 2) {
    const w = rng() < p;
    maps.push(w);
    w ? you++ : them++;
  }
  return { you, them, maps, won: you > them };
}

const PLACE = ["Groups", "Quarter-final", "Semi-final", "Final", "CHAMPION"];

/** Seeded 8-team bracket. Opponents are real historical team-years spread across
 *  the strength range so the run escalates rather than being flat. */
export function simulate(strength: number, snap: Snapshot, seed: string): RunResult {
  const rng = mulberry32(hashSeed(seed + ":sim"));
  const ranked = snap.teams.slice().sort((a, b) => a.effective_strength - b.effective_strength);

  // Three opponents from rising bands of the historical field. Swept to a ~10%
  // championship rate for good play (9.5% measured, greedy 4.8%, so a 2.0x skill
  // gap). A harder field WIDENS that gap — weak rosters stop sneaking through on
  // variance — so difficulty and skill-expression move together here.
  const bands: [number, number][] = [[0.75, 0.90], [0.90, 0.97], [0.97, 1.0]];
  const opponents = bands.map(([lo, hi]) => {
    const slice = ranked.slice(Math.floor(lo * ranked.length), Math.max(1, Math.floor(hi * ranked.length)));
    return slice[Math.floor(rng() * slice.length)] ?? ranked[ranked.length - 1];
  });

  const matches: MatchResult[] = [];
  let wins = 0;
  for (const opp of opponents) {
    const r = bo3(rng, strength, opp.effective_strength);
    matches.push({ opponent: opp, scoreYou: r.you, scoreThem: r.them, won: r.won, maps: r.maps });
    if (!r.won) break;
    wins++;
  }
  return {
    matches,
    wins,
    placement: PLACE[Math.min(wins + 1, 4)],
    champion: wins === opponents.length,
  };
}

export function shareText(res: RunResult, seed: string): string {
  const line = res.matches.map((m) => (m.won ? "🟩" : "🟥")).join("");
  return `csdle ${seed}\n${line} ${res.wins}-${res.matches.length - res.wins}\n${res.placement}`;
}
