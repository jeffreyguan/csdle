import { avatarFor } from "./sim/avatar";

export function PlayerAvatar({ id, nick, labels, size = 56, logo }:
  { id: string; nick: string; labels: string[]; size?: number; logo?: string }) {
  const a = avatarFor(id, nick, labels);
  const gid = `g${a.seed.toString(36)}`;
  // two deterministic arcs so silhouettes differ beyond just colour
  const a1 = (a.seed % 360) * (Math.PI / 180);
  const a2 = ((a.seed >> 7) % 360) * (Math.PI / 180);

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="avatar" aria-hidden="true">
      <defs>
        <linearGradient id={gid} gradientTransform={`rotate(${a.angle} .5 .5)`}>
          <stop offset="0%" stopColor={a.from} />
          <stop offset="100%" stopColor={a.to} />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#${gid})`} />
      <path d={`M ${50 + 48 * Math.cos(a1)} ${50 + 48 * Math.sin(a1)}
                A 48 48 0 0 1 ${50 + 48 * Math.cos(a2)} ${50 + 48 * Math.sin(a2)}`}
            fill="none" stroke="#ffffff14" strokeWidth="16" />
      <circle cx="50" cy="50" r="46" fill="none" stroke={a.ring} strokeWidth="3" opacity=".9" />
      {logo ? (
        /* the org badge reads faster than initials when one is available */
        <image href={logo} x="20" y="20" width="60" height="60"
               preserveAspectRatio="xMidYMid meet" />
      ) : (
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
              fontSize={a.initials.length > 2 ? 30 : 36} fontWeight="700"
              fill="#fff" opacity=".92" fontFamily="ui-sans-serif, system-ui, sans-serif">
          {a.initials}
        </text>
      )}
      <title>{nick}</title>
    </svg>
  );
}
