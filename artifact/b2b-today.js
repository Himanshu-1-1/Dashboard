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
  const TASK_STALE = 45;
  const CLOSE_ORDER = 7;
  const ctD = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const TASK_OWNER = /^\s*(mack|shruti|harsh|hemang|pulkit)\b/i;
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
    description: 'Today’s B2B work in the proposed order: overdue replies, other overdue follow-ups, agreements awaiting signature, meeting asks for Priority 1 prospects (a two-way conversation, connected, never met), first-introduction asks for signed partners, and partnership deals untouched for 14 days or more.',
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
        const who = TASK_OWNER.exec(s);
        const base = { id: p.id, name: p.name, account: p.account, task_id: t.id, task_created: t.created ? ctD(t.created) : null, task_kind: reply ? 'reply' : agree ? 'agreement' : 'follow-up',
          owner_hint: who ? who[1][0].toUpperCase() + who[1].slice(1).toLowerCase() : null,
          why: p.signed ? 'Signed partner' : p.met ? `Met ${p.met === 1 ? 'once' : p.met + ' times'}` : p.priority ? `P${p.priority}` : 'Campaign contact', late: t.days_overdue || 0 };
        if (p.dnc) {
          add({ ...base, order: CLOSE_ORDER, type: 'Close in Zoho', sop: 8, action: `Close “${s}”`, why_now: 'Marked Do Not Contact in Zoho, but this task is still open', done: 'The task is closed', record: 'Close the task; cancel any others for them' });
          return;
        }
        if (t.days_overdue > TASK_STALE) {
          add({ ...base, order: CLOSE_ORDER, type: 'Close in Zoho', sop: 3, action: `Re-date or close “${s}”`, why_now: `Due ${t.due}, ${t.days_overdue} days late: too old to be today’s work. Close it if it’s done or no longer needed; otherwise give it a new due date.`, stale: true, done: 'Closed, or re-dated with the real next step', record: 'Task status and due date' });
          return;
        }
        add({ ...base, order: reply ? 1 : agree ? 3 : 2, type: reply ? 'Reply' : agree ? 'Agreement' : 'Follow-up', sop: reply ? 3 : agree ? 5 : 3,
          action: s, why_now: t.days_overdue ? `Task due ${t.due}, ${t.days_overdue} ${t.days_overdue === 1 ? 'day' : 'days'} late` : 'Task due today',
          done: reply ? 'Your reply is sent' : agree ? 'The agreement step is done' : 'The follow-up is sent', record: 'Close the task; set the next one with a due date' });
      });
      agreements.filter((a) => a.kind === 'Referral agreement' && (a.state === 'Out for signature' || /^Expired/.test(a.state)) && a.contact_id && ppl.has(String(a.contact_id))).forEach((a) => {
        const p = ppl.get(String(a.contact_id));
        if (p.dnc || p.signed || (p.deal_stage && /^Closed Lost/.test(p.deal_stage))) return;
        add({ order: 3, type: 'Agreement', sop: 5, id: p.id, name: p.name, account: p.account, action: a.state === 'Out for signature' ? 'Chase the signature' : 'Re-send the agreement',
          why: 'Agreement in Zoho Sign', why_now: (a.state === 'Out for signature' ? (a.days_left != null ? `Deadline in ${a.days_left} days` : 'Out for signature') : 'Expired, not re-sent') + (p.deal_stage === 'Hold' ? '; the partnership deal is on Hold, so check it’s still wanted' : ''), late: a.days_left != null && a.days_left < 0 ? -a.days_left : 0,
          done: 'Signed, or a new copy sent', record: 'Partnership deal stage and next step' });
      });
      b2b_people.filter((p) => p.priority === '1' && p.connected && !p.met && !p.tasks && !p.signed && !p.dnc).forEach((p) => {
        add({ order: 4, type: 'Meeting ask', sop: 4, id: p.id, name: p.name, account: p.account, action: 'Ask for a first meeting', why: `P1, connected${p.li_only ? ' (Mack’s LinkedIn; Zoho not updated)' : ''}`,
          why_now: 'Two-way conversation, never met, nothing scheduled', late: 0, done: 'Booking link sent', record: 'Log the ask; a check-in task on the approved cadence' });
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

  const P3Q_STEPS = [
    ['Untouched', 'Send a connection request', '2'],
    ['Connected', 'Start a conversation', '3'],
    ['Met', 'Move to Priority 1 if it’s two-way', '3'],
    ['Requested', 'Wait for them to accept', null],
    ['Email Required', 'Blocked: LinkedIn needs their email', null],
    ['Do not contact', 'Don’t contact', null],
  ];
  dash.calc('b2b_p3_queue', {
    title: 'Priority 3 queue',
    description: 'Every B2B prospect at Priority 3, grouped by what to do next from Zoho’s LI Connect: untouched (empty, send a request), connected and never met (start a conversation), connected and met (move to Priority 1 if two-way), requested (waiting), Email Required (blocked), and Do Not Contact last. Within a group, by the partner evidence on the record.',
    inputs: ['b2b_people'],
    fn: (b2b_people) => b2b_people
      .filter((p) => p.priority === '3')
      .map((p) => {
        const li = p.li == null || p.li === '' || p.li === '-None-' ? null : String(p.li);
        const status = p.dnc ? 'Do not contact' : li == null ? 'Untouched' : li === 'Connected' ? (p.met ? 'Met' : 'Connected') : li === 'Requested' ? 'Requested' : li === 'Email Required' ? 'Email Required' : 'Untouched';
        const ev = [];
        if (p.tier === 'Founder, owner or CEO') ev.push('Founder, owner or CEO');
        if (p.fit === 'partner') ev.push('Consulting or IT firm');
        if (p.account) ev.push('Company on record');
        if (p.mack_old) ev.push('Known to Mack before 2026');
        if (p.met) ev.push(`Met ${p.met === 1 ? 'once' : p.met + ' times'}`);
        const step = P3Q_STEPS.findIndex((x) => x[0] === status);
        return { id: p.id, name: p.name, title: p.title, account: p.account, li, status, order: step, next: P3Q_STEPS[step][1], sop: P3Q_STEPS[step][2], evidence: ev, strength: ev.length };
      })
      .sort((a, b) => a.order - b.order || b.strength - a.strength || String(a.name).localeCompare(String(b.name))),
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
    description: 'Each B2B prospect with their email history from the team’s mailboxes (info@, hemang@, mack@, shruti@), matched to Zoho by email address: last email from them (automatic replies and meeting responses left out), last email from us, and counts. Status: they wrote last; gone quiet (they have written before, our last email was 14 or more days ago); no reply yet (we emailed, they never wrote); talking; bounced (our email to the address in Zoho came back undelivered and nothing has arrived from it since); never emailed; no address in Zoho. Mail sent from other mailboxes is not included.',
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
    description: 'The B2B work queue checked against email and meetings. A reply or follow-up task becomes “Close in Zoho” when we emailed the person after the task was created; other tasks note any email since. A meeting ask is dropped when a meeting is already scheduled. A stale deal with email in the last 14 days asks for the deal to be updated rather than revived. Plus one Reply item for each prospect whose email is the latest in the thread and arrived in the last 30 days, unless a reply or follow-up for them is already queued or they are marked Do Not Contact.',
    inputs: ['b2b_actions', 'b2b_mail_people', 'mtg_people'],
    fn: (b2b_actions0, b2b_mail_people, mtg_people) => {
      const mail = new Map(b2b_mail_people.map((m) => [m.id, m]));
      const nextMtg = new Map(mtg_people.filter((m) => m.next).map((m) => [m.id, m.next]));
      const day = (iso) => (iso ? ctD(iso) : null);
      const b2b_actions = b2b_actions0.flatMap((a) => {
        const m = mail.get(a.id) || {};
        const outDay = day(m.last_out);
        const inDay = day(m.last_in);
        if (a.task_id && !a.stale && a.type !== 'Close in Zoho' && a.task_created && outDay && outDay >= a.task_created) {
          if (a.task_kind === 'reply' || a.task_kind === 'follow-up') {
            return [{ ...a, order: CLOSE_ORDER, type: 'Close in Zoho', sop: 3, action: `Close “${a.action}” if it’s done`, probably_done: true,
              why_now: `We emailed them on ${outDay}${m.last_out_by ? ' (' + m.last_out_by + '@)' : ''}, after this task was created on ${a.task_created}${inDay && inDay > outDay ? `; they wrote again on ${inDay}` : ''}`,
              done: 'The task is closed, or re-dated if something is still owed', record: 'Task status; a new task if a next step is owed' }];
          }
          return [{ ...a, why_now: `${a.why_now}; we emailed them on ${outDay} since the task was created` }];
        }
        if (a.type === 'Meeting ask' && nextMtg.has(a.id)) return [];
        if (a.type === 'Revive deal') {
          const recent = [outDay, inDay].filter(Boolean).sort().pop();
          if (recent && (Date.parse(todayCT()) - Date.parse(recent)) / 864e5 <= STALE_DAYS) {
            return [{ ...a, action: `Update the ${a.action.replace(/^Move the | deal forward$/g, '')} deal in Zoho`, why_now: `${a.why_now}, but there was email on ${recent}: record the stage and next step`, done: 'Stage and next step match the conversation' }];
          }
        }
        return [a];
      });
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

  /* Monthly acquisition scorecard: new partner prospects added to Zoho (dataset b2b_added). */
  const ADD_TARGET = 50;
  const ADD_SOP_URL = 'https://docs.google.com/document/d/1aM7zseZMzA-5N3OUFKW8tzAdXjXRnYSlyRwVfETHa3A/edit?tab=t.0#heading=h.xxylwzgeyofk';
  const ADD_MONTHS = 4;
  const P5_WEAK = 100;
  const P5_STRONG = 350;
  const ctDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const liKey = (u) => {
    const m = /linkedin\.com\/in\/([^/?#]+)/i.exec(String(u || ''));
    return m ? decodeURIComponent(m[1]).toLowerCase() : null;
  };
  const nameKey = (r) => String(r.Full_Name || [r.First_Name, r.Last_Name].filter(Boolean).join(' ')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const workdays = (from, to) => {
    let n = 0;
    const d = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    while (d <= end) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) n += 1; d.setUTCDate(d.getUTCDate() + 1); }
    return n;
  };

  const coqlRows = ({ answer }) => {
    const a = typeof answer === 'string' ? (answer.trim() ? JSON.parse(answer) : {}) : (answer || {});
    if (a.status === 'error' || (a.code && !a.data)) throw new Error(a.message || a.code || 'Zoho CRM refused the query');
    const body = a.data && !Array.isArray(a.data) ? a.data : a;
    const list = Array.isArray(body.data) ? body.data : [];
    const rows = list.map((r) => {
      const o = {};
      for (const [k, v] of Object.entries(r)) {
        if (Array.isArray(v)) o[k] = v.map((x) => (x && typeof x === 'object' ? x.name : x)).filter((x) => x != null && x !== '').join(', ');
        else if (v && typeof v === 'object') { o[k] = v.name ?? null; o[k + '_id'] = v.id ?? null; }
        else o[k] = v;
      }
      return o;
    });
    return { columns: rows.length ? Object.keys(rows[0]) : [], rows, cut: Boolean(body.info && body.info.more_records) };
  };
  dash.loader('b2b_added', { description: 'Zoho’s COQL answer as rows: a lookup becomes its name (and _id), a multi-select becomes text.', fn: coqlRows });
  dash.loader('b2b_meetings', { description: 'Zoho’s COQL answer as rows: the linked contact becomes Who_Id (name) and Who_Id_id.', fn: coqlRows });
  dash.loader('b2b_all', { description: 'Zoho’s COQL answer as rows: a lookup becomes its name (and _id), a multi-select becomes text.', fn: coqlRows });

  /* Partner funnel overview: every contact tagged for the campaign, Priority 9 and 11 included, one group each by Priority. */
  const PF_GROUPS = [
    { key: '5', label: 'P5 · Backlog / Future Outreach', short: 'P5 Backlog', side: 'funnel', tone: 1 },
    { key: '3', label: 'P3 · Priority Outreach', short: 'P3 Priority outreach', side: 'funnel', tone: 2 },
    { key: '1', label: 'P1 · Active Partnership Pursuit', short: 'P1 Active pursuit', side: 'funnel', tone: 3 },
    { key: '99', label: 'P99 · Signed Partners / Closed Won', short: 'P99 Signed', side: 'funnel', tone: 4 },
    { key: '9', label: 'P9 · Inactive / Disqualified', short: 'P9 Inactive', side: 'out', tone: 'warn' },
    { key: '11', label: 'P11 · Do Not Contact', short: 'P11 Do not contact', side: 'out', tone: 'bad' },
    { key: 'none', label: 'No Priority set', short: 'No Priority', side: 'funnel', tone: 'none' },
  ];
  dash.calc('b2b_priority_all', {
    title: 'Campaign contacts by Priority',
    description: 'Every contact tagged “May 2026 - 100 B2B”, Priority 9 and 11 included, one row each with their Priority group (5, 3, 1, 99, 9, 11 or not set), company, LinkedIn status, Assigned and the day Zoho created them.',
    inputs: ['b2b_all'],
    fn: (b2b_all) => [...new Map(b2b_all.map((r) => [String(r.id), r])).values()].map((r) => {
      const pr = r.Priority != null && r.Priority !== '' && r.Priority !== '-None-' ? String(r.Priority) : null;
      return {
        id: String(r.id), name: r.Full_Name || '—', account: r.Account_Name || null, account_id: r.Account_Name_id || null,
        priority: pr, group: pr && PF_GROUPS.some((g) => g.key === pr) ? pr : pr ? 'other:' + pr : 'none',
        li: r.LI_Connect && r.LI_Connect !== '-None-' ? r.LI_Connect : null, assigned: r.Assigned || null, created: r.Created_Time ? ctD(r.Created_Time) : null,
      };
    }),
  });

  dash.calc('b2b_added_rows', {
    title: 'B2B prospects added to Zoho, one row each',
    description: 'Every contact tagged “May 2026 - 100 B2B” (Priority 9 and 11 left out), by the month Zoho created it (Central time). A contact counts toward the monthly target unless it is labeled only Client or repeats an earlier contact (same LinkedIn profile, or same name at the same company). Missing name, company or LinkedIn doesn’t stop it counting; it is listed so the record can be completed.',
    inputs: ['b2b_added'],
    fn: (b2b_added) => {
      const seen = new Map();
      return b2b_added
        .filter((r) => r.Created_Time)
        .slice()
        .sort((a, b) => String(a.Created_Time).localeCompare(String(b.Created_Time)))
        .map((r) => {
          const day = ctDate(r.Created_Time);
          const missing = [];
          if (!r.First_Name || !r.Last_Name) missing.push('full name');
          if (!r.Account_Name) missing.push('company');
          if (!liKey(r.LinkedIn)) missing.push('LinkedIn profile');
          const rel = String(r.Relationship_Type || '');
          const clientOnly = /client/i.test(rel) && !/referral partner|founder network|partner/i.test(rel);
          const keys = [liKey(r.LinkedIn) && 'li:' + liKey(r.LinkedIn), nameKey(r) && r.Account_Name && 'nm:' + nameKey(r) + '|' + String(r.Account_Name).toLowerCase()].filter(Boolean);
          const dupOf = keys.map((k) => seen.get(k)).find(Boolean) || null;
          keys.forEach((k) => { if (!seen.has(k)) seen.set(k, r.Full_Name || 'an earlier contact'); });
          const reason = dupOf ? 'Repeat of ' + dupOf : clientOnly ? 'Labeled Client, not a partner' : null;
          return {
            id: String(r.id), name: r.Full_Name || [r.First_Name, r.Last_Name].filter(Boolean).join(' ') || '—', account: r.Account_Name || null, account_id: r.Account_Name_id || null,
            day, month: day.slice(0, 7), linkedin: liKey(r.LinkedIn) ? r.LinkedIn : null, assigned: r.Assigned || null,
            source: /founder network/i.test(rel) ? 'Founder network' : 'Other sources', counted: !reason, reason,
            missing: missing.length ? 'Missing ' + missing.join(', ') : null,
          };
        });
    },
  });

  dash.calc('b2b_p5_backlog', {
    title: 'Priority 5 backlog',
    description: 'Every contact tagged “May 2026 - 100 B2B” whose current Priority is 5, one row per Zoho contact: the backlog available for future selection. Separate from the monthly target of new partner prospects.',
    inputs: ['b2b_added'],
    fn: (b2b_added) => [...new Map(b2b_added.filter((r) => String(r.Priority) === '5').map((r) => [String(r.id), r])).values()]
      .map((r) => ({ id: String(r.id), name: r.Full_Name || [r.First_Name, r.Last_Name].filter(Boolean).join(' ') || '—', account: r.Account_Name || null, account_id: r.Account_Name_id || null, created: r.Created_Time ? ctDate(r.Created_Time) : null, priority: String(r.Priority) }))
      .sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')) || a.name.localeCompare(b.name)),
  });

  dash.calc('b2b_scorecard', {
    title: 'Monthly partner acquisition scorecard',
    description: 'This calendar month (Central time) against the target of 50 qualified B2B partner prospects added to Zoho: counted so far, this week (Monday start), last month, the pace needed over the remaining weekdays, and whether the month is on track (counted so far at least the target’s share of weekdays gone). Months are the last four.',
    inputs: ['b2b_added_rows'],
    fn: (rows) => {
      const today = todayCT();
      const month = today.slice(0, 7);
      const [y, m] = month.split('-').map(Number);
      const first = month + '-01';
      const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
      const t = new Date(today + 'T00:00:00Z');
      const monday = new Date(t); monday.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
      const weekStart = monday.toISOString().slice(0, 10);
      const lastWeekStart = new Date(monday.getTime() - 7 * 864e5).toISOString().slice(0, 10);
      const counted = rows.filter((r) => r.counted);
      const inMonth = counted.filter((r) => r.month === month);
      const actual = inMonth.length;
      const remaining = Math.max(0, ADD_TARGET - actual);
      const totalDays = workdays(first, lastDay);
      const elapsed = workdays(first, today);
      const tomorrow = new Date(t.getTime() + 864e5).toISOString().slice(0, 10);
      const daysLeft = today >= lastDay ? 0 : workdays(tomorrow, lastDay);
      const todayIsWork = workdays(today, today) === 1;
      const daysLeftIncl = daysLeft + (todayIsWork ? 1 : 0);
      const expected = totalDays ? Math.round((ADD_TARGET * elapsed) / totalDays) : ADD_TARGET;
      const status = actual >= ADD_TARGET ? 'Target met' : actual >= expected ? 'On track' : 'Behind';
      const months = Array.from({ length: ADD_MONTHS }, (_, i) => new Date(Date.UTC(y, m - ADD_MONTHS + i, 1)).toISOString().slice(0, 7));
      return [{
        key: month, month, today, target: ADD_TARGET, actual, remaining, pct: actual / ADD_TARGET,
        week: inMonth.filter((r) => r.day >= weekStart).length,
        last_week: counted.filter((r) => r.day >= lastWeekStart && r.day < weekStart).length,
        prev_month: prev, prev_actual: counted.filter((r) => r.month === prev).length,
        added_all: rows.filter((r) => r.month === month).length,
        not_counted: rows.filter((r) => r.month === month && !r.counted).length,
        workdays_total: totalDays, workdays_elapsed: elapsed, workdays_left: daysLeftIncl, expected, status,
        per_day: daysLeftIncl ? remaining / daysLeftIncl : null, per_week: daysLeftIncl ? Math.ceil((remaining / daysLeftIncl) * 5) : null,
        trend: months.map((mo) => ({ month: mo, actual: counted.filter((r) => r.month === mo).length, added: rows.filter((r) => r.month === mo).length })),
      }];
    },
  });

  /* Priority 3, relationship development. Current balances come from b2b_people (Zoho's Priority and LI Connect);
     Today / This week / This month come only from field-change history (dataset p3_events: one row per change,
     {contact_id, field: 'Priority' | 'LI_Connect', from, to, at}), never inferred from current values. */
  const PF_SOP_URL = 'https://docs.google.com/spreadsheets/d/1QFWrhHd5ZnbNn-UmdNVZ3KfqUGp4Ru9R84ztd5Mtx-0/edit?usp=drive_link';
  const PM_SOP_URL = 'https://docs.google.com/document/d/1fGux7OzBHHh6BB-zqMPMyeMG7fQ0oCA_oQEE3rxqHHc/edit?tab=t.0#heading=h.4iets7th6uj';
  const P3_SOP_URL = 'https://docs.google.com/document/d/1ocLD2VXVnVrZAVz91FaocBRpqU8Tm8w8-9qUKvMztu8/edit?tab=t.0#heading=h.2n9bebp463et';
  const liOf = (v) => (v == null || v === '' || v === '-None-' ? null : String(v));
  const prOf = (v) => (v == null || v === '' || v === '-None-' ? null : String(v));

  dash.calc('p3_state', {
    title: 'Priority 3 relationship development, now',
    description: 'B2B prospects by their current Zoho Priority and LI Connect: the Priority 3 backlog, untouched (LI Connect empty), pending (Requested), connected, Email Required, and Priority 1 contacts that are Connected.',
    inputs: ['b2b_people'],
    fn: (b2b_people) => b2b_people.map((p) => ({ id: p.id, name: p.name, account: p.account, account_id: p.account_id, priority: prOf(p.priority), li: liOf(p.li), met: p.met })),
  });

  const P3_KPIS = {
    backlog: (x) => x.pr === '3',
    untouched: (x) => x.pr === '3' && x.li == null,
    pending: (x) => x.pr === '3' && x.li === 'Requested',
    connected: (x) => x.pr === '3' && x.li === 'Connected',
    email: (x) => x.pr === '3' && x.li === 'Email Required',
  };

  dash.calc('p3_periods', {
    title: 'Priority 3 changes today, this week and this month',
    description: 'From Zoho field history for Priority and LI Connect (Central time; weeks start Monday). Balances: the count now minus the count at the start of the period, rebuilt from the recorded changes. Events: unique contacts that made the change in the period while at Priority 3: pursued (LI Connect empty to Requested), connected (Requested to Connected), Email Required (newly set), and two-way conversations (Priority 3 to 1 while Connected). Periods that began before tracking started are marked partial.',
    inputs: ['p3_state', 'p3_events'],
    fn: (p3_state, p3_events) => {
      const today = todayCT();
      const t = new Date(today + 'T00:00:00Z');
      const mon = new Date(t); mon.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
      const starts = { today, week: mon.toISOString().slice(0, 10), month: today.slice(0, 8) + '01' };
      const ctOf = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T');
      const ev = p3_events
        .filter((e) => e && e.contact_id && e.at && (e.field === 'Priority' || e.field === 'LI_Connect'))
        .map((e) => ({ id: String(e.contact_id), field: e.field, from: e.field === 'Priority' ? prOf(e.from) : liOf(e.from), to: e.field === 'Priority' ? prOf(e.to) : liOf(e.to), ct: ctOf(e.at), at: e.at }))
        .sort((a, b) => a.ct.localeCompare(b.ct));
      const tracked = ev.length ? ev[0].ct.slice(0, 10) : null;
      const now = new Map(p3_state.map((p) => [p.id, { pr: p.priority, li: p.li }]));
      const byId = new Map();
      ev.forEach((e) => { if (!byId.has(e.id)) byId.set(e.id, []); byId.get(e.id).push(e); });
      const valueAt = (id, field, ct) => {
        const cur = now.get(id) || { pr: null, li: null };
        const list = (byId.get(id) || []).filter((e) => e.field === field);
        let v = field === 'Priority' ? cur.pr : cur.li;
        for (let i = list.length - 1; i >= 0; i -= 1) { if (list[i].ct >= ct) v = list[i].from; else break; }
        return v;
      };
      const stateAt = (id, ct) => ({ pr: valueAt(id, 'Priority', ct), li: valueAt(id, 'LI_Connect', ct) });
      const ids = new Set([...now.keys(), ...byId.keys()]);
      const out = [];
      Object.entries(starts).forEach(([period, day]) => {
        const ct0 = day + 'T00:00:00';
        const partial = !tracked || tracked > day;
        const row = { key: period, period, start: day, partial, tracked };
        Object.entries(P3_KPIS).forEach(([k, f]) => {
          let nowN = 0; let thenN = 0;
          ids.forEach((id) => { const c = now.get(id) || { pr: null, li: null }; if (f(c)) nowN += 1; if (f(stateAt(id, ct0))) thenN += 1; });
          row[k + '_net'] = nowN - thenN;
        });
        const inP = ev.filter((e) => e.ct >= ct0);
        const uniq = (list) => [...new Map(list.map((e) => [e.id, e])).values()];
        const at3 = (e) => stateAt(e.id, e.ct).pr === '3';
        row.pursued = uniq(inP.filter((e) => e.field === 'LI_Connect' && e.from == null && e.to === 'Requested' && at3(e)));
        row.newly_connected = uniq(inP.filter((e) => e.field === 'LI_Connect' && e.from === 'Requested' && e.to === 'Connected' && at3(e)));
        row.newly_email = uniq(inP.filter((e) => e.field === 'LI_Connect' && e.to === 'Email Required' && e.from !== 'Email Required' && at3(e)));
        row.promoted = uniq(inP.filter((e) => e.field === 'Priority' && e.from === '3' && e.to === '1' && stateAt(e.id, e.ct).li === 'Connected'));
        out.push(row);
      });
      const all = ev.filter((e) => e.field === 'Priority' && e.from === '3' && e.to === '1' && stateAt(e.id, e.ct).li === 'Connected');
      out.push({ key: 'all', period: 'all', start: tracked, partial: false, tracked, promoted: [...new Map(all.map((e) => [e.id, e])).values()] });
      return out;
    },
  });

  /* Meeting frequency and relationship depth (dataset b2b_meetings: Zoho Events linked to a B2B contact by Who_Id).
     A meeting counts only when Meeting Status is Completed and it has started; one per contact per start minute.
     Everything over time is rebuilt from meeting dates and the day Zoho created each contact; nothing is estimated. */
  const MTG_STAGES = [
    { k: 0, label: 'Never Met', def: 'No meeting held', icon: 'person' },
    { k: 1, label: 'Met Once', def: 'One meeting held', icon: 'person' },
    { k: 2, label: 'Met Twice', def: 'Two meetings held', icon: 'group' },
    { k: 3, label: 'Met Thrice', def: 'Three meetings held', icon: 'group' },
    { k: 4, label: 'Met 4+ Times', def: '4 or more meetings held', icon: 'group' },
  ];
  const MTG_WEEKS = 12;
  /* The meeting-frequency section covers Priority 1 (two-way conversation) only. */
  const MTG_PRIORITY = '1';
  const minuteOf = (t) => Math.floor(t / 6e4);

  /* Meetings come from two places: Zoho Events (Meeting Status Completed counts once its start time has passed) and the
     team's Outlook calendars (dataset b2b_cal, synced on weekdays: a past, uncancelled event with the prospect as guest or
     booking customer, or named in the subject). A Central-time day with a meeting from either source counts once. */
  dash.calc('mtg_people', {
    title: 'B2B prospects by meetings held',
    description: 'One row per B2B prospect: days with a meeting held (Zoho Meeting Status Completed, or a past uncancelled meeting on the info@, mack@, hemang@ or shruti@ Outlook calendar; one per Central-time day, with the source of each), the day they entered each meeting-count stage, the next meeting booked in either place, Outlook meetings Zoho does not show as Completed, and past Zoho meetings not marked Completed that Outlook does not confirm either.',
    inputs: ['b2b_people', 'b2b_added', 'b2b_meetings', 'b2b_cal'],
    fn: (b2b_people, b2b_added, b2b_meetings, b2b_cal) => {
      const now = Date.now();
      const added = new Map(b2b_added.map((r) => [String(r.id), r]));
      const cal = new Map();
      (b2b_cal || []).forEach((r) => {
        const k = String(r.Zoho_Id);
        if (!cal.has(k)) cal.set(k, { as_of: r.as_of || null, meetings: [] });
        if (r.at) cal.get(k).meetings.push(r);
      });
      const by = new Map();
      b2b_meetings.forEach((m) => {
        const id = m.Who_Id_id ? String(m.Who_Id_id) : null;
        const t = Date.parse(m.Start_DateTime);
        if (!id || !Number.isFinite(t)) return;
        const status = m.Meeting_Status && m.Meeting_Status !== '-None-' ? String(m.Meeting_Status) : null;
        if (!by.has(id)) by.set(id, { done: new Map(), next: null, unmarked: [] });
        const b = by.get(id);
        if (t > now) { if (b.next == null || t < b.next) b.next = t; return; }
        if (status === 'Completed') b.done.set(minuteOf(t), t);
        else b.unmarked.push({ t, status: status || 'Blank' });
      });
      return b2b_people.map((p) => {
        const b = by.get(p.id) || { done: new Map(), next: null, unmarked: [] };
        const c = cal.get(p.id);
        const held = new Map();
        const mark = (t, src, extra) => {
          const d = ctDate(t);
          const h = held.get(d) || { day: d, t, zoho: false, outlook: false, cals: new Set() };
          h.t = Math.min(h.t, t);
          h[src] = true;
          if (extra) extra.split(',').forEach((x) => x && h.cals.add(x));
          held.set(d, h);
        };
        b.done.forEach((t) => mark(t, 'zoho'));
        let next = b.next;
        let cancelled = 0;
        (c ? c.meetings : []).forEach((m) => {
          const t = Date.parse(m.at);
          if (!Number.isFinite(t)) return;
          if (m.cancelled === true || m.cancelled === 'true') { if (t <= now) cancelled += 1; return; }
          if (t > now) { if (next == null || t < next) next = t; return; }
          mark(t, 'outlook', m.cals);
        });
        const list = [...held.values()].sort((x, y) => x.t - y.t);
        const days = list.map((h) => h.day);
        const unmarked = b.unmarked.filter((u) => !b.done.has(minuteOf(u.t)) && !held.has(ctDate(u.t))).sort((x, y) => x.t - y.t);
        const a = added.get(p.id) || {};
        const created = Date.parse(a.Created_Time);
        const hasCreated = Number.isFinite(created);
        const first = list.length ? list[0].t : null;
        const startT = hasCreated ? (first != null ? Math.min(created, first) : created) : first;
        return {
          id: p.id, name: p.name, account: p.account, account_id: p.account_id, assigned: a.Assigned || null, priority: p.priority,
          li: p.li, connected: p.connected,
          n: days.length, cat: Math.min(4, days.length), days, last: days.length ? days[days.length - 1] : null,
          next: next == null ? null : new Date(next).toISOString(),
          start: startT == null ? null : ctDate(startT), created: hasCreated ? ctDate(created) : null,
          entered: [hasCreated && (first == null || created < first) ? ctDate(created) : null, days[0] || null, days[1] || null, days[2] || null, days[3] || null],
          unmarked: unmarked.map((u) => ({ at: new Date(u.t).toISOString(), day: ctDate(u.t), status: u.status })),
          sources: list.map((h) => ({ day: h.day, zoho: h.zoho, outlook: h.outlook, cals: [...h.cals].join(',') })),
          to_log: list.filter((h) => h.outlook && !h.zoho).map((h) => ({ day: h.day, cals: [...h.cals].join(',') })),
          cal_checked: Boolean(c), cal_as_of: c ? c.as_of || null : null, cal_cancelled: cancelled,
        };
      });
    },
  });

  /* Who to talk to next, Priority 1 only: ask for a first meeting, already booked, talk to again (last meeting
     AGAIN_DAYS+ ago and nothing booked), met recently, and Outlook meetings to log in Zoho. */
  const AGAIN_DAYS = 30;
  dash.calc('p1_meet_plan', {
    title: 'Priority 1 meeting plan',
    description: `One row per B2B prospect at Priority 1 now with its group: ask (no meeting held or booked), booked (a meeting is booked), again (last meeting ${AGAIN_DAYS}+ days ago, nothing booked), recent (met within ${AGAIN_DAYS} days, nothing booked); plus days since the last meeting and Outlook meetings Zoho does not show as Completed.`,
    inputs: ['mtg_people'],
    fn: (mtg_people) => {
      const t0 = dayMs(todayCT());
      return mtg_people.filter((p) => p.priority === MTG_PRIORITY).map((p) => {
        const since = p.last ? Math.round((t0 - dayMs(p.last)) / 864e5) : null;
        const group = p.next ? 'booked' : !p.n ? 'ask' : since >= AGAIN_DAYS ? 'again' : 'recent';
        return { ...p, since, group };
      });
    },
  });

  dash.calc('mtg_depth', {
    title: 'Meeting frequency stages, Priority 1',
    description: 'B2B prospects at Priority 1 now. For each stage (Never Met, Met Once, Twice, Thrice, 4+): prospects in it now; unique prospects who newly entered it today, this week (Monday start) and this calendar month (Central time); the count on the same day last month with the change since; and the count at the end of each of the last 12 weeks. Never Met is entered on the day Zoho created the contact; each later stage on the day of the meeting that reached it.',
    inputs: ['mtg_people'],
    fn: (everyone) => {
      const ppl = everyone.filter((p) => p.priority === MTG_PRIORITY);
      const today = todayCT();
      const t = new Date(today + 'T00:00:00Z');
      const mon = new Date(t); mon.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
      const iso = (d) => d.toISOString().slice(0, 10);
      const starts = { today, week: iso(mon), month: today.slice(0, 8) + '01' };
      const [y, m, d] = today.split('-').map(Number);
      const prevDay = iso(new Date(Date.UTC(y, m - 2, Math.min(d, new Date(Date.UTC(y, m - 1, 0)).getUTCDate()))));
      const points = Array.from({ length: MTG_WEEKS }, (_, i) => (i === MTG_WEEKS - 1 ? today : iso(new Date(mon.getTime() - (MTG_WEEKS - 2 - i) * 7 * 864e5 - 864e5))));
      const catAt = (p, day) => (!p.start || p.start > day ? null : Math.min(4, p.days.filter((x) => x <= day).length));
      const from = ppl.reduce((mn, p) => (p.start && (!mn || p.start < mn) ? p.start : mn), null);
      return MTG_STAGES.map((s) => {
        const total = ppl.filter((p) => p.cat === s.k).length;
        const prev = from && from <= prevDay ? ppl.filter((p) => catAt(p, prevDay) === s.k).length : null;
        const entered = (day) => ppl.filter((p) => p.entered[s.k] && p.entered[s.k] >= day && p.entered[s.k] <= today).length;
        return {
          key: String(s.k), stage: s.k, label: s.label, total,
          today: entered(starts.today), week: entered(starts.week), month: entered(starts.month),
          prev_day: prevDay, prev, change: prev ? (total - prev) / prev : null, history_from: from,
          spark: points.map((day) => ({ day, n: from && from <= day ? ppl.filter((p) => catAt(p, day) === s.k).length : null })),
        };
      });
    },
  });

  /* B2B partner meetings: every prospect with a completed meeting (mtg_people) and the Referral Partner deals linked to
     them by the deal's Contact Name. A Referral Partner deal on their company but linked to another contact, or to no
     contact, doesn't count; it is shown on the row so the link can be fixed. */
  dash.calc('b2b_partner_deals', {
    title: 'Met B2B prospects and their Referral Partner deals',
    description: 'One row per B2B prospect with at least one meeting held (Zoho Meeting Status Completed with start time passed, or a past uncancelled meeting on a team Outlook calendar): most recent meeting, Assigned, the Referral Partner deals whose Contact Name is this person (created) and any Referral Partner deal on their company that is linked to someone else or to no contact (not counted, shown for fixing).',
    inputs: ['mtg_people', 'deals_tagged'],
    fn: (mtg_people, deals_tagged) => {
      const rp = deals_tagged.filter((d) => d.kind === 'Partnership');
      const byContact = new Map();
      const byAccount = new Map();
      rp.forEach((d) => {
        if (d.contact_id) { const k = String(d.contact_id); if (!byContact.has(k)) byContact.set(k, []); byContact.get(k).push(d); }
        if (d.account_id) { const k = String(d.account_id); if (!byAccount.has(k)) byAccount.set(k, []); byAccount.get(k).push(d); }
      });
      const brief = (d) => ({ id: String(d.id), deal: d.deal || 'Referral Partner deal', stage: d.stage || null, contact: d.contact || null });
      return mtg_people.filter((p) => p.n > 0).map((p) => {
        const mine = (byContact.get(p.id) || []).map(brief);
        const mineIds = new Set(mine.map((d) => d.id));
        const companyOnly = p.account_id ? (byAccount.get(String(p.account_id)) || []).filter((d) => !mineIds.has(String(d.id))).map(brief) : [];
        return { id: p.id, name: p.name, account: p.account, account_id: p.account_id, assigned: p.assigned, first: p.days[0] || null, last: p.last, meetings: p.n, deals: mine, company_deals: companyOnly, created: mine.length > 0 };
      });
    },
  });

  /* Account gaps: a Referral Partner deal needs an Account in Zoho, so every B2B prospect at Priority 1 or with any meeting
     (completed, scheduled or not marked) should have one. Our own company as the Account counts as none. Do Not Contact
     records are left out: no deal will follow. Separately, Referral Partner deals linked to a prospect whose Account is
     missing, ours, or not the prospect's. */
  const OWN_CO = /tech\s*-?\s*transpire|true\s*lean/i;
  dash.calc('b2b_account_gaps', {
    title: 'B2B prospects and deals with a missing or wrong Account',
    description: 'Rows of kind "no_account": B2B prospects (not Do Not Contact) at Priority 1 or with at least one meeting in Zoho (completed, scheduled, or past and not marked Completed, or counted in Total Meetings) whose contact has no Account, or has our own company as its Account; with why they are in the list, meetings, next scheduled meeting, Assigned and any Referral Partner deal. Rows of kind "wrong_deal": Referral Partner deals linked to a B2B prospect whose deal Account is missing, is our own company, or differs from the contact\'s Account (including a contact with no Account).',
    inputs: ['b2b_people', 'mtg_people', 'deals_tagged'],
    fn: (b2b_people, mtg_people, deals_tagged) => {
      const mtg = new Map(mtg_people.map((m) => [m.id, m]));
      const rp = deals_tagged.filter((d) => d.kind === 'Partnership');
      const byContact = new Map();
      rp.forEach((d) => { if (!d.contact_id) return; const k = String(d.contact_id); if (!byContact.has(k)) byContact.set(k, []); byContact.get(k).push(d); });
      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const loose = new Map();
      rp.filter((d) => !d.contact_id && d.account).forEach((d) => { const k = norm(d.account); if (!loose.has(k)) loose.set(k, []); loose.get(k).push(d); });
      const own = (name) => OWN_CO.test(String(name || ''));
      const brief = (d) => ({ id: String(d.id), deal: d.deal || 'Referral Partner deal', stage: d.stage || null, account: d.account || null, account_id: d.account_id ? String(d.account_id) : null });
      const out = [];
      b2b_people.forEach((p) => {
        const m = mtg.get(p.id) || { n: 0, next: null, unmarked: [], last: null, assigned: null };
        const accOk = Boolean(p.account_id) && !own(p.account);
        const deals = (byContact.get(p.id) || []).map(brief);
        if (!p.dnc) {
          const why = [];
          if (p.priority === '1') why.push('Priority 1');
          if (m.n) why.push(`${m.n} meeting${m.n === 1 ? '' : 's'} held`);
          if (m.next) why.push('meeting scheduled');
          if (m.unmarked.length) why.push(`${m.unmarked.length} past meeting${m.unmarked.length === 1 ? '' : 's'} not marked Completed`);
          if (!m.n && !m.next && !m.unmarked.length && p.met > 0) why.push(`Zoho counts ${p.met} meeting${p.met === 1 ? '' : 's'}`);
          if (why.length && !accOk) {
            out.push({
              kind: 'no_account', key: 'n' + p.id, id: p.id, name: p.name, priority: p.priority, why,
              account: p.account_id ? p.account : null, account_id: p.account_id || null, own_account: Boolean(p.account_id) && own(p.account),
              meetings: m.n, last: m.last || null, next: m.next || null, unmarked: m.unmarked.length, assigned: m.assigned || null,
              deals, loose: (loose.get(norm(p.name)) || []).map(brief),
            });
          }
        }
        deals.forEach((d) => {
          let problem = null;
          if (!d.account_id) problem = 'Deal has no Account';
          else if (own(d.account)) problem = 'Deal is on our own company';
          else if (!accOk) problem = p.account_id ? 'Contact’s Account is our own company' : 'Contact has no Account';
          else if (String(d.account_id) !== String(p.account_id)) problem = 'Deal and contact are on different Accounts';
          if (!problem) return;
          out.push({
            kind: 'wrong_deal', key: 'd' + d.id + '|' + p.id, id: p.id, name: p.name, priority: p.priority, problem,
            account: p.account_id ? p.account : null, account_id: p.account_id || null, deal: d, assigned: m.assigned || null,
          });
        });
      });
      return out;
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
    ['1', 'Add and select a partner prospect', 'When you add someone to B2B, or work the Monday queue.', ['Check Zoho for the person and the company first. Never create a duplicate.', 'Fill company, title and source: Founder Network or Researched.', 'Founder network: set the starting stage the rules allow and write the reason. Researched: leave at P5 for the Monday queue.', 'From the Monday queue: select with one line of evidence per fit question and set P3, or skip and record the reason.'], null, 'The record is complete and the stage matches the rules.', 'The person works for a competitor or an existing client, or another rep already owns them.'],
    ['2', 'First outreach', 'A Priority 3 contact has LI Connect empty: no request sent yet.', ['Read their profile and company. Note one problem their clients deal with.', 'Send the connection note, or a message if you are already connected.', 'In Zoho, set LI Connect to Requested, or log the message.', 'Never send a second request while one is pending.'], 'Hi {first name}, your clients in {industry} seem to be wrestling with {problem}. I work on that side of things and would like to compare notes. Glad to connect.', 'The request or message is sent and recorded.', 'You are unsure whether someone already contacted them.'],
    ['3', 'Reply and follow up', 'They wrote back, or a follow-up task is due.', ['Read the whole thread and the Zoho notes.', 'Answer their actual point first, in a few lines. No sales pitch.', 'If they want to talk, use SOP 4.', 'Close the task, log the message and set the next task with a due date.'], null, 'Your reply is sent and the next task exists.', 'They ask about commission, exclusivity or agreement terms.'],
    ['4', 'Ask for a first meeting', 'A two-way conversation has started (P1) and no meeting has been asked for.', ['Send the approved booking link with the message below.', 'Log that you asked, and set a check-in task on the approved cadence.'], "Would a 20-minute call help? I'd like to hear which client problems come up most for you, and see whether we can help each other. Here's my booking link.", 'The link is sent and a check-in task exists.', 'They want to bring someone else, or talk terms first.'],
    ['5', 'Send and follow up on the agreement', 'After a meeting where the partner said yes to discussing a partnership, or an agreement is waiting.', ['Send the approved referral agreement through Zoho Sign with the company overview.', 'Move the partnership deal to Proposals.', 'Set a follow-up task on the approved cadence.'], null, 'The agreement is out (or signed) and the deal stage matches.', 'The partner asks for changes to the agreement.'],
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
  const pf = el('section', 'cc-card cc-pf');
  pf.id = 'b2-pf';
  pf.setAttribute('aria-labelledby', 'b2-pf-title');
  const pfHead = el('div', 'cc-b2-scorehead');
  const pfTitleBox = el('div');
  const pfTitle = el('h2', null, 'Partner Funnel Overview');
  pfTitle.id = 'b2-pf-title';
  pfTitleBox.append(pfTitle, el('p', 'cc-b2-insight', 'Campaign: May 2026 - 100 B2B. Every tagged contact by Priority, Priority 9 and 11 included.'));
  const pfReset = el('button', 'cc-go cc-pf-reset', 'Reset view');
  pfReset.type = 'button';
  pfReset.title = 'Clear the highlighted priority and show the whole funnel';
  pfReset.addEventListener('click', () => {
    if (!pfPick) return;
    pfPick = null;
    if (drill.dataset.from === 'pf') drill.hidden = true;
    drawPf();
    pf.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const pfSop = el('a', 'cc-b2-soplink', 'SOP');
  pfSop.href = PF_SOP_URL; pfSop.target = '_blank'; pfSop.rel = 'noopener'; pfSop.title = 'B2B Priority Definition: what each Priority means';
  pfSop.setAttribute('aria-label', 'SOP: B2B Priority Definition (opens in a new tab)');
  pfHead.append(pfTitleBox, pfReset, pfSop);
  const pfBody = el('div', 'cc-pf-body');
  const pfNote = el('p', 'cc-b2-insight cc-pf-note');
  pf.append(pfHead, pfBody, pfNote);
  const score = el('section', 'cc-card cc-b2-score');
  score.id = 'b2-score';
  score.setAttribute('aria-labelledby', 'b2-score-title');
  const scoreHead = el('div', 'cc-b2-scorehead');
  const scoreTitle = el('h2', null, 'New B2B partners added to Zoho');
  scoreTitle.id = 'b2-score-title';
  const sopLink = el('a', 'cc-b2-soplink', 'SOP');
  sopLink.href = ADD_SOP_URL; sopLink.target = '_blank'; sopLink.rel = 'noopener'; sopLink.title = 'B2B partner acquisition SOP: how to find and add partners';
  sopLink.setAttribute('aria-label', 'SOP: how to find and add partners (opens in a new tab)');
  const scoreState = el('span', 'cc-b2-state');
  scoreHead.append(scoreTitle, scoreState, sopLink);
  const scoreBody = el('div', 'cc-b2-scorebody');
  const scoreFoot = el('p', 'cc-b2-insight cc-b2-scorefoot');
  score.append(scoreHead, scoreBody, scoreFoot);

  const p3 = el('section', 'cc-card cc-p3');
  p3.id = 'b2-p3';
  p3.setAttribute('aria-labelledby', 'b2-p3-title');
  const p3Head = el('div', 'cc-b2-scorehead');
  const p3TitleBox = el('div');
  const p3Title = el('h2', null, 'Priority 3 — Relationship development');
  p3Title.id = 'b2-p3-title';
  p3TitleBox.append(p3Title, el('p', 'cc-b2-insight', 'Build relationships with selected B2B partner prospects.'));
  const p3Sop = el('a', 'cc-b2-soplink', 'SOP');
  p3Sop.href = P3_SOP_URL; p3Sop.target = '_blank'; p3Sop.rel = 'noopener'; p3Sop.title = 'Priority 3 relationship-development SOP';
  p3Head.append(p3TitleBox, p3Sop);
  const p3Grid = el('div', 'cc-p3-grid');
  const p3Note = el('p', 'cc-b2-insight cc-p3-note');
  p3.append(p3Head, p3Grid, p3Note);
  const na = el('section', 'cc-card cc-na');
  na.id = 'b2-na';
  na.setAttribute('aria-labelledby', 'b2-na-title');
  const naHead = el('div', 'cc-b2-scorehead');
  const naTitleBox = el('div');
  const naTitle = el('h2', null, 'Priority 1 and met partners without an Account');
  naTitle.id = 'b2-na-title';
  naTitleBox.append(naTitle, el('p', 'cc-b2-insight', 'A Referral Partner deal can only be created in Zoho on an Account, so every Priority 1 partner and everyone we have a meeting with needs one.'));
  const naState = el('span', 'cc-b2-state');
  const naSop = el('a', 'cc-b2-soplink', 'SOP');
  naSop.href = PM_SOP_URL; naSop.target = '_blank'; naSop.rel = 'noopener'; naSop.title = 'SOP 002: Referral Partner deal creation in Zoho';
  naSop.setAttribute('aria-label', 'SOP 002: Referral Partner deal creation (opens in a new tab)');
  naHead.append(naTitleBox, naState, naSop);
  const naTiles = el('div', 'cc-na-tiles');
  naTiles.setAttribute('role', 'group');
  naTiles.setAttribute('aria-label', 'Account gaps');
  const naList = el('div', 'cc-b2-wrap cc-na-list');
  naList.id = 'b2-na-list';
  naList.hidden = true;
  const naNote = el('p', 'cc-b2-insight cc-na-note');
  na.append(naHead, naTiles, naList, naNote);
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
  const mailCard = card('b2-mail', 'Email with B2B prospects', 'From the team’s mailboxes, matched to Zoho by email address. Only dates and counts are kept; no subjects or message text.');
  const mailStats = el('div', 'cc-b2-mstats');
  const mailWeeks = el('div', 'cc-b2-mweeks');
  const mailKey = el('p', 'cc-b2-mkey');
  const mailTools = el('div', 'cc-tools cc-b2-chips');
  const mailBody = el('div', 'cc-b2-wrap');
  const mailNote = el('p', 'cc-b2-insight');
  const mailFoot = el('p', 'cc-b2-mfoot');
  mailCard.append(mailStats, mailWeeks, mailKey, mailNote, mailTools, mailBody, mailFoot);
  const mtg = el('section', 'cc-card cc-mt');
  mtg.id = 'b2-mtg';
  mtg.setAttribute('aria-labelledby', 'b2-mtg-title');
  const mtgHead = el('div', 'cc-b2-scorehead');
  const mtgTitleBox = el('div');
  const mtgTitle = el('h2', null, 'P1 Meeting Frequency & Relationship Depth');
  mtgTitle.id = 'b2-mtg-title';
  mtgTitleBox.append(mtgTitle, el('p', 'cc-b2-insight', 'Priority 1 partners (two-way conversation): how often we have met each. Meetings come from Zoho and the team’s Outlook calendars. Who to talk to next is at the bottom of this page.'));
  mtgHead.append(mtgTitleBox);
  const mtgPath = el('div', 'cc-mt-path');
  const mtgBar = el('ol', 'cc-mt-bar');
  mtgBar.setAttribute('aria-label', 'Relationship stages, earliest first');
  const mtgCap = el('div', 'cc-mt-cap');
  mtgCap.append(el('span', null, 'Earlier in relationship'), el('span', null, 'Stronger relationship depth →'));
  mtgPath.append(mtgBar, mtgCap);
  const mtgGap = el('div', 'cc-mt-gap');
  mtgGap.hidden = true;
  const mtgGrid = el('div', 'cc-mt-grid');
  const mtgNote = el('p', 'cc-b2-insight cc-mt-note');
  const plan = el('section', 'cc-card cc-mp');
  plan.id = 'b2-mp';
  plan.setAttribute('aria-labelledby', 'b2-mp-title');
  const planHead = el('div', 'cc-b2-scorehead');
  const planTitleBox = el('div');
  const planTitle = el('h2', null, 'Who to talk to next');
  planTitle.id = 'b2-mp-title';
  planTitleBox.append(planTitle, el('p', 'cc-b2-insight', 'Priority 1 partners, from Zoho and the team’s Outlook calendars: who to ask for a first meeting, who is booked, and who to talk to again. Select a count to list the people; select it again to close.'));
  planHead.append(planTitleBox);
  const planTiles = el('div', 'cc-mp-tiles');
  planTiles.setAttribute('role', 'group');
  planTiles.setAttribute('aria-label', 'Who to talk to next');
  const planList = el('div', 'cc-b2-wrap cc-mp-list');
  planList.id = 'b2-mp-list';
  planList.hidden = true;
  plan.append(planHead, planTiles, planList);
  mtg.append(mtgHead, mtgPath, mtgGap, mtgGrid, mtgNote);
  const pmCard = el('section', 'cc-card cc-pm');
  pmCard.id = 'b2-pm';
  pmCard.setAttribute('aria-labelledby', 'b2-pm-title');
  const pmHead = el('div', 'cc-b2-scorehead');
  const pmTitleBox = el('div');
  const pmTitle = el('h2', null, 'B2B Deals Created');
  pmTitle.id = 'b2-pm-title';
  pmTitleBox.append(pmTitle, el('p', 'cc-b2-insight', 'Campaign: May 2026 - 100 B2B. Every partner we have met should have a Referral Partner deal in Zoho.'));
  const pmSop = el('a', 'cc-b2-soplink', 'SOP');
  pmSop.href = PM_SOP_URL; pmSop.target = '_blank'; pmSop.rel = 'noopener'; pmSop.title = 'SOP 002: Referral Partner deal creation in Zoho';
  pmSop.setAttribute('aria-label', 'SOP 002: how to create a Referral Partner deal (opens in a new tab)');
  pmHead.append(pmTitleBox, pmSop);
  const pmBody = el('div', 'cc-pm-body');
  const pmNote = el('p', 'cc-b2-insight cc-pm-note');
  const pmTools = el('div', 'cc-tools cc-b2-chips cc-pm-chips');
  pmTools.setAttribute('role', 'group');
  pmTools.setAttribute('aria-label', 'Period');
  pmCard.append(pmHead, pmBody, pmNote);
  const monCard = card('b2-monday', 'Priority 3 queue', 'Everyone at Priority 3, grouped by what to do next from LI Connect: untouched first, then connected, then waiting. Within a group, the strongest partner evidence comes first.');
  const monTools = el('div', 'cc-tools cc-b2-chips');
  const monBody = el('div', 'cc-b2-wrap');
  const monMore = el('div', 'cc-tools');
  monCard.append(monTools, monBody, monMore);
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
  /* Lists open right under the section that was clicked, not in one fixed place further down. */
  let drillFrom = null;
  const noteFrom = (e) => {
    const t = e.target;
    if (!(t instanceof Element) || drill.contains(t)) return;
    let sec = t;
    while (sec && sec.parentElement !== root) sec = sec.parentElement;
    if (sec) drillFrom = sec;
  };
  const placeDrill = () => {
    if (drillFrom && drillFrom !== drill && drillFrom.parentElement === root && drillFrom.nextElementSibling !== drill) drillFrom.after(drill);
  };

  root.append(pf, score, p3, na, mtg, pmCard, mailCard, grid1, drill, nextCard, queueCard, monCard, grid2, sopCard, dqCard, plan);
  /* SOP links: an animated playbook page instead of the word. The link keeps its title and aria-label. */
  const SOP_ICON = '<svg class="cc-sop-ico" viewBox="0 0 32 36" aria-hidden="true" focusable="false">'
    + '<g class="cc-sop-spark"><circle cx="27" cy="5" r="1.4"/><circle cx="4" cy="9" r="1"/><circle cx="29" cy="15" r="1"/><path d="M24 2.5v3M22.5 4h3"/></g>'
    + '<g class="cc-sop-page">'
    + '<path class="cc-sop-sheet" d="M7 3h12.5L27 10.5V30a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 30V5.5A2.5 2.5 0 0 1 7 3z"/>'
    + '<path class="cc-sop-fold" d="M19.5 3v5a2.5 2.5 0 0 0 2.5 2.5h5"/>'
    + '<path class="cc-sop-line cc-sop-l1" d="M8.5 14.5h11"/><path class="cc-sop-line cc-sop-l2" d="M8.5 19h13"/><path class="cc-sop-line cc-sop-l3" d="M8.5 23.5h7"/>'
    + '<g class="cc-sop-stamp"><circle cx="22.5" cy="26" r="5.2"/><path d="M20.2 26.1l1.6 1.6 3-3.3"/></g>'
    + '</g></svg>';
  root.querySelectorAll('a.cc-b2-soplink').forEach((a) => {
    a.classList.add('cc-sop-btn');
    a.innerHTML = SOP_ICON + '<span class="cc-b2-sr">SOP</span>';
  });
  root.addEventListener('click', noteFrom, true);
  root.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') noteFrom(e); }, true);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sop]');
    if (!b) return;
    const d = root.querySelector('#b2-sop-' + b.dataset.sop);
    if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); const s = d.querySelector('summary'); if (s) s.focus({ preventScroll: true }); }
  });

  /* Any list of rows (drill): cols are [header, (row) => text or Node]. */
  const showTable = (title, cols, list, note, empty) => {
    drill.querySelector('h3').textContent = title + ' (' + intF(list.length) + ')';
    drill.dataset.from = '';
    const tbl = el('table', 'cc-tbl');
    const th = el('thead'); const hr = el('tr');
    cols.forEach(([x]) => { const c = el('th', null, x); c.scope = 'col'; hr.append(c); });
    th.append(hr); tbl.append(th);
    const tb = el('tbody');
    list.forEach((r) => { const tr = el('tr'); cols.forEach(([, f]) => { const v = f(r); const td = el('td'); if (v instanceof Node) td.append(v); else td.textContent = v == null || v === '' ? '—' : v; tr.append(td); }); tb.append(tr); });
    tbl.append(tb);
    drillBody.replaceChildren(list.length ? tbl : el('p', empty ? 'cc-pm-done' : 'cc-b2-insight', empty || 'Nobody here.'));
    if (note) drillBody.prepend(el('p', 'cc-b2-insight', note));
    placeDrill();
    drill.hidden = false;
    drill.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const rowOpens = (tr, id) => {
    if (!id) return tr;
    tr.classList.add('cc-b2-rowlink');
    tr.title = 'Open the contact in Zoho CRM';
    tr.addEventListener('click', (e) => { if (e.target.closest('a, button, input, select')) return; window.open(ZOHO + 'Contacts/' + id, '_blank', 'noopener'); });
    return tr;
  };
  const peopleById = () => new Map(rows('b2b_people').map((p) => [p.id, p]));

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
    placeDrill();
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
  const mailMissing = () => Boolean(window.CC_MAIL_PRIVATE) && dash.data('b2b_mail').status === 'error';
  const mailOk = () => !mailMissing() && state(['b2b_mail_people']) === 'ok';
  /* One row per person and kind of work: the most urgent item leads, the rest ride along as “more”. Clean-up items group on their own. */
  const groupQueue = (list) => {
    const lead = new Map();
    const out = [];
    list.forEach((a) => {
      const k = a.id + (a.type === 'Close in Zoho' ? '|close' : '');
      const l = lead.get(k);
      if (l) { l.more.push(a); return; }
      const row = { ...a, more: [] };
      lead.set(k, row);
      out.push(row);
    });
    return out;
  };
  const queueRows = () => groupQueue(!mailMissing() && state(['b2b_queue']) === 'ok' ? rows('b2b_queue') : rows('b2b_actions'));
  const ctDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) : null);
  const daysF = (n) => (n == null ? '—' : n === 0 ? 'today' : n === 1 ? '1 day ago' : intF(n) + ' days ago');
  let picked = 0;
  let monPage = 0;
  let monFilter = 'All';

  const drawNext = (a) => {
    nextBody.replaceChildren();
    if (!a) { nextBody.append(el('p', 'cc-b2-insight', 'Nothing is due today. Work the Priority 3 queue, then ask Priority 1 prospects for a first meeting.')); return; }
    const left = el('div');
    const act = el('p', 'cc-b2-action'); act.append(document.createTextNode((a.mail ? 'Reply by email' : a.type) + ': '), link('Contacts', a.id, a.name));
    left.append(act, el('p', 'cc-b2-who', [a.account || 'No company on record', a.why].join('. ')));
    const dl = el('dl', 'cc-b2-dl');
    const pair = (k, v) => { dl.append(el('dt', null, k)); const dd = el('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; dl.append(dd); };
    pair('What to do', a.action);
    pair('Why now', a.why_now);
    if (a.owner_hint) pair('Named in the task', a.owner_hint);
    if (a.more && a.more.length) {
      const ul = el('ul', 'cc-b2-more');
      a.more.forEach((m) => ul.append(el('li', null, `${m.type}: ${m.action}. ${m.why_now}`)));
      pair(`Also open for ${a.name.split(' ')[0]}`, ul);
    }
    pair('SOP', sopBtn(a.sop, 'SOP ' + a.sop + ' ' + (SOPS.find((s) => s[0] === String(a.sop)) || [])[1]));
    pair('Done when', a.done);
    pair('Record it', a.record);
    pair('Then', a.sop === 3 ? 'If they want to talk, ask for a first meeting (SOP 4).' : a.sop === 4 ? 'When they book, log the meeting the same day (SOP 7).' : a.sop === 5 ? 'Once signed, ask for the first introduction (SOP 6).' : 'Keep the partner informed as the deal moves (SOP 6).');
    nextBody.append(left, dl);
  };

  const draw = () => {
    drawPf();
    drawScore();
    drawP3();
    drawNa();
    drawMtg();
    drawPm();
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
    const waitN = mailOk() ? rows('b2b_mail_people').filter((m) => m.status === 'They wrote last' && m.in_days != null && m.in_days <= MAIL_RECENT && !m.dnc).length : 0;
    const lateN = acts.filter((a) => (a.type === 'Reply' || a.type === 'Follow-up') && !a.mail).length;
    const closeItems = acts.filter((a) => a.type === 'Close in Zoho').flatMap((a) => [a, ...a.more]);
    const closeN = closeItems.length;
    const closeDone = closeItems.filter((a) => a.probably_done).length;
    const closeStale = closeItems.filter((a) => a.stale).length;
    const closeDnc = closeN - closeDone - closeStale;
    const strong = mon.filter((m) => m.strength >= 3).length;
    const fnN = ppl.filter((p) => p.source === 'Founder network').length;

    verdict.textContent = `${intF(fv('met'))} of ${intF(fv('all'))} B2B prospects have met us and ${intF(fv('signed'))} have signed, but only ${intF(fv('introduced'))} ${fv('introduced') === 1 ? 'partner has' : 'partners have'} introduced a client. The work is conversations and activation, not more names: ${waitN ? `${intF(waitN)} ${waitN === 1 ? 'prospect wrote' : 'prospects wrote'} last by email in the last 30 days, ` : ''}${intF(lateN)} follow-ups are overdue, ${intF(count('Meeting ask'))} Priority 1 prospects in a conversation have never met us, and ${intF(count('First introduction'))} signed partners have not been asked for an introduction.`;

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
    const scN = state(['b2b_scorecard']) === 'ok' ? (rows('b2b_scorecard')[0] || null) : null;
    tile('1', 'Add', `Target: ${ADD_TARGET} a month`, scN && scN.status !== 'Behind' ? 'cc-b2-ok' : 'cc-b2-wait', intF(ppl.length), 'B2B prospects, including ' + intF(fnN) + ' from the founder network', [
      scN ? `${intF(scN.actual)} of ${intF(ADD_TARGET)} added this month; ${intF(scN.remaining)} to go (scorecard above).` : 'This month’s additions show in the scorecard above once Zoho loads.',
      `${intF(incomplete)} have no company or no title, so they can’t be judged as partners yet.`,
      `${intF(clients)} tagged B2B are client prospects (a client deal, no partner deal). Partners refer buyers; they aren’t buyers.`,
    ], [['1', 'SOP 1 Add']]);
    tile('2', 'Select', `Confirmed: ${MONDAY} every Monday`, 'cc-b2-ok', intF(ppl.filter((p) => p.priority === '5').length), 'in the P5 backlog', [
      `${intF(mon.length)} can be offered in the Monday queue; ${intF(strong)} show three or more signs of a good partner.`,
      `At ${MONDAY} a week that is ${intF(Math.ceil(strong / MONDAY))} weeks of strong candidates.`,
      'Nobody advances by appearing in the queue: select with evidence, or skip with a reason.',
      'Selections per week can’t be counted until Zoho records when a stage changes.',
    ], [['1', 'SOP 1 Select']]);
    tile('3', 'Build relationships', 'Rules proposed', 'cc-b2-wait', intF(acts.length), 'items in today’s queue', [
      `${waitN ? intF(waitN) + ' emails waiting on a reply; ' : ''}${intF(lateN)} reply and follow-up tasks overdue; ${intF(count('Agreement'))} agreement steps waiting.`,
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
      [waitN, `Answer ${intF(waitN)} ${waitN === 1 ? 'email' : 'emails'} waiting on us`, `Their email is the latest in the thread, sent in the last ${MAIL_RECENT} days${waitN > mailN ? `; ${intF(waitN - mailN)} already have a reply or follow-up task in the queue` : ''}. Some need no answer: read, then reply or log it.`, () => { mailFilter = 'They wrote last'; drawMail(); mailCard.scrollIntoView({ behavior: 'smooth' }); }, '3'],
      [lateN, `Clear ${intF(lateN)} overdue replies and follow-ups`, `The oldest is ${intF(Math.max(0, ...acts.filter((a) => (a.type === 'Reply' || a.type === 'Follow-up') && !a.mail).map((a) => a.late)))} days late. Replies first: a conversation goes cold faster than a task.`, () => { queueFilter = 'Reply'; drawQueue(); queueCard.scrollIntoView({ behavior: 'smooth' }); }, '3'],
      [count('Agreement'), `Move ${intF(count('Agreement'))} agreement steps`, 'Signatures waiting and agreement tasks overdue. Each signed partner is a channel; an unsigned one is a conversation.', () => { queueFilter = 'Agreement'; drawQueue(); queueCard.scrollIntoView({ behavior: 'smooth' }); }, '5'],
      [count('Meeting ask'), `Ask ${intF(count('Meeting ask'))} Priority 1 prospects for a first meeting`, 'In a two-way conversation, connected, never met and nothing scheduled. Priority 3 contacts get a conversation first (Priority 3 queue), not a meeting ask.', () => { queueFilter = 'Meeting ask'; drawQueue(); queueCard.scrollIntoView({ behavior: 'smooth' }); }, '4'],
      [count('First introduction'), `Ask ${intF(count('First introduction'))} signed partners for their first introduction`, 'A signed agreement earns nothing until it produces an introduction. Name one client problem we solve and ask who comes to mind.', () => { queueFilter = 'First introduction'; drawQueue(); queueCard.scrollIntoView({ behavior: 'smooth' }); }, '6'],
      [mon.length, `Move ${intF(Math.min(MONDAY, mon.length))} from the Priority 5 backlog to Priority 3`, `${intF(mon.length)} ${mon.length === 1 ? 'prospect is' : 'prospects are'} at Priority 5 and not yet met; ${intF(strong)} show three or more partner signs. Select with evidence or skip with a reason.`, () => showP5(rows('b2b_p5_backlog')), '1'],
      [count('Revive deal'), `Revive ${intF(count('Revive deal'))} stalled partnership deals`, `Open deals untouched for ${STALE_DAYS} days or more, with no task set.`, () => { queueFilter = 'Revive deal'; drawQueue(); queueCard.scrollIntoView({ behavior: 'smooth' }); }, '5'],
      [closeN, `Close or re-date ${intF(closeN)} ${closeN === 1 ? 'task' : 'tasks'} in Zoho`, `${intF(closeDone)} look done (we emailed them after the task was created), ${intF(closeStale)} are more than ${TASK_STALE} days overdue, ${intF(closeDnc)} belong to Do Not Contact records. Open tasks that are already done push real work down the queue.`, () => { queueFilter = 'Close in Zoho'; drawQueue(); queueCard.scrollIntoView({ behavior: 'smooth' }); }, '3'],
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
        col.title = `Week of ${dayF(w.week)}: ${w.meetings} meetings. Select to list them.`;
        press(col, () => {
          const ids = peopleById();
          const end = new Date(new Date(w.week + 'T00:00:00Z').getTime() + 7 * 864e5).toISOString().slice(0, 10);
          const list = rows('meetings').filter((m) => m.Start_DateTime && m.Who_Id_id && ids.has(String(m.Who_Id_id)) && ctDay(m.Start_DateTime) >= w.week && ctDay(m.Start_DateTime) < end)
            .sort((a, b2) => String(a.Start_DateTime).localeCompare(String(b2.Start_DateTime)));
          showTable(`Meetings with B2B prospects, week of ${dayF(w.week)}`, [
            ['When (CT)', (m) => new Date(m.Start_DateTime).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })],
            ['Meeting', (m) => m.Event_Title],
            ['With', (m) => link('Contacts', m.Who_Id_id, m.Who_Id || ids.get(String(m.Who_Id_id)).name)],
            ['Company', (m) => { const p = ids.get(String(m.Who_Id_id)); return p && p.account_id ? link('Accounts', p.account_id, p.account) : (p && p.account) || 'No company'; }],
          ], list, 'Every meeting logged in Zoho against a B2B prospect that week, by meeting date.');
        });
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
    const unverified = ppl.filter((p) => p.priority === '1' && p.li !== 'Connected').length;
    const liOnly = ppl.filter((p) => p.li_only).length;
    const p5Signed = ppl.filter((p) => p.signed && p.priority === '5').length;
    [
      [clients, 'client prospects tagged B2B', 'Remove the B2B tag; they belong to a client campaign.', (p) => p.client_only],
      [incomplete, 'prospects with no company or no title', 'Fill them so the person can be judged as a partner.', (p) => !p.complete],
      [unverified, 'Priority 1 prospects not Connected in Zoho', 'Priority 1 means a two-way conversation after a LinkedIn connection; set LI Connect, or move them back to Priority 3.', (p) => p.priority === '1' && p.li !== 'Connected'],
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
          [ppl.filter(wrote).length, 'prospects who wrote back by email but are still P5 or have no Priority', 'They wrote back, which is a two-way conversation: once connected on LinkedIn they belong at Priority 1.', wrote],
          [ppl.filter(noAddr).length, 'prospects with no email address in Zoho', 'Email history can’t be matched without one. Add it when you have it.', noAddr],
        ];
      })() : []),
    ].forEach(([n, label, fix, keep]) => {
      const li = el('li', 'cc-b2-dqi' + (n ? '' : ' cc-b2-clear'));
      li.append(el('b', null, intF(n)), el('span', null, label), el('small', null, fix));
      if (n) press(li, () => showPeople(label[0].toUpperCase() + label.slice(1), ppl.filter(keep), fix));
      dqBody.append(li);
    });
    [['Not recorded', 'when a contact joined the campaign, when its stage changed, when a LinkedIn request was sent or accepted, and who did each piece of work.'], ['Awaiting Mack', 'per-rep targets, stage definitions, follow-up cadence, skip cooldown and status colors.']].forEach(([k, v]) => {
      const li = el('li', 'cc-b2-dqi cc-b2-note'); li.append(el('b', null, k), el('span', null, v)); dqBody.append(li);
    });
  };

  const drawQueue = () => {
    const acts = queueRows();
    const types = ['All', ...['Reply', 'Follow-up', 'Agreement', 'Meeting ask', 'First introduction', 'Revive deal', 'Close in Zoho'].filter((t) => acts.some((a) => a.type === t))];
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
      const what = el('td', null, a.action);
      if (a.more && a.more.length) what.append(el('small', null, `+${intF(a.more.length)} more open for them`));
      tr.append(el('td', null, String(i + 1)), el('td', a.type === 'Close in Zoho' ? 'cc-b2-closecell' : null, a.mail ? 'Reply by email' : a.type), who, what);
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
    if (mailMissing()) return 'Email activity by week isn’t in this build of the page; LinkedIn messages and calls are not recorded anywhere yet.';
    const wk = rows('b2b_mail_weeks');
    if (state(['b2b_mail_weeks']) !== 'ok' || wk.length < 2) return 'Email activity by week shows once the mailbox data loads; LinkedIn messages and calls are not recorded anywhere yet.';
    const a = wk[wk.length - 1];
    const b = wk[wk.length - 2];
    return `Email: ${intF(a.people_sent)} prospects emailed this week (${intF(b.people_sent)} last week); ${intF(a.received)} emails from prospects this week (${intF(b.received)} last week). LinkedIn messages and calls are not recorded yet.`;
  };

  const MAIL_COLS = [
    ['Name', (m) => link('Contacts', m.id, m.name)],
    ['Company', (m) => (m.account_id ? link('Accounts', m.account_id, m.account) : m.account || 'No company')],
    ['Their last email', (m) => (m.last_in ? dayF(ctDay(m.last_in)) : 'Never')],
    ['Our last email', (m) => (m.last_out ? dayF(ctDay(m.last_out)) + (m.last_out_by ? ', ' + m.last_out_by : '') : 'Never')],
    ['Emails out / in', (m) => intF(m.n_out) + ' / ' + intF(m.n_in)],
    ['Status', (m) => m.status],
  ];
  const showMailPeople = (title, list, note) => showTable(title, MAIL_COLS, list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))), note);
  const showMailWeek = (w) => {
    const ids = new Set((w._people || []).map(String));
    const list = rows('b2b_mail_people').filter((m) => ids.has(String(m.id)));
    showMailPeople(`Prospects we emailed, week of ${dayF(w.week)}`, list, `${intF(w.sent)} emails went to ${intF(w.people_sent)} prospects that week and ${intF(w.received)} came back. Who wrote to us in a given week isn’t kept, only the count; “They wrote last” lists who wrote most recently.`);
  };
  const drawMail = () => {
    if (mailMissing()) {
      [mailStats, mailWeeks, mailTools, mailBody].forEach((n) => n.replaceChildren());
      mailKey.textContent = '';
      mailFoot.textContent = '';
      mailNote.textContent = 'Email history isn’t on this page yet. The private Claude Dashboard has it.';
      return;
    }
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
      stat(intF(thisW.people_sent), 'prospects emailed this week', lastW ? `${intF(lastW.people_sent)} last week (${d > 0 ? '+' : ''}${intF(d)}). Week starts Monday, CT.` : null, () => showMailWeek(thisW));
    }
    stat(pct(wroteBack.length, emailed.length), 'of the prospects we emailed wrote back', `${intF(wroteBack.length)} of ${intF(emailed.length)}. Automatic replies and meeting responses don’t count.`, () => showMailPeople('Emailed by us and wrote back', wroteBack, `${intF(wroteBack.length)} of the ${intF(emailed.length)} prospects we emailed have written back.`));
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
        col.title = `Week of ${dayF(w.week)}: ${w.sent} emails sent to ${w.people_sent} prospects, ${w.received} received. Select to list the prospects we emailed.`;
        press(col, () => showMailWeek(w));
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
      const tr = rowOpens(el('tr'), m.id);
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
    const first = rows('b2b_mail')[0] || {};
    const boxes = first.mailboxes || 'info@, hemang@';
    mailFoot.textContent = `Mail as of ${first.as_of ? dayF(ctDay(first.as_of)) + ' (CT)' : 'the last refresh'}. Covers ${boxes}; mail sent only from another mailbox, a personal address or LinkedIn won’t show, so “they wrote last” can mean someone already answered elsewhere. Check before replying.`;
  };

  const monthF = (mo, style) => new Date(mo + '-01T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: style || 'long' });
  const showAdded = (title, list, note) => {
    drill.querySelector('h3').textContent = title + ' (' + intF(list.length) + ')';
    const tbl = el('table', 'cc-tbl');
    const th = el('thead'); const hr = el('tr');
    ['Name', 'Company', 'Added', 'LinkedIn', 'Source', 'Assigned to', 'Counts toward 50'].forEach((x) => { const c = el('th', null, x); c.scope = 'col'; hr.append(c); });
    th.append(hr); tbl.append(th);
    const tb = el('tbody');
    list.slice().sort((a, b) => b.day.localeCompare(a.day) || String(a.name).localeCompare(String(b.name))).forEach((r) => {
      const tr = el('tr');
      const n = el('td'); n.append(link('Contacts', r.id, r.name)); tr.append(n);
      const a = el('td'); if (r.account_id) a.append(link('Accounts', r.account_id, r.account)); else a.textContent = 'No company'; tr.append(a);
      tr.append(el('td', null, dayF(r.day)));
      const li = el('td'); if (r.linkedin) { const x = el('a', 'cc-zlink', 'Profile'); x.href = r.linkedin; x.target = '_blank'; x.rel = 'noopener'; li.append(x); } else li.textContent = 'Missing'; tr.append(li);
      tr.append(el('td', null, r.source), el('td', null, r.assigned || 'Not assigned'), el('td', r.counted ? (r.missing ? 'cc-b2-wait' : null) : 'cc-b2-late', r.counted ? (r.missing ? 'Yes. ' + r.missing : 'Yes') : r.reason));
      tb.append(tr);
    });
    tbl.append(tb);
    drillBody.replaceChildren(tbl);
    if (note) drillBody.prepend(el('p', 'cc-b2-insight', note));
    placeDrill();
    drill.hidden = false;
    drill.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const showP5 = (list) => {
    drill.querySelector('h3').textContent = 'Priority 5 backlog (' + intF(list.length) + ')';
    const tbl = el('table', 'cc-tbl');
    const th = el('thead'); const hr = el('tr');
    ['Name', 'Company', 'Created in Zoho', 'Priority'].forEach((x) => { const c = el('th', null, x); c.scope = 'col'; hr.append(c); });
    th.append(hr); tbl.append(th);
    const tb = el('tbody');
    list.forEach((r) => {
      const tr = el('tr');
      const n = el('td'); n.append(link('Contacts', r.id, r.name)); tr.append(n);
      const a = el('td'); if (r.account_id) a.append(link('Accounts', r.account_id, r.account)); else a.textContent = 'No company'; tr.append(a);
      tr.append(el('td', null, r.created ? dayF(r.created) + ' ' + r.created.slice(0, 4) : '—'), el('td', null, 'P' + r.priority));
      tb.append(tr);
    });
    tbl.append(tb);
    drillBody.replaceChildren(el('p', 'cc-b2-insight', 'Tagged “May 2026 - 100 B2B” with Priority 5 now: the backlog the weekly transfer to Priority 3 picks from. Newest first.'), tbl);
    placeDrill();
    drill.hidden = false;
    drill.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const drawScore = () => {
    const st = state(['b2b_scorecard']);
    scoreBody.replaceChildren();
    scoreFoot.textContent = '';
    scoreState.className = 'cc-b2-state';
    scoreState.textContent = '';
    if (st !== 'ok') {
      scoreBody.append(el('p', st === 'error' ? 'cc-b2-bad' : 'cc-b2-insight', st === 'error' ? 'The B2B contact list didn’t load from Zoho, so this month’s additions can’t be counted. Reload, or check the source in the dashboard menu.' : 'Counting this month’s additions from Zoho…'));
      return;
    }
    const sc = rows('b2b_scorecard')[0];
    const all = rows('b2b_added_rows');
    if (!sc || !all.length) {
      scoreBody.append(el('p', 'cc-b2-insight', 'No contacts carry the “May 2026 - 100 B2B” tag yet. Add the first one with the SOP; it shows here once Zoho has it.'));
      return;
    }
    const inMonth = all.filter((r) => r.month === sc.month);
    const counted = inMonth.filter((r) => r.counted);
    scoreState.textContent = sc.status;
    scoreState.classList.add(sc.status === 'Behind' ? 'cc-b2-wait' : 'cc-b2-ok');

    /* Focal number, bar and pace. */
    const main = el('div', 'cc-b2-scoremain');
    const big = el('p', 'cc-b2-scorebig');
    big.classList.add(sc.actual >= sc.target ? 'cc-b2-scoremet' : 'cc-b2-scoreshort');
    big.append(el('b', null, intF(sc.actual)), el('span', null, 'of ' + intF(sc.target)));
    const bigLabel = el('p', 'cc-b2-scorelabel', `qualified partner prospects added in ${monthF(sc.month)}`);
    press(big, () => showAdded(`Counted toward ${monthF(sc.month)}’s target`, counted, 'Tagged “May 2026 - 100 B2B” and created in Zoho this month, not labeled only Client and not a repeat.'));
    big.title = 'List the contacts in this count';
    const bar = el('div', 'cc-b2-scorebar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${sc.actual} of ${sc.target} added; ${sc.expected} expected by today`);
    const fill = el('i'); fill.style.width = Math.min(100, sc.pct * 100) + '%'; bar.append(fill);
    const mark = el('span', 'cc-b2-scoremark'); mark.style.left = Math.min(100, (sc.expected / sc.target) * 100) + '%'; mark.title = `Where the month should be by today: ${sc.expected}`; bar.append(mark);
    const barKey = el('p', 'cc-b2-scorekey');
    barKey.textContent = `${Math.round(sc.pct * 100)}% of the target. The tick marks where the month should be by today: ${intF(sc.expected)} after ${intF(sc.workdays_elapsed)} of ${intF(sc.workdays_total)} weekdays.`;
    main.append(big, bigLabel, bar, barKey);

    const facts = el('dl', 'cc-b2-scorefacts');
    const fact = (k, v, sub, go) => {
      const d = el('div', 'cc-b2-scorefact');
      d.append(el('dt', null, k), el('dd', null, v));
      if (sub) d.append(el('small', null, sub));
      if (go) press(d, go);
      facts.append(d);
    };
    const soFar = () => showAdded(`Counted toward ${monthF(sc.month)}’s target`, counted, `${intF(sc.actual)} counted so far against ${intF(sc.target)}: ${sc.remaining ? intF(sc.remaining) + ' still needed over ' + intF(sc.workdays_left) + ' weekdays left, about ' + (sc.per_week != null ? intF(sc.per_week) : '—') + ' a week.' : 'the target is met.'}`);
    fact('Still needed', intF(sc.remaining), sc.remaining ? (sc.workdays_left ? `${intF(sc.workdays_left)} weekdays left` : 'The month is over') : 'Target met', soFar);
    fact('Pace needed', sc.remaining && sc.per_week != null ? intF(sc.per_week) + ' a week' : '—', sc.remaining && sc.per_day != null ? `About ${sc.per_day < 1 ? sc.per_day.toFixed(1) : intF(Math.ceil(sc.per_day))} each weekday` : 'No more needed this month', soFar);
    fact('This week', intF(sc.week), `${intF(sc.last_week)} last week. Weeks start Monday, CT.`, () => showAdded('Counted this week', counted.filter((r) => r.day >= (() => { const t = new Date(sc.today + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); })())));
    const diff = sc.actual - sc.prev_actual;
    fact(monthF(sc.prev_month) + ' total', intF(sc.prev_actual), diff === 0 ? `${monthF(sc.month)} has matched it so far` : `${monthF(sc.month)} is ${intF(Math.abs(diff))} ${diff > 0 ? 'ahead' : 'behind'} so far`, () => showAdded(`Counted toward ${monthF(sc.prev_month)}`, all.filter((r) => r.month === sc.prev_month && r.counted)));
    const p5st = state(['b2b_p5_backlog']);
    const p5 = p5st === 'ok' ? rows('b2b_p5_backlog') : [];
    const level = p5st !== 'ok' ? null : p5.length < P5_WEAK ? ['weak', '▼ Weak'] : p5.length <= P5_STRONG ? ['building', 'Building'] : ['strong', '▲ Strong'];
    const p5card = el('article', 'cc-b2-p5card' + (level ? ' cc-b2-p5-' + level[0] : ''));
    p5card.id = 'b2-p5';
    const p5head = el('header', 'cc-b2-p5head');
    const badgeIcon = el('span', 'cc-b2-p5icon');
    badgeIcon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/></svg>';
    const p5titles = el('div');
    p5titles.append(el('h3', null, 'Priority 5 Backlog'), el('p', null, 'Top-of-funnel strength'));
    p5head.append(badgeIcon, p5titles);
    if (level) p5head.append(el('span', 'cc-b2-p5badge', level[1]));
    const p5num = el('p', 'cc-b2-p5num', p5st === 'ok' ? intF(p5.length) : p5st === 'loading' ? '…' : 'Unavailable');
    const p5sub = el('p', 'cc-b2-p5sub', p5st === 'error' ? 'The contact list didn’t load from Zoho, so the backlog can’t be counted.' : p5st === 'loading' ? 'Counting from Zoho…' : 'Waiting for selection. Not part of the 50.');
    const p5legend = el('p', 'cc-b2-p5legend');
    p5legend.append(el('b', null, 'Backlog strength:'), document.createTextNode(` under ${P5_WEAK} = Weak, ${P5_WEAK}–${P5_STRONG} = Building, over ${P5_STRONG} = Strong`));
    p5card.append(p5head, p5num, p5sub, p5legend);
    if (p5st === 'ok') { press(p5card, () => showP5(p5)); p5card.setAttribute('aria-label', `Priority 5 backlog: ${p5.length}, ${level[1].replace(/[▼▲] /, '')}. Open the list.`); }
    const side = el('div', 'cc-b2-scoreside');
    side.append(p5card, facts);
    const top = el('div', 'cc-b2-scoretop');
    top.append(main, side);

    /* Supporting: the monthly trend. */
    const sub = el('div', 'cc-b2-scoresub');
    const trend = el('figure', 'cc-b2-trend');
    trend.append(el('figcaption', null, `Counted per month, last four months. The dashed line is the target of ${ADD_TARGET}.`));
    const cols = el('div', 'cc-b2-trendcols');
    cols.style.gridTemplateColumns = `repeat(${sc.trend.length}, minmax(0, 1fr))`;
    const scale = Math.max(ADD_TARGET * 1.25, ...sc.trend.map((t2) => t2.actual));
    sc.trend.forEach((t2) => {
      const c = el('div', 'cc-b2-trendcol' + (t2.month === sc.month ? ' cc-b2-trendnow' : '') + (t2.actual >= ADD_TARGET ? ' cc-b2-trendmet' : ''));
      const b = el('span', 'cc-b2-trendbar');
      const i = el('i'); i.style.height = Math.min(100, (t2.actual / scale) * 100) + '%';
      const tl = el('span', 'cc-b2-trendtl'); tl.style.bottom = (ADD_TARGET / scale) * 100 + '%';
      b.append(i, tl);
      if (t2.actual > scale) b.classList.add('cc-b2-trendclip');
      c.append(el('b', null, intF(t2.actual)), b, el('small', null, monthF(t2.month, 'short')));
      c.title = `${monthF(t2.month)}: ${t2.actual} counted of ${t2.added} added`;
      press(c, () => showAdded(`Added in ${monthF(t2.month)}`, all.filter((r) => r.month === t2.month)));
      cols.append(c);
    });
    trend.append(cols);
    sub.append(trend);

    scoreBody.append(top, sub);
    const notCounted = inMonth.filter((r) => !r.counted);
    const incomplete = counted.filter((r) => r.missing);
    const toFix = [...notCounted, ...incomplete];
    const foot = [];
    if (notCounted.length) foot.push(`${intF(notCounted.length)} more ${notCounted.length === 1 ? 'was' : 'were'} added this month but ${notCounted.length === 1 ? 'doesn’t' : 'don’t'} count (labeled Client or a repeat).`);
    if (incomplete.length) foot.push(`${intF(incomplete.length)} counted ${incomplete.length === 1 ? 'contact is' : 'contacts are'} missing a name, company or LinkedIn profile.`);
    foot.push('Counted by the date Zoho created the contact; contacts tagged later don’t count as new.');
    scoreFoot.replaceChildren(document.createTextNode(foot.join(' ') + ' '));
    if (toFix.length) {
      const fix = el('button', 'cc-go', 'List the ones to fix'); fix.type = 'button';
      fix.addEventListener('click', () => showAdded(`Added in ${monthF(sc.month)}: records to fix`, toFix, 'Remove the B2B tag from clients and merge repeats; those count once fixed. Fill missing names, companies and LinkedIn profiles so the record is usable.'));
      scoreFoot.append(fix);
    }
  };

  const P3_ICON = {
    backlog: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    untouched: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
    pursued: '<path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4z"/>',
    connected: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="m15.5 11 2 2 4-4"/>',
    email: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    twoway: '<path d="M4 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M19 9h1a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1v3l-3.5-3H12"/>',
  };
  const svgIcon = (name) => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'cc-p3-icon');
    svg.innerHTML = P3_ICON[name];
    return svg;
  };
  const showP3 = (title, list, note, trans) => {
    drill.querySelector('h3').textContent = title + ' (' + intF(list.length) + ')';
    const tbl = el('table', 'cc-tbl');
    const th = el('thead'); const hr = el('tr');
    (trans ? ['Name', 'Company', 'Changed (CT)', 'From', 'To', 'Priority now', 'LI Connect now'] : ['Name', 'Company', 'Priority', 'LI Connect', 'Met']).forEach((x) => { const c = el('th', null, x); c.scope = 'col'; hr.append(c); });
    th.append(hr); tbl.append(th);
    const tb = el('tbody');
    const people = new Map(rows('p3_state').map((p) => [p.id, p]));
    list.forEach((r) => {
      const p = trans ? people.get(r.id) || { id: r.id, name: 'Contact ' + r.id } : r;
      const tr = el('tr');
      const n = el('td'); n.append(link('Contacts', p.id, p.name)); tr.append(n);
      const a = el('td'); if (p.account_id) a.append(link('Accounts', p.account_id, p.account)); else a.textContent = 'No company'; tr.append(a);
      if (trans) tr.append(el('td', null, r.ct.replace('T', ' ').slice(0, 16)), el('td', null, r.from || 'Empty'), el('td', null, r.to || 'Empty'), el('td', null, p.priority ? 'P' + p.priority : 'Not set'), el('td', null, p.li || 'Empty'));
      else tr.append(el('td', null, p.priority ? 'P' + p.priority : 'Not set'), el('td', null, p.li || 'Empty'), el('td', null, p.met ? intF(p.met) : '—'));
      tb.append(tr);
    });
    tbl.append(tb);
    drillBody.replaceChildren(tbl);
    if (note) drillBody.prepend(el('p', 'cc-b2-insight', note));
    placeDrill();
    drill.hidden = false;
    drill.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const drawP3 = () => {
    p3Grid.replaceChildren();
    const st = state(['p3_state']);
    if (st !== 'ok') {
      p3Note.textContent = st === 'error' ? 'The B2B contacts didn’t load from Zoho, so the Priority 3 panel can’t be worked out. Reload, or check the source in the dashboard menu.' : 'Loading Priority 3 from Zoho…';
      p3Note.classList.toggle('cc-b2-bad', st === 'error');
      return;
    }
    p3Note.classList.remove('cc-b2-bad');
    const ppl = rows('p3_state');
    const per = state(['p3_periods']) === 'ok' ? rows('p3_periods') : null;
    const pr = (k) => (per ? per.find((r) => r.key === k) : null);
    const list = (f) => ppl.filter((p) => f({ pr: p.priority, li: p.li }));
    const signed = (n) => (n > 0 ? '+' + intF(n) : n < 0 ? '−' + intF(-n) : '0');
    const cell = (v) => (per ? v : '—');
    const kpi = (opt) => {
      const c = el('article', 'cc-p3-kpi cc-p3-' + opt.theme);
      c.id = 'b2-p3-' + opt.key;
      const h = el('header', 'cc-p3-head');
      h.append(svgIcon(opt.icon), el('h3', null, opt.label));
      const big = el('p', 'cc-p3-big', opt.big);
      c.append(h, big, el('p', 'cc-p3-sub', opt.sub));
      (opt.blocks || [{ rows: opt.rows }]).forEach((b) => {
        const blk = el('div', 'cc-p3-block');
        if (b.title) {
          const bt = el('p', 'cc-p3-btitle'); bt.append(document.createTextNode(b.title));
          if (b.total != null) bt.append(el('b', null, b.total));
          blk.append(bt);
        }
        const dl = el('dl', 'cc-p3-periods');
        b.rows.forEach(([k, v]) => { const d = el('div'); d.append(el('dt', null, k), el('dd', null, v)); dl.append(d); });
        blk.append(dl);
        if (b.foot) blk.append(el('p', 'cc-p3-foot', b.foot));
        c.append(blk);
      });
      if (opt.flag) c.append(el('p', 'cc-p3-flag', opt.flag));
      press(c, opt.go);
      c.setAttribute('aria-label', opt.label + ': ' + opt.big + '. Open the list.');
      p3Grid.append(c);
    };
    const net = (k) => [['Today', cell(signed((pr('today') || {})[k + '_net']))], ['Week', cell(signed((pr('week') || {})[k + '_net']))], ['Month', cell(signed((pr('month') || {})[k + '_net']))]];
    const evt = (k) => [['Today', cell(intF(((pr('today') || {})[k] || []).length))], ['Week', cell(intF(((pr('week') || {})[k] || []).length))], ['Month', cell(intF(((pr('month') || {})[k] || []).length))]];
    const evtList = (k, title) => () => {
      if (!per) { showP3(title + ': this month', [], 'Changes aren’t recorded yet: Zoho history tracking for LI Connect and Priority isn’t on.', true); return; }
      showP3(title + ' this month', (pr('month') || {})[k] || [], 'Each contact once, with the change Zoho recorded.', true);
    };

    const backlog = list(P3_KPIS.backlog);
    const untouched = list(P3_KPIS.untouched);
    const pending = list(P3_KPIS.pending);
    const connected = list(P3_KPIS.connected);
    const email = list(P3_KPIS.email);
    const p1c = ppl.filter((p) => p.priority === '1' && p.li === 'Connected');
    const promotedAll = (pr('all') || {}).promoted || null;

    kpi({ key: 'backlog', theme: 'neutral', icon: 'backlog', label: 'Priority 3 backlog', big: intF(backlog.length), sub: 'Current total', rows: net('backlog'), go: () => showP3('Priority 3 backlog', backlog) });
    kpi({ key: 'untouched', theme: untouched.length ? 'bad' : 'good', icon: 'untouched', label: 'Untouched records', big: intF(untouched.length), sub: untouched.length ? 'LI Connect is empty: no request sent' : 'All contacts pursued', rows: net('untouched'), flag: untouched.length ? 'Action required until this reaches 0' : null, go: () => showP3('Untouched: Priority 3, LI Connect empty', untouched, 'Send each one a connection request (SOP 2) and set LI Connect to Requested.') });
    kpi({ key: 'pursued', theme: 'progress', icon: 'pursued', label: 'Pursued / pending', big: intF(pending.length), sub: 'Requests pending now', blocks: [{ title: 'New requests sent', rows: evt('pursued') }, { title: 'Pending total ', total: intF(pending.length), rows: net('pending'), foot: 'Net change in pending requests' }], go: per ? evtList('pursued', 'Newly pursued') : () => showP3('Pending: Priority 3, LI Connect Requested', pending) });
    kpi({ key: 'connected', theme: 'teal', icon: 'connected', label: 'Contacts connected', big: intF(connected.length), sub: 'Priority 3 at Connected now', rows: evt('newly_connected'), go: () => showP3('Connected: Priority 3, LI Connect Connected', connected, 'An accepted connection isn’t a conversation yet. When they write back or talk with us, move them to Priority 1.') });
    kpi({ key: 'email', theme: 'gray', icon: 'email', label: 'Email Required', big: intF(email.length), sub: 'Blocked — No action available', rows: evt('newly_email'), go: () => showP3('Email Required: Priority 3', email, 'Tracking only. LinkedIn needs their email to send a request, so there is nothing to do here for now.') });
    kpi({ key: 'twoway', theme: 'good', icon: 'twoway', label: 'Two-way conversations', big: promotedAll ? intF(promotedAll.length) : intF(p1c.length), sub: promotedAll ? `Connected, then moved from Priority 3 to 1${(pr('all') || {}).tracked ? ' since ' + dayF((pr('all') || {}).tracked) : ''}` : 'Priority 1 and Connected now (promotions count once tracking is on)', rows: evt('promoted'), go: () => (promotedAll ? showP3('Two-way conversations started', promotedAll, 'Moved from Priority 3 to 1 while Connected on LinkedIn.', true) : showP3('Priority 1 and Connected now', p1c, 'Promotions from Priority 3 to 1 can’t be counted until Zoho records Priority changes.')) });

    const m = pr('month');
    p3Note.textContent = !per
      ? 'Today, Week and Month show — because Zoho doesn’t record when Priority or LI Connect change yet. They fill in from the day history tracking is switched on for both fields; nothing is estimated before then.'
      : m && m.partial ? `Changes are counted from ${dayF(m.tracked)}, when Zoho started recording them, so this week’s and this month’s figures may be partial.` : 'Changes come from Zoho’s field history. Times are Central; weeks start Monday.';
  };

  const drawMonday = () => {
    const st = state(['b2b_p3_queue']);
    if (st !== 'ok') {
      monTools.replaceChildren(); monMore.replaceChildren();
      monBody.replaceChildren(el('p', st === 'error' ? 'cc-b2-bad' : 'cc-b2-insight', st === 'error' ? 'The B2B contacts didn’t load from Zoho, so the Priority 3 queue can’t be shown.' : 'Loading the Priority 3 queue…'));
      return;
    }
    const all = rows('b2b_p3_queue');
    const kinds = ['All', ...P3Q_STEPS.map((x) => x[0]).filter((k) => all.some((r) => r.status === k))];
    if (!kinds.includes(monFilter)) monFilter = 'All';
    monTools.replaceChildren(...kinds.map((k) => {
      const b = el('button', 'cc-chip', `${k} (${intF(k === 'All' ? all.length : all.filter((r) => r.status === k).length)})`);
      b.type = 'button'; b.setAttribute('aria-pressed', String(monFilter === k));
      b.addEventListener('click', () => { monFilter = k; monPage = 0; drawMonday(); });
      return b;
    }));
    const mon = all.filter((r) => monFilter === 'All' || r.status === monFilter);
    if (!mon.length) { monBody.replaceChildren(el('p', 'cc-b2-insight', 'Nobody is at Priority 3 right now. The weekly transfer from Priority 5 fills this queue.')); monMore.replaceChildren(); return; }
    const pages = Math.max(1, Math.ceil(mon.length / MONDAY));
    if (monPage >= pages) monPage = 0;
    const list = mon.slice(monPage * MONDAY, monPage * MONDAY + MONDAY);
    const tbl = el('table', 'cc-tbl');
    const th = el('thead'); const hr = el('tr');
    ['#', 'Contact', 'Role', 'LI Connect', 'Next step', 'Why this person'].forEach((x) => { const c = el('th', null, x); c.scope = 'col'; hr.append(c); });
    th.append(hr); tbl.append(th);
    const tb = el('tbody');
    list.forEach((m, i) => {
      const tr = rowOpens(el('tr'), m.id);
      const who = el('td'); who.append(link('Contacts', m.id, m.name)); if (m.account) who.append(el('small', null, m.account));
      const nx = el('td', m.status === 'Untouched' ? 'cc-b2-late' : null); nx.append(document.createTextNode(m.next + ' ')); if (m.sop) nx.append(sopBtn(m.sop));
      const ev = el('td'); const chips = el('span', 'cc-b2-ev'); m.evidence.forEach((x) => chips.append(el('span', null, x))); if (!m.evidence.length) chips.append(el('span', 'cc-b2-none', 'No evidence on record')); ev.append(chips);
      tr.append(el('td', null, String(monPage * MONDAY + i + 1)), who, el('td', null, m.title || 'No title'), el('td', null, m.li || 'Empty'), nx, ev);
      tb.append(tr);
    });
    tbl.append(tb);
    monBody.replaceChildren(tbl, el('p', 'cc-b2-insight', 'Untouched: send the connection request and set LI Connect to Requested. Connected: start a conversation; once they write back or talk with us, set Priority to 1.'));
    const prev = el('button', 'cc-go', 'Previous 10'); prev.type = 'button'; prev.disabled = monPage === 0; prev.addEventListener('click', () => { monPage -= 1; drawMonday(); });
    const next = el('button', 'cc-go', 'Next 10'); next.type = 'button'; next.disabled = monPage >= pages - 1; next.addEventListener('click', () => { monPage += 1; drawMonday(); });
    monMore.replaceChildren(prev, next, el('span', 'cc-b2-insight', `${intF(mon.length)} at Priority 3${monFilter === 'All' ? '' : ', ' + monFilter.toLowerCase()}, page ${monPage + 1} of ${pages}`));
  };

  /* Meeting frequency and relationship depth. */
  const MTG_ICON = {
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.9-4.2 4-6.5 8-6.5s7.1 2.3 8 6.5"/>',
    group: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.2 14.8c1.7.8 2.9 2.6 3.3 5.2"/>',
  };
  const mtgIcon = (name) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'cc-mt-icon');
    svg.innerHTML = MTG_ICON[name];
    return svg;
  };
  const whenF = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
  const fullDayF = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  let sparkSeq = 0;
  const spark = (pts, label) => {
    const ns = 'http://www.w3.org/2000/svg';
    const W = 160; const H = 40; const P = 3;
    const vals = pts.map((p) => p.n);
    const max = Math.max(1, ...vals.filter((v) => v != null));
    const known = pts.map((p, i) => ({ i, n: p.n })).filter((p) => p.n != null);
    const x = (i) => P + (i * (W - 2 * P)) / Math.max(1, pts.length - 1);
    const yv = (v) => H - P - (v / max) * (H - 2 * P);
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('class', 'cc-mt-spark');
    svg.setAttribute('role', 'img');
    const first = known[0]; const last = known[known.length - 1];
    svg.setAttribute('aria-label', `${label}, last ${MTG_WEEKS} weeks: ${intF(first.n)} on ${dayF(pts[first.i].day)}, ${intF(last.n)} now`);
    const line = known.map((p, j) => `${j ? 'L' : 'M'}${x(p.i).toFixed(1)} ${yv(p.n).toFixed(1)}`).join(' ');
    const area = document.createElementNS(ns, 'path');
    area.setAttribute('d', `${line} L${x(last.i).toFixed(1)} ${H} L${x(first.i).toFixed(1)} ${H} Z`); area.setAttribute('class', 'cc-mt-area');
    const gid = 'cc-mt-g' + (sparkSeq += 1);
    const defs = document.createElementNS(ns, 'defs');
    const lg = document.createElementNS(ns, 'linearGradient');
    lg.setAttribute('id', gid); lg.setAttribute('x1', '0'); lg.setAttribute('y1', '0'); lg.setAttribute('x2', '0'); lg.setAttribute('y2', '1');
    [['0', '0.42'], ['1', '0']].forEach(([o, a]) => { const st = document.createElementNS(ns, 'stop'); st.setAttribute('offset', o); st.setAttribute('class', 'cc-mt-stop'); st.style.stopOpacity = a; lg.append(st); });
    defs.append(lg);
    svg.append(defs);
    area.style.fill = `url(#${gid})`;
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', line); path.setAttribute('class', 'cc-mt-line'); path.setAttribute('vector-effect', 'non-scaling-stroke');
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', x(last.i).toFixed(1)); dot.setAttribute('cy', yv(last.n).toFixed(1)); dot.setAttribute('r', '2.6'); dot.setAttribute('class', 'cc-mt-dot');
    svg.append(area, path, dot);
    return svg;
  };

  const CAL_NAMES = { info: 'info@', mack: 'mack@', hemang: 'hemang@', shruti: 'shruti@' };
  const calsF = (c) => String(c || '').split(',').filter(Boolean).map((x) => CAL_NAMES[x] || x).join(', ');
  /* Where a person's meetings come from: Zoho, Outlook or both. */
  const srcF = (p) => {
    const src = p.sources || [];
    if (!src.length) return '—';
    const z = src.some((x) => x.zoho); const o = src.some((x) => x.outlook);
    return z && o ? 'Zoho + Outlook' : z ? 'Zoho' : 'Outlook only';
  };

  /* Who to talk to next (Priority 1). */
  let planTab = null;
  const PLAN = [
    ['ask', 'Ask for a first meeting', 'No meeting held or booked', 'warn'],
    ['booked', 'Meeting booked', 'Next meeting on a calendar or in Zoho', 'ok'],
    ['again', 'Talk to again', `Last met ${AGAIN_DAYS}+ days ago, nothing booked`, 'warn'],
    ['recent', 'Met recently', `Met within ${AGAIN_DAYS} days, nothing booked`, 'none'],
    ['log', 'Log in Zoho', 'Outlook meetings Zoho doesn’t show as Completed', 'bad'],
  ];
  const drawPlan = () => {
    const st = state(['p1_meet_plan']);
    if (st !== 'ok') { planTiles.replaceChildren(); planList.hidden = true; return; }
    const rowsP = rows('p1_meet_plan');
    const mail = mailOk() ? new Map(rows('b2b_mail_people').map((r) => [r.id, r])) : null;
    const lists = {
      ask: rowsP.filter((r) => r.group === 'ask').sort((a, b) => (b.connected ? 1 : 0) - (a.connected ? 1 : 0)
        || (mail ? (((mail.get(b.id) || {}).status === 'They wrote last') ? 1 : 0) - (((mail.get(a.id) || {}).status === 'They wrote last') ? 1 : 0) : 0)
        || String(a.name).localeCompare(String(b.name))),
      booked: rowsP.filter((r) => r.group === 'booked').sort((a, b) => String(a.next).localeCompare(String(b.next))),
      again: rowsP.filter((r) => r.group === 'again').sort((a, b) => (b.since || 0) - (a.since || 0)),
      recent: rowsP.filter((r) => r.group === 'recent').sort((a, b) => (a.since || 0) - (b.since || 0)),
      log: rowsP.filter((r) => r.to_log && r.to_log.length).sort((a, b) => b.to_log.length - a.to_log.length || String(a.name).localeCompare(String(b.name))),
    };
    const nameC = ['Name', (r) => link('Contacts', r.id, r.name)];
    const coC = ['Company', (r) => (r.account_id ? link('Accounts', r.account_id, r.account) : r.account || 'No company')];
    const ownC = ['Owner (Assigned)', (r) => r.assigned || 'Not assigned'];
    const mailC = mail ? [['Email', (r) => { const m = mail.get(r.id); if (!m) return '—'; return m.status + (m.last_in ? `; they wrote ${dayF(m.last_in)}` : '') + (m.last_out ? `; we wrote ${dayF(m.last_out)}` : ''); }]] : [];
    const COLS = {
      ask: [nameC, coC, ['LinkedIn', (r) => r.li || 'Not set'], ...mailC, ownC, ['In Zoho since', (r) => (r.created ? fullDayF(r.created) : '—')]],
      booked: [nameC, coC, ['Next meeting', (r) => whenF(r.next)], ['Meetings so far', (r) => intF(r.n)], ['Last met', (r) => (r.last ? fullDayF(r.last) : 'Not yet')], ownC],
      again: [nameC, coC, ['Last met', (r) => fullDayF(r.last)], ['Days since', (r) => intF(r.since)], ['Meetings', (r) => intF(r.n)], ...mailC, ownC],
      recent: [nameC, coC, ['Last met', (r) => fullDayF(r.last)], ['Days since', (r) => intF(r.since)], ['Meetings', (r) => intF(r.n)], ['Source', srcF], ownC],
      log: [nameC, coC, ['Meetings to log (CT)', (r) => r.to_log.map((x) => fullDayF(x.day)).join(', ')], ['Calendars', (r) => calsF([...new Set(r.to_log.flatMap((x) => x.cals.split(',')))].join(','))], ownC],
    };
    const NOTE = {
      ask: 'Priority 1 prospects with no meeting held in Zoho or on any team calendar, and nothing booked. Connected on LinkedIn first' + (mail ? ', then those who wrote to us last' : '') + '. Ask with SOP 4.',
      booked: 'A meeting is booked in Zoho or on a team calendar. Soonest first.',
      again: `Met before, last meeting ${AGAIN_DAYS} or more days ago, and nothing booked. Longest gap first: suggest a follow-up call.`,
      recent: `Met within the last ${AGAIN_DAYS} days with nothing booked yet. They move to Talk to again after ${AGAIN_DAYS} days.`,
      log: 'Meetings on the team’s Outlook calendars that Zoho doesn’t show as Completed on that day. Log each one in Zoho as a meeting linked to the contact with Meeting Status Completed (SOP 7), so the CRM and the deal SOP see it.',
    };
    const show = (k) => {
      planTab = k;
      planTiles.querySelectorAll('.cc-mp-tile').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.k === k)));
      planList.hidden = !k;
      if (!k) { planList.replaceChildren(); return; }
      const [, label] = PLAN.find((x) => x[0] === k);
      const list = lists[k];
      if (!list.length) { planList.replaceChildren(el('p', 'cc-pm-done', 'Nobody here right now.')); return; }
      const tbl = el('table', 'cc-tbl');
      const th = el('thead'); const hr = el('tr');
      COLS[k].forEach(([x]) => { const c = el('th', null, x); c.scope = 'col'; hr.append(c); });
      th.append(hr); tbl.append(th);
      const tb = el('tbody');
      list.forEach((r) => { const tr = rowOpens(el('tr'), r.id); COLS[k].forEach(([, f]) => { const v = f(r); const td = el('td'); if (v instanceof Node) td.append(v); else td.textContent = v == null || v === '' ? '—' : v; tr.append(td); }); tb.append(tr); });
      tbl.append(tb);
      planList.replaceChildren(el('p', 'cc-na-cap', `${label} (${intF(list.length)})`), el('p', 'cc-b2-insight', NOTE[k]), tbl);
      if (k === 'ask') planList.insertBefore(sopBtn(4, 'SOP 4 Ask for a first meeting'), planList.children[2]);
      if (k === 'log') planList.insertBefore(sopBtn(7, 'SOP 7 Log a meeting'), planList.children[2]);
    };
    planTiles.replaceChildren(...PLAN.map(([k, label, sub, tone]) => {
      const n = lists[k].length;
      const cls = tone === 'none' ? 'cc-pm-none' : tone === 'ok' ? (n ? 'cc-pm-ok' : 'cc-pm-none') : n ? (tone === 'bad' ? 'cc-pm-bad' : 'cc-mp-warn') : 'cc-pm-ok';
      const b = el('button', 'cc-pm-tile cc-na-tile cc-mp-tile ' + cls);
      b.type = 'button'; b.dataset.k = k; b.setAttribute('aria-controls', 'b2-mp-list');
      const txt = el('span', 'cc-na-txt');
      txt.append(el('span', 'cc-pm-label', label), el('span', 'cc-pm-sub', sub));
      b.append(el('span', 'cc-pm-num', intF(n)), txt, el('span', 'cc-na-chev'));
      b.setAttribute('aria-label', `${label}: ${intF(n)}. ${planTab === k ? 'Hide' : 'Show'} the list.`);
      b.addEventListener('click', () => show(planTab === k ? null : k));
      return b;
    }));
    show(PLAN.some(([k]) => k === planTab) ? planTab : null);
  };

  const showMtg = (title, list, note, mode) => {
    drill.querySelector('h3').textContent = title + ' (' + intF(list.length) + ')';
    const tbl = el('table', 'cc-tbl');
    const th = el('thead'); const hr = el('tr');
    (mode === 'unmarked'
      ? ['Name', 'Company', 'Owner (Assigned)', 'Meeting (CT)', 'Meeting Status', 'Completed meetings']
      : ['Name', 'Company', 'Owner (Assigned)', 'Last meeting', 'Meetings', 'Source', 'Next meeting']).forEach((x) => { const c = el('th', null, x); c.scope = 'col'; hr.append(c); });
    th.append(hr); tbl.append(th);
    const tb = el('tbody');
    list.forEach((r) => {
      const p = r.p || r;
      const tr = el('tr');
      const n = el('td'); n.append(link('Contacts', p.id, p.name)); tr.append(n);
      const a = el('td'); if (p.account_id) a.append(link('Accounts', p.account_id, p.account)); else a.textContent = 'No company'; tr.append(a);
      tr.append(el('td', null, p.assigned || 'Not assigned'));
      if (mode === 'unmarked') tr.append(el('td', null, whenF(r.u.at)), el('td', 'cc-b2-late', r.u.status), el('td', null, intF(p.n)));
      else tr.append(el('td', null, p.last ? fullDayF(p.last) : 'None'), el('td', null, intF(p.n)), el('td', null, srcF(p)), el('td', null, p.next ? whenF(p.next) : 'None booked'));
      tb.append(tr);
    });
    tbl.append(tb);
    drillBody.replaceChildren(tbl);
    if (note) drillBody.prepend(el('p', 'cc-b2-insight', note));
    if (mode === 'unmarked') drillBody.prepend(sopBtn(7, 'SOP 7 Log a meeting'));
    placeDrill();
    drill.hidden = false;
    drill.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const drawMtg = () => {
    const st = state(['mtg_people', 'mtg_depth']);
    mtgNote.classList.toggle('cc-b2-bad', st === 'error');
    if (st !== 'ok') {
      mtgGap.hidden = true;
      mtgBar.replaceChildren(...MTG_STAGES.map((s) => { const li = el('li', 'cc-mt-step cc-mt-s' + s.k); li.append(el('span', null, s.label), el('b', null, st === 'loading' ? '…' : '—')); return li; }));
      mtgGrid.replaceChildren(...MTG_STAGES.map((s) => {
        const c = el('article', 'cc-mt-kpi cc-mt-s' + s.k + ' cc-mt-wait');
        const h = el('header', 'cc-mt-head'); h.append(mtgIcon(s.icon), el('h3', null, s.label));
        c.append(h, el('p', 'cc-mt-big', st === 'loading' ? '…' : '—'), el('p', 'cc-mt-def', st === 'loading' ? 'Loading' : 'Unavailable'));
        return c;
      }));
      mtgNote.textContent = st === 'loading' ? 'Loading meetings and B2B contacts from Zoho…' : 'Zoho meetings or B2B contacts didn’t load, so the stages can’t be worked out. Reload, or check the source in the dashboard menu.';
      return;
    }
    const ppl = rows('mtg_people').filter((p) => p.priority === MTG_PRIORITY);
    const stages = rows('mtg_depth');
    if (!ppl.length) {
      mtgGap.hidden = true;
      mtgBar.replaceChildren();
      mtgGrid.replaceChildren(el('p', 'cc-b2-insight', 'No B2B prospect is at Priority 1 yet. Contacts tagged “May 2026 - 100 B2B” appear here once Zoho sets them to Priority 1.'));
      mtgNote.textContent = '';
      return;
    }
    const byStage = (k) => stages.find((s) => s.stage === k) || { total: 0, today: 0, week: 0, month: 0, spark: [] };

    const stageList = (k) => ppl.filter((p) => p.cat === k).slice().sort((a, b) => (k === 0 ? String(a.name).localeCompare(String(b.name)) : String(b.last || '').localeCompare(String(a.last || '')) || String(a.name).localeCompare(String(b.name))));
    const ownerNote = ' Owner shows Zoho’s Assigned field, since Contact Owner is the shared Transpire login.';
    mtgBar.replaceChildren(...MTG_STAGES.map((s) => {
      const li = el('li', 'cc-mt-step cc-mt-s' + s.k);
      li.append(el('span', null, s.label), el('b', null, intF(byStage(s.k).total)));
      press(li, () => showMtg(s.label, stageList(s.k), s.def + '.' + ownerNote));
      li.setAttribute('aria-label', `${s.label}: ${intF(byStage(s.k).total)} Priority 1 prospects. Open the list.`);
      return li;
    }));
    const tday = todayCT();
    const tmon = (() => { const t = new Date(tday + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); })();
    const periodStart = { Today: tday, 'This week': tmon, 'This month': tday.slice(0, 8) + '01' };

    const unmarked = ppl.flatMap((p) => p.unmarked.map((u) => ({ p, u }))).sort((a, b) => b.u.at.localeCompare(a.u.at));
    if (unmarked.length) {
      const who = new Set(unmarked.map((x) => x.p.id)).size;
      const txt = el('p');
      txt.append(el('b', null, `${intF(unmarked.length)} past meeting${unmarked.length === 1 ? '' : 's'} with ${intF(who)} Priority 1 prospect${who === 1 ? '' : 's'} ${unmarked.length === 1 ? 'isn’t' : 'aren’t'} marked Completed in Zoho and aren’t on a team Outlook calendar either`), document.createTextNode(' (Meeting Status is Scheduled or blank), so they don’t count in the stages below. Set Meeting Status to Completed for meetings that happened. Zoho has no Cancelled or No-show value, so a meeting that didn’t happen can only stay uncounted.'));
      const b = el('button', 'cc-go', 'List them'); b.type = 'button';
      b.addEventListener('click', () => showMtg('Past meetings not marked Completed', unmarked, 'Newest first. Each one stays out of the counts until Meeting Status says Completed.', 'unmarked'));
      mtgGap.replaceChildren(txt, b);
      mtgGap.hidden = false;
    } else mtgGap.hidden = true;

    const prevDay = (stages[0] || {}).prev_day;
    mtgGrid.replaceChildren(...MTG_STAGES.map((s) => {
      const r = byStage(s.k);
      const c = el('article', 'cc-mt-kpi cc-mt-s' + s.k);
      c.id = 'b2-mtg-' + s.k;
      const h = el('header', 'cc-mt-head'); h.append(mtgIcon(s.icon), el('h3', null, s.label));
      const top = el('div', 'cc-mt-top');
      top.append(el('p', 'cc-mt-big', intF(r.total)));
      const delta = el('span', 'cc-mt-delta');
      let spoken = 'no comparison';
      if (r.change == null) { delta.textContent = '—'; delta.classList.add('cc-mt-flat'); delta.title = r.prev === 0 ? `None here on ${fullDayF(prevDay)}, so there’s no percentage` : 'No history for the same day last month'; }
      else {
        const p = Math.round(r.change * 100);
        const up = p > 0; const down = p < 0;
        const tone = !up && !down ? 'flat' : s.k === 0 ? (up ? 'bad' : 'good') : s.k === 4 ? (up ? 'good' : 'bad') : 'flat';
        delta.textContent = (up ? '▲ ' : down ? '▼ ' : '') + Math.abs(p) + '%';
        delta.classList.add('cc-mt-' + tone);
        delta.title = `${intF(r.prev)} on ${fullDayF(prevDay)}` + (s.k > 0 && s.k < 4 ? '. A drop here can mean people moved up a stage.' : '');
        spoken = `${up ? 'up' : down ? 'down' : 'unchanged'} ${Math.abs(p)}% since ${dayF(prevDay)}`;
      }
      top.append(delta);
      if (prevDay && (r.change != null || r.prev === 0)) top.append(el('span', 'cc-mt-vs', 'vs ' + dayF(prevDay)));
      const dl = el('dl', 'cc-mt-periods');
      [['Today', r.today], ['This week', r.week], ['This month', r.month]].forEach(([k, v]) => {
        const d = el('div', 'cc-mt-pcell'); d.append(el('dt', null, k), el('dd', null, intF(v)));
        const from = periodStart[k];
        const go = (e) => {
          e.stopPropagation(); e.preventDefault();
          const list = ppl.filter((p) => p.entered[s.k] && p.entered[s.k] >= from && p.entered[s.k] <= tday).sort((a, b) => String(b.entered[s.k]).localeCompare(String(a.entered[s.k])) || String(a.name).localeCompare(String(b.name)));
          showMtg(`${s.label}: newly reached ${k.toLowerCase()}`, list, (s.k === 0 ? 'Added to Zoho in the period and not met yet.' : `Reached ${s.label.toLowerCase()} with a meeting held in the period.`) + ownerNote);
        };
        d.tabIndex = 0; d.setAttribute('role', 'button'); d.setAttribute('aria-label', `${s.label}, ${k.toLowerCase()}: ${intF(v)} newly reached. Open the list.`);
        d.addEventListener('click', go); d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(e); });
        dl.append(d);
      });
      c.append(h, top, el('p', 'cc-mt-def', s.def), el('p', 'cc-mt-ptitle', s.k === 0 ? 'Newly added, not met yet' : 'Newly reached this stage'), dl);
      const pts = r.spark || [];
      const real = pts.filter((x) => x.n != null);
      const sp = el('div', 'cc-mt-sparkbox');
      if (real.length >= 2 && real.some((x) => x.n > 0)) { sp.append(spark(pts, s.label)); sp.append(el('p', 'cc-mt-sparkcap', `Last ${MTG_WEEKS} weeks, end of each week`)); }
      else sp.append(el('p', 'cc-mt-nospark', real.length >= 2 ? `Nobody at this stage in the last ${MTG_WEEKS} weeks` : 'Not enough history for a trend yet'));
      c.append(sp);
      if (s.k === 0 && r.total) c.append(el('p', 'cc-mt-flag', 'Action required: no meeting yet'));
      const members = ppl.filter((p) => p.cat === s.k).slice().sort((a, b) => (s.k === 0 ? String(a.name).localeCompare(String(b.name)) : String(b.last || '').localeCompare(String(a.last || '')) || String(a.name).localeCompare(String(b.name))));
      const notes = {
        0: 'No meeting held in Zoho or on a team calendar. Ask connected prospects for a first meeting (SOP 4); past meetings not marked Completed are listed above the cards.',
        1: 'One meeting held. Follow up and book the second.',
        2: 'Two meetings held: early repeat engagement.',
        3: 'Three meetings held: a developing relationship.',
        4: 'Four or more meetings held: our deepest relationships.',
      };
      press(c, () => showMtg(s.label, members, notes[s.k] + ' Owner shows Zoho’s Assigned field, since Contact Owner is the shared Transpire login.'));
      c.setAttribute('aria-label', `${s.label}: ${intF(r.total)} prospects, ${spoken}. Today ${intF(r.today)}, this week ${intF(r.week)}, this month ${intF(r.month)} newly entered. Open the list.`);
      return c;
    }));
    const from = (stages[0] || {}).history_from;
    drawPlan();
    const calAsOf = ppl.reduce((m, p) => (p.cal_as_of && (!m || p.cal_as_of < m) ? p.cal_as_of : m), null);
    const calLine = ppl.some((p) => p.cal_checked) ? ` Outlook calendars (info@, mack@, hemang@, shruti@) checked ${calAsOf ? whenF(calAsOf) : ''}: an event counts when the prospect is a guest or the booking customer, or the subject names them, and it wasn’t cancelled.` : ' The Outlook calendar sync isn’t in this build, so only Zoho meetings count.';
    mtgNote.textContent = `Counts B2B prospects at Priority 1 today (${intF(ppl.length)}) by days with a meeting held, from Zoho (Meeting Status Completed, start time passed) or a team Outlook calendar; a day with a meeting in both counts once, and each prospect sits in one stage.${calLine} Today, This week (from Monday) and This month count prospects who newly reached a stage, in Central time; Never Met is reached when Zoho creates the contact. The change compares today’s total with ${prevDay ? fullDayF(prevDay) : 'the same day last month'}. Trends are rebuilt from meeting dates and contact creation dates${from ? ' since ' + fullDayF(from) : ''}; Zoho doesn’t keep Priority history, so past weeks show today’s Priority 1 prospects only, and anyone who has since moved to another Priority (signed partners at P99 included) isn’t in them.`;
  };

  /* B2B Partner Meetings: met partners and their Referral Partner deals. */
  const PM_OWNER_NOTE = 'CRM Owner shows Zoho’s Assigned field, since Contact Owner is the shared Transpire login.';
  const pmDealCell = (r) => {
    if (r.deals.length) {
      const box = el('span', 'cc-pm-deals');
      r.deals.forEach((d, i) => { if (i) box.append(document.createTextNode(', ')); box.append(link('Potentials', d.id, d.deal + (d.stage ? ' (' + d.stage + ')' : ''))); });
      return box;
    }
    const box = el('span', 'cc-pm-missing');
    box.append(el('b', null, 'Not created'));
    if (r.company_deals.length) {
      const why = el('small');
      why.append(document.createTextNode('A Referral Partner deal on this company isn’t linked to this contact: '));
      r.company_deals.forEach((d, i) => { if (i) why.append(document.createTextNode(', ')); why.append(link('Potentials', d.id, d.deal), document.createTextNode(d.contact ? ' (linked to ' + d.contact + ')' : ' (no contact)')); });
      box.append(why);
    }
    return box;
  };
  const pmCols = [
    ['Contact Name', (r) => link('Contacts', r.id, r.name)],
    ['Company', (r) => (r.account_id ? link('Accounts', r.account_id, r.account) : r.account || 'No company')],
    ['Meeting Date', (r) => (r.last ? fullDayF(r.last) : '—')],
    ['CRM Owner', (r) => r.assigned || 'Not assigned'],
    ['Referral Partner Deal', pmDealCell],
  ];
  const PM_PERIODS = [['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['all', 'All time']];
  let pmPeriod = 'all';
  const pmStart = (k) => {
    const t = todayCT();
    if (k === 'week') { const d = new Date(t + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); }
    if (k === 'month') return t.slice(0, 8) + '01';
    if (k === 'year') return t.slice(0, 5) + '01-01';
    return null;
  };
  /* The last five periods of a kind, oldest first: [start, end, short label]; the last one is the current period to date. */
  const pmSeries = (k) => {
    const t = todayCT();
    const iso = (d) => d.toISOString().slice(0, 10);
    const out = [];
    for (let i = 4; i >= 0; i -= 1) {
      if (k === 'week') {
        const m = new Date(new Date(pmStart('week') + 'T00:00:00Z').getTime() - i * 7 * 864e5);
        out.push([iso(m), i ? iso(new Date(m.getTime() + 6 * 864e5)) : t, i ? 'Week of ' + dayF(iso(m)) : 'This week']);
      } else if (k === 'month') {
        const [y, mo] = t.split('-').map(Number);
        const f = new Date(Date.UTC(y, mo - 1 - i, 1));
        out.push([iso(f), i ? iso(new Date(Date.UTC(y, mo - i, 0))) : t, f.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' })]);
      } else if (k === 'year') {
        const y = Number(t.slice(0, 4)) - i;
        out.push([y + '-01-01', i ? y + '-12-31' : t, String(y)]);
      }
    }
    return out;
  };
  const pmPrev = (k) => {
    const t = todayCT();
    const iso = (d) => d.toISOString().slice(0, 10);
    if (k === 'week') { const m = new Date(pmStart('week') + 'T00:00:00Z'); return [iso(new Date(m.getTime() - 7 * 864e5)), iso(new Date(m.getTime() - 864e5)), 'Last week']; }
    if (k === 'month') { const [y, mo] = t.split('-').map(Number); return [iso(new Date(Date.UTC(y, mo - 2, 1))), iso(new Date(Date.UTC(y, mo - 1, 0))), 'Last month']; }
    if (k === 'year') { const y = Number(t.slice(0, 4)) - 1; return [y + '-01-01', y + '-12-31', 'Last year']; }
    return null;
  };
  const pmSort = (list) => list.slice().sort((a, b) => String(b.last || '').localeCompare(String(a.last || '')) || String(a.name).localeCompare(String(b.name)));
  const drawPm = () => {
    const st = state(['b2b_partner_deals']);
    pmNote.classList.toggle('cc-b2-bad', st === 'error');
    if (st !== 'ok') {
      pmBody.replaceChildren(el('p', st === 'error' ? 'cc-b2-bad' : 'cc-b2-insight', st === 'error' ? 'Meetings or deals didn’t load from Zoho, so this can’t be worked out. Reload, or check the source in the dashboard menu.' : 'Loading meetings and deals from Zoho…'));
      pmNote.textContent = '';
      return;
    }
    const everyone = rows('b2b_partner_deals');
    const from = pmStart(pmPeriod);
    const periodName = (PM_PERIODS.find(([k]) => k === pmPeriod) || [])[1];
    const inPeriod = (r) => !from || (r.first && r.first >= from && r.first <= todayCT());
    pmTools.replaceChildren(...PM_PERIODS.map(([k, label]) => {
      const n = everyone.filter((r) => { const f = pmStart(k); return !f || (r.first && r.first >= f && r.first <= todayCT()); }).length;
      const b = el('button', 'cc-chip', `${label} (${intF(n)})`);
      b.type = 'button'; b.setAttribute('aria-pressed', String(pmPeriod === k));
      b.addEventListener('click', () => { pmPeriod = k; drawPm(); });
      return b;
    }));
    const all = everyone.filter(inPeriod);
    const scope = from ? ` first met ${periodName.toLowerCase()} (since ${fullDayF(from)})` : '';
    const made = all.filter((r) => r.created);
    const missing = all.filter((r) => !r.created);
    if (!everyone.length) {
      pmTools.replaceChildren();
      pmBody.replaceChildren(el('p', 'cc-b2-insight', 'No campaign contacts have been recorded as met yet. A contact counts once a meeting with them is marked Completed in Zoho.'));
      pmNote.textContent = '';
      return;
    }
    const tile = (cls, label, value, sub, go, aria) => {
      const c = el('div', 'cc-pm-tile ' + cls);
      c.append(el('p', 'cc-pm-label', label), el('p', 'cc-pm-num', intF(value)));
      if (sub) c.append(el('p', 'cc-pm-sub', sub));
      press(c, go);
      c.setAttribute('aria-label', aria);
      return c;
    };
    const met = tile('cc-pm-main', 'Partners Met', everyone.length, 'Unique contacts with a meeting held, all time',
      () => showTable('Partners met', pmCols, pmSort(everyone), 'Every May 2026 - 100 B2B contact with at least one meeting held (Zoho Completed, or on a team Outlook calendar for Priority 1 and 99), most recent meeting first. ' + PM_OWNER_NOTE),
      `Partners met, all time: ${intF(everyone.length)}. Open the list.`);
    const allMade = everyone.filter((r) => r.created).length;
    met.append(el('p', 'cc-pm-sub cc-pm-split', `${intF(allMade)} with a deal, ${intF(everyone.length - allMade)} without`));
    met.style.setProperty('--pm-share', ((everyone.length ? allMade / everyone.length : 0) * 100).toFixed(1) + '%');
    met.title = `${intF(everyone.length)} partners met, all time: ${intF(allMade)} with a Referral Partner deal (green part of the ring), ${intF(everyone.length - allMade)} without (red). Select to list them.`;
    const metWrap = el('div', 'cc-pm-left');
    metWrap.append(met);
    const ok = tile('cc-pm-ok', 'Referral Partner Deal Created', made.length, 'Met, with a Referral Partner deal linked to the contact',
      () => showTable('Referral Partner deal created' + (from ? ', ' + periodName.toLowerCase() : ''), pmCols, pmSort(made), `${from ? 'Partners' : 'Met partners'}${scope} whose Referral Partner deal names them as the contact. ` + PM_OWNER_NOTE),
      `Referral Partner deal created: ${intF(made.length)}. Open the list.`);
    const gap = tile(missing.length ? 'cc-pm-bad' : all.length ? 'cc-pm-ok' : 'cc-pm-none', 'Referral Partner Deal Not Created', missing.length, null,
      () => (missing.length
        ? showTable('Referral Partner deal not created' + (from ? ', ' + periodName.toLowerCase() : ''), pmCols, pmSort(missing), `${from ? 'Partners' : 'Met partners'}${scope} with no Referral Partner deal linked to them.` + ' Create the deal in Zoho as SOP 002 sets out (Deal Type Reseller/ Referral Partner, Stage Identify, Amount $0.00, their company as Account Name and this person as Contact Name); they drop off this list at the next refresh. ' + PM_OWNER_NOTE)
        : showTable('Referral Partner deal not created' + (from ? ', ' + periodName.toLowerCase() : ''), pmCols, [], null, from ? `All partners first met ${periodName.toLowerCase()} have Referral Partner Deals created.` : 'All met partners have Referral Partner Deals created.')),
      `Referral Partner deal not created: ${intF(missing.length)}, target 0. Open the list.`);
    const tgt = el('p', 'cc-pm-target', 'Target: 0');
    gap.insertBefore(tgt, gap.children[2] || null);
    if (!missing.length) gap.append(el('p', 'cc-pm-sub', all.length ? (from ? `All partners first met ${periodName.toLowerCase()} have Referral Partner Deals created.` : 'All met partners have Referral Partner Deals created.') : `Nobody was met for the first time ${periodName.toLowerCase()}.`));
    const pair = el('div', 'cc-pm-pair');
    pair.append(ok, gap);
    const right = el('div', 'cc-pm-right');
    const periodLine = el('p', 'cc-pm-period');
    if (from) {
      const b = el('button', 'cc-pm-prev', `${intF(all.length)} ${all.length === 1 ? 'partner' : 'partners'} first met ${periodName.toLowerCase()}`);
      b.type = 'button';
      b.addEventListener('click', () => showTable('Partners met, ' + periodName.toLowerCase(), pmCols, pmSort(all), `Partners${scope}, most recent meeting first. ` + PM_OWNER_NOTE));
      periodLine.append(b, document.createTextNode(` (since ${fullDayF(from)}). Their deals as they stand today:`));
    } else periodLine.textContent = 'Every partner met so far. Their deals as they stand today:';
    right.append(pmTools, periodLine, pair);
    pmBody.replaceChildren(metWrap, right);
    if (from) {
      const series = pmSeries(pmPeriod).map(([a, b, label], i, arr) => {
        const list = everyone.filter((r) => r.first && r.first >= a && r.first <= b);
        return { a, b, label, now: i === arr.length - 1, list, made: list.filter((r) => r.created), miss: list.filter((r) => !r.created) };
      });
      const peak = Math.max(1, ...series.map((x) => x.list.length));
      const chart = el('div', 'cc-pm-chart');
      chart.setAttribute('role', 'group');
      chart.setAttribute('aria-label', `Partners first met in each of the last five ${pmPeriod === 'week' ? 'weeks' : pmPeriod === 'month' ? 'months' : 'years'}, split by Referral Partner deal`);
      const head = el('div', 'cc-pm-chead');
      const key = el('p', 'cc-pm-key');
      key.append(el('span', 'cc-pm-k cc-pm-k-ok', 'Deal created'), el('span', 'cc-pm-k cc-pm-k-bad', 'Deal not created'));
      head.append(el('h3', null, `${periodName} against the four before it`), key);
      const cols = el('div', 'cc-pm-cols');
      series.forEach((x) => {
        const range = `${fullDayF(x.a)} – ${fullDayF(x.b)}`;
        const col = el('div', 'cc-pm-col' + (x.now ? ' cc-pm-now' : ''));
        const total = el('button', 'cc-pm-total', intF(x.list.length));
        total.type = 'button';
        total.title = `${x.label}: ${intF(x.list.length)} partners first met (${range}). Open the list.`;
        total.addEventListener('click', () => showTable(`Partners met, ${x.label.toLowerCase()}`, pmCols, pmSort(x.list), `Partners first met ${range}, most recent meeting first. ` + PM_OWNER_NOTE));
        const bar = el('div', 'cc-pm-bar');
        bar.style.height = (x.list.length / peak) * 100 + '%';
        [['miss', 'cc-pm-seg-bad', 'without a Referral Partner deal', 'not created'], ['made', 'cc-pm-seg-ok', 'with a Referral Partner deal', 'created']].forEach(([k, cls, words, short]) => {
          const n = x[k].length;
          if (!n) return;
          const seg = el('button', 'cc-pm-seg ' + cls);
          seg.type = 'button';
          seg.style.flexGrow = String(n);
          seg.title = `${x.label}: ${intF(n)} ${words}. Open the list.`;
          seg.setAttribute('aria-label', seg.title);
          if (n && x.list.length / peak > 0.25) seg.textContent = intF(n);
          seg.addEventListener('click', () => showTable(`Referral Partner deal ${short}, ${x.label.toLowerCase()}`, pmCols, pmSort(x[k]), `Partners first met ${range} ${words}. ` + PM_OWNER_NOTE));
          bar.append(seg);
        });
        const track = el('div', 'cc-pm-track');
        track.append(bar);
        const lab = el('p', 'cc-pm-clabel', x.label);
        const sub = el('small', null, x.list.length ? `${intF(x.made.length)} created, ${intF(x.miss.length)} not` : 'Nobody met');
        lab.append(sub);
        col.append(total, track, lab);
        cols.append(col);
      });
      chart.append(head, cols);
      const prevX = series[series.length - 2];
      const nowX = series[series.length - 1];
      const d = nowX.list.length - prevX.list.length;
      chart.append(el('p', 'cc-b2-insight', `${periodName}: ${intF(nowX.list.length)} first met against ${intF(prevX.list.length)} in ${prevX.label.toLowerCase().startsWith('week') ? 'the ' + prevX.label.toLowerCase() : prevX.label} (${d === 0 ? 'no change' : (d > 0 ? '+' : '−') + intF(Math.abs(d))}). ${periodName} runs to today, so it can read low until the period ends. Select a bar, a color or a total for its list.`));
      right.append(chart);
    }
    const loose = missing.filter((r) => r.company_deals.length).length;
    pmNote.textContent = `Met means at least one meeting held: marked Completed in Zoho, or (for Priority 1 and 99) a past uncancelled meeting on a team Outlook calendar${from ? `; ${periodName.toLowerCase()} counts partners whose first meeting falls in it (Central time${pmPeriod === 'week' ? ', weeks start Monday' : ''}), and their deals as they stand today` : ''}; ${intF(all.length)} = ${intF(made.length)} created + ${intF(missing.length)} not created. A deal counts only when its Deal Type is Referral Partner and its Contact Name is the person we met; a deal on the same company linked to someone else, or to no contact, doesn’t count${loose ? ` (${intF(loose)} met ${loose === 1 ? 'partner has' : 'partners have'} one; the list shows it so the link can be fixed)` : ''}.`;
  };

  /* Account gaps: Priority 1 and met partners without an Account, and Referral Partner deals on the wrong Account. */
  let naTab = null;
  const NA_FIX = {
    'Deal is on our own company': (r) => 'Change the deal’s Account Name to ' + (r.account_id ? r.account : 'the partner’s company') + '.',
    'Deal has no Account': (r) => 'Set the deal’s Account Name to ' + (r.account_id ? r.account : 'the partner’s company') + '.',
    'Contact has no Account': (r) => `Set the contact’s Account to ${r.deal.account} if that is their company; otherwise move the deal to the right Account.`,
    'Contact’s Account is our own company': (r) => `Set the contact’s Account to ${r.deal.account} if that is their company.`,
    'Deal and contact are on different Accounts': () => 'Point the contact and the deal at the same Account: the partner’s company.',
  };
  const NA_ORDER = Object.keys(NA_FIX);
  const naPriority = (r) => (r.priority ? 'P' + r.priority : 'Not set');
  const naFix = (r) => {
    const box = el('span', 'cc-na-fix');
    const before = r.next ? ` Before the meeting on ${whenF(r.next)}.` : '';
    if (r.own_account) { box.append(document.createTextNode('The Account is our own company. Set it to the partner’s company.' + before)); return box; }
    const onAcc = r.deals.filter((d) => d.account_id && !OWN_CO.test(String(d.account || '')));
    if (onAcc.length) {
      box.append(document.createTextNode('Their Referral Partner deal is on '), link('Accounts', onAcc[0].account_id, onAcc[0].account), document.createTextNode('. Set that as the contact’s Account if it is their company.' + before));
      return box;
    }
    if (r.deals.length) {
      box.append(document.createTextNode('Their Referral Partner deal is on our own company or no Account. Find or create their company’s Account, then set it on the contact and on the deal.' + before));
      return box;
    }
    if (r.loose.length) {
      const d = r.loose[0];
      box.append(document.createTextNode('A Referral Partner deal with their name has no contact: '), link('Potentials', d.id, d.deal), document.createTextNode('. Link this contact to it and set its Account on the contact.' + before));
      return box;
    }
    box.append(document.createTextNode('Find or create their company’s Account and set it on the contact.' + before));
    return box;
  };
  const naDealCell = (r) => {
    if (!r.deals.length) return 'None';
    const box = el('span', 'cc-pm-deals');
    r.deals.forEach((d, i) => { if (i) box.append(document.createTextNode(', ')); box.append(link('Potentials', d.id, d.deal + (d.stage ? ' (' + d.stage + ')' : ''))); });
    return box;
  };
  const NA_PEOPLE_COLS = [
    ['Contact Name', (r) => link('Contacts', r.id, r.name)],
    ['Priority', naPriority],
    ['Why listed', (r) => r.why.join(', ')],
    ['Last meeting', (r) => (r.last ? fullDayF(r.last) : 'None')],
    ['Next meeting', (r) => (r.next ? whenF(r.next) : 'None scheduled')],
    ['CRM Owner', (r) => r.assigned || 'Not assigned'],
    ['Referral Partner deal', naDealCell],
    ['Fix in Zoho', naFix],
  ];
  const NA_DEAL_COLS = [
    ['Contact Name', (r) => link('Contacts', r.id, r.name)],
    ['Contact’s Account', (r) => (r.account_id ? link('Accounts', r.account_id, r.account) : 'None')],
    ['Referral Partner deal', (r) => link('Potentials', r.deal.id, r.deal.deal + (r.deal.stage ? ' (' + r.deal.stage + ')' : ''))],
    ['Deal’s Account', (r) => (r.deal.account_id ? link('Accounts', r.deal.account_id, r.deal.account) : 'None')],
    ['What’s wrong', (r) => { const b = el('b', 'cc-na-problem', r.problem); return b; }],
    ['Fix in Zoho', (r) => (NA_FIX[r.problem] || (() => ''))(r)],
  ];
  const naSortPeople = (list) => list.slice().sort((a, b) =>
    (a.next ? 0 : 1) - (b.next ? 0 : 1) || String(a.next || '').localeCompare(String(b.next || ''))
    || (a.priority === '1' ? 0 : 1) - (b.priority === '1' ? 0 : 1)
    || String(b.last || '').localeCompare(String(a.last || '')) || String(a.name).localeCompare(String(b.name)));
  const drawNa = () => {
    const st = state(['b2b_account_gaps']);
    na.classList.remove('cc-na-bad', 'cc-na-good');
    naState.className = 'cc-b2-state';
    naState.textContent = '';
    naNote.classList.toggle('cc-b2-bad', st === 'error');
    if (st !== 'ok') {
      naTiles.replaceChildren();
      naList.replaceChildren(el('p', st === 'error' ? 'cc-b2-bad' : 'cc-b2-insight', st === 'error' ? 'B2B contacts, meetings or deals didn’t load from Zoho, so the Account check can’t be worked out. Reload, or check the source in the dashboard menu.' : 'Loading contacts, meetings and deals from Zoho…'));
      naNote.textContent = '';
      return;
    }
    const all = rows('b2b_account_gaps');
    const none = naSortPeople(all.filter((r) => r.kind === 'no_account'));
    const soon = none.filter((r) => r.next);
    const wrong = all.filter((r) => r.kind === 'wrong_deal').sort((a, b) => NA_ORDER.indexOf(a.problem) - NA_ORDER.indexOf(b.problem) || String(a.name).localeCompare(String(b.name)));
    const open = none.length + wrong.length;
    na.classList.add(open ? 'cc-na-bad' : 'cc-na-good');
    naState.textContent = open ? `${intF(open)} to fix` : 'All linked';
    naState.classList.add(open ? 'cc-b2-bad' : 'cc-b2-ok');
    const TABS = [
      ['none', 'No Account', none, 'Priority 1, or any meeting in Zoho, and the contact has no Account', 'Every Priority 1 and met partner has an Account.'],
      ['soon', 'Upcoming meeting, no Account', soon, 'Meeting scheduled; set the Account before it', 'Nobody with a scheduled meeting is missing an Account.'],
      ['wrong', 'Referral Partner deal on the wrong Account', wrong, 'Deal Account missing, ours, or not the contact’s', 'Every Referral Partner deal sits on its partner’s Account.'],
    ];
    const show = (k) => {
      naTab = k;
      naTiles.querySelectorAll('.cc-na-tile').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.k === k)));
      naList.hidden = !k;
      naNote.hidden = !k;
      if (!k) { naList.replaceChildren(); return; }
      const [, label, list, , ok] = TABS.find((x) => x[0] === k);
      naList.setAttribute('aria-label', label);
      if (!list.length) { naList.replaceChildren(el('p', 'cc-pm-done', ok)); return; }
      const cols = k === 'wrong' ? NA_DEAL_COLS : NA_PEOPLE_COLS;
      const tbl = el('table', 'cc-tbl cc-na-tbl');
      const th = el('thead'); const hr = el('tr');
      cols.forEach(([x]) => { const c = el('th', null, x); c.scope = 'col'; hr.append(c); });
      th.append(hr); tbl.append(th);
      const tb = el('tbody');
      list.forEach((r) => { const tr = rowOpens(el('tr'), r.id); cols.forEach(([, f]) => { const v = f(r); const td = el('td'); if (v instanceof Node) td.append(v); else td.textContent = v == null || v === '' ? '—' : v; tr.append(td); }); tb.append(tr); });
      tbl.append(tb);
      naList.replaceChildren(el('p', 'cc-na-cap', `${label} (${intF(list.length)})`), tbl);
    };
    naTiles.replaceChildren(...TABS.map(([k, label, list, sub]) => {
      const b = el('button', 'cc-pm-tile cc-na-tile ' + (list.length ? 'cc-pm-bad' : 'cc-pm-ok'));
      b.type = 'button'; b.dataset.k = k; b.setAttribute('aria-controls', 'b2-na-list');
      const txt = el('span', 'cc-na-txt');
      txt.append(el('span', 'cc-pm-label', label), el('span', 'cc-pm-sub', sub + '. Target 0.'));
      b.append(el('span', 'cc-pm-num', intF(list.length)), txt, el('span', 'cc-na-chev'));
      b.setAttribute('aria-label', `${label}: ${intF(list.length)}, target 0. ${naTab === k ? 'Hide' : 'Show'} the list.`);
      b.title = sub + '. Target 0. Select to show or hide the list.';
      b.addEventListener('click', () => show(naTab === k ? null : k));
      return b;
    }));
    show(TABS.some((x) => x[0] === naTab) ? naTab : null);
    const dnc = rows('b2b_people').filter((p) => p.dnc && (p.priority === '1' || p.met > 0) && !p.account_id).length;
    naNote.textContent = 'Counts B2B prospects (May 2026 - 100 B2B, Priority 9 and 11 left out) at Priority 1 or with any meeting in Zoho: completed, scheduled, past and not marked Completed, or counted in Total Meetings. An Account that is our own company (Tech Transpire, True Lean) counts as none. Upcoming is the part of No Account with a meeting still to come. The deal check covers every Referral Partner deal whose Contact Name is a B2B prospect, any stage.'
      + (dnc ? ` ${intF(dnc)} Do Not Contact ${dnc === 1 ? 'record is' : 'records are'} left out, since no deal will follow.` : '') + ' Fix it in Zoho and it drops off at the next refresh.';
  };

  /* Partner Funnel Overview. */
  let pfPick = null;
  const pfCols = [
    ['Name', (r) => link('Contacts', r.id, r.name)],
    ['Company', (r) => (r.account_id ? link('Accounts', r.account_id, r.account) : r.account || 'No company')],
    ['Priority', (r) => (r.priority ? 'P' + r.priority : 'Not set')],
    ['LI Connect', (r) => r.li || 'Empty'],
    ['Assigned', (r) => r.assigned || 'Not assigned'],
    ['Added to Zoho', (r) => (r.created ? fullDayF(r.created) : '—')],
  ];
  const pfOpen = (g, list, total) => {
    pfPick = g ? g.key : null;
    drawPf();
    showTable(g ? g.label : 'All campaign contacts', pfCols, list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))),
      g ? `${intF(list.length)} of ${intF(total)} contacts tagged “May 2026 - 100 B2B” (${total ? Math.round((list.length / total) * 1000) / 10 : 0}%). Select a name to open it in Zoho CRM.` : 'Every contact tagged “May 2026 - 100 B2B”, Priority 9 and 11 included. Select a name to open it in Zoho CRM.');
    drill.dataset.from = 'pf';
  };
  const pfArc = (cx, cy, r0, r1, a0, a1) => {
    const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = p(r1, a0); const [x1, y1] = p(r1, a1); const [x2, y2] = p(r0, a1); const [x3, y3] = p(r0, a0);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r1} ${r1} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}A${r0} ${r0} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`;
  };
  const drawPf = () => {
    const st = state(['b2b_priority_all']);
    pfReset.disabled = !pfPick || st !== 'ok';
    pfReset.setAttribute('aria-label', pfPick ? 'Reset view: clear the highlighted priority and show the whole funnel' : 'Reset view: nothing is highlighted');
    pfNote.classList.toggle('cc-b2-bad', st === 'error');
    if (st !== 'ok') {
      pfBody.replaceChildren(el('p', st === 'error' ? 'cc-b2-bad' : 'cc-b2-insight', st === 'error' ? 'Campaign contacts didn’t load from Zoho, so the funnel can’t be drawn. Reload, or check the source in the dashboard menu.' : 'Loading campaign contacts from Zoho…'));
      pfNote.textContent = '';
      return;
    }
    const all = rows('b2b_priority_all');
    if (!all.length) { pfBody.replaceChildren(el('p', 'cc-b2-insight', 'No contacts carry the “May 2026 - 100 B2B” tag yet.')); pfNote.textContent = ''; return; }
    const total = all.length;
    const other = [...new Set(all.filter((r) => r.group.startsWith('other:')).map((r) => r.priority))];
    const groups = [...PF_GROUPS, ...other.map((k) => ({ key: 'other:' + k, label: 'P' + k + ' · Not a defined stage', short: 'P' + k, side: 'out', tone: 'none' }))]
      .map((g) => ({ ...g, list: all.filter((r) => r.group === g.key) }))
      .filter((g) => g.list.length || ['5', '3', '1', '99', '9', '11'].includes(g.key));
    const pctF = (n) => (total ? (Math.round((n / total) * 1000) / 10).toFixed(1) : '0.0') + '%';
    const toneVar = (t) => `var(--pf-${t})`;

    /* Donut. */
    const ns = 'http://www.w3.org/2000/svg';
    const S = 240; const R1 = 116; const R0 = 76;
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${S} ${S}`); svg.setAttribute('class', 'cc-pf-donut'); svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', `${intF(total)} campaign contacts by Priority`);
    let a = 0;
    groups.filter((g) => g.list.length).forEach((g) => {
      const span = (g.list.length / total) * Math.PI * 2;
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', pfArc(S / 2, S / 2, R0, R1, a, a + span));
      path.setAttribute('class', 'cc-pf-slice' + (pfPick && pfPick !== g.key ? ' cc-pf-dim' : '') + (pfPick === g.key ? ' cc-pf-on' : ''));
      path.style.fill = toneVar(g.tone);
      path.setAttribute('tabindex', '0'); path.setAttribute('role', 'button');
      path.setAttribute('aria-label', `${g.label}: ${intF(g.list.length)}, ${pctF(g.list.length)}. Open the list.`);
      const tt = document.createElementNS(ns, 'title'); tt.textContent = `${g.label}: ${intF(g.list.length)} (${pctF(g.list.length)})`; path.append(tt);
      const go = () => pfOpen(g, g.list, total);
      path.addEventListener('click', go);
      path.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      svg.append(path);
      a += span;
    });
    const pickG = pfPick ? groups.find((g) => g.key === pfPick) : null;
    const center = el('button', 'cc-pf-center');
    center.type = 'button';
    center.append(el('span', null, pickG ? pickG.short : 'Total contacts'), el('b', null, intF(pickG ? pickG.list.length : total)), el('small', null, pickG ? `${pctF(pickG.list.length)} of campaign` : '100% of campaign'));
    center.addEventListener('click', () => (pickG ? pfOpen(pickG, pickG.list, total) : pfOpen(null, all, total)));
    const donut = el('div', 'cc-pf-left');
    const ring = el('div', 'cc-pf-ring');
    const gloss = document.createElementNS(ns, 'g');
    gloss.setAttribute('class', 'cc-pf-gloss'); gloss.setAttribute('aria-hidden', 'true');
    const gdefs = document.createElementNS(ns, 'defs');
    const rg = document.createElementNS(ns, 'linearGradient');
    rg.setAttribute('id', 'cc-pf-shine'); rg.setAttribute('x1', '0'); rg.setAttribute('y1', '0'); rg.setAttribute('x2', '0'); rg.setAttribute('y2', '1');
    [['0', '0.38'], ['0.45', '0.06'], ['1', '0']].forEach(([o, a]) => { const st = document.createElementNS(ns, 'stop'); st.setAttribute('offset', o); st.setAttribute('stop-color', '#fff'); st.setAttribute('stop-opacity', a); rg.append(st); });
    gdefs.append(rg);
    const shine = document.createElementNS(ns, 'path');
    shine.setAttribute('d', pfArc(S / 2, S / 2, R0, R1, 0, Math.PI * 2));
    shine.setAttribute('fill', 'url(#cc-pf-shine)');
    const inner = document.createElementNS(ns, 'circle');
    inner.setAttribute('cx', S / 2); inner.setAttribute('cy', S / 2); inner.setAttribute('r', R0 + 0.5); inner.setAttribute('class', 'cc-pf-inner');
    gloss.append(gdefs, shine, inner);
    svg.append(gloss);
    ring.append(svg, center);
    donut.append(ring, el('p', 'cc-pf-hint', pfPick ? 'Reset view, or select the same priority again, to show everyone.' : 'Select a slice or a priority to highlight it and list the contacts.'));

    /* Rows. */
    const rowsFor = (side, title, sub) => {
      const box = el('div', 'cc-pf-col');
      const h = el('div', 'cc-pf-colhead'); h.append(el('h3', null, title)); if (sub) h.append(el('span', null, sub));
      box.append(h);
      groups.filter((g) => g.side === side).forEach((g) => {
        const r = el('div', 'cc-pf-row' + (pfPick === g.key ? ' cc-pf-on' : '') + (pfPick && pfPick !== g.key ? ' cc-pf-dim' : ''));
        r.style.setProperty('--pf-c', toneVar(g.tone));
        const top = el('div', 'cc-pf-rtop');
        top.append(el('i', 'cc-pf-sw'), el('span', 'cc-pf-name', g.label), el('b', null, intF(g.list.length)), el('small', null, pctF(g.list.length)), el('span', 'cc-pf-chev', '›'));
        const bar = el('div', 'cc-pf-bar'); const fill = el('i'); fill.style.width = (total ? (g.list.length / total) * 100 : 0) + '%'; bar.append(fill);
        r.append(top, bar);
        press(r, () => (pfPick === g.key ? (pfPick = null, drawPf(), drill.dataset.from === 'pf' && (drill.hidden = true)) : pfOpen(g, g.list, total)));
        r.setAttribute('aria-label', `${g.label}: ${intF(g.list.length)} contacts, ${pctF(g.list.length)}. Open the list.`);
        r.setAttribute('aria-pressed', String(pfPick === g.key));
        box.append(r);
      });
      return box;
    };
    pfBody.replaceChildren(donut, rowsFor('funnel', 'Partner Funnel', 'Light to dark green'), rowsFor('out', 'Inactive & Restricted', null));
    const p99 = groups.find((g) => g.key === '99');
    pfNote.textContent = `${intF(total)} contacts carry the “May 2026 - 100 B2B” tag. Each sits in exactly one group by its current Zoho Priority, so the groups add up to the total.${p99 && !p99.list.length ? ' No contact is at Priority 99 yet: set it on signed partners in Zoho and they move here at the next refresh.' : ''} Other campaign figures on this tab leave Priority 9 and 11 out.`;
  };

  dash.onData(draw);
})();
