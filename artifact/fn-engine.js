/* Founder Network engine: identity resolution, the founder model, activities, actions, the status engine, the priority
   engine, the relationship pipeline and targets. Pure functions over rows the dashboard has already loaded, so the same
   code runs in the page (window.FN_ENGINE) and in Node tests (module.exports). Nothing here calls a network or writes
   anywhere. Dates are compared as Central-time days. */
(function (root) {
  'use strict';

  /* ---------- settings: every threshold, weight and target in one place ---------- */
  const DEFAULTS = {
    tz: 'America/Chicago',
    campaign: { start: '2026-08-17', end: '2026-12-18' },
    /* Targets from the Founder Network scorecard Mack shared on Oct 17, 2026 (Telegram photo 118). */
    targets: [
      { id: 'members', label: 'Founder Network contacts in Zoho', target: 450, unit: 'contacts' },
      { id: 'meetings', label: 'Meetings held', target: 150, unit: 'meetings' },
      { id: 'agreements_sent', label: 'Referral agreements sent', target: 25, unit: 'agreements' },
      { id: 'agreements_signed', label: 'Referral agreements signed', target: 10, unit: 'agreements' },
      { id: 'opportunities', label: 'Open opportunities', target: 15, unit: 'deals' },
      { id: 'closed', label: 'Deals closed', target: 7, unit: 'deals' },
    ],
    atRiskShare: 0.85, /* below 85% of the expected pace is At risk; below 60% is Below target */
    belowShare: 0.6,
    staleHours: { live: 24, imported: 24 * 14 },
    reconnectDays: { P1: 30, P3: 60 },
    followUpDays: 7,
    prepDays: 2,
    taskStaleDays: 45,
    callActionDays: 60, /* action items from recorded calls older than this stay on the timeline only */
    weights: { strategic: 25, opportunity: 20, relationship: 15, commitments: 15, intro: 10, recency: 10, upcoming: 5 },
    bands: { high: 55, normal: 30 },
    team: ['Mack', 'Hemang', 'Shruti', 'Vansh', 'Himanshu', 'Priya', 'Harsh', 'Pulkit'],
  };

  /* ---------- small helpers ---------- */
  const str = (v) => (v == null ? '' : String(v));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const list = (v) => (Array.isArray(v) ? v : str(v).split(',').map((x) => x.trim()).filter(Boolean));
  const isFN = (rel) => list(rel).includes('Founder Network');
  const ctDay = (v, tz = DEFAULTS.tz) => {
    if (!v) return null;
    const s = str(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-CA', { timeZone: tz });
  };
  const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 864e5);
  const daysBetween = (a, b) => (a && b ? dayNum(b) - dayNum(a) : null);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortDay = (d) => (d ? MON[Number(d.slice(5, 7)) - 1] + ' ' + Number(d.slice(8, 10)) : '');
  const maxDay = (...ds) => ds.filter(Boolean).sort().pop() || null;

  /* ---------- identity: names, LinkedIn, companies ---------- */
  const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'mba', 'cpa', 'pmp', 'md', 'esq', 'bhai']);
  const PLACEHOLDER = new Set(['last', 'name', 'unknown', 'recruiter', 'from', 'startup', 'guy', 'hemang', 'group']);
  const NICK = { rich: 'richard', rick: 'richard', mike: 'michael', tom: 'thomas', bill: 'william', bob: 'robert', rob: 'robert', jim: 'james', jon: 'jonathan', dave: 'david', chris: 'christopher', pam: 'pamela', sam: 'samantha', karran: 'karan' };
  const nameToks = (v) => str(v).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\([^)]*\)/g, ' ').split(',')[0]
    .toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1 && !TITLES.has(t));
  /* First token of the first name and last token of the last name; a record holding the whole name in Last Name is split. */
  const personKey = (first, last) => {
    let f = nameToks(first);
    let l = nameToks(last).filter((t) => !PLACEHOLDER.has(t));
    if (!f.length && l.length > 1) { f = l.slice(0, 1); l = l.slice(1); }
    return f.length && l.length && f[0] !== l[l.length - 1] ? { first: f[0], last: l[l.length - 1] } : null;
  };
  const keyOfName = (full) => { const t = nameToks(full).filter((x) => !PLACEHOLDER.has(x)); return t.length > 1 && t[0] !== t[t.length - 1] ? { first: t[0], last: t[t.length - 1] } : null; };
  const slugOf = (u) => {
    const m = str(u).trim().match(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/i);
    if (!m) return null;
    try { return decodeURIComponent(m[1]).toLowerCase().replace(/\/+$/, ''); } catch (e) { return m[1].toLowerCase(); }
  };
  const lev = (a, b) => {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      const cur = [i];
      for (let j = 1; j <= b.length; j += 1) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
      prev = cur;
    }
    return prev[b.length];
  };
  const undouble = (s) => s.replace(/(.)\1/g, '$1');
  const sameFirst = (a, b) => a === b || (NICK[a] || a) === (NICK[b] || b) || undouble(a) === undouble(b);
  const placeholderName = (full) => /last name|unknown|startup guy|\bfrom [a-z]+$|\((?:mack|hemang|shruti|vansh|himanshu|priya|harsh|pulkit)\)|recruiter$|group$/i.test(str(full)) || nameToks(full).length < 2;

  /* Match one person to Zoho contacts. Confidence: confirmed (same LinkedIn profile or Zoho id), likely (exact first and
     last name, one person by that name on our side), possible (same name words in another order, or a last name one or
     two letters off with the same first name). A rejected pair (decisions) is never proposed again. */
  const zohoIndex = (contacts) => {
    const bySlug = new Map(); const byKey = new Map(); const byLast = new Map(); const tokSets = [];
    for (const z of contacts) {
      const s = slugOf(z.LinkedIn); if (s && !bySlug.has(s)) bySlug.set(s, z);
      const k = personKey(z.First_Name, z.Last_Name);
      if (k) {
        const key = k.first + '|' + k.last;
        if (!byKey.has(key)) byKey.set(key, []); byKey.get(key).push(z);
        if (!byLast.has(k.last)) byLast.set(k.last, []); byLast.get(k.last).push(z);
      }
      tokSets.push([z, new Set(nameToks([z.First_Name, z.Last_Name].filter(Boolean).join(' ')).filter((t) => !PLACEHOLDER.has(t)))]);
    }
    return { bySlug, byKey, byLast, tokSets };
  };
  const weightOf = (z) => (isFN(z.Relationship_Type) ? 8 : 0) + (z.Priority ? 4 : 0) + (slugOf(z.LinkedIn) ? 2 : 0) + Math.min(4, num(z.Total_Meetings_Created));
  const matchPerson = (p, idx, opts = {}) => {
    const rejected = opts.rejected || new Set();
    const ok = (z) => z && !rejected.has(p.key + '|' + z.id);
    const slug = slugOf(p.linkedin);
    if (slug && ok(idx.bySlug.get(slug))) return { zoho: idx.bySlug.get(slug), how: 'Same LinkedIn profile', confidence: 'confirmed', others: 0 };
    const k = keyOfName(p.name);
    if (!k || opts.ambiguous) return null;
    /* two different LinkedIn profiles are two different people, whatever the names say */
    const fits = (z) => ok(z) && !(slug && slugOf(z.LinkedIn) && slugOf(z.LinkedIn) !== slug);
    const exact = (idx.byKey.get(k.first + '|' + k.last) || []).filter(fits);
    if (exact.length) {
      const sorted = exact.slice().sort((a, b) => weightOf(b) - weightOf(a) || str(a.id).localeCompare(str(b.id)));
      return { zoho: sorted[0], how: sorted.length > 1 ? `Same first and last name as ${sorted.length} Zoho records` : 'Same first and last name', confidence: sorted.length > 1 ? 'possible' : 'likely', others: sorted.length - 1 };
    }
    const pt = new Set(nameToks(p.name).filter((t) => !PLACEHOLDER.has(t)));
    const sub = idx.tokSets.filter(([z, zt]) => fits(z) && zt.size >= 2 && pt.size >= 2 && (([...zt].every((t) => pt.has(t)) && zt.has(k.first)) || ([...pt].every((t) => zt.has(t)) && zt.has(k.last) && zt.has(k.first)) || ([...zt].every((t) => pt.has(t)) && zt.has(k.last))));
    const subIds = [...new Set(sub.map(([z]) => z.id))];
    if (subIds.length === 1) return { zoho: sub[0][0], how: 'Same name words, different order or extra words', confidence: 'possible', others: 0 };
    if (k.last.length >= 4) {
      const near = [];
      for (const [z] of idx.tokSets) {
        if (!fits(z)) continue;
        const zk = personKey(z.First_Name, z.Last_Name);
        if (!zk || zk.last.length < 4) continue;
        const lastClose = zk.last !== k.last && lev(zk.last, k.last) <= 2;
        if ((sameFirst(zk.first, k.first) && lastClose) || (zk.last === k.last && zk.first !== k.first && sameFirst(zk.first, k.first))) near.push(z);
      }
      const ids = [...new Set(near.map((z) => z.id))];
      if (ids.length === 1) return { zoho: near[0], how: 'Name spelled differently', confidence: 'possible', others: 0 };
    }
    return null;
  };

  /* ---------- the founder model ---------- */
  /* One founder per Zoho Founder Network contact, plus one per person the team named in Telegram who doesn't match one.
     Every source attaches to a founder through a source identity with its method and confidence. */
  function buildFounders(src, settings = DEFAULTS) {
    const today = ctDay(src.now || new Date(), settings.tz);
    const fnRows = (src.fn || []).filter((z) => z && z.id);
    const all = new Map();
    for (const z of [...(src.contacts || []), ...fnRows]) if (z && z.id && !all.has(str(z.id))) all.set(str(z.id), z);
    const idxAll = zohoIndex([...all.values()]);
    const founders = new Map();
    const make = (id, base) => {
      const f = Object.assign({ id, name: '', company: '', title: '', linkedin: '', zoho: null, inFN: false, priority: null, owner: null,
        dnc: false, identities: [], activities: [], notes: [], telegramPriority: null, photos: [], issues: [], tgActions: [], outlook: null, linkedinConn: null }, base);
      founders.set(id, f);
      return f;
    };
    for (const z of fnRows) {
      const f = make('z:' + z.id, {
        name: str(z.Full_Name || [z.First_Name, z.Last_Name].filter(Boolean).join(' ')).trim(), company: str(z.Account_Name), title: str(z.Title),
        linkedin: str(z.LinkedIn), zoho: z, inFN: true, priority: z.Priority ? str(z.Priority) : null, owner: z.Assigned || null,
        dnc: z.DO_NOT_CONTACT === true || z.DO_NOT_CONTACT === 'true',
      });
      f.identities.push({ source: 'Zoho CRM', record: str(z.id), method: 'Zoho record', confidence: 'confirmed', verified: true });
      if (placeholderName(f.name)) f.issues.push({ type: 'Partial or placeholder name', detail: `Zoho holds “${f.name}”`, fix: 'Replace it with the person’s full name in Zoho', severity: 'medium' });
      if (!f.linkedin) f.issues.push({ type: 'No LinkedIn URL', detail: 'Zoho has no LinkedIn profile for this contact', fix: 'Add the LinkedIn URL in Zoho', severity: 'low' });
    }
    /* Contacts tagged Founder_Network whose Relationship Type doesn't say so */
    for (const z of all.values()) {
      if (isFN(z.Relationship_Type) || !list(z.Tag).includes('Founder_Network') || founders.has('z:' + z.id)) continue;
      const f = make('z:' + z.id, { name: str(z.Full_Name || [z.First_Name, z.Last_Name].filter(Boolean).join(' ')).trim(), company: str(z.Account_Name), title: str(z.Title), linkedin: str(z.LinkedIn), zoho: z, inFN: false, priority: z.Priority ? str(z.Priority) : null, owner: z.Assigned || null });
      f.identities.push({ source: 'Zoho CRM', record: str(z.id), method: 'Zoho record', confidence: 'confirmed', verified: true });
      f.issues.push({ type: 'In Zoho, not Founder Network', detail: `Tagged Founder_Network, but Relationship Type is “${str(z.Relationship_Type) || 'empty'}”`, fix: str(z.Relationship_Type) ? 'Add Founder Network to its Relationship Type' : 'Set its Relationship Type to Founder Network', severity: 'high' });
    }
    /* duplicates among Founder Network records, by name key */
    const fnByKey = new Map();
    for (const f of founders.values()) {
      const k = keyOfName(f.name); if (!k) continue;
      const key = k.first + '|' + k.last;
      if (!fnByKey.has(key)) fnByKey.set(key, []); fnByKey.get(key).push(f);
    }
    for (const group of fnByKey.values()) {
      if (group.length < 2) continue;
      for (const f of group) f.issues.push({ type: 'Possible duplicate in Zoho', detail: `${group.length} Founder Network records named ${f.name}`, fix: 'Compare them and merge in Zoho if they are one person', severity: 'medium', others: group.filter((g) => g !== f).map((g) => g.zoho.id) });
    }
    /* Telegram people */
    const alias = new Map(); /* 'tg:<name>' keys used by imported Fireflies and Outlook rows */
    const rejected = new Set((src.decisions || []).filter((d) => d.decision === 'reject').map((d) => d.person + '|' + d.zoho));
    const tgNameCount = new Map();
    for (const t of src.tgPeople || []) { const k = keyOfName(t.name); if (k) tgNameCount.set(k.first + '|' + k.last, (tgNameCount.get(k.first + '|' + k.last) || 0) + 1); }
    const HINT = { 'LinkedIn profile': ['Same LinkedIn profile', 'confirmed'], Name: ['Same first and last name', 'likely'] };
    const usedKeys = new Set();
    const tgRows = (src.tgPeople || []).filter((t) => t && str(t.name).trim());
    for (let i = 0; i < tgRows.length; i += 1) {
      const t = tgRows[i];
      /* each chat person keeps their own record: two people with one name are never merged */
      const base = 'tg:' + str(t.name).trim();
      const pkey = usedKeys.has(base) ? base + '#' + i : base;
      usedKeys.add(pkey);
      const p = { key: pkey, name: str(t.name).trim(), linkedin: t.slug ? 'https://www.linkedin.com/in/' + encodeURIComponent(t.slug) + '/' : '' };
      const k = keyOfName(t.name);
      /* A match worked out when the chat was imported is used while that Zoho record still exists and hasn't been
         rejected; otherwise the person is matched again against today's Zoho. */
      const hinted = t.zoho_id && all.get(str(t.zoho_id));
      const m = hinted && !rejected.has(p.key + '|' + t.zoho_id)
        ? { zoho: hinted, how: (HINT[t.zoho_by] || [str(t.zoho_by) || 'Matched at import'])[0], confidence: num(t.zoho_dups) ? 'possible' : (HINT[t.zoho_by] || [0, 'possible'])[1], others: num(t.zoho_dups) }
        : t.needs_name ? null : matchPerson(p, idxAll, { rejected, ambiguous: k && tgNameCount.get(k.first + '|' + k.last) > 1 });
      let f = m && founders.get('z:' + m.zoho.id);
      if (!f) {
        f = m ? make('z:' + m.zoho.id, { name: str(m.zoho.Full_Name || [m.zoho.First_Name, m.zoho.Last_Name].filter(Boolean).join(' ')).trim() || p.name, company: str(m.zoho.Account_Name) || t.company || '', title: str(m.zoho.Title) || t.title || '', linkedin: str(m.zoho.LinkedIn) || p.linkedin, inFN: false })
          : make(p.key, { name: p.name, company: t.company || '', title: t.title || '', linkedin: p.linkedin, inFN: false });
        if (m) {
          f.zoho = m.zoho; f.priority = m.zoho.Priority ? str(m.zoho.Priority) : null; f.owner = m.zoho.Assigned || null;
          f.identities.push({ source: 'Zoho CRM', record: str(m.zoho.id), method: 'Zoho record', confidence: 'confirmed', verified: true });
          f.issues.push({ type: 'In Zoho, not Founder Network', detail: `Zoho contact “${[m.zoho.First_Name, m.zoho.Last_Name].filter(Boolean).join(' ')}” has Relationship Type “${str(m.zoho.Relationship_Type) || 'empty'}”${list(m.zoho.Tag).includes('Founder_Network') ? ' though it is tagged Founder_Network' : ''}`, fix: str(m.zoho.Relationship_Type) ? 'Add Founder Network to its Relationship Type' : 'Set its Relationship Type to Founder Network', severity: 'high' });
        } else if (!k || t.needs_name) {
          f.issues.push({ type: 'Needs a full name', detail: 'The chat gives only a first name or a description', fix: t.review_note || 'Find the full name, then search Zoho before adding', severity: 'medium' });
        } else {
          f.issues.push({ type: 'Missing from Zoho', detail: 'Named in Telegram; no Zoho contact found by LinkedIn profile, name or close spelling' + (src.missing && src.missing.contacts ? ' (not every page of Zoho contacts loaded, so check Zoho first)' : ''), fix: t.review_note || 'Add the contact in Zoho with Relationship Type Founder Network', severity: (t.review_note && /not a person|nothing to add/i.test(t.review_note)) ? 'low' : src.missing && src.missing.contacts ? 'medium' : 'high' });
        }
      }
      if (m) {
        alias.set(base, f);
        f.identities.push({ source: 'Telegram', record: p.name, method: m.how, confidence: m.confidence, verified: m.confidence === 'confirmed' });
        if (m.confidence === 'possible') f.issues.push({ type: 'Unverified identity', detail: `Telegram “${p.name}” looks like Zoho “${f.name}” (${m.how.toLowerCase()})`, fix: 'Confirm the spelling, then correct Zoho or the team’s notes', severity: 'medium', telegram: t.name });
        if (m.others) f.issues.push({ type: 'Possible duplicate in Zoho', detail: `${m.others + 1} Zoho records match ${p.name}`, fix: 'Compare them and merge in Zoho if they are one person', severity: 'medium' });
      } else {
        if (!alias.has(base)) alias.set(base, f);
        f.identities.push({ source: 'Telegram', record: p.name, method: 'Named in the chat', confidence: k && !t.needs_name ? 'unmatched' : 'partial', verified: false });
      }
      const tp = /^p?\d+$/i.test(str(t.priority).trim()) ? 'P' + str(t.priority).trim().replace(/^p/i, '') : null;
      if (tp && (!f.telegramPriority || Number(tp.slice(1)) < Number(f.telegramPriority.slice(1)))) f.telegramPriority = tp;
      if (t.title && !f.title) f.title = t.title;
      if (t.company && !f.company) f.company = t.company;
      if (p.linkedin && !f.linkedin) f.linkedin = p.linkedin;
      for (const mn of t.mentions || []) {
        f.activities.push({ source: 'Telegram', type: mn.photo ? 'Telegram photo' : 'Telegram message', day: mn.date, at: mn.date, text: mn.text, by: mn.photo ? 'photo ' + mn.photo : mn.by, ref: mn.ref || null, kind: 'imported' });
      }
      for (const a of t.actions || []) f.tgActions.push({ text: a, day: t.first, ref: 'Telegram' });
      for (const r of (Array.isArray(t.relationship) ? t.relationship : t.relationship ? [t.relationship] : [])) f.notes.push({ source: 'Telegram', text: r });
    }
    /* LinkedIn export */
    const liBySlug = new Map(); const liByKey = new Map();
    for (const c of src.linkedin || []) {
      const s = slugOf(c.url); if (s) liBySlug.set(s, c);
      const k = personKey(c.first, c.last); if (k) { const key = k.first + '|' + k.last; liByKey.set(key, liByKey.has(key) ? null : c); }
    }
    for (const f of founders.values()) {
      const s = slugOf(f.linkedin);
      let c = s ? liBySlug.get(s) : null; let how = c ? 'Same LinkedIn profile' : null;
      if (!c) {
        const k = keyOfName(f.name); const hit = k ? liByKey.get(k.first + '|' + k.last) : null;
        const own = s || slugOf(f.zoho && f.zoho.LinkedIn);
        if (hit && !(own && slugOf(hit.url) && slugOf(hit.url) !== own)) { c = hit; how = 'Same first and last name'; }
      }
      if (c) {
        f.linkedinConn = { connected: c.connected, position: c.position, company: c.company, url: c.url, ties: c.ties || [] };
        f.identities.push({ source: 'LinkedIn export', record: c.url || c.name, method: how, confidence: how === 'Same LinkedIn profile' ? 'confirmed' : 'likely', verified: how === 'Same LinkedIn profile' });
        if (c.connected) f.activities.push({ source: 'LinkedIn', type: 'Connected on LinkedIn', day: c.connected, at: c.connected, text: `Connected with Mack on LinkedIn${(c.ties || []).length ? '; ' + c.ties.join(', ').toLowerCase() : ''}`, kind: 'imported' });
        if (!f.title && c.position) f.title = c.position;
        if (!f.company && c.company) f.company = c.company;
        if (!f.linkedin && c.url) { f.linkedin = c.url; f.issues = f.issues.filter((i) => i.type !== 'No LinkedIn URL' || !f.zoho); if (f.zoho && !slugOf(f.zoho.LinkedIn)) f.issues.push({ type: 'No LinkedIn URL', detail: 'Mack’s LinkedIn export has this person; Zoho doesn’t have the URL', fix: 'Add ' + c.url + ' in Zoho', severity: 'low' }); }
      }
    }
    for (const f of founders.values()) {
      const seen = new Set();
      f.issues = f.issues.filter((i) => { const k = i.type + '|' + i.detail; if (seen.has(k)) return false; seen.add(k); return true; });
    }
    /* Zoho events, tasks, deals, agreements */
    const byZoho = new Map();
    for (const f of founders.values()) if (f.zoho) byZoho.set(str(f.zoho.id), f);
    for (const e of src.events || []) {
      const f = byZoho.get(str(e.Who_Id_id)); if (!f) continue;
      const day = ctDay(e.Start_DateTime, settings.tz);
      const status = str(e.Meeting_Status) || 'No status';
      const past = day && day < today; const held = status === 'Completed' && day && day <= today;
      f.activities.push({ source: 'Zoho CRM', type: 'Meeting', day, at: e.Start_DateTime, text: `${str(e.Event_Title) || 'Meeting'} (${status})`, status, held, upcoming: Boolean(!held && day && day >= today && !/cancel/i.test(status)), unconfirmed: past && !held, ref: 'Events/' + e.id, kind: 'source' });
    }
    for (const t of src.tasks || []) {
      const f = byZoho.get(str(t.Who_Id_id)); if (!f) continue;
      f.activities.push({ source: 'Zoho CRM', type: 'Task', day: ctDay(t.Created_Time, settings.tz), at: t.Created_Time, text: str(t.Subject), task: t, ref: 'Tasks/' + t.id, kind: 'source' });
    }
    for (const d of src.deals || []) {
      const f = byZoho.get(str(d.Contact_Name_id)); if (!f) continue;
      f.activities.push({ source: 'Zoho CRM', type: 'Deal', day: ctDay(d.Created_Time, settings.tz), at: d.Created_Time, text: `${str(d.Deal_Name)}: ${str(d.Stage)}${d.Deal_Type ? ' (' + d.Deal_Type + ')' : ''}`, deal: d, ref: 'Potentials/' + d.id, kind: 'source' });
    }
    for (const a of src.agreements || []) {
      const f = a.contact_id && byZoho.get(str(a.contact_id)); if (!f) continue;
      f.activities.push({ source: 'Zoho Sign', type: 'Agreement', day: ctDay(a.completed || a.sent, settings.tz), at: a.completed || a.sent, text: `${a.kind}: ${a.state}`, agreement: a, kind: 'source' });
    }
    /* Fireflies */
    const ffById = new Map((src.ffMeetings || []).map((m) => [m.id, m]));
    for (const l of src.ffLinks || []) {
      const f = str(l.person).startsWith('tg:') ? (founders.get(l.person) || alias.get(l.person)) : founders.get('z:' + l.person);
      const m = ffById.get(l.meeting); if (!f || !m) continue;
      f.identities.push({ source: 'Fireflies', record: m.id, method: l.matched_by, confidence: l.matched_by === 'their Zoho email' ? 'confirmed' : 'likely', verified: l.matched_by === 'their Zoho email' });
      f.activities.push({ source: 'Fireflies', type: 'Recorded call', day: ctDay(m.date, settings.tz), at: m.date, text: m.title, summary: m.summary, actionItems: m.action_items, minutes: m.minutes, ref: m.url, held: true, kind: 'source' });
    }
    /* Outlook (checked by hand, dates and counts only) */
    for (const o of src.outlook || []) {
      const f = str(o.key).startsWith('tg:') ? (founders.get(o.key) || alias.get(o.key)) : founders.get('z:' + o.key); if (!f) continue;
      f.outlook = o;
      const conf = o.identity === 'same person' ? 'confirmed' : o.identity === 'unconfirmed' ? 'possible' : null;
      if (conf) f.identities.push({ source: 'Outlook', record: o.their_domain ? '@' + o.their_domain : 'team mailboxes', method: 'Name and company checked by hand', confidence: conf, verified: conf === 'confirmed' });
      if (o.identity === 'same person') {
        if (num(o.email_count)) f.activities.push({ source: 'Outlook mail', type: 'Email', day: o.last_email, at: o.last_email, text: `${num(o.email_count) >= 25 ? '25+' : num(o.email_count)} email${num(o.email_count) === 1 ? '' : 's'} since ${o.first_email || '—'}${o.two_way ? ', both ways' : ', one way'}`, kind: 'imported', twoWay: Boolean(o.two_way) });
        if (num(o.meeting_count) && o.last_meeting) f.activities.push({ source: 'Outlook calendar', type: 'Meeting', day: o.last_meeting, at: o.last_meeting, text: `${num(o.meeting_count)} meeting${num(o.meeting_count) === 1 ? '' : 's'} on the team calendars; latest shown`, held: o.last_meeting < today, upcoming: o.last_meeting >= today, kind: 'imported' });
      }
    }
    for (const f of founders.values()) f.activities.sort((a, b) => str(b.at || b.day).localeCompare(str(a.at || a.day)));
    return [...founders.values()];
  }

  /* ---------- per-founder facts the engines share ---------- */
  function facts(f, today) {
    const acts = f.activities;
    const interactions = acts.filter((a) => (a.type === 'Meeting' && a.held) || a.type === 'Recorded call' || a.type === 'Email');
    const meetingDays = [...new Set(acts.filter((a) => (a.type === 'Meeting' && a.held) || a.type === 'Recorded call').map((a) => a.day).filter(Boolean))].sort();
    const upcoming = acts.filter((a) => a.type === 'Meeting' && a.upcoming && a.day && a.day >= today).map((a) => a.day).sort()[0] || null;
    const lastInteraction = maxDay(...interactions.map((a) => a.day).filter((d) => d && d <= today));
    const deals = acts.filter((a) => a.deal).map((a) => a.deal);
    const openDeals = deals.filter((d) => ['Identify', 'Discovery', 'Proposals', 'Hold'].includes(str(d.Stage)));
    const won = deals.filter((d) => str(d.Stage) === 'Closed');
    const agreements = acts.filter((a) => a.agreement).map((a) => a.agreement).filter((a) => a.kind === 'Referral agreement');
    const tasks = acts.filter((a) => a.task).map((a) => a.task);
    const openTasks = tasks.filter((t) => str(t.Status) !== 'Completed' && !/cancel|deferred/i.test(str(t.Status)));
    const twoWay = acts.some((a) => a.twoWay) || acts.some((a) => a.type === 'Recorded call');
    const emailed = acts.some((a) => a.type === 'Email');
    const intro = /intro|introduc|referr/i.test(f.notes.map((n) => n.text).join(' ') + ' ' + acts.filter((a) => a.source === 'Telegram').map((a) => a.text).join(' '));
    return { interactions, meetingDays, upcoming, lastInteraction, deals, openDeals, won, agreements, tasks, openTasks, twoWay, emailed, intro };
  }

  /* ---------- relationship pipeline ---------- */
  const STAGES = ['Identified', 'Researched', 'Contacted', 'Engaged', 'Meeting booked', 'Relationship established', 'Opportunity or referral', 'Closed or nurture'];
  const STAGE_RULES = {
    'Identified': 'Named by the team or in Zoho, nothing more known yet',
    'Researched': 'Has a company or title, or a LinkedIn profile',
    'Contacted': 'We emailed them (Outlook) or they are in a Telegram reach-out',
    'Engaged': 'Two-way email or a recorded call',
    'Meeting booked': 'A meeting on Zoho or the team calendars that hasn’t happened yet',
    'Relationship established': 'At least one meeting held (Zoho Completed, team calendar or Fireflies)',
    'Opportunity or referral': 'A deal with them, or a referral agreement sent or signed',
    'Closed or nurture': 'A won deal, a signed agreement, Do Not Contact, or Priority 9 or 11',
  };
  function stageOf(f, F) {
    if (F.won.length || F.agreements.some((a) => a.state === 'Signed') || f.dnc || ['9', '11'].includes(f.priority)) return 'Closed or nurture';
    if (F.openDeals.length || F.agreements.length) return 'Opportunity or referral';
    if (F.upcoming) return 'Meeting booked';
    if (F.meetingDays.length) return 'Relationship established';
    if (F.twoWay) return 'Engaged';
    if (F.emailed || f.tgActions.some((a) => /reach out|reconnect|connect|message|follow up/i.test(a.text))) return 'Contacted';
    if (f.company || f.title || f.linkedin) return 'Researched';
    return 'Identified';
  }

  /* ---------- actions: Zoho tasks, meetings, Telegram asks, Fireflies commitments, rules ---------- */
  /* kind: commitment (recorded in a source with an owner or a date), proposal (found in a source, needs review), rule (the
     dashboard's own recommendation). Never invents an owner or a due date. */
  const TEAM_RE = (settings) => new RegExp('^(' + settings.team.join('|') + ')\\b', 'i');
  function actionsFor(f, F, today, settings = DEFAULTS) {
    const out = [];
    const add = (a) => out.push(Object.assign({ founder: f.id, name: f.name, company: f.company, owner: null, due: null, evidence: [], status: 'Open' }, a));
    for (const t of F.tasks) {
      if (/cancel|deferred/i.test(str(t.Status))) continue; /* parked in Zoho: on the timeline, not an action */
      const done = str(t.Status) === 'Completed';
      const due = t.Due_Date || null;
      const named = str(t.Subject).match(TEAM_RE(settings));
      const overdueDays = due && !done ? daysBetween(due, today) : null;
      add({
        key: 'zoho-task:' + t.id, category: 'Zoho task', kind: 'commitment', text: str(t.Subject) || 'Task',
        owner: named ? named[1][0].toUpperCase() + named[1].slice(1).toLowerCase() : null, due,
        status: done ? 'Done' : /waiting/i.test(str(t.Status)) ? 'Waiting' : overdueDays > 0 ? 'Overdue' : 'Open',
        overdueDays: overdueDays > 0 ? overdueDays : 0, stale: overdueDays > settings.taskStaleDays,
        priorityHint: /highest/i.test(str(t.Priority)) ? 'high' : 'normal' /* nearly every Zoho task is High, so only Highest escalates */, closedAt: t.Closed_Time || null,
        evidence: [{ source: 'Zoho CRM', text: `Task “${str(t.Subject)}”, ${str(t.Status)}${due ? ', due ' + due : ', no due date'}`, ref: 'Tasks/' + t.id }],
        next: done ? 'Nothing: completed in Zoho' : overdueDays > settings.taskStaleDays ? 'Close it in Zoho or set a new due date: it is more than ' + settings.taskStaleDays + ' days overdue' : 'Do it, then mark it Completed in Zoho',
      });
    }
    const meetings = f.activities.filter((a) => a.type === 'Meeting');
    for (const m of meetings.filter((x) => x.upcoming && x.day)) {
      const until = daysBetween(today, m.day);
      add({ key: 'prep:' + f.id + ':' + m.day, category: 'Prepare for a meeting', kind: 'commitment', text: `Prepare for the meeting on ${shortDay(m.day)}`, due: m.day, status: until <= settings.prepDays ? 'Due soon' : 'Open', evidence: [{ source: m.source, text: m.text, ref: m.ref || null }], next: 'Review the timeline and open actions before the meeting' });
    }
    for (const m of meetings.filter((x) => x.source === 'Zoho CRM' && x.unconfirmed)) {
      add({ key: 'outcome:' + m.ref, category: 'Record a meeting outcome', kind: 'commitment', text: `Zoho meeting on ${shortDay(m.day)} is still “${m.status}”`, due: m.day, status: 'Overdue', overdueDays: daysBetween(m.day, today), stale: daysBetween(m.day, today) > settings.taskStaleDays, evidence: [{ source: 'Zoho CRM', text: m.text, ref: m.ref }], next: 'Mark it Completed in Zoho if it happened, or delete it if it didn’t' });
    }
    const zohoDays = new Set(meetings.filter((x) => x.source === 'Zoho CRM').map((x) => x.day));
    for (const m of meetings.filter((x) => x.source === 'Outlook calendar' && x.held && x.day && !zohoDays.has(x.day))) {
      add({ key: 'log:' + f.id + ':' + m.day, category: 'Log a meeting in Zoho', kind: 'commitment', text: `Meeting on ${shortDay(m.day)} is on the team calendar but not in Zoho`, evidence: [{ source: 'Outlook calendar', text: m.text }], status: 'Open', next: 'Log it in Zoho as a Completed meeting' });
    }
    const lastMeeting = F.meetingDays[F.meetingDays.length - 1];
    if (lastMeeting && lastMeeting <= today) {
      const after = f.activities.some((a) => a.day && a.day > lastMeeting && (a.type === 'Email' || a.type === 'Task' || (a.type === 'Meeting')));
      const gap = daysBetween(lastMeeting, today);
      if (!after && gap >= settings.followUpDays && gap <= 60 && !F.openTasks.length) add({ key: 'followup:' + f.id + ':' + lastMeeting, category: 'Follow up after a meeting', kind: 'rule', text: `No follow-up recorded since the meeting on ${shortDay(lastMeeting)}`, evidence: [{ source: 'Rule', text: `Meeting ${gap} days ago; no later email, task or meeting on record` }], status: 'Open', next: 'Send a follow-up and record the next step in Zoho' });
    }
    for (const a of f.tgActions) {
      const txt = str(a.text);
      if (!txt) continue;
      const k = 'tg:' + f.id + ':' + txt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const done = /log meeting|log .*meeting/i.test(txt) && meetings.some((m) => m.source === 'Zoho CRM' && m.held);
      add({ key: k, category: 'From Telegram', kind: 'proposal', text: txt, evidence: [{ source: 'Telegram', text: txt + (a.day ? ' (' + a.day + ')' : '') }], status: done ? 'Done' : 'Needs review', next: 'Confirm it still applies, then create it as a task in Zoho or dismiss it there' });
    }
    for (const c of f.activities.filter((x) => x.type === 'Recorded call' && x.actionItems && x.day && daysBetween(x.day, today) <= settings.callActionDays)) {
      const blocks = str(c.actionItems).split(/\n(?=\*\*)/);
      for (const b of blocks) {
        const m = b.match(/^\*\*(.+?)\*\*\s*\n([\s\S]*)$/);
        if (!m) continue;
        const who = m[1].trim();
        const wk = keyOfName(who); const fk = keyOfName(f.name);
        if (wk && fk && wk.first === fk.first && wk.last === fk.last) continue; /* the founder's own items */
        /* a one-word header that is the founder's own first name is the founder, not a teammate who shares it */
        if (!wk && fk && nameToks(who)[0] === fk.first) continue;
        if (!/akhani/i.test(who) && !TEAM_RE(settings).test(who)) continue;
        for (const line of m[2].split('\n').map((x) => x.trim()).filter(Boolean)) {
          add({ key: 'ff:' + c.ref + ':' + line.toLowerCase().slice(0, 60), category: 'From a recorded call', kind: 'proposal', text: line.replace(/^[-*•]\s*/, '').replace(/\s*\(\d{1,2}:\d{2}(?::\d{2})?\)\s*$/, ''), owner: /akhani|mack/i.test(who) ? 'Mack' : who.split(' ')[0], evidence: [{ source: 'Fireflies', text: `${c.text}, ${c.day}: action item for ${who}`, ref: c.ref }], status: 'Needs review', next: 'Check the call; if it still stands, create it as a task in Zoho' });
        }
      }
    }
    const p = f.priority === '1' ? 'P1' : f.priority === '3' ? 'P3' : null;
    if (p && !f.dnc && !F.upcoming) {
      const gap = F.lastInteraction ? daysBetween(F.lastInteraction, today) : null;
      const limit = settings.reconnectDays[p];
      if (gap == null || gap >= limit) add({ key: 'reconnect:' + f.id, category: 'Reconnect', kind: 'rule', text: gap == null ? `${p} with no recorded interaction` : `${p}, last interaction ${gap} days ago`, evidence: [{ source: 'Rule', text: `${p} contacts get a touch point every ${limit} days; last one ${F.lastInteraction || 'never recorded'}` }], status: 'Open', next: 'Reach out and record it' });
    }
    for (const i of f.issues.filter((x) => x.severity === 'high')) add({ key: 'dq:' + f.id + ':' + i.type, category: 'Fix in Zoho', kind: 'rule', text: i.type + ': ' + i.detail, evidence: [{ source: 'Data quality', text: i.detail }], status: 'Open', next: i.fix });
    const seen = new Set();
    return out.filter((a) => (seen.has(a.key) ? false : seen.add(a.key)));
  }

  /* ---------- the status engine: one place decides every color ---------- */
  const STATUS = { CRITICAL: 'Critical', BELOW: 'Below target', AT_RISK: 'At risk', ON_TRACK: 'On track', DONE: 'Completed', VERIFY: 'Needs verification', STALE: 'Stale data' };
  const TONE = { Critical: 'bad', 'Below target': 'bad', 'At risk': 'warn', 'On track': 'ok', Completed: 'ok', 'Needs verification': 'muted', 'Stale data': 'muted' };
  function expectedShare(today, settings = DEFAULTS) {
    const { start, end } = settings.campaign;
    if (!today || today <= start) return 0;
    if (today >= end) return 1;
    return (dayNum(today) - dayNum(start)) / (dayNum(end) - dayNum(start));
  }
  function metricStatus({ actual, target, today, stale, missing, baseline = 0 }, settings = DEFAULTS) {
    if (missing || actual == null) return { status: STATUS.STALE, reason: 'Data not loaded; not counted as zero' };
    if (stale) return { status: STATUS.STALE, reason: 'Source data is older than its refresh window' };
    if (target == null) return { status: STATUS.ON_TRACK, reason: 'No target set' };
    if (actual >= target) return { status: STATUS.DONE, reason: `Target met: ${actual} of ${target}` };
    const share = expectedShare(today, settings);
    /* A count that already stood at `baseline` when the period began is expected to climb from there, not from zero. */
    const expected = Math.round(baseline + Math.max(0, target - baseline) * share);
    if (expected === 0) return { status: STATUS.ON_TRACK, reason: 'Period has not started', expected };
    const gap = Math.max(0, expected - actual);
    /* Too early in the period for a ratio to mean anything: a shortfall of a couple is a warning, not a miss. */
    if (expected - baseline <= 2) return gap ? { status: STATUS.AT_RISK, reason: `${actual} against ${expected} expected by today; ${gap} behind`, expected, gap } : { status: STATUS.ON_TRACK, reason: `${actual} against ${expected} expected by today`, expected, gap };
    const ratio = (actual - baseline) / (expected - baseline);
    if (ratio < settings.belowShare) return { status: STATUS.BELOW, reason: `${actual} against ${expected} expected by today (${target} by ${shortDay(settings.campaign.end)}); ${gap} behind`, expected, gap };
    if (ratio < settings.atRiskShare) return { status: STATUS.AT_RISK, reason: `${actual} against ${expected} expected by today; ${gap} behind`, expected, gap };
    return { status: STATUS.ON_TRACK, reason: `${actual} against ${expected} expected by today`, expected, gap };
  }
  function actionStatus(a) {
    if (a.status === 'Done') return STATUS.DONE;
    if (a.kind === 'proposal') return STATUS.VERIFY;
    if (a.status === 'Overdue' && !a.stale && (a.priorityHint === 'high' || a.category === 'Record a meeting outcome')) return STATUS.CRITICAL;
    if (a.status === 'Overdue') return STATUS.BELOW;
    if (a.status === 'Due soon') return STATUS.AT_RISK;
    return STATUS.ON_TRACK;
  }
  function sourceStatus(s, now, settings = DEFAULTS) {
    if (s.state === 'error') return { status: 'Error', tone: 'bad' };
    if (s.state === 'connect') return { status: 'Needs authorization', tone: 'warn' };
    if (s.state === 'missing') return { status: 'Not configured', tone: 'muted' };
    if (s.state === 'loading') return { status: 'Loading', tone: 'muted' };
    const limit = (s.kind === 'live' ? settings.staleHours.live : settings.staleHours.imported) * 36e5;
    const age = s.at ? (new Date(now).getTime() - new Date(s.at).getTime()) : null;
    if (age != null && age > limit) return { status: STATUS.STALE, tone: 'muted' };
    if (s.kind !== 'live' && !s.at) return { status: STATUS.VERIFY, tone: 'muted' }; /* imported, date unknown */
    return { status: s.kind === 'live' ? 'Connected' : 'Imported', tone: 'ok' };
  }

  /* ---------- the priority engine ---------- */
  function priorityOf(f, F, actions, today, settings = DEFAULTS) {
    const w = settings.weights;
    const reasons = []; const missing = [];
    let score = 0;
    const part = (key, value, why) => { if (value > 0) { const pts = Math.round(value * w[key]); score += pts; reasons.push({ factor: key, points: pts, why }); } };
    const p = f.priority || str(f.telegramPriority).replace(/^P/i, '') || null;
    part('strategic', p === '1' ? 1 : p === '3' ? 0.6 : p === '5' ? 0.25 : 0, p ? `Priority ${p}${f.priority ? ' in Zoho' : ' in the team’s chat'}` : '');
    if (!p) missing.push('Priority');
    part('opportunity', F.openDeals.length ? 1 : F.agreements.some((a) => a.state !== 'Signed') ? 0.8 : 0, F.openDeals.length ? `${F.openDeals.length} open deal${F.openDeals.length > 1 ? 's' : ''}` : 'Referral agreement out, not signed');
    part('relationship', F.meetingDays.length >= 2 ? 1 : F.meetingDays.length === 1 ? 0.7 : F.twoWay ? 0.5 : (f.linkedinConn && f.linkedinConn.ties.length) ? 0.4 : 0, F.meetingDays.length ? `${F.meetingDays.length} meeting day${F.meetingDays.length > 1 ? 's' : ''} held` : F.twoWay ? 'Two-way contact' : 'Endorsed or recommended each other on LinkedIn');
    const commits = actions.filter((a) => a.kind === 'commitment' && a.status !== 'Done');
    part('commitments', commits.length ? 1 : 0, `${commits.length} open commitment${commits.length > 1 ? 's' : ''}`);
    part('intro', F.intro ? 1 : 0, 'An introduction or referral is mentioned');
    if (!f.outlook) missing.push('Outlook check');
    const gap = F.lastInteraction ? daysBetween(F.lastInteraction, today) : null;
    part('recency', p === '1' || p === '3' ? (gap == null ? 1 : gap > 60 ? 1 : gap > 30 ? 0.6 : 0) : 0, gap == null ? 'No interaction on record' : `Last interaction ${gap} days ago`);
    const until = F.upcoming ? daysBetween(today, F.upcoming) : null;
    part('upcoming', until != null && until <= 7 ? 1 : 0, `Meeting in ${until} day${until === 1 ? '' : 's'}`);
    const urgent = actions.slice().sort((x, y) => rankAction(x) - rankAction(y)).find((a) => a.status !== 'Done' && ((a.kind === 'commitment' && a.status === 'Overdue' && !a.stale) || (a.category === 'Prepare for a meeting' && a.status === 'Due soon')));
    const review = !f.zoho || f.identities.some((i) => i.confidence === 'possible' || i.confidence === 'partial') || f.issues.some((i) => i.type === 'Needs a full name');
    let band = score >= settings.bands.high ? 'High priority' : score >= settings.bands.normal ? 'Normal' : 'Nurture';
    if (review) band = 'Needs review';
    if (urgent) band = 'Urgent';
    return { score, band, reasons, incomplete: missing, urgentBecause: urgent ? urgent.text : null };
  }

  /* ---------- one call builds everything the page shows ---------- */
  function run(src, settings = DEFAULTS) {
    const today = ctDay(src.now || new Date(), settings.tz);
    const founders = buildFounders(src, settings);
    const rows = founders.map((f) => {
      const F = facts(f, today);
      const actions = actionsFor(f, F, today, settings).map((a) => Object.assign(a, { statusLabel: actionStatus(a) }));
      const pr = priorityOf(f, F, actions, today, settings);
      const open = actions.filter((a) => a.status !== 'Done');
      const next = open.slice().sort((a, b) => rankAction(a) - rankAction(b))[0] || null;
      return Object.assign(f, { facts: F, actions, priorityInfo: pr, stage: stageOf(f, F), lastInteraction: F.lastInteraction, upcoming: F.upcoming, next: next ? next.text : null,
        verification: f.zoho && f.inFN ? (f.identities.every((i) => i.confidence !== 'possible') ? 'Verified' : 'Partly verified') : f.zoho ? 'In Zoho, not Founder Network' : 'Not in Zoho' });
    });
    return { today, founders: rows };
  }
  const ACTION_ORDER = ['Critical', 'Below target', 'At risk', 'Needs verification', 'On track', 'Completed'];
  /* Most severe first; within a status, recent misses before ones so old they need closing, then the longest overdue. */
  function rankAction(a) { return ACTION_ORDER.indexOf(a.statusLabel || actionStatus(a)) * 1000 + (a.stale ? 500 : 0) - Math.min(a.overdueDays || 0, 499); }

  /* ---------- targets ---------- */
  function targets(model, src, settings = DEFAULTS) {
    const today = model.today; const start = settings.campaign.start;
    const fn = model.founders.filter((f) => f.inFN && !['9', '11'].includes(f.priority));
    const meetingDays = new Set();
    for (const f of fn) for (const d of f.facts.meetingDays) if (d >= start && d <= today) meetingDays.add(f.id + '|' + d);
    const ag = fn.flatMap((f) => f.facts.agreements);
    const before = (d) => { const x = ctDay(d, settings.tz); return Boolean(x && x < start); };
    const baselines = {
      members: fn.filter((f) => f.zoho && before(f.zoho.Created_Time)).length,
      agreements_sent: ag.filter((a) => before(a.sent)).length,
      agreements_signed: ag.filter((a) => a.state === 'Signed' && before(a.completed)).length,
    };
    const counts = {
      members: src.missing && src.missing.fn ? null : fn.length,
      meetings: src.missing && src.missing.events ? null : meetingDays.size,
      agreements_sent: src.missing && src.missing.agreements ? null : ag.length,
      agreements_signed: src.missing && src.missing.agreements ? null : ag.filter((a) => a.state === 'Signed').length,
      opportunities: src.missing && src.missing.deals ? null : fn.reduce((t, f) => t + f.facts.openDeals.length, 0),
      closed: src.missing && src.missing.deals ? null : fn.reduce((t, f) => t + f.facts.won.length, 0),
    };
    return settings.targets.map((t) => Object.assign({}, t, { actual: counts[t.id] }, metricStatus({ actual: counts[t.id], target: t.target, today, missing: counts[t.id] == null, baseline: baselines[t.id] || 0 }, settings), { baseline: baselines[t.id] || 0 }));
  }

  const api = { DEFAULTS, STATUS, TONE, STAGES, STAGE_RULES, ctDay, daysBetween, nameToks, personKey, keyOfName, slugOf, lev, zohoIndex, matchPerson, buildFounders, facts, stageOf, actionsFor, actionStatus, metricStatus, sourceStatus, expectedShare, priorityOf, run, targets, rankAction };
  root.FN_ENGINE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
