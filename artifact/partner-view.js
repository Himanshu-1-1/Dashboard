/* Partner view (Hemang, Nov 1, 2026): a locked, full-screen view of one signed referral partner's referred client
   deals, for showing a partner the dashboard on a screen share. It opens from the Referrals tab, covers the whole page
   and makes everything under it inert until Exit, so nothing about another partner is on screen. It is a display
   mode, not access control: anyone who can open this dashboard can leave it. Loaded after the page script and
   b2b-today.js (calc rb_rows); uses the page's dash and the agreements calc. */
(() => {
  if (window.CC_PV) return;
  const LOST = ['Closed Lost', 'Closed Lost to Competition'];
  const slugOf = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const HASH_RE = /^#partner(?:=([a-z0-9-]+))?$/i;
  const COMM_RE = /^(\d+(?:\.\d+)?)\s*%(?:\s+(?:on|of)\s+(?:the\s+)?(?:revenue|deal(?:\s+value)?|deal\s+amount|amount|contract(?:\s+value)?))?\.?$/i;
  const commissionOf = (terms, amount, status) => {
    if (!terms) return { pct: null, value: null, why: 'none' };
    const m = String(terms).trim().match(COMM_RE);
    if (!m) return { pct: null, value: null, why: 'terms' };
    const pct = Number(m[1]);
    if (!(pct > 0 && pct <= 100)) return { pct: null, value: null, why: 'terms' };
    if (status === 'lost') return { pct, value: null, why: 'lost' };
    if (!(amount > 0)) return { pct, value: null, why: 'amount' };
    return { pct, value: Math.round(amount * pct) / 100, why: null };
  };
  const statusOf = (stage) => (stage === 'Closed' ? 'won' : LOST.includes(stage) ? 'lost' : 'open');
  const STAGE_LABEL = { won: 'Won', lost: 'Lost' };

  dash.calc('pv_partners', {
    title: 'Signed referral partners and the client deals they referred',
    description: 'One row per party with a signed Referral Partner Agreement (with a URL slug from their name, made unique when two names match) in Zoho Sign (agreements calc: signed once any copy is signed; internal test sends left out), with the client deals they referred (rb_rows: every Deal Type except Reseller/ Referral Partner and Platform Provider Agreement, so their own agreement deal never shows). A deal belongs to a partner when its Referred By Contact is that partner, or when it has no Referred By Contact and its Referred By Account is the partner’s company; for an agreement signed by a company with no contact, every deal whose Referred By Account is that company. Stages: Closed shows as Won, Closed Lost and Closed Lost to Competition as Lost, the rest as in Zoho. Commission comes from the deal’s Commission Details text in Zoho: when it is a plain percentage of the deal (such as 20%, 10% on Revenue) it is that share of the Amount, earned on won deals and potential on active ones; other terms (on margin, conditional) are shown as written and not totaled; lost deals earn none. Dates are Central time.',
    inputs: ['agreements', 'rb_rows'],
    fn: (agreements, rb_rows) => {
      const seen = new Set();
      return agreements
        .filter((a) => a.kind === 'Referral agreement' && a.state === 'Signed')
        .filter((a) => { if (seen.has(a.key)) return false; seen.add(a.key); return true; })
        .map((a) => {
          const cid = a.contact_id ? String(a.contact_id) : null;
          const aid = a.account_id ? String(a.account_id) : null;
          const mine = (d) => (cid
            ? d.by_id === cid || (!d.by_id && Boolean(aid) && d.by_account_id === aid)
            : Boolean(aid) && d.by_account_id === aid);
          const deals = rb_rows.filter(mine).map((d) => {
            const status = statusOf(d.stage);
            const c = commissionOf(d.commission_terms, d.amount, status);
            return {
              id: d.id, deal: d.deal, client: d.account, client_contact: d.contact, stage: STAGE_LABEL[status] || d.stage || 'No stage',
              status, created: d.created, modified: d.modified || null, amount: d.amount,
              commission_terms: d.commission_terms || null, commission_pct: c.pct, commission: c.value, commission_why: c.why,
            };
          });
          const firm = a.account && a.account !== '—' && a.account !== a.partner ? a.account : null;
          return {
            key: a.key, name: a.partner || firm || 'Partner', firm, contact_id: cid, account_id: aid,
            signed_on: String(a.completed || a.sent || '').slice(0, 10) || null, deals,
          };
        })
        .sort((x, y) => x.name.localeCompare(y.name))
        .map((p, i, all) => {
          const base = slugOf(p.name) || 'partner';
          const clash = all.some((q, j) => j !== i && (slugOf(q.name) || 'partner') === base);
          return { ...p, slug: clash ? base + '-' + String(p.contact_id || p.account_id || i).slice(-6) : base };
        });
    },
  });

  /* Who each partner introduced us to (Hemang, Nov 7, 2026): the Contacts field "Introduced By (Contact)" read the
     other way round, so a partner's page lists the people they put in front of us. Its own calc, not an input to
     pv_partners, so the Partner view still works wherever this dataset isn't in the build. */
  /* The Introduced By section's own dataset. Registered here rather than in the page script so both copies of the
     dashboard pick it up from this one file (Hemang, Nov 7, 2026); a copy whose data has no introductions dataset
     simply never fills it, and pv_intros then has no rows. */
  dash.loader('introductions', {
    description: 'Zoho’s COQL answer as rows: a lookup becomes its name (and _id), a multi-select becomes text.',
    fn: ({ answer }) => {
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
    },
  });

  dash.calc('pv_intros', {
    title: 'People each partner introduced',
    description: 'Every Zoho contact whose Introduced By (Contact) is set, grouped by the person who introduced them: name, company, title, email, phone, relationship type and the date the contact was created in Zoho.',
    inputs: ['introductions'],
    fn: (introductions) => {
      const by = new Map();
      introductions.forEach((r) => {
        const id = r.Introduced_By_Contact_id ? String(r.Introduced_By_Contact_id) : null;
        if (!id) return;
        if (!by.has(id)) by.set(id, []);
        by.get(id).push({
          id: String(r.id), name: r.Full_Name || '—', account: r.Account_Name || null,
          account_id: r.Account_Name_id ? String(r.Account_Name_id) : null, title: r.Title || null,
          email: r.Email || null, phone: r.Phone || null,
          rel: r.Relationship_Type || null, added: r.Created_Time ? String(r.Created_Time).slice(0, 10) : null,
        });
      });
      return [...by.entries()].map(([id, people]) => ({
        introducer_id: id,
        people: people.sort((a, b) => String(b.added || '').localeCompare(String(a.added || ''))),
      }));
    },
  });

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
  const fmtMoney = (v) => (v > 0 ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v) : '—');
  const ZOHO = 'https://crm.zoho.com/crm/org899412015/tab/';
  const zLink = (cls, text, module, id, title) => {
    if (!id) return el(cls === 'h2' ? 'h2' : 'span', cls === 'h2' ? 'cc-pv-name' : null, text);
    const a = el('a', 'cc-pv-zlink', text);
    a.href = ZOHO + module + '/' + encodeURIComponent(id);
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = title;
    if (cls !== 'h2') return a;
    const h = el('h2', 'cc-pv-name');
    h.append(a);
    return h;
  };
  const fmtCents = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v || 0);
  const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

  const st = { open: false, key: null, want: null, active: -1, list: [], overlay: null, inerted: [] };
  const setHash = (h) => { try { history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch (err) { /* sandboxed frame */ } };

  const partners = () => { const d = dash.data('pv_partners'); return d && d.status === 'ok' ? d.data || [] : null; };
  const loadState = () => { const d = dash.data('pv_partners'); return d ? d.status : 'loading'; };
  const loadError = () => { const d = dash.data('pv_partners'); return (d && (d.error || d.message)) || 'the agreements or deals did not load'; };

  const matches = (all, q) => {
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter((p) => (p.name + ' ' + (p.firm || '')).toLowerCase().includes(s));
  };

  const renderList = (ui) => {
    const all = partners() || [];
    st.list = matches(all, ui.input.value);
    ui.listbox.replaceChildren();
    if (!st.list.length) {
      const li = el('li', 'cc-pv-opt-none', all.length ? 'No signed partner matches that name.' : 'No signed referral partners yet.');
      li.setAttribute('role', 'presentation');
      ui.listbox.append(li);
    }
    st.list.forEach((p, i) => {
      const li = el('li', 'cc-pv-opt');
      li.id = 'cc-pv-opt-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === st.active));
      li.append(el('span', 'cc-pv-opt-name', p.name));
      if (p.firm) li.append(el('span', 'cc-pv-opt-firm', p.firm));
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => choose(ui, p));
      ui.listbox.append(li);
    });
    if (st.active >= 0 && st.list[st.active]) ui.input.setAttribute('aria-activedescendant', 'cc-pv-opt-' + st.active);
    else ui.input.removeAttribute('aria-activedescendant');
  };
  const openList = (ui) => { if (loadState() !== 'ok') return; ui.listbox.hidden = false; ui.input.setAttribute('aria-expanded', 'true'); renderList(ui); };
  const closeList = (ui) => { ui.listbox.hidden = true; ui.input.setAttribute('aria-expanded', 'false'); ui.input.removeAttribute('aria-activedescendant'); st.active = -1; };
  const choose = (ui, p) => {
    st.key = p.key;
    st.want = null;
    ui.input.value = p.name;
    setHash('partner=' + p.slug);
    closeList(ui);
    renderBody(ui);
    ui.input.blur();
  };

  const COMM_WHY = { terms: 'Terms aren’t a plain percentage of the deal', amount: 'No deal amount yet', lost: 'Lost deal, no commission', none: 'No terms recorded' };
  const commCell = (d) => {
    const td = el('td', 'cc-pv-num');
    if (d.commission != null) td.textContent = fmtCents(d.commission);
    else { td.textContent = '—'; td.title = COMM_WHY[d.commission_why] || ''; }
    return td;
  };
  const commissionCard = (deals) => {
    const sec = el('section', 'cc-pv-card cc-pv-comm');
    sec.append(el('h3', 'cc-pv-card-title', 'Commission'));
    const withTerms = deals.filter((d) => d.commission_terms);
    if (!withTerms.length) {
      sec.append(el('p', 'cc-pv-empty', 'No commission terms are recorded in Zoho for these deals yet.'));
      return sec;
    }
    const earned = deals.filter((d) => d.status === 'won' && d.commission != null).reduce((s, d) => s + d.commission, 0);
    const potential = deals.filter((d) => d.status === 'open' && d.commission != null).reduce((s, d) => s + d.commission, 0);
    const row = el('div', 'cc-pv-comm-row');
    const big = el('div', 'cc-pv-comm-total');
    big.append(el('span', 'cc-pv-comm-v', fmtCents(earned + potential)), el('span', 'cc-pv-stat-l', 'Total commission'));
    const parts = el('div', 'cc-pv-comm-parts');
    parts.append(stat(fmtCents(earned), 'Earned on won deals'), stat(fmtCents(potential), 'Potential on active deals'));
    row.append(big, parts);
    sec.append(row);
    const open = withTerms.filter((d) => d.status !== 'lost' && d.commission == null);
    if (open.length) {
      const ul = el('ul', 'cc-pv-comm-list');
      open.forEach((d) => { const li = el('li'); li.append(el('strong', null, d.deal), document.createTextNode(` · ${d.commission_terms} · ${d.commission_why === 'amount' ? 'no deal amount yet' : 'not included in the total'}`)); ul.append(li); });
      sec.append(el('p', 'cc-pv-note', 'Terms on record that the total can’t include:'), ul);
    }
    sec.append(el('p', 'cc-pv-note', 'Commission is the deal’s Commission Details in Zoho applied to its Amount. Lost deals earn none.'));
    return sec;
  };
  /* The Introduced By section: who this partner put in front of us. Null when the dataset isn't in the build, so the
     rest of the view is unaffected. */
  const introCard = (p) => {
    const d = dash.data('pv_intros');
    if (d.status !== 'ok') return null;
    const row = (d.data || []).find((x) => p.contact_id && x.introducer_id === String(p.contact_id));
    const people = row ? row.people : [];
    const card = el('section', 'cc-pv-card');
    card.append(el('h3', 'cc-pv-card-title', people.length ? `Introduced by ${p.name}: ${plural(people.length, 'person', 'people')}` : 'Introduced By'));
    if (!people.length) {
      card.append(el('p', 'cc-pv-empty', `No one in Zoho is recorded as introduced by ${p.name} yet. The Introduced By (Contact) field on a contact is what puts them here.`));
      return card;
    }
    const wrap = el('div', 'cc-pv-tablewrap');
    const table = el('table', 'cc-pv-table');
    const thead = el('thead');
    const hr = el('tr');
    ['Person', 'Company', 'Title', 'Email', 'Phone', 'Relationship', 'Added to Zoho'].forEach((t) => { const th = el('th', null, t); th.scope = 'col'; hr.append(th); });
    thead.append(hr);
    const tb = el('tbody');
    people.forEach((x) => {
      const tr = el('tr');
      const who = el('td', 'cc-pv-deal');
      who.append(zLink('a', x.name, 'Contacts', x.id, 'Open ' + x.name + ' in Zoho CRM'));
      const co = el('td');
      if (x.account && x.account_id) co.append(zLink('a', x.account, 'Accounts', x.account_id, 'Open ' + x.account + ' in Zoho CRM'));
      else co.textContent = x.account || '—';
      const mail = el('td', 'cc-pv-contactcell');
      if (x.email) { const a = el('a', 'cc-pv-mail', x.email); a.href = 'mailto:' + x.email; mail.append(a); } else mail.textContent = '—';
      const tel = el('td', 'cc-pv-contactcell');
      if (x.phone) { const a = el('a', 'cc-pv-mail', x.phone); a.href = 'tel:' + String(x.phone).replace(/[^+0-9]/g, ''); tel.append(a); } else tel.textContent = '—';
      tr.append(who, co, el('td', null, x.title || '—'), mail, tel, el('td', null, x.rel || '—'), el('td', null, fmtDate(x.added)));
      tb.append(tr);
    });
    table.append(thead, tb);
    wrap.append(table);
    card.append(wrap);
    card.append(el('p', 'cc-pv-note', 'From the Introduced By (Contact) field in Zoho; email and phone are theirs as Zoho holds them. Added to Zoho is the date the contact record was created, since Zoho records no date for the introduction itself.'));
    return card;
  };

  /* One card per step: the count, what it counts, and the amount of that group under a hairline (Hemang, Nov 7, 2026). */
  const stat = (value, label, amount) => {
    const d = el('div', 'cc-pv-stat');
    d.append(el('span', 'cc-pv-stat-v', value), el('span', 'cc-pv-stat-l', label));
    if (amount != null) d.append(el('span', 'cc-pv-stat-a', amount));
    return d;
  };

  const renderBody = (ui) => {
    const body = ui.body;
    body.replaceChildren();
    const ls = loadState();
    if (ls === 'loading') { body.append(el('p', 'cc-pv-empty', 'Loading signed partners and their deals…')); return; }
    if (ls !== 'ok') { body.append(el('p', 'cc-pv-empty', 'Partner view can’t load right now: ' + loadError() + '.')); return; }
    if (st.want) {
      const hit = (partners() || []).find((x) => x.slug === st.want);
      const asked = st.want;
      st.want = null;
      if (hit) { st.key = hit.key; ui.input.value = hit.name; }
      else {
        st.key = null;
        setHash('partner');
        body.append(el('p', 'cc-pv-empty', `This link names “${asked}”, which isn’t a signed partner. Choose a partner above.`));
        return;
      }
    }
    const p = (partners() || []).find((x) => x.key === st.key);
    if (!p) {
      st.key = null;
      body.append(el('p', 'cc-pv-empty', 'Choose a partner above. Only their referred deals will show.'));
      return;
    }
    const head = el('header', 'cc-pv-head');
    const who = el('div', 'cc-pv-who');
    who.append(p.contact_id
      ? zLink('h2', p.name, 'Contacts', p.contact_id, 'Open ' + p.name + ' in Zoho CRM: their record lists the deals they referred')
      : zLink('h2', p.name, 'Accounts', p.account_id, 'Open ' + p.name + ' in Zoho CRM: the account lists the deals it referred'));
    if (p.firm) who.append(el('p', 'cc-pv-firm', p.firm));
    const agree = el('p', 'cc-pv-agree');
    agree.append(el('span', 'cc-pv-agree-dot'), document.createTextNode(p.signed_on ? 'Referral agreement signed ' + fmtDate(p.signed_on) : 'Referral agreement signed'));
    who.append(agree);
    head.append(who);

    /* One card per step, each carrying its own amount (Hemang, Nov 6, 2026; one card rather than two, Nov 7): deals,
       active, won and lost. The old standalone Total amount and Won value cards are gone, because Deals and Won say it. */
    const deals = p.deals.slice();
    const sum = (list) => list.reduce((t, d) => t + (d.amount || 0), 0);
    const open = deals.filter((d) => d.status === 'open');
    const won = deals.filter((d) => d.status === 'won');
    const lost = deals.filter((d) => d.status === 'lost');
    const stats = el('div', 'cc-pv-stats');
    [[deals, deals.length === 1 ? 'Deal' : 'Deals'], [open, 'Active'], [won, 'Won'], [lost, 'Lost']].forEach(([list, label]) => {
      stats.append(stat(list.length.toLocaleString('en-US'), label, sum(list) > 0 ? fmtMoney(sum(list)) : '$0'));
    });
    head.append(stats);
    /* Zoho doesn't always carry an Amount, so say when a total is a floor rather than letting it read as the full value. */
    const noAmount = deals.filter((d) => !d.amount).length;
    if (noAmount) head.append(el('p', 'cc-pv-floor', `${noAmount === 1 ? 'One deal has' : noAmount + ' deals have'} no amount in Zoho, so the amounts above are a floor.`));
    body.append(head);

    const card = el('section', 'cc-pv-card');
    card.append(el('h3', 'cc-pv-card-title', deals.length ? `${plural(deals.length, 'deal', 'deals')} referred` : 'Deals referred'));
    const intro = introCard(p);
    if (!deals.length) {
      card.append(el('p', 'cc-pv-empty', 'No client deals are recorded as referred by this partner yet.'));
      body.append(card);
      if (intro) body.append(intro);
      return;
    }
    deals.sort((a, b) => String(b.modified || b.created || '').localeCompare(String(a.modified || a.created || '')));
    body.append(commissionCard(deals));
    const wrap = el('div', 'cc-pv-tablewrap');
    const table = el('table', 'cc-pv-table');
    const thead = el('thead');
    const hr = el('tr');
    [['Deal'], ['Client company'], ['Client contact'], ['Stage'], ['Created'], ['Last updated'], ['Amount', 'num'], ['Commission terms'], ['Commission', 'num']].forEach(([t, c]) => { const th = el('th', c ? 'cc-pv-' + c : null, t); th.scope = 'col'; hr.append(th); });
    thead.append(hr);
    const tb = el('tbody');
    deals.forEach((d) => {
      const tr = el('tr');
      const stage = el('td');
      stage.append(el('span', 'cc-pv-stage cc-pv-stage-' + d.status, d.stage));
      const dealTd = el('td', 'cc-pv-deal');
      dealTd.append(zLink('a', d.deal, 'Potentials', d.id, 'Open this deal in Zoho CRM'));
      tr.append(dealTd, el('td', null, d.client || '—'), el('td', null, d.client_contact || '—'), stage, el('td', null, fmtDate(d.created)), el('td', null, fmtDate(d.modified)), el('td', 'cc-pv-num', fmtMoney(d.amount)), el('td', 'cc-pv-terms', d.commission_terms || '—'), commCell(d));
      tb.append(tr);
    });
    table.append(thead, tb);
    wrap.append(table);
    card.append(wrap);
    card.append(el('p', 'cc-pv-note', 'Amounts and commission terms show where Zoho has them. Dates are Central time. Updated daily.'));
    body.append(card);
    if (intro) body.append(intro);
  };

  const build = () => {
    const overlay = el('div', 'cc-pv');
    overlay.id = 'cc-pv';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Partner view');
    const bar = el('div', 'cc-pv-bar');
    const label = el('label', 'cc-pv-label', 'Partner');
    label.htmlFor = 'cc-pv-input';
    const combo = el('div', 'cc-pv-combo');
    const input = el('input', 'cc-pv-input');
    input.id = 'cc-pv-input';
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'Type a signed partner’s name';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', 'cc-pv-list');
    const listbox = el('ul', 'cc-pv-list');
    listbox.id = 'cc-pv-list';
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-label', 'Signed referral partners');
    listbox.hidden = true;
    combo.append(input, listbox);
    const exit = el('button', 'cc-pv-exit', 'Exit partner view');
    exit.type = 'button';
    bar.append(label, combo, exit);
    const body = el('div', 'cc-pv-body');
    overlay.append(bar, body);
    const ui = { overlay, input, listbox, body, exit };

    input.addEventListener('focus', () => { input.select(); st.active = -1; openList(ui); });
    input.addEventListener('input', () => { st.active = 0; openList(ui); if (!st.list.length) st.active = -1; });
    input.addEventListener('blur', () => {
      closeList(ui);
      const p = (partners() || []).find((x) => x.key === st.key);
      input.value = p ? p.name : '';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (listbox.hidden) openList(ui);
        if (!st.list.length) return;
        st.active = e.key === 'ArrowDown' ? Math.min(st.list.length - 1, st.active + 1) : Math.max(0, st.active - 1);
        renderList(ui);
        const a = listbox.querySelector('[aria-selected="true"]');
        if (a) a.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const p = st.list[st.active >= 0 ? st.active : 0];
        if (!listbox.hidden && p && (st.active >= 0 || st.list.length === 1)) choose(ui, p);
      } else if (e.key === 'Escape') {
        if (!listbox.hidden) { e.preventDefault(); e.stopPropagation(); closeList(ui); }
      }
    });
    exit.addEventListener('click', close);
    return ui;
  };

  let ui = null;
  const open = (want) => {
    const slug = typeof want === 'string' && want ? want.toLowerCase() : null;
    if (st.open) {
      if (slug && ui) { st.want = slug; closeList(ui); renderBody(ui); }
      return;
    }
    st.open = true;
    st.key = null;
    st.want = slug;
    if (!ui) ui = build();
    ui.input.value = '';
    setHash(slug ? 'partner=' + slug : 'partner');
    st.inerted = [...document.body.children].filter((n) => n !== ui.overlay && !n.inert && n.tagName !== 'SCRIPT');
    st.inerted.forEach((n) => { n.inert = true; n.setAttribute('aria-hidden', 'true'); });
    document.body.append(ui.overlay);
    document.documentElement.classList.add('cc-pv-on');
    renderBody(ui);
    if (!slug) ui.input.focus();
    else ui.exit.focus();
  };
  const close = () => {
    if (!st.open) return;
    st.open = false;
    st.key = null;
    ui.overlay.remove();
    st.inerted.forEach((n) => { n.inert = false; n.removeAttribute('aria-hidden'); });
    st.inerted = [];
    document.documentElement.classList.remove('cc-pv-on');
    const refTab = document.getElementById('tab-ref');
    const refPage = document.getElementById('ref');
    if (refTab && refPage && refPage.hidden) refTab.click();
    setHash('ref');
    const btn = document.getElementById('cc-pv-open');
    if (btn) btn.focus();
  };
  const isLocked = () => {
    const gate = document.getElementById('cc-gate');
    return document.body.classList.contains('cc-locked') || Boolean(gate && !gate.hidden);
  };
  let waiting = null;
  const whenUnlocked = (fn) => {
    if (!isLocked()) { fn(); return; }
    if (waiting) waiting.disconnect();
    waiting = new MutationObserver(() => { if (!isLocked()) { waiting.disconnect(); waiting = null; fn(); } });
    waiting.observe(document.body, { attributes: true, attributeFilter: ['class', 'hidden'], subtree: true });
  };
  const fromHash = () => {
    if (isLocked()) { whenUnlocked(fromHash); return; }
    const m = location.hash.match(HASH_RE);
    if (m) open(m[1] || null);
    else if (st.open) close();
  };

  const mount = () => {
    const sec = document.getElementById('ref');
    if (!sec || document.getElementById('cc-pv-launch')) return;
    const box = el('div', 'cc-pv-launch');
    box.id = 'cc-pv-launch';
    const txt = el('div', 'cc-pv-launch-txt');
    txt.append(el('strong', null, 'Partner view'), el('span', null, 'Shows one signed partner’s referred deals and hides the rest of the dashboard, for a screen share. Pick the partner before you start sharing: the list shows every signed partner’s name. Its own link is this page’s address with #partner at the end (add =their-name, as the address shows once you pick, to open one partner straight away). The link still asks for the team passcode, so it’s for us, not for partners.'));
    const btn = el('button', 'cc-pv-open', 'Open partner view');
    btn.id = 'cc-pv-open';
    btn.type = 'button';
    btn.addEventListener('click', () => open());
    const acts = el('div', 'cc-pv-launch-acts');
    if (/^https?:$/.test(location.protocol) && /\.github\.io$/i.test(location.hostname)) {
      const copy = el('button', 'cc-pv-copy', 'Copy link');
      copy.type = 'button';
      copy.title = 'Copies this dashboard’s address that opens straight into Partner view';
      copy.addEventListener('click', async () => {
        const url = location.href.split('#')[0] + '#partner';
        try { await navigator.clipboard.writeText(url); copy.textContent = 'Link copied'; } catch (err) { copy.textContent = url; }
        setTimeout(() => { copy.textContent = 'Copy link'; }, 2500);
      });
      acts.append(copy);
    }
    acts.append(btn);
    box.append(txt, acts);
    const intro = sec.querySelector('.cc-intro');
    if (intro) intro.after(box); else sec.prepend(box);
  };

  dash.onData(() => { if (st.open && ui) { if (!ui.listbox.hidden) renderList(ui); renderBody(ui); } });
  window.CC_PV = { open, close };
  const start = () => { mount(); fromHash(); window.addEventListener('hashchange', fromHash); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
