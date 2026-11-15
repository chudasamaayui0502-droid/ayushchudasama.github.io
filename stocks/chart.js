'use strict';

// Live chart of any NSE stock: candles from Moneycontrol's chart feed, drawn
// with TradingView's open-source Lightweight Charts (vendor/), updated every
// minute while the market is open. Lines: VWAP, yesterday's high/low/close,
// the first 15 minutes' range, your trade's levels and your price alerts.
(() => {
  const LL = window.LiveLogic;
  const FEED = 'https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history';
  const ALERTS_KEY = 'alerts.price';
  const TF = {
    '1': { label: '1 min', res: '1', days: 4, count: 1500, intraday: true },
    '5': { label: '5 min', res: '5', days: 12, count: 700, intraday: true },
    '15': { label: '15 min', res: '15', days: 40, count: 700, intraday: true },
    'D': { label: 'Day', res: 'D', days: 730, count: 520, intraday: false },
    'W': { label: 'Week', res: 'W', days: 3650, count: 530, intraday: false },
  };
  let G, state = null;
  const $ = sel => document.querySelector(sel);

  // ---- price alerts, shared with the Live tab (day.js checks them every minute) ----
  const priceAlerts = {
    list() { try { return JSON.parse(localStorage.getItem(ALERTS_KEY)) || []; } catch { return []; } },
    save(list) { try { localStorage.setItem(ALERTS_KEY, JSON.stringify(list)); } catch { /* private mode */ } },
    add(sym, dir, price) {
      const a = { id: `${sym}-${dir}-${price}-${Date.now()}`, sym, dir, price, created: new Date().toISOString().slice(0, 10) };
      this.save([...this.list(), a]);
      return a;
    },
    remove(id) { this.save(this.list().filter(a => a.id !== id)); },
    symbols() { return [...new Set(this.list().map(a => a.sym))]; },
    // the alerts reached by `last`; they are removed so each rings once
    take(sym, last) {
      const hit = this.list().filter(a => a.sym === sym && LL.alertHit(a, last));
      const ids = new Set(hit.map(a => a.id));
      if (hit.length) this.save(this.list().filter(a => !ids.has(a.id)));
      return hit;
    },
  };

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  const feedUrl = (sym, tf, from, to) =>
    `${FEED}?symbol=${encodeURIComponent(sym)}&resolution=${TF[tf].res}&from=${from}&to=${to}&countback=${TF[tf].count}&currencyCode=INR`;
  async function getJSON(url, ms = 15000) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.s !== 'ok' && j.s !== 'no_data') throw new Error(j.s || 'bad answer');
      return j;
    } finally { clearTimeout(timer); }
  }
  const nowSec = () => Math.floor(Date.now() / 1000);
  function marketOpen() {
    const t = nowSec(), d = new Date((t + LL.IST) * 1000).getUTCDay(), m = LL.istMinute(t);
    return d >= 1 && d <= 5 && m >= LL.OPEN - 1 && m <= LL.CLOSE + 1;
  }
  // chart time: intraday bars as IST clock times (the chart shows UTC), days as dates
  const timeOf = (tf, t) => TF[tf].intraday ? t + LL.IST : LL.istDay(t);

  function lines(sym) {
    const out = [];
    const add = (price, color, title, dashed = true) => price > 0 && out.push({ price, color, title, dashed });
    const day = (G.store.get('day.trades', []) || []).find(t => t.sym === sym && !t.sold);
    if (day) {
      const sp = day.price * (1 - day.side * day.st / 100), tp = day.tg ? day.price * (1 + day.side * day.tg / 100) : null;
      add(day.price, css('--muted'), 'Your entry', false); add(sp, css('--down'), 'Your stop'); add(tp, css('--up'), 'Your target');
    }
    const swing = (G.store.get(G.KEYS.trades, []) || []).find(t => t.sym === sym && !t.sold);
    if (swing && !day) {
      add(swing.price, css('--muted'), 'Your buy', false);
      add(swing.price * (1 - swing.st / 100), css('--down'), 'Your stop');
      if (swing.tg) add(swing.price * (1 + swing.tg / 100), css('--up'), 'Your target');
    }
    const w = window.DayUI?.watchRow?.(sym);
    if (w && w.price > 0) add(w.price, css('--accent'), 'Day plan');
    for (const a of priceAlerts.list()) if (a.sym === sym) add(a.price, css('--amber'), `Alert ${a.dir === 'above' ? '▲' : '▼'}`);
    return out;
  }

  function nameOf(sym) {
    return G.TD?.stocks?.[sym]?.name || window.ScanUI?.nameOf?.(sym) || sym;
  }

  async function load(tf) {
    const to = nowSec();
    const s = state;
    const [feed, daily] = await Promise.all([
      getJSON(feedUrl(s.sym, tf, to - TF[tf].days * 86400, to)),
      TF[tf].intraday ? getJSON(feedUrl(s.sym, 'D', to - 20 * 86400, to)) : Promise.resolve(null),
    ]);
    return { bars: LL.bars(feed, TF[tf].intraday), daily: daily ? LL.bars(daily, false) : null };
  }

  function levelsFor(bars, daily) {
    const days = LL.byDay(bars);
    if (!days.length) return {};
    const [today, todayBars] = days[days.length - 1];
    const prev = (daily || []).filter(b => LL.istDay(b.t) < today);
    const y = prev[prev.length - 1];
    return { day: today, y, or15: LL.openingRange(todayBars, 15) };
  }

  function draw() {
    const s = state, tf = s.tf, box = $('#chartBox');
    const LW = window.LightweightCharts;
    if (s.chart) { s.chart.remove(); s.chart = null; }
    if (!LW) { box.innerHTML = '<p class="error">The chart library didn’t load. Check your connection and try again.</p>'; return; }
    box.innerHTML = '';
    const up = css('--up'), down = css('--down'), text = css('--text'), muted = css('--muted'), line = css('--line');
    const chart = LW.createChart(box, {
      autoSize: true,
      layout: { background: { type: 'solid', color: css('--panel') }, textColor: muted, fontFamily: 'DM Sans, system-ui, sans-serif', attributionLogo: true },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line },
      timeScale: { borderColor: line, timeVisible: TF[tf].intraday, secondsVisible: false, rightOffset: 3 },
      crosshair: { mode: LW.CrosshairMode.Normal },
      localization: { locale: 'en-IN', priceFormatter: p => p.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
    });
    s.chart = chart;
    s.candles = chart.addCandlestickSeries({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
    s.volume = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    s.candles.setData(s.bars.map(b => ({ time: timeOf(tf, b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
    s.volume.setData(s.bars.map(b => ({ time: timeOf(tf, b.t), value: b.v, color: b.c >= b.o ? css('--up-soft') : css('--down-soft') })));
    const legend = [];
    const overlay = (pts, color, label, width = 2) => {
      if (pts.length < 2) return null;
      const ser = chart.addLineSeries({ color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      ser.setData(pts.map(p => ({ time: timeOf(tf, p.t), value: p.value })));
      legend.push(`<span><i style="background:${color}"></i>${label}</span>`);
      return ser;
    };
    if (TF[tf].intraday) {
      s.vwapSeries = overlay(LL.vwap(s.bars), css('--accent'), 'VWAP (average price paid today)');
      const lv = levelsFor(s.bars, s.daily);
      const pl = (price, color, title, style = LW.LineStyle.Dashed) => price > 0 && s.candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
      if (lv.y) { pl(lv.y.h, muted, 'Yest. high'); pl(lv.y.l, muted, 'Yest. low'); pl(lv.y.c, muted, 'Yest. close', LW.LineStyle.Dotted); }
      if (lv.or15) { pl(lv.or15.hi, text, '15-min high', LW.LineStyle.SparseDotted); pl(lv.or15.lo, text, '15-min low', LW.LineStyle.SparseDotted); }
      s.levels = lv;
    } else {
      const n = tf === 'W' ? [10, 40] : [20, 50, 200];
      const colors = [css('--accent'), css('--amber'), muted];
      n.forEach((k, i) => overlay(LL.sma(s.bars, k), colors[i], `${k}-${tf === 'W' ? 'week' : 'day'} average`, 1.5));
    }
    for (const l of lines(s.sym)) {
      s.candles.createPriceLine({ price: l.price, color: l.color, lineWidth: 2, lineStyle: l.dashed ? LW.LineStyle.Dashed : LW.LineStyle.Solid, axisLabelVisible: true, title: l.title });
    }
    $('#chartLegend').innerHTML = legend.join('');
    // show the latest day (intraday) or the last ~6 months / 3 years
    const n = s.bars.length;
    const show = TF[tf].intraday ? Math.min(n, tf === '1' ? 375 : tf === '5' ? 150 : 100) : Math.min(n, tf === 'W' ? 156 : 130);
    if (n) chart.timeScale().setVisibleLogicalRange({ from: n - show, to: n + 2 });
  }

  function head() {
    const s = state, b = s.bars[s.bars.length - 1];
    const lv = TF[s.tf].intraday ? s.levels : null;
    const prevC = lv?.y?.c ?? (s.bars.length > 1 ? s.bars[s.bars.length - 2].c : null);
    const chg = b && prevC ? b.c / prevC - 1 : null;
    const when = b ? (TF[s.tf].intraday ? `${G.fmtDay(LL.istDay(b.t))}, ${LL.istTime(b.t)} IST` : G.fmtDay(LL.istDay(b.t))) : '';
    $('#chartHead').innerHTML = `<div class="trade-top"><div><b class="check-name">${G.esc(nameOf(s.sym))}</b><br><small>${G.esc(s.sym)} · NSE</small></div>
      <div class="r">${b ? `<b class="num">${G.inr(b.c, 2)}</b> ${chg == null ? '' : `<small class="${G.cls(chg)}">${G.spct(chg, 2)}</small>`}` : ''}<br>
        <small class="muted">${when}${s.live ? ' · live' : ''}</small></div></div>`;
    $('#chartTf').innerHTML = Object.entries(TF).map(([k, v]) =>
      `<button type="button" class="chip${k === s.tf ? ' on' : ''}" data-ctf="${k}" aria-pressed="${k === s.tf}">${v.label}</button>`).join('');
  }

  function info() {
    const s = state;
    const mine = priceAlerts.list().filter(a => a.sym === s.sym);
    const alertsOn = G.store.get('live.alerts', false);
    const last = s.bars.length ? s.bars[s.bars.length - 1].c : null;
    const scan = window.ScanUI?.rowFor?.(s.sym);
    $('#chartInfo').innerHTML = `
      ${scan ? `<p class="scan-tags">${scan}</p>` : ''}
      <form id="chartAlertForm" class="alert-form" autocomplete="off">
        <label class="label" for="chartAlertPrice">Price alert</label>
        <div class="check-row"><input id="chartAlertPrice" type="number" inputmode="decimal" step="0.05" min="0" placeholder="${last ? last.toFixed(2) : 'Price'}" />
          <button class="btn small" type="submit">Add</button></div>
        <small class="muted">Rings when the price reaches it (sound, vibration${'Notification' in window ? ', notification' : ''}), checked every minute while
          this page is open and alerts are on${alertsOn ? '' : ' — <b>alerts are off: turn them on in the Live tab</b>'}.</small>
      </form>
      ${mine.length ? `<ul class="plain alert-list">${mine.map(a => `<li>${a.dir === 'above' ? '▲ Above' : '▼ Below'} <b class="num">${G.inr(a.price, 2)}</b>
        <button type="button" class="btn small ghost" data-adel="${G.esc(a.id)}">Remove</button></li>`).join('')}</ul>` : ''}
      <p class="muted"><small>Prices: Moneycontrol’s chart feed, up to a minute behind the exchange; ${TF[s.tf].intraday ? 'only regular market hours (9:15 AM to 3:30 PM)' : 'adjusted for bonuses and splits'}.
        Charts: <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView Lightweight Charts™</a>.
        Lines are information, not buy or sell signals.</small></p>`;
  }

  async function show(tf) {
    const s = state;
    s.tf = tf;
    clearInterval(s.timer);
    $('#chartBox').innerHTML = '<p class="muted chart-wait">Loading the chart…</p>';
    head();
    try {
      const { bars, daily } = await load(tf);
      if (state !== s || s.tf !== tf) return;
      if (!bars.length) throw new Error('no prices');
      s.bars = bars; s.daily = daily;
    } catch (err) {
      if (state === s) $('#chartBox').innerHTML = `<p class="error">No chart for ${G.esc(s.sym)} right now (${G.esc(err.message)}).</p>`;
      return;
    }
    s.live = marketOpen();
    draw(); head(); info();
    if (s.live) s.timer = setInterval(tickLive, 60_000);
  }

  // every minute while the market is open: fetch the newest bars and update the chart in place
  async function tickLive() {
    const s = state;
    if (!s || !s.chart) return;
    if (!marketOpen()) { s.live = false; clearInterval(s.timer); head(); return; }
    const tf = s.tf, last = s.bars[s.bars.length - 1];
    try {
      const from = TF[tf].intraday ? last.t : nowSec() - 10 * 86400;
      const fresh = LL.bars(await getJSON(`${FEED}?symbol=${encodeURIComponent(s.sym)}&resolution=${TF[tf].res}&from=${from}&to=${nowSec()}&countback=30&currencyCode=INR`), TF[tf].intraday);
      if (state !== s || s.tf !== tf || !fresh.length) return;
      const keep = fresh.filter(b => b.t >= last.t);
      s.bars = LL.merge(s.bars, keep);
      for (const b of keep) {
        s.candles.update({ time: timeOf(tf, b.t), open: b.o, high: b.h, low: b.l, close: b.c });
        s.volume.update({ time: timeOf(tf, b.t), value: b.v, color: b.c >= b.o ? css('--up-soft') : css('--down-soft') });
      }
      if (s.vwapSeries) {
        const vw = LL.vwap(s.bars);
        for (const p of vw.slice(-keep.length - 1)) s.vwapSeries.update({ time: timeOf(tf, p.t), value: p.value });
      }
      head();
    } catch { /* keep the chart; try again next minute */ }
  }

  function open(sym, tf = null) {
    const dlg = $('#chartDialog');
    if (!dlg) return;
    close(false);
    state = { sym, tf: tf || (marketOpen() ? '5' : 'D'), bars: [], chart: null, timer: null };
    if (dlg.showModal && !dlg.open) dlg.showModal(); else dlg.setAttribute('open', '');
    show(state.tf);
  }

  function close(hide = true) {
    if (state) { clearInterval(state.timer); state.chart?.remove(); }
    state = null;
    const dlg = $('#chartDialog');
    if (hide && dlg) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  }

  function init(helpers) {
    G = helpers;
    const dlg = $('#chartDialog');
    if (!dlg) return;
    $('#chartClose').addEventListener('click', () => close());
    dlg.addEventListener('close', () => { if (state) close(false); });
    dlg.addEventListener('click', e => {
      if (e.target === dlg) { close(); return; }
      const c = e.target.closest('[data-ctf]');
      if (c && state && c.dataset.ctf !== state.tf) { show(c.dataset.ctf); return; }
      const del = e.target.closest('[data-adel]');
      if (del && state) { priceAlerts.remove(del.dataset.adel); draw(); info(); }
    });
    dlg.addEventListener('submit', e => {
      if (e.target.id !== 'chartAlertForm' || !state) return;
      e.preventDefault();
      const price = Math.round(parseFloat($('#chartAlertPrice').value) * 100) / 100;
      const last = state.bars.length ? state.bars[state.bars.length - 1].c : null;
      if (!(price > 0) || !(last > 0)) return;
      priceAlerts.add(state.sym, price >= last ? 'above' : 'below', price);
      draw(); info();
    });
    document.body.addEventListener('click', e => {
      const b = e.target.closest('[data-chart]');
      if (b) { e.preventDefault(); open(b.dataset.chart, b.dataset.tf || null); }
    });
  }

  window.LiveChart = { init, open, close, priceAlerts };
})();
