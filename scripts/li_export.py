#!/usr/bin/env python3
"""Mack's LinkedIn data export -> per-contact LinkedIn status and outreach rates for the dashboards.

The export (messages.csv, Invitations.csv, Connections.csv) and every message text stay in a scratch folder. What leaves
it: Zoho contact IDs, dates, counts, flags, a status label and a note of at most 15 words written by the reviewer (no
email addresses or phone numbers; build refuses them).

  inputs  EXPORT SCRATCH   EXPORT/messages.csv, Invitations.csv, Connections.csv + SCRATCH/zoho.json
                           -> SCRATCH/facts.json (per contact) and SCRATCH/review/group_NN.txt: the conversations to
                           label (new contacts, or a last message newer than the label's), at most GROUP per file
  build   SCRATCH          SCRATCH/facts.json + SCRATCH/labels.jsonl -> SCRATCH/li_dm.json and SCRATCH/li_outreach.json

zoho.json: [{"id", "LinkedIn", "Priority", "LI_Connect", "campaign": "b2b" | "fn"}], the contacts to match, by public
LinkedIn profile only (never by name).

labels.jsonl: one line per reviewed contact, written by the reviewers (scripts/li_review_task.md):
  {"contact_id", "status", "reply_needed", "met_on", "note", "last"}
  status: talking | they_wrote | said_yes | declined | no_reply | pitching | pleasantries
  reply_needed: true when their last message asks or offers something and nobody answered it
  met_on: YYYY-MM-DD of a meeting or call the messages show happened (the latest), else null
  note: what stands, 15 words at most; last: the conversation's last message time the label was written for.
A later line for the same contact replaces an earlier one.

li_dm.json, one row per matched contact with any LinkedIn evidence:
  contact_id, msgs, ours, theirs, first, last, last_in, last_out, last_from (us | them), invited_at, invite_note,
  connected_on, actual (connected | pending | none), status, reply_needed, met_on, note, reviewed (bool), as_of
li_outreach.json, one row per month of Mack's connection requests (all of them, not only Zoho contacts):
  month, sent, sent_note, accepted, accepted_note, opener_sent, opener_replied (the standard
  "ERP/MSP/consulting space" first message: people sent it that month, and how many wrote back afterwards)
"""
import csv
import json
import os
import re
import sys
from datetime import datetime, timezone

csv.field_size_limit(10 ** 9)
ME = 'mackakhani'
GROUP = 40
STATUSES = {'talking', 'they_wrote', 'said_yes', 'declined', 'no_reply', 'pitching', 'pleasantries'}
OPENER = re.compile(r'ERP/MSP/consulting space', re.I)
EMAIL = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')
PHONE = re.compile(r'(?:\+?\d[\s().-]?){9,}')
DAY = re.compile(r'^\d{4}-\d\d-\d\d$')


def slug(u):
    m = re.search(r'linkedin\.com/in/([^/?#\s]+)', u or '', re.I)
    return m.group(1).lower().rstrip('/') if m else None


def iso(dt):
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def msg_time(s):
    return iso(datetime.strptime(s.strip(), '%Y-%m-%d %H:%M:%S UTC').replace(tzinfo=timezone.utc))


def inv_time(s):
    return iso(datetime.strptime(s.strip(), '%m/%d/%y, %I:%M %p').replace(tzinfo=timezone.utc))


def read_connections(path):
    lines = open(path, encoding='utf-8', errors='replace').read().splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith('First Name'))
    out = {}
    for r in csv.DictReader(lines[start:]):
        k = slug(r.get('URL'))
        if k:
            out[k] = datetime.strptime(r['Connected On'].strip(), '%d %b %Y').strftime('%Y-%m-%d')
    return out


def inputs(export, d):
    zoho = json.load(open(d + '/zoho.json'))
    bykey = {}
    for c in zoho:
        k = slug(c.get('LinkedIn'))
        if k and re.fullmatch(r'\d{6,25}', str(c.get('id') or '')):
            bykey[k] = c
    conns = read_connections(export + '/Connections.csv')
    invites = {}
    for r in csv.DictReader(open(export + '/Invitations.csv', encoding='utf-8', errors='replace')):
        if r['Direction'] != 'OUTGOING':
            continue
        k = slug(r['inviteeProfileUrl'])
        t = inv_time(r['Sent At'])
        if k and (k not in invites or t > invites[k][0]):
            invites[k] = (t, bool(r['Message'].strip()))
    convs = {}
    for r in csv.DictReader(open(export + '/messages.csv', encoding='utf-8', errors='replace')):
        parts = {slug(r['SENDER PROFILE URL'])} | {slug(u) for u in (r['RECIPIENT PROFILE URLS'] or '').split(',')}
        parts.discard(None)
        parts.discard(ME)
        if len(parts) != 1 or not r['DATE']:
            continue
        k = parts.pop()
        if k in bykey:
            convs.setdefault(k, []).append({'t': msg_time(r['DATE']), 'us': slug(r['SENDER PROFILE URL']) == ME,
                                            'from': r['FROM'], 'text': r['CONTENT'] or ''})
    facts = []
    for k, c in sorted(bykey.items()):
        ms = sorted(convs.get(k, []), key=lambda m: m['t'])
        inv = invites.get(k)
        if not ms and not inv and k not in conns:
            continue
        ours = [m for m in ms if m['us']]
        theirs = [m for m in ms if not m['us']]
        facts.append({
            'contact_id': str(c['id']), 'campaign': c.get('campaign'), 'msgs': len(ms), 'ours': len(ours), 'theirs': len(theirs),
            'first': ms[0]['t'] if ms else None, 'last': ms[-1]['t'] if ms else None,
            'last_in': theirs[-1]['t'] if theirs else None, 'last_out': ours[-1]['t'] if ours else None,
            'last_from': ('us' if ms[-1]['us'] else 'them') if ms else None,
            'invited_at': inv[0] if inv else None, 'invite_note': inv[1] if inv else None,
            'connected_on': conns.get(k), 'actual': 'connected' if k in conns else 'pending' if inv else 'none',
        })
    with open(d + '/facts.json', 'w') as f:
        json.dump(facts, f)
    labels = read_labels(d)
    todo = [f for f in facts if f['msgs'] and (f['contact_id'] not in labels or labels[f['contact_id']].get('last') != f['last'])]
    os.makedirs(d + '/review', exist_ok=True)
    for old in os.listdir(d + '/review'):
        if old.startswith('group_'):
            os.remove(d + '/review/' + old)
    zid = {str(c['id']): c for c in zoho}
    keyof = {str(c['id']): k for k, c in bykey.items()}
    for g in range(0, len(todo), GROUP):
        out = []
        for f in todo[g:g + GROUP]:
            c = zid[f['contact_id']]
            out.append('### contact_id=%s | Priority %s | LI Connect %s | campaign %s | last=%s | %d messages'
                       % (f['contact_id'], c.get('Priority'), c.get('LI_Connect'), f['campaign'], f['last'], f['msgs']))
            for m in sorted(convs[keyof[f['contact_id']]], key=lambda m: m['t'])[-12:]:
                out.append('  %s %s: %s' % (m['t'][:10], 'MACK' if m['us'] else 'THEM', re.sub(r'\s+', ' ', m['text'])[:500]))
        with open('%s/review/group_%02d.txt' % (d, g // GROUP), 'w') as fh:
            fh.write('\n'.join(out) + '\n')
    # Outreach by month, over every request Mack sent (the export's own window).
    months = {}
    for r in csv.DictReader(open(export + '/Invitations.csv', encoding='utf-8', errors='replace')):
        if r['Direction'] != 'OUTGOING':
            continue
        m = inv_time(r['Sent At'])[:7]
        row = months.setdefault(m, {'month': m, 'sent': 0, 'sent_note': 0, 'accepted': 0, 'accepted_note': 0, 'opener_sent': 0, 'opener_replied': 0})
        note = bool(r['Message'].strip())
        acc = slug(r['inviteeProfileUrl']) in conns
        row['sent'] += 1
        row['sent_note'] += note
        row['accepted'] += acc
        row['accepted_note'] += acc and note
    allconv = {}
    for r in csv.DictReader(open(export + '/messages.csv', encoding='utf-8', errors='replace')):
        parts = {slug(r['SENDER PROFILE URL'])} | {slug(u) for u in (r['RECIPIENT PROFILE URLS'] or '').split(',')}
        parts.discard(None)
        parts.discard(ME)
        if len(parts) == 1 and r['DATE']:
            allconv.setdefault(parts.pop(), []).append((msg_time(r['DATE']), slug(r['SENDER PROFILE URL']) == ME, r['CONTENT'] or ''))
    for ms in allconv.values():
        ms.sort()
        first = next((m for m in ms if m[1] and OPENER.search(m[2])), None)
        if not first:
            continue
        m = first[0][:7]
        row = months.setdefault(m, {'month': m, 'sent': 0, 'sent_note': 0, 'accepted': 0, 'accepted_note': 0, 'opener_sent': 0, 'opener_replied': 0})
        row['opener_sent'] += 1
        row['opener_replied'] += any(not x[1] and x[0] > first[0] for x in ms)
    with open(d + '/outreach_raw.json', 'w') as f:
        json.dump(sorted(months.values(), key=lambda r: r['month']), f)
    print('matched contacts with LinkedIn evidence %d (with messages %d); to review %d in %d group files'
          % (len(facts), sum(1 for f in facts if f['msgs']), len(todo), (len(todo) + GROUP - 1) // GROUP))


def read_labels(d):
    out = {}
    path = d + '/labels.jsonl'
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line:
                r = json.loads(line)
                out[str(r['contact_id'])] = r
    return out


def build(d):
    facts = json.load(open(d + '/facts.json'))
    labels = read_labels(d)
    # How current the export is: its newest message, request or connection (not the time this ran).
    as_of = max([f[k] for f in facts for k in ('last', 'invited_at') if f.get(k)] +
                [f['connected_on'] + 'T00:00:00Z' for f in facts if f.get('connected_on')] or [iso(datetime.now(timezone.utc))])
    rows = []
    for f in facts:
        lab = labels.get(f['contact_id']) if f['msgs'] else None
        if lab:
            if lab.get('status') not in STATUSES or not isinstance(lab.get('reply_needed'), bool):
                sys.exit('bad label for %s: status or reply_needed' % f['contact_id'])
            if lab.get('met_on') is not None and not DAY.match(str(lab['met_on'])):
                sys.exit('bad met_on for %s' % f['contact_id'])
            note = re.sub(r'\s+', ' ', str(lab.get('note') or '')).strip()
            if len(note.split()) > 15 or EMAIL.search(note) or PHONE.search(note):
                sys.exit('note for %s is over 15 words or holds an email address or phone number' % f['contact_id'])
        if f['msgs'] and not lab:
            sys.exit('contact %s has messages but no label: review it first' % f['contact_id'])
        row = {k: f[k] for k in ('contact_id', 'msgs', 'ours', 'theirs', 'first', 'last', 'last_in', 'last_out', 'last_from',
                                  'invited_at', 'invite_note', 'connected_on', 'actual')}
        row.update({'status': lab['status'] if lab else ('none' if not f['msgs'] else None), 'reply_needed': bool(lab and lab['reply_needed']),
                    'met_on': lab.get('met_on') if lab else None, 'note': note if lab else None, 'reviewed': bool(lab), 'as_of': as_of})
        rows.append(row)
    with open(d + '/li_dm.json', 'w') as fh:
        json.dump(rows, fh)
    if os.path.exists(d + '/outreach_raw.json'):
        os.replace(d + '/outreach_raw.json', d + '/li_outreach.json')
    if not os.path.exists(d + '/li_outreach.json'):
        sys.exit('no outreach data: run inputs first')
    print('li_dm rows %d (reviewed %d, reply needed %d); outreach months %d'
          % (len(rows), sum(r['reviewed'] for r in rows), sum(r['reply_needed'] for r in rows),
             len(json.load(open(d + '/li_outreach.json')))))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'inputs':
        inputs(sys.argv[2].rstrip('/'), sys.argv[3].rstrip('/'))
    elif len(sys.argv) == 3 and sys.argv[1] == 'build':
        build(sys.argv[2].rstrip('/'))
    else:
        sys.exit(__doc__)
