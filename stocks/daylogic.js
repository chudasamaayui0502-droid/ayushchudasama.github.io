// Day-trading rules for live prices: the same rules screener/daytrade.py tests,
// applied to one stock's 5-minute bars of the current session. No page code
// here, so Node can check it against the Python engine (screener/test_daylogic_js.py).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DayLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BAR_MINUTES = 5, OPEN_MINUTE = 9 * 60 + 15, N_BARS = 76;  // 9:15, 9:20, ... 15:30
  const barAt = hhmm => {
    const [h, m] = hhmm.split(':').map(Number);
    return Math.floor((h * 60 + m - OPEN_MINUTE) / BAR_MINUTES);
  };
  const barTime = b => {
    const m = OPEN_MINUTE + b * BAR_MINUTES;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const ENTRY_BAR = barAt('09:20'), LAST_ENTRY_BAR = barAt('12:55'), EXIT_BAR = barAt('15:10');
  const SLIPPAGE = 0.0005;

  // ---- Groww intraday charges: keep in sync with screener/daytrade.py ----
  const brokerage = v => Math.min(Math.max(0.001 * v, 5), 20, 0.025 * v);
  const fees = v => v * (0.0000297 + 0.000001 + 0.000001);  // NSE + SEBI + IPFT
  const buyCharges = v => v > 0 ? brokerage(v) + fees(v) + 0.00003 * v + 0.18 * (brokerage(v) + fees(v)) : 0;
  const sellCharges = v => v > 0 ? brokerage(v) + fees(v) + 0.00025 * v + 0.18 * (brokerage(v) + fees(v)) : 0;
  const roundTrip = v => buyCharges(v) + sellCharges(v);
  const sharesFor = (value, price) => price > 0 ? Math.max(0, Math.floor(Math.max(value - roundTrip(value), 0) / price)) : 0;
  const tradeCharges = (sh, entry, exit, side) => side > 0
    ? buyCharges(sh * entry) + sellCharges(sh * exit) : sellCharges(sh * entry) + buyCharges(sh * exit);
  const tradePnl = (sh, entry, exit, side) => side * sh * (exit - entry) - tradeCharges(sh, entry, exit, side);
  const daySlots = exposure => Math.min(5, Math.max(1, Math.floor(exposure / 20000)));

  // Charges line by line, for one order. `side` is the order: 'buy' or 'sell'.
  function chargeItems(v, side) {
    if (!(v > 0)) return [];
    const b = brokerage(v), f = fees(v);
    const items = [['Brokerage', b]];
    items.push(side === 'buy' ? ['Stamp duty (0.003%)', 0.00003 * v] : ['STT (0.025%, sell side)', 0.00025 * v]);
    items.push(['Exchange, SEBI and IPFT fees', f], ['GST (18% on brokerage and fees)', 0.18 * (b + f)]);
    return items;
  }

  // ---- 5-minute bars ----
  const IST_OFFSET = 19800;  // seconds
  const istDate = t => new Date((t + IST_OFFSET) * 1000).toISOString().slice(0, 10);

  // One session's bars from the chart feed's {t, o, h, l, c} arrays, on 76 slots (null = no bar).
  // Like the engine: only slots on the 5-minute grid, positive prices, and high/low widened to
  // contain the open and close.
  function session(feed, day) {
    const s = { o: Array(N_BARS).fill(null), h: Array(N_BARS).fill(null), l: Array(N_BARS).fill(null), c: Array(N_BARS).fill(null) };
    if (!feed || !Array.isArray(feed.t)) return s;
    for (let i = 0; i < feed.t.length; i++) {
      const t = feed.t[i];
      if (istDate(t) !== day) continue;
      const mins = Math.floor(((t + IST_OFFSET) % 86400) / 60);
      if (mins < OPEN_MINUTE || (mins - OPEN_MINUTE) % BAR_MINUTES) continue;
      const b = (mins - OPEN_MINUTE) / BAR_MINUTES;
      if (b >= N_BARS) continue;
      const o = +feed.o[i], h = +feed.h[i], l = +feed.l[i], c = +feed.c[i];
      if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue;
      s.o[b] = o; s.h[b] = Math.max(h, o, c); s.l[b] = Math.min(l, o, c); s.c[b] = c;
    }
    return s;
  }
  const lastBar = s => { for (let b = N_BARS - 1; b >= 0; b--) if (s.o[b] != null) return b; return -1; };

  // ---- the rules ----
  const baseId = id => id.split('@')[0];

  // Nifty's last finished bar against its opening price: up for buys, down for short-sells.
  function marketOk(setup, mkt, b) {
    if (setup.filter !== 'mkt') return true;
    if (!mkt || b < 1 || mkt.c[b - 1] == null || mkt.o[0] == null) return false;
    return setup.side > 0 ? mkt.c[b - 1] > mkt.o[0] : mkt.c[b - 1] < mkt.o[0];
  }

  // Everything known about one stock today under one setup and exit rule.
  //   lv: the day before {pc, ph, pl}; open: today's official open (null if not known yet);
  //   mkt: the Nifty's bars today; niftyTrend: {up, down} the day before;
  //   final: it's 3:10 PM or later (or the session is over), so a trade still open is sold.
  // state: 'waiting' (before it can trigger), 'watching', 'filtered' (market filter says no),
  //   'no' (didn't gap enough / no entry by 12:55), 'nodata', 'open' (in the trade),
  //   'stop', 'target', 'time' (sold at 3:10 PM).
  function evaluate(setup, stop, target, s, lv, open, mkt, niftyTrend, final = false) {
    const up = setup.side > 0, side = setup.side;
    const out = { setup: setup.id, side, last: lastBar(s) };
    if (!lv || !(lv.pc > 0)) return { ...out, state: 'nodata' };
    if (setup.filter === 'trend' && !(niftyTrend && (up ? niftyTrend.up : niftyTrend.down))) return { ...out, state: 'filtered' };
    if (out.last < 0) return { ...out, state: 'waiting' };
    if (s.o[0] == null) return { ...out, state: 'nodata', why: 'no 9:15 bar (a special session)' };
    let e = -1, level = null;
    if (setup.kind === 'open') {
      if (!(open > 0)) return { ...out, state: 'waiting', why: 'opening price not known yet' };
      const gap = open / lv.pc - 1;
      out.gap = gap;
      if ((setup.gap_lo != null && !(gap >= setup.gap_lo)) || (setup.gap_hi != null && !(gap <= setup.gap_hi))) return { ...out, state: 'no' };
      if (s.o[ENTRY_BAR] == null) return { ...out, state: out.last < ENTRY_BAR ? 'waiting' : 'nodata' };
      if (!marketOk(setup, mkt, ENTRY_BAR)) return { ...out, state: 'filtered' };
      e = ENTRY_BAR;
    } else {
      let first;
      if (setup.kind === 'level') {
        level = up ? lv.ph : lv.pl;
        first = ENTRY_BAR;
      } else {
        const k = setup.orb_bars;
        if (out.last < k) return { ...out, state: 'waiting', why: 'opening range still forming' };
        for (let b = 0; b < k; b++) if (s.h[b] == null) return { ...out, state: 'nodata' };
        level = up ? Math.max(...s.h.slice(0, k)) : Math.min(...s.l.slice(0, k));
        first = k;
      }
      out.level = level;
      if (!(level > 0)) return { ...out, state: 'nodata' };
      for (let b = first; b <= Math.min(LAST_ENTRY_BAR, out.last); b++) {
        if (s.h[b] == null) continue;
        if ((up ? s.h[b] > level : s.l[b] < level) && marketOk(setup, mkt, b)) { e = b; break; }
      }
      if (e < 0) return { ...out, state: out.last >= LAST_ENTRY_BAR ? 'no' : (out.last < first ? 'waiting' : 'watching') };
    }
    const fill = setup.kind === 'open' ? s.o[e] : (up ? Math.max(s.o[e], level) : Math.min(s.o[e], level));
    return { ...out, ...follow(s, side, e, fill * (1 + SLIPPAGE * side), stop, target, final) };
  }

  // A trade entered in bar e at price pe: the stop-loss and target are checked on every bar
  // from e until 3:10 PM (both in one bar: the stop counts first), then it is sold at 3:10 PM.
  // A level jumped over between bars fills at that bar's open. Stops and the 3:10 PM sale
  // lose SLIPPAGE; the target is a limit order.
  function follow(s, side, e, pe, stop, target, final = false) {
    const up = side > 0, last = lastBar(s);
    const sp = up ? pe * (1 - stop) : pe * (1 + stop);
    const tp = target ? (up ? pe * (1 + target) : pe * (1 - target)) : null;
    const out = { e, pe, sp, tp, entryTime: barTime(e), last };
    for (let b = e; b < Math.min(EXIT_BAR, last + 1); b++) {
      if (s.h[b] == null) continue;
      const o = s.o[b];
      if (up ? s.l[b] <= sp : s.h[b] >= sp) {
        const f = b > e && (up ? o < sp : o > sp) ? o : sp;
        return { ...out, state: 'stop', x: b, px: f * (1 - SLIPPAGE * side), exitTime: barTime(b) };
      }
      if (tp != null && (up ? s.h[b] >= tp : s.l[b] <= tp)) {
        const f = b > e && (up ? o > tp : o < tp) ? o : tp;
        return { ...out, state: 'target', x: b, px: f, exitTime: barTime(b) };
      }
    }
    if (final || last >= EXIT_BAR) {
      let f = s.o[EXIT_BAR];
      for (let b = EXIT_BAR - 1; f == null && b >= 0; b--) f = s.c[b];
      if (f == null) return { ...out, state: 'open', now: null };
      return { ...out, state: 'time', x: EXIT_BAR, px: f * (1 - SLIPPAGE * side), exitTime: barTime(EXIT_BAR) };
    }
    return { ...out, state: 'open', now: last >= 0 ? s.c[last] : null };
  }

  // The day as the backtest trades it: entries in the order they trigger (then the most
  // traded stock first), up to day_slots() trades, each with an equal share of the money,
  // skipping stocks the money can't buy one share of.
  function takeTrades(results, levels, exposure) {
    const slots = daySlots(exposure), value = exposure / slots;
    const entered = results.filter(r => r.e != null && r.e >= 0)
      .sort((a, z) => (a.e - z.e) || ((levels[z.sym]?.turn ?? -Infinity) - (levels[a.sym]?.turn ?? -Infinity)) || (a.sym < z.sym ? -1 : 1));
    const taken = [], skipped = [];
    for (const r of entered) {
      const shares = sharesFor(value, r.pe);
      if (taken.length < slots && shares >= 1) taken.push({ ...r, shares });
      else skipped.push({ ...r, shares, why: shares < 1 ? 'price above the money per trade' : 'no free slot' });
    }
    return { slots, value, taken, skipped };
  }

  return {
    N_BARS, ENTRY_BAR, LAST_ENTRY_BAR, EXIT_BAR, SLIPPAGE, barAt, barTime, baseId,
    buyCharges, sellCharges, roundTrip, sharesFor, tradeCharges, tradePnl, daySlots, chargeItems,
    session, lastBar, istDate, marketOk, evaluate, follow, takeTrades,
  };
});
