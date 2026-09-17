#!/usr/bin/env python3
"""Multi-label player archetypes: awp / igl / star / anchor.

awp, igl  -> curated (seeded from Liquipedia, confirmed by hand)
star      -> DERIVED: top-rated non-AWP on the roster, above the pool median
anchor    -> default, so every player carries at least one label
"""
import json, statistics as st
from pathlib import Path

D = Path(__file__).parent

def label(year=2018):
    snap = json.loads((D / "snapshot.json").read_text())
    inf  = json.loads((D / "roles_inferred.json").read_text())
    P    = snap["players"]

    med = st.median(p["rating"] for p in P.values())
    for p in P.values():
        f = inf.get(p["nick"], {}).get("field", [])
        p["labels"] = set()
        if "awp" in f: p["labels"].add("awp")
        if "igl" in f: p["labels"].add("igl")

    for t in snap["teams"]:
        roster = [P[i] for i in t["roster"]]
        # star = best on the team, era-adjusted. AWPers are eligible: s1mple and
        # device are awp AND star, which is exactly what multi-label is for.
        cands = sorted(roster, key=lambda p: -p["rating"])
        for p in cands[:2]:
            if p["rating"] >= med:
                p["labels"].add("star")

    # unlabelled = flex; no anchor default
        p["labels"] = sorted(p["labels"])
    return snap, med

if __name__ == "__main__":
    snap, med = label()
    P = snap["players"]
    print(f"pool median rating {med}\n")
    for t in sorted(snap["teams"], key=lambda t: -t["strength"]):
        parts = []
        for i in t["roster"]:
            p = P[i]
            parts.append(f"{p['nick']}({','.join(p['labels'])})")
        print(f"  {t['team']:19} " + "  ".join(parts))

    import collections
    c = collections.Counter(l for p in P.values() for l in p["labels"])
    print(f"\nlabel counts: {dict(c.most_common())}")
    print(f"players with >1 label: {sum(1 for p in P.values() if len(p['labels'])>1)}/{len(P)}")
    per = collections.Counter()
    for t in snap["teams"]:
        ls = [P[i]["labels"] for i in t["roster"]]
        per[("awp" , sum(1 for l in ls if "awp" in l))] += 1
        per[("igl" , sum(1 for l in ls if "igl" in l))] += 1
    print("\nper-team counts (label, n) -> how many teams:")
    for k in sorted(per): print(f"   {k} -> {per[k]}")
