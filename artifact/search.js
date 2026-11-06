/* Contact search (Hemang, Nov 6, 2026): a search bar above the tabs for recalling a person.
   Type a name, a company or an email and every Zoho contact is matched as you type, from `qa_contact_rows`, which is
   already in the locked bundle. Opening one assembles a brief for that person in the browser from everything the
   dashboard holds: Zoho (deals, tasks, meetings, agreements), the team Outlook mail and calendars, Fireflies calls, the
   partner meeting briefs, Mack's LinkedIn conversations, and the Chief of Staff feed (Telegram, WhatsApp, email, call
   transcripts, text read from images, commitments, partner notes and the bot's own notes on them).
   The feed is a 10 MB file, so it loads only when a brief is first opened (`window.CC_LAZY('cos_feed')`): the names match
   instantly, and the history fills in a moment later.
   Read-only, like the rest of the page. The draft message follows the same rule as the Founder Network tab: an email
   when there's mail on record, a LinkedIn message when they're connected, else a connection note.
   Loads after the page script; uses the page's `dash`. */
(() => {
  const host = document.getElementById('cc-find');
  if (!host) return;

  const ZOHO = 'https://crm.zoho.com/crm/org899412015/tab/';
  const MAX_HITS = 8;
  const PAGE = 12;
  /* A reply is still worth owing inside this many days; after that it's a follow-up, not a reply. */
  const REPLY_DAYS = 30;
  const QUIET_DAYS = 30;
  const SRC = { telegram: 'Telegram', whatsapp: 'WhatsApp', m365_mail: 'Email', fireflies: 'Call', zoho_activity: 'Zoho', recording: 'Recording' };
  const SRC_ORDER = ['telegram', 'whatsapp', 'm365_mail', 'fireflies', 'zoho_activity', 'recording'];
  const CAMP = { rp: 'B2B', icp: 'ICP', fn: 'Founder Network', mc: 'Medical Courier', none: '' };
  /* Priority order for ranking equal matches: live prospects first, restricted records last. */
  const PRI_RANK = { 1: 0, 99: 1, 3: 2, 5: 3, 11: 8, 9: 9 };

  /* ---------- helpers ---------- */
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (cls, text, onClick, label) => { const b = el('button', cls, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); b.addEventListener('click', onClick); return b; };
  const D = (id) => { try { return dash.data(id); } catch (err) { return { status: 'error', data: [] }; } };
  const rows = (id) => D(id).data || [];
  const ok = (id) => D(id).status === 'ok';
  const okRows = (id) => (ok(id) ? rows(id) : []);
  const intF = (n) => Number(n || 0).toLocaleString('en-US');
  const plural = (n, one, many) => `${intF(n)} ${n === 1 ? one : many || one + 's'}`;
  const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

  const yearNow = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric' });
  const ctDay = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); };
  const todayCT = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const dayMs = (d) => (d ? Date.parse(d + 'T00:00:00Z') : NaN);
  const agoDays = (iso) => { const d = ctDay(iso); return d ? Math.round((dayMs(todayCT()) - dayMs(d)) / 864e5) : null; };
  const dayF = (iso) => {
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? iso + 'T12:00:00Z' : iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    const y = d.toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric' });
    return d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', ...(y === yearNow ? {} : { year: 'numeric' }) });
  };
  const atF = (iso) => {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    const y = d.toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric' });
    return d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', ...(y === yearNow ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' }) + ' CT';
  };
  const monthF = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'long', year: 'numeric' }); };
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9@. ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const firstName = (name) => String(name || '').split(',')[0].trim().split(/\s+/)[0] || 'there';
  /* Company names read better in a sentence without their legal ending. */
  const cleanCo = (s) => String(s || '').replace(/\s*(,?\s*(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|pvt|private|gmbh|s\.a|pte)\.?)+$/i, '').trim();
  const zohoLink = (module, id, text, cls) => { const a = el('a', cls || 'cc-fd-zoho', text); a.href = ZOHO + module + '/' + id; a.target = '_blank'; a.rel = 'noopener'; return a; };
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : null);
  /* The bot's memory notes are markdown with front matter. */
  const memoryText = (s) => String(s || '').replace(/^---[\s\S]*?\n---\s*/, '').trim();
  const gistOf = (s) => String(s || '').replace(/^(?:\[[A-Z0-9_-]+:[^\]]*\]\s*)+/, '').replace(/\[cid:[^\]]*\]/g, '').replace(/<?https?:\/\/[^\s>]+>?/g, '').replace(/\s+/g, ' ').trim();

  /* ---------- the contact index ---------- */
  let idx = null;
  let byId = null;
  const buildIndex = () => {
    if (!ok('qa_contact_rows')) return null;
    const list = rows('qa_contact_rows').map((r) => {
      const name = String(r.name || '').replace(/^—$/, '').trim();
      const nn = norm(name);
      return {
        ...r,
        nn,
        toks: nn.split(' ').filter(Boolean),
        nacct: norm(r.account),
        nmail: norm(r.email || r.email2 || ''),
        ntitle: norm(r.title),
      };
    }).filter((r) => r.nn);
    byId = new Map(list.map((r) => [r.id, r]));
    return list;
  };
  const index = () => { if (!idx) idx = buildIndex(); return idx || []; };

  /* Per-contact evidence of recent activity, used only to break ties between equal name matches. */
  let weight = null;
  const weightOf = (id) => {
    if (!weight) {
      weight = new Map();
      okRows('cos_digest').forEach((c) => weight.set(String(c.zoho_id), Math.min(40, Number(c.n || 0))));
    }
    const r = byId && byId.get(id);
    return (weight.get(id) || 0) + (r ? Math.min(20, r.meetings * 4 + r.deals * 6) : 0);
  };

  /* Tiered match: the earlier the tier, the better the hit. Every query word must appear somewhere. */
  const search = (q) => {
    const nq = norm(q);
    if (nq.length < 2) return [];
    const parts = nq.split(' ').filter(Boolean);
    const out = [];
    for (const r of index()) {
      const hay = `${r.nn} ${r.nacct} ${r.nmail} ${r.ntitle}`;
      if (!parts.every((p) => hay.includes(p))) continue;
      let tier = 5;
      if (r.nn.startsWith(nq)) tier = 0;
      else if (r.toks.some((t) => t.startsWith(nq))) tier = 1;
      else if (r.nn.includes(nq)) tier = 2;
      else if (r.nacct.startsWith(nq)) tier = 3;
      else if (r.nacct.includes(nq) || r.nmail.includes(nq)) tier = 4;
      out.push({ r, tier });
    }
    out.sort((a, b) => a.tier - b.tier
      || (PRI_RANK[a.r.priority] ?? 5) - (PRI_RANK[b.r.priority] ?? 5)
      || weightOf(b.r.id) - weightOf(a.r.id)
      || a.r.nn.localeCompare(b.r.nn));
    return out.map((x) => x.r);
  };

  /* ---------- the Chief of Staff feed (loaded on first open) ---------- */
  let feed = null;
  let feedState = 'idle';
  let feedMsg = '';
  const feedIndex = { byZoho: new Map(), items: new Map(), commits: new Map(), notes: new Map(), meets: new Map() };
  const indexFeed = () => {
    (feed.people || []).forEach((p) => { if (p.zoho_id) feedIndex.byZoho.set(String(p.zoho_id), p); });
    const push = (map, k, v) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
    (feed.items || []).forEach((it) => {
      const seen = new Set();
      (it.p || []).forEach(([pid]) => { if (!seen.has(pid)) { seen.add(pid); push(feedIndex.items, pid, it); } });
      if (it.from && !seen.has(it.from)) push(feedIndex.items, it.from, it);
    });
    (feed.commitments || []).forEach((c) => { [c.owner, c.who].forEach((pid) => push(feedIndex.commits, pid, c)); });
    (feed.partner_notes || []).forEach((n) => push(feedIndex.notes, n.pid, n));
    (feed.meetings || []).forEach((m) => (m.p || []).forEach((pid) => push(feedIndex.meets, pid, m)));
  };
  const loadFeed = () => {
    if (feedState !== 'idle') return Promise.resolve();
    if (typeof window.CC_LAZY !== 'function') { feedState = 'none'; feedMsg = 'The Chief of Staff history is on the passcode-locked site only.'; return Promise.resolve(); }
    feedState = 'loading';
    return window.CC_LAZY('cos_feed').then((f) => {
      if (!f || !Array.isArray(f.items)) { feedState = 'none'; feedMsg = 'The Chief of Staff history isn’t in this build yet.'; return; }
      feed = f;
      indexFeed();
      feedState = 'ok';
    }).catch((err) => { feedState = 'error'; feedMsg = `The Chief of Staff history didn’t load: ${err && err.message ? err.message : err}`; });
  };

  /* ---------- assembling one person's brief ---------- */
  const agreementFor = (z) => {
    if (!ok('agreements')) return null;
    const rank = { Signed: 4, 'Out for signature': 3, 'Expired, not re-sent': 2, Declined: 1 };
    let best = null;
    okRows('agreements').filter((a) => a.kind !== 'MNDA').forEach((a) => {
      const mine = (a.contact_id && String(a.contact_id) === z.id) || (!a.contact_id && z.account_id && String(a.account_id) === String(z.account_id));
      if (!mine) return;
      if (!best || (rank[a.state] || 0) > (rank[best.state] || 0)) best = a;
    });
    return best;
  };

  const gather = (id) => {
    const z = byId.get(id);
    const b = { z, id };
    b.deals = okRows('deals_tagged').filter((d) => String(d.contact_id || '') === id)
      .sort((x, y) => String(y.updated || '').localeCompare(String(x.updated || '')));
    b.tasks = okRows('open_tasks').filter((t) => String(t.Who_Id_id || '') === id)
      .sort((x, y) => String(x.Due_Date || '9999').localeCompare(String(y.Due_Date || '9999')));
    b.ag = agreementFor(z);
    b.mtg = okRows('mtg_people').find((m) => String(m.id) === id) || null;
    b.mail = okRows('b2b_mail_people').find((m) => String(m.id) === id) || null;
    b.li = okRows('b2b_li_people').find((m) => String(m.id) === id && m.in_export) || null;
    b.brief = okRows('b2b_briefs').find((x) => String(x.zoho_id) === id) || null;
    b.digest = okRows('cos_digest').find((c) => String(c.zoho_id) === id) || null;

    /* Meetings. For a B2B prospect `mtg_people` has already reconciled Zoho, Outlook and Fireflies; for everyone else
       the Zoho Events list and the feed's calendar and calls are combined the same way, one Central-time day each. */
    const held = new Map();
    const mark = (iso, src) => { const d = ctDay(iso); if (!d) return; const h = held.get(d) || { day: d, srcs: new Set() }; h.srcs.add(src); held.set(d, h); };
    let next = null;
    const keepNext = (iso) => { if (iso && (!next || iso < next)) next = iso; };
    const now = new Date().toISOString();
    if (b.mtg) {
      (b.mtg.sources || []).forEach((s) => { const h = { day: s.day, srcs: new Set() }; if (s.zoho) h.srcs.add('Zoho'); if (s.outlook) h.srcs.add('Outlook'); if (s.fireflies) h.srcs.add('Fireflies'); held.set(s.day, h); });
      next = b.mtg.next || null;
    } else {
      okRows('meetings').filter((m) => String(m.Who_Id_id || '') === id).forEach((m) => {
        if (!m.Start_DateTime) return;
        if (m.Start_DateTime > now) keepNext(m.Start_DateTime); else mark(m.Start_DateTime, 'Zoho');
      });
      const p = feedIndex.byZoho.get(id);
      if (p) {
        (feedIndex.meets.get(p.id) || []).forEach((m) => { if (m.cancelled) return; if (m.at > now) keepNext(m.at); else mark(m.at, 'Outlook'); });
        (feedIndex.items.get(p.id) || []).forEach((it) => { if (it.src === 'fireflies') mark(it.at, 'Fireflies'); });
      }
    }
    b.days = [...held.values()].sort((x, y) => x.day.localeCompare(y.day));
    b.n = b.days.length;
    b.last = b.n ? b.days[b.n - 1].day : null;
    b.next = next;
    b.since = b.last ? Math.round((dayMs(todayCT()) - dayMs(b.last)) / 864e5) : null;

    /* The conversation history and everything the bot holds on them. */
    const p = feedIndex.byZoho.get(id);
    b.person = p || null;
    b.items = p ? (feedIndex.items.get(p.id) || []) : [];
    b.commits = p ? (feedIndex.commits.get(p.id) || []).slice().sort((x, y) => (x.status === 'open' ? 0 : 1) - (y.status === 'open' ? 0 : 1) || String(y.upd || y.at).localeCompare(String(x.upd || x.at))) : [];
    b.notes = p ? (feedIndex.notes.get(p.id) || []).slice().sort((x, y) => String(y.at).localeCompare(String(x.at))) : [];
    b.openCommits = b.commits.filter((c) => c.status === 'open');
    b.lastCall = b.items.find((it) => it.src === 'fireflies' && (it.sum || it.text)) || null;
    b.lastIn = b.items.find((it) => it.dir === 'inbound' || (it.from && it.from === (p && p.id))) || null;
    b.lastAny = b.items[0] || null;

    /* Who owes whom a reply, newest first. */
    const waits = [];
    if (b.mail && b.mail.status === 'They wrote last' && b.mail.last_in && agoDays(b.mail.last_in) <= REPLY_DAYS) waits.push({ ch: 'email', at: b.mail.last_in });
    if (b.li && b.li.reply_needed && b.li.last_in) waits.push({ ch: 'LinkedIn message', at: b.li.last_in });
    if (b.lastIn && agoDays(b.lastIn.at) <= REPLY_DAYS && b.lastIn.src !== 'zoho_activity') waits.push({ ch: SRC[b.lastIn.src] === 'Email' ? 'email' : `${SRC[b.lastIn.src] || b.lastIn.src} message`, at: b.lastIn.at });
    waits.sort((x, y) => String(y.at).localeCompare(String(x.at)));
    b.reply = !b.next && waits.length && (!b.last || ctDay(waits[0].at) > b.last) ? waits[0] : null;
    return b;
  };

  /* The one next step, first match wins — the same order the B2B Today plan uses, widened to contacts outside B2B. */
  const stepFor = (b) => {
    const ask = b.brief && Array.isArray(b.brief.ask_next) && b.brief.ask_next.length ? clip(b.brief.ask_next[0], 110) : '';
    const overdue = b.tasks.find((t) => t.Due_Date && t.Due_Date < todayCT());
    const openDeal = b.deals.find((d) => !/^Closed/i.test(String(d.stage || '')));
    if (b.z.dnc) return { text: 'Do not contact: this record is marked Do Not Contact in Zoho.', tone: 'bad' };
    if (b.reply) return { text: `Reply to their ${b.reply.ch} of ${dayF(b.reply.at)}`, tone: 'now' };
    if (b.ag && b.ag.state === 'Out for signature') return { text: `Chase the signature on the referral agreement${b.ag.sent ? ` sent ${dayF(b.ag.sent)}` : ''}`, tone: 'now' };
    if (b.next) return { text: `Prepare for ${atF(b.next)}${b.brief ? '; read their meeting brief below' : ''}`, tone: 'ok' };
    if (b.ag && b.ag.state === 'Expired, not re-sent') return { text: 'Re-send the referral agreement; the last copy expired', tone: 'now' };
    if (overdue) return { text: `Close or re-date the overdue task: ${clip(overdue.Subject, 90)}`, tone: 'now' };
    const loose = b.openCommits.find((c) => !b.tasks.some((t) => sameWork(t.Subject, c.text)));
    if (loose) return { text: `Settle the open commitment: ${clip(loose.text, 110)}`, tone: 'now' };
    if (!b.n) return { text: b.z.li === 'Requested' ? 'The LinkedIn request is still pending: follow it up, or try email' : 'Ask for a first meeting', tone: 'ok' };
    if (openDeal && openDeal.next_step) return { text: `${clip(openDeal.next_step, 110)} (from the deal ${openDeal.deal})`, tone: 'ok' };
    if (b.since != null && b.since >= QUIET_DAYS) return { text: `Suggest a follow-up call; last met ${dayF(b.last)}${ask ? `. Ask next: ${ask}` : ''}`, tone: 'ok' };
    return { text: `Follow up on the meeting of ${dayF(b.last)}${ask ? `: ${ask}` : ''}`, tone: 'ok' };
  };

  /* A Zoho task and a commitment the bot found in a conversation are often the same promise written twice, so the
     shorter wording inside the longer counts as one item with both sources named. */
  const sig = (t) => norm(t).replace(/\b(the|a|an|to|for|and|with|on|of|in|our|their|his|her|them|please)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const sameWork = (x, y) => {
    const a = sig(x); const c = sig(y);
    if (!a || !c || a.length < 8 || c.length < 8) return false;
    const [shortS, longS] = a.length <= c.length ? [a, c] : [c, a];
    return longS.includes(shortS) && shortS.length / longS.length > 0.5;
  };

  /* Everything still open on this person, each with where it came from. */
  const todoFor = (b) => {
    const out = [];
    if (b.reply) out.push({ what: `A reply is owed on their ${b.reply.ch} of ${dayF(b.reply.at)}`, src: 'Conversations' });
    b.tasks.forEach((t) => {
      const late = t.Due_Date && t.Due_Date < todayCT();
      out.push({ key: 'task-' + t.id, what: clip(t.Subject, 120), when: t.Due_Date ? `${late ? 'Overdue since' : 'Due'} ${dayF(t.Due_Date)}` : 'No due date', late, src: 'Zoho task' });
    });
    b.openCommits.forEach((c) => {
      const twin = b.tasks.find((t) => sameWork(t.Subject, c.text));
      if (twin) {
        const row = out.find((o) => o.key === 'task-' + twin.id);
        if (row) { row.src = 'Zoho task, also found in a conversation'; return; }
      }
      out.push({
        what: clip(c.text, 140),
        when: c.due ? `${c.due.slice(0, 10) < todayCT() ? 'Overdue since' : 'Due'} ${dayF(c.due)}` : 'No date given',
        late: Boolean(c.due && c.due.slice(0, 10) < todayCT()),
        src: 'Found in a conversation',
      });
    });
    if (b.ag && b.ag.state === 'Out for signature') out.push({ what: `The referral agreement is out for signature${b.ag.sent ? `, sent ${dayF(b.ag.sent)}` : ''}`, when: b.ag.days_left != null ? `${plural(b.ag.days_left, 'day')} to the deadline` : '', late: b.ag.days_left != null && b.ag.days_left < 0, src: 'Zoho Sign' });
    if (b.ag && b.ag.state === 'Expired, not re-sent') out.push({ what: 'The referral agreement expired and hasn’t been re-sent', late: true, src: 'Zoho Sign' });
    if (b.mtg && (b.mtg.to_log || []).length) out.push({ what: `${plural(b.mtg.to_log.length, 'meeting')} on the team calendar that Zoho doesn’t show as Completed`, when: b.mtg.to_log.map((x) => dayF(x.day)).join(', '), src: 'Outlook vs Zoho' });
    if (b.mtg && (b.mtg.unmarked || []).length) out.push({ what: `${plural(b.mtg.unmarked.length, 'past Zoho meeting')} still Scheduled or blank; mark them Completed`, when: b.mtg.unmarked.map((x) => dayF(x.day)).join(', '), src: 'Zoho' });
    b.deals.filter((d) => !/^Closed/i.test(String(d.stage || ''))).forEach((d) => out.push({ what: `Deal open at ${d.stage}: ${clip(d.deal, 90)}${d.next_step ? ` — ${clip(d.next_step, 80)}` : ''}`, when: d.updated ? `Last updated ${dayF(d.updated)}` : '', late: d.updated ? agoDays(d.updated) >= 14 : false, src: 'Zoho deal' }));
    return out;
  };

  /* The draft, by the same rule as the Founder Network tab: email when there's mail on record, a LinkedIn message when
     they're connected, else a connection note of 300 characters at most. What it says follows the evidence. */
  const draftFor = (b) => {
    const first = firstName(b.z.name);
    const co = cleanCo(b.z.account);
    const at = co ? ` at ${co}` : '';
    const owner = b.z.assigned ? String(b.z.assigned).trim().split(/\s+/)[0] : null;
    /* The sign-off is added per channel at the end, so a LinkedIn message never carries an email's "Best,". */
    const signOff = (ch) => (ch === 'Email' ? (owner ? `\n\nBest,\n${owner}` : '\n\nBest,') : owner ? `\n\n${owner}` : '');
    const ask = b.brief && Array.isArray(b.brief.ask_next) && b.brief.ask_next.length ? clip(b.brief.ask_next[0], 140) : '';
    const hasMail = Boolean(b.z.email) && Boolean((b.mail && (b.mail.n_in || b.mail.n_out)) || (b.digest && b.digest.last && b.digest.last.m365_mail));
    const connected = b.z.li === 'Connected' || (b.li && b.li.actual === 'connected');

    let subject = null; let body = null; let why = '';
    if (b.reply) {
      subject = b.lastCall && b.lastCall.title ? `Re: ${clip(b.lastCall.title, 60)}` : 'Following up';
      body = `Hi ${first},\n\nThanks for your note of ${dayF(b.reply.at)}, and sorry for the slow reply.${ask ? `\n\n${ask}` : ''}\n\nWould a short call in the next few days work to pick this up?`;
      why = `They wrote last on ${dayF(b.reply.at)}, so this answers them.`;
    } else if (b.ag && b.ag.state === 'Out for signature') {
      subject = 'Referral agreement';
      body = `Hi ${first},\n\nJust a nudge on the referral agreement we sent${b.ag.sent ? ` on ${dayF(b.ag.sent)}` : ''} — it’s still waiting on a signature. Happy to walk through anything in it before you sign.\n\nAnything you’d like changed?`;
      why = 'The agreement is out for signature and unsigned.';
    } else if (b.next) {
      subject = 'Before we meet';
      body = `Hi ${first},\n\nLooking forward to our meeting on ${dayF(b.next)}.${ask ? ` I’d like to cover ${ask.charAt(0).toLowerCase() + ask.slice(1)}` : ''}\n\nIs there anything you’d like on the agenda?`;
      why = `A meeting is booked for ${dayF(b.next)}.`;
    } else if (!b.n) {
      subject = 'A short call?';
      body = `Hi ${first}, I hope all is well${at}. I’d like to hear what you’re working on these days and see where we might be useful to each other.\n\nWould you be open to 20 minutes in the next couple of weeks?`;
      why = 'No meeting has been held or booked with them yet.';
    } else {
      subject = 'Picking this back up';
      const when = b.last ? ` since we spoke on ${dayF(b.last)}` : '';
      body = `Hi ${first},\n\nIt’s been a while${when}, and I’d like to pick the conversation back up.${ask ? ` Last time we left it that ${ask.charAt(0).toLowerCase() + ask.slice(1)}` : ''}\n\nWould 20 minutes in the next couple of weeks work?`;
      why = b.last ? `You last met on ${dayF(b.last)}${b.since != null ? `, ${plural(b.since, 'day')} ago` : ''}.` : 'You have met before, with nothing booked now.';
    }

    if (hasMail) {
      const last = b.mail && b.mail.last_out ? monthF(b.mail.last_out) : null;
      return { channel: 'Email', subject, body: body + signOff('Email'), to: b.z.email || null, basis: `${why} Email, because there’s mail with them on record${last ? `, last sent ${last}` : ''}.` };
    }
    if (connected) {
      return { channel: 'LinkedIn message', subject: null, body: body + signOff('LinkedIn'), to: safeUrl(b.z.linkedin), basis: `${why} A LinkedIn message, because they’re connected and there’s no email with them on record.` };
    }
    if (b.z.email) {
      return { channel: 'Email', subject, body: body + signOff('Email'), to: b.z.email, basis: `${why} Email, because that’s the only address on the record.` };
    }
    let note = `Hi ${first}, I’d like to connect and hear what you’re working on${at}.${signOff('LinkedIn')}`;
    if (note.length > 300) note = `Hi ${first}, I’d like to connect and hear what you’re working on.${signOff('LinkedIn')}`;
    return { channel: 'LinkedIn connection note', subject: null, body: note, to: safeUrl(b.z.linkedin), basis: `${why} A connection note of 300 characters at most, because there’s no email and no connection on record.` };
  };

  /* ---------- the search bar ---------- */
  const form = el('form', 'cc-fd-form');
  form.setAttribute('role', 'search');
  const input = el('input', 'cc-fd-input');
  input.type = 'search';
  input.id = 'cc-fd-input';
  input.placeholder = 'Search a contact — name, company or email';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', 'cc-fd-hits');
  input.setAttribute('aria-label', 'Search a contact by name, company or email');
  const hint = el('kbd', 'cc-fd-kbd', '/');
  const hits = el('ul', 'cc-fd-hits');
  hits.id = 'cc-fd-hits';
  hits.setAttribute('role', 'listbox');
  hits.hidden = true;
  const note = el('p', 'cc-fd-note');
  note.setAttribute('role', 'status');
  /* The list and the match count share one drop-down, so the count is readable while results are open. */
  const pop = el('div', 'cc-fd-pop');
  pop.hidden = true;
  pop.append(hits, note);
  /* The magnifier is an element, not a background image, so it follows the theme's text color. */
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'cc-fd-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4.4-4.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  const row = el('div', 'cc-fd-row');
  row.append(icon, input, hint, pop);
  form.append(row);
  form.addEventListener('submit', (e) => { e.preventDefault(); if (shown[cursor]) open(shown[cursor].id); });
  host.replaceChildren(form);

  let shown = [];
  let cursor = 0;
  let total = 0;
  const closeHits = () => { pop.hidden = true; hits.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  /* The list scrolls to follow the keyboard, never the mouse: a pointer resting over the drop-down shouldn't move it. */
  const mark = (scroll) => {
    [...hits.children].forEach((li, i) => {
      const on = i === cursor;
      li.classList.toggle('cc-fd-on', on);
      li.setAttribute('aria-selected', String(on));
      if (!on) return;
      input.setAttribute('aria-activedescendant', li.id);
      if (!scroll) return;
      /* Scroll only when the row is actually out of view, so picking the first result never nudges the list. */
      const top = li.offsetTop - hits.scrollTop;
      if (top < 0) hits.scrollTop = Math.max(0, li.offsetTop - 4);
      else if (top + li.offsetHeight > hits.clientHeight) hits.scrollTop = li.offsetTop + li.offsetHeight - hits.clientHeight + 4;
    });
  };
  const render = () => {
    const q = input.value.trim();
    if (!ok('qa_contact_rows')) { shown = []; closeHits(); return; }
    if (q.length < 2) { shown = []; closeHits(); return; }
    const found = search(q);
    total = found.length;
    shown = found.slice(0, MAX_HITS);
    cursor = 0;
    hits.replaceChildren(...shown.map((r, i) => {
      const li = el('li', 'cc-fd-hit');
      li.id = 'cc-fd-hit-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.tabIndex = -1;
      const top = el('span', 'cc-fd-hitname', r.name);
      if (r.dnc) top.append(el('i', 'cc-fd-dnc', 'Do not contact'));
      const line = [r.title, r.account].filter(Boolean).join(' · ');
      const tags = el('span', 'cc-fd-hitmeta');
      if (line) tags.append(el('span', null, line));
      if (CAMP[r.camp]) tags.append(el('span', 'cc-fd-camp', CAMP[r.camp]));
      if (r.priority) tags.append(el('span', 'cc-fd-pri', 'P' + r.priority));
      li.append(top, tags);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); open(r.id); });
      li.addEventListener('mouseenter', () => { cursor = i; mark(false); });
      return li;
    }));
    note.textContent = !shown.length ? `No contact matches “${q}”.`
      : total > shown.length ? `Showing ${intF(shown.length)} of ${intF(total)} matches — keep typing to narrow it down.`
        : `${plural(total, 'match', 'matches')}.`;
    hits.hidden = !shown.length;
    pop.hidden = false;
    input.setAttribute('aria-expanded', String(shown.length > 0));
    hits.scrollTop = 0;
    mark(false);
  };
  let timer = null;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 90); });
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; closeHits(); input.blur(); return; }
    if (hits.hidden || !shown.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); cursor = (cursor + 1) % shown.length; mark(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = (cursor + shown.length - 1) % shown.length; mark(true); }
    else if (e.key === 'Enter') { e.preventDefault(); open(shown[cursor].id); }
  });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) closeHits(); });
  /* "/" or Cmd/Ctrl-K focuses the search from anywhere, unless you're already typing in a field. */
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if ((e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
      if (document.body.classList.contains('cc-locked')) return;
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  /* ---------- the brief panel ---------- */
  const dlg = el('dialog', 'cc-fd-dlg');
  dlg.setAttribute('aria-label', 'Contact brief');
  const panel = el('div', 'cc-fd-panel');
  dlg.append(panel);
  document.body.append(dlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  let openId = null;
  let shownItems = PAGE;
  const open = (id) => {
    openId = id;
    shownItems = PAGE;
    closeHits();
    input.blur();
    if (!dlg.open) dlg.showModal();
    draw();
    if (feedState === 'idle') loadFeed().then(() => { if (openId === id) draw(); });
  };

  const kv = (dl, k, v) => { if (v == null || v === '') return; dl.append(el('dt', null, k)); const dd = el('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; dl.append(dd); };

  const itemNode = (it) => {
    const a = el('article', 'cc-fd-item');
    a.dataset.src = it.src;
    const h = el('header', 'cc-fd-ihead');
    h.append(el('span', 'cc-fd-src cc-fd-src-' + it.src, SRC[it.src] || it.src));
    const t = el('time', 'cc-fd-when', atF(it.at)); t.dateTime = it.at || '';
    h.append(t);
    const from = it.from && feed ? (feed.people || []).find((p) => p.id === it.from) : null;
    if (from) h.append(el('span', 'cc-fd-from', from.name));
    if (it.chat) h.append(el('span', 'cc-fd-chat', it.chat));
    a.append(h);
    if (it.title) a.append(el('p', 'cc-fd-ititle', it.title));
    if (it.sum) {
      const s = el('div', 'cc-fd-sum');
      s.append(el('span', 'cc-fd-lab', it.src === 'fireflies' ? 'Call summary' : 'Summary'), el('p', null, it.sum));
      if (Array.isArray(it.dec) && it.dec.length) {
        const ul = el('ul', 'cc-fd-dec');
        it.dec.forEach((d) => ul.append(el('li', null, typeof d === 'string' ? d : (d && (d.text || d.decision)) || '')));
        s.append(el('span', 'cc-fd-lab', 'Decisions'), ul);
      }
      a.append(s);
    }
    if (it.text) a.append(el('div', 'cc-fd-text', it.text));
    (it.img || []).forEach((x) => {
      const d = el('div', 'cc-fd-img');
      d.append(el('span', 'cc-fd-lab', /pdf/i.test(x.mime) ? 'Text read from a PDF' : /image/i.test(x.mime) ? 'Text read from an image' : 'Text read from a file'), el('div', 'cc-fd-text', x.text));
      a.append(d);
    });
    if (!it.text && !it.sum && !(it.img || []).length) a.append(el('p', 'cc-fd-dim', it.kind ? `No text (${String(it.kind).replace(/_/g, ' ')})` : 'No text'));
    const url = safeUrl(it.link);
    if (url) { const l = el('a', 'cc-fd-link', it.src === 'm365_mail' ? 'Open in Outlook' : it.src === 'fireflies' ? 'Open in Fireflies' : 'Open the source'); l.href = url; l.target = '_blank'; l.rel = 'noopener'; a.append(l); }
    return a;
  };

  const copyBtn = (text, label) => {
    const b = btn('cc-fd-copy', label || 'Copy', () => {
      navigator.clipboard.writeText(text).then(() => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = label || 'Copy'; }, 1600); })
        .catch(() => { b.textContent = 'Press Ctrl-C'; });
    });
    return b;
  };

  const draw = () => {
    if (!openId || !byId || !byId.get(openId)) { panel.replaceChildren(el('p', 'cc-fd-dim', 'That contact isn’t in today’s data.')); return; }
    const b = gather(openId);
    const z = b.z;
    const parts = [];

    /* Head */
    const head = el('header', 'cc-fd-head');
    const title = el('div', 'cc-fd-title');
    title.append(el('h2', null, z.name));
    if (z.dnc) title.append(el('span', 'cc-fd-flag', 'Do not contact'));
    if (CAMP[z.camp]) title.append(el('span', 'cc-fd-camp', CAMP[z.camp]));
    if (z.priority) title.append(el('span', 'cc-fd-pri', 'Priority ' + z.priority));
    head.append(title);
    const sub = el('p', 'cc-fd-sub');
    if (z.title) sub.append(el('span', null, z.title));
    if (z.title && z.account) sub.append(document.createTextNode(' · '));
    if (z.account) sub.append(z.account_id ? zohoLink('Accounts', z.account_id, z.account, 'cc-fd-acct') : el('span', null, z.account));
    head.append(sub);
    const acts = el('div', 'cc-fd-acts');
    acts.append(zohoLink('Contacts', z.id, 'Open in Zoho ↗', 'cc-fd-go'));
    if (safeUrl(z.linkedin)) { const a = el('a', 'cc-fd-go', 'LinkedIn ↗'); a.href = z.linkedin; a.target = '_blank'; a.rel = 'noopener'; acts.append(a); }
    acts.append(btn('cc-fd-go cc-fd-close', 'Close', () => dlg.close()));
    head.append(acts);
    parts.push(head);

    /* Where we stand */
    const facts = el('dl', 'cc-fd-facts');
    kv(facts, 'Meetings', b.n ? `${intF(b.n)} held, last ${dayF(b.last)}${b.since != null ? ` (${plural(b.since, 'day')} ago)` : ''}` : 'None held');
    kv(facts, 'Next meeting', b.next ? atF(b.next) : 'None booked');
    kv(facts, 'CRM owner', z.assigned || 'Not assigned');
    kv(facts, 'LinkedIn', z.li || 'Not set');
    if (b.mail) kv(facts, 'Email', `${b.mail.status}${b.mail.last_in ? `, they wrote ${dayF(b.mail.last_in)}` : ''}${b.mail.last_out ? `, we wrote ${dayF(b.mail.last_out)}` : ''}`);
    else if (b.digest && b.digest.last && b.digest.last.m365_mail) kv(facts, 'Email', `Last ${b.digest.last.m365_mail.dir === 'inbound' ? 'from them' : 'exchanged'} ${dayF(b.digest.last.m365_mail.at)}`);
    else if (z.email) kv(facts, 'Email', `${z.email} — nothing on record`);
    if (b.li && b.li.label) kv(facts, 'LinkedIn messages', `${b.li.label}${b.li.note ? ` — ${b.li.note}` : ''}`);
    if (b.ag) kv(facts, 'Agreement', `${b.ag.state}${b.ag.completed ? `, signed ${dayF(b.ag.completed)}` : b.ag.sent ? `, sent ${dayF(b.ag.sent)}` : ''}`);
    if (b.deals.length) {
      const box = el('span', 'cc-fd-deals');
      b.deals.slice(0, 4).forEach((d, i) => { if (i) box.append(document.createTextNode(' · ')); box.append(zohoLink('Potentials', d.id, `${clip(d.deal, 48)} (${d.stage})`)); });
      if (b.deals.length > 4) box.append(document.createTextNode(` and ${intF(b.deals.length - 4)} more`));
      kv(facts, plural(b.deals.length, 'Deal'), box);
    }
    if (b.digest) {
      const last = SRC_ORDER.filter((s) => b.digest.last && b.digest.last[s]).sort((x, y) => String(b.digest.last[y].at).localeCompare(String(b.digest.last[x].at)));
      kv(facts, 'Conversations', `${plural(b.digest.n, 'message')} on record${last.length ? `, latest ${last.map((s) => `${SRC[s]} ${dayF(b.digest.last[s].at)}`).join(', ')}` : ''}`);
    }
    parts.push(facts);

    /* Next step and the draft */
    const step = stepFor(b);
    const next = el('section', 'cc-fd-next cc-fd-' + step.tone);
    next.append(el('span', 'cc-fd-lab', 'Next step'), el('p', 'cc-fd-steptext', step.text));
    if (!z.dnc) {
      const d = draftFor(b);
      const det = el('details', 'cc-fd-draft');
      const sm = el('summary', null, `Draft ${/^[aeiou]/i.test(d.channel) ? 'an' : 'a'} ${d.channel.replace(/^Email$/, 'email')}`);
      det.append(sm);
      const body = el('div', 'cc-fd-draftbody');
      body.append(el('p', 'cc-fd-dim', d.basis));
      if (d.subject) body.append(el('div', 'cc-fd-subject', `Subject: ${d.subject}`));
      const ta = el('textarea', 'cc-fd-text-area');
      ta.rows = Math.min(14, d.body.split('\n').length + 2);
      ta.value = d.body;
      ta.setAttribute('aria-label', `Draft ${d.channel} to ${z.name}`);
      body.append(ta);
      const row = el('div', 'cc-fd-draftacts');
      row.append(copyBtn((d.subject ? `Subject: ${d.subject}\n\n` : '') + d.body, 'Copy the draft'));
      if (d.channel === 'Email' && d.to) {
        const a = el('a', 'cc-fd-go', 'Open in your mail app');
        a.href = `mailto:${encodeURIComponent(d.to)}?subject=${encodeURIComponent(d.subject || '')}&body=${encodeURIComponent(ta.value)}`;
        a.addEventListener('mousedown', () => { a.href = `mailto:${encodeURIComponent(d.to)}?subject=${encodeURIComponent(d.subject || '')}&body=${encodeURIComponent(ta.value)}`; });
        row.append(a);
      } else if (d.to) {
        const a = el('a', 'cc-fd-go', 'Open LinkedIn ↗'); a.href = d.to; a.target = '_blank'; a.rel = 'noopener'; row.append(a);
      }
      row.append(el('span', 'cc-fd-dim', 'Nothing is sent from here — copy it into your mail or LinkedIn.'));
      body.append(row);
      det.append(body);
      next.append(det);
    }
    parts.push(next);

    /* What's left to do */
    const todo = todoFor(b);
    const left = el('section', 'cc-fd-sec');
    left.append(el('h3', null, `What’s left to do${todo.length ? ` (${intF(todo.length)})` : ''}`));
    if (!todo.length) left.append(el('p', 'cc-fd-dim', 'Nothing open on this contact: no task, commitment, unsigned agreement or open deal.'));
    else {
      const ul = el('ul', 'cc-fd-todo');
      todo.forEach((t) => {
        const li = el('li', t.late ? 'cc-fd-late' : null);
        li.append(el('span', 'cc-fd-what', t.what));
        const m = [t.when, t.src].filter(Boolean).join(' · ');
        if (m) li.append(el('span', 'cc-fd-dim', m));
        ul.append(li);
      });
      left.append(ul);
    }
    if (feedState === 'loading') left.append(el('p', 'cc-fd-dim', 'Still loading the conversation history, so commitments the bot found in calls and chats aren’t counted yet.'));
    parts.push(left);

    /* The meeting brief, when the partner briefs hold one */
    if (b.brief) {
      const sec = el('section', 'cc-fd-sec');
      sec.append(el('h3', null, 'Partner meeting brief'));
      const map = [['talked_about', 'Talked about'], ['still_open', 'Still open'], ['ask_next', 'Ask next'], ['drive_next', 'Drive the next meeting']];
      map.forEach(([k, label]) => {
        const v = b.brief[k];
        const list = Array.isArray(v) ? v : v ? [v] : [];
        if (!list.length) return;
        sec.append(el('span', 'cc-fd-lab', label));
        const ul = el('ul', 'cc-fd-bul');
        list.forEach((x) => ul.append(el('li', null, String(x))));
        sec.append(ul);
      });
      parts.push(sec);
    }

    /* What the bot knows about them */
    const mem = b.person ? memoryText(b.person.memory) : '';
    if (mem) {
      const sec = el('section', 'cc-fd-sec');
      const det = el('details');
      det.append(el('summary', null, 'What the Chief of Staff bot knows about them'), el('div', 'cc-fd-text', mem));
      sec.append(det);
      parts.push(sec);
    }

    /* Partner notes */
    if (b.notes.length) {
      const sec = el('section', 'cc-fd-sec');
      sec.append(el('h3', null, `Partner notes (${intF(b.notes.length)})`));
      const ul = el('ul', 'cc-fd-todo');
      b.notes.slice(0, 6).forEach((n) => {
        const li = el('li');
        li.append(el('span', 'cc-fd-what', n.text), el('span', 'cc-fd-dim', [dayF(n.at), n.group].filter(Boolean).join(' · ')));
        ul.append(li);
      });
      sec.append(ul);
      parts.push(sec);
    }

    /* What we talked about */
    const conv = el('section', 'cc-fd-sec');
    conv.append(el('h3', null, 'What we talked about'));
    if (feedState === 'loading') conv.append(el('p', 'cc-fd-dim', 'Loading the conversation history…'));
    else if (feedState === 'error' || feedState === 'none') conv.append(el('p', 'cc-fd-dim', feedMsg));
    else if (!b.person) conv.append(el('p', 'cc-fd-dim', 'No conversations on record for this contact. The Chief of Staff bot links people by email, so a contact with no address in Zoho, or one the team only emails from outside the four team mailboxes, won’t appear here.'));
    else if (!b.items.length) conv.append(el('p', 'cc-fd-dim', 'The bot knows this person but has no work conversations with them.'));
    else {
      conv.append(el('p', 'cc-fd-dim', `${plural(b.items.length, 'conversation')} on record, newest first.`));
      const box = el('div', 'cc-fd-items');
      b.items.slice(0, shownItems).forEach((it) => box.append(itemNode(it)));
      conv.append(box);
      if (b.items.length > shownItems) {
        const leftN = b.items.length - shownItems;
        conv.append(btn('cc-fd-go', leftN > PAGE ? `Show ${intF(PAGE)} more (${intF(leftN)} left)` : `Show the last ${intF(leftN)}`, () => { shownItems += PAGE; draw(); }));
      }
      const p = b.person;
      conv.append(btn('cc-fd-go cc-fd-tocos', 'Open the Chief of Staff tab', () => { dlg.close(); const t = document.getElementById('tab-cos'); if (t) t.click(); }));
      if (p && p.rel) conv.append(el('p', 'cc-fd-dim', `The bot files them as ${p.rel.replace(/_/g, ' ')}${p.org ? ` at ${p.org}` : ''}.`));
    }
    parts.push(conv);

    /* Where it all came from */
    const srcs = [
      ['Zoho CRM', ok('qa_contact_rows')],
      ['Team Outlook mail', Boolean(b.mail)],
      ['Team calendars', Boolean(b.mtg && b.mtg.cal_checked)],
      ['Fireflies calls', b.days.some((d) => d.srcs.has('Fireflies'))],
      ['Partner meeting brief', Boolean(b.brief)],
      ['LinkedIn messages', Boolean(b.li)],
      ['Chief of Staff feed', feedState === 'ok' && Boolean(b.person)],
    ];
    const foot = el('footer', 'cc-fd-foot');
    foot.append(el('span', 'cc-fd-lab', 'Built from'));
    foot.append(el('span', null, srcs.filter(([, on]) => on).map(([n]) => n).join(' · ') || 'Zoho CRM'));
    const missing = srcs.filter(([, on]) => !on).map(([n]) => n);
    if (missing.length) foot.append(el('span', 'cc-fd-dim', `Nothing on record from: ${missing.join(', ')}.`));
    if (feedState === 'ok' && feed && feed.built_at) foot.append(el('span', 'cc-fd-dim', `Conversations as of ${atF(feed.built_at)}.`));
    parts.push(foot);

    panel.replaceChildren(...parts);
    panel.scrollTop = 0;
  };

  dlg.addEventListener('close', () => { openId = null; });

  /* A redraw clears the cached index, since a new build can add or change contacts. */
  dash.onData(() => {
    idx = null; byId = null; weight = null;
    if (input.value.trim().length >= 2 && document.activeElement === input) render();
    if (openId) draw();
  });
})();
