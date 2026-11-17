import * as L from './logic.js';
import { createBackend, firebaseReady } from './backend.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { flights: [], opening: null, user: undefined, status: '', editing: null, view: 'add' };
let backend = null;
let toastTimer = 0;

// ---------------------------------------------------------------- ตัวช่วย
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

const sortedFlights = () => L.sortFlights(state.flights);
const totalsNow = () => L.addTotals(state.opening, L.sumFlights(state.flights));

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('โหลดตัวอ่าน Excel ไม่ได้ — ต้องต่อเน็ตในครั้งแรก'));
    document.head.appendChild(s);
  });
}

// ---------------------------------------------------------------- ส่วนหัว: ตัวนับชั่วโมง + สถานะซิงค์
function renderHeader() {
  const total = totalsNow().hours;
  const s = Math.max(0, total).toFixed(1).padStart(7, '0');
  $('#hobbs').innerHTML = [...s]
    .map((ch, i) => (ch === '.' ? '<span class="dot">.</span>' : `<span${i === s.length - 1 ? ' class="tenth"' : ''}>${ch}</span>`))
    .join('');
  $('#hobbs').setAttribute('aria-label', `ชั่วโมงบินรวม ${L.fmt(total)}`);

  const chip = $('#sync');
  const labels = { local: 'ในเครื่อง', synced: 'ซิงค์แล้ว', pending: 'กำลังซิงค์', offline: 'ออฟไลน์' };
  chip.hidden = !state.status || !state.user;
  chip.className = `chip ${state.status}`;
  chip.textContent = labels[state.status] || '';
}

// ---------------------------------------------------------------- ฟอร์ม
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ข้าม */ } },
};

function initForm() {
  const opt = (arr) => arr.map((v) => `<option>${esc(v)}</option>`).join('');
  $('#f-type').innerHTML = opt(L.AIRCRAFT);
  $('#f-duty').innerHTML = opt(L.DUTIES);
  $('#conds').innerHTML = L.CONDS.map((c) => `
    <div class="cond"><label>${c.label}
      <div class="row">
        <input id="c-${c.key}" type="number" inputmode="decimal" step="0.1" min="0" placeholder="0.0">
        <button type="button" data-fill="${c.key}" title="ใช้เท่ากับชั่วโมงบิน">= ชม.บิน</button>
      </div></label></div>`).join('');

  const last = LS.get('lb.last', {});
  resetForm(last);

  $('#f-type').addEventListener('change', () => {
    const nums = LS.get('lb.nums', {});
    $('#f-number').value = nums[$('#f-type').value] || '';
  });
  $('#conds').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fill]');
    if (!b) return;
    const h = $('#f-hours').value;
    if (!h) { $('#f-hours').focus(); return; }
    $(`#c-${b.dataset.fill}`).value = h;
  });
  $('#form').addEventListener('submit', onSubmit);
  $('#btn-cancel').addEventListener('click', () => { exitEdit(); showView('list'); });
  $('#btn-delete').addEventListener('click', onDelete);
}

function resetForm(keep = {}) {
  $('#f-date').value = keep.date || L.todayISO();
  $('#f-type').value = L.AIRCRAFT.includes(keep.type) ? keep.type : L.AIRCRAFT[0];
  const nums = LS.get('lb.nums', {});
  $('#f-number').value = keep.number ?? nums[$('#f-type').value] ?? '';
  $('#f-duty').value = L.DUTIES.includes(keep.duty) ? keep.duty : L.DUTIES[0];
  $('#f-dep').value = keep.dep || '';
  $('#f-dest').value = '';
  $('#f-mission').value = keep.mission || '';
  $('#f-hours').value = '';
  $('#f-note').value = '';
  for (const c of L.CONDS) $(`#c-${c.key}`).value = '';
}

function readForm() {
  const f = {
    date: $('#f-date').value,
    type: $('#f-type').value,
    number: $('#f-number').value.trim(),
    dep: $('#f-dep').value.trim(),
    dest: $('#f-dest').value.trim(),
    mission: $('#f-mission').value.trim(),
    duty: $('#f-duty').value,
    hours: L.num($('#f-hours').value),
    note: $('#f-note').value.trim(),
  };
  for (const c of L.CONDS) f[c.key] = L.num($(`#c-${c.key}`).value);
  return f;
}

function validate(f) {
  if (!f.date) return 'เลือกวันที่';
  if (!(f.hours > 0)) return 'ใส่ชั่วโมงบิน (มากกว่า 0)';
  if (f.hours > 24) return 'ชั่วโมงบินเกิน 24 ชม. ตรวจสอบอีกครั้ง';
  for (const c of L.CONDS) {
    if (f[c.key] > f.hours + 1e-9) return `${c.label} มากกว่าชั่วโมงบินรวมของเที่ยวนี้`;
  }
  return '';
}

function onSubmit(e) {
  e.preventDefault();
  const f = readForm();
  const err = validate(f);
  const box = $('#form-error');
  box.hidden = !err;
  box.textContent = err;
  if (err) return;

  if (state.editing) {
    const old = state.flights.find((x) => x.id === state.editing);
    f.id = state.editing;
    f.ord = old?.ord ?? Date.now();
  } else {
    f.id = crypto.randomUUID();
    f.ord = Date.now();
  }
  backend.saveFlight(f);

  const nums = LS.get('lb.nums', {});
  nums[f.type] = f.number;
  LS.set('lb.nums', nums);
  LS.set('lb.last', { date: f.date, type: f.type, number: f.number, duty: f.duty, mission: f.mission, dep: f.dest });

  if (state.editing) {
    exitEdit();
    toast('แก้ไขเที่ยวบินแล้ว');
    showView('list');
  } else {
    toast(`บันทึกแล้ว · ${L.fmt(f.hours)} ชม.`);
    resetForm({ ...f, dep: f.dest });
    $('#f-dest').focus();
  }
}

function startEdit(id) {
  const f = state.flights.find((x) => x.id === id);
  if (!f) return;
  state.editing = id;
  $('#form-title').textContent = `แก้ไขเที่ยวบิน · ${L.dmy(f.date)}`;
  $('#f-date').value = f.date;
  $('#f-type').value = L.AIRCRAFT.includes(f.type) ? f.type : L.AIRCRAFT[0];
  $('#f-number').value = f.number || '';
  $('#f-duty').value = L.DUTIES.includes(f.duty) ? f.duty : L.DUTIES[0];
  $('#f-dep').value = f.dep || '';
  $('#f-dest').value = f.dest || '';
  $('#f-mission').value = f.mission || '';
  $('#f-hours').value = f.hours;
  $('#f-note').value = f.note || '';
  for (const c of L.CONDS) $(`#c-${c.key}`).value = f[c.key] || '';
  $('#btn-save').textContent = 'บันทึกการแก้ไข';
  $('#btn-cancel').hidden = false;
  $('#btn-delete').hidden = false;
  showView('add');
}

function exitEdit() {
  state.editing = null;
  $('#form-title').textContent = 'เพิ่มเที่ยวบิน';
  $('#btn-save').textContent = 'บันทึกเที่ยวบิน';
  $('#btn-cancel').hidden = true;
  $('#btn-delete').hidden = true;
  $('#form-error').hidden = true;
  resetForm(LS.get('lb.last', {}));
}

function onDelete() {
  const f = state.flights.find((x) => x.id === state.editing);
  if (!f) return;
  if (!confirm(`ลบเที่ยวบิน ${L.dmy(f.date)} ${f.type} ${L.fmt(f.hours)} ชม. ?`)) return;
  backend.deleteFlight(f.id);
  exitEdit();
  toast('ลบเที่ยวบินแล้ว');
  showView('list');
}

function refreshSuggestions() {
  const count = (arr) => {
    const m = new Map();
    for (const v of arr) if (v) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  };
  const places = count(state.flights.flatMap((f) => [f.dep, f.dest])).slice(0, 80);
  const missions = [...new Set([...count(state.flights.map((f) => f.mission)), ...L.MISSIONS])];
  $('#dl-places').innerHTML = places.map((p) => `<option value="${esc(p)}">`).join('');
  $('#dl-missions').innerHTML = missions.map((p) => `<option value="${esc(p)}">`).join('');
}

// ---------------------------------------------------------------- รายการ
function flightRow(f, no) {
  const route = [f.dep, f.dest].filter(Boolean).join(' → ');
  return `<button class="flight" data-id="${esc(f.id)}">
    <div class="l1"><span>#${no} · ${L.dmy(f.date)} · ${esc(f.type)}${f.number ? ' ' + esc(f.number) : ''}<span class="tag">${esc(f.duty)}</span></span>
      <span class="hrs">${L.fmt(f.hours)}</span></div>
    <div class="l2">${esc(route)}${f.mission ? (route ? ' · ' : '') + esc(f.mission) : ''}</div>
    ${f.note ? `<div class="l3">${esc(f.note)}</div>` : ''}
  </button>`;
}

function renderList() {
  const box = $('#list');
  const sorted = sortedFlights();
  if (!sorted.length) {
    box.innerHTML = '<div class="empty">ยังไม่มีเที่ยวบิน<br>กดแท็บ “บันทึก” เพื่อเพิ่ม หรือนำเข้าจากไฟล์ Excel ในแท็บ “ตั้งค่า”</div>';
    return;
  }
  const noOf = new Map(sorted.map((f, i) => [f.id, i + 1]));
  const q = $('#search').value.trim().toLowerCase();
  if (q) {
    const hit = sorted.filter((f) => [f.date, L.dmy(f.date), f.type, f.number, f.dep, f.dest, f.mission, f.duty, f.note].join(' ').toLowerCase().includes(q)).reverse();
    const sum = L.sumFlights(hit).hours;
    box.innerHTML = `<div class="page-head"><span>พบ ${hit.length} รายการ</span><span class="muted">รวม ${L.fmt(sum)} ชม.</span></div>`
      + (hit.map((f) => flightRow(f, noOf.get(f.id))).join('') || '<div class="empty">ไม่พบรายการที่ตรงกับคำค้น</div>');
    return;
  }
  const pages = L.paginate(sorted, state.opening);
  box.innerHTML = pages.slice().reverse().map((p) => `
    <div class="page-head"><span>หน้า ${p.n}</span>
      <span class="muted">${p.rows.length}/${L.PAGE_SIZE} รายการ · หน้านี้ ${L.fmt(p.thisPage.hours)} · สะสม ${L.fmt(p.forward.hours)} ชม.</span></div>
    ${p.rows.map((f) => flightRow(f, f.no)).join('')}`).join('');
}

// ---------------------------------------------------------------- สรุป
function renderSummary() {
  const t = totalsNow();
  const types = [...new Set([...L.AIRCRAFT, ...Object.keys(t.byType)])].filter((x) => t.byType[x]);
  const duties = L.DUTIES.filter((d) => types.some((ty) => t.byTypeDuty[`${ty}|${d}`]));
  if (!duties.length) duties.push('CP/PI');
  const cell = (v) => (v ? L.fmt(v) : '–');

  const rows = types.map((ty) => `<tr><td>${esc(ty)}</td>${duties.map((d) => `<td>${cell(t.byTypeDuty[`${ty}|${d}`])}</td>`).join('')}<td><b>${L.fmt(t.byType[ty])}</b></td></tr>`).join('');

  const today = L.todayISO();
  const since = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return L.sumFlights(state.flights.filter((f) => f.date > iso && f.date <= today)).hours;
  };
  const stat = (label, v) => `<div class="stat"><b>${L.fmt(v)}</b><span>${label}</span></div>`;

  $('#summary').innerHTML = `
    <section class="card"><h2>ชั่วโมงบินตามแบบอากาศยาน</h2>
      <div class="scroll"><table>
        <thead><tr><th>แบบ</th>${duties.map((d) => `<th>${d}</th>`).join('')}<th>รวม</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${duties.length + 2}" class="muted">ยังไม่มีข้อมูล</td></tr>`}</tbody>
        <tfoot><tr><td>รวม</td>${duties.map(() => '<td></td>').join('')}<td>${L.fmt(t.hours)}</td></tr></tfoot>
      </table></div></section>
    <section class="card"><h2>ประเภทการบิน</h2><div class="stats">
      ${stat('Single engine', t.single)}${stat('Multi engine', t.multi)}
      ${stat('Simulator', t.sim)}${stat('X-Country', t.xc)}
      ${stat('Night Un-aided', t.nightUn)}${stat('Night NVG', t.nvg)}
      ${stat('IFR Training', t.ifr)}${stat('IMC', t.imc)}
    </div></section>
    <section class="card"><h2>ชั่วโมงบินล่าสุด</h2><div class="stats" style="grid-template-columns:repeat(3,1fr)">
      ${stat('30 วัน', since(30))}${stat('90 วัน', since(90))}${stat('365 วัน', since(365))}
    </div><p class="muted small" style="margin-bottom:0">นับเฉพาะเที่ยวบินที่บันทึกในแอป (ไม่รวมยอดยกมา)</p></section>`;
}

// ---------------------------------------------------------------- ตั้งค่า
function renderSettings() {
  const u = state.user;
  $('#account-info').textContent = !firebaseReady
    ? 'โหมดในเครื่อง: ข้อมูลอยู่ในเบราว์เซอร์เครื่องนี้เท่านั้น ยังไม่ซิงค์ข้ามอุปกรณ์ (ตั้งค่า Firebase ตามคู่มือใน README)'
    : u?.email ? `เข้าสู่ระบบเป็น ${u.email} · ข้อมูลซิงค์ข้ามอุปกรณ์อัตโนมัติ` : 'ยังไม่ได้เข้าสู่ระบบ';
  $('#btn-logout').hidden = !(firebaseReady && u);
  $('#opening-info').textContent = state.opening?.hours
    ? `ตั้งไว้ ${L.fmt(state.opening.hours)} ชม.`
    : 'ยังไม่ได้ตั้งค่า (เริ่มนับจาก 0)';
}

// ----- ยอดยกมา
const GENERAL = [['hours', 'ชั่วโมงรวม'], ['single', 'Single engine'], ['multi', 'Multi engine'], ...L.CONDS.map((c) => [c.key, c.label])];

function openOpeningDialog() {
  const o = state.opening || L.emptyTotals();
  const val = (v) => (v ? v : '');
  $('#opening-fields').innerHTML = `
    <div class="sect">ชั่วโมงสะสมตามแบบ × หน้าที่</div>
    <div class="scroll"><table><thead><tr><th>แบบ</th>${L.DUTIES.map((d) => `<th>${d}</th>`).join('')}</tr></thead>
    <tbody>${L.AIRCRAFT.map((ty) => `<tr><td>${ty}</td>${L.DUTIES.map((d) => `<td><input type="number" step="0.1" min="0" inputmode="decimal" data-k="${ty}|${d}" value="${val(o.byTypeDuty[`${ty}|${d}`])}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="sect">ยอดรวมอื่น ๆ <span class="muted small">(เว้นว่างให้คำนวณอัตโนมัติ: รวม/Single/Multi)</span></div>
    <div class="grid2">${GENERAL.map(([k, label]) => `<label>${label}<input type="number" step="0.1" min="0" inputmode="decimal" data-g="${k}" value="${val(o[k])}"></label>`).join('')}</div>`;
  $('#dlg-opening').returnValue = '';
  $('#dlg-opening').showModal();
}

function saveOpeningFromDialog() {
  const t = L.emptyTotals();
  for (const inp of document.querySelectorAll('#opening-fields [data-k]')) {
    const v = L.num(inp.value);
    if (!v) continue;
    const [ty] = inp.dataset.k.split('|');
    t.byTypeDuty[inp.dataset.k] = v;
    t.byType[ty] = (t.byType[ty] || 0) + v;
  }
  for (const inp of document.querySelectorAll('#opening-fields [data-g]')) t[inp.dataset.g] = L.num(inp.value);
  const sumTypes = Object.values(t.byType).reduce((a, b) => a + b, 0);
  if (!t.hours) t.hours = sumTypes;
  if (!t.single && !t.multi) {
    for (const [ty, h] of Object.entries(t.byType)) {
      if (L.SINGLE.has(ty)) t.single += h;
      if (L.MULTI.has(ty)) t.multi += h;
    }
  }
  t.sim = t.byType.SIM || 0;
  backend.saveOpening(t);
  toast('บันทึกยอดยกมาแล้ว');
}

// ----- นำเข้า/ส่งออก
async function importXlsx(file) {
  try {
    const XLSX = await loadXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const names = wb.SheetNames.filter((n) => /^S\d+$/i.test(n)).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
    if (!names.length) throw new Error('ไม่พบชีต S1, S2, ... ในไฟล์นี้');

    const incoming = [];
    let opening = null;
    let ord = 0;
    names.forEach((n, idx) => {
      const ws = wb.Sheets[n];
      const r = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      if (r.s.r || r.s.c) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: r.e });
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      if (idx === 0 && rows[22]) {
        const o = L.parseOpening(rows[22]);
        if (o.hours > 0) opening = o;
      }
      for (let i = 3; i < rows.length; i++) {
        const f = L.rowToFlight(rows[i]);
        if (f) { f.id = crypto.randomUUID(); f.ord = ord++; incoming.push(f); }
      }
    });

    const fresh = L.filterNew(state.flights, incoming);
    const skipped = incoming.length - fresh.length;
    const lines = [`พบ ${incoming.length} เที่ยวบินในไฟล์`, `จะเพิ่มใหม่ ${fresh.length} รายการ${skipped ? ` (ข้ามที่ซ้ำ ${skipped})` : ''}`];
    if (opening) lines.push(`ยอดยกมาในไฟล์: ${L.fmt(opening.hours)} ชม.`);
    if (!fresh.length && !opening) { toast('ไม่มีข้อมูลใหม่ให้นำเข้า'); return; }
    if (!confirm(`${lines.join('\n')}\n\nนำเข้าเลยไหม?`)) return;

    if (fresh.length) backend.saveMany(fresh);
    if (opening && (!state.opening?.hours || confirm(`มียอดยกมาอยู่แล้ว (${L.fmt(state.opening.hours)} ชม.)\nแทนที่ด้วยยอดจากไฟล์ (${L.fmt(opening.hours)} ชม.) ไหม?`))) {
      backend.saveOpening(opening);
    }
    toast(`นำเข้า ${fresh.length} เที่ยวบินแล้ว`);
  } catch (e) {
    toast(e.message || 'นำเข้าไม่สำเร็จ');
  }
}

async function exportXlsx() {
  const sorted = sortedFlights();
  if (!sorted.length) { toast('ยังไม่มีข้อมูลให้ส่งออก'); return; }
  try {
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    const sum = XLSX.utils.aoa_to_sheet(L.exportSummaryAOA(sorted, state.opening));
    sum['!cols'] = [{ wch: 18 }, ...Array(7).fill({ wch: 9 })];
    XLSX.utils.book_append_sheet(wb, sum, 'Summary');
    for (const p of L.paginate(sorted, state.opening)) {
      const ws = XLSX.utils.aoa_to_sheet(L.exportPageAOA(p));
      ws['!cols'] = [{ wch: 5 }, { wch: 11 }, { wch: 9 }, { wch: 8 }, { wch: 26 }, { wch: 26 }, { wch: 15 }, { wch: 7 }, ...Array(20).fill({ wch: 8 }), { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws, `S${p.n}`);
    }
    XLSX.writeFile(wb, `Pilot_Logbook_${L.todayISO()}.xlsx`);
  } catch (e) {
    toast(e.message || 'ส่งออกไม่สำเร็จ');
  }
}

function exportJson() {
  const data = { app: 'pilot-logbook', version: 1, exportedAt: new Date().toISOString(), opening: state.opening, flights: sortedFlights() };
  download(`pilot-logbook-backup-${L.todayISO()}.json`, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
}

async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'pilot-logbook' || !Array.isArray(data.flights)) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของแอป');
    const flights = data.flights.filter((f) => f && f.id && f.date && f.type);
    if (!confirm(`กู้คืน ${flights.length} เที่ยวบิน${data.opening ? ' และยอดยกมา' : ''}?\nรายการที่มีอยู่แล้วจะถูกอัปเดต ไม่ซ้ำซ้อน`)) return;
    backend.saveMany(flights);
    if (data.opening) backend.saveOpening(data.opening);
    toast('กู้คืนข้อมูลแล้ว');
  } catch (e) {
    toast(e.message || 'กู้คืนไม่สำเร็จ');
  }
}

// ---------------------------------------------------------------- หน้าจอ
function showView(name) {
  state.view = name;
  const pending = firebaseReady && state.user === undefined; // ยังรอผลตรวจการเข้าสู่ระบบ
  const loggedOut = firebaseReady && state.user === null;
  const target = loggedOut ? 'login' : name;
  for (const v of ['login', 'add', 'list', 'summary', 'settings']) $(`#view-${v}`).hidden = pending || v !== target;
  $('#tabs').hidden = pending || loggedOut;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  renderCurrent();
  window.scrollTo(0, 0);
}

function renderCurrent() {
  renderHeader();
  if (state.view === 'list') renderList();
  else if (state.view === 'summary') renderSummary();
  else if (state.view === 'settings') renderSettings();
}

// ---------------------------------------------------------------- เริ่มต้น
async function main() {
  initForm();

  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#list').addEventListener('click', (e) => {
    const b = e.target.closest('.flight');
    if (b) startEdit(b.dataset.id);
  });
  $('#search').addEventListener('input', renderList);
  $('#btn-login').addEventListener('click', () => backend.signIn());
  $('#btn-logout').addEventListener('click', () => backend.signOut());
  $('#btn-opening').addEventListener('click', openOpeningDialog);
  $('#dlg-opening').addEventListener('close', () => { if ($('#dlg-opening').returnValue === 'save') saveOpeningFromDialog(); });
  $('#btn-export-xlsx').addEventListener('click', exportXlsx);
  $('#btn-export-json').addEventListener('click', exportJson);
  $('#file-xlsx').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importXlsx(f); });
  $('#file-json').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importJson(f); });

  try {
    backend = await createBackend();
  } catch (e) {
    toast('เริ่มระบบซิงค์ไม่ได้ — ต่อเน็ตแล้วโหลดหน้าใหม่ครั้งหนึ่ง');
    console.error(e);
    return;
  }

  backend.start({
    onFlights(list) { state.flights = list; refreshSuggestions(); renderCurrent(); },
    onOpening(o) { state.opening = o; renderCurrent(); },
    onUser(u) { state.user = u; showView(state.view); },
    onStatus(s) { state.status = s; renderHeader(); },
    onError(msg) { toast(msg); },
  });
  showView('add');
}

main();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
