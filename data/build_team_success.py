#!/usr/bin/env python3
"""Per-(team, year) success -> bonuses, from that season's results ONLY.

ONE source, two magnitudes:
    every player   up to +TEAM_MAX to their own rating
    the IGL        buffs the OTHER FOUR by up to +IGL_MAX

Both read the same season. Career pedigree was dropped: it double-counted (an
IGL's 2018 results ARE his team's 2018 results) and Liquipedia's achievements
table caps at 10 rows, which silently judged apEX 2025 on 7 events while giving
pronax 2015 all 10, and scored FalleN 2016 as +8 in a year he won two Majors.

Scoring a season:
  * Qualifiers and showmatches are ignored — they are not results.
  * Placement x tier gives a season TOTAL and, divided by events entered, a RATE.
    The score is a GEOMETRIC blend of both: sqrt(total x rate).

    Neither alone works. Pure total rewarded attendance — 2015 had a bloated
    calendar and Virtus.pro 2015 entered 38 events, won 7 (18%) and scored
    5th-best all-time. Pure rate over-rewarded light schedules — NaVi 2021
    (18 events) outranked fnatic 2015 and Astralis 2018.

    Geometric rather than a weighted average, because an average lets a huge
    total paper over a poor rate: linear blending put Virtus.pro 2015 back at
    #7. Multiplying means a season needs BOTH volume and quality.
  * Rate also handles "entering and not doing well" without a separate penalty —
    a poor result adds to the denominator and nothing to the numerator. A penalty
    alone would NOT have fixed fnatic 2015: 29 top-4s in 32 events, one finish
    below 9th. Their issue was volume, not bad results.
  * A floor of MIN_EVENTS stops a 2-event season looking elite on rate alone.
"""
import collections, csv, json, math, re
from pathlib import Path

D = Path(__file__).parent
TIER = {"s-tier": 10.0, "a-tier": 5.0, "b-tier": 2.0, "c-tier": 1.0, "points": 3.0}
MAJOR = 30.0     # a Major is not just another S-Tier event — it is the single
                 # most prestigious result in CS, and at 22 a Major-winning
                 # season (Spirit 2024) ranked 17th

# Majors before 2017 were not named "Major" — DreamHack Winter, ESL One
# Katowice/Cologne, MLG Columbus. Without this, NiP 2016 (four ordinary S-Tier
# wins) tied Luminosity 2016 (two MAJORS) at 63.1 vs 63.2, and both took +15.
EARLY_MAJORS = [
    "dreamhack winter 2013", "ems one katowice 2014", "esl one cologne 2014",
    "esl one: cologne 2014", "dreamhack winter 2014",
    "esl one katowice 2015", "esl one: katowice 2015",
    "esl one cologne 2015", "esl one: cologne 2015",
    "dreamhack open cluj-napoca 2015", "dreamhack cluj-napoca 2015",
    "mlg columbus 2016", "esl one cologne 2016", "esl one: cologne 2016",
    "mlg major championship: columbus 2016",
    "esl major series one katowice 2014", "ems one katowice 2014",
]

# An RMR is a QUALIFIER for a Major, not a Major — but its name contains
# "Major" ("PGL Major Copenhagen 2024: European RMR"), so a bare word match gave
# it the full 22-point Major weight instead of A-Tier's 5.
# "ESL Major Series" / "ESL Major League" are unrelated events that merely
# contain the word — they are not CS Majors. (EMS One Katowice 2014 IS, and is
# listed in EARLY_MAJORS, so it still matches.)
NOT_MAJOR = re.compile(
    r"\brmr\b|qualifier|regional major ranking|closed|open\s+qual"
    r"|major series|major league", re.I)

def is_major(name):
    n = (name or "").strip().lower()
    if not n: return False
    if NOT_MAJOR.search(n): return False
    if re.search(r"\bmajor\b", n): return True
    return any(m in n for m in EARLY_MAJORS)
SKIP = {"qualifier", "showmatch", "misc"}
# Value by finishing position. Ranged placements ("1st - 4th", "5th - 8th") mean
# the bracket was not played out, so they score at the WORSE end — a bare ^1st
# match gave "1st - 4th" full winner's credit, which alone put Envy 2015 (three
# such finishes) above Astralis 2018 as the best season on record.
VALUE = {1: 1.0, 2: 0.55, 3: 0.32, 4: 0.26, 5: 0.14, 6: 0.11,
         7: 0.09, 8: 0.09, 9: 0.04, 10: 0.04, 11: 0.03, 12: 0.03}

# Calibrated against the spread of HLTV form across team-years (sd 4.2) and the
# best possible single-slot upgrade (+8.8 team points). At 6/15 achievements are
# ~53% of the variation in team strength — slightly ahead of form, which is the
# point: silverware should count. Past ~8/20 results swamp form entirely.
TEAM_MAX = 6      # to every player
IGL_MAX = 12      # to the other four, via the IGL (capped down from 15)
MIN_EVENTS = 8    # rate floor: fewer entries than this are judged as if 8
TOTAL_REF = 130.0 # a season total this big is a maximum-volume campaign.
                  # 205 was a 2015 ARTEFACT — fnatic's bloated-calendar season.
                  # Every other year's best total is 55-149, so no modern side
                  # could reach the volume cap and 2015 sat permanently on top.
RATE_REF  = 7.5   # points-per-event this high is a maximum-quality campaign
W_TOTAL   = 0.5   # geometric weight on volume; 1 - this goes on rate

def place_mult(p):
    """Worst position named in the placement string."""
    nums = [int(n) for n in re.findall(r"(\d+)(?:st|nd|rd|th)", (p or "").lower())]
    if not nums: return 0.0
    return VALUE.get(max(nums), 0.0)

def season_raw(rows, year):
    """Geometric blend of season total and points-per-event, on 0..1."""
    tot, entered = 0.0, 0
    for r in rows:
        if r["date"][:4] != str(year): continue
        tier = (r["tier"] or "").strip().lower()
        if tier in SKIP: continue
        # SKIP matches on TIER, but Liquipedia tags plenty of qualifiers with
        # the PARENT event's tier — "BLAST Open Fall 2025: Closed Qualifier"
        # arrives as S-Tier and scored as a full S-Tier win. 460 rows leaked
        # through, 103 of them as tournament wins. Filter on the name too.
        name = (r.get("tournament") or "").strip()
        if not name: continue                      # 282 rows have no event name
        if NOT_MAJOR.search(name.lower()): continue
        entered += 1
        w = MAJOR if is_major(r.get("tournament")) else TIER.get(tier, 0.0)
        tot += w * place_mult(r["place"])
    if not entered or tot <= 0: return 0.0
    vol = min(1.0, tot / TOTAL_REF)
    rate = min(1.0, (tot / max(entered, MIN_EVENTS)) / RATE_REF)
    return (vol ** W_TOTAL) * (rate ** (1 - W_TOTAL))

if __name__ == "__main__":
    res = json.loads((D / "team_results.json").read_text())
    lineups = [r for r in csv.DictReader(open(D / "lineups_all.csv")) if r["lineup"]]

    raws = {}
    for r in lineups:
        raws[(r["label"], r["year"])] = season_raw(res.get(r["label"], []), r["year"])

    # FIXED benchmark, not the year's best. Scaling to each season's top side
    # meant a weak year inflated everyone: 2016's best (Luminosity, 75) is half
    # of 2018's best (Astralis, 145), so NiP 2016 — a decent, non-Major season —
    # sat at 86% of its year and drew +13, while the same raw score in 2018 would
    # be 45%. A fixed bar makes a great season score the same whoever else was
    # great.
    #
    # season_raw already returns 0..1, so the benchmark is simply 1.0.
    # (History: 130 clipped the whole elite tier — fnatic 2015
    # (203.8), Astralis 2018 (144.8) and NaVi 2021 (131.8) all scored +15 despite
    # fnatic's season being 55% bigger than NaVi's. Raising the bar lets great
    # seasons rank against each other instead of bunching at the cap; exactly one
    # season now reaches it.
    BENCHMARK = 1.0

    out = {}
    for (t, y), v in raws.items():
        # linear, not sqrt: sqrt over-rewarded mediocre seasons
        norm = min(1.0, max(0.0, v) / BENCHMARK)
        out[f"{t}:{y}"] = {
            "raw": round(v, 1),
            "norm": round(norm, 3),
            "team_bonus": round(TEAM_MAX * norm),
            "igl_bonus": round(IGL_MAX * norm),
        }
    (D / "team_success.json").write_text(json.dumps(out, indent=1, sort_keys=True))

    print(f"{len(out)} team-years -> data/team_success.json")
    print(f"fixed benchmark: {BENCHMARK:.0f}")
    c = collections.Counter(v["igl_bonus"] for v in out.values())
    print("igl bonus distribution:", dict(sorted(c.items())))
    print("\nbest seasons:")
    for k, v in sorted(out.items(), key=lambda kv: -kv[1]["raw"])[:10]:
        print(f"   {k:26} raw {v['raw']:6.1f} -> team +{v['team_bonus']} / igl +{v['igl_bonus']}")
    print("\nthe cases that prompted this:")
    for k in ("ENCE:2018", "ENCE:2019", "Astralis:2018", "Astralis:2020",
              "fnatic:2015", "Vitality:2025", "Luminosity:2016"):
        if k in out:
            v = out[k]
            print(f"   {k:26} raw {v['raw']:6.1f} -> team +{v['team_bonus']} / igl +{v['igl_bonus']}")
