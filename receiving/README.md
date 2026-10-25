# PureTech › Receiving

[← Back to PureTech](../README.md)

Check each delivery against its invoice and keep a list of what was back-ordered, missing or extra.

## Checking a delivery

- **Receiving** shows one card for each Vast-Auto invoice that came in by email in the last 3 weeks and
  hasn't been checked yet, newest first. Each card shows the invoice number and whether anything on it is
  back-ordered. The cards fill in a few seconds after the page opens, while the PDFs are read.
- When a delivery has been checked, **tap its invoice**. A box opens with three parts:
  - **Back ordered**: filled in already from the **B/O** column of the invoice. If it was read wrong,
    change the number with **− / +** or press **✗ Remove**.
  - **Missing**: on the invoice but not in the delivery. Press **+ Add missing part**, type the part number,
    and set how many.
  - **Extra**: in the delivery but not on the invoice. Press **+ Add extra part** and do the same.
- Press **Save — invoice checked**. If nothing was wrong, just press Save. The card moves under
  **Show checked**.
- Made a mistake? Press **Show checked**, tap the invoice, fix it, and save again. To put it back in the list,
  press **Mark as not checked**.

## Last 7 days (the column on the right)

Every problem from invoices checked in the last 7 days:

- **Missing** and **Extra**: tick **Sorted** when it has been sorted out with the supplier. Click the tick
  again to take it off.
- **Back ordered**: these tick off by themselves. When a later invoice with that part is checked, and
  the part isn't marked missing on it, the back order shows **✓ Arrived on invoice …**.

## Week report

**Week report** (top of the right column) lists every problem from the deliveries checked that week,
Monday to Sunday, and whether each one is sorted. Use **◀ ▶** to see other weeks and **Print** to print it.
The same report for the current week is in the **Receiving · Week** tab of the spreadsheet.

## Spreadsheet tabs

- **Receiving**: one row for each problem, newest first: Date Checked, Invoice Number, Invoice Date,
  Part Number, Description, Problem (Missing / Extra / Back order), Quantity, Sorted (the date it was
  sorted), Note, and a link to the email.
- **Receiving · Week**: this week's report. It is rebuilt every time something changes.
- `_received` (hidden): the invoices that have been checked, including ones with nothing wrong.

## Changing which emails are shown

At the top of the `Receiving` script in Apps Script:

```
const RECEIVING_QUERY = 'from:vastauto.com has:attachment filename:pdf newer_than:21d';
```

Change `vastauto.com` to another supplier's email address or website, or `21d` to look further back
(for example `30d`). Then save and deploy a new version.
