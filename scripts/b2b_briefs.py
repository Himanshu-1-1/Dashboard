#!/usr/bin/env python3
"""Keep the B2B Today Partner meeting briefs (b2b_briefs) current: one short brief per B2B prospect with a held
Fireflies call, rewritten only when they have a held call the brief doesn't cover yet.

Everything here stays in a scratch folder DIR. Only the merged DIR/briefs.json leaves it: uploaded to the private
dashboard and, sealed with scripts/seal.mjs, pushed to the b2b-snapshot branch for the locked public site.

  inputs  DIR   DIR/b2b_ff.json (rows from scripts/b2b_ff.py, after build or merge), DIR/contacts.json (the same Zoho
                answer b2b_ff.py reads, plus Priority and LI_Connect), DIR/meetings.json (the calls fetched this run) and
                DIR/prev/briefs.json (the briefs as published; [] the first time) -> DIR/briefs/in/<zoho_id>.json for each
                prospect whose held calls changed, DIR/briefs/list.txt, and DIR/briefs/group_NN.txt (GROUP files each)
  merge   DIR   DIR/prev/briefs.json + DIR/briefs/out/<zoho_id>.json (written by agents following
                scripts/b2b_briefs_task.md) -> DIR/briefs.json; refuses a missing, malformed or oversized brief and any
                email address or phone number; calls, last_call and last_ff_id always come from b2b_ff.json

A call counts when b2b_ff.json marks it held; calls is the number of Central-time (CT) days with one, so two recordings
on one day are one meeting. Dates are CT. Calls with anyone from asinpa.com never reach
b2b_ff.json, so they never reach a brief.
"""
import json
import os
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

CT = ZoneInfo('America/Chicago')
GROUP = 6
KEYS = {'zoho_id', 'last_call', 'calls', 'talked_about', 'open_points', 'ask_next', 'next_meeting'}
EMAIL = re.compile(r'[\w.+-]+@[\w-]+(\.[\w-]+)+')
PHONE = re.compile(r'(?<![\w-])\+?\(?\d[\d\s().-]{8,}\d(?![\w-])')
LIMITS = {'talked_about': 400, 'next_meeting': 350, 'item': 300}
THIN = "Recorded calls don't say enough to brief on."


def ct_day(at):
    return datetime.fromisoformat(at.replace('Z', '+00:00')).astimezone(CT).strftime('%Y-%m-%d')


def held_rows(d):
    rows = json.load(open(d + '/b2b_ff.json'))
    by = {}
    for r in rows:
        if r.get('held') is True and r.get('ff_id'):
            by.setdefault(str(r['Zoho_Id']), []).append(r)
    for v in by.values():
        v.sort(key=lambda r: r['at'])
    return by


def facts(rows):
    # Two recordings on one Central-time day are one meeting, as the meeting counts elsewhere on the tab treat them.
    last = rows[-1]
    return {'calls': len({ct_day(r['at']) for r in rows}), 'last_call': ct_day(last['at']), 'last_ff_id': last['ff_id']}


def load_prev(d):
    path = d + '/prev/briefs.json'
    prev = json.load(open(path)) if os.path.exists(path) else []
    if not isinstance(prev, list):
        sys.exit('prev/briefs.json must be a list')
    return {str(b['zoho_id']): b for b in prev if isinstance(b, dict) and b.get('zoho_id')}


def load_people(d):
    body = json.load(open(d + '/contacts.json'))
    rows = body['data']['data'] if isinstance(body.get('data'), dict) else body['data']
    out = {}
    for r in rows:
        acct = r.get('Account_Name')
        out[str(r.get('id'))] = {
            'name': (r.get('Full_Name') or ' '.join(x for x in (r.get('First_Name'), r.get('Last_Name')) if x) or '').strip(),
            'company': (acct.get('name') if isinstance(acct, dict) else acct) or None,
            'priority': r.get('Priority') or None,
            'li_connect': r.get('LI_Connect') or None,
        }
    if not out:
        sys.exit('contacts.json has no contacts')
    return out


def names(m):
    seen = []
    for a in m.get('meetingAttendees') or []:
        n = (a.get('displayName') or a.get('name') or '').strip() if isinstance(a, dict) else ''
        if n and not EMAIL.search(n) and n not in seen:
            seen.append(n)
    return seen


def inputs(d):
    held = held_rows(d)
    prev = load_prev(d)
    people = load_people(d)
    meetings = json.load(open(d + '/meetings.json')) if os.path.exists(d + '/meetings.json') else {}
    os.makedirs(d + '/briefs/in', exist_ok=True)
    os.makedirs(d + '/briefs/out', exist_ok=True)
    todo = []
    for cid, rows in sorted(held.items()):
        if cid not in people:
            continue
        f = facts(rows)
        p = prev.get(cid)
        if p and p.get('calls') == f['calls'] and p.get('last_call') == f['last_call']:
            continue
        calls = []
        for r in rows:
            m = meetings.get(r['ff_id']) or {}
            s = m.get('summary') or {}
            calls.append({
                'ff_id': r['ff_id'], 'date': ct_day(r['at']), 'minutes': r['minutes'], 'matched_by': r['by'],
                'title': m.get('title'), 'summary': s.get('short_summary'), 'action_items': s.get('action_items'),
                'keywords': s.get('keywords'), 'attendees': names(m) if m else None,
                'fetched': bool(m),
            })
        brief = {k: p[k] for k in KEYS if k in p} if p else None
        doc = {'zoho_id': cid, **people[cid], 'previous_brief': brief, 'calls': calls}
        with open(f'{d}/briefs/in/{cid}.json', 'w') as fh:
            json.dump(doc, fh, ensure_ascii=False)
        todo.append(cid)
    with open(d + '/briefs/list.txt', 'w') as fh:
        fh.write(''.join(c + '\n' for c in todo))
    for name in os.listdir(d + '/briefs'):
        if re.fullmatch(r'group_\d\d\.txt', name):
            os.remove(f'{d}/briefs/{name}')
    groups = [todo[i:i + GROUP] for i in range(0, len(todo), GROUP)]
    for i, g in enumerate(groups):
        with open(f'{d}/briefs/group_{i:02d}.txt', 'w') as fh:
            fh.write(''.join(c + '.json\n' for c in g))
    need = sum(1 for c in todo for x in json.load(open(f'{d}/briefs/in/{c}.json'))['calls'] if not x['fetched'])
    print(json.dumps({'prospects_with_held_calls': len(held), 'briefs_to_write': len(todo), 'groups': len(groups),
                      'calls_to_fetch_by_id': need}))


def clean(text, where):
    if not isinstance(text, str):
        sys.exit(f'{where}: expected text')
    t = ' '.join(text.split())
    if EMAIL.search(t) or PHONE.search(t):
        sys.exit(f'{where}: contains an email address or phone number, not publishing')
    return t


def check(cid, b):
    if not isinstance(b, dict) or set(b) != KEYS:
        sys.exit(f'{cid}: brief must have exactly {sorted(KEYS)}')
    if str(b['zoho_id']) != cid:
        sys.exit(f'{cid}: zoho_id does not match the file name')
    out = {'zoho_id': cid}
    out['talked_about'] = clean(b['talked_about'], cid + ' talked_about')
    if not out['talked_about'] or len(out['talked_about']) > LIMITS['talked_about']:
        sys.exit(f'{cid}: talked_about is empty or too long')
    for k in ('open_points', 'ask_next'):
        v = b[k]
        if not isinstance(v, list) or len(v) > 3:
            sys.exit(f'{cid}: {k} must be a list of at most 3 items')
        out[k] = [clean(x, f'{cid} {k}') for x in v]
        if any(not x or len(x) > LIMITS['item'] for x in out[k]):
            sys.exit(f'{cid}: an item in {k} is empty or too long')
    nm = b['next_meeting']
    if nm is None:
        if out['talked_about'] != THIN:
            sys.exit(f'{cid}: next_meeting is null but the brief is not marked thin')
        out['next_meeting'] = None
    else:
        out['next_meeting'] = clean(nm, cid + ' next_meeting')
        if not out['next_meeting'] or len(out['next_meeting']) > LIMITS['next_meeting']:
            sys.exit(f'{cid}: next_meeting is empty or too long')
    return out


def merge(d):
    held = held_rows(d)
    prev = load_prev(d)
    todo = [c.strip() for c in open(d + '/briefs/list.txt') if c.strip()]
    missing = [c for c in todo if not os.path.exists(f'{d}/briefs/out/{c}.json')]
    if missing:
        sys.exit('no brief written for ' + ', '.join(missing) + '; not publishing')
    written = {c: check(c, json.load(open(f'{d}/briefs/out/{c}.json'))) for c in todo}
    out = []
    for cid, rows in held.items():
        base = written.get(cid) or (check(cid, {k: prev[cid][k] for k in KEYS if k in prev[cid]}) if cid in prev else None)
        if base is None:
            continue
        out.append({**base, **facts(rows)})
    if not out:
        sys.exit('no briefs to publish')
    out.sort(key=lambda b: (b['last_call'], b['zoho_id']), reverse=True)
    with open(d + '/briefs.json', 'w') as fh:
        json.dump(out, fh, ensure_ascii=False)
    print(json.dumps({'briefs': len(out), 'rewritten': len(written), 'kept': len(out) - len(written),
                      'dropped': len(set(prev) - {b['zoho_id'] for b in out})}))


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('inputs', 'merge'):
        sys.exit(__doc__)
    {'inputs': inputs, 'merge': merge}[sys.argv[1]](sys.argv[2].rstrip('/'))
