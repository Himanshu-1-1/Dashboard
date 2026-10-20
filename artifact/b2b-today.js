/* B2B Today: the referral-partner operating view. Private Claude Dashboard only (named contacts); never deployed to
   the public site. Loaded after the page script; uses the page's CC_RULES and CC_IND. */
(() => {
  const R = CC_RULES;
  const IND = CC_IND;
  const ZOHO = 'https://crm.zoho.com/crm/org899412015/tab/';
  const MONDAY = 10;
  const STALE_DAYS = 14;
  const SR = { Closed: 6, Proposals: 5, Discovery: 4, Identify: 3, Hold: 2, 'Closed Lost': 1, 'Closed Lost to Competition': 1 };
  const OPEN = ['Identify', 'Discovery', 'Proposals'];
  const todayCT = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const dayMs = (s) => Date.parse(String(s).slice(0, 10) + 'T00:00:00Z');
  const tier = (t) => {
    const s = String(t || '').toLowerCase();
    if (!s.trim()) return 'No title';
    if (/\b(assistant|associate|intern|coordinator|executive assistant)\b/.test(s)) return 'Other title';
    if (/vice president|\bs?vp\b|\bevp\b/.test(s)) return 'Senior leader';
    if (/\b(co-?founder|founder|owner|ceo|chief executive|president|principal|managing partner|managing director)\b/.test(s)) return 'Founder, owner or CEO';
    if (/\b(director|head|chief|cto|cfo|coo|cio|cmo|partner)\b/.test(s)) return 'Senior leader';
    return 'Other title';
  };

  dash.calc('b2b_people', {
    title: 'B2B prospects, one row each',
    description: 'Every B2B campaign contact plus founder-network contacts tagged B2B (the B2B Campaign tab leaves those out), with role, company, LinkedIn status (Zoho, or Mack’s export where Zoho has not recorded it), meetings, partnership deal, signed agreement, client introductions and open tasks.',
    inputs: ['wi_b2b_people', 'wi_introducers', 'deals_tagged', 'referral_links', 'tasks_tagged', 'agreements', 'li_sync', 'wi_mack'],
    fn: (wi_b2b_people, wi_introducers, deals_tagged, referral_links, tasks_tagged, agreements, li_sync, wi_mack) => {
      const on = new Map();
      [...li_sync, ...wi_mack].forEach((m) => { if (m && m.Zoho_Id && m.Connected_On && !on.has(String(m.Zoho_Id))) on.set(String(m.Zoho_Id), String(m.Connected_On).slice(0, 10)); });
      const dnc = new Set(wi_introducers.filter((r) => r.DO_NOT_CONTACT).map((r) => String(r.id)));
      const base = wi_b2b_people.map((r) => ({ r, source: 'Source not recorded' }));
      const seen = new Set(base.map((x) => String(x.r.id)));
      wi_introducers.forEach((r) => {
        const id = String(r.id);
        if (seen.has(id) || !R.isFN(r.Relationship_Type) || !R.hasTag(r.Tag, R.tags.rp) || R.excluded(r.Priority)) return;
        seen.add(id);
        base.push({ r, source: 'Founder network' });
      });
      const byContact = (list) => { const m = new Map(); list.forEach((x) => { if (!x.k) return; const k = String(x.k); if (!m.has(k)) m.set(k, []); m.get(k).push(x.v); }); return m; };
      const partner = byContact(deals_tagged.filter((d) => d.kind === 'Partnership').map((d) => ({ k: d.contact_id, v: d })));
      const client = byContact(deals_tagged.filter((d) => d.kind === 'Client').map((d) => ({ k: d.contact_id, v: d })));
      const tasks = byContact(tasks_tagged.map((t) => ({ k: t.contact_id, v: t })));
      const refByContact = new Map();
      const refByAccount = new Map();
      referral_links.forEach((l) => {
        if (l.Referred_By_Contact_id) refByContact.set(String(l.Referred_By_Contact_id), (refByContact.get(String(l.Referred_By_Contact_id)) || 0) + 1);
        else if (l.Referred_By_Account_id) refByAccount.set(String(l.Referred_By_Account_id), (refByAccount.get(String(l.Referred_By_Account_id)) || 0) + 1);
      });
      const signedSign = new Set(agreements.filter((a) => a.kind === 'Referral agreement' && a.state === 'Signed' && a.contact_id).map((a) => String(a.contact_id)));
      const t0 = dayMs(todayCT());
      return base.map(({ r, source }) => {
        const id = String(r.id);
        const pd = (partner.get(id) || []).slice().sort((a, b) => (SR[b.stage] || 0) - (SR[a.stage] || 0));
        const best = pd[0] || null;
        const open = tasks.get(id) || [];
        const overdue = open.filter((t) => t.overdue);
        const industry = r['Account_Name.Industries'] || r.Industry || null;
        const zli = r.LI_Connect || null;
        const liOn = on.get(id) || null;
        return {
          id, name: r.Full_Name || '—', title: r.Title || null, tier: tier(r.Title), account: r.Account_Name || null, account_id: r.Account_Name_id || null,
          industry, fit: IND.classify(industry).fit, priority: r.Priority ? String(r.Priority) : null, source,
          li: zli, li_on: liOn, connected: zli === 'Connected' || Boolean(liOn), li_only: zli !== 'Connected' && Boolean(liOn),
          mack_old: Boolean(liOn && liOn < '2026-01-01'), met: Number(r.Total_Meetings_Created || 0),
          deal_stage: best ? best.stage : null, deal_id: best ? best.id : null, deal_name: best ? best.deal : null,
          deal_age: best && best.updated ? Math.round((t0 - dayMs(best.updated)) / 864e5) : null,
          signed: (best && best.stage === 'Closed') || signedSign.has(id),
          intros: (refByContact.get(id) || 0) + (r.Account_Name_id ? refByAccount.get(String(r.Account_Name_id)) || 0 : 0),
          client_only: !pd.length && (client.get(id) || []).length > 0,
          tasks: open.length, overdue: overdue.length, oldest: overdue.reduce((m, t) => Math.max(m, t.days_overdue || 0), 0),
          dnc: dnc.has(id), complete: Boolean(r.Account_Name && r.Title),
        };
      });
    },
  });

  dash.calc('b2b_funnel', {
    title: 'B2B partner funnel',
    description: 'Prospects at each step from campaign contact to a partner who has introduced a client. Steps are counted separately, so a person can show at a later step without a logged earlier one (for example, a signed partner with no meeting recorded).',
    inputs: ['b2b_people'],
    fn: (b2b_people) => {
      const n = (keep) => b2b_people.filter(keep).length;
      return [
        { key: 'all', label: 'B2B prospects', value: b2b_people.length },
        { key: 'connected', label: 'Connected on LinkedIn', value: n((p) => p.connected) },
        { key: 'met', label: 'Met at least once', value: n((p) => p.met > 0) },
        { key: 'deal', label: 'In a partnership deal', value: n((p) => p.deal_stage && SR[p.deal_stage] > 1) },
        { key: 'agreement', label: 'Agreement sent or signed', value: n((p) => p.signed || p.deal_stage === 'Proposals') },
        { key: 'signed', label: 'Signed partner', value: n((p) => p.signed) },
        { key: 'introduced', label: 'Introduced a client', value: n((p) => p.intros > 0) },
      ];
    },
  });

  dash.calc('b2b_segments', {
    title: 'Where meetings and signings come from',
    description: 'For each kind of prospect: how many, how many are connected, have met us and have signed. Describes the past; small groups prove nothing on their own.',
    inputs: ['b2b_people'],
    fn: (b2b_people) => {
      const dims = [
        ['Priority', (p) => (p.priority === '1' ? 'P1' : p.priority === '3' ? 'P3' : p.priority === '5' ? 'P5' : 'Other or not set')],
        ['Source', (p) => p.source],
        ['Role', (p) => p.tier],
        ['Company on record', (p) => (p.account ? 'Yes' : 'No')],
        ['Partner-type industry', (p) => (p.fit === 'partner' ? 'Consulting or IT firm' : p.fit === 'unknown' ? 'Industry not set' : 'Other industry')],
        ['Connected with Mack before 2026', (p) => (p.mack_old ? 'Yes' : 'No')],
      ];
      const out = [];
      dims.forEach(([dim, f]) => {
        const g = new Map();
        b2b_people.forEach((p) => { const k = f(p); if (!g.has(k)) g.set(k, []); g.get(k).push(p); });
        [...g.entries()].forEach(([seg, list]) => out.push({ key: dim + '|' + seg, dim, seg, n: list.length, connected: list.filter((p) => p.connected).length, met: list.filter((p) => p.met > 0).length, signed: list.filter((p) => p.signed).length }));
      });
      return out;
    },
  });

  dash.calc('b2b_actions', {
    title: 'B2B work queue',
    description: 'Today’s B2B work in the proposed order: overdue replies, other overdue follow-ups, agreements awaiting signature, meeting asks for connected P1 and P3 prospects, first-introduction asks for signed partners, and partnership deals untouched for 14 days or more.',
    inputs: ['b2b_people', 'tasks_tagged', 'agreements'],
    fn: (b2b_people, tasks_tagged, agreements) => {
      const ppl = new Map(b2b_people.map((p) => [p.id, p]));
      const rows = [];
      const add = (r) => rows.push({ key: r.type + '|' + r.id + '|' + rows.length, ...r });
      tasks_tagged.filter((t) => t.contact_id && ppl.has(String(t.contact_id)) && (t.overdue || t.due === todayCT())).forEach((t) => {
        const p = ppl.get(String(t.contact_id));
        const s = t.subject || '';
        const reply = /respon|repl|message|get back|answer/i.test(s);
        const agree = /agreement|mnda|sign|contract|\bpp\b/i.test(s);
        add({ order: reply ? 1 : agree ? 3 : 2, type: reply ? 'Reply' : agree ? 'Agreement' : 'Follow-up', sop: reply ? 3 : agree ? 5 : 3, id: p.id, name: p.name, account: p.account, task_id: t.id,
          action: s, why: p.signed ? 'Signed partner' : p.met ? `Met ${p.met === 1 ? 'once' : p.met + ' times'}` : p.priority ? `P${p.priority}` : 'Campaign contact',
          why_now: t.days_overdue ? `Task due ${t.due}, ${t.days_overdue} ${t.days_overdue === 1 ? 'day' : 'days'} late` : 'Task due today', late: t.days_overdue || 0,
          done: reply ? 'Your reply is sent' : agree ? 'The agreement step is done' : 'The follow-up is sent', record: 'Close the task; set the next one with a due date' });
      });
      agreements.filter((a) => a.kind === 'Referral agreement' && (a.state === 'Out for signature' || /^Expired/.test(a.state)) && a.contact_id && ppl.has(String(a.contact_id))).forEach((a) => {
        const p = ppl.get(String(a.contact_id));
        add({ order: 3, type: 'Agreement', sop: 5, id: p.id, name: p.name, account: p.account, action: a.state === 'Out for signature' ? 'Chase the signature' : 'Re-send the agreement',
          why: 'Agreement in Zoho Sign', why_now: a.state === 'Out for signature' ? (a.days_left != null ? `Deadline in ${a.days_left} days` : 'Out for signature') : 'Expired, not re-sent', late: a.days_left != null && a.days_left < 0 ? -a.days_left : 0,
          done: 'Signed, or a new copy sent', record: 'Partnership deal stage and next step' });
      });
      b2b_people.filter((p) => (p.priority === '1' || p.priority === '3') && p.connected && !p.met && !p.tasks && !p.signed && !p.dnc).forEach((p) => {
        add({ order: 4, type: 'Meeting ask', sop: 4, id: p.id, name: p.name, account: p.account, action: 'Ask for a first meeting', why: `P${p.priority}, connected${p.li_only ? ' (Mack’s LinkedIn; Zoho not updated)' : ''}`,
          why_now: 'Connected, never met, nothing scheduled', late: 0, done: 'Booking link sent', record: 'Log the ask; a check-in task on the approved cadence' });
      });
      b2b_people.filter((p) => p.signed && !p.intros).forEach((p) => {
        add({ order: 5, type: 'First introduction', sop: 6, id: p.id, name: p.name, account: p.account, action: 'Ask for the first introduction', why: 'Signed partner',
          why_now: 'No client introduction recorded yet', late: 0, done: 'You asked, with one client problem they can spot', record: 'A task for the follow-up; Referred By on any deal that comes' });
      });
      b2b_people.filter((p) => OPEN.includes(p.deal_stage) && p.deal_age != null && p.deal_age >= STALE_DAYS && !p.tasks).forEach((p) => {
        add({ order: 6, type: 'Revive deal', sop: 5, id: p.id, name: p.name, account: p.account, action: `Move the ${p.deal_stage} deal forward`, why: `Partnership deal in ${p.deal_stage}`,
          why_now: `Not updated for ${p.deal_age} days`, late: p.deal_age, done: 'Next step agreed, or the deal closed', record: 'Deal stage and next step' });
      });
      return rows.sort((a, b) => a.order - b.order || b.late - a.late || String(a.name).localeCompare(String(b.name)));
    },
  });

  dash.calc('b2b_monday', {
    title: 'Monday selection candidates',
    description: 'P5 prospects not yet met, with no open task, not marked Do Not Contact and not client prospects, ordered by how much partner evidence their record shows (proposed order, awaiting approval): founder, owner or CEO role; consulting or IT firm; company on record; connected on LinkedIn; connected with Mack before 2026.',
    inputs: ['b2b_people'],
    fn: (b2b_people) => b2b_people
      .filter((p) => p.priority === '5' && !p.met && !p.tasks && !p.dnc && !p.client_only && p.source !== 'Founder network')
      .map((p) => {
        const ev = [];
        if (p.tier === 'Founder, owner or CEO') ev.push('Founder, owner or CEO');
        if (p.fit === 'partner') ev.push('Consulting or IT firm');
        if (p.account) ev.push('Company on record');
        if (p.connected) ev.push(p.li_only ? 'Connected (Mack’s LinkedIn)' : 'Connected');
        if (p.mack_old) ev.push('Known to Mack before 2026');
        return { ...p, evidence: ev, strength: ev.length };
      })
      .sort((a, b) => b.strength - a.strength || String(a.name).localeCompare(String(b.name))),
  });

  dash.calc('b2b_weeks', {
    title: 'B2B meetings by week',
    description: 'Meetings with B2B prospects in each of the last 12 weeks (Monday start, Central time), by meeting date. Meetings entered late raise past weeks after the fact.',
    inputs: ['meetings', 'b2b_people'],
    fn: (meetings, b2b_people) => {
      const ids = new Set(b2b_people.map((p) => p.id));
      const monday = (s) => { const d = new Date(String(s).slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
      const now = monday(todayCT());
      const weeks = Array.from({ length: 12 }, (_, i) => { const d = new Date(now + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 7 * (11 - i)); return d.toISOString().slice(0, 10); });
      const count = new Map(weeks.map((w) => [w, 0]));
      meetings.forEach((m) => {
        if (!m.Start_DateTime || !m.Who_Id_id || !ids.has(String(m.Who_Id_id))) return;
        const ct = new Date(m.Start_DateTime).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
        const w = monday(ct);
        if (count.has(w)) count.set(w, count.get(w) + 1);
      });
      return weeks.map((w) => ({ week: w, meetings: count.get(w) }));
    },
  });

  /* ---------- view ---------- */
  const root = document.querySelector('#b2-root');
  if (!root) return;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const intF = (v) => Number(v || 0).toLocaleString('en-US');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const link = (module, id, text) => { const a = el('a', 'cc-zlink', text); a.href = ZOHO + module + '/' + id; a.target = '_blank'; a.rel = 'noopener'; a.title = 'Open in Zoho CRM'; return a; };
  const dayF = (s) => { const d = new Date(String(s).slice(0, 10) + 'T00:00:00Z'); return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }); };
  const state = (ids) => { const st = ids.map((id) => dash.data(id).status); if (st.some((s) => s === 'loading')) return 'loading'; return st.every((s) => s === 'ok') ? 'ok' : 'error'; };
  const rows = (id) => { const d = dash.data(id); return d.status === 'ok' ? d.data || [] : []; };
  const sopBtn = (n, label) => { const b = el('button', 'cc-b2-sop', label || 'SOP ' + n); b.type = 'button'; b.dataset.sop = n; return b; };

  const SOPS = [
    ['1', 'Add and select a partner prospect', 'When you add someone to B2B, or work the Monday queue.', ['Check Zoho for the person and the company first. Never create a duplicate.', 'Fill company, title and source: Founder Network or Researched.', 'Founder network: set the starting stage the rules allow and write the reason. Researched: leave at P5 for the Monday queue.', 'From the Monday queue: select with one line of evidence per fit question and set P4, or skip and record the reason.'], null, 'The record is complete and the stage matches the rules.', 'The person works for a competitor or an existing client, or another rep already owns them.'],
    ['2', 'First outreach', 'A selected (P4) contact has no outreach yet.', ['Read their profile and company. Note one problem their clients deal with.', 'Send the connection note, or a message if you are already connected.', 'In Zoho, set LI Connect to Requested, or log the message.', 'Never send a second request while one is pending.'], 'Hi {first name}, your clients in {industry} seem to be wrestling with {problem}. I work on that side of things and would like to compare notes. Glad to connect.', 'The request or message is sent and recorded.', 'You are unsure whether someone already contacted them.'],
    ['3', 'Reply and follow up', 'They wrote back, or a follow-up task is due.', ['Read the whole thread and the Zoho notes.', 'Answer their actual point first, in a few lines. No sales pitch.', 'If they want to talk, use SOP 4.', 'Close the task, log the message and set the next task with a due date.'], null, 'Your reply is sent and the next task exists.', 'They ask about commission, exclusivity or agreement terms.'],
    ['4', 'Ask for a first meeting', 'Two-way contact exists (P3) and no meeting has been asked for.', ['Send the approved booking link with the message below.', 'Log that you asked, and set a check-in task on the approved cadence.'], "Would a 20-minute call help? I'd like to hear which client problems come up most for you, and see whether we can help each other. Here's my booking link.", 'The link is sent and a check-in task exists.', 'They want to bring someone else, or talk terms first.'],
    ['5', 'Send and follow up on the agreement', 'After a meeting where the partner said yes to discussing a partnership (P1), or an agreement is waiting.', ['Send the approved referral agreement through Zoho Sign with the company overview.', 'Move the partnership deal to Proposals.', 'Set a follow-up task on the approved cadence.'], null, 'The agreement is out (or signed) and the deal stage matches.', 'The partner asks for changes to the agreement.'],
    ['6', 'Introductions and partner updates', 'A signed partner has not introduced anyone yet, a partner introduces a client, or a referred deal changes stage.', ['No introduction yet: name one client problem we solve that their clients have, and ask whether anyone comes to mind.', 'An introduction: create the client deal and fill Referred By with the partner. A partnership deal never refers itself.', 'When the referred deal moves, send one short update. No internal detail, no request for their time.'], "Quick update on {client}: we've {met them / sent a proposal / started work}. Thanks again for the introduction.", 'Referred By is filled and the update is logged.', 'You are unsure which partner made the introduction.'],
    ['7', 'Log a meeting', 'On the day of the meeting.', ['Check whether the booking tool already created it. Do not add it twice.', 'Write the outcome the same day.', 'Change the stage only if the partner stated interest. A meeting alone never moves the stage.'], null, 'The outcome is in Zoho the same day.', 'The meeting raised commercial questions you cannot answer.'],
    ['8', 'Pause or close a prospect', 'No response after the approved cadence, they ask to stop, or they are not a fit.', ['Move the stage back, or close it out, with a reason.', 'Tick Do Not Contact if they asked you to stop.', 'Cancel open tasks that no longer apply.'], null, 'Nothing remains open on the contact.', 'Two reps claim the same contact.'],
  ];

  const card = (id, title, sub, extra) => {
    const c = el('article', 'cc-card' + (extra ? ' ' + extra : ''));
    c.id = id;
    const h = el('div', 'cc-card-head');
    h.append(el('h3', null, title));
    if (sub) h.append(el('p', null, sub));
    c.append(h);
    return c;
  };

  /* Static structure, built once. */
  root.replaceChildren();
  const head = el('div', 'cc-b2-head');
  const t = el('div', 'cc-wi-title');
  t.append(el('h2', null, 'B2B Today'), el('p', null, 'What the B2B referral-partner campaign needs next, who to work today, and how to do it right.'));
  const verdict = el('p', 'cc-b2-verdict');
  verdict.id = 'b2-verdict';
  head.append(t, verdict);
  const tiles = el('div', 'cc-b2-tiles');
  tiles.id = 'b2-tiles';
  const grid1 = el('div', 'cc-grid');
  const funnelCard = card('b2-funnel', 'From prospect to introduction', 'Each step counted on its own from Zoho. Select a step to list the people in it.');
  const funnelBody = el('div', 'cc-b2-funnel');
  const funnelNote = el('p', 'cc-b2-insight');
  funnelCard.append(funnelBody, funnelNote);
  const stepsCard = card('b2-steps', 'What to do next', 'Worked out from today’s data, most urgent first. Select a step for its list.');
  const stepsBody = el('ol', 'cc-b2-steps');
  stepsCard.append(stepsBody);
  grid1.append(funnelCard, stepsCard);
  const nextCard = card('b2-next', 'Do this next', 'The first item in today’s queue, with everything needed to do it right.', 'cc-b2-nextcard');
  const nextBody = el('div', 'cc-b2-nextbody');
  nextCard.append(nextBody);
  const queueCard = card('b2-queue', 'Today’s queue', 'In order: replies, follow-ups, agreements, meeting asks, first introductions, stalled deals. Select a row to make it the next action.');
  const queueTools = el('div', 'cc-tools cc-b2-chips');
  const queueBody = el('div', 'cc-b2-wrap');
  queueCard.append(queueTools, queueBody);
  const monCard = card('b2-monday', 'Monday selection queue', `Up to ${MONDAY} P5 prospects to review each week. Ordered by the partner evidence on their record; the order is proposed, awaiting Mack. Select or skip each one in Zoho.`);
  const monBody = el('div', 'cc-b2-wrap');
  const monMore = el('div', 'cc-tools');
  monCard.append(monBody, monMore);
  const grid2 = el('div', 'cc-grid');
  const segCard = card('b2-seg', 'Where meetings and signings come from', 'Share of each group that has met us, and how many signed. It describes the past; it does not prove a cause, and small groups can mislead.');
  const segBody = el('div', 'cc-b2-seg');
  const segNote = el('p', 'cc-b2-insight');
  segCard.append(segBody, segNote);
  const weekCard = card('b2-weeks', 'Meetings with B2B prospects, last 12 weeks', 'By meeting date. Meetings logged late raise past weeks after the fact, so the latest weeks can look low.');
  const weekBody = el('div', 'cc-b2-weeks');
  const weekNote = el('p', 'cc-b2-insight');
  weekCard.append(weekBody, weekNote);
  grid2.append(segCard, weekCard);
  const dqCard = card('b2-dq', 'Data that limits this page', 'Missing data is shown as missing, never as zero. Fix these in Zoho and the counts above become trustworthy.');
  const dqBody = el('ul', 'cc-b2-dq');
  dqCard.append(dqBody);

  const stagesCard = card('b2-stages', 'Relationship stages', 'Proposed, awaiting Mack. A stage changes only on evidence you can point to; a meeting alone or an accepted connection never moves it.');
  const stages = el('ol', 'cc-b2-stages');
  [['P5 Backlog', 'In the campaign, not selected', 'Next: the Monday queue'], ['P4 Selected', 'Chosen, with fit evidence', 'Next: first outreach (SOP 2)'], ['P3 Two-way contact', 'They wrote back or spoke with us', 'Next: ask for a meeting (SOP 4)'], ['P1 Active pursuit', 'Met, and agreed to explore a partnership', 'Next: the agreement (SOP 5)'], ['P2', 'Meaning not decided', 'Unused until Mack decides']].forEach(([a, b, c], i) => {
    const li = el('li', 'cc-b2-stage' + (i === 4 ? ' cc-b2-stage-open' : ''));
    li.append(el('b', null, a), el('span', null, b), el('small', null, c));
    stages.append(li);
  });
  stagesCard.append(stages);

  const sopCard = card('b2-sops', 'SOP library', 'Drafts, awaiting approval. Timings say “approved cadence” until Mack sets them.');
  const sl = el('label', 'cc-b2-searchlab');
  const sr = el('span', 'cc-b2-sr', 'Search the SOPs');
  const search = el('input', 'cc-b2-search');
  search.type = 'search'; search.placeholder = 'Search: reply, meeting, agreement…'; search.autocomplete = 'off';
  sl.append(sr, search);
  const sopList = el('div');
  SOPS.forEach(([n, title, when, steps, tpl, done, ask]) => {
    const d = el('details', 'cc-b2-sopd');
    d.id = 'b2-sop-' + n;
    const s = el('summary');
    s.append(el('b', null, 'SOP ' + n), document.createTextNode(' ' + title));
    const body = el('div', 'cc-b2-sopbody');
    const w = el('p'); w.append(el('span', 'cc-b2-k', 'When'), document.createTextNode(when)); body.append(w);
    const ol = el('ol'); steps.forEach((x) => ol.append(el('li', null, x))); body.append(ol);
    if (tpl) {
      const tp = el('div', 'cc-b2-tpl');
      const cb = el('button', 'cc-go', 'Copy message'); cb.type = 'button';
      cb.addEventListener('click', async () => { try { await navigator.clipboard.writeText(tpl); cb.textContent = 'Copied'; } catch (e) { cb.textContent = 'Select the text to copy'; } setTimeout(() => { cb.textContent = 'Copy message'; }, 1800); });
      tp.append(el('p', null, tpl), cb);
      body.append(tp);
    }
    const dn = el('p'); dn.append(el('span', 'cc-b2-k', 'Done when'), document.createTextNode(done)); body.append(dn);
    const ak = el('p'); ak.append(el('span', 'cc-b2-k', 'Ask a manager'), document.createTextNode(ask)); body.append(ak);
    d.append(s, body);
    sopList.append(d);
  });
  const empty = el('p', 'cc-b2-empty', 'No SOP matches. Try another word.'); empty.hidden = true;
  search.addEventListener('input', () => {
    const v = search.value.trim().toLowerCase();
    let shown = 0;
    sopList.querySelectorAll('.cc-b2-sopd').forEach((d) => { const hit = !v || d.textContent.toLowerCase().includes(v); d.hidden = !hit; if (hit) shown += 1; });
    empty.hidden = shown > 0;
  });
  sopCard.append(sl, sopList, empty);

  const drill = card('b2-list', 'People', null, 'cc-b2-drill');
  drill.hidden = true;
  const drillBody = el('div', 'cc-b2-wrap');
  const drillClose = el('button', 'cc-go', 'Close'); drillClose.type = 'button';
  drillClose.addEventListener('click', () => { drill.hidden = true; });
  drill.querySelector('.cc-card-head').append(drillClose);
  drill.append(drillBody);

  root.append(head, tiles, grid1, drill, nextCard, queueCard, monCard, grid2, stagesCard, sopCard, dqCard);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sop]');
    if (!b) return;
    const d = root.querySelector('#b2-sop-' + b.dataset.sop);
    if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); const s = d.querySelector('summary'); if (s) s.focus({ preventScroll: true }); }
  });

  /* People list (drill). */
  const showPeople = (title, list, note) => {
    drill.querySelector('h3').textContent = title + ' (' + intF(list.length) + ')';
    const tbl = el('table', 'cc-tbl');
    const th = el('thead'); const hr = el('tr');
    ['Name', 'Company', 'Role', 'Priority', 'LinkedIn', 'Met', 'Partnership deal'].forEach((x) => { const c = el('th', null, x); c.scope = 'col'; hr.append(c); });
    th.append(hr); tbl.append(th);
    const tb = el('tbody');
    list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach((p) => {
      const tr = el('tr');
      const n = el('td'); n.append(link('Contacts', p.id, p.name)); tr.append(n);
      const a = el('td'); if (p.account_id) a.append(link('Accounts', p.account_id, p.account)); else a.textContent = 'No company'; tr.append(a);
      tr.append(el('td', null, p.title || 'No title'), el('td', null, p.priority ? 'P' + p.priority : 'Not set'), el('td', null, p.li_only ? 'Connected (Mack’s LinkedIn)' : p.li || 'Not set'), el('td', null, p.met ? intF(p.met) : '—'));
      const d = el('td'); if (p.deal_id) d.append(link('Potentials', p.deal_id, p.deal_stage)); else d.textContent = '—'; tr.append(d);
      tb.append(tr);
    });
    tbl.append(tb);
    drillBody.replaceChildren(tbl);
    if (note) drillBody.prepend(el('p', 'cc-b2-insight', note));
    drill.hidden = false;
    drill.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const PEOPLE_KEEP = {
    all: (p) => true, connected: (p) => p.connected, met: (p) => p.met > 0, deal: (p) => p.deal_stage && SR[p.deal_stage] > 1,
    agreement: (p) => p.signed || p.deal_stage === 'Proposals', signed: (p) => p.signed, introduced: (p) => p.intros > 0,
  };
  const press = (node, fn) => { node.tabIndex = 0; node.setAttribute('role', 'button'); node.addEventListener('click', fn); node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } }); };

  let queueFilter = 'All';
  let queueAll = false;
  let picked = 0;
  let monPage = 0;

  const drawNext = (a) => {
    nextBody.replaceChildren();
    if (!a) { nextBody.append(el('p', 'cc-b2-insight', 'Nothing is due today. Work the Monday queue, then ask connected P1 and P3 prospects for a first meeting.')); return; }
    const left = el('div');
    const act = el('p', 'cc-b2-action'); act.append(document.createTextNode(a.type + ': '), link('Contacts', a.id, a.name));
    left.append(act, el('p', 'cc-b2-who', [a.account || 'No company on record', a.why].join('. ')));
    const dl = el('dl', 'cc-b2-dl');
    const pair = (k, v) => { dl.append(el('dt', null, k)); const dd = el('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; dl.append(dd); };
    pair('What to do', a.action);
    pair('Why now', a.why_now);
    pair('SOP', sopBtn(a.sop, 'SOP ' + a.sop + ' ' + (SOPS.find((s) => s[0] === String(a.sop)) || [])[1]));
    pair('Done when', a.done);
    pair('Record it', a.record);
    pair('Then', a.sop === 3 ? 'If they want to talk, ask for a first meeting (SOP 4).' : a.sop === 4 ? 'When they book, log the meeting the same day (SOP 7).' : a.sop === 5 ? 'Once signed, ask for the first introduction (SOP 6).' : 'Keep the partner informed as the deal moves (SOP 6).');
    nextBody.append(left, dl);
  };

  const draw = () => {
    const st = state(['b2b_people', 'b2b_actions', 'b2b_monday', 'b2b_funnel', 'b2b_segments']);
    if (st !== 'ok') {
      const msg = st === 'loading' ? 'Loading from Zoho…' : 'Some Zoho data did not load, so this page cannot be worked out. Reload, or check the source in the dashboard menu.';
      verdict.textContent = msg; verdict.classList.toggle('cc-b2-bad', st === 'error');
      [tiles, funnelBody, stepsBody, nextBody, queueBody, monBody, segBody, dqBody].forEach((n) => n.replaceChildren(el('p', st === 'error' ? 'cc-b2-bad' : 'cc-b2-insight', st === 'error' ? 'Unavailable' : 'Loading…')));
      return;
    }
    verdict.classList.remove('cc-b2-bad');
    const ppl = rows('b2b_people');
    const acts = rows('b2b_actions');
    const mon = rows('b2b_monday');
    const fun = rows('b2b_funnel');
    const seg = rows('b2b_segments');
    const fv = (k) => (fun.find((r) => r.key === k) || {}).value || 0;
    const count = (type) => acts.filter((a) => a.type === type).length;
    const strong = mon.filter((m) => m.strength >= 3).length;
    const fnN = ppl.filter((p) => p.source === 'Founder network').length;

    verdict.textContent = `${intF(fv('met'))} of ${intF(fv('all'))} B2B prospects have met us and ${intF(fv('signed'))} have signed, but only ${intF(fv('introduced'))} ${fv('introduced') === 1 ? 'partner has' : 'partners have'} introduced a client. The work is conversations and activation, not more names: ${intF(count('Reply') + count('Follow-up'))} follow-ups are overdue, ${intF(count('Meeting ask'))} connected P1 and P3 prospects have never been asked to meet, and ${intF(count('First introduction'))} signed partners have not been asked for an introduction.`;

    /* Tiles: Add, Select, Build relationships. */
    tiles.replaceChildren();
    const tile = (n, name, stateText, stateCls, big, bigLabel, lines, sops) => {
      const c = el('article', 'cc-card cc-b2-tile');
      const h = el('header', 'cc-b2-tilehead');
      h.append(el('span', 'cc-b2-n', n), el('h3', null, name), el('span', 'cc-b2-state ' + stateCls, stateText));
      const b = el('p', 'cc-b2-big'); b.append(el('b', null, big), el('span', null, bigLabel));
      const ul = el('ul', 'cc-b2-lines'); lines.forEach((x) => ul.append(el('li', null, x)));
      const s = el('p', 'cc-b2-sops'); sops.forEach(([k, l]) => s.append(sopBtn(k, l)));
      c.append(h, b, ul, s);
      tiles.append(c);
    };
    const incomplete = ppl.filter((p) => !p.complete).length;
    const fixN = ppl.filter((p) => p.client_only || !p.complete).length;
    const clients = ppl.filter((p) => p.client_only).length;
    tile('1', 'Add', 'Target awaiting confirmation', 'cc-b2-wait', intF(ppl.length), 'B2B prospects, including ' + intF(fnN) + ' from the founder network', [
      'Campaign additions cannot yet be measured reliably: Zoho records when a contact was created, not when it joined the campaign.',
      `${intF(incomplete)} have no company or no title, so they can’t be judged as partners yet.`,
      `${intF(clients)} tagged B2B are client prospects (a client deal, no partner deal). Partners refer buyers; they aren’t buyers.`,
      'Monthly target: 10 or 50 new partners, awaiting Mack.',
    ], [['1', 'SOP 1 Add']]);
    tile('2', 'Select', `Confirmed: ${MONDAY} every Monday`, 'cc-b2-ok', intF(ppl.filter((p) => p.priority === '5').length), 'in the P5 backlog', [
      `${intF(mon.length)} can be offered in the Monday queue; ${intF(strong)} show three or more signs of a good partner.`,
      `At ${MONDAY} a week that is ${intF(Math.ceil(strong / MONDAY))} weeks of strong candidates.`,
      'Nobody advances by appearing in the queue: select with evidence, or skip with a reason.',
      'Selections per week can’t be counted until Zoho records when a stage changes.',
    ], [['1', 'SOP 1 Select']]);
    tile('3', 'Build relationships', 'Rules proposed', 'cc-b2-wait', intF(acts.length), 'items in today’s queue', [
      `${intF(count('Reply'))} replies and ${intF(count('Follow-up'))} follow-ups overdue; ${intF(count('Agreement'))} agreement steps waiting.`,
      `${intF(ppl.filter((p) => p.connected && !p.met).length)} connected prospects have never met us.`,
      'An accepted LinkedIn connection is not a conversation; two-way contact means they wrote back or spoke with us.',
      'Replies and conversations by day can’t be counted until Zoho logs them as events.',
    ], [['3', 'SOP 3'], ['4', 'SOP 4'], ['5', 'SOP 5'], ['6', 'SOP 6'], ['7', 'SOP 7']]);

    /* Funnel. */
    funnelBody.replaceChildren();
    const first = fv('all') || 1;
    let worst = null;
    fun.forEach((r, i) => {
      const prev = i ? fun[i - 1].value : null;
      const share = prev ? r.value / prev : null;
      if (i > 0 && prev && (worst == null || share < worst.share)) worst = { i, share, r, prev };
      const row = el('div', 'cc-b2-frow');
      const lab = el('span', 'cc-b2-flab', r.label);
      const bar = el('span', 'cc-b2-fbar');
      const fill = el('i'); fill.style.width = Math.max(0.6, (r.value / first) * 100) + '%'; bar.append(fill);
      const val = el('span', 'cc-b2-fval'); val.append(el('b', null, intF(r.value)));
      if (share != null) val.append(el('small', null, pct(r.value, prev) + ' of the step above'));
      row.append(lab, bar, val);
      row.dataset.key = r.key;
      press(row, () => showPeople(r.label, ppl.filter(PEOPLE_KEEP[r.key]), r.key === 'connected' ? 'Includes connections found in Mack’s LinkedIn export that Zoho has not recorded.' : null));
      funnelBody.append(row);
    });
    if (worst) funnelBody.children[worst.i].classList.add('cc-b2-worst');
    const lc = (x) => x.charAt(0).toLowerCase() + x.slice(1);
    funnelNote.textContent = worst ? `Biggest drop: ${lc(fun[worst.i - 1].label)} to ${lc(worst.r.label)}, ${pct(worst.r.value, worst.prev)} carry on. Steps are counted separately: ${intF(ppl.filter((p) => p.signed && !p.met).length)} signed partners show no logged meeting, so the logged meeting count is low.` : '';

    /* Next steps. */
    stepsBody.replaceChildren();
    const steps = [
      [count('Reply') + count('Follow-up'), `Clear ${intF(count('Reply') + count('Follow-up'))} overdue replies and follow-ups`, `The oldest is ${intF(Math.max(0, ...acts.filter((a) => a.type === 'Reply' || a.type === 'Follow-up').map((a) => a.late)))} days late. Replies first: a conversation goes cold faster than a task.`, () => { queueFilter = 'Reply'; drawQueue(); queueCard.scrollIntoView({ behavior: 'smooth' }); }, '3'],
      [count('Agreement'), `Move ${intF(count('Agreement'))} agreement steps`, 'Signatures waiting and agreement tasks overdue. Each signed partner is a channel; an unsigned one is a conversation.', () => { queueFilter = 'Agreement'; drawQueue(); queueCard.scrollIntoView({ behavior: 'smooth' }); }, '5'],
      [count('Meeting ask'), `Ask ${intF(count('Meeting ask'))} connected P1 and P3 prospects for a first meeting`, 'Top priority, already connected, never met and nothing scheduled. P1 prospects meet us far more often than P5.', () => { queueFilter = 'Meeting ask'; drawQueue(); queueCard.scrollIntoView({ behavior: 'smooth' }); }, '4'],
      [count('First introduction'), `Ask ${intF(count('First introduction'))} signed partners for their first introduction`, 'A signed agreement earns nothing until it produces an introduction. Name one client problem we solve and ask who comes to mind.', () => { queueFilter = 'First introduction'; drawQueue(); queueCard.scrollIntoView({ behavior: 'smooth' }); }, '6'],
      [mon.length, `Pick ${MONDAY} from the Monday queue`, `${intF(strong)} P5 prospects show three or more partner signs. Select with evidence or skip with a reason.`, () => monCard.scrollIntoView({ behavior: 'smooth' }), '1'],
      [count('Revive deal'), `Revive ${intF(count('Revive deal'))} stalled partnership deals`, `Open deals untouched for ${STALE_DAYS} days or more, with no task set.`, () => { queueFilter = 'Revive deal'; drawQueue(); queueCard.scrollIntoView({ behavior: 'smooth' }); }, '5'],
      [fixN, `Fix ${intF(fixN)} records`, `${intF(clients)} client prospects tagged B2B and ${intF(incomplete)} prospects with no company or title.`, () => showPeople('Records to fix', ppl.filter((p) => p.client_only || !p.complete), 'Client prospects: remove the B2B tag. No company or title: fill them, or the person can’t be judged as a partner.'), null],
    ].filter(([n]) => n > 0);
    steps.forEach(([, title, desc, go, sop]) => {
      const li = el('li', 'cc-b2-step');
      const tx = el('div');
      tx.append(el('span', 'cc-b2-stept', title), el('span', 'cc-b2-stepd', desc));
      press(tx, go);
      li.append(tx);
      if (sop) li.append(sopBtn(sop));
      stepsBody.append(li);
    });

    drawQueue();
    drawMonday();

    /* Segments. */
    segBody.replaceChildren();
    const dims = [...new Set(seg.map((s) => s.dim))];
    let best = null;
    dims.forEach((dim) => {
      const list = seg.filter((s) => s.dim === dim).sort((a, b) => (dim === 'Priority' ? String(a.seg).localeCompare(String(b.seg)) : b.n - a.n));
      if (dim === 'Connected with Mack before 2026' && !list.some((s) => s.seg === 'Yes')) return;
      const total = list.reduce((t, s) => t + s.n, 0);
      if (total && Math.max(...list.map((s) => s.n)) / total > 0.95) return;
      const g = el('div', 'cc-b2-sgroup');
      g.append(el('h4', 'cc-b2-sdim', dim));
      const max = Math.max(...list.map((s) => (s.n ? s.met / s.n : 0)), 0.0001);
      list.forEach((s) => {
        const rate = s.n ? s.met / s.n : 0;
        if (s.n >= 10 && (!best || rate > best.rate)) best = { rate, s };
        const r = el('div', 'cc-b2-srow');
        const bar = el('span', 'cc-b2-sbar'); const f = el('i'); f.style.width = (rate / max) * 100 + '%'; bar.append(f);
        r.append(el('span', 'cc-b2-sseg', s.seg), bar, el('span', 'cc-b2-sval', `${pct(s.met, s.n)} met · ${intF(s.n)} people · ${intF(s.signed)} signed`));
        press(r, () => {
          const f2 = { Priority: (p) => (p.priority === '1' ? 'P1' : p.priority === '3' ? 'P3' : p.priority === '5' ? 'P5' : 'Other or not set'), Source: (p) => p.source, Role: (p) => p.tier, 'Company on record': (p) => (p.account ? 'Yes' : 'No'), 'Partner-type industry': (p) => (p.fit === 'partner' ? 'Consulting or IT firm' : p.fit === 'unknown' ? 'Industry not set' : 'Other industry'), 'Connected with Mack before 2026': (p) => (p.mack_old ? 'Yes' : 'No') }[dim];
          showPeople(dim + ': ' + s.seg, ppl.filter((p) => f2(p) === s.seg));
        });
        g.append(r);
      });
      segBody.append(g);
    });
    segNote.textContent = best ? `Highest meeting rate among groups of 10 or more: ${best.s.dim.toLowerCase()} “${best.s.seg}”, ${pct(best.s.met, best.s.n)} of ${intF(best.s.n)}. Use it to order the Monday queue, not as proof of a cause.` : '';

    /* Weeks. */
    weekBody.replaceChildren();
    const wk = rows('b2b_weeks');
    if (state(['b2b_weeks']) === 'ok' && wk.length) {
      const peak = Math.max(1, ...wk.map((w) => w.meetings));
      wk.forEach((w, i) => {
        const col = el('div', 'cc-b2-wcol' + (i === wk.length - 1 ? ' cc-b2-wnow' : ''));
        const b = el('i'); b.style.height = (w.meetings / peak) * 100 + '%';
        col.append(el('b', null, intF(w.meetings)), el('span', 'cc-b2-wbar'), el('small', null, dayF(w.week)));
        col.querySelector('.cc-b2-wbar').append(b);
        col.title = `Week of ${dayF(w.week)}: ${w.meetings} meetings`;
        weekBody.append(col);
      });
      const last4 = wk.slice(-4).reduce((t, w) => t + w.meetings, 0);
      const prev4 = wk.slice(-8, -4).reduce((t, w) => t + w.meetings, 0);
      weekNote.textContent = `Last 4 weeks: ${intF(last4)} ${last4 === 1 ? 'meeting' : 'meetings'}; the 4 before: ${intF(prev4)}. This week is in progress.`;
    } else {
      weekBody.replaceChildren(el('p', state(['b2b_weeks']) === 'loading' ? 'cc-b2-insight' : 'cc-b2-bad', state(['b2b_weeks']) === 'loading' ? 'Loading…' : 'Unavailable'));
      weekNote.textContent = '';
    }

    /* Data quality. */
    dqBody.replaceChildren();
    const unverified = ppl.filter((p) => (p.priority === '1' || p.priority === '3') && !p.met && !p.signed).length;
    const liOnly = ppl.filter((p) => p.li_only).length;
    const p5Signed = ppl.filter((p) => p.signed && p.priority === '5').length;
    [
      [clients, 'client prospects tagged B2B', 'Remove the B2B tag; they belong to a client campaign.', (p) => p.client_only],
      [incomplete, 'prospects with no company or no title', 'Fill them so the person can be judged as a partner.', (p) => !p.complete],
      [unverified, 'P1 or P3 prospects with no meeting logged', 'Stage unverified under the proposed rules; confirm or move each one.', (p) => (p.priority === '1' || p.priority === '3') && !p.met && !p.signed],
      [p5Signed, 'signed partners still at P5', 'Priority isn’t kept current; set the right stage.', (p) => p.signed && p.priority === '5'],
      [liOnly, 'connected on LinkedIn but not marked in Zoho', 'Set LI Connect to Connected so Zoho and this page agree.', (p) => p.li_only],
      [fnN, 'founder-network prospects tagged B2B', 'Counted here; the B2B Campaign tab leaves them out.', (p) => p.source === 'Founder network'],
    ].forEach(([n, label, fix, keep]) => {
      const li = el('li', 'cc-b2-dqi' + (n ? '' : ' cc-b2-clear'));
      li.append(el('b', null, intF(n)), el('span', null, label), el('small', null, fix));
      if (n) press(li, () => showPeople(label[0].toUpperCase() + label.slice(1), ppl.filter(keep), fix));
      dqBody.append(li);
    });
    [['Not recorded', 'when a contact joined the campaign, when its stage changed, when a LinkedIn request was sent or accepted, and who did each piece of work.'], ['Awaiting Mack', 'the monthly acquisition target (10 or 50), per-rep targets, stage definitions, follow-up cadence, skip cooldown and status colors.']].forEach(([k, v]) => {
      const li = el('li', 'cc-b2-dqi cc-b2-note'); li.append(el('b', null, k), el('span', null, v)); dqBody.append(li);
    });
  };

  const drawQueue = () => {
    const acts = rows('b2b_actions');
    const types = ['All', ...['Reply', 'Follow-up', 'Agreement', 'Meeting ask', 'First introduction', 'Revive deal'].filter((t) => acts.some((a) => a.type === t))];
    if (!types.includes(queueFilter)) queueFilter = 'All';
    queueTools.replaceChildren(...types.map((t) => {
      const b = el('button', 'cc-chip', t === 'All' ? `All (${acts.length})` : `${t} (${acts.filter((a) => a.type === t).length})`);
      b.type = 'button'; b.setAttribute('aria-pressed', String(queueFilter === t));
      b.addEventListener('click', () => { queueFilter = t; picked = 0; queueAll = false; drawQueue(); });
      return b;
    }));
    const list = acts.filter((a) => queueFilter === 'All' || a.type === queueFilter);
    if (picked >= list.length) picked = 0;
    drawNext(list[picked] || null);
    if (!list.length) { queueBody.replaceChildren(el('p', 'cc-b2-insight', 'Nothing in this part of the queue.')); return; }
    const tbl = el('table', 'cc-tbl cc-b2-qtbl');
    const th = el('thead'); const hr = el('tr');
    ['#', 'Type', 'Who', 'What to do', 'Why now', 'SOP'].forEach((x) => { const c = el('th', null, x); c.scope = 'col'; hr.append(c); });
    th.append(hr); tbl.append(th);
    const tb = el('tbody');
    list.slice(0, queueAll ? 200 : 12).forEach((a, i) => {
      const tr = el('tr', i === picked ? 'cc-b2-picked' : null);
      const who = el('td'); who.append(link('Contacts', a.id, a.name)); if (a.account) who.append(el('small', null, a.account));
      tr.append(el('td', null, String(i + 1)), el('td', null, a.type), who, el('td', null, a.action));
      tr.append(el('td', a.late ? 'cc-b2-late' : null, a.why_now));
      const s = el('td'); s.append(sopBtn(a.sop)); tr.append(s);
      tr.addEventListener('click', (e) => { if (e.target.closest('a, button')) return; picked = i; drawQueue(); nextCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      tb.append(tr);
    });
    tbl.append(tb);
    queueBody.replaceChildren(tbl);
    if (list.length > 12) {
      const more = el('button', 'cc-go', queueAll ? 'Show the first 12' : `Show all ${intF(Math.min(list.length, 200))}`);
      more.type = 'button';
      more.addEventListener('click', () => { queueAll = !queueAll; drawQueue(); });
      const bar = el('div', 'cc-tools'); bar.append(more);
      queueBody.append(bar);
    }
  };

  const drawMonday = () => {
    const mon = rows('b2b_monday');
    const pages = Math.max(1, Math.ceil(mon.length / MONDAY));
    if (monPage >= pages) monPage = 0;
    const list = mon.slice(monPage * MONDAY, monPage * MONDAY + MONDAY);
    const tbl = el('table', 'cc-tbl');
    const th = el('thead'); const hr = el('tr');
    ['#', 'Candidate', 'Role', 'Why this person', 'In Zoho'].forEach((x) => { const c = el('th', null, x); c.scope = 'col'; hr.append(c); });
    th.append(hr); tbl.append(th);
    const tb = el('tbody');
    list.forEach((m, i) => {
      const tr = el('tr');
      const who = el('td'); who.append(el('b', null, m.name)); if (m.account) who.append(el('small', null, m.account));
      const ev = el('td'); const chips = el('span', 'cc-b2-ev'); m.evidence.forEach((x) => chips.append(el('span', null, x))); if (!m.evidence.length) chips.append(el('span', 'cc-b2-none', 'No evidence on record')); ev.append(chips);
      const z = el('td'); const zl = link('Contacts', m.id, 'Open to select or skip'); z.append(zl);
      tr.append(el('td', null, String(monPage * MONDAY + i + 1)), who, el('td', null, m.title || 'No title'), ev, z);
      tb.append(tr);
    });
    tbl.append(tb);
    monBody.replaceChildren(tbl, el('p', 'cc-b2-insight', 'Select: set Priority to 4 in Zoho and write one line of evidence for each fit question. Skip: record the reason. Until Zoho stores skips, the same people return here until they are worked.'));
    const prev = el('button', 'cc-go', 'Previous 10'); prev.type = 'button'; prev.disabled = monPage === 0; prev.addEventListener('click', () => { monPage -= 1; drawMonday(); });
    const next = el('button', 'cc-go', 'Next 10'); next.type = 'button'; next.disabled = monPage >= pages - 1; next.addEventListener('click', () => { monPage += 1; drawMonday(); });
    monMore.replaceChildren(prev, next, el('span', 'cc-b2-insight', `${intF(mon.length)} candidates, page ${monPage + 1} of ${pages}`));
  };

  dash.onData(draw);
})();
