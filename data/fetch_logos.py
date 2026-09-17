#!/usr/bin/env python3
"""Download org logos from Liquipedia Commons.

NOTE ON RIGHTS: these are `license=fairuselogo` — trademarks shown to identify
the actual team, not freely-licensed artwork. Nominative use like this is the
basis wikis and fantasy sites rely on, and it is far weaker exposure than the
player photos (which are copyrighted press photography with no grant to us).
It is still not a licence. Revisit before any commercial use.
"""
import csv, gzip, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from liquipedia import get, UA

D = Path(__file__).parent
OUT = D.parent / "web" / "public" / "logos"
OUT.mkdir(parents=True, exist_ok=True)
COMMONS = "https://liquipedia.net/commons/api.php"

def commons(params):
    params = {**params, "format": "json"}
    req = urllib.request.Request(COMMONS + "?" + urllib.parse.urlencode(params),
                                 headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip": raw = gzip.decompress(raw)
    return json.loads(raw)

IMG = re.compile(r'^\s*\|\s*(?:image|imagelight)\s*=\s*(.+?)\s*$', re.M | re.I)

def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

if __name__ == "__main__":
    lineups = list(csv.DictReader(open(D / "lineups_all.csv")))
    pages = {}
    for r in lineups:
        if r["lineup"]: pages.setdefault(r["label"], r["page"])
    print(f"{len(pages)} orgs\n")

    manifest = {}
    # the app fetches /logos.json, which resolves inside web/public
    mpath = OUT.parent / "logos.json"
    if mpath.exists(): manifest = json.loads(mpath.read_text())

    for label, page in sorted(pages.items()):
        if label in manifest and (OUT / manifest[label]).exists():
            continue
        try:
            d = get({"action": "query", "prop": "revisions", "rvprop": "content",
                     "rvslots": "main", "titles": page, "redirects": 1})
            pg = next(iter(d["query"]["pages"].values()))
            if "missing" in pg: print(f"  {label:22} no page"); continue
            m = IMG.search(pg["revisions"][0]["slots"]["main"]["*"][:4000])
            if not m: print(f"  {label:22} no image field"); continue
            time.sleep(2)
            info = commons({"action": "query", "titles": f"File:{m.group(1)}",
                            "prop": "imageinfo", "iiprop": "url", "iiurlwidth": "160"})
            ip = next(iter(info["query"]["pages"].values()))
            url = (ip.get("imageinfo") or [{}])[0].get("thumburl")
            if not url: print(f"  {label:22} no thumb"); continue
            ext = ".png"
            fn = slug(label) + ext
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                (OUT / fn).write_bytes(r.read())
            manifest[label] = fn
            mpath.write_text(json.dumps(manifest, indent=1, sort_keys=True))
            print(f"  {label:22} -> {fn}")
            time.sleep(2)
        except Exception as e:
            print(f"  {label:22} ERROR {e}")

    print(f"\n{len(manifest)}/{len(pages)} logos -> web/public/logos/")
