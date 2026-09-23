import { useEffect, useMemo, useState } from "react";
import type { Player, Snapshot } from "./sim/types";
import { makeRolls, rerollAt, evaluate, simulate, shareText, ROUNDS, REROLLS,
  type RunResult, type Roll } from "./sim/engine";
import { todayKey } from "./sim/rng";
import { flag } from "./sim/flags";
import { PlayerAvatar } from "./Avatar";
import "./App.css";

type Mode = "daily" | "endless";

/** Position tags, rendered identically wherever a player appears.
 *
 *  An AWPer is NEVER flex. The shape is 2 anchors + 1 AWP + 2 rotaters, so the
 *  AWP holds his own slot and is not spent covering an anchor or rotater gap —
 *  the engine excludes him from the flex pool, and the card must say the same.
 *
 *  Shared because the option card and the filled slot had already drifted: the
 *  option card showed `flex`, the slot showed nothing. One renderer, one truth. */
function Tags({ p }: { p: Player }) {
  const positioned = p.labels.some((l) => l === "anchor" || l === "rotater" || l === "awp");
  return (
    <div className="c-tags">
      {p.labels.map((l) => <span key={l} className={`tag t-${l}`}>{l}</span>)}
      {!positioned && (
        <span className="tag t-flex" title="position not yet labelled — fills whichever slot is short">flex</span>
      )}
    </div>
  );
}

export default function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [mode, setMode] = useState<Mode>("daily");
  // Start endless somewhere random. With a fixed 0 every page load — and every
  // HMR reload in dev — dealt the SAME first board (Astralis 2022 / fnatic 2018 /
  // Falcons 2024 / Vitality 2021 / HellRaisers 2015), which reads as "I keep
  // getting the same teams". Daily is unaffected: its seed is the date, and it is
  // the only mode that has to be reproducible.
  const [nonce, setNonce] = useState(() => Math.floor(Math.random() * 1e6));
  const [picks, setPicks] = useState<Player[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [rerolls, setRerolls] = useState<Record<number, number>>({});
  const [logos, setLogos] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(0);   // matches shown so far

  useEffect(() => {
    fetch("/snapshot.json").then((r) => r.json()).then(setSnap);
    fetch("/logos.json").then((r) => r.json()).then(setLogos).catch(() => {});
  }, []);

  const seed = mode === "daily" ? todayKey() : `endless-${nonce}`;
  // endless only: don't deal an org that appeared in the previous draft.
  // Recomputed from the previous seed rather than remembered, so it stays a pure
  // function of (seed) — no hidden state for the leaderboard to disagree with.
  const prevOrgs = useMemo(
    () => (snap && mode === "endless"
      ? makeRolls(snap, `endless-${nonce - 1}`).map((r) => r.team.team)
      : []),
    [snap, mode, nonce]
  );
  const baseRolls = useMemo(
    () => (snap ? makeRolls(snap, seed, prevOrgs) : []),
    [snap, seed, prevOrgs]
  );
  const rolls: Roll[] = useMemo(() => {
    if (!snap) return [];
    return baseRolls.map((r, i) => {
      const n = rerolls[i] ?? 0;
      if (!n) return r;
      // exclude the exact team-years on the board — another SEASON of the same
      // org is a legitimate reroll result (2026-09-19)
      const inPlay = baseRolls.map((x) => `${x.team.team}:${x.team.year}`);
      return rerollAt(snap, seed, i, n, inPlay);
    });
  }, [snap, baseRolls, rerolls, seed, picks]);

  const reset = () => {
    setPicks([]); setResult(null); setCopied(false); setRerolls({}); setRevealed(0);
  };
  useEffect(reset, [seed]);

  if (!snap) return <div className="boot">loading 11 seasons…</div>;

  const round = picks.length;
  const done = round >= ROUNDS;
  const roll = rolls[round];
  const bd = evaluate(picks, snap);

  const rerollsUsed = Object.values(rerolls).reduce((a, b) => a + b, 0);
  const rerollsLeft = REROLLS - rerollsUsed;
  const hasIgl = picks.filter((p) => p.labels.includes("igl")).length;
  const hasAwp = picks.filter((p) => p.labels.includes("awp")).length;

  const run = () => {
    const b = evaluate(picks, snap);
    setResult(simulate(b.total, snap, seed, picks));
    setRevealed(0);
  };

  return (
    <div className="app">
      <header>
        <h1>csdle<span className="sub">mayhem</span></h1>
        <div className="modes">
          <button className={mode === "daily" ? "on" : ""} onClick={() => setMode("daily")}>Daily</button>
          <button className={mode === "endless" ? "on" : ""} onClick={() => setMode("endless")}>Endless</button>
          {/* always rendered, disabled in daily — conditionally mounting it made
              the whole right-aligned group shift when switching modes */}
          <button
            className="mode-new"
            disabled={mode !== "endless"}
            title={mode === "endless" ? "Deal a new board" : "Endless mode only — the daily board is fixed"}
            onClick={() => setNonce((n) => n + 1)}
          >↻ New</button>
        </div>
        <code className="seed">{seed}</code>
      </header>

      <div className="slots">
        {Array.from({ length: ROUNDS }).map((_, i) => {
          const p = picks[i];
          return (
            <div key={i} className={`slot ${p ? "filled" : i === round ? "active" : ""}`}>
              {p ? (
                <>
                  {logos[p.team] && (
                    <img className="c-watermark" src={`/logos/${logos[p.team]}`} alt="" />
                  )}
                  <div className="c-honours">
                    {p.trophies > 0 && (
                      <span className={`hon maj ${p.majors > 0 ? "major" : ""}`}
                            title={`${p.trophies} S-Tier title${p.trophies > 1 ? "s" : ""} this season`
                                   + (p.majors ? ` — ${p.majors} of them a Major` : "")}>
                        🏆<b>×{p.trophies}</b>
                      </span>
                    )}
                    {p.top20 && (
                      <span className={`hon t20 ${p.top20 <= 3 ? "elite" : ""}`}
                            title={`HLTV Top 20 Players of ${p.year}: #${p.top20}`}>
                        HLTV <b>#{p.top20}</b>
                      </span>
                    )}
                  </div>
                  <div className="c-head">
                    <PlayerAvatar id={p.id} nick={p.nick} labels={p.labels} size={40}
                                  logo={logos[p.team] ? `/logos/${logos[p.team]}` : undefined} />
                    <div className="c-id">
                      <div className="c-nick">{p.nick}</div>
                      <div className="c-sub">{flag(p.nationality)} {p.team} {p.year}</div>
                    </div>
                  </div>
                  <div className="c-ratingbox">
                    <div className="c-rating">
                      {p.rating}
                      {p.team_bonus + p.top20_bonus > 0 && (
                        <sup className="c-bonus">+{p.team_bonus + p.top20_bonus}</sup>
                      )}
                    </div>
                    <div className="c-meter"><span style={{ width: `${p.rating}%` }} /></div>
                  </div>
                  <div className="c-stats">
                    <div><b>{p.hltv.toFixed(2)}</b><span>HLTV</span></div>
                    <div><b>{p.kd ? p.kd.toFixed(2) : "—"}</b><span>K/D</span></div>
                    <div><b>{p.maps}</b><span>maps</span></div>
                  </div>
                  <Tags p={p} />
                  <div className={`c-leads ${p.leads > 0 ? "on" : ""}`}>
                    {p.leads > 0 ? `leads · +${Math.round((p.leads / 12) * 18)}%` : ""}
                  </div>
                </>
              ) : <div className="s-empty">{i + 1}</div>}
            </div>
          );
        })}
      </div>

      <div className="reqs">
        <span className={hasIgl === 1 ? "ok" : "bad"}>IGL {hasIgl}/1</span>
        <span className={hasAwp >= 1 ? "ok" : "bad"}>AWP {hasAwp}/1+</span>
        {picks.length > 0 && <span className="strength">strength {bd.total.toFixed(1)}</span>}
      </div>

      {!done && roll && (
        <section className="roll">
          <div className="roll-head">
            {/* slot is always rendered, logo or not — a conditional <img> changed
                the child order and shifted everything to its right */}
            <div className="org-logo">
              {logos[roll.team.team] && (
                <img src={`/logos/${logos[roll.team.team]}`} alt="" />
              )}
            </div>
            <div className="roll-main">
              <span className="r-label">Round {round + 1} of {ROUNDS} — you rolled</span>
              <h2>{roll.team.team} <em>{roll.team.year}</em></h2>
            </div>
            <div className="roll-right">
              <div className={`conf c-${roll.team.confidence}`}>lineup held {roll.team.days}d</div>
              <button
                className="reroll"
                disabled={rerollsLeft <= 0}
                onClick={() => setRerolls({ ...rerolls, [round]: (rerolls[round] ?? 0) + 1 })}
                title={rerollsLeft > 0 ? "Swap this team for another" : "No rerolls left"}
              >
                ↻ Reroll <span>{rerollsLeft}</span>
              </button>
            </div>
          </div>
          <div className="options">
            {roll.options.map((p) => {
              const logo = logos[p.team];
              return (
              <button key={p.id} className="card" onClick={() => setPicks([...picks, p])}>
                {logo && <img className="c-watermark" src={`/logos/${logo}`} alt="" />}

                {/* always rendered so the row reserves the same height on every
                    card — a conditional badge left unhonoured cards sitting higher */}
                <div className="c-honours">
                  {p.trophies > 0 && (
                    <span className={`hon maj ${p.majors > 0 ? "major" : ""}`}
                          title={`${p.trophies} S-Tier title${p.trophies > 1 ? "s" : ""} this season`
                                 + (p.majors ? ` — ${p.majors} of them a Major` : "")}>
                      🏆<b>×{p.trophies}</b>
                    </span>
                  )}
                  {p.top20 && (
                    <span className={`hon t20 ${p.top20 <= 3 ? "elite" : ""}`}
                          title={`HLTV Top 20 Players of ${p.year}: #${p.top20}`}>
                      HLTV <b>#{p.top20}</b>
                    </span>
                  )}
                </div>

                <div className="c-head">
                  <PlayerAvatar id={p.id} nick={p.nick} labels={p.labels}
                                size={40} logo={logo ? `/logos/${logo}` : undefined} />
                  <div className="c-id">
                    <div className="c-nick">{p.nick}</div>
                    <div className="c-sub">{flag(p.nationality)} {p.team} {p.year}</div>
                  </div>
                </div>

                <div className="c-ratingbox">
                  <div className="c-rating">
                    {p.rating}
                    {p.team_bonus + p.top20_bonus > 0 && (
                      <sup className="c-bonus"
                           title={`${p.base_rating} form`
                                  + (p.team_bonus ? ` + ${p.team_bonus} season results` : "")
                                  + (p.top20_bonus ? ` + ${p.top20_bonus} HLTV #${p.top20}` : "")}>
                        +{p.team_bonus + p.top20_bonus}
                      </sup>
                    )}
                  </div>
                  <div className="c-meter"><span style={{ width: `${p.rating}%` }} /></div>
                </div>

                <div className="c-stats">
                  <div><b>{p.hltv.toFixed(2)}</b><span>HLTV</span></div>
                  <div><b>{p.kd ? p.kd.toFixed(2) : "—"}</b><span>K/D</span></div>
                  <div><b>{p.maps}</b><span>maps</span></div>
                </div>

                <Tags p={p} />

                {/* always rendered so every card is the same height; only the
                    IGL's carries text. A conditional badge made IGL cards taller
                    and the rest vertically centred against them. */}
                <div className={`c-leads ${p.leads > 0 ? "on" : ""}`}>
                  {p.leads > 0 ? `leads · +${Math.round((p.leads / 12) * 18)}% to teammates` : ""}
                </div>
              </button>
            );})}
          </div>
        </section>
      )}

      {done && !result && (
        <section className="ready">
          <h2>Roster complete</h2>
          <ul className="bd">
            <li><span>Average rating</span><b>{bd.base.toFixed(1)}</b></li>
            {bd.leadership !== 0 && <li><span>{bd.leadership < 0 ? "No caller" : "IGL leadership"}</span><b className={bd.leadership < 0 ? "neg" : "pos"}>{bd.leadership < 0 ? "−" : "+"}{Math.abs(bd.leadership).toFixed(1)}</b></li>}
            {bd.compositionPenalty > 0 && <li><span>Composition</span><b className="neg">−{bd.compositionPenalty}</b></li>}
            <li className="tot"><span>Team strength</span><b>{bd.total.toFixed(1)}</b></li>
          </ul>
          {bd.notes.length > 0 && <div className="notes">{bd.notes.map((n, i) => <div key={i}>· {n}</div>)}</div>}
          <button className="go" onClick={run}>Simulate the run →</button>
          <button className="ghost" onClick={reset}>Change picks</button>
          {mode === "endless" && (
            <button className="ghost" onClick={() => setNonce((n) => n + 1)}>↻ New teams</button>
          )}
        </section>
      )}

      {result && (
        <section className="result">
          {(() => {
            const shown = result.matches.slice(0, revealed);
            const next = result.matches[revealed];
            const done = revealed >= result.matches.length;
            return (
              <>
                <h2 className={done && result.champion ? "champ" : ""}>
                  {done ? result.placement : next.stage}
                </h2>
                {/* reserved unconditionally: a row that appears only on a win
                    would shift the whole results panel (the conditional-mount
                    bug from 7u/7v). Empty when there is no MVP. */}
                <div className="mvp-row">
                  {done && result.champion && result.mvp && snap.players[result.mvp] && (
                    <>
                      <span className="mvp-tag">MVP</span>
                      <PlayerAvatar
                        player={snap.players[result.mvp]}
                        size={26}
                        logo={logos[snap.players[result.mvp].team]
                          ? `/logos/${logos[snap.players[result.mvp].team]}` : undefined}
                      />
                      <b>{snap.players[result.mvp].nick}</b>
                      <span className="mvp-yr">
                        {snap.players[result.mvp].year} · {snap.players[result.mvp].team}
                      </span>
                    </>
                  )}
                </div>

                <div className="matches">
                  {shown.map((m, i) => (
                    <div key={i} className={`match ${m.won ? "w" : "l"}`}>
                      <span className="m-round">{m.stage}</span>
                      <span className="m-opp">
                        <b className="m-rating">{m.opponent.effective_strength.toFixed(1)}</b>
                        {m.oppRecord && <span className="m-rec">{m.oppRecord}</span>}
                        <span className="m-names">
                          {m.opponent.roster
                            .map((id) => {
                              const q = snap.players[id];
                              return q && `${q.nick} ('${String(q.year).slice(2)})`;
                            })
                            .filter(Boolean).join(", ")}
                        </span>
                      </span>
                      <span className="m-score">{m.scoreYou}–{m.scoreThem}</span>
                    </div>
                  ))}
                </div>

                {!done && (
                  <div className="upnext">
                    <div className="u-label">
                      Up next — {next.stage} · Bo{next.bo}
                      {next.oppRecord && <> · they went <b>{next.oppRecord}</b> in the group stage</>}
                    </div>
                    <div className="u-team">
                      <span>Your opponent</span>
                    </div>
                    {(() => {
                      const o = next.opponent;
                      const men = o.roster.map((id) => snap.players[id]).filter(Boolean);
                      const oIgl = men.find((p) => p.id === o.igl)
                        ?? men.find((p) => p.labels.includes("igl"));
                      const oAwp = men.find((p) => p.labels.includes("awp"));
                      const mine = evaluate(picks, snap);
                      const myIgl = picks.find((p) => p.labels.includes("igl"));
                      const myAwp = picks.find((p) => p.labels.includes("awp"));
                      return (
                        <>
                          <div className="vs">
                            <div className="vs-side">
                              <div className="vs-name">Your five</div>
                              <div className="vs-rating">{mine.total.toFixed(1)}</div>
                              <div className="vs-row">IGL <b>{myIgl?.nick ?? "—"}</b></div>
                              <div className="vs-row">AWP <b>{myAwp?.nick ?? "—"}</b></div>
                              {mine.leadership !== 0 && (
                                <div className="vs-row dim">{mine.leadership < 0
                                  ? `no caller \u2212${Math.abs(mine.leadership).toFixed(1)}`
                                  : `leadership +${mine.leadership.toFixed(1)}`}</div>
                              )}
                            </div>
                            <div className="vs-mid">vs</div>
                            <div className="vs-side">
                              <div className="vs-name">Opponent</div>
                              <div className="vs-rating">{o.effective_strength.toFixed(1)}</div>
                              <div className="vs-row">IGL <b>{oIgl?.nick ?? "—"}</b></div>
                              <div className="vs-row">AWP <b>{oAwp?.nick ?? "—"}</b></div>
                              {o.leadership > 0 && (
                                <div className="vs-row dim">leadership +{Math.round((o.leadership / 12) * 18)}%</div>
                              )}
                            </div>
                          </div>
                          <div className="u-roster">
                            {men.map((op) => (
                              <div key={op.id} className="u-player">
                                <PlayerAvatar id={op.id} nick={op.nick} labels={op.labels} size={30}
                                              logo={logos[op.team] ? `/logos/${logos[op.team]}` : undefined} />
                                <div className="u-nick">{op.nick}</div>
                                <div className="u-yr">{op.year} · {op.rating}</div>
                                <div className="u-tags">
                                  {op.labels.filter((l) => l === "awp" || l === "igl")
                                    .map((l) => <span key={l} className={`tag t-${l}`}>{l}</span>)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                    <button className="go" onClick={() => setRevealed(revealed + 1)}>
                      Play the match →
                    </button>
                  </div>
                )}

                {done && (
                  <>
                    {!result.advanced && (
                      <p className="eliminated">
                        Eliminated in the group stage — {result.groupWins} win
                        {result.groupWins === 1 ? "" : "s"} from 3, two needed to advance.
                      </p>
                    )}
                    <pre className="share">{shareText(result, seed, snap)}</pre>
                    <button className="go" onClick={() => {
                      navigator.clipboard?.writeText(shareText(result, seed, snap));
                      setCopied(true);
                    }}>{copied ? "Copied ✓" : "Copy result"}</button>
                    {mode === "endless" ? (
                      <button className="ghost" onClick={() => setNonce((n) => n + 1)}>↻ New draft</button>
                    ) : (
                      <>
                        <button className="ghost" onClick={reset}>Change picks</button>
                        <button className="ghost" onClick={() => setMode("endless")}>Play endless →</button>
                      </>
                    )}
                  </>
                )}
              </>
            );
          })()}
        </section>
      )}

      <footer>
        Ratings from HLTV (per-season, normalised). Rosters from{" "}
        <a href="https://liquipedia.net/counterstrike" target="_blank" rel="noreferrer">Liquipedia</a>, CC-BY-SA 3.0.
      </footer>
    </div>
  );
}
