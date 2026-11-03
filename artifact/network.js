/* Mack's Network: every LinkedIn connection in Mack's export (dataset mack_network) and, since Nov 3, 2026, Shruti's
   (dataset shruti_network), read as B2B referral-partner prospects and checked against what we already know: Zoho
   contacts (live), Fireflies calls, the TLS team and advisors, LinkedIn endorsements and, for Shruti, her reviewed
   LinkedIn conversations. One engine (makeNet) draws each network; a chance of a real conversation is estimated live
   from how connections already in our B2B and Founder Network campaigns have done, and the most likely people carry a
   researched brief. A third view puts both together: the people both know, who should reach out, and what a second
   connection on the team is worth. On the private Claude dashboard and the passcode-locked public site, where both
   datasets arrive only sealed. Never written to Zoho. Uses the page's dash and CC_RULES. */
(() => {
  const root = document.getElementById('mn-root');
  if (!root) return;
  const ZOHO = 'https://crm.zoho.com/crm/org899412015/tab/';
  const B2B_TAG = 'May 2026 - 100 B2B';
  const ICP_TAG = '2026ICP';
  const PAGE = 50;
  const SHORTLIST = 12;
  const RIDGE = 4;
  const RES_ODDS = { High: 1.5, Medium: 1, Low: 0.25 };
  const LIKELY_X = 1.5;
  let LIKELY = 30;
  let AVG = 20;
  const GRADES = [
    ['A', 'Strong fit', 'Owner or principal who regularly advises business owners'],
    ['B', 'Possible fit', 'Right kind of role with weaker signals'],
    ['C', 'Weak fit', 'Inside a large company or an unrelated field'],
    ['X', 'Not a prospect', 'Student, job seeker, retired, empty profile or our own team'],
  ];
  const TYPES = [
    ['COACH', 'Business coaches and peer groups'],
    ['SALES_BD', 'Sales, BD and alliances'],
    ['MGMT_CONSULT', 'Management and operations consultants'],
    ['ADVISOR_FIN', 'Finance, legal and M&A advisors'],
    ['FRACTIONAL', 'Fractional and interim executives'],
    ['STAFFING', 'Staffing and recruiting firms'],
    ['IT_SERVICES', 'IT services, MSP and software firms'],
    ['ERP_CRM', 'ERP and CRM consultants'],
    ['AGENCY', 'Marketing and digital agencies'],
    ['VENDOR_ALLIANCE', 'Software vendor alliances'],
    ['INVESTOR', 'Investors'],
    ['ENTERPRISE_EXEC', 'Executives at operating companies'],
    ['EMPLOYEE', 'Employees and other roles'],
  ];
  const TYPE_NAME = Object.fromEntries(TYPES);
  const AGES = [['old', 'Before 2020'], ['mid', '2020 to 2025'], ['new', 'In 2026']];
  const SCOPES = [
    ['new', 'New people', 'not in Zoho and no sign we talk to them yet'],
    ['known', 'Known to us, not in Zoho', 'on our Fireflies calls, in our Outlook, or our team: add them to Zoho'],
    ['zoho', 'Already in Zoho', 'their campaign and Priority, matched live'],
  ];
  const CRM_NAME = { b2b: 'B2B campaign', fn: 'Founder Network', client: 'Client', icp: 'ICP campaign', other: 'In Zoho, no campaign' };
  const REL_NAME = { insider: 'Our team or advisor', works: 'Works with us regularly', talked: 'On our calls', mail: 'In our Outlook' };

  /* ---------- helpers ---------- */
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const intF = (n) => Number(n || 0).toLocaleString('en-US');
  const pctF = (x) => `${Math.round(x * 100)}%`;
  const rows = (id) => { const d = dash.data(id); return d && d.status === 'ok' ? d.data || [] : []; };
  const status = (id) => (dash.data(id) || {}).status;
  const slugOf = (u) => { const m = String(u || '').match(/linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/i); if (!m) return null; try { return decodeURIComponent(m[1]).toLowerCase().replace(/\/+$/, ''); } catch (e) { return m[1].toLowerCase(); } };
  /* Name matching. LinkedIn names carry credentials ("Shah, CPA", "Kotecha, CSPO®"), nicknames in brackets and middle
     initials; Zoho often holds the whole name in Last_Name with First_Name empty. Both sides reduce to the first token of
     the first name and the last token of the last name. */
  const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'mba', 'cpa', 'pmp', 'md', 'esq']);
  const nameToks = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\([^)]*\)/g, ' ').split(',')[0]
    .toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1 && !TITLES.has(t));
  const personKey = (first, last) => {
    let f = nameToks(first);
    let l = nameToks(last);
    if (!f.length && l.length > 1) { f = l.slice(0, 1); l = l.slice(1); }
    return f.length && l.length ? { first: f[0], last: l[l.length - 1] } : null;
  };
  const coToks = (v) => new Set(String(v || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !['inc', 'llc', 'ltd', 'the', 'and', 'group', 'solutions', 'services', 'technologies', 'technology', 'consulting', 'company', 'corp', 'pvt', 'private', 'limited', 'global'].includes(t)));
  const coOverlap = (a, b) => { const x = coToks(a); return [...coToks(b)].some((t) => x.has(t)); };
  /* Among duplicate Zoho contacts for one person, keep the one with the most campaign evidence. */
  const zWeight = (z) => (CC_RULES.isFN(z.Relationship_Type) ? 8 : 0) + (has(z.Tag, B2B_TAG) ? 8 : 0) + (z.Priority ? 4 : 0) + (slugOf(z.LinkedIn) ? 2 : 0) + Math.min(4, num(z.Total_Meetings_Created)) + (z.Account_Name ? 1 : 0);
  const accName = (z) => (z.Account_Name && typeof z.Account_Name === 'object' ? z.Account_Name.name : z.Account_Name) || '';
  const has = (list, v) => String(list || '').split(',').map((x) => x.trim()).includes(v);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const dayF = (s) => { if (!s) return '—'; const d = new Date(String(s).slice(0, 10) + 'T00:00:00Z'); return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }); };
  const yearOf = (s) => Number(String(s || '').slice(0, 4)) || null;
  const ageOf = (s) => { const y = yearOf(s); return !y || y >= 2026 ? 'new' : y <= 2019 ? 'old' : 'mid'; };
  const link = (href, text, title) => { const a = el('a', 'cc-zlink', text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; if (title) a.title = title; return a; };


  /* LinkedIn conversations (Shruti's export): labels from reading each conversation; text never reaches the page. */
  const DM_STATUS = { talking: 'Talking', said_yes: 'Said yes, nothing booked', they_wrote: 'They wrote last', no_reply: 'No reply yet', declined: 'Declined', pitching: 'Pitching their own service', pleasantries: 'Pleasantries only' };
  const DM_ORDER = ['said_yes', 'they_wrote', 'talking', 'no_reply', 'declined', 'pitching', 'pleasantries'];
  const DM_ACT = new Set(['said_yes', 'they_wrote', 'talking']);
  const DM_TALK = new Set(['said_yes', 'they_wrote', 'talking']);
  const dmLine = (d) => `${DM_STATUS[d.status] || 'Messaged'} on LinkedIn (${d.n_in + d.n_out} message${d.n_in + d.n_out === 1 ? '' : 's'}, last ${dayF(d.last)})${d.reply_needed ? ', reply owed' : ''}`;
  REL_NAME.dm = 'Talking on LinkedIn';

  /* Both networks share one engine (Hemang, Nov 3, 2026): Mack's export and Shruti's, each with its own calcs (mn_* and
     sn_*). Shruti's chance comes from a model fitted on both networks' campaign contacts (one row per Zoho contact),
     since her own pool is small; Mack's stays on his own. */
  const NETS = [
    { key: 'mn', ds: 'mack_network', who: 'Mack', whose: 'Mack’s', pron: 'he', modelIn: ['mn_rows'], modelWho: 'Mack’s', modelWho2: 'Mack', file: 'mack-network',
      sharedText: 'Shruti is connected too', waitLabel: 'Still waiting for research', waitText: 'more are still waiting for research',
      sealNote: 'It arrives sealed with the Founder Network files; until then it’s on the private Claude dashboard.', outlookNote: 'checked by hand for everyone on the Known list', footExtra: '', dm: false },
    { key: 'sn', ds: 'shruti_network', who: 'Shruti', whose: 'Shruti’s', pron: 'she', modelIn: ['sn_rows', 'mn_rows'], modelWho: 'Mack’s and Shruti’s', modelWho2: 'we', file: 'shruti-network',
      sharedText: 'Mack is connected too', waitLabel: 'Not identified on the web', waitText: 'more couldn’t be identified on the web (title-based grade only)',
      sealNote: 'It arrives sealed on its own branch; until then it’s on the private Claude dashboard.', outlookNote: 'not checked by hand for this network yet',
      footExtra: ' Her LinkedIn messages were read and labeled (status, reply owed, how to respond, a short note); the message text never leaves the analysis.', dm: true },
  ];

  const makeNet = (cfg, host) => {
  const K = cfg.key;
  const modelPool = () => {
    const lists = cfg.modelIn.map((id) => rows(id));
    const ids = new Set(lists[0].map((r) => r.zoho_id).filter(Boolean));
    return [...lists[0], ...lists.slice(1).flatMap((l) => l.filter((r) => r.zoho_id && !ids.has(r.zoho_id) && ids.add(r.zoho_id)))].filter((r) => r.crm === 'b2b' || r.crm === 'fn');
  };
  /* ---------- calc 1: every connection with its live CRM status and what we already know ---------- */
  dash.calc(K + '_rows', {
    title: `${cfg.whose} LinkedIn connections with CRM status and relationship signals`,
    description: `One row per connection in ${cfg.whose} LinkedIn export (dataset ${cfg.ds}) with the Zoho contact matched by LinkedIn profile (else exact first and last name when only one contact has it): campaign (B2B with Priority, Founder Network, Client, ICP, other), meetings and whether they progressed (Priority 1 or 99, or a meeting); and the scope: Already in Zoho, Known to us (Fireflies calls, TLS team or advisor, team notes) or New.${cfg.dm ? ' Also her reviewed LinkedIn conversations (status, reply owed, how to respond) and whether Mack is connected to them too.' : ''}`,
    inputs: [cfg.ds, 'qa_contacts', 'qa_contacts_2', 'qa_contacts_3', 'qa_contacts_4'],
    fn: (net, a, b, c, d) => {
      const seen = new Set();
      const contacts = [...a, ...b, ...c, ...d].filter((z) => z && z.id && !seen.has(String(z.id)) && seen.add(String(z.id)));
      const bySlug = new Map();
      const byName = new Map();
      const byLast = new Map();
      const push = (m, k, z) => { if (!m.has(k)) m.set(k, []); m.get(k).push(z); };
      contacts.forEach((z) => {
        const s = slugOf(z.LinkedIn);
        if (s && !bySlug.has(s)) bySlug.set(s, z);
        const k = personKey(z.First_Name, z.Last_Name);
        if (k) { push(byName, `${k.first}|${k.last}`, z); push(byLast, k.last, z); }
      });
      /* A name shared by two connections in one export can't tell them apart, so those never match by name. */
      const netKeys = new Map();
      net.forEach((r) => { const k = personKey(r.first, r.last); if (k) { const key = `${k.first}|${k.last}`; netKeys.set(key, (netKeys.get(key) || 0) + 1); } });
      const best = (list) => list.slice().sort((x, y) => zWeight(y) - zWeight(x) || String(x.id).localeCompare(String(y.id)))[0];
      /* The dashboard's file loader can hand nested fields over as JSON text; read them back as objects. */
      const obj = (v) => { if (typeof v !== 'string' || !/^[[{]/.test(v.trim())) return v; try { return JSON.parse(v); } catch (e) { return null; } };
      return net.map((raw) => {
        const r = { ...raw, ties: obj(raw.ties) || [], brief: obj(raw.brief) || null, co_zoho: obj(raw.co_zoho) || null, outlook: obj(raw.outlook) || null, dm: obj(raw.dm) || null, shared: raw.shared === true || raw.shared === 'true',
          client: raw.client === true || raw.client === 'true', calls: num(raw.calls), rel: raw.rel || null, insider: raw.insider || null, last_call: raw.last_call || null };
        if (r.brief && typeof r.brief !== 'object') r.brief = null;
        if (r.co_zoho && typeof r.co_zoho !== 'object') r.co_zoho = null;
        if (r.outlook && typeof r.outlook !== 'object') r.outlook = null;
        if (r.dm && typeof r.dm !== 'object') r.dm = null;
        /* A real two-way LinkedIn conversation makes them known to us, like a call. */
        if (!r.rel && r.dm && DM_TALK.has(r.dm.status)) r.rel = 'dm';
        /* Outlook evidence counts only when the check found the same person and real mail or meetings with them. */
        const ol = r.outlook && r.outlook.identity === 'same person' && (num(r.outlook.email_count) > 0 || num(r.outlook.meeting_count) > 0) ? r.outlook : null;
        if (!r.rel && ol) r.rel = 'mail';
        if (r.brief && !Array.isArray(r.brief.sources)) r.brief.sources = [];
        if (r.co_zoho && !Array.isArray(r.co_zoho.camps)) r.co_zoho.camps = [];
        const s = slugOf(r.url);
        let z = s ? bySlug.get(s) : null;
        let by = z ? 'LinkedIn profile' : null;
        let dups = 0;
        const k = personKey(r.first, r.last);
        if (!z && k && netKeys.get(`${k.first}|${k.last}`) === 1) {
          const list = byName.get(`${k.first}|${k.last}`) || [];
          if (list.length) { z = best(list); by = 'Name'; dups = list.length - 1; }
          else {
            /* Short and long forms of a first name (Matt / Matthew, Vivek / Vivekanand): same last name, first names
               sharing their first three letters, one candidate only, and either a distinctive last name or the same company. */
            const cand = (byLast.get(k.last) || []).filter((zz) => { const zk = personKey(zz.First_Name, zz.Last_Name); return zk && zk.first !== k.first && zk.first.slice(0, 3) === k.first.slice(0, 3) && (zk.first.startsWith(k.first) || k.first.startsWith(zk.first)); });
            if (cand.length === 1 && (k.last.length >= 7 || coOverlap(accName(cand[0]), r.company))) { z = cand[0]; by = 'Name (short form of the first name)'; }
          }
        }
        let crm = null;
        if (z) {
          if (CC_RULES.isFN(z.Relationship_Type)) crm = 'fn';
          else if (has(z.Tag, B2B_TAG)) crm = 'b2b';
          else if (has(z.Relationship_Type, 'Client')) crm = 'client';
          else if (has(z.Tag, ICP_TAG)) crm = 'icp';
          else crm = 'other';
        }
        const priority = z ? String(z.Priority || '') || null : null;
        const meetings = z ? num(z.Total_Meetings_Created) : 0;
        return {
          ...r,
          zoho_id: z ? String(z.id) : null, zoho_assigned: z ? z.Assigned || null : null, zoho_by: by, zoho_dups: dups, zoho_name: z ? [z.First_Name, z.Last_Name].filter(Boolean).join(' ') : null, zoho_account: z ? accName(z) || null : null, crm, priority, meetings,
          dnc: Boolean(z && (z.DO_NOT_CONTACT === true || z.DO_NOT_CONTACT === 'true')),
          progressed: Boolean(z && (priority === '1' || priority === '99' || meetings > 0)),
          scope: z ? 'zoho' : r.rel ? 'known' : 'new',
          age: ageOf(r.connected),
          tie: Array.isArray(r.ties) && r.ties.length > 0,
        };
      });
    },
  });

  /* ---------- the model: ridge logistic regression on Mack's connections already in our campaigns ---------- */
  const FEATS = [...TYPES.map(([k]) => (r) => r.type === k), ...AGES.map(([k]) => (r) => r.age === k), (r) => r.tie, ...['A', 'B', 'C', 'X'].map((g) => (r) => r.fit === g)];
  const featsOf = (r) => [1, ...FEATS.map((f) => (f(r) ? 1 : 0))];
  const sig = (z) => 1 / (1 + Math.exp(-z));
  const score = (w, r) => featsOf(r).reduce((s, v, j) => s + v * w[j], 0);
  /* Newton steps with an L2 penalty (not on the intercept); every feature is 0/1, so a few steps converge. */
  const fitLogit = (rows) => {
    const X = rows.map(featsOf);
    const y = rows.map((r) => (r.progressed ? 1 : 0));
    const d = X[0] ? X[0].length : FEATS.length + 1;
    let w = new Array(d).fill(0);
    for (let it = 0; it < 30; it += 1) {
      const H = Array.from({ length: d }, () => new Array(d).fill(0));
      const g = new Array(d).fill(0);
      X.forEach((x, i) => {
        const p = sig(x.reduce((s, v, j) => s + v * w[j], 0));
        const q = p * (1 - p);
        const on = [];
        x.forEach((v, j) => { if (v) on.push(j); });
        on.forEach((a) => { g[a] += y[i] - p; on.forEach((bb) => { H[a][bb] += q; }); });
      });
      for (let a = 0; a < d; a += 1) { if (a) { g[a] -= RIDGE * w[a]; H[a][a] += RIDGE; } else H[a][a] += 1e-6; }
      const M = H.map((row, i) => [...row, g[i]]);
      for (let c = 0; c < d; c += 1) {
        let piv = c;
        for (let r = c + 1; r < d; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        [M[c], M[piv]] = [M[piv], M[c]];
        for (let r = 0; r < d; r += 1) {
          if (r === c || !M[r][c]) continue;
          const f = M[r][c] / M[c][c];
          for (let k = c; k <= d; k += 1) M[r][k] -= f * M[c][k];
        }
      }
      const dx = M.map((row, i) => row[d] / row[i]);
      w = w.map((v, i) => v + dx[i]);
      if (Math.max(...dx.map(Math.abs)) < 1e-7) break;
    }
    return w;
  };

  /* ---------- calc 2: what turns a connection into a conversation, measured live ---------- */
  dash.calc(K + '_model', {
    title: `What turns ${cfg.modelWho} connections into conversations`,
    description: `Among ${cfg.modelWho} connections already in the B2B campaign or Founder Network (one row per Zoho contact), the share that progressed (Priority 1 or 99, or a meeting), overall and by grade, kind of partner, when they connected and endorsement or recommendation ties; plus a ridge logistic regression (penalty ${RIDGE}) on those same features, tested by 5-fold cross-validation: the share that progressed in the top and bottom fifth of held-out scores, and the AUC.`,
    inputs: cfg.modelIn,
    fn: (...lists) => {
      /* The first list is this network; any other list adds its campaign contacts not already counted (by Zoho contact). */
      const ids = new Set(lists[0].map((r) => r.zoho_id).filter(Boolean));
      const all = [...lists[0], ...lists.slice(1).flatMap((l) => l.filter((r) => r.zoho_id && !ids.has(r.zoho_id) && ids.add(r.zoho_id)))];
      const pool = all.filter((r) => r.crm === 'b2b' || r.crm === 'fn');
      const ok = pool.filter((r) => r.progressed).length;
      const base = pool.length ? ok / pool.length : 0;
      const group = (key, keys) => Object.fromEntries(keys.map((k) => {
        const g = pool.filter((r) => key(r) === k);
        const o = g.filter((r) => r.progressed).length;
        return [k, { ok: o, n: g.length, raw: g.length ? o / g.length : null }];
      }));
      let w = null;
      let test = null;
      if (pool.length >= 100 && ok >= 20) {
        w = fitLogit(pool);
        const held = [];
        for (let f = 0; f < 5; f += 1) {
          const wf = fitLogit(pool.filter((_, i) => i % 5 !== f));
          pool.forEach((r, i) => { if (i % 5 === f) held.push([sig(score(wf, r)), r.progressed ? 1 : 0]); });
        }
        held.sort((x, y) => y[0] - x[0]);
        const q = Math.max(1, Math.round(held.length / 5));
        const rate = (l) => l.reduce((s, x) => s + x[1], 0) / l.length;
        let auc = 0; let pos = 0; let neg = 0;
        held.slice().reverse().forEach(([, yy]) => { if (yy) { auc += neg; pos += 1; } else neg += 1; });
        test = { top: rate(held.slice(0, q)), bottom: rate(held.slice(-q)), auc: pos && neg ? auc / (pos * neg) : null, fifth: q };
      }
      return [{
        base, ok, n: pool.length, w, test,
        byGrade: group((r) => r.fit, ['A', 'B', 'C']),
        byType: group((r) => r.type, TYPES.map(([k]) => k)),
        byAge: group((r) => r.age, AGES.map(([k]) => k)),
        byTie: group((r) => (r.tie ? 'yes' : 'no'), ['yes', 'no']),
      }];
    },
  });

  /* ---------- calc 3: chance of a real conversation for every strong or possible fit ---------- */
  dash.calc(K + '_ranked', {
    title: 'Chance each connection becomes a real conversation',
    description: `For strong and possible fits: the model’s probability from their kind of partner, connection age, endorsement ties and grade; where web research found them, the odds are multiplied by ${RES_ODDS.High} for a High fit or ${RES_ODDS.Low} for a Low one (a judgment, not learned). An estimate from our own results, not a promise.`,
    inputs: [K + '_rows', K + '_model'],
    fn: (all, model) => {
      const m = model[0];
      return all.map((r) => {
        if (!m || !m.w || (r.fit !== 'A' && r.fit !== 'B')) return { ...r, chance: null };
        const res = r.brief && r.brief.check !== 'none' ? r.brief.fit_after_research : null;
        const odds = Math.exp(score(m.w, r)) * (RES_ODDS[res] || 1);
        return { ...r, chance: Math.max(1, Math.round((odds / (1 + odds)) * 100)) };
      });
    },
  });

  /* ---------- static structure ---------- */
  const st = { scope: 'new', grade: new Set(['A', 'B']), type: null, crm: null, q: '', page: 0, sort: 'chance', researched: false, pick: null };
  const section = (cls, title, sub) => {
    const s = el('section', 'cc-card ' + cls);
    const h = el('div', 'cc-card-head');
    const t = el(cls === 'cc-mn-head' ? 'h2' : 'h3', null, title);
    const p = el('p', null, sub || '');
    h.append(t, p);
    s.append(h);
    return { s, t, p };
  };
  const head = section('cc-mn-head', `${cfg.whose} network: who will become a partner`, '');
  const stats = el('div', 'cc-mn-stats');
  head.s.append(stats);
  const learn = section('cc-mn-learn', 'What turns a connection into a conversation', '');
  const learnBody = el('div', 'cc-mn-learngrid');
  const learnTake = el('ul', 'cc-mn-takeaways');
  learn.s.append(learnTake, learnBody);
  const likely = section('cc-mn-likely', 'Most likely to become partners', '');
  const likelyBody = el('div', 'cc-mn-briefs');
  const likelyMore = el('div', 'cc-tools');
  const likelyHelp = el('div');
  likely.s.append(likelyHelp, likelyBody, likelyMore);
  const known = section('cc-mn-known', 'Known to us, but not in Zoho', '');
  const knownBody = el('div', 'cc-mn-tablewrap');
  known.s.append(knownBody);
  const kinds = section('cc-mn-types', 'Where the new partners are', '');
  const kindsBody = el('div', 'cc-mn-bars');
  kinds.s.append(kindsBody);
  const list = section('cc-mn-list', 'Every connection', '');
  list.s.id = K + '-list';
  const scopeBar = el('div', 'cc-mn-scope');
  scopeBar.setAttribute('role', 'tablist');
  const filters = el('div', 'cc-mn-filters');
  const tableWrap = el('div', 'cc-mn-tablewrap');
  const pager = el('div', 'cc-tools cc-mn-pager');
  list.s.insertBefore(scopeBar, list.s.firstChild);
  list.s.append(filters, tableWrap, pager);
  const foot = el('p', 'cc-mn-foot');
  const convo = cfg.dm ? section('cc-mn-convo', 'Her LinkedIn conversations: who to answer and how', '') : null;
  const convoBody = el('div', 'cc-mn-tablewrap');
  if (convo) convo.s.append(convoBody);
  host.replaceChildren(...[head.s, convo && convo.s, learn.s, likely.s, known.s, kinds.s, list.s, foot].filter(Boolean));

  /* ---------- shared pieces ---------- */
  const researched = (r) => Boolean(r.brief && r.brief.check !== 'none');
  const resFit = (r) => (researched(r) ? r.brief.fit_after_research : null);
  const chanceBadge = (r) => {
    const b = el('span', 'cc-mn-chance' + (r.chance >= LIKELY ? ' cc-mn-hi' : r.chance >= AVG ? ' cc-mn-mid' : ''), r.chance == null ? '—' : r.chance + '%');
    b.title = `Estimated chance of a real two-way conversation (Priority 1, signed or a meeting), learned from ${cfg.modelWho} connections already in our campaigns. Average ${AVG}%; ${LIKELY}%+ is ${LIKELY_X}× the average.`;
    return b;
  };
  const gradePill = (g) => { const p = el('span', 'cc-mn-grade cc-mn-g' + g, g); p.title = (GRADES.find((x) => x[0] === g) || [])[1] || ''; return p; };
  const personLink = (r) => (r.url ? link(r.url, r.name, 'Open the LinkedIn profile') : el('b', null, r.name));
  const relLine = (r) => {
    const parts = [];
    const y = yearOf(r.connected);
    if (y) parts.push(`Connected since ${y}`);
    (r.ties || []).forEach((t) => parts.push(t));
    if (r.dm) parts.push(dmLine(r.dm));
    if (r.shared) parts.push(cfg.sharedText);
    if (r.calls) parts.push(`${r.calls} Fireflies call${r.calls === 1 ? '' : 's'}, last ${dayF(r.last_call)}`);
    if (r.insider) parts.push(r.insider);
    if (r.co_zoho && r.scope !== 'zoho') parts.push(`${r.co_zoho.n} colleague${r.co_zoho.n === 1 ? '' : 's'} at ${r.co_zoho.name} in Zoho (${r.co_zoho.camps.join(', ')})`);
    return parts.join(' · ');
  };
  const crmCell = (r) => {
    const w = el('span', 'cc-mn-crm cc-mn-crm-' + (r.crm || 'none'));
    if (r.zoho_id) {
      const label = r.crm === 'b2b' ? `B2B campaign${r.priority ? ', P' + r.priority : ''}` : CRM_NAME[r.crm];
      w.append(link(ZOHO + 'Contacts/' + r.zoho_id, label, `Open in Zoho (matched by ${String(r.zoho_by).toLowerCase()})`));
      if (r.zoho_by && r.zoho_by !== 'LinkedIn profile') {
        const m = el('small', 'cc-mn-matchnote', ` matched by name${r.zoho_dups ? `, ${r.zoho_dups} duplicate${r.zoho_dups === 1 ? '' : 's'} in Zoho` : ''}`);
        m.title = `Zoho record: ${r.zoho_name || '—'}${r.zoho_account ? ` at ${r.zoho_account}` : ''}. Matched by ${String(r.zoho_by).toLowerCase()}, not by LinkedIn profile: add the LinkedIn URL in Zoho to make it certain.`;
        w.append(m);
      }
      if (r.dnc) w.append(el('small', 'cc-mn-dnc', ' Do Not Contact'));
      w.append(el('small', 'cc-mn-matchnote', ` Assigned: ${r.zoho_assigned || 'nobody'}`));
    } else w.textContent = r.rel ? REL_NAME[r.rel] + ', not in Zoho' : 'Not in Zoho';
    return w;
  };
  /* ---------- Add to Zoho ----------
     The dashboard never writes to Zoho. "Add to Zoho" copies the person's details (tagged CCZOHO1) and opens Zoho's own
     New Contact page; the "Fill from dashboard" bookmark, run on that page, reads the clipboard and fills the form.
     The person checks it, picks the Account and presses Save in Zoho. Field ids are this org's Contacts layout. */
  const ZOHO_NEW = ZOHO + 'Contacts/create';
  const FILL_MARK = 'CCZOHO1 ';
  const ZOHO_TAGS = ['Founder_Network', 'May 2026 - 100 B2B'];
  async function ccZohoFill() {
    const ORG = 'org899412015';
    const MARK = 'CCZOHO1 ';
    const toast = (msg, bad) => {
      let t = document.getElementById('cc-zfill-toast');
      if (!t) { t = document.createElement('div'); t.id = 'cc-zfill-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
      t.style.cssText = 'position:fixed;z-index:2147483647;right:20px;bottom:20px;max-width:440px;padding:12px 16px;border-radius:10px;font:13px/1.5 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.28);white-space:pre-line;color:#fff;background:' + (bad ? '#b7373f' : '#1f6f43');
      t.textContent = msg;
      clearTimeout(t.ccTimer);
      t.ccTimer = setTimeout(() => { t.remove(); }, 20000);
    };
    if (location.hostname !== 'crm.zoho.com' || location.pathname.indexOf('/crm/' + ORG + '/tab/Contacts/create') !== 0) {
      toast('Open Zoho’s New Contact page first (Add to Zoho on the dashboard opens it), then click this bookmark.', true);
      return;
    }
    let raw = '';
    try { raw = await navigator.clipboard.readText(); } catch (e) {
      toast('Chrome blocked reading the clipboard. Allow clipboard access for crm.zoho.com, then click the bookmark again.', true);
      return;
    }
    if (typeof raw !== 'string' || raw.indexOf(MARK) !== 0) {
      toast('Nothing to fill. Press Add to Zoho on the dashboard card first, then click this bookmark.', true);
      return;
    }
    let d;
    try { d = JSON.parse(raw.slice(MARK.length)); } catch (e) { toast('The copied details are damaged. Press Add to Zoho on the card again.', true); return; }
    const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
    const q = (s) => document.querySelector(s);
    for (let i = 0; i < 40 && !q('#Crm_Contacts_LASTNAME_LInput'); i += 1) await sleep(250);
    if (!q('#Crm_Contacts_LASTNAME_LInput')) { toast('The New Contact form didn’t finish loading. Wait a moment and click the bookmark again.', true); return; }
    const missed = [];
    const put = (sel, val, label, keepFocus) => {
      if (!val) return;
      const box = q(sel);
      if (!box) { missed.push(label); return; }
      box.focus();
      if (box.select) box.select();
      document.execCommand('insertText', false, String(val));
      box.dispatchEvent(new Event('change', { bubbles: true }));
      if (!keepFocus) box.blur();
      if (String(box.value).trim() !== String(val).trim()) missed.push(label);
    };
    const shown = (btn) => (btn.textContent || '').replace(/\s+/g, ' ').trim();
    const pick = async (id, val, label) => {
      const dd = q('#' + id);
      const btn = dd && dd.querySelector('lyte-drop-button');
      if (!btn) { missed.push(label); return; }
      if (shown(btn).split(/\s*,\s*|\s{2,}/).indexOf(val) !== -1 || shown(btn) === val) return;
      btn.click();
      await sleep(450);
      const open = Array.prototype.slice.call(document.querySelectorAll('lyte-drop-box')).filter((b) => getComputedStyle(b).display !== 'none' && b.querySelector('lyte-drop-item'));
      const items = open.length ? Array.prototype.slice.call(open[open.length - 1].querySelectorAll('lyte-drop-item')) : [];
      const it = items.find((x) => x.getAttribute('data-value') === val) || items.find((x) => x.textContent.trim() === val);
      if (!it) { document.body.click(); missed.push(label); return; }
      it.click();
      await sleep(300);
      document.body.click();
      await sleep(150);
    };
    put('#Crm_Contacts_FIRSTNAME_LInput', d.first, 'First Name');
    put('#Crm_Contacts_LASTNAME_LInput', d.last, 'Last Name');
    put('#Crm_Contacts_TITLE_LInput', d.title, 'Title');
    put('#Crm_Contacts_CONTACTCF11_LInput', d.linkedin, 'LinkedIn');
    put('#Crm_Contacts_DESCRIPTION textarea', d.description, 'Description');
    await pick('Crm_Contacts_CONTACTCF25', d.priority, 'Priority');
    await pick('Crm_Contacts_CONTACTCF16', d.li_connect, 'LI Connect');
    await pick('Crm_Contacts_CONTACTCF23', d.relationship, 'Relationship Type');
    put('#Crm_Contacts_ACCOUNTID', d.company, 'Account Name', true);
    const lines = [missed.length ? 'Filled, except: ' + missed.join(', ') + '. Enter those by hand.' : 'Filled ' + (d.name || 'the contact') + '.'];
    if (d.company) lines.push('Account: pick ' + d.company + ' from the list, or New Account if it isn’t there.');
    lines.push('Contact Type is required: check it before saving.');
    lines.push('After Save, add the tags: ' + (d.tags || []).join(' and ') + '.');
    toast(lines.join('\n'), missed.length > 0);
  }
  const ZOHO_BOOKMARK = 'javascript:' + encodeURIComponent('(' + ccZohoFill.toString() + ')();');
  const cleanLast = (s) => String(s || '').split(',')[0].replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const cleanFirst = (s) => String(s || '').replace(/\([^)]*\)|"[^"]*"/g, ' ').replace(/\s+/g, ' ').trim();
  const zohoPayload = (r) => {
    const b = r.brief || {};
    const y = yearOf(r.connected);
    const why = String(b.why || r.why || '').trim();
    return {
      name: r.name,
      first: cleanFirst(r.first),
      last: cleanLast(r.last) || cleanLast(r.name),
      title: r.position || '',
      company: r.company || '',
      linkedin: r.url || '',
      description: [why, `From ${cfg.whose} LinkedIn network${y ? ', connected since ' + y : ''}.`].filter(Boolean).join(' '),
      priority: '5',
      li_connect: 'Connected',
      relationship: 'Founder Network',
      tags: ZOHO_TAGS,
    };
  };
  const addZohoBtn = (r) => {
    const label = 'Add to Zoho';
    const b = el('button', 'cc-go cc-mn-addz', label);
    b.type = 'button';
    b.title = 'Copies their details and opens Zoho’s New Contact page. There, click your “Fill from dashboard” bookmark, check the form, pick the Account and press Save.';
    b.addEventListener('click', async () => {
      let ok = true;
      try { await navigator.clipboard.writeText(FILL_MARK + JSON.stringify(zohoPayload(r))); } catch (e) { ok = false; }
      const a = document.createElement('a');
      a.href = ZOHO_NEW; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      b.textContent = ok ? 'Copied: use the bookmark in Zoho' : 'Couldn’t copy: allow the clipboard and retry';
      setTimeout(() => { b.textContent = label; }, 4000);
    });
    return b;
  };
  const bookmarkHelp = () => {
    const w = el('div', 'cc-mn-zhelp');
    const t = el('p');
    t.append(el('b', null, 'Add to Zoho: '), document.createTextNode('opens Zoho’s New Contact page with their details copied. One-time setup: copy the bookmark below, add a bookmark in Chrome, paste it as the URL and name it “Fill from dashboard”. On the New Contact page, click it to fill the form, then check it, pick the Account and press Save. Add the tags Founder_Network and May 2026 - 100 B2B after saving.'));
    const c = el('button', 'cc-go cc-mn-copy', 'Copy the bookmark');
    c.type = 'button';
    c.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(ZOHO_BOOKMARK); c.textContent = 'Copied'; } catch (e) { c.textContent = 'Couldn’t copy'; }
      setTimeout(() => { c.textContent = 'Copy the bookmark'; }, 1600);
    });
    w.append(t, c);
    return w;
  };
  const copyBtn = (text) => {
    const b = el('button', 'cc-go cc-mn-copy', 'Copy message');
    b.type = 'button';
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch (e) { b.textContent = 'Select and copy'; }
      setTimeout(() => { b.textContent = 'Copy message'; }, 1600);
    });
    return b;
  };

  /* ---------- head ---------- */
  const goList = (patch) => { Object.assign(st, { page: 0, pick: null }, patch); drawKinds(); drawList(); list.s.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  /* Any count on the tab lists exactly the people it counts (Hemang, Oct 29, 2026): a picked set overrides scope and grade. */
  const pickList = (label, people) => goList({ pick: { label, ids: new Set(people.map((r) => r.url || r.name)) }, q: '', type: null, crm: null, researched: false });
  const keyOfR = (r) => r.url || r.name;
  const numBtn = (n, label, people, text) => { const b = el('button', 'cc-mn-numbtn', text || intF(n)); b.type = 'button'; b.title = `Show ${label.toLowerCase()}`; b.addEventListener('click', (e) => { e.stopPropagation(); pickList(label, people); }); return b; };
  const drawHead = (all) => {
    const fresh = all.filter((r) => r.scope === 'new' && (r.fit === 'A' || r.fit === 'B'));
    const hot = fresh.filter((r) => r.chance >= LIKELY);
    const best = fresh.filter((r) => researched(r) && r.brief.fit_after_research === 'High');
    const knownN = all.filter((r) => r.scope === 'known').length;
    const inZoho = all.filter((r) => r.scope === 'zoho').length;
    const asof = (all[0] || {}).export_date;
    head.p.replaceChildren(numBtn(all.length, 'Every connection', all), document.createTextNode(` connections from ${cfg.whose} LinkedIn export${asof ? ' of ' + dayF(asof) : ''}, each checked against Zoho (live), our Fireflies calls, the TLS team and advisors${cfg.dm ? ', her LinkedIn messages' : ''}, and endorsements between ${cfg.who} and them, and ranked by the chance of a real conversation learned from our own results. `), numBtn(fresh.length, 'New strong or possible fits', fresh), document.createTextNode(' of them are new strong or possible fits: not in Zoho and not yet talking to us.'));
    const tile = (cls, label, n, hint, fn) => {
      const b = el('button', 'cc-mn-stat ' + cls);
      b.type = 'button';
      b.append(el('span', 'cc-mn-slab', label), el('b', null, intF(n)), el('small', null, hint));
      b.addEventListener('click', fn);
      return b;
    };
    stats.replaceChildren(
      tile('cc-mn-sA', 'Best bets, researched', best.length, 'high chance and a High fit on the web: approach first', () => pickList('Best bets, researched High', best)),
      tile('cc-mn-sB', `Above-average chance, ${LIKELY}%+`, hot.length, `${LIKELY_X}× our average of ${AVG}%: research these next`, () => pickList(`Above-average chance, ${LIKELY}%+`, hot)),
      tile('cc-mn-sKnown', 'Known to us, not in Zoho', knownN, 'on our calls or team: add to Zoho', () => known.s.scrollIntoView({ behavior: 'smooth', block: 'start' })),
      tile('cc-mn-sIn', 'Already in Zoho', inZoho, 'matched by LinkedIn profile or name', () => goList({ scope: 'zoho', grade: new Set(), type: null, crm: null, sort: 'chance' })),
    );
  };

  /* ---------- what the data says ---------- */
  const drawLearn = () => {
    const m = rows(K + '_model')[0];
    if (!m || !m.n) { learn.p.textContent = `Not enough of ${cfg.modelWho} connections are in our campaigns yet to learn from.`; learnBody.replaceChildren(); learnTake.replaceChildren(); return; }
    const pool0 = modelPool();
    learn.p.replaceChildren(document.createTextNode('Measured live on the '), numBtn(m.n, `${cfg.modelWho} connections in our B2B campaign or Founder Network`, pool0), document.createTextNode(` of ${cfg.modelWho} connections already in our B2B campaign or Founder Network: `), numBtn(m.ok, 'Progressed: Priority 1, signed or met', pool0.filter((r) => r.progressed), pctF(m.base)), document.createTextNode(' of them reached Priority 1, signed, or had a meeting. This is what the chances below are built on.'));
    const pool = pool0;
    const block = (title, entries) => {
      const w = el('div', 'cc-mn-learnblock');
      w.append(el('h4', null, title));
      const peak = Math.max(0.01, ...entries.map((e) => e.g.raw || 0));
      entries.forEach((e) => {
        if (!e.g.n) return;
        const row = el('div', 'cc-mn-lrow');
        const bar = el('span', 'cc-mn-ltrack'); const f = el('i'); f.style.width = ((e.g.raw || 0) / peak) * 100 + '%'; bar.append(f);
        const grp = e.keep ? pool.filter(e.keep) : [];
        const sm = el('small');
        if (e.keep) sm.append(numBtn(e.g.ok, `${e.label}: progressed`, grp.filter((r) => r.progressed)), document.createTextNode(' of '), numBtn(e.g.n, `${e.label}: everyone in the campaigns`, grp));
        else sm.textContent = `${e.g.ok} of ${e.g.n}`;
        row.append(el('span', 'cc-mn-llab', e.label), bar, el('b', null, pctF(e.g.raw || 0)), sm);
        row.title = `${e.label}: ${e.g.ok} of ${e.g.n} progressed (${pctF(e.g.raw || 0)}). Select a number to list the people.`;
        w.append(row);
      });
      return w;
    };
    const types = TYPES.map(([k, label]) => ({ k, label, g: m.byType[k], keep: (r) => r.type === k })).filter((x) => x.g && x.g.n >= 5).sort((x, y) => (y.g.raw || 0) - (x.g.raw || 0));
    learnBody.replaceChildren(
      block('By kind of partner (5 or more people)', types),
      block(`By when ${cfg.modelWho2} connected`, AGES.map(([k, label]) => ({ label, g: m.byAge[k], keep: (r) => r.age === k }))),
      block('By endorsements or recommendations', [{ label: 'Endorsement or recommendation', g: m.byTie.yes, keep: (r) => Boolean(r.tie) }, { label: 'Neither', g: m.byTie.no, keep: (r) => !r.tie }]),
      block('By grade from the title', GRADES.slice(0, 3).map(([k, label]) => ({ label: `${k} ${label}`, g: m.byGrade[k], keep: (r) => r.fit === k }))),
    );
    const take = [];
    if (types.length >= 2) {
      const best = types[0]; const worst = types[types.length - 1];
      take.push(`${best.label} progress most (${pctF(best.g.raw)}, ${best.g.ok} of ${best.g.n}); ${worst.label} least (${pctF(worst.g.raw)}, ${worst.g.ok} of ${worst.g.n}).`);
    }
    const o = m.byAge.old; const n2 = m.byAge.new; const md = m.byAge.mid;
    if (n2.n && (o.n || md.n)) {
      const older = { ok: o.ok + md.ok, n: o.n + md.n };
      take.push(`People ${cfg.modelWho2} have known since before 2026 progress at ${pctF(older.ok / older.n)}, against ${pctF(n2.raw)} for this year’s new connections: the existing network is worth more than cold connects.`);
    }
    if (m.byTie.yes.n && m.byTie.no.n) take.push(`Where ${cfg.modelWho2} and the person endorsed or recommended each other, ${pctF(m.byTie.yes.raw)} progressed, against ${pctF(m.byTie.no.raw)} without.`);
    const ga = m.byGrade.A; const gc = m.byGrade.C;
    if (ga.n && gc.n && Math.abs((ga.raw || 0) - (gc.raw || 0)) < 0.08) take.push(`A job title alone predicts little (strong fits ${pctF(ga.raw)}, weak fits ${pctF(gc.raw)}), so the ranking leans on relationship and kind of partner, not title.`);
    if (m.test) {
      const t = m.test;
      take.push(`Tested on people it wasn’t trained on: the top fifth by chance progressed ${pctF(t.top)}, the bottom fifth ${pctF(t.bottom)}${t.auc != null ? ` (AUC ${t.auc.toFixed(2)})` : ''}. The ranking ${t.auc >= 0.7 ? 'separates well' : 'is a real but modest signal'}, so the research below and ${cfg.who}’s own judgment still matter.`);
    }
    learnTake.replaceChildren(...take.map((t) => el('li', null, t)));
  };

  /* ---------- most likely, with research ---------- */
  let likelyAll = false;
  const drawLikely = (all) => {
    const pool = all.filter((r) => r.scope === 'new' && r.chance != null && researched(r) && resFit(r) !== 'Low')
      .sort((a, b) => Number(b.tie) - Number(a.tie) || b.chance - a.chance || (a.brief.check === 'confirmed' ? -1 : 1) - (b.brief.check === 'confirmed' ? -1 : 1) || String(a.connected).localeCompare(String(b.connected)));
    const lows = all.filter((r) => r.scope === 'new' && resFit(r) === 'Low').length;
    const waiting = all.filter((r) => r.scope === 'new' && r.brief && r.brief.check === 'none').length;
    const lowL = all.filter((r) => r.scope === 'new' && resFit(r) === 'Low');
    const waitL = all.filter((r) => r.scope === 'new' && r.brief && r.brief.check === 'none');
    likely.p.replaceChildren(document.createTextNode(`New people with the highest chance, each looked up on the web, those who endorsed or recommended ${cfg.who} (or ${cfg.pron} them) first: current role, firm, who they serve, risks, and how ${cfg.who} should open. `), numBtn(pool.length, 'Researched, not ruled out', pool), document.createTextNode(' shown'),
      ...(lows ? [document.createTextNode('; '), numBtn(lows, 'Ruled out by research', lowL), document.createTextNode(' ruled out by research (competitor, inactive or outside our market) and moved down the list')] : []),
      ...(waiting ? [document.createTextNode('; '), numBtn(waiting, cfg.waitLabel, waitL), document.createTextNode(` ${cfg.waitText}`)] : []), document.createTextNode('.'));
    likelyHelp.replaceChildren(...(pool.length ? [bookmarkHelp()] : []));
    const show = likelyAll ? pool : pool.slice(0, SHORTLIST);
    likelyBody.replaceChildren(...show.map((r) => {
      const b = r.brief;
      const c = el('article', 'cc-mn-brief');
      const top = el('div', 'cc-mn-btop');
      const who = el('div', 'cc-mn-bwho');
      who.append(personLink(r), el('span', 'cc-mn-brole', b.current_role && b.current_role !== 'Not found' ? b.current_role : [r.position, r.company].filter(Boolean).join(' at ')));
      const tags = el('div', 'cc-mn-btags');
      tags.append(chanceBadge(r), el('span', 'cc-mn-ptype', TYPE_NAME[r.type] || r.type));
      if (b.fit_after_research) tags.append(el('span', 'cc-mn-rfit cc-mn-rfit-' + b.fit_after_research.toLowerCase(), `Research: ${b.fit_after_research}`));
      if (b.check === 'partial') { const w = el('span', 'cc-mn-rfit cc-mn-rfit-medium', 'Role not confirmed'); w.title = 'The web research couldn’t confirm their current role. Check their LinkedIn profile before reaching out.'; tags.append(w); }
      top.append(who, tags);
      c.append(top);
      const facts = el('p', 'cc-mn-bfacts');
      facts.textContent = [b.location && b.location !== 'Unclear' ? b.location : null, b.role_current === 'changed' ? 'Role has changed since the export' : null, `Researched ${dayF(b.researched_on)}`].filter(Boolean).join(' · ');
      if (facts.textContent) c.append(facts);
      if (b.company && !/^not found/i.test(b.company)) c.append(el('p', 'cc-mn-bco', b.company));
      const why = el('p', 'cc-mn-bwhy'); why.append(el('b', null, 'Why them: '), document.createTextNode(b.why || r.why)); c.append(why);
      if (b.risks && !/^none/i.test(b.risks)) { const rk = el('p', 'cc-mn-brisk'); rk.append(el('b', null, 'Watch out: '), document.createTextNode(b.risks)); c.append(rk); }
      c.append(el('p', 'cc-mn-brel', relLine(r)));
      if (b.approach) { const ap = el('p', 'cc-mn-bapp'); ap.append(el('b', null, 'Approach: '), document.createTextNode(b.approach)); c.append(ap); }
      if (b.opener) {
        const box = el('div', 'cc-mn-opener');
        box.append(el('p', null, b.opener), copyBtn(b.opener));
        c.append(box);
      }
      const acts = el('div', 'cc-mn-bacts');
      acts.append(addZohoBtn(r));
      c.append(acts);
      if (Array.isArray(b.sources) && b.sources.length) {
        const src = el('p', 'cc-mn-bsrc');
        src.append(document.createTextNode('Sources: '));
        b.sources.slice(0, 3).forEach((u, i) => { if (i) src.append(document.createTextNode(', ')); let h = u; try { h = new URL(u).hostname.replace(/^www\./, ''); } catch (e) { /* keep */ } src.append(link(u, h)); });
        c.append(src);
      }
      return c;
    }));
    if (!pool.length) likelyBody.replaceChildren(el('p', 'cc-mn-empty', 'No researched people yet.'));
    likelyMore.replaceChildren();
    if (pool.length > SHORTLIST) {
      const b = el('button', 'cc-go', likelyAll ? `Show the top ${SHORTLIST}` : `Show all ${intF(pool.length)} researched`);
      b.type = 'button';
      b.addEventListener('click', () => { likelyAll = !likelyAll; drawLikely(all); });
      likelyMore.append(b);
    }
  };

  /* ---------- known to us, not in Zoho ---------- */
  const drawKnown = (all) => {
    const rank = (r) => (r.rel === 'insider' ? 4 : r.rel === 'works' ? 3 : r.fit === 'A' || r.fit === 'B' ? 0 : r.rel === 'talked' ? 1 : 2);
    const kn = all.filter((r) => r.scope === 'known').sort((a, b) => rank(a) - rank(b) || a.fit.localeCompare(b.fit) || String(b.last_call || '').localeCompare(String(a.last_call || '')));
    const olOn = kn.find((r) => r.outlook);
    known.p.textContent = `${intF(kn.length)} people ${cfg.who} is connected to who have no Zoho contact, yet we have met${cfg.dm ? ', messaged both ways on LinkedIn' : ''} or emailed them. Each row shows the proof: the Fireflies call and how it was matched${cfg.dm ? ', her LinkedIn conversation' : ''}, and what the team’s Outlook holds (${olOn ? 'checked ' + dayF(olOn.outlook.checked_on) : 'not checked for this network'}). Zoho was searched live by LinkedIn profile and by name, including records that hold the whole name in Last Name.`;
    const tbl = el('table', 'cc-tbl cc-mn-tbl');
    const th = el('thead'); const hr = el('tr');
    ['Name', 'Title and company', 'Fireflies', 'Outlook', 'Grade', 'What to do'].forEach((h) => { const c = el('th', null, h); c.scope = 'col'; hr.append(c); });
    th.append(hr); tbl.append(th);
    const tb = el('tbody');
    kn.forEach((r) => {
      const tr = el('tr');
      const n = el('td'); n.append(personLink(r));
      const role = el('td', 'cc-mn-rolecell'); role.append(el('span', null, r.position || '—'), el('small', null, r.company || ''));
      const ff = el('td', 'cc-mn-whycell', [r.calls ? `${r.calls} call${r.calls === 1 ? '' : 's'}, last ${dayF(r.last_call)}${r.call_by ? ` (matched by ${r.call_by})` : ''}` : 'None', r.dm ? 'LinkedIn: ' + dmLine(r.dm) : null].filter(Boolean).join(' · '));
      const o = r.outlook;
      const olText = !o ? 'Not checked'
        : o.identity === 'not found' ? 'Nothing found'
          : o.identity === 'different person' ? `Different person with the same name${o.note ? `: ${o.note}` : ''}`
            : o.identity === 'unconfirmed' ? `Not confirmed as the same person${o.note ? `: ${o.note}` : ''}`
            : [num(o.email_count) ? `${num(o.email_count) >= 25 ? '25+' : num(o.email_count)} email${num(o.email_count) === 1 ? '' : 's'}, last ${dayF(o.last_email)}${o.two_way ? ', both ways' : ''}` : null,
              num(o.meeting_count) ? `${num(o.meeting_count)} meeting${num(o.meeting_count) === 1 ? '' : 's'}, last ${dayF(o.last_meeting)}` : null,
              o.their_domain ? `@${o.their_domain}` : null, o.note || null].filter(Boolean).join(' · ') || 'Nothing found';
      const olCell = el('td', 'cc-mn-whycell', olText);
      if (r.insider) ff.prepend(el('b', null, r.insider + ' · '));
      const g = el('td'); g.append(gradePill(r.fit));
      const todo = r.rel === 'insider' ? 'Nothing: our team or advisor'
        : r.rel === 'works' ? 'Nothing: we work with them day to day'
          : resFit(r) === 'Low' ? `Add to Zoho, not as a B2B prospect: ${r.brief.risks}`
            : r.rel === 'dm' && !r.calls ? ((r.fit === 'A' || r.fit === 'B') ? 'Add to Zoho with the B2B tag and note the LinkedIn conversation' : 'Add to Zoho if the conversation was about business')
            : r.rel === 'mail' && !r.calls ? ((r.fit === 'A' || r.fit === 'B') ? 'Add to Zoho with the B2B tag and log the emails' : 'Add to Zoho if the emails were about business')
            : (r.fit === 'A' || r.fit === 'B') ? 'Add to Zoho with the B2B tag and log the call' : 'Add to Zoho if the call was about business';
      const onAcc = r.co_zoho && r.co_zoho.name && r.rel !== 'insider' && r.rel !== 'works' ? ` Link them to the ${r.co_zoho.name} account, which Zoho already has (${r.co_zoho.n} contact${r.co_zoho.n === 1 ? '' : 's'}: ${r.co_zoho.camps.join(', ')}).` : '';
      tr.append(n, role, ff, olCell, g, el('td', 'cc-mn-whycell', todo + (onAcc ? '.' + onAcc : '')));
      tb.append(tr);
    });
    tbl.append(tb);
    knownBody.replaceChildren(kn.length ? tbl : el('p', 'cc-mn-empty', 'Everyone we talk to is in Zoho.'));
  };


  /* ---------- her LinkedIn conversations (Shruti) ---------- */
  let convoF = 'act';
  let convoAll = false;
  const drawConvo = (all) => {
    const withDm = all.filter((r) => r.dm);
    /* A move from us: a live or owed conversation with a possible partner (a strong or possible fit, or someone already in Zoho). */
    const groups = [['act', 'Needs a move from us', (r) => (DM_ACT.has(r.dm.status) || r.dm.reply_needed) && (r.fit === 'A' || r.fit === 'B' || Boolean(r.zoho_id))], ...DM_ORDER.map((k) => [k, DM_STATUS[k], (r) => r.dm.status === k])];
    const g = groups.find((x) => x[0] === convoF) || groups[0];
    const lst = withDm.filter(g[2]).sort((a, b) => Number(b.dm.reply_needed) - Number(a.dm.reply_needed) || DM_ORDER.indexOf(a.dm.status) - DM_ORDER.indexOf(b.dm.status) || String(b.dm.last).localeCompare(String(a.dm.last)));
    const owed = withDm.filter((r) => r.dm.reply_needed);
    const asof = (withDm[0] || {}).export_date;
    convo.p.replaceChildren(numBtn(withDm.length, 'Everyone she has messaged with', withDm), document.createTextNode(` connections have messages with Shruti in her LinkedIn export${asof ? ' of ' + dayF(asof) : ''}. Each conversation was read and labeled; the text stays out of the dashboard. `), numBtn(owed.length, 'Waiting on her reply', owed), document.createTextNode(` ${owed.length === 1 ? 'is' : 'are'} waiting on her reply. Needs a move from us keeps to possible partners (strong or possible fits, or people already in Zoho); old personal threads are under their own status. How to respond is a suggestion for the B2B partner campaign, not a script.`));
    const chips = el('div', 'cc-tools');
    groups.forEach(([k, label, f]) => { const n = withDm.filter(f).length; if (!n && k !== 'act') return; chips.append(chip(`${label} (${intF(n)})`, convoF === k, () => { convoF = k; convoAll = false; drawConvo(all); })); });
    const tbl = el('table', 'cc-tbl cc-mn-tbl');
    const th = el('thead'); const hr = el('tr');
    ['Name', 'Title and company', 'Where it stands', 'Messages', 'What stands now', 'How to respond', 'Grade', 'Status'].forEach((h) => { const c = el('th', null, h); c.scope = 'col'; hr.append(c); });
    th.append(hr); tbl.append(th);
    const tb = el('tbody');
    (convoAll ? lst : lst.slice(0, 25)).forEach((r) => {
      const d = r.dm;
      const tr = el('tr');
      const n = el('td'); n.append(personLink(r)); if (r.shared) n.append(el('span', 'cc-mn-clientmark', 'Mack too'));
      const role = el('td', 'cc-mn-rolecell'); role.append(el('span', null, r.position || '—'), el('small', null, r.company || ''));
      const stc = el('td'); stc.append(el('span', 'cc-mn-dm cc-mn-dm-' + d.status, DM_STATUS[d.status] || d.status)); if (d.reply_needed) stc.append(el('small', 'cc-mn-dnc', ' Reply owed'));
      const msg = el('td', 'cc-mn-whycell', `${d.n_in} from them, ${d.n_out} from her${d.last_in ? ` · theirs ${dayF(d.last_in)}` : ''}${d.last_out ? ` · hers ${dayF(d.last_out)}` : ''}${d.met_on ? ` · met ${dayF(d.met_on)}` : ''}`);
      const g2 = el('td'); g2.append(gradePill(r.fit));
      const z = el('td'); z.append(crmCell(r));
      tr.append(n, role, stc, msg, el('td', 'cc-mn-whycell', d.note || '—'), el('td', 'cc-mn-whycell cc-mn-respond', d.respond || '—'), g2, z);
      tb.append(tr);
    });
    tbl.append(tb);
    const more = el('div', 'cc-tools');
    if (lst.length > 25) { const b = el('button', 'cc-go', convoAll ? 'Show the first 25' : `Show all ${intF(lst.length)}`); b.type = 'button'; b.addEventListener('click', () => { convoAll = !convoAll; drawConvo(all); }); more.append(b); }
    convoBody.replaceChildren(chips, lst.length ? tbl : el('p', 'cc-mn-empty', 'Nobody here.'), more);
  };

  /* ---------- kinds of partner (new scope) ---------- */
  const drawKinds = () => {
    const all = rows(K + '_ranked');
    const fits = all.filter((r) => r.scope === 'new' && (r.fit === 'A' || r.fit === 'B'));
    kinds.p.textContent = 'Strong and possible fits not in Zoho and not yet talking to us, by kind of partner, with the average chance for each kind. Select a row to list them.';
    const groups = TYPES.map(([k, label]) => {
      const l = fits.filter((r) => r.type === k);
      const avg = l.length ? l.reduce((s, r) => s + (r.chance || 0), 0) / l.length : 0;
      return { k, label, n: l.length, a: l.filter((r) => r.fit === 'A').length, hot: l.filter((r) => r.chance >= LIKELY).length, avg };
    }).filter((g) => g.n).sort((x, y) => y.avg - x.avg);
    const peak = Math.max(1, ...groups.map((g) => g.n));
    kindsBody.replaceChildren(...groups.map((g) => {
      const row = el('button', 'cc-mn-bar');
      row.type = 'button';
      row.setAttribute('aria-pressed', String(st.type === g.k));
      const track = el('span', 'cc-mn-track');
      const fa = el('i', 'cc-mn-fa'); fa.style.width = (g.hot / peak) * 100 + '%';
      const fb = el('i', 'cc-mn-fb'); fb.style.width = ((g.n - g.hot) / peak) * 100 + '%';
      track.append(fa, fb);
      row.append(el('span', 'cc-mn-blab', g.label), track, el('span', 'cc-mn-bnum', `${Math.round(g.avg)}% avg chance`), el('span', 'cc-mn-bnew', `${intF(g.n)} people · ${intF(g.hot)} at ${LIKELY}%+`));
      row.title = `${g.label}: ${g.n} new strong or possible fits, ${g.hot} with a ${LIKELY}%+ chance; average chance ${Math.round(g.avg)}%. Select to list them.`;
      row.addEventListener('click', () => goList({ scope: 'new', type: st.type === g.k ? null : g.k, grade: new Set(['A', 'B']), sort: 'chance' }));
      return row;
    }));
  };

  /* ---------- the full list ---------- */
  const inScope = (r) => r.scope === st.scope;
  const visible = (all) => {
    const q = st.q.trim().toLowerCase();
    if (st.pick) return all.filter((r) => st.pick.ids.has(keyOfR(r)) && (!q || `${r.name} ${r.position} ${r.company}`.toLowerCase().includes(q)));
    return all.filter((r) => inScope(r) && (!st.grade.size || st.grade.has(r.fit)) && (!st.type || r.type === st.type)
      && (st.scope !== 'zoho' || !st.crm || r.crm === st.crm) && (!st.researched || researched(r))
      && (!q || `${r.name} ${r.position} ${r.company} ${r.why} ${r.refer} ${(researched(r) && r.brief.why) || ''}`.toLowerCase().includes(q)));
  };
  const sorters = {
    chance: (a, b) => (b.chance ?? -1) - (a.chance ?? -1) || a.fit.localeCompare(b.fit) || String(a.connected).localeCompare(String(b.connected)),
    connected: (a, b) => String(a.connected).localeCompare(String(b.connected)),
    newest: (a, b) => String(b.connected).localeCompare(String(a.connected)),
    name: (a, b) => String(a.name).localeCompare(String(b.name)),
  };
  const chip = (label, on, fn, title) => { const b = el('button', 'cc-chip', label); b.type = 'button'; b.setAttribute('aria-pressed', String(on)); if (title) b.title = title; b.addEventListener('click', fn); return b; };
  const drawScope = (all) => {
    scopeBar.replaceChildren(...SCOPES.map(([k, label, hint]) => {
      const b = el('button', 'cc-mn-scopetab');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(st.scope === k));
      b.setAttribute('aria-selected', String(st.scope === k && !st.pick));
      b.append(el('b', null, `${label} (${intF(all.filter((r) => r.scope === k && (k !== 'new' || r.fit === 'A' || r.fit === 'B')).length)})`), el('span', null, k === 'new' ? hint + ' (strong and possible fits; add C or X from Grade)' : hint));
      b.addEventListener('click', () => { if (st.scope === k && !st.pick) return; Object.assign(st, { scope: k, crm: null, page: 0, pick: null, grade: k === 'new' ? new Set(['A', 'B']) : new Set() }); drawList(); });
      return b;
    }));
  };
  const drawFilters = (all) => {
    const scoped = all.filter(inScope);
    const g = el('div', 'cc-tools');
    g.append(el('span', 'cc-mn-flab', 'Grade'), ...GRADES.map(([k, label, def]) => chip(`${k} ${label} (${intF(scoped.filter((r) => r.fit === k).length)})`, st.grade.has(k), () => { st.grade.has(k) ? st.grade.delete(k) : st.grade.add(k); st.page = 0; drawList(); }, def)));
    const c = el('div', 'cc-tools');
    c.hidden = st.scope !== 'zoho';
    c.append(el('span', 'cc-mn-flab', 'In Zoho as'), chip('Any', !st.crm, () => { st.crm = null; st.page = 0; drawList(); }), ...Object.entries(CRM_NAME).map(([k, label]) => chip(label, st.crm === k, () => { st.crm = st.crm === k ? null : k; st.page = 0; drawList(); })));
    const t = el('div', 'cc-tools');
    const sel = el('select', 'cc-mn-select'); sel.setAttribute('aria-label', 'Kind of partner');
    sel.append(new Option('Every kind of partner', ''), ...TYPES.map(([k, label]) => new Option(label, k)));
    sel.value = st.type || '';
    sel.addEventListener('change', () => { st.type = sel.value || null; st.page = 0; drawKinds(); drawList(); });
    const search = el('input', 'cc-mn-search'); search.type = 'search'; search.placeholder = 'Search name, title, company or reason'; search.value = st.q; search.setAttribute('aria-label', 'Search connections');
    let timer = null;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { st.q = search.value; st.page = 0; drawList(true); }, 180); });
    const res = chip('Researched only', st.researched, () => { st.researched = !st.researched; st.page = 0; drawList(); });
    const sortSel = el('select', 'cc-mn-select'); sortSel.setAttribute('aria-label', 'Sort');
    sortSel.append(new Option('Sort: most likely first', 'chance'), new Option('Sort: longest-standing connection', 'connected'), new Option('Sort: newest connection', 'newest'), new Option('Sort: name', 'name'));
    sortSel.value = st.sort;
    sortSel.addEventListener('change', () => { st.sort = sortSel.value; st.page = 0; drawList(); });
    const reset = el('button', 'cc-go', 'Reset filters'); reset.type = 'button';
    reset.addEventListener('click', () => { Object.assign(st, { grade: st.scope === 'new' ? new Set(['A', 'B']) : new Set(), type: null, crm: null, q: '', page: 0, sort: 'chance', researched: false, pick: null }); drawKinds(); drawList(); });
    const dl = el('button', 'cc-go', 'Download these as CSV'); dl.type = 'button';
    dl.addEventListener('click', () => download(visible(all).sort(sorters[st.sort])));
    t.append(sel, search, res, sortSel, reset, dl);
    filters.replaceChildren(g, c, t);
    return search;
  };
  const download = (lst) => {
    const B = (r, k) => (researched(r) && r.brief[k]) || '';
    const cols = [['Name', (r) => r.name], ['LinkedIn', (r) => r.url], ['Position', (r) => r.position], ['Company', (r) => r.company], ['Connected', (r) => r.connected],
      ['Chance %', (r) => (r.chance == null ? '' : r.chance)], ['Grade', (r) => r.fit], ['Kind of partner', (r) => TYPE_NAME[r.type] || r.type], ['Why', (r) => r.why], ['Could refer', (r) => r.refer],
      ['Relationship', (r) => relLine(r)], ['Research fit', (r) => B(r, 'fit_after_research')], ['Role confirmed', (r) => (researched(r) ? (r.brief.check === 'confirmed' ? 'Yes' : 'No') : '')], ['Sources', (r) => (researched(r) ? (r.brief.sources || []).join(' ') : '')], ['Current role (research)', (r) => B(r, 'current_role')], ['Location', (r) => B(r, 'location')],
      ['Company (research)', (r) => B(r, 'company')], ['Why them (research)', (r) => B(r, 'why')], ['Risks', (r) => B(r, 'risks')], ['Approach', (r) => B(r, 'approach')], ['Opener', (r) => B(r, 'opener')],
      ['In Zoho', (r) => (r.zoho_id ? (r.crm === 'b2b' ? `B2B campaign${r.priority ? ' P' + r.priority : ''}` : CRM_NAME[r.crm]) : (r.rel ? REL_NAME[r.rel] + ', not in Zoho' : 'Not in Zoho'))], ['Zoho link', (r) => (r.zoho_id ? ZOHO + 'Contacts/' + r.zoho_id : '')]];
    const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [cols.map(([h]) => h).join(','), ...lst.map((r) => cols.map(([, f]) => esc(f(r))).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${cfg.file}-${st.scope}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const drawList = (keepFocus) => {
    const all = rows(K + '_ranked');
    const active = document.activeElement;
    drawScope(all);
    const search = drawFilters(all);
    if (keepFocus && active && active.classList.contains('cc-mn-search')) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    const lst = visible(all).sort(sorters[st.sort]);
    const pages = Math.max(1, Math.ceil(lst.length / PAGE));
    st.page = Math.min(st.page, pages - 1);
    const slice = lst.slice(st.page * PAGE, st.page * PAGE + PAGE);
    const sc = SCOPES.find((x) => x[0] === st.scope);
    list.t.textContent = st.pick ? `${st.pick.label} (${intF(lst.length)})` : `${sc[1]} (${intF(lst.length)})`;
    const parts = [];
    if (st.grade.size && st.grade.size < GRADES.length) parts.push([...st.grade].sort().join(' and ') + ' grade');
    if (st.type) parts.push(TYPE_NAME[st.type]);
    if (st.scope === 'zoho' && st.crm) parts.push(CRM_NAME[st.crm]);
    if (st.researched) parts.push('researched');
    if (st.q.trim()) parts.push(`matching “${st.q.trim()}”`);
    list.p.textContent = st.pick ? `The people behind the number you selected. Reset filters or pick a scope tab to go back to the full list. Nothing here is written to Zoho.` : `${sc[2][0].toUpperCase()}${sc[2].slice(1)}. ${parts.length ? 'Showing: ' + parts.join(', ') + '.' : 'Showing every grade.'} Nothing here is written to Zoho.`;
    const tbl = el('table', 'cc-tbl cc-mn-tbl');
    const thead = el('thead'); const hr = el('tr');
    ['Chance', 'Grade', 'Name', 'Title and company', 'Kind of partner', 'Why', 'Relationship', 'Status', 'Connected'].forEach((h) => { const th = el('th', null, h); th.scope = 'col'; hr.append(th); });
    thead.append(hr); tbl.append(thead);
    const tb = el('tbody');
    slice.forEach((r) => {
      const tr = el('tr');
      const ch = el('td'); ch.append(chanceBadge(r));
      const g = el('td'); g.append(gradePill(r.fit));
      const n = el('td'); n.append(personLink(r)); if (r.client) { const cm = el('span', 'cc-mn-clientmark', 'Client signal'); cm.title = 'Also looks like a direct buyer: a senior leader at a mid-size company in our ICP industries'; n.append(cm); }
      const role = el('td', 'cc-mn-rolecell'); role.append(el('span', null, r.position || '—'), el('small', null, r.company || ''));
      const why = el('td', 'cc-mn-whycell', (researched(r) && r.brief.why) || r.why || '—');
      if (resFit(r)) why.prepend(el('span', 'cc-mn-rfit cc-mn-rfit-' + resFit(r).toLowerCase(), `Research: ${resFit(r)}`), document.createTextNode(' '));
      const z = el('td'); z.append(crmCell(r));
      tr.append(ch, g, n, role, el('td', null, TYPE_NAME[r.type] || r.type || '—'), why, el('td', 'cc-mn-whycell', relLine(r) || '—'), z, el('td', 'cc-mn-date', dayF(r.connected)));
      tb.append(tr);
    });
    tbl.append(tb);
    tableWrap.replaceChildren(slice.length ? tbl : el('p', 'cc-mn-empty', 'Nobody matches these filters.'));
    pager.replaceChildren();
    if (pages > 1) {
      const prev = el('button', 'cc-go', '← Previous'); prev.type = 'button'; prev.disabled = st.page === 0;
      prev.addEventListener('click', () => { st.page -= 1; drawList(); list.s.scrollIntoView({ block: 'start' }); });
      const next = el('button', 'cc-go', 'Next →'); next.type = 'button'; next.disabled = st.page >= pages - 1;
      next.addEventListener('click', () => { st.page += 1; drawList(); list.s.scrollIntoView({ block: 'start' }); });
      pager.append(prev, el('span', 'cc-mn-pnum', `Page ${st.page + 1} of ${pages} · rows ${intF(st.page * PAGE + 1)}–${intF(st.page * PAGE + slice.length)}`), next);
    }
  };

  const draw = () => {
    const s = status(K + '_ranked');
    const parts = [convo && convo.s, learn.s, likely.s, known.s, kinds.s, list.s].filter(Boolean);
    if (s !== 'ok') {
      parts.forEach((p) => { p.hidden = true; });
      stats.replaceChildren();
      const missing = status(cfg.ds) === 'error' || (status(cfg.ds) === 'ok' && !rows(cfg.ds).length);
      head.p.textContent = missing ? `${cfg.whose} LinkedIn analysis isn’t in this build. ${cfg.sealNote}` : (s === 'error' ? 'The connections or Zoho contacts didn’t load. Reload, or check the sources in the dashboard menu.' : `Loading ${cfg.whose} connections and Zoho contacts…`);
      foot.textContent = '';
      return;
    }
    parts.forEach((p) => { p.hidden = false; });
    const m = rows(K + '_model')[0];
    if (m && m.base) { AVG = Math.round(m.base * 100); LIKELY = Math.round(m.base * LIKELY_X * 100); }
    const all = rows(K + '_ranked');
    drawHead(all);
    if (convo) drawConvo(all);
    drawLearn();
    drawLikely(all);
    drawKnown(all);
    drawKinds();
    drawList();
    foot.textContent = `How this works: every connection was read and graded by hand against the partners who have signed with us or reached Priority 1. Zoho is matched live by LinkedIn profile, else by first and last name (credentials, bracketed nicknames and middle initials ignored; records holding the whole name in Last Name included; short first-name forms such as Matt for Matthew only with a distinctive last name or the same company). We know someone when they were on a Fireflies call with us from Sep 2025 (an attendee whose name or email address is exactly theirs, or their first name at their own company’s domain; meeting titles are never used; calls with Asinpa and job interviews are left out), when the team’s Outlook holds mail or meetings with them (${cfg.outlookNote}), or when they are on the TLS website’s team or advisors list (matched by LinkedIn profile). Endorsements and recommendations come from ${cfg.whose} LinkedIn export.${cfg.footExtra} The chance comes from a logistic regression fitted live on ${cfg.modelWho} connections already in our campaigns (kind of partner, when they connected, endorsements, grade), so it changes as they progress; web research then nudges it up for a High fit and down for a Low one. Researched briefs use public web sources as of the research date; check before outreach. Nothing on this tab is written to Zoho.`;
  };

  return { draw, personLink, gradePill, crmCell, chip };
  };

  /* ---------- Mack and Shruti together ---------- */
  const togetherBox = el('div', 'cc-mn-together');
  const tg = (() => {
    const s = el('section', 'cc-card cc-mn-head');
    const h = el('div', 'cc-card-head');
    const t = el('h2', null, 'Mack and Shruti together: who reaches whom');
    const p = el('p');
    h.append(t, p); s.append(h);
    const stats2 = el('div', 'cc-mn-stats');
    s.append(stats2);
    const learn2 = el('ul', 'cc-mn-takeaways');
    s.append(learn2);
    const both = el('section', 'cc-card cc-mn-list');
    const bh = el('div', 'cc-card-head'); const bt = el('h3', null, 'People you both know: who should reach out'); const bp = el('p'); bh.append(bt, bp); both.append(bh);
    const bchips = el('div', 'cc-tools'); const bwrap = el('div', 'cc-mn-tablewrap'); both.append(bchips, bwrap);
    togetherBox.append(s, both);
    return { p, stats2, learn2, bp, bchips, bwrap };
  })();
  let bothF = 'fit';
  /* Who should reach out to a shared connection: whoever has the live relationship. */
  const bestOf = (m, s) => {
    if (s.dm && DM_TALK.has(s.dm.status)) return ['Shruti', `She’s in a live LinkedIn conversation (${(DM_STATUS[s.dm.status] || '').toLowerCase()})`];
    if (m.rel && m.rel !== 'insider') return ['Mack', m.rel === 'works' ? 'He works with them regularly' : m.rel === 'talked' ? `On ${m.calls} of our calls` : 'In our Outlook'];
    if ((m.ties || []).length) return ['Mack', m.ties.join(', ')];
    if (s.dm && s.dm.n_in > 0) return ['Shruti', 'They have written to her on LinkedIn'];
    if (m.zoho_assigned === 'Mack' || m.zoho_assigned === 'Shruti') return [m.zoho_assigned, 'Already assigned in Zoho'];
    return ['Mack', `No live tie either way; Mack by default (connected ${yearOf(m.connected) || '—'}, Shruti ${yearOf(s.connected) || '—'})`];
  };
  const drawTogether = () => {
    const { personLink, gradePill, crmCell, chip } = nets.mn;
    if (status('mn_ranked') !== 'ok' || status('sn_ranked') !== 'ok') {
      tg.p.textContent = status('sn_ranked') === 'ok' || status('mn_ranked') === 'ok' ? 'Both LinkedIn analyses are needed here; one isn’t in this build.' : 'Loading both networks…';
      tg.stats2.replaceChildren(); tg.learn2.replaceChildren(); tg.bwrap.replaceChildren(); tg.bchips.replaceChildren(); tg.bp.textContent = '';
      return;
    }
    const M = rows('mn_ranked'); const Sh = rows('sn_ranked');
    /* The same person only by LinkedIn profile: names alone (and the blank rows LinkedIn exports for closed accounts) never join. */
    const mBy = new Map(M.filter((r) => slugOf(r.url)).map((r) => [slugOf(r.url), r]));
    const pairs = Sh.filter((s) => slugOf(s.url) && mBy.has(slugOf(s.url))).map((s) => ({ s, m: mBy.get(slugOf(s.url)) }));
    const sOnly = Sh.filter((s) => !(slugOf(s.url) && mBy.has(slugOf(s.url))));
    const reach = M.length + sOnly.length;
    const zAll = new Set([...M, ...Sh].map((r) => r.zoho_id).filter(Boolean));
    tg.p.textContent = `${intF(M.length)} people in Mack’s LinkedIn export and ${intF(Sh.length)} in Shruti’s; ${intF(pairs.length)} are in both, so together you reach ${intF(reach)} people, ${intF(zAll.size)} of them already in Zoho. Shruti adds ${intF(sOnly.filter((r) => r.fit === 'A' || r.fit === 'B').length)} strong or possible fits Mack isn’t connected to.`;
    const tile = (label, n, hint, fn) => { const b = el('button', 'cc-mn-stat'); b.type = 'button'; b.append(el('span', 'cc-mn-slab', label), el('b', null, intF(n)), el('small', null, hint)); b.addEventListener('click', fn); return b; };
    const owed = Sh.filter((r) => r.dm && r.dm.reply_needed);
    const live = Sh.filter((r) => r.dm && DM_TALK.has(r.dm.status));
    const sNew = sOnly.filter((r) => r.scope === 'new' && (r.fit === 'A' || r.fit === 'B'));
    const sZ = Sh.filter((r) => r.zoho_id && !r.shared);
    tg.stats2.replaceChildren(
      tile('In both networks', pairs.length, 'shared connections: pick who reaches out below', () => tg.bwrap.scrollIntoView({ behavior: 'smooth', block: 'start' })),
      tile('Live on Shruti’s LinkedIn', live.length, `talking, wrote last or said yes${owed.length ? `; ${owed.length} reply owed` : ''}`, () => go('sn', 'convo')),
      tile('Shruti’s new fits', sNew.length, 'strong or possible, not in Zoho, Mack not connected', () => go('sn', 'list')),
      tile('Shruti-only, in Zoho', sZ.length, 'her connections already in the CRM', () => go('sn', 'zoho')),
    );
    /* What combining teaches: how shared connections progress against single-network ones (campaign contacts only). */
    const camp = (r) => r.crm === 'b2b' || r.crm === 'fn';
    const rate = (l) => { const c = l.filter(camp); return { n: c.length, ok: c.filter((r) => r.progressed).length }; };
    const rb = rate(pairs.map((x) => x.m));
    const rm = rate(M.filter((r) => !pairs.some((x) => x.m === r)));
    const rs = rate(sOnly);
    const pf = (x) => (x.n ? pctF(x.ok / x.n) : '—');
    const take = [];
    if (rb.n) take.push(`People both of you know progress at ${pf(rb)} (${rb.ok} of ${rb.n} in our campaigns), against ${pf(rm)} for Mack’s connections only (${rm.ok} of ${rm.n}) and ${pf(rs)} for Shruti’s only (${rs.ok} of ${rs.n}). A second connection on our team is a signal worth ranking on.`);
    const ms = rows('sn_model')[0];
    if (ms && ms.n) take.push(`Shruti’s chances come from a model fitted on both networks’ campaign contacts (${intF(ms.n)} people, ${pctF(ms.base)} progressed), because her own campaign pool is small; Mack’s chances still use his own.`);
    const oldS = Sh.filter((r) => yearOf(r.connected) && yearOf(r.connected) < 2026);
    if (oldS.length) take.push(`${intF(oldS.length)} of Shruti’s connections date from before 2026, mostly film and media; only ${intF(oldS.filter((r) => r.fit === 'A').length)} grade as strong fits, and web research confirmed few of them. Her value is the 2026 B2B connections and the conversations she’s already having.`);
    const wrongOwner = sZ.filter((r) => !r.zoho_assigned && r.zoho_by === 'LinkedIn profile' && !r.insider);
    if (wrongOwner.length) take.push(`${intF(wrongOwner.length)} of Shruti’s connections matched in Zoho by LinkedIn profile have nobody assigned: assign them to Shruti.`);
    const byName = sZ.filter((r) => r.zoho_by && r.zoho_by !== 'LinkedIn profile');
    if (byName.length) take.push(`${intF(byName.length)} of Shruti’s Zoho matches are by name only; some may be a different person with the same name. Add the LinkedIn URL in Zoho where it’s the same person.`);
    tg.learn2.replaceChildren(...take.map((t) => el('li', null, t)));
    /* Shared people with the best person to reach out. */
    const rowsB = pairs.map(({ m, s }) => { const [who, why] = bestOf(m, s); return { m, s, who, why }; });
    const groups = [['fit', 'Strong or possible fits', (x) => x.m.fit === 'A' || x.m.fit === 'B'], ['shruti', 'Shruti should reach out', (x) => x.who === 'Shruti'], ['mack', 'Mack should reach out', (x) => x.who === 'Mack'], ['owner', 'Zoho owner differs from best person', (x) => x.m.zoho_id && x.m.zoho_assigned && x.m.zoho_assigned !== x.who], ['all', 'Everyone in both', () => true]];
    tg.bchips.replaceChildren(...groups.map(([k, label, f]) => chip(`${label} (${intF(rowsB.filter(f).length)})`, bothF === k, () => { bothF = k; drawTogether(); })));
    const g = groups.find((x) => x[0] === bothF) || groups[0];
    const lst = rowsB.filter(g[2]).sort((a, b) => a.m.fit.localeCompare(b.m.fit) || Number(Boolean(a.m.zoho_id)) - Number(Boolean(b.m.zoho_id)) || String(a.m.name).localeCompare(String(b.m.name)));
    tg.bp.textContent = 'The best person is whoever has the live relationship: Shruti when she’s in a real LinkedIn conversation; Mack when he’s on calls, in mail or endorsed with them; otherwise whoever Zoho already assigns, else Mack. Zoho’s Assigned is the person working the prospect, so it can differ.';
    const tbl = el('table', 'cc-tbl cc-mn-tbl');
    const th = el('thead'); const hr = el('tr');
    ['Name', 'Title and company', 'Grade', 'Mack', 'Shruti', 'Best person to reach out', 'Zoho'].forEach((h) => { const c = el('th', null, h); c.scope = 'col'; hr.append(c); });
    th.append(hr); tbl.append(th);
    const tb = el('tbody');
    lst.forEach(({ m, s, who, why }) => {
      const tr = el('tr');
      const n = el('td'); n.append(personLink(m));
      const role = el('td', 'cc-mn-rolecell'); role.append(el('span', null, m.position || '—'), el('small', null, m.company || ''));
      const gr = el('td'); gr.append(gradePill(m.fit));
      const mk = el('td', 'cc-mn-whycell', [`Since ${yearOf(m.connected) || '—'}`, ...(m.ties || []), m.calls ? `${m.calls} call${m.calls === 1 ? '' : 's'}` : null].filter(Boolean).join(' · '));
      const sh = el('td', 'cc-mn-whycell', [`Since ${yearOf(s.connected) || '—'}`, s.dm ? dmLine(s.dm) : null, s.dm && s.dm.respond ? `Next: ${s.dm.respond}` : null].filter(Boolean).join(' · '));
      const best = el('td', 'cc-mn-whycell'); best.append(el('b', null, who), document.createTextNode(': ' + why));
      const z = el('td'); z.append(crmCell(m));
      tr.append(n, role, gr, mk, sh, best, z);
      tb.append(tr);
    });
    tbl.append(tb);
    tg.bwrap.replaceChildren(lst.length ? tbl : el('p', 'cc-mn-empty', 'Nobody here.'));
  };

  /* ---------- the view switch: Mack, Shruti, together ---------- */
  const VIEW_KEY = 'cc-mn-view-v1';
  let view = 'mn';
  try { const v = localStorage.getItem(VIEW_KEY); if (['mn', 'sn', 'both'].includes(v)) view = v; } catch (e) { /* per-viewer convenience only */ }
  const tabs = el('div', 'cc-mn-views');
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Whose network');
  const hosts = { mn: el('div', 'cc-mn-net'), sn: el('div', 'cc-mn-net'), both: togetherBox };
  const nets = Object.fromEntries(NETS.map((cfg) => [cfg.key, makeNet(cfg, hosts[cfg.key])]));
  root.replaceChildren(tabs, hosts.mn, hosts.sn, hosts.both);
  const drawTabs = () => {
    const n = (id) => (status(id) === 'ok' ? intF(rows(id).length) : '…');
    const shared = status('shruti_network') === 'ok' ? rows('shruti_network').filter((r) => r.shared === true || r.shared === 'true').length : null;
    tabs.replaceChildren(...[['mn', `Mack’s network (${n('mack_network')})`], ['sn', `Shruti’s network (${n('shruti_network')})`], ['both', `Together (${shared == null ? '…' : intF(shared)} in both)`]].map(([k, label]) => {
      const b = el('button', 'cc-mn-viewtab', label);
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(view === k));
      b.addEventListener('click', () => { view = k; try { localStorage.setItem(VIEW_KEY, k); } catch (e) { /* ignore */ } show(); });
      return b;
    }));
  };
  const show = () => { Object.entries(hosts).forEach(([k, h]) => { h.hidden = k !== view; }); drawTabs(); };
  /* Jump from the together view to a part of Shruti's section. */
  const go = (k, part) => {
    view = k; try { localStorage.setItem(VIEW_KEY, k); } catch (e) { /* ignore */ }
    show();
    const h = hosts[k];
    const target = part === 'convo' ? h.querySelector('.cc-mn-convo') : h.querySelector('.cc-mn-list');
    if (part === 'zoho') { const t = [...h.querySelectorAll('.cc-mn-scopetab')][2]; if (t) t.click(); }
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  dash.onData(() => { nets.mn.draw(); nets.sn.draw(); drawTogether(); show(); });
})();
