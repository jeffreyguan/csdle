#!/usr/bin/env python3
"""Infer playing roles by combining Liquipedia's roles field with page prose.

The |roles= infobox field is CURRENT occupation, not playing role: gla1ve reads
"coach", GuardiaN "coach", dupreeh "broadcast analyst". Prose, however, still
describes what they did as players.
"""
import json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from liquipedia import get

D = Path(__file__).parent
PLAY = {"awp","awper","entry","entryfragger","lurk","lurker","igl","rifle","support"}
NORM = {"awper":"awp","entryfragger":"entry","lurker":"lurk"}

PROSE = {
    "igl":     re.compile(r"in-?game\s+leader|\bIGL\b|the\s+(?:team'?s\s+)?captain|calling\s+(?:duties|role)", re.I),
    "awp":     re.compile(r"\bAWPer\b|primary\s+AWP|main\s+AWP|as\s+(?:the\s+)?AWPer|sniper\s+role", re.I),
    "entry":   re.compile(r"entry\s*-?\s*fragger|entry\s+role|opening\s+duels", re.I),
    "lurk":    re.compile(r"\blurker\b|lurk\s+role|lurking\s+role", re.I),
    "support": re.compile(r"support\s+player|support\s+role", re.I),
}

def wikitexts(nicks, batch=50):
    titles = {n[0].upper() + n[1:]: n for n in nicks}
    keys, out = list(titles), {}
    for i in range(0, len(keys), batch):
        d = get({"action":"query","prop":"revisions","rvprop":"content","rvslots":"main",
                 "titles":"|".join(keys[i:i+batch]),"redirects":1})
        q = d.get("query", {})
        back = {}
        for r in q.get("normalized", []) + q.get("redirects", []):
            back[r["to"]] = back.get(r["from"], r["from"])
        for pg in q.get("pages", {}).values():
            t = pg["title"]; nick = titles.get(back.get(t, t)) or titles.get(t)
            if nick and "missing" not in pg:
                out[nick] = pg["revisions"][0]["slots"]["main"]["*"]
    return out

def infer(nicks):
    texts = wikitexts(nicks)
    res = {}
    for nick, t in texts.items():
        m = re.search(r'^\s*\|\s*roles?\s*=\s*(.+?)\s*$', t, re.M | re.I)
        field = [NORM.get(x.strip().lower(), x.strip().lower())
                 for x in (m.group(1).split(",") if m else []) if x.strip()]
        field = [r for r in field if r in PLAY or r in NORM.values()]

        # strip the infobox before scanning prose so team names / params don't match
        body = t[t.find("}}\n"):] if "}}" in t[:3000] else t
        prose = [r for r, rx in PROSE.items() if rx.search(body)]

        res[nick] = {"field": list(dict.fromkeys(field)),
                     "prose": prose,
                     "roles": list(dict.fromkeys(field + prose))}
    return res

if __name__ == "__main__":
    snap = json.loads((D / "snapshot.json").read_text())
    nicks = [p["nick"] for p in snap["players"].values()]
    res = infer(nicks)
    (D / "roles_inferred.json").write_text(json.dumps(res, indent=1, sort_keys=True))

    fld = sum(1 for v in res.values() if v["field"])
    both = sum(1 for v in res.values() if v["roles"])
    print(f"{len(res)} players | usable roles field: {fld} | +prose: {both}")

    print("\nrecovered by prose only (field was empty or staff-only):")
    for n, v in sorted(res.items()):
        if not v["field"] and v["prose"]:
            print(f"   {n:14} -> {v['prose']}")
    print("\nstill nothing:", sorted(n for n, v in res.items() if not v["roles"]))
