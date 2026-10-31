"""Tests for the tool's own track record. Run: python -m pytest screener -q"""
import json

import pandas as pd
import pytest

import screener as S
import track as T


def panel(rows, start="2026-11-02"):
    """rows: {symbol: [(open, high, low, close), ...]} -> Panel on business days."""
    syms = sorted(rows)
    n = len(next(iter(rows.values())))
    dates = pd.bdate_range(start, periods=n)
    arr = {f: pd.DataFrame({s: [r[i] for r in rows[s]] for s in syms}, index=dates) for i, f in enumerate("OHLC")}
    return S.Panel(dates, syms, arr["O"], arr["H"], arr["L"], arr["C"], arr["C"] * 0 + 1e5, {})


def flat(price, n):
    return [(price, price, price, price)] * n


def test_picks_are_bought_next_open_and_sold_at_the_target():
    rows = {"AAA": flat(100, 2) + [(100, 101, 99, 100), (100, 111, 100, 110)] + flat(110, 2)}
    p = panel(rows)
    picks = {str(p.dates[1].date()): {"1000": [["AAA", "x", "10|5|20"]]}}
    r = T.follow(picks, p, 1000, None)
    assert r["start"] == str(p.dates[2].date())
    (sym, bought, bp, sold, sp, sh, pnl, kind, rule), = r["closed"]
    assert (sym, bought, bp, sold, kind, rule) == ("AAA", str(p.dates[2].date()), 100, str(p.dates[3].date()), 2, "10|5|20")
    assert sp == pytest.approx(110) and sh == float(S.affordable_shares(1000, 100))
    assert r["final"] == pytest.approx(1000 + pnl) and r["win_rate"] == 1 and r["open"] == []


def test_nothing_to_show_before_the_first_buy():
    p = panel({"AAA": flat(100, 3)})
    assert T.follow({str(p.dates[-1].date()): {"1000": [["AAA", "x", "10|5|20"]]}}, p, 1000, None) is None
    assert T.follow({}, p, 1000, None) is None


def test_busy_slot_skips_new_picks_and_last_day_picks_wait():
    rows = {"AAA": flat(100, 8), "BBB": flat(50, 8)}
    p = panel(rows)
    d = [str(x.date()) for x in p.dates]
    picks = {d[0]: {"1000": [["AAA", "x", "20|10|40"]]},   # bought on day 1, still open
             d[2]: {"1000": [["BBB", "x", "20|10|40"]]},   # no free slot (1 slot at Rs 1,000)
             d[7]: {"1000": [["BBB", "x", "20|10|40"]]}}   # signal on the last day: bought tomorrow
    r = T.follow(picks, p, 1000, None)
    assert [x[0] for x in r["open"]] == ["AAA"] and r["trades"] == 0


def test_todays_picks_follow_the_page_order():
    bt = {"buckets": [{"capital": 1000, "slots": 1, "chosen": "p1|0|20|120"}],
          "pattern_rules": {
              "p1": {"1000": {"rule": "0|20|120", "steady": 0.01, "ends": {"target": 0, "stop": 0.5, "time": 0.5}}},
              "p2": {"1000": {"rule": "8|4|20", "steady": 0.05, "ends": {"target": 0.5, "stop": 0.3, "time": 0.2}}},
              "p3": {"1000": {"rule": "5|4|10", "steady": 0.09, "ends": None}}}}
    today = {"signals": {"p2": [{"s": "BBB"}, {"s": "CCC"}], "p1": [{"s": "AAA"}], "p3": [{"s": "DDD"}]},
             "stocks": {"AAA": {"close": 500, "m": 0.1}, "BBB": {"close": 100, "m": 0.2}, "CCC": {"close": 100, "m": 0.5},
                        "DDD": {"close": 10, "m": 0.9}}}
    picks = T.todays_picks(today, bt, 1000)
    # the plan's own pattern first; p3 has no past trades to judge; then by 6-month strength
    assert picks == [["AAA", "p1", "0|20|120"], ["CCC", "p2", "8|4|20"]]


def test_update_saves_each_day_once(tmp_path):
    rows = {"AAA": flat(100, 5)}
    p = panel(rows)
    bt = {"buckets": [{"capital": 1000, "slots": 1, "chosen": "p1|0|20|120"}],
          "pattern_rules": {"p1": {"1000": {"rule": "0|20|120", "steady": 0.01, "ends": {"target": 0, "stop": 0, "time": 1}}}}}
    today = {"data_date": str(p.dates[-1].date()), "signals": {"p1": [{"s": "AAA"}]}, "stocks": {"AAA": {"close": 100, "m": 0}}}
    path = tmp_path / "track.json"
    t1 = T.update(path, today, bt, p, None)
    path.write_text(json.dumps(t1))
    today2 = {**today, "signals": {}}
    t2 = T.update(path, today2, bt, p, None)
    assert t2["picks"] == t1["picks"] and t2["since"] == str(p.dates[-1].date())
    json.dumps(S._round(t2), allow_nan=False)
