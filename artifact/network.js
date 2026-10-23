/* Mack's Network: every LinkedIn connection in Mack's export, graded as a B2B referral-partner prospect (dataset
   mack_network: grade, partner type, why, what they could refer, client signal), joined live to Zoho contacts by
   LinkedIn profile, else by exact first and last name, so the CRM status is always current. Private dashboard only:
   the data never goes to the public site or into Zoho. Loaded after the page script; uses dash and CC_RULES. */
(() => {
  const root = document.getElementById('mn-root');
  if (!root) return;
  const ZOHO = 'https://crm.zoho.com/crm/org899412015/tab/';
  const B2B_TAG = 'May 2026 - 100 B2B';
  const ICP_TAG = '2026ICP';
  const PAGE = 50;
  const SHORTLIST = 24;
  const GRADES = [
    ['A', 'Strong fit', 'Owner or principal who regularly advises business owners; could send a project now'],
    ['B', 'Possible fit', 'Right kind of role with weaker signals; worth a look before outreach'],
    ['C', 'Weak fit', 'Inside a large company or an unrelated field; little outside referral reach'],
    ['X', 'Not a prospect', 'Student, job seeker, retired or empty profile'],
  ];
  const TYPES = [
    ['IT_SERVICES', 'IT services, MSP and software firms'],
    ['ERP_CRM', 'ERP and CRM consultants'],
    ['FRACTIONAL', 'Fractional and interim executives'],
    ['MGMT_CONSULT', 'Management and operations consultants'],
    ['STAFFING', 'Staffing and recruiting firms'],
    ['ADVISOR_FIN', 'Finance, legal and M&A advisors'],
    ['SALES_BD', 'Sales, BD and alliances'],
    ['COACH', 'Business coaches and peer groups'],
    ['AGENCY', 'Marketing and digital agencies'],
    ['VENDOR_ALLIANCE', 'Software vendor alliances'],
    ['INVESTOR', 'Investors'],
    ['ENTERPRISE_EXEC', 'Executives at operating companies'],
    ['EMPLOYEE', 'Employees and other roles'],
  ];
  const TYPE_NAME = Object.fromEntries(TYPES);
  const TYPE_RANK = Object.fromEntries(TYPES.map(([k], i) => [k, i]));
  const CRM = [
    ['none', 'Not in Zoho'],
    ['b2b', 'In the B2B campaign'],
    ['fn', 'Founder Network'],
    ['client', 'Client'],
    ['icp', 'ICP campaign'],
    ['other', 'In Zoho, no campaign'],
  ];
  const CRM_NAME = Object.fromEntries(CRM);

  /* ---------- helpers ---------- */
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const intF = (n) => Number(n || 0).toLocaleString('en-US');
  const rows = (id) => { const d = dash.data(id); return d && d.status === 'ok' ? d.data || [] : []; };
  const status = (id) => (dash.data(id) || {}).status;
  const slugOf = (u) => { const m = String(u || '').match(/linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/i); if (!m) return null; try { return decodeURIComponent(m[1]).toLowerCase().replace(/\/+$/, ''); } catch (e) { return m[1].toLowerCase(); } };
  const nameKey = (f, l) => `${String(f || '').toLowerCase().replace(/[^a-z]/g, '')}|${String(l || '').toLowerCase().replace(/[^a-z]/g, '')}`;
  const has = (list, v) => String(list || '').split(',').map((x) => x.trim()).includes(v);
  const dayF = (s) => { if (!s) return '—'; const d = new Date(String(s).slice(0, 10) + 'T00:00:00Z'); return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }); };
  const link = (href, text, title) => { const a = el('a', 'cc-zlink', text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; if (title) a.title = title; return a; };

  /* ---------- calc: every connection with its live CRM status ---------- */
  dash.calc('mn_rows', {
    title: 'Mack’s LinkedIn connections graded as referral partners',
    description: 'One row per connection in Mack’s LinkedIn export (dataset mack_network): grade A to X, partner type, why, what they could refer and a client signal, with the Zoho contact matched by LinkedIn profile (else exact first and last name when only one contact has it) and its campaign: B2B campaign (with Priority), Founder Network, Client, ICP, in Zoho with no campaign, or not in Zoho.',
    inputs: ['mack_network', 'qa_contacts', 'qa_contacts_2', 'qa_contacts_3', 'qa_contacts_4'],
    fn: (net, a, b, c, d) => {
      const seen = new Set();
      const contacts = [...a, ...b, ...c, ...d].filter((z) => z && z.id && !seen.has(String(z.id)) && seen.add(String(z.id)));
      const bySlug = new Map();
      const byName = new Map();
      contacts.forEach((z) => {
        const s = slugOf(z.LinkedIn);
        if (s && !bySlug.has(s)) bySlug.set(s, z);
        const k = nameKey(z.First_Name, z.Last_Name);
        if (!byName.has(k)) byName.set(k, []);
        byName.get(k).push(z);
      });
      return net.map((r) => {
        const s = slugOf(r.url);
        let z = s ? bySlug.get(s) : null;
        let by = z ? 'LinkedIn profile' : null;
        if (!z) { const list = byName.get(nameKey(r.first, r.last)) || []; if (list.length === 1) { z = list[0]; by = 'Name'; } }
        let crm = 'none';
        if (z) {
          if (has(z.Tag, B2B_TAG) && !CC_RULES.isFN(z.Relationship_Type)) crm = 'b2b';
          else if (CC_RULES.isFN(z.Relationship_Type)) crm = 'fn';
          else if (has(z.Relationship_Type, 'Client')) crm = 'client';
          else if (has(z.Tag, ICP_TAG)) crm = 'icp';
          else crm = 'other';
        }
        return {
          ...r,
          zoho_id: z ? String(z.id) : null, zoho_by: by, crm,
          priority: z ? z.Priority || null : null, dnc: Boolean(z && (z.DO_NOT_CONTACT === true || z.DO_NOT_CONTACT === 'true')),
          b2b_tag: Boolean(z && has(z.Tag, B2B_TAG)),
        };
      });
    },
  });

  /* ---------- static structure ---------- */
  const st = { scope: 'new', grade: new Set(['A', 'B']), type: null, crm: null, client: false, q: '', page: 0, sort: 'fit' };
  const inScope = (r) => (st.scope === 'new' ? r.crm === 'none' : r.crm !== 'none');
  const head = el('section', 'cc-card cc-mn-head');
  const headTitle = el('div', 'cc-card-head');
  const h2 = el('h2', null, 'Mack’s network: referral partner prospects');
  const sub = el('p');
  headTitle.append(h2, sub);
  const stats = el('div', 'cc-mn-stats');
  head.append(headTitle, stats);

  const typesCard = el('section', 'cc-card cc-mn-types');
  const typesHead = el('div', 'cc-card-head');
  typesHead.append(el('h3', null, 'Where the partners are'), el('p', null, 'Strong and possible fits by kind of partner. Select a row to list them below.'));
  const typesBody = el('div', 'cc-mn-bars');
  typesCard.append(typesHead, typesBody);

  const shortCard = el('section', 'cc-card cc-mn-short');
  const shortHead = el('div', 'cc-card-head');
  shortHead.append(el('h3', null, 'Add these first'), el('p', null, 'Strong fits who are not in Zoho yet, one from each kind of partner in turn, longest-standing connection first within each kind. Mack already knows them, so outreach can skip the connection request.'));
  const shortBody = el('div', 'cc-mn-shortlist');
  const shortMore = el('div', 'cc-tools');
  shortCard.append(shortHead, shortBody, shortMore);

  const listCard = el('section', 'cc-card cc-mn-list');
  listCard.id = 'mn-list';
  const listHead = el('div', 'cc-card-head');
  const listTitle = el('h3', null, 'Every connection');
  const listNote = el('p');
  listHead.append(listTitle, listNote);
  const scopeBar = el('div', 'cc-mn-scope');
  scopeBar.setAttribute('role', 'tablist');
  scopeBar.setAttribute('aria-label', 'Which people');
  const filters = el('div', 'cc-mn-filters');
  const tableWrap = el('div', 'cc-mn-tablewrap');
  const pager = el('div', 'cc-tools cc-mn-pager');
  listCard.append(scopeBar, listHead, filters, tableWrap, pager);

  const note = el('p', 'cc-mn-foot');
  root.replaceChildren(head, typesCard, shortCard, listCard, note);

  /* ---------- filtering ---------- */
  const visible = (all) => {
    const q = st.q.trim().toLowerCase();
    return all.filter((r) => inScope(r) && (!st.grade.size || st.grade.has(r.fit))
      && (!st.type || r.type === st.type)
      && (st.scope === 'new' || !st.crm || r.crm === st.crm)
      && (!st.client || r.client)
      && (!q || `${r.name} ${r.position} ${r.company} ${r.why} ${r.refer}`.toLowerCase().includes(q)));
  };
  const sorters = {
    fit: (a, b) => a.fit.localeCompare(b.fit) || (TYPE_RANK[a.type] ?? 99) - (TYPE_RANK[b.type] ?? 99) || String(a.connected).localeCompare(String(b.connected)),
    name: (a, b) => String(a.name).localeCompare(String(b.name)),
    connected: (a, b) => String(b.connected).localeCompare(String(a.connected)),
    company: (a, b) => String(a.company).localeCompare(String(b.company)),
  };
  const goList = () => { st.page = 0; drawList(); listCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  /* ---------- pieces ---------- */
  const crmCell = (r) => {
    const w = el('span', 'cc-mn-crm cc-mn-crm-' + r.crm);
    if (r.zoho_id) {
      const label = r.crm === 'b2b' ? `B2B campaign${r.priority ? ', P' + r.priority : ''}` : CRM_NAME[r.crm];
      w.append(link(ZOHO + 'Contacts/' + r.zoho_id, label, `Open in Zoho (matched by ${r.zoho_by.toLowerCase()})`));
      if (r.dnc) w.append(el('small', 'cc-mn-dnc', ' Do Not Contact'));
    } else w.textContent = 'Not in Zoho';
    return w;
  };
  const gradePill = (g) => { const p = el('span', 'cc-mn-grade cc-mn-g' + g, g); p.title = (GRADES.find((x) => x[0] === g) || [])[1] || ''; return p; };
  const personCell = (r) => {
    const w = el('span', 'cc-mn-person');
    w.append(r.url ? link(r.url, r.name, 'Open the LinkedIn profile') : el('b', null, r.name));
    if (r.client) { const c = el('span', 'cc-mn-clientmark', 'Client signal'); c.title = 'Also looks like a direct buyer: a senior leader at a mid-size company in our ICP industries'; w.append(c); }
    return w;
  };

  const drawHead = (all) => {
    const by = (f) => all.filter(f).length;
    const newA = by((r) => r.fit === 'A' && r.crm === 'none');
    const newB = by((r) => r.fit === 'B' && r.crm === 'none');
    const knownFit = by((r) => (r.fit === 'A' || r.fit === 'B') && r.crm !== 'none');
    const inB2b = by((r) => (r.fit === 'A' || r.fit === 'B') && r.crm === 'b2b');
    const newClients = by((r) => r.client && r.crm === 'none');
    const asof = (rows('mack_network')[0] || {}).export_date;
    sub.textContent = `${intF(all.length)} connections from Mack’s LinkedIn export${asof ? ' of ' + dayF(asof) : ''}, each graded on role and company for how likely they are to refer business-owner clients to us. CRM status is matched live against Zoho.`;
    const tile = (cls, label, n, hint, apply) => {
      const b = el('button', 'cc-mn-stat ' + cls);
      b.type = 'button';
      b.append(el('span', 'cc-mn-slab', label), el('b', null, intF(n)), el('small', null, hint));
      b.setAttribute('aria-label', `${label}: ${intF(n)}. ${hint}. List them.`);
      b.addEventListener('click', () => { apply(); goList(); });
      return b;
    };
    stats.replaceChildren(
      tile('cc-mn-sA', 'Strong fits not in Zoho', newA, 'new people to add first', () => { st.scope = 'new'; st.grade = new Set(['A']); st.type = null; st.crm = null; st.client = false; }),
      tile('cc-mn-sB', 'Possible fits not in Zoho', newB, 'check the profile before adding', () => { st.scope = 'new'; st.grade = new Set(['B']); st.type = null; st.crm = null; st.client = false; }),
      tile('cc-mn-sClient', 'Client signal, not in Zoho', newClients, 'senior leaders at ICP-size companies', () => { st.scope = 'new'; st.grade = new Set(); st.type = null; st.crm = null; st.client = true; }),
      tile('cc-mn-sIn', 'Fits already in Zoho', knownFit, `${intF(inB2b)} of them in the B2B campaign`, () => { st.scope = 'known'; st.grade = new Set(['A', 'B']); st.type = null; st.crm = null; st.client = false; }),
    );
  };

  const drawTypes = (all) => {
    const fits = all.filter((r) => (r.fit === 'A' || r.fit === 'B') && inScope(r));
    typesHead.querySelector('p').textContent = st.scope === 'new' ? 'Strong and possible fits not in Zoho yet, by kind of partner. Select a row to list them below.' : 'Strong and possible fits already in Zoho, by kind of partner. Select a row to list them below.';
    const groups = TYPES.map(([k, label]) => {
      const list = fits.filter((r) => r.type === k);
      return { k, label, a: list.filter((r) => r.fit === 'A').length, b: list.filter((r) => r.fit === 'B').length, fresh: list.filter((r) => r.crm === 'none').length, n: list.length };
    }).filter((g) => g.n).sort((x, y) => y.a - x.a || y.n - x.n);
    const peak = Math.max(1, ...groups.map((g) => g.n));
    typesBody.replaceChildren(...groups.map((g) => {
      const row = el('button', 'cc-mn-bar');
      row.type = 'button';
      row.setAttribute('aria-pressed', String(st.type === g.k));
      const track = el('span', 'cc-mn-track');
      const fa = el('i', 'cc-mn-fa'); fa.style.width = (g.a / peak) * 100 + '%';
      const fb = el('i', 'cc-mn-fb'); fb.style.width = (g.b / peak) * 100 + '%';
      track.append(fa, fb);
      row.append(el('span', 'cc-mn-blab', g.label), track, el('span', 'cc-mn-bnum', `${intF(g.a)} strong`), el('span', 'cc-mn-bnew', `${intF(g.b)} possible`));
      row.title = `${g.label}: ${g.a} strong and ${g.b} possible fits ${st.scope === 'new' ? 'not in Zoho yet' : 'already in Zoho'}. Select to list them.`;
      row.addEventListener('click', () => { st.type = st.type === g.k ? null : g.k; st.grade = new Set(['A', 'B']); st.crm = null; st.client = false; drawTypes(all); goList(); });
      return row;
    }));
  };

  let shortAll = false;
  const drawShort = (all) => {
    /* One from each kind of partner in turn (kinds in TYPES order), longest-standing connection first within a kind,
       so the first cards cover every kind instead of the biggest one. */
    const byType = new Map();
    all.filter((r) => r.fit === 'A' && r.crm === 'none' && !['ENTERPRISE_EXEC', 'EMPLOYEE'].includes(r.type))
      .sort((a, b) => String(a.connected).localeCompare(String(b.connected)))
      .forEach((r) => { if (!byType.has(r.type)) byType.set(r.type, []); byType.get(r.type).push(r); });
    const queues = TYPES.map(([k]) => byType.get(k) || []).filter((q) => q.length);
    const picks = [];
    for (let i = 0; queues.some((q) => q.length > i); i += 1) queues.forEach((q) => { if (q[i]) picks.push(q[i]); });
    const show = shortAll ? picks : picks.slice(0, SHORTLIST);
    shortBody.replaceChildren(...show.map((r) => {
      const c = el('article', 'cc-mn-pick');
      const top = el('div', 'cc-mn-picktop');
      top.append(personCell(r), el('span', 'cc-mn-ptype', TYPE_NAME[r.type] || r.type));
      c.append(top, el('p', 'cc-mn-role', [r.position, r.company].filter(Boolean).join(' at ') || 'No title or company on LinkedIn'));
      c.append(el('p', 'cc-mn-why', r.why));
      if (r.refer) { const p = el('p', 'cc-mn-refer'); p.append(el('b', null, 'Could refer: '), document.createTextNode(r.refer)); c.append(p); }
      c.append(el('p', 'cc-mn-since', `Connected ${dayF(r.connected)}`));
      return c;
    }));
    if (!picks.length) shortBody.replaceChildren(el('p', 'cc-mn-empty', 'Every strong fit is already in Zoho.'));
    shortMore.replaceChildren();
    if (picks.length > SHORTLIST) {
      const b = el('button', 'cc-go', shortAll ? `Show the first ${SHORTLIST}` : `Show all ${intF(picks.length)}`);
      b.type = 'button';
      b.addEventListener('click', () => { shortAll = !shortAll; drawShort(all); });
      shortMore.append(b);
    }
  };

  const chip = (label, on, fn, title) => { const b = el('button', 'cc-chip', label); b.type = 'button'; b.setAttribute('aria-pressed', String(on)); if (title) b.title = title; b.addEventListener('click', fn); return b; };
  let allRows = [];
  const drawFilters = () => {
    const g = el('div', 'cc-tools');
    g.append(el('span', 'cc-mn-flab', 'Grade'), ...GRADES.map(([k, label, def]) => chip(`${k} ${label} (${intF(allRows.filter((r) => inScope(r) && r.fit === k).length)})`, st.grade.has(k), () => { st.grade.has(k) ? st.grade.delete(k) : st.grade.add(k); st.page = 0; drawList(); }, def)));
    const c = el('div', 'cc-tools');
    c.hidden = st.scope === 'new';
    c.append(el('span', 'cc-mn-flab', 'In Zoho as'), chip('Any', !st.crm, () => { st.crm = null; st.page = 0; drawList(); }), ...CRM.filter(([k]) => k !== 'none').map(([k, label]) => chip(label, st.crm === k, () => { st.crm = st.crm === k ? null : k; st.page = 0; drawList(); })));
    const t = el('div', 'cc-tools');
    const sel = el('select', 'cc-mn-select');
    sel.setAttribute('aria-label', 'Partner type');
    sel.append(new Option('Every partner type', ''), ...TYPES.map(([k, label]) => new Option(label, k)));
    sel.value = st.type || '';
    sel.addEventListener('change', () => { st.type = sel.value || null; st.page = 0; drawTypes(allRows); drawList(); });
    const search = el('input', 'cc-mn-search');
    search.type = 'search'; search.placeholder = 'Search name, title, company or reason'; search.value = st.q;
    search.setAttribute('aria-label', 'Search connections');
    let timer = null;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { st.q = search.value; st.page = 0; drawList(true); }, 180); });
    const clientChip = chip('Client signal only', st.client, () => { st.client = !st.client; st.page = 0; drawList(); });
    const sortSel = el('select', 'cc-mn-select');
    sortSel.setAttribute('aria-label', 'Sort');
    sortSel.append(new Option('Sort: best fit first', 'fit'), new Option('Sort: newest connection', 'connected'), new Option('Sort: name', 'name'), new Option('Sort: company', 'company'));
    sortSel.value = st.sort;
    sortSel.addEventListener('change', () => { st.sort = sortSel.value; st.page = 0; drawList(); });
    const reset = el('button', 'cc-go', 'Reset filters');
    reset.type = 'button';
    reset.addEventListener('click', () => { Object.assign(st, { grade: new Set(['A', 'B']), type: null, crm: null, client: false, q: '', page: 0, sort: 'fit' }); drawTypes(allRows); drawList(); });
    const dl = el('button', 'cc-go', 'Download these as CSV');
    dl.type = 'button';
    dl.addEventListener('click', () => download(visible(allRows).sort(sorters[st.sort])));
    t.append(sel, search, clientChip, sortSel, reset, dl);
    filters.replaceChildren(g, c, t);
    return search;
  };

  const download = (list) => {
    const cols = [['Name', (r) => r.name], ['LinkedIn', (r) => r.url], ['Position', (r) => r.position], ['Company', (r) => r.company], ['Connected', (r) => r.connected], ['Grade', (r) => r.fit], ['Partner type', (r) => TYPE_NAME[r.type] || r.type], ['Why', (r) => r.why], ['Could refer', (r) => r.refer], ['Client signal', (r) => (r.client ? 'Yes' : '')], ['In Zoho', (r) => (r.crm === 'b2b' ? `B2B campaign${r.priority ? ' P' + r.priority : ''}` : CRM_NAME[r.crm])], ['Zoho link', (r) => (r.zoho_id ? ZOHO + 'Contacts/' + r.zoho_id : '')]];
    const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [cols.map(([h]) => h).join(','), ...list.map((r) => cols.map(([, f]) => esc(f(r))).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `mack-network-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const drawScope = () => {
    const nNew = allRows.filter((r) => r.crm === 'none').length;
    const nKnown = allRows.length - nNew;
    const tab = (k, label, n, hint) => {
      const b = el('button', 'cc-mn-scopetab');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(st.scope === k));
      b.append(el('b', null, label), el('span', null, `${intF(n)} people · ${hint}`));
      b.addEventListener('click', () => { if (st.scope === k) return; st.scope = k; st.crm = null; st.type = null; st.page = 0; drawTypes(allRows); drawList(); });
      return b;
    };
    scopeBar.replaceChildren(tab('new', 'Not in Zoho', nNew, 'new people to add'), tab('known', 'Already in Zoho', nKnown, 'check their campaign and status'));
  };
  const drawList = (keepFocus) => {
    const active = document.activeElement;
    drawScope();
    const search = drawFilters();
    if (keepFocus && active && active.classList.contains('cc-mn-search')) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    const list = visible(allRows).sort(sorters[st.sort]);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    st.page = Math.min(st.page, pages - 1);
    const slice = list.slice(st.page * PAGE, st.page * PAGE + PAGE);
    const parts = [];
    if (st.grade.size && st.grade.size < GRADES.length) parts.push([...st.grade].sort().join(' and ') + ' grade');
    if (st.type) parts.push(TYPE_NAME[st.type]);
    if (st.scope === 'known' && st.crm) parts.push(CRM_NAME[st.crm]);
    if (st.client) parts.push('client signal');
    if (st.q.trim()) parts.push(`matching “${st.q.trim()}”`);
    listTitle.textContent = `${st.scope === 'new' ? 'Not in Zoho' : 'Already in Zoho'} (${intF(list.length)})`;
    listNote.textContent = (st.scope === 'new' ? 'Connections with no Zoho contact. Nothing here is written to Zoho; add the ones you want by hand. ' : 'Connections already in Zoho, matched by LinkedIn profile or exact name. ') + (parts.length ? 'Showing: ' + parts.join(', ') + '.' : 'Showing every grade.');
    const tbl = el('table', 'cc-tbl cc-mn-tbl');
    const thead = el('thead'); const hr = el('tr');
    ['Grade', 'Name', 'Title and company', 'Partner type', 'Why', 'Could refer', 'In Zoho', 'Connected'].forEach((h) => { const th = el('th', null, h); th.scope = 'col'; hr.append(th); });
    thead.append(hr); tbl.append(thead);
    const tb = el('tbody');
    slice.forEach((r) => {
      const tr = el('tr');
      const g = el('td'); g.append(gradePill(r.fit));
      const n = el('td'); n.append(personCell(r));
      const role = el('td', 'cc-mn-rolecell'); role.append(el('span', null, r.position || '—'), el('small', null, r.company || ''));
      tr.append(g, n, role, el('td', null, TYPE_NAME[r.type] || r.type || '—'), el('td', 'cc-mn-whycell', r.why || '—'), el('td', 'cc-mn-whycell', r.refer || '—'));
      const z = el('td'); z.append(crmCell(r)); tr.append(z, el('td', 'cc-mn-date', dayF(r.connected)));
      tb.append(tr);
    });
    tbl.append(tb);
    tableWrap.replaceChildren(slice.length ? tbl : el('p', 'cc-mn-empty', 'Nobody matches these filters.'));
    pager.replaceChildren();
    if (pages > 1) {
      const prev = el('button', 'cc-go', '← Previous'); prev.type = 'button'; prev.disabled = st.page === 0;
      prev.addEventListener('click', () => { st.page -= 1; drawList(); listCard.scrollIntoView({ block: 'start' }); });
      const next = el('button', 'cc-go', 'Next →'); next.type = 'button'; next.disabled = st.page >= pages - 1;
      next.addEventListener('click', () => { st.page += 1; drawList(); listCard.scrollIntoView({ block: 'start' }); });
      pager.append(prev, el('span', 'cc-mn-pnum', `Page ${st.page + 1} of ${pages} · rows ${intF(st.page * PAGE + 1)}–${intF(st.page * PAGE + slice.length)}`), next);
    }
  };

  const draw = () => {
    const s = status('mn_rows');
    if (s !== 'ok') {
      const missing = status('mack_network') === 'error' || (status('mack_network') === 'ok' && !rows('mack_network').length);
      head.hidden = false; typesCard.hidden = true; shortCard.hidden = true; listCard.hidden = true;
      stats.replaceChildren();
      sub.textContent = missing ? 'Mack’s LinkedIn analysis isn’t loaded on this dashboard. It lives on the private Claude dashboard only.' : (s === 'error' ? 'The connections or Zoho contacts didn’t load. Reload, or check the sources in the dashboard menu.' : 'Loading Mack’s connections and Zoho contacts…');
      note.textContent = '';
      return;
    }
    typesCard.hidden = false; shortCard.hidden = false; listCard.hidden = false;
    allRows = rows('mn_rows');
    drawHead(allRows);
    drawTypes(allRows);
    drawShort(allRows);
    drawList();
    note.textContent = 'How the grades were made: every connection was read and graded against the profile of the partners who have signed with us or reached Priority 1: founders and principals of small IT, consulting and staffing firms, fractional executives, and advisors and coaches who sit with business owners. Grades use the LinkedIn title and company as of the export, so check the profile before outreach. Client signal marks senior leaders at mid-size companies in our ICP industries, who may be buyers rather than partners. Nothing on this tab is written to Zoho.';
  };
  dash.onData(draw);
})();
