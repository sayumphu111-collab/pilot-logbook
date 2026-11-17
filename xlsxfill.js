// xlsxfill.js — กรอกข้อมูลลงไฟล์แม่แบบ (template.xlsx = ไฟล์ต้นฉบับที่ล้างข้อมูลแล้ว)
// แก้เฉพาะค่าในช่องข้อมูล สูตร/สี/เส้น/dropdown ของต้นฉบับอยู่ครบ ไม่ใช้ DOM จึงทดสอบด้วย Node ได้
import { AIRCRAFT, CONDS, PAGE_SIZE, num } from './logic.js';

export const MAX_PAGES = 50;
const FIRST_ROW = 4;

// ---------- ตัวช่วยคอลัมน์ ----------
export function colNum(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}
export function colLetters(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function isoToSerial(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
}

// ---------- สร้าง XML ของเซลล์ ----------
const numXml = (ref, s, v) => `<c r="${ref}"${s}><v>${Math.round(v * 1e6) / 1e6}</v></c>`;
const strXml = (ref, s, v) => `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
const cellXml = (ref, s, v) => (typeof v === 'number' ? numXml(ref, s, v) : strXml(ref, s, v));

// ---------- ใส่ค่าเข้าชีต ----------
// values: { 'B4': 45486, 'C4': 'AW139', ... }
export function fillSheetXml(xml, values) {
  const byRow = new Map();
  for (const [ref, v] of Object.entries(values)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    const row = Number(m[2]);
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push({ ref, col: colNum(m[1]), v });
  }
  for (const [row, cells] of byRow) {
    const rowRe = new RegExp(`<row r="${row}"(?:\\s[^>]*)?>([\\s\\S]*?)</row>`);
    const rm = rowRe.exec(xml);
    if (!rm) throw new Error(`ไม่พบแถว ${row} ในแม่แบบ`);
    let inner = rm[1];
    for (const { ref, col, v } of cells) {
      const cellRe = new RegExp(`<c r="${ref}"((?:\\s+[A-Za-z:]+="[^"]*")*)\\s*(?:/>|>([\\s\\S]*?)</c>)`);
      const cm = cellRe.exec(inner);
      if (cm) {
        if (cm[2] && cm[2].includes('<f')) continue; // ไม่เขียนทับสูตร
        const st = /s="(\d+)"/.exec(cm[1]);
        const nx = cellXml(ref, st ? ` s="${st[1]}"` : '', v);
        inner = inner.replace(cm[0], () => nx);
      } else {
        // ไม่มีเซลล์นี้ในแถว → แทรกตามลำดับคอลัมน์
        const re = /<c r="([A-Z]+)\d+"/g;
        let at = inner.length, x;
        while ((x = re.exec(inner))) { if (colNum(x[1]) > col) { at = x.index; break; } }
        inner = inner.slice(0, at) + cellXml(ref, '', v) + inner.slice(at);
      }
    }
    const open = rm[0].slice(0, rm[0].indexOf('>') + 1);
    xml = xml.replace(rm[0], () => `${open}${inner}</row>`);
  }
  return xml;
}

// ---------- ค่าของแต่ละหน้า (ช่องที่ผู้ใช้กรอกในต้นฉบับ) ----------
// B=วันที่ C=แบบ D=หมายเลข E=ต้นทาง F=ปลายทาง G=ภารกิจ H=หน้าที่ I=ชั่วโมง
// T=X-Country U=Night Un-aided V=NVG W=IFR Training X=IMC BC=หมายเหตุ
const COND_COL = { xc: 'T', nightUn: 'U', nvg: 'V', ifr: 'W', imc: 'X' };

export function pageValues(page) {
  const v = {};
  page.rows.forEach((f, i) => {
    const r = FIRST_ROW + i;
    v[`B${r}`] = isoToSerial(f.date);
    v[`C${r}`] = f.type;
    if (f.number !== '' && f.number != null) v[`D${r}`] = /^\d+$/.test(String(f.number)) ? Number(f.number) : String(f.number);
    if (f.dep) v[`E${r}`] = f.dep;
    if (f.dest) v[`F${r}`] = f.dest;
    if (f.mission) v[`G${r}`] = f.mission;
    if (f.duty) v[`H${r}`] = f.duty;
    v[`I${r}`] = num(f.hours);
    for (const c of CONDS) if (num(f[c.key]) > 0) v[`${COND_COL[c.key]}${r}`] = num(f[c.key]);
    if (f.note) v[`BC${r}`] = f.note;
  });
  return v;
}

// ---------- ยอดยกมา (S1 แถว 23) ----------
const DUTY_BLOCKS = [
  ['CP/PI', 'Z', AIRCRAFT.length],
  ['PC', 'AH', 6],
  ['MP', 'AN', 5],
  ['IP', 'AS', 5],
  ['SP', 'AX', 5],
];
export function openingValues(o) {
  const t = o || {};
  const v = {};
  const put = (col, x) => { v[`${col}23`] = Math.round(num(x) * 100) / 100; };
  put('I', t.hours); put('J', t.single); put('K', t.multi);
  AIRCRAFT.forEach((a, i) => put(colLetters(colNum('L') + i), t.byType?.[a]));
  put('T', t.xc); put('U', t.nightUn); put('V', t.nvg); put('W', t.ifr); put('X', t.imc);
  for (const [duty, start, count] of DUTY_BLOCKS) {
    for (let i = 0; i < count; i++) put(colLetters(colNum(start) + i), t.byTypeDuty?.[`${AIRCRAFT[i]}|${duty}`]);
  }
  return v;
}

// ---------- หา path ของชีตจากชื่อ ----------
export function sheetPaths(workbookXml, relsXml) {
  const rid2t = {};
  for (const m of relsXml.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0]);
    const tg = /Target="([^"]+)"/.exec(m[0]);
    if (id && tg) rid2t[id[1]] = tg[1];
  }
  const out = {};
  for (const m of workbookXml.matchAll(/<sheet\s[^>]*\/>/g)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
    if (name && rid && rid2t[rid]) out[name] = 'xl/' + rid2t[rid].replace(/^\/?(xl\/)?/, '');
  }
  return out;
}

// ---------- รวมทั้งหมด ----------
// getText(path) → Promise<string>, setText(path, string)
export async function fillWorkbook({ getText, setText }, pages, opening) {
  if (pages.length > MAX_PAGES) {
    throw new Error(`ข้อมูลเกิน ${MAX_PAGES * PAGE_SIZE} รายการ (${MAX_PAGES} ชีต) — ต้องเพิ่มชีตในแม่แบบก่อน`);
  }
  const paths = sheetPaths(await getText('xl/workbook.xml'), await getText('xl/_rels/workbook.xml.rels'));
  for (const p of pages) {
    const path = paths[`S${p.n}`];
    if (!path) throw new Error(`ไม่พบชีต S${p.n} ในแม่แบบ`);
    let values = pageValues(p);
    if (p.n === 1 && opening) values = { ...values, ...openingValues(opening) };
    setText(path, fillSheetXml(await getText(path), values));
  }
  // ยอดยกมาต้องใส่แม้ยังไม่มีเที่ยวบิน
  if (!pages.length && opening) {
    const path = paths.S1;
    setText(path, fillSheetXml(await getText(path), openingValues(opening)));
  }
}
