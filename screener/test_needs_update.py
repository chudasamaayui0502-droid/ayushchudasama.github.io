"""Tests for the "is an update needed?" check. Run: python -m pytest screener -q"""
import datetime as dt
import json

import pytest

import needs_update as N

D = dt.date


def at(y, m, d, hh, mm=0):
    return dt.datetime(y, m, d, hh, mm, tzinfo=N.IST)


def no_nse_call(day):
    raise AssertionError(f"NSE asked about {day}")


@pytest.mark.parametrize("now, want", [
    (at(2026, 10, 27, 21, 31), D(2026, 10, 27)),  # Tuesday evening: today
    (at(2026, 10, 27, 18, 30), D(2026, 10, 27)),
    (at(2026, 10, 27, 18, 29), D(2026, 10, 26)),  # just before prices are out
    (at(2026, 10, 27, 10, 0), D(2026, 10, 26)),   # Tuesday morning: Monday
    (at(2026, 10, 26, 10, 0), D(2026, 10, 23)),   # Monday morning: Friday
    (at(2026, 10, 24, 10, 0), D(2026, 10, 23)),   # Saturday
    (at(2026, 10, 25, 23, 0), D(2026, 10, 23)),   # Sunday night
])
def test_expected_close_day(now, want):
    assert N.expected_close_day(now) == want


def test_up_to_date_needs_nothing():
    needed, why = N.check(D(2026, 10, 27), at(2026, 10, 27, 21, 31), no_nse_call)
    assert not needed and "Up to date" in why


def test_evening_update_runs_without_asking_nse():
    needed, _ = N.check(D(2026, 10, 26), at(2026, 10, 27, 19, 0), no_nse_call)
    assert needed


def test_late_evening_with_prices_out():
    assert N.check(D(2026, 10, 26), at(2026, 10, 27, 23, 0), lambda d: True)[0]


def test_market_holiday_is_recognised_late_in_the_evening():
    asked = []
    needed, why = N.check(D(2026, 10, 26), at(2026, 10, 27, 23, 0), lambda d: asked.append(d) or False)
    assert not needed and "holiday" in why and asked == [D(2026, 10, 27)]


def test_nse_unreachable_means_update():
    assert N.check(D(2026, 10, 26), at(2026, 10, 27, 23, 0), lambda d: None)[0]


def test_gap_with_one_trading_day_needs_update():
    prices = {D(2026, 10, 27): False, D(2026, 10, 26): True}
    assert N.check(D(2026, 10, 23), at(2026, 10, 28, 8, 0), prices.get)[0]


def test_two_holidays_in_a_row():
    needed, why = N.check(D(2026, 10, 23), at(2026, 10, 28, 8, 0), lambda d: False)
    assert not needed and "2026-10-26, 2026-10-27" in why


def test_weekend_with_fridays_prices():
    assert not N.check(D(2026, 10, 23), at(2026, 10, 24, 10, 0), no_nse_call)[0]


def test_weekend_missing_friday():
    assert N.check(D(2026, 10, 22), at(2026, 10, 24, 10, 0), lambda d: True)[0]


def test_main_writes_github_output(tmp_path, monkeypatch, capsys):
    out = tmp_path / "out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    page = tmp_path / "today.json"
    monkeypatch.setattr(N, "TODAY_JSON", page)
    page.write_text(json.dumps({"data_date": "2099-01-01", "day_watch": {"date": "2099-01-01", "levels": {}}}))
    assert N.main() == 0
    assert out.read_text() == "needed=false\n"
    page.write_text("not json")
    N.main()
    assert out.read_text() == "needed=false\nneeded=true\n"
    assert "No usable" in capsys.readouterr().out


def test_missing_day_trading_watch_list_means_update(tmp_path, monkeypatch, capsys):
    out = tmp_path / "out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    page = tmp_path / "today.json"
    monkeypatch.setattr(N, "TODAY_JSON", page)
    for watch in (None, {"error": "feed down"}, {"date": "2098-12-31"}):
        page.write_text(json.dumps({"data_date": "2099-01-01", "day_watch": watch}))
        N.main()
    assert out.read_text() == "needed=true\n" * 3
    assert "watch list is missing" in capsys.readouterr().out


@pytest.mark.parametrize("today, ready", [
    ({"data_date": "2026-10-29", "day_watch": {"date": "2026-10-29"}}, True),
    ({"data_date": "2026-10-29", "day_watch": {"date": "2026-10-30"}}, True),  # the feed is a day ahead of Yahoo
    ({"data_date": "2026-10-29", "day_watch": {"date": "2026-10-28"}}, False),
    ({"data_date": "2026-10-29", "day_watch": {"date": "2026-10-29", "error": "x"}}, False),
    ({"data_date": "2026-10-29"}, False),
])
def test_watch_ready_agrees_with_the_screener(today, ready):
    import screener as S
    assert N.watch_ready(today) is ready
    assert S.watch_ok(today) is ready


def test_nse_answers_are_told_apart(monkeypatch):
    import urllib.error

    def fake(code):
        def urlopen(req, timeout):
            if code == 200:
                class R:
                    def __enter__(self): return self
                    def __exit__(self, *a): return False
                return R()
            if code is None:
                raise OSError("network down")
            raise urllib.error.HTTPError(req.full_url, code, "x", {}, None)
        return urlopen

    for code, expected in ((200, True), (404, False), (403, None), (None, None)):
        monkeypatch.setattr(N.urllib.request, "urlopen", fake(code))
        assert N.nse_has_prices(D(2026, 10, 27)) is expected, code
