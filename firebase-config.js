// ใส่ค่าจาก Firebase Console → Project settings → Your apps → Web app → SDK setup (Config)
// ค่าเหล่านี้ไม่ใช่รหัสลับ ความปลอดภัยของข้อมูลมาจากกฎใน firestore.rules + การล็อกอิน Google
// ถ้ายังไม่แก้ แอปจะทำงานใน "โหมดในเครื่อง" (เก็บในเบราว์เซอร์เครื่องนี้ ยังไม่ซิงค์)
export const firebaseConfig = {
  apiKey: 'AIzaSyBt8BTBJEfRkIDzosjJRC6VhZVVPvEiR4c',
  authDomain: 'pilot-logbook-79be8.firebaseapp.com',
  projectId: 'pilot-logbook-79be8',
  appId: '1:151531471314:web:f179f8f6379791d37dc80b',
};
