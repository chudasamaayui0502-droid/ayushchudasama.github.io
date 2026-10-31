#!/usr/bin/env python3
"""Long-term investing for the stocks/ page.

* SIP: a fixed amount every month into the Nifty 50 ETF (NIFTYBEES). The page
  replays it on real prices for any amount and start year.
* Strongest stocks (momentum): hold the N stocks that rose the most over the
  last months, among the 100 most traded at the time, and swap them once a
  month. Its settings are picked each January from what was known then, and
  that whole process is replayed year by year since 2019 (walk-forward), the
  same honest test as the swing plans get.

screener.py runs this in the weekly re-test and at each month-end.
"""
from __future__ import annotations

import datetime as dt
import math
import time
from dataclasses import dataclass

import numpy as np
import pandas as pd

import screener as S

# (N stocks, look-back days, days skipped at the end, keep while ranked below, market filter, trend filter)
GRID = [(n, look, skip, buf, filt, trend)
        for n in (5, 10)
        for look, skip in ((126, 0), (252, 21), (126, 21))
        for buf in (n, 2 * n)
        for filt in (False, True)
        for trend in (False, True)]
CAPITALS = [10000, 25000, 50000, 100000]
FIRST_YEAR = 2019        # walk-forward from this January
CHECK_YEARS = 2          # the latest years before each January are the "checking" part
LIST_CAPITAL = 10_000_000  # big enough that every stock fits, for the list of names


@dataclass
class Arrays:
    dates: pd.DatetimeIndex
    symbols: list
    O: np.ndarray
    Cf: np.ndarray
    month_end: np.ndarray
    eligible: np.ndarray     # [day, stock] on the list (from the day after each month-end)
    trend_ok: np.ndarray     # close above the 200-day average
    market_up: np.ndarray    # Nifty 50 above its 200-day average
    scores: dict             # (look, skip) -> [day, stock] return over the look-back


def arrays(p: S.Panel, market: dict, eligible: pd.DataFrame) -> Arrays:
    Cf = p.C.ffill().to_numpy()
    scores = {}
    for _, look, skip, *_ in GRID:
        if (look, skip) in scores:
            continue
        with np.errstate(invalid="ignore", divide="ignore"):
            a = np.full_like(Cf, np.nan)
            a[look:] = Cf[look - skip:len(Cf) - skip] / Cf[:len(Cf) - look] - 1
        scores[(look, skip)] = a
    sma = p.C.rolling(200, min_periods=200).mean().to_numpy()
    with np.errstate(invalid="ignore"):
        trend_ok = p.C.to_numpy() > sma
    up = np.zeros(len(p.dates), dtype=bool)
    if "nifty" in market:
        n = market["nifty"]["Close"].reindex(p.dates, method="ffill", limit=5)
        up = (n > n.rolling(200, min_periods=200).mean()).to_numpy()
    el = eligible.reindex(index=p.dates, columns=p.symbols).fillna(False).to_numpy(bool)
    # a month's last trading day (a holiday on the calendar's last weekday doesn't skip the month)
    me = np.r_[p.dates.month[1:] != p.dates.month[:-1], True]
    return Arrays(p.dates, list(p.symbols), p.O.to_numpy(), Cf, me, el, trend_ok, up, scores)


def ranking(A: Arrays, variant, t: int) -> list:
    """Stocks on the list at month-end t, strongest first."""
    n, look, skip, buf, filt, trend = variant
    sc = A.scores[(look, skip)][t].copy()
    ok = A.eligible[min(t + 1, len(A.dates) - 1)] & np.isfinite(sc)
    if trend:
        ok &= A.trend_ok[t]
    sc[~ok] = -np.inf
    order = np.argsort(-sc, kind="stable")
    return [int(k) for k in order if ok[k]]


def simulate(A: Arrays, variant, capital: float, start: int, end: int) -> dict:
    """Decide at each month-end close from the day before `start` until `end`,
    trade at the next open: sell what dropped out (below rank `buf`), buy the
    strongest to fill N equal slots, whole shares, Groww delivery charges. With
    the market filter, everything is sold while the Nifty is below its 200-day
    average. Sold at the close of `end`."""
    n, look, skip, buf, filt, trend = variant
    cash, hold = float(capital), {}
    marks, charges, trades, log = [], 0.0, 0, []
    decisions = [t for t in range(max(start - 1, 0), end) if A.month_end[t] and t + 1 >= start]
    for t in decisions:
        marks.append(cash + sum(sh * A.Cf[t, k] for k, sh in hold.items()))
        order = ranking(A, variant, t)
        rank = {k: r for r, k in enumerate(order)}
        cash_only = filt and not A.market_up[t]
        keep = [] if cash_only else [k for k in hold if rank.get(k, 10 ** 9) < buf]
        want = keep + [k for k in order[:n] if k not in keep][:max(0, n - len(keep))] if not cash_only else []
        d = t + 1
        sold, bought = [], []
        for k in list(hold):
            if k not in want:
                px = A.O[d, k] if np.isfinite(A.O[d, k]) else A.Cf[d, k]
                v = hold.pop(k) * px
                fee = float(S.sell_charges(v))
                cash += v - fee
                charges += fee
                trades += 1
                sold.append(k)
        new = [k for k in want if k not in hold]
        for i, k in enumerate(new):
            if not np.isfinite(A.O[d, k]):
                continue
            sh = float(S.affordable_shares(cash / (len(new) - i), A.O[d, k]))
            if sh >= 1:
                v = sh * A.O[d, k]
                fee = float(S.buy_charges(v))
                cash -= v + fee
                charges += fee
                trades += 1
                hold[k] = sh
                bought.append(k)
        log.append((d, sold, bought))
    value = cash + sum(sh * A.Cf[end, k] for k, sh in hold.items())
    final = value - sum(float(S.sell_charges(sh * A.Cf[end, k])) for k, sh in hold.items())
    marks.append(final)
    m = np.array(marks)
    years = max((A.dates[end] - A.dates[start]).days / 365.25, 1 / 365.25)
    return {"final": final, "cagr": (final / capital) ** (1 / years) - 1 if final > 0 else -1.0,
            "max_dd": float(np.max(1 - m / np.maximum.accumulate(m))) if len(m) else 0.0,
            "trades": trades, "charges": charges, "hold": hold, "log": log}


def row(dates: pd.DatetimeIndex, day: str, side="left") -> int:
    return int(dates.searchsorted(pd.Timestamp(day), side=side))


def pick(A: Arrays, capital: float, year: int, first_day: str) -> tuple:
    """The settings for `year`: best weaker part of training (from first_day)
    and checking (the CHECK_YEARS before), using prices up to Dec 31 only."""
    begin, v, s = row(A.dates, first_day), row(A.dates, f"{year - CHECK_YEARS}-01-01"), row(A.dates, f"{year}-01-01")
    best = None
    for variant in GRID:
        a = simulate(A, variant, capital, begin, v - 1)["cagr"]
        b = simulate(A, variant, capital, v, s - 1)["cagr"]
        key = (min(a, b), a > 0 and b > 0)
        if best is None or key[0] > best[0][0]:
            best = (key, variant, a, b)
    return best


def etf_hold(bench: pd.DataFrame | None, dates, capital: float, start: int, ends: list):
    """Buy the Nifty 50 ETF once at `start` and hold: value at each of `ends`
    (the last one after sale charges), the same yardstick as the swing test."""
    if bench is None:
        return None
    b = bench.reindex(dates)
    O, C = b["Open"].to_numpy(), b["Close"].ffill().to_numpy()
    f0 = start + int(np.argmax(np.isfinite(O[start:])))
    if not np.isfinite(O[f0]):
        return None
    units = float(S.affordable_shares(capital, O[f0]))
    cash = capital - units * O[f0] - float(S.buy_charges(units * O[f0]))
    marks = [cash + units * C[e] for e in ends]
    marks[-1] -= float(S.sell_charges(units * C[ends[-1]]))
    return marks


def walk_forward(A: Arrays, bench, capital: float, first_day: str, log=print) -> dict | None:
    """Each January: pick the settings from what was known, follow them for the
    year (starting with what last year ended with, sold at year-end)."""
    years, value, ends = [], float(capital), []
    for y in range(FIRST_YEAR, A.dates[-1].year + 1):
        s, e = row(A.dates, f"{y}-01-01"), row(A.dates, f"{y}-12-31", "right") - 1
        if s >= len(A.dates) or e <= s:
            break
        (steady, passed), variant, a, b = pick(A, capital, y, first_day)
        run = simulate(A, variant, value, s, e)
        years.append({"year": y, "plan": list(variant), "passed": bool(passed), "start_value": value, "end_value": run["final"],
                      "max_dd": run["max_dd"], "trades": run["trades"], "charges": run["charges"]})
        value = run["final"]
        ends.append(e)
    if not years:
        return None
    s0 = row(A.dates, f"{years[0]['year']}-01-01")
    yrs = max((A.dates[ends[-1]] - A.dates[s0]).days / 365.25, 1 / 365.25)
    out = {"start": str(A.dates[s0].date()), "end": str(A.dates[ends[-1]].date()), "final": value,
           "cagr": (value / capital) ** (1 / yrs) - 1, "worst_year": min(y["end_value"] / y["start_value"] - 1 for y in years),
           "years": years}
    etf = etf_hold(bench, A.dates, capital, s0, ends)
    if etf:
        prev = float(capital)
        for y, v in zip(years, etf):
            y.update({"etf_start": prev, "etf_end": v})
            prev = v
        out["etf"] = {"final": etf[-1], "cagr": (etf[-1] / capital) ** (1 / yrs) - 1}
    log(f"Strongest stocks Rs {capital:,}: walk-forward {out['start'][:4]}-{out['end'][:4]} -> Rs {value:,.0f} "
        f"({out['cagr']:+.1%} a year) | Nifty ETF -> Rs {etf[-1] if etf else float('nan'):,.0f}")
    return out


def current_list(A: Arrays, variant, names: dict) -> dict:
    """The stocks to hold after the latest month-end, and what changes from the
    month before, as if the settings had been followed for the past year."""
    last = len(A.dates) - 1
    # the latest finished month: the last row counts once the calendar says no weekday is left in its month
    done_last = (A.dates[last] + pd.offsets.BDay(1)).month != A.dates[last].month
    month_ends = [t for t in range(last) if A.month_end[t]] + ([last] if done_last else [])
    decide = month_ends[-1]
    start = row(A.dates, str((A.dates[decide] - pd.DateOffset(months=13)).date()))
    before = sorted(simulate(A, variant, LIST_CAPITAL, start + 1, decide)["hold"]) if decide > start + 1 else []
    order = ranking(A, variant, decide)
    rank = {k: r for r, k in enumerate(order)}
    n, look, skip, buf, filt, trend = variant
    cash_only = bool(filt and not A.market_up[decide])
    keep = [] if cash_only else [k for k in before if rank.get(k, 10 ** 9) < buf]
    want = [] if cash_only else keep + [k for k in order[:n] if k not in keep][:max(0, n - len(keep))]
    sc = A.scores[(look, skip)][decide]
    item = lambda k: {"s": A.symbols[k], "name": names.get(A.symbols[k], A.symbols[k]), "close": float(A.Cf[last, k]),
                      "score": float(sc[k]) if np.isfinite(sc[k]) else None, "rank": rank.get(k)}
    return {"as_of": str(A.dates[decide].date()), "cash": cash_only,
            "hold": [item(k) for k in want], "sell": [item(k) for k in before if k not in want],
            "buy": [item(k) for k in want if k not in before], "previous": [A.symbols[k] for k in before]}


def sip_series(bench: pd.DataFrame | None, dates: pd.DatetimeIndex) -> dict | None:
    """Each month's first trading day and its opening price, for the page's
    SIP calculator, plus the latest close."""
    if bench is None:
        return None
    b = bench.reindex(dates)
    O, C = b["Open"].to_numpy(), b["Close"].ffill().to_numpy()
    first = np.r_[True, dates.month[1:] != dates.month[:-1]]
    months = [[str(dates[i].date()), float(O[i])] for i in np.nonzero(first)[0] if np.isfinite(O[i]) and dates[i].year >= 2015]
    return {"symbol": S.BENCHMARK, "months": months, "last": [str(dates[-1].date()), float(C[-1])]}


def sip(series: dict, monthly: float, start_month: str) -> dict:
    """Invest `monthly` on the first trading day of every month from
    `start_month` (YYYY-MM): whole units at the open, Groww delivery charges,
    cash left over waits for next month. Valued at the last close after sale charges."""
    cash = units = invested = 0.0
    flows = []
    for day, px in series["months"]:
        if day[:7] < start_month:
            continue
        cash += monthly
        invested += monthly
        flows.append((day, -monthly))
        n = float(S.affordable_shares(cash, px))
        if n >= 1:
            v = n * px
            cash -= v + float(S.buy_charges(v))
            units += n
    day, last = series["last"]
    sale = units * last
    value = cash + sale - float(S.sell_charges(sale))
    flows.append((day, value))
    return {"invested": invested, "value": value, "units": units, "xirr": xirr(flows)}


def xirr(flows) -> float:
    t0 = dt.date.fromisoformat(flows[0][0])
    when = [(dt.date.fromisoformat(d) - t0).days / 365.25 for d, _ in flows]
    npv = lambda r: sum(f / (1 + r) ** w for (_, f), w in zip(flows, when))
    lo, hi = -0.99, 10.0
    if npv(lo) * npv(hi) > 0:
        return math.nan
    for _ in range(200):
        mid = (lo + hi) / 2
        if npv(lo) * npv(mid) <= 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def run(p: S.Panel, market: dict, bench, eligible: pd.DataFrame, names: dict, log=print) -> dict:
    t0 = time.time()
    A = arrays(p, market, eligible)
    first_day = S.PERIODS[0][1]
    this_year = A.dates[-1].year
    buckets = []
    for cap in CAPITALS:
        walk = walk_forward(A, bench, cap, first_day, log)
        (steady, passed), variant, a, b = pick(A, cap, this_year, first_day)
        buckets.append({"capital": cap, "plan": list(variant), "plan_year": this_year, "passed": bool(passed),
                        "pick": {"train": a, "check": b}, "walk": walk, "list": current_list(A, variant, names)})
    log(f"Invest: {len(GRID)} settings x {len(CAPITALS)} amounts in {time.time() - t0:.0f}s")
    return {
        "generated_at": dt.datetime.now(S.IST).isoformat(timespec="minutes"),
        "data_end": str(A.dates[-1].date()),
        "grid": {"settings": len(GRID), "first_year": FIRST_YEAR, "check_years": CHECK_YEARS, "capitals": CAPITALS},
        "universe": {"size": int(A.eligible[-1].sum()), "from": len(A.symbols)},
        "sip": sip_series(bench, A.dates),
        "momentum": buckets,
    }
