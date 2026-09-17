#!/usr/bin/env python3
"""Reconstruct canonical lineups for every (team, year) across all captured years.

Each unique Liquipedia page is resolved once and parsed once (disk-cached), then
reused for every year that team appears in. 226 team-years come from 72 pages.
"""
import csv, collections, sys, traceback
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from liquipedia import get
from rosters import parse_team, canonical_lineup

D = Path(__file__).parent
MIN_PLAYERS = 5

# ---- team pool per year -------------------------------------------------
per = collections.defaultdict(collections.Counter)
for r in csv.DictReader(open(D / "player_year_ratings.csv")):
    for t in r["teams"].split("|"):
        t = t.strip()
        if t:
            per[r["year"]][t[3:] if t.startswith("ex-") else t] += 1

pool = {y: sorted(t for t, n in c.items() if n >= MIN_PLAYERS) for y, c in per.items()}
labels = sorted({t for ts in pool.values() for t in ts})
print(f"{sum(len(v) for v in pool.values())} team-years from {len(labels)} unique teams\n")

# ---- explicit overrides for labels the search API resolves wrongly ------
# Short/ambiguous names land on nonsense: "X" -> "List of player hardware",
# "Players" -> the CS:GO article, "?" -> an IEM event page. Empty page = drop.
OVERRIDE, DROP = {}, set()
for r in csv.DictReader(open(D / "team_aliases.csv")):
    if r["page"].strip(): OVERRIDE[r["label"]] = r["page"].strip()
    else: DROP.add(r["label"])
labels = [l for l in labels if l not in DROP]
pool = {y: [t for t in ts if t not in DROP] for y, ts in pool.items()}
print(f"dropped {len(DROP)} unresolvable labels: {sorted(DROP)}\n")

# ---- resolve labels -> wiki titles (2s each, cached) --------------------
resolved = {}
for lab in labels:
    if lab in OVERRIDE:
        resolved[lab] = OVERRIDE[lab]; print(f"  override {lab:23} -> {OVERRIDE[lab]}"); continue
    try:
        d = get({"action": "query", "titles": lab, "redirects": 1})
        pg = next(iter(d.get("query", {}).get("pages", {}).values()))
        if "missing" in pg:
            hit = get({"action": "query", "list": "search", "srsearch": lab, "srlimit": 1})
            res = hit.get("query", {}).get("search", [])
            if res:
                resolved[lab] = res[0]["title"]; print(f"  search  {lab:24} -> {res[0]['title']}")
            else:
                print(f"  MISSING {lab}")
        else:
            resolved[lab] = pg["title"]
            if pg["title"] != lab: print(f"  redir   {lab:24} -> {pg['title']}")
    except Exception as e:
        print(f"  ERROR   {lab}: {e}")
print(f"\nresolved {len(resolved)}/{len(labels)}; parsing rosters (30s per uncached page)\n")

# ---- parse each page once ----------------------------------------------
parsed, anomalies = {}, []
for lab, title in resolved.items():
    try:
        ps, an = parse_team(title)
        parsed[lab] = ps
        anomalies += an
    except Exception:
        print(f"  PARSE FAIL {lab}"); traceback.print_exc(limit=1)

# ---- canonical lineup per (team, year) ---------------------------------
rows, stats = [], collections.Counter()
for year in sorted(pool):
    full = 0
    for lab in pool[year]:
        ps = parsed.get(lab)
        if ps is None:
            stats["no_page"] += 1; continue
        line, days, tally = canonical_lineup(ps, int(year))
        if line:
            full += 1; stats["full"] += 1
        else:
            stats["none"] += 1
        rows.append({"year": year, "label": lab, "page": resolved.get(lab, ""),
                     "lineup": "|".join(line) if line else "", "days": days,
                     "entries": len(ps), "alts": len(tally)})
    print(f"  {year}: {full}/{len(pool[year])} lineups")

out = D / "lineups_all.csv"
with out.open("w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

print(f"\nfull {stats['full']} | none {stats['none']} | no page {stats['no_page']}")
print(f"parse anomalies: {len(anomalies)}")
print(f"-> {out}")

miss = [r for r in rows if not r["lineup"]]
if miss:
    print(f"\nteam-years with no lineup ({len(miss)}):")
    for r in miss[:40]:
        print(f"   {r['year']} {r['label']:24} entries={r['entries']}")
