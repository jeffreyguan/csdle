import { useEffect, useMemo, useState } from "react";
import type { Player, Snapshot } from "./sim/types";
import { makeRolls, rerollAt, evaluate, simulate, shareText, ROUNDS, REROLLS,
  type RunResult, type Roll } from "./sim/engine";
import { todayKey } from "./sim/rng";
import { flag } from "./sim/flags";
import { PlayerAvatar } from "./Avatar";
import "./App.css";

type Mode = "daily" | "endless";

export default function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [mode, setMode] = useState<Mode>("daily");
  const [nonce, setNonce] = useState(0);
  const [picks, setPicks] = useState<Player[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [rerolls, setRerolls] = useState<Record<number, number>>({});
  const [logos, setLogos] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/snapshot.json").then((r) => r.json()).then(setSnap);
    fetch("/logos.json").then((r) => r.json()).then(setLogos).catch(() => {});
  }, []);

  const seed = mode === "daily" ? todayKey() : `endless-${nonce}`;
  // endless only: don't deal an org that appeared in the previous draft
  const prevOrgs = useMemo(
    () => (snap && mode === "endless" && nonce > 0
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
      // exclude orgs already taken or currently on the board
      const inPlay = baseRolls.map((x) => x.team.team).concat(picks.map(() => ""));
      return rerollAt(snap, seed, i, n, inPlay);
    });
  }, [snap, baseRolls, rerolls, seed, picks]);

  const reset = () => { setPicks([]); setResult(null); setCopied(false); setRerolls({}); };
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
    setResult(simulate(b.total, snap, seed));
  };

  return (
    <div className="app">
      <header>
        <h1>csdle<span className="sub">mayhem</span></h1>
        <div className="modes">
          <button className={mode === "daily" ? "on" : ""} onClick={() => setMode("daily")}>Daily</button>
          <button className={mode === "endless" ? "on" : ""} onClick={() => setMode("endless")}>Endless</button>
          {mode === "endless" && <button onClick={() => setNonce((n) => n + 1)}>↻ New</button>}
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
                  <PlayerAvatar id={p.id} nick={p.nick} labels={p.labels} size={30} />
                  <div className="s-nick">{flag(p.nationality)} {p.nick}</div>
                  <div className="s-meta">{p.year} · {p.rating}</div>
                  <div className="s-tags">{p.labels.map((l) => <span key={l} className={`tag t-${l}`}>{l}</span>)}</div>
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
            {logos[roll.team.team] && (
              <img className="org-logo" src={`/logos/${logos[roll.team.team]}`} alt="" />
            )}
            <div>
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
            {roll.options.map((p) => (
              <button key={p.id} className="card" onClick={() => setPicks([...picks, p])}>
                <div className="c-top">
                  <PlayerAvatar id={p.id} nick={p.nick} labels={p.labels} size={46} />
                  <div className="c-topright">
                    <span className="c-rating">{p.rating}</span>
                    <span className="c-flag">{flag(p.nationality)}</span>
                  </div>
                </div>
                <div className="c-nick">{p.nick}</div>
                <div className="c-tags">
                  {p.labels.map((l) => <span key={l} className={`tag t-${l}`}>{l}</span>)}
                  {!p.labels.some((l) => l === "anchor" || l === "rotater") && (
                    <span className="tag t-flex" title="position not yet labelled — fills whichever slot is short">flex</span>
                  )}
                </div>
                <div className="c-hltv">HLTV {p.hltv.toFixed(2)} · {p.maps} maps</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {done && !result && (
        <section className="ready">
          <h2>Roster complete</h2>
          <ul className="bd">
            <li><span>Average rating</span><b>{bd.base.toFixed(1)}</b></li>
            {bd.leadership > 0 && <li><span>IGL leadership</span><b className="pos">+{bd.leadership.toFixed(1)}</b></li>}
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
          <h2 className={result.champion ? "champ" : ""}>{result.placement}</h2>
          <div className="matches">
            {result.matches.map((m, i) => (
              <div key={i} className={`match ${m.won ? "w" : "l"}`}>
                <span className="m-round">{["Quarter-final", "Semi-final", "Grand Final"][i]}</span>
                <span className="m-opp">{m.opponent.team} {m.opponent.year}</span>
                <span className="m-score">{m.scoreYou}–{m.scoreThem}</span>
              </div>
            ))}
          </div>
          <pre className="share">{shareText(result, seed)}</pre>
          <button className="go" onClick={() => {
            navigator.clipboard?.writeText(shareText(result, seed));
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
        </section>
      )}

      <footer>
        Ratings from HLTV (per-season, normalised). Rosters from{" "}
        <a href="https://liquipedia.net/counterstrike" target="_blank" rel="noreferrer">Liquipedia</a>, CC-BY-SA 3.0.
      </footer>
    </div>
  );
}
