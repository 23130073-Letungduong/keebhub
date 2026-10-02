require('dotenv').config();
const path = require('path');
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
const ASSET_V = Date.now().toString(36);
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/keebhub';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(methodOverride('_method'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'keebhub-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGODB_URI, ttl: 7 * 24 * 3600 }),
  cookie: { maxAge: 7 * 24 * 3600 * 1000, httpOnly: true }
}));
app.use(flash());
app.use(passport.initialize());

// Biến dùng chung cho mọi view
let catCache = null, catAt = 0;
app.use(async (req, res, next) => {
  try {
    res.locals.v = ASSET_V; // thêm ?v= vào link css/js → trình duyệt luôn tải bản mới sau khi khởi động lại web
    res.locals.h = helpers;
    res.locals.STATUS = Order.STATUS;
    res.locals.PAY = Order.PAY;
    res.locals.oauth = oauthEnabled;
    res.locals.mailDev = !mailer.isConfigured();
    res.locals.vnpayLive = vnpay.isConfigured();
    res.locals.flash = { success: req.flash('success'), error: req.flash('error'), info: req.flash('info') };
    if (!catCache || Date.now() - catAt > 60000) { catCache = await Category.find().sort('order'); catAt = Date.now(); }
    res.locals.categories = catCache;
    next();
  } catch (e) { next(e); }
});
app.use(loadUser);

// Routes
app.use('/', require('./routes/home'));
app.use('/auth', require('./routes/auth'));
app.use('/', require('./routes/cart'));
app.use('/payment', require('./routes/payment'));
app.use('/account', require('./routes/account'));
app.use('/builder', require('./routes/builder'));
app.use('/seller', require('./routes/seller'));
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

// Hộp thư dev — xem email khi chưa cấu hình SMTP
app.get('/dev/mails', (req, res) => {
  if (mailer.isConfigured()) return res.redirect('/');
  res.render('pages/devmails', { title: 'Hộp thư dev', mails: mailer.devOutbox });
});
app.get('/dev/mails/:i', (req, res) => {
  const m = mailer.devOutbox[Number(req.params.i)];
  if (!m || mailer.isConfigured()) return res.redirect('/dev/mails');
  res.send(m.html);
});

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
    return res.redirect(req.get('Referrer') || '/');
  }
  console.error(err);
  if (req.xhr || (req.headers.accept || '').includes('application/json')) return res.status(500).json({ error: err.message });
  res.status(500).render('pages/error', { title: 'Lỗi hệ thống', code: 500, message: err.message });
});

mongoose.connect(MONGODB_URI).then(() => {
  console.log('✓ Đã kết nối MongoDB:', MONGODB_URI);
  app.listen(PORT, () => console.log(`✓ KeebHub chạy tại ${process.env.BASE_URL || 'http://localhost:' + PORT}`));
}).catch(err => {
  console.error('✗ Không kết nối được MongoDB. Kiểm tra MONGODB_URI trong .env\n', err.message);
  process.exit(1);
});

module.exports = app;
