/* Partner view (Hemang, Nov 1, 2026): a locked, full-screen view of one signed referral partner's referred client
   deals, for showing a partner the dashboard on a screen share. It opens from the Referrals tab, covers the whole page
   and makes everything under it inert until Exit, so nothing about another partner is on screen. It is a display
   mode, not access control: anyone who can open this dashboard can leave it. Loaded after the page script and
   b2b-today.js (calc rb_rows); uses the page's dash and the agreements calc. */
(() => {
  if (window.CC_PV) return;
  const LOST = ['Closed Lost', 'Closed Lost to Competition'];
  const statusOf = (stage) => (stage === 'Closed' ? 'won' : LOST.includes(stage) ? 'lost' : 'open');
  const STAGE_LABEL = { won: 'Won', lost: 'Lost' };

  dash.calc('pv_partners', {
    title: 'Signed referral partners and the client deals they referred',
    description: 'One row per party with a signed Referral Partner Agreement in Zoho Sign (agreements calc: signed once any copy is signed; internal test sends left out), with the client deals they referred (rb_rows: every Deal Type except Reseller/ Referral Partner and Platform Provider Agreement, so their own agreement deal never shows). A deal belongs to a partner when its Referred By Contact is that partner, or when it has no Referred By Contact and its Referred By Account is the partner’s company; for an agreement signed by a company with no contact, every deal whose Referred By Account is that company. Stages: Closed shows as Won, Closed Lost and Closed Lost to Competition as Lost, the rest as in Zoho. Dates are Central time.',
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
            return {
              id: d.id, deal: d.deal, client: d.account, client_contact: d.contact, stage: STAGE_LABEL[status] || d.stage || 'No stage',
              status, created: d.created, modified: d.modified || null, amount: d.amount,
            };
          });
          const firm = a.account && a.account !== '—' && a.account !== a.partner ? a.account : null;
          return {
            key: a.key, name: a.partner || firm || 'Partner', firm, contact_id: cid, account_id: aid,
            signed_on: String(a.completed || a.sent || '').slice(0, 10) || null, deals,
          };
        })
        .sort((x, y) => x.name.localeCompare(y.name));
    },
  });

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
  const fmtMoney = (v) => (v > 0 ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v) : '—');
  const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

  const st = { open: false, key: null, active: -1, list: [], overlay: null, inerted: [] };

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
    ui.input.value = p.name;
    closeList(ui);
    renderBody(ui);
    ui.input.blur();
  };

  const stat = (value, label) => { const d = el('div', 'cc-pv-stat'); d.append(el('span', 'cc-pv-stat-v', value), el('span', 'cc-pv-stat-l', label)); return d; };

  const renderBody = (ui) => {
    const body = ui.body;
    body.replaceChildren();
    const ls = loadState();
    if (ls === 'loading') { body.append(el('p', 'cc-pv-empty', 'Loading signed partners and their deals…')); return; }
    if (ls !== 'ok') { body.append(el('p', 'cc-pv-empty', 'Partner view can’t load right now: ' + loadError() + '.')); return; }
    const p = (partners() || []).find((x) => x.key === st.key);
    if (!p) {
      st.key = null;
      body.append(el('p', 'cc-pv-empty', 'Choose a partner above. Only their referred deals will show.'));
      return;
    }
    const head = el('header', 'cc-pv-head');
    const who = el('div', 'cc-pv-who');
    who.append(el('h2', 'cc-pv-name', p.name));
    if (p.firm) who.append(el('p', 'cc-pv-firm', p.firm));
    const agree = el('p', 'cc-pv-agree');
    agree.append(el('span', 'cc-pv-agree-dot'), document.createTextNode(p.signed_on ? 'Referral agreement signed ' + fmtDate(p.signed_on) : 'Referral agreement signed'));
    who.append(agree);
    head.append(who);

    const deals = p.deals.slice();
    const clients = new Set(deals.map((d) => d.client || 'deal:' + d.id)).size;
    const won = deals.filter((d) => d.status === 'won');
    const open = deals.filter((d) => d.status === 'open').length;
    const lost = deals.filter((d) => d.status === 'lost').length;
    const wonValue = won.reduce((s, d) => s + (d.amount || 0), 0);
    const stats = el('div', 'cc-pv-stats');
    stats.append(stat(clients.toLocaleString('en-US'), clients === 1 ? 'Client referred' : 'Clients referred'), stat(open.toLocaleString('en-US'), 'In progress'), stat(won.length.toLocaleString('en-US'), 'Won'), stat(lost.toLocaleString('en-US'), 'Lost'));
    if (wonValue > 0) stats.append(stat(fmtMoney(wonValue), 'Won value'));
    head.append(stats);
    body.append(head);

    const card = el('section', 'cc-pv-card');
    card.append(el('h3', 'cc-pv-card-title', deals.length ? `${plural(deals.length, 'deal', 'deals')} referred` : 'Deals referred'));
    if (!deals.length) {
      card.append(el('p', 'cc-pv-empty', 'No client deals are recorded as referred by this partner yet.'));
      body.append(card);
      return;
    }
    deals.sort((a, b) => String(b.modified || b.created || '').localeCompare(String(a.modified || a.created || '')));
    const wrap = el('div', 'cc-pv-tablewrap');
    const table = el('table', 'cc-pv-table');
    const thead = el('thead');
    const hr = el('tr');
    [['Deal'], ['Client company'], ['Client contact'], ['Stage'], ['Created'], ['Last updated'], ['Amount', 'num']].forEach(([t, c]) => { const th = el('th', c ? 'cc-pv-' + c : null, t); th.scope = 'col'; hr.append(th); });
    thead.append(hr);
    const tb = el('tbody');
    deals.forEach((d) => {
      const tr = el('tr');
      const stage = el('td');
      stage.append(el('span', 'cc-pv-stage cc-pv-stage-' + d.status, d.stage));
      tr.append(el('td', 'cc-pv-deal', d.deal), el('td', null, d.client || '—'), el('td', null, d.client_contact || '—'), stage, el('td', null, fmtDate(d.created)), el('td', null, fmtDate(d.modified)), el('td', 'cc-pv-num', fmtMoney(d.amount)));
      tb.append(tr);
    });
    table.append(thead, tb);
    wrap.append(table);
    card.append(wrap);
    card.append(el('p', 'cc-pv-note', 'Amounts show where one is set. Dates are Central time. Updated daily.'));
    body.append(card);
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
  const open = () => {
    if (st.open) return;
    st.open = true;
    st.key = null;
    if (!ui) ui = build();
    ui.input.value = '';
    st.inerted = [...document.body.children].filter((n) => n !== ui.overlay && !n.inert && n.tagName !== 'SCRIPT');
    st.inerted.forEach((n) => { n.inert = true; n.setAttribute('aria-hidden', 'true'); });
    document.body.append(ui.overlay);
    document.documentElement.classList.add('cc-pv-on');
    renderBody(ui);
    ui.input.focus();
  };
  const close = () => {
    if (!st.open) return;
    st.open = false;
    st.key = null;
    ui.overlay.remove();
    st.inerted.forEach((n) => { n.inert = false; n.removeAttribute('aria-hidden'); });
    st.inerted = [];
    document.documentElement.classList.remove('cc-pv-on');
    const btn = document.getElementById('cc-pv-open');
    if (btn) btn.focus();
  };

  const mount = () => {
    const sec = document.getElementById('ref');
    if (!sec || document.getElementById('cc-pv-launch')) return;
    const box = el('div', 'cc-pv-launch');
    box.id = 'cc-pv-launch';
    const txt = el('div', 'cc-pv-launch-txt');
    txt.append(el('strong', null, 'Partner view'), el('span', null, 'Shows one signed partner’s referred deals and hides the rest of the dashboard, for a screen share. Pick the partner before you start sharing: the list shows every signed partner’s name.'));
    const btn = el('button', 'cc-pv-open', 'Open partner view');
    btn.id = 'cc-pv-open';
    btn.type = 'button';
    btn.addEventListener('click', open);
    box.append(txt, btn);
    const intro = sec.querySelector('.cc-intro');
    if (intro) intro.after(box); else sec.prepend(box);
  };

  dash.onData(() => { if (st.open && ui) { if (!ui.listbox.hidden) renderList(ui); renderBody(ui); } });
  window.CC_PV = { open, close };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
