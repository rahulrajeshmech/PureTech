# PureTech

Google Apps Script web app for an auto-parts warehouse, called **PureTech**: one web app and one
Google Sheet (also named PureTech) with three sections:

- **Returns**: the user types a part number, the tool searches the shared Gmail for supplier invoice
  PDFs containing it, they pick one, press RETURN, and the return is logged in the Sheet.
- **Receiving**: one card per Vast-Auto invoice email; after checking a delivery the receiver taps it, fixes
  the back orders read from the B/O column and adds missing/extra parts; problems are logged, ticked off
  (back orders automatically when a later invoice ships the part) and reported weekly.
- **Scheduling**: a weekly staff calendar (Full time / Part time / Driver, each with an icon and colour) with a minimum of
  each kind per weekday, a repeating master schedule, and dated days off / extra cover on top.

Everyone uses one shared PC and Google account; there are no logins or edit protection. The people
using it are not technical: keep the UI to big text, few choices, plain words. Never add steps or
settings to their screen without asking. The schedule must look like a calendar (day cards, coloured
name tags), never like a spreadsheet grid. No emoji anywhere in the app: the three worker types use the
SVG icons (ID badge, clock, truck); everything else is plain words (plain ✓ ✗ ◀ ▶ → symbols are fine).
Look: minimal, white top bar, Inter, ink-black primary buttons, colour only for status (green covered,
orange short) and the three worker types; teams can be 20+ people a day, so day cards show numbers only.

## Files

The folders mirror the app: `app/` is the shared shell, `returns/`, `receiving/` and `scheduling/` are the sections,
each with its own README for the owner. In Apps Script the files are flat (no folders), named after
the file without its ending; the root README has the name → path table. Apps Script `.gs` files share
one global scope. Script and HTML files must not share a name.

- `app/Main.gs` — `doGet` (template page; `?section=scheduling` / `?section=receiving` opens that section), `include_`,
  `getConfig`, `setup` (renames the sheet to PureTech, calls each section's setup), shared helpers
  `ss_`, `sheet_`, `norm_`.
- `app/Index.html` — page shell: PureTech bar, section buttons, shared CSS (colour tokens on `:root`,
  `.btn`, `.link`, `.seg`, worker-type `.ico`/`.i-*`/`.t-*`), the worker-type icons as an SVG sprite
  (`#ic-full`, `#ic-part`, `#ic-driver`) and the `$`, `esc`, `call`, `typeIcon(type, size, decorative)`
  helpers; pastes in the three section files with `<?!= include_('…') ?>`.
- `app/appsscript.json` — manifest (Gmail + Drive advanced services, web app settings).
- `returns/Returns.gs` (was `Code.gs`) — Returns server: Gmail search (`searchPart`, `partQuery_`), PDF
  reading via Drive OCR (`readInvoice`, `pdfText_`, `guessInvoice_`, `guessQty_`), saving/undo (`recordReturn`,
  `undoReturn`, `setCategory`, `setComment`), pallets (`getPallets`, `getPallet`, `newPallet`, `reopenPallet`, `moveToPallet`, `deleteReturn`), tabs
  (`setupReturns_`, `moveToPalletLayout_`, `rebuildByPallet_`, `rebuildByInvoice_`).
- `returns/ReturnsPage.html` — Returns section (CSS scoped under `.returns`): pallet bar, search, invoice cards
  with the quantity picker, done screen, pallets view.
- `receiving/Receiving.gs` — Receiving server: `getReceivingList` (Gmail via `receivingEmails_`, query in
  `RECEIVING_QUERY`), `readReceiving` (PDF via `receivingText_`, shares `_pdf_cache` with Returns), pure
  `invoiceLines_`/`backorders_`, `saveReceiving`, `uncheckReceiving`, `getRecentProblems`, `setSorted`,
  `getWeekReport`, `rebuildReceivingWeek_`, `setupReceiving_`. Uses Returns' `cacheGet_`, `pdfText_`,
  `guessInvoice_`, `withLock_`, `MAX_QTY` and Schedule's `addDays_`, `mondayOf_`, `todayIso_`.
- `receiving/ReceivingPage.html` — Receiving section (CSS `.receiving`/`rc-*`, JS in the `Receiving`
  module): invoice cards, the check `<dialog>` (Back ordered / Missing / Extra), the "Last 7 days" column
  with Sorted ticks, and the printable week report.
- `scheduling/Schedule.gs` — Scheduling server: `getWeek`, `setDayOff`, `addExtra`, `removeChange`,
  `saveMasterSchedule`; pure `buildWeek_` (no Google calls) works out each day; `setupSchedule_`.
- `scheduling/SchedulePage.html` — Scheduling section (CSS under `.scheduling`, classes `sc-*`, JS
  wrapped in the `Scheduling` module so its names don't clash with the Returns script). Worker types are
  in `TYPES` at the top of the script. Calendar: numbers-only day cards, tap one for the names panel
  (`dayPanel`) under the week. Master scheduling: minimum cards per day, then one card per person with
  type buttons and Mon–Sun toggles, a filter by type, and a sticky Save bar.
- `README.md` (setup, updating, preview, file table), `returns/README.md`, `receiving/README.md`, `scheduling/README.md` —
  the owner's instructions. Keep them in sync with behaviour changes.
- `docs/diagrams/puretech-architecture.{html,svg}` — architecture diagram (made with archify).
- `tools/` — local preview and demo builder (see below).

## Key behaviour

- Part and invoice numbers are compared with `norm_` (uppercase, letters/digits only).
- Shows up to `SHOW_INVOICES` (15) invoices where some of the part can still be returned. Shipped quantity
  comes from `guessQty_` (Vast-Auto lines `… EA ORDERED SHIPPED B/O price` take SHIPPED; else the first whole
  number after the part), or is typed in on the page; an invoice is used up when returned ≥ shipped.
- Returns columns: Date Returned, Pallet, Part Number, Quantity, Invoice Number, Category, Email Date, PDF File,
  Email, Key, Comment. Category (F) is one of `CATEGORIES` (Defect, Core, New Return; blank reads as Defect),
  set when returning or with `setCategory`; `fixReturnsData_` repairs rows saved before the Category column.
  Comment (K) was added after Key so nothing moves; `getPallets` (the page's first call) and `recordReturn` run
  `ensureCommentColumn_`, which adds the K1 heading and widens the filter on older sheets. `cleanComment_`
  trims to `MAX_COMMENT` (500) and puts `'` before text starting `= + - @` so Sheets keeps it as text. Comments
  are set when returning or with `setComment(id, text)` from the pallet screen's Modify panel.
  New columns go at the end: the owner's live sheet has data, and moving a column shifts every row.
  A return is keyed by `normalisedPart|gmailMessageId:attachmentIndex` (hidden column J); the key repeats when
  more is returned later, so one row is identified by `rowId_` (key + `|` + date in ms).
- Pallets: `_pallets` (hidden) holds `Pallet | Started | Finished`; an empty Finished is the open pallet (only one).
  New returns go on the open pallet. `setupReturns_` rewrites a pre-pallet Returns tab (B1 = `Part Number`)
  into the new layout with Pallet 1 / Quantity 1.
- Saves run inside `withLock_` (one at a time, waits up to 30 s, then a plain "busy" message). Keep the work
  inside it to a fixed number of Sheets calls: no call per row or per block. `paintBlocks_` colours a rebuilt
  tab in three calls; formatting each block separately took over 20 s with a few hundred invoices and made
  the next save fail with a lock timeout.
- Sheet tabs: `Returns` (one row per return, newest first), `By Pallet` and `By Invoice` (rebuilt after every
  change by `rebuildAll_`), `_pallets`, `_pdf_cache` (hidden OCR cache); then `Schedule · Staff`, `Schedule · Base Week`, `Schedule · Needed`,
  `Schedule · Changes`; Receiving's `Receiving`, `Receiving · Week` sit after `By Invoice`, `_received` is hidden.
  `doGet` runs `setup` if `Returns`, `By Pallet`, `Schedule · Staff` or `Receiving` is missing.
- Receiving: `Receiving` columns are Date Checked, Invoice Number, Invoice Date, Part Number, Description,
  Problem (`Missing`/`Extra`/`Back order`), Quantity, Sorted, Note, Email, Key (hidden, `messageId:index`).
  A problem is identified by key|norm(part)|problem (one per invoice). `_received` = Key | Invoice | Checked |
  Problems marks an invoice checked even with no problems. Saving again replaces the invoice's rows (keeping
  Sorted). Saving an invoice closes open back orders from earlier invoices for parts it shipped (shipped > 0
  and not saved Missing): Sorted = now, Note = `Arrived on invoice X`; unchecking/re-saving undoes that.
  Back orders can't be ticked by hand. The right column is the last `RECENT_DAYS` (7) days by Date Checked.
- Scheduling: people are matched by `norm_(name)`. A day's workers = master schedule + Extra − Off (a day
  off wins). Dates are `yyyy-mm-dd` strings worked out in UTC. Renaming someone in Master scheduling
  renames their rows in Changes. Calendar is view-only; all input is in Make changes.

## Testing locally (no Google account needed)

- Server: load `app/Main.gs` + `returns/Returns.gs` + `receiving/Receiving.gs` + `scheduling/Schedule.gs` together in Node with `vm.runInContext` and stub
  `SpreadsheetApp`, `PropertiesService`, `LockService`, `Utilities` as needed; call the pure functions
  (`guessInvoice_`, `partQuery_`, `findLine_`, `buildWeek_`, `invoiceLines_`, `backorders_`) and the schedule functions against fake
  sheets. Values crossing the vm boundary (arrays, Dates) are from another realm: compare via JSON and
  create Dates inside the context.
- Page: build `Index.html` as Apps Script would (replace `<?= section ?>` and the `include_` lines with
  the files), inject a fake `google.script.run` (a Proxy) before the first script, and drive it with
  Playwright. Bridging the fake to the vm context with `page.exposeFunction` tests page and server together.
- `node --check` on `.js` copies of the `.gs` files for syntax.

## Local preview for the owner

`node tools/preview.mjs [--open]` builds `preview/PureTech-preview.html` (git-ignored) from the real
files; its `FILES` map says which folder each Apps Script file is in (add new files there). `tools/preview-fake.js` stands in for Google: the real `.gs` code runs in its
own scope on pretend sheets kept in localStorage; Gmail/Drive OCR are replaced by `DEMO_EMAILS`
(the real `guessInvoice_`/`findLine_`/`returnedFor_` still run); for Receiving it reassigns
`receivingEmails_`/`receivingText_` to `RECEIVING_EMAILS`, so the rest of Receiving runs for real.
Bump `STORE` when the demo tabs change, so old browser data is dropped. Rebuild after every change so the
owner can reload and look. If the server code starts using a new Google service, add it to the fake.

`node tools/preview.mjs --artifact` builds `preview/PureTech-demo.html`, published as the live demo at
https://claude.ai/artifact/UH6Por2eFhb5ntu2B4ZMSu (republish that artifact, e.g. `publish_files` with its slug
and `as: index.html`, to keep the link).
Published pages cannot show confirm() boxes, so that build answers them "yes".

## Getting changes into Google (manual, by the owner)

This repo is NOT linked to any Google account. Do not set up clasp, Google sign-in or any other
connection to the owner's Google account unless the owner explicitly asks for it in their own words
(see "Linking to Google later" below). Until then, the owner copies the code across by hand.

After every change:

1. Run the local tests above.
2. Commit and push, so the owner can also copy the files from GitHub.
3. Tell the owner, in plain words, **which files changed**, by their Apps Script name and their path
   (e.g. `SchedulePage` = `scheduling/SchedulePage.html`), and which are **new** (they
   must be created first with **+ → Script** or **+ → HTML**, named without the extension), and give
   these steps:
   1. Open the PureTech Google Sheet → **Extensions → Apps Script**.
   2. For each changed file: click it on the left, **Ctrl + A**, **Delete**, paste the new version,
      **Ctrl + S**.
   3. **Deploy → Manage deployments → pencil ✎ → Version: New version → Deploy**.
   4. Reload the tool in Chrome.
   Offer to print a changed file's full contents so they can copy it straight from the terminal.

The owner is not technical: one action per step, no jargon.

## Linking to Google later (only when the owner asks)

Google's clasp tool can upload and deploy the code directly:

1. Owner turns on "Google Apps Script API" at https://script.google.com/home/usersettings.
2. `npx @google/clasp login`, signed in to the Google account that receives the invoices.
3. Owner copies the Script ID from the Apps Script editor (gear → Project Settings); create
   `.clasp.json` at the project root with `{"scriptId": "<id>", "rootDir": "."}` and a `.claspignore`
   that lists only `app/**`, `returns/**/*.gs`, `returns/**/*.html`, `scheduling/**/*.gs`,
   `scheduling/**/*.html`.
   clasp names files by their folder (`returns/ReturnsPage`), but the Apps Script project is
   flat and `include_('ReturnsPage')` expects flat names. Before the first push, either change the
   `include_` calls to the folder names or copy the files into a flat folder for clasp. Agree this
   with the owner, because a push replaces every file in the project.
4. Upload: `npx @google/clasp push`.
5. Publish at the same URL: `npx @google/clasp deployments` to find the web app deployment ID
   (not `@HEAD`), then `npx @google/clasp deploy -i <deploymentId> -d "<what changed>"`.

To unlink again: `npx @google/clasp logout` and delete `.clasp.json`.
