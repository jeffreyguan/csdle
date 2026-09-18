#!/usr/bin/env python3
"""Leadership score for IGLs, from tournament wins earned UP TO a given year.

Design decisions:
  * As-of-year, not career total. Drafting gla1ve 2016 should not hand you the
    2018-19 Astralis Grand Slam he had not won yet. It also makes era matter:
    unproven 2016 gla1ve and Grand Slam 2019 gla1ve become different picks.
  * Square-root, not linear or log. Linear lets the winningest leaders dominate;
    log1p over-rewards thin resumes (a 5-point resume scored +3 against an elite
    65-point resume's +8), so 60% of team-years clustered at +5 or above and the
    bonus stopped discriminating. sqrt keeps diminishing returns while preserving
    a real gap between a one-title IGL and a Grand Slam one.
  * The bonus applies to the OTHER FOUR players, never to the IGL himself.
    A personal bonus would stack on an already-high rating and push the draft
    back toward "pick the best available" - the exact failure mode we designed
    the constraints to avoid. Team-wide makes a low-fragging IGL worth taking.
"""
import json, math, re
from pathlib import Path

D = Path(__file__).parent

TIER_WEIGHT = {"s-tier": 5.0, "a-tier": 2.0, "b-tier": 1.0, "c-tier": 0.5}
MAJOR_WEIGHT = 10.0
SECOND_PLACE_FRACTION = 0.35
CAP = 60.0          # raw score treated as "maximum pedigree"
EXPONENT = 0.5      # 0.5 = sqrt. Higher concentrates the bonus at the elite end
                    # (fewer teams near max); lower flattens it.
MAX_BONUS = 12      # rating points added to each of the other four.
                    # Calibration: upgrading one slot from a median player (50)
                    # to the best in the pool (92) is worth 8.4 team-mean points.
                    # MAX=12 puts a maxed IGL at ~8.0 -- roughly parity with the
                    # best available star upgrade, so an elite leader is a real
                    # alternative to a star pick without strictly dominating it.
                    # Raise toward 16 to make the IGL the single biggest lever;
                    # raise EXPONENT to make top-tier pedigree rarer instead.

# Majors before 2017 were not called "Major": DreamHack Winter, ESL One
# Katowice/Cologne, MLG Columbus. A bare /\bmajor\b/ scored pronax's three
# Major wins as ordinary S-Tier events while crediting apEX's 10s in full.
EARLY_MAJORS = [
    "dreamhack winter 2013", "ems one katowice 2014", "esl one: cologne 2014",
    "esl one cologne 2014", "dreamhack winter 2014",
    "esl one: katowice 2015", "esl one katowice 2015",
    "esl one: cologne 2015", "esl one cologne 2015",
    "dreamhack open cluj-napoca 2015", "dreamhack cluj-napoca 2015",
    "mlg columbus 2016", "esl one: cologne 2016", "esl one cologne 2016",
]

def is_major(t):
    s = (t or "").strip().lower()
    if re.search(r"\bmajor\b", s): return True
    return any(m in s for m in EARLY_MAJORS)

def raw_score(results, upto_year):
    total = 0.0
    for r in results:
        y = int(r["date"][:4])
        if y > upto_year: continue
        place = (r["place"] or "").strip()
        if place.startswith("1"):   mult = 1.0
        elif place.startswith("2"): mult = SECOND_PLACE_FRACTION
        else:                       continue
        w = MAJOR_WEIGHT if is_major(r["tournament"]) else \
            TIER_WEIGHT.get((r["tier"] or "").strip().lower(), 0.5)
        total += w * mult
    return total

def score(results, upto_year):
    raw = raw_score(results, upto_year)
    norm = (max(0.0, raw) / CAP) ** EXPONENT
    return min(1.0, norm), raw

def bonus(results, upto_year):
    n, raw = score(results, upto_year)
    return round(MAX_BONUS * n), round(raw, 1), round(n, 3)

if __name__ == "__main__":
    ach = json.loads((D / "achievements.json").read_text())
    snap = json.loads((D / "snapshot.json").read_text())
    P = snap["players"]

    rows = []
    for t in snap["teams"]:
        igl = next((P[i] for i in t["roster"] if "igl" in P[i]["labels"]), None)
        if not igl: continue
        res = ach.get(igl["nick"], [])
        b, raw, n = bonus(res, t["year"])
        rows.append((t["year"], t["team"], igl["nick"], raw, n, b, t["strength"]))

    rows.sort(key=lambda r: -r[5])
    print(f"{'yr':5}{'team':18}{'igl':14}{'raw':>7}{'norm':>7}{'bonus':>7}{'base':>7}")
    for r in rows[:25]:
        print(f"{r[0]:<5}{r[1][:17]:18}{r[2][:13]:14}{r[3]:7.1f}{r[4]:7.3f}{r[5]:7d}{r[6]:7.1f}")
    import collections
    print("\nbonus distribution:", dict(sorted(collections.Counter(r[5] for r in rows).items())))
