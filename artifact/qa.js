/* Quality Assurance: duplicates and data gaps across every Zoho Contact, Account and Deal, by campaign, with a merge
   plan per duplicate group. Read-only: every fix is made in Zoho and shows here at the next refresh. Loaded after the
   page script; uses the page's dash, CC_RULES and CC_NAMES. */
(() => {
  const R = CC_RULES;
  const ZOHO = 'https://crm.zoho.com/crm/org899412015/tab/';
  const CAMPS = [['rp', CC_NAMES.rp], ['icp', CC_NAMES.icp], ['fn', CC_NAMES.fn], ['mc', CC_NAMES.mc], ['none', 'Not in a campaign']];
  const CAMP_NAME = Object.fromEntries(CAMPS);
  const OUR_DOMAINS = ['techtranspire.com', 'trueleansolutions.com', 'truelean.com'];
  const OWN_CO = /tech\s*-?\s*transpire|true\s*lean/i;
  const FREE = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'protonmail.com', 'proton.me', 'gmx.com', 'mail.com', 'zoho.com', 'rediffmail.com', 'sbcglobal.net', 'comcast.net', 'att.net', 'verizon.net', 'bellsouth.net', 'cox.net', 'charter.net']);
  const SOCIAL = new Set(['linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'google.com', 'sites.google.com', 'wixsite.com', 'godaddysites.com']);
  const PLACEHOLDER = /^(n\/?a|na|none|null|unknown|test|tbd|self|self[\s-]?employed|freelance(r)?|independent|independent consultant|consultant|contractor|founder|founder & ceo|founder and ceo|ceo|owner|retired|individual|personal|private|student|stealth|stealth startup|stealth ai startup|-|\.|x)$/i;
  const HONORIFIC = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir']);
  const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'mba', 'ed', 'd', 'cpa', 'pmp', 'esq', 'pe', 'cfa']);
  const LEGAL = new Set(['inc', 'incorporated', 'llc', 'l', 'c', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'pvt', 'private', 'plc', 'gmbh', 'llp', 'lp', 'pllc', 'pc', 'the', 'sa', 'bv', 'ag', 'pty']);
  const PRIO_RANK = { 99: 6, 1: 5, 3: 4, 5: 3, 9: 1, 11: 0 };
  const LI_RANK = { Connected: 3, 'Email Required': 2, Requested: 1 };
  const STAGE_RANK = { Closed: 7, Proposals: 6, Discovery: 5, Identify: 4, Hold: 3, 'Closed Lost': 2, 'Closed Lost to Competition': 1 };
  const STALE_DAYS = 14;

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
  [['qa_contacts', 'Every Zoho contact, first 2,000 by record ID'], ['qa_contacts_2', 'Every Zoho contact, 2,001 to 4,000 by record ID'], ['qa_contacts_3', 'Every Zoho contact, 4,001 to 6,000 by record ID'], ['qa_contacts_4', 'Every Zoho contact, 6,001 to 8,000 by record ID'], ['qa_accounts', 'Every Zoho account']]
    .forEach(([id, d]) => dash.loader(id, { description: `Zoho’s COQL answer as rows (${d}): a lookup becomes its name (and _id), a multi-select or tag list becomes text.`, fn: coqlRows }));

  /* ---------- text helpers ---------- */
  const deaccent = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const words = (s) => deaccent(s).toLowerCase().replace(/&amp;/g, ' and ').replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean);
  const normName = (s) => words(s).filter((w) => !HONORIFIC.has(w) && !SUFFIX.has(w)).join(' ');
  const normCo = (s) => words(s).filter((w) => !LEGAL.has(w)).join(' ');
  const email = (s) => { const e = String(s || '').trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null; };
  const domainOf = (e) => (e ? e.split('@')[1] : null);
  const liSlug = (u) => { const m = String(u || '').match(/linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/i); if (!m) return null; try { return decodeURIComponent(m[1]).toLowerCase().replace(/\/+$/, ''); } catch (e) { return m[1].toLowerCase(); } };
  const webDomain = (u) => {
    const s = String(u || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
    return s && s.includes('.') && !SOCIAL.has(s) ? s : null;
  };
  const digits = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : null; };
  const lev = (a, b, max) => {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      const cur = [i];
      let best = cur[0];
      for (let j = 1; j <= b.length; j += 1) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  };
  const ours = (e) => Boolean(e) && OUR_DOMAINS.includes(domainOf(e));
  const isCaseOff = (s) => { const t = String(s || '').replace(/[^A-Za-z]/g, ''); return t.length > 2 && (t === t.toUpperCase() || t === t.toLowerCase()); };

  /* Union-find over record ids, keeping the reasons for each joined pair. */
  const groups = () => {
    const parent = new Map();
    const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); let c = x; while (parent.get(c) !== r) { const n = parent.get(c); parent.set(c, r); c = n; } return r; };
    const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
    const reasons = new Map();
    return {
      join: (a, b, why) => { add(a); add(b); const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); const k = a < b ? a + '|' + b : b + '|' + a; if (!reasons.has(k)) reasons.set(k, new Set()); reasons.get(k).add(why); },
      same: (a, b) => parent.has(a) && parent.has(b) && find(a) === find(b),
      list: () => {
        const by = new Map();
        [...parent.keys()].forEach((x) => { const r = find(x); if (!by.has(r)) by.set(r, []); by.get(r).push(x); });
        return [...by.values()].filter((g) => g.length > 1).map((ids) => {
          const set = new Set(ids);
          const why = new Set();
          reasons.forEach((w, k) => { const [a] = k.split('|'); if (set.has(a)) w.forEach((x) => why.add(x)); });
          return { ids, reasons: [...why] };
        });
      },
    };
  };

  /* ---------- records ---------- */
  dash.calc('qa_contact_rows', {
    title: 'Every Zoho contact, cleaned up for checking',
    description: 'One row per Zoho contact (all pages merged, each record once): names and company normalized, email and LinkedIn profile read, campaign (Founder Network, then Medical Courier by account tag, then B2B, then ICP, otherwise none), whether it is one of our own people, and linked deals.',
    inputs: ['qa_contacts', 'qa_contacts_2', 'qa_contacts_3', 'qa_contacts_4', 'deals_tagged'],
    fn: (c1, c2, c3, c4, deals_tagged) => {
      const deals = new Map();
      deals_tagged.forEach((d) => { if (d.contact_id) { const k = String(d.contact_id); deals.set(k, (deals.get(k) || 0) + 1); } });
      const seen = new Set();
      const out = [];
      [...c1, ...c2, ...c3, ...c4].forEach((r) => {
        const id = String(r.id || '');
        if (!id || seen.has(id)) return;
        seen.add(id);
        const e1 = email(r.Email); const e2 = email(r.Personal_Email);
        const camps = [];
        if (R.isFN(r.Relationship_Type)) camps.push('fn');
        if (R.hasTag(r['Account_Name.Tag'], R.tags.mc)) camps.push('mc');
        if (R.hasTag(r.Tag, R.tags.rp)) camps.push('rp');
        if (R.hasTag(r.Tag, R.tags.icp) || R.hasTag(r['Account_Name.Tag'], R.tags.icp)) camps.push('icp');
        const full = r.Full_Name || [r.First_Name, r.Last_Name].filter(Boolean).join(' ');
        const bare = String(full).split(',')[0];
        out.push({
          id, name: full || '—', first: r.First_Name || null, last: r.Last_Name || null, nname: normName(bare), ntitle: words(r.Title).join(' '),
          email: e1, email2: e2, raw_email: r.Email || null, phone: digits(r.Phone), title: r.Title || null,
          account: r.Account_Name || null, account_id: r.Account_Name_id ? String(r.Account_Name_id) : null,
          linkedin: r.LinkedIn || null, li_slug: liSlug(r.LinkedIn), tags: r.Tag || '', rel: r.Relationship_Type || '',
          priority: r.Priority != null && r.Priority !== '' ? String(r.Priority) : null, li: r.LI_Connect || null, type: r.Contact_Types || null,
          assigned: r.Assigned || null, dnc: r.DO_NOT_CONTACT === true || r.DO_NOT_CONTACT === 'true', meetings: Number(r.Total_Meetings_Created || 0),
          created: r.Created_Time || null, modified: r.Modified_Time || null,
          camps, camp: camps[0] || 'none', staff: ours(e1) || ours(e2), deals: deals.get(id) || 0,
        });
      });
      return out;
    },
  });

  dash.calc('qa_account_rows', {
    title: 'Every Zoho account, cleaned up for checking',
    description: 'One row per Zoho account: name normalized (legal endings like Inc and LLC dropped), website domain, campaign (Medical Courier or ICP by tag, otherwise the campaign of its contacts), contacts and deals linked.',
    inputs: ['qa_accounts', 'qa_contact_rows', 'deals_tagged'],
    fn: (qa_accounts, people, deals_tagged) => {
      const contacts = new Map(); const camps = new Map();
      people.forEach((p) => { if (!p.account_id) return; contacts.set(p.account_id, (contacts.get(p.account_id) || 0) + 1); if (p.camp !== 'none') { if (!camps.has(p.account_id)) camps.set(p.account_id, new Set()); camps.get(p.account_id).add(p.camp); } });
      const deals = new Map();
      deals_tagged.forEach((d) => { if (d.account_id) { const k = String(d.account_id); deals.set(k, (deals.get(k) || 0) + 1); } });
      return qa_accounts.map((r) => {
        const id = String(r.id);
        const cs = [];
        if (R.hasTag(r.Tag, R.tags.mc)) cs.push('mc');
        if (R.hasTag(r.Tag, R.tags.icp)) cs.push('icp');
        (camps.get(id) || new Set()).forEach((c) => { if (!cs.includes(c)) cs.push(c); });
        const order = ['fn', 'mc', 'rp', 'icp'];
        cs.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        return {
          id, name: r.Account_Name || '—', nname: normCo(r.Account_Name), website: r.Website || null, domain: webDomain(r.Website),
          phone: digits(r.Phone), industry: r.Industries || null, tags: r.Tag || '', priority: r.Priority != null && r.Priority !== '' ? String(r.Priority) : null,
          employees: r.No_Of_employees || null, contacts: contacts.get(id) || 0, deals: deals.get(id) || 0,
          created: r.Created_Time || null, modified: r.Modified_Time || null, camps: cs, camp: cs[0] || 'none', own: OWN_CO.test(String(r.Account_Name || '')),
        };
      });
    },
  });

  /* ---------- duplicates ---------- */
  const filled = (o, keys) => keys.reduce((n, k) => n + (o[k] ? 1 : 0), 0);
  const older = (a, b) => String(a.created || '9').localeCompare(String(b.created || '9'));
  const CONTACT_FIELDS = [['email', 'Email', (r) => r.raw_email], ['email2', 'Personal email', (r) => r.email2], ['phone', 'Phone', (r) => r.phone], ['title', 'Title', (r) => r.title], ['account', 'Account', (r) => r.account], ['linkedin', 'LinkedIn', (r) => r.linkedin], ['assigned', 'Assigned', (r) => r.assigned]];
  const ACCOUNT_FIELDS = [['website', 'Website', (r) => r.website], ['phone', 'Phone', (r) => r.phone], ['industry', 'Industry', (r) => r.industry], ['employees', 'Employees', (r) => r.employees]];
  const contactScore = (r) => r.deals * 40 + r.meetings * 10 + (r.li === 'Connected' ? 6 : r.li ? 3 : 0) + (r.priority ? 5 : 0) + r.camps.length * 4 + filled(r, ['email', 'phone', 'title', 'account_id', 'li_slug', 'first']);
  const accountScore = (r) => r.deals * 30 + r.contacts * 5 + r.camps.length * 4 + filled(r, ['domain', 'phone', 'industry', 'employees']);
  const dealScore = (r) => (STAGE_RANK[r.stage] || 0) * 10 + (r.contact_id ? 5 : 0) + (r.account_id ? 5 : 0) + (r.amount ? 3 : 0);
  const planFor = (recs, score, fields, extra) => {
    const sorted = recs.slice().sort((a, b) => score(b) - score(a) || older(a, b));
    const keep = sorted[0];
    const carry = [];
    sorted.slice(1).forEach((o) => fields.forEach(([k, label, val]) => { if (!keep[k] && o[k] && !carry.some((c) => c.label === label)) carry.push({ label, value: val(o), from: o.name, from_id: o.id }); }));
    return { keep: keep.id, merge: sorted.slice(1).map((r) => r.id), carry, notes: extra ? extra(keep, sorted.slice(1)) : [] };
  };
  const contactNotes = (keep, rest) => {
    const n = [];
    const all = [keep, ...rest];
    const tags = new Set(all.flatMap((r) => String(r.tags || '').split(', ').filter(Boolean)));
    const keepTags = new Set(String(keep.tags || '').split(', ').filter(Boolean));
    const addTags = [...tags].filter((t) => !keepTags.has(t));
    if (addTags.length) n.push(`Add tag${addTags.length > 1 ? 's' : ''} ${addTags.join(', ')} to the kept record.`);
    const bestP = all.reduce((b, r) => ((PRIO_RANK[r.priority] ?? -1) > (PRIO_RANK[b] ?? -1) ? r.priority : b), keep.priority);
    if (bestP && bestP !== keep.priority) n.push(`Set Priority to ${bestP} (the furthest stage among these records).`);
    const bestLi = all.reduce((b, r) => ((LI_RANK[r.li] || 0) > (LI_RANK[b] || 0) ? r.li : b), keep.li);
    if (bestLi && bestLi !== keep.li) n.push(`Set LI Connect to ${bestLi}.`);
    if (rest.some((r) => r.dnc) && !keep.dnc) n.push('One copy is marked Do Not Contact: keep that on the merged record.');
    const accts = new Set(all.map((r) => r.account_id).filter(Boolean));
    if (accts.size > 1) n.push('The copies sit on different Accounts: check which company is current before merging.');
    return n;
  };

  dash.calc('qa_dupes', {
    title: 'Duplicate contacts, accounts and deals',
    description: 'Groups of records that are the same person, company or deal. Sure: same email (and a matching name), same LinkedIn profile, same phone (and a matching name), or the same name at the same Account; for accounts the same name once legal endings are dropped, or the same website; for deals the same name on the same Account, or two open deals of one type for one contact. Likely: names one or two letters apart, or a short form of the name, at the same company or email domain; the same name on different or no Accounts; an account name that contains the other; two deals of one type on one Account. Each group has a record to keep (the one with the most deals, meetings and filled fields; the oldest on a tie), the records to merge into it, and the details to carry over.',
    inputs: ['qa_contact_rows', 'qa_account_rows', 'deals_tagged'],
    fn: (people, accounts, deals_tagged) => {
      const byId = new Map(people.map((p) => [p.id, p]));
      const sure = groups(); const likely = groups();
      const bucket = (key) => { const m = new Map(); people.forEach((p) => { const k = key(p); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(p); }); return [...m.values()].filter((l) => l.length > 1); };
      const nameCompatible = (a, b) => {
        if (!a.nname || !b.nname || a.nname === b.nname) return true;
        const wa = a.nname.split(' '); const wb = b.nname.split(' ');
        const la = wa[wa.length - 1]; const lb = wb[wb.length - 1];
        return la === lb && (wa[0][0] === wb[0][0]);
      };
      const pairs = (list, fn) => { for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) fn(list[i], list[j]); };
      const shared = [];
      bucket((p) => p.email).forEach((l) => pairs(l, (a, b) => (nameCompatible(a, b) ? sure.join(a.id, b.id, 'Same email') : shared.push([a, b]))));
      bucket((p) => p.email2).forEach((l) => pairs(l, (a, b) => { if (nameCompatible(a, b)) sure.join(a.id, b.id, 'Same personal email'); }));
      people.filter((p) => p.email && p.email2 && p.email !== p.email2).forEach((p) => people.forEach((q) => { if (q.id !== p.id && q.email === p.email2 && nameCompatible(p, q)) sure.join(p.id, q.id, 'Same email'); }));
      bucket((p) => p.li_slug).forEach((l) => pairs(l, (a, b) => sure.join(a.id, b.id, 'Same LinkedIn profile')));
      bucket((p) => p.phone).forEach((l) => pairs(l, (a, b) => { if (a.nname && a.nname === b.nname) sure.join(a.id, b.id, 'Same phone'); }));
      bucket((p) => (p.nname.includes(' ') && p.account_id ? p.nname + '|' + p.account_id : null)).forEach((l) => pairs(l, (a, b) => sure.join(a.id, b.id, 'Same name at the same Account')));
      /* Likely: compare within blocks that share a company, an email domain or a last name. */
      const blocks = [
        ['co', (p) => p.account_id],
        ['dom', (p) => (p.email && !FREE.has(domainOf(p.email)) && !ours(p.email) ? domainOf(p.email) : null)],
        ['last', (p) => { const w = p.nname.split(' '); return w.length > 1 ? w[w.length - 1] : null; }],
      ];
      const sameCo = (a, b) => (a.account_id && a.account_id === b.account_id) || (a.email && b.email && domainOf(a.email) === domainOf(b.email) && !FREE.has(domainOf(a.email)));
      blocks.forEach(([kind, key]) => bucket(key).forEach((l) => {
        if (l.length > 600) return;
        pairs(l, (a, b) => {
          if (sure.same(a.id, b.id) || !a.nname || !b.nname) return;
          const wa = a.nname.split(' '); const wb = b.nname.split(' ');
          if (wa.length < 2 || wb.length < 2) return;
          if (a.nname === b.nname) {
            const stub = (r) => !r.email && !r.email2 && !r.li_slug && !r.phone;
            const backed = (a.ntitle && a.ntitle === b.ntitle) || sameCo(a, b) || stub(a) || stub(b);
            if (backed) likely.join(a.id, b.id, a.account_id && b.account_id ? 'Same name, different Accounts' : 'Same name, no Account on one or both');
            return;
          }
          if (!sameCo(a, b) && kind !== 'last') return;
          if (kind === 'last' && !sameCo(a, b)) return;
          const max = Math.max(a.nname.length, b.nname.length) >= 12 ? 2 : 1;
          if (lev(a.nname, b.nname, max) <= max) { likely.join(a.id, b.id, 'Name spelled slightly differently, same company'); return; }
          const la = wa[wa.length - 1]; const lb = wb[wb.length - 1];
          const fa = wa[0]; const fb = wb[0];
          if (la === lb && fa !== fb && (fa.startsWith(fb) || fb.startsWith(fa)) && Math.min(fa.length, fb.length) >= 1) likely.join(a.id, b.id, 'Short form of the first name, same company');
        });
      }));
      const contactGroups = (g, level) => g.list().map((x, i) => {
        const recs = x.ids.map((id) => byId.get(id)).filter(Boolean);
        return { id: 'c' + level[0] + i, module: 'Contacts', level, reasons: x.reasons, records: recs.map((r) => r.id), camps: [...new Set(recs.map((r) => r.camp))], plan: planFor(recs, contactScore, CONTACT_FIELDS, contactNotes) };
      });
      const cSure = contactGroups(sure, 'sure');
      const sureSets = cSure.map((g) => new Set(g.records));
      const cLikely = contactGroups(likely, 'likely').filter((g) => !sureSets.some((s) => g.records.every((id) => s.has(id))));

      /* Accounts. */
      const aById = new Map(accounts.map((a) => [a.id, a]));
      const aSure = groups(); const aLikely = groups();
      const aBucket = (key) => { const m = new Map(); accounts.forEach((a) => { const k = key(a); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(a); }); return [...m.values()].filter((l) => l.length > 1); };
      aBucket((a) => (a.nname.length >= 3 ? a.nname : null)).forEach((l) => pairs(l, (a, b) => aSure.join(a.id, b.id, 'Same name')));
      aBucket((a) => a.domain).forEach((l) => pairs(l, (a, b) => aSure.join(a.id, b.id, 'Same website')));
      aBucket((a) => (a.nname.length >= 4 ? a.nname.slice(0, 3) : null)).forEach((l) => {
        if (l.length > 800) return;
        pairs(l, (a, b) => {
          if (aSure.same(a.id, b.id)) return;
          const max = Math.max(a.nname.length, b.nname.length) >= 12 ? 2 : 1;
          if (Math.min(a.nname.length, b.nname.length) >= 6 && lev(a.nname, b.nname, max) <= max) { aLikely.join(a.id, b.id, 'Name spelled slightly differently'); return; }
          const [s, t] = a.nname.length <= b.nname.length ? [a.nname, b.nname] : [b.nname, a.nname];
          if ((s.split(' ').length >= 2 || s.length >= 8) && (t.startsWith(s + ' '))) aLikely.join(a.id, b.id, 'One name is the start of the other');
        });
      });
      const accountGroups = (g, level) => g.list().map((x, i) => {
        const recs = x.ids.map((id) => aById.get(id)).filter(Boolean);
        return { id: 'a' + level[0] + i, module: 'Accounts', level, reasons: x.reasons, records: recs.map((r) => r.id), camps: [...new Set(recs.map((r) => r.camp))], plan: planFor(recs, accountScore, ACCOUNT_FIELDS, (keep, rest) => (rest.some((r) => r.contacts || r.deals) ? ['Zoho moves the contacts, deals and activities of the merged accounts onto the kept one.'] : [])) };
      });
      const aSureG = accountGroups(aSure, 'sure');
      const aSets = aSureG.map((g) => new Set(g.records));
      const aLikelyG = accountGroups(aLikely, 'likely').filter((g) => !aSets.some((s) => g.records.every((id) => s.has(id))));

      /* Deals. */
      const drecs = deals_tagged.map((d) => ({ id: String(d.id), name: d.deal || '—', nname: normCo(d.deal), stage: d.stage, kind: d.kind, account: d.account, account_id: d.account_id ? String(d.account_id) : null, contact: d.contact, contact_id: d.contact_id ? String(d.contact_id) : null, amount: d.amount || 0, created: d.created || null, camp: { 'B2B Campaign': 'rp', 'ICP Prospecting': 'icp', 'Founder Network': 'fn', 'Medical Courier': 'mc' }[d.campaign] || 'none' }));
      const dById = new Map(drecs.map((d) => [d.id, d]));
      const dSure = groups(); const dLikely = groups();
      const open = (d) => R.openStages.includes(d.stage);
      const lost = (d) => R.lostStages.includes(d.stage);
      pairs(drecs, (a, b) => {
        if (a.account_id && a.account_id === b.account_id && a.nname && a.nname === b.nname) dSure.join(a.id, b.id, 'Same name on the same Account');
        else if (a.kind !== 'Client' && a.contact_id && a.contact_id === b.contact_id && a.kind === b.kind && open(a) && open(b)) dSure.join(a.id, b.id, `Two open ${a.kind === 'Partnership' ? 'Referral Partner' : 'Platform Provider'} deals for one contact`);
        else if (a.kind !== 'Client' && a.account_id && a.account_id === b.account_id && a.kind === b.kind && !lost(a) && !lost(b)) dLikely.join(a.id, b.id, `Two ${a.kind === 'Partnership' ? 'Referral Partner' : 'Platform Provider'} deals on one Account`);
      });
      const dealGroups = (g, level) => g.list().map((x, i) => {
        const recs = x.ids.map((id) => dById.get(id)).filter(Boolean);
        return { id: 'd' + level[0] + i, module: 'Deals', level, reasons: x.reasons, records: recs.map((r) => r.id), camps: [...new Set(recs.map((r) => r.camp))], plan: planFor(recs, dealScore, [['amount', 'Amount', (r) => r.amount], ['contact_id', 'Contact', (r) => r.contact], ['account_id', 'Account', (r) => r.account]], () => ['Keep the furthest stage; close the others as duplicates, or merge them if your Zoho edition allows it.']) };
      });
      const dSureG = dealGroups(dSure, 'sure');
      const dLikelyG = dealGroups(dLikely, 'likely').filter((g) => !dSureG.some((s) => g.records.every((id) => s.records.includes(id))));
      const bySize = (a, b) => b.records.length - a.records.length;
      return [...cSure.sort(bySize), ...cLikely.sort(bySize), ...aSureG.sort(bySize), ...aLikelyG.sort(bySize), ...dSureG.sort(bySize), ...dLikelyG.sort(bySize)]
        .map((g) => ({ ...g, shared: undefined }))
        .concat(shared.map(([a, b], i) => ({ id: 'cx' + i, module: 'Contacts', level: 'shared', reasons: ['Different people with the same email'], records: [a.id, b.id], camps: [...new Set([a.camp, b.camp])], plan: null })));
    },
  });

  /* ---------- data health checks ---------- */
  dash.calc('qa_checks', {
    title: 'Data health checks',
    description: 'Each check lists the Zoho records that fail it, with why it matters and how to fix it. Our own team’s contacts (techtranspire.com, trueleansolutions.com) are left out of the contact checks.',
    inputs: ['qa_contact_rows', 'qa_account_rows', 'deals_tagged'],
    fn: (people, accounts, deals_tagged) => {
      const C = people.filter((p) => !p.staff);
      const camp = (p) => p.camp !== 'none';
      const accById = new Map(accounts.map((a) => [a.id, a]));
      const personById = new Map(people.map((p) => [p.id, p]));
      const contactNames = new Set(people.filter((p) => p.nname.includes(' ')).map((p) => p.nname));
      const today = Date.now();
      const out = [];
      const check = (id, module, label, severity, why, fix, list, detail) => out.push({ id, module, label, severity, why, fix, rows: list.map((r) => ({ id: r.id, name: r.name, camp: r.camp, company: r.account || r.name, detail: detail ? detail(r) : null })) });
      check('c-unreach', 'Contacts', 'No email, phone or LinkedIn', 'high', 'Nobody can reach this person, so the record can’t move forward in any campaign.', 'Find their work email or LinkedIn profile and add it, or delete the record if it’s junk.', C.filter((p) => !p.email && !p.email2 && !p.phone && !p.li_slug));
      check('c-bademail', 'Contacts', 'Email that isn’t a valid address', 'high', 'Mail to it bounces and the email history can’t match it.', 'Correct the address in Zoho.', C.filter((p) => p.raw_email && !p.email), (p) => 'Typed as: ' + String(p.raw_email).replace(/^(.).*?@/, '$1***@'));
      check('c-ownacct', 'Contacts', 'Account is our own company', 'high', 'A prospect filed under Tech Transpire or True Lean hides their real company and breaks deals and reports.', 'Set the Account to the company they work for.', C.filter((p) => p.account && OWN_CO.test(p.account)));
      check('c-dnc', 'Contacts', 'Do Not Contact but still in outreach', 'high', 'They asked not to be contacted, yet Priority 1, 3 or 5 keeps them in our queues.', 'Set Priority to 11 (Do Not Contact) and close their open tasks.', C.filter((p) => p.dnc && ['1', '3', '5'].includes(p.priority)), (p) => 'Priority ' + p.priority);
      check('c-noacct', 'Contacts', 'No Account', 'medium', 'Without a company there is no deal to create, no account-level view and no warm path.', 'Find or create their company’s Account and set it on the contact.', C.filter((p) => !p.account_id));
      check('c-placeholder', 'Contacts', 'Account is a placeholder or a person’s name', 'medium', 'Accounts like “Contractor”, “Founder & CEO” or a person’s own name hide the real company and multiply into duplicates.', 'Point the contact at their real company’s Account; for an independent consultant, use their practice’s name.', C.filter((p) => p.account && (PLACEHOLDER.test(p.account.trim()) || (contactNames.has(normName(p.account)) && normName(p.account) === p.nname))), (p) => p.account);
      check('c-namesplit', 'Contacts', 'First and last name in the wrong fields', 'medium', 'Mail merges open “Hi ,” and duplicate checks miss the person.', 'Put the first name in First Name and the rest in Last Name.', C.filter((p) => (!p.first && String(p.last || '').trim().includes(' ')) || (p.first && p.last && normName(p.first) === normName(p.last))), (p) => `First: ${p.first || 'empty'}; Last: ${p.last || 'empty'}`);
      check('c-case', 'Contacts', 'Name in all capitals or all lower case', 'low', 'Looks careless in emails and mail merges.', 'Write the name as the person does, e.g. “Kiran Patil”.', C.filter((p) => isCaseOff(p.first) || isCaseOff(p.last)));
      check('c-noprio', 'Contacts', 'Campaign contact with no Priority', 'medium', 'Without a Priority nobody knows which stage they are in, and the funnels miss them.', 'Set Priority per the B2B Priority Definition (5 backlog, 3 outreach, 1 two-way, 99 signed).', C.filter((p) => camp(p) && !p.priority), (p) => CAMP_NAME[p.camp]);
      check('c-noli', 'Contacts', 'Campaign contact with no LinkedIn profile', 'medium', 'Outreach starts on LinkedIn; without the profile the team can’t connect or check fit, and duplicates can’t be caught by profile.', 'Add their LinkedIn profile URL.', C.filter((p) => camp(p) && !p.li_slug && !['9', '11'].includes(p.priority)), (p) => (p.linkedin ? 'Not a profile link: ' + String(p.linkedin).slice(0, 60) : 'Empty'));
      check('c-notitle', 'Contacts', 'Campaign contact with no Title', 'low', 'Seniority drives who to ask for a meeting; without a title they rank last.', 'Add their job title from LinkedIn.', C.filter((p) => camp(p) && !p.title && !['9', '11'].includes(p.priority)));
      check('c-twocamps', 'Contacts', 'Tagged for both B2B and ICP', 'low', 'One person counts in two campaigns and may get two outreach sequences.', 'Keep the tag for the campaign they belong to and remove the other.', C.filter((p) => p.camps.includes('rp') && p.camps.includes('icp') && !p.camps.includes('fn')));
      /* Accounts. */
      const A = accounts.filter((a) => !a.own);
      check('a-placeholder', 'Accounts', 'Placeholder or person’s-name Account', 'medium', 'Not a real company, so it collects unrelated people and deals.', 'Move its contacts and deals to their real companies, then delete it.', A.filter((a) => PLACEHOLDER.test(a.name.trim()) || /\(placeholder\)/i.test(a.name) || contactNames.has(normName(a.name))));
      check('a-empty', 'Accounts', 'Account with no contacts and no deals', 'low', 'Clutter: it shows up in searches and inflates account counts.', 'Add the right contact, or delete it if it’s not a target.', A.filter((a) => !a.contacts && !a.deals && a.camp === 'none'));
      check('a-noweb', 'Accounts', 'Campaign account with no website', 'low', 'The website is how duplicates are caught and how the team researches fit.', 'Add the company website.', A.filter((a) => a.camp !== 'none' && !a.domain), (a) => (a.website ? 'Not usable: ' + a.website : 'Empty'));
      check('a-noind', 'Accounts', 'Campaign account with no Industry', 'low', 'Industry drives ICP fit and the openers on the ICP tab.', 'Set Industries on the Account.', A.filter((a) => a.camp !== 'none' && !a.industry));
      /* Deals. */
      const D = deals_tagged.map((d) => ({ id: String(d.id), name: d.deal || '—', account: d.account, account_id: d.account_id ? String(d.account_id) : null, contact_id: d.contact_id ? String(d.contact_id) : null, contact: d.contact, stage: d.stage, kind: d.kind, amount: d.amount, updated: d.updated, camp: { 'B2B Campaign': 'rp', 'ICP Prospecting': 'icp', 'Founder Network': 'fn', 'Medical Courier': 'mc' }[d.campaign] || 'none' }));
      check('d-nocontact', 'Deals', 'Deal with no Contact', 'high', 'Nobody is attached, so follow-ups, partner credit and the B2B Deals Created count all miss it.', 'Set Contact Name on the deal.', D.filter((d) => !d.contact_id), (d) => d.stage);
      check('d-noacct', 'Deals', 'Deal with no Account, or on our own company', 'high', 'The deal has no customer company, so it can’t roll up by account.', 'Set Account Name to the customer’s or partner’s company.', D.filter((d) => !d.account_id || OWN_CO.test(String(d.account || ''))), (d) => d.account || 'No Account');
      check('d-mismatch', 'Deals', 'Deal’s Account differs from its Contact’s', 'medium', 'Reports put the deal under one company and the person under another.', 'Make the deal and its contact point at the same Account.', D.filter((d) => d.contact_id && d.account_id && personById.get(d.contact_id) && personById.get(d.contact_id).account_id && personById.get(d.contact_id).account_id !== d.account_id), (d) => `Deal: ${d.account}; contact: ${personById.get(d.contact_id).account}`);
      check('d-notype', 'Deals', 'Deal with no Deal Type', 'medium', 'The dashboard can’t tell a referral partnership from client work.', 'Set Deal Type.', D.filter((d) => d.kind === 'No Deal Type'));
      check('d-stale', 'Deals', `Open deal not updated in ${STALE_DAYS}+ days`, 'medium', 'Stale stages make the pipeline look healthier than it is.', 'Update the stage and next step, or close it.', D.filter((d) => R.openStages.includes(d.stage) && d.updated && today - Date.parse(d.updated) >= STALE_DAYS * 864e5), (d) => `${d.stage}, updated ${Math.floor((today - Date.parse(d.updated)) / 864e5)} days ago`);
      check('d-noamount', 'Deals', 'Open client deal with no Amount', 'low', 'Pipeline value is understated.', 'Add the expected Amount.', D.filter((d) => d.kind === 'Client' && R.openStages.includes(d.stage) && !Number(d.amount)));
      return out;
    },
  });

  /* Clean share by campaign, and the overall score. */
  dash.calc('qa_score', {
    title: 'Data quality score',
    description: 'Share of records with no high or medium issue and in no sure or likely duplicate group: overall (contacts, accounts and deals; our own team left out) and per campaign for contacts.',
    inputs: ['qa_contact_rows', 'qa_account_rows', 'deals_tagged', 'qa_dupes', 'qa_checks'],
    fn: (people, accounts, deals, dupes, checks) => {
      const flagged = new Set();
      dupes.filter((g) => g.level !== 'shared').forEach((g) => g.records.forEach((id) => flagged.add(g.module + id)));
      checks.filter((c) => c.severity !== 'low').forEach((c) => c.rows.forEach((r) => flagged.add(c.module + r.id)));
      const C = people.filter((p) => !p.staff);
      const A = accounts.filter((a) => !a.own);
      const clean = (mod, list) => list.filter((r) => !flagged.has(mod + r.id)).length;
      const total = C.length + A.length + deals.length;
      const ok = clean('Contacts', C) + clean('Accounts', A) + clean('Deals', deals.map((d) => ({ id: String(d.id) })));
      const rows = CAMPS.map(([k, label]) => {
        const list = C.filter((p) => p.camp === k);
        const dup = list.filter((p) => dupes.some((g) => g.module === 'Contacts' && g.level !== 'shared' && g.records.includes(p.id))).length;
        const good = clean('Contacts', list);
        return { key: k, label, total: list.length, clean: good, dupes: dup, issues: list.length - good - dup < 0 ? 0 : list.length - good - dup, score: list.length ? good / list.length : null };
      });
      return [{ key: 'all', label: 'All records', total, clean: ok, score: total ? ok / total : null, contacts: C.length, accounts: A.length, deals: deals.length }, ...rows];
    },
  });

  /* ---------- view ---------- */
  const root = document.querySelector('#qa-root');
  if (!root) return;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const intF = (v) => Number(v || 0).toLocaleString('en-US');
  const pctF = (v) => (v == null ? '—' : Math.round(v * 100) + '%');
  const dayF = (s) => (s ? new Date(s).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const link = (module, id, text) => { const a = el('a', 'cc-zlink', text); a.href = ZOHO + module + '/' + id; a.target = '_blank'; a.rel = 'noopener'; a.title = 'Open in Zoho CRM'; return a; };
  const zmod = { Contacts: 'Contacts', Accounts: 'Accounts', Deals: 'Potentials' };
  /* Zoho's merge screen opens straight from a link with the record IDs. It takes at most three records, lists them newest
     first (highest ID) and makes Record 1 the master, whatever order the link gives. */
  const MERGE_MAX = 3;
  const idDesc = (a, b) => (a.length !== b.length ? b.length - a.length : b < a ? -1 : b > a ? 1 : 0);
  const mergeBatches = (plan) => {
    const out = [];
    for (let i = 0; i < plan.merge.length; i += MERGE_MAX - 1) out.push([plan.keep, ...plan.merge.slice(i, i + MERGE_MAX - 1)].map(String));
    return out;
  };
  const mergeUrl = (module, ids) => ZOHO + zmod[module] + '/merge?ids=' + ids.map(encodeURIComponent).join(',');
  const state = (ids) => { const st = ids.map((id) => dash.data(id).status); if (st.some((s) => s === 'loading')) return 'loading'; return st.every((s) => s === 'ok') ? 'ok' : 'error'; };
  const rows = (id) => { const d = dash.data(id); return d.status === 'ok' ? d.data || [] : []; };
  const mask = (e) => (e ? e.replace(/^(.)[^@]*@/, '$1***@') : '—');
  const campBadge = (k) => { const b = el('span', 'cc-qa-camp cc-qa-camp-' + k, CAMP_NAME[k] || k); return b; };
  const SEV = { high: 'High', medium: 'Medium', low: 'Low' };

  root.replaceChildren();
  const hero = el('section', 'cc-card cc-qa-hero');
  const heroText = el('div', 'cc-qa-herotext');
  heroText.append(el('h2', null, 'Quality Assurance'), el('p', 'cc-qa-lede', 'Every Contact, Account and Deal in Zoho, checked for duplicates and gaps, by campaign. Read-only: fix records in Zoho and they clear here at the next refresh.'));
  const heroScore = el('div', 'cc-qa-score');
  const heroStats = el('div', 'cc-qa-stats');
  const heroTools = el('div', 'cc-qa-tools');
  heroText.append(heroStats, heroTools);
  hero.append(heroScore, heroText);
  const campCard = el('section', 'cc-card cc-qa-camps');
  const campHead = el('div', 'cc-qa-head'); campHead.append(el('h3', null, 'Health by campaign'), el('p', 'cc-qa-sub', 'Contacts only. Clean means no high or medium issue and no duplicate. Select a campaign to filter the duplicates and checks below.'));
  const campBody = el('div', 'cc-qa-camprows');
  campCard.append(campHead, campBody);
  const dupCard = el('section', 'cc-card cc-qa-dups');
  const dupHead = el('div', 'cc-qa-head'); dupHead.append(el('h3', null, 'Duplicates'), el('p', 'cc-qa-sub', 'Each group is one person, company or deal stored more than once. The starred record is the one to keep; merge the others into it in Zoho and carry over what’s listed.'));
  const dupTools = el('div', 'cc-qa-dtools');
  const dupBody = el('div', 'cc-qa-groups');
  const dupMore = el('div', 'cc-qa-more');
  dupCard.append(dupHead, dupTools, dupBody, dupMore);
  const chkCard = el('section', 'cc-card cc-qa-checks');
  const chkHead = el('div', 'cc-qa-head'); chkHead.append(el('h3', null, 'Data health checks'), el('p', 'cc-qa-sub', 'Gaps that stop records from working in the campaigns. Select a check to list the records, with the fix.'));
  const chkBody = el('div', 'cc-qa-checkgrid');
  const chkList = el('div', 'cc-qa-checklist'); chkList.hidden = true;
  chkCard.append(chkHead, chkBody, chkList);
  const planCard = el('section', 'cc-card cc-qa-plan');
  const planHead = el('div', 'cc-qa-head'); planHead.append(el('h3', null, 'Make the data top-notch'), el('p', 'cc-qa-sub', 'In this order: the biggest wins first, then the rules that stop the mess coming back.'));
  const planBody = el('div', 'cc-qa-planbody');
  planCard.append(planHead, planBody);
  root.append(hero, campCard, dupCard, chkCard, planCard);

  let campFilter = 'all';
  let dupModule = 'Contacts';
  let dupLevel = 'sure';
  let dupPage = 0;
  let chkOpen = null;
  const PAGE = 8;

  const ring = (score) => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120'); svg.setAttribute('class', 'cc-qa-ring'); svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(ns, 'defs');
    const g = document.createElementNS(ns, 'linearGradient'); g.setAttribute('id', 'cc-qa-grad'); g.setAttribute('x1', '0'); g.setAttribute('y1', '0'); g.setAttribute('x2', '1'); g.setAttribute('y2', '1');
    [['0', 'cc-qa-g1'], ['1', 'cc-qa-g2']].forEach(([o, c]) => { const st = document.createElementNS(ns, 'stop'); st.setAttribute('offset', o); st.setAttribute('class', c); g.append(st); });
    defs.append(g); svg.append(defs);
    const track = document.createElementNS(ns, 'circle'); track.setAttribute('cx', 60); track.setAttribute('cy', 60); track.setAttribute('r', 50); track.setAttribute('class', 'cc-qa-track');
    const arc = document.createElementNS(ns, 'circle'); arc.setAttribute('cx', 60); arc.setAttribute('cy', 60); arc.setAttribute('r', 50); arc.setAttribute('class', 'cc-qa-arc'); arc.setAttribute('pathLength', '100');
    arc.style.strokeDasharray = `${Math.max(0, Math.min(100, (score || 0) * 100)).toFixed(1)} 100`;
    svg.append(track, arc);
    return svg;
  };

  const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const downloadCsv = (dupes, checks, people, accounts, deals) => {
    const lookup = { Contacts: new Map(people.map((p) => [p.id, p])), Accounts: new Map(accounts.map((a) => [a.id, a])), Deals: new Map(deals.map((d) => [String(d.id), { id: String(d.id), name: d.deal, account: d.account }])) };
    const lines = [['Kind', 'Module', 'Group or check', 'Level or severity', 'Record', 'Company', 'Campaign', 'What to do', 'Zoho link'].join(',')];
    dupes.forEach((g) => g.records.forEach((id) => {
      const r = lookup[g.module].get(id) || { name: id };
      const keep = g.plan && g.plan.keep === id;
      const keeper = g.plan ? lookup[g.module].get(g.plan.keep) : null;
      const what = !g.plan ? 'Check: different people share this address; give each their own' : keep ? 'Keep' + (g.plan.carry.length ? '; carry over ' + g.plan.carry.map((c) => c.label + ' from ' + c.from).join(', ') : '') : 'Merge into ' + (keeper ? keeper.name : g.plan.keep);
      lines.push(['Duplicate', g.module, g.reasons.join(' + '), g.level, r.name, r.account || '', CAMP_NAME[r.camp] || '', what, ZOHO + zmod[g.module] + '/' + id].map(csvCell).join(','));
    }));
    checks.forEach((c) => c.rows.forEach((r) => lines.push(['Check', c.module, c.label, c.severity, r.name, r.company || '', CAMP_NAME[r.camp] || '', c.fix + (r.detail ? ' (' + r.detail + ')' : ''), ZOHO + zmod[c.module] + '/' + r.id].map(csvCell).join(','))));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `zoho-quality-fix-list-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const drawHero = (score, dupes, checks, people, accounts, deals) => {
    const all = score[0];
    heroScore.replaceChildren(ring(all.score));
    const lab = el('div', 'cc-qa-scorelab');
    lab.append(el('b', null, pctF(all.score)), el('span', null, 'clean records'));
    heroScore.append(lab);
    heroScore.title = `${intF(all.clean)} of ${intF(all.total)} records have no high or medium issue and no duplicate.`;
    const sure = dupes.filter((g) => g.level === 'sure');
    const likely = dupes.filter((g) => g.level === 'likely');
    const extra = sure.reduce((n, g) => n + g.records.length - 1, 0);
    const high = checks.filter((c) => c.severity === 'high').reduce((n, c) => n + c.rows.length, 0);
    const stat = (n, label, sub, tone, go) => {
      const b = el('button', 'cc-qa-stat cc-qa-' + tone);
      b.type = 'button';
      b.append(el('b', null, intF(n)), el('span', null, label), el('small', null, sub));
      b.addEventListener('click', go);
      return b;
    };
    heroStats.replaceChildren(
      stat(sure.length, 'Sure duplicate groups', `${intF(extra)} extra records to merge away`, sure.length ? 'bad' : 'ok', () => { dupLevel = 'sure'; dupPage = 0; dupModule = (sure.find(() => true) || {}).module || 'Contacts'; drawDupes(); dupCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); }),
      stat(likely.length, 'Likely duplicates', 'Worth a quick look', likely.length ? 'warn' : 'ok', () => { dupLevel = 'likely'; dupPage = 0; dupModule = (likely.find(() => true) || {}).module || 'Contacts'; drawDupes(); dupCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); }),
      stat(high, 'High-severity gaps', 'Records that can’t work as they are', high ? 'bad' : 'ok', () => chkCard.scrollIntoView({ behavior: 'smooth', block: 'start' })),
      stat(all.total, 'Records checked', `${intF(all.contacts)} contacts, ${intF(all.accounts)} accounts, ${intF(all.deals)} deals`, 'none', () => campCard.scrollIntoView({ behavior: 'smooth', block: 'start' })),
    );
    const dl = el('button', 'cc-go cc-qa-dl', 'Download the fix list (CSV)');
    dl.type = 'button';
    dl.title = 'Every duplicate and failed check with what to do and the Zoho link, for working through in a spreadsheet';
    dl.addEventListener('click', () => downloadCsv(dupes, checks, people, accounts, deals));
    heroTools.replaceChildren(dl);
  };

  const drawCamps = (score) => {
    campBody.replaceChildren(...[{ key: 'all', label: 'All campaigns', total: score.slice(1).reduce((n, r) => n + r.total, 0), clean: score.slice(1).reduce((n, r) => n + r.clean, 0), dupes: score.slice(1).reduce((n, r) => n + r.dupes, 0), issues: score.slice(1).reduce((n, r) => n + r.issues, 0) }, ...score.slice(1)].map((r) => {
      const b = el('button', 'cc-qa-camprow' + (campFilter === r.key ? ' cc-qa-on' : ''));
      b.type = 'button'; b.setAttribute('aria-pressed', String(campFilter === r.key));
      const sc = r.total ? r.clean / r.total : null;
      const top = el('div', 'cc-qa-crtop');
      top.append(el('span', 'cc-qa-crname', r.label), el('b', null, pctF(sc)), el('small', null, `${intF(r.total)} contacts`));
      const bar = el('div', 'cc-qa-crbar');
      [['clean', r.clean, 'cc-qa-seg-ok'], ['issues', r.issues, 'cc-qa-seg-warn'], ['dupes', r.dupes, 'cc-qa-seg-bad']].forEach(([k, n, cls]) => { if (!n) return; const s = el('i', cls); s.style.flexGrow = String(n); s.title = `${intF(n)} ${k === 'clean' ? 'clean' : k === 'issues' ? 'with a high or medium issue' : 'in a duplicate group'}`; bar.append(s); });
      const key = el('small', 'cc-qa-crkey', `${intF(r.clean)} clean · ${intF(r.issues)} with issues · ${intF(r.dupes)} duplicated`);
      b.append(top, bar, key);
      b.addEventListener('click', () => { campFilter = campFilter === r.key && r.key !== 'all' ? 'all' : r.key; dupPage = 0; drawAll(); });
      return b;
    }));
  };

  const inCamp = (camps) => campFilter === 'all' || (camps || []).includes(campFilter);
  const drawDupes = () => {
    const people = new Map(rows('qa_contact_rows').map((p) => [p.id, p]));
    const accounts = new Map(rows('qa_account_rows').map((a) => [a.id, a]));
    const deals = new Map(rows('deals_tagged').map((d) => [String(d.id), d]));
    const all = rows('qa_dupes').filter((g) => inCamp(g.camps));
    const count = (m, l) => all.filter((g) => g.module === m && g.level === l).length;
    dupTools.replaceChildren();
    const mods = el('div', 'cc-qa-seg'); mods.setAttribute('role', 'group'); mods.setAttribute('aria-label', 'Record type');
    ['Contacts', 'Accounts', 'Deals'].forEach((m) => {
      const n = all.filter((g) => g.module === m && g.level !== 'shared').length;
      const b = el('button', 'cc-qa-segbtn', `${m} (${intF(n)})`); b.type = 'button'; b.setAttribute('aria-pressed', String(dupModule === m));
      b.addEventListener('click', () => { dupModule = m; dupPage = 0; if (m !== 'Contacts' && dupLevel === 'shared') dupLevel = 'sure'; drawDupes(); });
      mods.append(b);
    });
    const lvls = el('div', 'cc-tools cc-b2-chips cc-qa-lvls');
    [['sure', 'Sure'], ['likely', 'Likely'], ...(dupModule === 'Contacts' ? [['shared', 'Shared email']] : [])].forEach(([l, label]) => {
      const b = el('button', 'cc-chip', `${label} (${intF(count(dupModule, l))})`); b.type = 'button'; b.setAttribute('aria-pressed', String(dupLevel === l));
      b.addEventListener('click', () => { dupLevel = l; dupPage = 0; drawDupes(); });
      lvls.append(b);
    });
    dupTools.append(mods, lvls);
    const list = all.filter((g) => g.module === dupModule && g.level === dupLevel);
    const shown = list.slice(dupPage * PAGE, dupPage * PAGE + PAGE);
    if (!list.length) { dupBody.replaceChildren(el('p', 'cc-qa-clear', dupLevel === 'shared' ? 'No two people share an email address.' : `No ${dupLevel} duplicate ${dupModule.toLowerCase()}${campFilter !== 'all' ? ' in ' + CAMP_NAME[campFilter] : ''}.`)); dupMore.replaceChildren(); return; }
    const recOf = (id) => (dupModule === 'Contacts' ? people.get(id) : dupModule === 'Accounts' ? accounts.get(id) : (() => { const d = deals.get(id); return d ? { id, name: d.deal, account: d.account, account_id: d.account_id, stage: d.stage, contact: d.contact, contact_id: d.contact_id, created: d.created } : null; })());
    dupBody.replaceChildren(...shown.map((g) => {
      const card = el('article', 'cc-qa-group cc-qa-lvl-' + g.level);
      const head = el('header', 'cc-qa-ghead');
      const lvl = el('span', 'cc-qa-pill cc-qa-pill-' + g.level, g.level === 'sure' ? 'Sure' : g.level === 'likely' ? 'Likely' : 'Shared email');
      head.append(lvl);
      g.reasons.forEach((r) => head.append(el('span', 'cc-qa-reason', r)));
      g.camps.filter((c) => c !== 'none').forEach((c) => head.append(campBadge(c)));
      const tbl = el('table', 'cc-tbl cc-qa-gtbl');
      const cols = dupModule === 'Contacts'
        ? [['', (r) => (g.plan && g.plan.keep === r.id ? el('span', 'cc-qa-keep', '★ Keep') : g.plan ? el('span', 'cc-qa-merge', 'Merge') : '')], ['Name', (r) => link('Contacts', r.id, r.name)], ['Account', (r) => (r.account_id ? link('Accounts', r.account_id, r.account) : 'None')], ['Email', (r) => mask(r.email || r.email2)], ['LinkedIn', (r) => (r.li_slug ? '✓' : '—')], ['Priority', (r) => (r.priority ? 'P' + r.priority : '—')], ['Deals · meetings', (r) => `${r.deals} · ${r.meetings}`], ['Created', (r) => dayF(r.created)]]
        : dupModule === 'Accounts'
          ? [['', (r) => (g.plan.keep === r.id ? el('span', 'cc-qa-keep', '★ Keep') : el('span', 'cc-qa-merge', 'Merge'))], ['Account', (r) => link('Accounts', r.id, r.name)], ['Website', (r) => r.domain || '—'], ['Contacts', (r) => intF(r.contacts)], ['Deals', (r) => intF(r.deals)], ['Industry', (r) => r.industry || '—'], ['Created', (r) => dayF(r.created)]]
          : [['', (r) => (g.plan.keep === r.id ? el('span', 'cc-qa-keep', '★ Keep') : el('span', 'cc-qa-merge', 'Merge'))], ['Deal', (r) => link('Potentials', r.id, r.name)], ['Stage', (r) => r.stage || '—'], ['Account', (r) => (r.account_id ? link('Accounts', r.account_id, r.account) : 'None')], ['Contact', (r) => (r.contact_id ? link('Contacts', r.contact_id, r.contact) : 'None')], ['Created', (r) => dayF(r.created)]];
      const th = el('thead'); const hr = el('tr'); cols.forEach(([x]) => { const c = el('th', null, x); c.scope = 'col'; hr.append(c); }); th.append(hr);
      const tb = el('tbody');
      const order = g.plan ? [g.plan.keep, ...g.plan.merge] : g.records;
      order.map(recOf).filter(Boolean).forEach((r) => { const tr = el('tr', g.plan && g.plan.keep === r.id ? 'cc-qa-keeprow' : null); cols.forEach(([, f]) => { const v = f(r); const td = el('td'); if (v instanceof Node) td.append(v); else td.textContent = v == null || v === '' ? '—' : v; tr.append(td); }); tb.append(tr); });
      tbl.append(th, tb);
      const wrap = el('div', 'cc-b2-wrap'); wrap.append(tbl);
      card.append(head, wrap);
      const foot = el('div', 'cc-qa-gfoot');
      if (g.plan) {
        if (g.plan.carry.length) { const p = el('p'); p.append(el('b', null, 'Carry over: ')); p.append(document.createTextNode(g.plan.carry.map((c) => `${c.label} from ${c.from}`).join('; ') + '.')); foot.append(p); }
        g.plan.notes.forEach((n) => foot.append(el('p', null, n)));
        const batches = mergeBatches(g.plan);
        const keepName = (recOf(g.plan.keep) || {}).name || 'the starred record';
        const acts = el('div', 'cc-qa-merge-acts');
        batches.forEach((ids, i) => {
          const pos = ids.slice().sort(idDesc).indexOf(String(g.plan.keep)) + 1;
          const a = el('a', 'cc-qa-mergebtn', batches.length > 1 ? `Merge in Zoho (${i + 1} of ${batches.length})` : 'Merge in Zoho');
          a.href = mergeUrl(dupModule, ids); a.target = '_blank'; a.rel = 'noopener';
          a.title = `Opens Zoho's merge screen with these ${ids.length} records`;
          a.setAttribute('aria-label', `Merge ${ids.length} records into ${keepName} in Zoho (opens a new tab)`);
          const step = el('span', 'cc-qa-mergestep', pos === 1
            ? `${keepName} opens as the master (Record 1). Check the values, then select Merge.`
            : `In Zoho, choose Record ${pos} at the top (${keepName}) to make it the master, check the values, then select Merge.`);
          const row = el('div', 'cc-qa-mergerow'); row.append(a, step); acts.append(row);
        });
        foot.append(acts);
        const how = el('p', 'cc-qa-how');
        how.textContent = `Merge in Zoho opens Zoho's merge screen with these records already chosen; nothing changes until you select Merge there. Zoho moves the related ${dupModule === 'Deals' ? 'contacts, activities and notes' : 'deals, meetings, tasks and notes'} onto the master, keeps the oldest Created Time, and merges up to ${MERGE_MAX} records at a time${batches.length > 1 ? ', so this group takes ' + batches.length + ' merges, in order' : ''}.`;
        foot.append(how);
      } else foot.append(el('p', 'cc-qa-how', 'These are different people with the same email address (often a shared inbox). Give each their own address, or keep the shared one only on the right person.'));
      card.append(foot);
      return card;
    }));
    const pages = Math.ceil(list.length / PAGE);
    dupMore.replaceChildren();
    if (pages > 1) {
      const prev = el('button', 'cc-go', 'Previous'); prev.type = 'button'; prev.disabled = dupPage === 0; prev.addEventListener('click', () => { dupPage -= 1; drawDupes(); dupCard.scrollIntoView({ block: 'start' }); });
      const next = el('button', 'cc-go', 'Next'); next.type = 'button'; next.disabled = dupPage >= pages - 1; next.addEventListener('click', () => { dupPage += 1; drawDupes(); dupCard.scrollIntoView({ block: 'start' }); });
      dupMore.append(prev, el('span', 'cc-qa-pageinfo', `Groups ${intF(dupPage * PAGE + 1)}–${intF(Math.min(list.length, dupPage * PAGE + PAGE))} of ${intF(list.length)}`), next);
    }
  };

  const drawChecks = () => {
    const checks = rows('qa_checks');
    const byMod = ['Contacts', 'Accounts', 'Deals'];
    chkBody.replaceChildren(...byMod.map((m) => {
      const col = el('div', 'cc-qa-checkcol');
      col.append(el('h4', null, m));
      checks.filter((c) => c.module === m).forEach((c) => {
        const list = c.rows.filter((r) => inCamp([r.camp]));
        const b = el('button', 'cc-qa-check cc-qa-sev-' + c.severity + (list.length ? '' : ' cc-qa-pass'));
        b.type = 'button'; b.dataset.k = c.id; b.setAttribute('aria-expanded', String(chkOpen === c.id)); b.setAttribute('aria-controls', 'qa-checklist');
        b.append(el('b', null, intF(list.length)), el('span', null, c.label), el('small', null, list.length ? SEV[c.severity] : 'Passing'));
        b.addEventListener('click', () => { chkOpen = chkOpen === c.id ? null : c.id; drawChecks(); if (chkOpen) chkList.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
        col.append(b);
      });
      return col;
    }));
    chkList.id = 'qa-checklist';
    const c = checks.find((x) => x.id === chkOpen);
    if (!c) { chkList.hidden = true; chkList.replaceChildren(); return; }
    const list = c.rows.filter((r) => inCamp([r.camp]));
    chkList.hidden = false;
    const head = el('div', 'cc-qa-clhead');
    head.append(el('h4', null, `${c.label} (${intF(list.length)})`));
    const close = el('button', 'cc-go', 'Close'); close.type = 'button'; close.addEventListener('click', () => { chkOpen = null; drawChecks(); });
    head.append(close);
    const why = el('p', 'cc-qa-why'); why.append(el('b', null, 'Why it matters: '), document.createTextNode(c.why));
    const fix = el('p', 'cc-qa-fix'); fix.append(el('b', null, 'Fix: '), document.createTextNode(c.fix));
    if (!list.length) { chkList.replaceChildren(head, why, el('p', 'cc-qa-clear', 'Every record passes this check.')); return; }
    const tbl = el('table', 'cc-tbl');
    const th = el('thead'); const hr = el('tr'); ['Record', c.module === 'Contacts' ? 'Account' : c.module === 'Deals' ? 'Account' : 'Campaign', 'Campaign', 'Detail'].forEach((x) => { const t = el('th', null, x); t.scope = 'col'; hr.append(t); }); th.append(hr);
    const tb = el('tbody');
    list.slice(0, 300).forEach((r) => { const tr = el('tr'); const a = el('td'); a.append(link(zmod[c.module], r.id, r.name)); tr.append(a, el('td', null, c.module === 'Accounts' ? (CAMP_NAME[r.camp] || '—') : (r.company && r.company !== r.name ? r.company : '—')), el('td', null, CAMP_NAME[r.camp] || '—'), el('td', null, r.detail || '—')); tb.append(tr); });
    tbl.append(th, tb);
    const wrap = el('div', 'cc-b2-wrap'); wrap.append(tbl);
    chkList.replaceChildren(head, why, fix, wrap);
    if (list.length > 300) chkList.append(el('p', 'cc-qa-sub', `Showing the first 300 of ${intF(list.length)}. The CSV fix list has them all.`));
  };

  const drawPlan = (dupes, checks) => {
    const sure = dupes.filter((g) => g.level === 'sure');
    const steps = [];
    const sureBy = (m) => sure.filter((g) => g.module === m);
    ['Contacts', 'Accounts', 'Deals'].forEach((m) => { const g = sureBy(m); if (g.length) steps.push([`Merge ${intF(g.length)} group${g.length === 1 ? '' : 's'} of duplicate ${m.toLowerCase()}`, `${intF(g.reduce((n, x) => n + x.records.length - 1, 0))} extra records disappear. Start with the biggest groups; keep the starred record and carry over what each group lists.`]); });
    checks.filter((c) => c.severity === 'high' && c.rows.length).forEach((c) => steps.push([`${c.label}: ${intF(c.rows.length)}`, c.fix]));
    const likely = dupes.filter((g) => g.level === 'likely');
    if (likely.length) steps.push([`Review ${intF(likely.length)} likely duplicate groups`, 'Most are the same person or company under a different spelling; merge the ones that are, and fix the spelling on the others so they stop matching.']);
    checks.filter((c) => c.severity === 'medium' && c.rows.length).sort((a, b) => b.rows.length - a.rows.length).forEach((c) => steps.push([`${c.label}: ${intF(c.rows.length)}`, c.fix]));
    const lows = checks.filter((c) => c.severity === 'low' && c.rows.length);
    if (lows.length) steps.push([`Tidy ${intF(lows.reduce((n, c) => n + c.rows.length, 0))} low-severity gaps`, lows.map((c) => c.label.charAt(0).toLowerCase() + c.label.slice(1)).join('; ') + '.']);
    const ol = el('ol', 'cc-qa-steps');
    steps.forEach(([t, d]) => { const li = el('li'); li.append(el('b', null, t), el('span', null, d)); ol.append(li); });
    const byReason = (r) => dupes.filter((g) => g.reasons.includes(r)).length;
    const cnt = (id) => (checks.find((c) => c.id === id) || { rows: [] }).rows.length;
    const rules = [
      [byReason('Same email') + byReason('Same LinkedIn profile') > 0, 'Turn on Zoho’s duplicate check for Contacts on Email and LinkedIn', `${intF(byReason('Same email') + byReason('Same LinkedIn profile'))} groups share an email or LinkedIn profile. Marking those fields as unique (or adding them to the duplicate check) makes Zoho warn before a second copy is saved, including on import.`],
      [byReason('Same name') + byReason('Same website') > 0, 'Make Account Name and Website unique on Accounts', 'Stops a second “Acme Inc” or “acme.com” being created by a different teammate or an import.'],
      [cnt('c-noacct') + cnt('c-noli') + cnt('c-noprio') > 0, 'Require Account, LinkedIn and Priority on campaign contacts', 'Use layout rules or validation rules so a contact with a campaign tag can’t be saved without them; it catches gaps at entry instead of in clean-ups.'],
      [cnt('c-placeholder') + cnt('a-placeholder') > 0, 'One rule for independents', 'Use the consultant’s practice name as the Account (or leave Account empty and tag Independent), never “Contractor”, “Founder & CEO” or the person’s own name.'],
      [cnt('d-nocontact') + cnt('d-noacct') + cnt('d-notype') > 0, 'Require Contact, Account and Deal Type on every deal', 'Every report on this dashboard keys off those three fields; a deal missing one disappears from the campaign views.'],
      [true, 'Turn on history tracking for Priority and LI Connect', 'Gives the Priority 3 panel its Today, Week and Month numbers, and an audit trail of who moved whom.'],
      [true, 'Run this page every Monday', 'Target: 0 sure duplicates and 0 high-severity gaps. The CSV fix list can be split between the team.'],
    ].filter(([on]) => on);
    const rl = el('ul', 'cc-qa-rules');
    rules.forEach(([, t, d]) => { const li = el('li'); li.append(el('b', null, t), el('span', null, d)); rl.append(li); });
    const left = el('div'); left.append(el('h4', null, 'Clean up'), ol);
    const right = el('div'); right.append(el('h4', null, 'Keep it clean'), rl);
    planBody.replaceChildren(left, right);
  };

  const drawAll = () => {
    const st = state(['qa_contact_rows', 'qa_account_rows', 'qa_dupes', 'qa_checks', 'qa_score']);
    if (st !== 'ok') {
      const msg = st === 'loading' ? 'Reading every Contact, Account and Deal from Zoho…' : 'Some Zoho records didn’t load, so the checks can’t run. Reload, or check the source in the dashboard menu.';
      heroScore.replaceChildren(); heroStats.replaceChildren(el('p', st === 'error' ? 'cc-b2-bad' : 'cc-qa-sub', msg)); heroTools.replaceChildren();
      [campBody, dupBody, chkBody, planBody].forEach((n) => n.replaceChildren());
      dupTools.replaceChildren(); dupMore.replaceChildren(); chkList.hidden = true;
      return;
    }
    const dupes = rows('qa_dupes');
    const checks = rows('qa_checks');
    const score = rows('qa_score');
    drawHero(score, dupes.filter((g) => g.level !== 'shared'), checks, rows('qa_contact_rows'), rows('qa_account_rows'), rows('deals_tagged'));
    drawCamps(score);
    drawDupes();
    drawChecks();
    drawPlan(dupes.filter((g) => g.level !== 'shared'), checks);
  };
  dash.onData(drawAll);
})();
