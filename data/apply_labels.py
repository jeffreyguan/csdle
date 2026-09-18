#!/usr/bin/env python3
"""Apply IGL/AWP labels to every team-year lineup and validate the result.

Labels are per-PLAYER (with optional year range) because IGL/AWP are sticky
across a career — karrigan is one row, not eleven. Validation is per team-year:
exactly one IGL, at least one AWP.
"""
import csv, collections, json
from pathlib import Path

D = Path(__file__).parent

def load_labels():
    lab = collections.defaultdict(list)
    for r in csv.DictReader(open(D / "labels_manual.csv")):
        excl = set()
        spec = r["years"].strip()
        if "!" in spec:                       # "*!2017" = every year but 2017
            spec, _, ex = spec.partition("!")
            excl = {int(x) for x in ex.split("&") if x.strip().isdigit()}
            spec = spec or "*"
        for part in spec.split(";"):
            if part == "*":
                lo, hi = 0, 9999
            else:
                a, _, b = part.partition("-")
                lo, hi = int(a), int(b or a)
            lab[r["nick"]].append((r["label"], lo, hi, r["confidence"],
                                   (r.get("team") or "").strip(), frozenset(excl)))
    return lab

def labels_for(lab, nick, year, team=None):
    """team-scoped when the CSV names a team: Stewie2K IGL'd at Cloud9 in 2018
    but not at MIBR the same year, so player+year alone cannot disambiguate."""
    out = {}
    for name, lo, hi, conf, tm, excl in lab.get(nick, []):
        if not (lo <= year <= hi) or year in excl: continue
        if tm and team and tm.lower() != team.lower(): continue
        out[name] = conf
    return out

def main():
    lab = load_labels()
    alias = {r["liquipedia_nick"]: r["hltv_nick"]
             for r in csv.DictReader(open(D / "aliases.csv"))}

    rows = list(csv.DictReader(open(D / "lineups_all.csv")))
    rows = [r for r in rows if r["lineup"]]

    report, issues = [], collections.Counter()
    for r in rows:
        year = int(r["year"])
        nicks = r["lineup"].split("|")
        igls, awps, conf = [], [], []
        for n in nicks:
            key = alias.get(n, n)
            got = (labels_for(lab, key, year, r["label"])
                   or labels_for(lab, n, year, r["label"]))
            if "igl" in got: igls.append(n); conf.append(got["igl"])
            if "awp" in got: awps.append(n); conf.append(got["awp"])
        status = []
        if len(igls) == 0: status.append("NO_IGL"); issues["no_igl"] += 1
        elif len(igls) > 1: status.append("MULTI_IGL"); issues["multi_igl"] += 1
        if len(awps) == 0: status.append("NO_AWP"); issues["no_awp"] += 1
        if not status: issues["ok"] += 1
        report.append({
            "year": r["year"], "team": r["label"], "days": r["days"],
            "lineup": r["lineup"],
            "igl": "|".join(igls), "awp": "|".join(awps),
            "worst_conf": min(conf, key=lambda c: {"high":2,"medium":1,"low":0}[c]) if conf else "",
            "status": ",".join(status) or "ok",
        })

    out = D / "labelled_lineups.csv"
    with out.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(report[0].keys())); w.writeheader(); w.writerows(report)

    n = len(report)
    print(f"{n} team-years labelled -> {out}\n")
    for k in ("ok", "no_igl", "multi_igl", "no_awp"):
        print(f"   {k:10} {issues[k]:4d}  ({100*issues[k]/n:.0f}%)")

    # cross-year consistency: a player IGL in some years but not others on the same team
    seen = collections.defaultdict(set)
    for r in report:
        for n_ in r["lineup"].split("|"):
            seen[n_].add((r["year"], n_ in r["igl"].split("|")))
    print("\nby year:")
    per = collections.defaultdict(collections.Counter)
    for r in report: per[r["year"]][r["status"] == "ok"] += 1
    for y in sorted(per):
        ok, bad = per[y][True], per[y][False]
        print(f"   {y}: {ok:2d} ok / {ok+bad:2d}")
    return report

if __name__ == "__main__":
    main()
