#!/usr/bin/env python3
"""Daily LI Connect change log and the Priority / LI Connect baseline for the B2B Today Priority 3 panel.

Zoho keeps Priority history itself (Priority History, turned on Oct 28, 2026), but a module can track only one picklist,
so LI Connect changes are found here by comparing each B2B contact's value with the previous day's. Zoho contact IDs,
Priority and LI Connect values and times only: no names, emails or other details are written.

  build   DIR   DIR/contacts.json (+ DIR/prev/ from the last run, if any) -> DIR/p3_base.json, DIR/li_events.json,
                DIR/p3_state.json
  jsfile  DIR   DIR/p3_base.json + DIR/li_events.json -> DIR/p3.js (window.__P3__), the file the p3-snapshot branch
                carries for the locked public site; refuses any field that isn't an ID, value or time

contacts.json: {"data": [{"id", "Priority", "LI_Connect", "Modified_Time"}, ...]}, every contact tagged
"May 2026 - 100 B2B" from Zoho COQL, all pages joined.

prev/: p3_base.json, li_events.json and p3_state.json from the last run (the p3-snapshot branch). Missing on the first
run, which writes the baseline and no events.

p3_base.json: one row per contact, {contact_id, priority, li, at}: their Priority and LI Connect the first time this log
saw them. Rows are never changed afterwards; a contact newly tagged gets its row on the day it first appears. The page
uses it as the value before a contact's first recorded change.

li_events.json: one row per LI Connect change, {contact_id, field: "LI_Connect", from, to, at}. at is the contact's
Modified_Time when that falls after the previous run (the last edit, so close to the change), otherwise this run's time.

p3_state.json: {"as_of", "li": {contact_id: value}}: what the next run compares against.

A run stops without writing anything when the contact list is under 80% of the previous run's (an incomplete query).
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

LI_OK = re.compile(r'^[A-Za-z][A-Za-z ]{0,39}$')
PR_OK = re.compile(r'^\d{1,3}$')
ID_OK = re.compile(r'^\d{6,25}$')
ISO = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
EVENT_FIELDS = {'contact_id', 'field', 'from', 'to', 'at'}
BASE_FIELDS = {'contact_id', 'priority', 'li', 'at'}


def stamp(dt):
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def norm(v, ok):
    if v is None:
        return None
    s = str(v).strip()
    if s in ('', '-None-'):
        return None
    if not ok.match(s):
        sys.exit('unexpected value %r, not writing' % s)
    return s


def utc_of(s):
    if not s:
        return None
    try:
        return stamp(datetime.fromisoformat(str(s).replace('Z', '+00:00')))
    except ValueError:
        return None


def load(path, default):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def save(path, obj):
    with open(path, 'w') as f:
        json.dump(obj, f, indent=1, sort_keys=True)
        f.write('\n')


def build(d):
    rows = load(d + '/contacts.json', None)
    if not rows or not isinstance(rows.get('data'), list):
        sys.exit('contacts.json is missing or has no "data" list')
    now = stamp(datetime.now(timezone.utc))
    cur = {}
    for r in rows['data']:
        cid = str(r.get('id') or '')
        if not ID_OK.match(cid):
            sys.exit('a contact has no usable id, not writing')
        cur[cid] = {'pr': norm(r.get('Priority'), PR_OK), 'li': norm(r.get('LI_Connect'), LI_OK), 'mt': utc_of(r.get('Modified_Time'))}
    base = load(d + '/prev/p3_base.json', [])
    events = load(d + '/prev/li_events.json', [])
    state = load(d + '/prev/p3_state.json', None)
    if state and len(cur) < 0.8 * len(state.get('li', {})):
        sys.exit('only %d contacts against %d last run: the query looks incomplete, not writing' % (len(cur), len(state['li'])))
    have = {b['contact_id'] for b in base}
    added = 0
    for cid, v in sorted(cur.items()):
        if cid not in have:
            base.append({'contact_id': cid, 'priority': v['pr'], 'li': v['li'], 'at': now})
            added += 1
    new_events = 0
    if state:
        since = state.get('as_of') or now
        seen = {(e['contact_id'], e['at'], e['from'], e['to']) for e in events}
        for cid, v in sorted(cur.items()):
            if cid not in state['li']:
                continue
            before = state['li'][cid]
            if before == v['li']:
                continue
            at = v['mt'] if v['mt'] and since < v['mt'] <= now else now
            key = (cid, at, before, v['li'])
            if key in seen:
                continue
            events.append({'contact_id': cid, 'field': 'LI_Connect', 'from': before, 'to': v['li'], 'at': at})
            new_events += 1
    events.sort(key=lambda e: (e['at'], e['contact_id']))
    li = dict(state['li']) if state else {}
    li.update({cid: v['li'] for cid, v in cur.items()})
    save(d + '/p3_base.json', base)
    save(d + '/li_events.json', events)
    save(d + '/p3_state.json', {'as_of': now, 'li': li})
    print('contacts %d, baseline rows added %d, LI Connect changes found %d (%d in the log)%s'
          % (len(cur), added, new_events, len(events), '' if state else '; first run, baseline only'))


def jsfile(d):
    base = load(d + '/p3_base.json', None)
    events = load(d + '/li_events.json', None)
    if base is None or events is None:
        sys.exit('run build first')
    for b in base:
        if set(b) != BASE_FIELDS or not ID_OK.match(str(b['contact_id'])) or not ISO.match(b['at'] or '') \
                or (b['priority'] is not None and not PR_OK.match(b['priority'])) or (b['li'] is not None and not LI_OK.match(b['li'])):
            sys.exit('unexpected baseline row, not publishing')
    for e in events:
        if set(e) != EVENT_FIELDS or e['field'] != 'LI_Connect' or not ID_OK.match(str(e['contact_id'])) or not ISO.match(e['at'] or '') \
                or any(x is not None and not LI_OK.match(x) for x in (e['from'], e['to'])):
            sys.exit('unexpected event row, not publishing')
    body = {'generated_at': stamp(datetime.now(timezone.utc)), 'datasets': {'p3_base': base, 'li_events': events}}
    with open(d + '/p3.js', 'w') as f:
        f.write('window.__P3__ = ' + json.dumps(body) + ';\n')
    print('wrote', d + '/p3.js')


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('build', 'jsfile'):
        sys.exit(__doc__)
    {'build': build, 'jsfile': jsfile}[sys.argv[1]](sys.argv[2].rstrip('/'))
