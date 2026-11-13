/* 90-day sales campaign tracker (Hemang, Nov 10, 2026): the TLS Sales Campaign Goal sheet — Nov 1, 2026 to Jan 31,
   2027, $82,500 across Referral Business ($60,000) and Founder Network ($22,500) — against what Zoho actually holds.
   Mounts itself into the Deals tab right under "Deals at a glance", so neither copy of index.html needs new markup.
   Loaded after the page script and b2b-today.js: it uses the page's dash, CC_RULES, and the rb_rows calc.

   Three decisions Hemang made on Nov 10, 2026, because the sheet does not map onto Zoho one to one:

   1. When a deal was won. Closing_Date is empty on every deal in the CRM and Completion_Date is set on 2 of 14 closed
      deals. Settled Nov 13, 2026: the date comes from Zoho's own Stage History (module DealHistory) — the moment the
      deal entered the Closed stage — which Zoho writes once and no later edit to the deal disturbs. Modified_Time is
      only a last resort for a deal closed before stage tracking began (Feb 17, 2026; none in the CRM today), and
      won_on_est is true only then. This replaced the earlier Modified_Time fallback, which had five old deals dated
      into the window and was counting $5,000 of October revenue (PCAZ: Custom Courier App, really closed Oct 22) as
      November. Closing_Date still wins where Zoho holds one.
   2. Which track a deal belongs to. By the referrer's Relationship Type, the same split "Business from Referral
      Partners" already uses, so the two sections can never disagree: a referrer who is Founder Network puts the deal
      in Founder Network, any other recorded referrer puts it in Referral Business.
   3. Revenue with no referrer recorded is Direct — a third column that counts toward the $82,500 but carries no
      target of its own, so neither campaign's progress is inflated by business that came direct.

   Scope is the four things Zoho can measure: revenue, deals closed, deals logged and meetings. The sheet's engagement,
   follow-up and reconnection counts have nowhere to be recorded, so they are named as not tracked rather than shown
   as zero. Read-only: nothing here is written to Zoho. */
(() => {
  if (window.CC_C90) return;

  const WIN = { from: '2026-11-01', to: '2027-01-31' };
  const TOTAL_TARGET = { revenue: 82500, closed: 6, logged: 23 };
  const MONTHS = [
    { key: '2026-11', label: 'Nov 2026', target: 27500 },
    { key: '2026-12', label: 'Dec 2026', target: 27500 },
    { key: '2027-01', label: 'Jan 2027', target: 27500 },
  ];
  /* Targets straight off the sheet. Direct carries none: it exists so unreferred revenue still shows somewhere. */
  const TRACKS = [
    { key: 'ref', label: 'Referral Business', tone: 'blue', target: { revenue: 60000, closed: 3, logged: 15, meetings: 180, avg: 20000 } },
    { key: 'fn', label: 'Founder Network', tone: 'green', target: { revenue: 22500, closed: 3, logged: 8, meetings: 60, avg: 7500 } },
    /* Direct is purple, not grey: grey already means Combined in Closed Won and Business from Referral Partners, and
       against the green it fails the normal-vision separation floor (ΔE 14.4, floor 15) — labels don't excuse that
       one. Blue / green / purple passes all six checks on both the light and dark panel. */
    { key: 'dir', label: 'Direct', tone: 'purple', target: { revenue: null, closed: null, logged: null, meetings: null, avg: null } },
  ];
  const TRACK_WHY = {
    ref: 'Referred By is set and the referrer is not Founder Network.',
    fn: 'The referrer’s Relationship Type is Founder Network.',
    dir: 'No Referred By recorded — business that came direct, or a referrer still to be filled in.',
  };
  const TRACK_LABEL = { ref: 'Referral Business', fn: 'Founder Network', dir: 'Direct', other: 'Another campaign', none: 'No contact linked' };
  /* The sheet's activity targets that nothing in Zoho records, named rather than shown as zero. */
  const NOT_TRACKED = [
    'New engagements (120) and follow-ups (600)',
    'In-person against online meetings (60 / 120)',
    'Target people reached (500) and total interactions (600)',
    'Reconnections, social against intentional (30 / 30)',
    'Transfers from Founder Network to Referral (60)',
  ];

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const intF = (v) => new Intl.NumberFormat('en-US').format(v || 0);
  const moneyF = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0);
  const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
  const todayCT = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const ctDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const ZOHO = 'https://crm.zoho.com/crm/org899412015/tab/';
  const plural = (n, one, many) => (n === 1 ? one : many);

  const DAY_MS = 86400000;
  const noon = (ymd) => Date.parse(String(ymd).slice(0, 10) + 'T12:00:00Z');
  /* Last day of a YYYY-MM month. Pasting "-31" on every month makes an invalid date for November and February, which
     parses as NaN and silently voids the month's pace. */
  const monthEnd = (key) => {
    const [y, mo] = key.split('-').map(Number);
    return key + '-' + String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0');
  };
  const weekdays = (from, to) => {
    if (noon(to) < noon(from)) return 0;
    let n = 0;
    const end = noon(to);
    for (let t = noon(from); t <= end; t += DAY_MS) { const day = new Date(t).getUTCDay(); if (day >= 1 && day <= 5) n += 1; }
    return n;
  };
  const inWin = (ymd) => Boolean(ymd) && ymd >= WIN.from && ymd <= WIN.to;

  /* A deal's track. rb_rows already excludes Reseller/ Referral Partner and Platform Provider deals, so a partner's
     own agreement deal never counts as revenue. */
  const trackOf = (d) => (d.fn ? 'fn' : d.referred ? 'ref' : 'dir');
  const sumAmount = (list) => list.reduce((s, d) => s + (d.amount > 0 ? d.amount : 0), 0);

  dash.calc('c90', {
    title: '90-day sales campaign against target',
    description: 'The TLS Sales Campaign Goal sheet (Nov 1, 2026 to Jan 31, 2027; $82,500 across Referral Business $60,000 and Founder Network $22,500, $27,500 a month) measured against Zoho. Each client deal (rb_rows: every Deal Type except Reseller/ Referral Partner and Platform Provider Agreement) goes in one track by its referrer: Founder Network when the referring contact’s Relationship Type is Founder Network, Referral Business when any other referrer is recorded, Direct when none is. Revenue is the Amount of deals at stage Closed whose effective won date falls in the window; that date is Zoho’s Closing Date where it holds one, otherwise the moment the deal entered the Closed stage in Zoho’s own Stage History (module DealHistory), which no later edit to the deal moves, and only as a last resort the last-changed date. Deals closed counts the same deals, including those with no Amount, so revenue is a floor. Deals logged counts deals Zoho created in the window, whatever stage they are at now. Open pipeline is every client deal still open, whenever it was created. Pace compares each target with the share of the window’s weekdays that have passed, in Central time.',
    inputs: ['rb_rows'],
    fn: (rb_rows) => {
      const today = todayCT();
      const total = weekdays(WIN.from, WIN.to);
      const gone = today < WIN.from ? 0 : weekdays(WIN.from, today < WIN.to ? today : WIN.to);
      const share = total ? Math.min(1, gone / total) : 0;

      const won = rb_rows.filter((d) => d.status === 'won' && inWin(d.won_on));
      const made = rb_rows.filter((d) => inWin(d.created));
      const open = rb_rows.filter((d) => d.status === 'open');

      const tracks = TRACKS.map((t) => {
        const mine = (list) => list.filter((d) => trackOf(d) === t.key);
        const w = mine(won);
        const made2 = mine(made);
        const o = mine(open);
        return {
          key: t.key, label: t.label, tone: t.tone, target: t.target, why: TRACK_WHY[t.key],
          revenue: sumAmount(w), closed: w.length, logged: made2.length,
          noAmount: w.filter((d) => !(d.amount > 0)).length,
          openCount: o.length, openValue: sumAmount(o),
          /* What this track still needs, and whether its own open deals could supply it. Judging the campaign on an
             even weekday pace would be meaningless on a six-deal target: one deal swings it either way. Coverage is
             the question that has an answer — is the money to hit this number already in the pipeline.
             `state` is what the bar is colored by (Hemang, Nov 11, 2026): met, reachable, short, or none for a track
             the sheet gives no target. Every bar prints its state in words too, because a status must never be
             carried by color alone. */
          gap: t.target.revenue ? Math.max(0, t.target.revenue - sumAmount(w)) : null,
          covered: t.target.revenue ? sumAmount(o) >= Math.max(0, t.target.revenue - sumAmount(w)) : null,
          state: !t.target.revenue ? 'none'
            : sumAmount(w) >= t.target.revenue ? 'met'
              : sumAmount(o) >= t.target.revenue - sumAmount(w) ? 'reachable' : 'short',
          wonDeals: w, madeDeals: made2, openDeals: o,
        };
      });

      const months = MONTHS.map((mo) => {
        const w = won.filter((d) => String(d.won_on).slice(0, 7) === mo.key);
        /* The month's revenue split by track, so the column can be stacked in the same colors as the track bars
           rather than needing a fourth hue of its own. */
        const byTrack = TRACKS.map((t) => {
          const part = w.filter((d) => trackOf(d) === t.key);
          return { key: t.key, label: t.label, tone: t.tone, amount: sumAmount(part), deals: part };
        });
        const last = monthEnd(mo.key);
        const monthGone = today < mo.key + '-01' ? 0 : weekdays(mo.key + '-01', today < last ? today : last);
        const monthTotal = weekdays(mo.key + '-01', last);
        const when = mo.key < today.slice(0, 7) ? 'past' : mo.key === today.slice(0, 7) ? 'now' : 'ahead';
        return {
          key: mo.key, label: mo.label, target: mo.target, revenue: sumAmount(w), closed: w.length, wonDeals: w, byTrack,
          when,
          /* A month cannot be called reachable: no deal in Zoho carries an expected close month, so there is nothing
             to attribute open pipeline to. The states a month can honestly be in are met, missed (it has ended short),
             open (running) and ahead (not started). */
          state: sumAmount(w) >= mo.target ? 'met' : when === 'past' ? 'short' : when === 'now' ? 'open' : 'ahead',
          share: monthTotal ? Math.min(1, monthGone / monthTotal) : 0,
        };
      });

      return [{
        today, from: WIN.from, to: WIN.to, weekdaysTotal: total, weekdaysGone: gone, share,
        target: TOTAL_TARGET,
        revenue: sumAmount(won), closed: won.length, logged: made.length,
        noAmount: won.filter((d) => !(d.amount > 0)).length,
        openCount: open.length, openValue: sumAmount(open),
        wonDeals: won, madeDeals: made, openDeals: open,
        /* The campaign as a whole, by the same three states the bars use, so the top bar cannot drift from them.
           It can read reachable while the verdict reads At risk, and both are true: the total gap is covered by the
           open pipeline, but most of that pipeline is Direct and neither campaign track can reach its own number. */
        state: sumAmount(won) >= TOTAL_TARGET.revenue ? 'met'
          : sumAmount(open) >= TOTAL_TARGET.revenue - sumAmount(won) ? 'reachable' : 'short',
        tracks, months,
        /* Deals the window dated from the last-changed date because Zoho holds no Closing Date for them. */
        estimated: won.filter((d) => d.won_on_est),
        noClosingDate: rb_rows.filter((d) => d.status === 'won' && !d.closing),
      }];
    },
  });

  dash.calc('c90_meetings', {
    title: '90-day campaign meetings held',
    description: 'Zoho Meetings with a linked contact whose start time falls inside the campaign window and has already passed, in Central time, split by the contact: Founder Network by Relationship Type, Referral Business by the May 2026 - 100 B2B tag. Meetings with contacts in neither (ICP, Medical Courier, no campaign) and meetings with no linked contact are counted separately and left out of both tracks. The Events query carries no Meeting Status, so a past meeting that was cancelled or never happened still counts here; the P1 meeting frequency section on B2B Today is the stricter source for B2B prospects.',
    inputs: ['meetings'],
    fn: (meetings) => {
      const today = todayCT();
      const track = (m) => {
        if (!m.contact_id) return 'none';
        if (CC_RULES.isFN(m.rel)) return 'fn';
        if (CC_RULES.hasTag(m.tag, CC_RULES.tags.rp)) return 'ref';
        return 'other';
      };
      return meetings
        .filter((m) => m.Start_DateTime)
        .map((m) => ({
          title: m.Event_Title || 'Meeting', at: ctDay(m.Start_DateTime),
          contact: m.Who_Id || null, contact_id: m.Who_Id_id ? String(m.Who_Id_id) : null,
          rel: m['Who_Id.Relationship_Type'] || null, tag: m['Who_Id.Tag'] || null,
        }))
        .filter((m) => inWin(m.at) && m.at <= today)
        .map((m) => ({ ...m, track: track(m) }));
    },
  });

  /* ---- view ---- */

  let host = null;
  let drill = null;
  let drillBody = null;
  /* The block of the card the last click came from, so a list opens under the figure that opened it rather than at
     the foot of the whole card (Hemang, Nov 10, 2026): clicking Direct put its deals below Revenue by month. */
  let drillFrom = null;
  const noteFrom = (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !host || (drill && drill.contains(t))) return;
    let block = t;
    while (block && block.parentElement !== host) block = block.parentElement;
    if (block && block !== drill) drillFrom = block;
  };
  const placeDrill = () => {
    if (!host || !drill) return;
    const after = drillFrom && drillFrom.parentElement === host ? drillFrom : host.lastElementChild;
    if (after && after !== drill && after.nextElementSibling !== drill) after.after(drill);
  };

  const zLink = (text, module, id, title) => {
    if (!id) return document.createTextNode(text || '—');
    const a = el('a', 'cc-c90-zlink', text || '—');
    a.href = ZOHO + module + '/' + encodeURIComponent(id);
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = title;
    return a;
  };

  const STAGE_LABEL = { Closed: 'Closed Won' };

  const openDrill = (title, count) => {
    drill.querySelector('.cc-c90-drilltitle').textContent = title + ' (' + intF(count) + ')';
    drill.hidden = false;
  };
  const finishDrill = (body, note) => {
    drillBody.replaceChildren(body);
    if (note) drillBody.prepend(el('p', 'cc-c90-note', note));
    /* CC_SORT watches the document for new tables and wires this one itself. */
    placeDrill();
    drill.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const showDeals = (title, list, note) => {
    if (!drill) return;
    openDrill(title, list.length);
    if (!list.length) { finishDrill(el('p', 'cc-c90-note', 'No deals here yet.'), note); return; }
    const tbl = el('table', 'cc-tbl');
    const thead = el('thead');
    const hr = el('tr');
    ['Deal', 'Client', 'Referred by', 'Track', 'Stage', 'Amount', 'Won', 'Created'].forEach((h) => { const c = el('th', null, h); c.scope = 'col'; hr.append(c); });
    thead.append(hr);
    const tb = el('tbody');
    [...list]
      .sort((a, b) => String(b.won_on || b.created || '').localeCompare(String(a.won_on || a.created || '')))
      .forEach((d) => {
        const tr = el('tr');
        const name = el('td', 'cc-c90-dealcell');
        name.append(zLink(d.deal, 'Deals', d.id, 'Open the deal in Zoho CRM'));
        const client = el('td');
        client.append(d.contact_id ? zLink(d.contact, 'Contacts', d.contact_id, 'Open the contact in Zoho CRM') : document.createTextNode(d.account || '—'));
        if (d.contact_id && d.account) client.append(el('small', null, d.account));
        const by = el('td');
        by.append(d.by_id ? zLink(d.by, 'Contacts', d.by_id, 'Open the referrer in Zoho CRM') : document.createTextNode(d.by || d.by_account || '—'));
        /* A deal with no Amount in Zoho must never read as $0 (Hemang, Nov 10, 2026). */
        const amount = el('td', 'cc-c90-num', d.amount > 0 ? moneyF(d.amount) : 'Enter amount in CRM');
        if (!(d.amount > 0)) amount.classList.add('cc-c90-missing');
        const wonCell = el('td', null, d.status === 'won' ? fmtDate(d.won_on) : '—');
        if (d.status === 'won' && d.won_on_est) {
          wonCell.classList.add('cc-c90-est');
          wonCell.title = 'No Closing Date and no stage history for this deal — this is the date it was last changed, which any edit moves';
        }
        tr.append(
          name, client, by,
          el('td', null, TRACK_LABEL[trackOf(d)]),
          el('td', null, STAGE_LABEL[d.stage] || d.stage || '—'),
          amount, wonCell,
          el('td', null, fmtDate(d.created)),
        );
        tb.append(tr);
      });
    tbl.append(thead, tb);
    finishDrill(tbl, note);
  };

  const showMeetings = (title, list, note) => {
    if (!drill) return;
    openDrill(title, list.length);
    if (!list.length) { finishDrill(el('p', 'cc-c90-note', 'No meetings here yet.'), note); return; }
    const tbl = el('table', 'cc-tbl');
    const thead = el('thead');
    const hr = el('tr');
    ['Contact', 'Track', 'Date'].forEach((h) => { const c = el('th', null, h); c.scope = 'col'; hr.append(c); });
    thead.append(hr);
    const tb = el('tbody');
    [...list].sort((a, b) => String(b.at).localeCompare(String(a.at))).forEach((mt) => {
      const tr = el('tr');
      const who = el('td');
      who.append(mt.contact_id ? zLink(mt.contact, 'Contacts', mt.contact_id, 'Open the contact in Zoho CRM') : document.createTextNode('No contact linked'));
      tr.append(who, el('td', null, TRACK_LABEL[mt.track]), el('td', null, fmtDate(mt.at)));
      tb.append(tr);
    });
    tbl.append(thead, tb);
    finishDrill(tbl, note);
  };

  /* A figure that opens the records behind it. With nothing behind it the figure stays plain text, so a button can
     never open an empty list. */
  const fig = (tag, cls, text, onOpen) => {
    if (!onOpen) return el(tag, cls, text);
    const b = el('button', cls + ' cc-c90-open', text);
    b.type = 'button';
    b.addEventListener('click', onOpen);
    return b;
  };

  /* Progress bar: a solid fill for what is achieved and a tick where the window's weekdays say we should be today. */
  const bar = (done, target, share, tone) => {
    const wrap = el('div', 'cc-c90-bar');
    const pct = target > 0 ? Math.min(100, (done / target) * 100) : 0;
    const fill = el('span', 'cc-c90-fill cc-c90-fill-' + tone);
    fill.style.width = pct.toFixed(1) + '%';
    wrap.append(fill);
    if (target > 0 && share > 0 && share < 1) {
      const tick = el('span', 'cc-c90-tick');
      tick.style.left = (share * 100).toFixed(1) + '%';
      tick.title = 'Where the target says we should be today';
      wrap.append(tick);
    }
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', moneyF(done) + ' of ' + (target > 0 ? moneyF(target) : 'no target') + ', ' + Math.round(pct) + '% of target');
    return wrap;
  };

  /* The bars are colored by whether the target is met, still reachable from the open pipeline, or out of reach
     (Hemang, Nov 11, 2026). That retires the per-track hues on the bars: green already meant Founder Network here and
     in three other sections, so a green Founder Network bar would not say whether it was green for its identity or
     for hitting its number. The row label carries identity instead, and red/blue/green passes every palette check on
     both the light and dark panel — blue rather than amber for reachable, which against red is ΔE 2.1 for deutan
     viewers and is a warning color besides, when a target still in reach is not a warning. */
  const STATE = {
    met: { tone: 'met', word: 'Target met' },
    reachable: { tone: 'reachable', word: 'Reachable' },
    short: { tone: 'short', word: 'Not reachable' },
    none: { tone: 'none', word: 'No target' },
    open: { tone: 'reachable', word: 'In progress' },
    ahead: { tone: 'none', word: 'Not started' },
  };
  const chip = (tone) => el('span', 'cc-c90-chip cc-c90-chip-' + tone);

  const pct = (v, max) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);

  /* Revenue against target, one row per track, all three on one dollar axis so the bars are comparable.
     The rail is the axis (0 to the largest target), the fill is what has closed, the tick is that track's own
     target, and the caret is as far as the track could reach if every open deal closed — which is the coverage
     question the verdict turns on, read off the geometry: a caret short of the tick cannot reach the target. */
  const trackChart = (m) => {
    const sec = el('section', 'cc-c90-chart');
    const axisMax = Math.max(...m.tracks.map((t) => Math.max(t.target.revenue || 0, t.revenue)), 1);
    const head = el('div', 'cc-c90-charthead');
    head.append(el('h4', 'cc-c90-sub', 'Revenue by track'));
    head.append(el('p', 'cc-c90-note', 'The bar is what has closed, the tick is that track’s target, and the caret is as far as the track reaches if every open deal closes.'));
    sec.append(head);

    const rows = el('div', 'cc-c90-rows');
    m.tracks.forEach((t) => {
      const st = STATE[t.state];
      const row = el('div', 'cc-c90-row');
      const rh = el('div', 'cc-c90-rowhead');
      const name = el('span', 'cc-c90-rowname');
      name.append(document.createTextNode(t.label));
      rh.append(name);
      /* The state in words beside the bar: a status is never carried by color alone. */
      rh.append(el('span', 'cc-c90-state cc-c90-state-' + st.tone, st.word));
      const openWon = t.wonDeals.length ? () => showDeals(t.label + ' — closed in the window', t.wonDeals, t.why) : null;
      rh.append(fig('span', 'cc-c90-rowval', moneyF(t.revenue), openWon));
      rh.append(el('span', 'cc-c90-rowof', t.target.revenue ? 'of ' + moneyF(t.target.revenue) : 'no target on the sheet'));
      row.append(rh);

      const rail = el('div', 'cc-c90-rail');
      /* Nothing closed draws no bar: a minimum-width mark against $0 reads as a small amount rather than none. */
      if (t.revenue > 0) {
        const fill = el('span', 'cc-c90-barfill cc-c90-fill-' + st.tone);
        fill.style.width = pct(t.revenue, axisMax).toFixed(2) + '%';
        rail.append(fill);
      }
      if (t.target.revenue) {
        const tick = el('span', 'cc-c90-targettick');
        tick.style.left = pct(t.target.revenue, axisMax).toFixed(2) + '%';
        tick.title = 'Target ' + moneyF(t.target.revenue);
        rail.append(tick);
      }
      const reachAt = t.revenue + t.openValue;
      if (t.openValue > 0) {
        const over = reachAt > axisMax;
        const caret = el('span', 'cc-c90-reach' + (over ? ' cc-c90-reach-over' : ''));
        caret.style.left = pct(reachAt, axisMax).toFixed(2) + '%';
        caret.title = 'Reaches ' + moneyF(reachAt) + ' if every open deal closes'
          + (over ? ' — beyond the right edge of this axis' : '');
        rail.append(caret);
      }
      rail.setAttribute('role', 'img');
      rail.setAttribute('aria-label', t.label + ', ' + st.word.toLowerCase() + ': ' + moneyF(t.revenue) + ' closed'
        + (t.target.revenue ? ' of ' + moneyF(t.target.revenue) + ' target' : ', no target')
        + (t.openValue > 0 ? ', reaching ' + moneyF(reachAt) + ' if every open deal closes' : ''));
      row.append(rail);

      const facts = el('div', 'cc-c90-rowfacts');
      facts.append(metric('Deals closed', intF(t.closed), t.target.closed, openWon));
      facts.append(metric('Deals logged', intF(t.logged), t.target.logged,
        t.madeDeals.length ? () => showDeals(t.label + ' — logged in the window', t.madeDeals, t.why) : null));
      facts.append(metric('Open pipeline', moneyF(t.openValue), null,
        t.openDeals.length ? () => showDeals(t.label + ' — open deals', t.openDeals, t.why) : null, 'money'));
      row.append(facts);

      if (t.gap > 0) {
        const cover = el('p', t.covered ? 'cc-c90-note' : 'cc-c90-warn');
        cover.textContent = moneyF(t.gap) + ' still to close against ' + moneyF(t.openValue) + ' open'
          + (t.covered ? ' — enough in the pipeline to reach it.' : ' — not enough in the pipeline to reach it.');
        row.append(cover);
      }
      if (t.noAmount) {
        row.append(el('p', 'cc-c90-warn', intF(t.noAmount) + ' of the closed '
          + plural(t.noAmount, 'deal has', 'deals have') + ' no Amount in Zoho, so this figure is a floor.'));
      }
      rows.append(row);
    });
    sec.append(rows);

    const axis = el('div', 'cc-c90-axis');
    axis.append(el('span', null, moneyF(0)));
    axis.append(el('span', null, moneyF(axisMax)));
    sec.append(axis);
    return sec;
  };

  /* Revenue by month: one column a month against the $27,500 line, stacked by track in the same hues as the bars
     above, so the two charts share one legend and no fourth color is invented for the months. */
  const monthChart = (m) => {
    const sec = el('section', 'cc-c90-chart');
    const axisMax = Math.max(...m.months.map((mo) => Math.max(mo.target, mo.revenue)), 1);
    const head = el('div', 'cc-c90-charthead');
    head.append(el('h4', 'cc-c90-sub', 'Revenue by month'));
    head.append(el('p', 'cc-c90-note', 'Each month against its ' + moneyF(MONTHS[0].target) + ' share of the goal. A month that has not started is drawn as an outline, not a miss.'));
    sec.append(head);

    const plot = el('div', 'cc-c90-plot');
    const line = el('div', 'cc-c90-targetline');
    line.style.bottom = pct(MONTHS[0].target, axisMax).toFixed(2) + '%';
    line.title = 'Target ' + moneyF(MONTHS[0].target) + ' a month';
    plot.append(line, el('span', 'cc-c90-targetlabel', moneyF(MONTHS[0].target)));

    const cols = el('div', 'cc-c90-cols');
    m.months.forEach((mo) => {
      const st = STATE[mo.state];
      const col = el('div', 'cc-c90-col cc-c90-col-' + mo.when);
      if (mo.revenue > 0) {
        const bar2 = el('span', 'cc-c90-colbar cc-c90-fill-' + st.tone);
        bar2.style.height = pct(mo.revenue, axisMax).toFixed(2) + '%';
        /* The track split is no longer drawn as stacked segments — the column carries the month's state instead, and
           one color language runs across the whole card. Opening the column still lists every deal with its track. */
        bar2.title = mo.byTrack.filter((b) => b.amount > 0)
          .map((b) => b.label + ' ' + moneyF(b.amount)).join(' · ') || moneyF(mo.revenue);
        const hit = el('button', 'cc-c90-seghit');
        hit.type = 'button';
        hit.setAttribute('aria-label', mo.label + ', ' + moneyF(mo.revenue));
        hit.addEventListener('click', () => showDeals(mo.label + ' — closed deals', mo.wonDeals,
          'Deals whose won date falls in ' + mo.label + '.'));
        bar2.append(hit);
        col.append(bar2);
      }
      col.setAttribute('role', 'img');
      col.setAttribute('aria-label', mo.label + ', ' + st.word.toLowerCase() + ': '
        + moneyF(mo.revenue) + ' of ' + moneyF(mo.target));
      cols.append(col);
    });
    plot.append(cols);
    sec.append(plot);

    const labs = el('div', 'cc-c90-collabs');
    m.months.forEach((mo) => {
      const st = STATE[mo.state];
      const lab = el('div', 'cc-c90-collab cc-c90-col-' + mo.when);
      lab.append(fig('span', 'cc-c90-colval', moneyF(mo.revenue),
        mo.wonDeals.length ? () => showDeals(mo.label + ' — closed deals', mo.wonDeals, 'Deals whose won date falls in ' + mo.label + '.') : null));
      lab.append(el('span', 'cc-c90-colname', mo.label));
      lab.append(el('span', 'cc-c90-state cc-c90-state-' + st.tone, st.word));
      labs.append(lab);
    });
    sec.append(labs);
    return sec;
  };

  /* One status key for both charts. Every bar also prints its state in words, so this is a convenience, not the
     only way to read the color. */
  const LEGEND = [
    ['met', 'Target met'],
    ['reachable', 'Reachable from the open pipeline'],
    ['short', 'Not reachable'],
    ['none', 'No target on the sheet'],
  ];
  const legend = () => {
    const box = el('div', 'cc-c90-legend');
    LEGEND.forEach(([tone, word]) => {
      const item = el('span', 'cc-c90-legitem');
      item.append(chip(tone), document.createTextNode(word));
      box.append(item);
    });
    const tick = el('span', 'cc-c90-legitem');
    tick.append(el('span', 'cc-c90-legtick'), document.createTextNode('Target'));
    const reach = el('span', 'cc-c90-legitem');
    reach.append(el('span', 'cc-c90-legreach'), document.createTextNode('Reach if every open deal closes'));
    box.append(tick, reach);
    return box;
  };

  const stat = (label, value, sub, tone, onOpen) => {
    const box = el('div', 'cc-c90-stat');
    box.append(fig('span', 'cc-c90-stat-v' + (tone ? ' cc-c90-' + tone : ''), value, onOpen));
    box.append(el('div', 'cc-c90-stat-l', label));
    if (sub) box.append(el('div', 'cc-c90-stat-s', sub));
    return box;
  };

  /* One metric line inside a track: achieved against target, opening its deals. */
  const metric = (label, value, target, onOpen, unit) => {
    const row = el('div', 'cc-c90-metric');
    row.append(el('span', 'cc-c90-metric-l', label));
    row.append(fig('span', 'cc-c90-metric-v', value, onOpen));
    /* A track with no target on the sheet says so once, in its header; repeating it on every line is noise. */
    if (target != null) row.append(el('span', 'cc-c90-metric-t', 'of ' + (unit === 'money' ? moneyF(target) : intF(target))));
    return row;
  };

  const meetingBlock = (m) => {
    const card = el('section', 'cc-c90-mtg');
    card.append(el('h4', 'cc-c90-sub', 'Meetings held'));
    const d = dash.data('c90_meetings');
    if (d.status !== 'ok') {
      card.append(el('p', 'cc-c90-note', 'Zoho Meetings aren’t in this build, so meetings can’t be counted here.'));
      return card;
    }
    const all = d.data || [];
    const of = (k) => all.filter((x) => x.track === k);
    const ref = of('ref');
    const fn = of('fn');
    const other = of('other');
    const none = of('none');
    const row = el('div', 'cc-c90-mtgrow');
    row.append(
      stat('Referral Business', intF(ref.length), 'of 180 target', null, ref.length ? () => showMeetings('Referral Business meetings held', ref, 'Past Zoho Meetings in the window with a contact carrying the B2B tag.') : null),
      stat('Founder Network', intF(fn.length), 'of 60 target', null, fn.length ? () => showMeetings('Founder Network meetings held', fn, 'Past Zoho Meetings in the window with a Founder Network contact.') : null),
    );
    card.append(row);
    const left = [];
    if (other.length) left.push(intF(other.length) + ' with contacts in another campaign');
    if (none.length) left.push(intF(none.length) + ' with no contact linked');
    const note = el('p', 'cc-c90-note');
    note.append(document.createTextNode('Counted from Zoho Meetings only, between ' + fmtDate(m.from) + ' and today. The Events query carries no Meeting Status, so a past meeting that was cancelled still counts — the P1 meeting frequency section on B2B Today is the stricter source for B2B prospects, and it also sees the team’s Outlook calendars, which this does not.'));
    if (left.length) {
      note.append(document.createTextNode(' Left out of both: '));
      const b = el('button', 'cc-c90-open cc-c90-inline', left.join(' and ') + '.');
      b.type = 'button';
      b.addEventListener('click', () => showMeetings('Meetings left out of both tracks', [...other, ...none], 'These are in the window but belong to no campaign track, so neither number counts them.'));
      note.append(b);
    }
    card.append(note);
    return card;
  };

  const render = () => {
    if (!host) return;
    const d = dash.data('c90');
    if (d.status === 'loading') { host.replaceChildren(el('p', 'cc-c90-note', 'Loading the campaign figures…')); return; }
    if (d.status !== 'ok' || !d.data[0]) {
      host.replaceChildren(el('p', 'cc-c90-note', 'The campaign figures need the client-deal data, which isn’t in this build'
        + (d.message ? ' (' + d.message + ')' : '') + '.'));
      return;
    }
    const m = d.data[0];
    const frag = document.createDocumentFragment();

    const pace = m.target.revenue * m.share;
    const left = Math.max(0, m.target.revenue - m.revenue);
    const daysLeft = Math.max(0, m.weekdaysTotal - m.weekdaysGone);
    const met = m.revenue >= m.target.revenue;
    /* The verdict turns on coverage, not on an even weekday pace: with six deals to close in a quarter, pace says
       almost nothing — one deal moves it from behind to ahead — while whether each track's own open pipeline can
       reach its number is a question Zoho can actually answer. */
    const short = m.tracks.filter((t) => t.target.revenue && t.gap > 0 && !t.covered);

    const verdict = el('p', 'cc-c90-verdict ' + (met || !short.length ? 'cc-c90-good' : 'cc-c90-bad'));
    verdict.append(el('strong', null, met ? 'Target met.' : short.length ? 'At risk.' : 'On course.'));
    verdict.append(document.createTextNode(' ' + moneyF(m.revenue) + ' of ' + moneyF(m.target.revenue) + ' closed, with '
      + intF(daysLeft) + ' ' + plural(daysLeft, 'working day', 'working days') + ' left.'));
    if (!met) {
      if (short.length) {
        verdict.append(document.createTextNode(' ' + short.map((t) => t.label + ' needs ' + moneyF(t.gap)
          + ' more against ' + moneyF(t.openValue) + ' open').join(', and ') + '.'));
      } else {
        verdict.append(document.createTextNode(' ' + moneyF(left) + ' still to close, and every track has the open pipeline to reach it.'));
      }
    }
    frag.append(verdict);

    const top = el('div', 'cc-c90-top');
    top.append(
      stat('Closed so far', moneyF(m.revenue), intF(m.closed) + ' of ' + intF(m.target.closed) + ' ' + plural(m.target.closed, 'deal', 'deals'), met ? 'good' : null,
        m.wonDeals.length ? () => showDeals('Closed in the campaign window', m.wonDeals,
          'Every client deal at stage Closed whose won date falls between ' + fmtDate(m.from) + ' and ' + fmtDate(m.to) + '.') : null),
      stat('Still to close', moneyF(left), 'of the ' + moneyF(m.target.revenue) + ' target'),
      stat('Open pipeline', moneyF(m.openValue), intF(m.openCount) + ' open ' + plural(m.openCount, 'deal', 'deals') + ' it could come from', null,
        m.openDeals.length ? () => showDeals('Open client deals', m.openDeals,
          'Every client deal still open, whenever it was created. This is where the remaining ' + moneyF(left) + ' has to come from.') : null),
      stat('Deals logged', intF(m.logged), 'of ' + intF(m.target.logged) + ' target', m.logged >= m.target.logged ? 'good' : null,
        m.madeDeals.length ? () => showDeals('Deals logged in the campaign window', m.madeDeals,
          'Client deals Zoho created between ' + fmtDate(m.from) + ' and ' + fmtDate(m.to) + ', whatever stage they are at now.') : null),
    );
    frag.append(top);

    const overall = el('div', 'cc-c90-overall');
    overall.append(bar(m.revenue, m.target.revenue, m.share, STATE[m.state].tone));
    const onote = el('p', 'cc-c90-barnote');
    onote.append(el('span', 'cc-c90-state cc-c90-state-' + STATE[m.state].tone, STATE[m.state].word));
    onote.append(document.createTextNode(' — ' + Math.round((m.revenue / m.target.revenue) * 100) + '% of '
      + moneyF(m.target.revenue) + '. ' + intF(m.weekdaysGone) + ' of ' + intF(m.weekdaysTotal)
      + ' working days gone, so the tick sits at ' + moneyF(Math.round(pace)) + '.'));
    overall.append(onote);
    frag.append(overall);

    frag.append(legend());
    frag.append(trackChart(m));
    frag.append(monthChart(m));

    frag.append(meetingBlock(m));
    frag.append(caveats(m));
    frag.append(drill);
    host.replaceChildren(frag);
    drillFrom = null;
  };

  /* What the figures rest on, and what the sheet asks for that Zoho cannot answer. */
  const caveats = (m) => {
  const caveat = el('details', 'cc-c90-caveats');
  caveat.append(el('summary', null, 'How these figures are worked out, and what they can’t show'));
  const body = el('div', 'cc-c90-caveatbody');
  const dateNote = el('p');
  dateNote.append(el('strong', null, 'The close date is a stand-in. '));
  dateNote.append(document.createTextNode('Zoho’s Closing Date is empty on every deal in the CRM, so a deal is dated by when it entered the Closed stage in Zoho’s own Stage History. Zoho writes that once and later edits to the deal don’t move it. '));
  if (m.noClosingDate.length) {
    const b = el('button', 'cc-c90-open cc-c90-inline', 'Fill Closing Date on ' + intF(m.noClosingDate.length) + ' closed ' + plural(m.noClosingDate.length, 'deal', 'deals') + '.');
    b.type = 'button';
    b.addEventListener('click', () => showDeals('Closed deals with no Closing Date', m.noClosingDate,
      'Setting Closing Date in Zoho on each of these makes the campaign figures exact; the page prefers that field as soon as it holds a date.'));
    dateNote.append(b);
  }
  body.append(dateNote);
  const agreeNote = el('p');
  agreeNote.append(el('strong', null, 'Partner agreements are not revenue. '));
  agreeNote.append(document.createTextNode('Deals of type Reseller/ Referral Partner and Platform Provider Agreement are left out, so signing a partner never adds to the target. Referral Partner Deals and the Closed Won panel on B2B Today track those.'));
  body.append(agreeNote);
  const days = el('p');
  days.append(el('strong', null, 'Working days. '));
  days.append(document.createTextNode(intF(m.weekdaysTotal) + ' weekdays fall between ' + fmtDate(m.from) + ' and '
    + fmtDate(m.to) + '. The sheet counts 60, which presumably sets the holidays aside; this page counts every weekday, so the even-pace tick sits slightly later than the sheet’s would. The tick is a reference line only — the verdict is based on whether each track’s open pipeline can reach its number, not on pace.'));
  body.append(days);
  if (m.noAmount) {
    const amt = el('p');
    amt.append(el('strong', null, 'Every total is a floor. '));
    amt.append(document.createTextNode(intF(m.noAmount) + ' of the ' + intF(m.closed) + ' closed deals ' + plural(m.noAmount, 'has', 'have') + ' no Amount in Zoho.'));
    body.append(amt);
  }
  const nt = el('p');
  nt.append(el('strong', null, 'Not tracked. '));
  nt.append(document.createTextNode('The sheet’s activity targets have nowhere to be recorded in Zoho, so this card leaves them out rather than showing them as zero:'));
  body.append(nt);
  const ul = el('ul', 'cc-c90-nt');
  NOT_TRACKED.forEach((x) => ul.append(el('li', null, x)));
  body.append(ul);
  caveat.append(body);
    return caveat;
  };

  const mount = () => {
    const sec = document.getElementById('deals');
    if (!sec || document.getElementById('cc-c90')) return false;
    const card = el('article', 'cc-card');
    card.id = 'cc-c90';
    const head = el('div', 'cc-card-head');
    head.append(el('h3', null, '90-day sales campaign'));
    head.append(el('p', null, 'Nov 1, 2026 to Jan 31, 2027 against the ' + moneyF(82500) + ' goal, from the Amounts on closed deals in Zoho. Select a number to list the deals behind it.'));
    host = el('div', 'cc-c90-body');
    card.append(head, host);

    /* A nested panel rather than a second card: it sits between the blocks of this one. */
    drill = el('section', 'cc-c90-drill');
    drill.id = 'cc-c90-list';
    drill.hidden = true;
    const dh = el('div', 'cc-c90-drillhead');
    dh.append(el('h4', 'cc-c90-drilltitle', 'Deals'));
    const close = el('button', 'cc-c90-close', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => { drill.hidden = true; });
    dh.append(close);
    drillBody = el('div', 'cc-c90-drillbody');
    drill.append(dh, drillBody);
    host.append(drill);

    /* Clicks are noted in the capture phase, before the opener runs, so the list knows which block to sit under. */
    host.addEventListener('click', noteFrom, true);
    host.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') noteFrom(e); }, true);

    /* Right under "Deals at a glance" (Hemang, Nov 10, 2026). */
    const anchor = document.getElementById('dl-kpis');
    if (anchor) anchor.after(card); else sec.prepend(card);
    return true;
  };

  window.CC_C90 = { render };
  const start = () => { if (mount()) dash.onData(render); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
