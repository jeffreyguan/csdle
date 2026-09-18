# csdle — CS Mayhem

Draft a five-man Counter-Strike roster one player at a time, then simulate a run.

    npm install
    npm run dev          # http://localhost:5173
    npm test             # engine + render checks
    npm run sync-data    # re-copy ../data/snapshot.json after a data rebuild

## How a round works

Five rolls. Each deals a real historical `(team, year)` and you take exactly one
player from that roster. Feasibility is guaranteed by construction — at least one
roll offers an IGL and one offers an AWP — so no seed can deal an unwinnable hand.

**Two rerolls per draft.** Deterministic in `(seed, round, attempt)`, so a run is
still reproducible from picks + reroll counts alone. Rerolls deliberately do *not*
preserve the IGL/AWP guarantee — rerolling away your only caller is a real cost you
chose, and the composition penalty prices it.

## Assets

`public/logos/` — 68 org logos from Liquipedia, `license=fairuselogo`: trademarks
shown to identify the actual team (nominative use), not freely-licensed artwork.
Safer ground than player photos but still not a licence; revisit before commercial
use. `public/logos.json` maps team label → filename.

Player photos are **not** used. Every Liquipedia player image is `permission` with
copyright retained by the tournament organiser (ESL/BLAST/PGL), and Wikimedia
Commons — the only genuinely free source — covers just 23% of players and 9% of
player-years. Avatars are generated deterministically from the player id instead.

## Tournament

**Swiss stage** — play until 3 wins (advance) or 3 losses (out), so 3-5 matches.
The decider is Bo3. Opponents stiffen with your record. Then Bo3 quarter-final and
semi-final, and a **Bo5 grand final**.

**Every opponent is assembled** from real players to hit a strength target that
rises with how far you have gone — always exactly one AWPer and one IGL, and all
five within a band of each other so the side looks like a team. They have no name:
you face a roster, shown in full before each match.

Swiss pairs you against teams on **your own record** — 2-0 is a stiffer draw than
2-2 — and the quarter-final is **cross-seeded**, so a 3-0 run meets a 3-2 team
while a 3-2 run meets a 3-0. Opponent records are shown before each match.

Draws are heavy-tailed — 12% of opponents come from a long right tail, so a 70+
side is rare but possible, and likelier the better your record.

Measured for good play: 39% out in Swiss, **~5% champion**.

## Scoring

    strength = mean(5 ratings)
             + team success     (that season's results, +0-6 to every player)
             + HLTV Top 20      (+2 for #20 up to +5 for #1-3)
             + IGL leadership   (same season, MULTIPLYING the other four by up to
                                 +18% — a caller amplifies good players, he does
                                 not lift bad ones)
             − composition      (see below)

Cards carry two honour badges: `🏆×N` for S-Tier titles that season (gold when one
was a Major) and `HLTV #N` for a Top 20 placing.

Roles are `awp`, `igl`, `anchor`, `rotater` — all hand-curated. A player with no
positional label is **flex**. There is no derived `star`: it was a rating proxy
pretending to be a role.

Composition target is **2 anchors + 1 AWP + 2 rotaters**, plus an IGL — a soft
penalty (−2 per slot off), never a hard constraint. Unlabelled players are FLEX and
fill whichever slot is short, so partial positional labelling costs nothing.

**Only one IGL ever pays the leadership bonus** — the senior caller (highest
pedigree) leads, and it is never stacked. There is no extra penalty for a second
caller: IGLs already rate ~8.5 points below everyone else, so a second one drags
the roster mean on its own. Charging for it on top double-counted.

Ratings are HLTV, normalised **within each season** against a *trimmed* SD
(outliers otherwise inflate the spread and suppress each other) — Rating 1.0/2.0/3.0 are not
comparable across eras, so only the derived 0–100 number means anything.

## Does the constraint actually bind?

`npm run test:sim` drafts 400 seeds two ways:

    greedy-by-rating  ~8% championships
    constraint-aware ~16% championships

Twice the win rate for playing the constraints rather than the biggest number —
which is the entire design goal.

## Data

`public/snapshot.json` — 223 team-years, 1087 player-years, 2015–2025.
Built by the pipeline in `../data`. Rosters from Liquipedia (CC-BY-SA 3.0),
ratings derived from HLTV. See `../PLAN.md`.
