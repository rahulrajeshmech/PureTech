# PureTech

One Google web app and one Google Sheet for the shop, with three sections:

- **[Returns](returns/README.md)**: find which supplier invoice a part was bought on and log the return.
- **[Receiving](receiving/README.md)**: check each delivery against its invoice and keep a list of
  back-ordered, missing and extra parts, with a weekly report.
- **[Scheduling](scheduling/README.md)**: the weekly staff calendar, with a check that enough people are in each day.

The buttons at the top of the page switch between them. The app opens on **Returns**.

**Live demo:** <https://claude.ai/artifact/UH6Por2eFhb5ntu2B4ZMSu> (add `#receiving` or `#scheduling` to
the end to open on that section). It runs on demo data with made-up suppliers and a sample team. The link is private:
ask the owner to share it with you if it does not open.

It runs inside your own Google account: no server, no cost, and your email never leaves Google.

## Folders

```
puretech/
├─ app/          the PureTech page and setup, shared by all sections
├─ returns/      the Returns section
├─ receiving/    the Receiving section
├─ scheduling/   the Scheduling section
├─ docs/         the architecture diagram
└─ tools/        the local preview and demo builder
```

### Which file goes where in Apps Script

In Apps Script all the files sit side by side, without folders. Each one is named after its file,
without the ending:

| Name in Apps Script | Type | File in this project |
|---|---|---|
| `Main` | Script | [`app/Main.gs`](app/Main.gs) |
| `Index` | HTML | [`app/Index.html`](app/Index.html) |
| `appsscript.json` | Manifest | [`app/appsscript.json`](app/appsscript.json) |
| `Returns` | Script | [`returns/Returns.gs`](returns/Returns.gs) |
| `ReturnsPage` | HTML | [`returns/ReturnsPage.html`](returns/ReturnsPage.html) |
| `Receiving` | Script | [`receiving/Receiving.gs`](receiving/Receiving.gs) |
| `ReceivingPage` | HTML | [`receiving/ReceivingPage.html`](receiving/ReceivingPage.html) |
| `Schedule` | Script | [`scheduling/Schedule.gs`](scheduling/Schedule.gs) |
| `SchedulePage` | HTML | [`scheduling/SchedulePage.html`](scheduling/SchedulePage.html) |

## How it works

![How PureTech works: Returns and Scheduling](docs/diagrams/puretech-architecture.svg)

For a version you can zoom and click, download
[`docs/diagrams/puretech-architecture.html`](docs/diagrams/puretech-architecture.html) and open it in Chrome.

## The spreadsheet

The sheet is called **PureTech**. Its tabs are coloured by section: green for Returns, amber for Receiving,
blue for Scheduling. The tabs are described in each section's guide: [Returns](returns/README.md#spreadsheet-tabs),
[Receiving](receiving/README.md#spreadsheet-tabs) and [Scheduling](scheduling/README.md#spreadsheet-tabs).

**Download Excel**: link at the top of the tool, or in the sheet use File → Download → Microsoft Excel.

## Setup (one time, about 10 minutes)

Do this signed in to the Google account that **receives the supplier invoices**.

1. Go to <https://sheets.new> and name the sheet **PureTech**.
2. Click **Extensions → Apps Script**. A code editor opens.
3. Click the **gear (Project Settings)** on the left:
   - Tick **Show "appsscript.json" manifest file in editor**.
   - Set **Time zone** to yours.
4. Back in the **Editor** (`< >` icon), create the files in the table above:
   - The editor starts with a file called `Code.gs`. Click **⋮** next to it → **Rename**, call it `Returns`,
     delete what's in it, and paste in `returns/Returns.gs`.
   - Open `appsscript.json`, delete what's there, and paste in `app/appsscript.json`.
   - Click **+ → Script**, name it `Main` (no `.gs`), and paste in `app/Main.gs`.
     Do the same for `Schedule` with `scheduling/Schedule.gs` and `Receiving` with `receiving/Receiving.gs`.
   - Click **+ → HTML**, name it `Index` (no `.html`), delete what's there, and paste in `app/Index.html`.
     Do the same for `ReturnsPage` with `returns/ReturnsPage.html`, `ReceivingPage` with
     `receiving/ReceivingPage.html` and `SchedulePage` with `scheduling/SchedulePage.html`.
   - Click **Save** (disk icon).
5. Click **Deploy → New deployment** → gear → **Web app**:
   - Execute as: **Me**
   - Who has access: **Only myself**
   - Click **Deploy**. If it asks to **Authorize access**: choose your account → **Advanced** →
     **Go to … (unsafe)** → **Allow**. The "unverified" warning is normal for a script you added
     yourself; it only runs in your account.
   - Copy the **Web app URL**.
6. Open that URL. The first time, Google may ask for permission again (same steps as above).
   The tool then creates the Returns, Receiving and Schedule tabs in your sheet by itself.
7. On the shop PC, open Chrome **signed in to that same Google account**, open the URL, and
   create a desktop shortcut (Chrome menu ⋮ → **Cast, save and share → Create shortcut**, name it **PureTech**).
8. Optional: for a shortcut that opens straight on Scheduling, add `?section=scheduling` to the end of
   the Web app URL, open that, and create a second shortcut named **Staff schedule**. For Receiving, use
   `?section=receiving`.
9. Open **Scheduling → Make changes → Master scheduling** to add the team.

### Upgrading from the old returns tool (Pure-Merch-Return)

If the sheet still runs the first version of the tool (Apps Script files `Code`, `Index` and
`appsscript.json` only), this moves it to PureTech. Your returns are kept: the first time the new
version opens, it puts every earlier return on **Pallet 1** with quantity 1. The **Supplier** and
**Email Subject** columns are not kept in the new Returns tab, which is why step 1 makes a copy.

1. Open the Google Sheet → **File → Make a copy**, and name it e.g. *Returns backup 20 Oct*.
2. Go back to the original sheet → **Extensions → Apps Script**.
3. Click **+ → Script**, name it `Main`, select all (**Ctrl + A**), delete, and paste in `app/Main.gs`.
4. Do the same for `Returns` (`returns/Returns.gs`) and `Schedule` (`scheduling/Schedule.gs`).
5. Click `Index` on the left, select all, delete, and paste in `app/Index.html`.
6. Click **+ → HTML**, name it `ReturnsPage`, and paste in `returns/ReturnsPage.html`.
   Do the same for `SchedulePage` (`scheduling/SchedulePage.html`).
7. Delete the old file: hover over `Code` → **⋮ → Delete**. (It clashes with the new files.)
   `appsscript.json` stays as it is.
8. Press **Ctrl + S**. No red error line should appear at the top.
9. **Deploy → Manage deployments → pencil ✎ → Version: New version → Deploy**. If Google asks to
   authorise again: choose your account → **Advanced** → **Go to … (unsafe)** → **Allow**.
10. Reload the tool in Chrome (same link, same shortcut). The first load takes a little longer: the sheet
    is renamed **PureTech**, earlier returns move onto Pallet 1, and the By Pallet and Schedule tabs appear.
11. Check: search a part you returned before; it shows as already returned.
12. Open **Scheduling → Make changes → Master scheduling**, add the team and the minimum per day, and press
    **Save master schedule**. Optional: a second shortcut to the link with `?section=scheduling` on the end.

**If something goes wrong:** in Apps Script, **Deploy → Manage deployments → pencil ✎ → Version:** pick the
previous version → **Deploy**. Then in the sheet, **File → Version history → See version history** and restore
the version from before step 10. The copy from step 1 is a second safety net.

### Updating to a new version of the code

1. Open the Google Sheet → **Extensions → Apps Script**.
2. For each changed file (for example `SchedulePage`): click it on the left, select all (**Ctrl + A**),
   delete, paste the new version from this project (see the table above), and press **Ctrl + S**.
3. Click **Deploy → Manage deployments**. Click the **pencil ✎** on the right, set **Version** to
   **New version**, and click **Deploy**.
4. Reload the tool in Chrome. The URL and desktop shortcut stay the same.

Skipping step 3 means the tool keeps running the old code.

## Preview on this computer (no Google account)

To see the page and try changes before copying anything into Google:

1. In the project folder run `node tools/preview.mjs --open`. It builds
   `preview/PureTech-preview.html` and opens it in the browser.
2. It uses demo data: a sample team for Scheduling, demo invoices for Returns (try part
   numbers `CH8115` or `BP4471`), and four Vast-Auto invoices for Receiving. Nothing reaches Gmail or the Google Sheet.
3. What you do in the preview is remembered in that browser. **Reset demo data** (top right) starts again.
4. After changing any file in `app/`, `returns/`, `receiving/` or `scheduling/`, run step 1 again and reload the page.

The same demo can be published as a web page to look at from any device:
`node tools/preview.mjs --artifact` builds `preview/PureTech-demo.html` for that. On the published page,
add `#receiving` or `#scheduling` to the end of the link to open on that section. Confirmation questions (Undo, Remove) are
answered "yes" automatically there, because published pages cannot show them.
