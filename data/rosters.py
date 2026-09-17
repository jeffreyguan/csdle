#!/usr/bin/env python3
"""Reconstruct (team, year) canonical lineups from Liquipedia roster tables.

Column positions are NOT trusted: some rows carry an extra empty cell (s1mple on
Natus Vincere has 8 cells against a 7-column header), which silently shifts every
field. Instead, columns are located by content:

  nick  = first cell
  dates = cells containing a date, matched in order against the date headers
  role  = last cell before the first date cell ('' for players, set for staff)
  name  = the cell before that
"""
import datetime as dt, html as H, re, sys
from collections import Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from liquipedia import page_html

TABLE = re.compile(r'<table class="table2__table[^"]*">(.*?)</table>', re.S)
ROW   = re.compile(r'<tr[^>]*>(.*?)</tr>', re.S)
CELL  = re.compile(r'<t[dh][^>]*>(.*?)</t[dh]>', re.S)
DATE  = re.compile(r'(\d{4})-(\d{2}|\?\?)-(\d{2}|\?\?)')
# Staff titles land in an inconsistent column: Astralis puts "Director of Sports"
# in the role cell, NiP puts "CEO" in the Name cell. So scan every cell between the
# nick and the first date rather than trusting any single position.
# The role cell also carries PLAYING statuses, not just staff titles: TYLOO's
# fifth man "somebody" reads "On Loan", Summer reads "Loan". Treating any
# non-empty role as staff dropped them and cost TYLOO its 2018 lineup.
# Loan / stand-in = actively playing, keep. "Substitute" = benched, exclude --
# Space Soldiers' DESPE reads "Substitute" and made their squad six-deep.
# Match anywhere, not whole-string: MOUZ's siuhy reads "On Trial Loan" and an
# anchored ^(on )?loan$ filed him as staff, costing MOUZ its 2024 lineup.
PLAYER_STATUS = re.compile(r'\bloans?\b|\btrial\b|stand-?in', re.I)
STAFF_RE = re.compile(
    r'\b(coach|analyst|manager|director|board|founder|ceo|coo|cro|cfo|cmo|'
    r'president|owner|chairman|advisor|psychologist|physio|nutritionist|'
    r'head of|assistant|interim|scout|staff|talent|trainee)\b', re.I)


def txt(f): return H.unescape(re.sub(r'<[^>]+>', ' ', f)).strip()


def norm_date(cell):
    m = DATE.search(cell)
    if not m: return None
    y, mo, d = m.groups()
    return f"{y}-{'01' if mo == '??' else mo}-{'01' if d == '??' else d}"


def parse_team(title):
    h = page_html(title).replace("&#95;", "_")
    players, anomalies = [], []

    for tbl in TABLE.findall(h):
        rows = ROW.findall(tbl)
        if not rows: continue
        head = [txt(c) for c in CELL.findall(rows[0])]
        if "Join Date" not in head: continue
        idx = {n: i for i, n in enumerate(head)}
        blank_col = next((n for n in head if n == ""), None)
        if blank_col is not None:
            blank_col = ""

        for r in rows[1:]:
            cells = [txt(c) for c in CELL.findall(r)]
            raw   = CELL.findall(r)
            if len(cells) < 3: continue
            nick = cells[0]
            if not nick: continue

            # Map header -> cell by COLUMN INDEX, not by "nth cell containing a
            # date". Matching by date-order silently mis-assigns whenever a date
            # column is empty or a non-date column holds a date: the New Team cell
            # carries the next team's join date, which was landing in Leave/Inactive
            # (NBK- read as inactive=2018-10-08, his Vitality date).
            # Ragged rows (s1mple: 8 cells vs 7 headers) are handled by an offset.
            off = len(cells) - len(head)
            def col(name):
                if name not in idx: return None
                i = idx[name] + off
                return cells[i] if 0 <= i < len(cells) else None

            join = norm_date(col("Join Date") or "")
            if not join:
                anomalies.append((title, nick, "no join date"))
                continue

            name = (col("Name") or "").strip()
            role = (col(blank_col) or "").strip() if blank_col is not None else ""
            pre  = cells[1:idx["Join Date"] + off]
            is_staff = ((bool(role) and not PLAYER_STATUS.search(role))
                        or any(STAFF_RE.search(c) for c in pre))

            if off:
                anomalies.append((title, nick, f"{len(cells)} cells vs {len(head)} cols"))

            flag = re.search(r'<img alt="([^"]+)"', raw[0])
            players.append({
                "team": title, "nick": nick, "name": name, "role": role,
                "staff": is_staff,
                "nationality": flag.group(1) if flag else "",
                "join": join,
                "inactive": norm_date(col("Inactive Date") or ""),
                "leave": norm_date(col("Leave Date") or ""),
            })

    seen, out = set(), []
    for p in players:
        k = (p["nick"], p["join"], p["leave"])
        if k not in seen:
            seen.add(k); out.append(p)
    return out, anomalies


# Tagless org staff (Dignitas wEZ joined 2007, SK vilden 2007, NiP Peter Hedlund
# 2006) carry no role text and NO end date, so they read as rostered forever.
# Real players at the same org always have an inactive/leave date recorded.
STALE_TENURE_YEARS = 8

# Known staff whose Liquipedia rows carry no role text at all (zews, HUNDEN).
_ov = Path(__file__).parent / "staff_override.csv"
STAFF_OVERRIDE = set()
if _ov.exists():
    import csv as _csv
    STAFF_OVERRIDE = {r["nick"] for r in _csv.DictReader(_ov.open())}

def active_on(players, day):
    out = []
    year = int(day[:4])
    for p in players:
        if p["staff"] or p["nick"] in STAFF_OVERRIDE: continue
        if not p["inactive"] and not p["leave"] and p["join"]:
            if year - int(p["join"][:4]) >= STALE_TENURE_YEARS:
                continue
        if not p["join"] or p["join"] > day: continue
        # benched counts as out: end at the EARLIER of inactive/leave
        ends = [d for d in (p["inactive"], p["leave"]) if d]
        if ends and min(ends) < day: continue
        out.append(p["nick"])
    return tuple(sorted(out))


def canonical_lineup(players, year):
    d, end = dt.date(year, 1, 1), dt.date(year, 12, 31)
    tally = Counter()
    while d <= end:
        s = active_on(players, d.isoformat())
        if len(s) == 5: tally[s] += 1
        d += dt.timedelta(days=1)
    if not tally: return None, 0, tally
    best, days = tally.most_common(1)[0]
    return best, days, tally


if __name__ == "__main__":
    YEAR = 2018
    all_anom = []
    for team in ["Astralis", "Fnatic", "G2_Esports", "Natus_Vincere", "Space_Soldiers"]:
        ps, anom = parse_team(team)
        all_anom += anom
        line, days, tally = canonical_lineup(ps, YEAR)
        print(f"\n{team}  ({len(ps)} entries)")
        if line:
            print(f"  {YEAR}: {', '.join(line)}   [{days}d]")
        else:
            print(f"  {YEAR}: no stable 5-man set")
        for s, n in tally.most_common(3)[1:]:
            print(f"    alt [{n}d]: {', '.join(s)}")
    if all_anom:
        print(f"\n!! {len(all_anom)} row anomalies:")
        for a in all_anom[:12]: print("   ", a)
