// Tests for artifact/notes-engine.js. Synthetic fixtures only: no real Zoho note text, names or contact ids.
// The fixtures copy the shapes seen in the real data (a body date that disagrees with the filing time, two notes on one
// contact from the same day, a clause that is both theirs and ours, a note with no Next: clause).
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.fetch = () => { throw new Error('the engine must not call the network'); };
const N = require('../artifact/notes-engine.js');

const TODAY = '2026-11-20';
const note = (id, contact, body, filed, title) => ({
  id, Parent_Id_id: contact, Note_Content: body, Created_Time: filed,
  Note_Title: title === undefined ? 'Conversation note: Testperson Alpha' : title,
});

test('only the bot’s Conversation note: notes are read, whatever created them', () => {
  assert.equal(N.isBotNote({ Note_Title: 'Conversation note: Someone' }), true);
  assert.equal(N.isBotNote({ Note_Title: '  conversation NOTE: Someone' }), true, 'case and leading space do not matter');
  assert.equal(N.isBotNote({ Note_Title: 'LinkedIn DM: Someone (2026-09-07 to 2026-10-21) [abc]' }), false);
  assert.equal(N.isBotNote({ Note_Title: '30-Min Meeting with Someone' }), false);
  assert.equal(N.isBotNote({ Note_Title: null }), false, 'an untitled note is not the bot’s');
  assert.equal(N.isBotNote({}), false);
});

test('the conversation date comes from the body, not the filing time, and says which it used', () => {
  // Seen in the real data: a note filed on the 18th whose body describes the 19th.
  assert.deepEqual(N.conversationDate('Nov 19, 2026: they wrote.', '2026-11-18T17:46:30-06:00'), { on: '2026-11-19', src: 'body' });
  assert.deepEqual(N.conversationDate('Sept 3, 2026 - a call happened.', '2026-09-04T10:00:00-05:00'), { on: '2026-09-03', src: 'body' });
  assert.deepEqual(N.conversationDate('3rd Nov 2026: no leading month.', '2026-11-04T10:00:00-06:00'), { on: '2026-11-04', src: 'filed' });
});

test('an impossible body date falls back to the filing day rather than inventing one', () => {
  assert.deepEqual(N.conversationDate('Feb 31, 2026: a typo.', '2026-03-01T10:00:00-06:00'), { on: '2026-03-01', src: 'filed' });
  assert.deepEqual(N.conversationDate('Nov 18, 1026: a typo.', '2026-11-19T10:00:00-06:00'), { on: '2026-11-19', src: 'filed' });
  assert.deepEqual(N.conversationDate('no date at all', null), { on: null, src: null });
});

test('the filing time is read as a Central-time day, so a late-evening note keeps its own date', () => {
  // 23:30 CT on the 19th is already the 20th in UTC; the day must not slide.
  assert.equal(N.conversationDate('no date here', '2026-11-19T23:30:00-06:00').on, '2026-11-19');
});

test('the Next: clause is split out and its absence is normal', () => {
  assert.equal(N.nextClause('Nov 18, 2026: things happened. Next: We owe them a reply'), 'We owe them a reply');
  assert.equal(N.nextClause('Nov 18, 2026: things happened.\nNext:   We owe them\n  a reply  '), 'We owe them a reply');
  assert.equal(N.nextClause('Nov 18, 2026: a screenshot that was not a conversation.'), null);
  assert.equal(N.nextClause(''), null);
});

test('whose move it is: ours when we owe something, even where the clause opens on waiting for them', () => {
  assert.equal(N.directionOf('We owe them a time and place for the morning meeting. They are waiting on us.'), 'ours');
  assert.equal(N.directionOf('Waiting on them to review the file and judge fit.'), 'theirs');
  // The real shape that matters: both sides in one clause. There is work for us, so it is ours.
  assert.equal(N.directionOf('Waiting on them to review the file. We owe further examples after the call.'), 'ours');
  assert.equal(N.directionOf('Waiting on us to send the agreement.'), 'ours', 'waiting on us is ours');
  assert.equal(N.directionOf('They will come back with a date.'), 'theirs');
  assert.equal(N.directionOf(''), null);
});

test('a clause pinned to a moment is recognized without guessing what moment', () => {
  assert.equal(N.isTimeBound('We owe the cancellation of today’s 10:30 am meeting'), true);
  assert.equal(N.isTimeBound('We owe examples after the Friday call'), true);
  assert.equal(N.isTimeBound('We need to finish our reply about tomorrow night'), true);
  assert.equal(N.isTimeBound('We owe them a set of case studies'), false);
});

test('priority: ours and someone waiting on us is urgent on day one', () => {
  const item = { on: TODAY, next: 'We owe them a time and place. They are waiting on us.', direction: 'ours', timeBound: false };
  const p = N.priorityOf(item, TODAY);
  assert.equal(p.priority, 'urgent');
  assert.equal(p.age, 0);
  assert.match(p.reasons.join(' | '), /waiting on us/);
});

test('priority: a moment-pinned clause is urgent once the note is a day old, not on the day itself', () => {
  const mk = (on) => ({ on, next: 'We owe the cancellation of today’s 10:30 am meeting', direction: 'ours', timeBound: true });
  assert.equal(N.priorityOf(mk(TODAY), TODAY).priority, 'soon', 'raised today: the moment may still be ahead');
  const past = N.priorityOf(mk('2026-11-19'), TODAY);
  assert.equal(past.priority, 'urgent');
  assert.match(past.reasons.join(' | '), /that moment has passed/);
});

test('priority: age alone is never red, it is the backlog', () => {
  // Corrected against the real corpus: age-alone red was 55 of 74 reds, and a red that never clears itself is noise.
  const mk = (on) => ({ on, next: 'We owe them a set of case studies', direction: 'ours', timeBound: false });
  assert.equal(N.priorityOf(mk('2026-11-14'), TODAY).priority, 'soon', 'six days is this week\u2019s work');
  const old = N.priorityOf(mk('2026-11-13'), TODAY);
  assert.equal(old.priority, 'backlog', 'seven days drops out of Soon, it does not become red');
  assert.match(old.reasons.join(' | '), /nothing says anyone is waiting/);
});

test('priority: an explicit signal is red at any age, and still says how old it is', () => {
  const waiting = N.priorityOf({ on: '2026-09-20', next: 'We owe them a reply. They are waiting on us.', direction: 'ours', timeBound: false }, TODAY);
  assert.equal(waiting.priority, 'urgent', 'an old item someone is waiting on is still urgent');
  assert.match(waiting.reasons.join(' | '), /waiting on us/);
  assert.match(waiting.reasons.join(' | '), /Open 61 days/);
  assert.equal(waiting.stale, true);
});

test('priority: their move is Watching, and becomes ours to chase after chaseDays', () => {
  const mk = (on) => ({ on, next: 'Waiting on them to review the file.', direction: 'theirs', timeBound: false });
  const fresh = N.priorityOf(mk('2026-11-18'), TODAY);
  assert.equal(fresh.priority, 'watch');
  assert.match(fresh.reasons.join(' '), /Their move, 2 days ago/);
  const old = N.priorityOf(mk('2026-11-05'), TODAY);
  assert.equal(old.priority, 'backlog', 'chaseDays is longer than urgentDays, so a promoted item is already old');
  assert.match(old.reasons.join(' '), /the chase is ours now/);
});

test('priority: past staleDays an item is flagged stale and says to close it or raise it again', () => {
  const p = N.priorityOf({ on: '2026-09-01', next: 'We owe them a reply', direction: 'ours', timeBound: false }, TODAY);
  assert.equal(p.stale, true);
  assert.equal(p.priority, 'backlog');
  assert.match(p.reasons.join(' | '), /close it or raise it again/);
});

test('every priority carries the reasons it landed on, never an empty list', () => {
  for (const dir of ['ours', 'theirs']) {
    for (const on of [TODAY, '2026-11-10', '2026-08-01']) {
      const p = N.priorityOf({ on, next: 'We owe them something', direction: dir, timeBound: false }, TODAY);
      assert.ok(p.reasons.length > 0, `${dir} ${on} has no reason`);
      assert.ok(N.PRIORITY[p.priority], `${dir} ${on} has an unknown priority`);
    }
  }
});

test('a parsed note keeps the narrative without repeating the action under it', () => {
  const p = N.parseNote(note('1', '77', 'Nov 18, 2026: they asked for a date. Next: We owe them a date', '2026-11-18T08:00:00-06:00'));
  assert.equal(p.story, 'Nov 18, 2026: they asked for a date.');
  assert.equal(p.next, 'We owe them a date');
  assert.equal(p.person, 'Testperson Alpha');
  assert.equal(p.on, '2026-11-18');
  assert.equal(p.contactId, '77');
});

test('a contact’s timeline is newest conversation first, and two notes from one day keep the bot’s order', () => {
  const rows = [
    note('a', '77', 'Nov 5, 2026: older. Next: We owe A', '2026-11-05T08:00:00-06:00'),
    note('b', '77', 'Nov 18, 2026: the first of two. Next: We owe B', '2026-11-18T08:00:51-06:00'),
    note('c', '77', 'Nov 18, 2026: the second of two. Next: We owe C', '2026-11-18T08:00:52-06:00'),
    note('d', '88', 'Nov 19, 2026: another person. Next: We owe D', '2026-11-19T08:00:00-06:00'),
    { id: 'e', Parent_Id_id: '77', Note_Title: 'LinkedIn DM: Testperson Alpha', Note_Content: 'verbatim', Created_Time: '2026-11-19T08:00:00-06:00' },
  ];
  const t = N.timelineFor(rows, '77');
  assert.deepEqual(t.map((x) => x.id), ['c', 'b', 'a'], 'later filing first within a shared day; the DM note is not read');
  assert.deepEqual(N.timelineFor(rows, '88').map((x) => x.id), ['d']);
  assert.deepEqual(N.timelineFor(rows, null), []);
  assert.deepEqual(N.timelineFor(rows, '99'), []);
});

test('action items: a later note supersedes an older clause, and two notes from one day both stand', () => {
  const rows = [
    note('a', '77', 'Nov 5, 2026: older. Next: We owe the old thing', '2026-11-05T08:00:00-06:00'),
    note('b', '77', 'Nov 18, 2026: one. Next: We owe them a time and place', '2026-11-18T08:00:51-06:00'),
    note('c', '77', 'Nov 18, 2026: two. Next: We need to finish our reply', '2026-11-18T08:00:52-06:00'),
  ];
  const items = N.actionItems(rows, { today: TODAY });
  assert.deepEqual(items.map((i) => i.id).sort(), ['b', 'c']);
  assert.ok(!items.some((i) => i.next.includes('old thing')), 'the superseded clause is history, not work');
});

test('action items: a note with no Next: clause produces none, and neither does a note with no contact', () => {
  const rows = [
    note('a', '77', 'Nov 18, 2026: a screenshot, nothing to do.', '2026-11-18T08:00:00-06:00'),
    note('b', null, 'Nov 18, 2026: orphaned. Next: We owe something', '2026-11-18T08:00:00-06:00'),
  ];
  assert.deepEqual(N.actionItems(rows, { today: TODAY }), []);
});

test('action items sort urgent first, then soon, then the backlog, with fresh before stale inside each', () => {
  const rows = [
    note('watch', '1', 'Nov 19, 2026: a. Next: Waiting on them to reply', '2026-11-19T08:00:00-06:00'),
    note('soon', '2', 'Nov 19, 2026: b. Next: We owe them a set of examples', '2026-11-19T08:00:00-06:00'),
    note('urgent', '3', 'Nov 10, 2026: c. Next: We owe them a reply. They are waiting on us.', '2026-11-10T08:00:00-06:00'),
    note('backlog', '4', 'Nov 1, 2026: d. Next: We owe them a reply', '2026-11-01T08:00:00-06:00'),
    note('stale', '5', 'Sep 1, 2026: e. Next: We owe them a reply', '2026-09-01T08:00:00-06:00'),
  ];
  const items = N.actionItems(rows, { today: TODAY });
  assert.deepEqual(items.map((i) => i.id), ['urgent', 'soon', 'backlog', 'stale', 'watch']);
  assert.equal(items[2].stale, false);
  assert.equal(items[3].stale, true, 'stale keeps its priority but sorts behind fresh inside the same band');
});

test('a Zoho task is matched to the clause it covers, and only on the same contact', () => {
  const item = { contactId: '77', next: 'We owe them the signed referral agreement' };
  const tasks = [
    { Who_Id_id: '88', Subject: 'Send the signed referral agreement' },
    { Who_Id_id: '77', Subject: 'Send the signed referral agreement' },
  ];
  assert.equal(N.taskFor(item, tasks).Who_Id_id, '77');
  assert.equal(N.taskFor(item, []), null);
  assert.equal(N.taskFor({ contactId: '77', next: 'We owe them a reply' }, [{ Who_Id_id: '77', Subject: 'Book flights to Dallas' }]), null);
});

test('sameWork needs real overlap, not a shared word', () => {
  assert.equal(N.sameWork('Send the signed referral agreement', 'We owe them the signed referral agreement'), true);
  assert.equal(N.sameWork('Call them', 'We owe them a call'), false, 'too short to judge');
  assert.equal(N.sameWork('Book the flights to Dallas for the team', 'We owe them a set of case studies'), false);
});

test('the summary separates today\u2019s work from the backlog', () => {
  const rows = [
    note('a', '1', 'Nov 19, 2026: a. Next: We owe them a reply. They are waiting on us.', '2026-11-19T08:00:00-06:00'),
    note('b', '2', 'Nov 19, 2026: b. Next: We owe them a set of examples', '2026-11-19T08:00:00-06:00'),
    note('c', '3', 'Nov 19, 2026: c. Next: Waiting on them to reply', '2026-11-19T08:00:00-06:00'),
    note('d', '4', 'Sep 1, 2026: d. Next: We owe them a reply', '2026-09-01T08:00:00-06:00'),
  ];
  const s = N.summary(N.actionItems(rows, { today: TODAY }));
  assert.equal(s.urgent, 1);
  assert.equal(s.soon, 1);
  assert.equal(s.backlog, 1);
  assert.equal(s.watch, 1);
  assert.equal(s.act, 2, 'needs action is urgent plus soon, never the backlog');
  assert.equal(s.stale, 1);
  assert.equal(s.people, 4);
  assert.equal(s.ours, 3, 'the watching item is not ours');
});

test('the engine never mutates the rows it is given', () => {
  const rows = [note('a', '77', 'Nov 18, 2026: a. Next: We owe something', '2026-11-18T08:00:00-06:00')];
  const before = JSON.stringify(rows);
  N.actionItems(rows, { today: TODAY });
  N.timelineFor(rows, '77');
  assert.equal(JSON.stringify(rows), before);
});
