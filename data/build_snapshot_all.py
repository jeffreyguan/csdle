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

D = Path(__file__).parent

def main():
    alias = {r["liquipedia_nick"]: r["hltv_nick"]
             for r in csv.DictReader(open(D / "aliases.csv"))}
    lab = load_labels()

    # extra display stats the game_ratings table does not carry
    extra = {}
    for r in csv.DictReader(open(D / "player_year_ratings.csv")):
        extra[(r["year"], r["player_id"])] = {"kd": r["kd"], "rounds": r["rounds"],
                                              "kd_diff": r["kd_diff"]}

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

    # Season results drive BOTH bonuses now — one source, two magnitudes.
    # Career pedigree was dropped: an IGL's 2018 results ARE his team's 2018
    # results, so pairing the two double-counted the same tournament run, and
    # Liquipedia's 10-row achievements cap made career totals arbitrary anyway.
    succ = json.loads((D / "team_success.json").read_text()) \
        if (D / "team_success.json").exists() else {}
    majors = json.loads((D / "major_wins.json").read_text()) \
        if (D / "major_wins.json").exists() else {}
    trophies = json.loads((D / "trophies.json").read_text()) \
        if (D / "trophies.json").exists() else {}
    top20 = json.loads((D / "hltv_top20.json").read_text()) \
        if (D / "hltv_top20.json").exists() else {}
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
                "base_rating": int(g["game_rating"]), "team_bonus": 0,
                "top20_bonus": 0, "leads": 0,
                "team": r["label"],
                # HLTV's Top 20 is editorial — big events, impact, awards — so it
                # is independent of the rating already in this record
                "top20": (top20.get(year, {}).get(g["nick"])
                          or top20.get(year, {}).get(alias.get(nick, nick))
                          or top20.get(year, {}).get(nick)),
                "kd": float(extra.get((year, g["player_id"]), {}).get("kd") or 0) or None,
                "kd_diff": extra.get((year, g["player_id"]), {}).get("kd_diff") or "",
                "labels": sorted(ls.keys()),
                "rating_source": how,
            }
            roster.append(pid)
        if len(roster) != 5: continue

        # `star` is assigned after the loop — see below. It must NOT be derived
        # here: `players` is still being accumulated, and 28 player-years sit on
        # two teams in the same year sharing one object.

        # IGL leadership: trophies won UP TO this year buff the OTHER FOUR.
        # Never the IGL himself - a personal bonus would stack on an already
        # high rating and push the draft back to "take the biggest number".
        sc = succ.get(f"{r['label']}:{year}", {})
        team_bonus = sc.get("team_bonus", 0)
        igl = next((players[i] for i in roster if "igl" in players[i]["labels"]), None)
        lead = sc.get("igl_bonus", 0) if igl else 0
        lead_raw = sc.get("raw", 0.0)

        # every player carries their season's success on their own rating
        won_major = len(majors.get(f"{r['label']}:{year}", []))
        # S-Tier titles that season (Majors included — a Major is S-Tier)
        won_tro = trophies.get(f"{r['label']}:{year}", {}).get("s", 0)
        for i in roster:
            players[i]["majors"] = won_major
            players[i]["trophies"] = won_tro
            players[i]["team_bonus"] = team_bonus
            # HLTV's Top 20 is editorial — it rewards impact, utility and calling
            # that raw rating misses. corr(placing, rating) is -0.71, so it is
            # mostly redundant but not entirely: 62 of 201 placed players rate
            # below 60 (Snax 2015 #4 at 58, FalleN 2017 #6 at 59). Ranges 2-5:
            # a floor of 1 undersold the achievement — making HLTV's top 20 at
            # all is a real distinction, not a rounding error.
            pl = players[i].get("top20")
            t20b = round(2 + 3 * (20 - pl) / 19) if pl else 0
            players[i]["top20_bonus"] = t20b
            players[i]["rating"] = min(99, players[i]["base_rating"] + team_bonus + t20b)
        # An IGL's value is almost entirely what he gives the other four, so his
        # own card badly understates him — karrigan 2022 shows 40 while handing
        # his side +12 team points. Surface it so the draft is legible.
        if igl:
            players[igl["id"]]["leads"] = lead

        base = sum(players[i]["rating"] for i in roster) / 5
        # leadership is MULTIPLICATIVE on the other four (see engine.ts): a
        # caller amplifies good players, he does not lift bad ones to the same
        # absolute degree. IGL_SCALE 12, LEAD_MAX_MULT 0.18.
        if igl and lead:
            others = [players[i]["rating"] for i in roster if i != igl["id"]]
            mult = (lead / 12) * 0.18
            eff = (sum(players[i]["rating"] for i in roster) + sum(others) * mult) / 5
        else:
            eff = base

        d = int(r["days"])
        teams.append({
            "igl": igl["id"] if igl else None,
            "leadership": lead, "leadership_raw": round(lead_raw, 1),
            "effective_strength": round(eff, 1),
            "team": r["label"], "year": int(year), "roster": roster, "days": d,
            "confidence": "high" if d >= 150 else "medium" if d >= 60 else "low",
            "strength": round(base, 1),
        })

    # No derived labels. `star` was removed: it was a rating proxy dressed as a
    # role (top-2 on the roster), which said nothing about how a player actually
    # played. Roles are anchor / rotater / awp / igl, all hand-curated; a player
    # with no positional label is FLEX and the engine fills the short slot.

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
