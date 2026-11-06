/**
 * PureTech — Scheduling section
 *
 * A weekly staff calendar. Three kinds of worker (Full time, Part time, Driver),
 * a minimum number of each per weekday, a master schedule that repeats, and
 * week-specific changes on top of it (days off and extra cover). The page shows
 * each day with whether the minimum for every kind of worker is met.
 *
 * Everything is stored in four tabs of the PureTech sheet, which can also be
 * edited by hand.
 */

const SCHED_STAFF = 'Schedule · Staff';
const SCHED_BASE = 'Schedule · Base Week';
const SCHED_NEEDED = 'Schedule · Needed';
const SCHED_CHANGES = 'Schedule · Changes';
const SCHED_COLOUR = '#2f5fb3';

// The order here is the order they are shown in everywhere.
const WORKER_TYPES = [
  { key: 'full', label: 'Full time' },
  { key: 'part', label: 'Part time' },
  { key: 'driver', label: 'Driver' },
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const OFF = 'Off';
const EXTRA = 'Extra';

// ---------------------------------------------------------------------------
// Called from the page

/** The week starting on the Monday of `dateIso` (yyyy-mm-dd), plus everything the page needs to edit it. */
function getWeek(dateIso) {
  if (!ss_().getSheetByName(SCHED_STAFF)) setup();
  const sched = readSchedule_();
  const monday = mondayOf_(isIso_(dateIso) ? dateIso : todayIso_());
  const week = buildWeek_(sched, monday);
  week.staff = sched.staff.map(function (s) {
    return { name: s.name, type: s.type, active: s.active, days: sched.base[norm_(s.name)] || blankWeek_(false) };
  });
  week.needed = sched.needed;
  return week;
}

/** Gives someone who is working that day the day off. Undoes extra cover if that is why they were in. */
function setDayOff(dateIso, name, reason) {
  return changeDay_(dateIso, name, function (day, person, rows) {
    if (person.status === 'off') throw new Error(person.name + ' already has that day off.');
    if (person.status === 'extra') return rows.remove(EXTRA);
    if (person.status !== 'base') throw new Error(person.name + ' is not working on that day.');
    rows.add(OFF, String(reason || '').trim());
  });
}

/** Brings someone in on a day they don't usually work. Undoes a day off if they had one. */
function addExtra(dateIso, name) {
  return changeDay_(dateIso, name, function (day, person, rows) {
    if (person.status === 'off') return rows.remove(OFF);
    if (person.status) throw new Error(person.name + ' is already working that day.');
    rows.add(EXTRA, '');
  });
}

/** Removes a day off or extra cover, putting that day back to the master schedule. */
function removeChange(dateIso, name) {
  return changeDay_(dateIso, name, function (day, person, rows) {
    if (!rows.remove(OFF) && !rows.remove(EXTRA)) throw new Error('That change was not found. It may already have been undone.');
  });
}

/**
 * Saves the master schedule from the page: the staff list, which weekdays each person
 * normally works, and the minimum of each kind of worker per weekday.
 * data = { staff: [{ name, was, type, active, days: [7 booleans] }], needed: { full: [7 numbers], … } }
 * `was` is the name the person had before, so renaming someone keeps their days off.
 */
function saveMasterSchedule(data) {
  const staff = (data && data.staff || []).map(function (s) {
    return {
      name: String(s.name || '').trim().replace(/\s+/g, ' '),
      was: String(s.was || '').trim(),
      type: s.type,
      active: s.active !== false,
      days: WEEKDAYS.map(function (d, i) { return !!(s.days && s.days[i]); }),
    };
  });
  const seen = {};
  staff.forEach(function (s) {
    if (!s.name) throw new Error('Every person needs a name.');
    if (!typeLabel_(s.type)) throw new Error('Pick Full time, Part time or Driver for ' + s.name + '.');
    if (seen[norm_(s.name)]) throw new Error('There are two people called ' + s.name + '. Give them different names.');
    seen[norm_(s.name)] = true;
  });
  const needed = {};
  WORKER_TYPES.forEach(function (t) {
    needed[t.key] = WEEKDAYS.map(function (d, i) {
      const n = Math.floor(Number(data && data.needed && data.needed[t.key] && data.needed[t.key][i]) || 0);
      return Math.max(0, Math.min(n, 99));
    });
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    writeRows_(sheet_(SCHED_STAFF), staff.map(function (s) { return [s.name, typeLabel_(s.type), s.active]; }));
    writeRows_(sheet_(SCHED_BASE), staff.map(function (s) { return [s.name].concat(s.days); }));
    writeRows_(sheet_(SCHED_NEEDED), WORKER_TYPES.map(function (t) { return [t.label].concat(needed[t.key]); }));
    formatScheduleTabs_();

    // Renamed people keep their days off and extra cover.
    const renames = {};
    staff.forEach(function (s) { if (s.was && norm_(s.was) !== norm_(s.name)) renames[norm_(s.was)] = s.name; });
    const ch = sheet_(SCHED_CHANGES);
    if (Object.keys(renames).length && ch.getLastRow() > 1) {
      const names = ch.getRange(2, 2, ch.getLastRow() - 1, 1).getValues();
      ch.getRange(2, 2, names.length, 1).setValues(names.map(function (r) { return [renames[norm_(r[0])] || r[0]]; }));
    }
  } finally {
    lock.releaseLock();
  }
  return { saved: staff.length };
}

// ---------------------------------------------------------------------------
// Working out the week (no Google calls, so it can be tested on its own)

/**
 * sched = { staff: [{ name, type, active }], base: { NORMNAME: [7 booleans] },
 *           needed: { full: [7], part: [7], driver: [7] }, changes: [{ date, name, change, reason }] }
 * Returns { monday, ok, days: [7 × { date, people, off, counts, short, ok, closed, changeCount }] }.
 * people: [{ name, type, status: 'base' | 'extra' }], off: [{ name, type, reason }].
 */
function buildWeek_(sched, monday) {
  const staff = sched.staff.filter(function (s) { return s.active && typeLabel_(s.type); });
  const byName = {};
  staff.forEach(function (s) { byName[norm_(s.name)] = s; });
  const order = function (a, b) {
    return typeIndex_(a.type) - typeIndex_(b.type) || a.name.localeCompare(b.name);
  };

  const days = WEEKDAYS.map(function (d, i) {
    const date = addDays_(monday, i);
    const people = staff.filter(function (s) {
      const days = sched.base[norm_(s.name)];
      return days && days[i];
    }).map(function (s) { return { name: s.name, type: s.type, status: 'base' }; });
    const working = function (s) {
      return people.filter(function (p) { return p.name === s.name; })[0];
    };
    const changes = sched.changes.filter(function (c) { return c.date === date && byName[norm_(c.name)]; });

    // Extra cover first, then days off, so a day off always wins.
    changes.forEach(function (c) {
      const s = byName[norm_(c.name)];
      if (c.change === EXTRA && !working(s)) people.push({ name: s.name, type: s.type, status: 'extra' });
    });
    const off = [];
    changes.forEach(function (c) {
      const s = byName[norm_(c.name)];
      const p = working(s);
      if (c.change !== OFF || !p) return;
      people.splice(people.indexOf(p), 1);
      off.push({ name: s.name, type: s.type, reason: c.reason, wasExtra: p.status === 'extra' });
    });
    // A day off from extra cover just cancels the cover; it is not a change from the master schedule.
    const shownOff = off.filter(function (o) { return !o.wasExtra; }).map(function (o) {
      return { name: o.name, type: o.type, reason: o.reason };
    });

    const counts = {};
    const short = [];
    WORKER_TYPES.forEach(function (t) {
      const have = people.filter(function (p) { return p.type === t.key; }).length;
      const need = (sched.needed[t.key] || [])[i] || 0;
      counts[t.key] = { have: have, need: need, ok: have >= need };
      if (have < need) short.push({ type: t.key, missing: need - have });
    });
    people.sort(order);
    shownOff.sort(order);
    const noMinimum = WORKER_TYPES.every(function (t) { return !counts[t.key].need; });
    return {
      date: date,
      people: people,
      off: shownOff,
      counts: counts,
      short: short,
      ok: !short.length,
      closed: noMinimum && !people.length && !shownOff.length,
      changeCount: shownOff.length + people.filter(function (p) { return p.status === 'extra'; }).length,
    };
  });
  return { monday: monday, ok: days.every(function (d) { return d.ok; }), days: days };
}

// ---------------------------------------------------------------------------
// Reading and writing the tabs

function readSchedule_() {
  const ss = ss_();
  const tz = ss.getSpreadsheetTimeZone();
  const rows = function (name, cols) {
    const sh = sheet_(name);
    if (sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, cols).getValues()
      .filter(function (r) { return String(r[0]).trim() !== ''; });
  };
  const yes = function (v) { return v === true || String(v).trim().toUpperCase() === 'TRUE'; };

  const staff = rows(SCHED_STAFF, 3).map(function (r) {
    // A blank Active cell (a row typed in by hand) counts as active.
    return { name: String(r[0]).trim(), type: typeKey_(r[1]), active: r[2] === '' || yes(r[2]) };
  });
  const base = {};
  rows(SCHED_BASE, 8).forEach(function (r) {
    base[norm_(r[0])] = WEEKDAYS.map(function (d, i) { return yes(r[i + 1]); });
  });
  const needed = {};
  WORKER_TYPES.forEach(function (t) { needed[t.key] = blankWeek_(0); });
  rows(SCHED_NEEDED, 8).forEach(function (r) {
    const key = typeKey_(r[0]);
    if (key) needed[key] = WEEKDAYS.map(function (d, i) { return Math.max(0, Math.floor(Number(r[i + 1]) || 0)); });
  });
  const changes = rows(SCHED_CHANGES, 4).map(function (r) {
    return {
      date: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : String(r[0]).trim().slice(0, 10),
      name: String(r[1]).trim(),
      change: norm_(r[2]) === 'EXTRA' ? EXTRA : OFF,
      reason: String(r[3] || '').trim(),
    };
  });
  return { staff: staff, base: base, needed: needed, changes: changes };
}

/**
 * Shared steps for a change on one day: works out the person's status that day,
 * then lets `fn` add or remove rows on the Changes tab.
 */
function changeDay_(dateIso, name, fn) {
  if (!isIso_(dateIso)) throw new Error('Pick a day first.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sched = readSchedule_();
    const person = sched.staff.filter(function (s) { return s.active && norm_(s.name) === norm_(name); })[0];
    if (!person) throw new Error(name + ' is not on the staff list.');
    const day = buildWeek_(sched, mondayOf_(dateIso)).days.filter(function (d) { return d.date === dateIso; })[0];
    const status = day.off.some(function (o) { return o.name === person.name; }) ? 'off' :
      (day.people.filter(function (p) { return p.name === person.name; })[0] || {}).status || '';

    const sh = sheet_(SCHED_CHANGES);
    const tz = ss_().getSpreadsheetTimeZone();
    const rows = {
      add: function (change, reason) {
        sh.appendRow([dateIso, person.name, change, reason]);
        if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, 4).sort({ column: 1, ascending: true });
      },
      // Deletes every row for this person, day and kind of change. Returns true if any were found.
      remove: function (change) {
        if (sh.getLastRow() < 2) return false;
        const values = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
        let found = false;
        for (let i = values.length - 1; i >= 0; i--) {
          const r = values[i];
          const date = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : String(r[0]).trim();
          const kind = norm_(r[2]) === 'EXTRA' ? EXTRA : OFF;
          if (date === dateIso && norm_(r[1]) === norm_(person.name) && kind === change) {
            sh.deleteRow(i + 2);
            found = true;
          }
        }
        return found;
      },
    };
    fn(day, { name: person.name, status: status }, rows);
  } finally {
    lock.releaseLock();
  }
  return { date: dateIso };
}

/** Replaces everything under the header row with `values`. */
function writeRows_(sh, values) {
  const cols = sh.getLastColumn();
  if (sh.getMaxRows() > 1) {
    const old = sh.getRange(2, 1, sh.getMaxRows() - 1, cols);
    old.clearContent();
    old.clearDataValidations();
  }
  if (values.length) sh.getRange(2, 1, values.length, values[0].length).setValues(values);
}

// ---------------------------------------------------------------------------
// Sheet tabs for this section (called from setup() in Main.gs)

function setupSchedule_(ss) {
  const tabs = [
    [SCHED_STAFF, ['Name', 'Type', 'Active']],
    [SCHED_BASE, ['Name'].concat(WEEKDAYS)],
    [SCHED_NEEDED, ['Type'].concat(WEEKDAYS)],
    [SCHED_CHANGES, ['Date', 'Name', 'Change', 'Reason']],
  ];
  // Right after the Returns tabs, in this order.
  let at = ss.getSheetByName(BY_INVOICE) ? ss.getSheetByName(BY_INVOICE).getIndex() : 0;
  tabs.forEach(function (t) {
    let sh = ss.getSheetByName(t[0]);
    if (!sh) {
      sh = ss.insertSheet(t[0], at);
      sh.getRange(1, 1, 1, t[1].length).setValues([t[1]]);
      if (t[0] === SCHED_NEEDED) {
        sh.getRange(2, 1, WORKER_TYPES.length, 8).setValues(WORKER_TYPES.map(function (w) {
          return [w.label].concat(blankWeek_(0));
        }));
      }
    }
    at = sh.getIndex();
    sh.getRange(1, 1, 1, t[1].length).setFontWeight('bold').setBackground(SCHED_COLOUR).setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, t[0] === SCHED_CHANGES ? 150 : 180);
    sh.setTabColor(SCHED_COLOUR);
  });
  sheet_(SCHED_CHANGES).getRange('A:A').setNumberFormat('ddd d mmm yyyy');
  sheet_(SCHED_CHANGES).setColumnWidth(4, 220);
  formatScheduleTabs_();
}

/** Dropdowns and tick boxes, so the tabs are easy to edit by hand. Includes some empty rows for new people. */
function formatScheduleTabs_() {
  const spare = 20;
  const staff = sheet_(SCHED_STAFF);
  const staffRows = Math.max(staff.getLastRow() - 1, 0) + spare;
  staff.getRange(2, 2, staffRows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(WORKER_TYPES.map(function (t) { return t.label; }), true).build());
  staff.getRange(2, 3, Math.max(staff.getLastRow() - 1, 0) || 1, 1).insertCheckboxes();

  const base = sheet_(SCHED_BASE);
  if (base.getLastRow() > 1) base.getRange(2, 2, base.getLastRow() - 1, 7).insertCheckboxes();

  sheet_(SCHED_NEEDED).getRange(2, 2, WORKER_TYPES.length, 7).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireNumberBetween(0, 99).setAllowInvalid(false).build());

  sheet_(SCHED_CHANGES).getRange(2, 3, Math.max(sheet_(SCHED_CHANGES).getLastRow() - 1, 0) + spare, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList([OFF, EXTRA], true).build());
}

// ---------------------------------------------------------------------------
// Helpers

function typeKey_(label) {
  const n = norm_(label);
  if (n === 'FULLTIME' || n === 'FULL') return 'full';
  if (n === 'PARTTIME' || n === 'PART') return 'part';
  if (n === 'DRIVER' || n === 'DRIVERS') return 'driver';
  return '';
}

function typeLabel_(key) {
  const t = WORKER_TYPES.filter(function (w) { return w.key === key; })[0];
  return t ? t.label : '';
}

function typeIndex_(key) {
  return WORKER_TYPES.map(function (t) { return t.key; }).indexOf(key);
}

function blankWeek_(value) {
  return WEEKDAYS.map(function () { return value; });
}

function isIso_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function todayIso_() {
  return Utilities.formatDate(new Date(), ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}

/** Dates are worked out in UTC on plain yyyy-mm-dd strings, so time zones can't shift a day. */
function addDays_(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mondayOf_(iso) {
  const day = new Date(iso + 'T00:00:00Z').getUTCDay();
  return addDays_(iso, -((day + 6) % 7));
}
