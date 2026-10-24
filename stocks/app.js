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
  const p100 = x => Math.round(x * 100);  // 0.07 * 100 is 7.000000000000001
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
    unproven: ['bad', 'No strategy passed at this amount',
      'None of the {combos} combinations made money after charges in both training and checking at this amount. The plan shown is only the least bad one, so treat its signals as practice.'],
    loss: ['bad', 'Lost money in the final test',
      'Following the best plan for this amount lost money in the final test (middle of several start dates), mostly because charges are large compared with small trades. Practise on paper or add more money first.'],
    none: ['bad', 'Not enough data', 'No strategy had enough trades to test at this amount.'],
  };

  const parseKey = key => {
    const [vid, tg, st, hd] = key.split('|');
    return { vid, tg: +tg / 100, st: +st / 100, hd: +hd };
  };
  const ruleSummary = k => k.tg
    ? `+${p100(k.tg)}% / −${p100(k.st)}% / ${k.hd} days`
    : `trailing stop −${p100(k.st)}% / up to ${k.hd} days`;
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
    const [vcls, vtitle, vtextRaw] = VERDICTS[b.verdict] || VERDICTS.none;
    const vtext = vtextRaw.replace('{combos}', BT.combos_tested);
    const tested = b.capital === cap ? '' :
      `<p class="muted">Test results below are for ${inr(b.capital)}, the closest tested amount at or below yours.</p>`;
    const signedPct = x => (x > 0 ? '+' : x < 0 ? '−' : '') + pct(Math.abs(x), 1);
    const avgTrade = name => {
      const q = c.avg_trade[name];
      return q && q.n ? `${q.n} signals, average <span class="${cls(q.avg)}">${signedPct(q.avg)}</span> per trade after charges, ${pct(q.win)} won`
        : 'not enough signals';
    };
    const rows = ['train', 'validate', 'test'].map(name => {
      const r = c.spread[name], bench = b.benchmark[name];
      const range = name === 'test' ? ` (range ${inr(r.low)} – ${inr(r.high)})` : '';
      return `<div class="period${name === 'test' ? ' final' : ''}">
        <div><b>${PERIOD_LABEL[name][0]}</b><small>${periodRange(name)} · ${PERIOD_LABEL[name][1]}</small></div>
        <div class="period-value"><small>${inr(b.capital)} became</small><b class="num ${cls(r.final - b.capital)}">${inr(r.final)}</b></div>
        <p class="period-meta num">With your money: about ${Math.round(r.trades)} trades, ${pct(r.win_rate)} won,
          worst fall −${pct(r.max_dd)}${range} · Nifty 50 ETF: ${bench ? inr(bench.final) : '–'}</p>
        <p class="period-meta num">Every signal: ${avgTrade(name)}</p>
      </div>`;
    }).join('');
    const ex = c.example, rnd = b.random;
    const todays = TD.signals[k.vid] || [], last = TD.last_signal?.[k.vid];
    const filterOk = v.filter ? TD.market?.filters?.[v.filter] : null;
    const planToday = `<p>${todays.length
        ? `Today this plan signals <b>${todays.map(s => esc(s.s)).join(', ')}</b>, marked ★ in the buy list above.`
        : `This plan has no signal today.${last ? ` Its last one was on <b>${fmtDate(last.date)}</b> (${last.stocks.map(s => esc(s.s)).join(', ')}).` : ''}`}
      ${v.filter ? ` It only buys when <b>${esc(v.name.split(' + ').pop())}</b>: today ${filterOk ? '<b class="up">yes</b>' : '<b class="down">no</b>'}.` : ''}</p>`;
    const randomLine = rnd ? `<p>With the same target, stop-loss and amount, <b>random</b> stock picks turned ${inr(b.capital)} into
      <b>${inr(rnd.median)}</b> (middle of ${rnd.runs} random runs). This plan did better than <b>${pct(rnd.beat_pct)}</b> of them.</p>` : '';
    const passed = b.passed_train_and_validate;
    const passedLine = `<p><b>${passed} of ${BT.combos_tested}</b> combinations made money after charges in both training and checking
      at ${inr(b.capital)}.${passed === 0 ? ' <b>None did.</b> At this amount, charges eat more than the patterns earn.' : ''}</p>`;
    const timeExits = ex.trades - ex.targets_hit - ex.stops_hit;
    const chart = lineChart([
      { pts: ex.curve, color: 'var(--accent)', label: 'This plan (example run)' },
      { pts: b.benchmark.test?.curve, color: 'var(--muted)', label: 'Nifty 50 ETF (buy and hold)' },
    ], fmtDate(ex.start), fmtDate(ex.end));
    const log = (ex.trades_log || []).map(([sym, bd, bp, sd, sp, sh, pnl, kind]) => {
      const [label, kc] = kind === 1 && !k.tg ? ['Trailing stop', ''] : KIND[kind] || ['', ''];
      return `<tr><td><b>${esc(sym)}</b></td><td>${fmtDate(bd)}</td><td class="r num">${inr(bp, 2)}</td>
        <td>${fmtDate(sd)}</td><td class="r num">${inr(sp, 2)}</td><td class="r num">${sh}</td>
        <td class="r num ${cls(pnl)}">${signedInr(pnl, 2)}</td><td class="${kc}">${label}</td></tr>`;
    }).join('');
    const yearly = x => `<span class="${cls(x)}">${signedPct(x)}</span>`;
    const cands = b.candidates.map(o => {
      const ok = parseKey(o.key), ov = BT.variants[ok.vid], t = o.spread.test;
      return `<tr><td>${o.key === b.chosen ? '★ ' : ''}${esc(ov.name)}<br><small>${ruleSummary(ok)}</small></td>
        <td class="r num">${yearly(o.train_est)}</td><td class="r num">${yearly(o.validate_est)}</td>
        <td class="r num ${cls(t.final - b.capital)}">${inr(t.final)}</td></tr>`;
    }).join('');

    $('#plan').innerHTML = `<div class="card">
      <span class="label">The tested plan for ${inr(cap)}</span>
      <h2>${esc(v.name)}</h2>
      <p>${esc(v.desc)}</p>
      <div class="rules">${k.tg ? `
        <div class="rule"><b class="up">+${p100(k.tg)}%</b><span>Target: sell when up ${p100(k.tg)}%</span></div>
        <div class="rule"><b class="down">−${p100(k.st)}%</b><span>Stop-loss: sell when down ${p100(k.st)}%</span></div>
        <div class="rule"><b>${k.hd} days</b><span>Otherwise sell after ${k.hd} trading days</span></div>` : `
        <div class="rule"><b class="up">No cap</b><span>No fixed target: let winners run</span></div>
        <div class="rule"><b class="down">−${p100(k.st)}%</b><span>Sell if it falls ${p100(k.st)}% below its highest close since buying</span></div>
        <div class="rule"><b>${k.hd} days</b><span>Or sell after ${k.hd} trading days at most</span></div>`}
      </div>
      <p>Hold <b>${b.slots} stock${b.slots > 1 ? 's' : ''}</b> at a time (about ${inr(per)} each).
        Each buy + sell of ${inr(per)} costs about <b>${inr(cost, 2)}</b> in Groww charges
        (<b>${pct(cost / per, 1)}</b>), so a stock must rise more than that before you make anything.</p>
      <div class="verdict ${vcls}"><span class="badge ${vcls}">${vtitle}</span><p>${vtext}</p></div>
      ${planToday}
      <h3>How this plan did on past prices</h3>
      ${tested}
      ${passedLine}
      <p class="muted">“Every signal” is the pattern’s average trade across all Nifty 100 stocks. “${inr(b.capital)} became” is what following it with
        your money would have done: with ${b.slots === 1 ? 'one stock' : b.slots + ' stocks'} at a time you only catch some of the signals, so luck
        matters a lot. Each ₹ figure is the middle of ${BT.start_offsets} runs started on different weeks.</p>
      <div class="periods">${rows}</div>
      ${randomLine}
      <h3>One example run</h3>
      ${chart}
      <p class="muted">Starting ${fmtDate(ex.start)}: ${inr(b.capital)} became ${inr(ex.final)}. ${k.tg ? `${ex.targets_hit} targets hit, ${ex.stops_hit} stop-losses hit, ${timeExits} sold on time.`
          : `${ex.stops_hit} sold by the trailing stop, ${timeExits} at the time limit.`} Charges paid: ${inr(ex.charges)}. Income tax on profits (20% short-term capital gains) is not included.</p>
      <details><summary>See all ${ex.trades} trades from this example run</summary>
        <div class="table-wrap"><table>
          <thead><tr><th>Stock</th><th>Bought</th><th class="r">Price</th><th>Sold</th><th class="r">Price</th><th class="r">Shares</th><th class="r">Profit after charges</th><th>Why sold</th></tr></thead>
          <tbody>${log}</tbody></table></div></details>
      <details><summary>Other strategies tested for this amount</summary>
        <p class="muted">The ${b.candidates.length} steadiest of ${BT.combos_tested} combinations. Training and checking show the estimated
          yearly return from the average trade, used to pick (★). The final test was never used for picking.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Pattern</th><th class="r">Training</th><th class="r">Checking</th><th class="r">Final test</th></tr></thead>
          <tbody>${cands}</tbody></table></div></details>
    </div>`;
  }

  function healthChips(sym) {
    const f = TD.fundamentals?.[sym];
    if (!f) return '<p class="muted"><small>Company numbers not available.</small></p>';
    const chips = [];
    let warnings = 0;
    const add = (label, cls) => {
      if (cls === 'warn' || cls === 'bad') warnings++;
      chips.push(`<span class="badge ${cls}">${label}</span>`);
    };
    if (f.margin != null) add(`Profit margin ${pct(f.margin, 1)}`, f.margin < 0 ? 'bad' : 'good');
    if (f.earn_growth != null) add(`Profit growth ${f.earn_growth > 0 ? '+' : ''}${pct(f.earn_growth)}`, f.earn_growth < 0 ? 'warn' : 'good');
    if (f.rev_growth != null) add(`Sales growth ${f.rev_growth > 0 ? '+' : ''}${pct(f.rev_growth)}`, f.rev_growth < 0 ? 'warn' : 'good');
    if (f.de != null) add(`Debt/equity ${(f.de / 100).toFixed(2)}`, f.de > 150 ? 'warn' : 'good');
    if (f.pe != null) add(`P/E ${f.pe.toFixed(1)}`, f.pe < 0 ? 'bad' : f.pe > 60 ? 'warn' : 'info');
    if (f.roe != null) add(`ROE ${pct(f.roe)}`, f.roe < 0.08 ? 'warn' : 'good');
    return `<div class="health"><small class="muted">Company check (latest numbers, not part of the test):
      ${warnings ? `<b class="down">${warnings} warning${warnings > 1 ? 's' : ''}</b>` : '<b class="up">no warnings</b>'}</small>
      <div class="stock-chips">${chips.join('')}</div></div>`;
  }

  const newsLink = (name) =>
    `<a href="https://news.google.com/search?q=${encodeURIComponent(name + ' share')}&hl=en-IN&gl=IN&ceid=IN%3Aen" target="_blank" rel="noopener">Latest news ↗</a>`;

  const ruleOf = r => {
    const [tg, st, hd] = r.rule.split('|').map(Number);
    return { tg: tg / 100, st: st / 100, hd };
  };
  function weeksText(days) {
    const lo = Math.max(1, Math.round(days[0] / 5)), hi = Math.max(lo, Math.round(days[2] / 5));
    return lo === hi ? `about ${lo} week${lo > 1 ? 's' : ''}` : `${lo}–${hi} weeks`;
  }

  // Every stock any tested pattern signals today, with that pattern's rule and track record at this amount
  function todaysSignals(cap) {
    const b = bucketFor(cap), per = cap / b.slots;
    const planVid = b.chosen ? parseKey(b.chosen).vid : null;
    const byStock = new Map();
    for (const [vid, list] of Object.entries(TD.signals)) {
      const r = BT.pattern_rules?.[vid]?.[String(b.capital)];
      if (!r || !r.ends || !list.length) continue;  // not enough past trades to judge
      for (const s of list) {
        const e = { vid, r, plan: vid === planVid };
        const cur = byStock.get(s.s);
        if (!cur) { byStock.set(s.s, { sym: s.s, best: e, others: [] }); continue; }
        if (e.plan || (!cur.best.plan && e.r.steady > cur.best.r.steady)) { cur.others.push(cur.best); cur.best = e; }
        else cur.others.push(e);
      }
    }
    const rows = [];
    for (const x of byStock.values()) {
      const st = TD.stocks[x.sym];
      if (st) rows.push({ ...x, st, shares: affordableShares(per, st.close) });
    }
    rows.sort((a, z) => (z.best.plan - a.best.plan) || (z.best.r.steady - a.best.r.steady) || ((z.st.m ?? -1) - (a.st.m ?? -1)));
    return { b, per, planVid, ok: rows.filter(x => x.shares >= 1), dear: rows.filter(x => x.shares < 1) };
  }

  function signalCard(x, b, per, rank, weak) {
    const r = x.best.r, k = ruleOf(r), v = BT.variants[x.best.vid];
    const price = x.st.close, target = price * (1 + k.tg), stop = price * (1 - k.st);
    const invest = x.shares * price + buyCharges(x.shares * price);
    const win = netPnl(x.shares, price, target), loss = netPnl(x.shares, price, stop);
    const avg = r.avg.test;
    const base = n => n.split(' + ')[0];
    const also = [...new Set(x.others.map(o => base(BT.variants[o.vid].name)))].filter(n => n !== base(v.name));
    const rankLabel = rank === 1 ? (weak ? 'Best of today’s list' : 'Top pick') : rank <= b.slots ? 'In your slots' : '';
    return `<div class="pick${rank === 1 ? ' top' : ''}" id="pick-${esc(x.sym)}">
      <div class="pick-head">
        <div><div class="rank-row"><span class="rank">#${rank}</span>${rankLabel ? `<span class="badge ${rank === 1 && !weak ? 'good' : 'info'}">${rankLabel}</span>` : ''}</div>
          <div class="pick-name">${esc(x.st.name)}</div>
          <div class="pick-sym">${esc(x.sym)} · ${esc(x.st.industry)} ${x.best.plan ? '<span class="badge info">★ Tested plan</span>' : ''}</div></div>
        ${sparkline(x.st.bars)}
      </div>
      <div class="pick-grid">
        <div><span>Last close</span><b class="num">${inr(price, 2)}</b> <small class="${cls(x.st.chg)}">${x.st.chg == null ? '' : (x.st.chg > 0 ? '+' : '') + pct(x.st.chg, 1)}</small></div>
        <div><span>Buy</span><b class="num">${x.shares} share${x.shares > 1 ? 's' : ''}</b> <small>≈ ${inr(invest)} with charges</small></div>
        ${k.tg ? `<div><span>Target +${p100(k.tg)}% (sell)</span><b class="num up">${inr(target, 2)}</b> <small class="${cls(win)}">${signedInr(win)} after charges</small></div>
        <div><span>Stop-loss −${p100(k.st)}% (sell)</span><b class="num down">${inr(stop, 2)}</b> <small class="down">${signedInr(loss)} after charges</small></div>`
        : `<div><span>Target</span><b class="num up">None</b> <small>let it run while it keeps rising</small></div>
        <div><span>Starting stop −${p100(k.st)}%</span><b class="num down">${inr(stop, 2)}</b> <small class="down">${signedInr(loss)} after charges; rises with the price</small></div>`}
      </div>
      <p class="rule-line">${k.tg ? `Otherwise sell after ${k.hd} trading days`
        : `Sell when it falls ${p100(k.st)}% below its highest close since you bought, or after ${k.hd} trading days`} · Pattern: <b>${esc(v.name)}</b>${also.length ? ` <small>(also: ${esc(also.join(', '))})</small>` : ''}</p>
      <div class="history ${avg > 0 ? 'good' : 'bad'}">
        <b>How trades like this went at ${inr(b.capital)}</b>
        <p>${k.tg ? `${pct(r.ends.target)} reached the target${r.target_days ? `, usually after ${weeksText(r.target_days)}` : ''} ·
          ${pct(r.ends.stop)} hit the stop-loss · ${pct(r.ends.time)} were sold at the time limit.`
          : `${pct(r.ends.stop)} were sold by the trailing stop · ${pct(r.ends.time)} at the time limit.`}</p>
        <p>Final test (${periodRange('test')}): average <b class="${cls(avg)}">${avg > 0 ? '+' : ''}${pct(avg, 1)}</b> per trade after charges
          (about ${signedInr(avg * per)}), ${pct(r.test_win)} won, ${r.test_n} trades.</p>
      </div>
      ${k.tg && win <= 0 ? '<p class="error">Charges would eat the whole profit even if the target is hit. Skip this one.</p>' : ''}
      ${healthChips(x.sym)}
      <div class="btn-row"><button class="btn small ghost" data-add="${esc(x.sym)}" data-shares="${x.shares}" data-vid="${esc(x.best.vid)}">Add to My trades after buying</button>
        <span class="news">${newsLink(x.st.name)}</span></div>
    </div>`;
  }

  function renderBuy(cap) {
    const { b, per, ok, dear, planVid } = todaysSignals(cap);
    const cost = buyCharges(per) + sellCharges(per);
    const slotsNote = b.slots === 1
      ? `With ${inr(cap)} you can hold <b>1 stock</b> at a time, so buy one only if you don’t already hold one.`
      : `With ${inr(cap)} you can hold <b>${b.slots} stocks</b> at a time (about ${inr(per)} each).`;
    const weak = ok.length > 0 && ok.every(x => x.best.r.avg.test <= 0);
    const warn = weak
      ? `<div class="verdict bad"><span class="badge bad">Heads-up</span><p>At ${inr(b.capital)}, every one of these patterns
          <b>lost money on average</b> after charges in testing: each buy + sell of ${inr(per)} costs about ${inr(cost, 2)}.
          Some trades still win, but on average they lost. Always use the stop-loss, or paper-trade first.</p></div>` : '';
    let body;
    if (ok.length) {
      const take = Math.min(b.slots, ok.length);
      const ranking = `<div class="table-wrap"><table class="ranking">
          <thead><tr><th>#</th><th>Stock</th><th class="r">Price</th><th class="r">Avg trade</th></tr></thead>
          <tbody>${ok.map((x, i) => {
            const avg = x.best.r.avg.test;
            return `<tr${i < take ? ' class="in-slot"' : ''}><td><b>${i + 1}</b></td>
              <td><a href="#pick-${esc(x.sym)}">${esc(x.sym)}</a>${x.best.plan ? ' ★' : ''}<br><small>${esc(BT.variants[x.best.vid].name.split(' + ')[0])}</small></td>
              <td class="r num">${inr(x.st.close, 2)}</td><td class="r num ${cls(avg)}">${avg > 0 ? '+' : ''}${pct(avg, 1)}</td></tr>`;
          }).join('')}</tbody></table></div>
        <p class="muted rank-note">Ranked by: ① the tested plan’s own signals (★), ② how steadily the pattern made money after charges
          in training and checking at ${inr(b.capital)}, ③ 6-month strength, which is how the backtest chose between same-day signals.
          “Avg trade” is the final-test average after charges. ${take === 1 ? 'With 1 stock at a time, take <b>#1</b> only.'
            : `With ${b.slots} stocks at a time, take <b>#1–#${take}</b>.`}</p>`;
      body = ranking + ok.map((x, i) => signalCard(x, b, per, i + 1, weak)).join('');
    } else {
      const last = planVid && TD.last_signal?.[planVid];
      body = `<p class="empty"><b>No signals you can afford today.</b> Do nothing and check again after the next market close.</p>`
        + (last ? `<p>The tested plan’s last signal: <b>${fmtDate(last.date)}</b> · ${last.stocks.map(s => `${esc(s.s)} (${inr(s.c)} then${TD.stocks[s.s] ? `, ${inr(TD.stocks[s.s].close)} now` : ''})`).join(', ')}.</p>` : '');
    }
    const dearLine = dear.length ? `<p class="muted" style="margin-top:.6rem">Also signalled but too expensive for ${inr(per)}:
      ${dear.map(x => `${esc(x.sym)} (${inr(x.st.close)})`).join(', ')}.</p>` : '';
    $('#buy').innerHTML = `<div class="card">
      <span class="label">Buy signals · for ${fmtDay(nextWeekday(TD.data_date))} · ${inr(cap)}</span>
      <h2>${ok.length ? `${ok.length} stock${ok.length > 1 ? 's' : ''} you can buy` : 'Nothing to buy'}</h2>
      <p class="muted">From the close of ${fmtDay(TD.data_date)}: every stock a tested pattern signals today that fits your money,
        ranked below. Buy at the next market open (9:15–9:30 AM) as a <b>Delivery</b> order. ${slotsNote}</p>
      ${warn}${body}${dearLine}
    </div>`;
  }

  function renderMood(cap) {
    const m = TD.market;
    if (!m || !m.nifty) { $('#mood').innerHTML = ''; return; }
    const b = bucketFor(cap), v = b.chosen ? BT.variants[parseKey(b.chosen).vid] : null;
    const items = [
      m.nifty && { ok: m.nifty.up, title: 'Nifty 50', value: Math.round(m.nifty.close).toLocaleString('en-IN'),
        text: `${m.nifty.up ? 'Above' : 'Below'} its 200-day average (${Math.round(m.nifty.sma200).toLocaleString('en-IN')}): Indian market ${m.nifty.up ? 'rising' : 'falling'}` },
      m.vix && { ok: m.vix.calm, title: 'India VIX (fear gauge)', value: m.vix.close.toFixed(1),
        text: `${m.vix.calm ? 'Below' : 'Above'} ${m.vix_calm_below}: market is ${m.vix.calm ? 'calm' : 'nervous'}` },
      m.world && { ok: m.world.up, title: 'US market (S&P 500)', value: Math.round(m.world.close).toLocaleString('en-IN'),
        text: `${m.world.up ? 'Above' : 'Below'} its 200-day average: world markets ${m.world.up ? 'rising' : 'falling'}` },
    ].filter(Boolean);
    const good = items.filter(i => i.ok).length;
    const summary = good === items.length ? 'Good' : good === 0 ? 'Poor' : 'Mixed';
    const planLine = v && v.filter
      ? `Your plan uses the <b>${esc(v.name.split(' + ').pop())}</b> filter, because it made results steadier in testing.`
      : 'Your plan doesn’t use a market filter: for your amount, waiting for good market mood didn’t make results steadier.';
    $('#mood').innerHTML = `<div class="card">
      <span class="label">Market mood · ${fmtDay(TD.data_date)}</span>
      <h2>${summary}</h2>
      <div class="mood-grid">${items.map(i => `<div class="mood ${i.ok ? 'good' : 'bad'}">
        <small>${i.title}</small><b class="num">${i.value}</b><span>${i.text}</span></div>`).join('')}</div>
      <p class="muted">News such as wars, interest-rate changes, the budget, elections or a global crash shows up in these numbers within days.
        Each pattern was tested with and without waiting for good market mood. ${planLine}</p>
    </div>`;
  }

  function tradeStatus(t) {
    const s = TD.stocks[t.sym];
    if (!s) return { state: 'nodata' };
    const trail = !t.tg;
    const target = trail ? null : t.price * (1 + t.tg / 100), stop = t.price * (1 - t.st / 100);
    const out = { target, stop, close: s.close, trail };
    if (t.date > TD.data_date) return { ...out, state: 'new' };
    const first = TD.dates.findIndex(d => d >= t.date);
    out.partial = t.date < TD.dates[0];
    let held = out.partial ? null : 0;
    if (trail) {  // the stop sits st% below the highest close since buying, and only moves up
      let high = t.price;
      for (let i = Math.max(first, 0); i < TD.dates.length; i++) {
        const bar = s.bars[i];
        if (!bar || bar[2] == null) continue;
        if (held != null) held++;
        const level = high * (1 - t.st / 100);
        if (bar[2] <= level) return { ...out, state: 'stop', on: TD.dates[i], at: Math.min(level, bar[0]), stop: level };
        high = Math.max(high, bar[3]);
        if (held != null && held >= t.hold) return { ...out, state: 'time', on: TD.dates[i], at: bar[3] };
      }
      return { ...out, state: 'hold', left: held == null ? null : t.hold - held, high, stop: high * (1 - t.st / 100) };
    }
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
        if (s.trail) badge = '<span class="badge bad">SELL · trailing stop hit</span>';
        note = s.trail
          ? `The price fell to your trailing stop (${inr(s.stop, 2)}) on ${fmtDay(s.on)}. If your stop-loss order didn’t sell it, sell at the next market open.`
          : `The price fell to ${inr(s.stop, 2)} on ${fmtDay(s.on)}. If your stop-loss order didn’t sell it, sell at the next market open. Small losses like this are part of the plan.`;
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
          : `Day ${t.hold - s.left} of ${t.hold}: ${s.left} trading day${s.left === 1 ? '' : 's'} left. `
            + (s.trail ? `Your stop-loss is now <b>${inr(s.stop, 2)}</b>, ${t.st}% below the highest close since you bought (${inr(s.high, 2)}). If you use a stop-loss or GTT order on Groww, move it up to this price.`
              : 'Keep your target and stop-loss orders in place.')
            + (t.hint ? ` Trades like this that reached the target usually did so between day ${Math.round(t.hint[0])} and day ${Math.round(t.hint[2])}.` : '');
      }
      return `<div class="trade${card}">
        <div class="trade-top"><div><b>${esc(name)}</b> <small>${esc(t.sym)}</small></div>${badge}</div>
        <p>${note}</p>
        <p class="num"><small>Bought ${t.qty} × ${inr(t.price, 2)} on ${fmtDate(t.date)} ·
          ${s.trail ? `Trailing stop ${t.st}% · Stop now ${inr(s.stop, 2)}` : `Target ${inr(s.target, 2)} · Stop ${inr(s.stop, 2)}`} · Now ${inr(s.close, 2)}</small></p>
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
    form.elements.tg.value = prefill.tg ?? p100(k.tg);
    form.elements.st.value = prefill.st ?? p100(k.st);
    form.elements.hold.value = prefill.hold ?? k.hd;
    sel.onchange = () => { form.elements.price.value = TD.stocks[sel.value].close; };
    form.onsubmit = e => {
      e.preventDefault();
      const f = form.elements;
      const t = {
        id: String(Date.now()), sym: f.sym.value, date: f.date.value,
        price: +f.price.value, qty: Math.round(+f.qty.value), tg: +f.tg.value, st: +f.st.value, hold: Math.round(+f.hold.value),
      };
      if (!t.date || !(t.price > 0) || !(t.qty >= 1) || !(t.tg >= 0) || !(t.st > 0) || !(t.hold >= 1)) return;
      if (prefill.hint && t.sym === prefill.sym && t.hold === prefill.hold) t.hint = prefill.hint;
      store.set(KEYS.trades, [...store.get(KEYS.trades, []), t]);
      renderMyTrades(cap);
      $('#mytrades').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    slot.append(form);
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderPatterns() {
    const ex = BT.standard_exit;
    const rows = Object.values(BT.variants).filter(v => !v.filter).map(v => {
      const sigs = TD.signals[v.id] || [];
      const ps = BT.pattern_stats[v.id]?.test || {};
      return { v, sigs, ps };
    });
    const active = rows.filter(r => r.sigs.length);
    const quiet = rows.filter(r => !r.sigs.length);
    const block = ({ v, sigs, ps }) => `<div class="pattern">
      <b>${esc(v.name)}</b> <small class="muted">· ${esc(v.family)}</small>
      <p class="muted">${esc(v.desc)}</p>
      <p><small>Final test (+${p100(ex[0])}% target, −${p100(ex[1])}% stop, ${ex[2]} days, before charges):
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
    const nVariants = Object.values(BT.variants).filter(v => !v.filter).length, g = BT.grid;
    $('#method').innerHTML = `<div class="card">
      <span class="label">How it was tested</span>
      <h2>${BT.combos_tested.toLocaleString('en-IN')} combinations, ${g.capitals.length} amounts</h2>
      <ul class="plain">
        <li><b>${nVariants} chart patterns</b>, each on its own and with 3 market-mood filters (Nifty 50 rising, India VIX below 20,
          US S&amp;P 500 rising), × ${g.targets.length} targets (${g.targets.map(x => '+' + p100(x) + '%').join(', ')})
          × ${g.stops.length} stop-losses (${g.stops.map(x => '−' + p100(x) + '%').join(', ')}) × ${g.holds.length} holding times
          (${g.holds.join(', ')} trading days), plus trailing stops with no fixed target (${(g.trails || []).map(x => p100(x) + '%').join(', ')}
          below the highest close, held up to ${(g.trail_holds || []).join(' or ')} trading days), on ${BT.n_stocks} Nifty 100 stocks from ${fmtDate(BT.data_start)} to ${fmtDate(BT.data_end)}.</li>
        <li><b>Real money rules:</b> whole shares only, Groww’s delivery charges on every buy and sell (brokerage, STT, stamp duty,
          exchange fees, ₹20 DP charge, GST), and only as many stocks at once as your amount allows.</li>
        <li><b>No peeking at the future:</b> a pattern is spotted at the close and bought at the <i>next</i> day’s open. If the target and
          stop-loss are both touched on the same day, the test assumes the stop-loss came first.</li>
        <li><b>Picked on the average trade:</b> every trade each combination made is averaged after charges at your amount, in training
          (${periodRange('train')}) and checking (${periodRange('validate')}). The combination whose <i>weaker</i> period was best wins.
          Averages over thousands of trades hardly change when a few prices do, so the pick is stable.</li>
        <li><b>Then followed with your money:</b> the pick is run with whole shares, charges and only as many stocks as you can afford,
          starting on ${BT.start_offsets} different weeks. The page shows the middle result and the range.</li>
        <li><b>Final test never used for picking:</b> ${periodRange('test')} shows how the pick would really have done.</li>
        <li><b>Luck check:</b> the plan is compared with 100 runs of random stock picks using the same target, stop-loss and amount.</li>
        <li><b>No flip-flopping:</b> strategies are re-tested every Saturday, but a new one only replaces your plan if it is clearly better
          (by ${pct(BT.switch_margin)} a year).</li>
      </ul>
      <h3>Limits to keep in mind</h3>
      <ul class="plain">
        <li>It uses <b>today’s</b> Nifty 100 list for all past years. Stocks that are in the index now did well to get there, so past results look better than they really were.</li>
        <li>It assumes you get the exact target and stop-loss price. In real trading, prices can jump past your order.</li>
        <li>Income tax on profits (20% short-term capital gains) is not included.</li>
        <li><b>News and company financials are not in the test.</b> There is no free day-by-day record of past news or past financial
          reports for Indian companies, and judging 2015 trades with today’s numbers would make the test look better than reality.
          Market mood is tested instead, and each buy signal shows the company’s latest numbers and a news link so you can check them yourself.</li>
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
        <li><b>If you have a free slot</b>, look at Buy signals. Each stock shows how trades like it went before; the list starts with the
          best track record. Buy at the next market open (9:15–9:30 AM) as a <b>Delivery</b> order, not Intraday.</li>
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
    renderMood(cap);
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
        const r = BT.pattern_rules?.[add.dataset.vid]?.[String(bucketFor(currentCapital()).capital)];
        const k = r ? ruleOf(r) : null;
        openForm({ sym: add.dataset.add, qty: +add.dataset.shares, date: nextWeekday(TD.data_date),
          ...(k && { tg: p100(k.tg), st: p100(k.st), hold: k.hd, hint: r.target_days }) });
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
