'use strict';

// Live scanner: reads the 5-minute charts of the most traded NSE stocks every
// 5 minutes while the market is open (data/scan.json says which stocks and
// their levels), and lists what is moving. Information, not tested signals.
(() => {
  const LL = window.LiveLogic;
  const FEED = 'https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history';
  const KEY = { size: 'scan.size', view: 'scan.view', ring: 'scan.ring' };
  const SIZES = [100, 200, 300, 500];
  const EVERY = 5 * 60_000;
  const TAGS = {
    gapup: ['Gap up', 'up'], gapdown: ['Gap down', 'down'], hi52: ['52-week high', 'up'], lo52: ['52-week low', 'down'],
    pdh: ['Above yesterday’s high', 'up'], pdl: ['Below yesterday’s low', 'down'], orbup: ['Above 15-min high', 'up'],
    orbdown: ['Below 15-min low', 'down'], volume: ['Heavy volume', 'info'], abovevwap: ['Above VWAP', ''], belowvwap: ['Below VWAP', ''],
  };
  const VIEWS = {
    gainers: ['Gainers', xs => xs.filter(x => x.r.chg > 0).sort((a, b) => b.r.chg - a.r.chg)],
    losers: ['Losers', xs => xs.filter(x => x.r.chg < 0).sort((a, b) => a.r.chg - b.r.chg)],
    volume: ['Heavy volume', xs => xs.filter(x => x.r.rvol >= 2).sort((a, b) => b.r.rvol - a.r.rvol)],
    up: ['Breaking up', xs => xs.filter(x => ['pdh', 'orbup', 'hi52'].some(t => x.r.tags.includes(t))).sort((a, b) => (b.r.rvol || 0) - (a.r.rvol || 0))],
    down: ['Breaking down', xs => xs.filter(x => ['pdl', 'orbdown', 'lo52'].some(t => x.r.tags.includes(t))).sort((a, b) => (b.r.rvol || 0) - (a.r.rvol || 0))],
    hi52: ['52-week highs', xs => xs.filter(x => x.r.tags.includes('hi52')).sort((a, b) => b.r.chg - a.r.chg)],
  };
  const SHOW = 15;
  let G, SC = null;
  const st = { bars: {}, res: {}, at: null, busy: false, done: 0, want: 0, failed: 0, timer: null, started: false, day: null, rung: new Set() };
  const $ = sel => document.querySelector(sel);

  const nowSec = () => Math.floor(Date.now() / 1000);
  function phase() {
    const t = nowSec(), d = new Date((t + LL.IST) * 1000).getUTCDay(), m = LL.istMinute(t);
    if (d === 0 || d === 6) return 'closed';
    return m < LL.OPEN ? 'before' : m <= LL.CLOSE ? 'open' : 'after';
  }
  async function getJSON(url, ms = 15000) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(timer); }
  }
  const size = () => { const n = +G.store.get(KEY.size, 200); return SIZES.includes(n) ? n : 200; };
  const rows = () => (SC?.live?.rows || []).slice(0, size());
  const fields = () => SC?.live?.fields || [];

  // levels from the nightly file when they are for the session before this one, else from the feed itself
  function infoFor(row, days) {
    const f = fields(), get = k => row[f.indexOf(k)];
    const info = { pc: get('pc'), ph: get('ph'), pl: get('pl'), h52: get('h52'), l52: get('l52'), adv: get('adv') };
    const prev = days.length > 1 ? days[days.length - 2] : null;
    if (prev && SC.data_date !== prev[0]) {
      const b = prev[1];
      info.pc = b[b.length - 1].c; info.ph = Math.max(...b.map(x => x.h)); info.pl = Math.min(...b.map(x => x.l));
    }
    return info;
  }

  async function readOne(row) {
    const sym = row[0], have = st.bars[sym];
    const to = nowSec();
    const from = have && have.length ? have[have.length - 1].t : to - 6 * 86400;
    const j = await getJSON(`${FEED}?symbol=${encodeURIComponent(sym)}&resolution=5&from=${from}&to=${to}&countback=${have ? 12 : 200}&currencyCode=INR`);
    if (j.s !== 'ok' && j.s !== 'no_data') throw new Error(j.s);
    const fresh = LL.bars(j, true);
    const all = LL.merge(have || [], fresh);
    // keep the last two sessions only
    const days = LL.byDay(all).slice(-2);
    st.bars[sym] = days.flatMap(d => d[1]);
    if (!days.length) return;
    const [day, today] = days[days.length - 1];
    const r = LL.scan(today, infoFor(row, days), SC.vol_curve);
    if (r) st.res[sym] = { ...r, day };
  }

  async function readAll() {
    if (st.busy || !SC) return;
    st.busy = true;
    const list = rows();
    st.want = list.length; st.done = 0; st.failed = 0;
    render();
    let i = 0, lastPaint = Date.now();
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (i < list.length) {
        const row = list[i++];
        try { await readOne(row); } catch { st.failed++; }
        st.done++;
        if (Date.now() - lastPaint > 1500) { lastPaint = Date.now(); render(); }
      }
    }));
    const days = Object.values(st.res).map(r => r.day).sort();
    st.day = days.length ? days[days.length - 1] : null;
    st.at = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    st.busy = false;
    ring();
    render();
  }

  // optional alerts: a stock breaks above yesterday's high or makes a 52-week high on heavy volume
  function ring() {
    if (!G.store.get(KEY.ring, false) || phase() !== 'open' || !window.DayUI?.notify) return;
    const evs = [];
    for (const [sym, r] of Object.entries(st.res)) {
      if (r.day !== st.day || !(r.rvol >= 3)) continue;
      for (const t of ['hi52', 'pdh']) {
        if (!r.tags.includes(t)) continue;
        evs.push({ key: `${r.day}|scan|${sym}|${t}`, title: `${sym}: ${TAGS[t][0].toLowerCase()} on ${r.rvol.toFixed(1)}x volume`,
          body: `Now ${G.inr(r.last, 2)} (${G.spct(r.chg, 1)}). Scanner info, not a tested signal.` });
        break;
      }
    }
    if (evs.length) window.DayUI.notify(evs);
  }

  function schedule() {
    clearTimeout(st.timer);
    st.timer = null;
    if (!st.started) return;
    const active = !document.hidden && G.currentTab() === 'live';
    if (!active && !(G.store.get(KEY.ring, false) && window.DayUI?.alertsOn?.())) return;
    if (phase() !== 'open') return;
    // just after each 5-minute bar closes (and its volume is in)
    const t = nowSec(), next = (Math.floor((t + LL.IST) / 300) + 1) * 300 - LL.IST + 25;
    st.timer = setTimeout(async () => { await readAll(); schedule(); }, Math.min(EVERY, Math.max(10, next - t) * 1000));
  }

  const tagHtml = (tags, keep = null) => tags.filter(t => !keep || keep.includes(t))
    .map(t => `<span class="badge ${TAGS[t][1] === 'up' ? 'good' : TAGS[t][1] === 'down' ? 'bad' : TAGS[t][1]}">${TAGS[t][0]}</span>`).join(' ');

  function table(list) {
    if (!list.length) return '<p class="muted">Nothing here right now.</p>';
    return `<div class="table-wrap"><table class="scan-table"><thead><tr><th>Stock</th><th class="r">Price</th><th class="r">Change</th><th class="r">Volume vs normal</th></tr></thead><tbody>
      ${list.slice(0, SHOW).map(({ sym, r }) => `<tr data-chart="${G.esc(sym)}" data-tf="5" tabindex="0" role="button" aria-label="Live chart of ${G.esc(sym)}">
        <td><b>${G.esc(sym)}</b><br><small class="scan-name">${G.esc(nameOf(sym))}</small><div class="scan-tags">${tagHtml(r.tags.filter(t => t !== 'abovevwap' && t !== 'belowvwap'))}</div></td>
        <td class="r num">${G.inr(r.last, 2)}<br><small class="muted">${r.at}</small></td>
        <td class="r num ${G.cls(r.chg)}">${G.spct(r.chg, 2)}</td>
        <td class="r num">${r.rvol == null ? '–' : `${r.rvol.toFixed(1)}x`}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function render() {
    const box = $('#liveScan');
    if (!box || !st.started) return;
    if (!SC || !SC.live) {
      box.innerHTML = `<div class="card"><span class="label">Live scanner</span><p>The scanner’s stock list isn’t ready yet; it comes with the next evening update.</p></div>`;
      return;
    }
    const view = VIEWS[G.store.get(KEY.view, 'gainers')] ? G.store.get(KEY.view, 'gainers') : 'gainers';
    const latest = Object.entries(st.res).filter(([, r]) => r.day === st.day).map(([sym, r]) => ({ sym, r }));
    const counts = Object.fromEntries(Object.entries(VIEWS).map(([k, [, f]]) => [k, f(latest).length]));
    const ph = phase();
    const when = st.day ? `${ph === 'open' ? 'Today' : G.fmtDay(st.day)}` : '';
    const ringOn = G.store.get(KEY.ring, false);
    const settingsOpen = !!box.querySelector('details.scan-settings')?.open;  // redraws keep it open
    box.innerHTML = `<div class="card">
      <span class="label">Live scanner · ${size()} most traded NSE stocks</span>
      <h2>What’s moving${when ? ` · ${when}` : ''}</h2>
      <p class="muted num">${st.busy ? `Reading charts… ${st.done} of ${st.want}` : st.at ? `${latest.length} charts read at ${st.at} IST` : 'Starting…'}
        ${ph === 'open' ? ' · reads again after every 5-minute candle' : ph === 'closed' ? ' · market closed: showing the last session' : ph === 'before' ? ' · market opens at 9:15 AM' : ' · market closed for the day'}
        ${st.failed ? ` · ${st.failed} didn’t answer` : ''}</p>
      <div class="chips" role="group" aria-label="What to show">${Object.entries(VIEWS).map(([k, [label]]) =>
        `<button type="button" class="chip${k === view ? ' on' : ''}" data-sview="${k}" aria-pressed="${k === view}">${label} <small>${counts[k]}</small></button>`).join('')}</div>
      ${latest.length ? table(VIEWS[view][1](latest)) : st.busy ? '' : '<p class="muted">No prices yet.</p>'}
      <p class="muted"><small>Tap a stock for its live chart. “Volume vs normal”: shares traded so far today against a normal day by this time
        (2x = twice as busy). VWAP: the average price paid today.</small></p>
      <details class="scan-settings"${settingsOpen ? ' open' : ''}><summary>Scanner settings</summary>
        <p class="label">Stocks to read</p>
        <div class="chips">${SIZES.map(n => `<button type="button" class="chip${n === size() ? ' on' : ''}" data-ssize="${n}" aria-pressed="${n === size()}">${n}</button>`).join('')}</div>
        <p class="muted"><small>Each read is one small request per stock (about ${Math.round(size() * 0.6)} KB every 5 minutes after the first read).
          On mobile data, 100–200 is plenty.</small></p>
        <div class="btn-row"><button type="button" class="btn small ${ringOn ? '' : 'ghost'}" data-sring aria-pressed="${ringOn}">${ringOn ? '🔔 Scanner alerts: on' : '🔕 Scanner alerts: off'}</button>
          <button type="button" class="btn small ghost" data-snow>Read now</button></div>
        <p class="muted"><small>Scanner alerts ring when a stock breaks above yesterday’s high or makes a 52-week high on 3x normal volume
          (needs alerts on, above). They are information: in our tests, buying such breakouts during the day lost money after charges.</small></p>
      </details>
      <p class="warn-inline"><small><b>Not buy signals.</b> We tested trading these moves (breakouts, heavy-volume “stocks in play”, gaps) on a year of
        5-minute prices for 500 stocks: after Groww charges they lost money. Use the scanner to watch the market; the tested plans are above.</small></p>
    </div>`;
  }

  function nameOf(sym) {
    return SC?.names?.[sym] || G.TD?.stocks?.[sym]?.name || sym;
  }

  // one line about a stock for the chart window
  function rowFor(sym) {
    const r = st.res[sym];
    const hits = SC?.hits_by_stock?.[sym];
    const parts = [];
    if (r && r.day === st.day) parts.push(`${r.rvol == null ? '' : `Volume ${r.rvol.toFixed(1)}x normal. `}${tagHtml(r.tags)}`);
    if (hits && hits.length) parts.push(`Chart patterns at the close of ${G.fmtDay(SC.data_date)}: ${hits.map(h => `<span class="badge info">${G.esc(SC.patterns?.[h] || h)}</span>`).join(' ')}`);
    return parts.join('<br>');
  }

  function start() {
    if (!st.started) {
      st.started = true;
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && G.currentTab() === 'live' && phase() === 'open') readAll().then(schedule);
        else schedule();
      });
      readAll().then(schedule);
    } else {
      render();
      if (phase() === 'open' && !st.busy && st.at) readAll().then(schedule); else schedule();
    }
  }

  function init(helpers, scan) {
    G = helpers;
    SC = scan;
    document.body.addEventListener('click', e => {
      const v = e.target.closest('[data-sview]');
      if (v) { G.store.set(KEY.view, v.dataset.sview); render(); return; }
      const s = e.target.closest('[data-ssize]');
      if (s) { G.store.set(KEY.size, +s.dataset.ssize); readAll().then(schedule); return; }
      if (e.target.closest('[data-sring]')) { G.store.set(KEY.ring, !G.store.get(KEY.ring, false)); render(); schedule(); return; }
      if (e.target.closest('[data-snow]')) readAll().then(schedule);
    });
    document.body.addEventListener('keydown', e => {
      const row = e.key === 'Enter' && e.target.closest('tr[data-chart]');
      if (row) window.LiveChart?.open(row.dataset.chart, row.dataset.tf);
    });
  }

  window.ScanUI = { init, start, render, nameOf, rowFor, stop: () => { if (!(G.store.get(KEY.ring, false) && window.DayUI?.alertsOn?.())) { clearTimeout(st.timer); st.timer = null; } } };
})();
