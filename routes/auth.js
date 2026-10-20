const router = require('express').Router();
const { User } = require('../models');
const { passport, enabled } = require('../config/passport');
const mailer = require('../utils/mailer');
const { token } = require('../utils/helpers');

const BASE = () => process.env.BASE_URL || 'http://localhost:3000';
const RESEND_WAIT = 30; // giây phải chờ giữa 2 lần gửi email xác nhận
const VERIFY_HOURS = 24; // liên kết xác nhận email có hiệu lực 24 giờ
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function landing(user) {
  return user.role === 'admin' ? '/admin' : user.role === 'seller' ? '/seller' : '/';
}
function signIn(req, user, remember = true) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => {
      if (err) return reject(err);
      req.session.userId = String(user._id);
      if (!remember) req.session.cookie.expires = false;
      resolve();
    });
  });
}
async function mergeAndGo(req, res, user, remember) {
  user.lastLogin = new Date();
  await user.save();
  await signIn(req, user, remember);
  req.flash('success', `Chào mừng ${user.name}!`);
  // (flash đặt sau khi regenerate session để không bị mất)
  // Đăng nhập xong luôn về trang chính của vai trò: khách → trang chủ, người bán → Kênh người bán
  res.redirect(landing(user));
}

// ---------- Đăng nhập ----------
router.get('/login', (req, res) => {
  if (req.user) return res.redirect(landing(req.user));
  res.render('auth/login', { title: 'Đăng nhập', email: '' });
});

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const user = await User.findOne({ $or: [{ email }, { phone: email }] });
    if (!user || !(await user.checkPassword(req.body.password || ''))) {
      return res.render('auth/login', { title: 'Đăng nhập', email, flash: { error: ['Email hoặc mật khẩu không đúng.'], success: [], info: [] } });
    }
    if (user.status === 'locked') {
      return res.render('auth/login', { title: 'Đăng nhập', email, flash: { error: ['Tài khoản đã bị khoá. Liên hệ letungduong.nvn@gmail.com.'], success: [], info: [] } });
    }
    // Tài khoản quản trị chỉ được đăng nhập ở trang riêng /admin/login
    if (user.role === 'admin') {
      return res.render('auth/login', { title: 'Đăng nhập', email, flash: { error: ['Email hoặc mật khẩu không đúng.'], success: [], info: [] } });
    }
    if (!user.emailVerified) {
      return res.render('auth/login', { title: 'Đăng nhập', email, unverified: true, resendEmail: user.email, flash: { error: ['Tài khoản chưa xác nhận email. Kiểm tra hộp thư hoặc gửi lại email xác nhận.'], success: [], info: [] } });
    }
    await mergeAndGo(req, res, user, req.body.remember === 'on');
  } catch (e) { next(e); }
});

// ---------- Đăng ký (gửi email xác nhận) ----------
router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/register', { title: 'Đăng ký', form: {} });
});

router.post('/register', async (req, res, next) => {
  try {
    const f = (k, n = 120) => String(req.body[k] == null ? '' : req.body[k]).trim().slice(0, n);
    const form = { name: f('name', 80), email: f('email').toLowerCase(), phone: f('phone', 15) };
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const errors = [];
    if (form.name.length < 2) errors.push('Vui lòng nhập họ tên.');
    if (!EMAIL_RE.test(form.email)) errors.push('Email không hợp lệ.');
    if (form.phone && !/^0\d{9,10}$/.test(form.phone)) errors.push('Số điện thoại không hợp lệ.');
    if (password.length < 8) errors.push('Mật khẩu tối thiểu 8 ký tự.');
    if (password !== req.body.confirm) errors.push('Mật khẩu nhập lại không khớp.');
    if (!req.body.agree) errors.push('Bạn cần đồng ý điều khoản sử dụng.');
    // Email đã có tài khoản:
    //  - ĐÃ xác nhận  → báo trùng như cũ.
    //  - CHƯA xác nhận (đăng ký rồi bỏ đó, vài giờ sau quay lại đăng ký tiếp) → KHÔNG báo lỗi,
    //    cho đăng ký lại: ghi đè thông tin mới, gửi email xác nhận mới, link cũ hết tác dụng.
    const existing = EMAIL_RE.test(form.email) ? await User.findOne({ email: form.email }) : null;
    if (existing && existing.emailVerified) errors.push('Email đã được sử dụng.');
    if (form.phone && await User.exists({ phone: form.phone, ...(existing ? { _id: { $ne: existing._id } } : {}) })) errors.push('Số điện thoại đã được sử dụng.');
    if (errors.length) return res.render('auth/register', { title: 'Đăng ký', form, flash: { error: errors, success: [], info: [] } });

    if (existing) return reRegister(req, res, existing, form, password);

    const user = new User({ ...form, verifyToken: token(), verifyExpires: Date.now() + VERIFY_HOURS * 3600e3, verifySentAt: new Date() });
    await user.setPassword(password);
    await user.save();
    const sent = await mailer.sendVerify(user, `${BASE()}/auth/verify/${user.verifyToken}`);
    res.render('auth/check-email', { title: 'Kiểm tra email', email: user.email, kind: 'verify', mailFailed: !sent.ok, cooldown: RESEND_WAIT });
  } catch (e) { next(e); }
});

// Đăng ký lại bằng email chưa xác nhận: cập nhật tên / SĐT / mật khẩu theo lần đăng ký mới nhất
// và gửi email xác nhận mới. Vẫn giữ giới hạn 30 giây giữa 2 lần gửi email (chống spam hộp thư).
async function reRegister(req, res, user, form, password) {
  user.name = form.name;
  user.phone = form.phone;
  await user.setPassword(password);
  const passed = user.verifySentAt ? (Date.now() - user.verifySentAt) / 1000 : Infinity;
  let sent = { ok: true }, cooldown = RESEND_WAIT, msg;
  if (passed < RESEND_WAIT) {
    // Vừa gửi cách đây chưa tới 30 giây → không gửi thêm, email vừa gửi vẫn dùng được
    cooldown = Math.ceil(RESEND_WAIT - passed);
    await user.save();
    msg = `Email này vừa đăng ký nhưng chưa xác nhận. Thông tin đã được cập nhật — hãy dùng email xác nhận vừa gửi, hoặc đợi ${cooldown} giây để gửi lại.`;
  } else {
    user.verifyToken = token(); // token mới → link trong email cũ không còn dùng được
    user.verifyExpires = Date.now() + VERIFY_HOURS * 3600e3;
    user.verifySentAt = new Date();
    await user.save();
    sent = await mailer.sendVerify(user, `${BASE()}/auth/verify/${user.verifyToken}`);
    msg = 'Email này đã đăng ký trước đó nhưng chưa xác nhận. Chúng tôi đã cập nhật thông tin theo lần đăng ký mới và gửi email xác nhận MỚI — liên kết trong email cũ không còn dùng được.';
  }
  res.render('auth/check-email', { title: 'Kiểm tra email', email: user.email, kind: 'verify', mailFailed: !sent.ok, cooldown, flash: { info: [msg], error: [], success: [] } });
}

router.get('/verify/:token', async (req, res, next) => {
  try {
    const user = await User.findOne({ verifyToken: req.params.token, verifyExpires: { $gt: Date.now() } });
    if (!user) {
      req.flash('error', 'Liên kết xác nhận không hợp lệ hoặc đã hết hạn (có thể bạn đã nhận email xác nhận mới hơn). Hãy đăng nhập để gửi lại email xác nhận, hoặc đăng ký lại bằng email này.');
      return res.redirect('/auth/login');
    }
    user.emailVerified = true;
    user.verifyToken = undefined;
    user.verifyExpires = undefined;
    await user.save();
    await signIn(req, user);
    req.flash('success', 'Xác nhận email thành công! Bạn đã được đăng nhập.');
    res.redirect('/');
  } catch (e) { next(e); }
});

router.post('/resend', async (req, res, next) => {
  try {
    const user = await User.findOne({ email: String(req.body.email || '').toLowerCase().trim() });
    let sent = { ok: true }, cooldown = RESEND_WAIT, flash;
    if (user && !user.emailVerified) {
      const passed = user.verifySentAt ? (Date.now() - user.verifySentAt) / 1000 : Infinity;
      if (passed < RESEND_WAIT) {
        // Bấm Gửi lại quá nhanh → không gửi, báo số giây còn phải chờ
        cooldown = Math.ceil(RESEND_WAIT - passed);
        flash = { info: [`Vui lòng đợi ${cooldown} giây rồi bấm Gửi lại email.`], error: [], success: [] };
      } else {
        user.verifyToken = token();
        user.verifyExpires = Date.now() + VERIFY_HOURS * 3600e3;
        user.verifySentAt = new Date();
        await user.save();
        sent = await mailer.sendVerify(user, `${BASE()}/auth/verify/${user.verifyToken}`);
        flash = { success: ['Đã gửi lại email xác nhận.'], error: [], info: [] };
      }
    }
    res.render('auth/check-email', { title: 'Kiểm tra email', email: String(req.body.email || ''), kind: 'verify', mailFailed: !sent.ok, cooldown, ...(flash ? { flash } : {}) });
  } catch (e) { next(e); }
});

// ---------- Quên / đặt lại mật khẩu ----------
router.get('/forgot', (req, res) => res.render('auth/forgot', { title: 'Quên mật khẩu' }));
router.post('/forgot', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const user = await User.findOne({ email });
    let sent = { ok: true };
    if (user) {
      user.resetToken = token();
      user.resetExpires = Date.now() + 30 * 60e3;
      await user.save();
      sent = await mailer.sendReset(user, `${BASE()}/auth/reset/${user.resetToken}`);
    }
    // Không tiết lộ email có tồn tại hay không
    res.render('auth/check-email', { title: 'Kiểm tra email', email, kind: 'reset', mailFailed: !sent.ok });
  } catch (e) { next(e); }
});
router.get('/reset/:token', async (req, res) => {
  const user = await User.findOne({ resetToken: req.params.token, resetExpires: { $gt: Date.now() } });
  if (!user) { req.flash('error', 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.'); return res.redirect('/auth/forgot'); }
  res.render('auth/reset', { title: 'Đặt mật khẩu mới', token: req.params.token, email: user.email });
});
router.post('/reset/:token', async (req, res, next) => {
  try {
    const user = await User.findOne({ resetToken: req.params.token, resetExpires: { $gt: Date.now() } });
    if (!user) { req.flash('error', 'Liên kết đã hết hạn.'); return res.redirect('/auth/forgot'); }
    const pw = typeof req.body.password === 'string' ? req.body.password : '';
    if (pw.length < 8 || pw !== req.body.confirm) {
      return res.render('auth/reset', { title: 'Đặt mật khẩu mới', token: req.params.token, email: user.email, flash: { error: ['Mật khẩu tối thiểu 8 ký tự và phải khớp.'], success: [], info: [] } });
    }
    await user.setPassword(pw);
    user.resetToken = undefined;
    user.resetExpires = undefined;
    user.emailVerified = true;
    await user.save();
    req.flash('success', 'Đổi mật khẩu thành công. Hãy đăng nhập lại.');
    res.redirect('/auth/login');
  } catch (e) { next(e); }
});

// ---------- Đăng xuất ----------
function logout(req, res) {
  // Mọi vai trò (khách, người bán, admin) đăng xuất xong đều về trang chủ
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
}
router.post('/logout', logout);
router.get('/logout', logout);

// ---------- Google / Facebook ----------
function oauth(provider, scope) {
  router.get(`/${provider}`, (req, res, next) => {
    if (!enabled[provider]) {
      req.flash('error', `Chưa cấu hình đăng nhập ${provider === 'google' ? 'Google' : 'Facebook'} (xem README → .env).`);
      return res.redirect('/auth/login');
    }
    passport.authenticate(provider, { scope, session: false })(req, res, next);
  });
  router.get(`/${provider}/callback`, (req, res, next) => {
    if (!enabled[provider]) return res.redirect('/auth/login');
    passport.authenticate(provider, { session: false }, async (err, user) => {
      if (err || !user) {
        req.flash('error', 'Đăng nhập thất bại: ' + (err ? err.message : 'đã huỷ'));
        return res.redirect('/auth/login');
      }
      if (user.status === 'locked') { req.flash('error', 'Tài khoản đã bị khoá.'); return res.redirect('/auth/login'); }
      if (user.role === 'admin') { req.flash('error', 'Không thể đăng nhập bằng tài khoản này.'); return res.redirect('/auth/login'); }
      try { await mergeAndGo(req, res, user, true); } catch (e) { next(e); }
    })(req, res, next);
  });
}
oauth('google', ['profile', 'email']);
oauth('facebook', ['email']);

module.exports = router;
module.exports.signIn = signIn;
