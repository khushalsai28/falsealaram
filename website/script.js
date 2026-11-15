// Loads all page text from README.md and fills every element that has a
// data-text="key" attribute. Keys are the "### key" headings in README.md.

function parseReadme(md) {
  const text = {};
  let key = null;
  let lines = [];
  const save = () => { if (key) text[key] = lines.join('\n').trim(); };

  md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/).forEach((line) => {
    const keyHeading = line.match(/^###\s+([\w.\-]+)\s*$/);
    if (keyHeading) {
      save();
      key = keyHeading[1];
      lines = [];
    } else if (/^#{1,2}\s/.test(line)) {
      save();          // a # or ## heading ends the current slot
      key = null;
      lines = [];
    } else if (key) {
      lines.push(line);
    }
  });
  save();
  return text;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Small formatting language: **bold**, *accent*, {red:..}, {orange:..}, [text](url)
function format(s) {
  let out = escapeHtml(s);
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\{red:(.+?)\}/g, '<span class="u-red">$1</span>');
  out = out.replace(/\{orange:(.+?)\}/g, '<span class="u-orange">$1</span>');
  out = out.replace(/\*(.+?)\*/g, '<span class="accent">$1</span>');
  out = out.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return out.replace(/\s*\n\s*/g, ' ');
}

function applyText(text) {
  document.querySelectorAll('[data-text]').forEach((el) => {
    const value = text[el.dataset.text];
    if (value !== undefined) el.innerHTML = format(value);
  });
  document.querySelectorAll('[data-href]').forEach((el) => {
    const value = text[el.dataset.href];
    if (value) el.setAttribute('href', value.trim());
  });
  if (text['site.title']) document.title = text['site.title'];
}

async function loadText() {
  try {
    const res = await fetch('README.md', { cache: 'no-store' });
    if (!res.ok) throw new Error('README.md not found');
    applyText(parseReadme(await res.text()));
  } catch (err) {
    document.getElementById('load-error').hidden = false;
    console.error(err);
  }
}

// Before / After switch in the demo section
function setView(view) {
  document.body.dataset.view = view;
  document.getElementById('btn-before').setAttribute('aria-pressed', String(view === 'before'));
  document.getElementById('btn-after').setAttribute('aria-pressed', String(view === 'after'));
}

document.getElementById('btn-before').addEventListener('click', () => setView('before'));
document.getElementById('btn-after').addEventListener('click', () => setView('after'));

loadText();
