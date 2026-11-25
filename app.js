import * as L from './logic.js';
import { createBackend, firebaseReady } from './backend.js';
import { fillWorkbook, MAX_PAGES } from './xlsxfill.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { keep: {}, flights: [], rawFlights: [], unreadableFlights: [], quarantine: [], opening: null, rawOpening: null, config: null, user: undefined, status: '', editing: null, view: 'add', synced: false, welcome: false, wstep: 0, welcomeChecked: false, recheckWelcome: false };
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

// crypto.randomUUID ใช้ไม่ได้ใน iOS < 15.4 → สร้างเองจาก getRandomValues
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

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
function activeAircraftNames() { return L.getAircraft().filter((a) => a.active).map((a) => a.name); }
function renderTypeChips(extra = null) {
  renderChips('#chips-type', '#f-type', activeAircraftNames(), extra);
  syncChips();
}

// Flight Duties are configured per Aircraft; Excel compatibility is checked separately.
function allowedDuties(type) {
  const i = L.AIRCRAFT.indexOf(type);
  if (i < 0) return L.DUTIES; // ไม่รู้จักแบบ → ให้เลือกได้ทุกหน้าที่
  return L.dutiesForAircraft(type);
}

function renderDutyChips(extra = null) {
  const type = $('#f-type')?.value || L.AIRCRAFT[0];
  const duties = allowedDuties(type);
  const cur = $('#f-duty')?.value;
  // extra = หน้าที่ของเที่ยวเก่าที่กำลังแก้ (เช่น SOLO) ให้ยังแสดงในชิปได้
  renderChips('#chips-duty', '#f-duty', duties, extra);
  if (cur && duties.includes(cur)) {
    $('#f-duty').value = cur;
  } else if (extra && (duties.includes(extra) || extra === cur)) {
    $('#f-duty').value = extra;
  } else if (!duties.includes($('#f-duty').value)) {
    $('#f-duty').value = duties[0];
  }
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
  renderDutyChips();
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
      <input id="c-${c.key}" type="number" inputmode="decimal" step="any" min="0" placeholder="0.0" aria-label="${c.label} (ชั่วโมง)" hidden>
    </div>`).join('');

  state.keep = { ...LS.get('lb.last', {}), date: undefined }; // วันที่เริ่มต้น = วันนี้ (ไม่ใช้วันที่ของการบันทึกครั้งก่อนข้ามวัน)
  resetForm(state.keep);

  $('#f-type').addEventListener('change', () => {
    const nums = LS.get('lb.nums', {});
    $('#f-number').value = nums[$('#f-type').value] || '';
    renderDutyChips(); // SOLO แสดงเฉพาะ H269 / EN48
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
    $('#f-hours').value = next ? String(next) : '';
    syncAutoConds();
  }));
  $('#form').addEventListener('submit', onSubmit);
  $('#btn-cancel').addEventListener('click', () => { exitEdit(); showView('list'); });
  $('#btn-delete').addEventListener('click', onDelete);
}

function resetForm(keep = {}) {
  renderTypeChips();
  $('#f-date').value = keep.date || L.todayISO();
  $('#f-type').value = activeAircraftNames().includes(keep.type) ? keep.type : (activeAircraftNames()[0] || L.AIRCRAFT[0]);
  const nums = LS.get('lb.nums', {});
  $('#f-number').value = keep.number ?? nums[$('#f-type').value] ?? '';
  renderDutyChips();
  const duties = allowedDuties($('#f-type').value);
  $('#f-duty').value = duties.includes(keep.duty) ? keep.duty : duties[0];
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
    aircraftId: (state.editing && state.flights.find((x) => x.id === state.editing)?.type === $('#f-type').value ? state.flights.find((x) => x.id === state.editing)?.aircraftId : null) || L.aircraftByName($('#f-type').value)?.id || null,
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
  const editingFlight = state.editing ? state.flights.find((x) => x.id === state.editing) : null;
  if (!f.type || (!activeAircraftNames().includes(f.type) && editingFlight?.type !== f.type)) return 'เลือกแบบอากาศยานที่เปิดใช้งานจากรายการ';
  if (!(f.hours > 0)) return 'ใส่ชั่วโมงบิน (มากกว่า 0)';
  if (f.hours > 24) return 'ชั่วโมงบินเกิน 24 ชม. ตรวจสอบอีกครั้ง';
  if (!L.isValidHourIncrement(f.hours, { max: 24 })) return 'ชั่วโมงบินต้องเพิ่มครั้งละ 0.1 ชั่วโมง เช่น 1.2 หรือ 1.5';
  const duties = allowedDuties(f.type);
  const previousFlight = state.editing ? state.flights.find((x) => x.id === state.editing) : null;
  const preservingLegacyDuty = previousFlight?.duty === f.duty;
  if (!f.duty || (!duties.includes(f.duty) && !preservingLegacyDuty)) {
    if (f.duty === 'SOLO') {
      const names = [...L.soloAircraftNames()].join(' / ') || 'Aircraft ที่กำหนด SOLO ไว้';
      return `หน้าที่ SOLO ใช้ได้เฉพาะแบบ ${names}`;
    }
    return 'เลือกหน้าที่จากรายการที่อนุญาตตามแบบอากาศยาน';
  }
  for (const c of L.CONDS) {
    if (f[c.key] > f.hours + 1e-9) return `${c.label} มากกว่าชั่วโมงบินรวมของเที่ยวนี้`;
    if (f[c.key] > 0 && !L.isValidHourIncrement(f[c.key], { max: 24 })) return `${c.label} ต้องเพิ่มครั้งละ 0.1 ชั่วโมง`;
  }
  return '';
}

function onSubmit(e) {
  e.preventDefault();
  const btn = $('#btn-save');
  if (btn.disabled) return; // กันกดซ้ำเร็ว ๆ

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

  btn.disabled = true;

  if (state.editing) {
    const old = state.flights.find((x) => x.id === state.editing);
    f.id = state.editing;
    f.ord = old && old.date === f.date ? old.ord : placeOrd(f.date, f.id);
  } else {
    f.id = uuid();
    f.ord = placeOrd(f.date, null);
  }

  // optimistic: อัปเดต UI ทันที แล้วค่อยซิงค์ backend (snapshot จะทับค่าเดิมเมื่อมาถึง)
  applyFlightLocal(f);
  pendingSyncToast = true;
  backend.saveFlight(f);

  if (!state.editing) { // จำค่าไว้เติมเที่ยวถัดไป (การแก้ไขเที่ยวเก่าไม่เปลี่ยนค่าที่จำไว้)
    const nums = LS.get('lb.nums', {});
    nums[f.type] = f.number;
    LS.set('lb.nums', nums);
    state.keep = { date: f.date, type: f.type, number: f.number, duty: f.duty, mission: f.mission, dep: f.dest };
    LS.set('lb.last', { ...state.keep, date: undefined });
  }

  const syncHint = state.status === 'local' ? '' : (state.status === 'synced' ? '' : ' · กำลังซิงค์');
  if (state.editing) {
    exitEdit();
    toast(`แก้ไขเที่ยวบินแล้ว${syncHint}`, 5000);
    showView('list');
  } else {
    toast(`บันทึกแล้ว · ${L.fmt(f.hours)} ชม.${syncHint}`, 5000);
    resetForm(state.keep);
    flashSaved();
    window.scrollTo({ top: 0, behavior: 'smooth' }); // ให้เห็นฟอร์มที่ล้างแล้วและตัวนับชั่วโมงที่เพิ่มขึ้น
  }

  setTimeout(() => { btn.disabled = false; }, 1000);
}

function applyFlightLocal(f) {
  const i = state.flights.findIndex((x) => x.id === f.id);
  state.flights = i >= 0
    ? state.flights.map((x, j) => (j === i ? { ...f } : x))
    : [...state.flights, { ...f }];
  refreshSuggestions();
  renderCurrent();
}

let pendingSyncToast = false;

// ตำแหน่ง (ord) ของเที่ยวบินที่เพิ่ม/แก้วันที่ — แทรกตามวันที่ ถ้าช่องว่างแคบเกินไปจะจัดเลขใหม่ก่อน
function placeOrd(date, excludeId) {
  let others = sortedFlights().filter((x) => x.id !== excludeId);
  if (L.slotGapTooSmall(others, date)) {
    const re = L.renumber(others);
    const changed = re.filter((f, i) => f.ord !== others[i].ord);
    if (changed.length) backend.saveMany(changed);
    others = re;
  }
  return L.slotOrd(others, date);
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
  // ตอนแก้เที่ยวเก่า ถ้า duty เดิมเป็น SOLO ให้ยังเห็นชิป (จะถูก validate ตอนบันทึก)
  renderDutyChips(f.duty);
  const duties = allowedDuties(f.type);
  $('#f-duty').value = duties.includes(f.duty) || f.duty === 'SOLO' ? f.duty : duties[0];
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
  resetForm(state.keep);
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
    const CAP = 150; // แสดงไม่เกิน 150 รายการต่อการค้นหา (ยอดรวมยังนับครบทุกรายการที่พบ)
    box.innerHTML = `<div class="page-head"><span>พบ ${hit.length} รายการ</span><span class="muted">รวม ${L.fmt(sum)} ชม.</span></div>`
      + (hit.length ? `<div class="rows">${hit.slice(0, CAP).map((f) => flightRow(f, noOf.get(f.id))).join('')}</div>` : '<div class="empty">ไม่พบรายการที่ตรงกับคำค้น</div>')
      + (hit.length > CAP ? `<p class="muted small center">แสดง ${CAP} รายการล่าสุดจาก ${hit.length} — พิมพ์คำค้นเพิ่มเพื่อกรอง</p>` : '');
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
  const keys = Object.keys(t.byType).filter((k) => t.byType[k] > 0);
  const nameOf = (k) => L.aircraftById(k)?.name || k;
  const kindOfKey = (k) => L.aircraftById(k)?.kind || (L.SIMS.has(k) ? 'sim' : L.MULTI.has(k) ? 'multi' : 'single');
  // P1-1: ทุก key เป็น aircraftId; P1-SIM: SIM เข้าตารางหน้าที่เฉพาะ SP
  const dutyVal = (k, d) => kindOfKey(k) === 'sim' ? (d === 'SP' ? L.num(t.byTypeDuty[`${k}|SP`]) : 0) : L.num(t.byTypeDuty[`${k}|${d}`]);
  const dutyKeys = keys.filter((k) => kindOfKey(k) !== 'sim' || dutyVal(k, 'SP') > 0);
  const duties = L.DUTIES.filter((d) => dutyKeys.some((k) => dutyVal(k, d) > 0));
  if (!duties.length) duties.push('CP/PI');
  const cell = (v) => (v ? L.fmt(v) : '–');

  const rows = dutyKeys.map((k) => `<tr><td>${esc(nameOf(k))}</td>${duties.map((d) => `<td>${cell(dutyVal(k, d))}</td>`).join('')}<td><b>${L.fmt(t.byType[k])}</b></td></tr>`).join('');
  const dutyTotals = duties.map((d) => dutyKeys.reduce((a, k) => a + dutyVal(k, d), 0));
  const simDutyHours = keys.filter((k) => kindOfKey(k) === 'sim').reduce((a, k) => a + L.num(t.byType[k]), 0);
  const simRealHours = keys.filter((k) => kindOfKey(k) === 'sim').reduce((a, k) => a + dutyVal(k, 'SP'), 0);

  const today = L.todayISO();
  const since = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return L.sumFlights(state.flights.filter((f) => f.date > iso && f.date <= today)).hours;
  };
  const stat = (label, v) => `<div class="stat"><b>${L.fmt(v)}</b><span>${label}</span></div>`;

  const maxH = Math.max(1, ...keys.map((k) => t.byType[k]));
  const bars = keys.map((k) => `<div class="bar-row" data-type="${esc(nameOf(k))}" style="--t:${typeColor(nameOf(k))}"><span>${esc(nameOf(k))}</span><div class="bar"><i style="width:${((t.byType[k] / maxH) * 100).toFixed(1)}%"></i></div><b>${L.fmt(t.byType[k])}</b></div>`).join('');

  $('#summary').innerHTML = `
    <section class="card"><h2>สัดส่วนตามแบบอากาศยาน</h2>${bars || '<p class="muted">ยังไม่มีข้อมูล</p>'}</section>
    <section class="card"><h2>ชั่วโมงบินตามแบบ × หน้าที่</h2>
      <div class="scroll"><table>
        <thead><tr><th>แบบ</th>${duties.map((d) => `<th>${d}</th>`).join('')}<th>รวม</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${duties.length + 2}" class="muted">ยังไม่มีข้อมูล</td></tr>`}</tbody>
        <tfoot><tr><td>รวม</td>${dutyTotals.map((v) => `<td><b>${v ? L.fmt(v) : '–'}</b></td>`).join('')}<td><b>${L.fmt(t.hours)}</b></td></tr></tfoot>
      </table></div>${simDutyHours ? `<p class="muted small" style="margin:8px 0 0">หมายเหตุ: ชั่วโมง SIM ทั้งหมด ${L.fmt(simDutyHours)} ชม. แยกแสดงในช่อง Simulator — มีเฉพาะหน้าที่ SP ${L.fmt(simRealHours)} ชม. ที่นับเป็นชั่วโมงบินจริง/ยอดรวม/Excel</p>` : ''}</section>
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
  const issueCounts = { precision: 0, legacy: 0, unknown: 0, other: 0 };
  for (const f of state.flights) for (const issue of f._dataIssues || []) {
    if (issue.code === 'INVALID_HOUR_PRECISION') issueCounts.precision++;
    else if (issue.code === 'LEGACY_DUTY' || issue.code === 'UNCONFIGURED_DUTY') issueCounts.legacy++;
    else if (issue.code === 'UNKNOWN_AIRCRAFT') issueCounts.unknown++;
    else issueCounts.other++;
  }
  for (const issue of state.opening?._dataIssues || []) {
    if (issue.code === 'INVALID_HOUR_PRECISION') issueCounts.precision++;
    else issueCounts.other++;
  }
  issueCounts.other += state.unreadableFlights.length;
  const totalIssues = Object.values(issueCounts).reduce((a, b) => a + b, 0);
  $('#data-quality-info').textContent = totalIssues
    ? `พบรายการที่ต้องตรวจสอบ ${totalIssues} จุด · ชั่วโมงทศนิยมไม่ถูกต้อง ${issueCounts.precision} · Legacy/Unconfigured Duty ${issueCounts.legacy} · ไม่พบ Aircraft ${issueCounts.unknown} · รายการอ่านไม่ได้/อื่น ๆ ${issueCounts.other}`
    : 'ไม่พบปัญหาคุณภาพข้อมูลจากการตรวจสอบล่าสุด';
}

// ----- ยอดยกมา
const GENERAL = [['hours', 'ชั่วโมงบินจริง'], ['single', 'Single engine'], ['multi', 'Multi engine'], ...L.CONDS.map((c) => [c.key, c.label])];

function openOpeningDialog() {
  const o = state.opening || L.emptyTotals();
  const val = (v) => (v ? v : '');
  $('#opening-fields').innerHTML = `
    <div class="sect">ชั่วโมงสะสมตามแบบ × หน้าที่</div>
    <div class="scroll"><table><thead><tr><th>แบบ</th>${L.DUTIES.map((d) => `<th>${d}</th>`).join('')}</tr></thead>
    <tbody>${L.AIRCRAFT.map((ty) => { const a = L.aircraftByName(ty); return `<tr><td>${esc(ty)}</td>${L.DUTIES.map((d) => { const v = o.byTypeDuty?.[`${a?.id || ty}|${d}`] ?? o.byTypeDuty?.[`${ty}|${d}`] ?? o.byAircraftDuty?.[a?.id]?.[d]; return `<td><input type="number" step="0.1" min="0" inputmode="decimal" data-k="${esc(ty)}|${d}" value="${val(v)}" ${L.dutiesForAircraft(ty).includes(d) ? '' : 'disabled'}></td>`; }).join('')}</tr>`; }).join('')}</tbody></table></div>
    <div class="sect">ยอดรวมอื่น ๆ <span class="muted small">(เว้นว่างให้คำนวณอัตโนมัติ: รวม/Single/Multi)</span></div>
    <div class="grid2">${GENERAL.map(([k, label]) => `<label>${label}<input type="number" step="0.1" min="0" inputmode="decimal" data-g="${k}" value="${val(o[k])}"></label>`).join('')}</div>`;
  $('#dlg-opening').returnValue = '';
  $('#dlg-opening').showModal();
}

function saveOpeningFromDialog() {
  const inputs = [...document.querySelectorAll('#opening-fields input:not(:disabled)')];
  const invalid = inputs.find((inp) => inp.value !== '' && !L.isValidHourIncrement(L.num(inp.value), { allowZero: true }));
  if (invalid) { toast('ยอดยกมาต้องใช้ทศนิยม 1 ตำแหน่ง เช่น 12.3 ชั่วโมง', 5000); invalid.focus(); return; }
  const t = L.emptyTotals();
  let simReal = 0;
  for (const inp of document.querySelectorAll('#opening-fields [data-k]')) {
    if (inp.disabled) continue;
    const v = L.num(inp.value);
    if (!v) continue;
    const [ty, duty] = inp.dataset.k.split('|');
    const aircraft = L.aircraftByName(ty);
    const key = aircraft?.id || ty;
    t.byTypeDuty[`${key}|${duty}`] = v;
    t.byType[key] = Math.round(((t.byType[key] || 0) + v) * 10) / 10;
    if (aircraft) { t.byAircraftDuty[aircraft.id] ||= {}; t.byAircraftDuty[aircraft.id][duty] = v; }
    if (aircraft?.kind === 'sim' && duty === 'SP') simReal = Math.round((simReal + v) * 10) / 10;
  }
  for (const inp of document.querySelectorAll('#opening-fields [data-g]')) t[inp.dataset.g] = L.num(inp.value);
  const sumTypes = Math.round(Object.values(t.byType).reduce((a, b) => a + b, 0) * 10) / 10;
  t.sim = Object.entries(t.byType).reduce((sum, [k, v]) => L.aircraftById(k)?.kind === 'sim' ? Math.round((sum + v) * 10) / 10 : sum, 0);
  const simNonSp = Math.max(0, Math.round((t.sim - simReal) * 10) / 10);
  if (!t.hours) t.hours = Math.max(0, Math.round((sumTypes - simNonSp) * 10) / 10);
  t.loggedHours = Math.round((t.hours + simNonSp) * 10) / 10;
  if (!t.single && !t.multi) {
    for (const [k, h] of Object.entries(t.byType)) {
      const kind = L.aircraftById(k)?.kind;
      if (kind === 'single') t.single = Math.round((t.single + h) * 10) / 10;
      if (kind === 'multi') t.multi = Math.round((t.multi + h) * 10) / 10;
    }
  }
  backend.saveOpening(t);
  toast('บันทึกยอดยกมาแล้ว');
}

// ----- แบบอากาศยานของฉัน (Configuration v2)
let acDraft = []; // {id,name,kind,duties,active,origName}

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
        <button type="button" class="ic del" data-act="del" aria-label="ปิด/ลบแถวนี้">✕</button>
      </div>
      <div class="ac-active"><label><input type="checkbox" class="ac-active-check"${a.active !== false ? ' checked' : ''}> เปิดใช้งาน</label></div>
      <div class="ac-duty-list"><span class="ac-note">Flight Duty:</span>${L.DUTIES.map((d) => `<label><input type="checkbox" class="ac-duty" value="${d}"${a.duties.includes(d) ? ' checked' : ''}> ${d}</label>`).join('')}</div>
    </div>`).join('');
  $('#ac-add').disabled = false;
}

function syncAcDraft() {
  document.querySelectorAll('#ac-rows .ac-row').forEach((row, i) => {
    if (!acDraft[i]) return;
    acDraft[i].name = row.querySelector('.ac-name').value.trim().toUpperCase();
    acDraft[i].kind = row.querySelector('.ac-kind').value;
    acDraft[i].duties = [...row.querySelectorAll('.ac-duty:checked')].map((x) => x.value);
    acDraft[i].active = row.querySelector('.ac-active-check').checked;
  });
}

function openAircraftDialog() {
  acDraft = L.getAircraft().map((a) => ({ ...a, origName: a.name }));
  renderAcRows();
  $('#ac-error').hidden = true;
  $('#dlg-aircraft').returnValue = '';
  $('#dlg-aircraft').showModal();
}

function usedAircraftCount(name) {
  const id = L.aircraftByName(name)?.id;
  let n = state.flights.filter((f) => (f.aircraftId ? f.aircraftId === id : f.type === name)).length;
  if (state.opening && (
    (id && L.num(state.opening.byType?.[id]) > 0)
    || (id && Object.entries(state.opening.byTypeDuty || {}).some(([k, v]) => k.startsWith(`${id}|`) && L.num(v) > 0))
    || (id && Object.values(state.opening.byAircraftDuty?.[id] || {}).some((v) => L.num(v) > 0))
    || L.num(state.opening.byType?.[name]) > 0
    || Object.entries(state.opening.byTypeDuty || {}).some(([k, v]) => k.startsWith(`${name}|`) && L.num(v) > 0)
  )) n += 1;
  return n;
}

function commitAircraft(list) {
  const previous = L.getAircraft();
  const next = L.normalizeAircraft(list);
  const prevIdx = { byId: new Map(previous.map((a) => [a.id, a])), byName: new Map(previous.map((a) => [a.name, a])) };
  const nextById = new Map(next.map((a) => [a.id, a]));

  // P1-1: เปลี่ยน kind = เปลี่ยนการจัดหมวดยอดอย่างตั้งใจ → ต้องยืนยันพร้อมตัวเลขที่กระทบ
  const kindChanges = previous.filter((a) => nextById.get(a.id)?.kind && nextById.get(a.id).kind !== a.kind);
  if (kindChanges.length) {
    const affected = state.flights.filter((f) => {
      const a = f.aircraftId ? prevIdx.byId.get(f.aircraftId) : prevIdx.byName.get(f.type);
      return a && kindChanges.some((k) => k.id === a.id);
    });
    const hours = L.sumFlights(affected).loggedHours;
    if (affected.length && hours > 0 && !confirm(`เปลี่ยนชนิดเครื่องยนต์ของ ${kindChanges.map((a) => `${a.name}→${nextById.get(a.id).kind}`).join(', ')}\n\nflight ที่กระทบ ${affected.length} รายการ / ${L.fmt(hours)} ชม. จะถูกจัดหมวดใหม่ (Single/Multi/SIM)\nยอดรวมชั่วโมงบินจริงไม่เปลี่ยน เฉพาะหมวดและคอลัมน์ Excel ที่เปลี่ยน\n\nดำเนินการต่อไหม?`)) return;
  }

  const changed = [];
  for (const f of state.flights) {
    const old = f.aircraftId ? prevIdx.byId.get(f.aircraftId) : prevIdx.byName.get(f.type);
    const target = f.aircraftId ? nextById.get(f.aircraftId) : next.find((a) => a.name === f.type);
    if (target && (f.type !== target.name || f.aircraftId !== target.id)) changed.push({ ...f, aircraftId: target.id, type: target.name });
  }
  if (changed.length) backend.saveMany(changed);

  if (state.opening) {
    // P1-2: ใช้ id เป็นแกน; rename ไม่เปลี่ยน key จึงไม่มียอดตกช่อง
    const o = L.resolveOpening(state.opening, previous);
    const byType = {};
    const byTypeDuty = {};
    for (const [ref, value] of Object.entries(o.byType || {})) {
      const a = prevIdx.byId.get(ref) || prevIdx.byName.get(ref);
      const k = a?.id || ref;
      byType[k] = (byType[k] || 0) + value;
    }
    for (const [key, value] of Object.entries(o.byTypeDuty || {})) {
      const split = key.lastIndexOf('|');
      const ref = key.slice(0, split);
      const duty = key.slice(split + 1);
      const a = prevIdx.byId.get(ref) || prevIdx.byName.get(ref);
      const nk = `${a?.id || ref}|${duty}`;
      byTypeDuty[nk] = (byTypeDuty[nk] || 0) + value;
    }
    backend.saveOpening(L.sanitizeOpening({ ...o, byType, byTypeDuty, byAircraftDuty: { ...(o.byAircraftDuty || {}) } }, next));
  }
  L.setAircraft(next);
  backend.saveConfig({ version: 2, v: 2, aircraft: next });
  toast('บันทึกรายการ Aircraft และ Flight Duties แล้ว');
  renderTypeChips();
  renderCurrent();
}

function initAircraftEditor() {
  $('#btn-aircraft').addEventListener('click', openAircraftDialog);
  $('#ac-add').addEventListener('click', () => {
    syncAcDraft();
    acDraft.push({ id: uuid(), name: '', kind: 'single', duties: ['CP/PI', 'PC'], active: true, origName: null });
    renderAcRows();
    document.querySelectorAll('#ac-rows .ac-name')[acDraft.length - 1]?.focus();
  });
  $('#ac-default').addEventListener('click', () => {
    const cur = new Map(L.getAircraft().map((a) => [a.name, a]));
    acDraft = L.DEFAULT_AIRCRAFT.map((a) => ({ ...a, id: cur.get(a.name)?.id || a.id, origName: cur.has(a.name) ? a.name : null }));
    renderAcRows();
  });
  $('#ac-clear').addEventListener('click', () => {
    syncAcDraft();
    acDraft = [{ id: uuid(), name: '', kind: 'single', duties: ['CP/PI', 'PC'], active: true, origName: null }];
    renderAcRows();
  });
  $('#ac-rows').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    syncAcDraft();
    const i = Number(b.closest('.ac-row').dataset.i);
    if (b.dataset.act === 'del') {
      const a = acDraft[i];
      if (a.origName && usedAircraftCount(a.origName)) { a.active = false; /* retain row and history */ toast(`${a.origName} มีประวัติ จึงปิดใช้งานแทนการลบ`); }
      else acDraft.splice(i, 1);
    } else if (b.dataset.act === 'up' && i > 0) [acDraft[i - 1], acDraft[i]] = [acDraft[i], acDraft[i - 1]];
    else if (b.dataset.act === 'down' && i < acDraft.length - 1) [acDraft[i + 1], acDraft[i]] = [acDraft[i], acDraft[i + 1]];
    renderAcRows();
  });
  $('#form-aircraft').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value !== 'save') return;
    syncAcDraft();
    const list = acDraft.map((a, i) => ({ id: a.id || uuid(), name: a.name, kind: a.kind, duties: a.duties, active: a.active !== false, sortOrder: i + 1 }));
    let err = L.validateAircraft(list);
    if (!err) {
      const keptIds = new Set(list.map((a) => a.id));
      for (const old of L.getAircraft()) {
        if (!keptIds.has(old.id) && usedAircraftCount(old.name)) { err = `แบบ ${old.name} ยังมีข้อมูลอยู่ จึงลบถาวรไม่ได้ ให้ปิดใช้งานแทน`; break; }
      }
    }
    if (err) { e.preventDefault(); $('#ac-error').textContent = err; $('#ac-error').hidden = false; return; }
    commitAircraft(list);
  });
}

function applyConfig(cfg) {
  state.config = cfg;
  const raw = cfg?.aircraft;
  const normalized = Array.isArray(raw) ? L.normalizeAircraft(raw) : L.DEFAULT_AIRCRAFT;
  const list = L.validateAircraft(normalized) ? L.DEFAULT_AIRCRAFT : normalized;
  L.setAircraft(list);
  // config อาจมาหลัง opening/flights → sanitize ใหม่ด้วย config ที่ถูกต้องเสมอ
  state.flights = state.flights.map((f) => L.sanitizeFlight(f, list)).filter(Boolean); // attach stable IDs after config snapshot arrives; no write until migration is confirmed
  state.opening = state.rawOpening ? L.resolveOpening(state.rawOpening, list) : null;
  const editing = state.editing ? state.flights.find((x) => x.id === state.editing) : null;
  renderTypeChips(editing?.type || null);
  renderCurrent();
}

// ----- ตรวจสอบและ Migration Data Model v1 -> v2 (Prepare / Preview / Backup / Commit)
async function migrateDataModelV2() {
  if (firebaseReady && state.status !== 'synced') {
    toast('ยังไม่ย้ายข้อมูล: กรุณารอให้ Firebase ซิงค์เสร็จและมีสถานะ “ซิงค์แล้ว” ก่อน', 5500);
    return;
  }
  const preview = L.prepareMigrationV2({ aircraft: L.getAircraft(), flights: state.rawFlights, opening: state.rawOpening });
  const q = preview.dataQuality;
  const lines = [
    `Aircraft: ${preview.config.aircraft.length} แบบ`,
    `Flight Records ที่จะย้าย: ${preview.flights.filter((x) => x.migrated).length} รายการ`,
    `Flight ที่อ่านไม่ได้ (เก็บใน Quarantine): ${q.invalidFlights} รายการ`,
    `ชั่วโมงบินที่ต้องตรวจสอบ: ${q.invalidHourFlights} รายการ`,
    `Legacy/Unconfigured Duty: ${q.legacyDutyFlights} รายการ`,
    `Aircraft ที่ไม่พบใน Config: ${q.unknownAircraftFlights} รายการ`,
    `Opening Balance ที่ยังเชื่อม Aircraft ไม่ได้: ${q.unresolvedOpeningEntries} รายการ`,
    `Opening Balance ที่มีปัญหาความละเอียดชั่วโมง/ขัดกัน: ${q.openingIssues} รายการ`,
    `Flight ที่จะเติมลำดับ ord ตามวันที่: ${q.ordBackfilled} รายการ`,
  ];
  if (!confirm(`Migration Preview — Data Model v2\n\n${lines.join('\n')}\n\nระบบจะไม่ปัดเศษชั่วโมงและไม่เปลี่ยน Legacy Duty\nflight ที่อ่านไม่ได้จะถูกเก็บต้นฉบับไว้ใน Quarantine และในไฟล์สำรอง แต่จะไม่นำมารวมยอด\nยอดยกมาจะใช้ aircraftId เป็นแกน; ค่าที่ขัดกันจะโชว์ใน Data Quality ไม่ใช่เลือกข้างเงียบ ๆ\nSIM นอกหน้าที่ SP จะไม่นับเป็นชั่วโมงบินจริง แต่ยังแยกแสดงในยอด Simulator\n\nต้องการดำเนินการต่อเพื่อสร้างไฟล์สำรองหรือไม่?`)) return;

  const backup = {
    app: 'pilot-logbook', version: 1, exportedAt: new Date().toISOString(),
    config: state.config, aircraft: L.getAircraft(), opening: state.rawOpening,
    flights: L.sortFlights(state.rawFlights), quarantine: preview.quarantine,
  };
  download(`pilot-logbook-pre-v2-backup-${L.todayISO()}.json`, new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  if (!confirm('ได้สั่งดาวน์โหลดไฟล์สำรองก่อน Migration แล้วหรือไม่?\n\nกดตกลงเพื่อ Commit ข้อมูล v2 หรือยกเลิกเพื่อหยุดโดยไม่เปลี่ยนข้อมูล')) return;

  try {
    const validFlights = preview.flights.filter((x) => x.migrated).map((x) => x.migrated);
    if (validFlights.length) await backend.saveMany(validFlights);
    if (preview.quarantine.length) await backend.saveQuarantine(preview.quarantine);
    if (preview.opening) await backend.saveOpening(preview.opening);
    await backend.saveConfig(preview.config); // config v2 is the commit marker; retrying earlier phases is idempotent
    const reviewCount = q.invalidFlights + q.invalidHourFlights + q.legacyDutyFlights + q.unknownAircraftFlights + q.unresolvedOpeningEntries + q.openingIssues;
    toast(`Migration v2 เสร็จแล้ว · ${validFlights.length} เที่ยวบิน · กักกัน ${preview.quarantine.length} รายการ · ตรวจสอบ Data Quality ${reviewCount} รายการ`, 6500);
  } catch (e) {
    toast(`Migration ยังยืนยันผลไม่ได้: ${e.message || e} — เก็บไฟล์สำรองไว้ก่อนตรวจสอบ`, 7000);
  }
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
      <p class="lead">เลือกแบบอากาศยานที่คุณบิน แก้ไขและกำหนดหน้าที่ได้ภายหลัง</p>
      <div class="chips-static">${L.AIRCRAFT.map((n) => `<span class="pill" style="--t:${typeColor(n)}"><i></i>${esc(n)} <small>${L.KIND_SHORT[L.kindOf(n)]}</small></span>`).join('')}</div>
      <p class="muted small">รายการเริ่มต้นเป็นชุดจากสมุดต้นแบบ ถ้าคุณบินแบบอื่น กด “แก้ไขรายการ” เพื่อเพิ่ม Aircraft เปลี่ยนชื่อ/ชนิดเครื่องยนต์ และเลือก Flight Duties ลำดับมีผลกับช่องใน Excel Template รุ่นเดิม</p>
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
function clearLocalPrefs() {
  try { localStorage.removeItem('lb.last'); localStorage.removeItem('lb.nums'); } catch { /* ข้าม */ }
  state.keep = {};
}

async function deleteAllMyData() {
  if (!confirm('ลบข้อมูลทั้งหมดของคุณถาวร (เที่ยวบิน ยอดยกมา รายการแบบอากาศยาน และข้อมูลที่กักกันไว้) กู้คืนไม่ได้\n\nแนะนำให้ส่งออก Excel หรือสำรอง JSON ไว้ก่อน\n\nดำเนินการต่อไหม?')) return;
  const word = prompt('พิมพ์คำว่า ลบ เพื่อยืนยัน');
  if ((word || '').trim() !== 'ลบ') { toast('ยกเลิกการลบ'); return; }
  const btn = $('#btn-delete-all');
  btn.disabled = true;
  try {
    // P0-5: ใช้ rawFlights (รวม record ที่อ่านไม่ได้) และรอจนลบจริงจึงแจ้งสำเร็จ
    await backend.deleteAll(state.rawFlights.map((f) => f.id));
    state.rawFlights = []; state.flights = []; state.unreadableFlights = []; state.quarantine = [];
    state.opening = null; state.rawOpening = null;
    state.recheckWelcome = true;
    clearLocalPrefs();
    resetForm(state.keep);
    renderCurrent();
    renderHeader();
    toast('ลบข้อมูลทั้งหมดแล้ว');
  } catch (e) {
    toast(`ลบไม่สำเร็จทั้งหมด: ${e.message || e}`, 6500);
  } finally {
    btn.disabled = false;
  }
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

    const incomingRaw = [];
    let parsedOpening = null;
    let opening = null;
    let ord = 0;
    let unreadable = 0;
    let invalidPrecision = 0;
    let legacyDuties = 0;
    const ordBase = state.flights.length ? Math.max(...state.flights.map((f) => L.num(f.ord))) + 1 : 0; // ต่อท้ายข้อมูลเดิม ไม่แทรกกลาง
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
          // เก็บต้นฉบับไว้ก่อน แล้วค่อย sanitize ด้วยรายการ aircraft ที่จะใช้จริง (อาจต่างจาก config ปัจจุบัน)
          if (o && (o.hours > 0 || Object.keys(o.byType || {}).length || Object.keys(o.byTypeDuty || {}).length)) parsedOpening = o;
        }
      }
      for (let i = 3; i < rows.length; i++) {
        const raw = L.rowToFlight(rows[i]);
        if (raw) {
          raw.id = uuid();
          raw.ord = ordBase + ord++;
          // Preserve source values; sanitize หลังรู้รายการ aircraft ของไฟล์ เพื่อไม่ให้ id เก่าสวม identity
          incomingRaw.push(raw);
        } else if (L.isUnreadableDataRow(rows[i], i)) unreadable++;
      }
    });

    // แบบอากาศยานในไฟล์ เทียบกับรายการของคุณ
    let newList = null;
    const noData = !state.flights.length && !state.opening?.hours;
    const label = (l) => l.map((a) => a.name).join(', ');
    if (noData && fileList.length && !L.sameAircraft(fileList, L.getAircraft())
      && confirm(`ไฟล์นี้ใช้แบบอากาศยาน: ${label(fileList)}\n\nตั้งเป็นรายการแบบอากาศยานของคุณไหม?\n(ถ้ากดยกเลิก จะใช้รายการปัจจุบัน: ${label(L.getAircraft())})`)) newList = fileList;
    const nameErr = (list) => list.map((a) => a.name).find((n) => !L.NAME_RE.test(n));
    if (newList && nameErr(newList)) { alert(`ชื่อแบบอากาศยานในไฟล์ “${nameErr(newList)}” ใช้ไม่ได้ (ใช้ได้เฉพาะ A–Z ตัวเลข และ - . / เว้นวรรค ไม่เกิน 12 ตัว) กรุณาแก้ชื่อในไฟล์แล้วนำเข้าใหม่`); return; }
    const base = L.normalizeAircraft(newList ?? L.getAircraft());
    const baseIdx = {
      byId: new Map(base.map((a) => [a.id, a])),
      byName: new Map(base.map((a) => [a.name, a])),
    };
    // key ในข้อมูล v2 เป็น aircraftId → แปลงเป็นชื่อก่อนเทียบกับรายการ aircraft
    const nameOfRef = (ref) => (baseIdx.byId.get(String(ref)) || baseIdx.byName.get(String(ref).trim().toUpperCase()))?.name || String(ref).trim().toUpperCase();
    const usedTypes = new Set(incomingRaw.map((f) => nameOfRef(f.type)));
    if (parsedOpening) {
      Object.keys(parsedOpening.byType).forEach((k) => usedTypes.add(nameOfRef(k)));
      Object.keys(parsedOpening.byTypeDuty).forEach((k) => usedTypes.add(nameOfRef(k.slice(0, k.lastIndexOf('|')))));
    }
    const unknown = [...usedTypes].filter((t) => !base.some((a) => a.name === t));
    if (unknown.length) {
      if (!confirm(`ไฟล์มีแบบอากาศยานที่ยังไม่มีในรายการ: ${unknown.join(', ')}\n\nเพิ่มเข้ารายการให้ไหม? (ตั้งชนิดเครื่องยนต์ให้เดาเอง ปรับได้ที่ ตั้งค่า → แบบอากาศยานของฉัน)`)) return;
      newList = [...base, ...unknown.map((name) => ({ id: uuid(), name, kind: L.guessKind(name), duties: [...L.DUTIES], active: true }))];
      if (nameErr(newList) || L.validateAircraft(newList)) { alert(`ชื่อแบบอากาศยานในไฟล์ใช้ไม่ได้: ${[...unknown, ...newList.map((x) => x.name)].filter((n, i, arr) => !L.NAME_RE.test(n) && arr.indexOf(n) === i).join(', ') || unknown.join(', ')}\n\nใช้ได้เฉพาะ A–Z ตัวเลข และ - . / เว้นวรรค ไม่เกิน 12 ตัว กรุณาแก้ชื่อในไฟล์แล้วนำเข้าใหม่`); return; }
    }
    if (newList && L.validateAircraft(L.normalizeAircraft(newList))) { alert(L.validateAircraft(L.normalizeAircraft(newList))); return; }

    const importConfig = L.normalizeAircraft(newList ?? L.getAircraft());
    // rowToFlight เติม aircraftId จาก config ปัจจุบัน → ล้างก่อน เพื่อให้ name ของไฟล์เป็นตัวเลือก aircraft
    const incoming = incomingRaw.map((raw) => L.sanitizeFlight({ ...raw, aircraftId: null }, importConfig)).filter((f) => { if (!f) unreadable++; return !!f; });
    for (const f of incoming) {
      const a = importConfig.find((item) => item.id === f.aircraftId) || importConfig.find((item) => item.name === f.type);
      if (f._dataIssues?.some((x) => x.code === 'INVALID_HOUR_PRECISION')) invalidPrecision++;
      if (f._dataIssues?.some((x) => x.code === 'LEGACY_DUTY' || x.code === 'UNCONFIGURED_DUTY')) legacyDuties++;
      if (a) {
        f.aircraftId = a.id;
        f._dataIssues = (f._dataIssues || []).filter((x) => x.code !== 'UNKNOWN_AIRCRAFT' && !(x.code === 'UNCONFIGURED_DUTY' && a.duties.includes(f.duty)));
        if (!a.duties.includes(f.duty) && !f._dataIssues.some((x) => x.code === 'UNCONFIGURED_DUTY')) f._dataIssues.push({ code: 'UNCONFIGURED_DUTY', field: 'duty', value: f.duty });
      }
    }
    if (parsedOpening) {
      const o = L.sanitizeOpening(parsedOpening, importConfig);
      if (o && (o.hours > 0 || o._dataIssues?.length || Object.keys(o.byType || {}).length || Object.keys(o.byTypeDuty || {}).length)) opening = o;
    }

    const fresh = L.filterNew(state.flights, incoming);
    const skipped = incoming.length - fresh.length;
    const lines = [`พบ ${incoming.length} เที่ยวบินในไฟล์`, `จะเพิ่มใหม่ ${fresh.length} รายการ${skipped ? ` (ข้ามที่ซ้ำ ${skipped})` : ''}`];
    if (unreadable) lines.push(`⚠ ข้ามแถวที่อ่านไม่ได้ ${unreadable} แถว (วันที่ไม่ใช่รูปแบบวันที่ หรือไม่มีแบบอากาศยาน/ชั่วโมงบิน) ตรวจในไฟล์ก่อน`);
    if (invalidPrecision) lines.push(`⚠ พบชั่วโมงบินที่ไม่ใช่ขั้นละ 0.1 จำนวน ${invalidPrecision} รายการ — เก็บค่าต้นฉบับไว้ แต่ไม่นำไปรวมยอดจนกว่าจะแก้ไข`);
    if (opening?._dataIssues?.length) lines.push(`⚠ ยอดยกมามีค่าที่ต้องตรวจสอบ ${opening._dataIssues.length} รายการ — เก็บรายละเอียดไว้ใน Data Quality`);
    if (legacyDuties) lines.push(`⚠ พบ Legacy/Unconfigured Duty ${legacyDuties} รายการ — เก็บค่าเดิมไว้และแสดงใน Data Quality`);
    if (opening) lines.push(`ยอดยกมาในไฟล์: ${L.fmt(opening.hours)} ชม.`);
    if (!fresh.length && !opening) { toast('ไม่มีข้อมูลใหม่ให้นำเข้า'); return; }
    if (!confirm(`${lines.join('\n')}\n\nนำเข้าเลยไหม?`)) return;

    if (newList) backend.saveConfig({ version: 2, v: 2, aircraft: L.normalizeAircraft(newList) });
    if (fresh.length) backend.saveMany(fresh);
    if (opening && (opening.hours > 0 || opening._dataIssues?.length || Object.keys(opening.byType || {}).length || Object.keys(opening.byTypeDuty || {}).length) && (!state.opening?.hours || confirm(`มียอดยกมาอยู่แล้ว (${L.fmt(state.opening.hours)} ชม.)\nแทนที่ด้วยยอดจากไฟล์ (${L.fmt(opening.hours)} ชม.) ไหม?`))) {
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
  const invalidHours = sorted.filter((f) => f._dataIssues?.some((x) => x.code === 'INVALID_HOUR_PRECISION')).length + (state.opening?._dataIssues || []).filter((x) => x.code === 'INVALID_HOUR_PRECISION').length;
  if (invalidHours) { toast(`ยังส่งออกไม่ได้: พบชั่วโมงที่ไม่ใช่ 0.1 จำนวน ${invalidHours} รายการ กรุณาตรวจสอบ/แก้ไขก่อน เพื่อไม่ให้ Excel มีค่าผิดข้อกำหนด`, 6500); return; }
  if (pages.length > MAX_PAGES) { toast(`ข้อมูลเกิน ${MAX_PAGES * L.PAGE_SIZE} รายการ (แม่แบบมี ${MAX_PAGES} ชีต)`); return; }
  const btn = $('#btn-export-xlsx');
  btn.disabled = true;
  try {
    const [JSZip, res] = await Promise.all([loadJSZip(), fetch('template.xlsx')]);
    if (!res.ok) throw new Error('ไม่พบไฟล์ template.xlsx ในเว็บ');
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const text = new Map();
    await fillWorkbook({
      getText: async (p) => {
        if (text.has(p)) return text.get(p);
        const file = zip.file(p);
        if (!file) throw new Error(`Not found: ${p}`);
        return file.async('string');
      },
      setText: (p, t) => { text.set(p, t); zip.file(p, t); },
    }, pages, state.opening, L.getAircraft(), sorted);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    download(`Pilot_Logbook_${L.todayISO()}.xlsx`, blob);
    toast('ส่งออกแล้ว — ชีต Aircraft Summary รองรับ Aircraft/Duty ตามการตั้งค่าปัจจุบัน; Summary เดิมยังคงรูปแบบแม่แบบ 8 ช่อง');
  } catch (e) {
    toast(e.message || 'ส่งออกไม่สำเร็จ');
  } finally {
    btn.disabled = false;
  }
}

async function downloadTemplate() {
  const btn = $('#btn-download-template');
  btn.disabled = true;
  try {
    const res = await fetch('template.xlsx');
    if (!res.ok) throw new Error('ไม่พบไฟล์ template.xlsx ในเว็บ');
    download(`Pilot_Logbook_Template.xlsx`, await res.blob());
    toast('ดาวน์โหลดแม่แบบแล้ว');
  } catch (e) {
    toast(e.message || 'ดาวน์โหลดแม่แบบไม่สำเร็จ');
  } finally {
    btn.disabled = false;
  }
}

function exportJson() {
  const data = { app: 'pilot-logbook', version: 2, exportedAt: new Date().toISOString(), opening: state.rawOpening, aircraft: L.getAircraft(), flights: L.sortFlights(state.rawFlights), quarantine: state.quarantine };
  download(`pilot-logbook-backup-${L.todayISO()}.json`, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
}

async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'pilot-logbook' || !Array.isArray(data.flights)) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของแอป');
    const aircraft = Array.isArray(data.aircraft) ? L.normalizeAircraft(data.aircraft) : null;
    const activeConfig = aircraft || L.getAircraft();
    const ids = new Map(activeConfig.map((a) => [a.name, a.id]));
    const flights = data.flights.map((source) => {
      const f = L.sanitizeFlight(source, activeConfig);
      if (f) {
        const a = f.aircraftId ? activeConfig.find((item) => item.id === f.aircraftId) : activeConfig.find((item) => item.name === f.type);
        if (a) {
          f.aircraftId = a.id;
          f._dataIssues = (f._dataIssues || []).filter((x) => x.code !== 'UNKNOWN_AIRCRAFT' && !(x.code === 'UNCONFIGURED_DUTY' && a.duties.includes(f.duty)));
          if (!a.duties.includes(f.duty) && !f._dataIssues.some((x) => x.code === 'UNCONFIGURED_DUTY')) f._dataIssues.push({ code: 'UNCONFIGURED_DUTY', field: 'duty', value: f.duty });
        } else if (!f.aircraftId) f.aircraftId = ids.get(f.type) || null;
      }
      return f;
    }).filter(Boolean);
    const opening = L.sanitizeOpening(data.opening, activeConfig);
    const quarantine = Array.isArray(data.quarantine) ? data.quarantine : [];
    if (aircraft && L.validateAircraft(aircraft)) throw new Error(L.validateAircraft(aircraft));
    if (data.flights.length !== flights.length) toast(`ข้ามรายการที่ข้อมูลไม่ครบ ${data.flights.length - flights.length} รายการ`, 5000);
    if (!confirm(`กู้คืน ${flights.length} เที่ยวบิน${opening ? ' และยอดยกมา' : ''}${aircraft ? ' และรายการแบบอากาศยาน (แทนที่รายการปัจจุบัน)' : ''}${quarantine.length ? ` และข้อมูลที่กักกันไว้ ${quarantine.length} รายการ` : ''}?\nข้อมูล Legacy Duty และค่าชั่วโมงที่ผิดความละเอียดจะถูกเก็บไว้พร้อมสถานะตรวจสอบ`)) return;
    if (aircraft) { L.setAircraft(aircraft); await backend.saveConfig({ version: 2, v: 2, aircraft }); }
    await backend.saveMany(flights);
    if (quarantine.length) await backend.saveQuarantine(quarantine);
    if (opening) await backend.saveOpening(opening);
    toast(`กู้คืนข้อมูลแล้ว (${flights.length} เที่ยวบิน${quarantine.length ? ` · กักกัน ${quarantine.length} รายการ` : ''})`);
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
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => applyTheme(LS.get('lb.theme', {}));
  if (mq.addEventListener) mq.addEventListener('change', onScheme); else mq.addListener?.(onScheme); // Safari < 14
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
  $('#btn-migrate-v2').addEventListener('click', migrateDataModelV2);
  initWelcome();

  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.flight');
    if (b) startEdit(b.dataset.id);
  });
  let searchTimer = 0; // หน่วงการค้นหาเล็กน้อย กันกระตุกบนมือถือเมื่อมีข้อมูลหลายร้อยรายการ
  $('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderList, 160); });
  $('#btn-login').addEventListener('click', () => backend.signIn());
  $('#btn-logout').addEventListener('click', () => backend.signOut());
  $('#btn-opening').addEventListener('click', openOpeningDialog);
  $('#dlg-opening').addEventListener('close', () => { if ($('#dlg-opening').returnValue === 'save') saveOpeningFromDialog(); });
  $('#btn-export-xlsx').addEventListener('click', exportXlsx);
  $('#btn-download-template').addEventListener('click', downloadTemplate);
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
    onFlights(list) { state.rawFlights = list; const cleaned = list.map(L.sanitizeFlight); state.unreadableFlights = list.filter((item, i) => !cleaned[i]); state.flights = cleaned.filter(Boolean); refreshSuggestions(); renderCurrent(); maybeWelcome(); },
    onQuarantine(list) { state.quarantine = list || []; },
    onOpening(o) { state.rawOpening = o; state.opening = o ? L.resolveOpening(o, L.getAircraft()) : null; renderCurrent(); maybeWelcome(); },
    onConfig(c) { applyConfig(c); maybeWelcome(); },
    onSynced() { state.synced = true; maybeWelcome(); },
    onUser(u) {
      const id = u ? (u.email || 'local') : null;
      if (!id || (state.uid && state.uid !== id)) { clearLocalPrefs(); resetForm(state.keep); } // ไม่ให้ข้อมูลของผู้ใช้คนก่อนค้างในฟอร์ม
      state.uid = id || null;
      state.user = u;
      if (!u) { state.synced = false; state.welcome = false; state.welcomeChecked = false; state.quarantine = []; }
      showView(state.view);
    },
    onStatus(s) {
      const prev = state.status;
      state.status = s;
      renderHeader();
      // ยืนยันซิงค์หลังบันทึก (pending/offline → synced)
      if (pendingSyncToast && s === 'synced' && prev !== 'synced') {
        pendingSyncToast = false;
        toast('ซิงค์ขึ้นเซิร์ฟเวอร์แล้ว', 2500);
      }
      if (s === 'local') pendingSyncToast = false;
    },
    onError(msg) { pendingSyncToast = false; toast(msg); },
  });
  showView('add');
}

main();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
