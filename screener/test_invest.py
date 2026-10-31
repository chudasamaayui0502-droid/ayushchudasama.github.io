"""Tests for long-term investing. Run: python -m pytest screener -q"""

import numpy as np
import pandas as pd
import pytest

import invest as I
import screener as S


def world(n_days=900, n_stocks=12, seed=5, start="2017-01-02"):
    """Random stocks with different drifts, so momentum has something to find."""
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range(start, periods=n_days)
    drift = np.linspace(-0.001, 0.0015, n_stocks)
    close = 100 * np.exp(np.cumsum(rng.normal(drift, 0.015, (n_days, n_stocks)), axis=0))
    open_ = close * np.exp(rng.normal(0, 0.003, close.shape))
    syms = [f"S{k}" for k in range(n_stocks)]
    df = lambda a: pd.DataFrame(a, index=dates, columns=syms)
    vol = df(rng.uniform(1e5, 2e5, close.shape))
    p = S.Panel(dates, syms, df(open_), df(np.maximum(open_, close) * 1.01), df(np.minimum(open_, close) * 0.99), df(close), vol, {})
    nifty = pd.DataFrame({"Close": close.mean(axis=1) * 100}, index=dates)
    bench = pd.DataFrame({"Open": open_.mean(axis=1), "Close": close.mean(axis=1)}, index=dates)
    return p, {"nifty": nifty}, bench


def all_eligible(p):
    return pd.DataFrame(True, index=p.dates, columns=p.symbols)


def test_monthly_swaps_keep_n_equal_slots():
    p, market, _ = world()
    A = I.arrays(p, market, all_eligible(p))
    v = (3, 126, 0, 3, False, False)
    run = I.simulate(A, v, 1_000_000, 200, len(p.dates) - 1)
    month_starts = {d for d, _, _ in run["log"]}
    assert all(A.month_end[d - 1] for d in month_starts)  # trades only right after a month-end
    assert len(run["hold"]) == 3
    # with no buffer, the holdings after the last swap are the top 3 at that month-end
    last_decision = max(month_starts) - 1
    assert set(run["hold"]) == set(I.ranking(A, v, last_decision)[:3])
    assert run["charges"] > 0 and run["final"] > 0


def test_buffer_keeps_a_stock_that_slipped_a_little():
    p, market, _ = world()
    A = I.arrays(p, market, all_eligible(p))
    tight = I.simulate(A, (3, 126, 0, 3, False, False), 1_000_000, 200, len(p.dates) - 1)
    loose = I.simulate(A, (3, 126, 0, 6, False, False), 1_000_000, 200, len(p.dates) - 1)
    assert loose["trades"] < tight["trades"]


def test_market_filter_sells_everything_in_a_falling_market():
    p, market, _ = world()
    A = I.arrays(p, market, all_eligible(p))
    A.market_up = np.zeros(len(p.dates), dtype=bool)
    run = I.simulate(A, (3, 126, 0, 3, True, False), 100_000, 200, len(p.dates) - 1)
    assert run["hold"] == {} and run["trades"] == 0 and run["final"] == 100_000


def test_only_stocks_on_the_list_are_bought():
    p, market, _ = world()
    el = all_eligible(p)
    el.loc[:, ["S11", "S10"]] = False  # the two strongest drifters are never on the list
    A = I.arrays(p, market, el)
    run = I.simulate(A, (3, 126, 0, 3, False, False), 1_000_000, 200, len(p.dates) - 1)
    bought = {p.symbols[k] for _, _, b in run["log"] for k in b}
    assert bought and not bought & {"S11", "S10"}


def test_picks_use_only_prices_before_january():
    p, market, bench = world(n_days=1500, start="2015-01-01")
    A = I.arrays(p, market, all_eligible(p))
    year = 2019
    a = I.pick(A, 100_000, year, "2015-01-01")
    cut = p.dates.searchsorted(pd.Timestamp(f"{year}-01-01"))
    p2 = S.Panel(p.dates, p.symbols, *(df.copy() for df in (p.O, p.H, p.L, p.C, p.V)), {})
    for df in (p2.O, p2.H, p2.L, p2.C):
        df.iloc[cut:] *= np.linspace(1, 4, len(df) - cut)[:, None] ** np.arange(1, len(p.symbols) + 1)[None, :] ** 0.2
    b = I.pick(I.arrays(p2, market, all_eligible(p2)), 100_000, year, "2015-01-01")
    assert a[1] == b[1]


def test_walk_forward_chains_the_years(monkeypatch):
    monkeypatch.setattr(I, "FIRST_YEAR", 2018)
    monkeypatch.setattr(I, "CHECK_YEARS", 1)
    monkeypatch.setattr(I, "GRID", I.GRID[:6])
    p, market, bench = world(n_days=1600, start="2015-01-01")
    A = I.arrays(p, market, all_eligible(p))
    w = I.walk_forward(A, bench, 100_000, "2015-01-01", log=lambda *a: None)
    assert [y["year"] for y in w["years"]] == list(range(2018, p.dates[-1].year + 1))
    assert w["years"][0]["start_value"] == 100_000
    for a, b in zip(w["years"], w["years"][1:]):
        assert b["start_value"] == a["end_value"] and b["etf_start"] == a["etf_end"]
    assert w["etf"]["final"] == pytest.approx(S.buy_and_hold(bench.reindex(p.dates)["Open"].to_numpy(), bench.reindex(p.dates)["Close"].to_numpy(), 100_000, p.dates.searchsorted(pd.Timestamp("2018-01-01")), len(p.dates) - 1, p.dates)["final"])
    assert w["final"] == w["years"][-1]["end_value"] and w["etf"]["final"] == w["years"][-1]["etf_end"]


def test_current_list_follows_the_rules():
    p, market, _ = world()
    A = I.arrays(p, market, all_eligible(p))
    v = (4, 126, 0, 4, False, False)
    lst = I.current_list(A, v, {s: s for s in p.symbols})
    decide = p.dates.get_loc(pd.Timestamp(lst["as_of"]))
    assert {x["s"] for x in lst["hold"]} == {p.symbols[k] for k in I.ranking(A, v, decide)[:4]}
    assert {x["s"] for x in lst["buy"]} == {x["s"] for x in lst["hold"]} - set(lst["previous"])
    assert {x["s"] for x in lst["sell"]} == set(lst["previous"]) - {x["s"] for x in lst["hold"]}
    # mid-month: the list is from the last finished month
    assert A.month_end[decide] and p.dates[decide] <= p.dates[-1]


def test_sip_buys_whole_units_with_charges():
    series = {"months": [["2020-01-01", 100.0], ["2020-02-03", 110.0], ["2020-03-02", 90.0]], "last": ["2020-03-31", 120.0]}
    r = I.sip(series, 1000, "2020-01")
    units, cash = 0, 0.0
    for _, px in series["months"]:
        cash += 1000
        n = float(S.affordable_shares(cash, px))
        cash -= n * px + float(S.buy_charges(n * px))
        units += n
    assert r["units"] == units and r["invested"] == 3000
    assert r["value"] == pytest.approx(cash + units * 120 - float(S.sell_charges(units * 120)))
    assert I.sip(series, 1000, "2020-02")["invested"] == 2000


def test_xirr():
    assert I.xirr([("2020-01-01", -100.0), ("2021-01-01", 110.0)]) == pytest.approx(0.1, abs=2e-3)
    assert I.xirr([("2020-01-01", -100.0), ("2020-07-01", -100.0), ("2021-01-01", 200.0)]) == pytest.approx(0.0, abs=1e-6)


def test_run_end_to_end(monkeypatch):
    monkeypatch.setattr(I, "FIRST_YEAR", 2018)
    monkeypatch.setattr(I, "CHECK_YEARS", 1)
    monkeypatch.setattr(I, "GRID", I.GRID[:4])
    monkeypatch.setattr(I, "CAPITALS", [100_000])
    p, market, bench = world(n_days=1500, start="2015-01-01")
    res = I.run(p, market, bench, all_eligible(p), {}, log=lambda *a: None)
    import json
    json.dumps(S._round(res), allow_nan=False)
    b = res["momentum"][0]
    assert b["plan_year"] == p.dates[-1].year and b["walk"]["years"]
    assert len(b["list"]["hold"]) == b["plan"][0] or b["list"]["cash"]
    assert res["sip"]["months"][0][0] >= "2015-01-01"


NODE = __import__("shutil").which("node")
PAGE = __import__("pathlib").Path(__file__).resolve().parent.parent / "stocks" / "invest.js"


@pytest.mark.skipif(NODE is None, reason="needs Node.js")
def test_page_sip_calculator_matches_the_engine(tmp_path):
    import json
    import subprocess
    rng = np.random.default_rng(2)
    days = pd.bdate_range("2015-01-01", "2026-10-30")
    first = days[np.r_[True, days.month[1:] != days.month[:-1]]]
    series = {"months": [[str(d.date()), float(round(250 * np.exp(0.01 * i + rng.normal(0, 0.05)), 2))] for i, d in enumerate(first)],
              "last": ["2026-10-30", 345.6]}
    cases = [(1000, "2015-01"), (500, "2019-03"), (2500, "2024-01"), (100, "2015-01")]
    script = tmp_path / "sip.js"
    script.write_text(f"const I = require({json.dumps(str(PAGE))}); const s = {json.dumps(series)};"
                      f"console.log(JSON.stringify({json.dumps(cases)}.map(([m, f]) => {{ const r = I.sipReplay(s, m, f);"
                      f" return [r.invested, r.value, r.units, r.xirr]; }})));")
    got = json.loads(subprocess.run([NODE, str(script)], capture_output=True, text=True, check=True).stdout)
    for (m, f), (inv, val, units, x) in zip(cases, got):
        want = I.sip(series, m, f)
        assert inv == want["invested"] and units == want["units"]
        assert val == pytest.approx(want["value"], abs=1e-6)
        assert x == pytest.approx(want["xirr"], abs=1e-6)
