#!/usr/bin/env python3
"""The tool's own track record, from the day it started.

Each evening the swing buy list the page shows is saved (for a few amounts),
and those exact picks are followed with paper money the way the page tells
you to: bought at the next open while a slot is free, sold at their target,
stop-loss or time limit, with Groww charges. Unlike a backtest this can't be
fitted to the past: it only grows one day at a time.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import numpy as np
import pandas as pd

import screener as S

CAPITALS = (1000, 2000, 5000, 10000, 25000, 50000, 100000)  # the page's amounts


def bucket_for(bt: dict, cap: int) -> dict:
    pick = bt["buckets"][0]
    for b in bt["buckets"]:
        if cap >= b["capital"]:
            pick = b
    return pick


def todays_picks(today: dict, bt: dict, cap: int) -> list:
    """The buy list the page shows for `cap` (best tested plan), in its order:
    the plan's own signals first, then the steadiest patterns, then 6-month
    strength; only stocks one share of which fits. The same as todaysSignals()
    in stocks/app.js. Returns [[symbol, pattern, rule], ...]."""
    b = bucket_for(bt, cap)
    if not b.get("chosen"):
        return []
    plan_vid = b["chosen"].split("|")[0]
    per = cap / b["slots"]
    best = {}
    for vid, rows in today["signals"].items():
        r = bt["pattern_rules"].get(vid, {}).get(str(b["capital"]))
        if not r or not r.get("ends") or not rows:
            continue
        for row in rows:
            e = (vid == plan_vid, r["steady"], vid, r["rule"])
            cur = best.get(row["s"])
            if cur is None or (e[0] or (not cur[0] and e[1] > cur[1])):
                best[row["s"]] = e
    out = []
    for sym, (plan, steady, vid, rule) in best.items():
        st = today["stocks"].get(sym)
        if st and float(S.affordable_shares(per, st["close"])) >= 1:
            out.append((plan, steady, st.get("m") if st.get("m") is not None else -1, sym, vid, rule))
    out.sort(key=lambda x: (-x[0], -x[1], -x[2]))  # stable, like the page's sort
    keep = 2 * b["slots"]  # enough to fill free slots past stocks already held
    return [[sym, vid, rule] for *_, sym, vid, rule in out[:keep]]


def follow(picks: dict, p: S.Panel, cap: int, bench: pd.DataFrame | None) -> dict | None:
    """Buy each saved day's picks at the next open, in their order, while
    slots are free; sell by each pick's own rule; value at the last close."""
    O, H, L, C = (df.to_numpy() for df in (p.O, p.H, p.L, p.C))
    Cf = p.C.ffill().to_numpy()
    days = sorted(d for d in picks if picks[d].get(str(cap)))
    parts, rules = [], {}
    for day in days:
        t = p.dates.searchsorted(pd.Timestamp(day))
        if t >= len(p.dates) - 1 or p.dates[t] != pd.Timestamp(day):
            continue  # bought tomorrow: not yet
        rows = picks[day][str(cap)]
        for rank, (sym, vid, rule) in enumerate(rows):
            if sym not in p.symbols:
                continue
            n, e = np.array([p.symbols.index(sym)]), np.array([t + 1])
            if not np.isfinite(O[e[0], n[0]]):
                continue
            tg, st, hd = (int(x) for x in rule.split("|"))
            ex = S.simulate_exits(n, e, O[e, n], np.array([-float(t) * 1000 - rank]), O, H, L, C,
                                  **S.exits_for((tg / 100, st / 100, hd)))
            parts.append(next(iter(ex.values())))
            rules.setdefault((n[0], e[0]), rule)
    if not days:
        return None
    start = int(p.dates.searchsorted(pd.Timestamp(days[0]))) + 1
    end = len(p.dates) - 1
    if start > end:  # the first picks are bought at the next open
        return None
    if parts:
        allt = S.Trades(*(np.concatenate([getattr(x, f) for x in parts]) for f in S.Trades.__dataclass_fields__))
        run = S.portfolio_sim(allt, cap, S.slots_for(cap), start, end, Cf, p.dates)
    else:
        run = {"final": float(cap), "log": [], "charges": 0.0}
    b = None
    if bench is not None:
        bb = bench.reindex(p.dates)
        b = S.buy_and_hold(bb["Open"].to_numpy(), bb["Close"].to_numpy(), cap, start, end, p.dates)
    # [stock, bought, price, sold (or today), price, shares, profit after charges, why (2 target,
    #  1 stop-loss, 0 time, -1 still open), rule]
    log = [[p.symbols[k], str(p.dates[b_].date()), bp, str(p.dates[s2].date()), sp, sh, pnl, kind, rules[(k, b_)]]
           for k, b_, bp, s2, sp, sh, pnl, kind in run["log"]]
    closed = [x for x in log if x[7] != -1]
    return {"start": str(p.dates[start].date()), "end": str(p.dates[end].date()), "final": run["final"],
            "trades": len(closed), "closed": closed, "open": [x for x in log if x[7] == -1],
            "win_rate": sum(x[6] > 0 for x in closed) / len(closed) if closed else None,
            "charges": run["charges"], "etf_final": b["final"] if b else None}


def update(path: Path, today: dict, bt: dict, p: S.Panel, bench: pd.DataFrame | None) -> dict:
    """Save today's picks (once per day) and follow everything saved so far."""
    try:
        track = json.loads(path.read_text())
    except Exception:
        track = {"picks": {}}
    day = today["data_date"]
    if day not in track["picks"]:
        track["picks"][day] = {str(c): todays_picks(today, bt, c) for c in CAPITALS}
    track["results"] = {str(c): follow(track["picks"], p, c, bench) for c in CAPITALS}
    track["since"] = min(track["picks"])
    track["generated_at"] = dt.datetime.now(S.IST).isoformat(timespec="minutes")
    return track
