export type Label = "awp" | "igl" | "star" | "anchor";

export interface Player {
  id: string;
  player_id: string;
  nick: string;
  year: number;
  nationality: string;
  rating: number;
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
}

export interface Snapshot {
  teams: TeamYear[];
  players: Record<string, Player>;
  years: number[];
  source: Record<string, string>;
}
