#!/usr/bin/env python3
"""Build the B2B Today calendar dataset (b2b_cal) from the team's Outlook calendars.

Zoho contact IDs, meeting times, flags and our own mailbox names only. The inputs (contact names and addresses, raw
calendar events with subjects) live in a scratch folder and are never committed, uploaded or pushed.

  build   DIR   DIR/contacts.csv + DIR/events.jsonl -> DIR/b2b_cal.json
  jsfile  DIR   DIR/b2b_cal.json -> DIR/cal.js (window.__CAL__), the file the cal-snapshot branch carries for the
                locked public site; refuses any field that isn't an ID, time, flag or mailbox name

contacts.csv: header "zoho_contact_id,first,last,emails" then one line per contact searched; emails is a ";"-separated
list (may be empty).

events.jsonl: one line per calendar search hit, as returned by outlook_calendar_search (a line with "error" marks a
search that failed; build then stops without writing anything):
  {"contact_id": "...", "cal": "info|mack|hemang|shruti", "start": "2026-10-21T15:00:00.0000000", "start_tz": "UTC",
   "end": "...", "end_tz": "UTC", "cancelled": false, "all_day": false, "subject": "...", "organizer": "a@b.com",
   "attendees": ["c@d.com"], "summary": "first part of the body, used only to read a booking's customer email"}

An event counts for a contact when
  - the contact's address is the organizer, an attendee, or the booking customer ("Email : x" in the body), or
  - the subject names them: their last name plus their first name (or a name starting with it, or a nickname it starts
    with, at least 3 letters), and the subject isn't an internal note (prep, review, reminder, placeholder, travel).
All-day events never count. Copies of one meeting on several calendars (same contact, same start minute) are one
meeting; it is cancelled only when every copy is cancelled.
"""
import csv
import json
import re
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

CALS = ['info', 'mack', 'hemang', 'shruti']
WINDOWS_TZ = {
    'utc': 'UTC', 'central standard time': 'America/Chicago', 'eastern standard time': 'America/New_York',
    'pacific standard time': 'America/Los_Angeles', 'mountain standard time': 'America/Denver',
    'india standard time': 'Asia/Kolkata',
}
INTERNAL = re.compile(r'\b(prep|prepare|preparation|review|reminder|placeholder|travel|drive|block|need to set|hold)\b', re.I)
BOOKING_SUFFIXES = {'jr', 'sr', 'ii', 'iii', 'phd', 'md', 'mba', 'ed', 'd', 'dr', 'cpa', 'pmp'}
EMAIL = re.compile(r'Email\s*:\s*([^\s<>"\']+@[^\s<>"\']+)', re.I)
EMAIL = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def tokens(s):
    s = re.sub(r'&amp;', ' ', s or '', flags=re.I)
    return [t for t in re.split(r'[^a-z0-9]+', s.lower()) if t]


def to_utc(value, tz):
    if not value:
        return None
    v = value.strip()
    if v.endswith('Z') or re.search(r'[+-]\d\d:\d\d$', v):
        dt = datetime.fromisoformat(v.replace('Z', '+00:00'))
    else:
        v = re.sub(r'(\.\d{6})\d+$', r'\1', v)
        name = (tz or 'UTC').strip()
        zone = WINDOWS_TZ.get(name.lower(), name)
        try:
            dt = datetime.fromisoformat(v).replace(tzinfo=ZoneInfo(zone))
        except Exception:
            sys.exit(f'unknown time zone {name!r}; add it to WINDOWS_TZ')
    return dt.astimezone(timezone.utc)


def stamp(dt):
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load_contacts(d):
    out = {}
    with open(d + '/contacts.csv', newline='') as f:
        for row in csv.DictReader(f):
            cid = (row.get('zoho_contact_id') or '').strip()
            if not cid:
                continue
            first = tokens(row.get('first'))
            last = [t for t in tokens(row.get('last')) if t not in SUFFIXES]
            if not first and len(last) > 1:
                first, last = last[:1], last[1:]
            emails = {e.strip().lower() for e in (row.get('emails') or '').split(';') if EMAIL.match(e.strip())}
            out[cid] = {'first': first[0] if first else '', 'last': last, 'emails': emails}
    if not out:
        sys.exit('contacts.csv has no contacts; refusing to write an empty dataset')
    return out


def names_match(c, subject):
    t = tokens(subject)
    if not c['last'] or not all(x in t for x in c['last']):
        return False
    f = c['first']
    if not f:
        return False
    return any(x == f or (len(f) >= 3 and x.startswith(f)) or (len(x) >= 3 and f.startswith(x)) for x in t if x not in c['last'])


def counts_for(c, e):
    people = {(e.get('organizer') or '').lower()} | {(a or '').lower() for a in (e.get('attendees') or [])}
    people |= {m.lower().rstrip('.,;') for m in BOOKING_EMAIL.findall(e.get('summary') or '')}
    if c['emails'] & people:
        return 'email'
    subject = e.get('subject') or ''
    if names_match(c, subject) and not INTERNAL.search(subject):
        return 'name'
    return None


def build(d):
    contacts = load_contacts(d)
    meets = {cid: {} for cid in contacts}
    seen = set()
    errors = []
    with open(d + '/events.jsonl') as f:
        for n, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            e = json.loads(line)
            cid = str(e.get('contact_id') or '')
            cal = (e.get('cal') or '').lower()
            if cid not in contacts:
                sys.exit(f'events.jsonl line {n}: contact {cid!r} is not in contacts.csv')
            if cal not in CALS:
                sys.exit(f'events.jsonl line {n}: unknown calendar {cal!r}')
            if e.get('error'):
                errors.append(f'{cid} on {cal}: {e["error"]}')
                continue
            seen.add(cid)
            if e.get('all_day'):
                continue
            how = counts_for(contacts[cid], e)
            if not how:
                continue
            start = to_utc(e.get('start'), e.get('start_tz'))
            if not start:
                continue
            key = stamp(start)[:16]
            m = meets[cid].setdefault(key, {'at': stamp(start), 'cancelled': True, 'cals': set(), 'by': 'name'})
            m['cancelled'] = m['cancelled'] and bool(e.get('cancelled'))
            m['cals'].add(cal)
            if how == 'email':
                m['by'] = 'email'
    if errors:
        sys.exit('searches failed, not writing b2b_cal.json; rerun them:\n' + '\n'.join(errors))
    now = datetime.now(timezone.utc)
    rows = []
    for cid in contacts:
        ms = sorted(meets[cid].values(), key=lambda m: m['at'])
        rows.append({
            'Zoho_Id': cid,
            'meetings': [{'at': m['at'], 'cancelled': m['cancelled'], 'cals': ','.join(c for c in CALS if c in m['cals']), 'by': m['by']} for m in ms],
            'as_of': stamp(now),
        })
    with open(d + '/b2b_cal.json', 'w') as f:
        json.dump(rows, f)
    held = sum(1 for r in rows for m in r['meetings'] if not m['cancelled'] and m['at'] <= stamp(now))
    ahead = sum(1 for r in rows for m in r['meetings'] if not m['cancelled'] and m['at'] > stamp(now))
    met = sum(1 for r in rows if any(not m['cancelled'] and m['at'] <= stamp(now) for m in r['meetings']))
    print(json.dumps({'contacts': len(rows), 'contacts_with_hits': len(seen), 'contacts_met': met,
                      'meetings_held': held, 'meetings_ahead': ahead}))


ROW_FIELDS = {'Zoho_Id', 'meetings', 'as_of'}
MEET_FIELDS = {'at', 'cancelled', 'cals', 'by'}
ISO = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')


def jsfile(d):
    with open(d + '/b2b_cal.json') as f:
        rows = json.load(f)
    if not rows:
        sys.exit('b2b_cal.json is empty')
    for r in rows:
        if set(r) - ROW_FIELDS or not re.fullmatch(r'\d+', str(r.get('Zoho_Id'))) or not ISO.match(r.get('as_of') or ''):
            sys.exit('unexpected row, not publishing (extra fields, or a bad Zoho_Id or as_of)')
        for m in r['meetings']:
            if set(m) - MEET_FIELDS or not ISO.match(m.get('at') or '') or not isinstance(m.get('cancelled'), bool) \
                    or m.get('by') not in ('email', 'name') or any(c not in CALS for c in m.get('cals', '').split(',')):
                sys.exit('unexpected meeting field or value, not publishing')
    body = {'generated_at': stamp(datetime.now(timezone.utc)), 'datasets': {'b2b_cal': rows}}
    with open(d + '/cal.js', 'w') as f:
        f.write('window.__CAL__ = ' + json.dumps(body) + ';\n')
    print('wrote', d + '/cal.js')


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('build', 'jsfile'):
        sys.exit(__doc__)
    {'build': build, 'jsfile': jsfile}[sys.argv[1]](sys.argv[2].rstrip('/'))
