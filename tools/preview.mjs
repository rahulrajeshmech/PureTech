// Builds preview/PureTech-preview.html: the real PureTech page, runnable from a
// local file with no Google account. Run after any change in app/, returns/, receiving/ or scheduling/:
//
//   node tools/preview.mjs          (add --open to open it in the browser)
//
// Open it with ?section=scheduling or ?section=receiving on the end to start on that section.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Where each Apps Script file lives in this folder. In Apps Script they are all side by side.
const FILES = {
  'Main.gs': 'app', 'Index.html': 'app',
  'Returns.gs': 'returns', 'ReturnsPage.html': 'returns',
  'Receiving.gs': 'receiving', 'ReceivingPage.html': 'receiving',
  'Schedule.gs': 'scheduling', 'SchedulePage.html': 'scheduling',
};
const src = name => {
  if (!FILES[name]) throw new Error(name + ' is not in the FILES list in tools/preview.mjs.');
  return readFileSync(join(root, FILES[name], name), 'utf8');
};

const server = ['Main.gs', 'Returns.gs', 'Receiving.gs', 'Schedule.gs'].map(src).join('\n');
const fake = readFileSync(join(root, 'tools', 'preview-fake.js'), 'utf8').replace('/* SERVER_CODE */', () => server);

const banner = `<div style="background:#fff4d6;color:#5c3d00;font:15px/1.4 system-ui,sans-serif;padding:6px 16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">
  <b>PREVIEW</b><span>Demo data only — nothing here reaches Google. Parts to try in Returns: CH8115, BP4471, F44B.</span>
  <button onclick="PureTechPreview.reset()" style="margin-left:auto;font:inherit;padding:2px 10px;border:1px solid #5c3d00;border-radius:6px;background:none;cursor:pointer">Reset demo data</button>
</div>`;

// Do what Apps Script does to Index.html: fill in the section and paste in the included files.
let page = src('Index.html')
  .replace('<body data-section="<?= section ?>">', () => '<body data-section="returns">\n'
    + "<script>{ const m = /[?&]section=(scheduling|receiving)/.exec(location.search); if (m) document.body.dataset.section = m[1]; }</script>\n" + banner)
  .replace(/<\?!= include_\('(\w+)'\) \?>/g, (m, name) => src(name + '.html'));
if (page.includes('<?')) throw new Error('Index.html has a <? ?> tag the preview does not know how to fill in.');
page = page.replace('<script>', () => '<script>\n' + fake + '\n</script>\n<script>');

// --artifact: a version for publishing as a claude.ai page. That page supplies its own
// <html>/<head>/<body>, opens Scheduling with #scheduling (no query string reaches it),
// and never shows confirm() boxes, so they are answered "yes" (it is all demo data).
const artifact = process.argv.includes('--artifact');
if (artifact) {
  page = page
    .replace(/^<!doctype html>\s*<html>\s*<head>\s*/i, () => '<title>PureTech Demo</title>\n'
      + '<script>window.confirm = () => true; window.alert = m => console.warn(m);</script>\n')
    .replace(/<\/head>\s*<body data-section="returns">\s*<script>[^<]*<\/script>/, () =>
      "<script>document.body.dataset.section = ['#scheduling', '#receiving'].includes(location.hash) ? location.hash.slice(1) : 'returns';</script>")
    .replace(/<\/body>\s*<\/html>\s*$/, '')
    .replace('<header class="appbar">', '<style>.appbar .links { display: none; } body { background: var(--bg); }</style>\n<header class="appbar">')
    .replace('Parts to try in Returns: CH8115, BP4471, F44B.', 'Parts to try in Returns: CH8115, BP4471, F44B. Add #receiving or #scheduling to the link to open on that section.');
  if (/<\/?(html|head|body)\b/i.test(page)) throw new Error('Could not strip the page wrapper for the artifact build.');
  // The artifact server publishes the file as it is, so it must be a whole document again,
  // with everything in <body> (the section script sets document.body.dataset).
  page = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n'
    + page + '\n</body>\n</html>\n';
}

const out = join(root, 'preview', artifact ? 'PureTech-demo.html' : 'PureTech-preview.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log('Preview written to ' + out);
if (process.argv.includes('--open')) execFileSync('open', [out]);
