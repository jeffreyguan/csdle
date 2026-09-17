#!/usr/bin/env python3
"""Join all-year lineups + ratings + labels into the shipping snapshot.

Nickname collisions are checked PER YEAR and treated as a hard stop: NiKo (Bosnia,
FaZe) and niko (Denmark, OpTic) differ only by capitalization, and a lowercased
join silently swapped them once already.
"""
import csv, collections, json, statistics as st
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
from apply_labels import load_labels, labels_for
from build_leadership import bonus as igl_bonus

D = Path(__file__).parent

def main():
    alias = {r["liquipedia_nick"]: r["hltv_nick"]
             for r in csv.DictReader(open(D / "aliases.csv"))}
    lab = load_labels()

    ratings = collections.defaultdict(dict)      # year -> nick -> row
    ci      = collections.defaultdict(lambda: collections.defaultdict(list))
    for r in csv.DictReader(open(D / "game_ratings.csv")):
        ratings[r["year"]][r["nick"]] = r
        ci[r["year"]][r["nick"].lower()].append(r)

    collisions = {(y, k): [x["nick"] for x in v]
                  for y, d in ci.items() for k, v in d.items() if len(v) > 1}
    if collisions:
        print(f"nickname collisions (resolved by exact case): {len(collisions)}")
        for k, v in sorted(collisions.items())[:10]:
            print(f"   {k[0]} {k[1]!r} -> {v}")

    # a player can be in a Liquipedia lineup but absent from that year's HLTV
    # top-20 stats pool (below the map floor, or their team was outside top 20
    # while they played). Fall back to a nearby year, then impute.
    by_nick = collections.defaultdict(dict)
    for y, d in ratings.items():
        for nk, row in d.items(): by_nick[nk.lower()][int(y)] = row
    floor = {y: sorted(int(r["game_rating"]) for r in d.values())[len(d)//4]
             for y, d in ratings.items()}

    def lookup(year, nick):
        ex = ratings[year]
        if nick in ex: return ex[nick], "exact"
        a = alias.get(nick)
        if a and a in ex: return ex[a], "alias"
        c = ci[year].get(nick.lower(), [])
        if len(c) == 1: return c[0], "case"
        if len(c) > 1:
            raise SystemExit(f"ambiguous {nick!r} in {year}: {[x['nick'] for x in c]}")
        yrs = by_nick.get(nick.lower(), {})
        if yrs:
            near = min(yrs, key=lambda y2: abs(y2 - int(year)))
            if abs(near - int(year)) <= 3:
                return dict(yrs[near], year=year), f"carried:{near}"
        return {"player_id": f"imp:{nick}", "nick": nick, "nationality": "",
                "game_rating": str(floor[year]), "hltv_rating": "0",
                "maps": "0", "year": year}, "imputed"

    ach = json.loads((D / "achievements.json").read_text()) if (D / "achievements.json").exists() else {}
    teams, players, missing = [], {}, []
    for r in csv.DictReader(open(D / "lineups_all.csv")):
        if not r["lineup"]: continue
        year = r["year"]
        roster, ok = [], True
        for nick in r["lineup"].split("|"):
            g, how = lookup(year, nick)
            if how in ("carried", "imputed") or how.startswith("carried"):
                missing.append((year, r["label"], nick, how))
            pid = f"{g['player_id']}:{year}"
            ls = (labels_for(lab, alias.get(nick, nick), int(year), r["label"])
                  or labels_for(lab, nick, int(year), r["label"]))
            players[pid] = {
                "id": pid, "player_id": g["player_id"], "nick": g["nick"], "year": int(year),
                "nationality": g["nationality"], "rating": int(g["game_rating"]),
                "hltv": float(g["hltv_rating"]), "maps": int(g["maps"]),
                "labels": sorted(ls.keys()),
                "rating_source": how,
            }
            roster.append(pid)
        if len(roster) != 5: continue

        # derived labels: star = top-2 by rating on the roster, anchor = default
        med = st.median(p["rating"] for p in players.values())
        for p in sorted((players[i] for i in roster), key=lambda p: -p["rating"])[:2]:
            if p["rating"] >= med and "star" not in p["labels"]:
                p["labels"] = sorted(p["labels"] + ["star"])
        for i in roster:
            if not players[i]["labels"]:
                players[i]["labels"] = ["anchor"]

        # IGL leadership: trophies won UP TO this year buff the OTHER FOUR.
        # Never the IGL himself - a personal bonus would stack on an already
        # high rating and push the draft back to "take the biggest number".
        igl = next((players[i] for i in roster if "igl" in players[i]["labels"]), None)
        lead, lead_raw = 0, 0.0
        if igl:
            lead, lead_raw, _ = igl_bonus(ach.get(igl["nick"], []), int(year))
        base = sum(players[i]["rating"] for i in roster) / 5
        eff = base + lead * 4 / 5        # +lead to each of the other four

        d = int(r["days"])
        teams.append({
            "igl": igl["id"] if igl else None,
            "leadership": lead, "leadership_raw": round(lead_raw, 1),
            "effective_strength": round(eff, 1),
            "team": r["label"], "year": int(year), "roster": roster, "days": d,
            "confidence": "high" if d >= 150 else "medium" if d >= 60 else "low",
            "strength": round(base, 1),
        })

    snap = {"teams": teams, "players": players,
            "years": sorted({t["year"] for t in teams}),
            "source": {"ratings": "HLTV Top20 per-year; Rating 1.0 (2015-16), 2.0 (2017-23), 3.0 (2024-25); "
                                  "shrunk + z-scored within year",
                       "rosters": "Liquipedia (CC-BY-SA 3.0)"}}
    (D / "snapshot.json").write_text(json.dumps(snap, indent=1))
    print(f"\n{len(teams)} team-years, {len(players)} player-years -> data/snapshot.json")
    if missing:
        c = collections.Counter(m[3].split(":")[0] for m in missing)
        print(f"non-exact ratings: {dict(c)}")
    return snap

if __name__ == "__main__":
    main()
