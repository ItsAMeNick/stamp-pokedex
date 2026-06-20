'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let DEX = null;
let ALL_STAMPS = null;     // flat list built after DEX loads
let VIEW = 'home';         // 'home' | 'segment' | 'spread' | 'settings' | 'list'
let CUR_SEG = null;        // segment key
let CUR_SPREAD = 0;        // spread index within segment
let GRID_COLS = 10;        // configurable, saved to localStorage

const STORAGE_STATE  = 'pdex-state';
const STORAGE_CONFIG = 'pdex-config';

function loadState()  { return JSON.parse(localStorage.getItem(STORAGE_STATE)  || '{}'); }
function loadConfig() { return JSON.parse(localStorage.getItem(STORAGE_CONFIG) || '{}'); }

function saveState(s)  { localStorage.setItem(STORAGE_STATE,  JSON.stringify(s)); }
function saveConfig(c) { localStorage.setItem(STORAGE_CONFIG, JSON.stringify(c)); }

// State values: 0=none, 1=collected (have card), 2=punched (applied to notebook)
// Migration: old boolean `true` is treated as 2 (punched).
function getStampState(state, segKey, stampIdx) {
  const v = state[segKey]?.[stampIdx];
  if (v === true || v === 2) return 2;
  if (v === 1) return 1;
  return 0;
}

function countPunched(state, segKey) {
  const m = state[segKey];
  if (!m) return 0;
  return Object.values(m).filter(v => v === true || v === 2).length;
}

function countCollected(state, segKey) {
  const m = state[segKey];
  if (!m) return 0;
  return Object.values(m).filter(v => v === 1).length;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const cfg = loadConfig();
  GRID_COLS = cfg.cols ?? 10;

  try {
    const res = await fetch('./data/dex.json');
    if (!res.ok) throw new Error(res.statusText);
    DEX = await res.json();
  } catch (e) {
    document.getElementById('app').innerHTML = `
      <div style="padding:32px;text-align:center;color:#e74c3c">
        <p style="font-size:1.1rem;font-weight:600">Could not load dex.json</p>
        <p style="margin-top:8px;color:#8888aa;font-size:.85rem">
          Run <code style="background:#1e1e3a;padding:2px 6px;border-radius:4px">python3 handoff/generate.py</code>
          then serve this directory.
        </p>
      </div>`;
    return;
  }

  buildAllStamps();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  renderHome();
});

// ── Navigation ────────────────────────────────────────────────────────────────
window.goBack = function () {
  if (VIEW === 'spread')   { showSegment(CUR_SEG); return; }
  if (VIEW === 'segment')  { renderHome();          return; }
  if (VIEW === 'settings') { renderHome();          return; }
  if (VIEW === 'list')     { renderHome();          return; }
  renderHome();
};

window.showSettings = function () {
  VIEW = 'settings';
  setTitle('Settings', true, false);
  const cfg = loadConfig();
  const cols = cfg.cols ?? 10;
  const rows = cfg.rows ?? 6;

  const state     = loadState();
  const total     = DEX ? DEX.segments.reduce((s, seg) => s + seg.totalStamps, 0) : 0;
  const done      = DEX ? DEX.segments.reduce((s, seg) => s + countPunched(state, seg.key), 0) : 0;
  const inHand    = DEX ? DEX.segments.reduce((s, seg) => s + countCollected(state, seg.key), 0) : 0;

  document.getElementById('app').innerHTML = `
    <div class="total-strip">
      <div class="total-stat"><span class="val">${done.toLocaleString()}</span><span class="lbl">punched</span></div>
      <div class="total-stat"><span class="val">${inHand.toLocaleString()}</span><span class="lbl">in hand</span></div>
      <div class="total-stat"><span class="val">${total.toLocaleString()}</span><span class="lbl">total</span></div>
      <div class="total-stat"><span class="val">${total ? Math.round(100*done/total) : 0}%</span><span class="lbl">complete</span></div>
    </div>

    <p class="settings-title">Grid display</p>
    <div class="settings-section">
      <div class="settings-row">
        <div>
          <div class="setting-label">Columns</div>
          <div class="setting-hint">Stamps across full spread (physical: 10)</div>
        </div>
        <div class="stepper">
          <button onclick="adjustGrid('cols',-1)">−</button>
          <span id="cols-val">${cols}</span>
          <button onclick="adjustGrid('cols',1)">+</button>
        </div>
      </div>
      <div class="settings-row">
        <div>
          <div class="setting-label">Rows</div>
          <div class="setting-hint">Stamps per page (physical: 6)</div>
        </div>
        <div class="stepper">
          <button onclick="adjustGrid('rows',-1)">−</button>
          <span id="rows-val">${rows}</span>
          <button onclick="adjustGrid('rows',1)">+</button>
        </div>
      </div>
    </div>

    <p class="settings-title">Data</p>
    <div class="settings-section">
      <div class="settings-row">
        <div>
          <div class="setting-label">Export progress</div>
          <div class="setting-hint">Download your stamps as JSON</div>
        </div>
        <button class="icon-btn" onclick="exportState()">↓</button>
      </div>
      <div class="settings-row">
        <div>
          <div class="setting-label">Import progress</div>
          <div class="setting-hint">Restore from a JSON backup</div>
        </div>
        <button class="icon-btn" onclick="importState()">↑</button>
      </div>
    </div>

    <button class="danger-btn" onclick="confirmReset()">Reset all progress…</button>
  `;
};

window.adjustGrid = function (key, delta) {
  const cfg = loadConfig();
  const min = key === 'cols' ? 2 : 1;
  const max = key === 'cols' ? 10 : 12;
  cfg[key] = Math.min(max, Math.max(min, (cfg[key] ?? (key === 'cols' ? 5 : 6)) + delta));
  if (key === 'cols') GRID_COLS = cfg.cols;
  saveConfig(cfg);
  document.getElementById(`${key}-val`).textContent = cfg[key];
};

window.exportState = function () {
  const data = JSON.stringify({ state: loadState(), exported: new Date().toISOString() }, null, 2);
  const a = document.createElement('a');
  a.href = 'data:application/json,' + encodeURIComponent(data);
  a.download = 'pokedex-progress.json';
  a.click();
};

window.importState = function () {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.state || typeof parsed.state !== 'object') throw new Error('Invalid format');
        saveState(parsed.state);
        showSettings();
        alert('Import successful.');
      } catch {
        alert('Could not read file — make sure it\'s a valid export JSON.');
      }
    };
    reader.readAsText(file);
  };
  input.click();
};

window.confirmReset = function () {
  if (confirm('Reset ALL stamp progress? This cannot be undone.')) {
    saveState({});
    renderHome();
  }
};

// ── Home view ─────────────────────────────────────────────────────────────────
function renderHome() {
  VIEW = 'home';
  CUR_SEG = null;
  setTitle('Pokédex Notebook', false, true, true);

  const state = loadState();

  // Group by volume
  const byVol = {};
  for (const seg of DEX.segments) {
    (byVol[seg.volume] ??= []).push(seg);
  }

  let html = '';
  for (const [vol, segs] of Object.entries(byVol)) {
    const volDone  = segs.reduce((s, seg) => s + countPunched(state, seg.key), 0);
    const volTotal = segs.reduce((s, seg) => s + seg.totalStamps, 0);
    html += `<div class="volume-section">
      <div class="volume-label">Volume ${vol} — ${volDone}/${volTotal}</div>
      <div class="seg-list">`;

    for (const seg of segs) {
      const done = countPunched(state, seg.key);
      const pct  = Math.round(100 * done / seg.totalStamps);
      html += `
        <div class="seg-card" style="--seg-color:#${seg.color}" onclick="showSegment('${seg.key}')">
          <div class="seg-name">${seg.display}</div>
          <div class="seg-label">${seg.label}</div>
          <div class="seg-pct">${pct}%</div>
          <div class="seg-bar-track"><div class="seg-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
    }
    html += '</div></div>';
  }

  document.getElementById('app').innerHTML = html;
}

// ── Segment view (spread list) ────────────────────────────────────────────────
window.showSegment = function (segKey) {
  VIEW = 'segment';
  CUR_SEG = segKey;
  const seg   = DEX.segments.find(s => s.key === segKey);
  const state = loadState();
  const done  = countPunched(state, segKey);
  const pct   = Math.round(100 * done / seg.totalStamps);

  setTitle(seg.display, true, true);
  document.getElementById('header').style.setProperty('--seg-color', '#' + seg.color);

  let html = `
    <div class="spread-progress" style="--seg-color:#${seg.color}">
      <span>${done}/${seg.totalStamps} punched</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span>${pct}%</span>
    </div>
    <div class="spread-list">
      ${seg.titlePages ? `<div class="title-page-row">Title page — p.${seg.titlePages}</div>` : ''}`;

  let globalIdx = 0;
  for (let i = 0; i < seg.spreads.length; i++) {
    const spread  = seg.spreads[i];
    const sDone   = spread.stamps.filter((_, j) => getStampState(state, segKey, globalIdx + j) === 2).length;
    const sPct    = Math.round(100 * sDone / spread.stamps.length);
    const dots    = buildThumbDots(state, segKey, spread, globalIdx, seg.color);

    html += `
      <div class="spread-row" onclick="showSpread('${segKey}', ${i})">
        <div class="spread-thumb" style="--seg-color:#${seg.color}">${dots}</div>
        <div class="spread-info">
          <div class="spread-title">Spread ${i + 1}</div>
          <div class="spread-meta">p.${spread.pages} · ${spread.stamps.length} stamps${spread.blanks ? ` + ${spread.blanks} blank` : ''}</div>
        </div>
        <div class="spread-prog" style="color:#${seg.color}">${sDone}/${spread.stamps.length}</div>
      </div>`;

    globalIdx += spread.stamps.length;
  }

  html += '</div>';
  document.getElementById('app').innerHTML = html;
};

function buildThumbDots(state, segKey, spread, startIdx, color) {
  let html = '';
  const show = 10;
  for (let i = 0; i < show; i++) {
    if (i < spread.stamps.length) {
      const st = getStampState(state, segKey, startIdx + i);
      const cls = st === 2 ? ' done' : st === 1 ? ' collected' : '';
      html += `<div class="spread-dot${cls}"></div>`;
    } else {
      html += `<div class="spread-dot blank"></div>`;
    }
  }
  return html;
}

// ── Spread / grid view ────────────────────────────────────────────────────────
window.showSpread = function (segKey, spreadIdx) {
  VIEW = 'spread';
  CUR_SEG = segKey;
  CUR_SPREAD = spreadIdx;

  const seg    = DEX.segments.find(s => s.key === segKey);
  const spread = seg.spreads[spreadIdx];
  const cfg    = loadConfig();
  const cols   = cfg.cols ?? 10;
  const rows   = cfg.rows ?? 6;
  const perPage = cols * rows;

  setTitle(`${seg.display} · Spread ${spreadIdx + 1}`, true, true);
  document.getElementById('header').style.setProperty('--seg-color', '#' + seg.color);

  // Global start index for this spread's stamps
  let globalStart = 0;
  for (let i = 0; i < spreadIdx; i++) {
    globalStart += seg.spreads[i].stamps.length;
  }

  renderSpreadGrid(seg, spread, spreadIdx, globalStart, cols, rows, perPage);
};

function renderSpreadGrid(seg, spread, spreadIdx, globalStart, cols, rows, perPage) {
  const state      = loadState();
  const stamps     = spread.stamps;
  const n          = stamps.length;
  const sDone      = stamps.filter((_, i) => getStampState(state, seg.key, globalStart + i) === 2).length;
  const sCollected = stamps.filter((_, i) => getStampState(state, seg.key, globalStart + i) === 1).length;
  const sPct       = Math.round(100 * sDone / n);
  const isFirst    = spreadIdx === 0;
  const isLast     = spreadIdx === seg.spreads.length - 1;

  // Centerfold mode: 10 cols = two 5-col pages across the binding
  const halfCols     = cols / 2;
  const useCenterfold = cols === 10;
  const gridClass    = useCenterfold ? 'stamp-grid with-centerfold' : 'stamp-grid';
  const gridStyle    = useCenterfold ? '' : `style="--cols:${cols}"`;

  let html = `
    <div class="spread-progress" style="--seg-color:#${seg.color}">
      <span>${sDone}/${n} punched${sCollected ? ` · ${sCollected} in hand` : ''}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${sPct}%"></div></div>
      <span>${sPct}%</span>
    </div>

    <div class="spread-header">
      <span>p.${spread.pages} · ${spread.blanks ? spread.blanks + ' blank' : 'full'}</span>
      <div class="spread-nav">
        <button onclick="navSpread(-1)" ${isFirst ? 'disabled' : ''}>← Prev</button>
        <button onclick="navSpread(1)"  ${isLast  ? 'disabled' : ''}>Next →</button>
      </div>
    </div>

    <div class="${gridClass}" ${gridStyle}>`;

  const total = stamps.length + spread.blanks;
  for (let i = 0; i < total; i++) {
    // Insert centerfold marker in the middle of each row
    if (useCenterfold && i % cols === halfCols) {
      html += '<div class="centerfold-marker"></div>';
    }
    // Page-break label for non-centerfold narrow layouts
    if (!useCenterfold && i > 0 && i % perPage === 0) {
      html += `<div class="page-break"></div>
               <div class="page-label">Page ${Math.floor(i / perPage) + 1}</div>`;
    }

    if (i < stamps.length) {
      const stampIdx  = globalStart + i;
      const stampState = getStampState(state, seg.key, stampIdx);
      const stateClass = stampState === 2 ? ' stamped' : stampState === 1 ? ' collected' : '';
      html += `
        <div class="stamp-cell${stateClass}"
             style="--seg-color:#${seg.color}"
             data-idx="${stampIdx}"
             onclick="toggleCell(this)">
          <span class="stamp-num">${globalStart + i + 1}</span>
          <span class="stamp-name">${stamps[i]}</span>
        </div>`;
    } else {
      html += '<div class="stamp-cell blank"></div>';
    }
  }

  html += '</div>';
  document.getElementById('app').innerHTML = html;
}

window.toggleCell = function (el) {
  const idx   = parseInt(el.dataset.idx, 10);
  const state = loadState();
  if (!state[CUR_SEG]) state[CUR_SEG] = {};

  const cur  = getStampState(state, CUR_SEG, idx);
  const next = (cur + 1) % 3;   // 0→1→2→0
  if (next === 0) delete state[CUR_SEG][idx];
  else            state[CUR_SEG][idx] = next;
  saveState(state);

  el.classList.toggle('collected', next === 1);
  el.classList.toggle('stamped',   next === 2);

  // Update progress bar
  const seg    = DEX.segments.find(s => s.key === CUR_SEG);
  const spread = seg.spreads[CUR_SPREAD];
  let   globalStart = 0;
  for (let i = 0; i < CUR_SPREAD; i++) globalStart += seg.spreads[i].stamps.length;

  const sDone      = spread.stamps.filter((_, i) => getStampState(state, CUR_SEG, globalStart + i) === 2).length;
  const sCollected = spread.stamps.filter((_, i) => getStampState(state, CUR_SEG, globalStart + i) === 1).length;
  const sPct       = Math.round(100 * sDone / spread.stamps.length);

  const fill = document.querySelector('.bar-fill');
  const txt  = document.querySelector('.spread-progress span');
  if (fill) fill.style.width = sPct + '%';
  if (txt)  txt.textContent  = `${sDone}/${spread.stamps.length} punched${sCollected ? ` · ${sCollected} in hand` : ''}`;
};

window.navSpread = function (delta) {
  const seg     = DEX.segments.find(s => s.key === CUR_SEG);
  const newIdx  = CUR_SPREAD + delta;
  if (newIdx < 0 || newIdx >= seg.spreads.length) return;

  let globalStart = 0;
  for (let i = 0; i < newIdx; i++) globalStart += seg.spreads[i].stamps.length;

  CUR_SPREAD = newIdx;
  const cfg     = loadConfig();
  const cols    = cfg.cols ?? 10;
  const rows    = cfg.rows ?? 6;
  setTitle(`${seg.display} · Spread ${newIdx + 1}`, true, true);
  renderSpreadGrid(seg, seg.spreads[newIdx], newIdx, globalStart, cols, rows, cols * rows);
  document.getElementById('app').scrollTop = 0;
};

// ── Pokémon list view ─────────────────────────────────────────────────────────
function buildAllStamps() {
  ALL_STAMPS = [];
  for (const seg of DEX.segments) {
    let segIdx = 0;
    for (let si = 0; si < seg.spreads.length; si++) {
      const spread = seg.spreads[si];
      for (let i = 0; i < spread.stamps.length; i++) {
        const slot = i + 1;
        ALL_STAMPS.push({
          name:        spread.stamps[i],
          segKey:      seg.key,
          segDisplay:  seg.display,
          segColor:    seg.color,
          spreadIdx:   si,
          pages:       spread.pages,
          slotInSpread: slot,
          row:         Math.ceil(slot / 10),
          col:         ((slot - 1) % 10) + 1,
          stampIdx:    segIdx + i,
        });
      }
      segIdx += spread.stamps.length;
    }
  }
}

window.showList = function () {
  VIEW = 'list';
  setTitle('All Pokémon', true, false, false);

  document.getElementById('app').innerHTML = `
    <div class="dex-search-wrap">
      <input class="dex-search" type="search" placeholder="Search ${ALL_STAMPS.length.toLocaleString()} Pokémon…"
             oninput="filterDex(this.value)" autocomplete="off" autocorrect="off" spellcheck="false">
    </div>
    <div id="dex-count" class="dex-count"></div>
    <div id="dex-list"  class="dex-list"></div>
  `;
  filterDex('');
};

window.filterDex = function (query) {
  const q     = (query || '').toLowerCase().trim();
  const state = loadState();
  const items = q ? ALL_STAMPS.filter(s => s.name.toLowerCase().includes(q)) : ALL_STAMPS;

  const countEl = document.getElementById('dex-count');
  const listEl  = document.getElementById('dex-list');
  if (!listEl) return;

  countEl.textContent = q
    ? `${items.length.toLocaleString()} of ${ALL_STAMPS.length.toLocaleString()}`
    : `${ALL_STAMPS.length.toLocaleString()} Pokémon`;

  if (!items.length) {
    listEl.innerHTML = '<div class="dex-empty">No matches</div>';
    return;
  }

  let html = '';
  for (const item of items) {
    const st      = getStampState(state, item.segKey, item.stampIdx);
    const stClass = st === 2 ? ' stamped' : st === 1 ? ' collected' : '';
    html += `<div class="dex-row${stClass}"
               style="--seg-color:#${item.segColor}"
               data-seg="${item.segKey}" data-idx="${item.stampIdx}" data-spread="${item.spreadIdx}"
               onclick="openFromList(this)">
        <div class="dex-dot"></div>
        <div class="dex-info">
          <div class="dex-name">${item.name}</div>
          <div class="dex-meta">${item.segDisplay} · Spread ${item.spreadIdx + 1} · p.${item.pages} · Row ${item.row}, Col ${item.col}</div>
        </div>
      </div>`;
  }
  listEl.innerHTML = html;
};

window.openFromList = function (el) {
  const segKey    = el.dataset.seg;
  const idx       = parseInt(el.dataset.idx, 10);
  const spreadIdx = parseInt(el.dataset.spread, 10);
  const state     = loadState();

  if (getStampState(state, segKey, idx) === 0) {
    if (!state[segKey]) state[segKey] = {};
    state[segKey][idx] = 1;
    saveState(state);
  }

  showSpread(segKey, spreadIdx);

  requestAnimationFrame(() => {
    const cell = document.querySelector(`.stamp-cell[data-idx="${idx}"]`);
    if (cell) cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function setTitle(title, showBack, showSettings, showListBtn = false) {
  document.getElementById('nav-title').textContent = title;
  document.getElementById('back-btn').hidden     = !showBack;
  document.getElementById('settings-btn').hidden = !showSettings;
  document.getElementById('list-btn').hidden     = !showListBtn;
}
