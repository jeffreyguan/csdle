#!/usr/bin/env python3
"""Emit the labelling worksheet, ordered so the least work covers the most drafts.

Three label kinds are needed:
  pos  anchor | rotater   - positional; NO source has this (demo-level data), so
                            it is a judgement call. Unlabelled = flex, which costs
                            the player nothing, so partial labelling is safe.
  awp                     - the team-years currently scoring a silent -6
  igl                     - the team-years forfeiting the leadership bonus
"""
import csv, collections, json
from pathlib import Path
D = Path(__file__).parent

snap = json.loads((D / "snapshot.json").read_text())
P = snap["players"]

# how many roster slots each player occupies = how often they can be drafted
freq = collections.Counter()
for t in snap["teams"]:
    for i in t["roster"]:
        freq[P[i]["nick"]] += 1

have_pos = {p["nick"] for p in P.values()
            if "anchor" in p["labels"] or "rotater" in p["labels"]}

rows = []
for nick, n in freq.most_common():
    ex = next(p for p in P.values() if p["nick"] == nick)
    rows.append({
        "nick": nick, "slots": n, "nationality": ex["nationality"],
        "peak_rating": max(p["rating"] for p in P.values() if p["nick"] == nick),
        "existing": "|".join(l for l in ex["labels"] if l in ("awp", "igl")),
        "position": "",           # <-- fill: anchor or rotater
    })
out = D / "worksheet_positions.csv"
with out.open("w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

total = sum(freq.values())
print(f"-> {out}  ({len(rows)} players, {total} roster slots)\n")
print("labelling the top N players by draftability covers:")
run = 0
for n in (25, 50, 100, 150, 200, len(rows)):
    run = sum(c for _, c in freq.most_common(n))
    print(f"   top {n:4d} players -> {100*run/total:5.1f}% of all roster slots")

gaps = [r for r in csv.DictReader(open(D / "labelled_lineups.csv")) if r["status"] != "ok"]
need_awp = sorted({(r["year"], r["team"], r["lineup"]) for r in gaps if "NO_AWP" in r["status"]})
need_igl = sorted({(r["year"], r["team"], r["lineup"]) for r in gaps if "NO_IGL" in r["status"]})
for name, items in (("awp", need_awp), ("igl", need_igl)):
    p = D / f"worksheet_{name}.csv"
    with p.open("w", newline="") as fh:
        w = csv.writer(fh); w.writerow(["year", "team", "roster", name])
        for y, t, l in items: w.writerow([y, t, l.replace("|", ", "), ""])
    print(f"\n-> {p.name}  ({len(items)} team-years missing an {name.upper()})")
