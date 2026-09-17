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

## Scoring

    strength = mean(5 ratings)
             + IGL leadership   (his trophies up to that year, buffing the OTHER four)
             + chemistry        (largest same-nationality bloc: 3→+2, 4→+4, 5→+7)
             − composition      (no IGL −5, two callers −2, no AWP −6, two AWPs −2)

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
