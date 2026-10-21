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

# Campaign membership. Priority 9 (inactive) and 11 (do not contact) are left out of every campaign,
# and anyone whose Relationship Type includes Founder Network counts only in the Founder Network.
B2B_TAG = "May 2026 - 100 B2B"
ICP_TAG = "2026ICP"
COURIER_TAG = "2026MedicalCourier"
ACTIVE = "(Priority is null or Priority not in ('9','11'))"
NOT_FN = "(Relationship_Type is null or Relationship_Type not like '%Founder Network%')"

QUERIES = {
    'rp_contacts': {"sql": f"select COUNT(id), LI_Connect, Priority, Total_Meetings_Created from Contacts where ((Tag like '%{B2B_TAG}%' and {NOT_FN}) and {ACTIVE}) group by LI_Connect, Priority, Total_Meetings_Created", "paged": False},
    'fn_contacts': {"sql": f"select COUNT(id), LI_Connect, Priority, Total_Meetings_Created from Contacts where (Relationship_Type like '%Founder Network%' and {ACTIVE}) group by LI_Connect, Priority, Total_Meetings_Created", "paged": False},
    'icp_contacts': {"sql": f"select COUNT(id), LI_Connect, Priority, Total_Meetings_Created from Contacts where ((Tag like '%{ICP_TAG}%' and {NOT_FN}) and {ACTIVE}) group by LI_Connect, Priority, Total_Meetings_Created", "paged": False},
    'icp_accounts': {"sql": f"select COUNT(id), Priority from Accounts where (Tag like '%{ICP_TAG}%' and {ACTIVE}) group by Priority", "paged": False},
    'mc_accounts': {"sql": f"select COUNT(id), Priority from Accounts where (Tag like '%{COURIER_TAG}%' and {ACTIVE}) group by Priority", "paged": False},
    'mc_contacts': {"sql": f"select Full_Name, Account_Name, Priority, LI_Connect, Assigned, Relationship_Type, Total_Meetings_Created from Contacts where Account_Name.Tag like '%{COURIER_TAG}%' order by Full_Name asc", "paged": True},
    'deals': {"sql": 'select Deal_Name, Deal_Type, Stage, Amount, Lead_Source, Account_Name, Account_Name.Priority, Account_Name.Tag, Contact_Name, Contact_Name.Relationship_Type, Contact_Name.Priority, Contact_Name.Tag, Created_Time, Modified_Time, Reason_For_Loss__s, Next_Step, Priority, Last_Activity_Time, Completion_Date from Deals where id is not null order by Modified_Time desc', "paged": True},
    'open_tasks': {"sql": "select Subject, Due_Date, Status, Owner, Who_Id, Who_Id.Relationship_Type, Who_Id.Tag, Who_Id.Priority, What_Id from Tasks where Status != 'Completed' order by Due_Date asc", "paged": True},
    'sign_docs': {"sql": "select Name, zohosign__Document_Status, zohosign__Date_Sent, zohosign__Document_Deadline, zohosign__Date_Completed, zohosign__Contact, zohosign__Account, zohosign__Deal from zohosign__ZohoSign_Documents where (Name like '%Referral Partner Agreement%' or Name like 'Akhani%') order by zohosign__Date_Sent desc", "paged": True},
    'icp_account_list': {"sql": f"select Account_Name, Priority, Count_of_associated_Contacts, Industries, No_Of_employees from Accounts where (Tag like '%{ICP_TAG}%' and {ACTIVE}) order by Account_Name asc", "paged": True},
    'rp_backlog_people': {"sql": f"select Full_Name, Title, Account_Name, Priority, LI_Connect, Total_Meetings_Created, Last_Activity_Time from Contacts where (((Tag like '%{B2B_TAG}%' and {NOT_FN}) and {ACTIVE}) and (LI_Connect = 'Connected' and ((Total_Meetings_Created is null or Total_Meetings_Created = 0) or Priority is null))) order by Full_Name asc", "paged": True},
    'icp_backlog_people': {"sql": f"select Full_Name, Title, Account_Name, Account_Name.Industries, Account_Name.No_Of_employees, Priority, LI_Connect, Total_Meetings_Created, Last_Activity_Time from Contacts where (((Tag like '%{ICP_TAG}%' and {NOT_FN}) and {ACTIVE}) and (LI_Connect in ('Connected','Requested','Email Required') or (LI_Connect is null and Priority in ('1','3')))) order by Full_Name asc", "paged": True},
    'fn_backlog_people': {"sql": f"select Full_Name, Title, Account_Name, Priority, LI_Connect, Total_Meetings_Created, Last_Activity_Time from Contacts where (((Relationship_Type like '%Founder Network%' and {ACTIVE}) and LI_Connect = 'Connected') and (Total_Meetings_Created is null or Total_Meetings_Created = 0)) order by Full_Name asc", "paged": True},
    'mc_account_list': {"sql": f"select Account_Name, Priority, Count_of_associated_Contacts, Industries, No_Of_employees from Accounts where (Tag like '%{COURIER_TAG}%' and {ACTIVE}) order by Account_Name asc", "paged": True},
    'wi_icp_people': {"sql": f"select Full_Name, Title, Account_Name, LI_Connect, Total_Meetings_Created, Priority from Contacts where ((Tag like '%{ICP_TAG}%' and {NOT_FN}) and {ACTIVE}) order by Full_Name asc", "paged": True},
    'wi_icp_people_2': {"sql": f"select Full_Name, Title, Account_Name, LI_Connect, Total_Meetings_Created, Priority from Contacts where ((Tag like '%{ICP_TAG}%' and {NOT_FN}) and {ACTIVE}) order by id asc limit 2000, 2000", "paged": False},
    'wi_b2b_people': {"sql": f"select Full_Name, Title, Account_Name, Account_Name.Industries, Account_Name.No_Of_employees, Account_Name.Priority, Priority, LI_Connect, Total_Meetings_Created, Relationship_Type from Contacts where ((Tag like '%{B2B_TAG}%' and {NOT_FN}) and {ACTIVE}) order by Full_Name asc", "paged": True},
    'b2b_added': {"sql": f"select First_Name, Last_Name, Full_Name, Account_Name, LinkedIn, Assigned, Relationship_Type, Priority, Created_Time from Contacts where ((Tag like '%{B2B_TAG}%') and {ACTIVE}) order by Created_Time desc", "paged": True},
    'wi_introducers': {"sql": f"select Full_Name, Title, Account_Name, Account_Name.Industries, Account_Name.Billing_State, Industry, Relationship_Type, Tag, LI_Connect, Total_Meetings_Created, Last_Activity_Time, DO_NOT_CONTACT, Priority from Contacts where (Relationship_Type is not null and {ACTIVE}) order by Full_Name asc", "paged": True},
    'fn_people': {"sql": "select Full_Name, Account_Name, Priority, LI_Connect, Assigned, Total_Meetings_Created from Contacts where (Relationship_Type like '%Founder Network%' and Priority in ('1','3')) order by Priority asc", "paged": True},
    'met_contacts': {"sql": 'select Full_Name, Account_Name, Account_Name.Priority, Account_Name.Tag, Relationship_Type, Tag, Priority, LI_Connect, Assigned, Total_Meetings_Created from Contacts where Total_Meetings_Created is not null order by Total_Meetings_Created desc', "paged": True},
    'referral_links': {"sql": "select Referred_By_Contact, Referred_By_Account from Deals where ((Referred_By_Contact is not null or Referred_By_Account is not null) and (Deal_Type not like '%Referral Partner%' and Deal_Type not like '%Platform Provider%'))", "paged": True},
    'partner_agreements': {"sql": "select Deal_Name, Stage, Contact_Name, Account_Name from Deals where Deal_Type like '%Referral Partner%'", "paged": True},
    'boxbyte_contacts': {"sql": "select Full_Name, Account_Name, Title, LI_Connect, Total_Meetings_Created, Created_Time from Contacts where Tag like '%BoxByte%'", "paged": True},
    'b2b_meetings': {"sql": f"select Who_Id, Start_DateTime, End_DateTime, Meeting_Status from Events where Who_Id.Tag like '%{B2B_TAG}%' order by Start_DateTime asc", "paged": True},
    'meetings': {"sql": "select Event_Title, Start_DateTime, Who_Id, Who_Id.Relationship_Type, Who_Id.Priority, Who_Id.Tag from Events where Start_DateTime >= '2026-08-17T00:00:00-05:00' order by Start_DateTime asc", "paged": True}
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
