#!/usr/bin/env python3
"""Pull |roles= from Liquipedia player infoboxes (batched wikitext).

action=query is rate-limited at 1 req/2s (vs 30s for action=parse) and accepts up
to 50 titles per call, so the whole player pool costs a handful of requests.
"""
import json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from liquipedia import get

D = Path(__file__).parent
ROLES_RE = re.compile(r'^\s*\|\s*roles?\s*=\s*(.+?)\s*$', re.M | re.I)

def fetch_roles(nicks, batch=50):
    found, missing = {}, []
    titles = {n[0].upper() + n[1:]: n for n in nicks}      # wiki capitalizes first letter
    keys = list(titles)
    for i in range(0, len(keys), batch):
        chunk = keys[i:i + batch]
        d = get({"action": "query", "prop": "revisions", "rvprop": "content",
                 "rvslots": "main", "titles": "|".join(chunk), "redirects": 1})
        q = d.get("query", {})
        # redirects/normalization remap titles - follow them back to our nick
        back = {}
        for r in q.get("normalized", []) + q.get("redirects", []):
            back[r["to"]] = back.get(r["from"], r["from"])
        for pg in q.get("pages", {}).values():
            t = pg["title"]
            orig = back.get(t, t)
            nick = titles.get(orig) or titles.get(t)
            if nick is None: continue
            if "missing" in pg:
                missing.append((nick, "no page")); continue
            text = pg["revisions"][0]["slots"]["main"]["*"]
            m = ROLES_RE.search(text)
            if m:
                found[nick] = [x.strip().lower() for x in m.group(1).split(",") if x.strip()]
            else:
                missing.append((nick, "no roles field"))
    return found, missing

if __name__ == "__main__":
    snap = json.loads((D / "snapshot.json").read_text())
    nicks = [p["nick"] for p in snap["players"].values()]
    found, missing = fetch_roles(nicks)

    (D / "roles_liquipedia.json").write_text(json.dumps(found, indent=1, sort_keys=True))
    print(f"{len(found)}/{len(nicks)} players have a roles field "
          f"({100*len(found)/len(nicks):.0f}%)\n")

    import collections
    c = collections.Counter(r for v in found.values() for r in v)
    print("role vocabulary:", dict(c.most_common()))
    print(f"\nmissing ({len(missing)}):")
    nopage = [n for n, why in missing if why == "no page"]
    nofield = [n for n, why in missing if why == "no roles field"]
    print(f"  no page ({len(nopage)}): {nopage}")
    print(f"  no roles field ({len(nofield)}): {nofield}")
