#!/usr/bin/env python3
"""Turn raw HLTV per-year ratings into balanced 0-100 game ratings.

Three steps:
  1. shrink  - pull low-sample ratings toward that year's mean (empirical Bayes).
               Lowering minMapCount widens the pool but admits noisy ratings; a
               1.30 over 15 top-20 maps is not a 1.30 over 209. Shrinkage keeps
               those players draftable without letting variance decide the meta.
  2. z-score - normalize WITHIN each year. HLTV ratings are not comparable across
               eras (different formulas, different games).
  3. scale   - map to 0-100 for the draft UI.
"""
import csv, statistics as st
from pathlib import Path

D = Path(__file__).parent
K = 50          # shrinkage strength, in maps. rating is half-trusted at 50 maps.
PRIOR = 1.00    # HLTV rating of an average player

def build(src="ratings_merged.csv", out="game_ratings.csv"):
    rows = [r for r in csv.DictReader(open(D / src)) if r.get("rating")]
    for r in rows:
        r["_r"] = float(r["rating"])
        r["_n"] = int(r.get("maps_top20") or r.get("maps_all") or 0)

    by_year = {}
    for r in rows:
        by_year.setdefault(r["year"], []).append(r)

    out_rows = []
    for year, pool in sorted(by_year.items()):
        prior = st.mean(x["_r"] for x in pool)          # that year's actual mean
        for r in pool:
            n = r["_n"]
            r["_shrunk"] = (n * r["_r"] + K * prior) / (n + K) if n else prior

        mu = st.mean(x["_shrunk"] for x in pool)
        sd = st.pstdev(x["_shrunk"] for x in pool) or 1e-9
        for r in pool:
            n = r["_n"]          # re-read: do NOT reuse the loop var from above
            z = (r["_shrunk"] - mu) / sd
            out_rows.append({
                "year": year, "player_id": r["player_id"], "nick": r["nick"],
                "nationality": r["nationality"], "teams": r["teams"],
                "hltv_rating": f"{r['_r']:.2f}", "maps": n,
                "shrunk": f"{r['_shrunk']:.3f}", "z": f"{z:+.2f}",
                # 50 = average, ~10 points per standard deviation
                "game_rating": max(1, min(99, round(50 + 10 * z))),
            })
        print(f"{year}: {len(pool)} players, pool mean {prior:.3f}, sd {sd:.3f}")

    with (D / out).open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out_rows[0].keys()))
        w.writeheader(); w.writerows(out_rows)
    print(f"-> data/{out} ({len(out_rows)} rows)")
    return out_rows

if __name__ == "__main__":
    rows = build()
    print("\ntop 8 by game rating:")
    for r in sorted(rows, key=lambda r: -r["game_rating"])[:8]:
        print(f"  {r['game_rating']:3d}  {r['nick']:12} hltv={r['hltv_rating']} maps={r['maps']}")

    print("\neffect of shrinkage on a hypothetical 1.30 player, by sample size:")
    pool = [float(r["hltv_rating"]) for r in rows]
    prior = st.mean(pool)
    for n in (10, 15, 25, 50, 100, 209):
        s = (n * 1.30 + K * prior) / (n + K)
        print(f"  {n:3d} maps -> {s:.3f}   (raw 1.30, pool mean {prior:.3f})")
