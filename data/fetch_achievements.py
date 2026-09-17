#!/usr/bin/env python3
"""Pull tournament achievements for every labelled IGL from Liquipedia.

The achievements table is rendered from LiquipediaDB by a template, so it only
exists in parsed HTML (action=parse, 30s each) - not in the wikitext.
Cached, so this is paid once.
"""
import html as H, json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from liquipedia import page_html

D = Path(__file__).parent

# Common-word nicks hit Liquipedia DISAMBIGUATION pages, which parse to zero
# results: Zeus, Fox and Steel all did. Map them to the disambiguated title.
import csv as _csv
_pa = D / "player_page_aliases.csv"
PAGE_ALIAS = ({r["nick"]: r["page"] for r in _csv.DictReader(_pa.open())}
              if _pa.exists() else {})

def txt(x): return H.unescape(re.sub(r"<[^>]+>", " ", x)).strip()

def achievements(nick):
    try:
        title = PAGE_ALIAS.get(nick, nick[0].upper() + nick[1:])
        h = page_html(title).replace("&#95;", "_")
    except SystemExit:
        return None
    # Locate the table by HEADER SIGNATURE, not by position. Taking the first
    # "achievements" match lands in the Mouse Settings block on some pages
    # (apEX), so the wrong table gets parsed and yields zero results.
    target = None
    for tab in re.findall(r"<table[^>]*>(.*?)</table>", h, re.S):
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", tab, re.S)
        if not rows: continue
        head = [txt(c).lower() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", rows[0], re.S)]
        if "date" in head and "place" in head and "tier" in head:
            target = tab; break
    if target is None: return []
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", target, re.S):
        c = [txt(x) for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
        if len(c) < 7 or not re.match(r"\d{4}-\d{2}-\d{2}", c[0] or ""): continue
        out.append({"date": c[0], "place": c[1], "tier": c[2],
                    "tournament": c[6] if len(c) > 6 else "",
                    "team": c[7] if len(c) > 7 else ""})
    return out

if __name__ == "__main__":
    snap = json.loads((D / "snapshot.json").read_text())
    igls = sorted({p["nick"] for p in snap["players"].values() if "igl" in p["labels"]})
    print(f"fetching achievements for {len(igls)} IGLs\n")
    out = D / "achievements.json"
    res = json.loads(out.read_text()) if out.exists() else {}   # resume
    fails = []
    todo = [n for n in igls if n not in res]
    print(f"{len(res)} already saved, {len(todo)} to fetch\n", flush=True)
    for i, n in enumerate(igls, 1):
        if n in res: continue
        a = achievements(n)
        if a is None:
            fails.append(n); print(f"  [{i}/{len(igls)}] {n:16} PAGE MISSING"); continue
        res[n] = a
        out.write_text(json.dumps(res, indent=1, sort_keys=True))   # saveeach step
        wins = sum(1 for x in a if x["place"].startswith("1"))
        print(f"  [{i}/{len(igls)}] {n:16} {len(a):3d} results, {wins:2d} firsts", flush=True)
    print(f"\n-> data/achievements.json ({len(res)} players)")
    if fails: print("failed:", fails)
