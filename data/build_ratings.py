#!/usr/bin/env python3
"""Turn raw HLTV per-year ratings into balanced 0-100 game ratings.

Three steps:
  1. shrink  - pull low-sample ratings toward that year's mean. Lowering
               minMapCount widened the pool but admitted noisy ratings; a 1.30
               over 15 maps is not a 1.30 over 209.

               Trust is RELATIVE to the season and SATURATES:

                   weight = min(1, maps / season_median_maps)

               Relative, because map volume swings by calendar - 2015's median
               was 65 maps, 2016's was 152. An absolute constant (the old
               maps/(maps+50)) trusted a typical 2015 player 57% and a typical
               2016 player 75% purely because the schedule was busier.

               Saturating, because past a normal workload extra maps carry no
               extra information. The old form crept toward 1 forever, so 240
               vs 320 maps still moved the number. Now anyone at or above their
               season's median is taken at face value - half the pool.
  2. z-score - normalize WITHIN each year (HLTV ratings are not comparable across
               eras), using a TRIMMED standard deviation.

               The trim matters: elite players inflate the full SD, and a bigger
               SD divides everyone's delta down, so outliers suppress each other.
               donk 2024 sat +0.303 above his field and s1mple 2018 +0.305 above
               his — the same gap — yet donk scored 86 to s1mple's 90, purely
               because 2024 had three players above 1.28 and 2018 had one.
               sd(middle 90%) is near-identical across those years (0.0564 vs
               0.0576), so trimming removes the distortion without changing what
               a "typical" spread means.
  3. scale   - map to 0-100 for the draft UI.
"""
import csv, statistics as st
from pathlib import Path

D = Path(__file__).parent
# Full trust at this multiple of the season's median map count. 1.0 => a median
# workload is believed outright. Raise it to demand more evidence.
FULL_TRUST_AT_MEDIAN = 1.0

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
        maps_sorted = sorted(x["_n"] for x in pool)
        median_maps = maps_sorted[len(maps_sorted) // 2] or 1
        full = median_maps * FULL_TRUST_AT_MEDIAN
        for r in pool:
            w = min(1.0, r["_n"] / full) if full else 0.0
            r["_w"] = w
            r["_shrunk"] = w * r["_r"] + (1 - w) * prior

        shr = sorted(x["_shrunk"] for x in pool)
        mu = st.mean(shr)
        lo, hi = int(0.05 * len(shr)), int(0.95 * len(shr))
        sd = st.pstdev(shr[lo:hi]) or 1e-9      # trimmed: ignore the tails
        for r in pool:
            n = r["_n"]          # re-read: do NOT reuse the loop var from above
            z = (r["_shrunk"] - mu) / sd
            out_rows.append({
                "year": year, "player_id": r["player_id"], "nick": r["nick"],
                "nationality": r["nationality"], "teams": r["teams"],
                "hltv_rating": f"{r['_r']:.2f}", "maps": n,
                "trust": f"{r['_w']:.2f}",
                "shrunk": f"{r['_shrunk']:.3f}", "z": f"{z:+.2f}",
                # 50 = average. 7.5 pts per trimmed-SD keeps the familiar range
                # (~19-97); the trimmed SD is smaller, so the multiplier shrinks
                # to match.
                "game_rating": max(1, min(99, round(50 + 7.5 * z))),
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

    print("\ntrust vs workload (2018: median 135 maps):")
    prior = st.mean(float(r["hltv_rating"]) for r in rows)
    for n in (20, 40, 70, 105, 135, 200, 245):
        w = min(1.0, n / 135)
        print(f"  {n:3d} maps -> trust {w:.2f} -> raw 1.30 reads as "
              f"{w * 1.30 + (1 - w) * prior:.3f}{'   (full trust)' if w >= 1 else ''}")
