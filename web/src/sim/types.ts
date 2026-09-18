export type Label = "awp" | "igl" | "anchor" | "rotater";

export interface Player {
  id: string;
  player_id: string;
  nick: string;
  year: number;
  nationality: string;
  rating: number;        // base_rating + team_bonus — what the card shows
  base_rating: number;   // HLTV form alone: shrunk by maps, z-scored per season
  team_bonus: number;    // that side's results that season, added to `rating`
  leads: number;         // if IGL: the bonus he gives EACH of the other four
  team: string;          // the side they played for that season
  kd: number | null;     // kills/deaths vs top-20 opposition
  kd_diff: string;
  top20: number | null;  // HLTV Top 20 Players of the Year placing, if any
  top20_bonus: number;   // 1-4, folded into `rating`
  majors: number;        // Majors won by their side that season
  trophies: number;      // S-Tier titles that season, Majors included
  hltv: number;
  maps: number;
  labels: Label[];
  rating_source: string;
}

export interface TeamYear {
  team: string;
  year: number;
  roster: string[];
  days: number;
  confidence: "high" | "medium" | "low";
  strength: number;
  effective_strength: number;
  igl: string | null;
  leadership: number;
  leadership_raw: number;
  /** true when the side was assembled by the sim rather than played historically */
  custom?: boolean;
}

export interface Snapshot {
  teams: TeamYear[];
  players: Record<string, Player>;
  years: number[];
  source: Record<string, string>;
}
