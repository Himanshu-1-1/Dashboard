// Tests for artifact/fn-engine.js. Synthetic fixtures only: no Zoho, Telegram, Fireflies, Outlook or LinkedIn data.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.fetch = () => { throw new Error('the engine must not call the network'); };
const E = require('../artifact/fn-engine.js');

const NOW = '2026-10-23T15:00:00Z'; // 10:00 AM CT, Oct 23, 2026
const zc = (id, first, last, extra = {}) => ({ id, First_Name: first, Last_Name: last, Full_Name: [first, last].filter(Boolean).join(' '), Relationship_Type: 'Founder Network', ...extra });

test('personKey keeps first and last name, drops credentials and titles, splits a full name held in Last Name', () => {
  assert.deepEqual(E.personKey('Dr. Priya', 'Shah, PhD'), { first: 'priya', last: 'shah' });
  assert.deepEqual(E.personKey('', 'Ravi Thornquist Malviya'), { first: 'ravi', last: 'malviya' });
  assert.deepEqual(E.personKey('Torvald', 'Last Name'), null);
  assert.deepEqual(E.personKey('José', 'García (JG)'), { first: 'jose', last: 'garcia' });
});

test('slugOf reads LinkedIn profile slugs, decoded and lower-cased, and ignores other URLs', () => {
  assert.equal(E.slugOf('https://www.linkedin.com/in/Jane-Doe-123/?trk=x'), 'jane-doe-123');
  assert.equal(E.slugOf('https://linkedin.com/in/ren%C3%A9-l'), 'rené-l');
  assert.equal(E.slugOf('https://example.com/in/jane'), null);
  assert.equal(E.slugOf(null), null);
});

test('matchPerson: a LinkedIn profile is confirmed, an exact name is likely, a close name is only possible', () => {
  const idx = E.zohoIndex([
    zc('1', 'Jane', 'Doe', { LinkedIn: 'https://www.linkedin.com/in/jane-doe/' }),
    zc('2', 'Sharla', 'Quillfeather-Brandt'),
    zc('3', 'Corwin', 'Ashdown'),
    zc('4', 'Kumar', 'Anand Ravi'),
  ]);
  assert.equal(E.matchPerson({ key: 'a', name: 'Somebody Else', linkedin: 'https://linkedin.com/in/jane-doe' }, idx).confidence, 'confirmed');
  const exact = E.matchPerson({ key: 'b', name: 'Jane Doe' }, idx);
  assert.equal(exact.zoho.id, '1'); assert.equal(exact.confidence, 'likely');
  const close = E.matchPerson({ key: 'c', name: 'Sharla Quillfeather Brant' }, idx);
  assert.equal(close.zoho.id, '2'); assert.equal(close.confidence, 'possible');
});

test('matchPerson never matches on a different first name alone or on an ambiguous name', () => {
  const idx = E.zohoIndex([zc('3', 'Corwin', 'Ashdown'), zc('5', 'Marla', 'Fenwick')]);
  assert.equal(E.matchPerson({ key: 'x', name: 'Colwin Ashdown' }, idx), null);
  assert.equal(E.matchPerson({ key: 'y', name: 'Darla Fenwick' }, idx), null);
  assert.equal(E.matchPerson({ key: 'z', name: 'Corwin Ashdown' }, idx, { ambiguous: true }), null);
});

test('a rejected identity is never proposed again', () => {
  const idx = E.zohoIndex([zc('3', 'Corwin', 'Ashdown')]);
  assert.equal(E.matchPerson({ key: 'tg:Corwin Ashdown', name: 'Corwin Ashdown' }, idx, { rejected: new Set(['tg:Corwin Ashdown|3']) }), null);
});

test('duplicate Zoho records with one name are flagged, never merged', () => {
  const { founders } = E.run({ now: NOW, fn: [zc('10', 'Dorian', 'Halvesen'), zc('11', 'Dorian', 'Halvesen')] });
  assert.equal(founders.length, 2);
  for (const f of founders) assert.ok(f.issues.some((i) => i.type === 'Possible duplicate in Zoho'));
});

test('Telegram people: matched, missing from Zoho, in Zoho without Founder Network, and first-name-only', () => {
  const contacts = [zc('20', 'Asha', 'Rao', { Relationship_Type: 'Client' })];
  const { founders } = E.run({
    now: NOW,
    fn: [zc('21', 'Jane', 'Doe')],
    contacts,
    tgPeople: [
      { name: 'Jane Doe', priority: 'P1', mentions: [{ date: '2026-09-01', by: 'Mack', text: 'Coffee with Jane' }] },
      { name: 'Tom Nobody' },
      { name: 'Asha Rao' },
      { name: 'Ezekiel', needs_name: true },
    ],
  });
  const by = (n) => founders.find((f) => f.name === n);
  assert.equal(by('Jane Doe').telegramPriority, 'P1');
  assert.ok(by('Jane Doe').activities.some((a) => a.source === 'Telegram' && a.day === '2026-09-01'));
  assert.ok(by('Tom Nobody').issues.some((i) => i.type === 'Missing from Zoho'));
  assert.equal(by('Tom Nobody').verification, 'Not in Zoho');
  assert.ok(by('Asha Rao').issues.some((i) => i.type === 'In Zoho, not Founder Network' && i.severity === 'high'));
  assert.ok(by('Ezekiel').issues.some((i) => i.type === 'Needs a full name'));
  assert.equal(by('Ezekiel').priorityInfo.band, 'Needs review');
});

test('a contact tagged Founder_Network without the Relationship Type is surfaced as a fix', () => {
  const { founders } = E.run({ now: NOW, contacts: [zc('30', 'Nolan', 'Westbury', { Relationship_Type: null, Tag: 'Founder_Network' })] });
  assert.equal(founders.length, 1);
  assert.match(founders[0].issues[0].fix, /Set its Relationship Type to Founder Network/);
});

test('a match worked out at import is reused while the record exists, re-matched when it is gone', () => {
  const fn = [zc('40', 'Sharla', 'Quillfeather-Brandt')];
  const kept = E.run({ now: NOW, fn, tgPeople: [{ name: 'Sharla Quillfeather Brant', zoho_id: '40', zoho_by: 'Close match: spelling differs' }] });
  assert.equal(kept.founders.length, 1);
  assert.ok(kept.founders[0].identities.some((i) => i.source === 'Telegram' && i.confidence === 'possible'));
  assert.ok(kept.founders[0].issues.some((i) => i.type === 'Unverified identity'));
  const gone = E.run({ now: NOW, fn, tgPeople: [{ name: 'Sharla Quillfeather Brant', zoho_id: '999', zoho_by: 'Name' }] });
  assert.equal(gone.founders.length, 1, 'falls back to a live match against today’s Zoho');
});

test('status engine: target met, on track, at risk, below target, and missing data is stale, never zero', () => {
  const s = { ...E.DEFAULTS };
  const today = '2026-10-20'; // about 52% through Aug 17 – Dec 18
  const share = E.expectedShare(today, s);
  assert.ok(share > 0.5 && share < 0.55);
  assert.equal(E.metricStatus({ actual: 150, target: 150, today }, s).status, 'Completed');
  assert.equal(E.metricStatus({ actual: 78, target: 150, today }, s).status, 'On track');
  assert.equal(E.metricStatus({ actual: 60, target: 150, today }, s).status, 'At risk');
  assert.equal(E.metricStatus({ actual: 20, target: 150, today }, s).status, 'Below target');
  assert.equal(E.metricStatus({ actual: null, target: 150, today, missing: true }, s).status, 'Stale data');
  assert.equal(E.expectedShare('2026-08-01', s), 0);
  assert.equal(E.expectedShare('2027-01-01', s), 1);
});

test('source status: live data older than a day and imports older than two weeks are stale', () => {
  assert.equal(E.sourceStatus({ kind: 'live', state: 'ok', at: '2026-10-21T00:00:00Z' }, NOW).status, 'Stale data');
  assert.equal(E.sourceStatus({ kind: 'live', state: 'ok', at: '2026-10-23T12:00:00Z' }, NOW).status, 'Connected');
  assert.equal(E.sourceStatus({ kind: 'imported', state: 'ok', at: '2026-10-20T00:00:00Z' }, NOW).status, 'Imported');
  assert.equal(E.sourceStatus({ kind: 'imported', state: 'missing' }, NOW).status, 'Not configured');
  assert.equal(E.sourceStatus({ kind: 'live', state: 'error' }, NOW).status, 'Error');
});

const fixture = () => ({
  now: NOW,
  fn: [zc('50', 'Priya', 'Vandermolen', { Priority: '1' }), zc('51', 'Omar', 'Khan', { Priority: '3' }), zc('52', 'Lena', 'Ford', { Priority: '1' })],
  tasks: [
    { id: 't1', Who_Id_id: '50', Subject: 'Mack send referral agreement', Due_Date: '2026-10-20', Status: 'Not Started', Priority: 'Highest', Created_Time: '2026-10-10T10:00:00-05:00' },
    { id: 't2', Who_Id_id: '51', Subject: 'Check in', Due_Date: '2026-07-01', Status: 'Not Started', Priority: 'Normal', Created_Time: '2026-06-20T10:00:00-05:00' },
    { id: 't3', Who_Id_id: '52', Subject: 'Done thing', Due_Date: '2026-10-01', Status: 'Completed', Created_Time: '2026-09-20T10:00:00-05:00' },
  ],
  events: [
    { id: 'e1', Who_Id_id: '51', Event_Title: 'Coffee', Start_DateTime: '2026-10-24T09:00:00-05:00', Meeting_Status: 'Scheduled' },
    { id: 'e2', Who_Id_id: '52', Event_Title: 'Lunch', Start_DateTime: '2026-10-01T12:00:00-05:00', Meeting_Status: 'Scheduled' },
  ],
  ffMeetings: [{ id: 'ff1', date: '2026-09-15T15:00:00Z', title: 'Intro call', minutes: '30', summary: 'Talked', action_items: '\n**Mack Akhani**\nSend the deck to Priya (12:01)\n**Priya Vandermolen**\nShare her client list (14:00)', url: 'https://app.fireflies.ai/view/ff1' }],
  ffLinks: [{ person: '50', name: 'Priya Vandermolen', meeting: 'ff1', matched_by: 'their Zoho email' }],
  outlook: [{ key: '52', identity: 'same person', email_count: 4, first_email: '2026-08-20', last_email: '2026-09-01', two_way: true, meeting_count: 1, last_meeting: '2026-09-28' }],
  tgPeople: [{ name: 'Lena Ford', actions: ['put brunch on calendar'] }],
});

test('actions: overdue tasks, stale tasks, meeting prep, unconfirmed meetings, unlogged calendar meetings and reconnects', () => {
  const { founders } = E.run(fixture());
  const priya = founders.find((f) => f.zoho && f.zoho.id === '50');
  const omar = founders.find((f) => f.zoho && f.zoho.id === '51');
  const lena = founders.find((f) => f.zoho && f.zoho.id === '52');
  const t1 = priya.actions.find((a) => a.key === 'zoho-task:t1');
  assert.equal(t1.status, 'Overdue'); assert.equal(t1.overdueDays, 3); assert.equal(t1.owner, 'Mack');
  assert.equal(t1.statusLabel, 'Critical', 'an overdue Highest-priority task is critical');
  assert.equal(omar.actions.find((a) => a.key === 'zoho-task:t2').statusLabel, 'Below target', 'an overdue Normal task is below target, not critical');
  const t2 = omar.actions.find((a) => a.key === 'zoho-task:t2');
  assert.equal(t2.stale, true); assert.match(t2.next, /more than 45 days overdue/);
  const prep = omar.actions.find((a) => a.category === 'Prepare for a meeting');
  assert.equal(prep.status, 'Due soon'); assert.equal(prep.due, '2026-10-24');
  assert.ok(lena.actions.some((a) => a.category === 'Record a meeting outcome' && a.status === 'Overdue'));
  assert.ok(lena.actions.some((a) => a.category === 'Log a meeting in Zoho'));
  assert.equal(lena.actions.find((a) => a.key === 'zoho-task:t3').status, 'Done');
});

test('Fireflies action items become proposals for our team only, and Telegram asks need review', () => {
  const { founders } = E.run(fixture());
  const priya = founders.find((f) => f.zoho && f.zoho.id === '50');
  const ff = priya.actions.filter((a) => a.category === 'From a recorded call');
  assert.equal(ff.length, 1);
  assert.equal(ff[0].text, 'Send the deck to Priya'); assert.equal(ff[0].owner, 'Mack'); assert.equal(ff[0].kind, 'proposal');
  assert.equal(ff[0].statusLabel, 'Needs verification');
  const lena = founders.find((f) => f.zoho && f.zoho.id === '52');
  const tg = lena.actions.find((a) => a.category === 'From Telegram');
  assert.equal(tg.status, 'Needs review'); assert.equal(tg.owner, null, 'no owner is invented'); assert.equal(tg.due, null, 'no due date is invented');
});

test('priority engine: an overdue commitment makes a founder Urgent and every point has a reason', () => {
  const { founders } = E.run(fixture());
  for (const f of founders) {
    const sum = f.priorityInfo.reasons.reduce((t, r) => t + r.points, 0);
    assert.equal(sum, f.priorityInfo.score);
    for (const r of f.priorityInfo.reasons) assert.ok(r.why);
  }
  const priya = founders.find((f) => f.zoho && f.zoho.id === '50');
  assert.equal(priya.priorityInfo.band, 'Urgent');
  assert.match(priya.priorityInfo.urgentBecause, /referral agreement/);
});

test('a P1 with no interaction for 30+ days gets a reconnect action; one with a meeting booked does not', () => {
  const src = { now: NOW, fn: [zc('60', 'Ana', 'Lima', { Priority: '1' }), zc('61', 'Ben', 'Cole', { Priority: '1' })], events: [{ id: 'e9', Who_Id_id: '61', Event_Title: 'Call', Start_DateTime: '2026-10-30T10:00:00-05:00', Meeting_Status: 'Scheduled' }] };
  const { founders } = E.run(src);
  assert.ok(founders.find((f) => f.zoho.id === '60').actions.some((a) => a.category === 'Reconnect'));
  assert.ok(!founders.find((f) => f.zoho.id === '61').actions.some((a) => a.category === 'Reconnect'));
});

test('pipeline stages follow the evidence', () => {
  const { founders } = E.run({
    now: NOW,
    fn: [zc('70', 'A', 'One'), zc('71', 'B', 'Two', { Account_Name: 'Acme' }), zc('72', 'C', 'Three'), zc('73', 'D', 'Four'), zc('74', 'E', 'Five'), zc('75', 'F', 'Six', { DO_NOT_CONTACT: true })],
    events: [{ id: 'm1', Who_Id_id: '72', Start_DateTime: '2026-10-01T10:00:00-05:00', Meeting_Status: 'Completed' }, { id: 'm2', Who_Id_id: '73', Start_DateTime: '2026-11-01T10:00:00-05:00', Meeting_Status: 'Scheduled' }],
    deals: [{ id: 'd1', Contact_Name_id: '74', Deal_Name: 'Referral', Stage: 'Discovery', Created_Time: '2026-10-01T10:00:00-05:00' }],
  });
  const st = (id) => founders.find((f) => f.zoho.id === id).stage;
  assert.equal(st('70'), 'Identified');
  assert.equal(st('71'), 'Researched');
  assert.equal(st('72'), 'Relationship established');
  assert.equal(st('73'), 'Meeting booked');
  assert.equal(st('74'), 'Opportunity or referral');
  assert.equal(st('75'), 'Closed or nurture');
});

test('targets count from the data and show stale, not zero, when a source is missing', () => {
  const src = fixture();
  const model = E.run(src);
  const t = E.targets(model, src);
  assert.equal(t.find((x) => x.id === 'members').actual, 3);
  assert.equal(t.find((x) => x.id === 'meetings').actual, 2, 'Fireflies call for Priya and the Outlook meeting for Lena');
  const missing = E.targets(model, { ...src, missing: { deals: true } });
  assert.equal(missing.find((x) => x.id === 'closed').actual, null);
  assert.equal(missing.find((x) => x.id === 'closed').status, 'Stale data');
});

test('the engine works with no data at all', () => {
  const model = E.run({ now: NOW });
  assert.deepEqual(model.founders, []);
  assert.equal(E.targets(model, { missing: { fn: true } })[0].status, 'Stale data');
});

test('a count that started the period above zero is paced from where it started', () => {
  const today = '2026-10-20';
  const r = E.metricStatus({ actual: 300, target: 450, today, baseline: 250 });
  assert.equal(r.expected, 250 + Math.round(200 * E.expectedShare(today)));
  assert.equal(r.status, 'Below target', 'grew 50 of the ~105 expected since Aug 17');
  assert.equal(E.metricStatus({ actual: 360, target: 450, today, baseline: 250 }).status, 'On track');
});

test('a months-old unrecorded meeting is a fix, not an emergency; old call action items stay on the timeline', () => {
  const { founders } = E.run({
    now: NOW,
    fn: [zc('80', 'Gita', 'Rao', { Priority: '5' })],
    events: [{ id: 'old', Who_Id_id: '80', Event_Title: 'Lunch', Start_DateTime: '2026-04-30T09:00:00-05:00', Meeting_Status: 'Scheduled' }],
    ffMeetings: [
      { id: 'ffold', date: '2025-11-01T15:00:00Z', title: 'Old call', action_items: '\n**Mack Akhani**\n- Send the old deck (01:00)', url: 'https://app.fireflies.ai/view/ffold' },
      { id: 'ffnew', date: '2026-10-01T15:00:00Z', title: 'New call', action_items: '\n**Mack Akhani**\n- Send the new deck (01:00)', url: 'https://app.fireflies.ai/view/ffnew' },
    ],
    ffLinks: [{ person: '80', meeting: 'ffold', matched_by: 'their Zoho email' }, { person: '80', meeting: 'ffnew', matched_by: 'their Zoho email' }],
  });
  const f = founders[0];
  const outcome = f.actions.find((a) => a.category === 'Record a meeting outcome');
  assert.equal(outcome.stale, true);
  assert.equal(outcome.statusLabel, 'Below target');
  assert.notEqual(f.priorityInfo.band, 'Urgent');
  const ff = f.actions.filter((a) => a.category === 'From a recorded call').map((a) => a.text);
  assert.deepEqual(ff, ['Send the new deck']);
});

test('review fixes: identity', () => {
  const idx = E.zohoIndex([zc('1', 'Jane', 'Doe', { LinkedIn: 'https://www.linkedin.com/in/jane-doe-ny/' }), zc('2', 'Corwin', 'Ashdown'), zc('3', 'Corwin', 'Ashdown')]);
  assert.equal(E.matchPerson({ key: 'a', name: 'Jane Doe', linkedin: 'https://www.linkedin.com/in/jane-doe-london/' }, idx), null, 'different LinkedIn profiles are different people');
  assert.equal(E.matchPerson({ key: 'b', name: 'Corwin Ashdown' }, idx).confidence, 'possible', 'a name shared by two Zoho records needs review');
  assert.equal(E.slugOf('javascript:alert(1)//linkedin.com/in/x'), null);
  const { founders } = E.run({
    now: NOW,
    contacts: [zc('9', 'Michael', 'Johnson', { Relationship_Type: 'Client' })],
    tgPeople: [{ name: 'Tobias Grell' }, { name: 'Tobias Grell' }, { name: 'Michael Johnson', zoho_id: '9', zoho_by: 'Name' }, { name: 'Mike Johnson', zoho_id: '9', zoho_by: 'Nickname' }, { name: '' }, { name: 'Ravi Thornquist', priority: 1 }],
  });
  assert.equal(founders.filter((f) => f.name === 'Tobias Grell').length, 2, 'two chat people with one name stay two');
  assert.equal(founders.filter((f) => f.zoho && f.zoho.id === '9').length, 1, 'one Zoho record, one founder');
  assert.equal(founders.find((f) => f.zoho && f.zoho.id === '9').id, 'z:9');
  assert.ok(founders.find((f) => f.zoho && f.zoho.id === '9').identities.some((i) => i.record === 'Mike Johnson' && i.confidence === 'possible'), 'an unknown import method needs review');
  assert.equal(founders.find((f) => f.name === 'Ravi Thornquist').telegramPriority, 'P1', 'a numeric chat priority is read, not crashed on');
  assert.ok(!founders.some((f) => !f.name), 'rows with no name are skipped');
});

test('review fixes: actions and priority', () => {
  const { founders } = E.run({
    now: NOW,
    fn: [zc('90', 'Priya', 'Vandermolen', { Priority: '1' }), zc('91', 'Ana', 'Lima', { Priority: '9' })],
    tasks: [{ id: 'td', Who_Id_id: '90', Subject: 'Parked', Due_Date: '2026-10-20', Status: 'Deferred', Priority: 'Highest', Created_Time: '2026-10-01T10:00:00-05:00' }],
    events: [{ id: 'today', Who_Id_id: '90', Start_DateTime: '2026-10-23T08:00:00-05:00', Meeting_Status: 'Completed' }, { id: 'old', Who_Id_id: '91', Start_DateTime: '2026-09-23T08:00:00-05:00', Meeting_Status: 'Completed' }],
    ffMeetings: [{ id: 'c1', date: '2026-10-10T15:00:00Z', title: 'Call', action_items: '\n**Priya**\n- Share her client list\n**Mack Akhani**\n- Send the deck', url: 'https://app.fireflies.ai/view/c1' }],
    ffLinks: [{ person: '90', meeting: 'c1', matched_by: 'their Zoho email' }],
  });
  const priya = founders.find((f) => f.zoho.id === '90');
  assert.ok(!priya.actions.some((a) => a.key === 'zoho-task:td'), 'deferred tasks are not actions');
  assert.equal(priya.upcoming, null, 'a meeting completed this morning is not upcoming');
  assert.ok(!priya.actions.some((a) => a.category === 'Prepare for a meeting'));
  assert.deepEqual(priya.actions.filter((a) => a.category === 'From a recorded call').map((a) => a.text), ['Send the deck'], 'the founder’s own items are not given to a teammate who shares her first name');
  const ana = founders.find((f) => f.zoho.id === '91');
  assert.ok(!ana.priorityInfo.reasons.some((r) => r.factor === 'recency'), 'recency points are for Priority 1 and 3 only');
  const thirty = E.run({ now: NOW, fn: [zc('92', 'Ben', 'Cole', { Priority: '1' })], events: [{ id: 'm', Who_Id_id: '92', Start_DateTime: '2026-09-23T10:00:00-05:00', Meeting_Status: 'Completed' }] });
  assert.ok(thirty.founders[0].actions.some((a) => a.category === 'Reconnect'), 'quiet for exactly 30 days asks to reconnect');
});

test('review fixes: early-period pacing and imports with no date', () => {
  assert.equal(E.metricStatus({ actual: 0, target: 150, today: '2026-08-18' }).status, 'At risk');
  assert.equal(E.sourceStatus({ kind: 'imported', state: 'ok', at: null }, NOW).status, 'Needs verification');
});

test('outreach: who is suggested, who is left out, and why', () => {
  const src = {
    now: NOW,
    fn: [
      zc('a1', 'Hollis', 'Marrow', { Priority: '1', Account_Name: 'Marrow Labs LLC' }),
      zc('a2', 'Ines', 'Vale', { Priority: '1' }),
      zc('a3', 'Jory', 'Pell', { Priority: '1', DO_NOT_CONTACT: true }),
      zc('a4', 'Kit', 'Arden', { Priority: '1', Relationship_Type: 'Founder Network, Client' }),
      zc('a5', 'Lux', 'Fenn', { Priority: '3' }),
      zc('a6', 'Mae', 'Corr', { Priority: '1' }),
      zc('a7', 'Nils', 'Brae', { Priority: '1' }),
      zc('a8', 'Oda', 'Quist', { Priority: '5' }),
    ],
    events: [{ id: 'e', Who_Id_id: 'a2', Start_DateTime: '2026-09-01T10:00:00-05:00', Meeting_Status: 'Completed' }],
    tasks: [{ id: 't', Who_Id_id: 'a5', Subject: 'Call', Due_Date: '2026-11-01', Status: 'Not Started', Created_Time: '2026-10-01T10:00:00-05:00' }],
    tgPeople: [{ name: 'Mae Corr', zoho_id: 'a6', zoho_by: 'Name', relationship: ['Mack had lunch with her in September'] }],
    outlook: [{ key: 'a8', identity: 'same person', email_count: 3, first_email: '2026-05-01', last_email: '2026-06-10', two_way: true, meeting_count: 0 }],
    linkedin: [{ first: 'Hollis', last: 'Marrow', url: 'https://www.linkedin.com/in/hollis-marrow', connected: '2016-04-02', ties: ['They endorsed Mack'] }],
  };
  const model = E.run(src);
  const list = E.outreach(model, E.DEFAULTS, [{ zoho_id: 'a7', verdict: 'skip', why: 'Family' }]);
  const ids = list.map((c) => c.f.zoho.id);
  assert.deepEqual(ids.slice().sort(), ['a1', 'a8']);
  assert.equal(ids[0], 'a1', 'Priority 1 and connected on LinkedIn ranks first');
  assert.ok(list.leftOut.some((x) => x.f.zoho.id === 'a6' && x.by === 'rule'), 'a Telegram lunch counts as already talking');
  assert.ok(list.leftOut.some((x) => x.f.zoho.id === 'a7' && x.why === 'Family'));
  const hollis = list.find((c) => c.f.zoho.id === 'a1');
  assert.equal(hollis.draft.channel, 'LinkedIn message');
  assert.match(hollis.draft.body, /^Hi Hollis, I hope all is well at Marrow Labs\. Thank you again for the endorsement\./);
  const oda = list.find((c) => c.f.zoho.id === 'a8');
  assert.equal(oda.draft.channel, 'Email');
  assert.match(oda.draft.body, /traded emails back in Jun 2026/);
  assert.ok(!/@/.test(oda.draft.body), 'no address or earlier mail content in the draft');
});

test('outreach: hand-written drafts win, connection notes stay under 300 characters, recent email waits', () => {
  const src = { now: NOW, fn: [zc('b1', 'Pia', 'Sorel', { Priority: '1' }), zc('b2', 'Quin', 'Tarrant-Whitlock', { Priority: '1', Account_Name: 'A Very Long Company Name For Testing Purposes Holdings International' }), zc('b3', 'Rue', 'Ambler', { Priority: '1' })],
    outlook: [{ key: 'b3', identity: 'same person', email_count: 1, last_email: '2026-10-20', two_way: false }] };
  const list = E.outreach(E.run(src), E.DEFAULTS, [{ zoho_id: 'b1', verdict: 'reach', why: 'Asked to catch up after her trip', channel: 'Text message', body: 'Hi Pia, welcome back.' }]);
  const pia = list.find((c) => c.f.zoho.id === 'b1');
  assert.equal(pia.draft.body, 'Hi Pia, welcome back.'); assert.equal(pia.draft.channel, 'Text message'); assert.equal(pia.reviewed, true);
  const quin = list.find((c) => c.f.zoho.id === 'b2');
  assert.equal(quin.draft.channel, 'LinkedIn connection note'); assert.ok(quin.draft.body.length <= 300);
  assert.ok(!list.some((c) => c.f.zoho.id === 'b3'), 'emailed three days ago: not suggested again yet');
});

test('every target count is the length of the list it opens', () => {
  const src = fixture();
  const model = E.run(src);
  for (const t of E.targets(model, src)) assert.equal(t.actual, t.rows.length, t.id);
  const meetings = E.targets(model, src).find((t) => t.id === 'meetings').rows;
  assert.ok(meetings.every((r) => r.f && r.day && r.sources.length));
});

test('urgent actions are exactly what makes a founder Urgent', () => {
  const { founders } = E.run(fixture());
  for (const f of founders) assert.equal(f.priorityInfo.band === 'Urgent', f.actions.some(E.isUrgentAction), f.name);
});

test('a B2B campaign contact named in the Founder Network chat is not a data issue', () => {
  const { founders } = E.run({ now: NOW, contacts: [zc('c1', 'Wren', 'Halloway', { Relationship_Type: 'Referral Partner', Tag: 'May 2026 - 100 B2B' }), zc('c2', 'Yuri', 'Banfield', { Relationship_Type: null, Tag: '' })], tgPeople: [{ name: 'Wren Halloway' }, { name: 'Yuri Banfield' }] });
  const wren = founders.find((f) => f.name === 'Wren Halloway');
  assert.ok(!wren.issues.some((i) => i.type === 'In Zoho, not Founder Network'));
  assert.equal(wren.verification, 'In the B2B campaign');
  assert.ok(founders.find((f) => f.name === 'Yuri Banfield').issues.some((i) => i.type === 'In Zoho, not Founder Network'), 'outside any campaign it is still flagged');
});

test('anyone tagged for the B2B campaign is left out of the tab and the scorecard', () => {
  const src = { now: NOW, fn: [zc('d1', 'Odile', 'Brannock', { Priority: '1' }), zc('d2', 'Pell', 'Ivers', { Priority: '1', Tag: 'May 2026 - 100 B2B, Founder_Network' })],
    deals: [{ id: 'w1', Contact_Name_id: 'd2', Deal_Name: 'Referral', Stage: 'Closed', Created_Time: '2026-09-01T10:00:00-05:00' }] };
  const model = E.run(src);
  const shown = model.founders.filter((f) => E.isShown(f)).map((f) => f.zoho.id);
  assert.deepEqual(shown, ['d1']);
  const t = E.targets(model, src);
  assert.equal(t.find((x) => x.id === 'members').actual, 1);
  assert.equal(t.find((x) => x.id === 'closed').actual, 0, 'a B2B partner’s closed deal counts on B2B, not here');
});
