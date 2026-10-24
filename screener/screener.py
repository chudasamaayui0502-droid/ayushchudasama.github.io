#!/usr/bin/env python3
"""Swing-trade screener for NSE (India) stocks.

Downloads daily prices for the Nifty 100, looks for chart patterns, backtests
every pattern x target x stop-loss x holding-time combination with Groww
delivery charges, and writes JSON for the stocks/ page.

    python screener/screener.py --mode full    # backtest + today's signals
    python screener/screener.py --mode daily   # today's signals only
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import math
import pickle
import sys
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE.parent / "stocks" / "data"
CACHE_DIR = HERE / ".cache"
FALLBACK_LIST = HERE / "nifty100_fallback.csv"
NIFTY100_URL = "https://archives.nseindia.com/content/indices/ind_nifty100list.csv"

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
HISTORY_START = "2014-01-01"
# Strategies are picked on "train", the best few are compared on "validate",
# and "test" is never used for picking, so it shows how the pick really did.
PERIODS = [
    ("train", "2015-01-01", "2020-12-31"),
    ("validate", "2021-01-01", "2023-06-30"),
    ("test", "2023-07-01", None),
]
CAPITALS = [1000, 2000, 5000, 10000, 25000, 50000, 100000]
TARGETS = (0.05, 0.08, 0.12, 0.20)
STOPS = (0.04, 0.07, 0.10)
HOLDS = (10, 20, 40)  # trading days
# Trailing stops: no fixed target; sell once the price falls this far below
# its highest close since buying, or after the holding limit. Big winners
# keep running, and fewer, longer trades mean charges matter less.
TRAILS = (0.10, 0.15, 0.20)
TRAIL_HOLDS = (60, 120)  # trading days
STANDARD_EXIT = (0.08, 0.04, 20)  # used to compare patterns with each other
BENCHMARK = "NIFTYBEES"  # Nifty 50 ETF
# Big news (wars, rate changes, budgets, global crashes) shows up in these
# within days, and unlike news itself they have a long, testable history.
MARKET_TICKERS = {"nifty": "^NSEI", "vix": "^INDIAVIX", "world": "^GSPC"}
VIX_CALM = 20
# Latest company numbers from Yahoo, shown next to buy signals. There is no
# free history of past reports, so these can't be part of the backtest.
FUNDAMENTAL_FIELDS = {"pe": "trailingPE", "pb": "priceToBook", "de": "debtToEquity", "roe": "returnOnEquity",
                      "margin": "profitMargins", "rev_growth": "revenueGrowth", "earn_growth": "earningsGrowth"}
MIN_TRAIN_TRADES = 30
CANDIDATES_PER_CAPITAL = 12
RANDOM_RUNS = 100
# One run of a strategy depends a lot on its first few trades: start a week
# later and every trade after that can change. So each strategy is run from
# several start weeks and judged on the middle result.
START_OFFSETS = 8
OFFSET_STEP = 7  # trading days between start dates
# Many strategies score almost the same, so tiny data differences can reorder
# them. Keep last week's pick unless a new one is steadier by this much a year.
SWITCH_MARGIN = 0.02
RECENT_BARS = 70


# --------------------------------------------------------------------------
# Groww charges for equity delivery (groww.in/p/pricing, checked Oct 2026)
# --------------------------------------------------------------------------

def _brokerage(value):
    v = np.asarray(value, dtype=float)
    # 0.1% capped at Rs 20, minimum Rs 5, never above SEBI's 2.5% limit
    return np.minimum(np.minimum(np.maximum(0.001 * v, 5.0), 20.0), 0.025 * v)


def _exchange_fees(value):
    v = np.asarray(value, dtype=float)
    return 0.0000297 * v + 0.000001 * v + 0.000001 * v  # NSE txn + SEBI + IPFT


def buy_charges(value):
    v = np.asarray(value, dtype=float)
    brk, fees = _brokerage(v), _exchange_fees(v)
    stt, stamp = 0.001 * v, 0.00015 * v
    return np.where(v > 0, brk + fees + stt + stamp + 0.18 * (brk + fees), 0.0)


def sell_charges(value):
    v = np.asarray(value, dtype=float)
    brk, fees = _brokerage(v), _exchange_fees(v)
    stt = 0.001 * v
    dp = np.where(v >= 100, 20.0, 3.5)  # per sell transaction
    return np.where(v > 0, brk + fees + stt + dp + 0.18 * (brk + fees + dp), 0.0)


def affordable_shares(budget, price):
    """Whole shares that fit in budget including buy charges."""
    budget = np.asarray(budget, dtype=float)
    price = np.asarray(price, dtype=float)
    # buy_charges is non-decreasing, so charges on the full budget are an upper bound
    usable = np.maximum(budget - buy_charges(budget), 0.0)
    with np.errstate(divide="ignore", invalid="ignore"):
        shares = np.floor(usable / price)
    return np.where(np.isfinite(shares) & (price > 0), shares, 0.0)


# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------

def load_universe() -> pd.DataFrame:
    try:
        req = urllib.request.Request(NIFTY100_URL, headers={"User-Agent": "Mozilla/5.0"})
        raw = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
        df = pd.read_csv(io.StringIO(raw))
        if len(df) < 90 or "Symbol" not in df:
            raise ValueError("unexpected Nifty 100 list")
        FALLBACK_LIST.write_text(raw)
    except Exception as exc:  # NSE blocks some networks; the saved copy is fine
        print(f"Using saved Nifty 100 list ({exc})", file=sys.stderr)
        df = pd.read_csv(FALLBACK_LIST)
    df = df.rename(columns={"Company Name": "Name"})
    return df[["Symbol", "Name", "Industry"]].reset_index(drop=True)


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df[["Open", "High", "Low", "Close", "Volume"]].astype(float).dropna()
    df = df[(df["Close"] > 0) & (df["Open"] > 0) & (df["Volume"] > 0)].copy()
    # bad prints: an open/high/low far outside both yesterday's and today's close
    prev = df["Close"].shift(1)
    hi_ref, lo_ref = np.fmax(prev, df["Close"]), np.fmin(prev, df["Close"])
    bad_open = (df["Open"] > 2 * hi_ref) | (df["Open"] < 0.5 * lo_ref)
    df.loc[bad_open, "Open"] = df.loc[bad_open, "Close"]
    body_hi, body_lo = df[["Open", "Close"]].max(axis=1), df[["Open", "Close"]].min(axis=1)
    bad_high = df["High"] > 2 * np.fmax(hi_ref, body_hi)
    df.loc[bad_high, "High"] = body_hi[bad_high]
    bad_low = df["Low"] < 0.5 * np.fmin(lo_ref, body_lo)
    df.loc[bad_low, "Low"] = body_lo[bad_low]
    df["High"] = df[["High", "Open", "Close"]].max(axis=1)
    df["Low"] = df[["Low", "Open", "Close"]].min(axis=1)
    idx = pd.to_datetime(df.index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    df.index = idx.normalize()
    return df[~df.index.duplicated(keep="last")].sort_index()


def fix_corporate_actions(df: pd.DataFrame) -> tuple[pd.DataFrame, list]:
    """Yahoo sometimes misses demergers and bonus issues, which then look like
    a sudden crash (e.g. TRENT opening at exactly 2/3 of the previous close).
    When both the open and the close jump by over 25% the same way, scale all
    earlier prices so the gap disappears. Real news moves (PNB's +46% close in
    Oct 2017 after a +10% open) don't open that far away and are left alone."""
    prev = df["Close"].shift(1)
    gap, ret = df["Open"] / prev - 1, df["Close"] / prev - 1
    hits = df.index[(gap.abs() > 0.25) & (ret.abs() > 0.25) & (np.sign(gap) == np.sign(ret))]
    if not len(hits):
        return df, []
    df = df.copy()
    fixes = []
    for day in hits:
        factor = float(df.at[day, "Open"] / prev[day])
        df.loc[df.index < day, ["Open", "High", "Low", "Close"]] *= factor
        fixes.append({"date": str(day.date()), "factor": factor})
    return df, fixes


def download_prices(symbols, start=HISTORY_START, use_cache=False) -> dict[str, pd.DataFrame]:
    cache = CACHE_DIR / f"prices_{start}_{dt.date.today()}.pkl"
    if use_cache and cache.exists():
        frames = pickle.loads(cache.read_bytes())
        if set(symbols) <= set(frames) | set(frames.get("_missing", [])):
            frames.pop("_missing", None)
            return frames

    import yfinance as yf

    frames: dict[str, pd.DataFrame] = {}
    for attempt in range(4):
        todo = [s for s in symbols if s not in frames]
        if not todo:
            break
        if attempt:
            time.sleep(15 * attempt)
        try:
            raw = yf.download([f"{s}.NS" for s in todo], start=start, auto_adjust=True,
                              group_by="ticker", threads=True, progress=False)
        except Exception as exc:
            print(f"Download attempt {attempt + 1} failed: {exc}", file=sys.stderr)
            continue
        for s in todo:
            try:
                df = _clean(raw[f"{s}.NS"])
            except KeyError:
                continue
            if len(df) >= 30:
                frames[s] = df
    missing = [s for s in symbols if s not in frames]
    if missing:
        print(f"No data for: {', '.join(missing)}", file=sys.stderr)
    if use_cache:
        CACHE_DIR.mkdir(exist_ok=True)
        cache.write_bytes(pickle.dumps({**frames, "_missing": missing}))
    return frames


def download_market(start=HISTORY_START, use_cache=False) -> dict[str, pd.DataFrame]:
    """Daily closes of the Nifty 50, India VIX and the US S&P 500."""
    cache = CACHE_DIR / f"market_{start}_{dt.date.today()}.pkl"
    if use_cache and cache.exists():
        return pickle.loads(cache.read_bytes())
    import yfinance as yf

    out = {}
    for name, ticker in MARKET_TICKERS.items():
        for attempt in range(3):
            try:
                df = yf.download(ticker, start=start, auto_adjust=True, progress=False)
                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = df.columns.get_level_values(0)
                df = df[["Close"]].astype(float).dropna()
                df = df[df["Close"] > 0]
                idx = pd.to_datetime(df.index)
                df.index = (idx.tz_localize(None) if idx.tz is not None else idx).normalize()
                df = df[~df.index.duplicated(keep="last")].sort_index()
                if len(df) > 250:
                    out[name] = df
                    break
            except Exception as exc:
                print(f"{ticker} download failed: {exc}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    if use_cache:
        CACHE_DIR.mkdir(exist_ok=True)
        cache.write_bytes(pickle.dumps(out))
    return out


def fetch_fundamentals(symbols) -> dict:
    import yfinance as yf

    out = {}
    for s in symbols:
        try:
            info = yf.Ticker(f"{s}.NS").info
        except Exception as exc:
            print(f"No company data for {s}: {exc}", file=sys.stderr)
            continue
        row = {k: float(info[src]) for k, src in FUNDAMENTAL_FIELDS.items()
               if isinstance(info.get(src), (int, float)) and math.isfinite(info[src])}
        if row:
            out[s] = row
        time.sleep(0.3)
    return out


BHAVCOPY_URL = "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{:%Y%m%d}_F_0000.csv.zip"


def fetch_bhavcopy(day: dt.date) -> pd.DataFrame | None:
    """NSE's official end-of-day prices for one day (None if not published)."""
    import zipfile
    try:
        req = urllib.request.Request(BHAVCOPY_URL.format(day), headers={"User-Agent": "Mozilla/5.0"})
        blob = urllib.request.urlopen(req, timeout=30).read()
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            df = pd.read_csv(z.open(z.namelist()[0]))
    except Exception:
        return None
    df = df[df["SctySrs"] == "EQ"].set_index("TckrSymb")
    return df.rename(columns={"OpnPric": "Open", "HghPric": "High", "LwPric": "Low",
                              "ClsPric": "Close", "TtlTradgVol": "Volume"})[["Open", "High", "Low", "Close", "Volume"]]


def fill_recent_gaps(frames: dict[str, pd.DataFrame], now: dt.datetime | None = None,
                     fetch=fetch_bhavcopy, lookback: int = 5) -> list[str]:
    """Yahoo sometimes leaves the latest days blank for a few stocks. Fill
    those days (and today, once NSE has published it) from NSE's bhavcopy."""
    now = now or dt.datetime.now(IST)
    all_dates = pd.DatetimeIndex(sorted(set().union(*(df.index for df in frames.values()))))
    days = list(all_dates[-lookback:])
    today = pd.Timestamp(now.date())
    if now.weekday() < 5 and now.time() >= dt.time(18, 0) and (not days or today > days[-1]):
        days.append(today)
    filled = []
    for day in days:
        missing = [s for s, df in frames.items() if day not in df.index and len(df) and df.index[0] < day]
        if not missing:
            continue
        bhav = fetch(day.date())
        if bhav is None:
            continue
        for s in missing:
            if s in bhav.index:
                row = bhav.loc[[s]].astype(float)
                row.index = pd.DatetimeIndex([day])
                frames[s] = pd.concat([frames[s], _clean(row)]).sort_index()
                filled.append(f"{s} {day.date()}")
    if filled:
        print(f"Filled from NSE bhavcopy: {', '.join(filled)}", file=sys.stderr)
    return filled


@dataclass
class Panel:
    """Prices for all stocks on the same trading-day rows."""
    dates: pd.DatetimeIndex
    symbols: list
    O: pd.DataFrame
    H: pd.DataFrame
    L: pd.DataFrame
    C: pd.DataFrame
    V: pd.DataFrame
    fixes: dict


def build_panel(frames: dict[str, pd.DataFrame], now: dt.datetime | None = None) -> Panel:
    symbols = sorted(frames)
    frames, fixes = dict(frames), {}
    for s in symbols:
        frames[s], found = fix_corporate_actions(frames[s])
        if found:
            fixes[s] = found
    fields = {f: pd.DataFrame({s: frames[s][f] for s in symbols}).sort_index()
              for f in ("Open", "High", "Low", "Close", "Volume")}
    count = fields["Close"].notna().sum(axis=1)
    # drop stray dates where only a handful of stocks have a bar
    keep = count >= 0.5 * count.rolling(21, center=True, min_periods=1).median()
    now = now or dt.datetime.now(IST)
    last = fields["Close"].index[-1]
    if last.date() == now.date() and now.time() < dt.time(15, 45):
        keep.loc[last] = False  # today's bar is still forming
    fields = {f: df[keep] for f, df in fields.items()}
    return Panel(fields["Close"].index, symbols, fields["Open"], fields["High"],
                 fields["Low"], fields["Close"], fields["Volume"], fixes)


def slice_panel(p: Panel, end: int) -> Panel:
    """First `end` rows (used by tests to prove there is no look-ahead)."""
    return Panel(p.dates[:end], p.symbols, p.O.iloc[:end], p.H.iloc[:end],
                 p.L.iloc[:end], p.C.iloc[:end], p.V.iloc[:end], p.fixes)


# --------------------------------------------------------------------------
# Chart patterns. Each signal uses data up to that day's close only; the
# trade is bought at the next day's open.
# --------------------------------------------------------------------------

@dataclass
class Variant:
    id: str
    family: str
    name: str
    desc: str
    filter: str = ""  # market filter id, "" for the plain pattern


def rsi(close: pd.DataFrame, n: int) -> pd.DataFrame:
    d = close.diff()
    gain = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    loss = (-d).clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    return (100 - 100 / (1 + gain / loss)).where(close.notna())


def cross_up(a: pd.DataFrame, b) -> pd.DataFrame:
    b_prev = b.shift(1) if isinstance(b, pd.DataFrame) else b
    return (a > b) & (a.shift(1) <= b_prev)


def pattern_signals(p: Panel) -> list[tuple[Variant, pd.DataFrame]]:
    C, O, H, L, V = p.C, p.O, p.H, p.L, p.V
    sma = {n: C.rolling(n, min_periods=n).mean() for n in (10, 20, 30, 50, 100, 200)}
    up200, up50 = C > sma[200], C > sma[50]
    rsi2, rsi14 = rsi(C, 2), rsi(C, 14)
    vol_avg = V.shift(1).rolling(20, min_periods=20).mean()
    body, rng = (C - O).abs(), H - L
    lo_body, hi_body = O.where(O <= C, C), O.where(O >= C, C)
    out = []

    def add(vid, family, name, desc, sig):
        out.append((Variant(vid, family, name, desc), sig.fillna(False).astype(bool)))

    for T in (100, 200):
        for X in (5, 10):
            add(f"pullback_{T}_{X}", "Dip in uptrend", f"Uptrend dip ({T}d, RSI2<{X})",
                f"The stock is above its {T}-day average (long-term uptrend) but dropped "
                f"sharply in the last 2 days (2-day RSI below {X}). Buy the dip.",
                (C > sma[T]) & (rsi2 < X))

    for N in (20, 55):
        high_n = H.shift(1).rolling(N, min_periods=N).max()
        for vm in (1.0, 1.5):
            vol_txt = " on volume 1.5x normal or more" if vm > 1 else ""
            add(f"breakout_{N}_{vm:g}", "Breakout", f"{N}-day breakout" + (" + volume" if vm > 1 else ""),
                f"The price closes above its highest price of the last {N} days{vol_txt}, "
                f"while above its 200-day average.",
                cross_up(C, high_n) & (V > vm * vol_avg) & up200)

    for f, s in ((10, 30), (20, 50), (50, 200)):
        add(f"macross_{f}_{s}", "Moving-average crossover", f"{f}/{s} average crossover",
            f"The {f}-day average price crosses above the {s}-day average: a new uptrend may be starting.",
            cross_up(sma[f], sma[s]))

    for lvl in (30, 40):
        for trend in (False, True):
            add(f"rsi_{lvl}_{'trend' if trend else 'any'}", "RSI bounce",
                f"RSI back above {lvl}" + (" in uptrend" if trend else ""),
                f"The 14-day RSI climbs back above {lvl} after being below it (the selling is easing)"
                + (", while the stock is above its 200-day average." if trend else "."),
                cross_up(rsi14, lvl) & (up200 if trend else True))

    ema12 = C.ewm(span=12, adjust=False, min_periods=26).mean()
    ema26 = C.ewm(span=26, adjust=False, min_periods=26).mean()
    macd = ema12 - ema26
    macd_sig = macd.ewm(span=9, adjust=False, min_periods=9).mean()
    add("macd_below0", "MACD crossover", "MACD cross below zero",
        "The MACD line crosses above its signal line while still below zero: momentum turning up after a fall.",
        cross_up(macd, macd_sig) & (macd < 0))
    add("macd_trend", "MACD crossover", "MACD cross in uptrend",
        "The MACD line crosses above its signal line while the stock is above its 200-day average.",
        cross_up(macd, macd_sig) & up200)

    add("engulfing", "Candlestick", "Bullish engulfing",
        "After a short dip, a green candle fully covers the previous red candle, while above the 50-day average.",
        (C.shift(1) < O.shift(1)) & (C > O) & (O <= C.shift(1)) & (C >= O.shift(1))
        & (body > body.shift(1)) & (C.shift(1) < C.shift(4)) & up50)
    add("hammer", "Candlestick", "Hammer",
        "After a short fall, a candle with a long lower wick: sellers pushed the price down but buyers "
        "pushed it back up. Stock is above its 200-day average.",
        (rng > 0) & (lo_body - L >= 2 * body) & (H - hi_body <= 0.25 * rng) & (C < C.shift(5)) & up200)

    for N in (20, 50):
        low_n = L.shift(1).rolling(N, min_periods=N).min()
        add(f"support_{N}", "Support bounce", f"{N}-day support bounce",
            f"The price dips to its {N}-day low area (support) and closes strongly higher, "
            f"while above its 200-day average.",
            (L <= low_n * 1.015) & (C > C.shift(1)) & (C - L >= 0.6 * rng) & up200)

    for m in (2, 3):
        add(f"volspike_{m}", "Volume spike", f"Volume spike {m}x",
            f"Trading volume is {m}x normal or more and the price rises 3% or more, above the 50-day average: "
            f"big buyers may be stepping in.",
            (V > m * vol_avg) & (C >= 1.03 * C.shift(1)) & up50)

    # The strongest stocks of the last 6 months tend to keep leading (skipping
    # the latest month, which often reverses). Picked once a month.
    strength = (C.shift(21) / C.shift(126) - 1).where(up200)
    rank = strength.rank(axis=1, ascending=False)
    month_end = pd.DataFrame(np.repeat(month_ends(p.dates)[:, None], len(p.symbols), 1),
                             index=C.index, columns=C.columns)
    for k in (5, 10):
        add(f"strength_top{k}", "Monthly strength", f"Top {k} strongest (monthly)",
            f"At each month-end, the {k} stocks that rose the most over the last 6 months (not counting the latest "
            f"month), among those above their 200-day average.",
            (rank <= k) & month_end)
    return out


def month_ends(dates: pd.DatetimeIndex) -> np.ndarray:
    """Last weekday of each month. Known in advance from the calendar, so it
    doesn't peek at future prices (an exchange holiday can shift it a day)."""
    return np.asarray((dates + pd.offsets.BDay(1)).month != dates.month)


def momentum_score(p: Panel) -> np.ndarray:
    """6-month return, used to rank stocks when several signal on the same day."""
    return (p.C / p.C.shift(126) - 1).fillna(-1.0).to_numpy()


def market_filters(p: Panel, market: dict) -> dict:
    """{id: (name, condition, True/False per trading day)}. Each day uses only
    what was known at that day's Indian close."""
    out = {}

    def uptrend(close):
        return close > close.rolling(200, min_periods=200).mean()

    def on_panel_days(flags):
        return flags.reindex(p.dates, method="ffill", limit=5).fillna(False).astype(bool)

    if "nifty" in market:
        out["nifty"] = ("Nifty rising", "the Nifty 50 index is above its 200-day average (the Indian market is rising)",
                        on_panel_days(uptrend(market["nifty"]["Close"])))
    if "vix" in market:
        out["calm"] = ("Calm market", f"India VIX, the market's fear gauge, is below {VIX_CALM}",
                       on_panel_days(market["vix"]["Close"] < VIX_CALM))
    if "world" in market:
        us = uptrend(market["world"]["Close"])
        us.index = us.index + pd.Timedelta(days=1)  # the US closes after India: use its previous session
        out["world"] = ("World rising", "the US S&P 500 is above its 200-day average (world markets are rising)",
                        on_panel_days(us))
    return out


def with_market_filters(signals, filters: dict):
    """Each pattern on its own, plus once per market filter."""
    out = list(signals)
    for v, sig in signals:
        for fid, (fname, cond, mask) in filters.items():
            fsig = pd.DataFrame(sig.to_numpy() & mask.to_numpy()[:, None], index=sig.index, columns=sig.columns)
            out.append((Variant(f"{v.id}@{fid}", v.family, f"{v.name} + {fname}",
                                f"{v.desc} Only taken when {cond}.", fid), fsig))
    return out


# --------------------------------------------------------------------------
# Backtest
# --------------------------------------------------------------------------

@dataclass
class Trades:
    n: np.ndarray        # stock column
    e: np.ndarray        # entry row (bought at that day's open)
    x: np.ndarray        # exit row
    pe: np.ndarray       # entry price
    px: np.ndarray       # exit price
    kind: np.ndarray     # 0 time up, 1 stop-loss, 2 target
    complete: np.ndarray  # False when the data ends before the trade does
    score: np.ndarray

    def subset(self, mask):
        return Trades(*(getattr(self, f)[mask] for f in self.__dataclass_fields__))


def entry_points(sig: pd.DataFrame, O: np.ndarray, score: np.ndarray):
    S = sig.to_numpy()
    t, n = np.nonzero(S[:-1])  # a signal on the last day is bought tomorrow
    e = t + 1
    ok = np.isfinite(O[e, n])
    t, n, e = t[ok], n[ok], e[ok]
    return n, e, O[e, n], score[t, n]


def simulate_exits(n, e, pe, score, O, H, L, C, targets=TARGETS, stops=STOPS, holds=HOLDS,
                   trails=TRAILS, trail_holds=TRAIL_HOLDS):
    """Exit of every entry under every (target, stop, hold) rule, plus every
    trailing-stop rule, keyed (0, trail, hold).

    Stop-loss and target are checked against each day's low and high, starting
    on the entry day. If both are touched on the same day we assume the stop
    came first. If the day opens beyond a level, the fill is at the open.
    """
    T = O.shape[0]
    nn = n[:, None]
    rows = np.arange(len(e))
    out = {}

    def window(width, arrays):
        idx = e[:, None] + np.arange(width)[None, :]
        inb = idx < T
        idxc = np.minimum(idx, T - 1)
        return inb, [np.where(inb, A[idxc, nn], np.nan) for A in arrays]

    if trails and trail_holds:
        width = max(trail_holds)
        inb, (fo, fl, fc) = window(width, (O, L, C))
        # highest close known before each day; the buy price on the first day
        prior_high = np.fmax.accumulate(np.concatenate([pe[:, None], fc[:, :-1]], axis=1), axis=1)
        for trail in trails:
            level = prior_high * (1 - trail)
            hit = fl <= level
            first = np.where(hit.any(1), hit.argmax(1), width + 1)
            for hd in trail_holds:
                lim = hd - 1
                is_stop = first <= lim
                off = np.where(is_stop, first, lim)
                o_off, lv = fo[rows, off], level[rows, off]
                px = np.where(is_stop, np.where(o_off < lv, o_off, lv), fc[rows, lim])
                complete = inb[rows, off] & np.isfinite(px)
                out[(0.0, trail, hd)] = Trades(n, e, e + off, pe, px, np.where(is_stop, 1, 0), complete, score)

    if not (targets and stops and holds):
        return out
    hmax = max(holds)
    inb, (fo, fh, fl, fc) = window(hmax, (O, H, L, C))
    big = hmax + 1
    for tg in targets:
        tp = pe * (1 + tg)
        hit_t = fh >= tp[:, None]
        first_t = np.where(hit_t.any(1), hit_t.argmax(1), big)
        for st in stops:
            sp = pe * (1 - st)
            hit_s = fl <= sp[:, None]
            first_s = np.where(hit_s.any(1), hit_s.argmax(1), big)
            for hd in holds:
                lim = hd - 1
                is_stop = (first_s <= first_t) & (first_s <= lim)
                is_tgt = (first_t < first_s) & (first_t <= lim)
                off = np.where(is_stop, first_s, np.where(is_tgt, first_t, lim))
                o_off = fo[rows, off]
                px = np.where(is_stop, np.where(o_off < sp, o_off, sp),
                              np.where(is_tgt, np.where(o_off > tp, o_off, tp), fc[rows, lim]))
                complete = inb[rows, off] & np.isfinite(px)
                kind = np.where(is_stop, 1, np.where(is_tgt, 2, 0))
                out[(tg, st, hd)] = Trades(n, e, e + off, pe, px, kind, complete, score)
    return out


def period_bounds(dates: pd.DatetimeIndex):
    bounds = {}
    for name, start, end in PERIODS:
        s = int(dates.searchsorted(pd.Timestamp(start)))
        e = len(dates) - 1 if end is None else int(dates.searchsorted(pd.Timestamp(end), side="right")) - 1
        bounds[name] = (s, e)
    return bounds


def slots_for(capital: float) -> int:
    """How many stocks to hold at once: at least Rs 5,000 per stock, at most 5."""
    return int(min(5, max(1, capital // 5000)))


def trade_net_returns(tr: Trades, budget: float):
    shares = affordable_shares(budget, tr.pe)
    buy_val, sell_val = shares * tr.pe, shares * tr.px
    pnl = sell_val - sell_charges(sell_val) - buy_val - buy_charges(buy_val)
    return shares >= 1, pnl / budget


def quick_stats(tr: Trades, budget: float, bounds) -> dict:
    """Trade-by-trade results, used to shortlist strategies cheaply."""
    ok, net = trade_net_returns(tr, budget)
    hold = tr.x - tr.e + 1
    res = {}
    for name, (s, e) in bounds.items():
        m = ok & tr.complete & (tr.e >= s) & (tr.x <= e)
        k = int(m.sum())
        if k == 0:
            res[name] = {"n": 0, "win": None, "avg": None, "hold": None, "score": -math.inf}
            continue
        avg, h = float(net[m].mean()), float(hold[m].mean())
        res[name] = {"n": k, "win": float((net[m] > 0).mean()), "avg": avg, "hold": h, "score": avg / h}
    return res


def portfolio_sim(tr: Trades, capital: float, slots: int, start: int, end: int,
                  Cf: np.ndarray, dates: pd.DatetimeIndex) -> dict:
    """Follow the strategy with real money: limited cash, whole shares, charges,
    at most `slots` stocks at a time, never the same stock twice. When several
    stocks signal on the same day, the strongest (6-month return) goes first."""
    m = (tr.e >= start) & (tr.e <= end)
    order = np.lexsort((-tr.score[m], tr.e[m]))
    N, E, X = tr.n[m][order], tr.e[m][order], tr.x[m][order]
    PE, PX, K, DONE = tr.pe[m][order], tr.px[m][order], tr.kind[m][order], tr.complete[m][order]

    cash = float(capital)
    positions = []  # [exit_row, stock, shares, exit_price, cost, kind, buy_row, buy_price]
    held = set()
    equity = np.empty(end - start + 1)
    pnls, holds, kinds, log = [], [], [], []
    charges = 0.0
    invested_days = 0
    j = 0
    for d in range(start, end + 1):
        while j < len(E) and E[j] == d:  # buy at the open
            if len(positions) < slots and N[j] not in held:
                budget = cash / (slots - len(positions))
                shares = float(affordable_shares(budget, PE[j]))
                if shares >= 1:
                    val = shares * PE[j]
                    fee = float(buy_charges(val))
                    cash -= val + fee
                    charges += fee
                    if DONE[j] and X[j] <= end:
                        exit_row, exit_px, kind = int(X[j]), float(PX[j]), int(K[j])
                    else:  # still open at the end of the period
                        exit_row, exit_px, kind = end, float(Cf[end, N[j]]), -1
                    positions.append([exit_row, N[j], shares, exit_px, val + fee, kind, d, float(PE[j])])
                    held.add(N[j])
            j += 1
        if positions:
            invested_days += 1
        still = []
        for pos in positions:  # sell during the day
            if pos[0] == d:
                val = pos[2] * pos[3]
                fee = float(sell_charges(val))
                cash += val - fee
                charges += fee
                pnls.append(val - fee - pos[4])
                holds.append(d - pos[6] + 1)
                kinds.append(pos[5])
                log.append([int(pos[1]), pos[6], pos[7], d, pos[3], pos[2], val - fee - pos[4], pos[5]])
                held.discard(pos[1])
            else:
                still.append(pos)
        positions = still
        equity[d - start] = cash + sum(p[2] * Cf[d, p[1]] for p in positions)

    final = float(equity[-1])
    years = max((dates[end] - dates[start]).days / 365.25, 1 / 365.25)
    peak = np.maximum.accumulate(equity)
    pnls = np.array(pnls)
    kinds = np.array(kinds)
    return {
        "start": str(dates[start].date()), "end": str(dates[end].date()),
        "capital": capital, "final": final, "profit": final - capital,
        "cagr": (final / capital) ** (1 / years) - 1 if final > 0 else -1.0,
        "max_dd": float(np.max(1 - equity / peak)),
        "trades": len(pnls),
        "win_rate": float((pnls > 0).mean()) if len(pnls) else None,
        "avg_pnl": float(pnls.mean()) if len(pnls) else None,
        "best": float(pnls.max()) if len(pnls) else None,
        "worst": float(pnls.min()) if len(pnls) else None,
        "avg_hold": float(np.mean(holds)) if holds else None,
        "targets_hit": int((kinds == 2).sum()), "stops_hit": int((kinds == 1).sum()),
        "charges": charges,
        "invested_pct": invested_days / (end - start + 1),
        "curve": downsample_curve(equity, dates[start:end + 1]),
        "log": log,  # [stock, buy row, buy price, sell row, sell price, shares, profit after charges, kind]
    }


def downsample_curve(equity: np.ndarray, dates: pd.DatetimeIndex, points: int = 60):
    idx = np.unique(np.linspace(0, len(equity) - 1, min(points, len(equity))).round().astype(int))
    return [[str(dates[i].date()), round(float(equity[i]), 2)] for i in idx]


def buy_and_hold(O: np.ndarray, C: np.ndarray, capital: float, start: int, end: int,
                 dates: pd.DatetimeIndex) -> dict | None:
    """Put everything in the Nifty 50 ETF on day one and hold."""
    first = start + int(np.argmax(np.isfinite(O[start:end + 1])))
    if not np.isfinite(O[first]):
        return None
    shares = float(affordable_shares(capital, O[first]))
    if shares < 1:
        return None
    val = shares * O[first]
    cash = capital - val - float(buy_charges(val))
    Cf = pd.Series(C).ffill().to_numpy()
    equity = cash + shares * Cf[start:end + 1]
    equity[:first - start] = capital
    sell_val = shares * Cf[end]
    final = cash + sell_val - float(sell_charges(sell_val))
    equity[-1] = final
    years = max((dates[end] - dates[start]).days / 365.25, 1 / 365.25)
    peak = np.maximum.accumulate(equity)
    return {"final": final, "profit": final - capital, "cagr": (final / capital) ** (1 / years) - 1,
            "max_dd": float(np.max(1 - equity / peak)), "curve": downsample_curve(equity, dates[start:end + 1])}


def exits_for(rule) -> dict:
    """simulate_exits arguments that produce just this one rule."""
    tg, st, hd = rule
    if tg == 0:
        return {"targets": (), "stops": (), "holds": (), "trails": (st,), "trail_holds": (hd,)}
    return {"targets": (tg,), "stops": (st,), "holds": (hd,), "trails": (), "trail_holds": ()}


def random_baseline(O, H, L, C, Cf, dates, rule, n_entries, cap, start, end,
                    runs=RANDOM_RUNS, seed=7) -> list[float]:
    """Same exit rule, capital and number of buy signals, but the buy days and
    stocks are picked at random. If a pattern can't beat this, its profit came
    from the market rising, not from the pattern."""
    lo = max(start, 1)
    t_idx, n_idx = np.nonzero(np.isfinite(C[lo - 1:end]) & np.isfinite(O[lo:end + 1]))
    if not len(t_idx) or n_entries == 0:
        return []
    t_idx = t_idx + lo - 1
    rng = np.random.default_rng(seed)
    finals = []
    for _ in range(runs):
        k = rng.choice(len(t_idx), size=min(n_entries, len(t_idx)), replace=False)
        n, e = n_idx[k], t_idx[k] + 1
        tr = simulate_exits(n, e, O[e, n], rng.random(len(k)), O, H, L, C, **exits_for(rule))[rule]
        finals.append(portfolio_sim(tr, cap, slots_for(cap), start, end, Cf, dates)["final"])
    return finals


def combo_key(vid, exit_rule):
    tg, st, hd = exit_rule
    return f"{vid}|{round(tg * 100)}|{round(st * 100)}|{hd}"


def run_backtest(p: Panel, signals, bench: pd.DataFrame | None, log=print, previous: dict | None = None) -> dict:
    """previous: {capital: combo key} picked last time, kept unless clearly beaten."""
    O, H, L, C = (df.to_numpy() for df in (p.O, p.H, p.L, p.C))
    Cf = p.C.ffill().to_numpy()
    score = momentum_score(p)
    bounds = period_bounds(p.dates)
    variants = {v.id: v for v, _ in signals}

    # Stage 1: every combination, trade by trade, for every capital level
    t0 = time.time()
    stage1 = {cap: [] for cap in CAPITALS}
    trades_cache, rules = {}, {}
    pattern_stats = {}
    for v, sig in signals:
        n, e, pe, sc = entry_points(sig, O, score)
        exits = simulate_exits(n, e, pe, sc, O, H, L, C)
        for rule, tr in exits.items():
            key = combo_key(v.id, rule)
            trades_cache[key], rules[key] = tr, rule
            for cap in CAPITALS:
                stage1[cap].append((key, quick_stats(tr, cap / slots_for(cap), bounds)))
        std = exits[STANDARD_EXIT]
        gross = std.px / std.pe - 1
        pattern_stats[v.id] = {}
        for name, (s, end) in bounds.items():
            m = std.complete & (std.e >= s) & (std.x <= end)
            pattern_stats[v.id][name] = {
                "n": int(m.sum()),
                "win": float((gross[m] > 0).mean()) if m.any() else None,
                "avg": float(gross[m].mean()) if m.any() else None,
            }
    combos_tested = len(trades_cache)
    log(f"Stage 1: {combos_tested} combinations x {len(CAPITALS)} capital levels in {time.time() - t0:.0f}s")

    # Stage 2: shortlist on train, pick on validate, report test
    bench_O = bench_C = None
    if bench is not None:
        b = bench.reindex(p.dates)
        bench_O, bench_C = b["Open"].to_numpy(), b["Close"].to_numpy()
    sim_cache = {}

    def sim(key, cap, period):
        k = (key, cap, period)
        if k not in sim_cache:
            s, e = bounds[period]
            sim_cache[k] = portfolio_sim(trades_cache[key], cap, slots_for(cap), s, e, Cf, p.dates)
        return sim_cache[k]

    def spread(key, cap, period):
        """Middle and range of the runs from START_OFFSETS start weeks. Final
        values are scaled to the full period so they compare like for like."""
        s, e = bounds[period]
        runs = [sim(key, cap, period)] + [
            portfolio_sim(trades_cache[key], cap, slots_for(cap), s + i * OFFSET_STEP, e, Cf, p.dates)
            for i in range(1, START_OFFSETS) if s + i * OFFSET_STEP < e]
        years = max((p.dates[e] - p.dates[s]).days / 365.25, 1 / 365.25)
        cagr = np.array([r["cagr"] for r in runs])
        equiv = cap * np.maximum(1 + cagr, 0) ** years
        med = lambda field: float(np.median([r[field] for r in runs if r[field] is not None] or [np.nan]))
        return {"runs": len(runs), "cagr": float(np.median(cagr)), "final": float(np.median(equiv)),
                "low": float(equiv.min()), "high": float(equiv.max()), "trades": med("trades"),
                "win_rate": med("win_rate"), "max_dd": med("max_dd")}

    def expected_yearly(qs, period, cap):
        """Rough yearly return from the average trade (net of charges): return
        per day held, times the share of days the money would be in trades."""
        q = qs[period]
        if not q["n"]:
            return -math.inf
        s, e = bounds[period]
        busy = min(1.0, q["n"] * q["hold"] / (e - s + 1) / slots_for(cap))
        return q["score"] * busy * 250

    # For the page's daily list: every pattern's steadiest target/stop rule at
    # each amount, with how its past trades ended and how long targets took.
    pattern_rules = {}
    for cap in CAPITALS:
        best = {}
        for key, qs in stage1[cap]:
            if qs["train"]["n"] < MIN_TRAIN_TRADES or qs["validate"]["n"] < MIN_TRAIN_TRADES // 3:
                continue
            steady = min(expected_yearly(qs, "train", cap), expected_yearly(qs, "validate", cap))
            vid = key.split("|")[0]
            if vid not in best or (steady, key) > best[vid][:2]:
                best[vid] = (steady, key, qs)
        for vid, (steady, key, qs) in best.items():
            tr = trades_cache[key]
            ok, _ = trade_net_returns(tr, cap / slots_for(cap))
            m = ok & tr.complete
            kind, days = tr.kind[m], (tr.x - tr.e + 1)[m]
            hit_days = days[kind == 2]
            pattern_rules.setdefault(vid, {})[str(cap)] = {
                "rule": key.split("|", 1)[1], "steady": steady,
                "avg": {name: qs[name]["avg"] for name in ("train", "validate", "test")},
                "test_n": qs["test"]["n"], "test_win": qs["test"]["win"], "n": int(m.sum()),
                "ends": {"target": float((kind == 2).mean()), "stop": float((kind == 1).mean()),
                         "time": float((kind == 0).mean())} if m.any() else None,
                "target_days": [float(np.percentile(hit_days, q)) for q in (25, 50, 75)] if len(hit_days) else None,
            }

    buckets = []
    for cap in CAPITALS:
        # Pick on training + checking only, using the average of every trade:
        # thousands of trades barely move when a few prices change, unlike a
        # single run with real money. The test period is never looked at here.
        scored = []
        for key, qs in stage1[cap]:
            if qs["train"]["n"] < MIN_TRAIN_TRADES or qs["validate"]["n"] < MIN_TRAIN_TRADES // 3:
                continue
            tr, va = expected_yearly(qs, "train", cap), expected_yearly(qs, "validate", cap)
            avg_trade = {name: {k: q[k] for k in ("n", "win", "avg", "hold")} for name, q in qs.items()}
            scored.append({"key": key, "train_est": tr, "validate_est": va, "steady": min(tr, va),
                           "avg_trade": avg_trade})
        scored.sort(key=lambda c: (-round(c["steady"], 9), c["key"]))
        good = [c for c in scored if c["train_est"] > 0 and c["validate_est"] > 0]
        pool = good or scored
        best = pool[0] if pool else None
        prev_key = (previous or {}).get(cap)
        kept = next((c for c in pool if c["key"] == prev_key), None)
        if kept and kept["steady"] < best["steady"] - SWITCH_MARGIN:
            kept = None
        pick = kept or best
        shown = scored[:CANDIDATES_PER_CAPITAL]
        if pick and pick not in shown:
            shown.append(pick)
        # What following each one with real money would have looked like
        cands = [{**c, "spread": {name: spread(c["key"], cap, name) for name in ("train", "validate", "test")}}
                 for c in shown]
        chosen = next((c for c in cands if pick and c["key"] == pick["key"]), None)
        bench_res = {}
        if bench_O is not None:
            for name, (s, e) in bounds.items():
                bench_res[name] = buy_and_hold(bench_O, bench_C, cap, s, e, p.dates)
                if bench_res[name] and name != "test":
                    bench_res[name].pop("curve")
        random = None
        if chosen:
            s_, e_ = bounds["test"]
            tr = trades_cache[chosen["key"]]
            finals = random_baseline(O, H, L, C, Cf, p.dates, rules[chosen["key"]],
                                     int(((tr.e >= s_) & (tr.e <= e_)).sum()), cap, s_, e_)
            if finals:
                f = np.array(finals)
                random = {"runs": len(f), "median": float(np.median(f)), "p10": float(np.percentile(f, 10)),
                          "p90": float(np.percentile(f, 90)),
                          "beat_pct": float((chosen["spread"]["test"]["final"] > f).mean())}
        verdict = "none"
        if chosen:
            t, b = chosen["spread"]["test"], bench_res.get("test")
            if t["final"] <= cap:
                verdict = "loss"
            elif not good:
                verdict = "unproven"
            elif b and t["final"] < b["final"]:
                verdict = "below_index"
            elif random and random["beat_pct"] < 0.6:
                verdict = "luck"
            else:
                verdict = "good"

        out_cands = []
        for c in cands:
            oc = dict(c)
            if c is chosen:  # one example run (from the first start date) for the chart and trade list
                run = sim(c["key"], cap, "test")
                ex = {k: v for k, v in run.items() if k != "log"}
                ex["trades_log"] = [
                    [p.symbols[k], str(p.dates[b_].date()), bp, str(p.dates[s2].date()), sp, sh, pnl, kind]
                    for k, b_, bp, s2, sp, sh, pnl, kind in run["log"]]
                oc["example"] = ex
            out_cands.append(oc)
        buckets.append({
            "capital": cap, "slots": slots_for(cap), "chosen": chosen["key"] if chosen else None,
            "kept_previous": bool(kept and best is not kept),
            "verdict": verdict, "passed_train_and_validate": len(good), "random": random,
            "candidates": out_cands, "benchmark": bench_res,
        })
        if chosen:
            t = chosen["spread"]["test"]
            log(f"Rs {cap:>7,}: {chosen['key']:<32} test Rs {cap:,} -> Rs {t['final']:,.0f} "
                f"(range {t['low']:,.0f}-{t['high']:,.0f}, win {t['win_rate'] or 0:.0%}) "
                f"| Nifty ETF -> Rs {(bench_res.get('test') or {}).get('final', float('nan')):,.0f} "
                f"| beat {0 if not random else random['beat_pct']:.0%} of random | {verdict}")

    return {
        "generated_at": dt.datetime.now(IST).isoformat(timespec="minutes"),
        "data_start": str(p.dates[0].date()), "data_end": str(p.dates[-1].date()),
        "n_stocks": len(p.symbols), "combos_tested": combos_tested, "data_fixes": p.fixes,
        "periods": [{"name": name, "start": str(p.dates[s].date()), "end": str(p.dates[e].date())}
                    for name, (s, e) in bounds.items()],
        "grid": {"targets": TARGETS, "stops": STOPS, "holds": HOLDS, "trails": TRAILS, "trail_holds": TRAIL_HOLDS,
                 "capitals": CAPITALS},
        "start_offsets": START_OFFSETS, "switch_margin": SWITCH_MARGIN,
        "variants": {vid: v.__dict__ for vid, v in variants.items()},
        "pattern_stats": pattern_stats, "pattern_rules": pattern_rules,
        "standard_exit": STANDARD_EXIT,
        "buckets": buckets,
    }


# --------------------------------------------------------------------------
# Today's signals and recent prices for the page
# --------------------------------------------------------------------------

def market_mood(market: dict, filters: dict) -> dict:
    mood = {"vix_calm_below": VIX_CALM, "filters": {fid: bool(m.iloc[-1]) for fid, (_, _, m) in filters.items()}}
    for name in ("nifty", "world"):
        if name in market:
            c = market[name]["Close"]
            sma = c.rolling(200, min_periods=200).mean()
            mood[name] = {"date": str(c.index[-1].date()), "close": float(c.iloc[-1]), "sma200": float(sma.iloc[-1]),
                          "up": bool(c.iloc[-1] > sma.iloc[-1])}
    if "vix" in market:
        v = market["vix"]["Close"]
        mood["vix"] = {"date": str(v.index[-1].date()), "close": float(v.iloc[-1]), "calm": bool(v.iloc[-1] < VIX_CALM)}
    return mood


def today_payload(p: Panel, signals, universe: pd.DataFrame, mood: dict | None = None,
                  fundamentals: dict | None = None) -> dict:
    info = universe.set_index("Symbol")
    last = len(p.dates) - 1
    C = p.C.to_numpy()
    score = momentum_score(p)
    out_signals, last_signal = {}, {}
    for v, sig in signals:
        S_ = sig.to_numpy()
        hits = np.nonzero(S_[last])[0]
        rows = [{"s": p.symbols[k], "c": float(C[last, k]), "m": float(score[last, k])} for k in hits]
        out_signals[v.id] = sorted(rows, key=lambda r: -r["m"])
        days = np.nonzero(S_.any(axis=1))[0]
        if len(days):
            r = days[-1]
            last_signal[v.id] = {"date": str(p.dates[r].date()),
                                 "stocks": [{"s": p.symbols[k], "c": float(C[r, k])} for k in np.nonzero(S_[r])[0]]}
    recent = slice(max(0, last - RECENT_BARS + 1), last + 1)
    stocks = {}
    for k, sym in enumerate(p.symbols):
        if not np.isfinite(C[last, k]):
            continue  # no bar today (suspended or not yet listed)
        bars = np.stack([p.O.iloc[recent, k], p.H.iloc[recent, k], p.L.iloc[recent, k], p.C.iloc[recent, k]], 1)
        prev = p.C.iloc[:last, k].dropna()
        stocks[sym] = {
            "name": str(info.Name.get(sym, sym)), "industry": str(info.Industry.get(sym, "")),
            "close": float(C[last, k]),
            "chg": float(C[last, k] / prev.iloc[-1] - 1) if len(prev) else None,
            "m": float(score[last, k]),
            "bars": [[None if not np.isfinite(x) else x for x in row] for row in bars.tolist()],
        }
    return {
        "generated_at": dt.datetime.now(IST).isoformat(timespec="minutes"),
        "data_date": str(p.dates[last].date()),
        "dates": [str(d.date()) for d in p.dates[recent]],
        "signals": out_signals, "last_signal": last_signal, "stocks": stocks,
        "market": mood or {}, "fundamentals": fundamentals or {},
    }


def _round(obj, nd=4):
    if isinstance(obj, float):
        if not math.isfinite(obj):
            return None
        return round(obj, nd if abs(obj) < 1000 else 2)
    if isinstance(obj, (np.floating, np.integer)):
        return _round(obj.item(), nd)
    if isinstance(obj, dict):
        return {str(k): _round(v, nd) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_round(v, nd) for v in obj]
    return obj


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(_round(obj), separators=(",", ":"), allow_nan=False)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text)
    tmp.replace(path)
    print(f"Wrote {path.name} ({len(text) / 1024:.0f} KB)")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=("full", "daily"), default="daily")
    ap.add_argument("--cache", action="store_true", help="reuse today's downloaded prices (for development)")
    args = ap.parse_args(argv)

    universe = load_universe()
    frames = download_prices(list(universe.Symbol) + [BENCHMARK], use_cache=args.cache)
    fill_recent_gaps(frames)
    bench = frames.pop(BENCHMARK, None)
    if len(frames) < 0.8 * len(universe):
        print(f"Only {len(frames)} of {len(universe)} stocks downloaded; keeping the previous data.", file=sys.stderr)
        return 1
    panel = build_panel(frames)
    market = download_market(use_cache=args.cache)
    if set(market) != set(MARKET_TICKERS):
        print(f"Missing market data ({', '.join(set(MARKET_TICKERS) - set(market))}); keeping the previous data.",
              file=sys.stderr)
        return 1
    filters = market_filters(panel, market)
    signals = with_market_filters(pattern_signals(panel), filters)
    print(f"{len(panel.symbols)} stocks, {panel.dates[0].date()} to {panel.dates[-1].date()}, "
          f"{len(signals)} pattern versions")

    bt_path = OUT_DIR / "backtest.json"
    if args.mode == "full" or not bt_path.exists():
        previous = None
        if bt_path.exists():
            previous = {b["capital"]: b["chosen"] for b in json.loads(bt_path.read_text()).get("buckets", [])}
        write_json(bt_path, run_backtest(panel, signals, bench, previous=previous))
    signalled = sorted({s for v, sig in signals for s in sig.columns[sig.iloc[-1].to_numpy()]})
    fundamentals = fetch_fundamentals(signalled)
    write_json(OUT_DIR / "today.json",
               today_payload(panel, signals, universe, market_mood(market, filters), fundamentals))
    return 0


if __name__ == "__main__":
    sys.exit(main())
