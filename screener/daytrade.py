#!/usr/bin/env python3
"""Day trading (buy and sell the same day) for NSE stocks.

Tests same-day trade setups on a year of 5-minute prices with Groww's
intraday charges, and lists what to watch in the next session. Prices come
from Moneycontrol's public chart feed, the same feed the stocks/ page reads
live during market hours, so the page checks exactly what was tested:
  * daily bars: NSE's official open, high, low and close (they match the
    bhavcopy to the paisa), for gaps and yesterday's levels;
  * 5-minute bars: how the price moved during the day.
screener.py runs this; see run_backtest() and watch_list().
"""
from __future__ import annotations

import datetime as dt
import json
import math
import sys
import time
import urllib.parse
import urllib.request
import warnings
from dataclasses import dataclass

import numpy as np
import pandas as pd

import screener as S

FEED_URL = ("https://priceapi.moneycontrol.com/techCharts/indianMarket/{kind}/history"
            "?symbol={symbol}&resolution={res}&from={start}&to={end}&countback={count}&currencyCode=INR")
INDEX_SYMBOLS = {"nifty": "in;NSX", "banknifty": "in;nbx", "vix": "in;IDXN"}

BAR_MINUTES = 5
OPEN_MINUTE = 9 * 60 + 15
N_BARS = 76  # 9:15, 9:20, ... 15:30
CLOSED_AFTER = dt.time(15, 40)  # a session's bars are final after this


def bar_at(hhmm: str) -> int:
    h, m = map(int, hhmm.split(":"))
    return (h * 60 + m - OPEN_MINUTE) // BAR_MINUTES


def bar_time(b: int) -> str:
    m = OPEN_MINUTE + b * BAR_MINUTES
    return f"{m // 60:02d}:{m % 60:02d}"


ENTRY_BAR = bar_at("09:20")       # trades at the open are bought at 9:20, once the opening price is known
LAST_ENTRY_BAR = bar_at("12:55")  # no new trades after 12:55 PM
EXIT_BAR = bar_at("15:10")        # sell everything at 3:10 PM, before Groww's 3:20 PM auto square-off (Rs 50 + GST)
SLIPPAGE = 0.0005                 # 0.05% worse than the chart price on every market order
STOPS = (0.005, 0.01, 0.015, 0.02, 0.03)
TARGETS = (0.01, 0.015, 0.02, 0.03, 0.0)  # 0: no target, sell at 3:10 PM
MARGINS = (1, 2, 5)               # Groww's intraday margin lets you trade up to 5x your money
STANDARD_EXIT = (0.02, 0.0)       # stop, target used to compare setups with each other
MIN_TRADES = 20                   # in each half of the picking period
CANDIDATES = 8
RANDOM_RUNS = 100
# keep last week's pick unless a new one is better by this much per trading day
SWITCH_MARGIN = 0.0003
SCHEMA = 1
LONG_RUN_START = "2015-01-01"
INTRADAY_DAYS = 380  # the feed keeps about a year of 5-minute bars
DAILY_DAYS = 500     # enough daily bars for the 20-day average before the first 5-minute session


# --------------------------------------------------------------------------
# Groww charges for intraday equity (groww.in/pricing, checked Oct 2026)
# --------------------------------------------------------------------------

def buy_charges(value):
    v = np.asarray(value, dtype=float)
    brk, fees = S._brokerage(v), S._exchange_fees(v)
    stamp = 0.00003 * v
    return np.where(v > 0, brk + fees + stamp + 0.18 * (brk + fees), 0.0)


def sell_charges(value):
    v = np.asarray(value, dtype=float)
    brk, fees = S._brokerage(v), S._exchange_fees(v)
    stt = 0.00025 * v  # intraday STT is on the sell side only; no DP charge
    return np.where(v > 0, brk + fees + stt + 0.18 * (brk + fees), 0.0)


def round_trip_charges(value):
    return buy_charges(value) + sell_charges(value)


def shares_for(value, price):
    """Whole shares worth `value`, leaving room for the charges."""
    value = np.asarray(value, dtype=float)
    price = np.asarray(price, dtype=float)
    usable = np.maximum(value - round_trip_charges(value), 0.0)
    with np.errstate(divide="ignore", invalid="ignore"):
        shares = np.floor(usable / price)
    return np.where(np.isfinite(shares) & (price > 0), shares, 0.0)


def trade_charges(shares, entry, exit_, side):
    first, last = np.asarray(shares) * entry, np.asarray(shares) * exit_
    return np.where(np.asarray(side) > 0, buy_charges(first) + sell_charges(last),
                    sell_charges(first) + buy_charges(last))


def trade_pnl(shares, entry, exit_, side):
    """Rupees after charges. side +1: buy, then sell. side -1: short-sell
    first, buy back later the same day."""
    gross = np.asarray(side) * np.asarray(shares) * (np.asarray(exit_) - entry)
    return gross - trade_charges(shares, entry, exit_, side)


def day_slots(exposure: float) -> int:
    """Trades per day: one per Rs 20,000 traded, at most 5. Below Rs 20,000 per
    order the brokerage is 0.1% (Rs 5 minimum), so splitting further only costs more."""
    return int(min(5, max(1, exposure // 20000)))


# --------------------------------------------------------------------------
# Prices
# --------------------------------------------------------------------------

def fetch_bars(symbol: str, days: int, kind: str = "stock", res: str = "5",
               now: float | None = None) -> pd.DataFrame | None:
    """Bars from the chart feed: 5-minute ("5", IST times) or daily ("D",
    dated by session), or None."""
    now = now or time.time()
    url = FEED_URL.format(kind=kind, symbol=urllib.parse.quote(symbol, safe=""), res=res,
                          start=int(now - days * 86400), end=int(now), count=days * (N_BARS if res == "5" else 1))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(3):
        try:
            data = json.load(urllib.request.urlopen(req, timeout=60))
            break
        except Exception as exc:
            if attempt == 2:
                print(f"{res}-bars for {symbol} failed: {exc}", file=sys.stderr)
                return None
            time.sleep(3 * (attempt + 1))
    if data.get("s") != "ok" or not data.get("t"):
        return None
    idx = pd.to_datetime(data["t"], unit="s", utc=True).tz_convert("Asia/Kolkata").tz_localize(None)
    if res != "5":
        idx = idx.normalize()
    df = pd.DataFrame({k: data.get(k) for k in "ohlcv"}, index=idx).astype(float)
    return df[~df.index.duplicated(keep="last")].sort_index()


@dataclass
class Intraday:
    """Regular sessions only, as [session, bar, stock] arrays (NaN = no bar)."""
    dates: pd.DatetimeIndex
    symbols: list
    O: np.ndarray
    H: np.ndarray
    L: np.ndarray
    C: np.ndarray
    V: np.ndarray


def to_sessions(frames: dict, now: dt.datetime | None = None) -> Intraday:
    """Put each stock's 5-minute bars on 9:15-15:30 slots. A session counts when
    at least half the stocks have a 9:15 bar (special sessions like Diwali's
    evening Muhurat trading don't), and today's only once the market has closed."""
    now = now or dt.datetime.now(S.IST)
    symbols = sorted(frames)
    per, starts = {}, {}
    for sym in symbols:
        df = frames[sym]
        mins = df.index.hour * 60 + df.index.minute
        b = (mins - OPEN_MINUTE) // BAR_MINUTES
        ok = (mins >= OPEN_MINUTE) & (b < N_BARS) & ((mins - OPEN_MINUTE) % BAR_MINUTES == 0)
        prices = df[["o", "h", "l", "c"]]
        ok &= (np.isfinite(prices) & (prices > 0)).all(axis=1).to_numpy()
        df, b = df[ok], b[ok]
        days = df.index.normalize()
        per[sym] = (days, np.asarray(b), df)
        for d in days[np.asarray(b) == 0]:
            starts[d] = starts.get(d, 0) + 1
    today = pd.Timestamp(now.date())
    closed = now.time() >= CLOSED_AFTER
    dates = pd.DatetimeIndex(sorted(d for d, k in starts.items()
                                    if k >= 0.5 * len(symbols) and (d < today or (d == today and closed))))
    shape = (len(dates), N_BARS, len(symbols))
    arrays = {k: np.full(shape, np.nan) for k in "ohlcv"}
    for j, sym in enumerate(symbols):
        days, b, df = per[sym]
        rows = dates.get_indexer(days)
        keep = rows >= 0
        for k in "ohlcv":
            arrays[k][rows[keep], b[keep], j] = df[k].to_numpy()[keep]
    # tidy: high/low must contain open and close; the feed's late volumes are sometimes negative
    hi = np.fmax(np.fmax(arrays["h"], arrays["o"]), arrays["c"])
    lo = np.fmin(np.fmin(arrays["l"], arrays["o"]), arrays["c"])
    return Intraday(dates, symbols, arrays["o"], hi, lo, arrays["c"], np.clip(arrays["v"], 0, None))


@dataclass
class Daily:
    """Official daily prices, [day, stock]."""
    dates: pd.DatetimeIndex
    symbols: list
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray


def to_daily(frames: dict, symbols: list, now: dt.datetime | None = None) -> Daily:
    """Align daily bars on the days most stocks traded (a stray bar for one
    stock on a holiday is dropped); today's bar only counts once the market
    has closed."""
    now = now or dt.datetime.now(S.IST)
    today = pd.Timestamp(now.date())
    closed = now.time() >= CLOSED_AFTER
    cols = {}
    for k, name in (("o", "open"), ("h", "high"), ("l", "low"), ("c", "close"), ("v", "volume")):
        df = pd.DataFrame({s: frames[s][k] for s in symbols if s in frames}).sort_index()
        cols[name] = df
    idx = cols["close"].index
    traded = (cols["close"] > 0).sum(axis=1).to_numpy()
    idx = idx[(traded >= 0.5 * cols["close"].shape[1]) & ((idx < today) | ((idx == today) & closed))]
    out = {}
    for name, df in cols.items():
        df = df.reindex(index=idx, columns=symbols)
        if name != "volume":
            df = df.where(df > 0)
        out[name] = df.to_numpy(dtype=float)
    return Daily(pd.DatetimeIndex(idx), list(symbols), out["open"], out["high"], out["low"], out["close"],
                 np.nan_to_num(out["volume"], nan=0.0).clip(0))


def last_finite(a: np.ndarray, axis: int = 1) -> np.ndarray:
    """Last non-NaN value along `axis` (NaN if none)."""
    ok = np.isfinite(a)
    idx = a.shape[axis] - 1 - np.argmax(np.flip(ok, axis=axis), axis=axis)
    out = np.take_along_axis(a, np.expand_dims(idx, axis), axis).squeeze(axis)
    return np.where(ok.any(axis=axis), out, np.nan)


def features(close, high, low, volume) -> dict:
    """What is known after each day's close, as [day, stock]."""
    C, H, L = (pd.DataFrame(np.asarray(x, dtype=float)) for x in (close, high, low))
    rng = H - L
    with np.errstate(invalid="ignore", divide="ignore"):
        return {
            "close": C.to_numpy(), "high": H.to_numpy(), "low": L.to_numpy(),
            "sma20": C.rolling(20, min_periods=20).mean().to_numpy(),
            "nr7": ((rng <= rng.rolling(7, min_periods=7).min()) & (rng > 0)).to_numpy(),
            "pos": ((C - L) / rng.where(rng > 0)).to_numpy(),
            "ret": (C / C.shift(1) - 1).to_numpy(),
            "turnover": C.to_numpy() * np.asarray(volume, dtype=float),
        }


def shift_down(f: dict) -> dict:
    """Row t gets row t-1: what was known before day t started."""
    out = {}
    for k, a in f.items():
        z = np.zeros_like(a) if a.dtype == bool else np.full(a.shape, np.nan)
        z[1:] = a[:-1]
        out[k] = z
    return out


def skip_days(ip: Intraday, daily: Daily, p: S.Panel | None = None) -> np.ndarray:
    """[session, stock] True where a stock's prices that day can't be trusted
    for day trading:
      * the 5-minute bars and the daily bar disagree (the feed adjusts old prices
        for bonus issues and splits, but has missed the last day before one);
      * an ex-dividend or other corporate-action day, found where Yahoo's
        dividend-adjusted prices move against the feed's: the price drops by the
        dividend at the open, which looks like a gap but isn't one."""
    t = daily.dates.get_indexer(ip.dates)
    ok = t >= 0
    dclose = np.full((len(ip.dates), len(ip.symbols)), np.nan)
    dclose[ok] = daily.close[t[ok]]
    with np.errstate(invalid="ignore", divide="ignore"):
        skip = ~(np.abs(last_finite(ip.C, axis=1) / dclose - 1) <= 0.02)
        if p is not None:
            y = p.C.reindex(index=daily.dates, columns=daily.symbols).to_numpy()
            ratio = y / daily.close
            jump = np.full_like(ratio, np.nan)
            jump[1:] = ratio[1:] / ratio[:-1] - 1
            act = np.abs(jump) > 0.003
            skip[ok] |= act[t[ok]]
    return skip


def session_inputs(daily: Daily, dates: pd.DatetimeIndex) -> dict:
    """For each 5-minute session: the day before's features and the session's
    official open, as [session, stock]. Missing days give NaN."""
    f = features(daily.close, daily.high, daily.low, daily.volume)
    t = daily.dates.get_indexer(dates)
    ok = t >= 1
    out = {}
    for k, a in f.items():
        z = np.zeros((len(dates), a.shape[1]), dtype=bool) if a.dtype == bool else np.full((len(dates), a.shape[1]), np.nan)
        z[ok] = a[t[ok] - 1]
        out[k] = z
    out["open"] = np.full((len(dates), daily.open.shape[1]), np.nan)
    out["open"][ok] = daily.open[t[ok]]
    return out


# --------------------------------------------------------------------------
# Setups. Everything a setup needs is known before the session or seen live
# during it; the page applies the same rules to live prices.
# --------------------------------------------------------------------------

@dataclass
class Setup:
    id: str
    family: str
    name: str
    desc: str
    side: int                     # +1 buy first, -1 short-sell first
    kind: str                     # "open": trade at 9:20; "level": break of yesterday's high/low; "orb": opening range
    gap_lo: float | None = None   # "open": the official open vs yesterday's close must be >= gap_lo
    gap_hi: float | None = None   # and <= gap_hi
    pre: str = ""                 # condition on the day before: "", "trend", "nr7", "strong", "drop"
    orb_bars: int = 0             # opening range length in 5-minute bars
    filter: str = ""              # market filter: "", "mkt" (Nifty vs its open), "trend" (Nifty vs 20-day average)

    def spec(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if k != "desc"}


def base_setups() -> list[Setup]:
    out = []
    for g in (0.01, 0.02):
        p = round(g * 100)
        out += [
            Setup(f"gapdown_buy_{p}", "Gap fade", f"Gap down {p}%: buy",
                  f"The stock opens {p}% or more below yesterday's close. Buy at 9:20 AM, betting the fall was "
                  f"too much and the price climbs back during the day.", +1, "open", gap_hi=-g),
            Setup(f"gapup_short_{p}", "Gap fade", f"Gap up {p}%: short-sell",
                  f"The stock opens {p}% or more above yesterday's close. Short-sell at 9:20 AM (sell first, buy back "
                  f"later the same day), betting the jump fades.", -1, "open", gap_lo=g),
            Setup(f"gapup_buy_{p}", "Gap and go", f"Gap up {p}% in uptrend: buy",
                  f"The stock opens {p}% or more above yesterday's close while above its 20-day average. Buy at "
                  f"9:20 AM, betting the strength carries on.", +1, "open", gap_lo=g, pre="trend"),
            Setup(f"gapdown_short_{p}", "Gap and go", f"Gap down {p}% in downtrend: short-sell",
                  f"The stock opens {p}% or more below yesterday's close while below its 20-day average. "
                  f"Short-sell at 9:20 AM, betting the weakness carries on.", -1, "open", gap_hi=-g, pre="trend"),
        ]
    out += [
        Setup("pdh_nr7", "Range breakout", "Quiet day, then break above",
              "Yesterday's high-to-low range was the narrowest of the last 7 days (the price is coiling). "
              "Buy if the price rises above yesterday's high.", +1, "level", pre="nr7"),
        Setup("pdl_nr7", "Range breakout", "Quiet day, then break below",
              "Yesterday's range was the narrowest of the last 7 days. Short-sell if the price falls below "
              "yesterday's low.", -1, "level", pre="nr7"),
        Setup("pdh_strong", "Range breakout", "Strong close, then break above",
              "Yesterday the stock closed near its high, above its 20-day average. Buy if the price rises "
              "above yesterday's high.", +1, "level", pre="strong"),
        Setup("pdl_weak", "Range breakout", "Weak close, then break below",
              "Yesterday the stock closed near its low, below its 20-day average. Short-sell if the price "
              "falls below yesterday's low.", -1, "level", pre="strong"),
        Setup("rebound_buy", "Rebound", "Big fall yesterday: buy",
              "The stock fell 3% or more yesterday. Buy at 9:20 AM, betting on a bounce.", +1, "open", pre="drop"),
    ]
    for k, minutes in ((3, 15), (6, 30)):
        out += [
            Setup(f"orb{minutes}_long", "Opening range breakout", f"{minutes}-minute breakout up",
                  f"The stock is above its 20-day average. Note the highest price of the first {minutes} minutes "
                  f"(from 9:15 AM). Buy if the price rises above it, by 12:55 PM.", +1, "orb", pre="trend", orb_bars=k),
            Setup(f"orb{minutes}_short", "Opening range breakout", f"{minutes}-minute breakout down",
                  f"The stock is below its 20-day average. Note the lowest price of the first {minutes} minutes. "
                  f"Short-sell if the price falls below it, by 12:55 PM.", -1, "orb", pre="trend", orb_bars=k),
        ]
    return out


FILTERS = {
    "mkt": ("Nifty with you", "the Nifty 50 is above its opening price at that moment (below it, for short-sells)"),
    "trend": ("Nifty trend", "the Nifty 50 closed above its 20-day average the day before (below it, for short-sells)"),
}


def all_setups() -> list[Setup]:
    out = []
    for st in base_setups():
        out.append(st)
        for fid, (fname, cond) in FILTERS.items():
            out.append(Setup(**{**st.__dict__, "id": f"{st.id}@{fid}", "name": f"{st.name} + {fname}",
                                "desc": f"{st.desc} Only when {cond}.", "filter": fid}))
    return out


def pre_condition(st: Setup, prev: dict) -> np.ndarray:
    """True where the day-before condition holds."""
    pc = prev["close"]
    with np.errstate(invalid="ignore"):
        ok = np.isfinite(pc) & (pc > 0)
        trend = pc > prev["sma20"] if st.side > 0 else pc < prev["sma20"]
        if st.pre == "trend":
            ok &= trend
        elif st.pre == "nr7":
            ok &= prev["nr7"].astype(bool)
        elif st.pre == "strong":
            ok &= trend & ((prev["pos"] >= 0.75) if st.side > 0 else (prev["pos"] <= 0.25))
        elif st.pre == "drop":
            ok &= prev["ret"] <= -0.03
    return ok


@dataclass
class Market:
    """The Nifty 50 on the same sessions: 5-minute bars and the day before."""
    O: np.ndarray           # [session, bar]
    C: np.ndarray
    prev_close: np.ndarray  # [session]
    prev_sma20: np.ndarray


def market_from(nifty: Intraday | None, nifty_daily: Daily | None, dates: pd.DatetimeIndex) -> Market:
    D = len(dates)
    O = C = np.full((D, N_BARS), np.nan)
    if nifty is not None:
        pos = nifty.dates.get_indexer(dates)
        O = np.where(pos[:, None] >= 0, nifty.O[np.maximum(pos, 0), :, 0], np.nan)
        C = np.where(pos[:, None] >= 0, nifty.C[np.maximum(pos, 0), :, 0], np.nan)
    pc = sma = np.full(D, np.nan)
    if nifty_daily is not None:
        si = session_inputs(nifty_daily, dates)
        pc, sma = si["close"][:, 0], si["sma20"][:, 0]
    return Market(O, C, pc, sma)


@dataclass
class Entries:
    d: np.ndarray       # session
    s: np.ndarray       # stock
    e: np.ndarray       # entry bar
    pe: np.ndarray      # entry price, after slippage
    score: np.ndarray   # same-time tie-break: bigger first
    side: int


def entries(st: Setup, ip: Intraday, prev: dict, mkt: Market) -> Entries:
    """The first moment each stock meets the setup in each session."""
    D, B, N = ip.O.shape
    ok = pre_condition(st, prev)
    if "skip" in prev:
        ok &= ~prev["skip"]
    # a normal session for this stock: its 9:15 bar exists (not a special
    # session, such as the late start on the day a demerged company lists)
    ok &= np.isfinite(ip.O[:, 0])
    up = st.side > 0
    with np.errstate(invalid="ignore", divide="ignore"):
        if st.filter == "trend":
            m = mkt.prev_close > mkt.prev_sma20 if up else mkt.prev_close < mkt.prev_sma20
            ok &= m[:, None]
        allowed = np.zeros(B, dtype=bool)
        if st.kind == "open":
            gap = prev["open"] / prev["close"] - 1
            if st.gap_lo is not None:
                ok &= gap >= st.gap_lo
            if st.gap_hi is not None:
                ok &= gap <= st.gap_hi
            trig = np.zeros((D, B, N), dtype=bool)
            trig[:, ENTRY_BAR] = ok & np.isfinite(ip.O[:, ENTRY_BAR])
            level = np.full((D, N), np.nan)
        else:
            if st.kind == "level":
                level = prev["high"] if up else prev["low"]
                allowed[ENTRY_BAR:LAST_ENTRY_BAR + 1] = True
            else:
                k = st.orb_bars
                full = np.isfinite(ip.H[:, :k]).all(axis=1)
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", RuntimeWarning)
                    rng = np.nanmax(ip.H[:, :k], axis=1) if up else np.nanmin(ip.L[:, :k], axis=1)
                level = np.where(full, rng, np.nan)
                allowed[k:LAST_ENTRY_BAR + 1] = True
            trig = (ip.H > level[:, None, :]) if up else (ip.L < level[:, None, :])
            trig &= allowed[None, :, None] & ok[:, None, :]
        # when several stocks trigger at the same moment, the most traded one
        # (yesterday's turnover) goes first: it is the easiest to buy and sell at a fair price
        score = prev["turnover"]
        if st.filter == "mkt":
            # the Nifty's last finished 5-minute bar against its opening price
            m = np.zeros((D, B), dtype=bool)
            m[:, 1:] = (mkt.C[:, :-1] > mkt.O[:, :1]) if up else (mkt.C[:, :-1] < mkt.O[:, :1])
            trig &= m[:, :, None]
    hit = trig.any(axis=1)
    first = trig.argmax(axis=1)
    d, s = np.nonzero(hit)
    e = first[d, s]
    o = ip.O[d, e, s]
    lv = level[d, s]
    fill = o if st.kind == "open" else (np.fmax(o, lv) if up else np.fmin(o, lv))
    pe = fill * (1 + SLIPPAGE * st.side)
    sc = np.nan_to_num(np.asarray(score, dtype=float)[d, s], nan=-np.inf)
    keep = np.isfinite(pe)
    return Entries(d[keep], s[keep], e[keep], pe[keep], sc[keep], st.side)


@dataclass
class Trades:
    d: np.ndarray
    s: np.ndarray
    e: np.ndarray      # entry bar
    x: np.ndarray      # exit bar (EXIT_BAR for the 3:10 PM sale)
    pe: np.ndarray
    px: np.ndarray
    kind: np.ndarray   # 0 sold at 3:10 PM, 1 stop-loss, 2 target
    score: np.ndarray
    side: int

    def gross(self) -> np.ndarray:
        return self.side * (self.px / self.pe - 1)


def simulate(ip: Intraday, en: Entries, stop: float, target: float) -> Trades:
    """Stop-loss and target are checked on every 5-minute bar from the entry bar
    until 3:10 PM. If both are touched in the same bar we assume the stop came
    first. A level jumped over between bars fills at the bar's open."""
    B = N_BARS
    d, s, e, pe, side = en.d, en.s, en.e, en.pe, en.side
    n = len(d)
    if n == 0:
        zi, zf = np.zeros(0, dtype=int), np.zeros(0)
        return Trades(zi, zi, zi, zi, zf, zf, zi, zf, side)
    Hs, Ls, Os, Cs = ip.H[d, :, s], ip.L[d, :, s], ip.O[d, :, s], ip.C[d, :, s]
    bars = np.arange(B)[None, :]
    win = (bars >= e[:, None]) & (bars < EXIT_BAR)
    with np.errstate(invalid="ignore"):
        if side > 0:
            sp, tp = pe * (1 - stop), (pe * (1 + target) if target else np.full(n, np.inf))
            hit_s, hit_t = win & (Ls <= sp[:, None]), win & (Hs >= tp[:, None])
        else:
            sp, tp = pe * (1 + stop), (pe * (1 - target) if target else np.full(n, -np.inf))
            hit_s, hit_t = win & (Hs >= sp[:, None]), win & (Ls <= tp[:, None])
    fs = np.where(hit_s.any(1), hit_s.argmax(1), B)
    ft = np.where(hit_t.any(1), hit_t.argmax(1), B)
    is_stop = (fs < B) & (fs <= ft)
    is_tgt = (ft < B) & (ft < fs)
    rows = np.arange(n)
    o_s, o_t = Os[rows, np.minimum(fs, B - 1)], Os[rows, np.minimum(ft, B - 1)]
    # the 3:10 PM price: that bar's open, or the last price before it if the bar is missing
    xo = Os[:, EXIT_BAR]
    t_px = np.where(np.isfinite(xo), xo, last_finite(Cs[:, :EXIT_BAR], axis=1))
    with np.errstate(invalid="ignore"):
        if side > 0:
            s_px = np.where((fs > e) & (o_s < sp), o_s, sp) * (1 - SLIPPAGE)
            t_hit_px = np.where((ft > e) & (o_t > tp), o_t, tp)
            t_px = t_px * (1 - SLIPPAGE)
        else:
            s_px = np.where((fs > e) & (o_s > sp), o_s, sp) * (1 + SLIPPAGE)
            t_hit_px = np.where((ft > e) & (o_t < tp), o_t, tp)
            t_px = t_px * (1 + SLIPPAGE)
    px = np.where(is_stop, s_px, np.where(is_tgt, t_hit_px, t_px))
    kind = np.where(is_stop, 1, np.where(is_tgt, 2, 0))
    x = np.where(is_stop, fs, np.where(is_tgt, ft, EXIT_BAR))
    ok = np.isfinite(px)
    order = np.lexsort((-en.score[ok], e[ok], d[ok]))  # by session, then entry time, then score
    sel = np.nonzero(ok)[0][order]
    return Trades(d[sel], s[sel], e[sel], x[sel], pe[sel], px[sel], kind[sel], en.score[sel], side)


# --------------------------------------------------------------------------
# Results with real money
# --------------------------------------------------------------------------

def net_returns(tr: Trades, value: float):
    """Each trade's result after charges as a share of `value`, the money per trade."""
    shares = shares_for(value, tr.pe)
    return shares >= 1, trade_pnl(shares, tr.pe, tr.px, tr.side) / value


def periods_for(dates: pd.DatetimeIndex) -> dict:
    """Two picking periods and a final test of equal length."""
    n = len(dates)
    a, b = n // 3, 2 * n // 3
    return {"pick1": (0, a - 1), "pick2": (a, b - 1), "test": (b, n - 1)}


def quick_stats(tr: Trades, value: float, slots: int, bounds: dict) -> dict:
    """Every trade's result after charges, used to shortlist cheaply. "est" is
    the expected result per trading day on the money traded: on a day with k
    signals and room for `slots` trades, a typical day's trades earn the day's
    average and use min(k, slots) of the slots. Averaging by day, not by
    trade, matters: on a day the whole market gaps down, dozens of stocks
    signal at once but only a few can be bought."""
    ok, net = net_returns(tr, value)
    gross = tr.gross()
    out = {}
    for name, (s, e) in bounds.items():
        m = ok & (tr.d >= s) & (tr.d <= e)
        k = int(m.sum())
        days = e - s + 1
        if not k:
            out[name] = {"n": 0, "win": None, "avg": None, "gross": None, "per_day": 0.0, "days": 0, "est": -math.inf}
            continue
        d = tr.d[m] - s
        count = np.bincount(d, minlength=days)
        day_avg = np.bincount(d, weights=net[m], minlength=days) / np.maximum(count, 1)
        est = float((day_avg * np.minimum(count, slots) / slots).sum() / days)
        out[name] = {"n": k, "win": float((net[m] > 0).mean()), "avg": float(net[m].mean()),
                     "gross": float(gross[m].mean()), "per_day": k / days, "days": int((count > 0).sum()), "est": est}
    return out


def day_sim(tr: Trades, ip: Intraday, capital: float, margin: float, start: int, end: int) -> dict:
    """Trade with real money: each morning the money (times the margin) is
    split over day_slots() trades, taken in the order they trigger. Everything
    is sold the same day, so each day starts from the day before's result."""
    lo, hi = np.searchsorted(tr.d, start), np.searchsorted(tr.d, end, side="right")
    equity = float(capital)
    curve, day_pnls, pnls, kinds, log = [], [], [], [], []
    charges = 0.0
    j = lo
    for d in range(start, end + 1):
        exposure = equity * margin
        slots = day_slots(exposure)
        value = exposure / slots
        day_pnl, taken = 0.0, 0
        while j < hi and tr.d[j] == d:
            if taken < slots and equity > 0:
                sh = float(shares_for(value, tr.pe[j]))
                if sh >= 1:
                    pnl = float(trade_pnl(sh, tr.pe[j], tr.px[j], tr.side))
                    charges += float(trade_charges(sh, tr.pe[j], tr.px[j], tr.side))
                    day_pnl += pnl
                    pnls.append(pnl)
                    kinds.append(int(tr.kind[j]))
                    log.append([ip.symbols[tr.s[j]], str(ip.dates[d].date()), bar_time(int(tr.e[j])), float(tr.pe[j]),
                                bar_time(int(tr.x[j])), float(tr.px[j]), sh, pnl, int(tr.kind[j])])
                    taken += 1
            j += 1
        equity += day_pnl
        if taken:
            day_pnls.append(day_pnl)
        curve.append(equity)
    curve_arr = np.array(curve)
    peak = np.maximum.accumulate(np.concatenate([[capital], curve_arr]))[1:]
    pnls_a, days_a, kinds_a = np.array(pnls), np.array(day_pnls), np.array(kinds)
    n_days = end - start + 1
    return {
        "start": str(ip.dates[start].date()), "end": str(ip.dates[end].date()), "sessions": n_days,
        "capital": capital, "final": equity, "profit": equity - capital, "per_day": (equity - capital) / n_days,
        "max_dd": float(np.max(1 - curve_arr / peak)) if len(curve_arr) else 0.0,
        "trades": len(pnls), "days_traded": len(day_pnls),
        "win_rate": float((pnls_a > 0).mean()) if len(pnls) else None,
        "avg_pnl": float(pnls_a.mean()) if len(pnls) else None,
        "best_day": float(days_a.max()) if len(day_pnls) else None,
        "worst_day": float(days_a.min()) if len(day_pnls) else None,
        "green_days": float((days_a > 0).mean()) if len(day_pnls) else None,
        "targets_hit": int((kinds_a == 2).sum()), "stops_hit": int((kinds_a == 1).sum()),
        "charges": charges,
        "curve": [[str(ip.dates[start + i].date()), round(float(v), 2)] for i, v in enumerate(curve_arr)],
        "log": log,  # [stock, date, entry time, entry price, exit time, exit price, shares, profit after charges, kind]
    }


def random_entries(ip: Intraday, prev: dict, per_day: dict, side: int, rng) -> Entries:
    """As many trades on each day as the strategy took, in random stocks,
    entered at 9:20 AM."""
    d_list, s_list = [], []
    valid = np.isfinite(prev["close"]) & np.isfinite(ip.O[:, ENTRY_BAR]) & np.isfinite(ip.O[:, 0])
    if "skip" in prev:
        valid &= ~prev["skip"]
    for d, k in sorted(per_day.items()):
        cand = np.nonzero(valid[d])[0]
        if len(cand) and k:
            pick = rng.choice(cand, size=min(k, len(cand)), replace=False)
            d_list += [d] * len(pick)
            s_list += list(pick)
    d_a, s_a = np.array(d_list, dtype=int), np.array(s_list, dtype=int)
    pe = ip.O[d_a, ENTRY_BAR, s_a] * (1 + SLIPPAGE * side)
    return Entries(d_a, s_a, np.full(len(d_a), ENTRY_BAR), pe, rng.random(len(d_a)), side)


def random_baseline(ip, prev, run: dict, side, stop, target, capital, margin, start, end,
                    runs=RANDOM_RUNS, seed=11) -> list[float]:
    """If random trades at 9:20 with the same exits, money and number of trades
    a day do as well, the setup's result was luck or the market's move."""
    per_day = {}
    for row in run["log"]:
        d = int(ip.dates.get_loc(pd.Timestamp(row[1])))
        per_day[d] = per_day.get(d, 0) + 1
    if not per_day:
        return []
    rng = np.random.default_rng(seed)
    return [day_sim(simulate(ip, random_entries(ip, prev, per_day, side, rng), stop, target),
                    ip, capital, margin, start, end)["final"] for _ in range(runs)]


def long_run_check(st: Setup, p: S.Panel, market: dict, before: pd.Timestamp) -> dict | None:
    """The setup's basic idea on daily prices from 2015 until the 5-minute
    prices start: enter at the open (or at yesterday's high/low once crossed),
    sell at the close, no stop-loss or target, before charges. Opening-range
    setups need 5-minute prices, so they can't be checked this way."""
    if st.kind == "orb":
        return None
    O, H, L, C = (df.to_numpy() for df in (p.O, p.H, p.L, p.C))
    prev = shift_down(features(C, H, L, p.V.to_numpy()))
    ok = pre_condition(st, prev)
    up = st.side > 0
    with np.errstate(invalid="ignore", divide="ignore"):
        if st.filter == "trend" and "nifty" in market:
            nc = market["nifty"]["Close"].reindex(p.dates, method="ffill", limit=5)
            nsma = nc.rolling(20, min_periods=20).mean()
            m = (nc.shift(1) > nsma.shift(1)) if up else (nc.shift(1) < nsma.shift(1))
            ok &= m.to_numpy()[:, None]
        if st.kind == "open":
            gap = O / prev["close"] - 1
            if st.gap_lo is not None:
                ok &= gap >= st.gap_lo
            if st.gap_hi is not None:
                ok &= gap <= st.gap_hi
            entry = O
        else:
            level = prev["high"] if up else prev["low"]
            ok &= (H > level) if up else (L < level)
            entry = np.fmax(O, level) if up else np.fmin(O, level)
        gross = st.side * (C / entry - 1)
    rows = np.asarray((p.dates >= pd.Timestamp(LONG_RUN_START)) & (p.dates < before))
    ok &= rows[:, None] & np.isfinite(gross)
    t, n = np.nonzero(ok)
    note = "The Nifty-since-open filter can't be checked on daily prices, so this is without it." if st.filter == "mkt" else ""
    if not len(t):
        return {"n": 0, "avg": None, "win": None, "years": 0, "years_up": 0, "note": note}
    g = gross[t, n]
    years = pd.Series(g).groupby(p.dates[t].year).mean()
    return {"n": int(len(g)), "avg": float(g.mean()), "win": float((g > 0).mean()), "years": int(len(years)),
            "years_up": int((years > 0).sum()), "start": str(p.dates[t].min().date()),
            "end": str(p.dates[t].max().date()), "note": note}


def combo_key(sid: str, stop: float, target: float) -> str:
    return f"{sid}|{stop * 1000:.0f}|{target * 1000:.0f}"


def parse_key(key: str):
    sid, st, tg = key.split("|")
    return sid, int(st) / 1000, int(tg) / 1000


def run_backtest(ip: Intraday, daily: Daily, nifty: Intraday | None, nifty_daily: Daily | None,
                 p: S.Panel, market: dict, log=print, previous: dict | None = None) -> dict:
    """previous: {"capital|margin": combo key} picked last time, kept unless clearly beaten."""
    t0 = time.time()
    prev = session_inputs(daily, ip.dates)
    prev["skip"] = skip_days(ip, daily, p)
    mkt = market_from(nifty, nifty_daily, ip.dates)
    bounds = periods_for(ip.dates)
    setups = all_setups()
    trades, setup_stats, long_run = {}, {}, {}
    for st in setups:
        en = entries(st, ip, prev, mkt)
        for stop in STOPS:
            for target in TARGETS:
                trades[combo_key(st.id, stop, target)] = simulate(ip, en, stop, target)
        std = trades[combo_key(st.id, *STANDARD_EXIT)]
        g = std.gross()
        setup_stats[st.id] = {}
        for name, (s, e) in bounds.items():
            m = (std.d >= s) & (std.d <= e)
            setup_stats[st.id][name] = {"n": int(m.sum()), "per_day": float(m.sum() / (e - s + 1)),
                                        "win": float((g[m] > 0).mean()) if m.any() else None,
                                        "avg": float(g[m].mean()) if m.any() else None}
        long_run[st.id] = long_run_check(st, p, market, ip.dates[0])
    log(f"Day trading: {len(trades)} combinations on {len(ip.dates)} sessions in {time.time() - t0:.0f}s")

    sims = {}

    def sim(key, cap, margin, period):
        k = (key, cap, margin, period)
        if k not in sims:
            s, e = bounds[period]
            sims[k] = day_sim(trades[key], ip, cap, margin, s, e)
        return sims[k]

    buckets = []
    for cap in S.CAPITALS:
        for margin in MARGINS:
            exposure = cap * margin
            slots = day_slots(exposure)
            value = exposure / slots
            scored = []
            for key, tr in trades.items():
                qs = quick_stats(tr, value, slots, bounds)
                if qs["pick1"]["n"] < MIN_TRADES or qs["pick2"]["n"] < MIN_TRADES:
                    continue
                a, b = qs["pick1"]["est"] * margin, qs["pick2"]["est"] * margin
                scored.append({"key": key, "pick1_est": a, "pick2_est": b, "steady": min(a, b),
                               "avg_trade": {nm: {k: q[k] for k in ("n", "win", "avg", "gross", "per_day", "days")}
                                             for nm, q in qs.items()}})
            scored.sort(key=lambda c: (-round(c["steady"], 9), c["key"]))
            good = [c for c in scored if c["pick1_est"] > 0 and c["pick2_est"] > 0]
            pool = good or scored
            best = pool[0] if pool else None
            kept = next((c for c in pool if c["key"] == (previous or {}).get(f"{cap}|{margin}")), None)
            if kept and kept["steady"] < best["steady"] - SWITCH_MARGIN:
                kept = None
            pick = kept or best
            shown = scored[:CANDIDATES]
            if pick and pick not in shown:
                shown.append(pick)
            cands = [{**c, "runs": {nm: {k: v for k, v in sim(c["key"], cap, margin, nm).items()
                                         if k not in ("log", "curve")} for nm in bounds}} for c in shown]
            chosen = next((c for c in cands if pick and c["key"] == pick["key"]), None)
            random, verdict = None, "none"
            if chosen:
                sid, stop, target = parse_key(chosen["key"])
                side = next(x.side for x in setups if x.id == sid)
                run = sim(chosen["key"], cap, margin, "test")
                s_, e_ = bounds["test"]
                finals = random_baseline(ip, prev, run, side, stop, target, cap, margin, s_, e_)
                if finals:
                    f = np.array(finals)
                    random = {"runs": len(f), "median": float(np.median(f)), "p10": float(np.percentile(f, 10)),
                              "p90": float(np.percentile(f, 90)), "beat_pct": float((run["final"] > f).mean())}
                lr = long_run.get(sid)
                if run["trades"] == 0 or run["final"] <= cap:
                    verdict = "loss"
                elif not good:
                    verdict = "unproven"
                elif random and random["beat_pct"] < 0.6:
                    verdict = "luck"
                elif lr and lr["n"] and lr["avg"] <= 0:
                    verdict = "recent_only"
                else:
                    verdict = "good"
                chosen["example"] = run
            buckets.append({"capital": cap, "margin": margin, "slots": slots, "per_trade": value,
                            "chosen": chosen["key"] if chosen else None,
                            "kept_previous": bool(kept and best is not kept), "verdict": verdict,
                            "passed_pick": len(good), "random": random, "candidates": cands})
            if chosen:
                t = chosen["runs"]["test"]
                log(f"Rs {cap:>7,} x{margin}: {chosen['key']:<28} test Rs {cap:,} -> Rs {t['final']:,.0f} "
                    f"({t['trades']} trades, win {t['win_rate'] or 0:.0%}) | beat "
                    f"{0 if not random else random['beat_pct']:.0%} of random | {verdict}")

    return {
        "schema": SCHEMA,
        "generated_at": dt.datetime.now(S.IST).isoformat(timespec="minutes"),
        "data_start": str(ip.dates[0].date()), "data_end": str(ip.dates[-1].date()),
        "sessions": len(ip.dates), "n_stocks": len(ip.symbols), "combos_tested": len(trades),
        "periods": [{"name": nm, "start": str(ip.dates[s].date()), "end": str(ip.dates[e].date()), "sessions": e - s + 1}
                    for nm, (s, e) in bounds.items()],
        "grid": {"stops": STOPS, "targets": TARGETS, "margins": MARGINS, "capitals": S.CAPITALS,
                 "entry_time": bar_time(ENTRY_BAR), "last_entry": bar_time(LAST_ENTRY_BAR),
                 "exit_time": bar_time(EXIT_BAR), "slippage": SLIPPAGE, "min_trades": MIN_TRADES,
                 "random_runs": RANDOM_RUNS},
        "switch_margin": SWITCH_MARGIN, "standard_exit": STANDARD_EXIT,
        "setups": {st.id: {**st.spec(), "desc": st.desc} for st in setups},
        "setup_stats": setup_stats, "long_run": long_run,
        "buckets": buckets,
    }


# --------------------------------------------------------------------------
# The next session's watch list
# --------------------------------------------------------------------------

CORPORATE_ACTIONS_URL = ("https://www.nseindia.com/api/corporates-corporateActions?index=equities"
                         "&from_date={:%d-%m-%Y}&to_date={:%d-%m-%Y}")


def fetch_corporate_actions(start: dt.date, end: dt.date) -> list | None:
    """NSE's list of ex-dates (dividends, bonus issues, splits, demergers)
    between two dates: [(symbol, ISO date, what)], or None if NSE didn't answer."""
    req = urllib.request.Request(CORPORATE_ACTIONS_URL.format(start, end), headers={
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "application/json", "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-actions"})
    try:
        rows = json.load(urllib.request.urlopen(req, timeout=30))
        out = []
        for r in rows:
            day = dt.datetime.strptime(r["exDate"], "%d-%b-%Y").date()
            out.append((str(r["symbol"]), day.isoformat(), str(r.get("subject", "")).strip()))
        return out
    except Exception as exc:
        print(f"NSE corporate actions unavailable: {exc}", file=sys.stderr)
        return None


def watch_list(daily: Daily, nifty_daily: Daily | None, actions: list | None = None) -> dict:
    """Levels from the latest finished session, and which stocks meet each
    setup's day-before condition, for the next session. `actions` are NSE's
    upcoming ex-dates: on those days a stock's open drops for an accounting
    reason (a dividend, a bonus issue), so the page skips it."""
    f = features(daily.close, daily.high, daily.low, daily.volume)
    last = {k: a[-1:] for k, a in f.items()}  # the "day before" of the next session
    r = lambda x: None if not np.isfinite(x) else round(float(x), 4)
    levels = {}
    for j, sym in enumerate(daily.symbols):
        if np.isfinite(last["close"][0, j]):
            levels[sym] = {"pc": r(last["close"][0, j]), "ph": r(last["high"][0, j]), "pl": r(last["low"][0, j]),
                           "sma20": r(last["sma20"][0, j]), "pos": r(last["pos"][0, j]), "ret": r(last["ret"][0, j]),
                           "nr7": bool(last["nr7"][0, j]), "turn": r(last["turnover"][0, j])}
    candidates = {}
    for st in base_setups():
        ok = pre_condition(st, last)[0]
        candidates[st.id] = [daily.symbols[j] for j in np.nonzero(ok)[0] if daily.symbols[j] in levels]
    out = {"date": str(daily.dates[-1].date()), "levels": levels, "candidates": candidates, "ex_dates": None}
    if actions is not None:
        ex = {}
        for sym, day, what in actions:
            if sym in levels and day > out["date"]:
                ex.setdefault(sym, []).append([day, what])
        out["ex_dates"] = ex
    if nifty_daily is not None and len(nifty_daily.dates) and nifty_daily.dates[-1] == daily.dates[-1]:
        nf = features(nifty_daily.close, nifty_daily.high, nifty_daily.low, nifty_daily.volume)
        pc, sma = float(nf["close"][-1, 0]), nf["sma20"][-1, 0]
        out["nifty"] = {"pc": pc, "sma20": r(sma), "up": bool(np.isfinite(sma) and pc > sma),
                        "down": bool(np.isfinite(sma) and pc < sma)}
    return out


def download_daily(symbols, days: int = DAILY_DAYS, now: dt.datetime | None = None):
    """(stocks, nifty) official daily bars, or (None, None) when too few came back."""
    frames = {}
    for sym in symbols:
        df = fetch_bars(sym, days, res="D")
        if df is not None and len(df):
            frames[sym] = df
    if len(frames) < 0.8 * len(symbols):
        print(f"Only {len(frames)} of {len(symbols)} stocks have daily bars from the chart feed.", file=sys.stderr)
        return None, None
    n = fetch_bars(INDEX_SYMBOLS["nifty"], days, kind="index", res="D")
    syms = sorted(frames)
    return to_daily(frames, syms, now), (to_daily({"NIFTY": n}, ["NIFTY"], now) if n is not None else None)


def download_intraday(symbols, days: int = INTRADAY_DAYS, now: dt.datetime | None = None, log=print):
    """(stocks, nifty) 5-minute sessions, or (None, None) when too few came back."""
    t0 = time.time()
    frames = {}
    for sym in symbols:
        df = fetch_bars(sym, days)
        if df is not None and len(df):
            frames[sym] = df
    missing = [s for s in symbols if s not in frames]
    if missing:
        print(f"No 5-minute prices for: {', '.join(missing)}", file=sys.stderr)
    if len(frames) < 0.8 * len(symbols):
        print(f"Only {len(frames)} of {len(symbols)} stocks have 5-minute prices.", file=sys.stderr)
        return None, None
    n = fetch_bars(INDEX_SYMBOLS["nifty"], days, kind="index")
    ip = to_sessions(frames, now)
    nifty = to_sessions({"NIFTY": n}, now) if n is not None and len(n) else None
    log(f"5-minute prices: {len(frames)} stocks, {len(ip.dates)} sessions ({ip.dates[0].date()} to "
        f"{ip.dates[-1].date()}) in {time.time() - t0:.0f}s")
    return ip, nifty


def align(ip: Intraday, daily: Daily) -> tuple[Intraday, Daily]:
    """Keep the stocks both have, in the same order."""
    syms = [s for s in ip.symbols if s in set(daily.symbols)]
    i = [ip.symbols.index(s) for s in syms]
    j = [daily.symbols.index(s) for s in syms]
    ip2 = Intraday(ip.dates, syms, *(a[:, :, i] for a in (ip.O, ip.H, ip.L, ip.C, ip.V)))
    d2 = Daily(daily.dates, syms, *(a[:, j] for a in (daily.open, daily.high, daily.low, daily.close, daily.volume)))
    return ip2, d2
