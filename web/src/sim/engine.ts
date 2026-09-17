import type { Player, Snapshot, TeamYear } from "./types";
import { hashSeed, mulberry32, shuffle, type Rng } from "./rng";

export const ROUNDS = 5;

/* ------------------------------------------------------------------ rolls */

export interface Roll {
  team: TeamYear;
  options: Player[];
}

/** Five (team, year) rolls. Feasibility is guaranteed by construction: at least
 *  one roll offers an IGL and at least one offers an AWP, so the composition
 *  requirement can always be satisfied. Without this a seed could deal an
 *  unwinnable hand, which reads as a bug rather than a hard draft. */
export function makeRolls(snap: Snapshot, seed: string): Roll[] {
  const rng = mulberry32(hashSeed(seed));
  const has = (t: TeamYear, l: string) =>
    t.roster.some((id) => snap.players[id].labels.includes(l as never));

  const withIgl = snap.teams.filter((t) => has(t, "igl"));
  const withAwp = snap.teams.filter((t) => has(t, "awp"));

  const chosen: TeamYear[] = [];
  const take = (pool: TeamYear[]) => {
    const c = shuffle(rng, pool).find((t) => !chosen.includes(t));
    if (c) chosen.push(c);
  };
  take(withIgl);
  take(withAwp);
  const rest = shuffle(rng, snap.teams);
  for (const t of rest) {
    if (chosen.length >= ROUNDS) break;
    if (!chosen.includes(t)) chosen.push(t);
  }

  return shuffle(rng, chosen).map((team) => ({
    team,
    options: team.roster.map((id) => snap.players[id]),
  }));
}

/* --------------------------------------------------------------- strength */

export interface Breakdown {
  base: number;
  leadership: number;
  chemistry: number;
  compositionPenalty: number;
  total: number;
  notes: string[];
}

const CHEM = [0, 0, 0, 2, 4, 7];   // by size of the largest same-nationality bloc

export function evaluate(roster: Player[], snap: Snapshot): Breakdown {
  const notes: string[] = [];
  const base = roster.reduce((s, p) => s + p.rating, 0) / Math.max(1, roster.length);

  // --- leadership: the IGL's pedigree buffs the OTHER FOUR, never himself
  const igls = roster.filter((p) => p.labels.includes("igl"));
  let leadership = 0;
  if (igls.length === 1) {
    const t = snap.teams.find((x) => x.igl === igls[0].id);
    const b = t ? t.leadership : 0;
    leadership = (b * (roster.length - 1)) / Math.max(1, roster.length);
    if (b > 0) notes.push(`${igls[0].nick} leads: +${b} to each teammate`);
  }

  // --- nationality chemistry: CS is far more language-locked than LoL
  const counts = new Map<string, number>();
  for (const p of roster) counts.set(p.nationality, (counts.get(p.nationality) ?? 0) + 1);
  const bloc = Math.max(0, ...counts.values());
  const chemistry = CHEM[Math.min(bloc, 5)] ?? 0;
  if (chemistry > 0) {
    const nat = [...counts.entries()].find(([, n]) => n === bloc)?.[0];
    notes.push(`${bloc} ${nat} players: +${chemistry} chemistry`);
  }

  // --- composition: this is what stops "pick the highest number every time"
  let compositionPenalty = 0;
  const awps = roster.filter((p) => p.labels.includes("awp"));
  if (roster.length === ROUNDS) {
    if (igls.length === 0) { compositionPenalty += 5; notes.push("no IGL: -5"); }
    if (igls.length > 1) { compositionPenalty += 2; notes.push("two callers: -2"); }
    if (awps.length === 0) { compositionPenalty += 6; notes.push("no AWPer: -6"); }
    if (awps.length > 1) { compositionPenalty += 2; notes.push("two AWPers: -2"); }
  }

  const total = base + leadership + chemistry - compositionPenalty;
  return { base, leadership, chemistry, compositionPenalty, total, notes };
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

  // three opponents drawn from rising bands of the historical field
  const bands: [number, number][] = [[0.35, 0.6], [0.6, 0.85], [0.85, 1.0]];
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
