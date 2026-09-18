#!/usr/bin/env python3
"""Pull full tournament results per org from Liquipedia /Results subpages.

The main team page only carries the TOP 10 achievements, which is patchy per
year — Astralis's top 10 are all 2017-2019, so every other season would score
zero. The /Results subpage has the complete history (308 rows for ENCE).

Rate-limited and cached; resumable.
"""
import collections, html as H, json, re, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from liquipedia import page_html, get

D = Path(__file__).parent
OUT = D / "team_results.json"
def txt(x): return H.unescape(re.sub(r"<[^>]+>", " ", x)).strip()

def results_for(page):
    # /Results pages are large (800KB+) and a single SSL read timeout killed an
    # entire run at 54/69 orgs. Retry with backoff instead.
    h = None
    for attempt in range(4):
        try:
            h = page_html(f"{page}/Results").replace("&#95;", "_")
            break
        except SystemExit:
            return None
        except Exception as e:
            print(f"      retry {attempt+1}/4 ({type(e).__name__})", flush=True)
            time.sleep(5 * (attempt + 1))
    if h is None:
        return None
    for tab in re.findall(r"<table[^>]*>(.*?)</table>", h, re.S):
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", tab, re.S)
        if not rows: continue
        head = [txt(c).lower() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", rows[0], re.S)]
        if "date" in head and "place" in head and "tier" in head:
            out = []
            for r in rows[1:]:
                c = [txt(x) for x in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)]
                if len(c) > 2 and re.match(r"\d{4}-", c[0] or ""):
                    # tournament name lives in the link title of the icon cell
                    raw = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)
                    name = ""
                    if len(raw) > 5:
                        m = re.search(r'title="([^"]+)"', raw[5])
                        if m: name = H.unescape(m.group(1))
                    out.append({"date": c[0], "place": c[1], "tier": c[2],
                                "tournament": name})
            return out
    return []

if __name__ == "__main__":
    import csv
    pages = {}
    for r in csv.DictReader(open(D / "lineups_all.csv")):
        if r["lineup"]: pages.setdefault(r["label"], r["page"])
    res = json.loads(OUT.read_text()) if OUT.exists() else {}
    todo = [k for k in pages if k not in res]
    print(f"{len(pages)} orgs, {len(res)} cached, {len(todo)} to fetch", flush=True)
    for i, label in enumerate(sorted(todo), 1):
        rows = results_for(pages[label])
        if rows is None:
            # some orgs have no /Results subpage — fall back to the main page
            rows = []
        res[label] = rows
        OUT.write_text(json.dumps(res, indent=1, sort_keys=True))
        yrs = collections.Counter(r["date"][:4] for r in rows)
        print(f"  [{i}/{len(todo)}] {label:22} {len(rows):4d} results, {len(yrs)} seasons", flush=True)
    print(f"\n-> {OUT.name} ({len(res)} orgs)")
