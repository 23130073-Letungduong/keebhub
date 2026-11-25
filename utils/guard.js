// Các lớp chặn lách luật dùng chung

// 1) Giới hạn đăng nhập sai: 5 lần sai / 15 phút cho mỗi (IP + tài khoản) → tạm khoá, kể cả khi sau đó nhập đúng.
//    Lưu trong bộ nhớ máy chủ (đủ cho đồ án 1 máy chủ; khởi động lại web là xoá).
const LOGIN_MAX = 5, LOGIN_WINDOW = 15 * 60e3;
const fails = new Map();
const keyOf = (req, id) => `${req.ip}|${String(id || '').toLowerCase().trim()}`;
function loginBlocked(req, id) {
  const k = keyOf(req, id), now = Date.now();
  const list = (fails.get(k) || []).filter(t => now - t < LOGIN_WINDOW);
  if (list.length) fails.set(k, list); else fails.delete(k);
  if (list.length < LOGIN_MAX) return 0;
  return Math.ceil((LOGIN_WINDOW - (now - list[0])) / 60e3); // số phút còn phải chờ
}
function loginFailed(req, id) { const k = keyOf(req, id); fails.set(k, (fails.get(k) || []).concat(Date.now())); }
function loginOk(req, id) { fails.delete(keyOf(req, id)); }
setInterval(() => { const now = Date.now(); for (const [k, l] of fails) if (!l.some(t => now - t < LOGIN_WINDOW)) fails.delete(k); }, 10 * 60e3).unref();

// 2) Chỉ cho chuyển hướng tới đường dẫn TRONG web (chặn ?back=https://web-lừa-đảo)
function safePath(p, fallback) {
  p = typeof p === 'string' ? p : '';
  return /^\/(?![\/\\])/.test(p) && !/[\r\n]/.test(p) ? p : fallback;
}

// 3) Lấy chuỗi an toàn từ form (mảng / object → chuỗi rỗng)
const str = (v, n = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, n) : '');

module.exports = { loginBlocked, loginFailed, loginOk, LOGIN_MAX, safePath, str };
