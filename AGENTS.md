# BTLbro — Architecture Guide

Monorepo with two separate packages: a **Vite React frontend** (repo root) and an
**Express API server** (`server/`). Business: BTL (below-the-line) hyperlocal
marketing agency. Google Sheets is the source of truth for location/catchment
data, synced into a local JSON "database" that the public marketing tool and
checkout consume.

## How to run

- Frontend: `npm run dev` (root) → http://localhost:5173 (Vite proxies `/api` → :8081)
- Server: `npm run dev` in `server/` (needs `server/.env`, see `.env.example`)
- Test: `node sheetSync.test.mjs` in `server/` (mocks Google's CSV export; never touches real db.json)
- There is no shared root package.json/node_modules — root and `server/` are independent.

## Tech stack

- Frontend (root): React 18, react-router-dom, lucide-react, leaflet (used directly, no react-leaflet), Vite 5. No state library — plain `useState` + `sessionStorage`. Style is inline CSS objects / scoped CSS-in-JS.
- Server: Express 4, lowdb 5 (JSON file DB), googleapis, xlsx, csv-parse, node-cron, multer.

## Frontend — routing (main.jsx)

Path-based manual router (NOT react-router routes):
- `/`            → `BTLbroLanding (1).jsx` — public marketing site
- `/admin`       → `AdminPanel.jsx` — admin dashboard
- `/customize`   → `CustomerForm.jsx` — campaign request form
- `/checkout`    → `QuickCheckout.jsx` — 3-step payment checkout

### Public site
`BTLbroLanding` renders `IntroScreen` (once per session, splash), `Navbar`,
then either the landing sections or `MarketingTool` (tab-switched via
`activeTab`). Landing is fully static/hardcoded — no API calls. `OrbitHero` is
imported but unused (kept as a backup to an inline Hero).

### MarketingTool.jsx (user-facing core)
Search pincode/city → Leaflet map → radius-filtered catchment POIs (from synced
sheet data) → per-place/per-service selection → handoff to checkout.
- Reads: `GET /api/admin/google-drive/files`, `GET .../data/{fileId}?limit=1000`; search geocoded via `/api/places/geocode`.
- Google Places integration: suggestions (`/api/places/autocomplete`), search
  geocoding (`/api/places/geocode`), and **Nearby** places (`/api/places/nearby`)
  merged into the POI list. Nearby places (not in our sheet) are marked
  `onRequest` and **are selectable** — they flow to checkout tagged
  `source: 'from google'` (price shows "On request").
- **The searched centre point is itself a selectable place.** A synthetic POI
  (`id: 'searched_center'`, `type: 'your_location'`, `isCenter: true`) is
  prepended to `pois` so the user can buy services for the location they
  searched. It is `onRequest`, always passes the catchment filter (map + list),
  renders as the centre dot (skipped in the shape-marker loop and legend), and
  borrows `serviceColumns`/`columnsForPoi`. Its selection is cleared whenever
  the search point changes (`clearCenterSelection`).
- State persisted in `sessionStorage` keys prefixed `mt_`; writes `btl_checkout_data` + `btl_checkout_pincode` for `QuickCheckout`.
- Dedupes records by type+name, Haversine distance filter, Excel/CSV export.

### QuickCheckout.jsx (purchase)
3 steps (Details → Payment → Done). Reads pricing from `GET /api/settings`,
location data from Drive files (fallback), writes the order via `POST /api/orders`.
Computes: per-location cost + per-service promos + agency fee % + 18% GST.
Normalizes both legacy flat promo columns and new multi-tab `services` map.
Fake payment (2s timeout).

### CustomerForm.jsx
Campaign customization request form → `POST /api/orders` (status pending). Client-side validation only.

### AdminPanel.jsx (admin dashboard, ~2200 lines, monolith)
Sidebar tabs: dashboard, campaigns (mock, no CRUD), orders, locations, uploads,
drive (delegates to `GoogleDriveTab`), analytics (placeholder), settings.
- Google Drive / sheet data API prefix: `/api/admin/google-drive` (const `DRIVE_API`).
- Orders: `GET/POST/PUT/DELETE /api/orders`; settings: `GET/PUT /api/settings`.
- Admin login is hardcoded (`admin` / `admin123`).
- Merge of two sources: in-memory CSV uploads (`uploadedData`, lost on refresh) + server-side Drive records (`driveRecords`, `_source: 'drive'`).
- One-time migration: legacy `btl_submissions` from localStorage posted to server.
- Optimistic UI — local state mutated + fire-and-forget fetch.

### GoogleDriveTab.jsx (inside AdminPanel)
Manage sheet connection + sync. Uses `/api/admin/google-drive/*`,
`/api/admin/sync-google-sheet`, `/api/admin/preview-google-sheet-sync`,
`/api/admin/sheet-sync/status`. Current layout: **Card 1 "Google Sheet & Drive
Sync"** = 2-col grid (Master Sheet pills + Preview/Sync left, Drive Connection
right), sync-result/validation panels below full-width; **Card 2 "Sync
Overview"** = 3-col StatPill grid (Synced Files / Last Sync / Backfill) whose eye
icons open a **modal with tabs** (Sync History, Backfill Queue). File data
viewer is a modal (`showFileModal`), not inline. Shared `StatPill` component;
auto-sync toggle persists immediately; file-data search debounced 300ms; CSV
export prepends UTF-8 BOM; responsive `.gd-2col`/`.gd-3col` collapse under
1100px.

### WebsiteTab.jsx (inside AdminPanel)
Website CMS: `getContent`/`saveBlock`/`uploadImage`/products CRUD from api.js.
**3-col layout** (comment previously said "4-column" — it's `180px 1fr 1fr`):
col1 = section list (search-filterable, ~21 `SECTION_PRESETS`), col2 =
`FieldsEditor`, col3 = sticky **LivePreview**. Fields and preview share equal
width (`1fr 1fr`) so the page stays balanced. Also has a Products & Pricing
sub-view (`activeView` toggle).

**UX rules to keep:**
- **Live preview: fields render in the preview WITHOUT saving.** Parent holds
  `drafts` keyed by section; `FieldsEditor` is controlled (`value`/`onChange`),
  `onChange` forwards `toDraftShape(next, section)` (json_array fields parsed to
  arrays, invalid JSON left as string while typing). `currentContent =
  drafts[activeSection] || content[activeSection]`. Save clears the draft.
  Switching sections keeps unsaved drafts (keyed column).
- **Field order mirrors the preview layout** (e.g. hero shows `hero_image` first
  to match image-at-top preview). When adding/changing a preset field, check the
  LivePreview render order first.
- Section list dot: green = saved data, orange = unsaved draft.
- `ImageUpload` (from api.js) is separate from the public site's uploader.

## Admin design language (apply to ANY admin tab)
Warm Neutrals, NOT generic grays: borders `#E7E2D8`, fills `#FAF9F7`, text
`#161616/#4A4A4A/#949494`, accent `#F2701D` (buttons/focus), radius 8–14,
Inter 11–14px. Green `#10B981` for success, amber `#FEF3C7/#B45309` for unsaved.
Avoid `#EEE/#F0F0F0/#111/#333/#888/#999` gray fills. Toast/banner instead of
`alert()` where feasible; empty states styled, not bare lines.

## Server — API (index.js)

Mounts (CORS allows localhost:5173/3000, JSON body):
- `/api/health` — liveness
- `/api/admin/google-drive` — `adminAuth` → googleDrive.js
- `/api/admin` — `adminAuth` → sheetSync.js, plus status
- `/api/orders` — orders.js (no auth)
- `/api/settings` — settings.js (no auth)
- `/api/recee` — recee.js (staff) — site surveys: create request → assign to a
  recee exec → capture (geo/photos/prices) → verify within 200m → promote the row.
- `/api/places` — places.js (no auth) — Google Places proxies for the MarketingTool, key in `server/.env` `GOOGLE_MAPS_API_KEY`, never exposed to browser:
  - `GET /autocomplete?input=` — Places (New) Autocomplete suggestions (biased to India)
  - `GET /geocode?input=` — places/PIN query → `{lat,lng}` (replaces Nominatim)
  - `GET /nearby?lat&lng&radius&types=` — Places Nearby Search → places around a point

`adminAuth` only enforces a `Bearer ADMIN_PASSWORD` header when `NODE_ENV=production`.

### DB layer (db.js)
lowdb JSON file at `server/data/db.json`, `dbHelpers` object (SQL-ish) over a single in-memory `db.data`. Collections: `integration` (connection/config), `files` (synced spreadsheets), `records` (location rows), `sync_history`, `sync_errors`, `orders`, `settings`. Records have `data.is_active` for soft delete (see sync).

### Companies vs Accounts — TWO SEPARATE TABS, do not conflate

| Tab | Route | Owns |
|---|---|---|
| **Companies** | `routes/companies.js` | The customer *relationship*: business records, representative, leads, chat, calls, notes, activity timeline |
| **Accounts** | `routes/upiPayments.js` + `companies.js` | The *money*: ledger, reconciliation, outstanding, which company a movement belongs to |

A company is a *customer business*, not BTLbro itself. Leads are the individual
campaigns a company submits; chat/notes roll up under it. **The Companies
timeline must NOT include payment events** — reconciliation is Accounts' job.

- Companies auto-create from `lead.businessName` on every lead insert (checkout
  **and** the public `POST /api/leads`), then dedupe on `name_key`.
- `name_key` (`dbHelpers.companyKey`) lowercases, strips punctuation and common
  legal suffixes (pvt/ltd/llp/co/…). It is deliberately **not** fuzzy — "Cafe
  Coffee" and "Cafe Cofee" stay separate. First name seen wins as the display
  name; contact fields are only filled when blank, so a later lead never
  silently swaps the representative.
- Legacy leads are backfilled lazily by `backfillCompanies()` on first read of
  `/api/leads` or `/api/admin/companies`. It is idempotent.
- **The Companies timeline is synthesised server-side from every store** —
  leads, notes, `conversations[].messages[]` and `activities[]`. Never build it
  from `lead.activities[]` alone: that array truncates chat to 50 chars and
  never held notes or assignment events.
- Linking a movement to a company is **explicit only** (`PUT
  /api/admin/payments/ledger/:id { company_id }`, validated 400 on a bad id).
  The companies API still returns an *inferred* rollup by `counterparty_name`
  in `inferred_payment_ids` for reference only — it is never written back.
- Renaming a company onto an existing one returns **409** — merging is a
  deliberate separate operation, never a side effect of an edit.
- Access: Companies = `bd_executive` (own leads) + `manager`/`bdm`/`ops_manager`/
  `super_admin`. Accounts = `PAYOUT_ROLES` (manager/bdm/ops_manager/super_admin).
  Do **not** use the level-based `requireManager` for either — it would admit
  `recee_manager`/`ops_executive`, which the APIs reject. The AdminPanel/Sidebar
  gates mirror these lists exactly.

## Google Sheet sync (the heart — services/sheetSync.js)

Flow: **fetch → parse → validate ALL → diff → single atomic write → history.**
The sheet is the master source of truth; removed rows are deactivated
(`is_active=false`), never hard-deleted. One `db.write()` at the end = the
transaction boundary (nothing persists if it fails).

1. **Resolve source**: `GOOGLE_SHEET_ID` env > admin's connected URL. Sheet id
   from URL regex, gid from env/URL.
2. **Fetch**: preferred `fetchWorkbook` (XLSX, all tabs = catchments) with
   fallback to `fetchSheetCsv` (single-tab CSV). Two Google endpoints (export +
   gviz) with retry/backoff for throttling. 20-30s timeouts. Non-public sheets
   → `SheetSyncError('permission')`.
3. **Parse**: `spreadsheetParser.js` — `parseWorkbook` (multi-tab, two-row header:
   tab name = type, row-1 = service names, GMaps link → lat/lng or query for
   geocoding) / `parseSpreadsheetCSV` (legacy flat single-tab). Prices always
   stored as numbers (₹10,000 → 10000). `sheet_id` = external unique key.
4. **Geocode**: `geocode.js` — Nominatim, rate-limited (~1 req/s), cached forever
   in `services/data/geocode-cache.json`; failures retry after 24h. Budgeted per
   sync (120s manual / 45s scheduled); previously-geocoded coords are preserved
   from DB before diff.
5. **Validate**: all rows upfront. Errors on missing/duplicate `sheet_id`, name,
   invalid PIN code (6-digit), negative prices/distances/services. Any error →
   stop, DB untouched. `validateRecords` returns errors + warnings.
6. **Diff**: `computeDiff` compares against ACTIVE db records by `sheet_id`
   (add / update / unchanged / deactivate / reactivate) across `DIFF_FIELDS`.
7. **Apply**: `applyDiff` mutates in memory, one atomic `write()`.
8. **History**: every run recorded in `sync_history` (add / preview / success /
   validation_failed / failed).

Errors: `sheetSyncError.js` `SheetSyncError(kind, msg)`; routes map `kind` → HTTP
(`config`→400, `permission`→400, `sheet_not_found`→404, `empty_sheet`→400,
`timeout`→504, `network`/`google_api`→502).

### Scheduler (scheduler.js)
node-cron, every minute, checks `auto_sync_enabled` + elapsed `sync_frequency`
(5/15/30/60/1440 min) → `syncSheet({ triggerType: 'scheduled' })`.

### Google Drive OAuth (googleDriveService.js)
Optional OAuth2 flow for real Drive folder sync (read-only scopes). When no
`GOOGLE_CLIENT_ID/SECRET` set, it degrades: spreadsheets use the public-CSV
path; otherwise demo mode with generated sample data.

## Key domain concepts / gotchas

- **Catchments** = tabs in the master workbook (e.g. "cafe", "metro station"),
  each with per-service prices. Tab name becomes the record `type`.
- **Sheet is master** — manual DB edits get overwritten on next sync.
- **Records dedupe** by `sheet_id` (constructed as `type | name` when no ID col).
- **Prices** are always numbers; flat columns (`digital_promotion`, etc.) are the
  legacy layout vs the newer `services` map.
- CSV uploads in AdminPanel are **not persisted** server-side (in-memory only);
  only Drive/sheet synced data and orders persist.
- Checkout/form → orders; admin modifies order status via PUT.

## Recee / site surveys — Data assignment IS the recee assignment

The Data tab (`DataTab.jsx` → `POST /api/admin/records/assign`) is where a recee
manager assigns a location to a recee. That call does **both**:
  1. stamps the `records` row (`assigned_to/_name`, `recee_status='pending'`), and
  2. creates (or re-points) a matching `site_surveys` request so it appears on
     that recee's screen.
The two collections are otherwise separate — the recee screen reads only
`site_surveys`, so without step 2 a Data-tab assignment would never reach them.
Only `recee`/`recee_manager` assignees get a request (nobody else can action it).
Completing a survey (`applySurveyToRecord`) flips the row's `recee_status` to
`done` and `needs_recee=false`, so the Data tab stops showing it pending.
