# Campaign Command Center

Static campaign dashboard for True Lean Solutions / TechTranspire, published to GitHub Pages and refreshed daily from Zoho CRM.

## Layout
- `site/boxbyte.js` (`window.__BOXBYTE__`): the latest Box Byte batch file (datasets `boxbyte_leads`, `boxbyte_messages`, `boxbyte_held`), kept on the orphan `boxbyte-snapshot` branch and copied in by the workflow. The data layer merges its datasets into `data.js`'s.
- `site/courier.js` (`window.__COURIER__`): the Medical Courier prospects sheet (datasets `courier_sends`, `courier_file`), kept on the orphan `courier-snapshot` branch and copied in by the workflow. Company names and outreach flags only.
- `scripts/fetch_zoho.py`: pulls the datasets from Zoho CRM via COQL (`/crm/v7/coql`) and writes `site/data.js` (`window.__DASH_DATA__ = {...}`, loads from file:// and Pages alike). Python standard library only; no dependencies.
- `site/index.html`: the whole page (styles, data layer, charts). d3 v7.9.0 comes from cdnjs; everything else is inline.
- `.github/workflows/refresh.yml`: runs the fetch at 02:30 UTC (8:00 AM IST), on push to `main` and on demand, then deploys `site/` with `actions/deploy-pages`.

## Commands
- Fetch data: `python3 scripts/fetch_zoho.py` (needs `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`)
- Serve locally: `python3 -m http.server --directory site 8000`

## How the page is built
- The page code talks to a small `window.dash` data layer at the top of `index.html`: `dash.loader` turns each raw Zoho answer into rows, `dash.calc` derives values from datasets, `dash.data(id)` reads them, and `dash.onData(fn)` redraws.
- Dataset IDs in `QUERIES` (fetch script) must match the `dash.loader(...)` IDs in the page.
- Campaign membership: B2B tag `May 2026 - 100 B2B`, ICP tag `2026ICP` (contacts and accounts), Founder Network by Relationship Type, Medical Courier account tag `2026MedicalCourier`. Priority 9/11 excluded everywhere; Founder Network wins over tags. The tag constants live in `fetch_zoho.py` and `CC_RULES` in the page; keep them in step. Deals are sorted by Deal Type (`CC_RULES.dealKind`). Campaign tabs and the Overview's monthly bars count the open pipeline only (Identify, Discovery, Proposals, Hold; `CC_RULES.isOpen`); B2B leaves out lost agreements but keeps signed ones (`CC_RULES.notLost`). The Pipeline tab shows every deal.
- Every number on the page comes from a dataset or a `dash.calc`; don't hard-code figures in markup. Targets are constants inside the `funnel` calc.
- Colors and spacing are CSS custom properties defined once in `:root`, with dark-mode values.

## Hard constraints
- Never commit `site/data.js`, `site/boxbyte.js`, `site/courier.js` or any Zoho credentials to `main`. The `courier-snapshot` branch (orphan, single commit, force-pushed) never carries email addresses, phone numbers or people's names. The `boxbyte-snapshot` branch (orphan, single commit, force-pushed) holds the Box Byte batch file; it never carries LinkedIn/Sales Navigator URLs or review notes. Secrets live in GitHub Actions secrets only. The `data-snapshot` branch (orphan, single commit, force-pushed) is a stopgap used only while the secrets are missing.
- Meetings with no linked contact are published without titles (`redact_unlinked_meetings`); the calendar includes personal events.
- The Zoho client is read-only (`ZohoCRM.coql.READ,ZohoCRM.modules.READ`). Don't add write scopes.
- The site is public; planned next step is passcode encryption of `data.js` in the workflow.
- Dates display in Central time (CT); the refresh schedule is stated in IST.
- US spelling throughout.
