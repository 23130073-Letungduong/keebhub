const router = require('express').Router();
const { User } = require('../models');
const { passport, enabled } = require('../config/passport');
const mailer = require('../utils/mailer');
const { token } = require('../utils/helpers');

const BASE = () => process.env.BASE_URL || 'http://localhost:3000';
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
  const returnTo = req.session.returnTo;
  user.lastLogin = new Date();
  await user.save();
  await signIn(req, user, remember);
  req.flash('success', `Chào mừng ${user.name}!`);
  // (flash đặt sau khi regenerate session để không bị mất)
  res.redirect(returnTo && !returnTo.startsWith('/auth') ? returnTo : landing(user));
}

// ---------- Đăng nhập ----------
router.get('/login', (req, res) => {
  if (req.user) return res.redirect(landing(req.user));
  // ?next=/builder/new → sau khi đăng nhập quay lại đúng tính năng (chỉ nhận đường dẫn nội bộ)
  const nxt = typeof req.query.next === 'string' ? req.query.next : '';
  if (/^\/(?![\/\\])/.test(nxt) && !nxt.startsWith('/auth') && nxt.length < 300) req.session.returnTo = nxt;
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
      return res.render('auth/login', { title: 'Đăng nhập', email, flash: { error: ['Tài khoản đã bị khoá. Liên hệ hotro@keebhub.vn.'], success: [], info: [] } });
    }
    // Tài khoản quản trị chỉ được đăng nhập ở trang riêng /admin/login
    if (user.role === 'admin') {
      return res.render('auth/login', { title: 'Đăng nhập', email, flash: { error: ['Email hoặc mật khẩu không đúng.'], success: [], info: [] } });
    }
    if (!user.emailVerified) {
      return res.render('auth/login', { title: 'Đăng nhập', email, unverified: true, flash: { error: ['Tài khoản chưa xác nhận email. Kiểm tra hộp thư hoặc gửi lại email xác nhận.'], success: [], info: [] } });
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
    const form = { name: (req.body.name || '').trim(), email: (req.body.email || '').toLowerCase().trim(), phone: (req.body.phone || '').trim() };
    const errors = [];
    if (form.name.length < 2) errors.push('Vui lòng nhập họ tên.');
    if (!EMAIL_RE.test(form.email)) errors.push('Email không hợp lệ.');
    if (form.phone && !/^0\d{9,10}$/.test(form.phone)) errors.push('Số điện thoại không hợp lệ.');
    if ((req.body.password || '').length < 8) errors.push('Mật khẩu tối thiểu 8 ký tự.');
    if (req.body.password !== req.body.confirm) errors.push('Mật khẩu nhập lại không khớp.');
    if (!req.body.agree) errors.push('Bạn cần đồng ý điều khoản sử dụng.');
    if (await User.exists({ email: form.email })) errors.push('Email đã được sử dụng.');
    if (errors.length) return res.render('auth/register', { title: 'Đăng ký', form, flash: { error: errors, success: [], info: [] } });

    const user = new User({ ...form, verifyToken: token(), verifyExpires: Date.now() + 24 * 3600e3 });
    await user.setPassword(req.body.password);
    await user.save();
    await mailer.sendVerify(user, `${BASE()}/auth/verify/${user.verifyToken}`);
    res.render('auth/check-email', { title: 'Kiểm tra email', email: user.email, kind: 'verify' });
  } catch (e) { next(e); }
});

router.get('/verify/:token', async (req, res, next) => {
  try {
    const user = await User.findOne({ verifyToken: req.params.token, verifyExpires: { $gt: Date.now() } });
    if (!user) {
      req.flash('error', 'Liên kết xác nhận không hợp lệ hoặc đã hết hạn.');
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
    if (user && !user.emailVerified) {
      user.verifyToken = token();
      user.verifyExpires = Date.now() + 24 * 3600e3;
      await user.save();
      await mailer.sendVerify(user, `${BASE()}/auth/verify/${user.verifyToken}`);
    }
    res.render('auth/check-email', { title: 'Kiểm tra email', email: req.body.email, kind: 'verify' });
  } catch (e) { next(e); }
});

// ---------- Quên / đặt lại mật khẩu ----------
router.get('/forgot', (req, res) => res.render('auth/forgot', { title: 'Quên mật khẩu' }));
router.post('/forgot', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const user = await User.findOne({ email });
    if (user) {
      user.resetToken = token();
      user.resetExpires = Date.now() + 30 * 60e3;
      await user.save();
      await mailer.sendReset(user, `${BASE()}/auth/reset/${user.resetToken}`);
    }
    // Không tiết lộ email có tồn tại hay không
    res.render('auth/check-email', { title: 'Kiểm tra email', email, kind: 'reset' });
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
    const pw = req.body.password || '';
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
