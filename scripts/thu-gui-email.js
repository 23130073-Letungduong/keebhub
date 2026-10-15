// Thử cấu hình gửi email trong .env: kết nối Gmail và gửi 1 email thử tới chính địa chỉ đó.
// Chạy: node scripts/thu-gui-email.js   (cau-hinh-email.bat tự gọi)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
delete process.env.MAIL_DEV;
const mailer = require('../utils/mailer');
(async () => {
  if (!mailer.isConfigured()) { console.log('✗ Chưa có SMTP_USER / SMTP_PASS trong .env'); process.exit(1); }
  try {
    await mailer.verifyConnection();
    console.log('✓ Đăng nhập Gmail thành công (' + process.env.SMTP_USER + ')');
  } catch (e) {
    console.log('✗ Không đăng nhập được Gmail: ' + e.message);
    if (/Username and Password not accepted|EAUTH|535/.test(e.message)) console.log('  → Kiểm tra lại địa chỉ Gmail và MẬT KHẨU ỨNG DỤNG 16 ký tự (không phải mật khẩu Gmail thường).');
    process.exit(1);
  }
  const r = await mailer.sendTest(process.env.SMTP_USER);
  if (r.ok) { console.log('✓ Đã gửi email thử tới ' + process.env.SMTP_USER + ' — mở Gmail để kiểm tra (xem cả mục Spam).'); process.exit(0); }
  console.log('✗ Gửi email thử thất bại: ' + (r.error || r.reason)); process.exit(1);
})();
