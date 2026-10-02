// Các hàm tiện ích dùng chung cho server và view (EJS)
const crypto = require('crypto');

function money(n) {
  n = Math.round(Number(n) || 0);
  return n.toLocaleString('vi-VN').replace(/,/g, '.') + '₫';
}
function short(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + ' tỷ';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'tr';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}
function pad(n) { return String(n).padStart(2, '0'); }
function date(d) {
  if (!d) return '';
  d = new Date(d);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function dateTime(d) {
  if (!d) return '';
  d = new Date(d);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function ymd(d) {
  d = new Date(d);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function stars(r) {
  const n = Math.round(Number(r) || 0);
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}
function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
function uniqueSlug(s) {
  return slugify(s) + '-' + crypto.randomBytes(3).toString('hex');
}
function token() { return crypto.randomBytes(24).toString('hex'); }
function escapeRegex(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function initials(name) {
  const w = String(name || '?').trim().split(/\s+/);
  return (w.length > 1 ? w[w.length - 2][0] + w[w.length - 1][0] : w[0].slice(0, 2)).toUpperCase();
}
function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return Math.floor(s / 60) + ' phút trước';
  if (s < 86400) return Math.floor(s / 3600) + ' giờ trước';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' ngày trước';
  return date(d);
}
const PART_LABEL = { kit: 'Kit', switch: 'Switch', keycap: 'Keycap', stabilizer: 'Stabilizer', accessory: 'Phụ kiện', prebuilt: 'Build sẵn' };

module.exports = { money, short, date, dateTime, ymd, stars, slugify, uniqueSlug, token, escapeRegex, initials, timeAgo, PART_LABEL };
