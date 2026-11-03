#!/usr/bin/env node
// Chief of Staff feed for the locked dashboard (Hemang, Nov 3, 2026).
//
//   node cos_feed.mjs --db C:\chief-of-staff\data\cos.db --memories C:\chief-of-staff\memories --key seal_key.pub.pem [--push] [--dry-run]
//
// Reads the Chief of Staff bot's SQLite database READ-ONLY (it never writes to it and never touches the bot's folder),
// keeps every work conversation (all history) and leaves out everything the bot labels personal or family, spam or
// automated. Builds:
//   - cos_digest: one small row per person linked to a Zoho contact, with a concise context line (goes into the main
//     locked bundle, so every tab can show it);
//   - cos_feed: the full detail (people, every message, email, call transcript, CRM activity, text the bot read from
//     images, call summaries, commitments, partner notes, calendar meetings, memory notes), gzipped and loaded only
//     when the Chief of Staff tab opens.
// Both are sealed with the dashboard's RSA public key (same envelope as scripts/seal.mjs), so only the MAIL_KEY secret
// in GitHub Actions opens them. With --push it force-pushes cos.sealed.json as the only file on the orphan branch
// cos-snapshot and dispatches refresh.yml; when nothing changed since the last run it skips the push.
// Node 24 standard library only (node:sqlite).
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes, constants } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync, statSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = 'Himanshu-1-1/Dashboard';
const BRANCH = 'cos-snapshot';
const MAX_SEALED_BYTES = 90 * 1024 * 1024;
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;

/* ---------- arguments and config ---------- */
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const CONFIG_PATH = resolve(opt('--config', join(HERE, 'cos_feed.config.json')));
const config = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) : {};
const DB_PATH = resolve(opt('--db', config.db || 'C:\\chief-of-staff\\data\\cos.db'));
const MEM_ROOT = resolve(opt('--memories', config.memories || join(dirname(dirname(DB_PATH)), 'memories')));
const KEY_PATH = resolve(opt('--key', config.key || join(HERE, 'seal_key.pub.pem')));
const OUT_DIR = resolve(opt('--out', config.out || join(HERE, 'out')));
const STATE_PATH = join(OUT_DIR, 'state.json');
const LOG_PATH = join(OUT_DIR, 'cos_feed.log');
const LOCK_PATH = join(OUT_DIR, 'run.lock');
/* Chats to leave out by name even when the bot hasn't labeled them personal (exact channel names, case-insensitive). */
/* BotFather and the bot's own approvals group are bot chatter, not conversations with people. */
const EXCLUDE_CHATS = new Set(['botfather', 'tt/tls chief of staff', ...(config.exclude_chats || [])].map((s) => String(s).trim().toLowerCase()));
const PUSH = flag('--push');
const DRY = flag('--dry-run');
const IMMUTABLE = flag('--immutable');

mkdirSync(OUT_DIR, { recursive: true });
const log = (msg) => {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_PATH, line + '\n'); } catch { /* the log is a convenience */ }
};
const die = (msg) => { log('ERROR ' + msg); releaseLock(); process.exit(1); };

/* One run at a time: a slow push must not overlap the next hourly start. A lock older than 2 hours is a crash leftover. */
let haveLock = false;
function takeLock() {
  if (existsSync(LOCK_PATH)) {
    const age = Date.now() - statSync(LOCK_PATH).mtimeMs;
    if (age < LOCK_STALE_MS) { log(`another run holds ${LOCK_PATH} (${Math.round(age / 60000)} min old); skipping`); process.exit(0); }
    rmSync(LOCK_PATH, { force: true });
  }
  closeSync(openSync(LOCK_PATH, 'wx'));
  haveLock = true;
}
function releaseLock() { if (haveLock) { rmSync(LOCK_PATH, { force: true }); haveLock = false; } }
process.on('exit', releaseLock);

/* ---------- text helpers ---------- */
const clean = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\n{3,}/g, '\n\n').trim();
/* An email body without the quoted thread under it: the earlier messages are their own rows. */
const QUOTE_RE = /^(?:On .{4,200}wrote:\s*$|-{2,}\s*Original Message\s*-{2,}|_{20,}\s*$|From:\s.+\n(?:Sent|Date):\s.+$)/im;
const stripQuoted = (s) => { const t = clean(s); const m = QUOTE_RE.exec(t); return m && m.index > 0 ? t.slice(0, m.index).trim() : t; };
const words = (s, n) => { const w = clean(s).replace(/\s+/g, ' ').split(' ').filter(Boolean); return w.length > n ? w.slice(0, n).join(' ') + '…' : w.join(' '); };
const firstSentence = (s) => { const t = clean(s).replace(/\s+/g, ' '); const m = /^(.{20,220}?[.!?])(\s|$)/.exec(t); return m ? m[1] : t; };
/* The short line other tabs show: no tracking tags or boilerplate headers, one sentence's worth of words. */
const gistOf = (s) => clean(s).replace(/\[cid:[^\]]*\]/g, '').replace(/<?https?:\/\/[^\s>]+>?/g, '').replace(/[_=-]{5,}/g, ' ').replace(/^(?:\[[A-Z0-9_-]+:[^\]]*\]\s*)+/, '').replace(/^[A-Z][A-Z /&-]{8,}(?:\([^)]*\)|:)\s*/, '').replace(/\s+/g, ' ').trim();
/* Invitation replies and meeting-link boilerplate say nothing about the conversation. */
const NOISE_TITLE = /^(?:accepted|declined|tentative|tentatively accepted|canceled|cancelled|updated invitation|invitation|automatic reply|out of office)\b/i;
const jparse = (s, d) => { if (s == null || s === '') return d; try { return JSON.parse(s); } catch { return d; } };

/* ---------- read the bot's database (read-only) ---------- */
function openDb() {
  if (!existsSync(DB_PATH)) die(`database not found: ${DB_PATH}`);
  const path = IMMUTABLE ? `file:${DB_PATH}?mode=ro&immutable=1` : DB_PATH;
  const db = new DatabaseSync(path, { readOnly: true, open: true });
  db.exec('PRAGMA query_only = ON;');
  return db;
}

const PERSONAL_CATEGORIES = new Set(['personal', 'spam', 'automated']);
const WORK_RELS = new Set(['client', 'prospect', 'partner', 'referral_partner', 'advisor', 'vendor', 'third_party_vendor']);
const CHAT_SOURCES = new Set(['telegram', 'whatsapp']);
const SOURCE_NAME = { telegram: 'Telegram', whatsapp: 'WhatsApp', m365_mail: 'Email', fireflies: 'Call', zoho_activity: 'Zoho', recording: 'Recording', calendar: 'Meeting' };

function build(db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const people = new Map(all('SELECT p.id, p.display_name, p.role_title, p.relationship, p.seniority, p.zoho_contact_id, p.zoho_lead_id, p.memory_file, o.name AS org, o.domain AS org_domain, o.zoho_account_id FROM people p LEFT JOIN organizations o ON o.id = p.org_id').map((r) => [r.id, r]));
  const isPersonal = (pid) => (people.get(pid) || {}).relationship === 'personal';
  const isSelf = (pid) => (people.get(pid) || {}).relationship === 'self';

  const parts = new Map();
  for (const r of all('SELECT interaction_id, person_id, role FROM interaction_participants')) {
    if (!parts.has(r.interaction_id)) parts.set(r.interaction_id, []);
    parts.get(r.interaction_id).push([r.person_id, r.role]);
  }

  const rows = all(`SELECT i.id, i.source, i.kind, i.channel_ref, i.thread_key, i.direction, i.occurred_at, i.ended_at, i.title, i.category, i.web_link,
      ic.body_text, o.name AS org
    FROM interactions i
    LEFT JOIN interaction_content ic ON ic.interaction_id = i.id
    LEFT JOIN organizations o ON o.id = i.org_id
    WHERE i.duplicate_of IS NULL`);

  /* Chats are judged as a whole: a chat with someone the bot labels personal (family included) and nobody from outside
     the team on the business side is personal, every message in it. Emails, calls and CRM activity are judged one by one. */
  const chatTitle = new Map();
  const chatMembers = new Map();
  for (const r of rows) {
    if (!CHAT_SOURCES.has(r.source)) continue;
    const key = `${r.source}|${r.channel_ref || r.thread_key || ''}`;
    if (r.title && !chatTitle.has(key)) chatTitle.set(key, r.title);
    if (!chatMembers.has(key)) chatMembers.set(key, new Set());
    for (const [pid] of parts.get(r.id) || []) chatMembers.get(key).add(pid);
  }
  const personalChat = new Set();
  for (const [key, members] of chatMembers) {
    const ids = [...members];
    const name = (chatTitle.get(key) || key.split('|')[1] || '').trim().toLowerCase();
    if (EXCLUDE_CHATS.has(name)) { personalChat.add(key); continue; }
    if (ids.some(isPersonal) && !ids.some((pid) => WORK_RELS.has((people.get(pid) || {}).relationship))) personalChat.add(key);
  }

  const kept = [];
  let dropped = 0;
  for (const r of rows) {
    if (PERSONAL_CATEGORIES.has(r.category)) { dropped += 1; continue; }
    const ps = (parts.get(r.id) || []).filter(([pid]) => people.has(pid));
    if (CHAT_SOURCES.has(r.source)) {
      if (personalChat.has(`${r.source}|${r.channel_ref || r.thread_key || ''}`)) { dropped += 1; continue; }
    } else if (ps.some(([pid]) => isPersonal(pid)) && !ps.some(([pid]) => WORK_RELS.has(people.get(pid).relationship))) { dropped += 1; continue; }
    kept.push({ ...r, ps });
  }
  const keptIds = new Set(kept.map((r) => r.id));

  /* Text the bot read from images and files, and call or chat summaries. Images it marked personal stay out. */
  const att = new Map();
  for (const a of all("SELECT interaction_id, mime, reading_text FROM attachments WHERE read_status = 'done' AND reading_text IS NOT NULL AND trim(reading_text) <> ''")) {
    if (!keptIds.has(a.interaction_id)) continue;
    const t = clean(a.reading_text);
    if (!t || /^personal\b/i.test(t)) continue;
    if (!att.has(a.interaction_id)) att.set(a.interaction_id, []);
    att.get(a.interaction_id).push({ mime: a.mime || '', text: t });
  }
  const summ = new Map();
  for (const e of all('SELECT interaction_id, summary, decisions_json, topics_json, created_at FROM extractions WHERE summary IS NOT NULL ORDER BY created_at')) {
    if (!keptIds.has(e.interaction_id)) continue;
    summ.set(e.interaction_id, { summary: clean(e.summary), decisions: jparse(e.decisions_json, []), topics: jparse(e.topics_json, []) });
  }

  const usedPeople = new Set();
  const items = kept.map((r) => {
    const chatKey = CHAT_SOURCES.has(r.source) ? `${r.source}|${r.channel_ref || r.thread_key || ''}` : null;
    const body = r.source === 'm365_mail' ? stripQuoted(r.body_text) : clean(r.body_text);
    const p = r.ps.filter(([pid]) => !isSelf(pid));
    p.forEach(([pid]) => usedPeople.add(pid));
    /* Who wrote it, from the participants (the bot's direction is relative to the mailbox that received a copy). */
    const sender = (r.ps.find(([, role]) => role === 'from' || role === 'sender') || [])[0];
    if (sender) usedPeople.add(sender);
    const s = summ.get(r.id);
    return {
      id: r.id,
      src: r.source,
      kind: r.kind,
      at: r.occurred_at,
      end: r.ended_at || undefined,
      dir: r.direction || undefined,
      from: sender || undefined,
      chat: chatKey ? (chatTitle.get(chatKey) || r.channel_ref || '') : undefined,
      ck: chatKey ? createHash('sha1').update(chatKey).digest('hex').slice(0, 12) : undefined,
      title: r.source === 'm365_mail' || r.source === 'fireflies' || r.source === 'zoho_activity' ? (r.title || undefined) : undefined,
      org: r.org || undefined,
      cat: r.category || undefined,
      p: p.map(([pid, role]) => [pid, role]),
      text: body || undefined,
      img: att.get(r.id) || undefined,
      sum: s ? s.summary : undefined,
      dec: s && Array.isArray(s.decisions) && s.decisions.length ? s.decisions : undefined,
      link: r.web_link || undefined,
    };
  }).sort((a, b) => String(b.at).localeCompare(String(a.at)));

  /* Commitments, partner notes and calendar meetings tied to the people kept. */
  const commitments = all('SELECT id, interaction_id, owner_person_id, counterparty_person_id, text, due_at, status, evidence_quote, business_category, created_at, updated_at, closed_reason FROM commitments')
    .filter((c) => (!c.interaction_id || keptIds.has(c.interaction_id)) && !isPersonal(c.owner_person_id) && !isPersonal(c.counterparty_person_id) && (c.owner_person_id || c.counterparty_person_id))
    .map((c) => {
      [c.owner_person_id, c.counterparty_person_id].forEach((pid) => { if (pid && people.has(pid) && !isSelf(pid)) usedPeople.add(pid); });
      return { id: c.id, iid: c.interaction_id || undefined, owner: c.owner_person_id || undefined, who: c.counterparty_person_id || undefined, text: clean(c.text), due: c.due_at || undefined, status: c.status, quote: clean(c.evidence_quote) || undefined, cat: c.business_category || undefined, at: c.created_at, upd: c.updated_at, why_closed: c.closed_reason || undefined };
    });
  const partnerNotes = all('SELECT interaction_id, group_title, status, person_id, partner_name, note_text, confidence, created_at FROM partner_log')
    .filter((n) => (!n.interaction_id || keptIds.has(n.interaction_id)) && !isPersonal(n.person_id) && clean(n.note_text))
    .map((n) => { if (n.person_id && people.has(n.person_id)) usedPeople.add(n.person_id); return { iid: n.interaction_id, group: n.group_title || undefined, status: n.status, pid: n.person_id || undefined, name: n.partner_name || undefined, text: clean(n.note_text), conf: n.confidence ?? undefined, at: n.created_at }; });

  /* Identities (emails, phones, Telegram, WhatsApp names) for the people kept. */
  const ids = new Map();
  for (const r of all('SELECT person_id, kind, value FROM identities')) {
    if (!ids.has(r.person_id)) ids.set(r.person_id, []);
    ids.get(r.person_id).push([r.kind, r.value]);
  }
  const byEmail = new Map();
  for (const [pid, list] of ids) for (const [k, v] of list) if (k === 'email' && v) byEmail.set(String(v).toLowerCase(), pid);

  const meetings = [];
  for (const m of all('SELECT id, mailbox, subject, start_utc, end_utc, attendees_json, organizer_email, cancelled, external FROM calendar_events')) {
    const att = jparse(m.attendees_json, []);
    const emails = (Array.isArray(att) ? att : []).map((a) => String((a && (a.email || a.address || (a.emailAddress && a.emailAddress.address))) || '').toLowerCase()).filter(Boolean);
    const pids = [...new Set([...emails, String(m.organizer_email || '').toLowerCase()].map((e) => byEmail.get(e)).filter(Boolean))];
    if (pids.some(isPersonal) && !pids.some((pid) => WORK_RELS.has((people.get(pid) || {}).relationship))) continue;
    const ext = pids.filter((pid) => !isSelf(pid) && (people.get(pid) || {}).relationship !== 'internal');
    if (!ext.length) continue;
    ext.forEach((pid) => usedPeople.add(pid));
    meetings.push({ id: m.id, box: m.mailbox, title: clean(m.subject) || undefined, at: m.start_utc, end: m.end_utc || undefined, p: ext, cancelled: Boolean(m.cancelled) || undefined, external: Boolean(m.external) || undefined });
  }
  meetings.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  /* People: everyone the team talks to about work (never someone labeled personal), with the bot's memory notes. */
  const readMemory = (rel) => {
    if (!rel) return undefined;
    const path = resolve(dirname(MEM_ROOT), rel);
    if (!path.startsWith(dirname(MEM_ROOT)) || !existsSync(path)) return undefined;
    try { return clean(readFileSync(path, 'utf8')) || undefined; } catch { return undefined; }
  };
  const personList = [...usedPeople].map((pid) => people.get(pid)).filter((p) => p && p.relationship !== 'personal').map((p) => ({
    id: p.id, name: clean(p.display_name), rel: p.relationship, title: clean(p.role_title) || undefined, seniority: p.seniority || undefined,
    org: p.org || undefined, org_domain: p.org_domain || undefined, zoho_id: p.zoho_contact_id || undefined, zoho_lead: p.zoho_lead_id || undefined, zoho_account: p.zoho_account_id || undefined,
    ids: (ids.get(p.id) || []).length ? ids.get(p.id) : undefined, memory: readMemory(p.memory_file),
  }));
  const keepIds = new Set(personList.map((p) => p.id));
  const strip = (pid) => (pid && keepIds.has(pid) ? pid : undefined);
  items.forEach((it) => { it.p = it.p.filter(([pid]) => keepIds.has(pid)); it.from = strip(it.from); });
  commitments.forEach((c) => { c.owner = strip(c.owner); c.who = strip(c.who); });
  partnerNotes.forEach((n) => { n.pid = strip(n.pid); });
  meetings.forEach((m) => { m.p = m.p.filter((pid) => keepIds.has(pid)); });

  /* Concise per-person context for the other tabs: last contact per channel and one short line. */
  const lastBy = new Map();
  const latest = new Map();
  const latestZoho = new Map();
  const counts = new Map();
  for (const it of items) {
    for (const [pid] of it.p) {
      counts.set(pid, (counts.get(pid) || 0) + 1);
      const l = lastBy.get(pid) || {};
      if (!l[it.src]) { l[it.src] = { at: it.at, dir: it.dir }; lastBy.set(pid, l); }
      /* The digest line comes from the newest conversation the CRM doesn't already hold; Zoho notes only as a last resort. */
      if ((it.sum || it.text || (it.img && it.img.length)) && !NOISE_TITLE.test(it.title || '')) {
        if (it.src !== 'zoho_activity' && !latest.has(pid)) latest.set(pid, it);
        else if (it.src === 'zoho_activity' && !latestZoho.has(pid)) latestZoho.set(pid, it);
      }
    }
  }
  const openBy = new Map();
  for (const c of commitments) if (c.status === 'open') [c.owner, c.who].forEach((pid) => { if (pid) openBy.set(pid, (openBy.get(pid) || 0) + 1); });
  const digest = personList.filter((p) => p.zoho_id && p.rel !== 'self').map((p) => {
    const it = latest.get(p.id) || latestZoho.get(p.id);
    const body = it ? gistOf(it.sum ? firstSentence(it.sum) : it.text ? it.text : (it.img[0] || {}).text || '') : '';
    const invite = /^(?:Microsoft Teams meeting|Join Zoom Meeting|You have been invited)/i.test(body);
    const gist = it && it.title && it.src === 'm365_mail' ? (invite ? `Meeting invite: ${gistOf(it.title)}` : `${gistOf(it.title)}: ${body}`) : body;
    const by = it && it.from && people.has(it.from) ? clean(people.get(it.from).display_name) : '';
    const line = it ? `${SOURCE_NAME[it.src] || it.src} ${String(it.at).slice(0, 10)}${by ? `, ${by}` : ''}: ${words(gist, 22)}` : '';
    return { zoho_id: p.zoho_id, pid: p.id, name: p.name, n: counts.get(p.id) || 0, last: lastBy.get(p.id) || {}, open: openBy.get(p.id) || 0, line };
  });

  const bySource = {};
  items.forEach((it) => { bySource[it.src] = (bySource[it.src] || 0) + 1; });
  return {
    feed: { v: 1, built_at: new Date().toISOString(), people: personList, items, commitments, partner_notes: partnerNotes, meetings, stats: { items: items.length, by_source: bySource, people: personList.length, dropped_personal: dropped } },
    digest,
    stats: { kept: items.length, dropped, people: personList.length, digest: digest.length, bySource },
  };
}

/* ---------- seal (same envelope as scripts/seal.mjs) ---------- */
function seal(payload) {
  const pub = createPublicKey(readFileSync(KEY_PATH, 'utf8'));
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const key = publicEncrypt({ key: pub, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, dataKey);
  return JSON.stringify({ v: 1, alg: 'RSA-OAEP-256+A256GCM', key: key.toString('base64'), iv: iv.toString('base64'), data: body.toString('base64') });
}

/* ---------- publish ---------- */
const run = (cmd, argv, cwd) => execFileSync(cmd, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true });
function push(sealedPath) {
  const work = mkdtempSync(join(tmpdir(), 'cos-feed-'));
  try {
    const git = (...a) => run('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', ...a], work);
    git('init', '-q', '-b', BRANCH);
    writeFileSync(join(work, 'cos.sealed.json'), readFileSync(sealedPath));
    git('add', 'cos.sealed.json');
    git('-c', 'user.name=CoS feed', '-c', 'user.email=cos-feed@users.noreply.github.com', 'commit', '-q', '-m', 'cos.sealed.json: Chief of Staff feed, sealed for the locked public site');
    git('push', '-q', '-f', `https://github.com/${REPO}.git`, `${BRANCH}:${BRANCH}`);
    log(`pushed ${BRANCH}`);
    run('gh', ['workflow', 'run', 'refresh.yml', '--ref', 'main', '-R', REPO]);
    log('dispatched refresh.yml');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/* ---------- main ---------- */
takeLock();
const t0 = Date.now();
const db = openDb();
let built;
try { built = build(db); } finally { db.close(); }
const lazy = gzipSync(Buffer.from(JSON.stringify(built.feed), 'utf8'), { level: 9 });
/* The content hash leaves the build time out, so an hour with no new messages pushes nothing. */
const hash = createHash('sha256').update(JSON.stringify({ ...built.feed, built_at: null })).update(JSON.stringify(built.digest)).digest('hex');
log(`built in ${Date.now() - t0} ms: ${built.stats.kept} items (${Object.entries(built.stats.bySource).map(([k, v]) => `${k} ${v}`).join(', ')}), ${built.stats.people} people, ${built.stats.digest} linked to Zoho, ${built.stats.dropped} left out as personal; feed ${(lazy.length / 1048576).toFixed(1)} MB gzipped`);
const state = existsSync(STATE_PATH) ? jparse(readFileSync(STATE_PATH, 'utf8'), {}) : {};
const sealedPath = join(OUT_DIR, 'cos.sealed.json');
const sealedText = seal({ sealed_at: new Date().toISOString(), datasets: { cos_digest: built.digest }, lazy: { cos_feed: lazy.toString('base64') } });
if (sealedText.length > MAX_SEALED_BYTES) die(`sealed file is ${(sealedText.length / 1048576).toFixed(1)} MB, over the ${MAX_SEALED_BYTES / 1048576} MB limit`);
writeFileSync(sealedPath, sealedText);
if (DRY) { writeFileSync(join(OUT_DIR, 'cos_feed.json.gz'), lazy); writeFileSync(join(OUT_DIR, 'cos_digest.json'), JSON.stringify(built.digest)); log('dry run: wrote out/cos.sealed.json, out/cos_feed.json.gz and out/cos_digest.json; nothing pushed'); process.exit(0); }
if (!PUSH) { log('built; pass --push to publish'); process.exit(0); }
if (state.hash === hash && state.pushed_at) { log(`unchanged since ${state.pushed_at}; nothing pushed`); process.exit(0); }
try {
  push(sealedPath);
  writeFileSync(STATE_PATH, JSON.stringify({ hash, pushed_at: new Date().toISOString() }));
} catch (err) {
  die(`publish failed: ${String(err.stderr || err.message || err).trim().split('\n').slice(-3).join(' | ')}`);
}
