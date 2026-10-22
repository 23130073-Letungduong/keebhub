require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
require('./utils/async-errors');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const flash = require('connect-flash');
const methodOverride = require('method-override');

const helpers = require('./utils/helpers');
const { passport, enabled: oauthEnabled } = require('./config/passport');
const { loadUser } = require('./middleware/auth');
const { Category, Order } = require('./models');
const mailer = require('./utils/mailer');
const vnpay = require('./utils/vnpay');

const app = express();
// Mã phiên bản css/js = thời điểm sửa file mới nhất trong public/css, public/js
// → sửa CSS/JS là trình duyệt tải bản mới ngay (không bị dùng bản cũ đã lưu), khỏi cần khởi động lại web.
let assetV = Date.now().toString(36), assetCheckedAt = 0;
function assetVersion() {
  if (Date.now() - assetCheckedAt < 2000) return assetV;
  assetCheckedAt = Date.now();
  try {
    let max = 0;
    for (const d of ['css', 'js']) {
      const dir = path.join(__dirname, 'public', d);
      for (const f of fs.readdirSync(dir)) { const t = fs.statSync(path.join(dir, f)).mtimeMs; if (t > max) max = t; }
    }
    if (max) assetV = Math.floor(max).toString(36);
  } catch (e) { /* giữ mã cũ */ }
  return assetV;
}
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/keebhub';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
// res.back(): quay lại trang trước (chỉ trong cùng website), không có thì về trang dự phòng
app.use((req, res, next) => {
  res.back = (fallback = '/') => {
    const ref = req.get('Referrer') || '';
    try { const u = new URL(ref); if (u.host === req.get('host')) return res.redirect(u.pathname + u.search); } catch (e) { /* không có / sai Referrer */ }
    return res.redirect(fallback);
  };
  next();
});
// Tham số trên URL chỉ nhận chuỗi: ?q[]=a → 'a', ?x[$ne]=1 → bỏ (chặn lỗi 500 và NoSQL injection qua query)
app.use((req, res, next) => {
  for (const k of Object.keys(req.query)) {
    const v = req.query[k];
    if (Array.isArray(v)) req.query[k] = typeof v[0] === 'string' ? v[0] : '';
    else if (v !== null && typeof v === 'object') delete req.query[k];
  }
  next();
});
app.use(methodOverride('_method'));

// 2 phiên đăng nhập tách riêng trong cùng 1 trình duyệt:
//  - connect.sid    : khách / người bán (toàn bộ web)
//  - keebhub.admin  : quản trị viên (chỉ dùng cho /admin/...)
// → mở 1 tab đăng nhập khách và 1 tab đăng nhập admin cùng lúc, không đè lên nhau.
const sessionStore = MongoStore.create({ mongoUrl: MONGODB_URI, ttl: 7 * 24 * 3600 });
const sessionOpts = name => session({
  name,
  secret: process.env.SESSION_SECRET || 'keebhub-secret',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: { maxAge: 7 * 24 * 3600 * 1000, httpOnly: true, sameSite: 'lax' }
});
const userSession = sessionOpts('connect.sid');
const adminSession = sessionOpts('keebhub.admin');
const isAdminArea = req => req.path === '/admin' || req.path.startsWith('/admin/') ||
  // admin bấm xem trước sản phẩm / gian hàng từ trang quản trị (link có ?admin=1)
  (req.query.admin === '1' && (req.path.startsWith('/p/') || req.path.startsWith('/shop/')));
app.use((req, res, next) => (isAdminArea(req) ? adminSession : userSession)(req, res, next));
app.use(flash());
app.use(passport.initialize());

// Biến dùng chung cho mọi view
let catCache = null, catAt = 0;
app.locals.clearCatCache = () => { catCache = null; }; // gọi khi admin thêm/xoá danh mục
app.use(async (req, res, next) => {
  try {
    res.locals.v = assetVersion(); // thêm ?v= vào link css/js → trình duyệt luôn tải bản mới sau khi khởi động lại web
    res.locals.h = helpers;
    res.locals.STATUS = Order.STATUS;
    res.locals.PAY = Order.PAY;
    res.locals.oauth = oauthEnabled;
    res.locals.mailDev = mailer.isDev();
    res.locals.mailReady = mailer.isDev() || mailer.isConfigured();
    res.locals.vnpayLive = vnpay.isConfigured();
    res.locals.flash = { success: req.flash('success'), error: req.flash('error'), info: req.flash('info') };
    if (!catCache || Date.now() - catAt > 60000) { catCache = await Category.find().sort('order'); catAt = Date.now(); }
    res.locals.categories = catCache;
    next();
  } catch (e) { next(e); }
});
app.use(loadUser);
// Trang cần đăng nhập không cho trình duyệt lưu lại → đăng xuất rồi bấm "Quay lại" không còn thấy trang quản trị / tài khoản cũ
app.use(['/admin', '/seller', '/account', '/cart', '/checkout'], (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// Routes
// Tài khoản quản trị không dùng để mua hàng / build → đưa về trang quản trị kèm thông báo
app.use(['/cart', '/checkout', '/builder', '/wishlist', '/payment/vnpay', '/payment/retry'], (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    if (req.xhr || (req.headers.accept || '').includes('application/json')) return res.status(403).json({ error: 'Tài khoản quản trị không dùng để mua hàng.' });
    req.flash('info', 'Tài khoản quản trị không dùng để mua hàng. Hãy dùng tài khoản khách để thử mua.');
    return res.redirect('/admin');
  }
  next();
});
app.use('/', require('./routes/home'));
app.use('/auth', require('./routes/auth'));
app.use('/', require('./routes/cart'));
app.use('/payment', require('./routes/payment'));
app.use('/account', require('./routes/account'));
app.use('/builder', require('./routes/builder'));
app.use('/seller', require('./routes/seller'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

// Hộp thư dev — tự bật khi chưa cấu hình Gmail (hoặc MAIL_DEV=1); cấu hình Gmail xong thì trang này biến mất
if (mailer.isDev()) {
  app.get('/dev/mails', (req, res) => res.render('pages/devmails', { title: 'Hộp thư dev', mails: mailer.devOutbox }));
  app.get('/dev/mails/:i', (req, res) => {
    const m = mailer.devOutbox[Number(req.params.i)];
    if (!m) return res.redirect('/dev/mails');
    res.send(m.html);
  });
}

// 404
app.use((req, res) => {
  res.status(404).render('pages/404', { title: 'Không tìm thấy trang' });
});

// Lỗi
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const wantsJson = req.xhr || (req.headers.accept || '').includes('application/json');
  // Id sai định dạng (vd. /products/abc) → coi như không tìm thấy, không phải lỗi hệ thống
  if (err.name === 'CastError' || err.name === 'BSONError') {
    if (wantsJson) return res.status(404).json({ error: 'Không tìm thấy' });
    return res.status(404).render('pages/error', { title: 'Không tìm thấy', code: 404, message: 'Không tìm thấy nội dung bạn yêu cầu.' });
  }
  // Lỗi upload (file không phải ảnh, quá dung lượng...) → báo lại cho người dùng
  if (err.name === 'MulterError' || err.isUploadError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Ảnh quá dung lượng cho phép.' : err.message;
    if (wantsJson) return res.status(400).json({ error: msg });
    if (req.flash) req.flash('error', msg);
    return res.back ? res.back() : res.redirect('/');
  }
  console.error(err);
  if (req.xhr || (req.headers.accept || '').includes('application/json')) return res.status(500).json({ error: err.message });
  res.status(500).render('pages/error', { title: 'Lỗi hệ thống', code: 500, message: err.message });
});

mongoose.connect(MONGODB_URI).then(() => {
  console.log('✓ Đã kết nối MongoDB:', MONGODB_URI);
  require('./utils/cleanup').batDauDonDep(); // xoá tài khoản không xác nhận email sau 7 ngày
  app.listen(PORT, () => console.log(`✓ KeebHub chạy tại ${process.env.BASE_URL || 'http://localhost:' + PORT}`));
}).catch(err => {
  console.error('✗ Không kết nối được MongoDB. Kiểm tra MONGODB_URI trong .env\n', err.message);
  process.exit(1);
});

module.exports = app;
