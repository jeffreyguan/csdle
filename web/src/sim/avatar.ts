/** Deterministic generated avatars.
 *
 *  Real player photos are NOT usable: every Liquipedia player image is
 *  license=permission, copyright held by the tournament organiser (ESL, BLAST,
 *  PGL, StarLadder, DreamHack). That permission is granted to Liquipedia, not
 *  onward — self-hosting or hotlinking them would be redistributing press
 *  photography without a licence.
 *
 *  So: derive a stable, distinctive mark from the player id instead. Same
 *  player always renders the same avatar; the ring encodes their role. */

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// ring = the player's role at a glance. `flex` is an unlabelled position, not a
// role — positional labels are hand-curated and deliberately partial.
const ROLE_RING: Record<string, string> = {
  awp: "#a371f7", igl: "#58a6ff", rotater: "#f0883e", anchor: "#3fb950", flex: "#6e7681",
};

export interface Avatar {
  initials: string;
  from: string;
  to: string;
  ring: string;
  angle: number;
  seed: number;
}

export function avatarFor(id: string, nick: string, labels: string[]): Avatar {
  const h = hash(id);
  const hue = h % 360;
  const hue2 = (hue + 40 + (h >> 9) % 60) % 360;
  const role = ["awp", "igl", "rotater", "anchor"].find((r) => labels.includes(r)) ?? "flex";

  // strip leading non-letters so "910" and "b1t" still read sensibly
  const letters = nick.replace(/[^A-Za-z0-9]/g, "");
  const initials = (letters.slice(0, 2) || nick.slice(0, 2)).toUpperCase();

  return {
    initials,
    from: `hsl(${hue} 42% 32%)`,
    to: `hsl(${hue2} 46% 18%)`,
    ring: ROLE_RING[role],
    angle: (h >> 3) % 360,
    seed: h,
  };
}
