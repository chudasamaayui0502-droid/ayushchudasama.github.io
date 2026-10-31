'use strict';

// "Check a stock": everything the page knows about one Nifty 100 stock, in one place.
(() => {
  let G;
  const $ = sel => document.querySelector(sel);
  const FEED = 'https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history';

  // 70 daily candles with the 20-day average
  function candles(bars, dates) {
    const n = bars.length;
    if (n < 2) return '';
    const W = 340, H = 170, T = 8, B = 22, Lp = 4, R = 46;
    const hi = Math.max(...bars.map(b => b[1] ?? -Infinity)), lo = Math.min(...bars.map(b => b[2] ?? Infinity));
    const y = v => T + (hi - v) / ((hi - lo) || 1) * (H - T - B);
    const step = (W - Lp - R) / n, bw = Math.max(1, step * 0.6);
    let svg = '';
    bars.forEach((b, i) => {
      if (!b || b[0] == null || b[3] == null) return;
      const x = Lp + i * step + step / 2, up = b[3] >= b[0], c = up ? 'var(--up)' : 'var(--down)';
      svg += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y(b[1]).toFixed(1)}" y2="${y(b[2]).toFixed(1)}" stroke="${c}" stroke-width="1"/>`;
      const top = y(Math.max(b[0], b[3])), h = Math.max(1, Math.abs(y(b[0]) - y(b[3])));
      svg += `<rect x="${(x - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${c}"/>`;
    });
    const sma = [];
    for (let i = 19; i < n; i++) {
      const w = bars.slice(i - 19, i + 1).map(b => b && b[3]);
      if (w.every(v => v != null)) sma.push(`${(Lp + i * step + step / 2).toFixed(1)},${y(w.reduce((a, v) => a + v, 0) / 20).toFixed(1)}`);
    }
    const axis = [hi, (hi + lo) / 2, lo].map(v => `<text x="${W - R + 4}" y="${(y(v) + 4).toFixed(1)}" font-size="10" fill="var(--muted)">${G.inr(v, v < 100 ? 2 : 0)}</text>`).join('');
    return `<div class="legend"><span><i style="background:var(--up)"></i>Up day</span><span><i style="background:var(--down)"></i>Down day</span>
        <span><i style="background:var(--accent)"></i>20-day average</span></div>
      <svg class="candles" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily prices, last ${n} days">${svg}
        ${sma.length > 1 ? `<polyline fill="none" stroke="var(--accent)" stroke-width="1.4" points="${sma.join(' ')}"/>` : ''}${axis}
        <text x="${Lp}" y="${H - 6}" font-size="10" fill="var(--muted)">${G.fmtDate(dates[0])}</text>
        <text x="${W - R}" y="${H - 6}" font-size="10" fill="var(--muted)" text-anchor="end">${G.fmtDate(dates[n - 1])}</text></svg>`;
  }

  function swingPart(sym, cap) {
    const t = G.todaysSignals(cap);
    const i = t.ok.findIndex(x => x.sym === sym);
    if (i >= 0) {
      const x = t.ok[i], r = x.best.r, k = G.ruleOf(r), v = G.BT.variants[x.best.vid];
      const price = x.st.close;
      return `<p><span class="badge good">On today’s buy list: #${i + 1}</span> by <b>${G.esc(v.name)}</b>. Buy ${x.shares} share${x.shares > 1 ? 's' : ''} at the
        next open; ${k.tg ? `target ${G.inr(price * (1 + k.tg), 2)} (+${G.p100(k.tg)}%), stop-loss ${G.inr(price * (1 - k.st), 2)} (−${G.p100(k.st)}%), sell after ${k.hd} trading days`
          : `trailing stop ${G.p100(k.st)}% below the highest close, up to ${k.hd} trading days`}.</p>
        <p><button class="btn small ghost" data-goto-pick="${G.esc(sym)}">See it in the buy list</button></p>`;
    }
    if (t.dear.some(x => x.sym === sym)) return `<p><span class="badge warn">Signalled today</span> but one share costs more than your money per stock.</p>`;
    const last = Object.entries(G.TD.last_signal || {}).filter(([vid, ls]) => !G.BT.variants[vid]?.filter && ls.stocks.some(s => s.s === sym))
      .map(([vid, ls]) => `${G.esc(G.BT.variants[vid].name)} on ${G.fmtDate(ls.date)}`);
    return `<p>No swing signal today.${last.length ? ` It was last signalled by: ${last.slice(0, 3).join('; ')}.` : ''}</p>`;
  }

  function dayPart(sym) {
    const w = G.TD.day_watch, lv = w && w.levels && w.levels[sym];
    if (!lv) return '<p class="muted">No day-trading levels for this stock.</p>';
    const row = window.DayUI?.watchRow?.(sym);
    const ex = (w.ex_dates?.[sym] || []).map(e => `${G.fmtDay(e[0])}: ${G.esc(e[1])}`);
    return `<table class="kv"><tbody>
        <tr><td>Yesterday’s close · high · low</td><td class="r num">${G.inr(lv.pc, 2)} · ${G.inr(lv.ph, 2)} · ${G.inr(lv.pl, 2)}</td></tr>
        <tr><td>20-day average</td><td class="r num">${lv.sma20 ? G.inr(lv.sma20, 2) : '–'} <small>${lv.sma20 ? (lv.pc > lv.sma20 ? '(above: uptrend)' : '(below: downtrend)') : ''}</small></td></tr>
        <tr><td>Quiet day (narrowest range in 7 days)</td><td class="r">${lv.nr7 ? 'Yes' : 'No'}</td></tr>
      </tbody></table>
      ${row ? `<p><span class="badge info">On the day-trading watch list</span> for ${G.fmtDay(row.next)}: ${G.esc(row.setup.name)} · ${row.rule}${row.label ? ` · trades if it ${row.label} ${G.inr(row.price, 2)}` : ''}.
        ${row.practice ? '<small class="down">Practice only: this plan didn’t pass the tests.</small>' : ''}</p>` : '<p class="muted">Not on the day-trading plan’s watch list for the next session.</p>'}
      ${ex.length ? `<p><span class="badge warn">Company event</span> ${ex.join('; ')}. On that day the price drops for an accounting reason (dividend, bonus, split).</p>` : ''}`;
  }

  function investPart(sym, cap) {
    const inv = G.INV;
    if (!inv) return '';
    let b = inv.momentum[0];
    for (const x of inv.momentum) if (cap >= x.capital) b = x;
    const l = b.list, inList = l.hold.find(x => x.s === sym), sell = l.sell.find(x => x.s === sym);
    if (!inList && !sell) return '<p class="muted">Not in the strongest-stocks list this month.</p>';
    const x = inList || sell;
    return `<p><span class="badge ${sell ? 'bad' : 'good'}">${sell ? 'Leaving' : l.buy.some(y => y.s === sym) ? 'Joining' : 'In'} the strongest-stocks list</span>
      (from ${G.fmtDay(l.as_of)}): it rose ${G.spct(x.score, 0)} over the look-back period.</p>`;
  }

  function myPart(sym) {
    const swing = G.store.get(G.KEYS.trades, []).filter(t => t.sym === sym && !t.sold);
    const day = G.store.get('day.trades', []).filter(t => t.sym === sym && !t.sold);
    if (!swing.length && !day.length) return '';
    return `<h4>Your trades in it</h4><ul class="plain">${swing.map(t => `<li>Swing: ${t.qty} × ${G.inr(t.price, 2)} bought ${G.fmtDate(t.date)}</li>`).join('')}
      ${day.map(t => `<li>Day trade: ${t.side > 0 ? 'bought' : 'short-sold'} ${t.qty} × ${G.inr(t.price, 2)} on ${G.fmtDate(t.date)}</li>`).join('')}</ul>`;
  }

  async function livePrice(sym) {
    const box = $('#checkLive');
    if (!box) return;
    try {
      const to = Math.floor(Date.now() / 1000);
      const r = await fetch(`${FEED}?symbol=${encodeURIComponent(sym)}&resolution=5&from=${to - 5 * 86400}&to=${to}&countback=80&currencyCode=INR`, { cache: 'no-store' });
      const j = await r.json();
      if (j.s !== 'ok' || !j.t?.length) throw new Error('no prices');
      const last = j.c[j.c.length - 1], t = j.t[j.t.length - 1];
      const when = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(t * 1000));
      const pc = G.TD.day_watch?.levels?.[sym]?.pc ?? G.TD.stocks[sym]?.close;
      if ($('#checkLive')) $('#checkLive').innerHTML = `Latest price <b class="num">${G.inr(last, 2)}</b> <small class="${G.cls(last - pc)}">${pc ? G.spct(last / pc - 1, 2) : ''}</small>
        <small class="muted">(${when} IST, Moneycontrol)</small>`;
    } catch {
      if ($('#checkLive')) $('#checkLive').innerHTML = '<small class="muted">Latest price not available right now.</small>';
    }
  }

  function open(sym) {
    const st = G.TD.stocks[sym];
    if (!st) return;
    const cap = G.currentCapital();
    const dlg = $('#checkDialog');
    $('#checkBody').innerHTML = `
      <div class="trade-top"><div><b class="check-name">${G.esc(st.name)}</b><br><small>${G.esc(sym)} · ${G.esc(st.industry)}</small></div>
        <div class="r"><b class="num">${G.inr(st.close, 2)}</b> <small class="${G.cls(st.chg)}">${st.chg == null ? '' : G.spct(st.chg, 1)}</small><br>
        <small class="muted">close of ${G.fmtDay(G.TD.data_date)}</small></div></div>
      <p id="checkLive" class="num"><small class="muted">Loading the latest price…</small></p>
      ${candles(st.bars, G.TD.dates)}
      <h4>Swing</h4>${swingPart(sym, cap)}
      <h4>Day trading</h4>${dayPart(sym)}
      <h4>Invest</h4>${investPart(sym, cap)}
      ${myPart(sym)}
      <h4>Company</h4>${G.healthChips(sym)}
      <p class="news">${G.newsLink(st.name)}</p>`;
    if (dlg.showModal && !dlg.open) dlg.showModal(); else dlg.setAttribute('open', '');
    dlg.scrollTop = 0;
    livePrice(sym);
  }

  function close() {
    const dlg = $('#checkDialog');
    if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
  }

  function init(helpers) {
    G = helpers;
    const syms = Object.keys(G.TD.stocks).sort();
    $('#checkList').innerHTML = syms.map(s => `<option value="${G.esc(s)}">${G.esc(G.TD.stocks[s].name)}</option>`).join('');
    const input = $('#checkInput');
    const find = v => {
      v = v.trim().toUpperCase();
      if (!v) return null;
      if (G.TD.stocks[v]) return v;
      const byName = syms.filter(s => G.TD.stocks[s].name.toUpperCase().includes(v) || s.startsWith(v));
      return byName.length === 1 ? byName[0] : null;
    };
    const go = () => {
      const sym = find(input.value);
      $('#checkHint').textContent = sym || !input.value.trim() ? '' : 'Not found: pick a Nifty 100 stock from the list.';
      if (sym) { open(sym); input.value = ''; }
    };
    input.addEventListener('change', go);
    $('#checkForm').addEventListener('submit', e => { e.preventDefault(); go(); });
    $('#checkClose').addEventListener('click', close);
    $('#checkDialog').addEventListener('click', e => { if (e.target.id === 'checkDialog') close(); });
    document.body.addEventListener('click', e => {
      const goto = e.target.closest('[data-goto-pick]');
      if (!goto) return;
      close();
      G.showTab('swing');
      document.getElementById(`pick-${goto.dataset.gotoPick}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  window.CheckUI = { init, open };
})();
