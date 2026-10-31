'use strict';

// Invest tab: a monthly SIP into the Nifty 50 ETF, and the strongest-stocks
// portfolio. app.js loads data/invest.json and hands over its helpers via
// InvestUI.init(). sipReplay() has no page code, so Node can check it against
// screener/invest.py (screener/test_invest.py).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InvestUI = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // ---- Groww delivery charges: keep in sync with screener/screener.py ----
  const brokerage = v => Math.min(Math.max(0.001 * v, 5), 20, 0.025 * v);
  const fees = v => v * (0.0000297 + 0.000001 + 0.000001);
  const buyCharges = v => v > 0 ? brokerage(v) + fees(v) + 0.001 * v + 0.00015 * v + 0.18 * (brokerage(v) + fees(v)) : 0;
  function sellCharges(v) {
    if (!(v > 0)) return 0;
    const dp = v >= 100 ? 20 : 3.5;
    return brokerage(v) + fees(v) + 0.001 * v + dp + 0.18 * (brokerage(v) + fees(v) + dp);
  }
  const affordable = (budget, price) => price > 0 ? Math.max(0, Math.floor(Math.max(budget - buyCharges(budget), 0) / price)) : 0;

  function xirr(flows) {
    const t0 = new Date(flows[0][0] + 'T00:00:00Z');
    const w = flows.map(([d]) => (new Date(d + 'T00:00:00Z') - t0) / (365.25 * 864e5));
    const npv = r => flows.reduce((a, [, f], i) => a + f / (1 + r) ** w[i], 0);
    let lo = -0.99, hi = 10;
    if (npv(lo) * npv(hi) > 0) return NaN;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  // The same as invest.sip(): `monthly` on each month's first trading day from startMonth
  // (YYYY-MM), whole units at the open, charges, leftover cash waits; valued at the last
  // close after sale charges. Also returns the month-by-month path for the chart.
  function sipReplay(series, monthly, startMonth) {
    let cash = 0, units = 0, invested = 0;
    const flows = [], path = [];
    for (const [day, px] of series.months) {
      if (day.slice(0, 7) < startMonth) continue;
      cash += monthly; invested += monthly;
      flows.push([day, -monthly]);
      const n = affordable(cash, px);
      if (n >= 1) { const v = n * px; cash -= v + buyCharges(v); units += n; }
      path.push([day, cash + units * px, invested]);
    }
    const [day, last] = series.last;
    const sale = units * last, value = cash + sale - sellCharges(sale);
    flows.push([day, value]);
    path.push([day, value, invested]);
    return { invested, value, units, xirr: flows.length > 1 ? xirr(flows) : NaN, path };
  }

  let G, INV;
  const $ = sel => document.querySelector(sel);
  const KEY = { monthly: 'invest.monthly', from: 'invest.from' };
  const yearsOf = w => w ? `${w.start.slice(0, 4)}–${w.end.slice(0, 4)}` : '';

  function settingsText(v) {
    const [n, look, skip, buf, filt, trend] = v;
    const months = Math.round(look / 21), skipTxt = skip ? ', not counting the latest month' : '';
    return `Hold the <b>${n} stocks</b> that rose the most over the last ${months} months${skipTxt}, among the 100 most-traded NSE stocks
      ${trend ? 'that are above their own 200-day average' : ''}. Keep a stock while it stays in the top ${buf}.
      ${filt ? 'When the Nifty 50 is below its 200-day average, sell everything and wait in cash.' : ''}`;
  }

  // ---- what did best for this amount, all on the same year-by-year footing ----
  function renderBest(cap) {
    const rows = [];
    const swing = G.BT?.walk_forward, swingB = swing && Object.keys(swing).map(Number).filter(c => c <= cap).sort((a, z) => z - a)[0];
    const sipS = INV.sip;
    const momB = INV.momentum.filter(b => b.capital <= cap).sort((a, z) => z.capital - a.capital)[0];
    const w0 = momB?.walk || (swingB && swing[swingB]);
    const from = w0 ? w0.start.slice(0, 7) : '2019-01';
    if (momB?.walk) {
      const w = momB.walk;
      rows.push(['Strongest stocks (Invest tab)', `${G.inr(momB.capital)} → <b>${G.inr(w.final)}</b>`, w.cagr, 'Swaps stocks once a month']);
      if (w.etf) rows.push(['Nifty 50 ETF, just hold', `${G.inr(momB.capital)} → <b>${G.inr(w.etf.final)}</b>`, w.etf.cagr, 'One buy, no work']);
    }
    if (swingB) {
      const w = swing[swingB];
      rows.push(['Swing signals (Swing tab)', `${G.inr(swingB)} → <b>${G.inr(w.final)}</b>`, w.cagr, 'Plan re-picked every January']);
      if (!momB && w.etf) rows.push(['Nifty 50 ETF, just hold', `${G.inr(swingB)} → <b>${G.inr(w.etf.final)}</b>`, w.etf.cagr, 'One buy, no work']);
    }
    if (sipS) {
      const r = sipReplay(sipS, 1000, from);
      rows.push([`SIP: ₹1,000 every month`, `${G.inr(r.invested)} put in → <b>${G.inr(r.value)}</b>`, r.xirr, 'Nifty 50 ETF, monthly']);
    }
    rows.sort((a, z) => z[2] - a[2]);
    $('#investBest').innerHTML = `<div class="card">
      <span class="label">What did best · tested year by year since ${from.slice(0, 4)}</span>
      <h2>Every way, the same honest test</h2>
      <p class="muted">Each way was replayed from January ${from.slice(0, 4)} to ${G.fmtDate(w0 ? w0.end : INV.data_end)}, choosing its settings every January
        only from what was known then, with Groww charges. This is the closest thing to having really used the tool.</p>
      <div class="table-wrap"><table><thead><tr><th>Way</th><th class="r">Money</th><th class="r">A year</th></tr></thead>
        <tbody>${rows.map(([n, m, y, note]) => `<tr><td><b>${n}</b><br><small>${note}</small></td><td class="r num">${m}</td>
          <td class="r num ${G.cls(y)}">${G.spct(y, 1)}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted">Day trading isn’t in this table: no day-trading plan made money after charges in its tests (see the Day trading tab).
        ${cap < 10000 ? `<br><b>With ${G.inr(cap)}</b>, the strongest-stocks portfolio isn’t practical (its smallest tested amount is ₹10,000), so a monthly SIP is the simplest way to grow money.` : ''}</p>
    </div>`;
  }

  function sipChart(path) {
    return G.lineChart([
      { pts: path.map(p => [p[0], p[1]]), color: 'var(--accent)', label: 'Value' },
      { pts: path.map(p => [p[0], p[2]]), color: 'var(--muted)', label: 'Money put in' },
    ], G.fmtDate(path[0][0]), G.fmtDate(path[path.length - 1][0]));
  }

  function renderSip() {
    const s = INV.sip;
    if (!s) { $('#investSip').innerHTML = ''; return; }
    const monthly = Math.max(100, +G.store.get(KEY.monthly, 1000) || 1000);
    const years = [...new Set(s.months.map(m => m[0].slice(0, 4)))];
    const pick = years.includes(String(G.store.get(KEY.from, '2015'))) ? String(G.store.get(KEY.from, '2015')) : years[0];
    const r = sipReplay(s, monthly, `${pick}-01`);
    const gain = r.value - r.invested;
    $('#investSip').innerHTML = `<div class="card">
      <span class="label">Monthly SIP · Nifty 50 ETF (${G.esc(s.symbol)})</span>
      <h2>Put in a fixed amount every month</h2>
      <p>Every month, buy the Nifty 50 index (India’s 50 biggest companies) with the same amount, whatever the market does.
        No picking, no timing. Below: what it really did, on real prices.</p>
      <div class="sip-row">
        <label>Every month (₹)<input id="sipMonthly" type="number" inputmode="numeric" min="100" step="100" value="${monthly}" /></label>
        <div><span class="label" style="margin:0">Starting</span><div class="chips">${years.filter((y, i) => i % 2 === 0 || y === pick).map(y =>
          `<button type="button" class="chip" data-sipfrom="${y}" aria-pressed="${y === pick}">${y}</button>`).join('')}</div></div>
      </div>
      <div class="summary">
        <div><small>Put in</small><b class="num">${G.inr(r.invested)}</b></div>
        <div><small>Worth now</small><b class="num">${G.inr(r.value)}</b></div>
        <div><small>Gain</small><b class="num ${G.cls(gain)}">${G.signedInr(gain)}</b></div>
        <div><small>A year (XIRR)</small><b class="num ${G.cls(r.xirr)}">${G.spct(r.xirr, 1)}</b></div>
      </div>
      ${sipChart(r.path)}
      <p class="muted">Bought on the first trading day of each month at the opening price, in whole units, with Groww delivery charges; sold at
        ${G.fmtDate(s.last[0])}’s close. Past growth is not a promise: the value goes down as well as up, sometimes for years.</p>
      <details><summary>How to do it on Groww</summary><ol class="steps">
        <li><b>Index fund SIP (simplest):</b> search “Nifty 50 index fund”, choose one with a low expense ratio (around 0.1–0.2% a year), start a
          monthly SIP. No brokerage or DP charge, and it buys fractions, so every rupee is invested.</li>
        <li><b>Or the ETF:</b> buy ${G.esc(s.symbol)} (or another Nifty 50 ETF) as a <b>Delivery</b> order on the same day every month. Charges are small
          (₹5 brokerage minimum per order), and you get whole units only.</li>
        <li><b>Then leave it.</b> The gains come from staying invested for years, including through the falls.</li>
      </ol></details>
    </div>`;
  }

  function renderMomentum(cap) {
    const all = INV.momentum;
    let b = all[0];
    for (const x of all) if (cap >= x.capital) b = x;
    const w = b.walk, lst = b.list;
    const beat = w && w.etf && w.final > w.etf.final;
    const small = cap < all[0].capital;
    const per = cap / b.plan[0];
    // stocks one share of which costs more than the money per stock are skipped, as the test does;
    // their share of the money goes to the others
    const fits = x => G.affordableShares(per, x.close) >= 1;
    const held = lst.hold.filter(fits), dear = lst.hold.filter(x => !fits(x));
    const perFit = held.length ? cap / held.length : per;
    const stockRow = (x, action) => {
      const sh = action === 'dear' ? 0 : G.affordableShares(perFit, x.close);
      const [bc, bt] = { buy: ['good', 'Buy'], keep: ['info', 'Keep'], sell: ['bad', 'Sell'], dear: ['warn', 'Too dear: skip'] }[action];
      return `<tr><td><b>${G.esc(x.s)}</b><br><small>${G.esc(x.name)}</small></td>
        <td class="r num">${G.inr(x.close, 2)}<br><small class="${G.cls(x.score)}">${x.score == null ? '' : G.spct(x.score, 0)}</small></td>
        <td class="r num">${action === 'sell' || action === 'dear' ? '–' : `${sh}`}</td>
        <td><span class="badge ${bc}">${bt}</span></td></tr>`;
    };
    const buys = new Set(lst.buy.map(x => x.s));
    const listHtml = lst.cash
      ? `<p class="verdict warn">This month the settings say <b>stay in cash</b> (the Nifty 50 is below its 200-day average). Sell anything still held.</p>`
      : `<div class="table-wrap"><table><thead><tr><th>Stock</th><th class="r">Price · rise</th><th class="r">Shares</th><th>Do</th></tr></thead>
          <tbody>${held.map(x => stockRow(x, buys.has(x.s) ? 'buy' : 'keep')).join('')}${dear.map(x => stockRow(x, 'dear')).join('')}
          ${lst.sell.filter(fits).map(x => stockRow(x, 'sell')).join('')}</tbody></table></div>
          ${dear.length ? `<p class="muted">One share of ${dear.map(x => G.esc(x.s)).join(', ')} costs more than ${G.inr(per)}, so it is skipped and the money is
            split over the other ${held.length} (about ${G.inr(perFit)} each).</p>` : ''}`;
    const years = w ? w.years.map(y => {
      const r = y.end_value / y.start_value - 1, er = y.etf_end / y.etf_start - 1;
      return `<tr><td><b>${y.year}</b></td><td class="r num ${G.cls(r)}">${G.spct(r, 0)}<br><small>${G.inr(y.end_value)}</small></td>
        <td class="r num ${G.cls(er)}">${G.spct(er, 0)}<br><small>${G.inr(y.etf_end)}</small></td></tr>`;
    }).join('') : '';
    $('#investMom').innerHTML = `<div class="card">
      <span class="label">Strongest stocks · swap once a month</span>
      <h2>Own the stocks that are rising most</h2>
      <p>Stocks that rose the most over the past months have tended to keep rising for a while (“momentum”). This portfolio holds the strongest
        ones and swaps them once a month.</p>
      ${small ? `<div class="verdict bad"><p>With ${G.inr(cap)}, each stock would get only a few hundred rupees, and charges (about ₹37 per ₹1,000 bought
        and sold) would eat the gains. The results below are for ${G.inr(b.capital)}. Use the SIP until you have more.</p></div>` : ''}
      ${w ? `<div class="verdict ${beat ? 'good' : 'bad'}"><span class="badge ${beat ? 'good' : 'bad'}">${beat ? 'Beat the Nifty ETF year by year' : 'Did not beat the Nifty ETF'}</span>
        <p>Followed since ${w.start.slice(0, 4)}, picking the settings again every January from what was known then: ${G.inr(b.capital)} became
        <b>${G.inr(w.final)}</b> (${G.spct(w.cagr, 1)} a year)${w.etf ? `; the Nifty 50 ETF made <b>${G.inr(w.etf.final)}</b> (${G.spct(w.etf.cagr, 1)} a year)` : ''}.
        Worst year: <b class="down">${G.spct(w.worst_year, 0)}</b>. ${beat ? 'Past results don’t promise future ones; momentum has long bad spells.' : ''}</p></div>
        <details><summary>Year by year</summary><div class="table-wrap"><table>
          <thead><tr><th>Year</th><th class="r">Strongest stocks</th><th class="r">Nifty ETF</th></tr></thead><tbody>${years}</tbody></table></div></details>` : ''}
      <h3>This year’s settings (picked in January ${b.plan_year})</h3>
      <p>${settingsText(b.plan)}</p>
      <h3>The list for this month · from ${G.fmtDay(lst.as_of)}’s prices</h3>
      <p class="muted">${G.inr(cap)} split equally over the stocks. “Rise” is the past ${Math.round(b.plan[1] / 21)}-month rise used to rank them.
        Buy at the next morning’s open as a <b>Delivery</b> order.</p>
      ${listHtml}
      <details><summary>How to follow it</summary><ol class="steps">
        <li><b>On the last trading day of each month</b>, after 7 PM, open this tab: the list updates.</li>
        <li><b>Next morning</b>: sell the stocks marked Sell, then buy the ones marked Buy, splitting the money equally. Keep the rest.</li>
        <li><b>Don’t</b> check daily or sell in a panic: the test held through falls of ${w ? G.pct(-w.worst_year, 0) : 'over 15%'} in a year.</li>
        <li>Buy and sell charges and the 20% short-term / 12.5% long-term capital-gains tax apply; the test counts the charges, not the tax.</li>
      </ol></details>
      <p class="muted">Risks: these are often fast-moving, expensive-looking stocks, some smaller companies. Momentum works on average, not every month.
        The test can’t include companies that later left the stock market, which flatters it a little.</p>
    </div>`;
  }

  function renderMethod() {
    $('#investMethod').innerHTML = `<div class="card">
      <span class="label">How investing was tested</span>
      <ul class="plain">
        <li><b>No hindsight:</b> the strongest-stocks list is chosen at each month-end from the ${INV.universe.size} most-traded stocks at that time
          (out of today’s Nifty 500), not from today’s winners.</li>
        <li><b>Settings picked like the tool does:</b> ${INV.grid.settings} combinations of how many stocks, how far back to look, when to swap, and
          two market filters. Every January the steadiest one on the years before is chosen and followed for the year (walk-forward since ${INV.grid.first_year}).</li>
        <li><b>Real money rules:</b> whole shares, Groww delivery charges on every buy and sell, trades at the next morning’s open.</li>
        <li><b>The SIP</b> uses the Nifty 50 ETF’s real opening prices on each month’s first trading day.</li>
        <li>Updated every Saturday, and the list at every month-end. Prices: Yahoo Finance and NSE.</li>
      </ul>
    </div>`;
  }

  function render(cap) {
    if (!INV) {
      $('#investBest').innerHTML = `<div class="card"><span class="label">Invest</span><p>The investing tests haven’t run yet. They run with the next weekly update.</p></div>`;
      return;
    }
    renderBest(cap);
    renderMomentum(cap);
  }

  function init(helpers, inv) {
    G = helpers;
    INV = inv;
    if (!INV) return;
    renderSip();
    renderMethod();
    document.body.addEventListener('click', e => {
      const from = e.target.closest('[data-sipfrom]');
      if (from) { G.store.set(KEY.from, from.dataset.sipfrom); renderSip(); }
    });
    let timer;
    document.body.addEventListener('input', e => {
      if (e.target.id !== 'sipMonthly') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const v = Math.floor(+e.target.value);
        if (v >= 100) {
          G.store.set(KEY.monthly, v);
          const pos = e.target.selectionStart;
          renderSip();
          const el = $('#sipMonthly');
          el.focus();
          try { el.setSelectionRange(pos, pos); } catch { /* number inputs may not support it */ }
        }
      }, 400);
    });
  }

  return { init, render, sipReplay, buyCharges, sellCharges };
});
