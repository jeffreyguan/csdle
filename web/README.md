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

## Scoring

    strength = mean(5 ratings)
             + IGL leadership   (his trophies up to that year, buffing the OTHER four)
             − composition      (see below)

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

Ratings are HLTV, normalised **within each season** — Rating 1.0/2.0/3.0 are not
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
