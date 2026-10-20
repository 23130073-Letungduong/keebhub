// Tự dọn tài khoản đăng ký nhưng KHÔNG xác nhận email sau một số ngày (mặc định 7, đổi bằng UNVERIFIED_DAYS trong .env).
// - Chỉ xoá tài khoản khách (customer), chưa xác nhận email, không đăng nhập bằng Google/Facebook.
// - Tính từ lần đăng ký / gửi lại email gần nhất (updatedAt) → ai vừa đăng ký lại thì được tính lại từ đầu.
// - Tài khoản chưa xác nhận thì chưa đăng nhập được nên không có đơn hàng, đánh giá, shop… → xoá an toàn.
// Xoá xong, email và số điện thoại đó lại đăng ký mới được.
const { User } = require('../models');

const DAYS = () => Math.max(1, Number(process.env.UNVERIFIED_DAYS) || 7);

async function xoaTaiKhoanChuaXacNhan() {
  const cutoff = new Date(Date.now() - DAYS() * 24 * 3600e3);
  const r = await User.deleteMany({
    role: 'customer',
    emailVerified: { $ne: true },
    updatedAt: { $lt: cutoff },
    googleId: { $in: [null, ''] },
    facebookId: { $in: [null, ''] }
  });
  if (r.deletedCount) console.log(`[DỌN DẸP] Đã xoá ${r.deletedCount} tài khoản không xác nhận email sau ${DAYS()} ngày.`);
  return r.deletedCount;
}

// Chạy 1 lần lúc bật web, sau đó cứ 6 giờ chạy lại
function batDauDonDep() {
  const run = () => xoaTaiKhoanChuaXacNhan().catch(e => console.error('[DỌN DẸP] Lỗi:', e.message));
  run();
  const t = setInterval(run, 6 * 3600e3);
  if (t.unref) t.unref();
}

module.exports = { xoaTaiKhoanChuaXacNhan, batDauDonDep, DAYS };
