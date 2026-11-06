/**
 * PureTech — Receiving section
 *
 * Lists the supplier invoices (PDFs) that came in by email so each delivery can be
 * checked against its invoice. Back-ordered lines are read from the invoice's B/O
 * column; the receiver adds anything missing or extra. Only those problem lines are
 * saved, in the "Receiving" tab. A back order is ticked off by itself when the part
 * comes in on a later invoice; missing and extra parts are ticked off on the page.
 */

// Which emails are invoices to check. Change "vastauto.com" to look at another
// supplier, and "21d" to look further back (e.g. 30d).
const RECEIVING_QUERY = 'from:vastauto.com has:attachment filename:pdf newer_than:21d';
// Stop after this many emails, so the list can't get slow.
const RECEIVING_MAX_EMAILS = 60;
// How many days of problems are shown on the right of the page.
const RECENT_DAYS = 7;

const RECEIVING = 'Receiving';
const RECEIVED = '_received';
const RECEIVING_WEEK = 'Receiving · Week';
const RECEIVING_COLOUR = '#b45309';
const RECEIVING_HEADERS = ['Date Checked', 'Invoice Number', 'Invoice Date', 'Part Number', 'Description',
  'Problem', 'Quantity', 'Sorted', 'Note', 'Email', 'Key'];
const RCOL = { date: 1, invoice: 2, invDate: 3, part: 4, desc: 5, problem: 6, qty: 7, sorted: 8, note: 9,
  email: 10, key: 11 };
// The order here is the order they are shown in everywhere.
const PROBLEMS = ['Missing', 'Extra', 'Back order'];
const BACK_ORDER = 'Back order';
const ARRIVED = 'Arrived on invoice ';

// ---------------------------------------------------------------------------
// Called from the page

/** The invoice emails, newest first, each with what was saved if it has been checked already. */
function getReceivingList() {
  if (!ss_().getSheetByName(RECEIVING)) setup();
  const checked = checkedInvoices_();
  const items = receivingEmails_();
  items.forEach(function (item) { item.checked = checked[item.key] || null; });
  return { items: items };
}

/** Reads one invoice PDF: its invoice number and the back-ordered lines. */
function readReceiving(item) {
  const info = receivingText_(item);
  return { invoice: info.invoice, backorders: backorders_(info.text) };
}

/**
 * Saves a checked invoice. `lines` are its problems: [{part, desc, problem, qty}] with
 * problem "Missing", "Extra" or "Back order"; none means everything was there.
 * Checking it again replaces what was saved before (a part keeps its "Sorted" tick).
 */
function saveReceiving(item, invoice, lines) {
  invoice = String(invoice || '').trim().toUpperCase();
  if (!invoice) throw new Error('The invoice number is needed.');
  const clean = cleanLines_(lines);

  return withLock_(function () {
    const tz = ss_().getSpreadsheetTimeZone();
    const was = receivedRow_(item.key);
    const checkedOn = was && was.checked instanceof Date ? was.checked : new Date();
    const kept = {};
    removeInvoice_(item.key, was ? was.invoice : invoice, kept);

    const sh = sheet_(RECEIVING);
    const link = 'https://mail.google.com/mail/u/0/#all/' + item.threadId;
    clean.forEach(function (l) {
      const k = kept[norm_(l.part) + '|' + l.problem] || {};
      sh.appendRow([checkedOn, invoice, new Date(item.dateIso), l.part, l.desc, l.problem, l.qty,
        k.sorted || '', k.note || '', '', item.key]);
      sh.getRange(sh.getLastRow(), RCOL.email).setFormula('=HYPERLINK("' + link + '","Open")');
    });
    if (sh.getLastRow() > 2) {
      sh.getRange(2, 1, sh.getLastRow() - 1, RECEIVING_HEADERS.length).sort({ column: RCOL.date, ascending: false });
    }
    sheet_(RECEIVED).appendRow([item.key, invoice, checkedOn, clean.length]);
    closeBackorders_(item, invoice, clean);
    rebuildReceivingWeek_();
    return {
      checked: { when: Utilities.formatDate(checkedOn, tz, 'd MMM yyyy'), invoice: invoice, lines: clean },
      recent: getRecentProblems(),
    };
  });
}

/** Puts a checked invoice back in the list to check, removing what was saved for it. */
function uncheckReceiving(item) {
  return withLock_(function () {
    const was = receivedRow_(item.key);
    if (!was) throw new Error('That invoice is not marked as checked. It may already have been undone.');
    removeInvoice_(item.key, was.invoice, {});
    rebuildReceivingWeek_();
    return { recent: getRecentProblems() };
  });
}

/** Problems from invoices checked in the last RECENT_DAYS days, newest first. */
function getRecentProblems() {
  const from = addDays_(todayIso_(), -(RECENT_DAYS - 1));
  const tz = ss_().getSpreadsheetTimeZone();
  return receivingRows_().filter(function (r) {
    return r[0] instanceof Date && Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') >= from;
  }).map(problemLine_);
}

/** Ticks a missing or extra part as sorted out (or takes the tick off again). */
function setSorted(id, done) {
  return withLock_(function () {
    const rows = receivingRows_();
    for (let i = 0; i < rows.length; i++) {
      if (problemId_(rows[i]) !== id) continue;
      if (rows[i][RCOL.problem - 1] === BACK_ORDER) {
        throw new Error('Back orders are ticked off by themselves when the part comes in on a later invoice.');
      }
      sheet_(RECEIVING).getRange(i + 2, RCOL.sorted).setValue(done ? new Date() : '');
      rebuildReceivingWeek_();
      return getRecentProblems();
    }
    throw new Error('That part was not found. Its invoice may have been changed.');
  });
}

/** Every problem from invoices checked in the week starting on Monday `mondayIso` (yyyy-mm-dd). */
function getWeekReport(mondayIso) {
  return weekReport_(mondayOf_(isIso_(mondayIso) ? mondayIso : todayIso_()));
}

// ---------------------------------------------------------------------------
// Gmail and the PDFs (the preview replaces these two)

/** The invoice PDFs matching RECEIVING_QUERY, newest first. Does not open the PDFs. */
function receivingEmails_() {
  const tz = ss_().getSpreadsheetTimeZone();
  const out = [];
  let pageToken, scanned = 0;
  do {
    const res = Gmail.Users.Messages.list('me', { q: RECEIVING_QUERY, maxResults: 50, pageToken: pageToken });
    pageToken = res.nextPageToken;
    (res.messages || []).forEach(function (m) {
      if (scanned++ >= RECEIVING_MAX_EMAILS) return;
      const msg = GmailApp.getMessageById(m.id);
      msg.getAttachments({ includeInlineImages: false }).forEach(function (a, i) {
        if (!isPdf_(a)) return;
        out.push({
          key: m.id + ':' + i,
          messageId: m.id,
          threadId: m.threadId,
          index: i,
          fileName: a.getName(),
          supplier: supplierName_(msg.getFrom()),
          subject: msg.getSubject(),
          dateIso: msg.getDate().toISOString(),
          dateText: Utilities.formatDate(msg.getDate(), tz, 'd MMM yyyy'),
          invoiceGuess: guessInvoice_('', msg.getSubject(), a.getName()),
        });
      });
    });
  } while (pageToken && scanned < RECEIVING_MAX_EMAILS);
  return out;
}

/** The PDF's text and invoice number, read once and kept in the "_pdf_cache" tab (shared with Returns). */
function receivingText_(item) {
  let info = cacheGet_(item.key);
  if (!info) {
    const att = GmailApp.getMessageById(item.messageId)
      .getAttachments({ includeInlineImages: false })[item.index];
    const text = pdfText_(att.copyBlob());
    info = { text: text, invoice: guessInvoice_(text, item.subject, item.fileName) };
    cachePut_(item.key, info);
  }
  return info;
}

// ---------------------------------------------------------------------------
// Reading the invoice

// A Vast-Auto line: "SPI F44B  FUEL TANK  EA  1  1  0  420.28 …" is line code, part number,
// description, UNIT, ORDERED, SHIPPED, B/O, then the price.
const INVOICE_LINE = /^\s*([A-Z0-9]{2,4})\s+(\S+)((?:\s+.*?)?)\s+[A-Z]{2,3}\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+\.\d\d\b/i;

/** Every line of a Vast-Auto invoice table: [{part, desc, ordered, shipped, bo}]. */
function invoiceLines_(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    const m = INVOICE_LINE.exec(line);
    if (!m) return;
    out.push({ part: m[2].toUpperCase(), desc: m[3].replace(/\s+/g, ' ').trim(),
      ordered: Number(m[4]), shipped: Number(m[5]), bo: Number(m[6]) });
  });
  return out;
}

/**
 * The back-ordered lines: [{part, desc, qty}]. From the B/O column on a Vast-Auto invoice;
 * on other layouts, from lines that say "B/O" or "back order" (the part is the first word with
 * letters and digits in it, the quantity the first whole number after it, else 1).
 */
function backorders_(text) {
  const table = invoiceLines_(text);
  if (table.length) {
    return table.filter(function (l) { return l.bo > 0; })
      .map(function (l) { return { part: l.part, desc: l.desc, qty: l.bo }; });
  }
  const out = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    if (!/\bB\s*\/\s*O\b|\bBACK[\s\-]*ORDER/i.test(line)) return;
    const words = line.trim().split(/\s+/);
    const at = words.findIndex(function (w) { return /[A-Z]/i.test(w) && /\d/.test(w); });
    if (at === -1) return;
    const qty = words.slice(at + 1).filter(function (w) { return /^\d{1,4}$/.test(w); })[0];
    out.push({ part: words[at].replace(/[^A-Z0-9\-\/]/gi, '').toUpperCase(), desc: '', qty: qty ? Number(qty) : 1 });
  });
  return out;
}

// ---------------------------------------------------------------------------
// The tabs

function receivingRows_() {
  const sh = sheet_(RECEIVING);
  return sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, RECEIVING_HEADERS.length).getValues();
}

/** Identifies one problem: an invoice has at most one line per part and problem. */
function problemId_(r) {
  return r[RCOL.key - 1] + '|' + norm_(r[RCOL.part - 1]) + '|' + r[RCOL.problem - 1];
}

function problemLine_(r) {
  const tz = ss_().getSpreadsheetTimeZone();
  const day = function (d) { return d instanceof Date ? Utilities.formatDate(d, tz, 'd MMM yyyy') : String(d || ''); };
  return { id: problemId_(r), part: String(r[RCOL.part - 1]), desc: String(r[RCOL.desc - 1]),
    problem: String(r[RCOL.problem - 1]), qty: Number(r[RCOL.qty - 1]) || 1, invoice: String(r[RCOL.invoice - 1]),
    when: day(r[0]), sorted: day(r[RCOL.sorted - 1]), note: String(r[RCOL.note - 1] || '') };
}

/** Checks the lines from the page and joins repeats of the same part and problem. */
function cleanLines_(lines) {
  const out = [];
  const seen = {};
  (lines || []).forEach(function (l) {
    const part = String(l.part || '').trim().toUpperCase();
    const problem = PROBLEMS.filter(function (p) { return norm_(p) === norm_(l.problem); })[0];
    const qty = Number(l.qty);
    if (!part) throw new Error('Every part needs a part number. Remove the empty line or type the part number.');
    if (!problem) throw new Error('Unknown problem "' + l.problem + '".');
    if (!(qty >= 1 && qty <= MAX_QTY && Math.floor(qty) === qty)) {
      throw new Error('The quantity for ' + part + ' must be a whole number from 1 to ' + MAX_QTY + '.');
    }
    const k = norm_(part) + '|' + problem;
    if (seen[k]) { seen[k].qty = Math.min(seen[k].qty + qty, MAX_QTY); return; }
    out.push(seen[k] = { part: part, desc: String(l.desc || '').trim(), problem: problem, qty: qty });
  });
  return out;
}

/** {key: {when, invoice, lines}} for every checked invoice. */
function checkedInvoices_() {
  const tz = ss_().getSpreadsheetTimeZone();
  const out = {};
  const sh = sheet_(RECEIVED);
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
      if (!r[0]) return;
      out[r[0]] = { when: r[2] instanceof Date ? Utilities.formatDate(r[2], tz, 'd MMM yyyy') : String(r[2]),
        invoice: String(r[1]), lines: [] };
    });
  }
  receivingRows_().forEach(function (r) {
    const c = out[r[RCOL.key - 1]];
    if (c) c.lines.push({ part: String(r[RCOL.part - 1]), desc: String(r[RCOL.desc - 1]),
      problem: String(r[RCOL.problem - 1]), qty: Number(r[RCOL.qty - 1]) || 1 });
  });
  return out;
}

/** The "_received" row for an invoice PDF: {invoice, checked, row}, or null. */
function receivedRow_(key) {
  const sh = sheet_(RECEIVED);
  if (sh.getLastRow() < 2) return null;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === key) return { invoice: String(rows[i][1]), checked: rows[i][2], row: i + 2 };
  }
  return null;
}

/**
 * Removes everything saved for an invoice PDF: its problem rows (their Sorted tick and note go
 * into `kept`), its "_received" row, and the back orders it ticked off on earlier invoices.
 */
function removeInvoice_(key, invoice, kept) {
  const sh = sheet_(RECEIVING);
  const rows = receivingRows_();
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r[RCOL.key - 1] === key) {
      kept[norm_(r[RCOL.part - 1]) + '|' + r[RCOL.problem - 1]] = { sorted: r[RCOL.sorted - 1], note: r[RCOL.note - 1] };
      sh.deleteRow(i + 2);
    } else if (r[RCOL.problem - 1] === BACK_ORDER && norm_(r[RCOL.note - 1]) === norm_(ARRIVED + invoice)) {
      sh.getRange(i + 2, RCOL.sorted, 1, 2).setValues([['', '']]);
    }
  }
  const was = receivedRow_(key);
  if (was) sheet_(RECEIVED).deleteRow(was.row);
}

/**
 * The parts shipped on this invoice (and not saved as missing) have arrived: open back orders
 * for them from earlier invoices are ticked off with "Arrived on invoice …".
 */
function closeBackorders_(item, invoice, lines) {
  let shipped;
  try {
    shipped = invoiceLines_(receivingText_(item).text).filter(function (l) { return l.shipped > 0; });
  } catch (e) {
    return; // The PDF could not be read; back orders can still close on the next invoice.
  }
  const missing = {};
  lines.forEach(function (l) { if (l.problem === 'Missing') missing[norm_(l.part)] = true; });
  const came = {};
  shipped.forEach(function (l) { if (!missing[norm_(l.part)]) came[norm_(l.part)] = true; });

  const sh = sheet_(RECEIVING);
  const when = new Date(item.dateIso);
  receivingRows_().forEach(function (r, i) {
    if (r[RCOL.problem - 1] !== BACK_ORDER || r[RCOL.sorted - 1] || r[RCOL.key - 1] === item.key) return;
    if (!came[norm_(r[RCOL.part - 1])]) return;
    if (!(r[RCOL.invDate - 1] instanceof Date) || r[RCOL.invDate - 1] >= when) return;
    sh.getRange(i + 2, RCOL.sorted, 1, 2).setValues([[new Date(), ARRIVED + invoice]]);
  });
}

/** The problems from invoices checked in one week, grouped Missing, Extra, Back order. */
function weekReport_(monday) {
  const tz = ss_().getSpreadsheetTimeZone();
  const sunday = addDays_(monday, 6);
  const rows = receivingRows_().filter(function (r) {
    if (!(r[0] instanceof Date)) return false;
    const d = Utilities.formatDate(r[0], tz, 'yyyy-MM-dd');
    return d >= monday && d <= sunday;
  });
  const groups = PROBLEMS.map(function (p) {
    const lines = rows.filter(function (r) { return r[RCOL.problem - 1] === p; }).map(problemLine_);
    return { problem: p, lines: lines,
      qty: lines.reduce(function (n, l) { return n + l.qty; }, 0),
      open: lines.filter(function (l) { return !l.sorted; }).length };
  });
  return { monday: monday, sunday: sunday, groups: groups };
}

/** Rebuilds the "Receiving · Week" tab: this week's problems, grouped, with whether each is sorted. */
function rebuildReceivingWeek_() {
  const out = ss_().getSheetByName(RECEIVING_WEEK);
  if (!out) return;
  out.clear();
  const week = weekReport_(mondayOf_(todayIso_()));
  const all = week.groups.reduce(function (n, g) { return n + g.lines.length; }, 0);
  const open = week.groups.reduce(function (n, g) { return n + g.open; }, 0);

  const values = [
    ['Week of ' + isoText_(week.monday) + ' to ' + isoText_(week.sunday),
      all + (all === 1 ? ' problem, ' : ' problems, ') + open + ' not sorted yet', '', '', '', '', ''],
    ['Problem', 'Part Number', 'Quantity', 'Invoice Number', 'Date Checked', 'Sorted', 'Note'],
  ];
  const groupRows = [];
  week.groups.forEach(function (g) {
    groupRows.push(values.length + 1);
    values.push([g.problem, g.lines.length + (g.lines.length === 1 ? ' line' : ' lines'), g.qty, '', '',
      g.open + ' not sorted', '']);
    g.lines.forEach(function (l) {
      values.push(['', l.part, l.qty, l.invoice, l.when, l.sorted ? 'Sorted ' + l.sorted : 'Not sorted', l.note]);
    });
  });

  out.getRange(1, 1, values.length, 7).setNumberFormats(values.map(function () {
    return ['@', '@', '0', '@', '@', '@', '@'];
  })).setValues(values);
  out.getRange(1, 1, 1, 7).setFontWeight('bold');
  out.getRange(2, 1, 1, 7).setFontWeight('bold').setBackground(RECEIVING_COLOUR).setFontColor('#ffffff');
  groupRows.forEach(function (r) {
    out.getRange(r, 1, 1, 7).setFontWeight('bold').setBackground('#fdf3e3');
  });
  out.setFrozenRows(2);
  [110, 180, 90, 150, 130, 150, 240].forEach(function (w, i) { out.setColumnWidth(i + 1, w); });
}

/** "2026-10-19" as "19 Oct 2026". Noon UTC, so no time zone moves it to another day. */
function isoText_(iso) {
  return Utilities.formatDate(new Date(iso + 'T12:00:00Z'), ss_().getSpreadsheetTimeZone(), 'd MMM yyyy');
}

// ---------------------------------------------------------------------------
// Sheet tabs for this section (called from setup() in Main.gs, after the Scheduling tabs)

function setupReceiving_(ss) {
  // Right after the Returns tabs.
  const at = ss.getSheetByName(BY_INVOICE) ? ss.getSheetByName(BY_INVOICE).getIndex() : 0;
  let sh = ss.getSheetByName(RECEIVING);
  if (!sh) {
    sh = ss.insertSheet(RECEIVING, at);
    sh.getRange(1, 1, 1, RECEIVING_HEADERS.length).setValues([RECEIVING_HEADERS]);
  }
  sh.getRange(1, 1, 1, RECEIVING_HEADERS.length).setFontWeight('bold').setBackground(RECEIVING_COLOUR)
    .setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.getRange('A:A').setNumberFormat('d mmm yyyy, h:mm am/pm');
  sh.getRange('B:B').setNumberFormat('@');
  sh.getRange('C:C').setNumberFormat('d mmm yyyy');
  sh.getRange('D:D').setNumberFormat('@');
  sh.getRange('G:G').setNumberFormat('0');
  sh.getRange('H:H').setNumberFormat('d mmm yyyy');
  [170, 130, 110, 140, 220, 100, 80, 110, 220, 70].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.hideColumns(RCOL.key);
  if (!sh.getFilter()) sh.getRange(1, 1, sh.getMaxRows(), RECEIVING_HEADERS.length).createFilter();
  sh.setTabColor(RECEIVING_COLOUR);

  if (!ss.getSheetByName(RECEIVING_WEEK)) ss.insertSheet(RECEIVING_WEEK, sh.getIndex());
  ss.getSheetByName(RECEIVING_WEEK).setTabColor(RECEIVING_COLOUR);

  if (!ss.getSheetByName(RECEIVED)) {
    const r = ss.insertSheet(RECEIVED);
    r.getRange(1, 1, 1, 4).setValues([['Key', 'Invoice', 'Checked', 'Problems']]);
    r.hideSheet();
  }
  rebuildReceivingWeek_();
}
