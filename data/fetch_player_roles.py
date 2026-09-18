#!/usr/bin/env python3
"""Liquipedia |roles= for every player, gated on |status=.

The field is CURRENT occupation, so a retired player reads "coach" (gla1ve) or
"broadcast analyst" (dupreeh) — which is why it was rejected in 6h. But for
`status=Active` players it is their actual playing role, and it is authoritative:
it catches mzinho as a rifler and 910 as the AWPer, both of which were hand-
labelled wrong.

Batched (50 titles/request) so the whole pool costs a handful of calls.
"""
import csv, json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from liquipedia import get

D = Path(__file__).parent
ALIAS = {r["nick"]: r["page"] for r in csv.DictReader(open(D / "player_page_aliases.csv"))} \
        if (D / "player_page_aliases.csv").exists() else {}
ROLES = re.compile(r"^\s*\|\s*roles?\s*=\s*(.+?)\s*$", re.M | re.I)
STATUS = re.compile(r"^\s*\|\s*status\s*=\s*(.+?)\s*$", re.M | re.I)
NORM = {"awper": "awp", "awp": "awp", "rifle": "rifle", "rifler": "rifle",
        "igl": "igl", "entry": "entry", "entryfragger": "entry",
        "lurker": "lurk", "lurk": "lurk", "support": "support"}

def fetch(nicks, batch=50):
    titles = {ALIAS.get(n, n[0].upper() + n[1:]): n for n in nicks}
    keys, out = list(titles), {}
    for i in range(0, len(keys), batch):
        d = get({"action": "query", "prop": "revisions", "rvprop": "content",
                 "rvslots": "main", "titles": "|".join(keys[i:i + batch]), "redirects": 1})
        q = d.get("query", {})
        back = {}
        for r in q.get("normalized", []) + q.get("redirects", []):
            back[r["to"]] = back.get(r["from"], r["from"])
        for pg in q.get("pages", {}).values():
            t = pg["title"]; nick = titles.get(back.get(t, t)) or titles.get(t)
            if not nick or "missing" in pg: continue
            txt = pg["revisions"][0]["slots"]["main"]["*"]
            m, st = ROLES.search(txt), STATUS.search(txt)
            roles = [NORM.get(x.strip().lower()) for x in (m.group(1).split(",") if m else [])]
            out[nick] = {"status": (st.group(1).strip() if st else "").lower(),
                         "roles": [r for r in roles if r]}
    return out

if __name__ == "__main__":
    nicks = [r["nick"] for r in csv.DictReader(open(D / "players_all.csv"))]
    res = fetch(nicks)
    (D / "player_roles.json").write_text(json.dumps(res, indent=1, sort_keys=True))
    active = {k: v for k, v in res.items() if v["status"] == "active" and v["roles"]}
    print(f"{len(res)}/{len(nicks)} pages read; {len(active)} ACTIVE with a usable role")
    import collections
    print("primary roles among active:",
          dict(collections.Counter(v["roles"][0] for v in active.values()).most_common()))
