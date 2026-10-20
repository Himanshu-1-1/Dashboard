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

  /* Email (dataset b2b_mail: one row per B2B contact with an address in Zoho; dates and counts only, from the
     info@ and hemang@ mailboxes, matched by address; b2b_mail_weeks: messages per week). Private dashboard only. */
  const MAIL_RECENT = 30;
  const MAIL_QUIET = 14;
  const MAIL_STATUS = ['They wrote last', 'Gone quiet', 'No reply yet', 'Talking', 'Bounced', 'Never emailed', 'No address'];
  dash.calc('b2b_mail_people', {
    title: 'B2B prospects by email status',
    description: 'Each B2B prospect with their email history from the info@ and hemang@ mailboxes, matched to Zoho by email address: last email from them (automatic replies and meeting responses left out), last email from us, and counts. Status: they wrote last; gone quiet (they have written before, our last email was 14 or more days ago); no reply yet (we emailed, they never wrote); talking; bounced (our email to the address in Zoho came back undelivered and nothing has arrived from it since); never emailed; no address in Zoho. Mail sent from other mailboxes is not included.',
    inputs: ['b2b_people', 'b2b_mail'],
    fn: (b2b_people, b2b_mail) => {
      const m = new Map(b2b_mail.map((r) => [String(r.Zoho_Id), r]));
      const now = Date.now();
      const ago = (iso) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 864e5)) : null);
      return b2b_people.map((p) => {
        const r = m.get(p.id);
        const o = { id: p.id, name: p.name, account: p.account, account_id: p.account_id, priority: p.priority, met: p.met, signed: p.signed, dnc: p.dnc, tasks: p.tasks };
        if (!r) return { ...o, status: 'No address', n_in: 0, n_out: 0, last_in: null, last_out: null, last_out_by: null, in_days: null, out_days: null };
        const nIn = Number(r.n_in || 0);
        const nOut = Number(r.n_out || 0);
        const li = r.last_in || null;
        const lo = r.last_out || null;
        const inD = ago(li);
        const outD = ago(lo);
        let status = 'Talking';
        if (r.bounced) status = 'Bounced';
        else if (!nIn && !nOut) status = 'Never emailed';
        else if (li && (!lo || Date.parse(li) > Date.parse(lo))) status = 'They wrote last';
        else if (!nIn) status = 'No reply yet';
        else if (outD != null && outD >= MAIL_QUIET) status = 'Gone quiet';
        return { ...o, status, n_in: nIn, n_out: nOut, last_in: li, last_out: lo, last_out_by: r.last_out_by || null, in_days: inD, out_days: outD };
      });
    },
  });

  dash.calc('b2b_queue', {
    title: 'B2B work queue with email',
    description: 'The B2B work queue plus one Reply item for each prospect whose email is the latest in the thread and arrived in the last 30 days, unless a reply or follow-up task for them is already in the queue or they are marked Do Not Contact.',
    inputs: ['b2b_actions', 'b2b_mail_people'],
    fn: (b2b_actions, b2b_mail_people) => {
      const has = new Set(b2b_actions.filter((a) => a.type === 'Reply' || a.type === 'Follow-up').map((a) => a.id));
      const add = b2b_mail_people
        .filter((p) => p.status === 'They wrote last' && p.in_days != null && p.in_days <= MAIL_RECENT && !p.dnc && !has.has(p.id))
        .map((p) => ({ key: 'Mail|' + p.id, order: 1, type: 'Reply', sop: 3, id: p.id, name: p.name, account: p.account,
          action: 'Read their last email and answer it, or close the loop',
          why: p.signed ? 'Signed partner' : p.met ? `Met ${p.met === 1 ? 'once' : p.met + ' times'}` : p.priority ? `P${p.priority}` : 'Campaign contact',
          why_now: `They emailed ${p.in_days === 0 ? 'today' : p.in_days === 1 ? 'yesterday' : p.in_days + ' days ago'}; ${p.last_out ? 'our last email was before that' : 'we have not emailed them'}`,
          late: p.in_days, mail: true, done: 'Your reply is sent, or no reply is needed', record: 'Log the email in Zoho; set the next task with a due date' }));
      return [...b2b_actions, ...add].sort((a, b) => a.order - b.order || b.late - a.late || String(a.name).localeCompare(String(b.name)));
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
  const queueCard = card('b2-queue', 'Today’s queue', 'In order: replies (tasks, and emails waiting on us), follow-ups, agreements, meeting asks, first introductions, stalled deals. Select a row to make it the next action.');
  const queueTools = el('div', 'cc-tools cc-b2-chips');
  const queueBody = el('div', 'cc-b2-wrap');
  queueCard.append(queueTools, queueBody);
  const mailCard = card('b2-mail', 'Email with B2B prospects', 'From the info@ and hemang@ mailboxes, matched to Zoho by email address. Only dates and counts are kept; no subjects or message text.');
  const mailStats = el('div', 'cc-b2-mstats');
  const mailWeeks = el('div', 'cc-b2-mweeks');
  const mailKey = el('p', 'cc-b2-mkey');
  const mailTools = el('div', 'cc-tools cc-b2-chips');
  const mailBody = el('div', 'cc-b2-wrap');
  const mailNote = el('p', 'cc-b2-insight');
  const mailFoot = el('p', 'cc-b2-mfoot');
  mailCard.append(mailStats, mailWeeks, mailKey, mailNote, mailTools, mailBody, mailFoot);
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

  root.append(head, tiles, grid1, drill, nextCard, queueCard, mailCard, monCard, grid2, stagesCard, sopCard, dqCard);
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
  let mailFilter = 'They wrote last';
  let mailAll = false;
  const mailOk = () => state(['b2b_mail_people']) === 'ok';
  const queueRows = () => (state(['b2b_queue']) === 'ok' ? rows('b2b_queue') : rows('b2b_actions'));
  const ctDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) : null);
  const daysF = (n) => (n == null ? '—' : n === 0 ? 'today' : n === 1 ? '1 day ago' : intF(n) + ' days ago');
  let picked = 0;
  let monPage = 0;

  const drawNext = (a) => {
    nextBody.replaceChildren();
    if (!a) { nextBody.append(el('p', 'cc-b2-insight', 'Nothing is due today. Work the Monday queue, then ask connected P1 and P3 prospects for a first meeting.')); return; }
    const left = el('div');
    const act = el('p', 'cc-b2-action'); act.append(document.createTextNode((a.mail ? 'Reply by email' : a.type) + ': '), link('Contacts', a.id, a.name));
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
    const acts = queueRows();
    const mon = rows('b2b_monday');
    const fun = rows('b2b_funnel');
    const seg = rows('b2b_segments');
    const fv = (k) => (fun.find((r) => r.key === k) || {}).value || 0;
    const count = (type) => acts.filter((a) => a.type === type).length;
    const mailN = acts.filter((a) => a.mail).length;
    const lateN = acts.filter((a) => (a.type === 'Reply' || a.type === 'Follow-up') && !a.mail).length;
    const strong = mon.filter((m) => m.strength >= 3).length;
    const fnN = ppl.filter((p) => p.source === 'Founder network').length;

    verdict.textContent = `${intF(fv('met'))} of ${intF(fv('all'))} B2B prospects have met us and ${intF(fv('signed'))} have signed, but only ${intF(fv('introduced'))} ${fv('introduced') === 1 ? 'partner has' : 'partners have'} introduced a client. The work is conversations and activation, not more names: ${mailN ? `${intF(mailN)} ${mailN === 1 ? 'prospect is' : 'prospects are'} waiting on an email reply, ` : ''}${intF(lateN)} follow-ups are overdue, ${intF(count('Meeting ask'))} connected P1 and P3 prospects have never been asked to meet, and ${intF(count('First introduction'))} signed partners have not been asked for an introduction.`;

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
      `${mailN ? intF(mailN) + ' emails waiting on a reply; ' : ''}${intF(lateN)} reply and follow-up tasks overdue; ${intF(count('Agreement'))} agreement steps waiting.`,
      `${intF(ppl.filter((p) => p.connected && !p.met).length)} connected prospects have never met us.`,
      'An accepted LinkedIn connection is not a conversation; two-way contact means they wrote back or spoke with us.',
      mailWeekLine(),
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
      [mailN, `Answer ${intF(mailN)} ${mailN === 1 ? 'email' : 'emails'} waiting on us`, `Their email is the latest in the thread, sent in the last ${MAIL_RECENT} days; the oldest has waited ${intF(Math.max(0, ...acts.filter((a) => a.mail).map((a) => a.late)))} days. Some need no answer: read, then reply or log it.`, () => { queueFilter = 'Reply'; drawQueue(); queueCard.scrollIntoView({ behavior: 'smooth' }); }, '3'],
      [lateN, `Clear ${intF(lateN)} overdue replies and follow-ups`, `The oldest is ${intF(Math.max(0, ...acts.filter((a) => (a.type === 'Reply' || a.type === 'Follow-up') && !a.mail).map((a) => a.late)))} days late. Replies first: a conversation goes cold faster than a task.`, () => { queueFilter = 'Reply'; drawQueue(); queueCard.scrollIntoView({ behavior: 'smooth' }); }, '3'],
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
    drawMail();
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
      ...(mailOk() ? (() => {
        const mp = new Map(rows('b2b_mail_people').map((m) => [m.id, m]));
        const wrote = (p) => (mp.get(p.id) || {}).n_in > 0 && (p.priority === '5' || !p.priority) && !p.signed;
        const noAddr = (p) => (mp.get(p.id) || {}).status === 'No address';
        const bad = (p) => (mp.get(p.id) || {}).status === 'Bounced';
        return [
          [ppl.filter(bad).length, 'email addresses in Zoho that bounced', 'Our email came back undelivered. Find the current address, or clear the field.', bad],
          [ppl.filter(wrote).length, 'prospects who wrote back by email but are still P5 or have no Priority', 'Two-way contact is on record; under the proposed stages they are P3.', wrote],
          [ppl.filter(noAddr).length, 'prospects with no email address in Zoho', 'Email history can’t be matched without one. Add it when you have it.', noAddr],
        ];
      })() : []),
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
    const acts = queueRows();
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
      tr.append(el('td', null, String(i + 1)), el('td', null, a.mail ? 'Reply by email' : a.type), who, el('td', null, a.action));
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

  const mailWeekLine = () => {
    const wk = rows('b2b_mail_weeks');
    if (state(['b2b_mail_weeks']) !== 'ok' || wk.length < 2) return 'Email activity by week shows once the mailbox data loads; LinkedIn messages and calls are not recorded anywhere yet.';
    const a = wk[wk.length - 1];
    const b = wk[wk.length - 2];
    return `Email: ${intF(a.people_sent)} prospects emailed this week (${intF(b.people_sent)} last week); ${intF(a.received)} emails from prospects this week (${intF(b.received)} last week). LinkedIn messages and calls are not recorded yet.`;
  };

  const drawMail = () => {
    const st = state(['b2b_mail_people']);
    if (st !== 'ok') {
      [mailStats, mailWeeks, mailTools, mailBody].forEach((n) => n.replaceChildren());
      mailKey.textContent = '';
      mailFoot.textContent = '';
      mailNote.textContent = st === 'loading' ? 'Loading the mailbox data…' : 'The mailbox data did not load, so email history isn’t shown. The rest of this page doesn’t depend on it.';
      mailNote.classList.toggle('cc-b2-bad', st === 'error');
      return;
    }
    mailNote.classList.remove('cc-b2-bad');
    const mp = rows('b2b_mail_people');
    const by = (k) => mp.filter((m) => m.status === k);
    const withAddr = mp.filter((m) => m.status !== 'No address');
    const emailed = mp.filter((m) => m.n_out > 0);
    const wroteBack = emailed.filter((m) => m.n_in > 0);
    const waiting = by('They wrote last').filter((m) => m.in_days != null && m.in_days <= MAIL_RECENT);
    const wk = state(['b2b_mail_weeks']) === 'ok' ? rows('b2b_mail_weeks') : [];
    const thisW = wk[wk.length - 1] || null;
    const lastW = wk[wk.length - 2] || null;

    /* Stats. */
    mailStats.replaceChildren();
    const stat = (big, label, sub, go, cls) => {
      const c = el('div', 'cc-b2-mstat' + (cls ? ' ' + cls : ''));
      c.append(el('b', null, big), el('span', null, label));
      if (sub) c.append(el('small', null, sub));
      if (go) press(c, go);
      mailStats.append(c);
    };
    const pick = (k) => () => { mailFilter = k; mailAll = false; drawMail(); mailTools.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
    stat(intF(waiting.length), 'waiting on our reply', `They wrote last, in the last ${MAIL_RECENT} days. ${intF(by('They wrote last').length - waiting.length)} older.`, pick('They wrote last'), waiting.length ? 'cc-b2-mwarn' : null);
    if (thisW) {
      const d = lastW ? thisW.people_sent - lastW.people_sent : null;
      stat(intF(thisW.people_sent), 'prospects emailed this week', lastW ? `${intF(lastW.people_sent)} last week (${d > 0 ? '+' : ''}${intF(d)}). Week starts Monday, CT.` : null, null);
    }
    stat(pct(wroteBack.length, emailed.length), 'of the prospects we emailed wrote back', `${intF(wroteBack.length)} of ${intF(emailed.length)}. Automatic replies and meeting responses don’t count.`, pick('No reply yet'));
    stat(intF(withAddr.length), 'of ' + intF(mp.length) + ' prospects have an email address in Zoho', `${intF(mp.length - withAddr.length)} can’t be matched.`, pick('No address'));

    /* Weeks: sent and received, paired bars. */
    mailWeeks.replaceChildren();
    if (wk.length) {
      const peak = Math.max(1, ...wk.map((w) => Math.max(w.sent, w.received)));
      wk.forEach((w, i) => {
        const col = el('div', 'cc-b2-mcol' + (i === wk.length - 1 ? ' cc-b2-wnow' : ''));
        const bars = el('span', 'cc-b2-mbars');
        const bs = el('i', 'cc-b2-msent'); bs.style.height = (w.sent / peak) * 100 + '%';
        const br = el('i', 'cc-b2-mrecv'); br.style.height = (w.received / peak) * 100 + '%';
        bars.append(bs, br);
        const nums = el('span', 'cc-b2-mnums'); nums.append(el('b', null, intF(w.sent)), document.createTextNode(' / '), el('b', null, intF(w.received)));
        col.append(nums, bars, el('small', null, dayF(w.week)));
        col.title = `Week of ${dayF(w.week)}: ${w.sent} emails sent to ${w.people_sent} prospects, ${w.received} received`;
        mailWeeks.append(col);
      });
      mailKey.replaceChildren();
      const k1 = el('span', 'cc-b2-mk cc-b2-mk-sent', 'Sent by us'); const k2 = el('span', 'cc-b2-mk cc-b2-mk-recv', 'Received from prospects');
      mailKey.append(k1, k2, document.createTextNode(' Emails per week, last 12 weeks. This week is in progress.'));
    } else {
      mailKey.textContent = '';
    }

    /* Insight: does an email reply go with meeting us? */
    const metRate = (list) => (list.length ? list.filter((m) => m.met > 0).length / list.length : null);
    const silent = emailed.filter((m) => !m.n_in);
    const a = metRate(wroteBack);
    const b = metRate(silent);
    const quiet = by('Gone quiet').length;
    mailNote.textContent = a != null && b != null && wroteBack.length >= 5
      ? `Of prospects who wrote back by email, ${pct(wroteBack.filter((m) => m.met > 0).length, wroteBack.length)} have met us; of those emailed who never wrote back, ${pct(silent.filter((m) => m.met > 0).length, silent.length)}. ${quiet ? `${intF(quiet)} threads have gone quiet: they wrote before, and our last email was ${MAIL_QUIET} or more days ago.` : ''}`
      : `${intF(quiet)} threads have gone quiet: they wrote before, and our last email was ${MAIL_QUIET} or more days ago.`;

    /* Chips and table. */
    const counts = new Map(MAIL_STATUS.map((k) => [k, by(k).length]));
    if (!counts.get(mailFilter)) mailFilter = MAIL_STATUS.find((k) => counts.get(k)) || MAIL_STATUS[0];
    mailTools.replaceChildren(...MAIL_STATUS.filter((k) => counts.get(k)).map((k) => {
      const b2 = el('button', 'cc-chip', `${k} (${intF(counts.get(k))})`);
      b2.type = 'button'; b2.setAttribute('aria-pressed', String(mailFilter === k));
      b2.addEventListener('click', () => { mailFilter = k; mailAll = false; drawMail(); });
      return b2;
    }));
    const list = by(mailFilter).slice().sort((x, y) => {
      if (mailFilter === 'They wrote last') return (x.in_days ?? 1e9) - (y.in_days ?? 1e9);
      if (mailFilter === 'Gone quiet' || mailFilter === 'No reply yet' || mailFilter === 'Talking') return (x.out_days ?? 1e9) - (y.out_days ?? 1e9);
      return String(x.name).localeCompare(String(y.name));
    });
    const tbl = el('table', 'cc-tbl');
    const th = el('thead'); const hr = el('tr');
    const noMail = mailFilter === 'Never emailed' || mailFilter === 'No address';
    (noMail ? ['Name', 'Company', 'Priority', 'Met'] : ['Name', 'Company', 'Their last email', 'Our last email', 'Emails out / in', 'Met', '']).forEach((x) => { const c = el('th', null, x); c.scope = 'col'; hr.append(c); });
    th.append(hr); tbl.append(th);
    const tb = el('tbody');
    list.slice(0, mailAll ? 300 : 12).forEach((m) => {
      const tr = el('tr');
      const n = el('td'); n.append(link('Contacts', m.id, m.name)); tr.append(n);
      const ac = el('td'); if (m.account_id) ac.append(link('Accounts', m.account_id, m.account)); else ac.textContent = 'No company'; tr.append(ac);
      if (noMail) {
        tr.append(el('td', null, m.priority ? 'P' + m.priority : 'Not set'), el('td', null, m.met ? intF(m.met) : '—'));
      } else {
        const li = el('td', m.status === 'They wrote last' && m.in_days != null && m.in_days <= MAIL_RECENT ? 'cc-b2-late' : null);
        li.textContent = m.last_in ? dayF(ctDay(m.last_in)) : 'Never'; if (m.last_in) li.append(el('small', null, daysF(m.in_days)));
        const lo = el('td'); lo.textContent = m.last_out ? dayF(ctDay(m.last_out)) : 'Never';
        if (m.last_out) lo.append(el('small', null, daysF(m.out_days) + (m.last_out_by ? ', ' + m.last_out_by : '')));
        tr.append(li, lo, el('td', null, intF(m.n_out) + ' / ' + intF(m.n_in)), el('td', null, m.met ? intF(m.met) : '—'));
        const s = el('td'); if (m.status !== 'Bounced') s.append(sopBtn(m.status === 'They wrote last' || m.status === 'Gone quiet' ? 3 : m.status === 'Talking' ? 4 : 2)); tr.append(s);
      }
      tb.append(tr);
    });
    tbl.append(tb);
    mailBody.replaceChildren(tbl);
    if (list.length > 12) {
      const more = el('button', 'cc-go', mailAll ? 'Show the first 12' : `Show all ${intF(Math.min(list.length, 300))}`);
      more.type = 'button';
      more.addEventListener('click', () => { mailAll = !mailAll; drawMail(); });
      const bar = el('div', 'cc-tools'); bar.append(more);
      mailBody.append(bar);
    }
    const asOf = (rows('b2b_mail')[0] || {}).as_of;
    mailFoot.textContent = `Mail as of ${asOf ? dayF(ctDay(asOf)) + ' (CT)' : 'the last refresh'}. Covers info@ and hemang@; mail sent only from another mailbox won’t show, so “they wrote last” can mean someone already answered from elsewhere. Check before replying.`;
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
