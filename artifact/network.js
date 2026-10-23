/* Mack's Network: every LinkedIn connection in Mack's export (dataset mack_network), read as a B2B referral-partner
   prospect and checked against what we already know: Zoho contacts (live), Fireflies calls, the TLS team and
   advisors, and LinkedIn endorsements and recommendations between Mack and them. A chance of a real conversation is
   estimated live from how Mack's connections already in our B2B and Founder Network campaigns have done (by kind of
   partner, how long Mack has known them and endorsement ties), and the most likely people carry a researched brief.
   Private dashboard only: never on the public site or written to Zoho. Uses the page's dash and CC_RULES. */
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
    ['known', 'Known to us, not in Zoho', 'on our calls, our team or our notes: add them to Zoho'],
    ['zoho', 'Already in Zoho', 'their campaign and Priority, matched live'],
  ];
  const CRM_NAME = { b2b: 'B2B campaign', fn: 'Founder Network', client: 'Client', icp: 'ICP campaign', other: 'In Zoho, no campaign' };
  const REL_NAME = { insider: 'Our team or advisor', works: 'Works with us regularly', talked: 'On our calls', known: 'In our notes' };

  /* ---------- helpers ---------- */
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const intF = (n) => Number(n || 0).toLocaleString('en-US');
  const pctF = (x) => `${Math.round(x * 100)}%`;
  const rows = (id) => { const d = dash.data(id); return d && d.status === 'ok' ? d.data || [] : []; };
  const status = (id) => (dash.data(id) || {}).status;
  const slugOf = (u) => { const m = String(u || '').match(/linkedin\.com\/(?:in|pub)\/([^/?#\s]+)/i); if (!m) return null; try { return decodeURIComponent(m[1]).toLowerCase().replace(/\/+$/, ''); } catch (e) { return m[1].toLowerCase(); } };
  const nameKey = (f, l) => `${String(f || '').toLowerCase().replace(/[^a-z]/g, '')}|${String(l || '').toLowerCase().replace(/[^a-z]/g, '')}`;
  const has = (list, v) => String(list || '').split(',').map((x) => x.trim()).includes(v);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const dayF = (s) => { if (!s) return '—'; const d = new Date(String(s).slice(0, 10) + 'T00:00:00Z'); return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }); };
  const yearOf = (s) => Number(String(s || '').slice(0, 4)) || null;
  const ageOf = (s) => { const y = yearOf(s); return !y || y >= 2026 ? 'new' : y <= 2019 ? 'old' : 'mid'; };
  const link = (href, text, title) => { const a = el('a', 'cc-zlink', text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; if (title) a.title = title; return a; };

  /* ---------- calc 1: every connection with its live CRM status and what we already know ---------- */
  dash.calc('mn_rows', {
    title: 'Mack’s LinkedIn connections with CRM status and relationship signals',
    description: 'One row per connection in Mack’s LinkedIn export (dataset mack_network) with the Zoho contact matched by LinkedIn profile (else exact first and last name when only one contact has it): campaign (B2B with Priority, Founder Network, Client, ICP, other), meetings and whether they progressed (Priority 1 or 99, or a meeting); and the scope: Already in Zoho, Known to us (Fireflies calls, TLS team or advisor, team notes) or New.',
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
      /* The dashboard's file loader can hand nested fields over as JSON text; read them back as objects. */
      const obj = (v) => { if (typeof v !== 'string' || !/^[[{]/.test(v.trim())) return v; try { return JSON.parse(v); } catch (e) { return null; } };
      return net.map((raw) => {
        const r = { ...raw, ties: obj(raw.ties) || [], brief: obj(raw.brief) || null, co_zoho: obj(raw.co_zoho) || null,
          client: raw.client === true || raw.client === 'true', calls: num(raw.calls), rel: raw.rel || null, insider: raw.insider || null, last_call: raw.last_call || null };
        if (r.brief && typeof r.brief !== 'object') r.brief = null;
        if (r.co_zoho && typeof r.co_zoho !== 'object') r.co_zoho = null;
        if (r.brief && !Array.isArray(r.brief.sources)) r.brief.sources = [];
        if (r.co_zoho && !Array.isArray(r.co_zoho.camps)) r.co_zoho.camps = [];
        const s = slugOf(r.url);
        let z = s ? bySlug.get(s) : null;
        let by = z ? 'LinkedIn profile' : null;
        if (!z) { const list = byName.get(nameKey(r.first, r.last)) || []; if (list.length === 1) { z = list[0]; by = 'Name'; } }
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
          zoho_id: z ? String(z.id) : null, zoho_by: by, crm, priority, meetings,
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
  dash.calc('mn_model', {
    title: 'What turns Mack’s connections into conversations',
    description: `Among Mack’s connections already in the B2B campaign or Founder Network, the share that progressed (Priority 1 or 99, or a meeting), overall and by grade, kind of partner, when Mack connected and endorsement or recommendation ties; plus a ridge logistic regression (penalty ${RIDGE}) on those same features, tested by 5-fold cross-validation: the share that progressed in the top and bottom fifth of held-out scores, and the AUC.`,
    inputs: ['mn_rows'],
    fn: (all) => {
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
  dash.calc('mn_ranked', {
    title: 'Chance each connection becomes a real conversation',
    description: `For strong and possible fits: the model’s probability from their kind of partner, connection age, endorsement ties and grade; where web research found them, the odds are multiplied by ${RES_ODDS.High} for a High fit or ${RES_ODDS.Low} for a Low one (a judgment, not learned). An estimate from our own results, not a promise.`,
    inputs: ['mn_rows', 'mn_model'],
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
  const st = { scope: 'new', grade: new Set(['A', 'B']), type: null, crm: null, q: '', page: 0, sort: 'chance', researched: false };
  const section = (cls, title, sub) => {
    const s = el('section', 'cc-card ' + cls);
    const h = el('div', 'cc-card-head');
    const t = el(cls === 'cc-mn-head' ? 'h2' : 'h3', null, title);
    const p = el('p', null, sub || '');
    h.append(t, p);
    s.append(h);
    return { s, t, p };
  };
  const head = section('cc-mn-head', 'Mack’s network: who will become a partner', '');
  const stats = el('div', 'cc-mn-stats');
  head.s.append(stats);
  const learn = section('cc-mn-learn', 'What turns a connection into a conversation', '');
  const learnBody = el('div', 'cc-mn-learngrid');
  const learnTake = el('ul', 'cc-mn-takeaways');
  learn.s.append(learnTake, learnBody);
  const likely = section('cc-mn-likely', 'Most likely to become partners', '');
  const likelyBody = el('div', 'cc-mn-briefs');
  const likelyMore = el('div', 'cc-tools');
  likely.s.append(likelyBody, likelyMore);
  const known = section('cc-mn-known', 'Known to us, but not in Zoho', '');
  const knownBody = el('div', 'cc-mn-tablewrap');
  known.s.append(knownBody);
  const kinds = section('cc-mn-types', 'Where the new partners are', '');
  const kindsBody = el('div', 'cc-mn-bars');
  kinds.s.append(kindsBody);
  const list = section('cc-mn-list', 'Every connection', '');
  list.s.id = 'mn-list';
  const scopeBar = el('div', 'cc-mn-scope');
  scopeBar.setAttribute('role', 'tablist');
  const filters = el('div', 'cc-mn-filters');
  const tableWrap = el('div', 'cc-mn-tablewrap');
  const pager = el('div', 'cc-tools cc-mn-pager');
  list.s.insertBefore(scopeBar, list.s.firstChild);
  list.s.append(filters, tableWrap, pager);
  const foot = el('p', 'cc-mn-foot');
  root.replaceChildren(head.s, learn.s, likely.s, known.s, kinds.s, list.s, foot);

  /* ---------- shared pieces ---------- */
  const researched = (r) => Boolean(r.brief && r.brief.check !== 'none');
  const resFit = (r) => (researched(r) ? r.brief.fit_after_research : null);
  const chanceBadge = (r) => {
    const b = el('span', 'cc-mn-chance' + (r.chance >= LIKELY ? ' cc-mn-hi' : r.chance >= AVG ? ' cc-mn-mid' : ''), r.chance == null ? '—' : r.chance + '%');
    b.title = `Estimated chance of a real two-way conversation (Priority 1, signed or a meeting), learned from Mack’s connections already in our campaigns. Average ${AVG}%; ${LIKELY}%+ is ${LIKELY_X}× the average.`;
    return b;
  };
  const gradePill = (g) => { const p = el('span', 'cc-mn-grade cc-mn-g' + g, g); p.title = (GRADES.find((x) => x[0] === g) || [])[1] || ''; return p; };
  const personLink = (r) => (r.url ? link(r.url, r.name, 'Open the LinkedIn profile') : el('b', null, r.name));
  const relLine = (r) => {
    const parts = [];
    const y = yearOf(r.connected);
    if (y) parts.push(`Connected since ${y}`);
    (r.ties || []).forEach((t) => parts.push(t));
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
      if (r.dnc) w.append(el('small', 'cc-mn-dnc', ' Do Not Contact'));
    } else w.textContent = r.rel ? REL_NAME[r.rel] + ', not in Zoho' : 'Not in Zoho';
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
  const goList = (patch) => { Object.assign(st, { page: 0 }, patch); drawKinds(); drawList(); list.s.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const drawHead = (all) => {
    const fresh = all.filter((r) => r.scope === 'new' && (r.fit === 'A' || r.fit === 'B'));
    const hot = fresh.filter((r) => r.chance >= LIKELY);
    const best = fresh.filter((r) => researched(r) && r.brief.fit_after_research === 'High');
    const knownN = all.filter((r) => r.scope === 'known').length;
    const inZoho = all.filter((r) => r.scope === 'zoho').length;
    const asof = (all[0] || {}).export_date;
    head.p.textContent = `${intF(all.length)} connections from Mack’s LinkedIn export${asof ? ' of ' + dayF(asof) : ''}, each checked against Zoho (live), our Fireflies calls, the TLS team and advisors, and endorsements between Mack and them, and ranked by the chance of a real conversation learned from our own results. ${intF(fresh.length)} of them are new strong or possible fits: not in Zoho and not yet talking to us.`;
    const tile = (cls, label, n, hint, fn) => {
      const b = el('button', 'cc-mn-stat ' + cls);
      b.type = 'button';
      b.append(el('span', 'cc-mn-slab', label), el('b', null, intF(n)), el('small', null, hint));
      b.addEventListener('click', fn);
      return b;
    };
    stats.replaceChildren(
      tile('cc-mn-sA', 'Best bets, researched', best.length, 'high chance and a High fit on the web: approach first', () => likely.s.scrollIntoView({ behavior: 'smooth', block: 'start' })),
      tile('cc-mn-sB', `Above-average chance, ${LIKELY}%+`, hot.length, `${LIKELY_X}× our average of ${AVG}%: research these next`, () => goList({ scope: 'new', grade: new Set(['A', 'B']), type: null, crm: null, sort: 'chance' })),
      tile('cc-mn-sKnown', 'Known to us, not in Zoho', knownN, 'on our calls or team: add to Zoho', () => known.s.scrollIntoView({ behavior: 'smooth', block: 'start' })),
      tile('cc-mn-sIn', 'Already in Zoho', inZoho, 'matched by LinkedIn profile or name', () => goList({ scope: 'zoho', grade: new Set(), type: null, crm: null, sort: 'chance' })),
    );
  };

  /* ---------- what the data says ---------- */
  const drawLearn = () => {
    const m = rows('mn_model')[0];
    if (!m || !m.n) { learn.p.textContent = 'Not enough of Mack’s connections are in our campaigns yet to learn from.'; learnBody.replaceChildren(); learnTake.replaceChildren(); return; }
    learn.p.textContent = `Measured live on the ${intF(m.n)} of Mack’s connections already in our B2B campaign or Founder Network: ${pctF(m.base)} of them reached Priority 1, signed, or had a meeting. This is what the chances below are built on.`;
    const block = (title, entries) => {
      const w = el('div', 'cc-mn-learnblock');
      w.append(el('h4', null, title));
      const peak = Math.max(0.01, ...entries.map((e) => e.g.raw || 0));
      entries.forEach((e) => {
        if (!e.g.n) return;
        const row = el('div', 'cc-mn-lrow');
        const bar = el('span', 'cc-mn-ltrack'); const f = el('i'); f.style.width = ((e.g.raw || 0) / peak) * 100 + '%'; bar.append(f);
        row.append(el('span', 'cc-mn-llab', e.label), bar, el('b', null, pctF(e.g.raw || 0)), el('small', null, `${e.g.ok} of ${e.g.n}`));
        row.title = `${e.label}: ${e.g.ok} of ${e.g.n} progressed (${pctF(e.g.raw || 0)}).`;
        w.append(row);
      });
      return w;
    };
    const types = TYPES.map(([k, label]) => ({ k, label, g: m.byType[k] })).filter((x) => x.g && x.g.n >= 5).sort((x, y) => (y.g.raw || 0) - (x.g.raw || 0));
    learnBody.replaceChildren(
      block('By kind of partner (5 or more people)', types),
      block('By when Mack connected', AGES.map(([k, label]) => ({ label, g: m.byAge[k] }))),
      block('By endorsements or recommendations', [{ label: 'Endorsement or recommendation', g: m.byTie.yes }, { label: 'Neither', g: m.byTie.no }]),
      block('By grade from the title', GRADES.slice(0, 3).map(([k, label]) => ({ label: `${k} ${label}`, g: m.byGrade[k] }))),
    );
    const take = [];
    if (types.length >= 2) {
      const best = types[0]; const worst = types[types.length - 1];
      take.push(`${best.label} progress most (${pctF(best.g.raw)}, ${best.g.ok} of ${best.g.n}); ${worst.label} least (${pctF(worst.g.raw)}, ${worst.g.ok} of ${worst.g.n}).`);
    }
    const o = m.byAge.old; const n2 = m.byAge.new; const md = m.byAge.mid;
    if (n2.n && (o.n || md.n)) {
      const older = { ok: o.ok + md.ok, n: o.n + md.n };
      take.push(`People Mack has known since before 2026 progress at ${pctF(older.ok / older.n)}, against ${pctF(n2.raw)} for this year’s new connections: the existing network is worth more than cold connects.`);
    }
    if (m.byTie.yes.n && m.byTie.no.n) take.push(`Where Mack and the person endorsed or recommended each other, ${pctF(m.byTie.yes.raw)} progressed, against ${pctF(m.byTie.no.raw)} without.`);
    const ga = m.byGrade.A; const gc = m.byGrade.C;
    if (ga.n && gc.n && Math.abs((ga.raw || 0) - (gc.raw || 0)) < 0.08) take.push(`A job title alone predicts little (strong fits ${pctF(ga.raw)}, weak fits ${pctF(gc.raw)}), so the ranking leans on relationship and kind of partner, not title.`);
    if (m.test) {
      const t = m.test;
      take.push(`Tested on people it wasn’t trained on: the top fifth by chance progressed ${pctF(t.top)}, the bottom fifth ${pctF(t.bottom)}${t.auc != null ? ` (AUC ${t.auc.toFixed(2)})` : ''}. The ranking ${t.auc >= 0.7 ? 'separates well' : 'is a real but modest signal'}, so the research below and Mack’s own judgment still matter.`);
    }
    learnTake.replaceChildren(...take.map((t) => el('li', null, t)));
  };

  /* ---------- most likely, with research ---------- */
  let likelyAll = false;
  const drawLikely = (all) => {
    const pool = all.filter((r) => r.scope === 'new' && r.chance != null && researched(r) && resFit(r) !== 'Low')
      .sort((a, b) => b.chance - a.chance || (a.brief.check === 'confirmed' ? -1 : 1) - (b.brief.check === 'confirmed' ? -1 : 1) || String(a.connected).localeCompare(String(b.connected)));
    const lows = all.filter((r) => r.scope === 'new' && resFit(r) === 'Low').length;
    const waiting = all.filter((r) => r.scope === 'new' && r.brief && r.brief.check === 'none').length;
    likely.p.textContent = `New people with the highest chance, each looked up on the web: current role, firm, who they serve, risks, and how Mack should open. ${intF(pool.length)} shown${lows ? `; ${intF(lows)} ruled out by research (competitor, inactive or outside our market) and moved down the list` : ''}${waiting ? `; ${intF(waiting)} more are still waiting for research` : ''}.`;
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
    known.p.textContent = `${intF(kn.length)} people Mack is connected to whom we already talk to or work with, yet who have no Zoho contact. Partner prospects among them should go into Zoho first; team, advisors and day-to-day colleagues are kept out of the new list.`;
    const tbl = el('table', 'cc-tbl cc-mn-tbl');
    const th = el('thead'); const hr = el('tr');
    ['Name', 'Title and company', 'How we know them', 'Grade', 'What to do'].forEach((h) => { const c = el('th', null, h); c.scope = 'col'; hr.append(c); });
    th.append(hr); tbl.append(th);
    const tb = el('tbody');
    kn.forEach((r) => {
      const tr = el('tr');
      const n = el('td'); n.append(personLink(r));
      const role = el('td', 'cc-mn-rolecell'); role.append(el('span', null, r.position || '—'), el('small', null, r.company || ''));
      const how = el('td', 'cc-mn-whycell', [r.insider || REL_NAME[r.rel], r.calls ? `${r.calls} Fireflies call${r.calls === 1 ? '' : 's'}, last ${dayF(r.last_call)}` : null].filter(Boolean).join(' · '));
      const g = el('td'); g.append(gradePill(r.fit));
      const todo = r.rel === 'insider' ? 'Nothing: our team or advisor'
        : r.rel === 'works' ? 'Nothing: we work with them day to day'
          : resFit(r) === 'Low' ? `Add to Zoho, not as a B2B prospect: ${r.brief.risks}`
            : (r.fit === 'A' || r.fit === 'B') ? 'Add to Zoho with the B2B tag and log the call' : 'Add to Zoho if the call was about business';
      tr.append(n, role, how, g, el('td', 'cc-mn-whycell', todo));
      tb.append(tr);
    });
    tbl.append(tb);
    knownBody.replaceChildren(kn.length ? tbl : el('p', 'cc-mn-empty', 'Everyone we talk to is in Zoho.'));
  };

  /* ---------- kinds of partner (new scope) ---------- */
  const drawKinds = () => {
    const all = rows('mn_ranked');
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
      b.append(el('b', null, `${label} (${intF(all.filter((r) => r.scope === k).length)})`), el('span', null, hint));
      b.addEventListener('click', () => { if (st.scope === k) return; Object.assign(st, { scope: k, crm: null, page: 0, grade: k === 'new' ? new Set(['A', 'B']) : new Set() }); drawList(); });
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
    reset.addEventListener('click', () => { Object.assign(st, { grade: st.scope === 'new' ? new Set(['A', 'B']) : new Set(), type: null, crm: null, q: '', page: 0, sort: 'chance', researched: false }); drawKinds(); drawList(); });
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
    a.download = `mack-network-${st.scope}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const drawList = (keepFocus) => {
    const all = rows('mn_ranked');
    const active = document.activeElement;
    drawScope(all);
    const search = drawFilters(all);
    if (keepFocus && active && active.classList.contains('cc-mn-search')) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    const lst = visible(all).sort(sorters[st.sort]);
    const pages = Math.max(1, Math.ceil(lst.length / PAGE));
    st.page = Math.min(st.page, pages - 1);
    const slice = lst.slice(st.page * PAGE, st.page * PAGE + PAGE);
    const sc = SCOPES.find((x) => x[0] === st.scope);
    list.t.textContent = `${sc[1]} (${intF(lst.length)})`;
    const parts = [];
    if (st.grade.size && st.grade.size < GRADES.length) parts.push([...st.grade].sort().join(' and ') + ' grade');
    if (st.type) parts.push(TYPE_NAME[st.type]);
    if (st.scope === 'zoho' && st.crm) parts.push(CRM_NAME[st.crm]);
    if (st.researched) parts.push('researched');
    if (st.q.trim()) parts.push(`matching “${st.q.trim()}”`);
    list.p.textContent = `${sc[2][0].toUpperCase()}${sc[2].slice(1)}. ${parts.length ? 'Showing: ' + parts.join(', ') + '.' : 'Showing every grade.'} Nothing here is written to Zoho.`;
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
    const s = status('mn_ranked');
    const parts = [learn.s, likely.s, known.s, kinds.s, list.s];
    if (s !== 'ok') {
      parts.forEach((p) => { p.hidden = true; });
      stats.replaceChildren();
      const missing = status('mack_network') === 'error' || (status('mack_network') === 'ok' && !rows('mack_network').length);
      head.p.textContent = missing ? 'Mack’s LinkedIn analysis isn’t loaded on this dashboard. It lives on the private Claude dashboard only.' : (s === 'error' ? 'The connections or Zoho contacts didn’t load. Reload, or check the sources in the dashboard menu.' : 'Loading Mack’s connections and Zoho contacts…');
      foot.textContent = '';
      return;
    }
    parts.forEach((p) => { p.hidden = false; });
    const m = rows('mn_model')[0];
    if (m && m.base) { AVG = Math.round(m.base * 100); LIKELY = Math.round(m.base * LIKELY_X * 100); }
    const all = rows('mn_ranked');
    drawHead(all);
    drawLearn();
    drawLikely(all);
    drawKnown(all);
    drawKinds();
    drawList();
    foot.textContent = 'How this works: every connection was read and graded by hand against the partners who have signed with us or reached Priority 1. We know someone when they were on a Fireflies call with us (Sep 2025 on; matched by their email, display name or name in the meeting title, and only by email for names shared by several connections), are on the TLS team or advisors list, or are in the team’s notes. Endorsements and recommendations come from Mack’s LinkedIn export. The chance comes from a logistic regression fitted live on Mack’s connections already in our campaigns (kind of partner, when Mack connected, endorsements, grade), so it changes as they progress; web research then nudges it up for a High fit and down for a Low one. Researched briefs use public web sources as of the research date; check before outreach. Nothing on this tab is written to Zoho.';
  };
  dash.onData(draw);
})();
