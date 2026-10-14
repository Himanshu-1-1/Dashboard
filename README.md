# Campaign Command Center

A daily dashboard for the three outreach campaigns run by True Lean Solutions and TechTranspire: the **B2B Campaign** (referral partners), **ICP Prospecting** and the **Founder Network**. It also covers referrals (who sent us which client), the Box Byte lead-generation partnership, and the full deal pipeline.

Every day at **6:00 PM IST** (7:30 AM Central during daylight time, 6:30 AM in standard time), a GitHub Actions job pulls the numbers from Zoho CRM, saves them as `data.js`, and publishes the site to GitHub Pages. The data file is never committed to this repo. It exists only in the deployed site.

> **Privacy:** this site is public. Anyone who has the link can see client names, deal titles and amounts. Passcode encryption is the planned next step; until then, share the link only with people who should see CRM data.

## What's on the page

| Tab | What it answers |
|---|---|
| Overview | The backlog for B2B, ICP and Founder Network at the top, then every 2026 target against today's pace and meetings per week |
| B2B Campaign | Partner prospects through to signed referral agreements and referred deals |
| Referrals | Which partner referred which client deal, and whether the partner's agreement is signed |
| ICP Prospecting | Executives at target accounts from LinkedIn invite through meetings and deals |
| Founder Network | Priority contacts with or without a next step, and the opportunities they've produced |
| Box Byte | Box Byte's leads through Zoho (connected, met, deals), leads by LinkedIn profile, and the latest batch file's drafted messages and held prospects |
| Medical Courier | Courier accounts, email outreach from the prospects sheet, and courier deals |
| Deals | Every deal on a board by stage (open stages, then won and lost), win rate, time since last update, loss reasons, deals by month created and data-quality gaps, filtered by Deal Type |
| Pipeline | Every deal by stage, campaign and month created, with search |

Every chart is clickable and opens the records behind it. Each campaign tab also has a **Backlog** card listing where that campaign is behind (red = lapsed or overdue, amber = waiting on us); select any item to see the records by name. Names, companies, deals and tasks in these lists open the record in Zoho CRM.

## One-time setup

### 1. Turn on GitHub Pages
Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.

### 2. Create a read-only Zoho API client
1. Sign in to <https://api-console.zoho.com> with a Zoho CRM admin account.
2. **Add Client → Self Client → Create**. Copy the **Client ID** and **Client Secret**.
3. Open the **Generate Code** tab:
   - Scope: `ZohoCRM.coql.READ,ZohoCRM.modules.READ`
   - Time duration: 10 minutes
   - Description: `Campaign dashboard (read-only)`
   - Click **Create** and choose the TechTranspire CRM org. Copy the code it shows.
4. Within 10 minutes, swap the code for a refresh token:

   ```bash
   curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
     -d "grant_type=authorization_code" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "code=THE_CODE_YOU_COPIED"
   ```

   The response contains `refresh_token`. It doesn't expire unless revoked, and it can only read data.

### 3. Add the secrets to GitHub
Repo **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `ZOHO_CLIENT_ID` | Client ID from step 2 |
| `ZOHO_CLIENT_SECRET` | Client Secret from step 2 |
| `ZOHO_REFRESH_TOKEN` | `refresh_token` from step 2 |

The org uses Zoho's US data center (`crm.zoho.com`), which is the default. For another data center, add **variables** (not secrets) `ZOHO_ACCOUNTS_URL` and `ZOHO_API_DOMAIN`, for example `https://accounts.zoho.in` and `https://www.zohoapis.in`.

### 4. Run it once
**Actions → Refresh dashboard → Run workflow**. When it finishes, the site is live at `https://<owner>.github.io/<repo>/`. After that it refreshes every day at 6:00 PM IST on its own, and on every push to `main`.

## Running locally

```bash
export ZOHO_CLIENT_ID=... ZOHO_CLIENT_SECRET=... ZOHO_REFRESH_TOKEN=...
python3 scripts/fetch_zoho.py
python3 -m http.server --directory site 8000
# open http://localhost:8000
```

`site/data.js`, `site/boxbyte.js` and `site/courier.js` are git-ignored. Never commit them. Because the data loads as a script, you can also just double-click `site/index.html` after running the fetch.

## How the numbers are counted

- **B2B Campaign:** contacts whose Relationship Type includes *Referral Partner*. Partnership deals are deals named as a referral, partner or platform agreement.
- **Founder Network:** contacts whose Relationship Type includes *Founder Network*. Opportunities are client deals with one of these contacts. Next steps are their open Zoho tasks.
- **ICP Prospecting:** contacts at an account with a Priority set, with their own Priority 1, 3 or 5 and no relationship tag.
- **Referrals:** client deals with *Referred By Contact* or *Referred By Account* filled in (Commission Details section on the deal; a deal counts once even when both are filled), plus deals marked *External Referral* that have no referrer recorded yet.
- **Campaign membership:** B2B is contacts tagged *May 2026 - 100 B2B*; ICP is contacts and accounts tagged *2026ICP*; Founder Network is Relationship Type = Founder Network; Medical Courier is accounts tagged *2026MedicalCourier* and their contacts and deals. Priority 9 and 11 are left out of every campaign, and Founder Network wins over any tag. Deals are sorted by Deal Type: Reseller/ Referral Partner, Platform Provider Agreement, or client work.
- **Medical Courier email outreach:** the initial emails went to company addresses with no contact in Zoho, so emailed, followed up and replied come from the Medical Courier prospects sheet, stored as `courier.js` on the `courier-snapshot` branch.
- **Box Byte:** live counts come from contacts tagged *BoxByte* in Zoho. The LinkedIn profile each lead came through, the drafted messages and the held prospects come from Box Byte's latest batch file, stored as `boxbyte.js` on the `boxbyte-snapshot` branch.
- **Meetings:** Zoho Meetings linked to a contact. A meeting with no contact attached can't be credited to a campaign, and because the calendar also holds personal events, it's published without its title.
- **Backlog:** agreements come from Zoho Sign (referral agreements and the Akhani MNDA). A party counts as signed once any copy is signed; otherwise the newest copy decides between out for signature and expired. Recalled, draft and internal test sends are ignored. Overdue tasks are open Zoho tasks past their due date, credited to their contact's campaign. A deal is stale when it is open and hasn't been updated for 14 days or more.
- **Targets:** from the 2026 campaign tracking sheets. The pace line assumes the campaigns run Aug 17 to Dec 18, 2026.

## Things to know

- Until the three Zoho secrets are added, the job publishes the one-off snapshot stored on the `data-snapshot` branch and shows a warning in the run. Once the secrets are in, it pulls live data and the snapshot branch can be deleted.
- **New copy of the courier prospects sheet:** rebuild `courier.js` from the workbook (phase sheets with Company and Email sent columns) and force-push it as the single commit on the `courier-snapshot` branch, then run the workflow. Only company names and the emailed / followed up / replied flags are published.
- **New Box Byte batch file:** rebuild `boxbyte.js` from the workbook (sheets *Leads*, *SEND* and *HELD*) and force-push it as the single commit on the `boxbyte-snapshot` branch, then run the workflow. Message text is published; links, sourcing URLs and review notes are left out.
- If any Zoho query fails, the job stops and the site keeps yesterday's data. The failed run shows in the **Actions** tab with Zoho's error.
- GitHub can start scheduled runs a few minutes late, and it pauses schedules on repos with no activity for 60 days. A push or a manual run turns the schedule back on.
- To change the refresh time, edit the `cron` line in `.github/workflows/refresh.yml`. It's in UTC: `30 12 * * *` is 6:00 PM IST.
