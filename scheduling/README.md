# PureTech › Scheduling

[← Back to PureTech](../README.md)

The weekly staff calendar, with a check that enough people are in each day.

There are three kinds of worker, each with its own icon and colour: **Full time** (an ID badge, blue),
**Part time** (a clock, purple) and **Driver** (a truck, teal). The app uses no emoji. Scheduling has two
parts, chosen with the **Calendar / Make changes** switch at the top right.

## Calendar (for looking)

- The whole week side by side, Monday to Sunday. Use **◀ ▶** to change week and **Today** to come back.
  Today's card has a dark top.
- Each card shows only numbers, so it stays the same size however many people work: a line per kind of
  worker, e.g. truck `1/2 ✗` means 1 driver working and 2 needed. A short day has an orange outline and a
  **✗ Short** strip; a covered day says **✓ Covered**. "2 off · 1 extra" means it differs from the master schedule.
- Above the week: how many days are fully staffed, and an orange box listing every short day, e.g.
  "Tuesday 20 Oct needs 1 more Driver (Sam off)". Click a line to open that day.
- **Click a day card** to see everyone working that day in a panel under the week: the changes from the
  master schedule (days off, crossed out with the reason; extra cover, marked **+ cover**), then three
  columns, one per kind of worker, with "12 of 12 needed" and the names. Each missing person shows as an
  orange dashed **1 more needed** box. **Close** (or clicking the card again) hides it.
- A day with no minimum and nobody working shows **Closed**.
- Nothing can be changed here. A short day's panel has a **Fix this day →** button that opens Extra cover.

## Make changes (for changing)

- **Day off**: pick the day, tap the person (grouped by kind of worker), optionally pick why
  (Sick, Holiday, Other), **Save day off**. Before saving it shows whether the day will be short.
- **Extra cover**: pick the day, tap someone who isn't working that day, **Save extra cover**.
  The kind of worker the day is short of comes first and is marked **NEEDED**.
- **Master scheduling**: the master schedule, which repeats every week.
  - **Minimum needed each day**: a card per weekday with **− / +** for each kind of worker. Under each number
    it shows how many are on the master schedule that day, e.g. "11 on · 1 short".
  - **Your team**: one card per person: name, **Full time / Part time / Driver**, and the days they work
    (**Mon … Sun** buttons; dark = works that day). **Away for a while** takes someone off the schedule without
    deleting them; **Remove** deletes them. **+ Add person** adds a card at the top. The buttons **Everyone /
    Full time / Part time / Drivers** show one kind at a time, handy with a big team.
  - Press **Save master schedule** in the bar at the bottom (**Cancel** throws the changes away).
    Days off and extra cover already entered stay as they are.
- Under the Day off / Extra cover form, **Changes for …** lists that week's days off and extra cover,
  each with **Undo**.

## Files

| File | What it does |
|---|---|
| [`Schedule.gs`](Schedule.gs) | Server side: works out each day (master schedule + extra cover − days off), saves changes, the Schedule tabs. |
| [`SchedulePage.html`](SchedulePage.html) | The Scheduling screens: Calendar, Make changes, Master scheduling. The kinds of worker are in `TYPES` at the top of its script; their icons are in `Index.html` (`ic-full`, `ic-part`, `ic-driver`) and their colours in the `.i-*` / `.t-*` styles there. |

## Spreadsheet tabs

- **Schedule · Staff**: name, kind of worker, and whether they are on the schedule (tick box).
- **Schedule · Base Week**: the master schedule, one row per person with a tick box per weekday.
- **Schedule · Needed**: the minimum of each kind of worker per weekday.
- **Schedule · Changes**: days off and extra cover for particular dates.

These tabs can also be edited by hand; the app shows the change when it is reloaded.
