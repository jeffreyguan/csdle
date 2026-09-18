#!/usr/bin/env python3
"""HLTV's Top 20 Players of the Year, from Liquipedia's mirror of the rankings.

HLTV's own ranking is editorial — it weighs big events, impact and awards, not
just raw rating — so it is genuinely independent of the stats already in the
snapshot, and a Top-20 placing is the recognition players are actually known for.
"""
import html as H, json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from liquipedia import page_html

D = Path(__file__).parent
# strip zero-width / word-joiner characters — 2022's names carry U+2060
INVIS = re.compile(r"[\u200b-\u200f\u2060\ufeff]")
def txt(x): return INVIS.sub("", H.unescape(re.sub(r"<[^>]+>", " ", x))).strip()

if __name__ == "__main__":
    h = page_html("HLTV/Top 20 Players").replace("&#95;", "_")
    out = {}
    for tab in re.findall(r"<table[^>]*>(.*?)</table>", h, re.S):
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", tab, re.S)
        if len(rows) < 5: continue
        # 2023's header reads "2023  (GO/2)" — the CS:GO/CS2 split year — so
        # match a leading year rather than requiring the cell to be only a year
        m = re.match(r"\s*(20\d\d)\s*(?:\(|$)", txt(rows[0]))
        if not m: continue
        year = m.group(1)
        got = {}
        for r in rows[1:]:
            c = [txt(x) for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)]
            if len(c) < 2 or not c[0].strip().isdigit(): continue
            # 'Mathieu "  ZywOo  " Herbaut' -> ZywOo
            q = re.search(r'"\s*(.+?)\s*"', c[1])
            if q: got[q.group(1)] = int(c[0])
        if got: out[year] = got
    (D / "hltv_top20.json").write_text(json.dumps(out, indent=1, sort_keys=True))
    print(f"years: {sorted(out)}")
    for y in sorted(out):
        top = sorted(out[y].items(), key=lambda kv: kv[1])[:3]
        print(f"   {y}: {len(out[y])} players | top3 = " +
              ", ".join(f"{n} (#{r})" for n, r in top))
