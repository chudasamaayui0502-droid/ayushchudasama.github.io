#!/usr/bin/env python3
"""Does stocks/data/today.json lack the latest finished trading day?

The update workflow runs this first, before installing anything, so the
extra scheduled runs that find the prices already published finish in
seconds. Standard library only. Prints the reason and, inside GitHub
Actions, writes needed=true/false to $GITHUB_OUTPUT.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
TODAY_JSON = Path(__file__).resolve().parent.parent / "stocks" / "data" / "today.json"
BHAVCOPY_URL = "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{:%Y%m%d}_F_0000.csv.zip"
PRICES_OUT = dt.time(18, 30)  # a day's closing prices are normally out by then
SURELY_OUT = dt.time(22, 30)  # after this, no NSE file for the day means there was no trading


def expected_close_day(now: dt.datetime) -> dt.date:
    """The latest weekday whose closing prices should be out at `now` (IST):
    today from 6:30 PM on a weekday, otherwise the weekday before."""
    day = now.date()
    if now.weekday() >= 5 or now.time() < PRICES_OUT:
        day -= dt.timedelta(days=1)
        while day.weekday() >= 5:
            day -= dt.timedelta(days=1)
    return day


def nse_has_prices(day: dt.date) -> bool | None:
    """True if NSE has published the day's closing prices, False if it says it
    has none (no trading that day, or not out yet), None if it can't be reached."""
    req = urllib.request.Request(BHAVCOPY_URL.format(day), headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=30):
            return True
    except urllib.error.HTTPError as exc:
        return False if exc.code == 404 else None
    except Exception:
        return None


def check(have: dt.date, now: dt.datetime, has_prices=nse_has_prices) -> tuple[bool, str]:
    """(update needed?, why). `have` is the latest day in today.json."""
    want = expected_close_day(now)
    if have >= want:
        return False, f"Up to date: the page has prices for {have}, the latest finished trading day."
    missing, day = [], want
    while day > have:
        if day.weekday() < 5:
            if day == want and now < dt.datetime.combine(want, SURELY_OUT, IST):
                return True, f"The page has prices up to {have}; prices for {want} should be out now."
            if has_prices(day) is not False:  # published, or NSE couldn't be asked
                return True, f"The page has prices up to {have}; prices for {day} are missing."
            missing.append(day)
        day -= dt.timedelta(days=1)
    days = ", ".join(str(d) for d in sorted(missing))
    return False, f"Up to date: the page has prices for {have}; NSE has none for {days} (market holiday)."


def main(argv=None) -> int:
    now = dt.datetime.now(IST)
    try:
        have = dt.date.fromisoformat(json.loads(TODAY_JSON.read_text())["data_date"])
    except Exception as exc:
        needed, why = True, f"No usable {TODAY_JSON.name} ({exc})."
    else:
        needed, why = check(have, now, has_prices=nse_has_prices)
    print(why)
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"needed={'true' if needed else 'false'}\n")
    else:
        print(f"needed={'true' if needed else 'false'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
