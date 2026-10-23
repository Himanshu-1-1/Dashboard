#!/usr/bin/env python3
"""Build the B2B Today Fireflies dataset (b2b_ff): which B2B prospects were on which recorded calls in 2026.

Zoho contact IDs, start times, minutes and flags only leave the scratch folder. The inputs (contact names and
addresses, Fireflies titles, attendee lists and summaries) stay there and are never committed, uploaded or pushed.

  build   DIR   DIR/contacts.json + DIR/meetings.json -> DIR/b2b_ff.json: one row per (prospect, recorded call)
                {Zoho_Id, at, held, minutes, by, ff_id, as_of}
  pages   DIR   DIR/p*.json (fireflies_get_transcripts pages, format json) -> DIR/meetings.json, one entry per call ID
  merge   DIR FROM
                daily refresh: DIR/meetings.json holds only calls from FROM (YYYY-MM-DD, UTC) on, so after build this keeps
                the rows of DIR/prev/b2b_ff.json that start before FROM (for prospects still in contacts.json) and adds
                the rows just built; DIR/b2b_ff.json is rewritten
  jsfile  DIR   DIR/b2b_ff.json -> DIR/ff.js (window.__FF__) for the locked public site; drops ff_id and refuses any
                field that isn't an ID, time, number or flag

contacts.json: Zoho COQL answer (data.data rows) for every contact tagged "May 2026 - 100 B2B": id, First_Name,
Last_Name, Full_Name, Email, Personal_Email, Account_Name, Account_Name.Website.

meetings.json: {fireflies_id: meeting} as returned by fireflies_get_transcripts (format json): id, title, dateString,
duration (minutes), participants, meetingAttendees, meetingInfo.

A call counts for a prospect when
  - one of the prospect's addresses is among the call's participants or attendees ("email"), or
  - an attendee's company domain (not a free mail domain, not ours) is the prospect's email or Account website domain
    and no other B2B prospect has that domain ("domain"; not when the title books the call with someone else), or
  - the title names them: last name plus first name (or a name starting with it), and the title isn't an internal note
    ("name").
A call is held when Fireflies recorded at least 5 minutes, didn't flag it silent, and its summary names the prospect or
their company without saying they didn't join. Domain and name matches also need that mention to count at all. Calls with only our own people, and calls
with anyone from an EXCLUDED domain (asinpa.com), are skipped. One prospect on one call is one row, however many ways it matched (email beats domain beats name).
"""
import json
import re
import sys
from datetime import datetime, timezone

OURS = ('techtranspire.com', 'trueleansolutions.com', 'truelean.com')
# Calls with anyone from these domains are left out entirely (standing rule for every meeting summary).
EXCLUDED = ('asinpa.com',)
FREE = {'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com', 'hotmail.com', 'outlook.com',
        'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'protonmail.com', 'proton.me', 'gmx.com',
        'mail.com', 'zoho.com', 'rediffmail.com', 'sbcglobal.net', 'comcast.net', 'att.net', 'verizon.net'}
SOCIAL = {'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'google.com',
          'sites.google.com', 'wixsite.com', 'godaddysites.com'}
INTERNAL = re.compile(r'\b(prep|prepare|preparation|review|reminder|placeholder|travel|drive|block|standup|stand-up|sync|internal)\b', re.I)
SUFFIXES = {'jr', 'sr', 'ii', 'iii', 'phd', 'md', 'mba', 'ed', 'd', 'dr', 'cpa', 'pmp'}
EMAIL = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
HELD_MINUTES = 5
GENERIC = {'solutions', 'solution', 'consulting', 'group', 'technologies', 'technology', 'services', 'global', 'partners',
           'company', 'systems', 'software', 'digital', 'international', 'enterprises', 'holdings', 'tech', 'labs', 'founder'}
NO_SHOW = re.compile(r"\b(did ?n[o']?t (join|show|attend)|no[- ]show|was absent|were absent|never joined|could not join|couldn't join|didn't make it)\b", re.I)
RANK = {'email': 3, 'domain': 2, 'name': 1}
BOOKED = re.compile(r'\bmeeting with\s+(.+)$', re.I)


def tokens(s):
    return [t for t in re.split(r'[^a-z0-9]+', (s or '').lower()) if t]


def web_domain(u):
    s = re.sub(r'^[a-z]+://', '', (u or '').strip().lower())
    s = re.sub(r'^www\.', '', s).split('/')[0].split('?')[0].split('#')[0]
    return s if '.' in s and s not in SOCIAL else None


def org(d):
    return '.'.join(d.split('.')[-2:]) if d else None


def stamp(dt):
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load_contacts(d):
    body = json.load(open(d + '/contacts.json'))
    rows = body['data']['data'] if isinstance(body.get('data'), dict) else body['data']
    out = {}
    for r in rows:
        cid = str(r.get('id') or '')
        if not cid:
            continue
        emails = {e.strip().lower() for e in (r.get('Email'), r.get('Personal_Email')) if e and EMAIL.match(e.strip())}
        doms = {org(e.split('@')[1]) for e in emails if e.split('@')[1] not in FREE and not e.endswith(OURS)}
        w = web_domain(r.get('Account_Name.Website'))
        if w:
            doms.add(org(w))
        first = tokens(r.get('First_Name'))
        last = [t for t in tokens(r.get('Last_Name')) if t not in SUFFIXES]
        if not first and len(last) > 1:
            first, last = last[:1], last[1:]
        acct = r.get('Account_Name')
        acct = acct.get('name') if isinstance(acct, dict) else acct
        co = [t for t in tokens(acct) if len(t) >= 4 and t not in GENERIC]
        out[cid] = {'emails': emails, 'doms': {x for x in doms if x}, 'first': first[0] if first else '', 'last': last, 'co': co}
    if not out:
        sys.exit('contacts.json has no contacts; refusing to write an empty dataset')
    return out


def names_match(c, title):
    t = tokens(title)
    if not c['last'] or not c['first'] or not all(x in t for x in c['last']):
        return False
    f = c['first']
    return any(x == f or (len(f) >= 3 and x.startswith(f)) or (len(x) >= 3 and f.startswith(x)) for x in t if x not in c['last'])


def build(d):
    contacts = load_contacts(d)
    meetings = json.load(open(d + '/meetings.json'))
    dom_owner = {}
    for cid, c in contacts.items():
        for x in c['doms']:
            dom_owner.setdefault(x, set()).add(cid)
    now = stamp(datetime.now(timezone.utc))
    rows = {}
    for fid, m in meetings.items():
        people = {(p or '').strip().lower() for p in (m.get('participants') or [])}
        people |= {(a.get('email') or '').strip().lower() for a in (m.get('meetingAttendees') or []) if isinstance(a, dict)}
        people = {p for p in people if EMAIL.match(p)}
        if any(p.endswith(EXCLUDED) for p in people):
            continue
        outside = {p for p in people if not p.endswith(OURS)}
        title = m.get('title') or ''
        if not outside and not any(names_match(c, title) for c in contacts.values()):
            continue
        try:
            start = datetime.fromisoformat((m.get('dateString') or '').replace('Z', '+00:00'))
        except ValueError:
            continue
        minutes = float(m.get('duration') or 0)
        silent = bool((m.get('meetingInfo') or {}).get('silent_meeting'))
        summ = m.get('summary') or {}
        text = ' '.join([summ.get('short_summary') or '', summ.get('action_items') or '', ' '.join(summ.get('keywords') or [])])
        said = set(tokens(text))
        recorded = minutes >= HELD_MINUTES and not silent
        hits = {}
        for cid, c in contacts.items():
            if c['emails'] & people:
                hits[cid] = 'email'
        booked = BOOKED.search(title)
        for p in outside:
            dom = p.split('@')[1]
            if dom in FREE:
                continue
            owners = dom_owner.get(org(dom), set())
            if len(owners) == 1:
                cid = next(iter(owners))
                c = contacts[cid]
                # A booking titled for someone else at the same company is that person's call, not this prospect's.
                if booked and not ({c['first'], *c['last']} & set(tokens(booked.group(1)))):
                    continue
                hits.setdefault(cid, 'domain')
        if not INTERNAL.search(title):
            for cid, c in contacts.items():
                if cid not in hits and names_match(c, title):
                    hits[cid] = 'name'
        for cid, by in hits.items():
            c = contacts[cid]
            # The summary has to talk about them: their name or their company. A slot they skipped, where our team
            # talked about other work, doesn't count as a meeting with them.
            mentioned = bool(({c['first'], *c['last'], *c['co']} - {''}) & said)
            if by != 'email' and not mentioned:
                continue
            held = recorded and mentioned and not NO_SHOW.search(text)
            key = (cid, fid)
            prev = rows.get(key)
            if prev and RANK[prev['by']] >= RANK[by]:
                continue
            rows[key] = {'Zoho_Id': cid, 'at': stamp(start), 'held': held, 'minutes': round(minutes), 'by': by, 'ff_id': fid, 'as_of': now}
    out = sorted(rows.values(), key=lambda r: (r['Zoho_Id'], r['at']))
    with open(d + '/b2b_ff.json', 'w') as f:
        json.dump(out, f)
    held = [r for r in out if r['held']]
    print(json.dumps({'calls_read': len(meetings), 'rows': len(out), 'held_rows': len(held),
                      'prospects_on_calls': len({r['Zoho_Id'] for r in out}), 'prospects_met': len({r['Zoho_Id'] for r in held}),
                      'by': {k: sum(1 for r in out if r['by'] == k) for k in RANK}}))


FIELDS = {'Zoho_Id', 'at', 'held', 'minutes', 'by', 'as_of'}
ISO = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')


def jsfile(d):
    rows = json.load(open(d + '/b2b_ff.json'))
    if not rows:
        sys.exit('b2b_ff.json is empty')
    out = []
    for r in rows:
        r = {k: v for k, v in r.items() if k != 'ff_id'}
        if set(r) != FIELDS or not re.fullmatch(r'\d+', str(r['Zoho_Id'])) or not ISO.match(r['at']) or not ISO.match(r['as_of']) \
                or not isinstance(r['held'], bool) or not isinstance(r['minutes'], int) or r['by'] not in RANK:
            sys.exit('unexpected row, not publishing')
        out.append(r)
    body = {'generated_at': stamp(datetime.now(timezone.utc)), 'datasets': {'b2b_ff': out}}
    with open(d + '/ff.js', 'w') as f:
        f.write('window.__FF__ = ' + json.dumps(body) + ';\n')
    print('wrote', d + '/ff.js')


def pages(d):
    import glob
    files = sorted(glob.glob(d + '/p*.json'))
    if not files:
        sys.exit('no page files (p*.json) in ' + d)
    meetings = {}
    for f in files:
        body = json.load(open(f))
        if isinstance(body, dict):
            body = body.get('transcripts') or body.get('data') or []
        if not isinstance(body, list):
            sys.exit(f + ' is not a list of calls')
        for m in body:
            if isinstance(m, dict) and m.get('id'):
                meetings[str(m['id'])] = m
    with open(d + '/meetings.json', 'w') as f:
        json.dump(meetings, f)
    print(json.dumps({'pages': len(files), 'calls': len(meetings)}))


def merge(d, since):
    if not re.fullmatch(r'\d{4}-\d\d-\d\d', since):
        sys.exit('FROM must be YYYY-MM-DD')
    prev = json.load(open(d + '/prev/b2b_ff.json'))
    if not isinstance(prev, list) or not prev:
        sys.exit('prev/b2b_ff.json is empty; run a full build instead')
    fresh = json.load(open(d + '/b2b_ff.json'))
    ids = set(load_contacts(d))
    cut = since + 'T00:00:00Z'
    kept = [r for r in prev if r['at'] < cut and str(r['Zoho_Id']) in ids]
    seen = {(str(r['Zoho_Id']), r['ff_id']) for r in fresh}
    out = sorted(fresh + [r for r in kept if (str(r['Zoho_Id']), r['ff_id']) not in seen], key=lambda r: (r['Zoho_Id'], r['at']))
    with open(d + '/b2b_ff.json', 'w') as f:
        json.dump(out, f)
    print(json.dumps({'kept_before_window': len(kept), 'built_in_window': len(fresh), 'rows': len(out),
                      'prospects_met': len({r['Zoho_Id'] for r in out if r['held']})}))


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd in ('build', 'jsfile', 'pages') and len(sys.argv) == 3:
        {'build': build, 'jsfile': jsfile, 'pages': pages}[cmd](sys.argv[2].rstrip('/'))
    elif cmd == 'merge' and len(sys.argv) == 4:
        merge(sys.argv[2].rstrip('/'), sys.argv[3])
    else:
        sys.exit(__doc__)
