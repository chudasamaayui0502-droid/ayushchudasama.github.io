#!/usr/bin/env python3
"""Every NSE stock, every evening.

Downloads the daily chart of every NSE equity (EQ series, about 2,350 stocks)
from Moneycontrol's chart feed (official NSE daily prices, adjusted for bonuses
and splits), reads each one's daily and weekly chart for every pattern, and
reads the 5-minute charts of the most traded ones. Writes data/scan.json: the
whole-market scan for the Swing tab, the stock list and levels for the live
scanner, and names for "Check a stock".
"""
from __future__ import annotations

import datetime as dt
import io
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

import daytrade as DT
import screener as S

HERE = Path(__file__).resolve().parent
ALL_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
FALLBACK_ALL = HERE / "nse_equity_fallback.csv"
THREADS = 8
SCAN_DAYS = 1000         # calendar days (~690 sessions): 52-week highs, 200-day averages, and settled MACD/ADX averages
MIN_TURNOVER = 5e7       # Rs 5 crore a day (median of 20 days): easy to buy and sell
MIN_PRICE = 20.0
LIVE_SIZE = 500          # stocks the live scanner may read
INTRADAY_DAYS = 12       # calendar days of 5-minute bars read each evening
N_SLOTS = DT.N_BARS
# share of a normal day's volume done by the end of each 5-minute slot (9:15 ... 3:30),
# measured on 500 stocks in Oct-Nov 2026; replaced by each evening's own measurement
DEFAULT_CURVE = [
    0.0455, 0.0716, 0.0933, 0.1137, 0.1322, 0.1489, 0.1651, 0.1806, 0.195, 0.2093, 0.2228, 0.2357,
    0.2486, 0.2612, 0.273, 0.2849, 0.2965, 0.3077, 0.3192, 0.3303, 0.3411, 0.3522, 0.363, 0.3734,
    0.3841, 0.3946, 0.4051, 0.4156, 0.4257, 0.436, 0.446, 0.4562, 0.4667, 0.4769, 0.4867, 0.4965,
    0.5062, 0.5163, 0.5258, 0.5358, 0.5457, 0.5552, 0.5644, 0.5736, 0.5833, 0.5927, 0.6018, 0.6112,
    0.6208, 0.63, 0.639, 0.6483, 0.6578, 0.6672, 0.677, 0.6864, 0.6958, 0.7061, 0.7159, 0.726,
    0.7369, 0.7475, 0.7586, 0.7701, 0.782, 0.7952, 0.8091, 0.8241, 0.8402, 0.8648, 0.8898, 0.9154,
    0.9431, 0.971, 1.0, 1.0,
]


def load_all() -> pd.DataFrame:
    """NSE's list of all listed equities, EQ series (normal trading): Symbol, Name."""
    try:
        req = urllib.request.Request(ALL_URL, headers={"User-Agent": "Mozilla/5.0"})
        raw = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
        df = pd.read_csv(io.StringIO(raw))
        df.columns = [c.strip() for c in df.columns]
        if len(df) < 1500 or "SYMBOL" not in df:
            raise ValueError("unexpected NSE equity list")
        df = df[df["SERIES"].astype(str).str.strip() == "EQ"]
        out = pd.DataFrame({"Symbol": df["SYMBOL"].astype(str).str.strip(), "Name": df["NAME OF COMPANY"].astype(str).str.strip()})
        out.to_csv(FALLBACK_ALL, index=False)
    except Exception as exc:  # NSE blocks some networks; the saved copy is fine
        print(f"Using saved NSE equity list ({exc})", file=sys.stderr)
        out = pd.read_csv(FALLBACK_ALL)
    return out.drop_duplicates("Symbol").reset_index(drop=True)


CHUNK = 100       # stocks per batch
TIMEOUT = 20      # seconds one request may take in the bulk download
MIN_OK = 0.5      # stop early when fewer than half of the stocks so far came back


def fetch_in_chunks(symbols, days: int, res: str, log=print) -> dict:
    """fetch_many in batches; if the feed refuses most requests (blocked or down),
    stop after a batch instead of waiting out thousands of failures."""
    frames, tried = {}, 0
    for i in range(0, len(symbols), CHUNK):
        part = symbols[i:i + CHUNK]
        frames.update(DT.fetch_many(part, days, res=res, threads=THREADS, timeout=TIMEOUT))
        tried += len(part)
        if len(frames) < MIN_OK * tried:
            log(f"The chart feed answered only {len(frames)} of {tried} requests; stopping early.")
            break
    return frames


def download_all(symbols, days: int, log=print) -> dict:
    """Moneycontrol daily bars for every symbol, 8 at a time: {symbol: DataFrame(o,h,l,c,v)}."""
    t0 = time.time()
    frames = fetch_in_chunks(list(symbols), days, "D", log)
    log(f"Daily charts: {len(frames)} of {len(symbols)} NSE stocks in {time.time() - t0:.0f}s")
    return frames


def to_screener(frames: dict, start: str | None = None) -> dict:
    """Feed bars -> the screener's Open/High/Low/Close/Volume frames."""
    out = {}
    for s, df in frames.items():
        df = df.rename(columns={"o": "Open", "h": "High", "l": "Low", "c": "Close", "v": "Volume"})
        if start:
            df = df[df.index >= pd.Timestamp(start)]
        df = S._clean(df)
        if len(df) >= 30:
            out[s] = df
    return out


def turnover(p: S.Panel, days: int = 20) -> pd.Series:
    """Median daily traded value (Rs) over the last `days` sessions."""
    return (p.C * p.V).iloc[-days:].median()


def liquid(p: S.Panel) -> pd.Series:
    """Stocks easy enough to trade: Rs 5 crore a day or more, price Rs 20 or more, traded today."""
    last = p.C.iloc[-1]
    return (turnover(p) >= MIN_TURNOVER) & (last >= MIN_PRICE) & last.notna()


def volume_curve(ip: DT.Intraday | None) -> list | None:
    """For each 5-minute slot, the median share of a full day's volume traded by its end."""
    if ip is None or not len(ip.dates):
        return None
    v = np.nan_to_num(ip.V, nan=0.0)                       # [day, slot, stock]
    total = v.sum(axis=1, keepdims=True)
    with np.errstate(invalid="ignore", divide="ignore"):
        frac = np.cumsum(v, axis=1) / total
    frac = np.where(total > 0, frac, np.nan)
    curve = np.nanmedian(frac.transpose(1, 0, 2).reshape(N_SLOTS, -1), axis=1)
    curve = np.maximum.accumulate(np.nan_to_num(curve, nan=0.0))
    curve[-1] = 1.0
    return [round(float(x), 4) for x in curve]


def download_intraday(symbols, days: int = INTRADAY_DAYS, log=print):
    """A few days of 5-minute bars for the most traded stocks (8 at a time)."""
    t0 = time.time()
    frames = fetch_in_chunks(list(symbols), days, "5", log)
    log(f"5-minute charts: {len(frames)} of {len(symbols)} stocks in {time.time() - t0:.0f}s")
    return DT.to_sessions(frames) if frames else None


def payload(p: S.Panel, base_signals, names: dict, test_list: list, curve: list | None, intraday_read: int) -> dict:
    """data/scan.json. `base_signals`: pattern_signals(p) (no market filters);
    `test_list`: the stocks the buy list may use today."""
    liq = liquid(p)
    turn = turnover(p)
    order = turn[liq].sort_values(ascending=False).index.tolist()
    rank = {s: i for i, s in enumerate(order)}
    last = len(p.dates) - 1
    hits, by_stock, patterns = {}, {}, {}
    for v, sig in base_signals:
        patterns[v.id] = v.name
        row = sig.iloc[last]
        syms = sorted((s for s in row.index[row.to_numpy()] if s in rank), key=rank.get)
        hits[v.id] = syms
        for s in syms:
            by_stock.setdefault(s, []).append(v.id)
    C, H, L, V = p.C, p.H, p.L, p.V
    h52, l52 = H.iloc[-252:].max(), L.iloc[-252:].min()
    adv = V.iloc[-20:].mean()
    rnd = lambda x: None if not np.isfinite(x) else round(float(x), 2)
    live = [[s, rnd(C[s].iloc[-1]), rnd(H[s].iloc[-1]), rnd(L[s].iloc[-1]), rnd(h52[s]), rnd(l52[s]), int(adv[s])]
            for s in order[:LIVE_SIZE] if np.isfinite(adv[s])]
    traded_today = int(C.iloc[-1].notna().sum())
    return {
        "generated_at": dt.datetime.now(S.IST).isoformat(timespec="minutes"),
        "data_date": str(p.dates[-1].date()),
        "counts": {"listed": len(names), "daily": traded_today, "weekly": traded_today, "intraday": int(intraday_read),
                   "patterns": len(base_signals), "liquid": int(liq.sum()),
                   "total": int(2 * traded_today + intraday_read)},
        "min_turnover_cr": round(MIN_TURNOVER / 1e7, 1), "min_price": MIN_PRICE,
        "test_list": sorted(test_list),
        "patterns": patterns, "hits": hits, "hits_by_stock": by_stock,
        "names": {s: names.get(s, s) for s in p.symbols},
        "live": {"fields": ["sym", "pc", "ph", "pl", "h52", "l52", "adv"], "rows": live},
        "vol_curve": curve,
    }
