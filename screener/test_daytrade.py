"""Tests for the day-trading engine. Run: python -m pytest screener -q"""
import datetime as dt
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import daytrade as D
import screener as S

NAN = np.nan
B = D.N_BARS


def session_arrays(rows: dict, n_stocks=1):
    """{ "HH:MM": (o, h, l, c) } -> O, H, L, C of shape (1, 76, n_stocks); other slots empty."""
    arrs = [np.full((1, B, n_stocks), NAN) for _ in range(4)]
    for t, ohlc in rows.items():
        for a, v in zip(arrs, ohlc):
            a[0, D.bar_at(t), :] = v
    return arrs


def make_ip(rows: dict, dates=("2026-10-29",), symbols=("AAA",)):
    O, H, L, C = session_arrays(rows, len(symbols))
    return D.Intraday(pd.DatetimeIndex(pd.to_datetime(list(dates))), list(symbols), O, H, L, C, np.ones_like(O))


def prev_for(pc, ph=None, pl=None, open_=None, sma20=NAN, nr7=False, pos=NAN, ret=NAN, turnover=1.0):
    a = lambda x: np.array([[x]], dtype=float)
    return {"close": a(pc), "high": a(ph if ph is not None else pc), "low": a(pl if pl is not None else pc),
            "sma20": a(sma20), "nr7": np.array([[nr7]]), "pos": a(pos), "ret": a(ret), "turnover": a(turnover),
            "open": a(open_ if open_ is not None else pc)}


def no_market(n=1):
    return D.Market(np.full((n, B), NAN), np.full((n, B), NAN), np.full(n, NAN), np.full(n, NAN))


def flat_day(price=100.0, until="15:30"):
    """A quiet session: every bar at `price`."""
    rows, b = {}, 0
    while D.bar_time(b) <= until and b < B:
        rows[D.bar_time(b)] = (price, price, price, price)
        b += 1
    return rows


def setup(**kw):
    base = dict(id="t", family="f", name="n", desc="d", side=1, kind="open")
    base.update(kw)
    return D.Setup(**base)


# ---- charges ---------------------------------------------------------------

def test_intraday_round_trip_on_1000():
    # brokerage Rs 5 + 5 (minimum), STT 0.025% on the sale, stamp 0.003% on the buy,
    # NSE/SEBI/IPFT fees, GST 18% on brokerage and fees; no DP charge
    fees = 2 * 1000 * (0.0000297 + 0.000002)
    expected = 10 + 0.25 + 0.03 + fees + 0.18 * (10 + fees)
    assert float(D.round_trip_charges(1000)) == pytest.approx(expected, abs=1e-9)
    assert 12.1 < expected < 12.2  # 1.2% of Rs 1,000: why small day trades rarely pay
    # far cheaper than delivery (Rs 37.6 for the same Rs 1,000)
    assert float(D.round_trip_charges(1000)) < float(S.buy_charges(1000) + S.sell_charges(1000)) / 3


def test_intraday_brokerage_cap_and_stt_side():
    assert float(D.buy_charges(100_000)) == pytest.approx(20 + 100_000 * 0.0000317 + 3 + 0.18 * (20 + 3.17), abs=1e-9)
    # STT only when selling, stamp duty only when buying
    assert float(D.sell_charges(100_000) - D.buy_charges(100_000)) == pytest.approx(25 - 3)


def test_short_trade_pays_stt_on_the_opening_sale():
    pnl = float(D.trade_pnl(10, 100.0, 99.0, -1))  # sell 10 at 100, buy back at 99
    expected = 10 - float(D.sell_charges(1000) + D.buy_charges(990))
    assert pnl == pytest.approx(expected)
    assert float(D.trade_pnl(10, 100.0, 99.0, +1)) == pytest.approx(-10 - float(D.buy_charges(1000) + D.sell_charges(990)))


def test_shares_leave_room_for_charges():
    for value, price in ((1000, 990), (1000, 500), (5000, 4980), (20000, 333.3)):
        sh = float(D.shares_for(value, price))
        assert sh * price + float(D.round_trip_charges(sh * price)) <= value
    assert float(D.shares_for(1000, 995)) == 0  # 995 + Rs 12 of charges is more than Rs 1,000


@pytest.mark.parametrize("exposure, slots", [(1000, 1), (19_999, 1), (20_000, 1), (40_000, 2), (99_999, 4),
                                             (100_000, 5), (500_000, 5)])
def test_day_slots(exposure, slots):
    assert D.day_slots(exposure) == slots


# ---- prices ----------------------------------------------------------------

def feed_frame(day, times, price=100.0):
    idx = pd.to_datetime([f"{day} {t}" for t in times])
    return pd.DataFrame({"o": price, "h": price + 1, "l": price - 1, "c": price, "v": 1000.0}, index=idx)


def test_sessions_keep_regular_days_only():
    regular = [D.bar_time(b) for b in range(B)]
    frames = {
        "AAA": pd.concat([feed_frame("2026-10-27", regular), feed_frame("2026-10-28", regular),
                          feed_frame("2026-11-08", ["18:15", "18:20", "18:25"]),  # Diwali Muhurat session
                          feed_frame("2026-10-29", ["09:15", "09:20"])]),         # today, still trading
        "BBB": pd.concat([feed_frame("2026-10-27", regular), feed_frame("2026-10-28", regular[3:]),
                          feed_frame("2026-10-29", ["09:15"])]),
    }
    during = dt.datetime(2026, 10, 29, 9, 25, tzinfo=S.IST)
    ip = D.to_sessions(frames, during)
    assert list(ip.dates.strftime("%Y-%m-%d")) == ["2026-10-27", "2026-10-28"]
    assert ip.O.shape == (2, B, 2)
    assert np.isnan(ip.O[1, 0, 1]) and ip.O[1, 3, 1] == 100  # BBB started late on the 28th
    after = D.to_sessions(frames, dt.datetime(2026, 10, 29, 16, 0, tzinfo=S.IST))
    assert after.dates[-1] == pd.Timestamp("2026-10-29")


def test_sessions_tidy_bad_bars():
    idx = pd.to_datetime(["2026-10-27 09:15", "2026-10-27 09:17", "2026-10-27 09:20", "2026-10-27 09:25"])
    df = pd.DataFrame({"o": [100, 100, 100, 0], "h": [99, 100, 101, 0], "l": [101, 100, 99, 0],
                       "c": [100.5, 100, 100, 0], "v": [10, 10, -5, 0]}, index=idx)
    ip = D.to_sessions({"AAA": df}, dt.datetime(2026, 10, 28, 9, 0, tzinfo=S.IST))
    assert ip.H[0, 0, 0] == 100.5 and ip.L[0, 0, 0] == 100  # high/low widened to contain open and close
    assert np.isnan(ip.O[0, 2, 0])  # zero prices are no bar; 09:17 is off the 5-minute grid
    assert ip.V[0, 1, 0] == 0  # negative volume clipped


def test_daily_bars_skip_todays_forming_bar():
    idx = pd.to_datetime(["2026-10-27", "2026-10-28", "2026-10-29"])
    df = pd.DataFrame({"o": [1, 2, 3.0], "h": [1, 2, 3.0], "l": [1, 2, 3.0], "c": [1, 2, 3.0], "v": [1, 1, 1.0]}, index=idx)
    d = D.to_daily({"AAA": df}, ["AAA"], dt.datetime(2026, 10, 29, 12, 0, tzinfo=S.IST))
    assert list(d.dates.strftime("%d")) == ["27", "28"]
    d = D.to_daily({"AAA": df}, ["AAA"], dt.datetime(2026, 10, 29, 15, 45, tzinfo=S.IST))
    assert len(d.dates) == 3


def test_daily_bars_ignore_a_stray_bar_on_a_holiday():
    days = pd.to_datetime(["2026-10-27", "2026-10-28", "2026-10-29"])
    bar = lambda idx: pd.DataFrame({k: 10.0 for k in "ohlcv"}, index=pd.DatetimeIndex(idx))
    frames = {"AAA": bar(days), "BBB": bar(days), "CCC": bar(list(days) + [pd.Timestamp("2026-10-31")])}
    d = D.to_daily(frames, ["AAA", "BBB", "CCC"], dt.datetime(2026, 11, 1, 10, 0, tzinfo=S.IST))
    assert list(d.dates.strftime("%d")) == ["27", "28", "29"]
    w = D.watch_list(d, None)
    assert w["date"] == "2026-10-29" and set(w["levels"]) == {"AAA", "BBB", "CCC"}


def test_features_use_only_the_past():
    n = 30
    close = np.linspace(100, 129, n)[:, None]
    f = D.features(close, close + 1, close - 1, np.ones_like(close))
    assert np.isnan(f["sma20"][18, 0]) and f["sma20"][19, 0] == pytest.approx(close[:20].mean())
    prev = D.shift_down(f)
    assert prev["close"][5, 0] == close[4, 0] and np.isnan(prev["close"][0, 0])
    assert prev["nr7"].dtype == bool and not prev["nr7"][0, 0]


def test_session_inputs_line_up_the_day_before():
    dates = pd.to_datetime(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"])
    a = lambda *x: np.array(x, dtype=float)[:, None]
    daily = D.Daily(pd.DatetimeIndex(dates), ["AAA"], a(10, 20, 30, 40), a(11, 21, 31, 41), a(9, 19, 29, 39),
                    a(10.5, 20.5, 30.5, 40.5), a(1, 1, 1, 1))
    si = D.session_inputs(daily, pd.DatetimeIndex(pd.to_datetime(["2026-10-28", "2026-10-30"])))
    assert si["close"][0, 0] == 20.5 and si["high"][0, 0] == 21 and si["open"][0, 0] == 30
    assert np.isnan(si["close"][1, 0]) and np.isnan(si["open"][1, 0])  # no daily bar for that session


# ---- entries and exits -----------------------------------------------------

def test_gap_uses_the_official_open_and_buys_at_920():
    rows = flat_day(97.5)
    rows["09:20"] = (97.6, 98.0, 97.4, 97.8)
    ip = make_ip(rows)
    st = setup(gap_hi=-0.02)
    en = D.entries(st, ip, prev_for(pc=100, open_=97.9), no_market())  # official open only -2.1%
    assert len(en.d) == 1 and en.e[0] == D.ENTRY_BAR
    assert en.pe[0] == pytest.approx(97.6 * (1 + D.SLIPPAGE))
    # the first trade (97.5) is -2.5%, but the official open (98.1) is only -1.9%: no trade
    assert len(D.entries(st, ip, prev_for(pc=100, open_=98.1), no_market()).d) == 0


def test_no_trade_without_a_915_bar_or_on_a_skipped_day():
    rows = flat_day(97)
    del rows["09:15"]
    st = setup(gap_hi=-0.02)
    assert len(D.entries(st, make_ip(rows), prev_for(pc=100, open_=97), no_market()).d) == 0
    prev = prev_for(pc=100, open_=97)
    prev["skip"] = np.array([[True]])
    assert len(D.entries(st, make_ip(flat_day(97)), prev, no_market()).d) == 0


def test_level_break_from_920_until_1255():
    rows = flat_day(100)
    rows["09:15"] = (100, 103, 100, 100)  # above yesterday's high in the first bar doesn't count
    rows["10:00"] = (100.5, 102.5, 100.4, 102)
    st = setup(kind="level", pre="")
    en = D.entries(st, make_ip(rows), prev_for(pc=100, ph=101), no_market())
    assert en.e[0] == D.bar_at("10:00") and en.pe[0] == pytest.approx(101 * (1 + D.SLIPPAGE))
    late = flat_day(100)
    late["13:00"] = (100, 103, 100, 102)
    assert len(D.entries(st, make_ip(late), prev_for(pc=100, ph=101), no_market()).d) == 0
    gapped = flat_day(100)
    gapped["10:00"] = (101.5, 102, 101.4, 101.8)  # opens above the level: filled at the open
    assert D.entries(st, make_ip(gapped), prev_for(pc=100, ph=101), no_market()).pe[0] == pytest.approx(101.5 * (1 + D.SLIPPAGE))


def test_short_level_break():
    rows = flat_day(100)
    rows["11:00"] = (99.5, 99.6, 98.0, 98.5)
    st = setup(kind="level", side=-1)
    en = D.entries(st, make_ip(rows), prev_for(pc=100, pl=99), no_market())
    assert en.e[0] == D.bar_at("11:00") and en.pe[0] == pytest.approx(99 * (1 - D.SLIPPAGE))


def test_opening_range_breakout():
    rows = flat_day(100)
    rows["09:15"] = (100, 101, 99.5, 100.5)
    rows["09:25"] = (100.5, 101.2, 100, 101)   # range high 101.2 after 15 minutes
    rows["09:30"] = (101, 101.3, 100.8, 101.1)  # first bar after the range: breaks it
    st = setup(kind="orb", orb_bars=3)
    en = D.entries(st, make_ip(rows), prev_for(pc=100), no_market())
    assert en.e[0] == D.bar_at("09:30") and en.pe[0] == pytest.approx(101.2 * (1 + D.SLIPPAGE))
    missing = dict(rows)
    del missing["09:20"]  # no full opening range: no trade
    assert len(D.entries(st, make_ip(missing), prev_for(pc=100), no_market()).d) == 0


def test_market_filter_uses_the_niftys_last_finished_bar():
    rows = flat_day(97)
    st = setup(gap_hi=-0.02, filter="mkt")
    mkt = no_market()
    mkt.O[0, 0], mkt.C[0, 0] = 22000, 21990  # Nifty fell in its first bar: no buy at 9:20
    assert len(D.entries(st, make_ip(rows), prev_for(pc=100, open_=97), mkt).d) == 0
    mkt.C[0, 0] = 22010
    assert len(D.entries(st, make_ip(rows), prev_for(pc=100, open_=97), mkt).d) == 1
    trend = setup(gap_hi=-0.02, filter="trend")
    m2 = no_market()
    m2.prev_close[:], m2.prev_sma20[:] = 22000, 22100  # Nifty below its 20-day average: no buys
    assert len(D.entries(trend, make_ip(rows), prev_for(pc=100, open_=97), m2).d) == 0


def run_one(rows, stop, target, side=1, pe_bar="09:20"):
    ip = make_ip(rows)
    e = D.bar_at(pe_bar)
    en = D.Entries(np.array([0]), np.array([0]), np.array([e]), np.array([ip.O[0, e, 0] * (1 + D.SLIPPAGE * side)]),
                   np.array([1.0]), side)
    tr = D.simulate(ip, en, stop, target)
    return tr, en.pe[0]


def test_stop_counts_first_when_both_are_touched():
    rows = flat_day(100)
    rows["10:00"] = (100, 103, 98, 100)
    tr, pe = run_one(rows, 0.01, 0.02)
    assert tr.kind[0] == 1 and tr.px[0] == pytest.approx(pe * 0.99 * (1 - D.SLIPPAGE))


def test_jump_through_the_stop_fills_at_the_open():
    rows = flat_day(100)
    rows["10:00"] = (97, 97.5, 96.5, 97)
    tr, pe = run_one(rows, 0.01, 0.02)
    assert tr.kind[0] == 1 and tr.px[0] == pytest.approx(97 * (1 - D.SLIPPAGE))


def test_target_fills_at_the_target_or_a_better_open():
    rows = flat_day(100)
    rows["11:00"] = (100.5, 102.5, 100.4, 102)
    tr, pe = run_one(rows, 0.01, 0.015)
    assert tr.kind[0] == 2 and tr.px[0] == pytest.approx(pe * 1.015) and tr.x[0] == D.bar_at("11:00")
    rows["11:00"] = (103, 103.5, 102.8, 103)
    tr, _ = run_one(rows, 0.01, 0.015)
    assert tr.px[0] == 103


def test_sold_at_310_otherwise():
    rows = flat_day(100)
    rows["15:10"] = (100.8, 101, 100.5, 100.9)
    rows["15:20"] = (90, 90, 90, 90)  # after 3:10 PM: ignored
    tr, pe = run_one(rows, 0.02, 0.0)
    assert tr.kind[0] == 0 and tr.x[0] == D.EXIT_BAR and tr.px[0] == pytest.approx(100.8 * (1 - D.SLIPPAGE))
    del rows["15:10"]
    rows["15:05"] = (100.2, 100.4, 100.1, 100.3)
    tr, _ = run_one(rows, 0.02, 0.0)
    assert tr.px[0] == pytest.approx(100.3 * (1 - D.SLIPPAGE))  # bar missing: the last price before 3:10


def test_short_exits_mirror_long_ones():
    rows = flat_day(100)
    rows["10:30"] = (100, 101.5, 99.9, 101)
    tr, pe = run_one(rows, 0.01, 0.02, side=-1)
    assert tr.kind[0] == 1 and tr.px[0] == pytest.approx(pe * 1.01 * (1 + D.SLIPPAGE))
    assert tr.gross()[0] < 0
    rows["10:30"] = (100, 100.1, 97.5, 98)
    tr, pe = run_one(rows, 0.01, 0.02, side=-1)
    assert tr.kind[0] == 2 and tr.px[0] == pytest.approx(pe * 0.98) and tr.gross()[0] == pytest.approx(0.02)


def test_entry_bar_stop_uses_the_stop_price_not_the_bars_open():
    # broke above 101 in the 10:00 bar, which had opened lower and also dipped below the stop
    rows = flat_day(100)
    rows["10:00"] = (99.0, 101.5, 98.0, 101)
    ip = make_ip(rows)
    en = D.entries(setup(kind="level"), ip, prev_for(pc=100, ph=101), no_market())
    tr = D.simulate(ip, en, 0.01, 0.0)
    assert tr.kind[0] == 1 and tr.px[0] == pytest.approx(en.pe[0] * 0.99 * (1 - D.SLIPPAGE))


# ---- synthetic market: no look-ahead, money rules, the whole run -----------

def make_world(n_daily=60, n_sessions=36, n_stocks=6, seed=3):
    """Random stocks with gaps, 5-minute bars for the last sessions and official daily bars."""
    rng = np.random.default_rng(seed)
    days = pd.bdate_range("2026-01-05", periods=n_daily)
    symbols = [f"S{k}" for k in range(n_stocks)]
    O = np.full((n_sessions, B, n_stocks), NAN)
    H, L, C = O.copy(), O.copy(), O.copy()
    d_open, d_high, d_low, d_close = (np.full((n_daily, n_stocks), NAN) for _ in range(4))
    first = n_daily - n_sessions
    price = np.full(n_stocks, 500.0)
    for t in range(n_daily):
        gap = rng.choice([0, 0, 0, -0.025, 0.025, -0.012, 0.012], size=n_stocks) + rng.normal(0, 0.003, n_stocks)
        official = price * (1 + gap)
        p = official * (1 + rng.normal(0, 0.002, n_stocks))  # the first trade differs a little from the auction
        bars = []
        for b in range(B):
            o = p
            path = o * np.exp(np.cumsum(rng.normal(0, 0.0025, (4, n_stocks)), axis=0))
            c = path[-1]
            bars.append((o, np.maximum(path.max(0), np.maximum(o, c)), np.minimum(path.min(0), np.minimum(o, c)), c))
            p = c
        hi = np.max([x[1] for x in bars], axis=0)
        lo = np.min([x[2] for x in bars], axis=0)
        d_open[t], d_high[t], d_low[t], d_close[t] = official, np.maximum(hi, official), np.minimum(lo, official), bars[-1][3]
        if t >= first:
            s = t - first
            for b, (o, h, l, c) in enumerate(bars):
                O[s, b], H[s, b], L[s, b], C[s, b] = o, h, l, c
        price = bars[-1][3]
    # a few missing bars
    holes = rng.random(O.shape) < 0.01
    for a in (O, H, L, C):
        a[holes] = NAN
    sess = pd.DatetimeIndex(days[first:])
    ip = D.Intraday(sess, symbols, O, H, L, C, np.ones_like(O))
    daily = D.Daily(pd.DatetimeIndex(days), symbols, d_open, d_high, d_low, d_close, np.full((n_daily, n_stocks), 1e5))
    # the Nifty: the average stock
    nO, nH, nL, nC = (np.nanmean(a, axis=2, keepdims=True) * 40 for a in (O, H, L, C))
    nifty = D.Intraday(sess, ["NIFTY"], nO, nH, nL, nC, np.ones_like(nO))
    nd = D.Daily(pd.DatetimeIndex(days), ["NIFTY"], *(np.nanmean(a, axis=1, keepdims=True) * 40
                                                      for a in (d_open, d_high, d_low, d_close)), np.ones((n_daily, 1)))
    return ip, daily, nifty, nd


def trades_of(ip, daily, nifty, nd, sid, stop, target):
    st = next(s for s in D.all_setups() if s.id == sid)
    prev = D.session_inputs(daily, ip.dates)
    return D.simulate(ip, D.entries(st, ip, prev, D.market_from(nifty, nd, ip.dates)), stop, target)


def as_set(ip, tr, upto=None):
    return {(ip.symbols[s], int(d), int(e), round(float(pe), 6), int(x), round(float(px), 6))
            for s, d, e, pe, x, px in zip(tr.s, tr.d, tr.e, tr.pe, tr.x, tr.px) if upto is None or d < upto}


@pytest.mark.parametrize("sid", ["gapdown_buy_2", "gapup_short_1@mkt", "pdh_nr7", "orb15_long@trend", "pdl_weak"])
def test_no_look_ahead(sid):
    ip, daily, nifty, nd = make_world()
    base = trades_of(ip, daily, nifty, nd, sid, 0.01, 0.02)
    cut = 20
    # scramble every session from `cut` on, in both the 5-minute and the daily prices
    ip2 = D.Intraday(ip.dates, ip.symbols, *(a.copy() for a in (ip.O, ip.H, ip.L, ip.C, ip.V)))
    for a in (ip2.O, ip2.H, ip2.L, ip2.C):
        a[cut:] *= 1.3
    d2 = D.Daily(daily.dates, daily.symbols, *(a.copy() for a in (daily.open, daily.high, daily.low, daily.close, daily.volume)))
    t_cut = daily.dates.get_loc(ip.dates[cut])
    for a in (d2.open, d2.high, d2.low, d2.close):
        a[t_cut:] *= 0.7
    after = trades_of(ip2, d2, nifty, nd, sid, 0.01, 0.02)
    assert as_set(ip, base, cut) == as_set(ip2, after, cut)
    assert len(as_set(ip, base, cut)) > 0, "the synthetic market should produce some trades"


def test_entries_dont_depend_on_later_bars_the_same_day():
    ip, daily, nifty, nd = make_world()
    prev = D.session_inputs(daily, ip.dates)
    mkt = D.market_from(nifty, nd, ip.dates)
    for st in D.all_setups():
        en = D.entries(st, ip, prev, mkt)
        if not len(en.d):
            continue
        ip2 = D.Intraday(ip.dates, ip.symbols, *(a.copy() for a in (ip.O, ip.H, ip.L, ip.C, ip.V)))
        for d, s, e in zip(en.d, en.s, en.e):
            for a in (ip2.O, ip2.H, ip2.L, ip2.C):
                a[d, e + 1:, s] = 1.0  # wreck everything after the entry bar
        en2 = D.entries(st, ip2, prev, mkt)
        assert set(zip(en.d, en.s, en.e, en.pe.round(6))) <= set(zip(en2.d, en2.s, en2.e, en2.pe.round(6))), st.id


def test_quick_stats_count_each_day_once():
    ip, *_ = make_world(n_sessions=6, n_daily=30)
    tr = D.Trades(np.array([0, 0, 0, 3]), np.array([0, 1, 2, 0]), np.array([1, 1, 1, 1]), np.array([71] * 4),
                  np.array([100.0] * 4), np.array([110.0, 90.0, 90.0, 101.0]), np.zeros(4, dtype=int), np.zeros(4), 1)
    qs = D.quick_stats(tr, 1_000_000, 1, {"all": (0, 5)})["all"]
    net = D.net_returns(tr, 1_000_000)[1]
    # day 0: average of its 3 trades on the one slot; day 3: its trade; 4 idle days
    assert qs["est"] == pytest.approx((net[:3].mean() + net[3]) / 6)
    assert qs["n"] == 4 and qs["days"] == 2


def test_day_sim_takes_trades_in_order_with_whole_shares():
    ip, *_ = make_world(n_sessions=3, n_daily=30)
    # day 0: two trades; a Rs 1,000 account with 1 slot takes only the first
    tr = D.Trades(np.array([0, 0, 2]), np.array([0, 1, 2]), np.array([1, 3, 1]), np.array([71, 71, 71]),
                  np.array([100.0, 50.0, 2000.0]), np.array([101.0, 49.0, 2100.0]), np.zeros(3, dtype=int), np.zeros(3), 1)
    run = D.day_sim(tr, ip, 1000, 1, 0, 2)
    sh = float(D.shares_for(1000, 100.0))
    assert run["trades"] == 1 and run["log"][0][0] == ip.symbols[0] and run["log"][0][6] == sh
    assert run["final"] == pytest.approx(1000 + float(D.trade_pnl(sh, 100.0, 101.0, 1)))
    # with 5x margin the Rs 2,000 stock fits on day 2
    assert D.day_sim(tr, ip, 1000, 5, 0, 2)["trades"] == 2


def test_periods_split_the_sessions():
    b = D.periods_for(pd.bdate_range("2026-01-01", periods=248))
    assert b == {"pick1": (0, 81), "pick2": (82, 164), "test": (165, 247)}


def test_skip_days_catch_bad_and_ex_dividend_days():
    ip, daily, *_ = make_world(n_sessions=5, n_daily=30)
    skip = D.skip_days(ip, daily)
    assert not skip.any()
    ip.C[2, :, 1] *= 2  # the 5-minute bars missed a bonus issue that day
    assert D.skip_days(ip, daily)[2, 1]
    # Yahoo's dividend-adjusted prices step against the feed's on an ex-dividend day
    adj = daily.close.copy()
    t = daily.dates.get_loc(ip.dates[3])
    adj[:t, 4] *= 0.97
    panel = S.Panel(daily.dates, daily.symbols, *(pd.DataFrame(adj, index=daily.dates, columns=daily.symbols) for _ in range(5)), {})
    sk = D.skip_days(ip, daily, panel)
    assert sk[3, 4] and sk[:, 4].sum() == 1


def test_watch_list():
    ip, daily, nifty, nd = make_world()
    w = D.watch_list(daily, nd, [("S1", "2099-01-01", "Dividend - Rs 5"), ("S1", "2000-01-01", "old"),
                                 ("ZZZ", "2099-01-01", "not followed")])
    assert w["date"] == str(daily.dates[-1].date())
    lv = w["levels"]["S0"]
    assert lv["pc"] == pytest.approx(daily.close[-1, 0], abs=1e-4) and lv["ph"] == pytest.approx(daily.high[-1, 0], abs=1e-4)
    assert set(w["candidates"]["gapdown_buy_2"]) == set(daily.symbols)  # no day-before condition
    up = [s for j, s in enumerate(daily.symbols) if daily.close[-1, j] > daily.close[-20:, j].mean()]
    assert set(w["candidates"]["orb15_long"]) == set(up)
    assert w["ex_dates"] == {"S1": [["2099-01-01", "Dividend - Rs 5"]]}
    assert set(w["nifty"]) == {"pc", "sma20", "up", "down"}
    assert D.watch_list(daily, nd)["ex_dates"] is None  # NSE didn't answer: unknown, not "none"


def test_run_backtest_end_to_end():
    ip, daily, nifty, nd = make_world(n_sessions=60, n_daily=90, n_stocks=8)
    p = S.Panel(daily.dates, daily.symbols, *(pd.DataFrame(a, index=daily.dates, columns=daily.symbols)
                                              for a in (daily.open, daily.high, daily.low, daily.close, daily.volume)), {})
    res = D.run_backtest(ip, daily, nifty, nd, p, {}, log=lambda *a: None)
    json.dumps(S._round(res), allow_nan=False)
    assert res["combos_tested"] == len(D.all_setups()) * len(D.STOPS) * len(D.TARGETS)
    assert len(res["buckets"]) == len(S.CAPITALS) * len(D.MARGINS)
    for b in res["buckets"]:
        assert b["verdict"] in {"good", "luck", "recent_only", "unproven", "loss", "none"}
        if b["chosen"]:
            ex = next(c for c in b["candidates"] if c["key"] == b["chosen"])["example"]
            assert ex["final"] == pytest.approx(b["capital"] + sum(row[7] for row in ex["log"]))
            if ex["final"] <= b["capital"]:
                assert b["verdict"] == "loss"


# ---- the page's live rules match the engine --------------------------------

NODE = shutil.which("node")
LOGIC = Path(__file__).resolve().parent.parent / "stocks" / "daylogic.js"


@pytest.mark.skipif(NODE is None, reason="needs Node.js")
@pytest.mark.parametrize("seed", [3, 8])
def test_page_rules_match_the_engine(tmp_path, seed):
    ip, daily, nifty, nd = make_world(seed=seed)
    prev = D.session_inputs(daily, ip.dates)
    mkt = D.market_from(nifty, nd, ip.dates)
    to_feed = lambda O, H, L, C, d, j: {k: [None if not np.isfinite(x) else float(x) for x in a[d, :, j]]
                                        for k, a in zip("ohlc", (O, H, L, C))}
    sessions = []
    for d in range(len(ip.dates)):
        sessions.append({
            "bars": {s: to_feed(ip.O, ip.H, ip.L, ip.C, d, j) for j, s in enumerate(ip.symbols)},
            "nifty": to_feed(nifty.O, nifty.H, nifty.L, nifty.C, d, 0),
            "levels": {s: {"pc": float(prev["close"][d, j]), "ph": float(prev["high"][d, j]), "pl": float(prev["low"][d, j]),
                           "turn": float(prev["turnover"][d, j])} for j, s in enumerate(ip.symbols)
                       if np.isfinite(prev["close"][d, j])},
            "open": {s: float(prev["open"][d, j]) for j, s in enumerate(ip.symbols) if np.isfinite(prev["open"][d, j])},
            "trend": {"up": bool(mkt.prev_close[d] > mkt.prev_sma20[d]), "down": bool(mkt.prev_close[d] < mkt.prev_sma20[d])},
        })
    cases, expected = [], {}
    for st in D.all_setups():
        cand = D.pre_condition(st, prev)
        for stop, target in ((0.005, 0.01), (0.02, 0.0), (0.01, 0.03)):
            key = f"{st.id}|{stop}|{target}"
            cases.append({"key": key, "setup": st.spec(), "stop": stop, "target": target,
                          "cands": [[s for j, s in enumerate(ip.symbols) if cand[d, j]] for d in range(len(ip.dates))]})
            tr = D.simulate(ip, D.entries(st, ip, prev, mkt), stop, target)
            run = D.day_sim(tr, ip, 30_000, 2, 0, len(ip.dates) - 1)
            expected[key] = {"trades": sorted([ip.symbols[s], int(d), int(e), round(float(pe), 6), int(x), round(float(px), 6), int(k)]
                                              for s, d, e, pe, x, px, k in zip(tr.s, tr.d, tr.e, tr.pe, tr.x, tr.px, tr.kind)),
                             "final": round(run["final"], 6), "taken": [[r[0], r[1]] for r in run["log"]]}
    fixture = tmp_path / "fixture.json"
    fixture.write_text(json.dumps({"sessions": sessions, "cases": cases, "dates": [str(x.date()) for x in ip.dates]}))
    script = tmp_path / "check.js"
    script.write_text(f"""
const L = require({json.dumps(str(LOGIC))});
const F = require({json.dumps(str(fixture))});
const KIND = {{stop: 1, target: 2, time: 0}};
const out = {{}};
for (const c of F.cases) {{
  const trades = [];
  let equity = 30000;
  const taken = [];
  F.sessions.forEach((S, d) => {{
    const results = [];
    for (const sym of c.cands[d]) {{
      const r = L.evaluate(c.setup, c.stop, c.target, S.bars[sym], S.levels[sym], S.open[sym] ?? null, S.nifty, S.trend, true);
      if (r.e != null && r.e >= 0) {{
        trades.push([sym, d, r.e, +r.pe.toFixed(6), r.x, +r.px.toFixed(6), KIND[r.state]]);
        results.push({{ ...r, sym }});
      }}
    }}
    const day = L.takeTrades(results, S.levels, equity * 2);
    for (const t of day.taken) {{
      equity += L.tradePnl(t.shares, t.pe, t.px, t.side);
      taken.push([t.sym, F.dates[d]]);
    }}
  }});
  trades.sort((a, z) => (a[0] < z[0] ? -1 : a[0] > z[0] ? 1 : 0) || a[1] - z[1] || a[2] - z[2]);
  out[c.key] = {{ trades, final: +equity.toFixed(6), taken }};
}}
console.log(JSON.stringify(out));
""")
    got = json.loads(subprocess.run([NODE, str(script)], capture_output=True, text=True, check=True).stdout)
    n_trades = 0
    for key, want in expected.items():
        g = got[key]
        assert len(g["trades"]) == len(want["trades"]), key
        for a, b in zip(sorted(g["trades"], key=lambda r: (r[0], r[1], r[2])), sorted(want["trades"], key=lambda r: (r[0], r[1], r[2]))):
            assert a[:3] == b[:3] and a[4] == b[4] and a[6] == b[6], (key, a, b)
            assert a[3] == pytest.approx(b[3], abs=1e-5) and a[5] == pytest.approx(b[5], abs=1e-5), (key, a, b)
        assert g["taken"] == want["taken"], key
        assert g["final"] == pytest.approx(want["final"], abs=1e-4), key
        n_trades += len(want["trades"])
    assert n_trades > 500


@pytest.mark.skipif(NODE is None, reason="needs Node.js")
def test_page_charges_match_the_engine(tmp_path):
    values = [1, 99, 100, 999, 1000, 4999, 5000, 19999, 20000, 123456.78]
    script = tmp_path / "c.js"
    script.write_text(f"const L = require({json.dumps(str(LOGIC))});"
                      f"console.log(JSON.stringify({json.dumps(values)}.map(v => [L.buyCharges(v), L.sellCharges(v), L.sharesFor(v, 97.3)])));")
    got = json.loads(subprocess.run([NODE, str(script)], capture_output=True, text=True, check=True).stdout)
    for v, (b, s, sh) in zip(values, got):
        assert b == pytest.approx(float(D.buy_charges(v)), abs=1e-9)
        assert s == pytest.approx(float(D.sell_charges(v)), abs=1e-9)
        assert sh == float(D.shares_for(v, 97.3))
