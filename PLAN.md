# csdle — CS "Mayhem" mode (roster draft → simulated tournament run)

Reference points: LoLdle's **Worlds Mayhem** (temporary mode), itself inspired by
**82-0** (NBA) and its **82-0 VALORANT** adaptation.

Their loop: roll a (team, era) → pick ONE player off that roster → repeat until the
lineup is full → simulate a tournament run → share the record without revealing the
lineup.

---

## 1. Data sources — the honest answer

### HLTV: no API, and scraping is explicitly forbidden
- There is **no official public HLTV API**. Never has been.
- HLTV's Terms of Use explicitly prohibit "data mining or web scraping in relation to
  the Website and its content."
- The site is behind Cloudflare bot protection. Every unofficial wrapper
  (`gigobyte/HLTV` for Node, `hltv-async-api` / `hltv-data` for Python) says the same
  thing in its README: abuse it and you get IP-banned. They also break whenever HLTV
  ships markup changes.
- **Conclusion: do not build a live runtime dependency on HLTV.** It is the single
  best data source in CS and also the one you cannot legitimately depend on.

### Liquipedia: a real, sanctioned API — use this as the spine
- MediaWiki API per-wiki: `https://liquipedia.net/counterstrike/api.php`
  (`action=parse`, `action=query`, `action=askargs`). No key needed.
- **LiquipediaDB API** — structured datapoints (`match`, `team`, `player`,
  `tournament`, `placement`, `standingsentry`, `transfer`, `teamtemplate`,
  `squadplayer`, `series`). Requires requesting an API key / approval.
- Rate limits are strict and enforced with automated IP bans:
  - MediaWiki: **1 request / 2 s**; `action=parse`: **1 request / 30 s**
  - LiquipediaDB: **60 requests / hour**
- Requires a custom `User-Agent` identifying the project + contact
  (`csdle/1.0 (https://...; you@email)`). Generic `python-requests` gets blocked.
- Requires caching: "re-use / cache your API results for as long as possible."
- Content is **CC-BY-SA 3.0** → you must attribute Liquipedia on the site.

Liquipedia gives you: rosters by year, player real names, **nationality**,
**role** (AWPer / IGL / rifler / coach), join & leave dates, team templates + logos,
tournament placements. That is most of what this game needs.

What it does *not* give you: per-player performance ratings.

### Filling the ratings gap
Ranked by how much I'd lean on each:
1. **Hand-authored ratings, seeded from public stat knowledge.** 82-0 shows "full
   ratings visible" — those are *game* numbers, tuned for balance, not a stat feed.
   This is the intended design, not a compromise.
2. **Kaggle HLTV-derived bulk datasets** (several exist: CS2 HLTV pro match stats,
   CS:GO Majors player stats, CSGO Pro Players). One-time offline download, no live
   scraping, no Cloudflare. Use to *seed* the hand ratings. Derived from HLTV, so
   treat as hobby-project-only, not a commercial base.
3. **PandaScore** — free tier is 1000 req/hr and covers schedules/results/context.
   Real *stats* tiers start ~EUR 400/mo per game. Free tier alone won't give ratings.
4. **bo3.gg** (community wrapper `tommhe14/CS2API`) — modern CS2 only, unofficial.

### The key architectural call
**This game needs zero live data.** It is a historical-roster game. So:

> One-time ETL from Liquipedia (+ Kaggle seed) → a committed local snapshot
> (SQLite or JSON) → the app ships as a static site. Refresh the snapshot manually
> 2–4×/year.

That removes rate limits, Cloudflare, key management, and uptime from the runtime
entirely, and makes the whole thing cheap to host.

---

## 2. Game design

### Draft
- Roll a **(team, era)** pair, e.g. *Astralis 2018*, *NiP 2012*, *SK 2017*, *NAVI 2021*.
- Player picks one member of that historical roster. Repeat 5×.
- Filling **5 distinct roles** is the constraint that makes it a game rather than
  "pick the highest number every time": **AWPer / IGL / entry / support / lurker**.
  - Liquipedia has a role field, but CS roles are softer than LoL lanes and the data
    is patchy. Expect to hand-fill roles for the top ~300 players. This is the single
    biggest data-quality risk — validate it in the spike (§4, Phase 1).

### Chemistry — the CS-native mechanic
CS is far more nationality-locked than LoL. Real-life superteams have repeatedly
failed on language. Lean into it:
- **Language/region synergy**: all-Danish, all-Swedish, all-French, all-BR, all-CIS
  lineups get a bonus. Mixed international lineups take a penalty unless they contain
  a known international IGL.
- **Era coherence**: mixing 1.6 and CS2 players costs you. Adjacent years are free.
- **Role overlap penalty**: two AWPers, or zero IGL, tanks the team.
- **Historical-teammate bonus**: players who actually played together get a small buff.

### Rating model
Roughly: `team_strength = Σ(player_rating × role_fit) + chemistry − era_spread_penalty`

Watch out: **HLTV Rating is not comparable across eras.** Rating 1.0, 2.0, and later
revisions use different formulas, and CS 1.6 / Source / GO / CS2 are effectively
different games. Normalize *within* era (z-score vs that year's top 20) before
mapping to a single 0–100 game rating. Do not put raw HLTV numbers from 2013 and
2024 on the same scale.

### Simulation
- Seeded, deterministic, **pure function**: `(seed, lineup) → run result`. Testable,
  and re-runnable server-side for leaderboard verification.
- Bracket shaped like a **Major**: Challengers → Legends → Playoffs, or a straight
  16-team bracket. Opponents drawn from real historical lineups at their era strength.
- Match resolution: Bo3, map-by-map, logistic/Elo-style win probability from strength
  delta. Round-by-round sim is more flavorful but adds nothing to the outcome
  distribution — do it later, for the recap text, if at all.
- **Daily seed**: `date → PRNG → spin sequence`, so everyone gets the same draft and
  scores are comparable. This is what makes it shareable.

### Share / social
Share card shows record + mode + link, **not the lineup** — so friends attempt it
blind first. Straight from the 82-0 playbook.

---

## 3. Architecture

```
data/
  fetch_liquipedia.py     # rate-limited, cached, custom UA
  seed_ratings.py         # Kaggle CSVs -> per-era normalized ratings
  build_snapshot.py       # -> snapshot.sqlite / players.json (committed)
sim/
  engine.ts               # pure, seeded: (seed, lineup) -> RunResult
  ratings.ts              # chemistry + role fit
  engine.test.ts
web/                      # Vite + React (or Next static export)
api/                      # only needed for the leaderboard
```

- Sim runs **client-side** for instant feedback.
- Leaderboard needs a backend (Cloudflare Workers + D1, or Supabase). It must
  **re-run the sim server-side** from `(seed, picks)` and reject mismatches —
  otherwise the leaderboard is trivially forged by POSTing a fake score.
- Sim engine shared between client and server → keep it a dependency-free TS module.

---

## 4. Phases

| Phase | Deliverable | Why first |
|---|---|---|
| 0 | Decide era scope | Determines all data work |
| 1 | **Data spike**: pull 5 teams from Liquipedia, inspect real payloads | Validates the role/nationality/roster-by-year assumption before anything is built |
| 2 | Snapshot ETL + rating normalization | The hard, boring, load-bearing part |
| 3 | Sim engine + tests (CLI only, no UI) | Balance is tuned here, headlessly |
| 4 | Draft UI + run recap | |
| 5 | Daily seed, share card, leaderboard | |

**Recommended era scope:** CS:GO 2013–2023 + CS2 2023–now. Coverage is dense, ratings
are comparable-ish, and the player pool is recognizable. CS 1.6 is a data desert and
a nostalgia trap — add it later as a separate mode if at all.

---

## 5. Legal / attribution
- Attribute Liquipedia (CC-BY-SA 3.0) visibly.
- Don't scrape HLTV. If you use Kaggle HLTV-derived data, keep it non-commercial.
- **No player photos** — copyrighted press images. Use initials/avatars or nothing.
- Team logos are org trademarks. Safer to use text/abbreviations for v1.
- Fan project, no implication of Valve/HLTV/Liquipedia endorsement.

---

## 6. Decisions (locked 2026-09-16)

1. **Era scope: CS:GO + CS2 only** (2013–now). Schema keeps an `era` dimension so a
   1.6 pool can be added later as a separate mode.
2. **Format: daily seed + endless.** The daily run uses a date-derived seed, is the
   only thing that writes to the leaderboard, and is the shareable artifact. Endless
   free-play runs entirely client-side with no backend.
3. **Ratings: stat-seeded, then hand-tuned.** Kaggle HLTV-derived CSVs → per-era
   z-score normalization → 0–100 game rating → manual overrides table for players the
   data misrates or misses. The override layer is committed and diffable, so balance
   changes are reviewable.
4. **Stack:** Vite + React + TypeScript, static build. Sim engine is a dependency-free
   TS module shared by client and the leaderboard verifier. Backend deferred to
   Phase 5 (Cloudflare Workers + D1).

## 6b. Ratings strategy (per-player, per-year)

### HLTV Rating is versioned — pick one deliberately
| Version | Era | Notes |
|---|---|---|
| 1.0 | pre-2017 | Kills + survival + multi-kills. **Formula is public & computable.** |
| 2.0 | 2017 | 10 components (5 per side): kill, survival, KAST, impact, damage. **Formula never published** — "The exact formula won't be public this time." |
| 2.1 | CS2 recalibration | Same model, reweighted |
| 3.0 | **Aug 2025** | Round Swing replaces Impact; economy-weighted; 6 sub-ratings |

Implications:
- Only 1.0 can be reproduced exactly. 2.0 must be *approximated* — best public
  regression (Dave, flashed.gg):
  `0.0073·KAST + 0.3591·KPR − 0.5329·DPR + 0.2372·Impact + 0.0032·ADR + 0.1587`
  where `Impact` is itself approximated from KPR + assists-per-round.
- **VERIFIED 2026-09-16:** the per-year `/stats/players` table still serves
  **Rating 2.0** for CS:GO-era date ranges — column header is literally "Rating 2.0",
  and s1mple 2018 = 1.34, the historically familiar figure. Rating 3.0 has *not*
  been applied retroactively here. This is the good case: no approximation needed,
  no version drift across the CS:GO years.
- Re-verify when the range crosses into CS2 (2023+), where 2.1/3.0 may apply.

### Scope is ~2,100 cells, not "all of HLTV"
14 seasons × ~30 draftable teams × 5 slots, heavily overlapping → **~600 unique
players, ~2,100 (player, year) rating cells.** Tractable. Do not architect for a
scraping campaign.

### Acquisition — chosen approach
**Spine (C):** HLTV's per-year leaderboard already aggregates exactly this:
`hltv.org/stats/players?startDate=YYYY-01-01&endDate=YYYY-12-31&minMapCount=N`
— one page per season, ~14 pages. HLTV ToS forbids automated data mining and the site
is Cloudflare-protected, so **these are saved manually in-browser** and the repo
parses local HTML. No automation against hltv.org lives in this codebase.

**Backfill (A):** bulk HLTV-derived Kaggle datasets, already published, for per-map
sub-stats (KAST, ADR, opening duels) used by role inference and chemistry:
- `mateusdmachado/csgo-professional-matches` — `players.csv`, per-player per-map,
  Nov 2015 – Mar 2020
- `griffindesroches/cs2-hltv-professional-match-statistics-dataset` — CS2 era
- Known gaps: **2020–2023** and **2012–2015**

### Pipeline
```
data/raw/hltv_stats/<year>.html   # manually saved, committed
data/parse_hltv_year.py           # local HTML -> player_year_ratings.csv
data/kaggle/                      # bulk CSVs for sub-stats
data/build_ratings.py             # join + per-era z-score -> 0-100 game rating
data/overrides.csv                # hand-tuning layer, diffable
```
Hand-tuning applies last, on top of the derived number, so balance edits are always
reviewable as a diff.

## 6c. FINDING (2026-09-16): HLTV yearly stats cannot supply rosters

Tested by inverting `player_year_ratings.csv` (2018, `rankingFilter=Top20`) into
(team -> players). Result: **only 8 of 22 teams had exactly 5 players.**

| Failure | Example |
|---|---|
| Under-full | G2 = 3 (kennyS, shox, bodyy); HEROIC = 3; Renegades = 3; Virtus.pro = 4 |
| Over-full (year churn) | fnatic = 9; NiP/FaZe/MOUZ/HellRaisers = 6 |
| Duplicate org identity | `Space Soldiers` and `ex-Space Soldiers` = same 5 people |
| Player on 2 teams | tarik & Stewie2K (MIBR + Cloud9); Xizt (FaZe + NiP, stand-in) |

**Root cause:** the table is a *per-player yearly aggregate*, not a roster. The team
column is incidental — no join date, no leave date, no lineup concept.

**Lowering `minMapCount` does not help** — it worsens the over-full case (fnatic 9 -> 12)
while under-full persists (a November signing never clears any map floor). Not tunable.

### Revised data split
- **Liquipedia** — rosters by (team, year) with join/leave dates, via `squadplayer` +
  transfer log. Derive the **canonical lineup** = the 5 who overlapped the most days
  that season. Back on the critical path, but scoped to rosters only.
- **HLTV yearly stats** — ratings spine + nationality (100% populated, 22 countries).
  Still valuable; just not authoritative for who was on a team.
- **Join key** — Liquipedia has no HLTV `player_id`. Match on nickname + a
  hand-maintained alias table (`data/aliases.csv`), ~600 players.

### Game semantics this buys
"Astralis 2018" must mean device/dupreeh/Magisk/gla1ve/Xyp9x — the Grand Slam lineup
— not everyone who wore the jersey. The canonical-lineup derivation is what makes a
(team, year) roll well-formed, and it guarantees every roll offers exactly 5 picks.

## 6d. VALIDATED (2026-09-16): Liquipedia rosters + HLTV ratings works

Spike run against the live Liquipedia CS wiki (rate-limited, disk-cached,
custom UA). Reconstructed 2018 lineups for the exact teams HLTV got wrong:

| Team | Canonical 2018 lineup | Days | HLTV gave |
|---|---|---|---|
| Astralis | Magisk, Xyp9x, dev1ce, dupreeh, gla1ve | 328 | 5 (correct) |
| Fnatic | Golden, JW, KRIMZ, Lekr0, flusha | 144 | **9 (churn blob)** |
| G2 | NBK-, apEX, bodyy, kennyS, shox | 151 | **3 (incomplete)** |
| Natus Vincere | Edward, Zeus, electroNic, flamie, s1mple | 351 | 5 (correct) |
| Space Soldiers | Calyx, MAJ3R, XANTARES, ngiN, paz | 1 | 5 (duplicated as ex-) |

Alternates fall out with day counts too — Astralis pre-Magisk (Kjaerbye, 33d),
G2 pre-shuffle (Ex6TenZ/SmithZz, 48d), fnatic's two other 2018 lineups. That is
**better than a single roster**: (team, year) can roll a specific era-accurate
lineup, and every roll is guaranteed exactly 5 picks.

### Parser notes (fragility already hit and fixed)
- Table class varies: `table2__table` **and** `table2__table sortable` — gla1ve and
  Xyp9x were silently dropped by an exact-class regex.
- Underscores in class names arrive HTML-escaped (`table2&#95;&#95;table`).
- **Column positions are not stable.** s1mple's row has 8 cells against a 7-column
  header, shifting every field (his role parsed as "Oleksandr Kostyliev"). Columns are
  now located by content — dates by pattern, role as the last cell before the first
  date — and any row whose cell count != header count is reported as an anomaly.
- Staff filter: role cell is empty for players, non-empty for Coach / CEO /
  Director of Sports / Board Member. Clean separator.
- Partial dates (`2019-08-??`) clamp to the start of the period.

### Join to HLTV ratings: 22/25 (88%), two distinct failure modes
1. **Alias mismatch** — `dev1ce` (Liquipedia) vs `device` (HLTV). Seeded
   `data/aliases.csv`. Expect a few dozen across 14 years.
2. **Pool gap** — NBK- and apEX are absent from the HLTV capture entirely, because
   it used `rankingFilter=Top20` plus the default ~100-map floor.

**Consequence for the remaining 13 years: drop `rankingFilter=Top20`.** It is too
narrow — it puts holes in rosters the draft will actually serve. Capture a broader
pool and filter later in the pipeline, where it is reversible.

### Known edge case
Space Soldiers scores only 1 day of overlap (thin Liquipedia page for a short-lived
org) yet still yields the right five. The day count is a **confidence signal**, not a
correctness one — low-day lineups should be flagged for review, not discarded.

## 6e. COVERAGE (2026-09-16): 21/21 teams for 2018

Full 2018 HLTV team pool run through Liquipedia. **Every team produced a full
5-man canonical lineup.** Output: `data/lineups_2018.csv`.

Team-name resolution needed no manual alias table — MediaWiki redirects handled it:
AGO -> AGO esports, FaZe -> FaZe Clan, G2 -> G2 Esports, Gambit -> Gambit Esports,
Liquid -> Team Liquid, OpTic -> OpTic Gaming, fnatic -> Fnatic. 21/21 resolved.

### Three more parser bugs, all silent
1. **Tagless org staff.** NiP's founder Peter Hedlund (join 2006, no leave) was
   counted as a rostered player for 19 years, so NiP never showed exactly 5. Staff
   titles land in an inconsistent column — Astralis puts "Director of Sports" in the
   role cell, NiP puts "CEO" in the *Name* cell — so staff are now detected by
   scanning every cell between nick and first date against a title keyword list.
2. **Date columns mis-mapped (worst one).** Dates were matched to headers by "nth
   cell containing a date", which breaks when a date column is empty or a non-date
   column holds a date. The **New Team** cell carries the next team's join date, so
   NBK- parsed as `inactive=2018-10-08` — his *Vitality* date — with leave *before*
   inactive. Now mapped by column index with an offset for ragged rows.
3. **Benched != rostered.** Window now ends at `min(inactive, leave)`, not `leave`.

Combined effect on confidence: MIBR 21d -> 159d, Gambit 36d -> 110d, NaVi 351d -> 365d,
Liquid 193d -> 258d, MOUZ 184d -> 254d, FaZe 331d -> 350d.

### Day-count is a confidence signal, and it is load-bearing
6 of 21 lineups hold for under 100 days. **2018 had no single "team lineup" for most
orgs** — G2's dominant 2018 five is Ex6TenZ/SmithZz/bodyy/kennyS/shox (174d), not the
NBK-/apEX side that was benched in June.

Design consequence: `(team, year)` is a coarse unit. Prefer rolling
`(team, year, lineup-era)` using the alternates, or accept the dominant lineup and
surface the day count in the UI as era flavour ("G2, mid-2018").

### Known edge case
Space Soldiers = 1 day: the org exited CS on 2018-01-01 and the roster played on as
"ex-Space Soldiers". Lineup is correct, confidence is not. Disbanded orgs whose roster
continues under an `ex-` label need to be treated as their own team-year entity.

## 6f. Ratings capture — RESOLVED

**`rankingFilter` filters MATCHES, not the player list** (confirmed by the user).
So Top20 ratings are quality-adjusted: only games against top-20 opposition count,
stripping out padding against tier-3 teams. Keep the filter.

**Capture: one file per year.** `rankingFilter=Top20` + a low `minMapCount`.
The earlier dual Top20/All capture is unnecessary — a low floor on the Top20 view
gives quality *and* full roster coverage in a single save.

```
https://www.hltv.org/stats/players?startDate=YYYY-01-01&endDate=YYYY-12-31&rankingFilter=Top20&minMapCount=<low>
-> data/raw/hltv_stats/<year>-Top20.html
```

### Lowering the floor trades coverage for variance — handled by shrinkage
With only top-20 matches counting, a thin sample is genuinely noisy: 1.30 over 15
maps is not 1.30 over 209. Left raw, a hot split becomes a first-round draft pick.

`data/build_ratings.py` applies empirical-Bayes shrinkage toward the year's pool
mean before normalizing:

    weight = min(1, maps / season_median_maps)     # relative + saturating
    shrunk = weight * rating + (1 - weight) * season_mean

| top-20 maps | raw 1.30 becomes |
|---|---|
| 10 | 1.086 |
| 15 | 1.103 |
| 25 | 1.129 |
| 50 | 1.172 |
| 100 | 1.215 |
| 209 | 1.251 |

`K` is the tuning knob: the map count at which a rating is half-trusted. Raise to
punish small samples harder, lower to let them speak.

### Pipeline
`shrink -> z-score within year -> 0-100 game rating` (50 = average, ~10 pts per SD).
Per-year normalization is required: HLTV ratings are not comparable across eras.
2018 sanity check: s1mple 86, device 73, NiKo 70, dupreeh 66.

## 6g. 2018 SLICE COMPLETE (2026-09-16)

Capture: `rankingFilter=Top20&minMapCount=50` -> **129 players** (was 90 at the
default ~100-map floor). NBK- and apEX now present; the pool gap is closed.

**Join: 105/105 = 100%** across all 21 reconstructed lineups.
Snapshot: `data/snapshot.json` — 21 teams, 101 players, self-contained.

### Bug found at this step: nickname case collision
`NiKo` (Nikola Kovac, Bosnia, FaZe, rating 73) and `niko` (Nikolaj Kristensen,
Denmark, OpTic, rating 46) are **different players distinguished only by
capitalization.** A lowercased join silently gave FaZe the wrong one — a 27-point
error on a first-round pick, and FaZe ranked 14th instead of 6th.

Lookup order is now: exact case -> alias table -> case-insensitive **only if
unambiguous** -> raise. Never guess between candidates. Liquipedia preserves the
capitalization correctly, so exact matching resolves it.

Generalize when scaling to 14 years: run the collision check per year before
building, and treat any new collision as a hard stop, not a warning.

### 2018 team strengths (sanity check vs history)
Astralis 66.2 > NaVi 58.4 > Liquid 54.8 > MIBR 54.6 > NRG 53.8 > FaZe 53.6.
Astralis's 2018 Grand Slam season topping the table is the expected result.
G2 sits low (43.2) because the day-dominant lineup is the Ex6TenZ/SmithZz side.

### Snapshot shape
```json
{"teams": [{"team","year","roster":[player_id],"days","confidence","strength"}],
 "players": {"<id>": {"nick","nationality","rating","hltv","maps","role": null}}}
```
`confidence` from lineup days: high >=150, medium >=60, low <60.
`role` is null everywhere — the remaining hand-curation gap.

## 6h. ROLES — what can and cannot be automated (2026-09-16)

### Liquipedia `|roles=` is CURRENT OCCUPATION, not playing role
97% of the 2018 pool (98/101) has the field, but the semantics are wrong for
retired players: gla1ve = `coach`, GuardiaN = `coach`, dupreeh = `broadcast
analyst`, f0rest = `streamer`, Xyp9x = `assistant coach`. The infobox confirms it
— gla1ve carries `years_active=2010-2025` **and** `years_active_coach=2025-Present`
with `roles=coach`. There is **no per-era playing-role field anywhere on the page.**

Consequence: role coverage *degrades as you go back in time*, precisely where the
draft pool is most interesting. Only 79/101 normalize to a playing role, and the
IGL count is inflated to 32 in a 101-player pool because the field accumulates
every role a player ever held.

### Prose mining: TESTED, REJECTED
Regexing page prose for "in-game leader" / "AWPer" / "entry fragger" recovered only
5 players and **3 of the 5 were wrong** — gla1ve tagged `awp`, dupreeh `awp/lurk`,
f0rest and friberg `igl`. The patterns match descriptions of *teammates'* roles in
surrounding text. Do not pursue. (`data/infer_roles.py` keeps the experiment.)

### What IS automatable
| Role | Automatable | Source |
|---|---|---|
| entry | yes | HLTV `/stats/players/openingkills` — per-year, objective, same manual-save flow |
| awp | mostly | roles field catches 16; AWPers are few and well-known |
| **igl** | **no** | no statistical signature; field over-counts 32 vs the true ~21 |
| rifle/support/lurk | low value | weak signatures, little mechanical weight |

### Decision: scope roles to IGL + AWP, hand-confirm
Do not curate 5 roles x 600 players. Need **one AWPer and one IGL per team-year**;
fill the rest from opening-kill stats and defaults. ~21 IGL decisions per year with
heavy cross-year overlap -> roughly 60-80 unique IGLs across all 14 seasons.

`data/roles_worksheet_2018.csv` pre-fills candidate shortlists:
auto-resolved to a single candidate for IGL 7/21, AWP 11/21.

**The shortlist is a hint, not an answer** — single-candidate results are still
wrong sometimes: fnatic resolves to Lekr0 (actually Golden), Renegades to Nifty for
both IGL and AWP (actually AZR at IGL). Astralis and NaVi come back empty. Review
all 21 rows, do not trust the auto-fills.

## 6i. ROLE MODEL: 4 multi-labels (awp / igl / star / anchor)

Replaces the 5-role grid (AWP/IGL/entry/support/lurk), which was a LoLdle import.
LoL enforces hard lanes; CS does not. A CS role is a property of a player *within a
team's system* and changes by team, by year, even by map — it is not statistically
separable. Opening kills conflates entry with AWP (AWPers take most CT opening
duels); flash assists measure the team's system, not the individual.

### The model
| Label | Source | Notes |
|---|---|---|
| `awp` | **curated** | small, well-known set |
| `igl` | **curated** | ~21/year, heavy cross-year overlap |
| `star` | **derived** | top-2 by rating on the roster, >= pool median |
| `anchor` | **derived** | default, so every player has >=1 label |

Multi-label is the point: s1mple = `awp,star`, FalleN = `igl,star`, device =
`awp,star`. No player is forced into one box — the failure that killed the 5-role grid.

AWPers ARE eligible for `star` — excluding them left s1mple as `awp` only, which is
plainly wrong.

### Validated on 2018
Structure is sound. Every remaining error traces to the Liquipedia seed, not the
scheme: gla1ve and Zeus land as `anchor` (both IGLs), Golden missed as fnatic's IGL,
Renegades gives Nifty `awp,igl` when AZR was the IGL, Liquid shows 3 IGLs, GODSENT 4,
and 7 teams show zero AWPer.

**=> Do not seed awp/igl from Liquipedia. Curate them.** 2 flags x 21 teams = 42
decisions for 2018. `star`/`anchor` need no input.

### Draft constraints this enables (all data-backed)
- >= 1 `awp` and exactly 1 `igl` in the five
- nationality/language chemistry (100% populated from HLTV)
- era coherence (years are already the draft axis)
- **rating budget cap** — the strongest candidate for the primary constraint:
  creates the same "can't just take the five biggest numbers" tension, needs zero
  curation, and is tunable for balance in a way roles never would be

`openingkills` / `flashbangs` remain useful as *playstyle flavour* (aggressive vs
passive) and small sim modifiers — descriptive, not structural. Not worth saving
until the core loop works.

## 6j. TEAM POOL: no separate top-20 source needed

`rankingFilter=Top20` + `minMapCount=50` yields 27 distinct team labels for 2018.
The distribution self-filters: 24 teams have >=5 players, then a cliff to three
teams with exactly 1 (Envy, Vega Squadron, Imperial) — transfer artifacts where one
player passed through mid-year. They cannot form a lineup anyway.

**Filter = `>=5 players in the pool`.** Already implicit, now explicit in
`coverage_<year>.py` as `MIN_PLAYERS`.

The min-50 floor added **BIG, ENCE and TYLOO** — all legitimately top-20 in 2018,
all absent at the old 100-map floor. Further confirmation the lower floor was right.

### Rejected: Major attendance as the team filter
- Wrong granularity — two Majors/year through 2020, then annual
- Includes Challengers qualifiers who were never top 20
- Misses top-20 teams that skipped a cycle

### Rejected: HLTV ranking archive (`/ranking/teams/2018/december/31`)
More precise, but a year-end snapshot misses teams that were top-20 *during* the
year and gone by December — Space Soldiers disbanded in January 2018 and would
vanish. The stats capture naturally means "top-20 relevant at any point that year",
which is what a season-based draft wants.

### Two more parser bugs (the role cell carries PLAYING statuses, not just staff)
1. **`On Loan` treated as staff.** TYLOO's fifth man `somebody` (Xu Haowen) reads
   "On Loan"; Summer reads "Loan". The "any non-empty role = staff" rule dropped
   them and TYLOO produced no 2018 lineup.
2. **Over-correcting broke Space Soldiers.** Exempting `substitute` too let DESPE
   ("Substitute") into the squad, making it six-deep and killing its lineup.

Correct rule: **loan / stand-in = actively playing, keep. Substitute = benched,
exclude.** Opposite treatment, similar-looking values.

### Result: 24/24 teams, 116 players, 100% rating join
Astralis 66.2 > NaVi 58.4 > Liquid 54.8 > MIBR 54.6 > ENCE 54.0 > NRG 53.8 > FaZe 53.6.

## 6k. FULL BUILD COMPLETE — 2015-2025 (2026-09-17)

11 years captured, **223/223 team-years reconstructed, 1087 player-years.**
Snapshot: `data/snapshot.json`, self-contained, no runtime API calls.

### Rating version drift is REAL and is handled
| Years | Version |
|---|---|
| 2015-2016 | Rating **1.0** |
| 2017-2023 | Rating **2.0** |
| 2024-2025 | Rating **3.0** |

Per-year z-scoring (decided in 6b) turns out to be load-bearing, not precautionary:
absolute scales are never compared. Raw `hltv_rating` is meaningless across years —
only the derived `game_rating` is comparable. Map floors also vary by year (20 in
2015, 65 in 2020) because no `minMapCount` reached the URLs; shrinkage absorbs it.

### Bugs found scaling from 1 year to 11
1. **Ambiguous short team names** resolved to nonsense via the search fallback:
   `X` -> "List of player hardware", `Players` -> the CS:GO article, `?` -> an IEM
   event page. `Spirit` failed all 5 of its years. Fixed with `data/team_aliases.csv`
   (explicit page overrides + explicit drops).
2. **`On Trial Loan`** — the anchored `^(on )?loan$` pattern filed MOUZ's siuhy as
   staff, costing MOUZ its 2024 lineup. Now matches `\bloans?\b|\btrial\b` anywhere.
3. **Tagless org staff with ancient join dates** — Dignitas `wEZ` (joined 2007) and
   SK `vilden` (2007) have no role text AND no end date, so they read as rostered
   forever. Rule: no end date + tenure >= 8 years => staff. Real players at these
   orgs always have an inactive/leave date recorded.

### Rating fallback chain (42 of 1115 slots)
A player can be in a Liquipedia lineup but absent from that year's HLTV top-20 pool.
Resolution order: exact -> alias -> case-insensitive -> **carried** from a year within
3 (19 slots) -> **imputed** at the year's 25th percentile (23 slots). Every player
carries `rating_source` so imputed values are never mistaken for measured ones.
1016/1087 are exact.

### Labels: 78% of team-years fully valid
`data/labels_manual.csv` — per-player, with optional year range AND team scope.
Team scope was necessary: Stewie2K called for Cloud9 in 2018 but FalleN called at
MIBR the same year; player+year alone cannot disambiguate.

| | count |
|---|---|
| ok (1 IGL, >=1 AWP) | 175 (78%) |
| no_igl | 28 (13%) |
| no_awp | 27 (12%) |
| **multi_igl** | **0** |

Remaining gaps are tier-2 sides and years where a guess would be unverifiable —
**left blank and flagged deliberately.** A visible gap beats a plausible wrong label,
because nothing downstream would catch it.

### Sanity check: strongest team-years
2018 Astralis 66.0 > 2021 NaVi 61.2 > 2025 Vitality 60.8 > 2021 Gambit 60.0 >
2016 Luminosity 59.4 > 2019 Astralis 59.4 > 2025 Spirit 58.6 > 2017 SK 58.4.
Historically credible top to bottom.

### Known bad
- **Eternal Fire 2025** picked an academy roster (Calyx, EMSTAR, imoRR, jresy,
  lugseN) — 4 of 5 unresolved against the rating pool. Needs a manual lineup override.
- 6 team-years have `confidence: low` (<60 days); Space Soldiers 2018 is 1 day.

## 6l. IGL LEADERSHIP BONUS (2026-09-17)

Rewards IGLs who won, without breaking the draft.

### The design decision that matters
**The bonus applies to the OTHER FOUR players, never to the IGL himself.** A
personal rating bonus would stack on an already-strong rating, making winning IGLs
doubly dominant and pushing the draft back toward "pick the biggest number" — the
exact failure the constraints exist to prevent. Team-wide makes a low-fragging
proven leader genuinely competitive with a star: **gla1ve 2021 rates 41 but carries
+8**, while fox 2015 rates 53 and carries +1.

### Scoring
Source: Liquipedia player achievements tables (`data/achievements.json`, 67 IGLs).

    Major win = 10 | S-Tier = 5 | A-Tier = 2 | B-Tier = 1 | runner-up x0.35
    norm  = (raw / 60) ** 0.5         # CAP = 60, EXPONENT = 0.5
    bonus = round(12 * norm)          # MAX_BONUS -> EACH of the other four

**Calibration:** upgrading one slot from a median player (50) to the best in the
pool (92) is worth 8.4 team-mean points. MAX_BONUS=12 puts a maxed IGL at ~8.0 —
roughly parity with the best available star upgrade, so an elite leader is a real
alternative to a star without strictly dominating. Raise toward 16 to make IGL the
biggest lever in the draft; raise EXPONENT (0.5 -> 0.65) to make top pedigree
*rarer* rather than bigger.

    gla1ve 2018: +10 -> 2018 Astralis 66.0 -> 74.0 (strongest team-year in the pool)
    gla1ve 2021: +12 -> a weak 45.0 roster lifted to 54.6
    distribution: {0:15, 3:24, 5:27, 7:23, 8:19, 10:14, 12:4} — only 4 hit the cap

**Counted as-of-year, not career total.** Drafting gla1ve 2016 must not hand you
the Grand Slam he had not won yet. This also makes era matter — the same player is
a different pick in different years:

| IGL | trajectory |
|---|---|
| gla1ve | 2017 +3 -> 2018 +7 -> 2019-22 +8 |
| FalleN | 2015 +0 -> 2016 +5 (Luminosity Major) -> 2025 +7 |
| karrigan | 2016 +0 -> 2017 +3 -> 2019 +5 -> 2022 +7 |
| apEX | 2019 +2 -> 2024 +5 -> 2025 +7 |

### Why sqrt, not log or linear
Linear lets the winningest leaders dominate. `log1p` over-rewarded thin resumes —
a 5-point resume scored +3 against an elite 65-point resume's +8, so 114 of 193
team-years clustered at +5 or higher and the bonus stopped discriminating. sqrt
keeps diminishing returns while preserving a real gap. Distribution now:
`{0:15, 1:11, 2:27, 3:39, 4:21, 5:33, 6:24, 7:19, 8:4}`.

### Two parser bugs
1. **Wrong table by position.** Taking the first "achievements" match landed in the
   Mouse Settings block on some pages (apEX, arT, bLitz) -> silently 0 results.
   Now located by **header signature** (Date+Place+Tier) — same lesson as the
   roster parser: never trust position.
2. **Disambiguation pages.** `Zeus`, `Fox` and `Steel` are common words and resolve
   to disambiguation stubs. Fixed via `data/player_page_aliases.csv`
   (Zeus -> "Zeus (Ukrainian player)", etc). Zeus is a Major-winning IGL; losing him
   would have been a silent hole.

### Known limitation
Liquipedia's achievements table is **capped at 10 rows**, so these are top-10
placements, not complete trophy counts. Tier weighting still separates a Major
winner from a tier-2 IGL, and the distribution discriminates well, but raw numbers
will not match a full trophy tally. Fuller history would need each player's
`/Results` subpage (~30 min more fetching).

### Snapshot fields added
`teams[].igl`, `teams[].leadership` (0-8), `teams[].leadership_raw`,
`teams[].effective_strength` (= strength + leadership*4/5).

## 6m. SITE BUILT (2026-09-17) — `web/`

Vite 8 + React 19 + TS. `npm run dev` -> localhost:5173. Build: 72 kB gzipped.

    web/src/sim/rng.ts       seeded PRNG (mulberry32 + FNV hash), daily key
    web/src/sim/engine.ts    rolls, evaluate(), bo3, bracket, share text
    web/src/sim/flags.ts     nationality -> flag emoji
    web/src/App.tsx          draft UI
    web/scripts/*.ts         headless engine + render tests

### Loop
Five rolls, each a real `(team, year)`; take one player from that roster.
**Feasibility guaranteed by construction** — at least one roll offers an IGL and one
an AWP, verified 0 failures across 500 seeds. A seed that deals an unwinnable hand
reads as a bug, not as a hard draft.

### Scoring (all mechanics from 6i/6l wired in)
    strength = mean(5 ratings)
             + IGL leadership (other four only)
             - composition (2 anchor / 1 awp / 2 rotater, soft; no IGL -5, no AWP -6)

Sim: Bo3 per match, `p = 1/(1+exp(-(a-b)/7))`, 3-round bracket with opponents drawn
from rising bands (35-60%, 60-85%, 85-100%) of the historical field, so the run
escalates. Daily seed = local date; endless = nonce. Pure and seeded, so a server
can re-verify a submitted score from `(seed, picks)` alone.

### The design goal, measured
`npm run test:sim` drafts 400 seeds two ways:

| strategy | avg strength | championships |
|---|---|---|
| greedy by rating | 58.3 | 81/400 (**20%**) |
| constraint-aware | 61.8 | 132/400 (**33%**) |

Constraint-aware is ~1.65x greedy, so the "don't just pick the best player
available" goal holds, verified rather than asserted.

### Era-spread penalty REMOVED (2026-09-17, user request)
Was `<=1y 0, <=3y -1, <=6y -3, else -6`. Removing it raised championship rates from
8%/16% to **20%/33%**, because the penalty buffed only the *player* — bracket
opponents are single-year historical teams and never had a spread to lose. Net
effect: every roster gained ~5 points against a fixed field, and the strategic gap
narrowed from 2.0x to 1.65x.

**Open balance question:** a 1-in-3 championship rate for good play is generous for
a daily game. To restore difficulty without reintroducing the mechanic, raise the
opponent bands in `simulate()` (currently 35-60%, 60-85%, 85-100% of the historical
field) — e.g. to 55-75%, 75-92%, 92-100%.

### Verified
tsc clean, production build clean, dev server serves app + 340 kB snapshot,
`renderToString(<App/>)` mounts, `evaluate()` finite for 0-5 picks (the UI calls it
on every render — an unguarded `Math.max()` on an empty roster would white-screen
the page). **Not** visually verified: no browser automation available here.

### Not built yet
Leaderboard + server-side verification (the engine is already pure and seeded for
it), persistence of the daily result, and the positional archetype model if it
ever replaces AWP+IGL.

## 6n. PLAYER PHOTOS — investigated, NOT usable (2026-09-17)

### The saved HLTV `_files` folders never had player photos
The "Webpage, Complete" saves carried 415 images: country flags, team logos and
site chrome (buttons, ad pixels, sponsor logos). **Zero player portraits** —
`/stats/players` is a stats *table*; portraits only exist on individual player
pages, which were never saved. (I had also deleted those `_files` dirs while
installing the captures — worth noting, but nothing usable was in them.)

### Liquipedia has photos for 396/407 players (97%) — and they are NOT licensed to us
Infoboxes carry `|image=`, and thumbnails resolve fine through the API. But the
File pages live on **Liquipedia Commons** (separate wiki, `/commons/api.php`), and
surveying all 396:

| license | count |
|---|---|
| `permission` | **395** |
| `fairuse` | 1 |
| free/CC | **0** |

Copyright holders: ESL Gaming (83), BLAST (79), PGL (54), StarLadder (32),
DreamHack (25), Esports World Cup (12). Typical note:

> "BLAST has allowed **Liquipedia** to use images from their Flickr account.
> **All rights to the images remain in the hands of BLAST.**"

That is a grant to Liquipedia, not a transferable licence. Self-hosting would be
redistributing press photography without permission; hotlinking moves the bandwidth
cost but not the copyright problem. **Do not ship real player photos.**
This confirms the call already made in §5.

### What shipped instead: deterministic generated avatars
`web/src/sim/avatar.ts` + `web/src/Avatar.tsx`. FNV hash of `player_id` ->
two-stop gradient + rotation + arc, initials from the nick, and a **ring coloured
by role** (awp purple / igl blue / star orange / anchor grey). Pure SVG, no assets,
no network, no licence exposure.

Verified: deterministic, **1087/1087 distinct**, and awkward nicks degrade well
(`910`->"91", `b1t`->"B1", `disco doplan`->"DI", `NBK-`->"NB").

### If real photos are wanted later
Only viable route is genuinely free-licensed sources (Wikimedia Commons has CC-BY
shots of a handful of marquee players), or asking the organisers directly.
Coverage would be a few dozen players at best, so a hybrid — real photo where a
free licence exists, generated avatar otherwise — is the only workable shape.

## 6o. DRAFT VARIETY FIX (2026-09-17)

**Report:** "I get the same teams every time." Measured it — team-*years* were
well distributed (219/223 seen over 200 seeds), but **orgs** were not.

**Cause:** 223 team-years across only **69 orgs**. G2, Liquid, MOUZ and NaVi have
11 seasons each, so plain sampling dealt the same org twice in **21% of drafts**
and the top 12 orgs took ~48% of all slots. Different years, same names — reads as
repetition.

### Fix
1. **No repeated org within a draft** -> 21% to **0%**
2. **No org carried over from the previous draft** (`avoid` param, endless only) ->
   4.7/45 slots to **0.0**. Daily passes nothing, so it stays a pure function of
   the seed and remains server-verifiable.

Variety is now **92% of the theoretical ceiling** (35.7 distinct orgs per 50 slots
under ideal uniform sampling).

### Two alternatives tried and REJECTED, both measured
- **Org-uniform sampling** (each org equally likely regardless of seasons).
  Flattened the big names (5.3% -> 3.8% top share) but pulled in far more tier-2
  sides, shrinking the gap between a good and a lazy draft from **1.65x to 1.23x**.
  Variety is not worth losing the strategy.
- **One roll per era band.** Looked varied, but unnecessary once orgs are deduped.
  Counter-intuitively it *helped* chemistry (21% vs 10% reachable 3-blocs) because
  same-era teams share nationality clusters — but not enough to justify it.

### Final numbers
| | |
|---|---|
| greedy by rating | 18% championships |
| constraint-aware | **29%** championships (1.6x) |
| same org twice in a draft | 0% |
| org repeat from previous draft | 0.0/45 |
| variety vs ceiling | 92% |
| feasibility failures / 500 seeds | 0 |

`npm run test:variety` guards both properties.

### Residual
A 3-player nationality bloc is reachable in only ~19% of drafts and 4+ in ~1%, so
chemistry is a rare bonus rather than a routine lever. Inherent to 69 orgs across
11 years — raising the CHEM values would make it matter more when it does land.

## 6p. REAL REPETITION BUG + nationality synergy removed (2026-09-17)

### The bug: every retry replayed the identical draft
`Redraft` (ready screen) and `Try again` (result screen) both called `reset()`,
which cleared picks but **left the seed unchanged** — so the same five team-years
came back every time, in both modes. That is the "same team and year over and
over" report, and it was a genuine bug, not a perception issue. The earlier
org-sampling work was addressing a different (also real, now fixed) problem.

**Fix — retry paths now say what they do:**
| button | behaviour |
|---|---|
| `Change picks` | same rolls, re-pick (legitimate: rethinking the daily puzzle) |
| `↻ New teams` / `↻ New draft` | bumps the nonce -> genuinely new teams (endless) |
| `Play endless →` | offered on the daily result, since daily is one fixed draft |

Daily deliberately keeps one draft per day — that is the format — but the UI no
longer implies a retry will deal new teams. Verified: 0/5 consecutive endless
drafts identical, 26/30 distinct team-years over 6 drafts.

### Org-uniform sampling: NOT used
Confirmed removed. Sampling is uniform over **team-years**; repetition is handled
by the within-draft org dedupe and the previous-draft avoid-list only. Org-uniform
was measured and rejected in 6o for shrinking the strategy gap 1.65x -> 1.23x.

### Nationality synergy REMOVED (user request)
Was `largest same-nationality bloc: 3->+2, 4->+4, 5->+7`. Gone from the engine,
the breakdown UI, the tests and the README. Flags remain as player info only.

Scoring is now just: **mean rating + IGL leadership − composition penalties.**

Strategy gap holds after both removals: greedy **18%** vs constraint-aware **29%**
championships (1.6x), so IGL/AWP composition alone still carries the design goal.

## 6q. MAP-COUNT TRUST: now relative and saturating (2026-09-17)

**Two problems with the old `maps / (maps + 50)`:**

1. **Absolute, not relative.** Map volume swings by calendar — 2015's median was
   65 maps, 2016's was 152. A fixed K=50 trusted a typical 2015 player **57%** and
   a typical 2016 player **75%**, purely because the schedule was busier. Median
   trust ranged 0.57-0.75 across seasons.
2. **Never saturated.** The curve crept toward 1 forever, so 240 vs 320 maps still
   moved the number even though the extra maps carry no real information.

**New rule — one line, both fixed:**

    weight = min(1, maps / season_median_maps)

Play a median workload for your season and your rating is taken at face value;
above that, extra maps do nothing at all.

| | before | after |
|---|---|---|
| median trust spread across seasons | 0.57-0.75 | **1.00 everywhere** |
| corr(maps, score) | 0.27 | **0.24** |
| players at full trust | 0 | **656/1281 (51%)** |
| mean score shift | — | 0.8 pts |

Tuning knob is `FULL_TRUST_AT_MEDIAN` (1.0). Raise it to demand more evidence
before believing a rating.

Variants measured and rejected: `n/(n+0.5*median)` fixed the cross-season spread
but still never saturated; `min(1, n/q60)` saturated but reintroduced a 0.11
spread because the q60/median ratio moves by year.

`game_ratings.csv` now carries a `trust` column so shrinkage is auditable per row.

Downstream rebuilt: snapshot, web copy. Strategy gap holds — greedy **20%** vs
constraint-aware **29%**.

## 6r. PHOTOS SURVEYED, LOGOS + REROLLS ADDED (2026-09-17)

### Why LoLdle/VALORANT have photos and CS cannot
Structural, not legal sophistication. **Riot runs its own esport**, publishes
179k+ official photos via the LoL Esports Flickr, and its "Legal Jibber Jabber"
grants a *"limited licence for non-commercial community use"* of its IP — exactly
the fan-game case. **Valve does not run CS esports.** Events belong to independent
organisers (ESL, BLAST, PGL, StarLadder, DreamHack), each owning its own
photography, none offering a fan-use grant. One permissive publisher vs a dozen
rights-holders with none.

### Everything is copyrighted; only the licence differs
| source | copyrighted | licensed to us |
|---|---|---|
| HLTV | yes | **no** — terms: content owned by "HLTV **or its licensors**"; no use of materials without a licence. The "or its licensors" matters — HLTV mostly does not own the photos either |
| Liquipedia | yes | **no** — 395/396 `permission`, 1 `fairuse`, 0 free |
| Wikimedia Commons | yes | **YES** — CC BY / CC BY-SA / CC0 / PD |

### Commons survey (all 407 players) — free, but thin
| | |
|---|---|
| players with >=1 free photo | **95/406 (23%)** |
| player-years with a photo from **that exact year** | **95/1087 (9%)** |
| within +/-2 years | 181 (17%) |
| none | 811 (75%) |

A typical 5-man board would show ~1.7 photos and ~3.3 avatars; strict per-year
~0.5 photos. **Per-year photos are not achievable** — recommendation is either
all-avatars (consistent) or best-available-photo-regardless-of-year with the year
labelled. Exact-year-only produces a board where one card in ten looks different.
Data kept in `data/commons_photos.json` if this is revisited.

### Team logos: shipped as placeholders
68/69 orgs (`OG` missing), `data/fetch_logos.py` -> `web/public/logos/` + manifest.
`license=fairuselogo` — trademarks identifying the real team (nominative use, the
basis wikis and fantasy sites rely on). Weaker exposure than press photos but still
an argument, not a grant.

Placed on the **roll header**, not the player cards: all five options share a team,
so five identical logos would replace the per-player distinction the avatars give.

### Rerolls
`REROLLS = 2` per draft. `rerollAt(snap, seed, round, attempt, inPlay)` is
deterministic in `(seed, round, attempt)`, so a run stays reproducible from picks +
reroll counts and the leaderboard can still re-derive the board.

Verified over 500 rerolls: **0 collisions** with teams already on the board, 0
returning the same team, successive rerolls all distinct.

Deliberately does **not** preserve the IGL/AWP guarantee — the opening hand is
always playable, but rerolling away your only caller is a chosen cost that the
composition penalty prices.

## 6s. COMPOSITION, DIFFICULTY, MULTI-CALLER (2026-09-17)

### Positional composition: 2 anchors / 1 AWP / 2 rotaters — SOFT
`-2` per slot off target. Never forced: you can always field your five, an
unbalanced side just costs. Forcing the shape would make some boards unplayable.

**Unlabelled = FLEX**, filling whichever slot is short, so an unlabelled pool costs
the player nothing and penalties sharpen as labelling lands. The derived `anchor`
default was removed — anchor/rotater are now curated labels, not a fallback.

No source has positional data (it is demo-level), so this is a judgement call by
design. Worksheets generated (see below).

### No penalty for two callers (user call, and the data backs it)
IGLs rate **43.2 vs 51.7** — 8.5 points below everyone else. A second caller was
being charged three times over:

| | cost |
|---|---|
| rating drag (8.5 pts on a mean of 5) | ~1.7 team pts |
| **leadership forfeited entirely** (`igls.length === 1`) | **~4.6 team pts** |
| explicit penalty | 2 |

~8.3 team points for a merely suboptimal choice. The hidden forfeit was nearly
triple the explicit penalty sitting next to it. Now: the **senior caller leads**
(highest leadership among the IGLs) and there is no extra charge — the rating drag
is the whole cost.

### Difficulty retuned to ~10%
Opponent bands swept to `75-90 / 90-97 / 97-100` of the historical field.

| | championships |
|---|---|
| constraint-aware | **9.5%** |
| greedy by rating | 4.8% |
| gap | **2.0x** (was 1.55x) |

Note: difficulty and skill-expression move together here — a harder field *widens*
the gap, because weak rosters stop surviving on variance. Removing the multi-caller
penalty narrowed it (greedy drafters who stumble into two callers keep the bonus),
which the retune absorbed.

### Worksheets for the remaining manual work
| file | rows | note |
|---|---|---|
| `worksheet_positions.csv` | 399 | `anchor`/`rotater`, sorted by draftability |
| `worksheet_igl.csv` | 23 | team-years forfeiting the leadership bonus |
| `worksheet_awp.csv` | 27 | team-years silently eating -6 |

Positional coverage is front-loaded: top 25 players = 19% of roster slots, top 100
= **51%**, top 150 = 66%. Partial labelling is safe (flex), so there is no need to
finish it.

### Also fixed: 7 team-scoped labels never matched
`labels_manual.csv` used Liquipedia page titles (`G2 Esports`, `Team Liquid`,
`FaZe Clan`) while the data uses HLTV labels (`G2`, `Liquid`, `FaZe`), so those
scoped rows silently did nothing. Label validity 76% -> **80%**.

## 6s. COMPOSITION, DIFFICULTY, MULTI-CALLER (2026-09-17)

### Positional composition: 2 anchors / 1 AWP / 2 rotaters — SOFT
`-2` per slot off target. Never forced: you can always field your five, an
unbalanced side just costs. **Unlabelled = FLEX**, filling whichever slot is short,
so an unlabelled pool costs the player nothing and penalties sharpen as labelling
lands. The derived `anchor` default was removed — anchor/rotater are curated labels
now, not a fallback. No source has positional data (demo-level), so it is a
judgement call by design.

### Two callers: no penalty, and only ONE leadership bonus
IGLs rate **43.2 vs 51.7** — 8.5 points below everyone else. A second caller was
charged three times over:

| | cost |
|---|---|
| rating drag (8.5 pts on a mean of 5) | ~1.7 team pts |
| **leadership forfeited entirely** (`igls.length === 1`) | **~4.6 team pts** |
| explicit penalty | 2 |

~8.3 team points for a merely suboptimal choice — and the hidden forfeit was nearly
triple the explicit penalty beside it.

Now the **senior caller leads**: the highest-pedigree IGL in the five pays the
bonus, applied **once, never stacked**. Verified — gla1ve 2019 (+12) alongside
pronax 2015 (+11) yields +9.6 team points, identical to gla1ve alone; summing would
have given +18.4.

### Difficulty retuned to ~10%
Opponent bands swept to `75-90 / 90-97 / 97-100` of the historical field:
constraint-aware **9.5%**, greedy 4.8%, gap **2.0x** (was 1.55x).

Difficulty and skill-expression move together here — a harder field *widens* the
gap, because weak rosters stop surviving on variance. Removing the multi-caller
penalty narrowed it (greedy drafters who stumble into two callers keep the bonus);
the retune absorbed that.

### Worksheets for the remaining manual work
| file | rows | note |
|---|---|---|
| `worksheet_positions.csv` | 399 | `anchor`/`rotater`, sorted by draftability |
| `worksheet_igl.csv` | 23 | team-years forfeiting the leadership bonus |
| `worksheet_awp.csv` | 27 | team-years silently eating -6 |

Coverage is front-loaded: top 25 players = 19% of roster slots, top 100 = **51%**,
top 150 = 66%. Partial labelling is safe (flex), so finishing it is optional.

### Also fixed: 7 team-scoped labels never matched
`labels_manual.csv` used Liquipedia page titles (`G2 Esports`, `Team Liquid`,
`FaZe Clan`) while the data uses HLTV labels (`G2`, `Liquid`, `FaZe`), so those rows
silently did nothing. Label validity 76% -> **80%**.

## 6t. `star` WAS BROKEN — now absolute (2026-09-17)

**Symptom:** 20 player-years labelled `star` were rated BELOW the 50 season average
— tarik 2015 (48), rallen 2015 (48), v1c7oR 2015 (48), Zero 2017 (49).

**Two bugs, both silent:**
1. **Drifting threshold.** `med = median(p["rating"] for p in players.values())`
   sat INSIDE the per-team loop, over the dict being accumulated. The first team
   compared against a ~5-player median; the last against ~1087. Early teams got a
   nonsense cut, which is exactly where the sub-average stars came from.
2. **Shared player-years.** 28 player-years sit on two teams in the same year
   (tarik: MIBR 2018 + Cloud9 2018) and share ONE object, keyed `player_id:year`.
   With `if "star" not in p["labels"]`, whichever team was processed first won —
   so the label depended on iteration order, not on the player.

Team-relative `star` cannot work at all while player-years are shared.

**Fix: absolute threshold, assigned after the loop.**

    STAR_AT = 62     # ~1.2 SD above the season mean

`game_rating` is z-scored within each season (mean 50, ~10/SD), so a fixed cut
means "elite for your era" and is order-independent by construction.

| | before | after |
|---|---|---|
| stars | 406/1087 (37%) | **137/1087 (12.6%)** |
| lowest-rated star | 48 | **62** |
| stars below the 50 average | 20 | **0** |
| depends on processing order | yes | no |

~0.6 stars per 5-man board, so `star` now means something. `STAR_AT` is the knob.

## 6u. `star` REMOVED — position is the role label (2026-09-17)

`star` was a **rating proxy dressed as a role**: top-2 on the roster (later
rating >= 62). It said nothing about how a player actually played, which is what a
role label is for. Dropped entirely.

**Label set is now four, all hand-curated:**

| label | meaning | ring |
|---|---|---|
| `awp` | primary AWPer | purple |
| `igl` | in-game leader | blue |
| `rotater` | plays off the site, rotates | orange |
| `anchor` | holds a site | green |
| *(none)* | **flex** — position not yet labelled | grey |

No derived labels remain. `flex` is shown as a dim chip so an unlabelled player
reads as "not yet assigned" rather than a blank card, and the engine already treats
flex as filling whichever slot is short — so partial labelling costs nothing.

**Current state: 691/1087 player-years are flex.** That is the worksheet:
`data/worksheet_positions.csv`, sorted by draftability (top 100 players = 51% of
roster slots). Until it is filled the 2/1/2 composition penalty rarely bites,
because flex absorbs the gaps by design.

## 7. Next step — Phase 1 data spike

Before any app code, answer these empirically against the live Liquipedia API:

- Does `squadplayer` / roster data reliably give **roster-by-year** for a team, or
  only current rosters + a transfer log to replay?
- How complete is the **role** field across the top ~300 CS:GO/CS2 players?
- Is **nationality** consistently populated? (Required for the chemistry mechanic.)
- Do the Kaggle HLTV CSVs **join cleanly** to Liquipedia player IDs, or is name
  matching going to need a manual alias table?

Scope: ~5 teams (e.g. Astralis 2018, NAVI 2021, SK 2017, FaZe 2022, G2 2024).
Rate-limited, cached to disk, custom User-Agent. Output: a short findings note plus
raw JSON samples committed under `data/samples/`.

If roles or roster-by-year come back thin, that changes Phase 2 from "ETL" to
"ETL + a meaningful hand-curation pass" — better to know now.
