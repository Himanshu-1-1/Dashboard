/* Founder Network: relationship intelligence and actions for the private Claude Dashboard. One founder per Zoho Founder
   Network contact (plus everyone the team named in Telegram who isn't one), joined to Zoho meetings, tasks, deals and
   Zoho Sign, the reviewed Telegram reconstruction (messages and photos), Fireflies calls, the team's Outlook (dates and
   counts only, checked by hand) and Mack's LinkedIn export. The rules live in fn-engine.js (window.FN_ENGINE), which
   must load first. Read-only: nothing here writes to Zoho or sends anything; every fix names the change and opens the
   record in Zoho. Private dashboard only: never on the public site. */
(() => {
  const E = window.FN_ENGINE;
  const sec = document.getElementById('fn');
  if (!E || !sec || typeof dash === 'undefined') return;

  const ZOHO = 'https://crm.zoho.com/crm/org899412015/tab/';
  const PAGE = 25;
  const CONTACT_IDS = ['qa_contacts', 'qa_contacts_2', 'qa_contacts_3', 'qa_contacts_4'];
  const LIVE = ['fn_events', 'fn_tasks', 'deals', 'sign_docs'];
  const FILES = ['fn_reach', 'fn_tg_people', 'fn_tg_photos', 'fn_tg_log', 'fn_ff_meetings', 'fn_ff_links', 'fn_outlook', 'mack_network', 'fn_sources'];

  /* ---------- loaders for the two Founder Network queries (same shape as the page's other Zoho queries) ---------- */
  const coql = ({ answer }) => {
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
  const LOADER = 'Zoho’s COQL answer as rows: a lookup becomes its name (and _id), a multi-select becomes text.';
  dash.loader('fn_events', { description: LOADER, fn: coql });
  dash.loader('fn_tasks', { description: LOADER, fn: coql });

  /* ---------- turning datasets into the engine's inputs ---------- */
  const parse = (v, d) => { if (v == null || v === '') return d; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return d; } };
  const accName = (v) => (v && typeof v === 'object' ? v.name : v) || '';
  const dedupe = (lists) => { const m = new Map(); for (const l of lists) for (const r of l || []) if (r && r.id && !m.has(String(r.id))) m.set(String(r.id), Object.assign({}, r, { Account_Name: accName(r.Account_Name) })); return [...m.values()]; };
  const isFN = (v) => String(v || '').split(',').map((x) => x.trim()).includes('Founder Network');
  /* agreements: the page's own calc when it has run, else worked out the same way from sign_docs */
  const agreementsFrom = (sign) => {
    const g = new Map();
    for (const d of sign || []) {
      const st = String(d.zohosign__Document_Status || '');
      if (/recalled|draft/i.test(st) || /tech transpire|true lean solutions/i.test(d.zohosign__Account || '')) continue;
      const party = d.zohosign__Contact_id || d.zohosign__Account_id; if (!party) continue;
      const kind = /referral partner agreement/i.test(d.Name || '') ? 'Referral agreement' : 'MNDA';
      const k = kind + '|' + party; if (!g.has(k)) g.set(k, []); g.get(k).push(d);
    }
    return [...g.entries()].map(([k, l]) => {
      l.sort((a, b) => String(b.zohosign__Date_Sent || '').localeCompare(String(a.zohosign__Date_Sent || '')));
      const signed = l.find((d) => /signed|completed/i.test(d.zohosign__Document_Status || '')); const doc = signed || l[0];
      const st = String(doc.zohosign__Document_Status || '');
      return { kind: k.split('|')[0], contact_id: doc.zohosign__Contact_id || null, state: signed ? 'Signed' : /out for signature|in ?progress/i.test(st) ? 'Out for signature' : /expired|declined/i.test(st) ? 'Expired, not re-sent' : st, sent: doc.zohosign__Date_Sent || null, completed: doc.zohosign__Date_Completed || null, id: doc.id };
    });
  };
  const buildSrc = (d, now) => {
    const contacts = dedupe(CONTACT_IDS.map((id) => d[id]));
    return {
      now,
      contacts,
      fn: contacts.filter((z) => isFN(z.Relationship_Type)),
      events: d.fn_events || [],
      tasks: d.fn_tasks || [],
      deals: d.deals || [],
      agreements: agreementsFrom(d.sign_docs),
      linkedin: (d.mack_network || []).map((c) => ({ first: c.first, last: c.last, url: c.url, position: c.position, company: c.company, connected: c.connected, ties: parse(c.ties, []) })),
      tgPeople: (d.fn_tg_people || []).map((t) => Object.assign({}, t, { relationship: parse(t.relationship, []), actions: parse(t.actions, []), mentions: parse(t.mentions, []), needs_name: t.needs_name === true || t.needs_name === 'true' })),
      ffMeetings: d.fn_ff_meetings || [],
      ffLinks: d.fn_ff_links || [],
      outlook: (d.fn_outlook || []).map((o) => Object.assign({}, o, { email_count: Number(o.email_count) || 0, meeting_count: Number(o.meeting_count) || 0, two_way: o.two_way === true || o.two_way === 'true' })),
      missing: { fn: CONTACT_IDS.some((id) => !d[id]), contacts: CONTACT_IDS.some((id) => !d[id]), events: !d.fn_events, deals: !d.deals, agreements: !d.sign_docs },
    };
  };
  const flatFounder = (f) => ({ id: f.id, zoho_id: f.zoho ? String(f.zoho.id) : null, name: f.name, company: f.company, in_fn: f.inFN, band: f.priorityInfo.band, score: f.priorityInfo.score,
    stage: f.stage, verification: f.verification, priority: f.priority, chat_priority: f.telegramPriority, last_interaction: f.lastInteraction, next_meeting: f.upcoming,
    open_actions: f.actions.filter((a) => a.status !== 'Done').length, issues: f.issues.length, next: f.next });
  const flatAction = (a) => ({ key: a.key, founder: a.founder, name: a.name, category: a.category, kind: a.kind, text: a.text, owner: a.owner, due: a.due, status: a.status, status_label: a.statusLabel, next: a.next });

  /* The calcs readers can open in Sources. Every input is listed, so a source that fails shows there. */
  const INPUTS = [...CONTACT_IDS, 'fn_events', 'fn_tasks', 'deals', 'sign_docs', 'mack_network', 'fn_tg_people', 'fn_ff_meetings', 'fn_ff_links', 'fn_outlook'];
  const calcModel = (args) => { const d = {}; INPUTS.forEach((id, i) => { d[id] = args[i]; }); return E.run(buildSrc(d, new Date())); };
  dash.calc('fn_founders', {
    title: 'Founder Network founders', description: 'One row per founder: priority band and score, pipeline stage, identity check, last interaction, next meeting and next action, from Zoho, Telegram, Fireflies, Outlook and LinkedIn by the rules in fn-engine.js.',
    inputs: INPUTS, fn: (...sources) => calcModel(sources).founders.filter((f) => E.isShown(f)).map(flatFounder),
  });
  dash.calc('fn_actions', {
    title: 'Founder Network actions', description: 'Zoho tasks, meetings to prepare or record, Telegram asks and Fireflies action items to review, and rule-based follow-ups and reconnects, each with its evidence.',
    inputs: INPUTS, fn: (...sources) => { const seen = new Set(); return calcModel(sources).founders.filter((f) => E.isShown(f)).flatMap((f) => f.actions).filter((a) => !seen.has(a.key) && seen.add(a.key)).map(flatAction); },
  });
  dash.calc('fn_targets', {
    title: 'Founder Network targets', description: 'Each scorecard target against the pace expected by today over Aug 17 to Dec 18, 2026, with its status.',
    inputs: INPUTS, fn: (...sources) => { const src = {}; INPUTS.forEach((id, i) => { src[id] = sources[i]; }); const s = buildSrc(src, new Date()); return E.targets(E.run(s), s).map((t) => ({ id: t.id, label: t.label, actual: t.actual, target: t.target, expected: t.expected ?? null, status: t.status })); },
  });

  /* ---------- helpers ---------- */
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (cls, text, fn, title) => { const b = el('button', cls, text); b.type = 'button'; if (title) b.title = title; if (fn) b.addEventListener('click', fn); return b; };
  const link = (href, text, title) => { const a = el('a', 'cc-fx-link', text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; if (title) a.title = title; return a; };
  const intF = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
  const dayF = (s) => { if (!s) return '—'; const d = new Date(String(s).slice(0, 10) + 'T00:00:00Z'); return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }); };
  const ago = (d, today) => { if (!d) return 'never'; const n = E.daysBetween(d, today); return n === 0 ? 'today' : n === 1 ? 'yesterday' : n > 0 ? `${n} days ago` : `in ${-n} days`; };
  const toneOf = (label) => E.TONE[label] || ({ Urgent: 'bad', 'High priority': 'warn', Normal: 'ok', Nurture: 'muted', 'Needs review': 'muted', Overdue: 'bad', 'Due soon': 'warn', Done: 'ok' }[label] || 'muted');
  const pill = (label, tone) => el('span', 'cc-fx-pill cc-fx-' + (tone || toneOf(label)), label);
  const zohoHref = (ref) => (/^https?:/.test(ref || '') ? ref : ZOHO + ref);
  const contactHref = (f) => (f.zoho ? ZOHO + 'Contacts/' + f.zoho.id : null);
  const SRC_SHORT = { 'Zoho CRM': 'Zoho', 'Zoho Sign': 'Sign', Telegram: 'Telegram', Fireflies: 'Fireflies', 'Outlook mail': 'Outlook', 'Outlook calendar': 'Outlook', LinkedIn: 'LinkedIn', Rule: 'Rule', 'Data quality': 'Data' };
  const srcChip = (s) => el('span', 'cc-fx-src cc-fx-src-' + String(SRC_SHORT[s] || s).toLowerCase().replace(/[^a-z]/g, ''), SRC_SHORT[s] || s);
  const tableWrap = (heads, cls) => {
    const wrap = el('div', 'cc-fx-tablewrap'); const t = el('table', 'cc-fx-tbl ' + (cls || ''));
    const tr = el('tr'); heads.forEach((h) => { const th = el('th', null, h); th.scope = 'col'; tr.append(th); });
    const thead = el('thead'); thead.append(tr); const tbody = el('tbody'); t.append(thead, tbody); wrap.append(t);
    return { wrap, t, tbody };
  };
  const pager = (total, page, go) => {
    const p = el('div', 'cc-fx-pager');
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const prev = btn('cc-chip', 'Previous', () => go(page - 1)); prev.disabled = page <= 0;
    const next = btn('cc-chip', 'Next', () => go(page + 1)); next.disabled = page >= pages - 1;
    p.append(prev, el('span', null, total ? `${page * PAGE + 1}–${Math.min(total, (page + 1) * PAGE)} of ${intF(total)}` : 'Nothing to show'), next);
    return p;
  };
  /* card heading with an optional short note on the right */
  const cardHead = (title, meta, id) => { const h = el('div', 'cc-fx-cardhead'); const t = el('h3', null, title); if (id) t.id = id; h.append(t); if (meta) h.append(el('span', 'cc-fx-meta', meta)); return h; };
  const chip = (label, on, fn, title) => { const b = btn('cc-chip', label, fn, title); b.setAttribute('aria-pressed', String(Boolean(on))); return b; };
  const select = (label, options, value, fn) => {
    const w = el('label', 'cc-fx-field'); w.append(el('span', null, label));
    const s = el('select', 'cc-fx-select');
    for (const [v, t] of options) { const o = el('option', null, t); o.value = v; if (v === value) o.selected = true; s.append(o); }
    s.addEventListener('change', () => fn(s.value)); w.append(s); return w;
  };
  const search = (value, placeholder, fn) => {
    const s = el('input', 'cc-fx-search'); s.type = 'search'; s.placeholder = placeholder; s.value = value || ''; s.setAttribute('aria-label', placeholder);
    let timer; s.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => fn(s.value), 180); }); return s;
  };
  const has = (q, ...parts) => !q || parts.join(' ').toLowerCase().includes(q.trim().toLowerCase());
  const csv = (rows, cols, name) => {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const text = [cols.map((c) => c[1]).join(','), ...rows.map((r) => cols.map((c) => esc(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  /* ---------- frame ---------- */
  sec.classList.add('cc-fx-on');
  const root = el('div', 'cc-fx-root'); root.id = 'fnx-root';
  sec.prepend(root);
  const head = el('header', 'cc-fx-head');
  const h2 = el('h2', null, 'Founder Network'); h2.id = 'fnx-title';
  const lede = el('p', 'cc-fx-lede');
  const nav = el('div', 'cc-fx-nav'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Founder Network views');
  head.append(h2, lede, nav);
  const body = el('div', 'cc-fx-body');
  const foot = el('p', 'cc-fx-foot');
  root.append(head, body, foot);
  const drawer = el('dialog', 'cc-fx-drawer'); drawer.setAttribute('aria-labelledby', 'fnx-drawer-title');
  document.body.append(drawer);
  drawer.addEventListener('click', (e) => { if (e.target === drawer) drawer.close(); });

  const VIEWS = [
    ['overview', 'Overview'], ['actions', 'Action Center'], ['founders', 'Founders'], ['pipeline', 'Pipeline'],
    ['timeline', 'Activity'], ['quality', 'Data quality'], ['sources', 'Sources'], ['rules', 'Targets and rules'],
  ];
  const st = {
    view: 'overview',
    actions: { status: null, urgent: false, category: '', owner: '', kind: '', q: '', done: false, sort: 'urgency', page: 0 },
    founders: { band: null, stage: '', ver: '', source: '', soon: false, q: '', sort: 'score', page: 0 },
    timeline: { source: '', q: '', page: 0 },
    quality: { type: '', sev: '', page: 0 },
    outreach: { at: 0 },
    overview: { target: null },
  };
  const go = (view, patch) => {
    st.view = view;
    if (patch) Object.assign(st[view], { page: 0 }, patch);
    render();
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ---------- the model, recomputed only when a dataset changes ---------- */
  let memo = { key: null, model: null };
  const statusOf = (id) => (dash.data(id) || {}).status || 'missing';
  const rowsOf = (id) => { const x = dash.data(id); return x && x.status === 'ok' ? x.data || [] : null; };
  const getModel = () => {
    const d = {}; const keyParts = [E.ctDay(new Date())];
    for (const id of [...CONTACT_IDS, ...LIVE, ...FILES]) { const r = rowsOf(id); d[id] = r; keyParts.push(r); }
    if (memo.model && memo.key.length === keyParts.length && memo.key.every((x, i) => x === keyParts[i])) return memo.model;
    const ready = d.qa_contacts && d.fn_events && d.fn_tasks;
    if (!ready) return null;
    const src = buildSrc(d, new Date());
    const model = E.run(src);
    model.src = src;
    model.targets = E.targets(model, src);
    /* Priority 9, 11 and 99 stay out of every view; the scorecard above was counted first, so signed P99 partners still count there */
    model.all = model.founders;
    model.byId = new Map(model.all.map((f) => [f.id, f]));
    model.founders = model.all.filter((f) => E.isShown(f));
    /* a recorded call shared by two founders lists each action item once */
    const seenKeys = new Set();
    model.actions = model.founders.flatMap((f) => f.actions.map((a) => Object.assign(a, { f }))).filter((a) => !seenKeys.has(a.key) && seenKeys.add(a.key));
    model.issues = model.founders.flatMap((f) => f.issues.map((i) => Object.assign({}, i, { f })));
    model.timeline = model.founders.flatMap((f) => f.activities.filter((a) => a.day).map((a) => Object.assign({}, a, { f }))).sort((a, b) => String(b.day).localeCompare(String(a.day)));
    model.outreach = E.outreach(model, E.DEFAULTS, rowsOf('fn_reach') || []);
    memo = { key: keyParts, model };
    return model;
  };
  const fnMembers = (m) => m.founders.filter((f) => f.inFN);

  /* ---------- Overview ---------- */
  const targetCard = (t, today) => {
    const c = el('article', 'cc-fx-target cc-fx-t-' + toneOf(t.status));
    /* the whole card opens the records behind its number */
    const open = st.overview.target === t.id;
    c.dataset.tid = t.id; c.tabIndex = 0; c.setAttribute('role', 'button'); c.setAttribute('aria-pressed', String(open)); c.setAttribute('aria-controls', 'fnx-target-list');
    c.setAttribute('aria-label', `${t.label}: ${intF(t.actual)} of ${intF(t.target)}, ${t.status}. ${open ? 'Hide' : 'Show'} the records`);
    const toggle = () => { st.overview.target = open ? null : t.id; render(); const again = root.querySelector(`.cc-fx-target[data-tid="${t.id}"]`); if (again) again.focus({ preventScroll: true }); const l = document.getElementById('fnx-target-list'); if (l && !open) l.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
    c.addEventListener('click', (e) => { if (!e.target.closest('a')) toggle(); });
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    c.dataset.source = 'fn_targets'; c.dataset.where = 'id=' + t.id;
    const top = el('div', 'cc-fx-ttop'); top.append(el('span', 'cc-fx-tlab', t.label), pill(t.status));
    const num = el('div', 'cc-fx-tnum');
    const b = el('b', null, intF(t.actual)); b.dataset.source = 'fn_targets'; b.dataset.field = 'actual'; b.dataset.where = 'id=' + t.id;
    num.append(b, el('span', null, ` of ${intF(t.target)}`));
    const bar = el('div', 'cc-fx-tbar'); bar.setAttribute('role', 'img');
    const fill = el('i'); fill.style.width = `${Math.min(100, ((t.actual || 0) / t.target) * 100)}%`;
    const tick = el('s'); tick.style.left = `${Math.min(100, ((t.expected || 0) / t.target) * 100)}%`; tick.title = `Expected by today: ${intF(t.expected)}`;
    bar.append(fill, tick); bar.setAttribute('aria-label', `${intF(t.actual)} of ${intF(t.target)}; ${intF(t.expected)} expected by today`);
    c.append(top, num, bar, el('p', 'cc-fx-treason', t.reason), el('span', 'cc-fx-topen', open ? 'Hide the list' : `View ${intF(t.actual)} ${t.actual === 1 ? 'record' : 'records'}`));
    return c;
  };
  /* The list behind one target: same rows the count came from. */
  const targetList = (t) => {
    const box = el('div', 'cc-fx-tlist'); box.id = 'fnx-target-list';
    const hd = el('div', 'cc-fx-cardhead');
    hd.append(el('h3', null, `${t.label}: ${intF(t.rows.length)}`), btn('cc-chip', 'Close', () => { st.overview.target = null; render(); const again = root.querySelector(`.cc-fx-target[data-tid="${t.id}"]`); if (again) again.focus({ preventScroll: true }); }));
    box.append(hd);
    const nameCell = (f) => { const td = el('td'); td.append(btn('cc-fx-name', f.name, () => openProfile(f.id))); if (f.company) td.append(el('small', null, f.company)); return td; };
    const zLink = (ref, text) => { const td = el('td'); if (ref) td.append(link(zohoHref(ref), text)); return td; };
    let t2;
    if (t.id === 'members') {
      t2 = tableWrap(['Founder', 'Priority', 'Stage', 'Added to Zoho', '']);
      t.rows.forEach(({ f }) => { const tr = el('tr'); tr.append(nameCell(f), el('td', null, f.priority ? 'P' + f.priority : '—'), el('td', null, f.stage), el('td', null, dayF(f.zoho && f.zoho.Created_Time)), zLink(f.zoho ? 'Contacts/' + f.zoho.id : null, 'Open in Zoho')); t2.tbody.append(tr); });
    } else if (t.id === 'meetings') {
      t2 = tableWrap(['Date', 'Founder', 'Recorded in', '']);
      t.rows.forEach((r) => { const tr = el('tr'); const srcs = el('td', 'cc-fx-srcs'); r.sources.forEach((x) => srcs.append(srcChip(x))); tr.append(el('td', null, dayF(r.day)), nameCell(r.f), srcs, zLink(r.ref, /fireflies/.test(r.ref || '') ? 'Open call' : 'Open in Zoho')); t2.tbody.append(tr); });
    } else if (t.id === 'agreements_sent' || t.id === 'agreements_signed') {
      t2 = tableWrap(['Founder', 'State', 'Sent', 'Signed', '']);
      t.rows.forEach(({ f, a }) => { const tr = el('tr'); const stt = el('td'); stt.append(pill(a.state, a.state === 'Signed' ? 'ok' : /expired/i.test(a.state) ? 'bad' : 'warn')); tr.append(nameCell(f), stt, el('td', null, dayF(a.sent)), el('td', null, a.state === 'Signed' ? dayF(a.completed) : '—'), zLink(a.id ? 'CustomModule1/' + a.id : (f.zoho ? 'Contacts/' + f.zoho.id : null), 'Open in Zoho')); t2.tbody.append(tr); });
    } else {
      t2 = tableWrap(['Deal', 'Founder', 'Stage', 'Type', 'Created', '']);
      t.rows.forEach(({ f, d }) => { const tr = el('tr'); tr.append(el('td', null, d.Deal_Name || '—'), nameCell(f), el('td', null, d.Stage || '—'), el('td', null, d.Deal_Type || '—'), el('td', null, dayF(d.Created_Time)), zLink('Potentials/' + d.id, 'Open in Zoho')); t2.tbody.append(tr); });
    }
    if (!t.rows.length) { const tr = el('tr'); const td = el('td', 'cc-fx-empty', t.actual == null ? 'This source didn’t load, so there’s nothing to list.' : 'Nothing yet.'); td.colSpan = 6; tr.append(td); t2.tbody.append(tr); }
    box.append(t2.wrap);
    return box;
  };
  /* Start a conversation: two founders we haven't built a relationship with, each with a draft for Mack to send. */
  const copyBtn = (text, label) => {
    const b = btn('cc-fx-copy', label);
    b.addEventListener('click', async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { ok = false; }
      b.textContent = ok ? 'Copied' : 'Select the text and copy it';
      setTimeout(() => { b.textContent = label; }, 1800);
    });
    return b;
  };
  const drawOutreach = (m) => {
    const list = m.outreach;
    const sec2 = el('section', 'cc-fx-card cc-fx-reach');
    sec2.setAttribute('aria-labelledby', 'fnx-reach-title');
    const head2 = el('div', 'cc-fx-reachhead');
    const h = el('h3', null, 'Start a conversation'); h.id = 'fnx-reach-title';
    const count = el('span', 'cc-fx-reachcount', `${intF(list.length)} not met yet`);
    head2.append(h, count);
    sec2.append(head2);
    if (!list.length) { sec2.append(el('p', 'cc-fx-empty', 'Everyone in the Founder Network has a meeting, a deal or an open task. Nobody to start with.')); return sec2; }
    const at = st.outreach.at % list.length;
    const pick = [list[at], list.length > 1 ? list[(at + 1) % list.length] : null].filter(Boolean);
    const grid = el('div', 'cc-fx-reachgrid');
    for (const c of pick) {
      const f = c.f; const d = c.draft;
      const card = el('article', 'cc-fx-reachcard');
      const top = el('div', 'cc-fx-reachtop');
      const who = el('div');
      who.append(btn('cc-fx-name cc-fx-reachname', f.name, () => openProfile(f.id)), el('p', 'cc-fx-sub', [f.title, f.company].filter(Boolean).join(', ') || 'No role or company on record'));
      const talkedBefore = (c.reviewed && c.reasons[0] && /agreed|talked|introduc|asked|started|outreach|messag/i.test(c.reasons[0].why)) || (f.outlook && f.outlook.identity === 'same person' && f.outlook.email_count > 0);
      top.append(who, pill(talkedBefore ? 'Messaged, never met' : 'Not talked to yet', 'bad'));
      const top3 = c.reasons.filter((r) => r.points === 0).concat(c.reasons.filter((r) => r.points > 0).sort((a, b) => b.points - a.points)).slice(0, 3).map((r) => r.why);
      const why = el('p', 'cc-fx-why', top3.join('; '));
      const histBox = el('details', 'cc-fx-hist');
      const hist = el('ul', 'cc-fx-reachhist'); c.history.forEach((x) => hist.append(el('li', null, x)));
      histBox.append(el('summary', null, 'What’s on record'), hist);
      const dh = el('div', 'cc-fx-drafthead'); const ch = el('b', null, d.channel); ch.title = d.basis; dh.append(ch);
      const box = el('div', 'cc-fx-draft');
      if (d.subject) box.append(el('p', 'cc-fx-subject', 'Subject: ' + d.subject));
      box.append(el('pre', null, d.body));
      const acts = el('div', 'cc-fx-reachacts');
      acts.append(copyBtn((d.subject ? 'Subject: ' + d.subject + '\n\n' : '') + d.body, 'Copy the draft'));
      const slug = E.slugOf(f.linkedin);
      if (slug && d.channel !== 'Email') acts.append(link('https://www.linkedin.com/in/' + encodeURIComponent(slug) + '/', 'Open LinkedIn'));
      if (f.zoho) acts.append(link(contactHref(f), 'Open in Zoho'));
      if (d.reviewed) dh.append(el('small', 'cc-fx-checked', 'Checked by hand'));
      card.append(top, why, histBox, dh, box, acts);
      grid.append(card);
    }
    const nav2 = el('div', 'cc-fx-reachnav');
    if (list.length > 2) nav2.append(btn('cc-chip', 'Show two others', () => { st.outreach.at = (at + 2) % list.length; render(); }), el('small', null, `${at + 1}–${Math.min(list.length, at + 2)} of ${intF(list.length)}`));
    sec2.append(grid, nav2);
    if (list.leftOut && list.leftOut.length) {
      const det = el('details', 'cc-fx-leftout');
      det.append(el('summary', null, `${intF(list.leftOut.length)} left out: already talking, or not prospects`));
      const ul = el('ul', 'cc-fx-rules');
      list.leftOut.slice().sort((a, b) => String(a.f.name).localeCompare(String(b.f.name))).forEach((x) => { const li = el('li'); li.append(btn('cc-fx-name', x.f.name, () => openProfile(x.f.id)), document.createTextNode(': ' + x.why)); ul.append(li); });
      det.append(ul);
      sec2.append(det);
    }
    return sec2;
  };
  const drawOverview = (m) => {
    const wrap = el('div', 'cc-fx-ov');
    const today = m.today;
    const members = fnMembers(m);
    const open = m.actions.filter((a) => a.status !== 'Done');
    const overdue = open.filter((a) => a.kind === 'commitment' && a.status === 'Overdue');
    const soon = m.founders.filter((f) => f.upcoming && E.daysBetween(today, f.upcoming) <= 7);
    const review = open.filter((a) => a.kind === 'proposal').length;
    const fixes = m.issues.filter((i) => i.severity === 'high');
    const urgentActs = open.filter(E.isUrgentAction);

    const tiles = el('div', 'cc-fx-tiles');
    /* Each tile keeps its tone from the existing rules (anything open is red or amber, nothing open is clear); the kind
       only picks the color family, and the flag says the status in words so it never rests on color alone. */
    const tile = (tone, kind, label, n, hint, flag, fn) => {
      const b = btn(`cc-fx-tile cc-fx-tile-${kind} cc-fx-${tone}`, null, fn);
      const top = el('span', 'cc-fx-tiletop'); top.append(el('span', 'cc-fx-tilelab', label), el('span', 'cc-fx-tileflag', flag));
      b.append(top, el('b', null, intF(n)), el('small', null, hint));
      b.setAttribute('aria-label', `${label}: ${intF(n)}. ${flag}. ${hint}`);
      return b;
    };
    const outlookIn = statusOf('fn_outlook') === 'ok';
    tiles.append(
      tile(urgentActs.length ? 'bad' : 'ok', 'urgent', 'Urgent actions', urgentActs.length, 'overdue up to 45 days, or meeting prep within 2 days', urgentActs.length ? 'Critical' : 'Clear', () => go('actions', { urgent: true, status: null, done: false })),
      tile(overdue.length ? 'bad' : 'ok', 'overdue', 'Overdue commitments', overdue.length, 'Zoho tasks and meetings', overdue.length ? 'Overdue' : 'Clear', () => go('actions', { status: 'Overdue', done: false })),
      tile(outlookIn ? 'info' : 'muted', 'meet', 'Meeting in the next 7 days', soon.length, outlookIn ? 'founders, Zoho and calendars' : 'Zoho only; calendars not loaded', outlookIn ? 'Schedule' : 'Partial', () => go('founders', { soon: true, band: null, stage: '', sort: 'meeting' })),
      tile(review ? 'warn' : (statusOf('fn_tg_people') === 'ok' ? 'ok' : 'muted'), 'review', 'Waiting for review', review, 'asks from Telegram and calls', review ? 'Pending' : (statusOf('fn_tg_people') === 'ok' ? 'Clear' : 'Partial'), () => go('actions', { status: 'Needs review', done: false })),
      tile(fixes.length ? 'warn' : 'ok', 'fix', 'Zoho fixes', fixes.length, 'missing or not marked in Zoho', fixes.length ? 'Data to fix' : 'Clear', () => go('quality', { type: '', sev: 'high' })),
    );

    const tgrid = el('section', 'cc-fx-card');
    tgrid.append(cardHead('Scorecard targets', `Pace to ${dayF(E.DEFAULTS.campaign.end)}`));
    const tg = el('div', 'cc-fx-targets'); m.targets.forEach((t) => tg.append(targetCard(t, today))); tgrid.append(tg);
    const picked = m.targets.find((t) => t.id === st.overview.target);
    if (picked) tgrid.append(targetList(picked));

    const focus = el('section', 'cc-fx-card');
    focus.append(cardHead('Who needs attention first'));
    const ranked = m.founders.filter((f) => ['Urgent', 'High priority'].includes(f.priorityInfo.band)).sort((a, b) => (a.priorityInfo.band === 'Urgent' ? -1 : 0) - (b.priorityInfo.band === 'Urgent' ? -1 : 0) || b.priorityInfo.score - a.priorityInfo.score).slice(0, 10);
    const ul = el('ol', 'cc-fx-focus');
    for (const f of ranked) {
      const li = el('li');
      const name = btn('cc-fx-name', f.name, () => openProfile(f.id));
      const why = f.priorityInfo.urgentBecause || f.priorityInfo.reasons.slice().sort((a, b) => b.points - a.points).slice(0, 2).map((r) => r.why).join('; ');
      li.append(pill(f.priorityInfo.band), name, el('span', 'cc-fx-co', f.company ? ' · ' + f.company : ''), el('p', null, why));
      if (f.next && f.next !== why) li.append(el('p', 'cc-fx-next', 'Next: ' + f.next));
      ul.append(li);
    }
    if (!ranked.length) ul.append(el('li', 'cc-fx-empty', 'Nobody is urgent or high priority right now.'));
    focus.append(ul);

    const stages = el('section', 'cc-fx-card');
    stages.append(cardHead('Relationship pipeline'));
    const bar = el('div', 'cc-fx-stagebar');
    const counts = E.STAGES.map((s) => [s, m.founders.filter((f) => f.stage === s).length]);
    const maxN = Math.max(1, ...counts.map((c) => c[1]));
    counts.forEach(([s, n], i) => {
      if (!n) return;
      const seg = btn('cc-fx-seg cc-fx-seg' + i, null, () => go('founders', { stage: s }), `${s}: ${n}`);
      const bar2 = el('i'); bar2.style.width = `${(n / maxN) * 100}%`;
      const track = el('span'); track.append(bar2);
      seg.append(el('span', null, s), el('b', null, intF(n)), track);
      bar.append(seg);
    });
    stages.append(bar);

    const log = el('section', 'cc-fx-card');
    log.append(cardHead('Team activity', 'Telegram'));
    const lg = rowsOf('fn_tg_log');
    const lul = el('ul', 'cc-fx-log');
    if (!lg) lul.append(el('li', 'cc-fx-empty', statusOf('fn_tg_log') === 'loading' ? 'Loading…' : 'The Telegram activity log isn’t loaded.'));
    else lg.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8).forEach((r) => { const li = el('li'); li.append(el('time', null, dayF(r.date)), el('span', 'cc-fx-kind', r.kind), el('span', null, r.text)); lul.append(li); });
    log.append(lul);

    const grid = el('div', 'cc-fx-two'); grid.append(focus, el('div', 'cc-fx-stack')); grid.lastChild.append(stages, log);
    wrap.append(tiles, drawOutreach(m), tgrid, grid);
    return wrap;
  };

  /* ---------- Action Center ---------- */
  const ACTION_STATUS = ['Overdue', 'Due soon', 'Open', 'Waiting', 'Needs review', 'Done'];
  const KIND_NAME = { commitment: 'Recorded commitment', proposal: 'Proposed, needs review', rule: 'Recommendation' };
  const actionRow = (a, today) => {
    const tr = el('tr', 'cc-fx-row-' + toneOf(a.statusLabel));
    const s = el('td'); s.append(pill(a.status, toneOf(a.status === 'Needs review' ? 'Needs verification' : a.statusLabel)));
    if (a.overdueDays) s.append(el('small', 'cc-fx-od', `${a.overdueDays} day${a.overdueDays === 1 ? '' : 's'} late`));
    const what = el('td'); what.append(el('b', null, a.text), el('small', 'cc-fx-cat', `${a.category} · ${KIND_NAME[a.kind]}`));
    const who = el('td'); who.append(btn('cc-fx-name', a.name, () => openProfile(a.founder))); if (a.company) who.append(el('small', null, a.company));
    const due = el('td', null, a.due ? `${dayF(a.due)} (${ago(a.due, today)})` : '—');
    const owner = el('td', null, a.owner || 'Not recorded');
    const ev = el('td', 'cc-fx-ev');
    for (const e of a.evidence) { const p = el('p'); p.append(srcChip(e.source), document.createTextNode(' ' + e.text)); if (e.ref) p.append(' ', link(zohoHref(e.ref), /fireflies/.test(e.ref) ? 'Open call' : 'Open in Zoho')); ev.append(p); }
    const nx = el('td', 'cc-fx-nextcell'); nx.append(el('span', null, a.next));
    const f = a.f; if (f && f.zoho && !a.evidence.some((e) => e.ref && !/fireflies/.test(e.ref))) nx.append(' ', link(contactHref(f), 'Open contact'));
    tr.append(s, what, who, due, owner, ev, nx);
    return tr;
  };
  const drawActions = (m) => {
    const a = st.actions; const today = m.today;
    const all = m.actions;
    const owners = [...new Set(all.map((x) => x.owner).filter(Boolean))].sort();
    const cats = [...new Set(all.map((x) => x.category))].sort();
    const vis = all.filter((x) => (a.done || x.status !== 'Done') && (!a.urgent || E.isUrgentAction(x)) && (!a.status || x.status === a.status) && (!a.category || x.category === a.category)
      && (!a.owner || (a.owner === '-' ? !x.owner : x.owner === a.owner)) && (!a.kind || x.kind === a.kind) && has(a.q, x.text, x.name, x.company, x.category, x.next));
    const sorters = {
      urgency: (x, y) => E.rankAction(x) - E.rankAction(y) || String(x.due || '9').localeCompare(String(y.due || '9')),
      due: (x, y) => String(x.due || '9').localeCompare(String(y.due || '9')),
      founder: (x, y) => String(x.name || '').localeCompare(String(y.name || '')),
    };
    vis.sort(sorters[a.sort]);
    const wrap = el('section', 'cc-fx-card');
    wrap.append(cardHead('Action Center', 'Complete tasks in Zoho'));
    const counts = Object.fromEntries(ACTION_STATUS.map((s) => [s, all.filter((x) => x.status === s).length]));
    const chips = el('div', 'cc-fx-chips');
    chips.append(chip(`All open (${intF(all.filter((x) => x.status !== 'Done').length)})`, !a.status && !a.done && !a.urgent, () => { Object.assign(a, { status: null, urgent: false, done: false, page: 0 }); render(); }));
    const nUrgent = all.filter(E.isUrgentAction).length;
    if (nUrgent) chips.append(chip(`Urgent (${intF(nUrgent)})`, a.urgent, () => { Object.assign(a, { urgent: !a.urgent, status: null, done: false, page: 0 }); render(); }));
    for (const s of ACTION_STATUS) if (counts[s]) chips.append(chip(`${s} (${intF(counts[s])})`, a.status === s, () => { Object.assign(a, { status: a.status === s ? null : s, urgent: false, done: s === 'Done' && a.status !== s, page: 0 }); render(); }));
    const filters = el('div', 'cc-fx-filters');
    filters.append(
      search(a.q, 'Search actions or founders', (v) => { a.q = v; a.page = 0; render(); }),
      select('Kind', [['', 'Any'], ['commitment', KIND_NAME.commitment], ['proposal', KIND_NAME.proposal], ['rule', KIND_NAME.rule]], a.kind, (v) => { a.kind = v; a.page = 0; render(); }),
      select('Type', [['', 'Any'], ...cats.map((c) => [c, c])], a.category, (v) => { a.category = v; a.page = 0; render(); }),
      select('Owner', [['', 'Anyone'], ...owners.map((o) => [o, o]), ['-', 'Not recorded']], a.owner, (v) => { a.owner = v; a.page = 0; render(); }),
      select('Sort', [['urgency', 'Most urgent first'], ['due', 'Due date'], ['founder', 'Founder']], a.sort, (v) => { a.sort = v; a.page = 0; render(); }),
      btn('cc-chip', 'Download CSV', () => csv(vis, [['status', 'Status'], ['text', 'Action'], ['category', 'Type'], [(x) => KIND_NAME[x.kind], 'Kind'], ['name', 'Founder'], ['company', 'Company'], ['owner', 'Owner'], ['due', 'Due'], ['next', 'Next step'], [(x) => x.evidence.map((e) => e.source + ': ' + e.text).join(' | '), 'Evidence']], 'founder-network-actions')),
    );
    const t = tableWrap(['Status', 'Action', 'Founder', 'Due', 'Owner', 'Evidence', 'Next step']);
    t.t.dataset.source = 'fn_actions'; t.t.dataset.rowKey = 'key';
    const page = vis.slice(a.page * PAGE, (a.page + 1) * PAGE);
    page.forEach((x) => { const r = actionRow(x, today); r.dataset.key = x.key; t.tbody.append(r); });
    if (!page.length) { const tr = el('tr'); const td = el('td', 'cc-fx-empty', 'No actions match these filters.'); td.colSpan = 7; tr.append(td); t.tbody.append(tr); }
    wrap.append(chips, filters, t.wrap, pager(vis.length, a.page, (p) => { a.page = p; render(); }));
    return wrap;
  };

  /* ---------- Founders directory ---------- */
  const BANDS = ['Urgent', 'High priority', 'Normal', 'Nurture', 'Needs review'];
  const SOURCES = [['zoho', 'Zoho CRM'], ['tg', 'Telegram'], ['ff', 'Fireflies'], ['ol', 'Outlook'], ['li', 'LinkedIn export']];
  const hasSource = (f, k) => ({ zoho: Boolean(f.zoho), tg: f.identities.some((i) => i.source === 'Telegram'), ff: f.identities.some((i) => i.source === 'Fireflies'), ol: Boolean(f.outlook && f.outlook.identity === 'same person'), li: Boolean(f.linkedinConn) }[k]);
  const drawFounders = (m) => {
    const s = st.founders; const today = m.today;
    const vis = m.founders.filter((f) => (!s.band || f.priorityInfo.band === s.band) && (!s.stage || f.stage === s.stage) && (!s.ver || f.verification === s.ver)
      && (!s.soon || (f.upcoming && E.daysBetween(today, f.upcoming) <= 7))
      && (!s.source || hasSource(f, s.source)) && has(s.q, f.name, f.company, f.title));
    const sorters = {
      score: (a, b) => (a.priorityInfo.band === 'Urgent' ? 0 : 1) - (b.priorityInfo.band === 'Urgent' ? 0 : 1) || b.priorityInfo.score - a.priorityInfo.score || String(a.name || '').localeCompare(String(b.name || '')),
      name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
      recent: (a, b) => String(b.lastInteraction || '').localeCompare(String(a.lastInteraction || '')),
      quiet: (a, b) => String(a.lastInteraction || '0').localeCompare(String(b.lastInteraction || '0')),
      meeting: (a, b) => String(a.upcoming || '9').localeCompare(String(b.upcoming || '9')),
    };
    vis.sort(sorters[s.sort]);
    const wrap = el('section', 'cc-fx-card');
    wrap.append(cardHead('Founders', `${intF(fnMembers(m).length)} in Zoho, ${intF(m.founders.filter((f) => !f.inFN).length)} more from Telegram`));
    const chips = el('div', 'cc-fx-chips');
    chips.append(chip(`Everyone (${intF(m.founders.length)})`, !s.band && !s.soon, () => { Object.assign(s, { band: null, soon: false, page: 0 }); render(); }));
    if (s.soon) chips.append(chip('Meeting in the next 7 days', true, () => { s.soon = false; s.page = 0; render(); }));
    for (const b of BANDS) { const n = m.founders.filter((f) => f.priorityInfo.band === b).length; if (n) chips.append(chip(`${b} (${intF(n)})`, s.band === b, () => { s.band = s.band === b ? null : b; s.page = 0; render(); })); }
    const vers = [...new Set(m.founders.map((f) => f.verification))].sort();
    const filters = el('div', 'cc-fx-filters');
    filters.append(
      search(s.q, 'Search name, company or title', (v) => { s.q = v; s.page = 0; render(); }),
      select('Stage', [['', 'Any stage'], ...E.STAGES.map((x) => [x, x])], s.stage, (v) => { s.stage = v; s.page = 0; render(); }),
      select('In Zoho', [['', 'Any'], ...vers.map((v) => [v, v])], s.ver, (v) => { s.ver = v; s.page = 0; render(); }),
      select('Seen in', [['', 'Any source'], ...SOURCES], s.source, (v) => { s.source = v; s.page = 0; render(); }),
      select('Sort', [['score', 'Priority'], ['meeting', 'Next meeting'], ['recent', 'Most recent contact'], ['quiet', 'Longest without contact'], ['name', 'Name']], s.sort, (v) => { s.sort = v; s.page = 0; render(); }),
      btn('cc-chip', 'Download CSV', () => csv(vis, [['name', 'Founder'], ['company', 'Company'], ['title', 'Title'], [(f) => f.priorityInfo.band, 'Priority band'], [(f) => f.priorityInfo.score, 'Score'], ['stage', 'Stage'], ['priority', 'Zoho Priority'], ['telegramPriority', 'Chat priority'], ['lastInteraction', 'Last interaction'], ['upcoming', 'Next meeting'], ['next', 'Next action'], ['verification', 'In Zoho'], [(f) => (f.zoho ? ZOHO + 'Contacts/' + f.zoho.id : ''), 'Zoho link']], 'founder-network')),
    );
    const t = tableWrap(['Founder', 'Priority', 'Stage', 'Last interaction', 'Next meeting', 'Next action', 'In Zoho', 'Sources']);
    t.t.dataset.source = 'fn_founders'; t.t.dataset.rowKey = 'id';
    for (const f of vis.slice(s.page * PAGE, (s.page + 1) * PAGE)) {
      const tr = el('tr'); tr.dataset.key = f.id;
      const n = el('td'); n.append(btn('cc-fx-name', f.name, () => openProfile(f.id))); if (f.company || f.title) n.append(el('small', null, [f.title, f.company].filter(Boolean).join(', ')));
      const p = el('td'); p.append(pill(f.priorityInfo.band), el('small', null, `score ${f.priorityInfo.score}${f.priority ? ' · Zoho P' + f.priority : ''}${f.telegramPriority && String(f.telegramPriority).replace('P', '') !== f.priority ? ' · chat ' + f.telegramPriority : ''}`));
      const li = el('td', null, f.lastInteraction ? `${dayF(f.lastInteraction)} (${ago(f.lastInteraction, today)})` : 'None recorded');
      const up = el('td', null, f.upcoming ? dayF(f.upcoming) : '—');
      const ver = el('td'); ver.append(f.zoho ? link(contactHref(f), f.verification, 'Open in Zoho') : el('span', 'cc-fx-warntext', f.verification));
      const srcs = el('td', 'cc-fx-srcs'); SOURCES.forEach(([k, label]) => { if (hasSource(f, k)) srcs.append(srcChip(label === 'Zoho CRM' ? 'Zoho CRM' : label === 'LinkedIn export' ? 'LinkedIn' : label)); });
      tr.append(n, p, el('td', null, f.stage), li, up, el('td', 'cc-fx-nextcell', f.next || '—'), ver, srcs);
      t.tbody.append(tr);
    }
    if (!vis.length) { const tr = el('tr'); const td = el('td', 'cc-fx-empty', 'Nobody matches these filters.'); td.colSpan = 8; tr.append(td); t.tbody.append(tr); }
    wrap.append(chips, filters, t.wrap, pager(vis.length, s.page, (p) => { s.page = p; render(); }));
    return wrap;
  };

  /* ---------- Pipeline ---------- */
  const drawPipeline = (m) => {
    const wrap = el('section', 'cc-fx-card');
    wrap.append(cardHead('Relationship pipeline', 'Worked out from the sources'));
    const board = el('div', 'cc-fx-board');
    E.STAGES.forEach((s, i) => {
      const people = m.founders.filter((f) => f.stage === s).sort((a, b) => b.priorityInfo.score - a.priorityInfo.score);
      const col = el('div', 'cc-fx-col cc-fx-seg' + i);
      const h = el('div', 'cc-fx-colhead'); h.append(el('b', null, intF(people.length)), el('span', null, s));
      col.append(h, el('p', 'cc-fx-rule', E.STAGE_RULES[s]));
      const ul = el('ul');
      people.slice(0, 8).forEach((f) => { const li = el('li'); li.append(btn('cc-fx-name', f.name, () => openProfile(f.id)), pill(f.priorityInfo.band)); ul.append(li); });
      col.append(ul);
      if (people.length > 8) col.append(btn('cc-chip', `All ${intF(people.length)}`, () => go('founders', { stage: s, band: null })));
      board.append(col);
    });
    wrap.append(board);
    return wrap;
  };

  /* ---------- Activity timeline ---------- */
  const TL_SOURCES = ['Zoho CRM', 'Zoho Sign', 'Fireflies', 'Outlook mail', 'Outlook calendar', 'Telegram', 'LinkedIn'];
  const drawTimeline = (m) => {
    const s = st.timeline; const today = m.today;
    const vis = m.timeline.filter((a) => a.day <= today || a.upcoming).filter((a) => (!s.source || a.source === s.source) && has(s.q, a.text, a.f.name, a.type));
    const wrap = el('section', 'cc-fx-card');
    wrap.append(cardHead('Activity', 'Newest first'));
    const chips = el('div', 'cc-fx-chips');
    chips.append(chip(`All (${intF(vis.length)})`, !s.source, () => { s.source = ''; s.page = 0; render(); }));
    TL_SOURCES.forEach((x) => { const n = m.timeline.filter((a) => a.source === x).length; if (n) chips.append(chip(`${x} (${intF(n)})`, s.source === x, () => { s.source = s.source === x ? '' : x; s.page = 0; render(); })); });
    const filters = el('div', 'cc-fx-filters'); filters.append(search(s.q, 'Search activity', (v) => { s.q = v; s.page = 0; render(); }));
    const list = el('ol', 'cc-fx-tl');
    for (const a of vis.slice(s.page * PAGE, (s.page + 1) * PAGE)) {
      const li = el('li');
      const top = el('div', 'cc-fx-tltop'); top.append(el('time', null, dayF(a.day)), srcChip(a.source), el('span', 'cc-fx-kind', a.type), btn('cc-fx-name', a.f.name, () => openProfile(a.f.id)));
      li.append(top, el('p', null, a.text + (a.by ? ` (${a.by})` : '')));
      if (a.ref) li.append(link(zohoHref(a.ref), /fireflies/.test(a.ref) ? 'Open the call in Fireflies' : 'Open in Zoho'));
      list.append(li);
    }
    if (!vis.length) list.append(el('li', 'cc-fx-empty', 'No activity matches.'));
    wrap.append(chips, filters, list, pager(vis.length, s.page, (p) => { s.page = p; render(); }));
    return wrap;
  };

  /* ---------- Data quality ---------- */
  const SEV = { high: 'bad', medium: 'warn', low: 'muted' };
  const drawQuality = (m) => {
    const s = st.quality;
    /* the issue tiles and the table both follow the severity filter */
    const RANK = { high: 0, medium: 1, low: 2 };
    const pool = m.issues.filter((i) => !s.sev || i.severity === s.sev);
    const worst = (list) => list.reduce((w, i) => (RANK[i.severity] < RANK[w] ? i.severity : w), 'low');
    const types = [...new Set(pool.map((i) => i.type))].map((t) => [t, pool.filter((i) => i.type === t)]).sort((a, b) => RANK[worst(a[1])] - RANK[worst(b[1])] || b[1].length - a[1].length);
    if (s.type && !types.some(([t]) => t === s.type)) s.type = '';
    const vis = pool.filter((i) => !s.type || i.type === s.type).sort((a, b) => (RANK[a.severity] - RANK[b.severity]) || String(a.f.name || '').localeCompare(String(b.f.name || '')));
    const wrap = el('section', 'cc-fx-card');
    wrap.append(cardHead('Data quality', 'Fix in Zoho'));
    const sevChips = el('div', 'cc-fx-chips');
    [['', 'All severities'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']].forEach(([k, l]) => { const n = m.issues.filter((i) => !k || i.severity === k).length; sevChips.append(chip(`${l} (${intF(n)})`, s.sev === k, () => { s.sev = k; s.page = 0; render(); })); });
    const grid = el('div', 'cc-fx-qgrid');
    for (const [t, list] of types) {
      const b = btn('cc-fx-qtile cc-fx-' + SEV[worst(list)], null, () => { s.type = s.type === t ? '' : t; s.page = 0; render(); });
      b.setAttribute('aria-pressed', String(s.type === t));
      b.append(el('b', null, intF(list.length)), el('span', null, t));
      grid.append(b);
    }
    const t = tableWrap(['Severity', 'Issue', 'Founder', 'Evidence', 'Change to make', '']);
    for (const i of vis.slice(s.page * PAGE, (s.page + 1) * PAGE)) {
      const tr = el('tr');
      const sev = el('td'); sev.append(pill(i.severity === 'high' ? 'High' : i.severity === 'medium' ? 'Medium' : 'Low', SEV[i.severity]));
      const who = el('td'); who.append(btn('cc-fx-name', i.f.name, () => openProfile(i.f.id)));
      const act = el('td');
      if (i.f.zoho) act.append(link(contactHref(i.f), 'Open in Zoho'));
      else act.append(link(ZOHO + 'Contacts/create', 'New contact in Zoho', 'Search Zoho for the name first'));
      tr.append(sev, el('td', null, i.type), who, el('td', 'cc-fx-ev', i.detail), el('td', null, i.fix), act);
      t.tbody.append(tr);
    }
    if (!vis.length) { const tr = el('tr'); const td = el('td', 'cc-fx-empty', 'No issues of this kind.'); td.colSpan = 6; tr.append(td); t.tbody.append(tr); }
    const dl = btn('cc-chip', 'Download the fix list', () => csv(vis, [['severity', 'Severity'], ['type', 'Issue'], [(i) => i.f.name, 'Founder'], ['detail', 'Evidence'], ['fix', 'Change to make'], [(i) => (i.f.zoho ? ZOHO + 'Contacts/' + i.f.zoho.id : ''), 'Zoho link']], 'founder-network-fixes'));
    wrap.append(sevChips, grid, el('div', 'cc-fx-filters'), t.wrap, pager(vis.length, s.page, (p) => { s.page = p; render(); }));
    wrap.querySelector('.cc-fx-filters').append(dl);
    return wrap;
  };

  /* ---------- Sources ---------- */
  const SRC_ROWS = [
    { id: 'qa_contacts', label: 'Zoho CRM contacts', kind: 'live', how: 'Live from Zoho', limits: 'Read-only', count: (m) => m.src.contacts.length, unit: 'contacts' },
    { id: 'fn_events', label: 'Zoho CRM meetings', kind: 'live', how: 'Live from Zoho', limits: 'Linked to the contact only', count: (m) => (rowsOf('fn_events') || []).length, unit: 'meetings' },
    { id: 'fn_tasks', label: 'Zoho CRM tasks', kind: 'live', how: 'Live from Zoho', limits: 'Complete tasks in Zoho', count: (m) => (rowsOf('fn_tasks') || []).length, unit: 'tasks' },
    { id: 'deals', label: 'Zoho CRM deals', kind: 'live', how: 'Live from Zoho', limits: 'Matched by Contact Name', count: (m) => (rowsOf('deals') || []).length, unit: 'deals' },
    { id: 'sign_docs', label: 'Zoho Sign agreements', kind: 'live', how: 'Live from Zoho Sign', limits: 'Referral agreements and MNDAs', count: (m) => m.src.agreements.length, unit: 'agreements' },
    { id: 'fn_tg_people', label: 'Telegram group', kind: 'imported', how: 'Chat export, reviewed by hand', limits: 'Re-export to update', count: () => (rowsOf('fn_tg_people') || []).length, unit: 'people' },
    { id: 'fn_tg_photos', label: 'Telegram photos', kind: 'imported', how: 'Described by hand', limits: 'No phone numbers or emails', count: () => (rowsOf('fn_tg_photos') || []).length, unit: 'photos' },
    { id: 'fn_ff_meetings', label: 'Fireflies calls', kind: 'imported', how: 'Matched by email or exact name', limits: 'No Asinpa calls or interviews', count: () => (rowsOf('fn_ff_meetings') || []).length, unit: 'calls' },
    { id: 'fn_outlook', label: 'Outlook mail and calendar', kind: 'imported', how: 'Checked by hand', limits: 'Dates and counts only', count: () => (rowsOf('fn_outlook') || []).length, unit: 'people checked' },
    { id: 'mack_network', label: 'Mack’s LinkedIn export', kind: 'imported', how: 'Mack’s data export', limits: 'Emails dropped', count: () => (rowsOf('mack_network') || []).length, unit: 'connections' },
  ];
  const drawSources = (m) => {
    const wrap = el('section', 'cc-fx-card');
    wrap.append(cardHead('Sources', 'Zoho live, the rest imported'));
    const built = new Map((rowsOf('fn_sources') || []).map((r) => [r.dataset, r.built]));
    const t = tableWrap(['Source', 'How', 'Status', 'Records', 'Updated', 'Limits']);
    const now = new Date();
    for (const r of SRC_ROWS) {
      const s0 = statusOf(r.id);
      const at = r.kind === 'live' ? (s0 === 'ok' ? now.toISOString() : null) : r.id === 'mack_network' ? ((rowsOf('mack_network') || [])[0] || {}).export_date : built.get(r.id);
      const state = s0 === 'ok' ? 'ok' : s0 === 'loading' ? 'loading' : s0 === 'connect' || s0 === 'declined' ? 'connect' : s0 === 'missing' ? 'missing' : 'error';
      /* the public site carries the imported files only once they are sealed for it */
      const ss = state !== 'ok' && r.kind === 'imported' && window.CC_MAIL_PRIVATE ? { status: 'Not in this build', tone: 'muted' } : E.sourceStatus({ kind: r.kind, state, at }, now);
      const tr = el('tr');
      const st2 = el('td'); st2.append(pill(ss.status, ss.tone));
      tr.append(el('td', null, r.label), el('td', null, r.how), st2, el('td', null, s0 === 'ok' ? `${intF(r.count(m))} ${r.unit}` : '—'), el('td', null, r.kind === 'live' ? (s0 === 'ok' ? 'Live' : '—') : dayF(at)), el('td', null, r.limits));
      t.tbody.append(tr);
    }
    const id = el('section', 'cc-fx-card');
    const conf = { confirmed: 0, likely: 0, possible: 0, unmatched: 0, partial: 0 };
    m.founders.forEach((f) => f.identities.filter((i) => i.source !== 'Zoho CRM').forEach((i) => { conf[i.confidence] = (conf[i.confidence] || 0) + 1; }));
    id.append(cardHead('How records are joined'), el('p', 'cc-fx-sub', 'Matched by Zoho ID, then LinkedIn profile or Zoho email, then a unique exact name. Close names wait for review.'));
    const ul = el('ul', 'cc-fx-conf');
    [['confirmed', 'Confirmed'], ['likely', 'Likely, same name'], ['possible', 'Possible, needs review'], ['unmatched', 'Named in Telegram, not in Zoho'], ['partial', 'First name only']].forEach(([k, l]) => { const li = el('li'); li.append(el('b', null, intF(conf[k] || 0)), el('span', null, l)); ul.append(li); });
    id.append(ul);
    wrap.append(t.wrap);
    const out = el('div', 'cc-fx-stack'); out.append(wrap, id);
    return out;
  };

  /* ---------- Targets and rules ---------- */
  const drawRules = () => {
    const S = E.DEFAULTS;
    const out = el('div', 'cc-fx-stack');
    const a = el('section', 'cc-fx-card');
    a.append(el('h3', null, 'Targets'), el('p', 'cc-fx-sub', `Mack’s Oct 17 scorecard, ${dayF(S.campaign.start)} to ${dayF(S.campaign.end)}, paced from where each count stood on Aug 17.`));
    const t = tableWrap(['Target', 'Goal', 'Counted from']);
    const from = { members: 'Zoho contacts with Founder Network in Relationship Type, not Priority 9 or 11', meetings: 'Days with a meeting held since Aug 17: Zoho Completed, team calendar or Fireflies call, one per founder per day', agreements_sent: 'Referral agreements in Zoho Sign to a Founder Network contact, any state', agreements_signed: 'Those signed', opportunities: 'Open deals (Identify, Discovery, Proposals, Hold) whose contact is a founder', closed: 'Deals at Closed whose contact is a founder' };
    S.targets.forEach((x) => { const tr = el('tr'); tr.append(el('td', null, x.label), el('td', null, intF(x.target)), el('td', null, from[x.id])); t.tbody.append(tr); });
    a.append(t.wrap);
    const b = el('section', 'cc-fx-card');
    b.append(cardHead('Status rules'));
    const t2 = tableWrap(['Status', 'When']);
    [['Completed', 'The target is met, or the action is done in Zoho'], ['On track', `At least ${Math.round(S.atRiskShare * 100)}% of the pace expected by today`], ['At risk', `${Math.round(S.belowShare * 100)}% to ${Math.round(S.atRiskShare * 100)}% of the expected pace, or a meeting to prepare within ${S.prepDays} days`], ['Below target', `Under ${Math.round(S.belowShare * 100)}% of the expected pace, or a commitment past due`], ['Critical', `A Highest-priority Zoho task past due, or a past Zoho meeting from the last ${S.taskStaleDays} days still not marked Completed`], ['Needs verification', 'Found in Telegram or on a call, or an identity that isn’t confirmed'], ['Stale data', `A source that didn’t load, or an import older than ${S.staleHours.imported / 24} days`]]
      .forEach(([k, v]) => { const tr = el('tr'); const td = el('td'); td.append(pill(k)); tr.append(td, el('td', null, v)); t2.tbody.append(tr); });
    b.append(t2.wrap);
    const c = el('section', 'cc-fx-card');
    c.append(el('h3', null, 'Priority engine'), el('p', 'cc-fx-sub', `${S.bands.high}+ points is High priority, ${S.bands.normal}+ Normal, below that Nurture. An overdue commitment or a meeting within ${S.prepDays} days makes a founder Urgent; not in Zoho or an unconfirmed identity is Needs review.`));
    const t3 = tableWrap(['Signal', 'Up to', 'Scored from']);
    c.append(el('p', 'cc-fx-sub', 'Anyone tagged for the B2B campaign is left out everywhere, scorecard included; Shruti tracks them on B2B. Priority 9, 11 and 99 are hidden from every list; signed P99 partners outside B2B still count in the scorecard.'));
    const why = { strategic: 'Zoho Priority (1 full, 3 most, 5 some); the chat’s priority when Zoho has none', opportunity: 'An open deal, or a referral agreement sent and not signed', relationship: 'Meeting days held, two-way contact, or endorsements on LinkedIn', commitments: 'Any open recorded commitment', intro: 'An introduction or referral mentioned in the notes', recency: `Priority 1 or 3 (Zoho, else the chat) with no interaction for 30+ days, full points past 60`, upcoming: 'A meeting in the next 7 days' };
    Object.entries(S.weights).forEach(([k, v]) => { const tr = el('tr'); tr.append(el('td', null, k[0].toUpperCase() + k.slice(1)), el('td', null, String(v)), el('td', null, why[k])); t3.tbody.append(tr); });
    c.append(t3.wrap);
    const d = el('section', 'cc-fx-card');
    d.append(el('h3', null, 'Action rules'));
    const ul = el('ul', 'cc-fx-rules');
    [`Zoho tasks for a founder are recorded commitments; more than ${S.taskStaleDays} days overdue asks to close or re-date them`, `A meeting in Zoho or on the team calendar that hasn’t happened yet asks for preparation; due soon within ${S.prepDays} days`, 'A past Zoho meeting still Scheduled or blank asks to record the outcome', 'A team-calendar meeting with no Zoho meeting that day asks to log it in Zoho', `A meeting held ${S.followUpDays} to 60 days ago with no later email, task or meeting asks for a follow-up`, `Priority 1 with no interaction in ${S.reconnectDays.P1} days, or Priority 3 in ${S.reconnectDays.P3}, asks to reconnect, unless a meeting is booked`, 'Asks in Telegram and our team’s action items on a recorded call are proposals until someone confirms them in Zoho', 'Nothing gets an owner or a due date the source doesn’t record']
      .forEach((x) => ul.append(el('li', null, x)));
    d.append(ul, el('p', 'cc-fx-sub', 'Set in fn-engine.js; ask for a change.'));
    out.append(a, b, c, d);
    return out;
  };

  /* ---------- profile ---------- */
  const openProfile = (id) => {
    const m = memo.model; const f = m && m.byId.get(id); if (!f) return;
    const today = m.today;
    drawer.replaceChildren();
    const top = el('header', 'cc-fx-dhead');
    const h = el('h3', null, f.name); h.id = 'fnx-drawer-title';
    const close = btn('cc-fx-close', 'Close', () => drawer.close());
    const sub = el('p', 'cc-fx-sub', [f.title, f.company].filter(Boolean).join(', ') || 'No title or company on record');
    const badges = el('div', 'cc-fx-badges'); badges.append(pill(f.priorityInfo.band), pill(f.stage, 'info'), pill(f.verification, f.zoho && f.inFN ? 'ok' : 'warn'));
    const links = el('div', 'cc-fx-dlinks');
    if (f.zoho) links.append(link(contactHref(f), 'Open in Zoho'));
    if (E.slugOf(f.linkedin)) links.append(link('https://www.linkedin.com/in/' + encodeURIComponent(E.slugOf(f.linkedin)) + '/', 'LinkedIn profile'));
    top.append(close, h, sub, badges, links);
    const sec2 = (title) => { const s = el('section', 'cc-fx-dsec'); s.append(el('h4', null, title)); return s; };

    const pr = sec2(`Why ${f.priorityInfo.band.toLowerCase()} (score ${f.priorityInfo.score})`);
    if (f.priorityInfo.urgentBecause) pr.append(el('p', 'cc-fx-urgent', 'Urgent because: ' + f.priorityInfo.urgentBecause));
    const rl = el('ul', 'cc-fx-reasons');
    f.priorityInfo.reasons.forEach((r) => { const li = el('li'); li.append(el('b', null, '+' + r.points), el('span', null, r.why)); rl.append(li); });
    if (!f.priorityInfo.reasons.length) rl.append(el('li', null, 'No scoring signal yet.'));
    pr.append(rl);
    if (f.priorityInfo.incomplete.length) pr.append(el('p', 'cc-fx-sub', 'Not known yet: ' + f.priorityInfo.incomplete.join(', ') + '.'));

    const facts = sec2('At a glance');
    const dl = el('dl', 'cc-fx-facts');
    const fact = (k, v) => { dl.append(el('dt', null, k), el('dd', null, v)); };
    fact('Zoho Priority', f.priority ? 'P' + f.priority : 'Not set');
    if (f.telegramPriority) fact('Priority in the chat', f.telegramPriority);
    fact('Assigned to', f.owner || 'Not recorded');
    fact('Meeting days held', intF(f.facts.meetingDays.length));
    fact('Last interaction', f.lastInteraction ? `${dayF(f.lastInteraction)} (${ago(f.lastInteraction, today)})` : 'None recorded');
    fact('Next meeting', f.upcoming ? dayF(f.upcoming) : 'None booked');
    fact('Deals', f.facts.deals.length ? f.facts.deals.map((d) => `${d.Deal_Name} (${d.Stage})`).join('; ') : 'None');
    fact('Referral agreement', f.facts.agreements.length ? f.facts.agreements.map((a) => a.state).join('; ') : 'None');
    if (f.outlook) fact('Outlook', f.outlook.identity === 'same person' ? `${f.outlook.email_count >= 25 ? '25+' : f.outlook.email_count} emails${f.outlook.first_email ? ' from ' + dayF(f.outlook.first_email) : ''}${f.outlook.last_email ? ' to ' + dayF(f.outlook.last_email) : ''}${f.outlook.two_way ? ', both ways' : ''}; ${f.outlook.meeting_count} calendar meetings${f.outlook.note ? '. ' + f.outlook.note : ''}` : `Checked: ${f.outlook.identity}${f.outlook.note ? ' (' + f.outlook.note + ')' : ''}`);
    else fact('Outlook', 'Not checked yet');
    if (f.linkedinConn) fact('LinkedIn', `Connected with Mack ${f.linkedinConn.connected ? 'on ' + dayF(f.linkedinConn.connected) : ''}${f.linkedinConn.ties.length ? '; ' + f.linkedinConn.ties.join(', ').toLowerCase() : ''}`);
    facts.append(dl);

    const ac = sec2('Open actions');
    const open = f.actions.filter((a) => a.status !== 'Done').sort((a, b) => E.rankAction(a) - E.rankAction(b));
    const al = el('ul', 'cc-fx-dactions');
    open.forEach((a) => {
      const li = el('li'); li.append(pill(a.status, toneOf(a.status === 'Needs review' ? 'Needs verification' : a.statusLabel)), el('b', null, a.text));
      li.append(el('small', null, `${a.category} · ${KIND_NAME[a.kind]}${a.owner ? ' · ' + a.owner : ''}${a.due ? ' · due ' + dayF(a.due) : ''}`));
      a.evidence.forEach((e) => { const p = el('p'); p.append(srcChip(e.source), ' ' + e.text); if (e.ref) p.append(' ', link(zohoHref(e.ref), /fireflies/.test(e.ref) ? 'Open call' : 'Open in Zoho')); li.append(p); });
      li.append(el('p', 'cc-fx-next', 'Next: ' + a.next));
      al.append(li);
    });
    if (!open.length) al.append(el('li', 'cc-fx-empty', 'Nothing open.'));
    ac.append(al);

    const idn = sec2('Identity across sources');
    const t = tableWrap(['Source', 'Record', 'Matched by', 'Confidence']);
    f.identities.forEach((i) => { const tr = el('tr'); const c = el('td'); c.append(pill(i.confidence[0].toUpperCase() + i.confidence.slice(1), i.confidence === 'confirmed' ? 'ok' : i.confidence === 'likely' ? 'info' : 'warn')); tr.append(el('td', null, i.source), el('td', null, /^https?:/.test(i.record) ? 'profile' : i.source === 'Fireflies' ? 'call' : i.record), el('td', null, i.method), c); t.tbody.append(tr); });
    idn.append(t.wrap);

    const iss = sec2('Data issues');
    const il = el('ul', 'cc-fx-rules'); f.issues.forEach((i) => il.append(el('li', null, `${i.type}: ${i.detail}. Change: ${i.fix}.`)));
    if (!f.issues.length) il.append(el('li', null, 'None found.'));
    iss.append(il);

    const notes = sec2('Notes from the team');
    const nl = el('ul', 'cc-fx-rules'); f.notes.forEach((n) => nl.append(el('li', null, n.text)));
    if (!f.notes.length) nl.append(el('li', null, 'None.'));
    notes.append(nl);

    const tl = sec2('Timeline');
    const ol = el('ol', 'cc-fx-tl');
    f.activities.forEach((a) => {
      const li = el('li'); const tp = el('div', 'cc-fx-tltop'); tp.append(el('time', null, dayF(a.day)), srcChip(a.source), el('span', 'cc-fx-kind', a.type));
      li.append(tp, el('p', null, a.text + (a.by ? ` (${a.by})` : '')));
      if (a.summary) { const d = el('details'); d.append(el('summary', null, 'Call summary'), el('p', null, a.summary)); li.append(d); }
      if (a.ref) li.append(link(zohoHref(a.ref), /fireflies/.test(a.ref) ? 'Open the call in Fireflies' : 'Open in Zoho'));
      ol.append(li);
    });
    if (!f.activities.length) ol.append(el('li', 'cc-fx-empty', 'No activity on record.'));
    tl.append(ol);

    const scroll = el('div', 'cc-fx-dbody'); scroll.append(pr, ac, facts, idn, iss, notes, tl);
    drawer.append(top, scroll);
    if (!drawer.open) drawer.showModal();
    close.focus();
  };

  /* ---------- render ---------- */
  const render = () => {
    const m = getModel();
    nav.replaceChildren(...VIEWS.map(([k, label]) => { const b = btn('cc-fx-tab', label, () => { if (st.view !== k) { st.view = k; render(); } }); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(st.view === k)); return b; }));
    if (!m) {
      const bad = [...CONTACT_IDS.slice(0, 1), 'fn_events', 'fn_tasks'].filter((id) => ['error', 'connect', 'declined', 'missing'].includes(statusOf(id)));
      lede.textContent = bad.length ? `Zoho didn’t load (${bad.join(', ')}). Reconnect Zoho CRM in the dashboard’s Sources, then reload.` : 'Loading the Founder Network from Zoho and the imported sources…';
      body.replaceChildren(); foot.textContent = '';
      return;
    }
    const members = fnMembers(m);
    const missingRows = SRC_ROWS.filter((r) => statusOf(r.id) !== 'ok');
    const stale = window.CC_MAIL_PRIVATE && missingRows.length && missingRows.every((r) => r.kind === 'imported') ? ['Telegram, Fireflies, Outlook and LinkedIn (not in this build yet)'] : missingRows.map((r) => r.label);
    const hidden = m.all.length - m.founders.length;
    lede.textContent = `${intF(members.length)} in Zoho and ${intF(m.founders.filter((f) => !f.inFN).length)} more from Telegram or the Founder_Network tag, as of ${dayF(m.today)} CT.${hidden ? ` ${intF(hidden)} hidden: in the B2B campaign, or at Priority 9, 11 or 99.` : ''}${stale.length ? ' Not loaded: ' + stale.join(', ') + '.' : ''}`;
    const view = { overview: drawOverview, actions: drawActions, founders: drawFounders, pipeline: drawPipeline, timeline: drawTimeline, quality: drawQuality, sources: drawSources, rules: drawRules }[st.view];
    const focusId = document.activeElement && root.contains(document.activeElement) && document.activeElement.matches('input') ? document.activeElement.className : null;
    body.replaceChildren(view(m));
    if (focusId) { const i = body.querySelector('input.' + focusId.split(' ')[0]); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
    foot.textContent = 'Read-only: make every change in Zoho. Private to this dashboard.';
  };
  dash.onData(render);
})();
