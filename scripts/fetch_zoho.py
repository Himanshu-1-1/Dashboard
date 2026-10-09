#!/usr/bin/env python3
"""Pull the Campaign Command Center datasets from Zoho CRM and write site/data.js.

Runs in GitHub Actions once a day. Uses only the Python standard library.

Required environment variables:
  ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
Optional (defaults are Zoho's US data center, which crm.zoho.com uses):
  ZOHO_ACCOUNTS_URL  default https://accounts.zoho.com
  ZOHO_API_DOMAIN    default https://www.zohoapis.com
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

PAGE_SIZE = 2000
MAX_ROWS = 100_000
RETRIES = 4

QUERIES = {
    'rp_contacts': {"sql": "select COUNT(id), LI_Connect, Priority, Total_Meetings_Created from Contacts where Relationship_Type like '%Referral Partner%' group by LI_Connect, Priority, Total_Meetings_Created", "paged": False},
    'fn_contacts': {"sql": "select COUNT(id), LI_Connect, Priority, Total_Meetings_Created from Contacts where Relationship_Type like '%Founder Network%' group by LI_Connect, Priority, Total_Meetings_Created", "paged": False},
    'icp_contacts': {"sql": "select COUNT(id), LI_Connect, Priority, Total_Meetings_Created from Contacts where ((Account_Name.Priority is not null and Priority in ('1','3','5')) and Relationship_Type is null) group by LI_Connect, Priority, Total_Meetings_Created", "paged": False},
    'icp_accounts': {"sql": 'select COUNT(id), Priority from Accounts where Priority is not null group by Priority', "paged": False},
    'deals': {"sql": 'select Deal_Name, Stage, Amount, Lead_Source, Account_Name, Account_Name.Priority, Contact_Name, Contact_Name.Relationship_Type, Created_Time, Modified_Time from Deals where id is not null order by Modified_Time desc', "paged": True},
    'open_tasks': {"sql": "select Subject, Due_Date, Status, Owner, Who_Id, Who_Id.Relationship_Type from Tasks where Status != 'Completed' order by Due_Date asc", "paged": True},
    'fn_people': {"sql": "select Full_Name, Account_Name, Priority, LI_Connect, Assigned, Total_Meetings_Created from Contacts where (Relationship_Type like '%Founder Network%' and Priority in ('1','3')) order by Priority asc", "paged": True},
    'met_contacts': {"sql": 'select Full_Name, Account_Name, Account_Name.Priority, Relationship_Type, Priority, LI_Connect, Assigned, Total_Meetings_Created from Contacts where Total_Meetings_Created is not null order by Total_Meetings_Created desc', "paged": True},
    'referral_links': {"sql": "select Referred_By_Contact, Referred_By_Account from Deals where ((Referred_By_Contact is not null or Referred_By_Account is not null) and (Deal_Type not like '%Referral Partner%' and Deal_Type not like '%Platform Provider%'))", "paged": True},
    'meetings': {"sql": "select Event_Title, Start_DateTime, Who_Id, Who_Id.Relationship_Type, Who_Id.Priority from Events where Start_DateTime >= '2026-08-17T00:00:00-05:00' order by Start_DateTime asc", "paged": True}
}


def env(name, default=None, required=False):
    value = os.environ.get(name, "").strip() or default
    if required and not value:
        sys.exit(f"Missing required environment variable {name}. Add it as a GitHub Actions secret.")
    return value


def request(url, *, data=None, headers=None, method="GET"):
    """HTTP request with retries on rate limits and server errors. Returns (status, body_text)."""
    body = None
    if data is not None:
        body = data if isinstance(data, bytes) else json.dumps(data).encode("utf-8")
    for attempt in range(1, RETRIES + 1):
        req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.status, resp.read().decode("utf-8")
        except urllib.error.HTTPError as err:
            text = err.read().decode("utf-8", errors="replace")
            if err.code in (429, 500, 502, 503, 504) and attempt < RETRIES:
                time.sleep(2 ** attempt)
                continue
            return err.code, text
        except urllib.error.URLError as err:
            if attempt < RETRIES:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"Network error calling {url}: {err.reason}") from err
    raise RuntimeError(f"Gave up calling {url}")


def access_token(accounts_url, client_id, client_secret, refresh_token):
    params = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
    }).encode("utf-8")
    status, text = request(f"{accounts_url}/oauth/v2/token", data=params,
                           headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = {}
    if status != 200 or "access_token" not in payload:
        sys.exit(f"Zoho refused the refresh token (HTTP {status}): {payload.get('error', text[:300])}. "
                 "Check ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_REFRESH_TOKEN, and the data center URLs.")
    return payload["access_token"]


def coql(api_domain, token, sql):
    status, text = request(f"{api_domain}/crm/v7/coql", data={"select_query": sql},
                           headers={"Authorization": f"Zoho-oauthtoken {token}", "Content-Type": "application/json"},
                           method="POST")
    if status == 204 or not text.strip():
        return [], False
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError(f"Zoho returned a non-JSON answer (HTTP {status}): {text[:300]}")
    if status != 200:
        raise RuntimeError(f"Zoho rejected the query (HTTP {status}): {payload.get('code')} {payload.get('message')}")
    info = payload.get("info") or {}
    return payload.get("data") or [], bool(info.get("more_records"))


def redact_unlinked_meetings(rows):
    """The site is public and the calendar also holds personal events. A meeting with no
    contact linked can't be credited to a campaign, so publish it without its title."""
    for row in rows:
        if not row.get("Who_Id"):
            row["Event_Title"] = "Meeting (no contact linked)"


def run_query(api_domain, token, sql, paged):
    if not paged:
        rows, _ = coql(api_domain, token, sql)
        return rows, False
    rows, offset = [], 0
    while True:
        page, more = coql(api_domain, token, f"{sql} limit {offset}, {PAGE_SIZE}")
        rows.extend(page)
        offset += len(page)
        if not more or not page:
            return rows, False
        if offset >= MAX_ROWS:
            return rows, True


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default="site/data.js", help="where to write the data file")
    args = parser.parse_args()

    accounts_url = env("ZOHO_ACCOUNTS_URL", "https://accounts.zoho.com").rstrip("/")
    api_domain = env("ZOHO_API_DOMAIN", "https://www.zohoapis.com").rstrip("/")
    token = access_token(accounts_url,
                         env("ZOHO_CLIENT_ID", required=True),
                         env("ZOHO_CLIENT_SECRET", required=True),
                         env("ZOHO_REFRESH_TOKEN", required=True))

    datasets, failures = {}, []
    for name, spec in QUERIES.items():
        try:
            rows, cut = run_query(api_domain, token, spec["sql"], spec["paged"])
        except RuntimeError as err:
            failures.append(f"{name}: {err}")
            continue
        if name == "meetings":
            redact_unlinked_meetings(rows)
        datasets[name] = {"status": "success", "data": {"data": rows, "info": {"count": len(rows), "more_records": cut}}}
        print(f"{name}: {len(rows)} rows{' (cut short)' if cut else ''}")

    if failures:
        sys.exit("Some queries failed, so the site was not updated:\n  " + "\n  ".join(failures))

    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "datasets": datasets}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    payload = json.dumps(out, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("window.__DASH_DATA__ = " + payload + ";\n")
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
