'use strict';

(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const KEYS = { capital: 'swing.capital', trades: 'swing.trades' };
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: not saved */ }
    },
  };

  // ---- Groww delivery charges: keep in sync with screener/screener.py ----
  const brokerage = v => Math.min(Math.max(0.001 * v, 5), 20, 0.025 * v);
  const exchangeFees = v => v * (0.0000297 + 0.000001 + 0.000001);
  function buyCharges(v) {
    if (!(v > 0)) return 0;
    const b = brokerage(v), f = exchangeFees(v);
    return b + f + 0.001 * v + 0.00015 * v + 0.18 * (b + f);
  }
  function sellCharges(v) {
    if (!(v > 0)) return 0;
    const b = brokerage(v), f = exchangeFees(v), dp = v >= 100 ? 20 : 3.5;
    return b + f + 0.001 * v + dp + 0.18 * (b + f + dp);
  }
  const affordableShares = (budget, price) =>
    price > 0 ? Math.max(0, Math.floor((budget - buyCharges(budget)) / price)) : 0;
  function netPnl(shares, buy, sell) {
    const bv = shares * buy, sv = shares * sell;
    return sv - sellCharges(sv) - bv - buyCharges(bv);
  }

  // ---- formatting ----
  const inr = (x, d = 0) => x == null || !isFinite(x) ? '–'
    : '₹' + Number(x).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
  const signedInr = (x, d = 0) => !isFinite(x) ? '–' : (x > 0 ? '+' : x < 0 ? '−' : '') + inr(Math.abs(x), d);
  const pct = (x, d = 0) => x == null || !isFinite(x) ? '–' : (x * 100).toFixed(d) + '%';
  const cls = x => x > 0 ? 'up' : x < 0 ? 'down' : '';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const asDate = s => new Date(s + 'T00:00:00');
  const fmtDate = s => asDate(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtDay = s => asDate(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function nextWeekday(s) {
    const d = asDate(s);
    do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6);
    return isoDay(d);
  }

  let BT, TD;

  const PERIOD_LABEL = {
    train: ['Training', 'used to shortlist'],
    validate: ['Checking', 'used to pick the winner'],
    test: ['Final test', 'never used for picking'],
  };
  const KIND = { 2: ['Target', 'up'], 1: ['Stop-loss', 'down'], 0: ['Time up', ''], '-1': ['Still open', ''] };
  const VERDICTS = {
    good: ['good', 'Passed every test',
      'It made money in the final test, beat simply holding the Nifty 50 ETF, and did better than most random picks with the same rules. Past results still don’t guarantee future profit.'],
    luck: ['warn', 'Made money, but it may be luck',
      'It made money in the final test, but random stock picks with the same target and stop-loss often did about as well. The profit may have come from the market rising, not from the pattern.'],
    below_index: ['warn', 'Made less than the Nifty 50 ETF',
      'It made money in the final test, but simply buying the Nifty 50 ETF (NIFTYBEES) and holding it did better, with no work and fewer charges.'],
    unproven: ['bad', 'Did not pass the earlier tests',
      'No strategy made money in both the training and checking periods at this amount. Treat these signals as practice only.'],
    loss: ['bad', 'Lost money in the final test',
      'Even the best strategy for this amount lost money in the final test, mostly because charges are large compared with small trades. Practise on paper or add more money first.'],
    none: ['bad', 'Not enough data', 'No strategy had enough trades to test at this amount.'],
  };

  const parseKey = key => {
    const [vid, tg, st, hd] = key.split('|');
    return { vid, tg: +tg / 100, st: +st / 100, hd: +hd };
  };
  function bucketFor(cap) {
    let pick = BT.buckets[0];
    for (const b of BT.buckets) if (cap >= b.capital) pick = b;
    return pick;
  }
  const chosenOf = b => b.candidates.find(c => c.key === b.chosen);
  const periodOf = name => BT.periods.find(p => p.name === name);
  const periodRange = name => {
    const p = periodOf(name);
    return `${asDate(p.start).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} – ${asDate(p.end).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
  };
  function signalsPerMonth(vid) {
    const p = periodOf('test');
    const months = (asDate(p.end) - asDate(p.start)) / (30.44 * 864e5);
    const n = BT.pattern_stats[vid]?.test?.n ?? 0;
    return months > 0 ? n / months : 0;
  }

  // ---- small SVG charts ----
  function sparkline(bars) {
    const closes = bars.map(b => b && b[3]).filter(v => v != null);
    if (closes.length < 2) return '';
    const lo = Math.min(...closes), hi = Math.max(...closes) || lo + 1, W = 110, H = 36;
    const pts = closes.map((v, i) => `${(i / (closes.length - 1) * W).toFixed(1)},${(H - 2 - (v - lo) / (hi - lo || 1) * (H - 4)).toFixed(1)}`);
    const color = closes[closes.length - 1] >= closes[0] ? 'var(--up)' : 'var(--down)';
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Price over the last ${closes.length} days"><polyline fill="none" stroke="${color}" stroke-width="1.6" points="${pts.join(' ')}"/></svg>`;
  }

  function lineChart(series, startLabel, endLabel) {
    series = series.filter(s => s.pts && s.pts.length > 1);
    if (!series.length) return '';
    const W = 600, H = 240, L = 78, R = 10, T = 12, B = 30;
    const vals = series.flatMap(s => s.pts.map(p => p[1]));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo || hi || 1) * 0.06;
    lo -= pad; hi += pad;
    const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    let grid = '';
    for (let i = 0; i <= 3; i++) {
      const v = lo + (hi - lo) * i / 3;
      grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>`
        + `<text x="${L - 8}" y="${y(v) + 5}" text-anchor="end" font-size="16" fill="var(--muted)">${inr(v)}</text>`;
    }
    const lines = series.map(s => {
      const n = s.pts.length;
      const pts = s.pts.map((p, i) => `${(L + i / (n - 1) * (W - L - R)).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
      return `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" points="${pts}"/>`;
    }).join('');
    const legend = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('');
    return `<div class="legend">${legend}</div>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Money over time in the final test">${grid}${lines}
        <text x="${L}" y="${H - 6}" font-size="16" fill="var(--muted)">${esc(startLabel)}</text>
        <text x="${W - R}" y="${H - 6}" font-size="16" fill="var(--muted)" text-anchor="end">${esc(endLabel)}</text>
      </svg>`;
  }

  // ---- sections ----
  function renderPlan(cap) {
    const b = bucketFor(cap), c = chosenOf(b);
    if (!c) {
      $('#plan').innerHTML = `<div class="card"><span class="label">Your plan</span><p>No strategy could be tested at this amount.</p></div>`;
      return;
    }
    const k = parseKey(b.chosen), v = BT.variants[k.vid];
    const per = cap / b.slots;
    const cost = buyCharges(per) + sellCharges(per);
    const [vcls, vtitle, vtext] = VERDICTS[b.verdict] || VERDICTS.none;
    const tested = b.capital === cap ? '' :
      `<p class="muted">Test results below are for ${inr(b.capital)}, the closest tested amount at or below yours.</p>`;
    const rows = ['train', 'validate', 'test'].map(name => {
      const r = c[name], bench = b.benchmark[name];
      return `<div class="period${name === 'test' ? ' final' : ''}">
        <div><b>${PERIOD_LABEL[name][0]}</b><small>${periodRange(name)} · ${PERIOD_LABEL[name][1]}</small></div>
        <div class="period-value"><small>${inr(b.capital)} became</small><b class="num ${cls(r.profit)}">${inr(r.final)}</b></div>
        <p class="period-meta num">${r.trades} trades · ${pct(r.win_rate)} won · worst fall −${pct(r.max_dd)}
          · Nifty 50 ETF: ${bench ? inr(bench.final) : '–'}</p>
      </div>`;
    }).join('');
    const t = c.test, rnd = b.random;
    const randomLine = rnd ? `<p>With the same target, stop-loss and amount, <b>random</b> stock picks turned ${inr(b.capital)} into
      <b>${inr(rnd.median)}</b> (middle result of ${rnd.runs} random runs). This strategy did better than <b>${pct(rnd.beat_pct)}</b> of them.</p>` : '';
    const timeExits = t.trades - t.targets_hit - t.stops_hit;
    const chart = lineChart([
      { pts: t.curve, color: 'var(--accent)', label: 'This strategy' },
      { pts: b.benchmark.test?.curve, color: 'var(--muted)', label: 'Nifty 50 ETF (buy and hold)' },
    ], fmtDate(t.start), fmtDate(t.end));
    const log = (t.trades_log || []).map(([sym, bd, bp, sd, sp, sh, pnl, kind]) => {
      const [label, kc] = KIND[kind] || ['', ''];
      return `<tr><td><b>${esc(sym)}</b></td><td>${fmtDate(bd)}</td><td class="r num">${inr(bp, 2)}</td>
        <td>${fmtDate(sd)}</td><td class="r num">${inr(sp, 2)}</td><td class="r num">${sh}</td>
        <td class="r num ${cls(pnl)}">${signedInr(pnl, 2)}</td><td class="${kc}">${label}</td></tr>`;
    }).join('');
    const cands = b.candidates.map(o => {
      const ok = parseKey(o.key), ov = BT.variants[ok.vid];
      const cell = r => `<td class="r num ${cls(r.profit)}">${inr(r.final)}</td>`;
      return `<tr><td>${o.key === b.chosen ? '★ ' : ''}${esc(ov.name)}</td>
        <td class="num">+${ok.tg * 100}% / −${ok.st * 100}% / ${ok.hd}d</td>${cell(o.train)}${cell(o.validate)}${cell(o.test)}</tr>`;
    }).join('');

    $('#plan').innerHTML = `<div class="card">
      <span class="label">Your plan for ${inr(cap)}</span>
      <h2>${esc(v.name)}</h2>
      <p>${esc(v.desc)}</p>
      <div class="rules">
        <div class="rule"><b class="up">+${k.tg * 100}%</b><span>Target: sell when up ${k.tg * 100}%</span></div>
        <div class="rule"><b class="down">−${k.st * 100}%</b><span>Stop-loss: sell when down ${k.st * 100}%</span></div>
        <div class="rule"><b>${k.hd} days</b><span>Otherwise sell after ${k.hd} trading days</span></div>
      </div>
      <p>Hold <b>${b.slots} stock${b.slots > 1 ? 's' : ''}</b> at a time (about ${inr(per)} each).
        Each buy + sell of ${inr(per)} costs about <b>${inr(cost, 2)}</b> in Groww charges
        (<b>${pct(cost / per, 1)}</b>), so a stock must rise more than that before you make anything.</p>
      <div class="verdict ${vcls}"><span class="badge ${vcls}">${vtitle}</span><p>${vtext}</p></div>
      <h3>How this plan did on past prices</h3>
      ${tested}
      <div class="periods">${rows}</div>
      ${randomLine}
      ${chart}
      <p class="muted">Final test: ${t.targets_hit} targets hit, ${t.stops_hit} stop-losses hit, ${timeExits} sold on time.
        Charges paid: ${inr(t.charges)}. Income tax on profits (20% short-term capital gains) is not included.</p>
      <details><summary>See all ${t.trades} trades from the final test</summary>
        <div class="table-wrap"><table>
          <thead><tr><th>Stock</th><th>Bought</th><th class="r">Price</th><th>Sold</th><th class="r">Price</th><th class="r">Shares</th><th class="r">Profit after charges</th><th>Why sold</th></tr></thead>
          <tbody>${log}</tbody></table></div></details>
      <details><summary>Other strategies tested for this amount</summary>
        <p class="muted">The ${b.candidates.length} best of ${BT.combos_tested} combinations after training. ★ is the one picked on the checking period.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Pattern</th><th>Target / stop / days</th><th class="r">Training</th><th class="r">Checking</th><th class="r">Final test</th></tr></thead>
          <tbody>${cands}</tbody></table></div></details>
    </div>`;
  }

  function renderBuy(cap) {
    const b = bucketFor(cap);
    if (!b.chosen) { $('#buy').innerHTML = ''; return; }
    const k = parseKey(b.chosen), v = BT.variants[k.vid];
    const per = cap / b.slots;
    const buyDay = nextWeekday(TD.data_date);
    const picks = [], tooDear = [];
    for (const s of TD.signals[k.vid] || []) {
      const st = TD.stocks[s.s];
      if (!st) continue;
      const shares = affordableShares(per, st.close);
      (shares >= 1 ? picks : tooDear).push({ sym: s.s, st, shares });
    }
    const freq = signalsPerMonth(k.vid);
    let body;
    if (!picks.length) {
      body = `<p class="empty"><b>No buy signal today${tooDear.length ? ' that fits your amount' : ''}.</b> That’s normal: do nothing and check again
        after the next market close. This pattern shows up about ${freq.toFixed(freq < 3 ? 1 : 0)} times a month across the Nifty 100.</p>`;
    } else {
      body = picks.map((p, i) => {
        const price = p.st.close, target = price * (1 + k.tg), stop = price * (1 - k.st);
        const invest = p.shares * price + buyCharges(p.shares * price);
        const win = netPnl(p.shares, price, target), loss = netPnl(p.shares, price, stop);
        const top = i < b.slots;
        return `<div class="pick${top ? ' top' : ''}">
          <div class="pick-head">
            <div><div class="pick-name">${esc(p.st.name)}</div>
              <div class="pick-sym">${esc(p.sym)} · ${esc(p.st.industry)} ${top ? `<span class="badge info">${b.slots === 1 ? 'Top pick' : 'Pick #' + (i + 1)}</span>` : ''}</div></div>
            ${sparkline(p.st.bars)}
          </div>
          <div class="pick-grid">
            <div><span>Last close</span><b class="num">${inr(price, 2)}</b> <small class="${cls(p.st.chg)}">${p.st.chg == null ? '' : (p.st.chg > 0 ? '+' : '') + pct(p.st.chg, 1)}</small></div>
            <div><span>Buy</span><b class="num">${p.shares} share${p.shares > 1 ? 's' : ''}</b> <small>≈ ${inr(invest)} with charges</small></div>
            <div><span>Target (sell)</span><b class="num up">${inr(target, 2)}</b> <small class="${cls(win)}">${signedInr(win)} after charges</small></div>
            <div><span>Stop-loss (sell)</span><b class="num down">${inr(stop, 2)}</b> <small class="down">${signedInr(loss)} after charges</small></div>
          </div>
          ${win <= 0 ? '<p class="error">Charges would eat the whole profit even if the target is hit. Skip this one.</p>' : ''}
          <div class="btn-row"><button class="btn small ghost" data-add="${esc(p.sym)}" data-shares="${p.shares}">Add to My trades after buying</button></div>
        </div>`;
      }).join('');
      if (picks.length > b.slots) {
        body += `<p class="muted" style="margin-top:.6rem">You only have room for ${b.slots} stock${b.slots > 1 ? 's' : ''}. Take the highest one${b.slots > 1 ? 's' : ''} first (they are sorted by 6-month strength, like in testing) and skip the rest.</p>`;
      }
    }
    const dear = tooDear.length ? `<p class="muted" style="margin-top:.6rem">Also signalled but too expensive for ${inr(per)}:
      ${tooDear.map(p => `${esc(p.sym)} (${inr(p.st.close)})`).join(', ')}.</p>` : '';
    $('#buy').innerHTML = `<div class="card">
      <span class="label">Buy list · for ${fmtDay(buyDay)} (next trading day)</span>
      <h2>${picks.length ? 'Buy at the market open' : 'Nothing to buy'}</h2>
      <p class="muted">Based on the close of ${fmtDay(TD.data_date)}. Pattern: ${esc(v.name)}.
        ${b.slots === 1 ? 'Only buy if you don’t already hold a stock from this plan.'
          : `Only buy if you hold fewer than ${b.slots} stocks from this plan.`}
        Target and stop-loss are worked out from the last close; after you buy, save the trade below with your real price.</p>
      ${body}${dear}
    </div>`;
  }

  function tradeStatus(t) {
    const s = TD.stocks[t.sym];
    if (!s) return { state: 'nodata' };
    const target = t.price * (1 + t.tg / 100), stop = t.price * (1 - t.st / 100);
    const out = { target, stop, close: s.close };
    if (t.date > TD.data_date) return { ...out, state: 'new' };
    const first = TD.dates.findIndex(d => d >= t.date);
    out.partial = t.date < TD.dates[0];
    let held = out.partial ? null : 0;
    for (let i = Math.max(first, 0); i < TD.dates.length; i++) {
      const bar = s.bars[i];
      if (!bar || bar[2] == null) continue;
      if (held != null) held++;
      if (bar[2] <= stop) return { ...out, state: 'stop', on: TD.dates[i], at: Math.min(stop, bar[0]) };
      if (bar[1] >= target) return { ...out, state: 'target', on: TD.dates[i], at: Math.max(target, bar[0]) };
      if (held != null && held >= t.hold) return { ...out, state: 'time', on: TD.dates[i], at: bar[3] };
    }
    return { ...out, state: 'hold', left: held == null ? null : t.hold - held };
  }

  function renderMyTrades(cap) {
    const trades = store.get(KEYS.trades, []);
    const list = trades.map(t => {
      const s = tradeStatus(t), st = TD.stocks[t.sym];
      const name = st ? st.name : t.sym;
      let badge, note, pnl = null, card = '';
      if (s.state === 'nodata') {
        badge = '<span class="badge warn">No price data</span>';
        note = 'This stock is not in the Nifty 100 list the tool follows, so it can’t check it.';
      } else if (s.state === 'new') {
        badge = '<span class="badge info">Waiting</span>';
        note = `Bought after the last update (${fmtDay(TD.data_date)}). Check again after the next market close.`;
      } else if (s.state === 'stop') {
        pnl = netPnl(t.qty, t.price, s.at); card = ' sell';
        badge = '<span class="badge bad">SELL · stop-loss hit</span>';
        note = `The price fell to ${inr(s.stop, 2)} on ${fmtDay(s.on)}. If your stop-loss order didn’t sell it, sell at the next market open. Small losses like this are part of the plan.`;
      } else if (s.state === 'target') {
        pnl = netPnl(t.qty, t.price, s.at); card = ' sell win';
        badge = '<span class="badge good">SELL · target hit</span>';
        note = `The price reached ${inr(s.target, 2)} on ${fmtDay(s.on)}. If your target order didn’t sell it, sell at the next market open.`;
      } else if (s.state === 'time') {
        pnl = netPnl(t.qty, t.price, s.at); card = ' sell';
        badge = '<span class="badge warn">SELL · time is up</span>';
        note = `Held for ${t.hold} trading days without hitting the target or stop-loss. Sell at the next market open.`;
      } else {
        pnl = netPnl(t.qty, t.price, s.close);
        badge = '<span class="badge info">HOLD</span>';
        note = s.left == null ? 'Bought before the last 70 days of saved prices, so the days left can’t be counted. Keep the target and stop-loss.'
          : `${s.left} trading day${s.left === 1 ? '' : 's'} left. Keep your target and stop-loss orders in place.`;
      }
      return `<div class="trade${card}">
        <div class="trade-top"><div><b>${esc(name)}</b> <small>${esc(t.sym)}</small></div>${badge}</div>
        <p>${note}</p>
        <p class="num"><small>Bought ${t.qty} × ${inr(t.price, 2)} on ${fmtDate(t.date)} ·
          Target ${inr(s.target, 2)} · Stop ${inr(s.stop, 2)} · Now ${inr(s.close, 2)}</small></p>
        ${pnl == null ? '' : `<p><b class="${cls(pnl)}">${signedInr(pnl, 2)}</b> <small>${s.state === 'hold' ? 'if sold at the last close' : 'at the exit price'}, after charges</small></p>`}
        <div class="btn-row"><button class="btn small ghost" data-del="${esc(t.id)}">${s.state === 'hold' || s.state === 'new' ? 'Remove' : 'I sold it — remove'}</button></div>
      </div>`;
    }).join('');
    $('#mytrades').innerHTML = `<div class="card">
      <span class="label">My trades · when to sell</span>
      <h2>Your open trades</h2>
      <p class="muted">Save each stock you buy here. Every evening the page checks the new prices and tells you to
        <b>HOLD</b> or <b>SELL</b>. Saved only in this browser on this phone.</p>
      ${list || '<p class="empty">No trades saved yet.</p>'}
      <div class="btn-row"><button class="btn" id="addTrade">Add a trade</button></div>
      <div id="formSlot"></div>
    </div>`;
    $('#addTrade').onclick = () => openForm({});
  }

  function openForm(prefill) {
    const cap = currentCapital(), b = bucketFor(cap), k = b.chosen ? parseKey(b.chosen) : { tg: 0.1, st: 0.05, hd: 20 };
    const slot = $('#formSlot');
    slot.innerHTML = '';
    const form = $('#tradeForm').content.firstElementChild.cloneNode(true);
    const sel = form.elements.sym;
    for (const sym of Object.keys(TD.stocks).sort()) {
      const o = document.createElement('option');
      o.value = sym; o.textContent = `${sym} · ${TD.stocks[sym].name}`;
      sel.append(o);
    }
    sel.value = prefill.sym || sel.options[0].value;
    form.elements.date.value = prefill.date || isoDay(new Date());
    form.elements.price.value = prefill.price ?? TD.stocks[sel.value].close;
    form.elements.qty.value = prefill.qty ?? 1;
    form.elements.tg.value = Math.round(k.tg * 100);
    form.elements.st.value = Math.round(k.st * 100);
    form.elements.hold.value = k.hd;
    sel.onchange = () => { form.elements.price.value = TD.stocks[sel.value].close; };
    form.onsubmit = e => {
      e.preventDefault();
      const f = form.elements;
      const t = {
        id: String(Date.now()), sym: f.sym.value, date: f.date.value,
        price: +f.price.value, qty: Math.round(+f.qty.value), tg: +f.tg.value, st: +f.st.value, hold: Math.round(+f.hold.value),
      };
      if (!t.date || !(t.price > 0) || !(t.qty >= 1) || !(t.tg > 0) || !(t.st > 0) || !(t.hold >= 1)) return;
      store.set(KEYS.trades, [...store.get(KEYS.trades, []), t]);
      renderMyTrades(cap);
      $('#mytrades').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    slot.append(form);
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderPatterns() {
    const ex = BT.standard_exit;
    const rows = Object.values(BT.variants).map(v => {
      const sigs = TD.signals[v.id] || [];
      const ps = BT.pattern_stats[v.id]?.test || {};
      return { v, sigs, ps };
    });
    const active = rows.filter(r => r.sigs.length);
    const quiet = rows.filter(r => !r.sigs.length);
    const block = ({ v, sigs, ps }) => `<div class="pattern">
      <b>${esc(v.name)}</b> <small class="muted">· ${esc(v.family)}</small>
      <p class="muted">${esc(v.desc)}</p>
      <p><small>Final test (+${ex[0] * 100}% target, −${ex[1] * 100}% stop, ${ex[2]} days, before charges):
        ${ps.n ? `${ps.n} trades, ${pct(ps.win)} won, average <span class="${cls(ps.avg)}">${ps.avg > 0 ? '+' : ''}${pct(ps.avg, 1)}</span> per trade` : 'not enough trades'}</small></p>
      <div class="stock-chips">${sigs.map(s => `<span class="stock-chip">${esc(s.s)} ${inr(TD.stocks[s.s]?.close ?? s.c)}</span>`).join('')}</div>
    </div>`;
    $('#patterns').innerHTML = `<div class="card">
      <span class="label">Chart patterns found on ${fmtDay(TD.data_date)}</span>
      <h2>All patterns today</h2>
      <p class="muted">Every pattern the tool scans for, and which stocks show it today. Your plan above uses only the one that
        tested best for your amount. The others are for learning, so you can see how often each pattern worked.</p>
      ${active.length ? active.map(block).join('') : '<p class="empty">No patterns found today.</p>'}
      ${quiet.length ? `<details><summary>${quiet.length} patterns with no stocks today</summary>${quiet.map(block).join('')}</details>` : ''}
    </div>`;
  }

  function renderMethod() {
    const fixes = Object.entries(BT.data_fixes || {}).flatMap(([s, list]) => list.map(f => `${esc(s)} (${fmtDate(f.date)})`));
    const nVariants = Object.keys(BT.variants).length, g = BT.grid;
    $('#method').innerHTML = `<div class="card">
      <span class="label">How it was tested</span>
      <h2>${BT.combos_tested} combinations, ${g.capitals.length} amounts</h2>
      <ul class="plain">
        <li><b>${nVariants} chart patterns</b> × ${g.targets.length} targets (${g.targets.map(x => '+' + x * 100 + '%').join(', ')})
          × ${g.stops.length} stop-losses (${g.stops.map(x => '−' + x * 100 + '%').join(', ')}) × ${g.holds.length} holding times
          (${g.holds.join(', ')} trading days), on ${BT.n_stocks} Nifty 100 stocks from ${fmtDate(BT.data_start)} to ${fmtDate(BT.data_end)}.</li>
        <li><b>Real money rules:</b> whole shares only, Groww’s delivery charges on every buy and sell (brokerage, STT, stamp duty,
          exchange fees, ₹20 DP charge, GST), and only as many stocks at once as your amount allows.</li>
        <li><b>No peeking at the future:</b> a pattern is spotted at the close and bought at the <i>next</i> day’s open. If the target and
          stop-loss are both touched on the same day, the test assumes the stop-loss came first.</li>
        <li><b>Three separate periods:</b> the best ${BT.buckets[0].candidates.length} combinations are shortlisted on
          ${periodRange('train')}, the winner is picked on ${periodRange('validate')}, and the final test on
          ${periodRange('test')} was never used for picking, so it shows how the pick would really have done.</li>
        <li><b>Luck check:</b> the winner is compared with 100 runs of random stock picks using the same target, stop-loss and amount.</li>
      </ul>
      <h3>Limits to keep in mind</h3>
      <ul class="plain">
        <li>It uses <b>today’s</b> Nifty 100 list for all past years. Stocks that are in the index now did well to get there, so past results look better than they really were.</li>
        <li>It assumes you get the exact target and stop-loss price. In real trading, prices can jump past your order.</li>
        <li>Income tax on profits (20% short-term capital gains) is not included.</li>
        <li>Prices come from Yahoo Finance, with missing days filled from NSE’s official bhavcopy.${fixes.length ? ` Price gaps caused by bonus issues or demergers were adjusted for: ${fixes.join(', ')}.` : ''}</li>
      </ul>
    </div>`;
  }

  function renderHowTo() {
    $('#howto').innerHTML = `<div class="card">
      <span class="label">How to use it</span>
      <h2>Your daily routine (5 minutes)</h2>
      <ol class="steps">
        <li><b>After 7 PM on a trading day</b>, open this page. The top line shows which day’s closing prices it is using.</li>
        <li><b>Check “My trades” first.</b> If a trade says <b>SELL</b>, sell it on Groww the next morning.</li>
        <li><b>If you have a free slot</b>, look at the Buy list. Buy the top pick at the next market open (9:15–9:30 AM) as a
          <b>Delivery</b> order, not Intraday.</li>
        <li><b>Right after buying</b>, tap “Add to My trades” and enter your real buy price. Then set your target and stop-loss on Groww,
          for example with a GTT (Good Till Triggered) order or a price alert, so you don’t have to watch the screen.</li>
        <li><b>Follow the rules every time.</b> Never skip the stop-loss, and never buy more stocks than your plan says.</li>
        <li><b>No signal? Do nothing.</b> Most days have no trade. That’s normal.</li>
      </ol>
      <p class="muted">Tip: for your first few weeks, just write the signals down without buying (paper trading) and see how they turn out.</p>
    </div>`;
  }

  function renderHeader() {
    const daysOld = (new Date() - asDate(TD.data_date)) / 864e5;
    const stale = daysOld > 5 ? ` <span class="error">· These prices are ${Math.floor(daysOld)} days old. The daily update may have failed.</span>` : '';
    $('#dataLine').innerHTML = `Using closing prices of <b>${fmtDay(TD.data_date)}</b> · updates every trading day around 7 PM IST${stale}`;
    $('#foot').innerHTML = `<p>Signals updated ${esc(TD.generated_at.replace('T', ' '))} IST · strategies re-tested ${esc(BT.generated_at.replace('T', ' '))} IST.</p>
      <p>Data: Yahoo Finance and NSE. Charges: Groww pricing page. This page is a learning tool, not investment advice, and is not from a SEBI-registered adviser.
      <a href="https://github.com/chudasamaayui0502-droid/ayushchudasama.github.io/tree/main/screener">How it works (code)</a>.</p>`;
  }

  // ---- capital input ----
  const input = () => $('#capital');
  const currentCapital = () => Math.max(0, Math.floor(+input().value || 0));

  function renderCapitalDependent() {
    const cap = currentCapital();
    for (const chip of document.querySelectorAll('.chip')) chip.setAttribute('aria-pressed', String(+chip.dataset.cap === cap));
    if (cap < 100) {
      $('#plan').innerHTML = '<div class="card"><p>Enter at least ₹100.</p></div>';
      $('#buy').innerHTML = '';
      return;
    }
    store.set(KEYS.capital, cap);
    renderPlan(cap);
    renderBuy(cap);
    renderMyTrades(cap);
  }

  function init() {
    renderHeader();
    $('#capitalChips').innerHTML = BT.grid.capitals.map(c => `<button type="button" class="chip" data-cap="${c}">${inr(c)}</button>`).join('');
    input().value = store.get(KEYS.capital, 1000);
    let timer;
    input().addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(renderCapitalDependent, 250); });
    $('#capitalChips').addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      input().value = chip.dataset.cap;
      renderCapitalDependent();
    });
    document.body.addEventListener('click', e => {
      const add = e.target.closest('[data-add]');
      if (add) {
        openForm({ sym: add.dataset.add, qty: +add.dataset.shares, date: nextWeekday(TD.data_date) });
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del && confirm('Remove this trade from the list?')) {
        store.set(KEYS.trades, store.get(KEYS.trades, []).filter(t => t.id !== del.dataset.del));
        renderMyTrades(currentCapital());
      }
    });
    renderCapitalDependent();
    renderPatterns();
    renderMethod();
    renderHowTo();
  }

  async function load() {
    try {
      const get = url => fetch(url, { cache: 'no-cache' }).then(r => {
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        return r.json();
      });
      [BT, TD] = await Promise.all([get('data/backtest.json'), get('data/today.json')]);
    } catch (err) {
      $('#dataLine').innerHTML = `<span class="error">Could not load the price data (${esc(err.message)}). Try again in a minute.</span>`;
      return;
    }
    init();
  }

  load();
})();
