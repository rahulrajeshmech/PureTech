/**
 * PureTech — Returns section
 *
 * A web page that searches Gmail for supplier invoices (PDFs) containing a
 * part number, lets the user pick one and records the return in this Google
 * Sheet. Works with any supplier: the PDF is read with Google Drive's text
 * recognition and the invoice number is guessed, then confirmed by the user.
 */

// How many not-yet-returned invoices to show. A few spares are fetched in case
// one turns out to be an invoice already used under a different email.
const SHOW_INVOICES = 15;
const SPARE_INVOICES = 5;
// Stop looking after this many emails, so a very common part can't stall the search.
const MAX_EMAILS_SCANNED = 300;
const SEARCH_EXTRA = 'has:attachment filename:pdf';

// Most of one part that can be returned in one go.
const MAX_QTY = 999;

const RETURNS = 'Returns';
const BY_PALLET = 'By Pallet';
const BY_INVOICE = 'By Invoice';
const PALLETS = '_pallets';
const CACHE = '_pdf_cache';
// Comment was added last, after the hidden Key column, so the other columns don't move.
const RETURN_HEADERS = ['Date Returned', 'Pallet', 'Part Number', 'Quantity', 'Invoice Number',
  'Category', 'Email Date', 'PDF File', 'Email', 'Key', 'Comment'];
const COL = { date: 1, pallet: 2, part: 3, qty: 4, invoice: 5, category: 6, emailDate: 7, file: 8, email: 9, key: 10,
  comment: 11 };
const MAX_COMMENT = 500;
const CATEGORIES = ['Defect', 'Core', 'New Return'];

// ---------------------------------------------------------------------------
// Called from the page

/**
 * Finds PDF attachments in emails matching the part number, newest first, until
 * there are enough where the part has not been returned yet. Fast: does not open
 * the PDFs (readInvoice does that, one at a time, from the page).
 */
function searchPart(part) {
  part = String(part || '').trim();
  const out = { items: [], returned: [], returnedInvoices: [], show: SHOW_INVOICES };
  if (!part) return out;

  const q = partQuery_(part) + ' ' + SEARCH_EXTRA;
  const done = returnedFor_(part);
  out.returnedInvoices = done.invoices;
  const tz = ss_().getSpreadsheetTimeZone();
  const wanted = SHOW_INVOICES + SPARE_INVOICES;

  let pageToken, scanned = 0;
  do {
    const res = Gmail.Users.Messages.list('me', { q: q, maxResults: 50, pageToken: pageToken });
    pageToken = res.nextPageToken;
    const messages = res.messages || [];
    for (let n = 0; n < messages.length && out.items.length < wanted; n++) {
      const m = messages[n];
      scanned++;
      const msg = GmailApp.getMessageById(m.id);
      msg.getAttachments({ includeInlineImages: false }).forEach(function (a, i) {
        if (!isPdf_(a)) return;
        const key = m.id + ':' + i;
        const item = {
          key: key,
          messageId: m.id,
          threadId: m.threadId,
          index: i,
          fileName: a.getName(),
          supplier: supplierName_(msg.getFrom()),
          subject: msg.getSubject(),
          dateIso: msg.getDate().toISOString(),
          dateText: Utilities.formatDate(msg.getDate(), tz, 'd MMM yyyy'),
          returnedOn: done.keys[key] ? done.keys[key].when : '',
          returnedInvoice: done.keys[key] ? done.keys[key].invoice : '',
          returnedQty: done.keys[key] ? done.keys[key].qty : 0,
        };
        (item.returnedOn ? out.returned : out.items).push(item);
      });
    }
  } while (pageToken && out.items.length < wanted && scanned < MAX_EMAILS_SCANNED);
  return out;
}

/** Reads one PDF: its guessed invoice number, the line with the part and how many were shipped. */
function readInvoice(item, part) {
  let info = cacheGet_(item.key);
  if (!info) {
    const att = GmailApp.getMessageById(item.messageId)
      .getAttachments({ includeInlineImages: false })[item.index];
    const text = pdfText_(att.copyBlob());
    info = { text: text, invoice: guessInvoice_(text, item.subject, item.fileName) };
    cachePut_(item.key, info);
  }
  return {
    invoice: info.invoice,
    found: norm_(info.text).indexOf(norm_(part)) !== -1,
    line: findLine_(info.text, part),
    shipped: guessQty_(info.text, part),
  };
}

/** Saves the return on the open pallet and rebuilds the "By Pallet" and "By Invoice" tabs. */
function recordReturn(item, part, invoice, qty, category, comment) {
  part = String(part || '').trim().toUpperCase();
  invoice = String(invoice || '').trim().toUpperCase();
  qty = Number(qty === undefined ? 1 : qty);
  const cat = CATEGORIES.includes(category) ? category : 'Defect';
  if (!part || !invoice) throw new Error('Part number and invoice number are both needed.');
  if (!(qty >= 1 && qty <= MAX_QTY && Math.floor(qty) === qty)) {
    throw new Error('The quantity must be a whole number from 1 to ' + MAX_QTY + '.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(RETURNS);
    ensureCommentColumn_(sh);
    const pallet = openPallet_();
    const link = 'https://mail.google.com/mail/u/0/#all/' + item.threadId;
    sh.appendRow([new Date(), pallet, part, qty, invoice, cat, new Date(item.dateIso),
      item.fileName, '', norm_(part) + '|' + item.key, cleanComment_(comment)]);
    const row = sh.getLastRow();
    sh.getRange(row, COL.email).setFormula('=HYPERLINK("' + link + '","Open")');
    if (row > 2) {
      sh.getRange(2, 1, row - 1, RETURN_HEADERS.length).sort({ column: COL.date, ascending: false });
    }
    rebuildAll_();
    return { invoice: invoice, pallet: pallet, qty: qty, category: cat };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Undoes a return: deletes the newest matching row from the Returns tab.
 * Matches the exact invoice PDF first, then the same part + invoice number
 * (for invoices that were returned under a different email).
 */
function undoReturn(item, part, invoice) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(RETURNS);
    if (sh.getLastRow() < 2) throw new Error('There is no return to undo.');
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, RETURN_HEADERS.length).getValues();
    const key = norm_(part) + '|' + item.key;
    const byKey = function (r) { return r[COL.key - 1] === key; };
    const byInvoice = function (r) {
      return norm_(r[COL.part - 1]) === norm_(part) && norm_(r[COL.invoice - 1]) === norm_(invoice);
    };
    let found = -1;
    [byKey, byInvoice].some(function (match) {
      rows.forEach(function (r, i) {
        if (match(r) && (found === -1 || r[COL.date - 1] > rows[found][COL.date - 1])) found = i;
      });
      return found !== -1;
    });
    if (found === -1) throw new Error('That return was not found. It may already have been undone.');
    sh.deleteRow(found + 2);
    rebuildAll_();
    return { invoice: String(rows[found][COL.invoice - 1]) };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Pallets. Returns are put on the open pallet; "_pallets" remembers each pallet's dates.

/** All pallets, newest first: number, dates as text, open or finished, how many parts are on it. */
function getPallets() {
  // The page loads the pallets first thing, so this is where older sheets get the Comment column.
  ensureCommentColumn_(sheet_(RETURNS));
  const tz = ss_().getSpreadsheetTimeZone();
  const day = function (d) { return d instanceof Date ? Utilities.formatDate(d, tz, 'd MMM yyyy') : String(d || ''); };
  const qty = palletQty_();
  return pallets_().reverse().map(function (p) {
    return { number: p.number, started: day(p.started), finished: day(p.finished), open: !p.finished,
      qty: qty[p.number] || 0 };
  });
}

/** The returns on one pallet, newest first. */
function getPallet(number) {
  number = Number(number);
  const tz = ss_().getSpreadsheetTimeZone();
  return returnRows_().filter(function (r) { return Number(r[COL.pallet - 1]) === number; })
    .map(function (r) {
      return { id: rowId_(r), part: String(r[COL.part - 1]), qty: Number(r[COL.qty - 1]) || 1,
        invoice: String(r[COL.invoice - 1]),
        category: String(r[COL.category - 1]) || 'Defect',
        comment: String(r[COL.comment - 1] || ''),
        when: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'd MMM yyyy') : String(r[0]) };
    });
}

/** Changes the category of one return (by its id from getPallet). */
function setCategory(id, category) {
  if (!CATEGORIES.includes(category)) throw new Error('Category must be Defect, Core, or New Return.');
  return withLock_(function () {
    const rows = returnRows_();
    for (let i = 0; i < rows.length; i++) {
      if (rowId_(rows[i]) === id) {
        sheet_(RETURNS).getRange(i + 2, COL.category).setValue(category);
        rebuildAll_();
        return getPallets();
      }
    }
    throw new Error('That return was not found.');
  });
}

/** Adds, changes or (when empty) clears the comment on one return (by its id from getPallet). */
function setComment(id, comment) {
  return withLock_(function () {
    const rows = returnRows_();
    for (let i = 0; i < rows.length; i++) {
      if (rowId_(rows[i]) === id) {
        sheet_(RETURNS).getRange(i + 2, COL.comment).setValue(cleanComment_(comment));
        rebuildAll_();
        return { comment: String(comment || '').replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT) };
      }
    }
    throw new Error('That return was not found. It may have been deleted.');
  });
}

/**
 * A comment as it is stored: one line, at most MAX_COMMENT characters. A leading
 * apostrophe stops Sheets reading text such as "=see note" or "-2 damaged" as a formula.
 */
function cleanComment_(comment) {
  const c = String(comment || '').replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT);
  return /^[=+\-@]/.test(c) ? "'" + c : c;
}

/**
 * Sheets made before comments end at Key: give them the Comment heading (column K) and
 * widen the filter to cover it. Cheap when it is already there: reads one cell.
 */
function ensureCommentColumn_(sh) {
  if (sh.getRange(1, COL.comment).getValue() === 'Comment') return;
  sh.getRange(1, COL.comment).setValue('Comment')
    .setFontWeight('bold').setBackground('#1d7a3a').setFontColor('#ffffff');
  sh.setColumnWidth(COL.comment, 300);
  const filter = sh.getFilter();
  if (filter && filter.getRange().getLastColumn() < RETURN_HEADERS.length) {
    filter.remove();
    sh.getRange(1, 1, sh.getMaxRows(), RETURN_HEADERS.length).createFilter();
  }
}

/** Finishes the open pallet and starts the next one. */
function newPallet() {
  return withLock_(function () {
    const sh = sheet_(PALLETS);
    const list = pallets_();
    const open = list.filter(function (p) { return !p.finished; })[0];
    if (open) {
      if (!palletQty_()[open.number]) throw new Error('Pallet ' + open.number + ' is still empty.');
      sh.getRange(open.row, 3).setValue(new Date());
    }
    const last = list.length ? list[list.length - 1].number : 0;
    sh.appendRow([last + 1, new Date(), '']);
    rebuildByPallet_();
    return getPallets();
  });
}

/** Puts new returns on an earlier pallet again. The pallet in use is finished, or removed if empty. */
function reopenPallet(number) {
  number = Number(number);
  return withLock_(function () {
    const sh = sheet_(PALLETS);
    const list = pallets_();
    const target = list.filter(function (p) { return p.number === number; })[0];
    if (!target) throw new Error('Pallet ' + number + ' was not found.');
    const open = list.filter(function (p) { return !p.finished; })[0];
    if (open !== target) {
      sh.getRange(target.row, 3).setValue('');
      if (open && !palletQty_()[open.number]) sh.deleteRow(open.row);
      else if (open) sh.getRange(open.row, 3).setValue(new Date());
    }
    rebuildByPallet_();
    return getPallets();
  });
}

/** Moves one return (by its id from getPallet) to another pallet. */
function moveToPallet(id, number) {
  number = Number(number);
  return withLock_(function () {
    if (!pallets_().some(function (p) { return p.number === number; })) {
      throw new Error('Pallet ' + number + ' was not found.');
    }
    const rows = returnRows_();
    for (let i = 0; i < rows.length; i++) {
      if (rowId_(rows[i]) === id) {
        sheet_(RETURNS).getRange(i + 2, COL.pallet).setValue(number);
        rebuildByPallet_();
        return getPallets();
      }
    }
    throw new Error('That return was not found. It may have been undone.');
  });
}

/** Deletes one return (by its id from getPallet), the same as undoing it. */
function deleteReturn(id) {
  return withLock_(function () {
    const rows = returnRows_();
    for (let i = 0; i < rows.length; i++) {
      if (rowId_(rows[i]) === id) {
        sheet_(RETURNS).deleteRow(i + 2);
        rebuildAll_();
        return getPallets();
      }
    }
    throw new Error('That return was not found. It may already have been deleted.');
  });
}

/** The number of the pallet returns go on now, starting Pallet 1 if there is none. */
function openPallet_() {
  const list = pallets_();
  const open = list.filter(function (p) { return !p.finished; })[0];
  if (open) return open.number;
  const number = list.length ? list[list.length - 1].number + 1 : 1;
  sheet_(PALLETS).appendRow([number, new Date(), '']);
  return number;
}

/** Rows of the "_pallets" tab, lowest number first: {number, started, finished, row}. */
function pallets_() {
  const sh = sheet_(PALLETS);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().map(function (r, i) {
    return { number: Number(r[0]), started: r[1], finished: r[2], row: i + 2 };
  }).filter(function (p) { return p.number; }).sort(function (a, b) { return a.number - b.number; });
}

/** How many parts are on each pallet: {number: total quantity}. */
function palletQty_() {
  const out = {};
  returnRows_().forEach(function (r) {
    const n = Number(r[COL.pallet - 1]);
    if (n) out[n] = (out[n] || 0) + (Number(r[COL.qty - 1]) || 1);
  });
  return out;
}

function returnRows_() {
  const sh = sheet_(RETURNS);
  return sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, RETURN_HEADERS.length).getValues();
}

/** Identifies one row: the key repeats when more is returned later from the same invoice. */
function rowId_(r) {
  return r[COL.key - 1] + '|' + (r[0] instanceof Date ? r[0].getTime() : String(r[0]));
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Sheet tabs for this section (called from setup() in Main.gs)

function setupReturns_(ss) {
  let sh = ss.getSheetByName(RETURNS) || ss.insertSheet(RETURNS, 0);
  if (sh.getLastRow() > 0 && sh.getRange(1, 1, 1, 2).getValues()[0][1] === 'Part Number') moveToPalletLayout_(sh);
  fixReturnsData_();
  sh.getRange(1, 1, 1, RETURN_HEADERS.length).setValues([RETURN_HEADERS])
    .setFontWeight('bold').setBackground('#1d7a3a').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  formatReturns_(sh);
  [170, 70, 140, 80, 140, 90, 110, 200, 70].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.hideColumns(COL.key);
  if (!sh.getFilter()) sh.getRange(1, 1, sh.getMaxRows(), RETURN_HEADERS.length).createFilter();
  ensureCommentColumn_(sh);

  if (!ss.getSheetByName(PALLETS)) {
    const p = ss.insertSheet(PALLETS);
    p.getRange(1, 1, 1, 3).setValues([['Pallet', 'Started', 'Finished']]);
    p.appendRow([1, oldestReturn_(sh) || new Date(), '']);
    p.hideSheet();
  }
  if (!ss.getSheetByName(BY_PALLET)) ss.insertSheet(BY_PALLET, 1);
  if (!ss.getSheetByName(BY_INVOICE)) ss.insertSheet(BY_INVOICE, 2);
  rebuildAll_();

  const cache = ss.getSheetByName(CACHE) || ss.insertSheet(CACHE);
  cache.getRange(1, 1, 1, 3).setValues([['Key', 'Invoice', 'Text']]);
  cache.hideSheet();

  sh.setTabColor('#1d7a3a');
  ss.getSheetByName(BY_PALLET).setTabColor('#1d7a3a');
  ss.getSheetByName(BY_INVOICE).setTabColor('#1d7a3a');
}

function formatReturns_(sh) {
  sh.getRange('A:A').setNumberFormat('d mmm yyyy, h:mm am/pm');
  sh.getRange('B:B').setNumberFormat('0');
  sh.getRange('C:C').setNumberFormat('@');
  sh.getRange('D:D').setNumberFormat('0');
  sh.getRange('E:E').setNumberFormat('@');
  sh.getRange('F:F').setNumberFormat('@');
  sh.getRange('G:G').setNumberFormat('d mmm yyyy');
}

/**
 * Repairs rows saved before the Category column existed. Detects old-format rows by
 * checking whether column 6 holds a Date (the old Email Date) instead of a category string,
 * then rewrites those rows in the new 10-column layout with 'Defect' as the category.
 * Safe to call on a sheet with mixed old and new rows.
 */
function fixReturnsData() {
  return withLock_(function () {
    return fixReturnsData_();
  });
}

function fixReturnsData_() {
  const sh = sheet_(RETURNS);
  if (sh.getLastRow() < 2) return 'Nothing to fix.';
  const n = sh.getLastRow() - 1;
  const range = sh.getRange(2, 1, n, 10);
  const data = range.getValues();
  const formulas = range.getFormulas();
  let fixed = 0;
  const newData = data.map(function (r, i) {
    const cat = r[5];
    // Old row: col 6 holds a Date object OR a non-category string (date stored as text).
    const isOld = cat instanceof Date ||
      (typeof cat === 'string' && cat !== '' && !CATEGORIES.includes(cat));
    if (isOld) {
      fixed++;
      return [r[0], r[1], r[2], r[3], r[4], 'Defect', cat, r[6], formulas[i][7] || r[7], r[8]];
    }
    return r;
  });
  if (fixed > 0) {
    range.setValues(newData);
    rebuildAll_();
  }
  return 'Fixed ' + fixed + ' row' + (fixed === 1 ? '' : 's') + '. ' + (n - fixed) + ' already correct.';
}

/**
 * Before pallets the Returns tab was: Date Returned, Part Number, Invoice Number, Supplier,
 * Email Date, Email Subject, PDF File, Email, Key. Rewrites it in the new layout: every
 * return so far goes on Pallet 1 with quantity 1; supplier and subject are dropped.
 */
function moveToPalletLayout_(sh) {
  if (sh.getFilter()) sh.getFilter().remove();
  const n = sh.getLastRow() - 1;
  if (n < 1) return;
  const range = sh.getRange(2, 1, n, 9);
  const old = range.getValues();
  const formulas = range.getFormulas();
  formatReturns_(sh);
  sh.getRange(2, 1, n, 10).setValues(old.map(function (r, i) {
    return [r[0], 1, String(r[1]), 1, String(r[2]), 'Defect', r[4], r[6], formulas[i][7] || r[7], r[8]];
  }));
}

function oldestReturn_(sh) {
  let oldest = null;
  if (sh.getLastRow() < 2) return oldest;
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
    if (r[0] instanceof Date && (!oldest || r[0] < oldest)) oldest = r[0];
  });
  return oldest;
}

// ---------------------------------------------------------------------------
// Helpers

function isPdf_(att) {
  return att.getContentType() === 'application/pdf' || /\.pdf$/i.test(att.getName());
}

function supplierName_(from) {
  const m = String(from).match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : String(from).replace(/[<>]/g, '')).trim();
}

/**
 * Gmail treats dashes, spaces and slashes as word breaks, so "CH-8115" is stored as
 * "CH 8115" and a search for "ch8115" misses it (and the other way round). Search
 * for every likely way of writing the part: joined up, and split where letters
 * meet digits (CH8115 / CH 8115 / CH-8115).
 */
function partQuery_(part) {
  const typed = String(part).replace(/["()]/g, ' ').replace(/[^A-Za-z0-9]+/g, ' ').trim();
  const joined = norm_(part);
  // Positions where a letter meets a digit, e.g. CH|8115 or AB|12|CD.
  const cuts = [];
  for (let i = 1; i < joined.length; i++) {
    if (/[A-Z]/.test(joined[i - 1]) !== /[A-Z]/.test(joined[i])) cuts.push(i);
  }
  const splitAt = function (positions) {
    let out = '', last = 0;
    positions.forEach(function (p) { out += joined.slice(last, p) + ' '; last = p; });
    return out + joined.slice(last);
  };
  const variants = [typed, joined, splitAt(cuts)];
  if (cuts.length <= 4) cuts.forEach(function (c) { variants.push(splitAt([c])); });

  const seen = {};
  const terms = variants.filter(function (v) {
    const k = v.toUpperCase();
    if (!v || seen[k]) return false;
    seen[k] = true;
    return true;
  }).map(function (v) { return '"' + v + '"'; });
  return terms.length > 1 ? '{' + terms.join(' ') + '}' : terms[0];
}

/** Already-returned PDFs and invoice numbers for this part, with how many were returned in all. */
function returnedFor_(part) {
  const out = { keys: {}, invoices: [] };
  const p = norm_(part);
  const tz = ss_().getSpreadsheetTimeZone();
  const byInvoice = {};
  // Newest first, so `when` is the last time it was returned.
  returnRows_().forEach(function (r) {
    if (norm_(r[COL.part - 1]) !== p) return;
    const when = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'd MMM yyyy') : String(r[0]);
    const qty = Number(r[COL.qty - 1]) || 1;
    const k = String(r[COL.key - 1]).split('|')[1];
    const byKey = out.keys[k] = out.keys[k] || { when: when, invoice: String(r[COL.invoice - 1]), qty: 0 };
    byKey.qty += qty;
    const i = norm_(r[COL.invoice - 1]);
    if (!byInvoice[i]) out.invoices.push(byInvoice[i] = { invoice: i, when: when, qty: 0 });
    byInvoice[i].qty += qty;
  });
  return out;
}

/** Converts a PDF to text using Google Drive's text recognition (works on scans too). */
function pdfText_(blob) {
  const file = Drive.Files.create(
    { name: 'temp-invoice-read', mimeType: MimeType.GOOGLE_DOCS }, blob, { ocrLanguage: 'en', fields: 'id' });
  try {
    return DocumentApp.openById(file.id).getBody().getText();
  } finally {
    Drive.Files.remove(file.id);
  }
}

// Labels suppliers commonly put before the invoice number. The value must contain a digit.
const INVOICE_PATTERNS = [
  /(?:tax\s*)?invoice\s*(?:no|number|num|nbr|#)\.?\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-\/]*)/gi,
  /\binv(?:oice)?\.?\s*(?:no\.?\s*)?[#:]\s*([A-Z0-9][A-Z0-9\-\/]*)/gi,
  /\b(?:bill|document|doc)\s*(?:no|number)\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]*)/gi,
];
const LOOSE_PATTERN = /\binv(?:oice)?[\s_\-#:.]*([A-Z0-9\-\/]*\d[A-Z0-9\-\/]*)/gi;

/** Best guess at the invoice number: PDF text first, then email subject, then file name. */
function guessInvoice_(text, subject, fileName) {
  const sources = [
    [text, INVOICE_PATTERNS],
    [subject, INVOICE_PATTERNS.concat([LOOSE_PATTERN])],
    [String(fileName || '').replace(/\.pdf$/i, ''), [LOOSE_PATTERN]],
  ];
  for (let s = 0; s < sources.length; s++) {
    const str = String(sources[s][0] || '');
    const patterns = sources[s][1];
    for (let p = 0; p < patterns.length; p++) {
      const re = new RegExp(patterns[p].source, patterns[p].flags);
      let m;
      while ((m = re.exec(str))) {
        const v = m[1].replace(/[\-\/]+$/, '');
        if (/\d/.test(v) && v.length >= 3) return v.toUpperCase();
      }
    }
  }
  return '';
}

/** The PDF line mentioning the part, so the user can see it really is on the invoice. */
function findLine_(text, part) {
  const p = norm_(part);
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (norm_(lines[i]).indexOf(p) !== -1) {
      return lines[i].replace(/\s+/g, ' ').trim().slice(0, 160);
    }
  }
  return '';
}

/**
 * How many of the part were shipped, read from its line on the invoice, or null if unclear.
 * Vast-Auto lines: "SPI F44B  FUEL TANK  EA  1  1  0  420.28 …" are UNIT, ORDERED, SHIPPED,
 * B/O, then the price, so it takes the second number. Other layouts: the first whole number
 * after the part, e.g. the 2 in "CH-8115 Oil filter 2 @ 12.50".
 */
function guessQty_(text, part) {
  const p = norm_(part);
  if (!p) return null;
  const partRe = new RegExp(p.split('').join('[^A-Z0-9]*'), 'i');
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = partRe.exec(lines[i]);
    if (!m) continue;
    const rest = lines[i].slice(m.index + m[0].length);
    const table = rest.match(/\b[A-Z]{2,3}\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+\.\d\d\b/i);
    if (table) return Number(table[2]);
    const loose = rest.match(/(?:^|\s)(\d{1,4})(?=\s|$)/);
    return loose ? Number(loose[1]) : null;
  }
  return null;
}

function cacheGet_(key) {
  const sh = ss_().getSheetByName(CACHE);
  if (!sh || sh.getLastRow() < 2) return null;
  const hit = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
  if (!hit) return null;
  const r = sh.getRange(hit.getRow(), 1, 1, 3).getValues()[0];
  return { invoice: String(r[1]), text: String(r[2]) };
}

function cachePut_(key, info) {
  const sh = ss_().getSheetByName(CACHE);
  if (!sh) return;
  // A cell holds at most 50,000 characters; the part list is near the top anyway.
  sh.appendRow([key, info.invoice, "'" + info.text.slice(0, 45000)]);
}

function rebuildAll_() {
  rebuildByPallet_();
  rebuildByInvoice_();
}

/** Rebuilds the "By Pallet" tab: one block per pallet, newest first, listing what is on it. */
function rebuildByPallet_() {
  const ss = ss_();
  const out = ss.getSheetByName(BY_PALLET);
  if (!out || !ss.getSheetByName(PALLETS)) return;
  out.clear();
  const tz = ss.getSpreadsheetTimeZone();
  const day = function (d) { return d instanceof Date ? Utilities.formatDate(d, tz, 'd MMM yyyy') : String(d || ''); };
  const rows = returnRows_();

  const values = [['Pallet', 'Part Number', 'Quantity', 'Invoice Number', 'Date Returned', 'Category', 'Comment']];
  const groupRows = [];
  const block = function (title, status, g) {
    groupRows.push(values.length + 1);
    values.push([title, status, g.reduce(function (n, r) { return n + (Number(r[COL.qty - 1]) || 1); }, 0), '', '', '', '']);
    g.forEach(function (r) {
      values.push(['', r[COL.part - 1], r[COL.qty - 1], r[COL.invoice - 1], r[COL.date - 1],
        String(r[COL.category - 1]) || 'Defect', String(r[COL.comment - 1] || '')]);
    });
  };
  const list = pallets_();
  list.slice().reverse().forEach(function (p) {
    block('Pallet ' + p.number,
      p.finished ? day(p.started) + (day(p.finished) !== day(p.started) ? ' to ' + day(p.finished) : '')
        : 'Started ' + day(p.started) + ', still open',
      rows.filter(function (r) { return Number(r[COL.pallet - 1]) === p.number; }));
  });
  const known = {};
  list.forEach(function (p) { known[p.number] = true; });
  const loose = rows.filter(function (r) { return !known[Number(r[COL.pallet - 1])]; });
  if (loose.length) block('No pallet', '', loose);

  out.getRange(1, 1, values.length, 7).setNumberFormats(values.map(function () {
    return ['@', '@', '0', '@', 'd mmm yyyy', '@', '@'];
  })).setValues(values);
  out.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#1d7a3a').setFontColor('#ffffff');
  groupRows.forEach(function (r) {
    out.getRange(r, 1, 1, 7).setFontWeight('bold').setBackground('#e3f5e8');
  });
  out.setFrozenRows(1);
  [110, 220, 90, 160, 130, 90, 300].forEach(function (w, i) { out.setColumnWidth(i + 1, w); });
}

/** Rebuilds the "By Invoice" tab: one block per invoice number, listing the parts returned. */
function rebuildByInvoice_() {
  const ss = ss_();
  const out = ss.getSheetByName(BY_INVOICE);
  if (!out) return;
  out.clear();
  const rows = returnRows_();

  const groups = {};
  rows.forEach(function (r) {
    const k = String(r[COL.invoice - 1]);
    (groups[k] = groups[k] || []).push(r);
  });
  const keys = Object.keys(groups).sort(function (a, b) {
    return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
  });

  const values = [['Invoice Number', 'Part Number', 'Quantity', 'Date Returned', 'Pallet', 'Category', 'Comment']];
  const groupRows = [];
  keys.forEach(function (k) {
    const g = groups[k].sort(function (a, b) {
      return String(a[COL.part - 1]).localeCompare(String(b[COL.part - 1]));
    });
    groupRows.push(values.length + 1);
    values.push([k, 'Total returned', g.reduce(function (n, r) { return n + (Number(r[COL.qty - 1]) || 1); }, 0), '', '', '', '']);
    g.forEach(function (r) {
      values.push(['', r[COL.part - 1], r[COL.qty - 1], r[COL.date - 1], r[COL.pallet - 1],
        String(r[COL.category - 1]) || 'Defect', String(r[COL.comment - 1] || '')]);
    });
  });

  out.getRange(1, 1, values.length, 7).setNumberFormats(values.map(function () {
    return ['@', '@', '0', 'd mmm yyyy', '0', '@', '@'];
  })).setValues(values);
  out.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#1d7a3a').setFontColor('#ffffff');
  groupRows.forEach(function (r) {
    out.getRange(r, 1, 1, 7).setFontWeight('bold').setBackground('#e3f5e8');
  });
  out.setFrozenRows(1);
  [160, 160, 90, 130, 70, 90, 300].forEach(function (w, i) { out.setColumnWidth(i + 1, w); });
}
