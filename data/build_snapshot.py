#!/usr/bin/env python3
"""Join lineups + ratings into the snapshot the game ships with.

Output: data/snapshot.json — self-contained, no runtime API calls.
"""
import csv, json
from pathlib import Path

D = Path(__file__).parent

def build(year=2018, out="snapshot.json"):
    alias = {r["liquipedia_nick"].lower(): r["hltv_nick"].lower()
             for r in csv.DictReader(open(D / "aliases.csv"))}
    pool = [r for r in csv.DictReader(open(D / "game_ratings.csv"))
            if r["year"] == str(year)]
    exact = {r["nick"]: r for r in pool}
    ci = {}
    for r in pool:
        ci.setdefault(r["nick"].lower(), []).append(r)

    def lookup(nick):
        """Exact case first. NiKo (FaZe, Bosnia) and niko (OpTic, Denmark) are
        different players distinguished ONLY by capitalization, so a lowercased
        join silently swaps them — a 27-point rating error. Fall back to
        case-insensitive only when it is unambiguous."""
        if nick in exact:
            return exact[nick]
        a = alias.get(nick.lower())
        if a:
            if a in exact:
                return exact[a]
            if len(ci.get(a, [])) == 1:
                return ci[a][0]
        c = ci.get(nick.lower(), [])
        if len(c) == 1:
            return c[0]
        if len(c) > 1:
            raise SystemExit(
                f"ambiguous nick {nick!r}: {[(x['nick'], x['player_id']) for x in c]}"
                " — add an exact-case entry to aliases.csv")
        return None

    teams, players, dropped = [], {}, []
    for r in csv.DictReader(open(D / f"lineups_{year}.csv")):
        if not r["lineup"]:
            continue
        roster = []
        for nick in r["lineup"].split("|"):
            g = lookup(nick)
            if not g:
                dropped.append((r["label"], nick)); continue
            pid = g["player_id"]
            players[pid] = {
                "id": pid, "nick": g["nick"], "nationality": g["nationality"],
                "rating": int(g["game_rating"]), "hltv": float(g["hltv_rating"]),
                "maps": int(g["maps"]),
                "role": None,          # TODO: hand-curated AWP/IGL/entry/support/lurk
            }
            roster.append(pid)
        if len(roster) != 5:
            dropped.append((r["label"], f"only {len(roster)}")); continue
        teams.append({
            "team": r["label"], "year": year, "roster": roster,
            "days": int(r["days"]),
            "confidence": "high" if int(r["days"]) >= 150
                          else "medium" if int(r["days"]) >= 60 else "low",
            "strength": round(sum(players[p]["rating"] for p in roster) / 5, 1),
        })

    snap = {"year": year, "teams": teams, "players": players,
            "source": {"ratings": "HLTV Rating 2.0, rankingFilter=Top20, minMapCount=50",
                       "rosters": "Liquipedia (CC-BY-SA 3.0)"}}
    (D / out).write_text(json.dumps(snap, indent=1))
    return snap, dropped

if __name__ == "__main__":
    snap, dropped = build()
    print(f"{len(snap['teams'])} teams, {len(snap['players'])} players -> data/snapshot.json")
    if dropped: print("dropped:", dropped)

    print("\nteams by strength:")
    for t in sorted(snap["teams"], key=lambda t: -t["strength"]):
        names = ", ".join(snap["players"][p]["nick"] for p in t["roster"])
        print(f"  {t['strength']:5.1f}  {t['confidence']:6}  {t['team']:20} {names}")

    print("\n--- sample draft roll ---")
    t = next(x for x in snap["teams"] if x["team"] == "Astralis")
    print(f"You rolled: {t['team']} {t['year']}  (lineup held {t['days']} days)")
    for p in t["roster"]:
        pl = snap["players"][p]
        print(f"   [{pl['rating']:3d}]  {pl['nick']:10} {pl['nationality']:8} "
              f"HLTV {pl['hltv']:.2f} over {pl['maps']} maps")
