// Gửi email qua SMTP (nodemailer) — cấu hình SMTP_* trong .env (Gmail + mật khẩu ứng dụng).
// Hộp thư dev (/dev/mails): TỰ BẬT khi chưa cấu hình Gmail (SMTP_USER/SMTP_PASS trống) hoặc khi MAIL_DEV=1;
// cấu hình Gmail xong thì tự tắt, email gửi thẳng tới hộp thư thật.
// Gửi lỗi (sai mật khẩu ứng dụng, mất mạng…) không làm sập trang: ghi log và trả về { ok:false }.
const nodemailer = require('nodemailer');

const devOutbox = [];
let transporter = null;

if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  const port = Number(process.env.SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#F7F8FA;font-family:Arial,sans-serif;color:#101828">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="font-size:22px;font-weight:800;margin-bottom:18px"><span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:8px;background:#1B62F5;color:#fff;margin-right:8px">K</span>Keeb<span style="color:#1B62F5">Hub</span></div>
    <div style="background:#fff;border:1px solid #E4E7EC;border-radius:14px;padding:28px">
      <h2 style="margin:0 0 14px;font-size:20px">${title}</h2>${bodyHtml}
    </div>
    <p style="font-size:12px;color:#98A2B3;text-align:center;margin-top:18px">© KeebHub — Sàn bàn phím custom</p>
  </div></body></html>`;
}
function button(href, text) {
  return `<p style="margin:22px 0"><a href="${href}" style="background:#1B62F5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">${text}</a></p>
  <p style="font-size:12px;color:#98A2B3">Nếu nút không bấm được, mở liên kết: <br><a href="${href}">${href}</a></p>`;
}

const devMode = () => process.env.MAIL_DEV === '1' || !transporter;

async function send(to, subject, html) {
  const from = process.env.MAIL_FROM || (process.env.SMTP_USER ? `KeebHub <${process.env.SMTP_USER}>` : 'KeebHub <no-reply@keebhub.vn>');
  if (devMode()) {
    devOutbox.unshift({ to, subject, html, at: new Date() });
    if (devOutbox.length > 50) devOutbox.pop();
    return { ok: true, dev: true };
  }
  if (!transporter) {
    // Chưa cấu hình email: in link ra cửa sổ chạy web để quản trị viên xử lý (hoặc bấm "Xác minh" trong trang admin)
    const link = (html.match(/href="(http[^"]+\/auth\/[^"]+)"/) || [])[1] || '';
    console.warn(`[EMAIL] Chưa cấu hình gửi email (SMTP_* trong .env) → không gửi được tới ${to}: ${subject}${link ? '\n        Link: ' + link : ''}`);
    return { ok: false, reason: 'not_configured' };
  }
  try {
    await transporter.sendMail({ from, to, subject, html });
    return { ok: true };
  } catch (e) {
    console.error(`[EMAIL] Gửi tới ${to} thất bại: ${e.message}`);
    return { ok: false, reason: e.code === 'EAUTH' ? 'auth' : 'send', error: e.message };
  }
}

module.exports = {
  devOutbox,
  isConfigured: () => !!transporter,
  isDev: devMode,
  verifyConnection: () => (transporter ? transporter.verify() : Promise.reject(new Error('Chưa cấu hình SMTP_HOST / SMTP_USER'))),
  sendTest: (to) => send(to, 'KeebHub — Email thử cấu hình', layout('Gửi email thành công 🎉', '<p>Web KeebHub đã gửi được email qua Gmail. Từ giờ email xác nhận tài khoản, đặt lại mật khẩu và đơn hàng sẽ đến hộp thư thật của người dùng.</p>')),
  sendVerify: (user, link) => send(user.email, 'Xác nhận tài khoản KeebHub',
    layout('Xác nhận email của bạn', `<p>Chào ${user.name},</p><p>Cảm ơn bạn đã đăng ký KeebHub. Bấm nút dưới đây để kích hoạt tài khoản (liên kết có hiệu lực 24 giờ).</p>${button(link, 'Xác nhận tài khoản')}`)),
  sendReset: (user, link) => send(user.email, 'Đặt lại mật khẩu KeebHub',
    layout('Đặt lại mật khẩu', `<p>Chào ${user.name},</p><p>Có yêu cầu đặt lại mật khẩu cho tài khoản này. Liên kết có hiệu lực 30 phút. Nếu không phải bạn, hãy bỏ qua email này.</p>${button(link, 'Đặt mật khẩu mới')}`)),
  sendOrder: (user, orders, link) => send(user.email, `Đặt hàng thành công ${orders.map(o => '#' + o.code).join(', ')}`,
    layout('Cảm ơn bạn đã đặt hàng!', `<p>Chào ${user.name}, KeebHub đã nhận ${orders.length} đơn hàng của bạn: <b>${orders.map(o => '#' + o.code).join(', ')}</b>.</p>${button(link, 'Xem đơn hàng')}`))
};
