"""Tests for the screener. Run: python -m pytest screener -q"""
import datetime as dt

import numpy as np
import pandas as pd
import pytest

import screener as S


def make_frames(n_days=400, n_stocks=6, seed=1):
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2019-01-01", periods=n_days)
    frames = {}
    for k in range(n_stocks):
        close = 100 * np.exp(np.cumsum(rng.normal(0.0005, 0.02, n_days)))
        open_ = close * np.exp(rng.normal(0, 0.005, n_days))
        high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.02, n_days))
        low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.02, n_days))
        vol = rng.uniform(1e5, 5e5, n_days)
        frames[f"S{k}"] = pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close,
                                        "Volume": vol}, index=dates)
    return frames


def bars(rows):
    """rows of (open, high, low, close) for one stock -> O, H, L, C arrays (T x 1)."""
    a = np.array(rows, dtype=float)
    return tuple(a[:, i:i + 1] for i in range(4))


# ---- charges ---------------------------------------------------------------

def test_round_trip_charges_on_1000():
    # brokerage 5+5, STT 1+1, stamp 0.15, NSE/SEBI/IPFT ~0.06, DP 20, GST 18% on brokerage+fees+DP
    buy, sell = float(S.buy_charges(1000)), float(S.sell_charges(1000))
    fees = 2 * 1000 * (0.0000297 + 0.000002)
    expected = 10 + 2 + 0.15 + 20 + fees + 0.18 * (10 + 20 + fees)
    assert buy + sell == pytest.approx(expected, abs=0.01)
    assert 37 < buy + sell < 38  # about 3.8% of Rs 1,000


def test_brokerage_caps():
    assert float(S._brokerage(100_000)) == 20  # 0.1% would be 100
    assert float(S._brokerage(10_000)) == 10   # 0.1%
    assert float(S._brokerage(1_000)) == 5     # minimum
    assert float(S._brokerage(100)) == 2.5     # SEBI 2.5% cap beats the minimum


def test_small_sale_has_lower_dp_charge():
    assert float(S.sell_charges(99)) < float(S.sell_charges(100)) - 15


def test_affordable_shares_never_overspend():
    budgets = np.array([1000, 1000, 5000, 999.0, 250_000])
    prices = np.array([990, 330, 4999, 1200, 13.7])
    shares = S.affordable_shares(budgets, prices)
    spend = shares * prices + S.buy_charges(shares * prices)
    assert np.all(spend <= budgets + 1e-9)
    assert list(shares[:4]) == [1, 3, 0, 0]
    assert S.affordable_shares(1000, np.nan) == 0


# ---- exits -----------------------------------------------------------------

def run_exit(rows, target=0.10, stop=0.05, hold=5):
    O, H, L, C = bars(rows)
    tr = S.simulate_exits(np.array([0]), np.array([0]), O[[0], 0], np.array([0.0]), O, H, L, C,
                          targets=(target,), stops=(stop,), holds=(hold,))[(target, stop, hold)]
    return tr.kind[0], int(tr.x[0]), float(tr.px[0]), bool(tr.complete[0])


def test_target_hit():
    kind, x, px, done = run_exit([(100, 102, 99, 101), (101, 111, 100, 110), (110, 112, 108, 111),
                                  (111, 112, 110, 111), (111, 112, 110, 111)])
    assert (kind, x, px, done) == (2, 1, pytest.approx(110), True)


def test_stop_hit():
    kind, x, px, _ = run_exit([(100, 101, 96, 97), (97, 98, 94, 95), (95, 96, 94, 95),
                               (95, 96, 94, 95), (95, 96, 94, 95)])
    assert (kind, x, px) == (1, 1, pytest.approx(95))


def test_gap_down_fills_at_open():
    kind, x, px, _ = run_exit([(100, 101, 99, 100), (90, 92, 89, 91), (91, 92, 90, 91),
                               (91, 92, 90, 91), (91, 92, 90, 91)])
    assert (kind, px) == (1, pytest.approx(90))  # worse than the 95 stop


def test_gap_up_fills_at_open():
    kind, x, px, _ = run_exit([(100, 101, 99, 100), (115, 116, 114, 115), (115, 116, 114, 115),
                               (115, 116, 114, 115), (115, 116, 114, 115)])
    assert (kind, px) == (2, pytest.approx(115))


def test_both_levels_same_day_counts_as_stop():
    kind, _, px, _ = run_exit([(100, 111, 94, 100), (100, 101, 99, 100), (100, 101, 99, 100),
                               (100, 101, 99, 100), (100, 101, 99, 100)])
    assert (kind, px) == (1, pytest.approx(95))


def test_time_exit_at_close():
    rows = [(100, 101, 99, 100)] * 4 + [(100, 101, 99, 103)]
    assert run_exit(rows) == (0, 4, pytest.approx(103), True)


def test_trade_running_past_data_end_is_incomplete():
    rows = [(100, 101, 99, 100)] * 3
    assert run_exit(rows)[3] is False


# ---- data cleaning ---------------------------------------------------------

def test_bonus_issue_gap_is_adjusted():
    idx = pd.bdate_range("2025-12-25", periods=6)
    close = [4200, 4210, 4272.69, 2860, 2935, 2948]
    open_ = [4190, 4200, 4218, 2848.46, 2862, 2935]
    df = pd.DataFrame({"Open": open_, "High": np.array(close) * 1.01, "Low": np.array(close) * 0.99,
                       "Close": close, "Volume": 1e5}, index=idx)
    fixed, fixes = S.fix_corporate_actions(df)
    assert len(fixes) == 1 and fixes[0]["factor"] == pytest.approx(2 / 3, abs=1e-3)
    assert fixed["Close"].iloc[2] == pytest.approx(2848.46)
    assert (fixed["Close"].pct_change().abs().dropna() < 0.05).all()


def test_real_news_move_is_kept():
    idx = pd.bdate_range("2017-10-20", periods=4)
    df = pd.DataFrame({"Open": [116.9, 118.6, 137.1, 191.2], "High": [119, 128, 186, 209],
                       "Low": [116, 118, 137, 181], "Close": [118.1, 124.6, 182.2, 192.6],
                       "Volume": 1e6}, index=idx)
    fixed, fixes = S.fix_corporate_actions(df)
    assert fixes == [] and fixed.equals(df)


def test_bad_open_print_is_repaired():
    idx = pd.bdate_range("2015-06-01", periods=3)
    raw = pd.DataFrame({"Open": [102.3, 92.1, 294.2], "High": [104.2, 94.3, 294.2],
                        "Low": [90.6, 89.7, 54.6], "Close": [91.4, 92.0, 56.3],
                        "Volume": 1e6}, index=idx)
    df = S._clean(raw)
    assert df["Open"].iloc[2] == pytest.approx(56.3)
    assert df["High"].iloc[2] < 60


def test_missing_recent_bars_filled_from_bhavcopy():
    frames = make_frames(n_days=20, n_stocks=3)
    last = frames["S0"].index[-1]
    frames["S1"] = frames["S1"].iloc[:-1]  # Yahoo left the last day blank
    bhav = pd.DataFrame({"Open": [50.0], "High": [52.0], "Low": [49.0], "Close": [51.0], "Volume": [1e5]},
                        index=pd.Index(["S1"], name="TckrSymb"))
    asked = []

    def fake_fetch(day):
        asked.append(day)
        return bhav if day == last.date() else None

    sunday = dt.datetime.combine(last.date() + dt.timedelta(days=(6 - last.weekday())), dt.time(10), tzinfo=S.IST)
    filled = S.fill_recent_gaps(frames, now=sunday, fetch=fake_fetch)
    assert filled == [f"S1 {last.date()}"]
    assert asked == [last.date()]
    assert frames["S1"].index[-1] == last and frames["S1"]["Close"].iloc[-1] == 51.0


def test_forming_bar_dropped_during_market_hours():
    frames = make_frames(n_days=30)
    last = frames["S0"].index[-1]
    during = dt.datetime.combine(last.date(), dt.time(11, 0), tzinfo=S.IST)
    after = dt.datetime.combine(last.date(), dt.time(18, 0), tzinfo=S.IST)
    assert S.build_panel(frames, now=during).dates[-1] < last
    assert S.build_panel(frames, now=after).dates[-1] == last


# ---- no look-ahead -----------------------------------------------------------

def test_signals_use_only_past_data():
    p = S.build_panel(make_frames(), now=dt.datetime(2030, 1, 1, tzinfo=S.IST))
    full = S.pattern_signals(p)
    for cut in (250, 320, 399):
        part = S.pattern_signals(S.slice_panel(p, cut))
        for (v, sig_full), (_, sig_part) in zip(full, part):
            assert sig_full.iloc[cut - 1].equals(sig_part.iloc[cut - 1]), (v.id, cut)


def test_entry_is_next_day_open():
    p = S.build_panel(make_frames(), now=dt.datetime(2030, 1, 1, tzinfo=S.IST))
    sig = pd.DataFrame(False, index=p.dates, columns=p.symbols)
    sig.iloc[100, 2] = True
    sig.iloc[-1, 3] = True  # today's signal: no trade yet
    O = p.O.to_numpy()
    n, e, pe, _ = S.entry_points(sig, O, S.momentum_score(p))
    assert list(n) == [2] and list(e) == [101] and pe[0] == O[101, 2]


# ---- portfolio rules -----------------------------------------------------------

def synthetic_trades(rows):
    """rows of (stock, entry_row, exit_row, entry_px, exit_px, score)."""
    a = np.array(rows, dtype=float)
    k = len(rows)
    return S.Trades(a[:, 0].astype(int), a[:, 1].astype(int), a[:, 2].astype(int), a[:, 3], a[:, 4],
                    np.full(k, 2), np.ones(k, bool), a[:, 5])


def test_portfolio_one_slot_takes_strongest_signal_and_waits_for_cash():
    dates = pd.bdate_range("2024-01-01", periods=30)
    Cf = np.full((30, 3), 100.0)
    tr = synthetic_trades([
        (0, 1, 5, 100, 110, 0.5),
        (1, 1, 5, 100, 110, 0.9),   # same day, stronger: taken
        (0, 3, 8, 100, 120, 0.9),   # slot busy: skipped
        (2, 6, 10, 500, 520, 0.1),  # after the first exit: 2 shares fit
    ])
    res = S.portfolio_sim(tr, 1000, 1, 0, 29, Cf, dates)
    bc, sc = (lambda v: float(S.buy_charges(v))), (lambda v: float(S.sell_charges(v)))
    cash = 1000 - 900 - bc(900) + 990 - sc(990)
    cash = cash - 1000 - bc(1000) + 1040 - sc(1040)
    assert res["trades"] == 2
    assert res["final"] == pytest.approx(cash)
    assert res["charges"] == pytest.approx(bc(900) + sc(990) + bc(1000) + sc(1040))


def test_portfolio_never_holds_same_stock_twice():
    dates = pd.bdate_range("2024-01-01", periods=30)
    Cf = np.full((30, 2), 100.0)
    tr = synthetic_trades([
        (0, 1, 9, 100, 100, 0.5),
        (0, 3, 8, 100, 120, 0.9),   # stock 0 already held, slot free: still skipped
        (1, 4, 8, 100, 100, 0.1),   # different stock: taken
    ])
    res = S.portfolio_sim(tr, 20000, 2, 0, 29, Cf, dates)
    assert res["trades"] == 2
    assert res["final"] < 20000  # both trades were flat, so only charges


def test_unaffordable_stock_is_skipped():
    dates = pd.bdate_range("2024-01-01", periods=10)
    Cf = np.full((10, 1), 1500.0)
    tr = synthetic_trades([(0, 1, 5, 1500, 1600, 1.0)])
    res = S.portfolio_sim(tr, 1000, 1, 0, 9, Cf, dates)
    assert res["trades"] == 0 and res["final"] == 1000


def test_open_trade_is_valued_at_period_end():
    dates = pd.bdate_range("2024-01-01", periods=10)
    Cf = np.full((10, 1), 120.0)
    tr = synthetic_trades([(0, 2, 50, 100, 200, 1.0)])  # would exit after the period
    res = S.portfolio_sim(tr, 1000, 1, 0, 9, Cf, dates)
    shares = 9
    expected = 1000 - (900 + float(S.buy_charges(900))) + shares * 120 - float(S.sell_charges(shares * 120))
    assert res["final"] == pytest.approx(expected)


def test_full_backtest_on_synthetic_data_has_no_nan_in_json(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "PERIODS", [("train", "2019-01-01", "2019-12-31"),
                                       ("validate", "2020-01-01", "2020-06-30"),
                                       ("test", "2020-07-01", None)])
    monkeypatch.setattr(S, "MIN_TRAIN_TRADES", 1)
    frames = make_frames(n_days=500, n_stocks=8)
    p = S.build_panel(frames, now=dt.datetime(2030, 1, 1, tzinfo=S.IST))
    signals = S.pattern_signals(p)
    bt = S.run_backtest(p, signals, frames["S0"], log=lambda *_: None)
    universe = pd.DataFrame({"Symbol": p.symbols, "Name": p.symbols, "Industry": ""})
    S.write_json(tmp_path / "b.json", bt)
    S.write_json(tmp_path / "t.json", S.today_payload(p, signals, universe))
    assert bt["combos_tested"] == len(signals) * len(S.TARGETS) * len(S.STOPS) * len(S.HOLDS)
    assert len(bt["buckets"]) == len(S.CAPITALS)
