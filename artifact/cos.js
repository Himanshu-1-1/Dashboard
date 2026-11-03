/* Chief of Staff tab (Hemang, Nov 3, 2026): everything the Chief of Staff bot has read from work conversations, view-only.
   Telegram and WhatsApp groups and chats, team email, Fireflies call transcripts, Zoho activity, text the bot read from
   images, call summaries, commitments, partner notes, calendar meetings and the bot's notes on each person. Personal and
   family conversations are left out when the feed is built (scripts/cos_feed.mjs on Hemang's laptop, hourly). The full
   feed is large, so it is fetched only when this tab opens (window.CC_LAZY('cos_feed'), decrypted with the passcode key);
   the small cos_digest dataset feeds the concise lines on B2B Today. Nothing here writes anywhere: approvals stay in the
   Telegram bot. Uses the page's dash. */
(() => {
  const root = document.getElementById('cos-root');
  if (!root) return;
  const section = root.closest('.cc-page') || root;
  const ZOHO = 'https://crm.zoho.com/crm/org899412015/tab/';
  const PAGE = 40;
  const SRC = {
    telegram: 'Telegram', whatsapp: 'WhatsApp', m365_mail: 'Email', fireflies: 'Call', zoho_activity: 'Zoho', recording: 'Recording',
  };
  const SRC_ORDER = ['telegram', 'whatsapp', 'm365_mail', 'fireflies', 'zoho_activity', 'recording'];
  const REL = {
    self: 'You', internal: 'Our team', client: 'Client', prospect: 'Prospect', partner: 'Partner', referral_partner: 'Referral partner',
    advisor: 'Advisor', vendor: 'Vendor', third_party_vendor: 'Outside vendor', unknown: 'Not labeled',
  };
  const REL_GROUPS = [
    ['all', 'Everyone', null],
    ['client', 'Clients', ['client']],
    ['prospect', 'Prospects', ['prospect']],
    ['partner', 'Partners and advisors', ['partner', 'referral_partner', 'advisor']],
    ['team', 'Our team', ['internal', 'self']],
    ['vendor', 'Vendors', ['vendor', 'third_party_vendor']],
    ['unknown', 'Not labeled', ['unknown']],
  ];
  const VIEWS = [
    ['people', 'People'],
    ['chats', 'Groups and chats'],
    ['latest', 'Latest'],
    ['commitments', 'Commitments'],
    ['notes', 'Partner notes'],
  ];
  const STATUS = { open: 'Open', done: 'Done', dropped: 'Dropped' };

  /* ---------- helpers ---------- */
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const intF = (n) => Number(n || 0).toLocaleString('en-US');
  const plural = (n, one, many) => `${intF(n)} ${n === 1 ? one : many || one + 's'}`;
  const yearNow = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric' });
  const atF = (iso) => {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    const y = d.toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric' });
    return d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', ...(y === yearNow ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' }) + ' CT';
  };
  const dayF = (iso) => {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    const y = d.toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric' });
    return d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', ...(y === yearNow ? {} : { year: 'numeric' }) });
  };
  /* A due date stored as midnight UTC is a calendar date, not a moment: show it as written. */
  const dueF = (iso) => (/T00:00:00(?:\.0+)?Z$/.test(String(iso || '')) ? new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(String(iso).slice(0, 4) === yearNow ? {} : { year: 'numeric' }) }) : dayF(iso));
  const words = (s, n) => { const w = String(s || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean); return w.length > n ? w.slice(0, n).join(' ') + '…' : w.join(' '); };
  const zohoLink = (module, id, text) => { const a = el('a', 'cc-cos-zoho', text); a.href = ZOHO + module + '/' + id; a.target = '_blank'; a.rel = 'noopener'; return a; };
  const safeUrl = (u) => (/^https:\/\//i.test(String(u || '')) ? u : null);
  const btn = (cls, text, onClick, label) => { const b = el('button', cls, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); b.addEventListener('click', onClick); return b; };
  const wrap = (node) => { const w = el('div', 'cc-cos-wrap'); w.append(node); return w; };
  const table = (heads, rowsOut) => {
    const t = el('table', 'cc-tbl cc-cos-tbl');
    const th = el('thead'); const hr = el('tr');
    heads.forEach((h) => { const c = el('th', /^(Conversations|Messages|Open|People)$/.test(h) ? 'cc-num' : null, h); c.scope = 'col'; hr.append(c); });
    th.append(hr);
    const tb = el('tbody');
    rowsOut.forEach((cells) => {
      const tr = el('tr');
      cells.forEach((v) => {
        const td = el('td');
        if (v && typeof v === 'object' && v.cls) { td.className = v.cls; v = v.v; }
        if (v instanceof Node) td.append(v); else td.textContent = v == null || v === '' ? '—' : v;
        tr.append(td);
      });
      tb.append(tr);
    });
    t.append(th, tb);
    return wrap(t);
  };
  const chips = (list, current, onPick, label) => {
    const box = el('div', 'cc-cos-chips');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', label);
    list.forEach(([k, text]) => {
      const b = btn('cc-chip', text, () => onPick(k));
      b.setAttribute('aria-pressed', String(k === current));
      box.append(b);
    });
    return box;
  };
  const searchBox = (value, placeholder, onInput) => {
    const i = el('input', 'cc-search');
    i.type = 'search'; i.placeholder = placeholder; i.value = value; i.setAttribute('aria-label', placeholder);
    let t;
    i.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => onInput(i.value), 250); });
    return i;
  };
  const moreBtn = (shown, total, onMore, step = PAGE) => {
    if (shown >= total) return null;
    const left = total - shown;
    return btn('cc-go cc-cos-more', left > step ? `Show ${intF(step)} more (${intF(left)} left)` : `Show the last ${intF(left)}`, onMore);
  };
  /* The bot's memory notes are markdown files: drop the front matter, keep the text. */
  const memoryText = (s) => String(s || '').replace(/^---[\s\S]*?\n---\s*/, '').trim();

  /* ---------- data ---------- */
  let F = null;
  let loadState = 'idle';
  let loadMsg = '';
  const P = new Map();
  const byPerson = new Map();
  const chatsBy = new Map();
  const commitBy = new Map();
  const notesBy = new Map();
  const meetBy = new Map();
  let hay = null;
  const nameOf = (pid) => (P.get(pid) || {}).name || 'Someone';
  const senderOf = (it) => it.from || ((it.p || []).find(([, r]) => r === 'from' || r === 'sender') || [])[0] || null;
  const gistOf = (it) => {
    const t = it.sum || it.text || ((it.img || [])[0] || {}).text || '';
    return words(String(t).replace(/^(?:\[[A-Z0-9_-]+:[^\]]*\]\s*)+/, '').replace(/^[A-Z][A-Z /&-]{8,}(?:\([^)]*\)|:)\s*/, '').replace(/<?https?:\/\/[^\s>]+>?/g, '').replace(/\[cid:[^\]]*\]/g, ''), 20);
  };
  const index = () => {
    P.clear(); byPerson.clear(); chatsBy.clear(); commitBy.clear(); notesBy.clear(); meetBy.clear(); hay = null;
    F.people.forEach((p) => P.set(p.id, p));
    F.items.forEach((it, i) => {
      const seen = new Set();
      (it.p || []).forEach(([pid]) => { if (seen.has(pid)) return; seen.add(pid); if (!byPerson.has(pid)) byPerson.set(pid, []); byPerson.get(pid).push(i); });
      if (it.ck) {
        let c = chatsBy.get(it.ck);
        if (!c) { c = { ck: it.ck, name: it.chat || 'Chat', src: it.src, idx: [], people: new Set(), last: it.at }; chatsBy.set(it.ck, c); }
        c.idx.push(i);
        (it.p || []).forEach(([pid]) => c.people.add(pid));
        if (String(it.at) > String(c.last)) c.last = it.at;
      }
    });
    (F.commitments || []).forEach((c) => [c.owner, c.who].forEach((pid) => { if (pid) { if (!commitBy.has(pid)) commitBy.set(pid, []); commitBy.get(pid).push(c); } }));
    (F.partner_notes || []).forEach((n) => { if (n.pid) { if (!notesBy.has(n.pid)) notesBy.set(n.pid, []); notesBy.get(n.pid).push(n); } });
    (F.meetings || []).forEach((m) => (m.p || []).forEach((pid) => { if (!meetBy.has(pid)) meetBy.set(pid, []); meetBy.get(pid).push(m); }));
  };
  const haystack = () => {
    if (!hay) {
      hay = F.items.map((it) => [it.title, it.chat, it.org, it.text, it.sum, ...(it.img || []).map((x) => x.text), ...(it.p || []).map(([pid]) => nameOf(pid))]
        .filter(Boolean).join('\n').toLowerCase());
    }
    return hay;
  };
  const matches = (idxs, q) => {
    const t = String(q || '').trim().toLowerCase();
    if (!t) return idxs;
    const h = haystack();
    const parts = t.split(/\s+/);
    return idxs.filter((i) => parts.every((w) => h[i].includes(w)));
  };

  /* ---------- state ---------- */
  const st = {
    view: 'people', person: null, chat: null,
    people: { q: '', rel: 'all', shown: PAGE },
    chats: { q: '', src: 'all', shown: PAGE },
    latest: { q: '', src: 'all', shown: PAGE },
    commitments: { status: 'open', q: '', shown: PAGE * 2 },
    notes: { q: '', shown: PAGE * 2 },
    detail: { q: '', src: 'all', shown: PAGE },
  };
  let restoreScroll = null;

  /* ---------- skeleton ---------- */
  const head = el('div', 'cc-card cc-cos-head');
  const h2 = el('h2', null, 'Chief of Staff');
  const lede = el('p', 'cc-cos-lede', 'Everything the Chief of Staff bot has read from work conversations: Telegram and WhatsApp groups and chats, team email, call transcripts, Zoho activity and text it read from images, with its notes on each person, the commitments it found and its partner notes. Personal and family conversations are left out. View only: approvals stay in the Telegram bot.');
  const asof = el('p', 'cc-cos-asof');
  const stats = el('div', 'cc-cos-stats');
  head.append(h2, lede, stats, asof);
  const views = el('div', 'cc-cos-views');
  views.setAttribute('role', 'tablist');
  views.setAttribute('aria-label', 'Chief of Staff views');
  const body = el('div', 'cc-card cc-cos-body');
  body.setAttribute('aria-live', 'polite');
  root.replaceChildren(head, views, body);

  const drawViews = () => {
    views.replaceChildren(...VIEWS.map(([k, label]) => {
      const b = btn('cc-cos-viewtab', label, () => { st.view = k; st.person = null; st.chat = null; draw(); });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(st.view === k && !st.person && !st.chat));
      return b;
    }));
    views.hidden = !F;
  };

  /* ---------- one conversation item ---------- */
  const itemNode = (it, opts = {}) => {
    const a = el('article', 'cc-cos-item');
    a.dataset.src = it.src;
    const h = el('header', 'cc-cos-ihead');
    h.append(el('span', 'cc-cos-src cc-cos-src-' + it.src, SRC[it.src] || it.src));
    const t = el('time', 'cc-cos-when', atF(it.at)); t.dateTime = it.at || ''; h.append(t);
    const from = senderOf(it);
    if (from) h.append(personBtn(from, 'cc-cos-from'));
    const others = (it.p || []).filter(([pid, r]) => pid !== from && r !== 'from' && r !== 'sender').map(([pid]) => pid);
    if (others.length && it.src !== 'telegram' && it.src !== 'whatsapp') {
      const to = el('span', 'cc-cos-to');
      to.append(document.createTextNode(it.src === 'fireflies' ? 'with ' : 'to '));
      others.slice(0, 4).forEach((pid, i) => { if (i) to.append(document.createTextNode(', ')); to.append(personBtn(pid)); });
      if (others.length > 4) to.append(document.createTextNode(` and ${intF(others.length - 4)} more`));
      h.append(to);
    }
    if (it.chat && !opts.inChat) h.append(chatBtn(it.ck, it.chat));
    a.append(h);
    if (it.title) a.append(el('p', 'cc-cos-title', it.title));
    const blocks = el('div', 'cc-cos-blocks');
    if (it.sum) {
      const s = el('div', 'cc-cos-sum');
      s.append(el('span', 'cc-cos-lab', it.src === 'fireflies' ? 'Call summary' : 'Summary'), el('p', null, it.sum));
      if (Array.isArray(it.dec) && it.dec.length) {
        const ul = el('ul', 'cc-cos-dec');
        it.dec.forEach((d) => ul.append(el('li', null, typeof d === 'string' ? d : (d && (d.text || d.decision)) || JSON.stringify(d))));
        s.append(el('span', 'cc-cos-lab', 'Decisions'), ul);
      }
      blocks.append(s);
    }
    if (it.text) blocks.append(el('div', 'cc-cos-text', it.text));
    (it.img || []).forEach((x) => {
      const d = el('div', 'cc-cos-img');
      d.append(el('span', 'cc-cos-lab', /pdf/i.test(x.mime) ? 'Text read from a PDF' : /image/i.test(x.mime) ? 'Text read from an image' : 'Text read from a file'), el('div', 'cc-cos-text', x.text));
      blocks.append(d);
    });
    if (!it.text && !it.sum && !(it.img || []).length) blocks.append(el('p', 'cc-cos-empty', it.kind ? `No text (${String(it.kind).replace(/_/g, ' ')})` : 'No text'));
    a.append(blocks);
    const len = (it.text || '').length + (it.sum || '').length + (it.img || []).reduce((n, x) => n + x.text.length, 0);
    const foot = el('footer', 'cc-cos-ifoot');
    if (len > 700 || /(\n.*){9,}/.test(it.text || '')) {
      blocks.classList.add('cc-cos-clamp');
      const tog = btn('cc-cos-link', 'Show all', () => {
        const open = blocks.classList.toggle('cc-cos-clamp');
        tog.textContent = open ? 'Show all' : 'Show less';
        tog.setAttribute('aria-expanded', String(!open));
      });
      tog.setAttribute('aria-expanded', 'false');
      foot.append(tog);
    }
    const url = safeUrl(it.link);
    if (url) {
      const l = el('a', 'cc-cos-link', it.src === 'm365_mail' ? 'Open in Outlook' : it.src === 'fireflies' ? 'Open in Fireflies' : 'Open the source');
      l.href = url; l.target = '_blank'; l.rel = 'noopener';
      foot.append(l);
    }
    if (foot.childNodes.length) a.append(foot);
    return a;
  };
  const personBtn = (pid, cls) => {
    const p = P.get(pid);
    if (!p) return el('span', cls || null, 'Someone');
    if (p.rel === 'self') return el('span', 'cc-cos-self ' + (cls || ''), p.name);
    const b = btn('cc-cos-name ' + (cls || ''), p.name, () => openPerson(pid), `Open ${p.name}`);
    return b;
  };
  const chatBtn = (ck, name) => btn('cc-cos-chat', name, () => openChat(ck), `Open the chat ${name}`);
  const itemList = (idxs, shownKey, onMore, opts) => {
    const box = el('div', 'cc-cos-items');
    const shown = idxs.slice(0, st[shownKey].shown);
    shown.forEach((i) => box.append(itemNode(F.items[i], opts)));
    const more = moreBtn(shown.length, idxs.length, () => { st[shownKey].shown += PAGE; onMore(); });
    if (more) box.append(more);
    if (!idxs.length) box.append(el('p', 'cc-cos-empty', 'Nothing matches.'));
    return box;
  };
  const srcChips = (idxs, current, onPick) => {
    const n = {};
    idxs.forEach((i) => { const s = F.items[i].src; n[s] = (n[s] || 0) + 1; });
    const list = [['all', `All ${intF(idxs.length)}`], ...SRC_ORDER.filter((s) => n[s]).map((s) => [s, `${SRC[s]} ${intF(n[s])}`])];
    return chips(list, current, onPick, 'Source');
  };

  /* ---------- people ---------- */
  const personSummary = (pid) => {
    const idxs = byPerson.get(pid) || [];
    let last = null; let gist = null;
    for (const i of idxs) { const it = F.items[i]; if (!last) last = it; if (!gist && it.src !== 'zoho_activity' && (it.text || it.sum || it.img)) { gist = it; break; } }
    const cs = commitBy.get(pid) || [];
    return { n: idxs.length, last, gist: gist || last, open: cs.filter((c) => c.status === 'open').length };
  };
  const drawPeople = () => {
    const s = st.people;
    const group = REL_GROUPS.find(([k]) => k === s.rel) || REL_GROUPS[0];
    const q = s.q.trim().toLowerCase();
    let list = F.people.filter((p) => p.rel !== 'self' && (!group[2] || group[2].includes(p.rel)));
    if (q) list = list.filter((p) => [p.name, p.org, p.title, ...(p.ids || []).map((x) => x[1])].filter(Boolean).join(' ').toLowerCase().includes(q));
    const sum = new Map(list.map((p) => [p.id, personSummary(p.id)]));
    list.sort((a, b) => String((sum.get(b.id).last || {}).at || '').localeCompare(String((sum.get(a.id).last || {}).at || '')));
    const counts = Object.fromEntries(REL_GROUPS.map(([k, , rels]) => [k, F.people.filter((p) => p.rel !== 'self' && (!rels || rels.includes(p.rel))).length]));
    const tools = el('div', 'cc-cos-tools');
    tools.append(searchBox(s.q, 'Search people, companies, emails', (v) => { s.q = v; s.shown = PAGE; draw(); }),
      chips(REL_GROUPS.map(([k, label]) => [k, `${label} ${intF(counts[k])}`]), s.rel, (k) => { s.rel = k; s.shown = PAGE; draw(); }, 'Relationship'));
    const rowsOut = list.slice(0, s.shown).map((p) => {
      const x = sum.get(p.id);
      const nm = el('span', 'cc-cos-pcell');
      nm.append(personBtn(p.id));
      if (p.zoho_id) nm.append(zohoLink('Contacts', p.zoho_id, 'Zoho'));
      return [nm, REL[p.rel] || p.rel, p.org || '', x.last ? `${dayF(x.last.at)}, ${SRC[x.last.src] || x.last.src}` : '',
        { cls: 'cc-num', v: intF(x.n) }, { cls: 'cc-num', v: x.open ? intF(x.open) : '' }, { cls: 'cc-cos-gistcell', v: x.gist ? gistOf(x.gist) : '' }];
    });
    const cap = el('p', 'cc-cos-cap', `${plural(list.length, 'person', 'people')}, most recent conversation first. Select a name for everything the bot holds on them.`);
    const parts = [tools, cap, table(['Name', 'Relationship', 'Company', 'Last contact', 'Conversations', 'Open', 'Latest'], rowsOut)];
    const more = moreBtn(Math.min(s.shown, list.length), list.length, () => { s.shown += PAGE; draw(); });
    if (more) parts.push(more);
    body.replaceChildren(...parts);
  };

  const openPerson = (pid) => {
    restoreScroll = null;
    st.person = pid; st.chat = null;
    st.detail = { q: '', src: 'all', shown: PAGE };
    draw();
    root.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const drawPerson = () => {
    const p = P.get(st.person);
    if (!p) { st.person = null; draw(); return; }
    const s = st.detail;
    const back = btn('cc-go cc-cos-back', 'Back', () => { st.person = null; draw(); });
    const title = el('div', 'cc-cos-ptitle');
    title.append(el('h3', null, p.name));
    if (p.zoho_id) title.append(zohoLink('Contacts', p.zoho_id, 'Open in Zoho'));
    else if (p.zoho_lead) title.append(zohoLink('Leads', p.zoho_lead, 'Open the Zoho lead'));
    const facts = el('dl', 'cc-cos-facts');
    const fact = (k, v) => { if (!v) return; facts.append(el('dt', null, k)); const dd = el('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; facts.append(dd); };
    fact('Relationship', REL[p.rel] || p.rel);
    fact('Title', p.title);
    fact('Company', p.zoho_account && p.org ? zohoLink('Accounts', p.zoho_account, p.org) : p.org);
    const ids = p.ids || [];
    const idOf = (kind) => ids.filter(([k]) => k === kind).map(([, v]) => v);
    fact('Email', idOf('email').join(', '));
    fact('Phone', idOf('phone').join(', '));
    fact('Telegram', [...idOf('telegram_username').map((v) => '@' + String(v).replace(/^@/, ''))].join(', '));
    fact('WhatsApp name', idOf('whatsapp_name').join(', '));
    const parts = [back, title, facts];
    const mem = memoryText(p.memory);
    if (mem) {
      const d = el('details', 'cc-cos-mem');
      d.open = true;
      d.append(el('summary', null, 'What the bot knows about them'), el('div', 'cc-cos-text', mem));
      parts.push(d);
    }
    const cs = (commitBy.get(p.id) || []).slice().sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || String(b.upd || b.at).localeCompare(String(a.upd || a.at)));
    if (cs.length) {
      parts.push(el('h4', 'cc-cos-sub', `Commitments (${intF(cs.filter((c) => c.status === 'open').length)} open of ${intF(cs.length)})`), commitTable(cs.slice(0, 20)));
      if (cs.length > 20) parts.push(el('p', 'cc-cos-cap', `The 20 most relevant shown; the Commitments view lists all ${intF(cs.length)}.`));
    }
    const ns = (notesBy.get(p.id) || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (ns.length) parts.push(el('h4', 'cc-cos-sub', `Partner notes (${intF(ns.length)})`), notesTable(ns));
    const ms = (meetBy.get(p.id) || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (ms.length) parts.push(el('h4', 'cc-cos-sub', `Calendar meetings (${intF(ms.length)})`), table(['When', 'Meeting', 'Calendar', 'Status'], ms.map((m) => [atF(m.at), m.title || '', m.box || '', m.cancelled ? 'Cancelled' : new Date(m.at) > new Date() ? 'Coming up' : 'Held'])));
    const all = byPerson.get(p.id) || [];
    const bySrc = s.src === 'all' ? all : all.filter((i) => F.items[i].src === s.src);
    const idxs = matches(bySrc, s.q);
    parts.push(el('h4', 'cc-cos-sub', `Conversations (${intF(all.length)}), newest first`));
    const tools = el('div', 'cc-cos-tools');
    tools.append(searchBox(s.q, `Search ${p.name}’s conversations`, (v) => { s.q = v; s.shown = PAGE; draw(); }), srcChips(all, s.src, (k) => { s.src = k; s.shown = PAGE; draw(); }));
    parts.push(tools, itemList(idxs, 'detail', draw));
    body.replaceChildren(...parts);
  };

  /* ---------- groups and chats ---------- */
  const drawChats = () => {
    const s = st.chats;
    const all = [...chatsBy.values()];
    const q = s.q.trim().toLowerCase();
    let list = all.filter((c) => (s.src === 'all' || c.src === s.src) && (!q || c.name.toLowerCase().includes(q)));
    list.sort((a, b) => String(b.last).localeCompare(String(a.last)));
    const n = { telegram: all.filter((c) => c.src === 'telegram').length, whatsapp: all.filter((c) => c.src === 'whatsapp').length };
    const tools = el('div', 'cc-cos-tools');
    tools.append(searchBox(s.q, 'Search chat names', (v) => { s.q = v; draw(); }),
      chips([['all', `All ${intF(all.length)}`], ['telegram', `Telegram ${intF(n.telegram)}`], ['whatsapp', `WhatsApp ${intF(n.whatsapp)}`]], s.src, (k) => { s.src = k; draw(); }, 'Source'));
    const rowsOut = list.map((c) => {
      const last = F.items[c.idx[0]];
      return [chatBtn(c.ck, c.name), SRC[c.src], { cls: 'cc-num', v: intF(c.idx.length) }, { cls: 'cc-num', v: intF(c.people.size) }, atF(c.last), { cls: 'cc-cos-gistcell', v: last ? gistOf(last) : '' }];
    });
    body.replaceChildren(tools, el('p', 'cc-cos-cap', `${plural(list.length, 'group or chat', 'groups and chats')} the bot reads, most recent first.`), table(['Chat', 'Source', 'Messages', 'People', 'Last message', 'Latest'], rowsOut));
  };
  const openChat = (ck) => {
    st.chat = ck; st.person = null;
    st.detail = { q: '', src: 'all', shown: PAGE };
    draw();
    root.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const drawChat = () => {
    const c = chatsBy.get(st.chat);
    if (!c) { st.chat = null; draw(); return; }
    const s = st.detail;
    const back = btn('cc-go cc-cos-back', 'Back', () => { st.chat = null; draw(); });
    const title = el('div', 'cc-cos-ptitle');
    title.append(el('h3', null, c.name), el('span', 'cc-cos-src cc-cos-src-' + c.src, SRC[c.src]));
    const people = [...c.people].filter((pid) => P.has(pid) && P.get(pid).rel !== 'self').sort((a, b) => (byPerson.get(b) || []).length - (byPerson.get(a) || []).length);
    const who = el('p', 'cc-cos-who');
    who.append(document.createTextNode(`${plural(c.idx.length, 'message')} from ${plural(people.length, 'person', 'people')}: `));
    people.slice(0, 24).forEach((pid, i) => { if (i) who.append(document.createTextNode(', ')); who.append(personBtn(pid)); });
    if (people.length > 24) who.append(document.createTextNode(` and ${intF(people.length - 24)} more`));
    const idxs = matches(c.idx, s.q);
    const tools = el('div', 'cc-cos-tools');
    tools.append(searchBox(s.q, `Search ${c.name}`, (v) => { s.q = v; s.shown = PAGE; draw(); }));
    body.replaceChildren(back, title, who, tools, itemList(idxs, 'detail', draw, { inChat: true }));
  };

  /* ---------- latest ---------- */
  const drawLatest = () => {
    const s = st.latest;
    const all = F.items.map((_, i) => i);
    const bySrc = s.src === 'all' ? all : all.filter((i) => F.items[i].src === s.src);
    const idxs = matches(bySrc, s.q);
    const tools = el('div', 'cc-cos-tools');
    tools.append(searchBox(s.q, 'Search every conversation', (v) => { s.q = v; s.shown = PAGE; draw(); }), srcChips(all, s.src, (k) => { s.src = k; s.shown = PAGE; draw(); }));
    body.replaceChildren(tools, el('p', 'cc-cos-cap', s.q.trim() ? `${plural(idxs.length, 'conversation')} match, newest first.` : 'Every work conversation, newest first.'), itemList(idxs, 'latest', draw));
  };

  /* ---------- commitments ---------- */
  const commitTable = (list) => table(['What', 'Owner', 'With', 'Due', 'Status', 'Found'], list.map((c) => {
    const what = el('div', 'cc-cos-what');
    what.append(el('span', null, c.text));
    if (c.quote) what.append(el('q', 'cc-cos-quote', c.quote));
    if (c.status !== 'open' && c.why_closed) what.append(el('small', 'cc-cos-why', c.why_closed));
    const due = c.due ? dueF(c.due) : '';
    const late = c.status === 'open' && c.due && String(c.due).slice(0, 10) < new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    return [what, c.owner ? personBtn(c.owner) : '', c.who ? personBtn(c.who) : '', late ? { cls: 'cc-cos-late', v: `${due}, overdue` } : due, STATUS[c.status] || c.status, dayF(c.at)];
  }));
  const drawCommitments = () => {
    const s = st.commitments;
    const all = F.commitments || [];
    const n = { open: 0, done: 0, dropped: 0 };
    all.forEach((c) => { n[c.status] = (n[c.status] || 0) + 1; });
    const q = s.q.trim().toLowerCase();
    let list = all.filter((c) => (s.status === 'all' || c.status === s.status) && (!q || [c.text, c.quote, nameOf(c.owner), nameOf(c.who)].join(' ').toLowerCase().includes(q)));
    const dueKey = (c) => (c.due ? String(c.due) : '9999');
    list = list.sort((a, b) => (s.status === 'open' ? dueKey(a).localeCompare(dueKey(b)) : 0) || String(b.upd || b.at).localeCompare(String(a.upd || a.at)));
    const tools = el('div', 'cc-cos-tools');
    tools.append(searchBox(s.q, 'Search commitments', (v) => { s.q = v; s.shown = PAGE * 2; draw(); }),
      chips([['open', `Open ${intF(n.open)}`], ['done', `Done ${intF(n.done)}`], ['dropped', `Dropped ${intF(n.dropped)}`], ['all', `All ${intF(all.length)}`]], s.status, (k) => { s.status = k; s.shown = PAGE * 2; draw(); }, 'Status'));
    const parts = [tools, el('p', 'cc-cos-cap', `Promises the bot found in conversations (who owes what to whom). ${s.status === 'open' ? 'Soonest due first; no due date last.' : 'Most recently updated first.'} The bot’s own approvals happen in Telegram.`), commitTable(list.slice(0, s.shown))];
    const more = moreBtn(Math.min(s.shown, list.length), list.length, () => { s.shown += PAGE * 2; draw(); }, PAGE * 2);
    if (more) parts.push(more);
    body.replaceChildren(...parts);
  };

  /* ---------- partner notes ---------- */
  const notesTable = (list) => table(['Date', 'Partner', 'Group', 'Note', 'Status'], list.map((n) => [dayF(n.at), n.pid ? personBtn(n.pid) : n.name || '', n.group || '', { cls: 'cc-cos-notecell', v: n.text }, n.status ? String(n.status).replace(/_/g, ' ') : '']));
  const drawNotes = () => {
    const s = st.notes;
    const q = s.q.trim().toLowerCase();
    const list = (F.partner_notes || []).filter((n) => !q || [n.text, n.name, n.group, nameOf(n.pid)].join(' ').toLowerCase().includes(q)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const tools = el('div', 'cc-cos-tools');
    tools.append(searchBox(s.q, 'Search partner notes', (v) => { s.q = v; s.shown = PAGE * 2; draw(); }));
    const parts = [tools, el('p', 'cc-cos-cap', `${plural(list.length, 'note')} the bot took on partners from the team’s groups, newest first.`), notesTable(list.slice(0, s.shown))];
    const more = moreBtn(Math.min(s.shown, list.length), list.length, () => { s.shown += PAGE * 2; draw(); }, PAGE * 2);
    if (more) parts.push(more);
    body.replaceChildren(...parts);
  };

  /* ---------- header and routing ---------- */
  const stat = (n, label, onClick) => {
    const b = btn('cc-cos-stat', '', onClick);
    b.append(el('b', null, intF(n)), el('span', null, label));
    return b;
  };
  const drawHead = () => {
    if (!F) { stats.replaceChildren(); asof.textContent = ''; return; }
    const open = (F.commitments || []).filter((c) => c.status === 'open').length;
    stats.replaceChildren(
      stat(F.people.filter((p) => p.rel !== 'self').length, 'people', () => { st.view = 'people'; st.person = null; st.chat = null; draw(); }),
      stat(chatsBy.size, 'groups and chats', () => { st.view = 'chats'; st.person = null; st.chat = null; draw(); }),
      stat(F.items.length, 'conversations', () => { st.view = 'latest'; st.person = null; st.chat = null; draw(); }),
      stat(open, 'open commitments', () => { st.view = 'commitments'; st.commitments.status = 'open'; st.person = null; st.chat = null; draw(); }),
    );
    const by = (F.stats && F.stats.by_source) || {};
    asof.textContent = `Built ${atF(F.built_at)} from the bot’s database (${SRC_ORDER.filter((s) => by[s]).map((s) => `${SRC[s]} ${intF(by[s])}`).join(', ')}). It refreshes hourly while Hemang’s laptop is on; ${plural((F.stats || {}).dropped_personal || 0, 'personal or family item')} left out.`;
  };
  const draw = () => {
    drawViews();
    drawHead();
    if (!F) {
      const parts = [el('p', loadState === 'error' ? 'cc-cos-bad' : 'cc-cos-cap', loadMsg || 'Loading the Chief of Staff feed…')];
      if (loadState === 'error') parts.push(btn('cc-go', 'Try again', () => { loadState = 'idle'; ensure(); }));
      body.replaceChildren(...parts);
      return;
    }
    if (st.person) drawPerson();
    else if (st.chat) drawChat();
    else ({ people: drawPeople, chats: drawChats, latest: drawLatest, commitments: drawCommitments, notes: drawNotes }[st.view] || drawPeople)();
  };

  const ensure = () => {
    if (loadState === 'loading' || loadState === 'ok' || loadState === 'none') return;
    if (typeof window.CC_LAZY !== 'function') { loadState = 'none'; loadMsg = 'The Chief of Staff feed is on the passcode-locked public dashboard only.'; draw(); return; }
    loadState = 'loading'; loadMsg = 'Loading the Chief of Staff feed (about 10 MB, once per visit)…'; draw();
    window.CC_LAZY('cos_feed').then((feed) => {
      if (!feed || !Array.isArray(feed.items)) {
        loadState = 'none';
        loadMsg = 'The Chief of Staff feed isn’t in this build yet. It arrives from Hemang’s laptop once the hourly task has pushed it; the next site build picks it up.';
        draw();
        return;
      }
      F = feed;
      index();
      loadState = 'ok';
      draw();
    }).catch((err) => {
      loadState = 'error';
      loadMsg = `The Chief of Staff feed didn’t load: ${err && err.message ? err.message : err}`;
      draw();
    });
  };
  /* Fetch only when the tab is shown. */
  /* Wait for the unlock: before it, the lazy file list isn't known yet. */
  const visible = () => !section.hidden && dash.data('cos_digest').status !== 'loading';
  new MutationObserver(() => { if (visible()) ensure(); }).observe(section, { attributes: true, attributeFilter: ['hidden'] });
  dash.onData(() => { if (visible()) ensure(); });
  draw();
})();
