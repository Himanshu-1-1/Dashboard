/* Conversation-note engine (Hemang, Nov 20, 2026): turns the Chief of Staff bot's Zoho notes into a dated timeline per
   contact and a list of action items with a derived priority. Pure functions over rows the dashboard has already loaded,
   so the same code runs in the page (window.CC_NOTES) and in Node tests (module.exports). Nothing here calls a network
   or writes anywhere. Dates are compared as Central-time days.

   Only the bot's `Conversation note:` notes reach the dashboard (Hemang's decision, Nov 20, 2026). Zoho holds ~1,500
   contact notes but the other ~1,000 are `LinkedIn DM:` verbatim threads, Fireflies notes carrying raw addresses, and
   personal items; every note is created by the same shared Transpire login, so the title prefix is the only thing that
   tells them apart and `isBotNote` is the whole containment boundary. */
(function (root) {
  'use strict';

  const DEFAULTS = {
    tz: 'America/Chicago',
    titlePrefix: 'conversation note:',
    /* Ours and open this long is red whatever it says: a week is how long a partner waits before it costs us. */
    urgentDays: 7,
    /* Waiting on them stops being their move at some point; past this the chase is ours. */
    chaseDays: 10,
    /* Older than this is listed and counted separately, never mixed into this week's work. */
    staleDays: 45,
    /* Our own people, for the one case where the bot files a note about a teammate. */
    team: ['Mack', 'Hemang', 'Shruti', 'Vansh', 'Himanshu', 'Harsh', 'Pulkit', 'Bilal', 'Sajeed'],
  };

  const PRIORITY = {
    urgent: { key: 'urgent', label: 'Urgent', tone: 'bad', rank: 0, why: 'Ours, and the note says they are waiting on us or the moment it names has passed' },
    soon: { key: 'soon', label: 'Soon', tone: 'warn', rank: 1, why: 'Ours to move, raised this week' },
    backlog: { key: 'backlog', label: 'Backlog', tone: 'muted', rank: 2, why: 'Ours, older than a week, with nothing saying anyone is waiting' },
    watch: { key: 'watch', label: 'Watching', tone: 'muted', rank: 3, why: 'Their move; nothing for us to do yet' },
  };

  const str = (v) => (v == null ? '' : String(v));
  const squash = (s) => str(s).replace(/\s+/g, ' ').trim();
  const ctDay = (iso, tz) => {
    if (!iso) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str(iso))) return str(iso);
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: tz || DEFAULTS.tz });
  };
  const dayMs = (d) => (d ? Date.parse(d + 'T00:00:00Z') : NaN);
  const daysBetween = (from, to) => {
    const a = dayMs(from); const b = dayMs(to);
    return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 864e5);
  };

  /* ---------- which notes are ours to read ---------- */
  const isBotNote = (r, settings) => str(r && r.Note_Title).trim().toLowerCase()
    .startsWith((settings || DEFAULTS).titlePrefix);

  /* ---------- when the conversation happened ---------- */
  /* The body opens "Nov 18, 2026: ..." which is the day the exchange happened. `Created_Time` is when the bot filed the
     note, and the two differ by hours or a day in either direction (one note filed Nov 18 at 17:46 describes Nov 19).
     Sorting on the filing time orders notes by when the bot got to them rather than by when things happened, so the
     body's own date wins wherever it parses and the filing time is the fallback. `src` says which was used, because a
     date the page asserts has to be checkable. */
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const DATE_RE = /^\s*([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\s*[:\-–]/;
  function conversationDate(text, createdTime, settings) {
    const filed = ctDay(createdTime, (settings || DEFAULTS).tz);
    const m = DATE_RE.exec(str(text));
    if (m) {
      const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
      const day = Number(m[2]); const year = Number(m[3]);
      if (mon && day >= 1 && day <= 31 && year >= 2000 && year <= 2100) {
        const iso = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        /* A parsed date only wins if it is a real calendar day: "Feb 31, 2026" is a typo, not a date. */
        const d = new Date(iso + 'T00:00:00Z');
        if (!Number.isNaN(d.getTime()) && d.getUTCDate() === day && d.getUTCMonth() + 1 === mon) return { on: iso, src: 'body' };
      }
    }
    return { on: filed, src: filed ? 'filed' : null };
  }

  /* ---------- the Next: clause ---------- */
  /* The bot ends a note with "Next: ..." and writes it about the contact and for us ("We owe Greg a time and place").
     A note describing a screenshot that was not a conversation carries none, so its absence is normal, never an error. */
  const NEXT_RE = /(?:^|\n|\.\s+)Next:\s*([\s\S]+)$/;
  /* Separate from NEXT_RE on purpose: that one consumes the ". " before the clause, so using it to strip the clause
     off the narrative takes the sentence's full stop with it and the timeline entry ends mid-air. */
  const STRIP_RE = /(?:^|\n+|[ \t]+)Next:\s*[\s\S]+$/;
  const nextClause = (text) => {
    const m = NEXT_RE.exec(str(text).trim());
    return m ? squash(m[1]) : null;
  };

  /* ---------- whose move it is ---------- */
  /* Ours wherever the clause says we owe or need something, even when it opens with "Waiting on ...": the Cesar note
     reads "Waiting on Cesar to review the PDF ... We owe further case studies", and there is work for us in it. Only a
     clause that is purely about their move is theirs. "Waiting on us" is ours however it is phrased. */
  const OURS_RE = /\b(we|our side|i)\s+(owe|need|must|should|have to|still|will|owe them)\b|\bwe\s+\w+\s+(to send|to reply|to confirm)\b|\bno reply (to|from us)\b|\bour move\b|\bwaiting on (us|our side|the team)\b/i;
  const THEIRS_RE = /^\s*(waiting|pending|they|he|she|it)\b|\bwaiting (on|for)\b/i;
  /* Some clauses say outright that we owe nothing ("Friday booking made by them, nothing owed"), and the first cut
     still read them as ours and then called one of them Urgent for naming a weekday -- a list that tells you to act on
     something whose own text says nothing is owed is how a panel loses its reader. "Nothing owed by him" is the
     opposite statement and must not be caught: it means the ball is with us. */
  const NOTHING_BY_US = /\bnothing (?:is )?(?:owed|owing|outstanding|needed|required|to do|pending)\b|\bno (?:reply|action|response) (?:is )?(?:needed|required)\b|\bnothing on us\b/i;
  const NOTHING_BY_THEM = /\bnothing (?:is )?(?:owed|owing|outstanding|pending)\s+by\s+(?!us\b|our\b|the team\b)/i;
  function directionOf(next) {
    const t = squash(next);
    if (!t) return null;
    if (NOTHING_BY_US.test(t) && !NOTHING_BY_THEM.test(t)) return 'theirs';
    if (OURS_RE.test(t)) return 'ours';
    if (THEIRS_RE.test(t)) return 'theirs';
    return 'ours';
  }

  /* ---------- is the clause pinned to a moment ---------- */
  /* Clauses like "the cancellation of today's 10:30 am CT meeting" or "finish our reply about tomorrow night" name a
     moment relative to the note's own day. The engine does not try to resolve them into a timestamp -- "Friday" from a
     Wednesday note is this Friday, from a Saturday note it is next Friday, and guessing wrong would date the work
     wrongly. It only records that the clause is pinned to a moment, which with the note's age is enough: a clause about
     today or tomorrow, read a day or more later, has passed. */
  const WHEN_RE = /\b(today|tonight|tomorrow|this (?:morning|afternoon|evening)|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\bby\s+(?:end of|close of)\b/i;
  const isTimeBound = (next) => WHEN_RE.test(squash(next));

  /* ---------- the derived priority ---------- */
  /* Nothing in a Zoho note carries a priority, so this is worked out from what the clause says and how old it is, and
     every item carries the reasons it landed where it did -- a wrong call has to be visible rather than plausible.

     Red means an explicit signal, never age alone (corrected Nov 20, 2026 against the real corpus). The first cut made
     anything of ours open a week red, and on the live data that was 74 of 178 items red, of which only 9 said anyone was
     waiting on us and 12 named a moment that had passed: 55 were red for being old. 140 of the 178 are 14 days or more
     old, so the honest shape of this data is a backlog, not an emergency, and a red that never clears itself is the
     "same reds every day" that Mack rejected on the partner-deals section on Nov 12. So age moves an item of ours out of
     Soon and into Backlog -- counted, listed, filterable, and not shouting. */
  function priorityOf(item, today, settings) {
    const s = settings || DEFAULTS;
    const age = item.on ? daysBetween(item.on, today) : null;
    const reasons = [];
    const stale = age != null && age > s.staleDays;
    const old = age != null && age >= s.urgentDays;
    if (item.direction === 'theirs') {
      if (age != null && age >= s.chaseDays) {
        reasons.push(`Their move ${age} days ago and nothing since, so the chase is ours now`);
        if (stale) reasons.push(`Older than ${s.staleDays} days: close it or raise it again`);
        /* chaseDays is longer than urgentDays, so a promoted item is always already in the backlog by age. */
        return { priority: 'backlog', reasons, age, stale };
      }
      reasons.push(age == null ? 'Their move' : `Their move, ${age} ${age === 1 ? 'day' : 'days'} ago`);
      return { priority: 'watch', reasons, age, stale };
    }
    let urgent = false;
    if (/\bwaiting on (us|our side|the team)\b|\bis waiting on us\b/i.test(item.next || '')) {
      reasons.push('The note says they are waiting on us'); urgent = true;
    }
    /* A moment that passed yesterday is urgent; one that passed a month ago has decayed into a reconnect, and on the
       live corpus 6 of the 10 time-bound reds were 22 to 30 days past their moment. Being waiting-on-us does not decay
       the same way -- an unanswered person stays unanswered -- so only this trigger carries a window. */
    if (item.timeBound && age != null && age >= 1 && age <= s.urgentDays) {
      reasons.push(`Pinned to a moment in a note ${age} ${age === 1 ? 'day' : 'days'} old, so that moment has passed`); urgent = true;
    }
    if (urgent) {
      if (old) reasons.push(`Open ${age} days`);
      if (stale) reasons.push(`Older than ${s.staleDays} days: close it or raise it again`);
      return { priority: 'urgent', reasons, age, stale };
    }
    if (old) {
      reasons.push(`Ours, open ${age} days, and nothing says anyone is waiting`);
      if (stale) reasons.push(`Older than ${s.staleDays} days: close it or raise it again`);
      return { priority: 'backlog', reasons, age, stale };
    }
    reasons.push(age == null ? 'Ours to move' : `Ours to move, raised ${age === 0 ? 'today' : age === 1 ? 'yesterday' : age + ' days ago'}`);
    return { priority: 'soon', reasons, age, stale };
  }

  /* ---------- one note, parsed ---------- */
  function parseNote(r, settings) {
    const s = settings || DEFAULTS;
    const text = str(r.Note_Content).trim();
    const d = conversationDate(text, r.Created_Time, s);
    const title = squash(r.Note_Title);
    const next = nextClause(text);
    return {
      id: str(r.id) || null,
      contactId: str(r.Parent_Id_id) || null,
      person: title.replace(/^conversation note:\s*/i, '') || null,
      on: d.on,
      onSrc: d.src,
      filed: r.Created_Time || null,
      text,
      /* The narrative without the Next: clause, for a timeline that does not repeat the action under it. */
      story: next ? squash(text.replace(STRIP_RE, '')) : squash(text),
      next,
      direction: next ? directionOf(next) : null,
      timeBound: next ? isTimeBound(next) : false,
    };
  }

  /* ---------- a contact's notes, newest conversation first ---------- */
  /* Sorted on the conversation date, then on the filing time so two notes from one day keep the order the bot read
     them in. Zoho's offsets move with daylight saving, so times are compared as parsed instants, never as strings. */
  const byNewest = (a, b) => str(b.on).localeCompare(str(a.on))
    || ((Date.parse(b.filed) || 0) - (Date.parse(a.filed) || 0))
    || str(a.id).localeCompare(str(b.id));

  function timelineFor(rows, contactId, settings) {
    const id = str(contactId);
    if (!id) return [];
    return (rows || []).filter((r) => isBotNote(r, settings) && str(r.Parent_Id_id) === id)
      .map((r) => parseNote(r, settings)).sort(byNewest);
  }

  /* ---------- the action items ---------- */
  /* An item is live unless a later note on the same contact exists: the conversation moved on, so its clause is history
     and belongs on the timeline rather than in a work list. Two notes sharing a conversation date are both live -- Greg
     has two from Nov 18, one about a meeting time and one about an unfinished reply, and they are different work.
     Supersession is not a claim that anything was done; it only says a newer note speaks for that contact. */
  function actionItems(rows, opts) {
    const o = opts || {};
    const settings = o.settings || DEFAULTS;
    const today = o.today || ctDay(new Date().toISOString(), settings.tz);
    const notes = (rows || []).filter((r) => isBotNote(r, settings)).map((r) => parseNote(r, settings));
    const newestOn = new Map();
    for (const n of notes) {
      if (!n.contactId || !n.on) continue;
      const cur = newestOn.get(n.contactId);
      if (!cur || n.on > cur) newestOn.set(n.contactId, n.on);
    }
    const out = [];
    for (const n of notes) {
      if (!n.next || !n.contactId) continue;
      const superseded = Boolean(n.on && newestOn.get(n.contactId) && newestOn.get(n.contactId) > n.on);
      if (superseded) continue;
      const p = priorityOf(n, today, settings);
      out.push(Object.assign({}, n, p, { key: 'note:' + n.id, superseded: false }));
    }
    return out.sort((a, b) => PRIORITY[a.priority].rank - PRIORITY[b.priority].rank
      || Number(a.stale) - Number(b.stale)
      || (b.age || 0) - (a.age || 0)
      || str(a.person).localeCompare(str(b.person)));
  }

  /* ---------- does Zoho carry a task for this ---------- */
  /* The done state is a Zoho Task, by Hemang's decision (Nov 20, 2026), and the bot does not write them yet, so this
     only answers whether a task exists: `open_tasks` pulls Status != Completed, so a completed task is absent from the
     dataset and cannot be told apart from a task that never existed. Until the bot writes them, the honest readings are
     "tracked in Zoho, still open" and "not in Zoho" -- never "done". Matching is the wording-containment test the
     contact brief already uses for a commitment and a task that say the same thing. */
  const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'for', 'with', 'on', 'in', 'at', 'is', 'are', 'we', 'our', 'us', 'owe', 'need', 'next', 'his', 'her', 'their', 'them', 'it', 'be', 'by', 'from', 'that', 'this', 'about', 'so', 'yet']);
  const sig = (s) => squash(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter((w) => w && w.length > 2 && !STOP.has(w)).join(' ');
  function sameWork(a, b) {
    const x = sig(a); const y = sig(b);
    if (!x || !y || x.length < 8 || y.length < 8) return false;
    const [shortS, longS] = x.length <= y.length ? [x, y] : [y, x];
    return longS.includes(shortS) && shortS.length / longS.length > 0.5;
  }
  function taskFor(item, tasks) {
    const list = (tasks || []).filter((t) => str(t.Who_Id_id) === str(item.contactId));
    return list.find((t) => sameWork(t.Subject, item.next)) || null;
  }

  /* ---------- the roll-up the panel reads ---------- */
  function summary(items, settings) {
    const s = settings || DEFAULTS;
    const count = (k) => items.filter((i) => i.priority === k).length;
    return {
      urgent: count('urgent'),
      soon: count('soon'),
      backlog: count('backlog'),
      watch: count('watch'),
      /* Needs action is the pair worth looking at today; the backlog is a cleanup decision, not a morning list. */
      act: count('urgent') + count('soon'),
      stale: items.filter((i) => i.stale).length,
      people: new Set(items.map((i) => i.contactId)).size,
      ours: items.filter((i) => i.direction === 'ours').length,
      staleDays: s.staleDays,
      urgentDays: s.urgentDays,
    };
  }

  const api = { DEFAULTS, PRIORITY, ctDay, daysBetween, isBotNote, conversationDate, nextClause, directionOf, isTimeBound, priorityOf, parseNote, timelineFor, actionItems, sameWork, taskFor, summary };
  root.CC_NOTES = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
