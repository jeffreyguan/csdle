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

## 6v. GROUP STAGE + FITTED OPPONENTS + MATCH REVEAL (2026-09-17)

**Diagnosis:** tuning only the championship rate hid the real problem. The
placement spread was flat — **62% reached the semi-final or better**, 27% the
final. Weak rosters went deep because every round drew from the same wide bands.

### Format: Major-style
`Group A/B/C` (Bo1) then `Quarter-final / Semi-final / Grand Final` (Bo3).
**2 wins from 3 to advance**, so a bad group run ends the tournament.

### Opponents: fitted to depth, not sampled from a band
Each stage has a fixed strength TARGET and takes the nearest real team-year (one
of the closest 8, deterministically jittered, no repeats within a run).

    Group A 53 | Group B 57 | Group C 60 | QF 61 | SF 64 | GF 66

**Fixed, never scaled to the player** — rubber-banding would make a strong draft
pointless and a weak one feel unearned. Real teams are kept rather than generated
ones: seeing "Astralis 2018" across the table is the flavour; *which* one you draw
is what varies with depth.

### Result (drafted strength p10 55 / p50 61 / p90 68)
| | constraint-aware | greedy |
|---|---|---|
| out in groups | **29.4%** | 46.3% |
| quarter-final | 28.4% | 27.4% |
| semi-final | 21.4% | 14.3% |
| grand final | 9.5% | 4.9% |
| **CHAMPION** | **11.3%** | 7.1% |

A proper descending curve: going deep is now rare and roughly a third of runs end
in groups. Swept 9 target sets to land it.

### UI: match-by-match reveal
The run no longer resolves in one blob. Each step shows **who you are facing**
(logo, team, year, Bo1/Bo3) before you press *Play the match*, then the result
lands and the next opponent is revealed. Share string separates the stages:
`🟩🟩🟩 | 🟩🟥  4-1`.

## 6w. CUSTOM OPPONENT TEAMS (2026-09-17)

**~50% of opponents are now assembled by the sim** rather than drawn from the 223
real team-years. Real sides stay for recognition; custom ones let the game pose
match-ups that never happened, and there are only 223 real lineups to rotate.

### How they are built
Five real players greedily assembled toward the stage's strength target. Accuracy
is excellent — **mean error 0.04 pts vs target, max 0.4** — so custom sides do not
disturb the tuned difficulty curve at all.

### Org-style names
`Vertex`, `Nomad Union`, `Obsidian Gaming`, `Talon Collective`, `Zenith Esports`.
Descriptor prefixes ("All-Star Halcyon", "Nordic Vertex") were dropped — they read
as a label, not a team you could plausibly lose to.

### Custom teams get leadership too
An IGL on their side buffs their other four, exactly as on yours. Without it a
custom team was quietly weaker than a real team of identical players.

Targeting had to become a **correction pass**: a fixed offset cannot work because
leadership is 0 for a side with no IGL and up to +9.6 team points for one led by
gla1ve, so the overshoot depends on who got drawn. A constant -2.5 blew the error
out to 2.50 mean / 7.2 max; the swap loop restores **0.05 mean / 0.4 max**.

### The reveal shows a head-to-head, not just a name
Up-next card now carries both sides: **team rating, IGL, AWP, leadership bonus**,
and the opponent's full five with avatars, year, rating and role tags. You can see
what you are walking into and why the number is what it is.

### Difficulty unchanged
constraint-aware: 29.2% out in groups, **10.4% champion**; greedy 5.7%.

## 6x. OPPONENT POOL WAS LOCKED TO 41 TEAMS (2026-09-17)

**Report:** "I still see the same teams, especially the year — Vitality 21,
HellRaisers 15."

**Measured:** the DRAFT was fine — all 223 team-years appear, Vitality 2021 and
HellRaisers 2015 each dealt 7x in 2000 slots against an expected 9. But they were
**faced as opponents 0 times**, because:

`opponentFor` took the **nearest 8 to a FIXED target**. Fixed targets => a fixed
candidate list => **only 41 of 223 team-years could ever be faced**, and the same
handful recycled forever (Falcons 2025 alone was 5.4% of all real matches).

### Fix: jittered target + tolerance band
    aim  = target ± 4          (the target itself moves per match)
    pool = everything within ±4 of aim

| | before | after |
|---|---|---|
| distinct real opponents | **41/223** | **172/223** |
| most-seen opponent | 5.4% | **1.8%** |

Jitter is symmetric so difficulty averages out across a run, though it did nudge
the championship rate 11% -> 12.2%; targets raised by 1 to compensate.

### Final curve
| | constraint-aware | greedy |
|---|---|---|
| out in groups | 31.6% | — |
| quarter-final | 28.9% | — |
| semi-final | 19.5% | — |
| grand final | 9.4% | — |
| **CHAMPION** | **10.6%** | 5.9% |

19 team-years still never appear — the extremes (43 strength at the bottom, 74 at
the top) sit outside every stage band. Acceptable; they are draftable, just never
opponents.

## 6y. THE ACTUAL REPETITION BUG: endless always started at board 0 (2026-09-17)

**Report:** "I still see the same teams I draft from — Vitality 21, HellRaisers 15."

Those two are not a coincidence. `endless-0` dealt exactly:

    Astralis 2022 | fnatic 2018 | Falcons 2024 | Vitality 2021 | HellRaisers 2015

**Cause:** `const [nonce, setNonce] = useState(0)`. Endless always opened on board
zero — every page load, and (during this session) every Vite HMR reload, which
fired on each edit. So the same five teams kept reappearing.

**Why every engine test missed it:** the tests exercise `makeRolls`, which is
correct — 223/223 team-years reachable, 92% of the variety ceiling, 0.11 shared
team-years between consecutive boards. The bug was in **session state**, not the
engine. Statistical tests over many seeds cannot see a bug that always picks the
same seed.

**Fix:** `useState(() => Math.floor(Math.random() * 1e6))`. Every session opens on
a different board. Daily is untouched — its seed is the date, and it is the only
mode that must be reproducible.

Also fixed alongside: `prevOrgs` was computed with `nonce > 0` so the very first
endless board applied no avoid list, and it called `makeRolls` without the avoid
argument, so it reconstructed a *different* previous board than the one shown.

### Lesson
Two separate "same teams" reports had two entirely different causes — the first was
a genuine engine issue (opponent pool locked to 41/223), the second was UI state.
Both presented identically to the player. Worth testing the app's state machine,
not just the pure functions.

## 6z. SWISS STAGE + ALL-CUSTOM, UNNAMED OPPONENTS (2026-09-17)

### Format: Swiss, first to 3 wins
Not a fixed 3 matches — you play until **3 wins (advance)** or **3 losses (out)**,
so a run is 3-5 matches. The decider (2-x or x-2) is Bo3, as in a real Major.
Run lengths: 36% / 37% / 27% for 3 / 4 / 5 matches.

Opponents stiffen with your record: `56 + 3.0 x wins`, jittered ±2.5.

### Every opponent is now assembled; real lineups dropped
223 real team-years is too few, they always field the exact five who played, and
fitting them to a strength target meant a small pool recycled (that was the
41/223 bug in 6x). An assembled side hits any target exactly.

**Roles are coherent: 100% have exactly one AWPer and exactly one IGL.**
Getting to 100% needed two fixes:
- *Dual-role players.* FalleN and Jame carry both `awp` and `igl`; taking one as
  the AWPer then adding a separate caller gave two. Now the AWP slot prefers a
  non-caller, and a caller is only added if the AWPer is not one.
- *Roster incoherence.* The correction pass reached for extremes to hit the
  number — NiKo (77) beside STYKO (40). Candidates are now confined to ±11 of
  the target, so a side looks like a team.

### No names
Opponents are identified by their five players and their rating, not a fabricated
org name. Match rows read `62.4 — s1mple, device, gla1ve…`; the reveal shows the
full five with roles.

### Difficulty
| | constraint-aware | greedy |
|---|---|---|
| out in Swiss | **42.3%** | 63.3% |
| quarter-final | 22.7% | 15.7% |
| semi-final | 16.4% | 10.8% |
| grand final | 9.7% | 5.2% |
| **CHAMPION** | **8.9%** | 5.0% |

Swiss now eliminates ~42%, close to a real Major's half-the-field, while the title
stays near 10%. Swept 5 configurations.

## 7a. SEASON SUCCESS REPLACES CAREER PEDIGREE (2026-09-17)

**Trigger:** "why does pronax 2015 have a higher bonus than apEX 2025?" — and it
exposed three bugs in the career-pedigree model.

### Bugs in the old model
1. **Liquipedia's achievements table caps at 10 rows.** apEX had 3 of his 10 dated
   2026, which the as-of-year filter dropped — he was judged on **7 events** while
   pronax got all 10. FalleN 2016 scored +8 in a year he won **two Majors**.
2. **Pre-2017 Majors were not detected.** The check was `/\bmajor\b/`, but
   DreamHack Winter, ESL One Katowice/Cologne and MLG Columbus are Majors that
   are not named "Major" — pronax's three Major wins scored as ordinary S-Tier.
3. **Double counting.** An IGL's 2018 results ARE his team's 2018 results, so
   career pedigree + a team-success bonus would count one run twice.

### New model: ONE source, two magnitudes, per season
`data/team_results.json` — full `/Results` history for all 69 orgs (no 10-row cap).

| | reads | magnitude |
|---|---|---|
| every player | their team's season | up to **+6** to their own rating |
| the IGL | the same season | buffs the **other four** by up to **+15** |

Weighting calibrated against the spread of HLTV form across team-years (sd 4.2)
and the best possible single-slot upgrade (+8.8 team points):

| TEAM / IGL | achievements sd | share of spread | max contribution |
|---|---|---|---|
| 4 / 12 | 3.6 | 46% | +13.6 |
| **6 / 15** | **4.8** | **53%** | **+18.0** |
| 8 / 20 | 6.3 | 60% | +24.0 |

At 6/15 silverware is slightly ahead of form, which is the intent. Past ~8/20
results swamp form entirely.

Scoring: placement x tier, summed over the season (not averaged — entering 30
events and winning 3 is not worse than entering 10 and winning 3), qualifiers and
showmatches excluded, then normalised against **that year's best side**.

### Two calibration findings
- **Ranged placements.** `^1st` matched `"1st - 4th"` and gave a top-four-somewhere
  finish full winner's credit. Envy 2015 had three, which alone made it the best
  season on record (144.2). Ranged results now score at the **worse** end; Envy
  fell to 131.1 and 3rd, behind fnatic 2015 (179.8, two Majors) and Astralis 2018.
- **Reference bar.** Normalising against the 92nd percentile put 39 team-years at
  the cap with a median of +6 of 12 — everyone got half, which discriminates
  nothing. Against the year's best, with a linear curve: 14 at max, median +4.

### Result
    ENCE 2018   base 52.2  +1 each, igl +3   -> 55.6
    ENCE 2019   base 48.0  +2 each, igl +5   -> 54.0

At 4/12 the gap narrowed from 2.6 to 1.6 but did not flip. **At 6/15 it does:**

    ENCE 2018   effective 55.6   (team +1 each, igl +3)
    ENCE 2019   effective 56.6   (team +3 each, igl +7)

Their Katowice final now outweighs the individual-stat dip, which was the point.

### Difficulty re-centred
Bonuses lifted drafted strength ~1 point (p50 61 -> 62), so the ladder moved with
it (Swiss base 56 -> 57.5, playoffs 61/64/66 -> 62.5/65.5/67.5).
Back to: **43.4% out in Swiss, 9.4% champion**, greedy 5.8%.

## 7b. TRIMMED SD: elite players were suppressing each other (2026-09-17)

**Report:** "why would ZywOo affect donk's z-score? the delta should be as large
as s1mple 2018."

Correct on both counts. The deltas ARE identical:

    s1mple 2018  shrunk 1.340  field mean 1.035  delta +0.305  sd 0.0766  z 3.98 -> 90
    donk   2024  shrunk 1.330  field mean 1.027  delta +0.303  sd 0.0834  z 3.64 -> 86

Same distance above the field, different score — because 2024's **standard
deviation** is larger. And it is larger precisely because 2024 had three players
above 1.28 (ZywOo, donk, m0NESY) while 2018 had one. **Outliers inflate the SD,
and a bigger SD divides every delta down, so elite players in the same season
suppress one another.**

The giveaway — the typical spread is near-identical:

    2018:  sd(all) 0.0766   sd(middle 90%) 0.0576
    2024:  sd(all) 0.0834   sd(middle 90%) 0.0564

**Fix:** normalise against a **trimmed SD** (middle 90%), with the multiplier cut
from 10 to 7.5 per SD to preserve the familiar range. The mean is unchanged — one
player never moved that; it was always the denominator.

    donk 2024  base 86 -> 90      (now equal to s1mple 2018, as the delta implies)
    range 21-99, median 51 — essentially unchanged

Final rating is also clamped to 99: base is clamped, but the success bonus could
push a top season past it (donk 2025 briefly read 100).

Difficulty unchanged at **46.1% out in Swiss, 10.9% champion**.

## 7c. Bo5 GRAND FINAL (2026-09-17)

Majors run Bo5 grand finals; the sim now matches. `series()` takes `1 | 3 | 5`
(first to 1 / 2 / 3).

Format is now: Swiss Bo1 (Bo3 decider) -> QF Bo3 -> SF Bo3 -> **GF Bo5**.

A longer series cuts variance and favours the stronger side, so it was worth
checking the title did not drift: **10.9% -> 10.4%**, small enough to leave alone.
The effect is muted because finalists are already a selected group — reaching the
final at all is ~18%, and those who do tend to be strong.

Verified over 236 simulated finals: every scoreline is a valid Bo5
(`3-0, 3-1, 3-2, 2-3, 1-3, 0-3`), never more than 5 maps.
`npm run test:bo` guards it.

## 7d. TWO BUGS IN SEASON SCORING (2026-09-17)

**Report:** "Xizt 2016 got +15 and that wasn't even prime NiP."

### Bug 1: a Major counted the same as any S-Tier event
`TIER` had no Major tier, so **NiP 2016 (four ordinary S-Tier wins) tied
Luminosity 2016 (two MAJORS)** at 63.1 vs 63.2 — both took +15. The old
player-pedigree code weighted Majors at 2x; that never carried into season scoring.

Fixed: `MAJOR = 22` vs S-Tier 10, with the pre-2017 name list (DreamHack Winter,
ESL One Katowice/Cologne, MLG Columbus — Majors that are not named "Major").
Tournament names now come from the results-table link title, present on 97% of
13,979 rows. Luminosity 2016 -> 75.2, clear of NiP's 64.6.

### Bug 2: scaling to the year's best inflated weak years
The bonus was `raw / that_year's_best`, so a weak season inflated everyone:

| year | best season | by |
|---|---|---|
| 2016 | **75.2** | Luminosity |
| 2018 | **144.8** | Astralis |
| 2025 | **148.7** | Vitality |

2016's best is **half** of 2018's, so NiP 2016 sat at 86% of its year and drew
+13, while the same raw score in 2018 would be 45%. Conversely Spirit 2025 — a
genuinely strong season — was squashed to +8 for coexisting with Vitality.

Fixed: a **fixed benchmark of 170**. A great season now scores the same
regardless of who else was great.

170 rather than 130 because at 130 the whole elite tier was **clipped** — fnatic
2015 (203.8), Astralis 2018 (144.8) and NaVi 2021 (131.8) all scored +15, despite
fnatic's season being 55% bigger than NaVi's. Raising the bar lets great seasons
rank against each other:

    fnatic 2015    +15      Astralis 2019  +10
    Vitality 2025  +13      SK 2017        +10
    Astralis 2018  +13      Liquid 2019     +9
    NaVi 2021      +12      NiP 2016        +6

Exactly one season now reaches the cap (was 39 under per-year scaling, 6 at 130).
The scale stays **linear** — convexity was tested and only squashed the middle
without separating the top, which was the actual complaint.

### Result
    Xizt / NiP    2015  raw  98.1 -> igl +11
                  2016  raw  64.6 -> igl  +7     (was +15)
                  2017  raw  27.1 -> igl  +3

Distribution is far healthier: median IGL bonus +4, only 6 seasons at the +15 cap
(was 39 at cap under the old per-year scaling).

Difficulty re-centred — smaller bonuses lowered drafted strength ~1 point
(Swiss base 59 -> 58, playoffs 63/66/68). Back to **44.5% out in Swiss, 10.1%
champion**.

## 7e. SEASON SCORE IS NOW A RATE, NOT A TOTAL (2026-09-18)

**Report:** "entering events and not doing well should be penalised... 2015
fnatic was not as good as 2025 or 2018 or even 2019."

Correct, and the totals were attendance-inflated:

| season | entered | wins | win% | old raw | per event |
|---|---|---|---|---|---|
| fnatic 2015 | **32** | 15 | 47% | **203.8** (#1) | 6.4 |
| Vitality 2025 | 21 | 11 | 52% | 148.7 | **7.1** |
| Astralis 2018 | 22 | 14 | **64%** | 144.8 | 6.6 |
| NaVi 2021 | 18 | 11 | 61% | 131.8 | **7.3** |
| **Virtus.pro 2015** | **38** | 7 | **18%** | **132.4 (#5)** | 3.5 |
| **Envy 2015** | **31** | 7 | **23%** | **140.9 (#4)** | 4.5 |

2015 had a bloated calendar and three 2015 sides sat in the all-time top five.
Virtus.pro won 18% of what they entered and scored 5th-best ever.

**Fix: a GEOMETRIC blend of total and rate** — `sqrt(total x rate)`, each
normalised (TOTAL_REF 205, RATE_REF 7.5, floor of 8 events).

Neither alone works:
- **Pure total** rewards attendance (Virtus.pro 2015: 38 events, 18% win rate,
  5th all-time).
- **Pure rate** over-rewards light schedules (NaVi 2021, 18 events, outranked
  fnatic 2015 and Astralis 2018).
- **A weighted average** lets a huge total paper over a poor rate — linear
  blending put Virtus.pro 2015 back at #7.

Multiplying requires BOTH volume and quality.

This also delivers the "penalise entering and doing badly" ask without a separate
penalty — a poor result adds to the denominator and nothing to the numerator.
Worth noting a penalty ALONE would not have fixed fnatic 2015: they had 29 top-4s
in 32 events and one finish below 9th. The problem was volume, not bad results.

### Final ranking (IGL bonus), W_TOTAL = 0.5
    1. fnatic 2015     +14      5. Astralis 2019  +9
    2. Astralis 2018   +12      6. Envy 2015      +10
    3. NaVi 2021       +12      7. SK 2017        +9
    4. Vitality 2025   +12      9. FaZe 2022      +8
                               20. Virtus.pro 15  +8

fnatic 2015 and Astralis 2018 clear NaVi 2021, FaZe 2022 sits outside the top 8,
and **Virtus.pro 2015 falls to #20** (38 events, 18% win rate) — at W_TOTAL 0.6 it
was #8, and a linear blend put it at #7.

`season_raw` returns 0..1 directly, so BENCHMARK = 1.0.

### Rejected: mean of top-K events
Tested at K=5/8/12. It suppresses the volume-inflated 2015 sides even harder
(Virtus.pro #14, Envy #13 at K=5) but reverses the calls that prompted the work:
Astralis 2018 slips to #5, NaVi 2021 rises to #3, FaZe 2022 returns to #6.
Top-K measures PEAK only — five best results say nothing about the other twenty —
so a side brilliant five times and mediocre often scores like one brilliant five
times and good throughout.

Difficulty re-centred: **42.4% -> ~10% champion** after lifting the ladder 0.6-0.7.

## 7f. IGL CAP 15 -> 12, AND THE 2015 QUESTION (2026-09-18)

`IGL_MAX` lowered to 12 (team stays 6). Distribution is now heavily bottom-loaded
— median +2, one season at +11 — so the bonus reads as a genuine distinction
rather than something most sides collect.

### "2015 has two teams so high, which is a contradiction"
Half right, and the cause is real: **the volume term is not era-normalised.**

| year | median events entered |
|---|---|
| 2015 | **27** |
| 2022 | **15** |
| 2025 | 19 |

2015 teams entered nearly twice what modern sides do, so the TOTAL half of
`sqrt(total x rate)` hands 2015 free credit. Rate is era-neutral; volume is not.

**But fixing it conflicts with the earlier calls.** Normalising volume against each
season's median schedule:

| | global ref (kept) | era-normalised |
|---|---|---|
| fnatic 2015 | #1 | #3 |
| NaVi 2021 | #3 | **#2** |
| Vitality 2025 | #2 | **#1** |
| FaZe 2022 | #9 | **#5** |
| Virtus.pro 2015 | #8 | **#18** |
| 2015 sides in top 10 | 3 | 2 |

It suppresses 2015 (and crushes Virtus.pro) but pushes NaVi 2021 to #2 and FaZe
2022 back to #5 — reversing two explicit user calls. **Kept the global reference**;
the tension is noted rather than resolved, since it is a genuine trade, not a bug.

Worth separating: fnatic 2015 ranking #1 is *not* obviously wrong — 15 wins from
32 events at a 47% win rate is a real case for best season on record. The weaker
2015 entries (Envy #6 at a 23% win rate, Virtus.pro #8 at 18%) are where the
volume bias actually shows.

## 7g. RMR BUG + TOTAL_REF WAS A 2015 ARTEFACT (2026-09-18)

**Report:** "donk 2024 only gets +3?" — Spirit won the Shanghai Major that year.

### Bug: RMRs scored as Majors
`is_major` matched the word "Major", so **"PGL Major Copenhagen 2024: European
RMR"** — a *qualifier for* the Major — took the full 22-point Major weight instead
of A-Tier's 5. **406 rows affected**, concentrated in the RMR era (118 in 2024,
82 in 2022, 74 in 2023). Now excluded via `NOT_MAJOR` (rmr / qualifier / closed).

### TOTAL_REF 205 was calibrated on a single outlier
Best season total by year: **2015: 203.8** — every other year is **55-149**. So
205 meant no modern side could approach the volume cap, and 2015 sat permanently
on top. Spirit 2024's Major-winning season reached only 40% of it.

Lowered to **130**, and MAJOR raised **22 -> 30** (at 22, a Major-winning season
ranked 17th — a Major is the single most prestigious result in CS).

### Result
    1. Astralis 2018  +12      6. Envy 2015       +10
    2. Vitality 2025  +12      7. FaZe 2022        +8
    3. fnatic 2015    +11     11. Spirit 2024      +8   (was #17, +6)
    4. Astralis 2019  +10
    5. NaVi 2021      +11

Astralis 2018 and Vitality 2025 now clear fnatic 2015, and Astralis 2019 sits
just behind — matching the stated view that "2015 fnatic was not as good as 2025
or 2018 or even 2019". donk 2024 now reads **90 + 4 = 94**.

This also largely resolves 7f's noted contradiction: the 2015 dominance was mostly
TOTAL_REF, not the blend.

## 7h. CARD REDESIGN + IGL ALIGNMENT BUG (2026-09-18)

### The alignment bug
`.card` is a `<button>`, and **buttons vertically centre their content**. The IGL's
`leads` badge made that card taller, so every other card floated mid-box against
it. Fixed with `display:flex; flex-direction:column` (top-aligned, badge pushed
down by `margin-top:auto`) and by **always rendering the badge** — empty for
non-IGLs — so all cards are identical height regardless of role.

Third instance of the same class this session: conditionally mounting an element
inside a sized container. Reserve the slot, don't mount conditionally.

### New card
- **Org logo inside the avatar** instead of initials (1072/1087 players have one;
  initials remain the fallback), plus a large faded logo watermark that lifts and
  rotates on hover.
- **Rating at 32px with a gradient meter bar**, and the `+N` results bonus as a
  green superscript.
- **Three-stat strip**: HLTV rating, K/D, maps. Added `team`, `kd`, `kd_diff` to
  the player records (K/D present for 1045/1087; the rest show "—").
- Nick, flag, team and season in a header block; role chips below.
- Gradient panel background, lift-and-shadow on hover.

`npm run test:card` asserts the app mounts and checks team/logo/K-D coverage.

### Grid overflow
The redesigned cards used `auto-fit, minmax(178px, 1fr)` — five of those need
930px and the container gave 848px, so they wrapped to two rows. Now pinned to
`repeat(5, minmax(0, 1fr))` with the container widened 880 -> 1000px (186px per
card), and **every grid switched from `1fr` to `minmax(0, 1fr)`**.

That distinction is the actual fix: `1fr` is `minmax(auto, 1fr)`, so a track
never shrinks below its content and long names (Gratisfaction, "Ninjas in
Pyjamas 2015") push the row wider instead of ellipsing. Applied to the option
cards, roster slots, opponent roster, stat strip, match rows and the head-to-head
panel.

Responsive: 5 columns > 760px, 3 columns > 460px, 2 below.

## 7i. HONOURS ON CARDS: Majors + HLTV Top 20 (2026-09-18)

### Major wins
Derived from `team_results.json`: a 1st place at a Major (ranged placements
excluded). **15 Major-winning team-seasons across 2015-2025** — correctly none in
2020, which had no Major.

Needed one more `NOT_MAJOR` rule: **"ESL Major Series"** and **"ESL Major League"**
are unrelated events that merely contain the word, and were producing false
positives (NiP 2013, Vexed 2016). EMS One Katowice 2014 genuinely IS a Major and
is listed explicitly in `EARLY_MAJORS`.

### HLTV Top 20 Players of the Year
Liquipedia mirrors the rankings at `HLTV/Top 20 Players`. Scraped to
`data/hltv_top20.json` — **15 years, 20 players each**, 201 of the 1087
player-years in the pool have a placing.

This is genuinely new information: HLTV's ranking is **editorial** (big events,
impact, awards) rather than a rating, so it is independent of everything already
in the snapshot. It is also the answer to an earlier question — HLTV made donk #1
of 2024 while raw rating vs top-20 had ZywOo ahead.

Two parse fixes: 2023's header reads `"2023  (GO/2)"` (the CS:GO/CS2 split year)
so it needed a prefix match rather than an exact one, and 2022's names carry
invisible word-joiner characters (U+2060) that had to be stripped.

### On the card
Badges hang **over the top edge** as a tab: 🏆 for a Major (x2 when a side won
both that year) and `HLTV #N` for the Top 20 placing, orange when top three.

Positioned absolutely and out of flow, which matters: an in-flow honours row
reserved ~26px on every card, and 886 of 1087 player-years have no Top 20 placing,
so most cards carried an empty band. Out of flow costs nothing when empty and
still cannot shift siblings.

## 7j. LEADERSHIP IS NOW MULTIPLICATIVE (2026-09-18)

**Question:** "should IGLs be a flat add or a multiplier? IGLs can carry a bad
team right now."

### Flat did favour weak rosters, by construction
| roster | flat +9.6 | gain | x1.18 | gain |
|---|---|---|---|---|
| 40 | 49.6 | **24%** | 45.8 | 14% |
| 60 | 69.6 | 16% | 68.6 | 14% |
| 80 | 89.6 | **12%** | 91.5 | 14% |

A flat bonus is worth twice as much proportionally to a 40-rated roster as an
80-rated one — the carry effect exactly as described.

**But it was mostly theoretical.** Over 1500 drafts by a bot deliberately chasing
leadership, the weakest 20% averaged only +2.8 leadership, and just **0.7%** of
sub-58 rosters reached 62+. The bonus distribution is bottom-heavy (median +2)
after the 7f-7g recalibration, so elite callers are rare.

### Changed anyway, because it is more true to CS
A great caller makes good players better through structure, utility and roles —
he cannot make bad players good. Flat said otherwise.

    leadership = other_four_total x (season_bonus / 12) x 0.18

Applied identically in `evaluate()`, in `buildOpponent`'s `effOf`, and in the
snapshot's `effective_strength`.

### Measured effect
    weak roster (48) + max IGL:   57.6 -> 54.9   (-2.7, the carry case)
    strong roster (72) + max IGL: 81.6 -> 82.4   (+0.8)

The "too OP on a good team" worry does not materialise — the ceiling rises 0.8
while the carry loses 2.7, and p10/p50/p90 of drafted strength are unchanged.
Difficulty held at **45.0% out in Swiss, 9.2% champion** with no retune.

UI now reads `leads · +18% to teammates` rather than a flat figure.

## 7k. FILLED SLOTS MATCH THE OPTION CARDS (2026-09-18)

Picked players were rendering as a cramped stub (30px avatar, 104px tall) while
the options they came from were full cards — so making a pick visually shrank it.

Filled slots now reuse the **exact card layout**: watermark, honours badges,
avatar with org logo, nick + flag + team + season, 30px rating with meter, the
three-stat strip, role chips and the leads badge. Same 5-column grid, so a pick
looks identical before and after it is made.

Empty slots keep a large centred number. Mobile min-height 92 -> 150px.

Also: the first stat is now labelled **HLTV** (was "rating", which was ambiguous
next to the big 0-99 number that is also called a rating) and the stat values went
12.5px -> 14.5px.

Dead `.s-nick` / `.s-meta` / `.s-leads` / `.s-tags` rules removed.

## 7l. ALIGNMENT LINT (2026-09-18)

The same layout bug has now appeared **four times**: reroll button, roll-header
logo, mode buttons, honours row. Every instance was an element mounted
conditionally inside a container whose layout depends on its children.

`npm run test:align` guards it:
- the layout-reserved blocks (`c-honours`, `c-leads`, `org-logo`, `mode-new`)
  must render unconditionally
- the option card and the filled slot must emit **identical block sets**, so the
  two cannot drift apart

**Rule:** reserve the slot and render it empty, or take the element out of flow
entirely. Never mount conditionally inside a right-aligned, space-between, or
content-sized container.

## 7m. THE DIFFICULTY LADDER DIPPED (2026-09-18)

**Report:** "2nd and 3rd group games feel much harder than the 1st, maybe harder
than the QF, and the playoffs ramp slowly."

Exactly right — the ladder was not monotonic:

    Swiss 0-0      57.4
    Swiss 1-x      60.4
    Swiss 2-x      63.4   <- the decider
    Quarter-final  62.0   <- EASIER than the match before it
    Semi-final     65.0
    Grand Final    67.0

The Swiss climbed **+3.0 per win** while the playoffs climbed +3.0 then +2.0, so
progressing out of the group stage made the next match *easier*, and the bracket
barely escalated.

### New ladder
    Swiss 0-x   58.5          Quarter-final  62.5   (+1.0)
    Swiss 1-x   60.0  (+1.5)  Semi-final     66.0   (+3.5)
    Swiss 2-x   61.5  (+1.5)  Grand Final    69.5   (+3.5)

Gentle through Swiss, steep through the bracket — **playoff steps are now 2.3x
the Swiss steps**, where they used to be smaller.

### Superseded by 7n — see below for the final seeded model.

## 7n. SWISS SEEDING BY RECORD + QF CROSS-SEEDING (2026-09-18)

**Report:** "2-0 should be slightly harder than 2-1, which is harder than 2-2.
Going 3-0 should reward you with a 3-2 opponent."

That is real Major Swiss: you are paired against teams on **your own record**, and
a clean run earns a softer bracket. The model scaled by **win count alone**, so
2-0 and 2-2 drew identical opponents.

### Swiss now scales on (wins − losses)
    target = SWISS_BASE + (wins - losses) x 1.5

    0-0  59.8    1-0  61.3    2-0  62.8
                 0-1  58.3    2-1  61.3    2-2  59.8

Measured over 2500 runs — mean opponent strength by record:
`2-0 61.4 > 2-1 60.0 > 2-2 58.4`, and `0-1 56.9` (losing early softens the draw,
which is the point of Swiss).

### Quarter-final is cross-seeded
    QF target = 62.5 + (losses - 1) x 2.2

    qualified 3-0 -> mean QF opponent 60.2
    qualified 3-1 -> 62.5
    qualified 3-2 -> 64.5

So a 3-0 run draws a QF **easier than its own last Swiss match** (60.2 vs 62.8).
That dip is deliberate — it is the reward — which broke the old monotonic-ladder
test. `test:ladder` now asserts the six invariants that actually apply, including
"a 3-0 run earns an easier QF than its last Swiss match" and "a 3-2 run draws a
harder one".

### Opponent records are shown
Swiss opponents carry your record (pairing guarantees it); QF opponents show
`3-(2-L)` from the cross-seed; later rounds draw from the qualifying spread.
Displayed on the up-next card ("they went **2-0** in the group stage") and as a
chip in the match history.

### Final difficulty — champion 5%
| | |
|---|---|
| out in Swiss | 39.1% |
| quarter-final | 26.0% |
| semi-final | 18.1% |
| grand final | 11.9% |
| **CHAMPION** | **4.9%** (greedy 3.1%) |

`npm run test:seed` measures the Swiss and QF seeding empirically so neither can
silently invert.

## 7o. HLTV TOP 20 BONUS (2026-09-18)

`bonus = round(2 + 3 x (20 - placing) / 19)` -> **+5 for #1-3 down to +2 for #20**,
folded into the visible rating alongside the season-results bonus. A floor of +1
undersold it — making HLTV's top 20 at all is a real distinction.

### Why it is not just double-counting
`corr(placing, base rating) = -0.71` — strong, so most of it is redundant. But
**62 of 201 placed players rate below 60**:

    Snax 2015    #4  rating 58        FalleN 2017  #6  rating 59
    Snax 2016    #5  rating 54        broky 2024   #8  rating 57

Those are players whose value is in utility, calling and impact rather than
fragging — exactly the "good players with worse ratings" gap raised earlier.
HLTV's ranking is editorial, so it captures what the rating cannot. Kept small
(1-4) so it corrects rather than overrides.

    Snax 2015  (#4):  58 + 4 season + 5 top20 = 67
    FalleN 2017 (#6):  59 + 4 season + 4 top20 = 67
    b1t 2025   (#20):  57 + 1 season + 2 top20 = 60

6 player-years hit the 99 cap.

### Difficulty re-centred
Ratings rose ~1.5 points (p50 62 -> 63), so the ladder moved with them
(Swiss base 59.8 -> 60.9, playoffs 64.9 / 68.8 / 72.7).

| | |
|---|---|
| out in Swiss | 40.7% |
| quarter-final | 25.0% |
| semi-final | 17.9% |
| grand final | 10.9% |
| **CHAMPION** | **5.5%** |

## 7p. TROPHY COUNT + "MOST DECORATED CALLS" (2026-09-18)

### Trophy badge now counts S-Tier titles
Was Majors only (63 player-years). Now every **S-Tier win that season**, Majors
included, shown as `🏆×N`. 432 player-years carry at least one; the badge turns
gold when one of the titles was a Major, grey otherwise — so a Major still reads
differently from three ordinary S-Tiers.

    fnatic 2015     x11  (2 Majors)      Envy 2015          x7  (0 Majors)
    Astralis 2018    x9  (1 Major)       Natus Vincere 2021 x7  (1 Major)
    Vitality 2025    x9  (2 Majors)

Distribution: 71 seasons with 1 title, 23 with 2, 15 with 3, tailing to fnatic
2015's 11. `test:card` asserts `trophies >= majors` (a Major is an S-Tier event),
currently 0 violations.

### "Most decorated calls", not "senior"
The selection logic already picked the highest-leadership caller — only the note
said "senior", which described the wrong rule. Wording corrected and the intent
commented, so the behaviour and the explanation now agree.

## 7q. THE OPTION CARD WAS NOT SHOWING THE HLTV BONUS (2026-09-18)

**Report:** "every player on the same team has the same + number."

True, and a bug. The card markup exists in **two places** — the option card and
the filled roster slot — and an earlier edit matched only the slot's markup. The
option card, the one you actually pick from, still rendered `+{team_bonus}`.
Since the season bonus is identical for all five team-mates, every card showed
the same `+N` and the HLTV component was invisible.

Data was correct throughout: Astralis 2018 is `+10 / +9 / +11 / +10 / +10`
(season +6, HLTV +4/+3/+5/+4/+4 for Magisk #7, Xyp9x #13, device #2, dupreeh #5,
gla1ve #8).

Both variants now render `team_bonus + top20_bonus`, with a tooltip breaking it
down (`75 form + 6 season results + 5 HLTV #2`).

`test:align` gained a check that the combined expression appears in both variants
and the team-only form appears nowhere — the two card copies have now drifted
twice, so it is worth asserting.

**Note:** 111 of 223 team-years still show an identical `+N` across all five —
those are sides with no Top 20 players at all. That is correct, not the bug.

## 7r. HEAVY-TAILED DRAWS + STIFFER QF (2026-09-18)

**Report:** "group stage variation is too small — facing a 65+ or even 70+ side
should be possible, just unlikely, especially in the 2-0 pool. QF is too easy."

Measured, and both were true. Uniform +/-2.5 jitter gave every pool the same
narrow width:

| pool | old max | old >=70 | new max | new >=70 |
|---|---|---|---|---|
| 0-0 | 63.3 | 0% | 69.9 | 0% |
| 2-0 | **66.5** | **0%** | **72.7** | **3%** |
| Quarter-final | 69.9 | 0% | **79.8** | **27%** |

### Spike draws
12% of draws now come from a long right tail (+2.5 to +9 above target) instead of
the uniform band. A stacked side is rare but possible, and more likely the better
your record — the 2-0 pool now produces a 65+ opponent a third of the time and a
70+ one occasionally, so a good group run can still deliver a genuine scare.

### QF raised 64.9 -> 66.3
It was sitting barely above the Swiss decider. It is now a real gate: 77% of QF
opponents are 65+, and it eliminates 34% of all runs.

### QF seed step widened 2.2 -> 3.3
Raising the QF base broke the reward — a 3-0 run's QF (64.1) had crept above its
own last Swiss match (63.9). A wider step restores it:

    qualified 3-0 -> mean QF opponent 63.6
    qualified 3-1 -> 66.9
    qualified 3-2 -> 70.6

### One invariant was wrong, not the config
`semi-final above the HARDEST QF draw` began failing because a 3-2 qualifier now
meets a 70+ side in the quarter-final — harder than the semi. That is correct and
true to a real Major, where the cross-seeded 3-2 vs 3-0 is often the bracket's
toughest match. Relaxed to **"above the median QF draw"**: the bracket must
escalate on average, not for every seed.

Difficulty: **38.9% out in Swiss, 4.9% champion.**

## 7s. DUPLICATE AWP LABELS (2026-09-18)

**Report:** "some teams have more than one AWPer — Senzu and HeavyGod aren't
AWPers." Both correct: **31 of 223 team-years fielded two or three AWPers.**

Two causes:
1. **Wrong labels.** Speculative medium-confidence rows for players who are
   riflers: Senzu, Techno4K, HeavyGod, Tauson, Woro2k, noway, El1an, WorldEdit,
   fox, Rickeh, Jerry, coldzera, DeadFox, mixwell, ICY, niko, Maden, Lucky.
   The MongolZ had **three** (Senzu, Techno4K, mzinho — only mzinho AWPs).
2. **Blanket `*` on part-career AWPers.** chrisJ AWPed for mouz until oskar took
   over in 2017; Magisk AWPed in 2016 but allu was OpTic's AWP in 2017; SmithZz
   before kennyS; br0 at Monte but not Astralis; FalleN until molodoy at FURIA
   2025; Maden before SunPayus. Now year-scoped.

**Result: 31 -> 0 team-years with duplicate AWPers.** `npm run test:roles` fails
the build if one returns.

Side effect: `no_awp` rose 27 -> 35 team-years, since removing a wrong label
exposes a genuine gap. Those are in `worksheet_awp.csv`.

### Two doubled IGLs remain, and they cannot be fixed by labelling
`AdreN 2019` appears on **both AVANGAR and FaZe**; `roeJ 2022` on both Copenhagen
Flames and fnatic. A player-year is ONE object keyed `player_id:year`, so a
team-scoped label applied for one side leaks to the other — the same structural
limit that broke the derived `star` label in 7b.

Tolerated deliberately: the engine already resolves multiple callers (only the
most decorated one's bonus applies) and there is no multi-caller penalty, so it is
cosmetic. A duplicate AWP is not — it mis-prices the composition penalty — which
is why the lint fails on that and only reports this.

## 7t. SEMI-AUTOMATED ROLE LABELLING (2026-09-18)

**Question:** "is there an automated way to label? mzinho doesn't AWP, 910 does."

Both corrections were right, and there is a partial automation.

### Liquipedia `|roles=`, gated on `|status=`
Rejected in 6h because it reads CURRENT occupation — gla1ve shows `coach`. But it
carries a `status` field, and for **`status=Active` players it is their playing
role**. It had both corrections outright:

    mzinho  roles=Rifle     910  roles=AWP
    Senzu   roles=rifle,awper    HeavyGod  roles=rifle

403/407 pages read, **270 active with a usable role**.

### But it is NOT a wholesale labeller — noisy in both directions
- **Over-inclusive:** career-cumulative, so any brief stint counts.
  `Twistzz: igl,rifle`, `rain: igl,entry`, `TACO: igl,support` — none are primary
  callers.
- **Under-inclusive:** `tabseN: rifle`, despite years as BIG's IGL.
- **Not team-scoped:** a career AWPer label produces duplicates when two
  AWP-capable players share a roster.

### What was applied automatically
Only unambiguous cases, by two rules:
- **sole role is `awp`** -> add (18 players, including **910**)
- **I say `awp` and Liquipedia lists other roles but not awp** -> remove
  (12 players, including **mzinho**, Magisk, br0, FalleN, Graviti)

Everything else — 62 conflicts — went to `worksheet_role_conflicts.csv` for a
human call rather than being guessed.

### Duplicate resolution needed a human too
Auto-adding created two new doubles. The heuristic "keep the higher-rated player"
resolved Legacy 2025 correctly (dumau over saadzin) but got **CLG 2017 wrong** —
it kept Rickeh, when koosta was CLG's AWPer and Rickeh AWPed for Renegades.
Rating is not a proxy for who holds the AWP. Corrected by hand.

Labels gained a `*!YYYY` form ("every year except this one") for exactly this:
a career AWPer who was not the primary on one particular roster.

**Result: 0 team-years with duplicate AWPers**, guarded by `npm run test:roles`.

## 7u. REWORKING THE NO-IGL PENALTY (2026-09-18)

**Complaint:** "the no igl penalty seems a bit weird right now."

It was. Three separate faults, and they compounded.

### 1. It was regressive — backwards from the bonus it paired with
Leadership is MULTIPLICATIVE (7p), so it scales up with roster quality. Its
absence was a flat `-5`:

    roster 45  ->  -5 is -11.1%
    roster 75  ->  -5 is  -6.7%

So owning a caller helped good rosters most, while lacking one hurt bad rosters
most. The two halves of one mechanic pointed in opposite directions, and the
flat term quietly functioned as a tax on weak boards.

### 2. It was a cliff carrying the entire value of a caller
An IGL with zero season success yields `mult = 0`, i.e. +0 leadership. So the
only thing separating "unproven caller" from "nobody calls" was the flat -5 —
the whole worth of having an IGL was packed into a step function, with nothing
continuous underneath it.

### 3. It fired 64% of the time
Under greedy-by-rating drafting, 960/1500 boards ended with no caller. A penalty
that common is not a penalty; it is a baseline shift. It also sat oddly beside
the rule that **two callers are not punished** (7p): 0 callers -5, 1 fine,
3 fine.

### Fix: put "no caller" at the BOTTOM of the leadership axis
Not a separate composition term. One axis, proportional at both ends:

    no caller        -10% of the whole side
    unproven caller    0%
    decorated caller  up to +18% to the other four

`NO_IGL_MULT` set to **0.10** on request (2026-09-18). It was initially 0.075,
chosen so the penalty at a median roster landed near the old flat 5.0 rather
than re-tuning difficulty around a bug fix; 10% makes fielding no caller a
clearly losing choice rather than a marginal one.

Cost of ignoring the caller rule entirely, measured at 4000 drafts each:

    keeps a caller      strength 62.1   champion 4.9%
    ignores the rule    strength 58.7   champion 2.7%

A competent drafter is unaffected (they end up with a caller 98% of the time),
so the championship rate stays on target at 4.9% — the penalty only bites the
players it is meant to.

    roster avg   penalty
            45      -4.5
            65      -6.5
            75      -7.5

Measured gap between drafts-with-a-caller and drafts-with-none: **6.5** (was a
flat 5.0, applied regressively). Championship rate holds at **4.9%** against the
5% target.

Removed from `compositionPenalty` entirely; `no AWPer -6` and `two AWPers -3`
stay there since those are genuinely compositional, not leadership.

### Also fixed: the conditional-mount hazard, 5th occurrence
`{bd.leadership > 0 && <li>...}` — once leadership can go negative, that row
UNMOUNTS and the breakdown panel shifts. Changed to `!== 0` with a sign-aware
label ("No caller" / "IGL leadership"). Same for the versus panel.

## 7v. MATCH SUMMARY TRUNCATED TWO NAMES EARLY (2026-09-18)

**Report:** "in the summary section, it shows two names then ... there is enough
space for all the names."

Correct, and it was clipped TWICE over — which is why it read as two names when
the code said three.

1. **JSX:** `.slice(0, 3).join(", ")}…` — capped at three, with a HARDCODED
   ellipsis that printed whether or not anything was actually cut.
2. **CSS:** `.m-opp { overflow: hidden; text-overflow: ellipsis }` — and `.m-opp`
   is `display: flex`, so the bare text node became an anonymous flex item.
   Ellipsis on a flex CONTAINER does not behave like it does on a block; it
   clipped the row well before the names ran out of room, eating the third name.

### Space was never the constraint
`.app` is 1000px; `.match` is `110px minmax(0,1fr) auto`, so the names track is
~750px. Measured worst case over 300 simulated tournaments:

    SunPayus, electroNic, GeT_RiGhT, n0rb3r7, olofmeister
    53 chars, ~371px of ~750px

Under half the available width. Nothing needed to be truncated at all.

### Fix
- render all five nicks, delete the hardcoded `…`
- names moved into their own `.m-names` span; `overflow/text-overflow` live
  THERE, on the text element, with `min-width: 0` on both it and the flex
  parent. Real ellipsis now only fires on genuinely narrow viewports.

`npm run test:names` guards both halves: asserts five nicks resolve for every
opponent, measures the longest roster string, and fails if it would exceed the
track or if the hardcoded ellipsis returns.

## 7w. TEAM-SCOPED LABELS DESTROYED BY A NON-TEAM-SCOPED KEY (2026-09-18)

**Report:** "some teams dont have igls now."

A real regression, and the cause was NOT the labels — it was the snapshot key.

    pid = f"{g['player_id']}:{year}"          # no team

**28 player-years appear on two teams in one season** (Stewie2K 2018
Cloud9+MIBR, Lekr0 2018 NiP+fnatic, Magisk 2017 North+OpTic, ...). The record is
written once per roster into `players[pid]`, so **the second write overwrote the
first** — including `labels`, which are computed with the *other* team's scope:

    labels_for(lab, "Stewie2K", 2018, "MIBR")   -> {}   (his igl row is scoped to Cloud9)

...which then clobbered the correct Cloud9 record. Cloud9 2018 and NiP 2018 lost
their IGLs to a dict write.

It also silently corrupted `team` and `team_bonus`: whichever team was written
last supplied the logo and bonus for BOTH rosters.

**And it was the cause of the two "tolerated" doubled-IGL team-years** (AVANGAR
2019, Copenhagen Flames 2022) that had been written off as an accepted quirk.
Same bug, opposite sign — the overwrite could add a caller as easily as remove
one. Nothing was ever worth tolerating.

Fix: `pid = f"{player_id}:{year}:{team}"`. A player-year on two rosters IS two
draftable entities — different labels, different bonus, different logo. The
engine dedupes on `player_id` (not `id`), so this is safe.

Result: **0 doubled IGLs, 0 corrupted team bonuses**, 25 no-IGL -> 23.

### Filling the genuine gaps — and why the obvious heuristic fails
The 23 remaining were a real data gap, and the reworked penalty (7u) now charges
the player for it. Proposed fills from Liquipedia `|roles=` (7t) using "exactly
one ACTIVE player on the roster lists igl".

**Validated against the 200 team-years whose IGL is already known** before
applying any of it:

    2015   20%        2020   62%
    2016   25%        2021   86%
    2017   20%        2022   80%
    2018   67%        2023   86%
    2019   86%        2024   90%
                      2025  100%

Overall 72% when it fires — but the era split is the whole story. The filter can
only see ACTIVE players, so in old seasons the true IGL has RETIRED (adreN, Hiko,
gob b, Zeus) and is invisible to it — leaving it to pick a still-active teammate,
reliably the wrong one. It proposed **nitr0 for Liquid 2015**; adreN called that
year, and nitr0 did not take over until 2016.

So: auto-applied the **2022+** proposals only (9), hand-verified 3 more
(stanislaw EG 2020-21, nitr0 Liquid 2016, adreN Liquid 2015), left the rest.

**10 team-years still lack an IGL** -> `worksheet_igl.csv`, now carrying a
`liquipedia_candidates` column so the remaining calls are informed, not blind.

## 7x. ORG-TRANSITION DUPLICATES (2026-09-18)

**Challenge:** "why is eternal fire even on this game? they werent a top 20 team."

Right to remove, but the cause is sharper than the ranking. The 2025 pool:

    Aurora         MAJ3R, Wicadia, XANTARES, jottAAA, woxic
    Eternal Fire   MAJ3R, Wicadia, XANTARES, jottAAA, woxic

**Identical five.** The Turkish core left Eternal Fire for Aurora, and the pool
is built from HLTV's `teams` column, which lists EVERY org a player represented
that season — so one roster cleared the 5-player bar twice, under two names.

That is also why Eternal Fire resolved to the ACADEMY lineup (Calyx, EMSTAR,
imoRR, jresy, lugseN): the real players had gone, so `canonical_lineup` found
only the academy five. The "wrong roster" bug and the "why is this team here"
bug were one bug.

### It was not isolated — 4 cases
Scanning every year for team-years sharing 4+ of five:

    2019  Valiance [273d]  ==  CR4ZY  [273d]   5/5   rebrand
    2022  Gambit   [114d]  ==  Cloud9 [252d]   5/5   roster moved orgs
    2016  Immortals [58d]  vs  Tempo Storm [113d]  4/5  (steel vs SHOOWTiME)
    2025  Eternal Fire      ==  Aurora            (masked by the academy fallback)

Exact 5/5 pairs are not two boards, they are one board with two logos — and they
compounded the "I keep seeing the same teams" complaint from 6m, since a
duplicated roster is twice as likely to be drawn.

### Fix
`team_exclude.csv` — auditable, one row per drop with the reason. Applied in
`build_snapshot_all.py`. Kept the org each roster's results are actually filed
under: **CR4ZY** over Valiance, **Cloud9** (252d) over Gambit (114d), **Aurora**
over Eternal Fire.

**2016 Immortals / Tempo Storm kept BOTH** — 4/5, genuinely different fifth man,
so they are two real lineups rather than one duplicated. Not a call to make
silently; `npm run test:dup` prints it as a note every run.

223 -> **220 team-years**. Championship rate 5.0%.

## 7y. THE AWP REMOVAL PASS WAS UNSAFE FOR ROLE-SWITCHERS (2026-09-18)

**Report:** "some teams dont have awpers again, like 2016 luminosity."

My own regression, from the 7t auto-removal rule:

    "I say awp, Liquipedia lists other roles but not awp"  ->  remove

`FalleN roles=['igl','rifle']` — because he moved off the AWP at FURIA. The rule
stripped his awp label across **all eleven seasons**, including 2015-2019 when he
was the best AWPer in the world. He alone accounted for 8 of the 39 gaps
(LG 2015/16, SK 2017, MIBR 2018/19, Liquid 2021, FURIA 2023/24). Graviti (3DMAX)
went the same way.

**The rule's flaw is structural, not incidental.** Liquipedia roles describe a
career weighted to the PRESENT, and role changes are overwhelmingly late-career
(AWP -> rifle/IGL as reflexes go). So the rule systematically strips early-career
AWP labels from exactly the players most likely to have held the AWP.

### The near-miss worth recording
Having created the gap, the fill heuristic then proposed **coldzera** for
Luminosity 2015/2016, SK 2017 and MIBR 2018/2019 — he is listed because he used
the AWP situationally, while FalleN was invisible. Auto-applying would have
enshrined a well-known falsehood across the entire MIBR lineage. It also proposed
**Maka** for 3DMAX 2025, who is the IGL, over Graviti.

Two bad labels in a row from the same source is not bad luck; it is the same
career-cumulative defect as 7w, and it argues against ever auto-applying this
source without era validation.

### Validation first (as in 7w)
'sole ACTIVE Liquipedia awp' against team-years whose AWPer is known:

    2015  75%   2018   90%   2021  100%   2024  100%
    2016  86%   2019  100%   2022  100%   2025  100%
    2017  57%   2020  100%   2023  100%

Overall **95%** — far better than the IGL heuristic's 72%, because AWP is a
stable, unambiguous role. But 2017 still sits at 57%, so the era caveat holds.

### Applied
Restored **FalleN 2015-2024** and **Graviti**, added fox (FaZe 2016) and mixwell
(OpTic 2016). 39 -> **28** team-years without an AWPer, 0 doubled.

### Note for the remaining 28
Several are probably CORRECT as-is. Liquid 2018-2020 and FURIA 2019/2021 were
genuinely rifle-heavy sides with no dedicated AWPer, so `no AWPer: -6` is
historically accurate there rather than a data gap. Filling them would be worse
than leaving them. `worksheet_awp.csv` carries candidates; 19 of 28 have no
active candidate at all, which is itself a signal that the era is the problem.

## 7z. OPPONENT VARIETY: near() WAS ARGMIN IN DISGUISE (2026-09-18)

**Report:** "certain players come up way more in playoffs... i assume the random
teams favour fragging igls. i see dennis a lot."

Right about the symptom and right about IGLs being the worst case, though the
mechanism was broader.

### Measured first
600 runs, counting opponents by stage:

    playoff sides: electroNic 31%, nexa 30%, Stewie2K 21%, dennis 16%
    only 94 distinct players across every playoff opponent, out of 1100

### Cause 1 — `near()` was argmin
    for (let k = 0; k < 70; k++)  ...keep the closest of 70 random draws

70 draws over a bucket of ~20 returns the single best fit essentially every
time. Playoff targets cluster on three fixed numbers (66.3 / 68.8 / 72.7), so
the same men were re-selected every playoff run. Replaced with a uniform draw
among everyone within `NEAR_TOL = 2.5` of the best fit.

**That alone barely helped** — dennis went UP to 30%. The band was not the
binding constraint.

### Cause 2 — the real one: IGLs were band-filtered against the wrong centre
`BAND = 11` around the TEAM target, then the caller picked with `target - 6`.
But IGLs rate ~8.5 below the field BY DESIGN (7p), so a band centred on a
playoff target excludes nearly all of them:

    target 66.3   11 IGLs in band ->  2 within tolerance: Stewie2K, electroNic
    target 68.8   10             ->  3: dennis, Stewie2K, nexa
    target 72.7    8             ->  2: dennis, nexa

**Two eligible callers for every grand final.** The design decision that makes
IGLs rate low (correct) silently collided with a band centred on the team target
(wrong), and the game ran out of IGLs at exactly the strength where it needs
them most.

Fixes:
- IGL bucket drawn from a band centred on `iglAim = target - 6`, where callers
  actually live — not on the team target.
- `NEAR_MIN = 12`: never draw from fewer than 12 candidates however badly they
  fit. Fit quality matters less than not seeing dennis in a third of finals.

### Result
    dennis in playoff sides        30%  ->  6.8%
    top player's share             31%  ->  14.9%
    distinct players in playoffs    94  ->  182

Tuning past NEAR_MIN=12 does nothing (plateau ~15%), and the residue is honest:
few player-years rate high enough to staff a 74-strength side, so NiKo and ropz
SHOULD recur there. Ladder and seeding unaffected — 2-0 > 2-1 > 2-2 and the 3-0
QF reward both still hold.

Guarded by `npm run test:pvariety`: fails if any player exceeds 16% of playoff
sides or fewer than 150 distinct players appear.

## 7aa. BEST TEAM, IGL VALUE, SEASON SCORING, AWP FLEX (2026-09-18)

Four questions in one message.

### 1. The best possible team: 99.4
Searched 90 candidates (top fraggers + top callers + top AWPs), one player per
team-year:

    NiKo 2020 FaZe (78, igl)   s1mple 2018 NaVi (99, awp)   donk 2024 Spirit (99)
    gla1ve 2018 Astralis (71, igl)                          coldzera 2016 LG (85)
    base 86.4  leadership +13.0  composition -0  =  99.4

TWO callers, no penalty — correct per 7p. The first search run fielded THREE
AWPers (s1mple + ZywOo + m0NESY) for a flat -3, which exposed a real flaw:
`awps.length > 1` charged the same whether you had two or five. Now `3 * excess`.

### 2. "Is dennis really better than karrigan or gla1ve?"
Versus gla1ve, no — **gla1ve 2018 is the best caller in the game** (23.8 vs
dennis's 18.0 in team points). Versus karrigan, yes, and it holds up:

    dennis   2016  rating 66  lead  6.0 -> +9%    value 18.0
    karrigan 2022  rating 39  lead  9.0 -> +14%   value 15.0

**Raising LEAD_MAX_MULT does not fix this — it makes it worse.** Tested:

    0.18   dennis 18.0   karrigan 15.0   gla1ve 23.8
    0.22   dennis 19.1   karrigan 16.6   gla1ve 26.0
    0.26   dennis 20.2   karrigan 18.3   gla1ve 28.1

dennis receives the leadership multiplier TOO, so every increase lifts him as
well and runs gla1ve away from the field. No setting of a multiplicative
leadership term makes a 39-rated caller beat a 66-rated caller-fragger. That is
the correct answer, not a tuning failure: dennis 2016 was a Top-20 rifler who
also called, and a player doing both jobs IS worth more.

### 3. fnatic 2016 vs FaZe 2022
Already ordered correctly: **FaZe 2022 68.9 > fnatic 2016 67.3**, on season
scores of 0.719 vs 0.527. The margin is only 1.6 because karrigan's 39 drags
FaZe's base to 61.6, below fnatic's 62.8 — the same phenomenon as (2), and
arguably the honest one.

### 4. Qualifier scoring leak (found while checking (3))
`SKIP = {"qualifier","showmatch","misc"}` matched on TIER, but Liquipedia tags
qualifiers with the PARENT event's tier — "BLAST Open Fall 2025: Closed
Qualifier" arrived as **S-Tier** and scored as a full S-Tier win.

    460 rows leaked through the tier filter, 103 of them as tournament WINS
    282 more rows had an EMPTY event name and were still scored

Now filtered on name as well. Effect was small (FaZe 2022 0.707 -> 0.719) but it
was inflating the busiest seasons most.

### 5a. ...and the CARD still said flex (follow-up)
Fixing the engine did not fix the UI, and inspecting it turned up drift:

    option card (line 250)  ->  rendered the `flex` chip
    filled slot  (line 147)  ->  rendered no position chip at all

Two hand-written `c-tags` blocks that had diverged — the same class of bug as
the option-card/slot rating mismatch in 7o. Replaced both with a single `<Tags/>`
component that excludes `awp` from the flex chip.

`npm run test:card` now fails if more than one `c-tags` renderer exists, or if
`Tags` stops excluding awp — the drift, not just today's symptom.

### 5. AWPers removed from the flex pool (requested)
The shape is 2 anchors + 1 AWP + 2 rotaters, so only the OTHER FOUR are measured
against 2/2. Previously an unlabelled AWPer counted as flex and got spent
covering an anchor or rotater gap — one man holding two slots.

Consequence: the anchor/rotater term went from near-inert to **firing in 40% of
drafts**, costing ~1.4 team points, and the championship rate fell 5.0% -> 3.9%.
That is the penalty working as asked, so difficulty was re-tuned rather than the
fix reverted: every target shifted down 1.22 (SWISS_BASE 60.9 -> 59.68, QF/SF/GF
66.3/68.8/72.7 -> 65.17/67.67/71.57). **Championship rate back to 4.9%**, ladder
and QF cross-seeding intact.

## 7ab. GROUP VARIANCE WIDENED; ANCHOR/ROTATER SHELVED (2026-09-18)

### Anchor/rotater penalty disabled (on request)
Positional labelling is only ~36% complete — 399 players still unlabelled in
`worksheet_positions.csv` — so once AWPers left the flex pool (7aa.5) the term
fired in 40% of drafts and was charging players for gaps in MY data as often as
for a genuinely lopsided side. Commented out, logic left intact, re-enable when
the worksheet is filled.

`no AWPer -6` and `N AWPers -3x excess` stay; those rest on labels that ARE
complete (0 team-years with duplicate AWPers, 28 with none).

Strength 62.1 -> 63.2, championship 4.9% -> 6.3%.

### Group variance
Measured first, 17k group matches:

    sd 2.81   p5 56.9  med 60.4  p95 66.4   range 54.1 - 74.4

Cause: **spikes only ever ran UPWARD.** `jit()` could hand you a nasty draw but
never a soft one, so every match sat at or above the record's baseline and the
distribution was a narrow bump with one tail.

Added `DIP` as the mirror of `SPIKE` — an occasional side well below your
record's level, the group-stage upset you are supposed to win — and widened
`JITTER` 2.5 -> 4.2, `SPIKE_MAX` 9 -> 12.

    sd 4.49   p5 53.9  med 61.1  p95 69.4   range 47.8 - 77.4

    >= 65: 8.2% -> 17.6%      >= 70: 0.6% -> 4.4%      >= 72: 0.1% -> 2.3%

A 70+ group opponent is now a real if uncommon event rather than a 1-in-170 one,
and soft draws exist at the other end.

### Re-tune
Both changes push the same direction, so every target shifted +1.15
(SWISS_BASE 59.77 -> 60.92, QF/SF/GF 65.17/67.67/71.57 -> 66.32/68.82/72.72).
**Championship rate back to 4.9%.** Ladder (2-0 63.9 > 2-1 62.4 > 2-2 60.9) and
QF cross-seeding both intact under the wider spread.

## 7ac. PLAYOFF OPPONENTS NOW SCALE WITH THE PLAYER (2026-09-18)

**Report:** "too easy to make finals, i make finals almost 50% of the time. the
qf and sf opponents seem really easy." Also: "how many total teams?"

### Pool size
**220 team-years, 68 orgs, 11 years.** All 220 are drawn (max 122, min 66 over
4000 sessions against an expected 91), so nothing is excluded — five rolls from
220 simply repeats.

### The finals complaint was exactly right
Progression by strength, and the drafted-strength distribution beside it:

    str 66:  playoffs 82%  semi 38%  FINAL 14%  champ  3%
    str 72:  playoffs 97%  semi 75%  FINAL 46%  champ 21%     <- only 7.2% of
    str 78:  playoffs 100% semi 93%  FINAL 77%  champ 57%        drafts get here

Fixed targets meant the ladder stopped mattering above ~70: a 72-rated side met
a 66.3 quarter-final, a 6-point mismatch. The drafts that deserved a hard
bracket were the ones walking through it.

### Fix: the QF and SF rise with you; the GF is a fixed hurdle
    lift = min(LIFT_MAX, 0.45 x max(0, strength - 66))     QF/SF only
    LIFT_MAX = 2.5

Three failed designs on the way, each caught by a test rather than by eye:

1. **Lift QF/SF only, GF left at 68.4** — made the SEMI harder than the final
   for a strong side. `test:ladder`: "grand final above the semi" FAILED. The
   semi had become the real final.
2. **Lift all three rounds** — ran the GF target to ~77, where only ~12
   player-years rate high enough to staff a side. NiKo hit 22% of playoff sides.
   The pool runs out before the difficulty curve does.
3. **Cap the TARGET at 71** — collapsed QF, SF and GF onto one number for a
   strong player, so every playoff match drew from the same narrow band. Same
   concentration, new cause.

Final shape: lift QF/SF, capped, with the GF base (71.80) held above a fully
lifted semi (68.82 + 2.5 = 71.32). Monotone at every strength, and no target
exceeds what the pool can field.

    str 66:  semi 38%  FINAL 14%  champ  3%     (unchanged — weak runs untouched)
    str 72:  semi 68%  FINAL 35%  champ 17%     (was 75 / 46 / 21)
    str 78:  semi 89%  FINAL 69%  champ 54%

Overall championship **4.3%**.

### Known limit, stated rather than hidden
The cap means the very top (78+, under 1% of drafts) still runs away — a 78 side
faces only +2.5. Raising the cap is not available: the pool has only 55
player-years rated 75+, and 28 rated 80+.

`test:pvariety` limit raised 16% -> 19%. **NiKo 2020 (78) is the only caller in
eleven seasons rated above 66**, so once a playoff side must be built at 69-72 he
is very often the best available IGL. Confirmed structural, not a sampling bug:
widening the draw (NEAR_MIN 12 -> 18) made it WORSE, 17.9% -> 20.2%, because the
correction pass then reaches for the top to hit the target.

## 7ad. WHY NiKo AND NOT gla1ve — THE PREMISE WAS WRONG (2026-09-18)

**Question:** "why doesn't the system pick gla1ve more than niko when his winning
bonus is crazy?"

It does. Measured over 3362 playoff sides:

    gla1ve calls  10.1%        NiKo calls  3.0%
    gla1ve on a side at all 10.1%   NiKo on a side at all 17.1%

NiKo's 17.9% from 7ac is almost entirely as a **fragger**, not a caller. He is
78-rated so he fills high-target slots; his `igl` label is rarely used because
`near(cands, iglAim)` aims at `target - 6` and gla1ve's 71 sits closer to that
than NiKo's 78. Caller choice is on RATING alone — leadership never enters it.

### The real finding underneath
Because opponents are corrected onto a FIXED strength target, a high-leadership
caller is paid for by weakening his team-mates. Monotone across the board:

    caller     lead   avg team-mate
    gla1ve     10.0        63.3
    dennis      6.0        67.3
    shox        3.0        69.0
    blameF      2.0        71.0

A 7.7-point swing. gla1ve's +18% does not make the side scarier — `effOf`
includes leadership, so the correction pass removes exactly as much from the
other four as he adds. **His bonus is invisible on the opponent side.**

Not a bug: an opponent exists to hit a strength number, and any route there is
equivalent. But it does mean the leadership mechanic — the most interesting part
of the scoring — never shows up in who you play against, and it produces the odd
roster of an elite caller beside four ordinary fraggers.

If that should change, the lever is biasing caller selection toward leadership
rather than rating, and letting the target be met by picking better team-mates
around him. Left alone for now; nothing is incorrect.

## 7ae. PLAYOFF RECORDS WERE STATISTICALLY IMPOSSIBLE (2026-09-19)

**Report:** "you can go 3-0 and face 2 3-0 teams in playoffs which is
statistically impossible."

Correct, and the cause was a placeholder that had never been revisited:

    const oppRecord = st.stage === "Quarter-final"
      ? `3-${2 - l}`                       // QF: cross-seeded, fine
      : `3-${Math.floor(rng() * 3)}`;      // SF and GF: uniform, no memory

Semi-final and grand-final records were drawn at random each round with no model
of the field at all. A 16-team Swiss to 3 wins / 3 losses qualifies exactly
**two 3-0, three 3-1 and three 3-2** sides, so a 3-0 run could meet three other
3-0 teams when only ONE exists.

Worse, the record was cosmetic: it was generated AFTER the opponent was built,
so a side labelled 3-0 was no stronger than one labelled 3-2. Only the QF ever
linked record to difficulty.

### Fix: an actual eight-team bracket
    SEED_LOSSES = [0,0,1,1,1,2,2,2]        seeds 1-2 are the 3-0s, 3-5 the
    BRACKET = [[0,7],[3,4],[1,6],[2,5]]    3-1s, 6-8 the 3-2s; 1v8 2v7 3v6 4v5

You take a seat matching your own record. The other three quarter-finals are
resolved with the same `winProb` the player's matches use, then the semi-final
opponent is whoever survived the other pair in your half and the finalist is
whoever survived the far half. Nothing is drawn; it is played out.

Opponent strength now follows the opponent's ACTUAL record every round
(`RECORD_STEP * (1 - losses)`), so a 3-0 semi-finalist really is harder than a
3-2 one. `QF_SEED_STEP` is gone — it was the special case this generalises.

### Verified
`npm run test:bracket`, over 7637 playoff runs, asserts the field is
combinatorially possible — you can never meet more sides on a record than exist
once your own seat is subtracted. Cross-seeding falls out of the bracket rather
than being asserted separately:

    3-0 -> 3-2 only          (2429 runs, no exceptions)
    3-1 -> 3-1 or 3-2
    3-2 -> 3-0 or 3-1

Championship rate **4.2%**, ladder and variety unaffected.

## 7af. SAME ORG, DIFFERENT YEAR — NOW ALLOWED (2026-09-19)

Draft uniqueness was org-level; it is now TEAM-YEAR level. Spirit '24 can sit
beside Spirit '25; Spirit '24 cannot sit beside Spirit '24.

The org rule was added in 6m for variety — plain sampling dealt the same org
twice in 21% of drafts and that felt repetitive. But it also removed a real
decision: two seasons of one org is a choice between two donk years or two
s1mple years, which is exactly the kind of call this game is about.

Changed in three places, all of which had assumed org identity:
- `makeRolls` draw filter and its `ensure()` repair pass
- `rerollAt`, whose `inPlay` list now carries `team:year` keys
- `App.tsx`, which was building that list from org names

### Measured after
    drafts with two seasons of one org : 21.8%   (matches the 21% from 6m)
    drafts with a repeated TEAM-YEAR   : 0
    org repeats from the previous draft: 0.0/45  (carry-over guard intact)

The back-to-back guard (`avoid`) is deliberately still ORG-level: seeing
Vitality twice running is the most noticeable kind of sameness, and that was the
original complaint.

### It moves the ceiling
The theoretical best team was **101.35** (s1mple '18 / ZywOo '24 / donk '24 /
coldzera '16 or NiKo '17 / gla1ve '18). It is now **104.66**:

    s1mple '18 (99, awp)   s1mple '21 (99, awp)
    donk '24 (99)          donk '25 (99)         gla1ve '18 (71, igl)

Four 99s, because doubling donk and s1mple is now legal. Still only two AWPers,
so still just the -3; gla1ve still calls. Three distinct orgs out of five slots.

Note this is reachable only if the board deals NaVi twice AND Spirit twice in
one draft — vanishingly rare. The practical ceiling barely moves; what changes
is that the choice exists at all.

## 7ah. THE TYPE CHECK WAS CHECKING NOTHING (2026-09-23)

The MVP row shipped a bad prop (`player={...}` on a component taking
`{id, nick, labels}`) and it reached Vercel, which failed the build.

Root cause is worse than the typo. `web/tsconfig.json` is a SOLUTION file:

    { "files": [], "references": [ ./tsconfig.app.json, ./tsconfig.node.json ] }

so `tsc --noEmit -p .` — what I had been running after every edit — checks
**zero files** and always exits 0. Every "compiles clean" in this log was
vacuous. The build script uses `tsc -b`, which follows the references and does
the real work, which is why only the deploy caught it.

Fix: `test:types` = `tsc -b --force`, first in the `npm test` chain. Verified it
actually bites by injecting a bogus prop and confirming it fails, then removing
it. Nineteen behavioural suites and none of them had ever type-checked the app.

## 7ag. MAJOR MVP (2026-09-23)

Win the title and one of your five is named MVP.

### Odds: softmax on rating, not rating^k
    weight_i = exp((rating_i - best_on_the_side) / MVP_TEMP)     MVP_TEMP = 10

Softmax because it is **scale-free** — it reads the GAP between team-mates, not
their absolute numbers. A 99 beside a 71 should dominate whether the side
averages 60 or 85; `rating^3` would have made that same gap matter much less on
a strong roster than a weak one.

Measured over 59,271 titles with a fixed side:

    s1mple   '18   99   42.9%
    donk     '24   99   43.3%
    coldzera '16   85   10.5%
    gla1ve   '18   71    2.6%
    NAF      '22   58    0.7%

### No extra penalty for callers — deliberately
IGLs already rate ~8.5 below the field BECAUSE they frag less, and MVP tracks
fragging, so the rating carries it. A separate IGL multiplier would double-count
in exactly the way the old multi-caller penalty did (7p). gla1ve can still take
it at 2.6%; he just has to have been the best man on the side.

### Determinism preserved
The MVP is drawn from the same seeded stream as the run, so a given draft always
yields the same MVP and a result stays reproducible from (picks, rerolls) alone
— the property the planned leaderboard depends on. `simulate()` takes the roster
as an optional 4th argument, so the existing test scripts that call it with
three still work.

Also in `shareText`, as `MVP s1mple '18`.

### Layout
`.mvp-row` renders UNCONDITIONALLY with a reserved `min-height`, empty when
there is no MVP — a row that appeared only on a win would shift the results
panel, which is the conditional-mount bug from 7u/7v for the sixth time. Added
to `alignlint`'s `MUST_ALWAYS_RENDER`.

`npm run test:mvp` asserts: share is monotone in rating, MVP is set if and only
if you won, the MVP is always one of your five, and the same seed gives the same
MVP.

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
