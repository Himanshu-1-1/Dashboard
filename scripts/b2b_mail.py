#!/usr/bin/env python3
"""Build the private B2B Today mail datasets (b2b_mail, b2b_mail_weeks) from Outlook message metadata.

Dates, counts and Zoho contact IDs only. The inputs (contact addresses, message metadata) and the outputs live in a
scratch folder and on the private Claude Dashboard artifact; never commit them or copy them into site/.

  rebuild  DIR   per-contact search results DIR/out*_*.csv  -> DIR/b2b_mail.json, DIR/b2b_mail_weeks.json
  merge    DIR   DIR/b2b_mail.json + DIR/b2b_mail_weeks.json (current datasets) + DIR/messages.jsonl (new mail)
                 -> the same two files, updated in place

Both read DIR/contacts.csv: one "zoho_contact_id,email" line per B2B campaign contact with an address in Zoho.

rebuild CSV lines: contact_id,mailbox,internetMessageId,dir,date,auto,our_sender (dir: in | out | other | none | error | cut).
merge messages.jsonl lines: {"id": internetMessageId, "mailbox": "info", "sender": "a@b.com", "to": ["c@d.com"],
                             "sent": "2026-10-20T14:29:45Z", "auto": 0}
"""
import csv
import glob
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

CT = ZoneInfo('America/Chicago')
OURS = ('@techtranspire.com', '@trueleansolutions.com', '@truelean.com')
BOUNCE = ('microsoftexchange', 'postmaster', 'mailer-daemon')
BOX_ORDER = ['info', 'hemang', 'mack', 'shruti']
WEEKS = 12


def mkey(mid):
    """A short one-way key for a message ID, so the weekly dataset can count each message once without storing IDs."""
    return hashlib.sha256(mid.strip().encode()).hexdigest()[:16]


def utc(iso):
    return datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(timezone.utc)


def stamp(dt):
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def ct_monday(dt):
    d = dt.astimezone(CT).date()
    return d - timedelta(days=d.weekday())


def week_list(now):
    m = ct_monday(now)
    return [(m - timedelta(weeks=WEEKS - 1 - i)).isoformat() for i in range(WEEKS)]


def boxes_label(boxes):
    return ', '.join(b + '@' for b in sorted(boxes, key=lambda b: (BOX_ORDER + [b]).index(b)))


def load_contacts(d):
    by_id, by_addr = {}, {}
    with open(d + '/contacts.csv', newline='') as f:
        for row in csv.reader(f):
            if len(row) < 2 or not row[0].strip() or row[0].strip() == 'zoho_contact_id':
                continue
            cid, addr = row[0].strip(), row[1].strip().lower()
            if not addr:
                continue
            by_id[cid] = addr
            by_addr.setdefault(addr, set()).add(cid)
    if not by_id:
        sys.exit('contacts.csv has no contacts; refusing to write empty datasets')
    return by_id, by_addr


def blank(cid):
    return {'Zoho_Id': cid, 'n_in': 0, 'n_out': 0, 'last_in': None, 'last_out': None, 'last_out_by': None, 'bounced': False}


def is_ours(sender):
    s = (sender or '').lower()
    return s.startswith('/o=') or s.endswith(OURS)


def local_part(sender):
    s = (sender or '').lower()
    return None if s.startswith('/o=') or '@' not in s else s.split('@')[0]


def apply(row, direction, iso, by):
    if direction == 'in':
        row['n_in'] += 1
        if not row['last_in'] or iso > row['last_in']:
            row['last_in'] = iso
            if row.get('bounced'):
                row['bounced'] = False
    else:
        row['n_out'] += 1
        if not row['last_out'] or iso > row['last_out']:
            row['last_out'], row['last_out_by'] = iso, by


def write(d, rows, weeks, boxes, now):
    label = boxes_label(boxes)
    for r in rows:
        r['as_of'] = stamp(now)
        r['mailboxes'] = label
    with open(d + '/b2b_mail.json', 'w') as f:
        json.dump(rows, f)
    with open(d + '/b2b_mail_weeks.json', 'w') as f:
        json.dump(weeks, f)


def summary(rows, weeks):
    print(json.dumps({
        'contacts': len(rows), 'emailed': sum(1 for r in rows if r['n_out']), 'wrote_back': sum(1 for r in rows if r['n_in']),
        'bounced': sum(1 for r in rows if r.get('bounced')),
        'this_week': {k: v for k, v in weeks[-1].items() if not k.startswith('_')} if weeks else None,
    }))


def rebuild(d):
    by_id, _ = load_contacts(d)
    msgs, bounced, boxes, problems = {}, {}, set(), []
    files = sorted(glob.glob(d + '/out_*.csv') + glob.glob(d + '/outm_*.csv'))
    if not files:
        sys.exit('no out*_*.csv files in ' + d)
    for path in files:
        with open(path, newline='') as f:
            for row in csv.reader(f):
                if not row or row[0] == 'contact_id':
                    continue
                cid, box, mid, direction, iso, auto, by = [x.strip() for x in (row + [''] * 7)[:7]]
                if box:
                    boxes.add(box)
                if direction in ('error', 'cut'):
                    problems.append((cid, box, direction))
                    continue
                if not iso or cid not in by_id:
                    continue
                by = '' if by.lower().startswith('/o=') else by.lower()
                if auto == '1':
                    if by.startswith(BOUNCE) and iso > bounced.get(cid, ''):
                        bounced[cid] = iso
                    continue
                if direction in ('in', 'out') and mid:
                    msgs[(cid, mkey(mid))] = (direction, stamp(utc(iso)), by if direction == 'out' else '')
    if problems:
        sys.exit('searches failed or were cut short, rerun them first: ' + json.dumps(problems[:20]))
    rows = {cid: blank(cid) for cid in by_id}
    for (cid, _), (direction, iso, by) in sorted(msgs.items(), key=lambda kv: kv[1][1]):
        apply(rows[cid], direction, iso, by or None)
    for cid, iso in bounced.items():
        r = rows[cid]
        r['bounced'] = not (r['last_in'] and r['last_in'] > stamp(utc(iso)))
    now = datetime.now(timezone.utc)
    weeks = {w: {'sent': set(), 'received': set(), 'people': set()} for w in week_list(now)}
    for (cid, mid), (direction, iso, _) in msgs.items():
        w = ct_monday(utc(iso)).isoformat()
        if w in weeks:
            if direction == 'out':
                weeks[w]['sent'].add(mid)
                weeks[w]['people'].add(cid)
            else:
                weeks[w]['received'].add(mid)
    wrows = [{'week': w, 'sent': len(a['sent']), 'received': len(a['received']), 'people_sent': len(a['people']),
              '_sent_ids': sorted(a['sent']), '_received_ids': sorted(a['received']), '_people': sorted(a['people'])}
             for w, a in weeks.items()]
    out = [rows[c] for c in by_id]
    write(d, out, wrows, boxes, now)
    summary(out, wrows)


def merge(d):
    by_id, by_addr = load_contacts(d)
    with open(d + '/b2b_mail.json') as f:
        current = json.load(f)
    with open(d + '/b2b_mail_weeks.json') as f:
        cur_weeks = json.load(f)
    if not current:
        sys.exit('b2b_mail.json is empty; run rebuild instead')
    since = min(r['as_of'] for r in current if r.get('as_of'))
    boxes = {b.strip().rstrip('@') for b in (current[0].get('mailboxes') or '').split(',') if b.strip()}
    rows = {r['Zoho_Id']: r for r in current if r['Zoho_Id'] in by_id}
    for cid in by_id:
        rows.setdefault(cid, blank(cid))
    now = datetime.now(timezone.utc)
    weeks = {w: {'sent': set(), 'received': set(), 'people': set()} for w in week_list(now)}
    for w in cur_weeks:
        if w['week'] in weeks:
            weeks[w['week']]['sent'] |= set(w.get('_sent_ids') or [])
            weeks[w['week']]['received'] |= set(w.get('_received_ids') or [])
            weeks[w['week']]['people'] |= set(w.get('_people') or [])
    seen = set()
    added = 0
    with open(d + '/messages.jsonl') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            m = json.loads(line)
            mid, iso = (mkey(m['id']) if m.get('id') else None), m.get('sent')
            if m.get('mailbox'):
                boxes.add(m['mailbox'])
            if not mid or not iso or mid in seen or int(m.get('auto') or 0):
                continue
            iso = stamp(utc(iso))
            if iso <= since or iso > stamp(now):
                continue
            seen.add(mid)
            sender = (m.get('sender') or '').lower()
            to = {(x or '').lower() for x in (m.get('to') or [])}
            w = ct_monday(utc(iso)).isoformat()
            hit = False
            if sender in by_addr:
                for cid in by_addr[sender]:
                    apply(rows[cid], 'in', iso, None)
                    hit = True
                if hit and w in weeks:
                    weeks[w]['received'].add(mid)
            elif is_ours(sender):
                for addr in to:
                    for cid in by_addr.get(addr, ()):
                        apply(rows[cid], 'out', iso, local_part(sender))
                        hit = True
                        if w in weeks:
                            weeks[w]['people'].add(cid)
                if hit and w in weeks:
                    weeks[w]['sent'].add(mid)
            added += hit
    wrows = [{'week': w, 'sent': len(a['sent']), 'received': len(a['received']), 'people_sent': len(a['people']),
              '_sent_ids': sorted(a['sent']), '_received_ids': sorted(a['received']), '_people': sorted(a['people'])}
             for w, a in weeks.items()]
    out = [rows[c] for c in by_id]
    write(d, out, wrows, boxes, now)
    print(json.dumps({'window_from': since, 'messages_matched': added}))
    summary(out, wrows)


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('rebuild', 'merge'):
        sys.exit(__doc__)
    {'rebuild': rebuild, 'merge': merge}[sys.argv[1]](sys.argv[2].rstrip('/'))
