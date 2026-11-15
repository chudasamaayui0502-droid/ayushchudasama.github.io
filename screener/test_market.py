"""Tests for the whole-market scan and the live chart maths. Run: python -m pytest screener -q"""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import daytrade as DT
import market as MK
import screener as S


def panel(n_stocks=30, n_days=300, seed=2):
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2024-01-01", periods=n_days)
    frames = {}
    for k in range(n_stocks):
        c = (10 + 10 * k) * np.exp(np.cumsum(rng.normal(0, 0.01, n_days)))
        frames[f"S{k:02d}"] = pd.DataFrame({"Open": c, "High": c * 1.01, "Low": c * 0.99, "Close": c,
                                            "Volume": np.full(n_days, 1e5 * (k + 1))}, index=dates)
    return S.build_panel(frames)


def test_liquid_needs_turnover_and_price():
    p = panel()
    liq = MK.liquid(p)
    turn = MK.turnover(p)
    last = p.C.iloc[-1]
    assert (liq == ((turn >= MK.MIN_TURNOVER) & (last >= MK.MIN_PRICE))).all()
    assert liq.any() and not liq.all()


def test_payload_lists_patterns_for_liquid_stocks_only_most_traded_first(monkeypatch):
    p = panel()
    base = S.pattern_signals(p)
    # make every stock hit one pattern today
    vid = base[0][0].id
    base[0][1].iloc[-1] = True
    out = MK.payload(p, base, {s: f"Co {s}" for s in p.symbols}, p.symbols[:5], MK.DEFAULT_CURVE, 7)
    liq = MK.liquid(p)
    turn = MK.turnover(p)
    assert set(out["hits"][vid]) == set(liq[liq].index)
    assert out["hits"][vid] == list(turn[liq].sort_values(ascending=False).index)
    assert out["counts"]["intraday"] == 7 and out["counts"]["daily"] == len(p.symbols)
    rows = out["live"]["rows"]
    assert [r[0] for r in rows] == out["hits"][vid][:MK.LIVE_SIZE]
    f = out["live"]["fields"]
    s = rows[0][0]
    assert rows[0][f.index("pc")] == round(float(p.C[s].iloc[-1]), 2)
    assert rows[0][f.index("h52")] == round(float(p.H[s].iloc[-252:].max()), 2)
    assert out["hits_by_stock"][s][0] == vid
    json.dumps(S._round(out), allow_nan=False)


def test_download_stops_early_when_the_feed_refuses(monkeypatch):
    calls = []

    def fake(sym, days, res="5", now=None, timeout=60):
        calls.append(sym)
        return None  # every request refused

    monkeypatch.setattr(DT, "fetch_bars", fake)
    monkeypatch.setattr(MK, "CHUNK", 50)
    out = MK.download_all([f"S{k}" for k in range(1000)], 30, log=lambda *a: None)
    assert out == {} and len(calls) == 50  # one batch, not 1,000 failures

    ok = {f"S{k}" for k in range(0, 1000, 2)} | {f"S{k}" for k in range(10)}
    monkeypatch.setattr(DT, "fetch_bars", lambda sym, days, res="5", now=None, timeout=60: pd.DataFrame({"c": [1.0]}) if sym in ok else None)
    out = MK.download_all([f"S{k}" for k in range(1000)], 30, log=lambda *a: None)
    assert len(out) == len(ok)  # about half answered all along: keep going


def test_volume_curve_rises_to_one():
    D, N = 5, 3
    V = np.ones((D, DT.N_BARS, N))
    V[:, 0, :] = 10  # a busy first bar
    z = np.zeros_like(V)
    ip = DT.Intraday(pd.bdate_range("2026-01-01", periods=D), ["A", "B", "C"], z, z, z, z, V)
    c = MK.volume_curve(ip)
    assert len(c) == DT.N_BARS and c[-1] == 1.0 and all(b >= a for a, b in zip(c, c[1:]))
    assert c[0] == pytest.approx(10 / (10 + DT.N_BARS - 1), abs=1e-4)
    assert MK.volume_curve(None) is None
    assert len(MK.DEFAULT_CURVE) == DT.N_BARS and MK.DEFAULT_CURVE[-1] == 1.0


NODE = shutil.which("node")
LOGIC = Path(__file__).resolve().parent.parent / "stocks" / "livelogic.js"


def node(script: str, tmp_path):
    f = tmp_path / "t.js"
    f.write_text(f"const L = require({json.dumps(str(LOGIC))});\n{script}")
    return json.loads(subprocess.run([NODE, str(f)], capture_output=True, text=True, check=True).stdout)


def ist(day: str, hhmm: str) -> int:
    return int(pd.Timestamp(f"{day} {hhmm}", tz="Asia/Kolkata").timestamp())


@pytest.mark.skipif(NODE is None, reason="needs Node.js")
def test_live_chart_maths(tmp_path):
    d = "2026-11-06"
    t = [ist(d, "09:10"), ist(d, "09:15"), ist(d, "09:20"), ist(d, "09:25"), ist(d, "09:30"), ist(d, "15:45")]
    feed = {"t": t, "o": [99, 100, 102, 101, 103, 104], "h": [99, 101, 103, 102, 105, 104], "l": [99, 99, 101, 100, 102, 104],
            "c": [99, 100.5, 102.5, 101.5, 104.5, 104], "v": [5, 10, 20, 10, 40, 7]}
    out = node(f"""
      const feed = {json.dumps(feed)};
      const b = L.bars(feed, true);
      const vw = L.vwap(b), sm = L.sma(b, 2), or15 = L.openingRange(b, 15);
      const info = {{pc: 100, ph: 102, pl: 98, h52: 104, l52: 80, adv: 500}};
      const curve = Array(76).fill(0).map((_, k) => (k + 1) / 76);
      const sc = L.scan(b, info, curve);
      const merged = L.merge(b, [{{t: {t[4]}, o: 103, h: 106, l: 102, c: 105, v: 50}}]);
      console.log(JSON.stringify({{n: b.length, times: b.map(x => L.istTime(x.t)), vw: vw.map(x => x.value), sm: sm.map(x => x.value),
        or15, sc, merged: merged.map(x => x.c), up: L.alertHit({{dir: 'above', price: 104}}, 104.5), down: L.alertHit({{dir: 'below', price: 104}}, 104.5)}}));
    """, tmp_path)
    assert out["times"] == ["09:15", "09:20", "09:25", "09:30"]  # pre-open and after-market prints dropped
    tp = [(101 + 99 + 100.5) / 3, (103 + 101 + 102.5) / 3, (102 + 100 + 101.5) / 3, (105 + 102 + 104.5) / 3]
    v = [10, 20, 10, 40]
    want = np.cumsum(np.array(tp) * v) / np.cumsum(v)
    assert out["vw"] == pytest.approx(list(want))
    assert out["sm"] == pytest.approx([101.5, 102.0, 103.0])
    assert out["or15"] == {"hi": 103, "lo": 99}  # 9:15-9:29, known once the 9:30 bar exists
    sc = out["sc"]
    assert sc["last"] == 104.5 and sc["chg"] == pytest.approx(0.045) and sc["hi"] == 105
    assert sc["rvol"] == pytest.approx(80 / (500 * 4 / 76))  # 80 shares by the 9:30 slot (index 3)
    for tag in ("hi52", "pdh", "orbup", "volume", "abovevwap"):
        assert tag in sc["tags"]
    assert "gapup" not in sc["tags"] and "pdl" not in sc["tags"]
    assert out["merged"] == [100.5, 102.5, 101.5, 105]
    assert out["up"] and not out["down"]
