import * as L from './logic.js';
import { createBackend, firebaseReady } from './backend.js';
import { fillWorkbook, MAX_PAGES } from './xlsxfill.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { flights: [], opening: null, config: null, user: undefined, status: '', editing: null, view: 'add', synced: false, welcome: false, wstep: 0, welcomeChecked: false, recheckWelcome: false };
let backend = null;
let toastTimer = 0;

// ---------------------------------------------------------------- ตัวช่วย
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
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

function loadScript(src, globalName, errMsg) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(window[globalName]);
    s.onerror = () => reject(new Error(errMsg));
    document.head.appendChild(s);
  });
}
const loadJSZip = () => loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'JSZip', 'โหลดตัวสร้างไฟล์ไม่ได้ — ต้องต่อเน็ตในครั้งแรก');

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
  chip.className = `chip-status ${state.status}`;
  chip.textContent = labels[state.status] || '';
}

// ---------------------------------------------------------------- ฟอร์ม
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ข้าม */ } },
};

const SHORT = { xc: 'XC', nightUn: 'Night', nvg: 'NVG', ifr: 'IFR', imc: 'IMC' };

// ชิปแทน dropdown (แตะง่ายบนมือถือ/ไอแพด) — ยังเก็บค่าใน <select> ที่ซ่อนไว้
function renderChips(boxSel, selSel, values, extra = null) {
  const all = extra && !values.includes(extra) ? [...values, extra] : values;
  const sel = $(selSel);
  const cur = sel.value;
  sel.innerHTML = all.map((v) => `<option>${esc(v)}</option>`).join('');
  $(boxSel).innerHTML = all.map((v) => `<button type="button" class="chip" role="radio" aria-checked="false" data-v="${esc(v)}">${esc(v)}</button>`).join('');
  if (all.includes(cur)) sel.value = cur;
}

function wireChips(boxSel, selSel) {
  $(boxSel).addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    $(selSel).value = b.dataset.v;
    $(selSel).dispatchEvent(new Event('change', { bubbles: true }));
    syncChips();
  });
}

// รายการแบบอากาศยานเปลี่ยนได้ → วาดชิปใหม่ (extra = แบบของเที่ยวบินเก่าที่กำลังแก้ ซึ่งไม่อยู่ในรายการแล้ว)
function renderTypeChips(extra = null) {
  renderChips('#chips-type', '#f-type', L.AIRCRAFT, extra);
  syncChips();
}

const TYPE_COLORS = ['#2f7f6d', '#2c6ea6', '#b8693a', '#8a5ca8', '#7f8f34', '#b08a2e', '#aa4f62', '#6c7380'];
const typeColor = (name) => { const i = L.AIRCRAFT.indexOf(name); return i >= 0 ? TYPE_COLORS[i % TYPE_COLORS.length] : '#6c7380'; };

// ภารกิจ: ชิปเหมือนหน้าที่ + ชิป “อื่นๆ (พิมพ์เอง)” — ค่าเก็บในช่องข้อความ #f-mission (แสดงเมื่อเลือกพิมพ์เอง)
let missionCustom = false;

function missionOptions() {
  const cur = $('#f-mission').value.trim();
  const counts = new Map();
  for (const f of state.flights) {
    const m = (f.mission || '').trim();
    if (m && !L.MISSIONS.includes(m)) counts.set(m, (counts.get(m) || 0) + 1);
  }
  const history = [...counts.entries()].sort((x, y) => y[1] - x[1]).map((x) => x[0]).slice(0, 8);
  const opts = [...L.MISSIONS, ...history];
  if (cur && !missionCustom && !opts.includes(cur)) opts.push(cur); // ภารกิจของเที่ยวเก่าที่กำลังแก้/เพิ่งบันทึก
  return opts;
}

let missionKey = '';
function renderMissionChips() {
  const opts = missionOptions();
  const key = opts.join('\u0001');
  if (key !== missionKey || !$('#chips-mission').firstChild) { // วาดใหม่เฉพาะเมื่อรายการเปลี่ยน
    missionKey = key;
    $('#chips-mission').innerHTML = opts
      .map((m) => `<button type="button" class="chip" role="radio" aria-checked="false" data-v="${esc(m)}">${esc(m)}</button>`)
      .join('') + '<button type="button" class="chip" role="radio" aria-checked="false" data-custom="1">อื่นๆ (พิมพ์เอง)</button>';
  }
  syncMissionChips();
}

function syncMissionChips() {
  const inp = $('#f-mission');
  const val = inp.value.trim();
  const chips = [...$('#chips-mission').querySelectorAll('.chip[data-v]')];
  if (val && !chips.some((b) => b.dataset.v === val)) missionCustom = true; // ค่าที่ไม่มีในชิป = พิมพ์เอง
  chips.forEach((b) => b.setAttribute('aria-checked', String(!missionCustom && b.dataset.v === val)));
  $('#chips-mission .chip[data-custom]')?.setAttribute('aria-checked', String(missionCustom));
  inp.hidden = !missionCustom;
}

function syncChips() {
  for (const [box, sel] of [['#chips-type', '#f-type'], ['#chips-duty', '#f-duty']]) {
    const v = $(sel).value;
    $(box).querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
  }
}

// สภาพการบิน: ชิปเปิด/ปิด + ช่องตัวเลข (ค่าเริ่มต้น = เท่าชั่วโมงบิน และตามไปเมื่อแก้ชั่วโมงบิน)
const condEl = (key) => document.querySelector(`.cond[data-key="${key}"]`);

function setCond(key, value, auto = false) {
  const el = condEl(key);
  const inp = el.querySelector('input');
  const on = value !== null;
  el.querySelector('.cond-chip').setAttribute('aria-pressed', String(on));
  inp.hidden = !on;
  inp.value = on && value !== '' ? value : '';
  el.dataset.auto = on && auto ? '1' : '';
}

function readCond(key, hours) {
  const el = condEl(key);
  if (el.querySelector('.cond-chip').getAttribute('aria-pressed') !== 'true') return 0;
  const v = L.num(el.querySelector('input').value);
  return v > 0 ? v : hours;
}

function syncAutoConds() {
  const h = $('#f-hours').value;
  document.querySelectorAll('.cond[data-auto="1"]').forEach((el) => { el.querySelector('input').value = h; });
}

function initForm() {
  renderChips('#chips-type', '#f-type', L.AIRCRAFT);
  renderChips('#chips-duty', '#f-duty', L.DUTIES);
  wireChips('#chips-type', '#f-type');
  wireChips('#chips-duty', '#f-duty');
  $('#chips-mission').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const inp = $('#f-mission');
    if (b.dataset.custom) {
      if (!missionCustom) { missionCustom = true; inp.value = ''; }
      syncMissionChips();
      inp.focus();
      return;
    }
    missionCustom = false;
    inp.value = inp.value.trim() === b.dataset.v ? '' : b.dataset.v; // แตะซ้ำ = ยกเลิก
    syncMissionChips();
  });
  $('#conds').innerHTML = L.CONDS.map((c) => `
    <div class="cond" data-key="${c.key}">
      <button type="button" class="chip cond-chip" aria-pressed="false">${c.label}</button>
      <input id="c-${c.key}" type="number" inputmode="decimal" step="0.1" min="0" placeholder="0.0" aria-label="${c.label} (ชั่วโมง)" hidden>
    </div>`).join('');

  resetForm(LS.get('lb.last', {}));

  $('#f-type').addEventListener('change', () => {
    const nums = LS.get('lb.nums', {});
    $('#f-number').value = nums[$('#f-type').value] || '';
  });
  $('#conds').addEventListener('click', (e) => {
    const chip = e.target.closest('.cond-chip');
    if (!chip) return;
    const key = chip.parentElement.dataset.key;
    if (chip.getAttribute('aria-pressed') === 'true') setCond(key, null);
    else setCond(key, $('#f-hours').value || '', true);
  });
  $('#conds').addEventListener('input', (e) => { const el = e.target.closest('.cond'); if (el) el.dataset.auto = ''; });
  $('#f-hours').addEventListener('input', syncAutoConds);
  document.querySelectorAll('.stepper [data-step]').forEach((b) => b.addEventListener('click', () => {
    const next = Math.max(0, Math.round((L.num($('#f-hours').value) + Number(b.dataset.step)) * 10) / 10);
    $('#f-hours').value = next ? next.toFixed(1) : '';
    syncAutoConds();
  }));
  $('#form').addEventListener('submit', onSubmit);
  $('#btn-cancel').addEventListener('click', () => { exitEdit(); showView('list'); });
  $('#btn-delete').addEventListener('click', onDelete);
}

function resetForm(keep = {}) {
  renderTypeChips();
  $('#f-date').value = keep.date || L.todayISO();
  $('#f-type').value = L.AIRCRAFT.includes(keep.type) ? keep.type : L.AIRCRAFT[0];
  const nums = LS.get('lb.nums', {});
  $('#f-number').value = keep.number ?? nums[$('#f-type').value] ?? '';
  $('#f-duty').value = L.DUTIES.includes(keep.duty) ? keep.duty : L.DUTIES[0];
  $('#f-dep').value = keep.dep || '';
  $('#f-dest').value = '';
  $('#f-mission').value = keep.mission || '';
  missionCustom = false;
  renderMissionChips();
  $('#f-hours').value = '';
  $('#f-note').value = '';
  for (const c of L.CONDS) setCond(c.key, null);
  syncChips();
}

function readForm() {
  const hours = L.num($('#f-hours').value);
  const f = {
    date: $('#f-date').value,
    type: $('#f-type').value,
    number: $('#f-number').value.trim(),
    dep: $('#f-dep').value.trim(),
    dest: $('#f-dest').value.trim(),
    mission: $('#f-mission').value.trim(),
    duty: $('#f-duty').value,
    hours,
    note: $('#f-note').value.trim(),
  };
  for (const c of L.CONDS) f[c.key] = readCond(c.key, hours);
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
  if (err) {
    toast(err, 4500);
    const field = !f.date ? '#f-date' : (!(f.hours > 0) || f.hours > 24) ? '#f-hours' : null;
    if (field) { $(field).scrollIntoView({ block: 'center', behavior: 'smooth' }); $(field).focus({ preventScroll: true }); }
    return;
  }

  if (state.editing) {
    const old = state.flights.find((x) => x.id === state.editing);
    f.id = state.editing;
    f.ord = old && old.date === f.date ? old.ord : L.slotOrd(sortedFlights().filter((x) => x.id !== f.id), f.date);
  } else {
    f.id = crypto.randomUUID();
    f.ord = L.slotOrd(sortedFlights(), f.date);
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
    flashSaved();
    window.scrollTo({ top: 0, behavior: 'smooth' }); // ให้เห็นฟอร์มที่ล้างแล้วและตัวนับชั่วโมงที่เพิ่มขึ้น
    // บนมือถือ/ไอแพดไม่โฟกัสช่องพิมพ์ เพราะคีย์บอร์ดจะเด้งขึ้นมาบังหน้าจอ (เมาส์/คีย์บอร์ดจริงโฟกัสต่อให้)
    if (matchMedia('(pointer: fine)').matches) $('#f-dest').focus({ preventScroll: true });
  }
}

// ปุ่มบันทึกเปลี่ยนเป็น “✓ บันทึกแล้ว” สั้นๆ และกันการกดซ้ำ (กดซ้ำจะเจอข้อความเตือนช่องว่างทั้งที่บันทึกสำเร็จแล้ว)
function flashSaved() {
  const b = $('#btn-save');
  b.disabled = true;
  b.classList.add('done');
  b.textContent = '✓ บันทึกแล้ว';
  navigator.vibrate?.(15);
  setTimeout(() => {
    b.disabled = false;
    b.classList.remove('done');
    b.textContent = state.editing ? 'บันทึก' : 'บันทึกเที่ยวบิน';
  }, 700);
}

function startEdit(id) {
  const f = state.flights.find((x) => x.id === id);
  if (!f) return;
  state.editing = id;
  $('#form-title').textContent = `แก้ไขเที่ยวบิน · ${L.dmy(f.date)}`;
  $('#f-date').value = f.date;
  renderTypeChips(f.type);
  $('#f-type').value = f.type;
  $('#f-number').value = f.number || '';
  $('#f-duty').value = L.DUTIES.includes(f.duty) ? f.duty : L.DUTIES[0];
  $('#f-dep').value = f.dep || '';
  $('#f-dest').value = f.dest || '';
  $('#f-mission').value = f.mission || '';
  missionCustom = false;
  renderMissionChips();
  $('#f-hours').value = f.hours;
  $('#f-note').value = f.note || '';
  for (const c of L.CONDS) {
    const v = L.num(f[c.key]);
    setCond(c.key, v > 0 ? v : null, v > 0 && Math.abs(v - L.num(f.hours)) < 1e-9);
  }
  syncChips();
  $('#btn-save').textContent = 'บันทึก';
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
  const placesHtml = places.map((p) => `<option value="${esc(p)}">`).join('');
  if ($('#dl-places').dataset.h !== placesHtml) { $('#dl-places').innerHTML = placesHtml; $('#dl-places').dataset.h = placesHtml; }
  renderMissionChips();
}

// ---------------------------------------------------------------- รายการ
function flightRow(f, no) {
  const route = [f.dep, f.dest].filter(Boolean).join(' → ');
  const minis = L.CONDS.filter((c) => L.num(f[c.key]) > 0).map((c) => `<span class="mini">${SHORT[c.key]}</span>`).join('');
  const meta = [f.mission, f.note].filter(Boolean).map(esc).join(' · ');
  return `<button class="flight" data-id="${esc(f.id)}" data-type="${esc(f.type)}" style="--t:${typeColor(f.type)}">
    <span class="f-main">
      <span class="f-top"><span class="f-no">#${no}</span><span>${L.dmy(f.date)}</span><span class="f-type">${esc(f.type)}${f.number ? ' ' + esc(f.number) : ''}</span><span class="tag">${esc(f.duty)}</span></span>
      ${route ? `<span class="f-route">${esc(route)}</span>` : ''}
      ${minis || meta ? `<span class="f-meta">${minis}${meta}</span>` : ''}
    </span>
    <span class="f-hours"><b>${L.fmt(f.hours)}</b><small>ชม.</small></span>
  </button>`;
}

function renderRecent() {
  const box = $('#recent-list');
  const sorted = sortedFlights();
  if (!sorted.length) { box.innerHTML = '<div class="empty small">ยังไม่มีเที่ยวบิน</div>'; box.dataset.h = ''; return; }
  const html = sorted.slice(-8).reverse().map((f, i) => flightRow(f, sorted.length - i)).join('');
  if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; }
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
      + (hit.length ? `<div class="rows">${hit.map((f) => flightRow(f, noOf.get(f.id))).join('')}</div>` : '<div class="empty">ไม่พบรายการที่ตรงกับคำค้น</div>');
    return;
  }
  const pages = L.paginate(sorted, state.opening);
  box.innerHTML = pages.slice().reverse().map((p) => `
    <div class="page-head"><span>หน้า ${p.n}</span>
      <span class="muted">${p.rows.length}/${L.PAGE_SIZE} รายการ · หน้านี้ ${L.fmt(p.thisPage.hours)} · สะสม ${L.fmt(p.forward.hours)} ชม.</span></div>
    <div class="rows">${p.rows.map((f) => flightRow(f, f.no)).join('')}</div>`).join('');
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

  const maxH = Math.max(1, ...types.map((ty) => t.byType[ty]));
  const bars = types.map((ty) => `<div class="bar-row" data-type="${esc(ty)}" style="--t:${typeColor(ty)}"><span>${esc(ty)}</span><div class="bar"><i style="width:${((t.byType[ty] / maxH) * 100).toFixed(1)}%"></i></div><b>${L.fmt(t.byType[ty])}</b></div>`).join('');

  $('#summary').innerHTML = `
    <section class="card"><h2>สัดส่วนตามแบบอากาศยาน</h2>${bars || '<p class="muted">ยังไม่มีข้อมูล</p>'}</section>
    <section class="card"><h2>ชั่วโมงบินตามแบบ × หน้าที่</h2>
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
function renderAircraftSummary() {
  $('#ac-summary').innerHTML = L.AIRCRAFT.map((n) => `<span class="pill" style="--t:${typeColor(n)}"><i></i>${esc(n)} <small>${L.KIND_SHORT[L.kindOf(n)]}</small></span>`).join('');
}

function renderSettings() {
  renderAircraftSummary();
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

// ----- แบบอากาศยานของฉัน
let acDraft = []; // [{ name, kind, orig }]  orig = ชื่อเดิม (ใช้ตามรอยการเปลี่ยนชื่อ)

function renderAcRows() {
  const kinds = Object.entries(L.KIND_SHORT);
  $('#ac-rows').innerHTML = acDraft.map((a, i) => `
    <div class="ac-row" data-i="${i}">
      <span class="ac-no">${i + 1}</span>
      <input class="ac-name" value="${esc(a.name)}" maxlength="12" placeholder="เช่น AW139" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="ชื่อแบบอากาศยานลำดับที่ ${i + 1}">
      <div class="ac-sub">
        <select class="ac-kind" aria-label="ชนิดเครื่องยนต์">${kinds.map(([k, label]) => `<option value="${k}"${a.kind === k ? ' selected' : ''}>${label}</option>`).join('')}</select>
        <button type="button" class="ic" data-act="up" aria-label="เลื่อนขึ้น"${i === 0 ? ' disabled' : ''}>▲</button>
        <button type="button" class="ic" data-act="down" aria-label="เลื่อนลง"${i === acDraft.length - 1 ? ' disabled' : ''}>▼</button>
        <button type="button" class="ic del" data-act="del" aria-label="ลบแถวนี้">✕</button>
      </div>
      <div class="ac-note">ไฟล์ Excel รองรับหน้าที่: ${L.slotDuties(i).join(', ')}</div>
    </div>`).join('');
  $('#ac-add').disabled = acDraft.length >= L.MAX_AIRCRAFT;
}

function syncAcDraft() {
  document.querySelectorAll('#ac-rows .ac-row').forEach((row, i) => {
    if (!acDraft[i]) return;
    acDraft[i].name = row.querySelector('.ac-name').value.trim().toUpperCase();
    acDraft[i].kind = row.querySelector('.ac-kind').value;
  });
}

function openAircraftDialog() {
  acDraft = L.getAircraft().map((a) => ({ ...a, orig: a.name }));
  renderAcRows();
  $('#ac-error').hidden = true;
  $('#dlg-aircraft').returnValue = '';
  $('#dlg-aircraft').showModal();
}

// ชื่อแบบที่ยังถูกใช้อยู่ (เที่ยวบิน/ยอดยกมา) → ห้ามลบ
function usedAircraftCount(name) {
  let n = state.flights.filter((f) => f.type === name).length;
  if (state.opening && L.num(state.opening.byType?.[name]) > 0) n += 1;
  return n;
}

function commitAircraft(list, renames) {
  if (renames.size) {
    const map = (t) => renames.get(t) ?? t;
    const changed = state.flights.filter((f) => renames.has(f.type)).map((f) => ({ ...f, type: map(f.type) }));
    if (changed.length) backend.saveMany(changed);
    if (state.opening) {
      const o = { ...state.opening, byType: {}, byTypeDuty: {} };
      for (const [k, v] of Object.entries(state.opening.byType || {})) o.byType[map(k)] = (o.byType[map(k)] || 0) + v;
      for (const [k, v] of Object.entries(state.opening.byTypeDuty || {})) {
        const [ty, d] = k.split('|');
        const nk = `${map(ty)}|${d}`;
        o.byTypeDuty[nk] = (o.byTypeDuty[nk] || 0) + v;
      }
      backend.saveOpening(o);
    }
  }
  backend.saveConfig({ v: 1, aircraft: list });
  toast('บันทึกรายการแบบอากาศยานแล้ว');
}

function initAircraftEditor() {
  $('#btn-aircraft').addEventListener('click', openAircraftDialog);
  $('#ac-add').addEventListener('click', () => {
    syncAcDraft();
    if (acDraft.length >= L.MAX_AIRCRAFT) return;
    acDraft.push({ name: '', kind: 'single', orig: null });
    renderAcRows();
    document.querySelectorAll('#ac-rows .ac-name')[acDraft.length - 1]?.focus();
  });
  $('#ac-default').addEventListener('click', () => {
    const cur = new Set(L.AIRCRAFT);
    acDraft = L.DEFAULT_AIRCRAFT.map((a) => ({ ...a, orig: cur.has(a.name) ? a.name : null }));
    renderAcRows();
  });
  $('#ac-clear').addEventListener('click', () => {
    syncAcDraft();
    acDraft = [{ name: '', kind: 'single', orig: null }];
    renderAcRows();
  });
  $('#ac-rows').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    syncAcDraft();
    const i = Number(b.closest('.ac-row').dataset.i);
    if (b.dataset.act === 'del') acDraft.splice(i, 1);
    else if (b.dataset.act === 'up' && i > 0) [acDraft[i - 1], acDraft[i]] = [acDraft[i], acDraft[i - 1]];
    else if (b.dataset.act === 'down' && i < acDraft.length - 1) [acDraft[i + 1], acDraft[i]] = [acDraft[i], acDraft[i + 1]];
    renderAcRows();
  });
  $('#form-aircraft').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value !== 'save') return; // ยกเลิก → ปิดตามปกติ
    syncAcDraft();
    const list = acDraft.map(({ name, kind }) => ({ name, kind }));
    let err = L.validateAircraft(list);
    const renames = new Map();
    if (!err) {
      const kept = new Set(acDraft.filter((a) => a.orig).map((a) => a.orig));
      for (const cur of L.AIRCRAFT) {
        const n = usedAircraftCount(cur);
        if (!kept.has(cur) && n) { err = `แบบ ${cur} ยังมีข้อมูลอยู่ (${n > 1 || state.flights.some((f) => f.type === cur) ? 'เที่ยวบิน/ยอดยกมา' : 'ยอดยกมา'}) จึงลบไม่ได้ ให้เปลี่ยนชื่อในแถวเดิมแทน`; break; }
      }
      for (const a of acDraft) if (a.orig && a.orig !== a.name) renames.set(a.orig, a.name);
    }
    if (err) { e.preventDefault(); $('#ac-error').textContent = err; $('#ac-error').hidden = false; return; }
    commitAircraft(list, renames);
  });
}

function applyConfig(cfg) {
  state.config = cfg;
  const list = cfg?.aircraft && !L.validateAircraft(cfg.aircraft) ? cfg.aircraft : L.DEFAULT_AIRCRAFT;
  L.setAircraft(list);
  const editing = state.editing ? state.flights.find((x) => x.id === state.editing) : null;
  renderTypeChips(editing?.type || null);
  renderCurrent();
}

// ----- ต้อนรับผู้ใช้ใหม่
function maybeWelcome() {
  if (state.welcome || !state.synced || !state.user) return;
  if (state.welcomeChecked && !state.recheckWelcome) return;
  const empty = !state.config && !state.flights.length && !state.opening?.hours;
  if (!empty) { if (!state.recheckWelcome) state.welcomeChecked = true; return; }
  state.welcomeChecked = true;
  state.recheckWelcome = false;
  state.welcome = true;
  state.wstep = 0;
  showView(state.view);
}

function renderWelcome() {
  const step = state.wstep;
  $('#w-dots').innerHTML = [0, 1, 2].map((i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('');
  let html = '';
  if (step === 0) {
    html = `
      <h1>ยินดีต้อนรับ</h1>
      <p class="lead">สมุดบันทึกชั่วโมงบินส่วนตัวของคุณ</p>
      <ul class="bul">
        <li>กรอกเที่ยวบินได้เร็วบนมือถือ ไอแพด และคอมพิวเตอร์ ยอดรวมและยอดสะสมคำนวณให้เอง</li>
        <li>ข้อมูลซิงค์ข้ามอุปกรณ์ และใช้ออฟไลน์ได้</li>
        <li>ส่งออกเป็นไฟล์ Excel ตามรูปแบบสมุดล็อกบุ๊กได้</li>
      </ul>
      <div class="callout"><b>ความเป็นส่วนตัวของคุณ</b>
        ข้อมูลล็อกบุ๊กเห็นได้เฉพาะบัญชี Google ของคุณผ่านแอปนี้ แต่ผู้ดูแลระบบมีสิทธิ์ทางเทคนิคเปิดดูฐานข้อมูลได้ จึงควรเลี่ยงการใส่ข้อมูลลับของหน่วยในช่องภารกิจและหมายเหตุ คุณส่งออกหรือลบข้อมูลทั้งหมดได้ด้วยตัวเอง
        <button type="button" class="linkbtn" data-open="privacy">อ่านรายละเอียด</button></div>
      <div class="w-actions"><button class="btn primary block" data-w="next">เริ่มตั้งค่า</button></div>`;
  } else if (step === 1) {
    html = `
      <h1>แบบอากาศยานของคุณ</h1>
      <p class="lead">เลือกแบบที่คุณบิน (สูงสุด ${L.MAX_AIRCRAFT} แบบ) แก้ภายหลังได้</p>
      <div class="chips-static">${L.AIRCRAFT.map((n) => `<span class="pill" style="--t:${typeColor(n)}"><i></i>${esc(n)} <small>${L.KIND_SHORT[L.kindOf(n)]}</small></span>`).join('')}</div>
      <p class="muted small">รายการเริ่มต้นเป็นชุดจากสมุดต้นแบบ ถ้าคุณบินแบบอื่น กด “แก้ไขรายการ” เพื่อเปลี่ยนชื่อหรือชนิดเครื่องยนต์ ลำดับมีผลกับไฟล์ Excel: ใส่แบบที่บินบ่อยและมีหลายหน้าที่ไว้ลำดับต้น</p>
      <div class="w-actions">
        <button class="btn block" data-w="edit">แก้ไขรายการแบบอากาศยาน</button>
        <div class="w-actions row"><button class="btn" data-w="back">ย้อนกลับ</button><button class="btn primary" data-w="next">ถัดไป</button></div>
      </div>`;
  } else {
    html = `
      <h1>พร้อมเริ่มแล้ว</h1>
      <p class="lead">คุณมีชั่วโมงบินสะสมอยู่แล้วหรือไม่?</p>
      <div class="w-actions">
        <button class="btn w-choice" data-w="import">นำเข้าจากไฟล์ Excel<small>ไฟล์สมุดล็อกบุ๊กรูปแบบเดียวกับต้นแบบ ระบบดึงเที่ยวบินและยอดยกมาให้</small></button>
        <button class="btn w-choice" data-w="opening">ตั้งยอดยกมาเอง<small>พิมพ์ชั่วโมงสะสมก่อนใช้แอป ตามแบบ × หน้าที่</small></button>
        <button class="btn primary w-choice" data-w="start">เริ่มบันทึกเที่ยวบินแรก<small>ไม่มียอดสะสม หรือจะตั้งภายหลังก็ได้</small></button>
      </div>
      <p class="muted small center" style="margin-top:14px">ดูวิธีใช้ได้ทุกเมื่อที่แท็บ “วิธีใช้”</p>
      <div class="w-actions row" style="margin-top:6px"><button class="btn" data-w="back">ย้อนกลับ</button><span></span></div>`;
  }
  $('#w-body').innerHTML = html;
}

function finishWelcome(next) {
  state.welcome = false;
  if (!state.config) backend.saveConfig({ v: 1, aircraft: L.getAircraft() }); // จดว่าตั้งค่าแล้ว จะไม่แสดงหน้าต้อนรับอีก
  if (next === 'import') { showView('settings'); $('#file-xlsx').click(); }
  else if (next === 'opening') { showView('settings'); openOpeningDialog(); }
  else showView('add');
}

function initWelcome() {
  $('#w-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]');
    if (!b) return;
    const a = b.dataset.w;
    if (a === 'next') { state.wstep = Math.min(2, state.wstep + 1); renderWelcome(); }
    else if (a === 'back') { state.wstep = Math.max(0, state.wstep - 1); renderWelcome(); }
    else if (a === 'edit') openAircraftDialog();
    else finishWelcome(a);
  });
}

// ----- ลบข้อมูลทั้งหมดของฉัน
function deleteAllMyData() {
  if (!confirm('ลบข้อมูลทั้งหมดของคุณถาวร (เที่ยวบิน ยอดยกมา และรายการแบบอากาศยาน) กู้คืนไม่ได้\n\nแนะนำให้ส่งออก Excel หรือสำรอง JSON ไว้ก่อน\n\nดำเนินการต่อไหม?')) return;
  const word = prompt('พิมพ์คำว่า ลบ เพื่อยืนยัน');
  if ((word || '').trim() !== 'ลบ') { toast('ยกเลิกการลบ'); return; }
  state.recheckWelcome = true;
  backend.deleteAll(state.flights.map((f) => f.id));
  toast('ลบข้อมูลทั้งหมดแล้ว');
}

// ----- เรียงตามวันที่
function renderOrderInfo() {
  const n = L.countOutOfOrder(sortedFlights());
  $('#order-info').textContent = n
    ? `ตอนนี้มี ${n} รายการที่วันที่ไม่เรียงตามลำดับ`
    : 'ข้อมูลทั้งหมดเรียงตามวันที่แล้ว';
  $('#btn-sort').disabled = !n;
}

function sortByDate() {
  const sorted = sortedFlights();
  const n = L.countOutOfOrder(sorted);
  if (!n) { toast('เรียงตามวันที่อยู่แล้ว'); return; }
  if (!confirm(`เรียงเที่ยวบินทั้งหมดใหม่ตามวันที่ (${n} รายการจะเปลี่ยนตำแหน่ง)\n\nรายการที่ย้ายอาจข้ามหน้า ยอดรวมแต่ละหน้าและไฟล์ Excel ที่ส่งออกจะเปลี่ยนตาม แต่ยอดสะสมรวมเท่าเดิม\nแนะนำให้สำรองข้อมูล (JSON) ก่อน\n\nดำเนินการต่อไหม?`)) return;
  const changed = L.reorderByDate(sorted);
  backend.saveMany(changed);
  toast(`เรียงตามวันที่แล้ว (${changed.length} รายการ)`);
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
    let slotNames = [];
    let fileList = [];
    names.forEach((n, idx) => {
      const ws = wb.Sheets[n];
      const r = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      if (r.s.r || r.s.c) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: r.e });
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      if (idx === 0) {
        slotNames = L.sheetSlotNames(ws);
        fileList = L.sheetAircraft(ws);
        if (rows[22]) {
          const o = L.parseOpening(rows[22], slotNames.some(Boolean) ? slotNames : L.AIRCRAFT);
          if (o.hours > 0) opening = o;
        }
      }
      for (let i = 3; i < rows.length; i++) {
        const f = L.rowToFlight(rows[i]);
        if (f) { f.id = crypto.randomUUID(); f.ord = ord++; incoming.push(f); }
      }
    });

    // แบบอากาศยานในไฟล์ เทียบกับรายการของคุณ
    let newList = null;
    const noData = !state.flights.length && !state.opening?.hours;
    const label = (l) => l.map((a) => a.name).join(', ');
    if (noData && fileList.length && !L.sameAircraft(fileList, L.getAircraft())
      && confirm(`ไฟล์นี้ใช้แบบอากาศยาน: ${label(fileList)}\n\nตั้งเป็นรายการแบบอากาศยานของคุณไหม?\n(ถ้ากดยกเลิก จะใช้รายการปัจจุบัน: ${label(L.getAircraft())})`)) newList = fileList;
    const base = newList ?? L.getAircraft();
    const usedTypes = new Set(incoming.map((f) => f.type));
    if (opening) Object.keys(opening.byType).forEach((k) => usedTypes.add(k));
    const unknown = [...usedTypes].filter((t) => !base.some((a) => a.name === t));
    if (unknown.length) {
      if (base.length + unknown.length > L.MAX_AIRCRAFT) {
        alert(`ไฟล์มีแบบอากาศยานที่ไม่อยู่ในรายการของคุณ: ${unknown.join(', ')}\n\nรายการเต็มแล้ว (สูงสุด ${L.MAX_AIRCRAFT} แบบ) กรุณาแก้รายการที่ ตั้งค่า → แบบอากาศยานของฉัน หรือแก้ชื่อในไฟล์ แล้วนำเข้าใหม่`);
        return;
      }
      if (!confirm(`ไฟล์มีแบบอากาศยานที่ยังไม่มีในรายการ: ${unknown.join(', ')}\n\nเพิ่มเข้ารายการให้ไหม? (ตั้งชนิดเครื่องยนต์ให้เดาเอง ปรับได้ที่ ตั้งค่า → แบบอากาศยานของฉัน)`)) return;
      newList = [...base, ...unknown.map((name) => ({ name, kind: L.guessKind(name) }))];
    }

    const fresh = L.filterNew(state.flights, incoming);
    const skipped = incoming.length - fresh.length;
    const lines = [`พบ ${incoming.length} เที่ยวบินในไฟล์`, `จะเพิ่มใหม่ ${fresh.length} รายการ${skipped ? ` (ข้ามที่ซ้ำ ${skipped})` : ''}`];
    if (opening) lines.push(`ยอดยกมาในไฟล์: ${L.fmt(opening.hours)} ชม.`);
    if (!fresh.length && !opening) { toast('ไม่มีข้อมูลใหม่ให้นำเข้า'); return; }
    if (!confirm(`${lines.join('\n')}\n\nนำเข้าเลยไหม?`)) return;

    if (newList) backend.saveConfig({ v: 1, aircraft: newList });
    if (fresh.length) backend.saveMany(fresh);
    if (opening && (!state.opening?.hours || confirm(`มียอดยกมาอยู่แล้ว (${L.fmt(state.opening.hours)} ชม.)\nแทนที่ด้วยยอดจากไฟล์ (${L.fmt(opening.hours)} ชม.) ไหม?`))) {
      backend.saveOpening(opening);
    }
    toast(`นำเข้า ${fresh.length} เที่ยวบินแล้ว`);
  } catch (e) {
    toast(e.message || 'นำเข้าไม่สำเร็จ');
  }
}

// ส่งออก: กรอกข้อมูลลงไฟล์แม่แบบ (ต้นฉบับที่ล้างข้อมูลแล้ว) จึงได้สูตร/สี/เส้น/ชีต Summary เหมือนต้นฉบับ
async function exportXlsx() {
  const sorted = sortedFlights();
  if (!sorted.length && !state.opening) { toast('ยังไม่มีข้อมูลให้ส่งออก'); return; }
  const pages = L.paginate(sorted, state.opening);
  if (pages.length > MAX_PAGES) { toast(`ข้อมูลเกิน ${MAX_PAGES * L.PAGE_SIZE} รายการ (แม่แบบมี ${MAX_PAGES} ชีต)`); return; }
  const btn = $('#btn-export-xlsx');
  btn.disabled = true;
  try {
    const [JSZip, res] = await Promise.all([loadJSZip(), fetch('template.xlsx')]);
    if (!res.ok) throw new Error('ไม่พบไฟล์ template.xlsx ในเว็บ');
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const text = new Map();
    await fillWorkbook({
      getText: async (p) => text.get(p) ?? (await zip.file(p).async('string')),
      setText: (p, t) => { text.set(p, t); zip.file(p, t); },
    }, pages, state.opening, L.getAircraft());
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    download(`Pilot_Logbook_${L.todayISO()}.xlsx`, blob);
    const gaps = L.coverageGaps(sorted);
    toast(gaps
      ? `ส่งออกแล้ว · มี ${gaps} เที่ยวบินที่หน้าที่ไม่มีคอลัมน์รองรับในไฟล์ Excel (ยังนับในชั่วโมงรวมแล้ว)`
      : 'ส่งออกแล้ว — เปิดด้วย Excel / Google Sheets', gaps ? 6500 : 3200);
  } catch (e) {
    toast(e.message || 'ส่งออกไม่สำเร็จ');
  } finally {
    btn.disabled = false;
  }
}

function exportJson() {
  const data = { app: 'pilot-logbook', version: 1, exportedAt: new Date().toISOString(), opening: state.opening, aircraft: L.getAircraft(), flights: sortedFlights() };
  download(`pilot-logbook-backup-${L.todayISO()}.json`, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
}

async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'pilot-logbook' || !Array.isArray(data.flights)) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของแอป');
    const flights = data.flights.filter((f) => f && f.id && f.date && f.type);
    const aircraft = data.aircraft && !L.validateAircraft(data.aircraft) ? data.aircraft : null;
    if (!confirm(`กู้คืน ${flights.length} เที่ยวบิน${data.opening ? ' และยอดยกมา' : ''}${aircraft ? ' และรายการแบบอากาศยาน (แทนที่รายการปัจจุบัน)' : ''}?\nรายการที่มีอยู่แล้วจะถูกอัปเดต ไม่ซ้ำซ้อน`)) return;
    if (aircraft) backend.saveConfig({ v: 1, aircraft });
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
  const target = loggedOut ? 'login' : state.welcome ? 'welcome' : name;
  for (const v of ['login', 'welcome', 'add', 'list', 'summary', 'settings', 'help']) $(`#view-${v}`).hidden = pending || v !== target;
  $('#tabs').hidden = pending || loggedOut || state.welcome;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  renderCurrent();
  window.scrollTo(0, 0);
}

function renderCurrent() {
  renderHeader();
  if (state.welcome) renderWelcome();
  else if (state.view === 'add') renderRecent();
  else if (state.view === 'list') renderList();
  else if (state.view === 'summary') renderSummary();
  else if (state.view === 'settings') { renderSettings(); renderOrderInfo(); }
}

// ---------------------------------------------------------------- ธีม
const ACCENTS = [
  { id: 'olive', name: 'เขียวทหาร', h: '#34402a', acc: '#c9b98a' },
  { id: 'navy', name: 'น้ำเงินกรมท่า', h: '#1f3150', acc: '#e3b45d' },
  { id: 'teal', name: 'เขียวมรกต', h: '#134549', acc: '#e6a95a' },
  { id: 'graphite', name: 'เทาถ่าน', h: '#2a2e35', acc: '#ec7a3d' },
];
const MODES = [['auto', 'อัตโนมัติ'], ['light', 'สว่าง'], ['dark', 'มืด']];

function applyTheme(t) {
  const r = document.documentElement;
  if (t.mode === 'light' || t.mode === 'dark') r.dataset.theme = t.mode; else delete r.dataset.theme;
  if (t.accent && t.accent !== 'olive') r.dataset.accent = t.accent; else delete r.dataset.accent;
  delete r.dataset.mode;
  requestAnimationFrame(() => {
    // แปลงสีที่คำนวณแล้ว (อาจเป็น color(srgb …)) เป็น #rrggbb เพื่อให้ meta theme-color ใช้ได้ทุกเบราว์เซอร์
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = getComputedStyle($('.top')).backgroundColor;
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b] = cx.getImageData(0, 0, 1, 1).data;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  });
  $('#theme-mode').querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === (t.mode || 'auto'))));
  $('#theme-accent').querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.accent === (t.accent || 'olive'))));
}

function initTheme() {
  $('#theme-mode').innerHTML = MODES.map(([id, label]) => `<button type="button" role="radio" aria-checked="false" data-mode="${id}">${label}</button>`).join('');
  $('#theme-accent').innerHTML = ACCENTS.map((a) => `<button type="button" class="swatch" role="radio" aria-checked="false" data-accent="${a.id}"><i style="--sw-h:${a.h};--sw-acc:${a.acc}"></i>${a.name}</button>`).join('');
  const pick = (patch) => { const t = { ...LS.get('lb.theme', {}), ...patch }; LS.set('lb.theme', t); applyTheme(t); };
  $('#theme-mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick({ mode: b.dataset.mode }); });
  $('#theme-accent').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick({ accent: b.dataset.accent }); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(LS.get('lb.theme', {})));
  applyTheme(LS.get('lb.theme', {}));
}

// ---------------------------------------------------------------- เริ่มต้น
async function main() {
  const setTopH = () => document.documentElement.style.setProperty('--top-h', `${$('.top').offsetHeight}px`);
  setTopH();
  addEventListener('resize', setTopH);
  requestAnimationFrame(setTopH);
  initForm();
  initTheme();
  initAircraftEditor();
  initWelcome();

  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  document.addEventListener('click', (e) => {
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
  $('#btn-sort').addEventListener('click', sortByDate);
  $('#btn-delete-all').addEventListener('click', deleteAllMyData);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open="privacy"]')) $('#dlg-privacy').showModal();
  });
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
    onFlights(list) { state.flights = list; refreshSuggestions(); renderCurrent(); maybeWelcome(); },
    onOpening(o) { state.opening = o; renderCurrent(); maybeWelcome(); },
    onConfig(c) { applyConfig(c); maybeWelcome(); },
    onSynced() { state.synced = true; maybeWelcome(); },
    onUser(u) {
      state.user = u;
      if (!u) { state.synced = false; state.welcome = false; state.welcomeChecked = false; }
      showView(state.view);
    },
    onStatus(s) { state.status = s; renderHeader(); },
    onError(msg) { toast(msg); },
  });
  showView('add');
}

main();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
