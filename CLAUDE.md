# Campaign Command Center

Static campaign dashboard for True Lean Solutions / TechTranspire, published to GitHub Pages and refreshed daily from Zoho CRM.

## Layout
- `scripts/fetch_zoho.py`: pulls the datasets from Zoho CRM via COQL (`/crm/v7/coql`) and writes `site/data.js` (`window.__DASH_DATA__ = {...}`, loads from file:// and Pages alike). Python standard library only; no dependencies.
- `site/index.html`: the whole page (styles, data layer, charts). d3 v7.9.0 comes from cdnjs; everything else is inline.
- `.github/workflows/refresh.yml`: runs the fetch at 02:30 UTC (8:00 AM IST), on push to `main` and on demand, then deploys `site/` with `actions/deploy-pages`.

## Commands
- Fetch data: `python3 scripts/fetch_zoho.py` (needs `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`)
- Serve locally: `python3 -m http.server --directory site 8000`

## How the page is built
- The page code talks to a small `window.dash` data layer at the top of `index.html`: `dash.loader` turns each raw Zoho answer into rows, `dash.calc` derives values from datasets, `dash.data(id)` reads them, and `dash.onData(fn)` redraws.
- Dataset IDs in `QUERIES` (fetch script) must match the `dash.loader(...)` IDs in the page.
- Every number on the page comes from a dataset or a `dash.calc`; don't hard-code figures in markup. Targets are constants inside the `funnel` calc.
- Colors and spacing are CSS custom properties defined once in `:root`, with dark-mode values.

## Hard constraints
- Never commit `site/data.js` or any Zoho credentials. Secrets live in GitHub Actions secrets only.
- The Zoho client is read-only (`ZohoCRM.coql.READ,ZohoCRM.modules.READ`). Don't add write scopes.
- The site is public; planned next step is passcode encryption of `data.js` in the workflow.
- Dates display in Central time (CT); the refresh schedule is stated in IST.
- US spelling throughout.
