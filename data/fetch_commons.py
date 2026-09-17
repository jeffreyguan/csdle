#!/usr/bin/env python3
"""Survey Wikimedia Commons for FREE-licensed player photos, by year.

Commons is the only source with genuinely reusable licences — Liquipedia's player
images are all `permission` (copyright retained by ESL/BLAST/PGL), so they cannot
be self-hosted. Commons categories are used rather than free-text search, which
returns junk (a search for "donk" matched a Dutch bridge).
"""
import csv, gzip, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

D = Path(__file__).parent
UA = "csdle/0.1 (https://github.com/jeffreyguan/csdle; jeffreyguan0710@gmail.com) python-urllib"
API = "https://commons.wikimedia.org/w/api.php"
OUT = D / "commons_photos.json"

def q(params):
    params = {**params, "format": "json"}
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params),
                                 headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip": raw = gzip.decompress(raw)
            return json.loads(raw)
        except Exception:
            time.sleep(2 * (attempt + 1))
    return {}

def category_files(name):
    d = q({"action": "query", "list": "categorymembers",
           "cmtitle": f"Category:{name}", "cmtype": "file", "cmlimit": "50"})
    return [m["title"] for m in d.get("query", {}).get("categorymembers", [])]

def details(files):
    out = []
    for i in range(0, len(files), 25):
        d = q({"action": "query", "titles": "|".join(files[i:i+25]),
               "prop": "imageinfo", "iiprop": "extmetadata|url", "iiurlwidth": "240"})
        for pg in d.get("query", {}).get("pages", {}).values():
            ii = (pg.get("imageinfo") or [{}])[0]
            em = ii.get("extmetadata", {})
            lic = em.get("LicenseShortName", {}).get("value", "")
            dt = re.sub(r"<[^>]+>", "", em.get("DateTimeOriginal", {}).get("value", "")
                        or em.get("DateTime", {}).get("value", ""))
            m = re.search(r"(19|20)\d\d", dt)
            out.append({"file": pg["title"], "year": int(m.group(0)) if m else None,
                        "license": lic, "thumb": ii.get("thumburl", ""),
                        "author": re.sub(r"<[^>]+>", "", em.get("Artist", {}).get("value", ""))[:60]})
        time.sleep(0.3)
    return out

FREE = re.compile(r"^(CC BY|CC0|Public domain)", re.I)

if __name__ == "__main__":
    nicks = [r["nick"] for r in csv.DictReader(open(D / "players_all.csv"))]
    res = json.loads(OUT.read_text()) if OUT.exists() else {}
    todo = [n for n in nicks if n not in res]
    print(f"{len(nicks)} players; {len(res)} cached, {len(todo)} to check", flush=True)

    for i, nick in enumerate(todo, 1):
        cap = nick[0].upper() + nick[1:]
        files = category_files(cap) or category_files(f"{cap} (gamer)")
        info = [x for x in details(files) if FREE.match(x["license"] or "")] if files else []
        res[nick] = info
        OUT.write_text(json.dumps(res, indent=1, sort_keys=True))
        if info:
            yrs = sorted({x["year"] for x in info if x["year"]})
            print(f"  [{i}/{len(todo)}] {nick:16} {len(info):2d} free images, years {yrs}", flush=True)
        time.sleep(0.3)

    withany = {k: v for k, v in res.items() if v}
    multi = {k: v for k, v in withany.items() if len({x['year'] for x in v if x['year']}) > 1}
    print(f"\nplayers with >=1 free Commons photo: {len(withany)}/{len(nicks)} "
          f"({100*len(withany)/len(nicks):.0f}%)")
    print(f"players with photos from >1 distinct year: {len(multi)}")
