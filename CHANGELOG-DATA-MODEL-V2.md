# Pilot Logbook B1 — Data Model v2 Development Build

สถานะ: Development build สำหรับทดสอบต่อ ยังไม่ใช่รุ่น Production/Deployment

## สิ่งที่เปลี่ยนแปลง

- เพิ่ม Aircraft Configuration v2: `id`, `name`, `kind`, `duties`, `active`, `sortOrder`
- ใช้ Stable Aircraft ID เชื่อม Flight Records และ Opening Balance; เก็บ `type` ไว้เพื่อ backward compatibility
- กำหนด Flight Duties แยกตาม Aircraft ได้ ไม่อิงลำดับ Aircraft
- เพิ่มการปิดใช้งาน Aircraft แทนการลบเมื่อมีประวัติ
- ใช้ชั่วโมงบินทศนิยม 1 ตำแหน่ง (0.1 ชั่วโมง) และคำนวณยอดด้วย integer tenths
- ค่าที่มีความละเอียดผิดข้อกำหนดจะคงค่าต้นฉบับพร้อม Data Quality issue ไม่ปัดเศษ และไม่นำไปรวมยอด
- Legacy Duty ถูกเก็บไว้ ไม่ถูกเปลี่ยนเป็น CP/PI อัตโนมัติ
- เพิ่ม Data Quality summary และ Migration Preview → JSON Backup → Commit
- Migration รอ Firebase streams ทั้ง Flights, Config และ Opening Balance ให้ sync จาก server และไม่มี pending writes ก่อนเริ่ม
- ปรับ Excel Summary builder ให้ใช้ Duty Config ของ Aircraft แต่ละแบบ
- ป้องกัน Excel export เมื่อมี Aircraft เกิน 8 แบบ, Duty ไม่มีคอลัมน์รองรับ หรือมีชั่วโมงที่ไม่ใช่ 0.1 เพื่อไม่ให้ยอดสรุปขาด/ผิด
- เพิ่ม test suite สำหรับ Data Model v2, Decimal Hours, Legacy Duty, Migration, Excel Summary และชุดข้อมูลจำลอง 12 Aircraft × 900 Flights

## ผลทดสอบที่ทำได้ใน Development Environment

คำสั่ง: `node --test tests/*.test.mjs`

ผลล่าสุด: **14 tests passed, 0 failed**

ตรวจ syntax ของ `app.js`, `logic.js`, `backend.js`, `xlsxfill.js` ผ่าน `node --check`

ชุดทดสอบ Excel จำลอง 12 Aircraft × 900 Flights ผ่านการตรวจความละเอียด 0.1 ชั่วโมงและ Migration logic

## ข้อจำกัดที่ยังเหลือ

- Excel Template ปัจจุบันยังมี 8 ช่อง Aircraft เท่านั้น จึงยังไม่มี Dynamic Excel layout สำหรับ Aircraft ลำดับที่ 9 เป็นต้นไป
- Duty ที่ไม่มีคอลัมน์ใน Template เดิมจะถูกป้องกันไม่ให้ส่งออก ต้องพัฒนา Dynamic Excel layout เพิ่มใน Milestone ถัดไป
- ยังไม่ได้ทดสอบการทำงานจริงบน Firebase project ของผู้ใช้ หรือทดสอบ UI แบบ end-to-end บน Android/Chrome ในอุปกรณ์จริง
- ก่อนใช้กับข้อมูลบินจริง ให้ทดสอบบนสำเนาข้อมูล/บัญชีทดสอบ และเก็บ JSON Backup ไว้ก่อน Migration

## ความปลอดภัยของไฟล์

ไฟล์ต้นฉบับ ZIP ไม่ถูกแก้ไข การพัฒนาทั้งหมดทำในสำเนาแยกต่างหาก

## Dynamic Excel Layout — development update
- Added generated `Aircraft Summary` worksheet with one row per configured Aircraft × Duty, including Aircraft beyond the original eight slots.
- Summary formulas aggregate flight hours across S1–S50; Opening Balance is included by stable Aircraft ID (with legacy name-based fallback).
- Added a workbook-level `AircraftTypeList` named range so the Type dropdown can use the dynamic Aircraft list without the 255-character inline-list limit.
- Added `Data Quality` worksheet to carry issue codes and original values into exports.
- Existing S1–S50 pages and original `Summary` sheet remain in place. The original Summary remains a legacy eight-slot view; `Aircraft Summary` is the complete dynamic summary.
- Browser/Excel desktop verification is still required before production use.

## Development Build patch — Dynamic Aircraft Summary (xlsxfill.js)

- Dynamic `Aircraft Summary` now records the Stable Aircraft ID in column G and calculates flight hours by that ID, not by the editable Aircraft display name.
- Export writes the Stable Aircraft ID into hidden helper column `DE` on each S1–S50 flight row. Legacy records without an ID are mapped by their current configured Aircraft name; records carrying an unknown ID are not silently rebound by name.
- Hidden helper column `DF` marks valid 0.1-hour entries. Dynamic Summary formulas include this marker so invalid precision values cannot contribute to the Dynamic totals.
- Hidden helper columns `DE:DF` are added without changing the visible S1–S50 layout; worksheet dimensions are extended and the helper columns remain hidden.
- Repeated exports update the existing `AircraftTypeList` defined name instead of appending duplicate definitions.
- Validation: 19/19 Node tests passed. A real-template export test with 12 Aircraft, 900 flight records and all 50 pages was recalculated with LibreOffice; all 36 Aircraft × Duty formula rows matched independently computed totals (0 mismatches; 1,251.9 hours).
