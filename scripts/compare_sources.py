#!/usr/bin/env python3
"""Compare the same dataset as produced by two pipelines, so the changeover can be verified.

While collection moves from the dashboard's own scheduled tasks to the Chief of Staff feed, both produce
b2b_cal, b2b_ff and b2b_mail. This reports where they agree and where they differ, against the acceptance
rules agreed with the Chief of Staff side:

  b2b_cal  directional. The new source must find every prospect-day the old one found. Extras are expected
           (the feed sees meetings the agent search misses) and are listed so they can be spot-checked, not
           counted as failures. Coverage rows (at = null) must be present for every prospect the old source
           covered, because the page reads the presence of ANY row for a prospect as "the calendars were
           checked for them" (cal_checked) and would otherwise report every prospect without a meeting as
           never searched.
  b2b_ff   directional the same way, now that the bot carries an attended flag per participant: it must find
           every held prospect-day the old source found, and extras are listed for review. There are no coverage
           rows in this dataset, so the coverage check is not reported for it.
  b2b_mail equality, per prospect, on n_in, n_out, last_in, last_out and bounced. Valid only at the same
           mailbox scope: widening from four mailboxes to twelve makes equality meaningless.

Usage:
    python3 scripts/compare_sources.py b2b_cal  OLD NEW
    python3 scripts/compare_sources.py b2b_ff   OLD NEW
    python3 scripts/compare_sources.py b2b_mail OLD NEW

OLD and NEW are each either a .json file holding the dataset's rows, or one of the page's data files
(cal.js, ff.js, mail.js, or an opened sealed file) from which the named dataset is read. Nothing is written
and nothing is published; this only reads and reports. Exit status is 0 when the dataset passes.

Python standard library only.
"""

import json
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

CT = ZoneInfo('America/Chicago')
NOW = datetime.now(CT)


def ct_day(at):
    """The Central-time calendar day of a UTC timestamp, as the page counts days."""
    return datetime.fromisoformat(str(at).replace('Z', '+00:00')).astimezone(CT).strftime('%Y-%m-%d')


def is_past(at):
    return datetime.fromisoformat(str(at).replace('Z', '+00:00')).astimezone(CT) <= NOW


def load(path, dataset):
    """Rows of one dataset, from a plain .json list or from a window.__X__ = {...} data file."""
    text = open(path, encoding='utf-8').read()
    if text.lstrip().startswith('['):
        rows = json.loads(text)
        if not isinstance(rows, list):
            sys.exit(f'{path}: expected a list of rows')
        return rows
    start = text.find('{')
    if start == -1:
        sys.exit(f'{path}: no JSON object found')
    body = json.loads(text[start:text.rfind('}') + 1])
    if isinstance(body, list):
        return body
    sets = body.get('datasets', body)
    if dataset not in sets:
        have = ', '.join(sorted(sets)) or 'none'
        sys.exit(f'{path}: no dataset "{dataset}" (has: {have})')
    rows = sets[dataset]
    if not isinstance(rows, list):
        sys.exit(f'{path}: dataset "{dataset}" is not a list of rows')
    return rows


def days(rows, held_only):
    """{zoho_id: {CT day}} for what counts as a meeting, and the set of ids with any row at all."""
    seen, present = {}, set()
    for r in rows:
        zid = str(r.get('Zoho_Id') or '')
        if not zid:
            continue
        present.add(zid)
        at = r.get('at')
        if not at:
            continue
        if r.get('cancelled') is True or str(r.get('cancelled')).lower() == 'true':
            continue
        if held_only and r.get('held') is not True:
            continue
        if not is_past(at):
            continue
        seen.setdefault(zid, set()).add(ct_day(at))
    return seen, present


def report_days(old, new, label):
    held_only = label == 'b2b_ff'
    o_days, o_present = days(old, held_only)
    n_days, n_present = days(new, held_only)
    o_pairs = {(z, d) for z, ds in o_days.items() for d in ds}
    n_pairs = {(z, d) for z, ds in n_days.items() for d in ds}
    missing = sorted(o_pairs - n_pairs)
    extra = sorted(n_pairs - o_pairs)
    # Only b2b_cal carries coverage rows (at = null), so only b2b_cal can lose coverage. b2b_ff has a row only where
    # there was a call, and a prospect with no row has always meant "no recorded call", never "never searched".
    lost_coverage = sorted(o_present - n_present) if label == 'b2b_cal' else []

    print(f'{label}: {len(o_pairs)} prospect-days in OLD, {len(n_pairs)} in NEW')
    print(f'  agreed                     {len(o_pairs & n_pairs)}')
    print(f'  in OLD, not in NEW         {len(missing)}' + ('   <-- each one is a miss' if missing else ''))
    print(f'  in NEW, not in OLD         {len(extra)}' + ('   (expected; spot-check before trusting)' if extra else ''))
    if label == 'b2b_cal':
        print(f'  prospects with no row in NEW that OLD had   {len(lost_coverage)}'
              + ('   <-- breaks cal_checked' if lost_coverage else ''))

    for z, d in missing[:40]:
        print(f'    MISSING  {z}  {d}')
    if len(missing) > 40:
        print(f'    ... and {len(missing) - 40} more')
    for z, d in extra[:40]:
        print(f'    EXTRA    {z}  {d}')
    if len(extra) > 40:
        print(f'    ... and {len(extra) - 40} more')
    for z in lost_coverage[:40]:
        print(f'    NO ROW   {z}')

    ok = not missing and not lost_coverage
    print('  VERDICT: ' + ('passes' if ok else 'does not pass'))
    return ok


MAIL_COMPARED = ('n_in', 'n_out', 'last_in', 'last_out', 'bounced')


def report_mail(old, new):
    o = {str(r.get('Zoho_Id')): r for r in old if r.get('Zoho_Id')}
    n = {str(r.get('Zoho_Id')): r for r in new if r.get('Zoho_Id')}
    only_old = sorted(set(o) - set(n))
    only_new = sorted(set(n) - set(o))
    diffs = []
    for zid in sorted(set(o) & set(n)):
        for f in MAIL_COMPARED:
            a, b = o[zid].get(f), n[zid].get(f)
            if (a or None) != (b or None):
                diffs.append((zid, f, a, b))

    print(f'b2b_mail: {len(o)} prospects in OLD, {len(n)} in NEW')
    print(f'  only in OLD                {len(only_old)}' + ('   <-- each one is a miss' if only_old else ''))
    print(f'  only in NEW                {len(only_new)}')
    print(f'  field disagreements        {len(diffs)}')
    for zid, f, a, b in diffs[:60]:
        print(f'    {zid}  {f}: OLD {a!r}  NEW {b!r}')
    if len(diffs) > 60:
        print(f'    ... and {len(diffs) - 60} more')
    for zid in only_old[:40]:
        print(f'    ONLY OLD  {zid}')
    ok = not only_old and not diffs
    print('  VERDICT: ' + ('passes' if ok else 'does not pass'))
    if only_new:
        print('  Note: prospects only in NEW are fine on their own, but if the mailbox scope also widened,')
        print('        equality is not a valid test — compare at the same four mailboxes first.')
    return ok


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ('b2b_cal', 'b2b_ff', 'b2b_mail'):
        sys.exit(__doc__)
    dataset, old_path, new_path = sys.argv[1], sys.argv[2], sys.argv[3]
    old = load(old_path, dataset)
    new = load(new_path, dataset)
    print(f'OLD  {old_path}  ({len(old)} rows)')
    print(f'NEW  {new_path}  ({len(new)} rows)')
    print()
    ok = report_mail(old, new) if dataset == 'b2b_mail' else report_days(old, new, dataset)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
