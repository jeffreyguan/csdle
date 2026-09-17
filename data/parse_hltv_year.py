#!/usr/bin/env python3
"""Parse manually-saved HLTV per-year player stats pages -> tidy CSV.

Input:  data/raw/hltv_stats/<year>-<filter>.html   (saved by hand in a browser)
          e.g. 2018-Top20.html, 2018-All.html
Output: data/player_year_ratings.csv   one row per (year, player, filter)
        data/ratings_merged.csv        one row per (year, player); Top20 preferred,
                                       All as fallback, both kept for comparison

No network access. Nothing here touches hltv.org.
"""
import csv, html, json, re, sys
from pathlib import Path

RAW = Path(__file__).parent / "raw" / "hltv_stats"
OUT = Path(__file__).parent / "player_year_ratings.csv"

TABLE_RE = re.compile(r'<table class="stats-table player-ratings-table".*?</table>', re.S)
ROW_RE   = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
TD_RE    = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
TH_RE    = re.compile(r"<th[^>]*>(.*?)</th>", re.S)


def text(frag: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", frag)).strip()


def parse_file(path: Path) -> list[dict]:
    src = path.read_text(encoding="utf-8", errors="replace")

    m = TABLE_RE.search(src)
    if not m:
        raise SystemExit(f"{path.name}: stats table not found — is this the right page?")
    table = m.group(0)

    headers = [text(h) for h in TH_RE.findall(table)]
    rows = ROW_RE.findall(table)

    # provenance: the filters baked into the row links
    q = re.search(r"startDate=([\d-]+)&amp;endDate=([\d-]+)([^\"]*)", table)
    start, end, extra = (q.group(1), q.group(2), q.group(3)) if q else ("", "", "")
    ranking_filter = (re.search(r"rankingFilter=([^&\"]+)", extra or "") or [None, ""])[1]
    year = start[:4] or path.stem

    out = []
    for row in rows:
        cells = [text(c) for c in TD_RE.findall(row)]
        if len(cells) < len(headers):
            continue  # header row / spacer

        pid = re.search(r"/stats/players/(\d+)/([^?\"]+)", row)
        if not pid:
            continue

        # nationality comes from the flag img — needed for the chemistry mechanic
        flag = re.search(r'<img alt="([^"]+)"[^>]*class="flag"', row)

        # a player can have several teams in one year (transfers) — keep them all
        teams = re.findall(r"/stats/teams/(\d+)/([^?\"]+)\?", row)
        team_names = re.findall(r'<img alt="([^"]+)"[^>]*class="logo"', row)
        if not team_names:
            # teams without a logo still carry the name in the cell's data-sort
            team_names = re.findall(r'<td class="teamCol"[^>]*data-sort="([^"]+)"', row)
        if not team_names:
            team_names = [n.replace("-", " ").title() for _, n in teams]

        out.append({
            "year": year,
            "player_id": pid.group(1),
            "nick": cells[0],
            "nationality": flag.group(1) if flag else "",
            "team_ids": "|".join(dict.fromkeys(t[0] for t in teams)),
            "teams": "|".join(dict.fromkeys(team_names)),
            "maps": cells[2],
            "rounds": cells[3],
            "kd_diff": cells[4],
            "kd": cells[5],
            "rating": cells[6],
            "rating_version": headers[6] if len(headers) > 6 else "",
            "ranking_filter": ranking_filter,
            "date_range": f"{start}..{end}",
        })
    return out


def main() -> None:
    files = sorted(RAW.glob("*.html"))
    if not files:
        raise SystemExit(f"no .html files in {RAW}")

    allrows = []
    for f in files:
        rows = parse_file(f)
        print(f"{f.name:14} {len(rows):4d} players  "
              f"filter={rows[0]['ranking_filter'] or '(none)':8} "
              f"rating={rows[0]['rating_version']}")
        allrows.extend(rows)

    with OUT.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(allrows[0].keys()))
        w.writeheader()
        w.writerows(allrows)
    print(f"\n-> {OUT.relative_to(Path.cwd())}  ({len(allrows)} rows)")

    # pivot: one row per (year, player), carrying both filter views
    merged = {}
    for r in allrows:
        k = (r["year"], r["player_id"])
        m = merged.setdefault(k, {
            "year": r["year"], "player_id": r["player_id"], "nick": r["nick"],
            "nationality": r["nationality"], "teams": r["teams"],
            "rating_top20": "", "maps_top20": "",
            "rating_all": "", "maps_all": "", "rating": "", "rating_source": "",
        })
        suffix = "top20" if (r["ranking_filter"] or "").lower() == "top20" else "all"
        m[f"rating_{suffix}"] = r["rating"]
        m[f"maps_{suffix}"] = r["maps"]

    for m in merged.values():
        if m["rating_top20"]:
            m["rating"], m["rating_source"] = m["rating_top20"], "Top20"
        else:
            m["rating"], m["rating_source"] = m["rating_all"], "All"

    mout = Path(__file__).parent / "ratings_merged.csv"
    with mout.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(next(iter(merged.values())).keys()))
        w.writeheader(); w.writerows(merged.values())

    both = [m for m in merged.values() if m["rating_top20"] and m["rating_all"]]
    print(f"-> {mout.relative_to(Path.cwd())}  ({len(merged)} players)")
    print(f"   Top20 only: {sum(1 for m in merged.values() if m['rating_top20'] and not m['rating_all'])}"
          f" | All only: {sum(1 for m in merged.values() if m['rating_all'] and not m['rating_top20'])}"
          f" | both: {len(both)}")
    if both:
        dm = [int(m["maps_all"]) - int(m["maps_top20"]) for m in both]
        dr = [round(float(m["rating_all"]) - float(m["rating_top20"]), 3) for m in both]
        same = sum(1 for d in dm if d == 0)
        print(f"\n   FILTER SEMANTICS TEST ({len(both)} players in both views):")
        print(f"     identical map counts: {same}/{len(both)}")
        if same == len(both):
            print("     -> rankingFilter only filters WHICH PLAYERS ARE LISTED.")
            print("        Top20 adds no rating accuracy; use All and filter locally.")
        else:
            print(f"     -> rankingFilter filters WHICH MATCHES COUNT."
                  f" mean map delta {sum(dm)/len(dm):+.1f}, mean rating delta {sum(dr)/len(dr):+.3f}")
            print("        Top20 ratings are genuinely quality-adjusted. Prefer them.")


if __name__ == "__main__":
    main()
