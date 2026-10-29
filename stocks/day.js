'use strict';

// Day trading and Live tabs. app.js loads the data and hands over its helpers
// through DayUI.init(); the rules themselves are in daylogic.js.
(() => {
  const L = window.DayLogic;
  let G, DT;  // helpers from app.js, and data/daytrade.json
  const $ = sel => document.querySelector(sel);
  const KEY = { margin: 'day.margin', trades: 'day.trades', auto: 'live.auto', target: 'day.target' };
  const FEED = 'https://priceapi.moneycontrol.com/techCharts/indianMarket';
  const INDICES = [['nifty', 'in;NSX', 'Nifty 50'], ['bank', 'in;nbx', 'Bank Nifty'], ['vix', 'in;IDXN', 'India VIX']];
  const LIVE_EVERY = 60_000;
  const SQUARE_OFF = '₹59 (₹50 + GST)';

  const PERIOD = {
    pick1: ['Picking, part 1', 'used to pick'],
    pick2: ['Picking, part 2', 'used to pick'],
    test: ['Final test', 'never used for picking'],
  };
  const VERDICT = {
    good: ['good', 'Passed every test',
      'It made money after charges in both picking periods and in the final test, and did better than most random trades with the same rules. Past results still don’t guarantee future profit, so start small.'],
    luck: ['warn', 'Made money, but it may be luck',
      'It made money in the final test, but random trades with the same stop-loss, target and money often did about as well. Practise on paper first.'],
    recent_only: ['warn', 'Worked this year, but not over 11 years',
      'It made money in the 5-minute tests, but on daily prices from 2015 its basic idea lost money. It may have been a lucky year. Practise on paper first.'],
    unproven: ['bad', 'No day-trading setup passed at this amount',
      'None of the {combos} combinations made money after charges in both picking periods at this amount. The plan shown is only the least bad one. <b>Don’t use real money:</b> practise it on paper with the Live tab.'],
    loss: ['bad', 'Lost money in the final test',
      'Following the best plan for this amount lost money in the final test, after charges. <b>Don’t use real money:</b> practise it on paper with the Live tab, or use the swing plan instead.'],
    none: ['bad', 'Not enough data', 'No setup had enough trades to test at this amount.'],
  };

  // ---- small helpers ----
  const inr = (x, d = 0) => G.inr(x, d);
  const pctTxt = (x, d = 1) => G.pct(x, d);
  const signed = (x, d = 0) => G.signedInr(x, d);
  const tick = x => Math.round(x * 20) / 20;  // NSE prices move in 5 paise
  const sideWord = side => side > 0 ? 'Buy' : 'Short-sell';
  const parseKey = key => {
    const [sid, st, tg] = key.split('|');
    return { sid, st: +st / 1000, tg: +tg / 1000 };
  };
  const margin = () => {
    const m = +G.store.get(KEY.margin, 1);
    return DT && DT.grid.margins.includes(m) ? m : 1;
  };
  // "best": the best tested plan; "4", "5": the best plan with that fixed target
  const targetChoice = () => {
    const t = String(G.store.get(KEY.target, 'best'));
    return t !== 'best' && DT && DT.buckets.some(b => b.target === t) ? t : 'best';
  };
  function bucketFor(cap, m, t = targetChoice()) {
    const list = DT.buckets.filter(b => b.margin === m && (b.target || 'best') === t);
    let pick = list[0];
    for (const b of list) if (cap >= b.capital) pick = b;
    return pick;
  }
  const chosenOf = b => b && b.candidates.find(c => c.key === b.chosen);
  const monthsOf = p => Math.max(1, Math.round(p.sessions / 21));
  const periodOf = name => DT.periods.find(p => p.name === name);
  const periodRange = name => {
    const p = periodOf(name);
    const f = s => G.asDate(s).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    return `${f(p.start)} – ${f(p.end)}`;
  };

  function nowIST() {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      second: '2-digit', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(new Date()).map(x => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute, time: `${p.hour}:${p.minute}:${p.second}`,
      weekend: p.weekday === 'Sat' || p.weekday === 'Sun' };
  }
  function phase(n) {
    if (n.weekend) return 'weekend';
    if (n.minutes < 9 * 60) return 'before';
    if (n.minutes < 9 * 60 + 15) return 'preopen';
    if (n.minutes < 15 * 60 + 30) return 'open';
    return 'after';
  }
  const barStart = b => 9 * 60 + 15 + b * 5;
  const barOfTime = hhmm => Math.min(L.N_BARS - 1, Math.max(0, L.barAt(hhmm)));

  // Plain-English rules of a setup and exit rule
  function entryText(st) {
    const g = st.gap_hi != null ? -st.gap_hi : st.gap_lo;
    if (st.kind === 'open') {
      if (g == null) return `${sideWord(st.side)} at 9:20 AM`;
      return `${sideWord(st.side)} at 9:20 AM if it opens ${G.p100(g)}% or more ${st.gap_hi != null ? 'below' : 'above'} yesterday’s close`;
    }
    if (st.kind === 'level') return `${sideWord(st.side)} when the price goes ${st.side > 0 ? 'above yesterday’s high' : 'below yesterday’s low'} (9:20 AM – 12:55 PM)`;
    return `${sideWord(st.side)} when the price goes ${st.side > 0 ? 'above the highest' : 'below the lowest'} price of the first ${st.orb_bars * 5} minutes (until 12:55 PM)`;
  }
  const pct1 = x => (Math.round(x * 1000) / 10).toString();  // 0.015 -> "1.5"
  function rulesHtml(st, k) {
    return `<div class="rules four">
      <div class="rule"><b class="${st.side > 0 ? 'up' : 'down'}">${sideWord(st.side)}</b><span>${G.esc(entryText(st))}</span></div>
      <div class="rule"><b class="down">−${pct1(k.st)}%</b><span>Stop-loss: get out if the price goes ${pct1(k.st)}% against you</span></div>
      <div class="rule"><b class="up">${k.tg ? '+' + pct1(k.tg) + '%' : 'None'}</b><span>${k.tg ? `Target: take the profit at ${pct1(k.tg)}%` : 'No target: hold until 3:10 PM'}</span></div>
      <div class="rule"><b>3:10 PM</b><span>Sell everything by then (Groww closes intraday trades at 3:20 PM and charges ${SQUARE_OFF})</span></div>
    </div>`;
  }
  const ruleSummary = k => `stop −${pct1(k.st)}% · ${k.tg ? `target +${pct1(k.tg)}%` : 'no target'} · out by 3:10 PM`;

  function planFor(cap) {
    if (!DT) return null;
    const m = margin(), b = bucketFor(cap, m), c = chosenOf(b);
    const exposure = cap * m, slots = L.daySlots(exposure), value = exposure / slots;
    if (!c) return { b, m, exposure, slots, value };
    const k = parseKey(b.chosen);
    return { b, m, c, k, st: DT.setups[k.sid], exposure, slots, value };
  }

  // ---- intraday chart ----
  function dayChart(s, lines = []) {
    const pts = [];
    for (let b = 0; b < L.N_BARS; b++) if (s.c[b] != null) pts.push([b, s.c[b]]);
    if (pts.length < 2) return '';
    const vals = pts.map(p => p[1]).concat(lines.filter(x => x && x.v > 0).map(x => x.v));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo || hi * 0.01 || 1) * 0.08;
    lo -= pad; hi += pad;
    const W = 320, H = 110, x = b => b / (L.N_BARS - 1) * W, y = v => (hi - v) / (hi - lo) * H;
    const path = pts.map(([b, v], i) => `${i ? 'L' : 'M'}${x(b).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const ls = lines.filter(l => l && l.v > 0).map(l =>
      `<line x1="0" x2="${W}" y1="${y(l.v).toFixed(1)}" y2="${y(l.v).toFixed(1)}" stroke="${l.color}" stroke-width="1" stroke-dasharray="4 3"/>`).join('');
    const exit = `<line x1="${x(L.EXIT_BAR)}" x2="${x(L.EXIT_BAR)}" y1="0" y2="${H}" stroke="var(--line)" stroke-width="1"/>`;
    return `<svg class="daychart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price today, 5-minute closes">${exit}${ls}
      <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.6"/></svg>`;
  }

  // ---------------------------------------------------------------------------
  // Day trading tab
  // ---------------------------------------------------------------------------

  function renderSettings(cap) {
    const m = margin();
    const chips = DT.grid.margins.map(x => `<button type="button" class="chip" data-margin="${x}" aria-pressed="${x === m}">${x === 1 ? 'No margin (1×)' : x + '×'}</button>`).join('');
    $('#daySettings').innerHTML = `<div class="card">
      <span class="label">Day trading · same-day trades</span>
      <h2>Buy and sell on the same day</h2>
      <p>A day trade is opened and closed between 9:15 AM and 3:20 PM, as an <b>Intraday</b> order on Groww. You can also
        <b>short-sell</b>: sell first and buy back later the same day, to profit when the price falls.</p>
      <p class="label" style="margin-top:.8rem">Groww’s intraday margin</p>
      <div class="chips" id="marginChips">${chips}</div>
      <p class="label" style="margin-top:.8rem">Target</p>
      <div class="chips">${['best', ...(DT.grid.target_choices || []).map(t => String(Math.round(t * 100)))].map(t =>
        `<button type="button" class="chip" data-dtarget="${t}" aria-pressed="${t === targetChoice()}">${t === 'best' ? 'Best tested ★' : t + '% target'}</button>`).join('')}</div>
      <p class="muted" style="margin-top:.5rem">With margin, Groww lets you trade more than your money for the day (up to 5× on many stocks).
        Profits <b>and losses</b> grow by the same amount: with ${inr(cap)}, a 1% move against you costs about ${inr(cap * 0.01)} with no margin
        and ${inr(cap * 0.05)} with 5×.</p>
      ${targetNote(cap)}
      <p class="muted">Each amount and margin is tested separately below.${m > 1 ? ` You are trading ${inr(cap * m)} with ${inr(cap)} of your own money.` : ''}</p>
    </div>`;
  }

  // How often a fixed target was reached in one day, against the best tested plan
  function targetNote(cap) {
    const t = targetChoice();
    if (t === 'best') return '<p class="muted" style="margin-top:.5rem">The plan below uses whichever target tested best for your amount and margin.</p>';
    const m = margin(), mine = chosenOf(bucketFor(cap, m)), best = chosenOf(bucketFor(cap, m, 'best'));
    if (!mine) return '';
    const ex = mine.example, hit = ex.trades ? ex.targets_hit / ex.trades : 0;
    return `<p class="verdict warn">With a fixed <b>${t}% target</b>, the target was reached in <b>${ex.targets_hit} of ${ex.trades}</b> trades in the
      final test (${pctTxt(hit, 0)}): a ${t}% move in one day is rare for these big stocks, so most trades end at the stop-loss or at 3:10 PM.
      ${inr(mine.runs.test.capital)} became <b>${inr(mine.runs.test.final)}</b>${best ? `, against ${inr(best.runs.test.final)} for the best tested plan` : ''}.</p>`;
  }

  function renderPlan(cap) {
    const plan = planFor(cap);
    const box = $('#dayPlan');
    if (!plan || !plan.c) {
      box.innerHTML = `<div class="card"><span class="label">Day-trading plan</span><p>No day-trading strategy could be tested at this amount.</p></div>`;
      return;
    }
    const { b, m, c, k, st, slots, value } = plan;
    const cost = L.roundTrip(value);
    const [vcls, vtitle, vraw] = VERDICT[b.verdict] || VERDICT.none;
    const nCombos = targetChoice() === 'best' ? DT.combos_tested : DT.combos_tested / DT.grid.targets.length;
    const vtext = vraw.replace('{combos}', nCombos.toLocaleString('en-IN'));
    const tested = b.capital === cap ? '' : `<p class="muted">Test results are for ${inr(b.capital)} (the closest tested amount at or below yours), ${m}× margin.</p>`;
    const rows = ['pick1', 'pick2', 'test'].map(name => {
      const r = c.runs[name], at = c.avg_trade[name];
      return `<div class="period${name === 'test' ? ' final' : ''}">
        <div><b>${PERIOD[name][0]}</b><small>${periodRange(name)} · ${PERIOD[name][1]}</small></div>
        <div class="period-value"><small>${inr(b.capital)} became</small><b class="num ${G.cls(r.final - b.capital)}">${inr(r.final)}</b></div>
        <p class="period-meta num">${r.trades} trades on ${r.days_traded} of ${r.sessions} days · ${r.win_rate == null ? '–' : pctTxt(r.win_rate, 0)} won ·
          worst day ${r.worst_day == null ? '–' : signed(r.worst_day)} · biggest fall −${pctTxt(r.max_dd, 1)}</p>
        <p class="period-meta num">Every signal: ${at.n} trades, average <span class="${G.cls(at.avg)}">${G.spct(at.avg, 2)}</span> after charges
          (<span class="${G.cls(at.gross)}">${G.spct(at.gross, 2)}</span> before)</p>
      </div>`;
    }).join('');
    const rnd = b.random;
    const randomLine = rnd ? `<p>With the same rules and money, <b>random</b> trades at 9:20 AM turned ${inr(b.capital)} into
      <b>${inr(rnd.median)}</b> in the final test (middle of ${rnd.runs} runs). This plan did better than <b>${pctTxt(rnd.beat_pct, 0)}</b> of them.</p>` : '';
    const lr = DT.long_run[k.sid];
    const longLine = lr && lr.n ? `<p>Long check on daily prices (${G.asDate(lr.start).getFullYear()}–${G.asDate(lr.end).getFullYear()}, before charges,
        enter at the open and sell at the close): ${lr.n.toLocaleString('en-IN')} trades, average <b class="${G.cls(lr.avg)}">${G.spct(lr.avg, 2)}</b>,
        up in ${lr.years_up} of ${lr.years} years.${lr.note ? ` <small>${G.esc(lr.note)}</small>` : ''}</p>`
      : lr === null ? '<p class="muted">This setup needs 5-minute prices, so it can’t be checked on the longer daily history.</p>' : '';
    const ex = c.example;
    const chart = G.lineChart([
      { pts: ex.curve, color: 'var(--accent)', label: 'This plan (final test)' },
      { pts: ex.curve.map(p => [p[0], b.capital]), color: 'var(--muted)', label: 'Money at the start' },
    ], G.fmtDate(ex.start), G.fmtDate(ex.end));
    const KIND = { 0: ['3:10 PM', ''], 1: ['Stop-loss', 'down'], 2: ['Target', 'up'] };
    const log = ex.log.map(([sym, day, et, ep, xt, xp, sh, pnl, kind]) => `<tr><td><b>${G.esc(sym)}</b><br><small>${G.fmtDate(day)}</small></td>
      <td class="r num">${et}<br><small>${inr(ep, 2)}</small></td><td class="r num">${xt}<br><small>${inr(xp, 2)}</small></td>
      <td class="r num">${sh}</td><td class="r num ${G.cls(pnl)}">${signed(pnl, 2)}</td><td class="${KIND[kind][1]}">${KIND[kind][0]}</td></tr>`).join('');
    const perDay = x => `<span class="${G.cls(x)}">${signed(x * b.capital * 21)}</span>`;
    const cands = b.candidates.map(o => {
      const ok = parseKey(o.key), os = DT.setups[ok.sid];
      return `<tr><td>${o.key === b.chosen ? '★ ' : ''}${G.esc(os.name)}<br><small>${ruleSummary(ok)}</small></td>
        <td class="r num">${perDay(o.pick1_est)}</td><td class="r num">${perDay(o.pick2_est)}</td>
        <td class="r num ${G.cls(o.runs.test.final - b.capital)}">${inr(o.runs.test.final)}</td></tr>`;
    }).join('');
    box.innerHTML = `<div class="card">
      <span class="label">The tested day-trading plan for ${inr(cap)}${m > 1 ? ` · ${m}× margin` : ''}</span>
      <h2>${G.esc(st.name)}</h2>
      <p>${G.esc(st.desc)}</p>
      ${rulesHtml(st, k)}
      <p>Up to <b>${slots} trade${slots > 1 ? 's' : ''} a day</b>, about ${inr(value)} each${m > 1 ? ` (with ${m}× margin)` : ''}. Each buy + sell of
        ${inr(value)} costs about <b>${inr(cost, 2)}</b> in Groww intraday charges (<b>${pctTxt(cost / value, 2)}</b>), so the price must move
        that much your way before you make anything.</p>
      <div class="verdict ${vcls}"><span class="badge ${vcls}">${vtitle}</span><p>${vtext}</p></div>
      <h3>How this plan did on past prices</h3>
      ${tested}
      <p><b>${b.passed_pick} of ${DT.combos_tested.toLocaleString('en-IN')}</b> combinations made money after charges in both picking periods at this amount.</p>
      <p class="muted">Tested on every 5-minute price of the last year (${G.fmtDate(DT.data_start)} – ${G.fmtDate(DT.data_end)}), split into
        three parts of about ${monthsOf(periodOf('test'))} months. “${inr(b.capital)} became” follows the plan with real money: whole shares,
        Groww charges, ${slots === 1 ? 'one trade a day' : `up to ${slots} trades a day`}, in the order they happened.</p>
      <div class="periods">${rows}</div>
      ${randomLine}
      ${longLine}
      <h3>The final test, day by day</h3>
      ${chart}
      <p class="muted">${ex.trades} trades: ${ex.targets_hit} hit the target, ${ex.stops_hit} hit the stop-loss, ${ex.trades - ex.targets_hit - ex.stops_hit} were sold at 3:10 PM.
        Charges paid: ${inr(ex.charges)}. Income tax on profits is not included (day-trading profit is taxed as business income).</p>
      <details><summary>See all ${ex.trades} trades from the final test</summary>
        <div class="table-wrap"><table>
          <thead><tr><th>Stock</th><th class="r">In</th><th class="r">Out</th><th class="r">Shares</th><th class="r">Profit after charges</th><th>Why out</th></tr></thead>
          <tbody>${log}</tbody></table></div></details>
      <details><summary>Other setups tested for this amount</summary>
        <p class="muted">The ${b.candidates.length} steadiest of ${DT.combos_tested.toLocaleString('en-IN')} combinations at ${inr(b.capital)}, ${m}× margin.
          “Picking” columns show the expected result per month from the average day; the pick (★) has the best <i>weaker</i> picking period.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Setup</th><th class="r">Picking 1</th><th class="r">Picking 2</th><th class="r">Final test</th></tr></thead>
          <tbody>${cands}</tbody></table></div></details>
    </div>`;
  }

  // The watch list for the next session, for the plan's setup
  function watchFor(plan) {
    const w = G.TD.day_watch;
    if (!w || w.error || !w.levels) return null;
    const st = plan.st, base = L.baseId(st.id);
    const next = G.nextWeekday(w.date);
    const out = [];
    for (const sym of w.candidates?.[base] || []) {
      const lv = w.levels[sym], info = G.TD.stocks[sym];
      if (!lv) continue;
      let price = lv.pc, label = '';
      if (st.kind === 'open' && (st.gap_hi != null || st.gap_lo != null)) {
        price = tick(st.gap_hi != null ? lv.pc * (1 + st.gap_hi) : lv.pc * (1 + st.gap_lo));
        label = st.gap_hi != null ? 'opens at or below' : 'opens at or above';
      } else if (st.kind === 'level') {
        price = st.side > 0 ? lv.ph : lv.pl;
        label = st.side > 0 ? 'goes above' : 'goes below';
      }
      const ex = (w.ex_dates?.[sym] || []).find(e => e[0] === next);
      out.push({ sym, lv, name: info ? info.name : sym, price, label, shares: L.sharesFor(plan.value, price), ex });
    }
    out.sort((a, z) => (z.lv.turn ?? 0) - (a.lv.turn ?? 0));
    return { w, next, rows: out };
  }

  function trendLine(st, w) {
    if (st.filter !== 'trend') return '';
    if (!w.nifty) return '<p class="error">The Nifty’s trend couldn’t be checked, so this plan can’t trade tomorrow.</p>';
    const ok = st.side > 0 ? w.nifty.up : w.nifty.down;
    return `<p>Market filter: the Nifty 50 closed at ${Math.round(w.nifty.pc).toLocaleString('en-IN')}, ${w.nifty.up ? 'above' : 'below'} its 20-day
      average (${w.nifty.sma20 ? Math.round(w.nifty.sma20).toLocaleString('en-IN') : '–'}): ${ok ? '<b class="up">trades allowed</b>' : '<b class="down">no trades tomorrow</b>'}.</p>`;
  }

  function renderWatch(cap) {
    const plan = planFor(cap), box = $('#dayWatch');
    if (!plan || !plan.c) { box.innerHTML = ''; return; }
    const w = G.TD.day_watch;
    if (!w || w.error) {
      box.innerHTML = `<div class="card"><span class="label">Day-trade watch list</span>
        <p class="error">The watch list for the next session couldn’t be made${w && w.error ? ` (${G.esc(w.error)})` : ''}. The update tries again later this evening and at 8 AM.</p></div>`;
      return;
    }
    const wl = watchFor(plan), st = plan.st;
    const ok = wl.rows.filter(r => r.shares >= 1 && !r.ex), dear = wl.rows.filter(r => r.shares < 1 && !r.ex), skipped = wl.rows.filter(r => r.ex);
    const how = st.kind === 'open'
      ? `The opening price at 9:15 AM decides. If a stock ${st.gap_hi != null || st.gap_lo != null ? 'opens at the price shown or beyond' : 'is on this list'},
        ${sideWord(st.side).toLowerCase()} it at <b>9:20 AM</b> as an <b>Intraday</b> order. The Live tab checks every stock for you at 9:15.`
      : st.kind === 'level'
        ? `From 9:20 AM to 12:55 PM, ${sideWord(st.side).toLowerCase()} a stock as soon as its price ${st.side > 0 ? 'goes above' : 'goes below'} the level shown.
          ${st.filter ? 'The Live tab also checks the Nifty filter at that moment.' : 'On Groww you can place a <b>stop-limit</b> (trigger) order at that level in the morning instead of watching.'}`
        : `Wait for the first ${st.orb_bars * 5} minutes (until ${L.barTime(st.orb_bars)} AM). Then ${sideWord(st.side).toLowerCase()} if the price
          ${st.side > 0 ? 'goes above the highest' : 'goes below the lowest'} price of that time. The Live tab shows the exact level at ${L.barTime(st.orb_bars)} AM.`;
    const levelHead = st.kind === 'open' ? (st.gap_hi != null || st.gap_lo != null ? 'Trade if it' : 'Trade at 9:20') : st.kind === 'level' ? 'Trade when it' : 'Yesterday’s close';
    const table = list => `<div class="table-wrap"><table class="watch">
      <thead><tr><th>Stock</th><th class="r">Yesterday’s close</th><th class="r">${levelHead}</th></tr></thead>
      <tbody>${list.map(r => `<tr><td><b>${G.esc(r.sym)}</b><br><small>${G.esc(r.name)}</small></td>
        <td class="r num">${inr(r.lv.pc, 2)}</td>
        <td class="r num">${r.label ? `<small>${r.label}</small><br>${inr(r.price, 2)}` : st.kind === 'orb' ? `<small>level at ${L.barTime(st.orb_bars)}</small>` : '9:20 AM'}
          <br><small>${r.shares} share${r.shares === 1 ? '' : 's'}</small></td></tr>`).join('')}</tbody></table></div>`;
    const first = ok.slice(0, 12), more = ok.slice(12);
    const exNote = w.ex_dates == null
      ? '<p class="muted">NSE’s dividend calendar couldn’t be checked today: before trading a gap, look for an ex-dividend date on the stock’s Groww page (Events).</p>'
      : skipped.length ? `<p class="muted">Skipped because of an ex-date on ${G.fmtDay(wl.next)} (the price drops for an accounting reason, not a real move):
          ${skipped.map(r => `${G.esc(r.sym)} (${G.esc(r.ex[1])})`).join(', ')}.</p>` : '';
    box.innerHTML = `<div class="card">
      <span class="label">Day-trade watch list · for ${G.fmtDay(wl.next)}</span>
      <h2>${ok.length ? `${ok.length} stock${ok.length > 1 ? 's' : ''} to watch` : 'Nothing to watch'}</h2>
      <p class="muted">From the close of ${G.fmtDay(w.date)}, for the plan above (${G.esc(st.name)} · ${ruleSummary(plan.k)}).
        ${plan.b.verdict === 'good' ? '' : '<b>Practice only</b>: this plan didn’t pass the tests at your amount.'}</p>
      <p>${how}</p>
      ${trendLine(st, w)}
      ${st.filter === 'mkt' ? `<p>Market filter: only ${st.side > 0 ? 'buy when the Nifty 50 is above' : 'short-sell when the Nifty 50 is below'} its opening price at that moment. The Live tab checks it.</p>` : ''}
      ${first.length ? table(first) : '<p class="empty">No stock meets this setup’s conditions for the next session.</p>'}
      ${more.length ? `<details><summary>${more.length} more</summary>${table(more)}</details>` : ''}
      ${dear.length ? `<details><summary>${dear.length} more on the list, but too expensive for ${inr(plan.value)} per trade</summary>
        <p class="muted">${dear.map(r => `${G.esc(r.sym)} (${inr(r.price)})`).join(', ')}.</p></details>` : ''}
      ${exNote}
      <p class="muted">Shares are for ${inr(plan.value)} per trade${plan.slots > 1 ? `, up to ${plan.slots} trades` : ''}, at the level shown, leaving room for charges.
        When several trigger at once, the plan takes the most traded stock first.</p>
    </div>`;
  }

  // ---- my day trades ----
  const dayTrades = () => G.store.get(KEY.trades, []);
  const saveDayTrades = list => G.store.set(KEY.trades, list);

  function renderDayTrades() {
    const all = dayTrades(), open = all.filter(t => !t.sold), closed = all.filter(t => t.sold);
    const n = nowIST();
    const item = t => {
      const st = G.TD.stocks[t.sym], name = st ? st.name : t.sym;
      const today = t.date === n.day;
      const sp = t.side > 0 ? t.price * (1 - t.st / 100) : t.price * (1 + t.st / 100);
      const tp = t.tg ? (t.side > 0 ? t.price * (1 + t.tg / 100) : t.price * (1 - t.tg / 100)) : null;
      const note = today ? 'Follow it on the Live tab: it tells you when the stop-loss or target is hit, and to get out by 3:10 PM.'
        : `This was a day trade on ${G.fmtDay(t.date)}. Groww closes intraday trades by 3:20 PM, so enter the price it was closed at.`;
      return `<div class="trade" data-dtrade="${G.esc(t.id)}">
        <div class="trade-top"><div><b>${G.esc(name)}</b> <small>${G.esc(t.sym)}</small></div>
          <span class="badge ${today ? 'info' : 'warn'}">${today ? 'OPEN today' : 'Close it'}</span></div>
        <p class="num"><small>${t.side > 0 ? 'Bought' : 'Short-sold'} ${t.qty} × ${inr(t.price, 2)} at ${G.esc(t.time)} on ${G.fmtDate(t.date)} ·
          Stop ${inr(tick(sp), 2)} · ${tp ? `Target ${inr(tick(tp), 2)}` : 'No target'}</small></p>
        <p>${note}</p>
        <div class="btn-row"><button class="btn small" data-dclose="${G.esc(t.id)}">I closed it</button>
          <button class="btn small ghost" data-ddel="${G.esc(t.id)}">Remove</button></div>
        <div class="sell-slot"></div>
      </div>`;
    };
    const closedRow = t => {
      const net = L.tradePnl(t.qty, t.price, t.sold.price, t.side);
      const ch = L.tradeCharges(t.qty, t.price, t.sold.price, t.side);
      const st = G.TD.stocks[t.sym];
      return `<div class="closed">
        <div class="trade-top"><div><b>${G.esc(st ? st.name : t.sym)}</b> <small>${G.esc(t.sym)} · ${t.side > 0 ? 'bought' : 'short-sold'}</small></div>
          <b class="num ${G.cls(net)}">${signed(net, 2)}</b></div>
        <p class="num"><small>${G.fmtDate(t.date)} · in ${inr(t.price, 2)} at ${G.esc(t.time)} · out ${inr(t.sold.price, 2)} at ${G.esc(t.sold.time)} · ${t.qty} shares ·
          price move ${signed(t.side * t.qty * (t.sold.price - t.price), 2)} · charges −${inr(ch, 2)}</small></p>
        <div class="btn-row"><button class="btn small ghost" data-dunsell="${G.esc(t.id)}">Undo</button>
          <button class="btn small ghost" data-ddel="${G.esc(t.id)}">Remove</button></div>
      </div>`;
    };
    let closedHtml = '';
    if (closed.length) {
      const nets = closed.map(t => L.tradePnl(t.qty, t.price, t.sold.price, t.side));
      const total = nets.reduce((a, x) => a + x, 0), wins = nets.filter(x => x > 0).length;
      closedHtml = `<details class="closed-list" open><summary>Closed day trades: ${closed.length} · ${wins} won · total
          <b class="${G.cls(total)}">${signed(total, 2)}</b> after charges</summary>
        ${[...closed].sort((a, z) => (z.date + z.sold.time > a.date + a.sold.time ? 1 : -1)).map(closedRow).join('')}</details>`;
    }
    $('#dayTrades').innerHTML = `<div class="card">
      <span class="label">My day trades</span>
      <h2>Your day trades</h2>
      <p class="muted">Save each day trade right after you enter it, real or on paper. Saved only in this browser.</p>
      ${open.map(item).join('') || '<p class="empty">No open day trades.</p>'}
      <div class="btn-row"><button class="btn" id="addDayTrade">Add a day trade</button></div>
      <div id="dayFormSlot"></div>
      ${closedHtml}
    </div>`;
  }

  function openDayForm(prefill = {}) {
    const slot = $('#dayFormSlot');
    const n = nowIST(), plan = planFor(G.currentCapital());
    const k = plan && plan.k ? plan.k : { st: 0.01, tg: 0 };
    const syms = Object.keys(G.TD.stocks).sort();
    const sym = prefill.sym || syms[0];
    const time = prefill.time || (phase(n) === 'open' ? n.time.slice(0, 5) : '09:20');
    slot.innerHTML = `<form class="trade-form" autocomplete="off">
      <label>Stock<select name="sym" required>${syms.map(s => `<option value="${G.esc(s)}"${s === sym ? ' selected' : ''}>${G.esc(s)} · ${G.esc(G.TD.stocks[s].name)}</option>`).join('')}</select></label>
      <label>Direction<select name="side"><option value="1">Buy first</option><option value="-1"${prefill.side === -1 ? ' selected' : ''}>Short-sell first</option></select></label>
      <label>Date<input name="date" type="date" required value="${G.esc(prefill.date || n.day)}" /></label>
      <label>Time in (HH:MM)<input name="time" type="time" required min="09:15" max="15:30" value="${G.esc(time)}" /></label>
      <label>Price (₹)<input name="price" type="number" inputmode="decimal" step="any" min="0.01" required value="${prefill.price ?? G.TD.stocks[sym].close}" /></label>
      <label>Shares<input name="qty" type="number" step="1" min="1" required value="${prefill.qty ?? 1}" /></label>
      <label>Stop-loss %<input name="st" type="number" step="0.1" min="0.1" required value="${prefill.st ?? pct1(k.st)}" /></label>
      <label>Target % (0 = sell at 3:10 PM)<input name="tg" type="number" step="0.1" min="0" required value="${prefill.tg ?? pct1(k.tg)}" /></label>
      <button type="submit" class="btn">Save day trade</button></form>`;
    const form = slot.querySelector('form');
    form.elements.sym.onchange = () => { form.elements.price.value = G.TD.stocks[form.elements.sym.value].close; };
    form.onsubmit = e => {
      e.preventDefault();
      const f = form.elements;
      const t = { id: String(Date.now()), sym: f.sym.value, side: +f.side.value, date: f.date.value, time: f.time.value,
        price: +f.price.value, qty: Math.round(+f.qty.value), st: +f.st.value, tg: +f.tg.value, setup: prefill.setup || null };
      if (!t.date || !/^\d\d:\d\d$/.test(t.time) || !(t.price > 0) || !(t.qty >= 1) || !(t.st > 0) || !(t.tg >= 0)) return;
      saveDayTrades([...dayTrades(), t]);
      renderDayTrades();
      if (live.started) refresh();
    };
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function showCloseForm(id, price, time) {
    const box = document.querySelector(`[data-dtrade="${CSS.escape(id)}"] .sell-slot`)
      || document.querySelector(`[data-ltrade="${CSS.escape(id)}"] .sell-slot`);
    if (!box) return;
    box.innerHTML = `<form class="trade-form sell-form">
      <label>Out at (HH:MM)<input name="time" type="time" required value="${G.esc(time)}" /></label>
      <label>Price (₹)<input name="price" type="number" inputmode="decimal" step="any" min="0.01" required value="${(+price).toFixed(2)}" /></label>
      <button type="submit" class="btn">Save</button></form>`;
    const form = box.querySelector('form');
    form.onsubmit = e => {
      e.preventDefault();
      const p = +form.elements.price.value, tm = form.elements.time.value;
      if (!(p > 0) || !tm) return;
      saveDayTrades(dayTrades().map(t => t.id === id ? { ...t, sold: { price: p, time: tm } } : t));
      renderDayTrades();
      if (live.started) renderLive();
    };
    form.elements.price.focus();
  }

  function renderMethod() {
    const g = DT.grid, n = Object.values(DT.setups).filter(s => !s.filter).length;
    $('#dayMethod').innerHTML = `<div class="card">
      <span class="label">How day trading was tested</span>
      <h2>${DT.combos_tested.toLocaleString('en-IN')} combinations on every 5-minute price</h2>
      <ul class="plain">
        <li><b>${n} setups</b> (gaps at the open, breaks of yesterday’s high or low, opening-range breakouts, a rebound), buying and
          short-selling, each on its own and with 2 market filters (the Nifty 50 above its opening price at that moment, or above its 20-day
          average), × ${g.stops.length} stop-losses (${g.stops.map(x => pct1(x) + '%').join(', ')}) × ${g.targets.length} targets
          (${g.targets.map(x => x ? pct1(x) + '%' : 'none').join(', ')}), on ${DT.n_stocks} Nifty 100 stocks over ${DT.sessions} trading days.</li>
        <li><b>Real orders:</b> trades at the open are entered at ${g.entry_time} AM, once the official opening price is known. Breakouts fill at the
          level (or the next price, if it jumps past). No new trades after ${g.last_entry}; everything is sold at ${g.exit_time} PM. Every market order
          gets ${pctTxt(g.slippage, 2)} worse than the chart price.</li>
        <li><b>No peeking:</b> only prices up to that moment are used. If the stop-loss and the target are both touched within the same
          5 minutes, the test assumes the stop-loss came first.</li>
        <li><b>Groww intraday charges</b> on every trade (brokerage ₹5–₹20 per order, 0.025% STT on the sale, 0.003% stamp duty,
          exchange fees, 18% GST), whole shares, and only as many trades a day as the money allows (one per ₹20,000, up to 5).</li>
        <li><b>Picked, then tested:</b> the year is split into three parts. The plan is picked on the first two (the average day after
          charges, using its weaker part) and judged on the last, which was never used for picking. It is compared with ${g.random_runs} runs of
          random trades with the same rules, and the setup’s basic idea is checked on daily prices back to 2015.</li>
        <li><b>Skipped days:</b> ex-dividend and other corporate-action days (the price drops for an accounting reason), and days where the
          5-minute and daily prices disagree.</li>
        <li><b>Re-tested every Saturday</b> as new prices come in; a new plan replaces yours only if it is clearly better.</li>
      </ul>
      <h3>Why day trading is hard</h3>
      <ul class="plain">
        <li>SEBI found that <b>7 in 10</b> individual intraday traders in shares lost money in 2022-23, and 8 in 10 of those who traded most often.</li>
        <li>Charges are a big share of a small trade: ₹12 on a ₹1,000 round trip is 1.2%, while a typical day’s move in a big stock is about 1–2%.</li>
        <li>Profits from day trading are taxed as business income, at your income-tax rate.</li>
      </ul>
      <p class="muted">Prices: Moneycontrol’s public chart feed (5-minute and daily bars; the daily bars match NSE’s official prices). Company
        events: NSE’s corporate-action calendar.</p>
    </div>`;
  }

  function renderHowTo() {
    $('#dayHowto').innerHTML = `<div class="card">
      <span class="label">How to use it</span>
      <h2>A day-trading day (practise on paper first)</h2>
      <ol class="steps">
        <li><b>The evening before</b>, look at the watch list above: which stocks, and at what price the plan would trade.</li>
        <li><b>At 9:15 AM</b>, open the <b>Live</b> tab. It checks the opening prices and tells you when a setup is on: what to do,
          how many shares, and where the stop-loss and target are.</li>
        <li><b>On Groww</b>, choose <b>Intraday</b> (not Delivery), place the order, then right away place a <b>stop-loss order</b>.
          Keep the Live tab open: it shows the price every minute and tells you when to sell (“Target hit”, “Stop-loss hit” or 3:10 PM).
          When the target is hit, sell and cancel the stop-loss order. Don’t keep a stop-loss and a target order open together:
          when one fills, the other can start a new trade.</li>
        <li><b>Save it</b> under “My day trades” with your real price and time. The Live tab then follows <i>your</i> price. It only
          updates while the page is open on screen (it doesn’t ring an alarm), so the stop-loss order on Groww is your safety net.</li>
        <li><b>By 3:10 PM</b>, get out of everything that is still open. If you don’t, Groww closes it at 3:20 PM and charges ${SQUARE_OFF}.</li>
        <li><b>Never</b> move the stop-loss further away, add to a losing trade, or take more trades than the plan says.</li>
      </ol>
      <p class="muted">Do this on paper for at least a few weeks and compare with the plan’s test results before using real money.</p>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Live tab
  // ---------------------------------------------------------------------------

  const live = { started: false, timer: null, busy: false, at: null, error: null, ok: 0, failed: 0,
    index: {}, prevSession: null, session: {}, opens: {}, day: null };

  const histUrl = (kind, sym, res, from, to, count) =>
    `${FEED}/${kind}/history?symbol=${encodeURIComponent(sym)}&resolution=${res}&from=${from}&to=${to}&countback=${count}&currencyCode=INR`;

  async function getJSON(url, ms = 15000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.s !== 'ok' && j.s !== 'no_data') throw new Error(j.errmsg || j.s || 'bad answer');
      return j;
    } finally { clearTimeout(t); }
  }
  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        try { await fn(item); live.ok++; } catch { live.failed++; }
      }
    }));
  }
  const nowSec = () => Math.floor(Date.now() / 1000);
  // the latest session in a 5-minute answer
  const latestDay = feed => feed && feed.t && feed.t.length ? L.istDate(feed.t[feed.t.length - 1]) : null;
  const dailyRows = feed => (feed && feed.t ? feed.t.map((t, i) => ({ d: L.istDate(t), o: feed.o[i], h: feed.h[i], l: feed.l[i], c: feed.c[i] })) : []);

  async function fetchBars(sym, kind = 'stock', since = null) {
    const to = nowSec();
    const feed = await getJSON(histUrl(kind, sym, 5, since || to - 6 * 86400, to, since ? 80 : 400));
    const day = latestDay(feed);
    return { day, s: day ? L.session(feed, day) : L.session(null, '') };
  }
  async function fetchDaily(sym, kind = 'stock') {
    const to = nowSec();
    return dailyRows(await getJSON(histUrl(kind, sym, 'D', to - 15 * 86400, to, 10)));
  }

  // What the plan needs today: candidates and their state
  function liveContext(n) {
    const cap = G.currentCapital(), plan = planFor(cap);
    const w = G.TD.day_watch;
    const ctx = { cap, plan, w, n, ok: false, why: '' };
    if (!plan || !plan.c) { ctx.why = 'No day-trading plan was tested at this amount.'; return ctx; }
    if (!w || w.error || !w.levels) { ctx.why = 'The day-trading watch list is missing, so today’s plan can’t be checked.'; return ctx; }
    const day = live.day, ph = phase(n);  // day: the session the feed shows (today while the market is open)
    if (ph === 'weekend' || ((ph === 'before' || ph === 'preopen') && day !== n.day)) {
      ctx.why = ph === 'weekend' ? 'The market is closed for the weekend. The next plan is in the Day trading tab.'
        : 'The market opens at 9:15 AM. From then on, this shows which stocks trigger and what to do.';
      ctx.closed = true;
      return ctx;
    }
    if (!day || !live.prevSession) { ctx.why = 'Waiting for the first prices.'; return ctx; }
    if (day !== n.day) {
      ctx.why = 'There is no trading session today (a market holiday?).';
      ctx.closed = true;
      return ctx;
    }
    if (w.date === day) { ctx.why = 'Today’s session is over and tomorrow’s watch list is ready in the Day trading tab.'; ctx.closed = true; return ctx; }
    if (w.date !== live.prevSession) {
      ctx.why = `The watch list is from ${G.fmtDay(w.date)}, but the last session before today was ${G.fmtDay(live.prevSession)}, so its levels are out of date.`;
      return ctx;
    }
    const exToday = sym => (w.ex_dates?.[sym] || []).some(e => e[0] === day);
    ctx.cands = (w.candidates?.[L.baseId(plan.st.id)] || []).filter(sym => w.levels[sym])
      .map(sym => ({ sym, lv: w.levels[sym], ex: exToday(sym) }));
    ctx.ok = true;
    return ctx;
  }

  async function refresh() {
    if (live.busy) return;
    live.busy = true;
    live.ok = live.failed = 0;
    const n = nowIST();
    try {
      // the market: indices, and from the Nifty's daily bars, the last session before today
      await pool(INDICES, 3, async ([id, sym]) => {
        const [bars, daily] = await Promise.all([fetchBars(sym, 'index'), fetchDaily(sym, 'index')]);
        const prev = daily.filter(r => r.d < (bars.day || n.day));
        live.index[id] = { ...bars, prevClose: prev.length ? prev[prev.length - 1].c : null };
        if (id === 'nifty') {
          live.day = bars.day;
          const before = daily.filter(r => r.d < n.day);
          live.prevSession = before.length ? before[before.length - 1].d : null;
        }
      });
      if (live.day !== live.sessionDay) { live.session = {}; live.opens = {}; live.sessionDay = live.day; }
      const ctx = liveContext(n);
      const want = new Set();
      if (ctx.ok) {
        const st = ctx.plan.st;
        const pend = ctx.cands.filter(c => !c.ex && L.sharesFor(ctx.plan.value, c.lv.pc) >= 1);
        if (st.kind === 'open') {
          // today's official open, from the daily bar
          const need = pend.filter(c => !(live.opens[c.sym] > 0));
          await pool(need, 6, async c => {
            const today = (await fetchDaily(c.sym)).find(r => r.d === live.day);
            if (today && today.o > 0) live.opens[c.sym] = today.o;
          });
          for (const c of pend) {
            const o = live.opens[c.sym];
            if (!(o > 0)) continue;
            const gap = o / c.lv.pc - 1;
            if ((st.gap_lo == null || gap >= st.gap_lo) && (st.gap_hi == null || gap <= st.gap_hi)) want.add(c.sym);
          }
        } else {
          for (const c of pend) {
            const r = live.session[c.sym]?.result;
            // stop asking for stocks that are settled: no entry possible any more
            if (!r || !['no', 'nodata', 'filtered'].includes(r.state)) want.add(c.sym);
          }
        }
      }
      const others = new Set();
      for (const t of G.store.get(G.KEYS.trades, [])) if (!t.sold && G.TD.stocks[t.sym]) others.add(t.sym);
      for (const t of dayTrades()) if (!t.sold && t.date === n.day) others.add(t.sym);
      for (const x of G.todaysSignals(G.currentCapital()).ok.slice(0, 6)) others.add(x.sym);
      for (const sym of others) want.add(sym);
      // the plan's candidates need only today's bars; my trades and the swing list also show the last session
      const since = ctx.ok ? Math.floor(Date.parse(`${n.day}T09:00:00+05:30`) / 1000) : null;
      const planSyms = new Set(ctx.ok ? ctx.cands.map(c => c.sym) : []);
      await pool([...want], 6, async sym => {
        const b = await fetchBars(sym, 'stock', planSyms.has(sym) && !others.has(sym) ? since : null);
        live.session[sym] = { ...(live.session[sym] || {}), ...b };
      });
      if (live.ok) live.at = n.time;
      live.tried = n.time;
      live.error = live.failed && !live.ok ? 'The live price feed didn’t answer.' : live.failed ? `${live.failed} price requests failed; showing what came back.` : null;
    } catch (err) {
      live.error = `The live price feed didn’t answer (${err.message}).`;
    } finally {
      live.busy = false;
    }
    renderLive();
  }

  function schedule() {
    clearTimeout(live.timer);
    live.timer = null;
    const n = nowIST(), ph = phase(n);
    const auto = G.store.get(KEY.auto, true);
    if (!auto || document.hidden || !live.started || G.currentTab() !== 'live') return;
    let wait = null;
    if (ph === 'open' || ph === 'preopen' || (ph === 'after' && n.minutes < 15 * 60 + 45)) wait = LIVE_EVERY;
    else if (ph === 'before') wait = Math.min(5 * 60_000, (9 * 60 - n.minutes) * 60_000);
    if (wait != null) live.timer = setTimeout(async () => { await refresh(); schedule(); }, Math.max(wait, 10_000));
  }

  const STATE_TEXT = {
    waiting: ['info', 'Waiting'], watching: ['info', 'Watching'], filtered: ['warn', 'Market filter: no'], no: ['', 'No trade'],
    nodata: ['warn', 'No prices'], open: ['good', 'In the trade'], stop: ['bad', 'Stop-loss hit'], target: ['good', 'Target hit'],
    time: ['warn', 'Sold at 3:10 PM'],
  };

  function planToday(ctx) {
    if (!ctx.plan || !ctx.plan.c) return `<div class="card"><span class="label">Today’s day-trade plan</span><p>${G.esc(ctx.why)}</p></div>`;
    const { plan } = ctx, st = plan.st, k = plan.k;
    const head = `<span class="label">Today’s day-trade plan · ${G.esc(st.name)}</span>
      <p class="muted">${G.esc(entryText(st))} · ${ruleSummary(k)} · ${inr(plan.value)} per trade, up to ${plan.slots} a day.
        ${plan.b.verdict === 'good' ? '' : '<b class="down">Practice only:</b> this plan didn’t pass the tests at your amount.'}</p>`;
    if (!ctx.ok) return `<div class="card">${head}<p>${G.esc(ctx.why)}</p></div>`;
    const n = ctx.n, final = phase(n) === 'after' || n.minutes >= barStart(L.EXIT_BAR) || ctx.n.day !== live.day;
    const mkt = live.index.nifty?.s, trend = ctx.w.nifty;
    const results = ctx.cands.map(c => {
      const ses = live.session[c.sym];
      if (c.ex) return { sym: c.sym, lv: c.lv, state: 'no', why: 'ex-dividend or other company event today: skipped' };
      if (L.sharesFor(plan.value, c.lv.pc) < 1) return { sym: c.sym, lv: c.lv, state: 'no', dear: true };
      let r;
      if (st.kind === 'open' && !(live.opens[c.sym] > 0)) r = { state: 'waiting', why: phase(n) === 'open' ? 'opening price not known yet' : 'market not open yet' };
      else if (st.kind === 'open' && !ses) {
        const gap = live.opens[c.sym] / c.lv.pc - 1;
        const hit = (st.gap_lo == null || gap >= st.gap_lo) && (st.gap_hi == null || gap <= st.gap_hi);
        r = hit ? { state: 'nodata', gap, why: `opened ${G.spct(gap, 1)}: prices didn’t load, try “Update now”` } : { state: 'no', gap };
      } else r = L.evaluate(st, k.st, k.tg, ses ? ses.s : L.session(null, ''), c.lv, live.opens[c.sym] ?? null, mkt, trend, final);
      if (ses) ses.result = r;
      return { ...r, sym: c.sym, lv: c.lv };
    });
    const day = L.takeTrades(results, ctx.w.levels, plan.exposure);
    const takenSet = new Set(day.taken.map(t => t.sym));
    let total = 0;
    const cards = day.taken.map(t => {
      const s = live.session[t.sym]?.s, now = t.state === 'open' ? t.now : t.px;
      const pnl = now > 0 ? L.tradePnl(t.shares, t.pe, now, t.side) : null;
      if (pnl != null) total += pnl;
      const fresh = phase(n) === 'open' && t.state === 'open' && n.minutes - barStart(t.e) <= 10;
      const [bc, bt] = STATE_TEXT[t.state];
      const info = G.TD.stocks[t.sym];
      const action = t.state === 'open'
        ? (fresh ? `<b>${sideWord(t.side).toUpperCase()} NOW (Intraday):</b> ${t.shares} share${t.shares > 1 ? 's' : ''} near ${inr(t.pe, 2)}.
            Then place a stop-loss order at <b>${inr(tick(t.sp), 2)}</b> on Groww.${t.tp ? ` The target is <b>${inr(tick(t.tp), 2)}</b>: this page
            says “Target hit” when it gets there. Then ${t.side > 0 ? 'sell' : 'buy back'} and cancel the stop-loss order.` : ''}
            <br><small>Keep only one exit order open: if a stop-loss and a target order are both open and one fills, the other can start a new, unwanted trade.</small>`
          : `${t.side > 0 ? 'Bought' : 'Short-sold'} at ${t.entryTime} near ${inr(t.pe, 2)}. Keep the stop-loss at ${inr(tick(t.sp), 2)}${t.tp ? ` and the target at ${inr(tick(t.tp), 2)}` : ''}; get out by 3:10 PM.
            ${n.minutes - barStart(t.e) > 10 && phase(n) === 'open' ? '<br><small>If you didn’t enter at the time, skip it: the test only counts entries at the trigger price.</small>' : ''}`)
        : t.state === 'stop' ? `Stopped out at ${t.exitTime} near ${inr(t.px, 2)}. ${phase(n) === 'open' ? 'If your stop-loss order didn’t fill, get out now.' : ''}`
          : t.state === 'target' ? `Target reached at ${t.exitTime} (${inr(t.px, 2)}). ${phase(n) === 'open' ? `<b>${t.side > 0 ? 'Sell' : 'Buy back'} now</b> if you are still in, and cancel your stop-loss order.` : ''}`
            : `Sold at 3:10 PM near ${inr(t.px, 2)}. ${phase(n) === 'open' ? `<b>${t.side > 0 ? 'Sell' : 'Buy back'} now</b> if you are still in, and cancel your stop-loss order.` : ''}`;
      return `<div class="live-trade ${t.state}">
        <div class="trade-top"><div><b>${G.esc(info ? info.name : t.sym)}</b> <small>${G.esc(t.sym)} · ${t.side > 0 ? 'buy' : 'short-sell'}</small></div>
          <span class="badge ${bc}">${bt}</span></div>
        ${s ? dayChart(s, [{ v: t.pe, color: 'var(--muted)' }, { v: t.sp, color: 'var(--down)' }, { v: t.tp, color: 'var(--up)' }]) : ''}
        <p>${action}</p>
        <p class="num"><small>In ${t.entryTime} ${inr(t.pe, 2)} · Stop ${inr(t.sp, 2)} · ${t.tp ? `Target ${inr(t.tp, 2)}` : 'No target'} · ${t.state === 'open' ? 'Now' : 'Out'} ${inr(now, 2)}</small>
          ${pnl == null ? '' : ` · <b class="${G.cls(pnl)}">${signed(pnl, 2)}</b> <small>after charges${t.state === 'open' ? ', if closed now' : ''}</small>`}</p>
        ${t.state === 'open' ? `<div class="btn-row"><button class="btn small ghost" data-dsave="${G.esc(t.sym)}" data-side="${t.side}" data-price="${t.pe.toFixed(2)}"
          data-time="${t.entryTime}" data-qty="${t.shares}" data-st="${pct1(k.st)}" data-tg="${pct1(k.tg)}">Save to My day trades</button></div>` : ''}
      </div>`;
    }).join('');
    const why = r => {
      if (r.why) return r.why;
      if (r.state === 'no' && r.gap != null) return `opened ${G.spct(r.gap, 1)}: not enough`;
      if (r.state === 'no') return 'no entry by 12:55 PM';
      if (r.state === 'watching') {
        const now = live.session[r.sym]?.s?.c[r.last];
        return `${st.side > 0 ? 'buy above' : 'short-sell below'} ${inr(r.level, 2)}${now ? ` · now ${inr(now, 2)} (${G.spct(now / r.level - 1, 1)})` : ''}`;
      }
      if (r.state === 'filtered') return 'the Nifty filter says no today';
      if (r.e != null && r.e >= 0) {
        const sk = day.skipped.find(x => x.sym === r.sym);
        return `triggered at ${r.entryTime} but skipped: ${sk ? sk.why : ''}`;
      }
      return '';
    };
    const dear = results.filter(r => r.dear);
    const others = results.filter(r => !takenSet.has(r.sym) && !r.dear);
    const order = { watching: 0, waiting: 1, open: 2, stop: 2, target: 2, time: 2, filtered: 3, nodata: 4, no: 5 };
    others.sort((a, z) => (order[a.state] - order[z.state]) || ((z.lv.turn ?? 0) - (a.lv.turn ?? 0)));
    const shown = others.slice(0, 25);
    const dearLine = dear.length ? `<p class="muted">${dear.length} more stock${dear.length > 1 ? 's' : ''} on the list cost more than ${inr(plan.value)} per trade, so they aren’t checked.</p>` : '';
    const table = shown.length ? `<details${day.taken.length ? '' : ' open'}><summary>${others.length} stocks you can afford on today’s list</summary>
      <div class="table-wrap"><table class="live-list"><thead><tr><th>Stock</th><th>Status</th></tr></thead><tbody>
      ${shown.map(r => {
        const [c2, t2] = r.e != null && r.e >= 0 ? ['', 'Skipped'] : STATE_TEXT[r.state] || ['', r.state];
        return `<tr><td><b>${G.esc(r.sym)}</b></td><td><span class="badge ${c2}">${t2}</span> <small>${G.esc(why(r))}</small></td></tr>`;
      }).join('')}</tbody></table></div>${others.length > shown.length ? `<p class="muted">and ${others.length - shown.length} more with no trade.</p>` : ''}${dearLine}</details>` : dearLine;
    const ph = phase(n);
    const summary = day.taken.length
      ? `<p><b>${day.taken.length} trade${day.taken.length > 1 ? 's' : ''}</b> by the plan today · result so far <b class="${G.cls(total)}">${signed(total, 2)}</b> after charges (paper).</p>`
      : `<p>${ph === 'open' ? (results.some(r => ['waiting', 'watching'].includes(r.state)) ? 'No trade yet: still watching.' : 'No trade today.') : ph === 'after' ? 'No trade by the plan today.' : 'The market isn’t open yet.'}</p>`;
    return `<div class="card">${head}${summary}${cards}${table}</div>`;
  }

  function marketCard(n) {
    const ph = phase(n);
    const status = { weekend: 'Closed for the weekend', before: 'Closed · opens at 9:15 AM', preopen: 'Pre-open · trading starts at 9:15 AM',
      open: 'Open', after: 'Closed for the day' }[ph];
    const noSession = ph === 'open' && n.minutes > 9 * 60 + 25 && live.day && live.day !== n.day;
    const idx = INDICES.map(([id, , name]) => {
      const x = live.index[id];
      if (!x || !x.day) return `<div class="mood"><small>${name}</small><b class="num">–</b></div>`;
      const last = x.s.c[L.lastBar(x.s)], chg = x.prevClose ? last / x.prevClose - 1 : null;
      const good = id === 'vix' ? chg < 0 : chg > 0;
      return `<div class="mood ${chg == null ? '' : good ? 'good' : 'bad'}"><small>${name}${x.day !== n.day ? ` · ${G.fmtDay(x.day)}` : ''}</small>
        <b class="num">${last.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</b>
        <span class="${G.cls(chg)}">${chg == null ? '' : G.spct(chg, 2)}</span>${dayChart(x.s)}</div>`;
    }).join('');
    const auto = G.store.get(KEY.auto, true);
    return `<div class="card">
      <span class="label">Live · NSE</span>
      <h2>Market: ${noSession ? 'no trading today (holiday?)' : status}</h2>
      <p class="muted num">${n.time} IST · ${live.at ? `prices from ${live.at}` : live.tried ? `no prices yet (last try ${live.tried})` : 'loading prices…'}${live.busy ? ' · updating…' : ''}
        ${auto && (ph === 'open' || ph === 'preopen') ? ' · updates every minute' : ''}</p>
      ${live.error ? `<p class="error">${G.esc(live.error)}</p>` : ''}
      <div class="mood-grid idx-grid">${idx}</div>
      <div class="btn-row"><button class="btn small" id="liveNow">Update now</button>
        <button class="btn small ghost" id="liveAuto" aria-pressed="${auto}">${auto ? 'Auto-update: on' : 'Auto-update: off'}</button></div>
      <p class="muted"><small>Prices: Moneycontrol’s public chart feed, a few seconds to a minute behind the exchange. For your orders, trust the price on Groww.</small></p>
    </div>`;
  }

  function myTradesLive(n) {
    const rows = [];
    for (const t of G.store.get(G.KEYS.trades, [])) {
      if (t.sold || !G.TD.stocks[t.sym]) continue;
      const x = live.session[t.sym];
      const last = x ? x.s.c[L.lastBar(x.s)] : null;
      if (!(last > 0)) continue;
      const target = t.tg ? t.price * (1 + t.tg / 100) : null, stop = t.price * (1 - t.st / 100);
      const pnl = G.netPnl(t.qty, t.price, last);
      const note = target && last >= target ? '<b class="up">at or above the target now</b>' : last <= stop ? '<b class="down">at or below the stop-loss now</b>'
        : `${target ? `${G.spct(target / last - 1, 1)} to the target, ` : ''}${G.spct(stop / last - 1, 1)} to the stop-loss`;
      rows.push(`<tr><td><b>${G.esc(t.sym)}</b><br><small>swing · ${t.qty} × ${inr(t.price, 2)}</small></td>
        <td class="r num">${inr(last, 2)}<br><small>${x.day !== n.day ? G.fmtDay(x.day) : ''}</small></td>
        <td class="r num ${G.cls(pnl)}">${signed(pnl, 2)}</td><td><small>${note}</small></td></tr>`);
    }
    const cards = [];
    for (const t of dayTrades()) {
      if (t.sold || t.date !== n.day) continue;
      const x = live.session[t.sym];
      if (!x || x.day !== n.day) continue;
      const e = barOfTime(t.time);
      const r = L.follow(x.s, t.side, e, t.price, t.st / 100, t.tg / 100, phase(n) === 'after' || n.minutes >= barStart(L.EXIT_BAR));
      const now = r.state === 'open' ? r.now : r.px;
      const pnl = now > 0 ? L.tradePnl(t.qty, t.price, now, t.side) : null;
      const [bc, bt] = STATE_TEXT[r.state];
      const say = r.state === 'open' ? 'Hold. Get out by 3:10 PM.' : r.state === 'stop' ? `The stop-loss level was reached at ${r.exitTime}. If your order didn’t fill, get out now.`
        : r.state === 'target' ? `The target was reached at ${r.exitTime}: <b>${t.side > 0 ? 'sell' : 'buy back'} now</b> and cancel your stop-loss order.`
          : `It’s 3:10 PM: <b>${t.side > 0 ? 'sell' : 'buy back'} now</b> and cancel your stop-loss order.`;
      cards.push(`<div class="live-trade ${r.state}" data-ltrade="${G.esc(t.id)}">
        <div class="trade-top"><div><b>${G.esc(t.sym)}</b> <small>day trade · ${t.side > 0 ? 'bought' : 'short-sold'} ${t.qty} × ${inr(t.price, 2)} at ${G.esc(t.time)}</small></div>
          <span class="badge ${bc}">${bt}</span></div>
        ${dayChart(x.s, [{ v: t.price, color: 'var(--muted)' }, { v: r.sp, color: 'var(--down)' }, { v: r.tp, color: 'var(--up)' }])}
        <p>${say}</p>
        <p class="num"><small>Stop ${inr(tick(r.sp), 2)} · ${r.tp ? `Target ${inr(tick(r.tp), 2)}` : 'No target'} · ${r.state === 'open' ? 'Now' : 'Exit'} ${inr(now, 2)}</small>
          ${pnl == null ? '' : ` · <b class="${G.cls(pnl)}">${signed(pnl, 2)}</b> <small>after charges</small>`}</p>
        <div class="btn-row"><button class="btn small" data-dclose="${G.esc(t.id)}" data-at="${(now || t.price).toFixed(2)}" data-tm="${r.exitTime || n.time.slice(0, 5)}">I closed it</button></div>
        <div class="sell-slot"></div>
      </div>`);
    }
    if (!rows.length && !cards.length) return '';
    return `<div class="card"><span class="label">My open trades · live</span>
      ${cards.join('')}
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Stock</th><th class="r">Price</th><th class="r">If sold now</th><th>Levels</th></tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>
        <p class="muted"><small>Swing trades: “if sold now” includes Groww delivery charges. Their HOLD / SELL advice is in the Swing tab and uses closing prices.</small></p>` : ''}
    </div>`;
  }

  function swingLive(n) {
    const list = G.todaysSignals(G.currentCapital()).ok.slice(0, 6);
    const rows = list.map(x => {
      const s = live.session[x.sym];
      if (!s || s.day !== n.day) return '';
      const open = s.s.o[0], last = s.s.c[L.lastBar(s.s)];
      return `<tr><td><b>${G.esc(x.sym)}</b></td><td class="r num">${inr(x.st.close, 2)}</td>
        <td class="r num">${open ? inr(open, 2) : '–'}<br><small class="${G.cls(open / x.st.close - 1)}">${open ? G.spct(open / x.st.close - 1, 1) : ''}</small></td>
        <td class="r num">${inr(last, 2)}</td></tr>`;
    }).filter(Boolean);
    if (!rows.length) return '';
    return `<div class="card"><span class="label">Swing buy list · today’s prices</span>
      <p class="muted">The swing plan buys these at today’s open as <b>Delivery</b> orders (see the Swing tab).</p>
      <div class="table-wrap"><table><thead><tr><th>Stock</th><th class="r">Signal close</th><th class="r">Opened</th><th class="r">Now</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div></div>`;
  }

  function renderLive() {
    if (!live.started) return;
    const n = nowIST();
    const ctx = liveContext(n);
    $('#live').innerHTML = marketCard(n) + planToday(ctx) + myTradesLive(n) + swingLive(n);
  }

  function startLive() {
    if (!live.started) {
      live.started = true;
      renderLive();
      refresh().then(schedule);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && G.currentTab() === 'live') refresh().then(schedule);
        else schedule();
      });
    } else {
      renderLive();
      schedule();
    }
  }

  // ---------------------------------------------------------------------------

  function render(cap) {
    if (!DT) {
      $('#dayPlan').innerHTML = `<div class="card"><span class="label">Day trading</span>
        <p>The day-trading tests haven’t run yet. They run with the next price update; check again after 7 PM.</p></div>`;
      return;
    }
    renderSettings(cap);
    renderPlan(cap);
    renderWatch(cap);
    renderDayTrades();
    if (live.started) renderLive();
  }

  function init(helpers, dt) {
    G = helpers;
    DT = dt;
    if (DT) {
      renderMethod();
      renderHowTo();
    }
    document.body.addEventListener('click', e => {
      const chip = e.target.closest('[data-margin]');
      if (chip) { G.store.set(KEY.margin, +chip.dataset.margin); render(G.currentCapital()); return; }
      const tchip = e.target.closest('[data-dtarget]');
      if (tchip) { G.store.set(KEY.target, tchip.dataset.dtarget); render(G.currentCapital()); return; }
      if (e.target.closest('#addDayTrade')) { openDayForm(); return; }
      const save = e.target.closest('[data-dsave]');
      if (save) {
        const d = save.dataset;
        G.showTab('day');
        openDayForm({ sym: d.dsave, side: +d.side, price: +d.price, time: d.time, qty: +d.qty, st: +d.st, tg: +d.tg,
          setup: planFor(G.currentCapital())?.st?.id });
        return;
      }
      const close = e.target.closest('[data-dclose]');
      if (close) {
        const t = dayTrades().find(x => x.id === close.dataset.dclose);
        if (t) showCloseForm(t.id, close.dataset.at || t.price, close.dataset.tm || '15:10');
        return;
      }
      const unsell = e.target.closest('[data-dunsell]');
      if (unsell) {
        saveDayTrades(dayTrades().map(t => {
          if (t.id !== unsell.dataset.dunsell) return t;
          const { sold, ...rest } = t;
          return rest;
        }));
        renderDayTrades();
        return;
      }
      const del = e.target.closest('[data-ddel]');
      if (del && confirm('Remove this day trade?')) {
        saveDayTrades(dayTrades().filter(t => t.id !== del.dataset.ddel));
        renderDayTrades();
        return;
      }
      if (e.target.closest('#liveNow')) { refresh().then(schedule); return; }
      if (e.target.closest('#liveAuto')) {
        G.store.set(KEY.auto, !G.store.get(KEY.auto, true));
        renderLive();
        schedule();
      }
    });
  }

  window.DayUI = { init, render, startLive, stopLive: () => { clearTimeout(live.timer); live.timer = null; } };
})();
