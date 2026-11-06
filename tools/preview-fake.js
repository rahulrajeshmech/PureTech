// PureTech preview: stands in for Google so the page runs from a local file.
// tools/preview.mjs pastes this into the preview page, with the real .gs code
// in place of SERVER_CODE. Schedule, Receiving and saving/undo use the real server
// code on pretend sheets; Gmail and the PDFs are replaced by a few demo invoices.
// Changes are kept in this browser until "Reset demo data" is pressed.
(function () {
  const STORE = 'puretech-preview-v5';
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---- demo data -----------------------------------------------------------
  function demoTabs() {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const day = n => { const d = new Date(monday); d.setDate(monday.getDate() + n); return iso(d); };
    const week = s => [...'MTWTFSS'].map((x, i) => s.includes(i));
    const ago = (days, hour) => { const d = new Date(today); d.setDate(d.getDate() - days); d.setHours(hour || 9, 0, 0, 0); return d; };
    const people = [
      ['Ana', 'Full time', [0, 1, 2, 3, 4]], ['Ben', 'Full time', [0, 1, 2, 3, 4, 5]], ['Chloe', 'Full time', [1, 2, 3, 4, 5]],
      ['Priya', 'Part time', [1, 2, 5]], ['Dev', 'Part time', [0, 3, 4]],
      ['Sam', 'Driver', [0, 1, 2, 3, 4]], ['Tom', 'Driver', [2, 3, 4, 5]],
    ];
    return {
      'Returns': [['Date Returned', 'Pallet', 'Part Number', 'Quantity', 'Invoice Number', 'Category', 'Email Date', 'PDF File', 'Email', 'Key', 'Comment']],
      'By Pallet': [[]],
      'By Invoice': [[]],
      '_pallets': [['Pallet', 'Started', 'Finished'], [1, today, '']],
      '_pdf_cache': [['Key', 'Invoice', 'Text']],
      // Invoice 31CX7001 was checked 4 days ago: two back orders and a missing part.
      // One from 10 days ago, already sorted, so the week report has an earlier week.
      'Receiving': [['Date Checked', 'Invoice Number', 'Invoice Date', 'Part Number', 'Description', 'Problem', 'Quantity', 'Sorted', 'Note', 'Email', 'Key'],
        [ago(4), '31CX7001', ago(5), 'CH8115', 'OIL FILTER', 'Back order', 2, '', '', 'Open', 'r1:0'],
        [ago(4), '31CX7001', ago(5), '171577', 'STRUT ASSEMBLY', 'Back order', 1, '', '', 'Open', 'r1:0'],
        [ago(4), '31CX7001', ago(5), 'BP-4471', '', 'Missing', 1, '', '', 'Open', 'r1:0'],
        [ago(10), '31CX6890', ago(11), 'WA-120', '', 'Missing', 2, ago(8), '', 'Open', 'r0:0']],
      'Receiving · Week': [[]],
      '_received': [['Key', 'Invoice', 'Checked', 'Problems'], ['r1:0', '31CX7001', ago(4), 3], ['r0:0', '31CX6890', ago(10), 1]],
      'Schedule · Staff': [['Name', 'Type', 'Active']].concat(people.map(p => [p[0], p[1], true])),
      'Schedule · Base Week': [['Name', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']].concat(people.map(p => [p[0]].concat(week(p[2])))),
      'Schedule · Needed': [['Type', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        ['Full time', 2, 2, 2, 2, 2, 1, 0], ['Part time', 1, 1, 1, 1, 1, 1, 0], ['Driver', 1, 1, 2, 2, 2, 1, 0]],
      // Sam is off on Tuesday this week, so the calendar shows a short day straight away.
      'Schedule · Changes': [['Date', 'Name', 'Change', 'Reason'], [day(1), 'Sam', 'Off', 'Sick']],
    };
  }

  const DEMO_EMAILS = [
    // Laid out like a real Vast-Auto invoice: UNIT, ORDERED, SHIPPED, B/O, then prices.
    { id: 'm5', from: '"Eastway Auto Distribution" <invoices@eastway.example>', subject: 'Invoice 31CX9012', file: 'INV_31CX9012.pdf', daysAgo: 1,
      text: 'EASTWAY AUTO DISTRIBUTION\nINVOICE\nNo. 31CX9012\nITEM DESCRIPTION UNIT ORDERED SHIPPED B/O PRICE NET PRICE NET CORE EXT PRICE\n'
        + 'SPI F44B FUEL TANK EA 1 1 0 420.28 271.84 0.00 271.84\nFRA CH8115 OIL FILTER EA 6 4 2 14.20 9.10 0.00 36.40' },
    { id: 'm1', from: '"Northside Parts Co" <invoices@northside.example>', subject: 'Tax Invoice INV-204518', file: 'INV-204518.pdf', daysAgo: 2,
      text: 'NORTHSIDE PARTS CO\nTax Invoice No: INV-204518\nCH-8115 Oil filter 2 @ 12.50\nBP-4471 Brake pads front 1 @ 89.00' },
    { id: 'm2', from: '"Coastal Auto Supply" <accounts@coastal.example>', subject: 'Your invoice 77812', file: 'scan_0042.pdf', daysAgo: 9,
      text: 'COASTAL AUTO SUPPLY\nInvoice # 77812\nCH8115 OIL FILTER 4 @ 11.90\nWA-120 Wiper blade 2 @ 15.00' },
    { id: 'm3', from: 'Metro Trade Spares <trade@metro.example>', subject: 'Invoice attached', file: 'Bill-B55310.pdf', daysAgo: 21,
      text: 'METRO TRADE SPARES\nBill No: B55310\nBP 4471 Brake pad set 2 @ 84.00\nSP-9 Spark plug 8 @ 7.20' },
    { id: 'm4', from: '"Northside Parts Co" <invoices@northside.example>', subject: 'Tax Invoice INV-199870', file: 'INV-199870.pdf', daysAgo: 40,
      text: 'NORTHSIDE PARTS CO\nTax Invoice No: INV-199870\nCH-8115 Oil filter 6 @ 12.50\nAF-301 Air filter 1 @ 24.00' },
  ];

  // Receiving: Vast-Auto invoices, laid out like the real ones (UNIT, ORDERED, SHIPPED, B/O, prices).
  const VAST = '"Vast-Auto Distribution" <csvado@vastauto.example>';
  const vastText = (no, lines) => 'VAST-AUTO DISTRIBUTION\nINVOICE\nNo. ' + no + '\nUNIT ORDERED SHIPPED B/O PRICE NET NET EXT\n'
    + 'PRICE CORE PRICE ITEM DESCRIPTION\n' + lines.join('\n') + '\n*** Page 1 of 1 ***';
  const RECEIVING_EMAILS = [
    { id: 'r4', from: VAST, subject: 'Invoice 31CX7051', file: '31CX7051.pdf', daysAgo: 0,
      text: vastText('31CX7051', ['ACD 41-110 SPARK PLUG EA 4 4 0 9.80 6.10 0.00 24.40', 'MON 171577 STRUT ASSEMBLY EA 1 1 0 210.00 141.20 0.00 141.20']) },
    { id: 'r3', from: VAST, subject: 'Invoice 31CX7044', file: '31CX7044.pdf', daysAgo: 1,
      text: vastText('31CX7044', ['FRA CH8115 OIL FILTER EA 2 2 0 14.20 9.10 0.00 18.20', 'DOR 924-301 BRAKE LINE EA 1 1 0 22.40 15.30 0.00 15.30',
        'SPI F44B FUEL TANK EA 2 1 1 420.28 271.84 0.00 271.84']) },
    { id: 'r2', from: VAST, subject: 'Invoice 31CX7020', file: '31CX7020.pdf', daysAgo: 3,
      text: vastText('31CX7020', ['WIX 51515 OIL FILTER EA 10 10 0 8.10 5.20 0.00 52.00', 'BOS 0242 SPARK PLUG EA 8 6 2 7.20 4.90 0.00 29.40']) },
    { id: 'r1', from: VAST, subject: 'Invoice 31CX7001', file: '31CX7001.pdf', daysAgo: 5,
      text: vastText('31CX7001', ['FRA CH8115 OIL FILTER EA 6 4 2 14.20 9.10 0.00 36.40', 'MON 171577 STRUT ASSEMBLY EA 2 1 1 210.00 141.20 0.00 141.20']) },
  ];

  // ---- pretend spreadsheet ---------------------------------------------------
  // Dates are kept as {$d: "..."} in browser storage and turned back into Dates here.
  const revive = (k, v) => v && typeof v === 'object' && v.$d ? new Date(v.$d) : v;
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(tabs, function (k, v) {
        return this[k] instanceof Date ? { $d: this[k].toISOString() } : v;
      }));
    } catch (e) { /* preview still works without storage */ }
  };
  let tabs;
  try { tabs = JSON.parse(localStorage.getItem(STORE), revive); } catch (e) { tabs = null; }
  if (!tabs) tabs = demoTabs();

  // Anything the server code calls that only affects formatting is accepted and ignored.
  const lenient = obj => new Proxy(obj, { get: (t, k) => k in t ? t[k] : () => lenient(t) });
  function range(rows, r, c, nr, nc) {
    return lenient({
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = rows()[r - 1 + i] || [];
          out.push(Array.from({ length: nc }, (_, j) => row[c - 1 + j] === undefined ? '' : row[c - 1 + j]));
        }
        return out;
      },
      setValues(v) {
        v.forEach((row, i) => {
          const t = rows()[r - 1 + i] = rows()[r - 1 + i] || [];
          row.forEach((x, j) => { t[c - 1 + j] = x; });
        });
        return this;
      },
      clearContent() {
        for (let i = 0; i < nr; i++) {
          const row = rows()[r - 1 + i];
          if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = '';
        }
        const all = rows();
        while (all.length > 1 && all[all.length - 1].every(x => x === '' || x === undefined)) all.pop();
        return this;
      },
      sort(o) {
        const part = rows().slice(r - 1, r - 1 + nr);
        const key = x => x[o.column - 1] instanceof Date ? x[o.column - 1].getTime() : String(x[o.column - 1]);
        part.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (o.ascending ? 1 : -1));
        rows().splice(r - 1, nr, ...part);
        return this;
      },
      getValue() { return this.getValues()[0][0]; },
      setValue(v) { return this.setValues([[v]]); },
      getFormulas() {
        return this.getValues().map(row => row.map(x => typeof x === 'string' && x[0] === '=' ? x : ''));
      },
      setFormula(f) { rows()[r - 1][c - 1] = f; return this; },
    });
  }
  function sheet(name) {
    const rows = () => tabs[name];
    return lenient({
      getLastRow: () => rows().filter(x => x.length).length,
      getMaxRows: () => Math.max(rows().length, 1000),
      getLastColumn: () => Math.max(1, ...rows().map(x => x.length)),
      getIndex: () => Object.keys(tabs).indexOf(name) + 1,
      getRange(r, c, nr, nc) { return typeof r === 'string' ? lenient({}) : range(rows, r, c, nr || 1, nc || 1); },
      appendRow(row) { rows().push(row.slice()); },
      deleteRow(i) { rows().splice(i - 1, 1); },
      clear() { tabs[name] = [[]]; },
    });
  }
  const ss = lenient({
    getSheetByName: name => tabs[name] ? sheet(name) : null,
    getSpreadsheetTimeZone: () => 'local',
    getName: () => 'PureTech',
    getUrl: () => '#preview-spreadsheet',
    getId: () => 'preview',
  });

  const google = {
    SpreadsheetApp: lenient({ getActiveSpreadsheet: () => ss, newDataValidation: () => lenient({ build: () => ({}) }) }),
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      formatDate(d, tz, f) {
        if (f === 'yyyy-MM-dd') return iso(d);
        return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
      },
    },
    Logger: { log() {} },
  };

  // ---- the real server code, in its own scope so its names don't clash with the page's ----
  const server = (function (SpreadsheetApp, PropertiesService, LockService, Utilities, Logger) {
    /* SERVER_CODE */

    // Demo stand-ins for Gmail and Drive OCR; they reuse the real matching and guessing.
    function demoItem(m) {
      const date = new Date();
      date.setDate(date.getDate() - m.daysAgo);
      return { key: m.id + ':0', messageId: m.id, threadId: m.id, index: 0, fileName: m.file,
        supplier: supplierName_(m.from), subject: m.subject, dateIso: date.toISOString(),
        dateText: Utilities.formatDate(date, '', 'd MMM yyyy') };
    }
    // Receiving reads Gmail and the PDFs through these two; the rest is the real code.
    receivingEmails_ = () => RECEIVING_EMAILS.map(m => Object.assign(demoItem(m), { invoiceGuess: guessInvoice_('', m.subject, m.file) }));
    receivingText_ = item => {
      const m = RECEIVING_EMAILS.find(x => x.id === item.messageId);
      return { text: m.text, invoice: guessInvoice_(m.text, item.subject, item.fileName) };
    };
    return {
      getConfig, getReceivingList, readReceiving, saveReceiving, uncheckReceiving, getRecentProblems, setSorted, getWeekReport,
      recordReturn, undoReturn, getPallets, getPallet, newPallet, reopenPallet, moveToPallet, deleteReturn, setCategory, setComment, getWeek, setDayOff, addExtra, removeChange, saveMasterSchedule,
      searchPart(part) {
        part = String(part || '').trim();
        const out = { items: [], returned: [], returnedInvoices: [], show: SHOW_INVOICES };
        if (!part) return out;
        const done = returnedFor_(part);
        out.returnedInvoices = done.invoices;
        DEMO_EMAILS.filter(m => norm_(m.text).indexOf(norm_(part)) !== -1).forEach(m => {
          const item = demoItem(m);
          item.returnedOn = done.keys[item.key] ? done.keys[item.key].when : '';
          item.returnedInvoice = done.keys[item.key] ? done.keys[item.key].invoice : '';
          item.returnedQty = done.keys[item.key] ? done.keys[item.key].qty : 0;
          (item.returnedOn ? out.returned : out.items).push(item);
        });
        return out;
      },
      readInvoice(item, part) {
        const m = DEMO_EMAILS.find(x => x.id === item.messageId);
        return { invoice: guessInvoice_(m.text, item.subject, item.fileName),
          found: norm_(m.text).indexOf(norm_(part)) !== -1, line: findLine_(m.text, part), shipped: guessQty_(m.text, part) };
      },
    };
  })(google.SpreadsheetApp, google.PropertiesService, google.LockService, google.Utilities, google.Logger);

  // ---- google.script.run ------------------------------------------------------
  function runner(ok, fail) {
    return new Proxy({}, {
      get(t, k) {
        if (k === 'withSuccessHandler') return f => runner(f, fail);
        if (k === 'withFailureHandler') return f => runner(ok, f);
        return (...args) => setTimeout(() => {
          // Copy arguments and results, as Google does, so nothing is shared by accident.
          const copy = x => x === undefined ? x : JSON.parse(JSON.stringify(x));
          let res;
          try {
            if (!server[k]) throw new Error(k + ' is not available in the preview.');
            res = copy(server[k](...copy(args)));
          } catch (e) { if (fail) fail(e); return; }
          save();
          if (ok) ok(res);
        }, k === 'readInvoice' || k === 'readReceiving' ? 500 : 150);
      },
    });
  }
  window.google = { script: { run: runner() } };

  window.PureTechPreview = {
    reset() {
      if (!confirm('Put the demo data back? Your preview changes will be lost.')) return;
      try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
      location.reload();
    },
  };
})();
