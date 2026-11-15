// Live chart and scanner maths: no page code here, so Node can test it
// (screener/test_livelogic_js.py). Bars are {t, o, h, l, c, v} with t in
// Unix seconds, from Moneycontrol's chart feed.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LiveLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const IST = 19800;               // seconds ahead of UTC
  const OPEN = 9 * 60 + 15, CLOSE = 15 * 60 + 30;
  const istDay = t => new Date((t + IST) * 1000).toISOString().slice(0, 10);
  const istMinute = t => Math.floor(((t + IST) % 86400) / 60);
  const istTime = t => new Date((t + IST) * 1000).toISOString().slice(11, 16);

  // Feed answer -> bars. Intraday bars are kept only for the regular session
  // (9:15 AM to 3:30 PM): the 1-minute feed also has after-market prints.
  function bars(feed, intraday) {
    const out = [];
    if (!feed || !Array.isArray(feed.t)) return out;
    for (let i = 0; i < feed.t.length; i++) {
      const t = +feed.t[i], o = +feed.o[i], h = +feed.h[i], l = +feed.l[i], c = +feed.c[i];
      if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue;
      if (intraday) {
        const m = istMinute(t);
        if (m < OPEN || m > CLOSE) continue;
      }
      out.push({ t, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v: Math.max(0, +(feed.v ? feed.v[i] : 0) || 0) });
    }
    out.sort((a, b) => a.t - b.t);
    return out.filter((b, i) => i === out.length - 1 || out[i + 1].t !== b.t);
  }

  // Newer bars replace older ones with the same time (the forming bar changes).
  function merge(old, fresh) {
    if (!fresh.length) return old.slice();
    const first = fresh[0].t;
    return old.filter(b => b.t < first).concat(fresh);
  }

  // Bars grouped by IST trading day, oldest first: [[day, bars], ...]
  function byDay(list) {
    const out = [];
    for (const b of list) {
      const d = istDay(b.t);
      if (!out.length || out[out.length - 1][0] !== d) out.push([d, []]);
      out[out.length - 1][1].push(b);
    }
    return out;
  }

  // Volume-weighted average price, restarting each day, from typical prices.
  function vwap(list) {
    const out = [];
    let day = null, pv = 0, vol = 0;
    for (const b of list) {
      const d = istDay(b.t);
      if (d !== day) { day = d; pv = 0; vol = 0; }
      pv += (b.h + b.l + b.c) / 3 * b.v;
      vol += b.v;
      out.push({ t: b.t, value: vol > 0 ? pv / vol : b.c });
    }
    return out;
  }

  function sma(list, n) {
    const out = [];
    let sum = 0;
    for (let i = 0; i < list.length; i++) {
      sum += list[i].c;
      if (i >= n) sum -= list[i - n].c;
      if (i >= n - 1) out.push({ t: list[i].t, value: sum / n });
    }
    return out;
  }

  // Highest and lowest price of a day's first `minutes` minutes (null until that time has passed).
  function openingRange(dayBars, minutes = 15) {
    if (!dayBars.length) return null;
    const end = OPEN + minutes;
    const first = dayBars.filter(b => istMinute(b.t) < end);
    const done = dayBars.some(b => istMinute(b.t) >= end);
    if (!first.length || !done) return null;
    return { hi: Math.max(...first.map(b => b.h)), lo: Math.min(...first.map(b => b.l)) };
  }

  // 5-minute bar slot of a time: 0 at 9:15, 75 at 3:30.
  const slot = t => Math.min(75, Math.max(0, Math.floor((istMinute(t) - OPEN) / 5)));

  // What a stock is doing today, from its 5-minute bars of the day.
  // info: {pc, ph, pl, h52, l52, adv} known from earlier days (yesterday's close,
  // high and low; 52-week high and low before today; average daily volume);
  // curve[k]: the share of a normal day's volume traded by the end of slot k.
  function scan(dayBars, info, curve) {
    if (!dayBars.length || !(info.pc > 0)) return null;
    const last = dayBars[dayBars.length - 1];
    const hi = Math.max(...dayBars.map(b => b.h)), lo = Math.min(...dayBars.map(b => b.l));
    const vol = dayBars.reduce((a, b) => a + b.v, 0);
    const vw = vwap(dayBars);
    const now = vw[vw.length - 1].value;
    const k = slot(last.t);
    const expected = info.adv > 0 && curve && curve[k] > 0 ? info.adv * curve[k] : null;
    const rvol = expected ? vol / expected : null;
    const or15 = openingRange(dayBars, 15);
    const open = dayBars[0].o;
    const x = {
      last: last.c, at: istTime(last.t), chg: last.c / info.pc - 1, gap: open / info.pc - 1, open, hi, lo,
      vwap: now, vol, rvol, or15, tags: [],
    };
    const tag = t => x.tags.push(t);
    if (x.gap >= 0.02) tag('gapup');
    if (x.gap <= -0.02) tag('gapdown');
    if (info.h52 > 0 && hi > info.h52) tag('hi52');
    if (info.l52 > 0 && lo < info.l52) tag('lo52');
    if (info.ph > 0 && last.c > info.ph) tag('pdh');
    if (info.pl > 0 && last.c < info.pl) tag('pdl');
    if (or15 && last.c > or15.hi) tag('orbup');
    if (or15 && last.c < or15.lo) tag('orbdown');
    if (rvol != null && rvol >= 2) tag('volume');
    tag(last.c >= now ? 'abovevwap' : 'belowvwap');
    return x;
  }

  // Price alerts: which of the user's levels the latest price has reached.
  // alert: {sym, dir: 'above'|'below', price}
  const alertHit = (a, last) => last > 0 && (a.dir === 'above' ? last >= a.price : last <= a.price);

  return { IST, OPEN, CLOSE, istDay, istMinute, istTime, bars, merge, byDay, vwap, sma, openingRange, slot, scan, alertHit };
});
