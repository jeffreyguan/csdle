#!/usr/bin/env python3
"""Rate-limited, disk-cached Liquipedia CS wiki client.

Terms: https://liquipedia.net/api-terms-of-use
  - action=parse : max 1 request / 30s
  - other        : max 1 request / 2s
  - custom User-Agent with contact info REQUIRED
  - cache aggressively; do not re-request identical data
"""
import json, os, time, urllib.parse, urllib.request
from pathlib import Path

CACHE = Path(__file__).parent / "cache"
CACHE.mkdir(exist_ok=True)

API = "https://liquipedia.net/counterstrike/api.php"

# override with CSDLE_CONTACT to keep this out of a public repo
CONTACT = os.environ.get("CSDLE_CONTACT", "jeffreyguan0710@gmail.com")
UA = f"csdle/0.1 (https://github.com/jeffreyguan/csdle; {CONTACT}) python-urllib"

PARSE_DELAY = 30.0
QUERY_DELAY = 2.0
_last = [0.0]


def _throttle(delay: float) -> None:
    wait = delay - (time.monotonic() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.monotonic()


def get(params: dict) -> dict:
    """Fetch from the API, or return the cached copy if we already have it."""
    params = {**params, "format": "json"}
    key = urllib.parse.urlencode(sorted(params.items())).replace("/", "_").replace("&", "__")
    blob = CACHE / f"{key[:180]}.json"

    if blob.exists():
        return json.loads(blob.read_text())

    _throttle(PARSE_DELAY if params.get("action") == "parse" else QUERY_DELAY)

    req = urllib.request.Request(
        f"{API}?{urllib.parse.urlencode(params)}",
        headers={"User-Agent": UA, "Accept-Encoding": "gzip"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            import gzip
            raw = gzip.decompress(raw)

    data = json.loads(raw)
    blob.write_text(json.dumps(data))
    return data


def page_html(title: str) -> str:
    d = get({"action": "parse", "page": title, "prop": "text"})
    if "error" in d:
        raise SystemExit(f"{title}: {d['error'].get('info')}")
    return d["parse"]["text"]["*"]
