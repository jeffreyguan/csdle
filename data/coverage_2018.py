#!/usr/bin/env python3
"""Run the full 2018 HLTV team pool through Liquipedia; report lineup coverage."""
import csv, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from liquipedia import get
from rosters import parse_team, canonical_lineup

YEAR = 2018

MIN_PLAYERS = 5   # teams below this are transfer artifacts (one player passing
                  # through mid-year), not top-20 sides, and cannot form a lineup
counts = {}
for r in csv.DictReader(open(Path(__file__).parent / "player_year_ratings.csv")):
    for t in r["teams"].split("|"):
        t = t.strip()
        if t:
            t = t[3:] if t.startswith("ex-") else t   # ex-Space Soldiers -> Space Soldiers
            counts[t] = counts.get(t, 0) + 1
dropped = sorted(t for t, n in counts.items() if n < MIN_PLAYERS)
labels = sorted(t for t, n in counts.items() if n >= MIN_PLAYERS)
if dropped:
    print(f"dropped {len(dropped)} teams with <{MIN_PLAYERS} players: {dropped}")
print(f"{len(labels)} distinct teams in the {YEAR} HLTV pool\n")

# resolve each label to a real wiki page title (cheap: 2s/req, follows redirects)
resolved, unresolved = {}, []
for lab in labels:
    d = get({"action": "query", "titles": lab, "redirects": 1})
    pages = d.get("query", {}).get("pages", {})
    page = next(iter(pages.values()))
    if "missing" in page:
        hit = get({"action": "query", "list": "search", "srsearch": lab, "srlimit": 1})
        res = hit.get("query", {}).get("search", [])
        if res:
            resolved[lab] = res[0]["title"]; print(f"  search  {lab:22} -> {res[0]['title']}")
        else:
            unresolved.append(lab); print(f"  MISSING {lab}")
    else:
        resolved[lab] = page["title"]
        arrow = "" if page["title"] == lab else f" -> {page['title']}"
        print(f"  ok      {lab:22}{arrow}")

print(f"\nresolved {len(resolved)}/{len(labels)}; now parsing rosters (30s each, cached)\n")

rows, full, partial = [], 0, 0
for lab, title in resolved.items():
    try:
        ps, anom = parse_team(title)
        line, days, tally = canonical_lineup(ps, YEAR)
    except Exception as e:
        print(f"  ERROR {lab}: {e}"); continue
    if line:
        full += 1
        print(f"  FULL    {lab:22} [{days:3d}d] {', '.join(line)}")
    else:
        partial += 1
        best = tally.most_common(1)
        print(f"  NONE    {lab:22} (entries={len(ps)})")
    rows.append({"label": lab, "page": title, "year": YEAR,
                 "lineup": "|".join(line) if line else "",
                 "days": days, "entries": len(ps), "anomalies": len(anom)})

out = Path(__file__).parent / f"lineups_{YEAR}.csv"
with out.open("w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

print(f"\n==== {full}/{len(labels)} teams produced a full 5-man {YEAR} lineup")
print(f"     {partial} produced none; {len(unresolved)} unresolved: {unresolved}")
print(f"     -> {out}")
