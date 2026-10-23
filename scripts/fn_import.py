#!/usr/bin/env python3
"""Build the Founder Network file datasets for the private Claude Dashboard.

Every input and output stays in a scratch folder: never in the repo, never on a public branch. Python standard library only.

  fn_import.py telegram WORK OUT      WORK holds people_z.json, photos.json, photos_out_*.json and activity.json (the
                                      reviewed Telegram reconstruction), and optionally review_notes.json. Writes fn_tg_people.json, fn_tg_photos.json and
                                      fn_tg_log.json.
  fn_import.py fireflies FF FN EMAILS TG OUT
                                      FF: Fireflies meetings ({id: meeting}); FN: Zoho COQL answer for Founder Network
                                      contacts; EMAILS: {zoho id: email}, used only to match and never written; TG:
                                      fn_tg_people.json. Writes fn_ff_meetings.json and fn_ff_links.json.
  fn_import.py outlook IN OUT         IN holds the hand-checked out_*.json files. Writes fn_outlook.json (dates, counts,
                                      flags, the other side's domain and a short note only).
  fn_import.py sources OUT            Writes fn_sources.json: when each file dataset was built and how many rows it has.

Rules carried over from the dashboard: phone numbers and email addresses are removed from any text; meetings with
@asinpa.com attendees and job interviews are skipped; a Fireflies meeting counts for a person only by their Zoho email,
an attendee display name that is exactly their first and last name, or an attendee email local part that is exactly
first+last or last+first, and names shared by two people match by email only.
"""
import glob
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone

EMAIL = re.compile(r'[\w.+-]+@[\w-]+(\.[\w-]+)+')
PHONE = re.compile(r'(?<![\w-])\+?\(?\d[\d\s().-]{8,}\d(?![\w-])')
TITLES = {'dr', 'mr', 'mrs', 'ms', 'jr', 'sr', 'phd', 'mba', 'cpa', 'md'}
PLACE = {'last', 'name', 'unknown', 'recruiter', 'from', 'startup', 'guy', 'group'}
OURS = ('techtranspire.com', 'trueleansolutions.com', 'truelean.com')
OUTLOOK_FIELDS = ('email_count', 'first_email', 'last_email', 'two_way', 'meeting_count', 'last_meeting', 'their_domain', 'identity', 'note')
IDENTITIES = {'same person', 'different person', 'not found', 'unconfirmed'}
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def clean(text):
    """Remove email addresses and phone numbers (10+ digits); dates and short numbers stay."""
    text = EMAIL.sub('[email removed]', str(text or ''))
    return PHONE.sub(lambda m: '[phone removed]' if len(re.sub(r'\D', '', m.group(0))) >= 10 else m.group(0), text)


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def dump(obj, path):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    print(os.path.basename(path), len(obj), 'rows', os.path.getsize(path), 'bytes')


def toks(v):
    v = re.sub(r'\([^)]*\)', ' ', v or '').split(',')[0]
    return [t for t in re.split(r'[^a-z]+', v.lower()) if len(t) > 1 and t not in TITLES]


def mention(m):
    """'2026-08-14 Mack: text' or '2026-09-16 photo 61 (WhatsApp chat): text' -> {date, by, text, photo}."""
    date, rest = (m.split(' ', 1) + [''])[:2]
    by, text = rest.split(': ', 1) if ': ' in rest else (rest, '')
    photo = re.match(r'photo (\d+)', by)
    return {'date': date if DATE.match(date) else None, 'by': clean(by), 'text': clean(text), 'photo': int(photo.group(1)) if photo else None}


def telegram(work, out):
    people = load(os.path.join(work, 'people_z.json'))
    notes_path = os.path.join(work, 'review_notes.json')  # optional {name: what to do instead}, written when reviewing
    notes = load(notes_path) if os.path.exists(notes_path) else {}
    rows = []
    for p in people:
        z = p.get('zoho') or {}
        rows.append({
            'name': p['name'], 'priority': p.get('priority') or None, 'slug': p.get('slug') or None,
            'title': clean(p.get('li_title') or p.get('photo_title') or ''), 'company': clean(p.get('li_company') or p.get('photo_company') or ''),
            'connected': p.get('connected') or None, 'first': p.get('first') or None, 'sources': p.get('sources') or 'chat',
            'needs_name': bool(p.get('needs_name')),
            'relationship': json.dumps([clean(r) for r in p.get('relationship') or []], ensure_ascii=False),
            'actions': json.dumps([clean(a) for a in p.get('actions') or []], ensure_ascii=False),
            'mentions': json.dumps([mention(m) for m in p.get('mentions') or []], ensure_ascii=False),
            'zoho_id': z.get('id'), 'zoho_by': z.get('by'), 'zoho_dups': z.get('dups') or 0, 'review_note': clean(notes.get(p['name'])) or None,
        })
    dump(rows, os.path.join(out, 'fn_tg_people.json'))
    photos = {p['n']: p for p in load(os.path.join(work, 'photos.json'))}
    prow = []
    for f in sorted(glob.glob(os.path.join(work, 'photos_out_*.json'))):
        for o in load(f):
            ph = photos.get(o['n'], {})
            d = ph.get('date') or ''
            iso = f'{d[6:10]}-{d[3:5]}-{d[0:2]}' if re.match(r'\d{2}\.\d{2}\.\d{4}', d) else None
            prow.append({'n': o['n'], 'date': iso, 'from': ph.get('from') or '', 'kind': o.get('kind') or '', 'summary': clean(o.get('summary')),
                         'people': ', '.join(x.get('name', '') for x in o.get('people') or []), 'actions': json.dumps([clean(a) for a in o.get('actions') or []], ensure_ascii=False),
                         'crm_counts': clean((o.get('crm_counts') or '').replace('(#DIV/0!)', '(the sheet showed a divide-by-zero error)'))})
    prow.sort(key=lambda r: r['n'])
    dump(prow, os.path.join(out, 'fn_tg_photos.json'))
    act = [{'date': a[0], 'kind': a[1], 'text': clean(a[2])} for a in load(os.path.join(work, 'activity.json'))]
    act += [{'date': r['date'], 'kind': 'Tracker snapshot (photo)', 'text': r['crm_counts']} for r in prow if r['crm_counts'] and r['date']]
    act.sort(key=lambda r: r['date'] or '')
    dump(act, os.path.join(out, 'fn_tg_log.json'))


def fireflies(ff_path, fn_path, emails_path, tg_path, out):
    ff = load(ff_path)
    fn = load(fn_path)
    fn = fn.get('data', {}).get('data', fn) if isinstance(fn, dict) else fn
    emails = load(emails_path)
    people = []
    for z in fn:
        t = [x for x in toks(z.get('Full_Name')) if x not in PLACE]
        people.append({'key': z['id'], 'name': z.get('Full_Name'), 'first': t[0] if t else None, 'last': t[-1] if len(t) > 1 else None, 'email': (emails.get(z['id']) or '').lower()})
    for p in load(tg_path):
        if not p.get('zoho_id') and not p.get('needs_name'):
            t = toks(p['name'])
            people.append({'key': 'tg:' + p['name'], 'name': p['name'], 'first': t[0] if t else None, 'last': t[-1] if len(t) > 1 else None, 'email': ''})
    cnt = Counter((p['first'], p['last']) for p in people if p['first'] and p['last'])
    meet = []
    for m in (ff.values() if isinstance(ff, dict) else ff):
        em, names = set(), set()
        for x in m.get('participants') or []:
            if isinstance(x, str) and '@' in x:
                em.add(x.strip().lower())
        for a in m.get('meetingAttendees') or []:
            if isinstance(a, dict):
                if a.get('email'):
                    em.add(a['email'].strip().lower())
                if a.get('displayName'):
                    names.add(' '.join(toks(a['displayName'])))
        title = m.get('title') or ''
        if any(e.endswith('@asinpa.com') for e in em) or re.search(r'\bcandidate\b|\binterview\b', title.lower()):
            continue
        meet.append((m, {e for e in em if not e.endswith(OURS)}, names))
    links, used = [], {}
    for p in people:
        for m, em, names in meet:
            how = None
            if p['email'] and p['email'] in em:
                how = 'their Zoho email'
            elif p['first'] and p['last'] and cnt[(p['first'], p['last'])] == 1:
                if any(n.split() and n.split()[0] == p['first'] and n.split()[-1] == p['last'] for n in names):
                    how = 'attendee name'
                elif any(re.sub(r'[^a-z]', '', e.split('@')[0]) in {p['first'] + p['last'], p['last'] + p['first']} for e in em):
                    how = 'attendee email'
            if how:
                links.append({'person': p['key'], 'name': p['name'], 'meeting': m['id'], 'matched_by': how})
                used[m['id']] = m
    rows = []
    for mid, m in used.items():
        s = m.get('summary') if isinstance(m.get('summary'), dict) else {}
        rows.append({'id': mid, 'date': (m.get('dateString') or '')[:19] + 'Z', 'title': clean(m.get('title')), 'minutes': round(float(m.get('duration') or 0)),
                     'summary': clean(s.get('short_summary'))[:1200], 'action_items': clean(s.get('action_items'))[:2500], 'url': 'https://app.fireflies.ai/view/' + mid})
    rows.sort(key=lambda r: r['date'])
    dump(rows, os.path.join(out, 'fn_ff_meetings.json'))
    dump(links, os.path.join(out, 'fn_ff_links.json'))


def outlook(src, out):
    rows, bad = [], 0
    for f in sorted(glob.glob(os.path.join(src, 'out_*.json')), key=lambda p: int(re.sub(r'\D', '', os.path.basename(p)) or 0)):
        for o in load(f):
            r = {'key': str(o.get('k') or o.get('key'))}
            for k in OUTLOOK_FIELDS:
                r[k] = o.get(k)
            r['identity'] = r['identity'] if r['identity'] in IDENTITIES else 'unconfirmed'
            for k in ('first_email', 'last_email', 'last_meeting'):
                r[k] = r[k] if isinstance(r[k], str) and DATE.match(r[k]) else None
            r['email_count'] = min(25, int(r['email_count'] or 0))
            r['meeting_count'] = int(r['meeting_count'] or 0)
            r['two_way'] = bool(r['two_way'])
            dom = str(r['their_domain'] or '').lower().split('@')[-1]
            r['their_domain'] = dom if re.match(r'^[a-z0-9.-]+\.[a-z]{2,}$', dom) and dom != 'asinpa.com' else None
            note = clean(r['note'])
            if re.search(r'asinpa', note, re.I):
                note, bad = '', bad + 1
            r['note'] = ' '.join(note.split()[:15])
            rows.append(r)
    if bad:
        print('notes cleared for mentioning Asinpa:', bad)
    print(Counter(r['identity'] for r in rows))
    dump(rows, os.path.join(out, 'fn_outlook.json'))


def sources(out):
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    names = {'fn_tg_people': 'Telegram', 'fn_tg_photos': 'Telegram photos', 'fn_tg_log': 'Telegram', 'fn_ff_meetings': 'Fireflies', 'fn_ff_links': 'Fireflies', 'fn_outlook': 'Outlook mail and calendar'}
    rows = []
    for ds, label in names.items():
        p = os.path.join(out, ds + '.json')
        if os.path.exists(p):
            rows.append({'dataset': ds, 'source': label, 'rows': len(load(p)), 'built': datetime.fromtimestamp(os.path.getmtime(p), timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'recorded': now})
    dump(rows, os.path.join(out, 'fn_sources.json'))


if __name__ == '__main__':
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else ''), sys.argv[2:]
    if cmd == 'telegram' and len(args) == 2:
        telegram(*args)
    elif cmd == 'fireflies' and len(args) == 5:
        fireflies(*args)
    elif cmd == 'outlook' and len(args) == 2:
        outlook(*args)
    elif cmd == 'sources' and len(args) == 1:
        sources(*args)
    else:
        sys.exit(__doc__)
