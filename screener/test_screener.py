"""Tests for the screener. Run: python -m pytest screener -q"""
import datetime as dt
import json

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


def run_trailing(rows, trail=0.10, hold=20):
    O, H, L, C = bars(rows)
    tr = S.simulate_exits(np.array([0]), np.array([0]), O[[0], 0], np.array([0.0]), O, H, L, C,
                          targets=(), stops=(), holds=(), trails=(trail,), trail_holds=(hold,))[(0.0, trail, hold)]
    return tr.kind[0], int(tr.x[0]), float(tr.px[0]), bool(tr.complete[0])


def test_trailing_stop_follows_highest_close():
    rows = [(100, 101, 99, 100), (100, 111, 100, 110), (110, 121, 109, 120), (120, 131, 119, 130),
            (130, 131, 120, 125), (125, 126, 116, 118), (118, 119, 117, 118)]
    # stop moves up to 130 * 0.9 = 117 after the 130 close; day 5's low of 116 hits it
    assert run_trailing(rows) == (1, 5, pytest.approx(117), True)


def test_trailing_stop_starts_below_buy_price():
    rows = [(100, 101, 89, 95)] + [(95, 96, 94, 95)] * 5
    assert run_trailing(rows)[:3] == (1, 0, pytest.approx(90))


def test_trailing_stop_gap_down_fills_at_open():
    rows = [(100, 101, 99, 100), (100, 121, 100, 120), (100, 101, 98, 99)] + [(99, 100, 98, 99)] * 3
    assert run_trailing(rows)[:3] == (1, 2, pytest.approx(100))  # stop was 108


def test_trailing_time_exit():
    rows = [(100, 101, 99, 100 + i) for i in range(5)]
    assert run_trailing(rows, hold=5) == (0, 4, pytest.approx(104), True)


def test_month_ends_come_from_the_calendar():
    dates = pd.bdate_range("2024-01-26", "2024-03-05")
    ends = [str(d.date()) for d in dates[S.month_ends(dates)]]
    assert ends == ["2024-01-31", "2024-02-29"]


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


# ---- market mood filters --------------------------------------------------------

def market_frames(p, n_days=400):
    idx = pd.bdate_range("2018-06-01", periods=n_days + 250)
    up = pd.DataFrame({"Close": np.linspace(100, 200, len(idx))}, index=idx)
    return {"nifty": up, "world": up.copy(), "vix": pd.DataFrame({"Close": 15.0}, index=idx)}


def test_us_filter_uses_previous_us_session():
    p = S.build_panel(make_frames(), now=dt.datetime(2030, 1, 1, tzinfo=S.IST))
    market = market_frames(p)
    day = p.dates[300]
    close = market["world"]["Close"].copy()
    close[close.index >= day] = 1.0  # US crashes on the same calendar day
    market["world"] = close.to_frame()
    world = S.market_filters(p, market)["world"][2]
    assert world.loc[p.dates[299]] and world.loc[day]  # India closes before the US crash is known
    assert not world.loc[p.dates[301]]


def test_market_filters_use_only_past_data():
    p = S.build_panel(make_frames(), now=dt.datetime(2030, 1, 1, tzinfo=S.IST))
    rng = np.random.default_rng(3)
    idx = pd.bdate_range("2018-01-01", periods=900)
    walk = lambda: pd.DataFrame({"Close": 100 * np.exp(np.cumsum(rng.normal(0, 0.02, len(idx))))}, index=idx)
    market = {"nifty": walk(), "world": walk(), "vix": pd.DataFrame({"Close": rng.uniform(10, 30, len(idx))}, index=idx)}
    full = S.market_filters(p, market)
    cut = p.dates[250]
    part = S.market_filters(p, {k: v[v.index <= cut] for k, v in market.items()})
    for fid in full:
        assert full[fid][2].loc[:cut].equals(part[fid][2].loc[:cut]), fid


def test_filtered_pattern_is_subset_of_plain_pattern():
    p = S.build_panel(make_frames(), now=dt.datetime(2030, 1, 1, tzinfo=S.IST))
    market = market_frames(p)
    market["vix"] = pd.DataFrame({"Close": 35.0}, index=market["vix"].index)  # never calm
    signals = S.pattern_signals(p)
    allv = dict((v.id, (v, s)) for v, s in S.with_market_filters(signals, S.market_filters(p, market)))
    assert len(allv) == len(signals) * 4
    for v, sig in signals:
        assert not allv[f"{v.id}@calm"][1].to_numpy().any()
        for fid in ("nifty", "world"):
            fv, fsig = allv[f"{v.id}@{fid}"]
            assert fv.filter == fid and not (fsig.to_numpy() & ~sig.to_numpy()).any()


def test_mood_shows_the_us_close_the_filter_uses():
    p = S.build_panel(make_frames(), now=dt.datetime(2030, 1, 1, tzinfo=S.IST))
    market = market_frames(p)
    last = p.dates[-1]
    market["world"] = market["world"][market["world"].index <= last]  # US bar for today is still forming
    mood = S.market_mood(market, S.market_filters(p, market), last)
    assert mood["world"]["date"] < str(last.date()) <= mood["nifty"]["date"]


def test_today_payload_reports_last_signal_and_mood():
    p = S.build_panel(make_frames(), now=dt.datetime(2030, 1, 1, tzinfo=S.IST))
    sig = pd.DataFrame(False, index=p.dates, columns=p.symbols)
    sig.iloc[120, 1] = sig.iloc[250, 4] = True
    v = S.Variant("x", "fam", "X", "desc")
    market = market_frames(p)
    filters = S.market_filters(p, market)
    universe = pd.DataFrame({"Symbol": p.symbols, "Name": p.symbols, "Industry": ""})
    out = S.today_payload(p, [(v, sig)], universe, S.market_mood(market, filters), {"S4": {"pe": 20.0}})
    assert out["signals"]["x"] == []
    assert out["last_signal"]["x"]["date"] == str(p.dates[250].date())
    assert [r["s"] for r in out["last_signal"]["x"]["stocks"]] == ["S4"]
    assert out["market"]["nifty"]["up"] and out["market"]["vix"]["calm"] and out["fundamentals"]["S4"]["pe"] == 20


def test_backup_run_with_no_new_prices_is_a_no_op(tmp_path):
    p = S.build_panel(make_frames(), now=dt.datetime(2030, 1, 1, tzinfo=S.IST))
    universe = pd.DataFrame({"Symbol": p.symbols, "Name": p.symbols, "Industry": ""})
    signals = S.pattern_signals(p)
    first = S.today_payload(p, signals, universe, {}, {"S1": {"pe": 10.0}})
    S.write_json(tmp_path / "t.json", first)
    saved = json.loads((tmp_path / "t.json").read_text())
    again = S.today_payload(p, signals, universe, {}, {"S1": {"pe": 11.0}})  # later run, new timestamp
    assert S.same_prices(saved, again)
    wobble = json.loads(json.dumps(saved))
    first_stock = next(iter(wobble["stocks"].values()))
    first_stock["bars"][0][0] += 0.0001  # an old adjusted price, 4th decimal
    assert S.same_prices(wobble, again)
    newer = S.today_payload(S.slice_panel(p, len(p.dates) - 1), S.pattern_signals(S.slice_panel(p, len(p.dates) - 1)),
                            universe, {}, {})
    assert not S.same_prices(saved, newer)


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


def test_last_pick_is_kept_unless_clearly_beaten(monkeypatch):
    monkeypatch.setattr(S, "PERIODS", [("train", "2019-01-01", "2019-12-31"),
                                       ("validate", "2020-01-01", "2020-06-30"),
                                       ("test", "2020-07-01", None)])
    monkeypatch.setattr(S, "MIN_TRAIN_TRADES", 1)
    monkeypatch.setattr(S, "CAPITALS", [10000])
    monkeypatch.setattr(S, "RANDOM_RUNS", 2)
    frames = make_frames(n_days=500, n_stocks=8)
    p = S.build_panel(frames, now=dt.datetime(2030, 1, 1, tzinfo=S.IST))
    signals = S.pattern_signals(p)
    quiet = lambda *_: None
    first = S.run_backtest(p, signals, None, log=quiet)["buckets"][0]
    assert first["chosen"] == first["candidates"][0]["key"]  # steadiest first
    # a weaker candidate from the same pool stays when the margin is huge...
    pool = [c for c in first["candidates"]
            if first["passed_train_and_validate"] == 0 or (c["train_est"] > 0 and c["validate_est"] > 0)]
    assert len(pool) >= 2
    other = pool[-1]["key"]
    monkeypatch.setattr(S, "SWITCH_MARGIN", 100.0)
    kept = S.run_backtest(p, signals, None, log=quiet, previous={10000: other})["buckets"][0]
    assert kept["chosen"] == other and kept["kept_previous"]
    # ...and is replaced when there is no margin
    monkeypatch.setattr(S, "SWITCH_MARGIN", -100.0)
    replaced = S.run_backtest(p, signals, None, log=quiet, previous={10000: other})["buckets"][0]
    assert replaced["chosen"] == first["chosen"] and not replaced["kept_previous"]


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
    assert bt["combos_tested"] == len(signals) * (len(S.TARGETS) * len(S.STOPS) * len(S.HOLDS)
                                                 + len(S.TRAILS) * len(S.TRAIL_HOLDS))
    assert bt["pattern_rules"], "the daily list needs each pattern's rule"
    for vid, by_cap in bt["pattern_rules"].items():
        for cap, r in by_cap.items():
            assert f"{vid}|{r['rule']}" in {f"{v.id}|{k}" for v in [x for x, _ in signals]
                                            for k in [f"{round(a*100)}|{round(b*100)}|{c}"
                                                      for a in S.TARGETS for b in S.STOPS for c in S.HOLDS]
                                            + [f"0|{round(b*100)}|{c}" for b in S.TRAILS for c in S.TRAIL_HOLDS]}
            if r["ends"]:
                assert abs(sum(r["ends"].values()) - 1) < 1e-9
            if r["target_days"]:
                lo, mid, hi = r["target_days"]
                assert 1 <= lo <= mid <= hi <= max(S.HOLDS + S.TRAIL_HOLDS)
    assert len(bt["buckets"]) == len(S.CAPITALS)
