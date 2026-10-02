// Trang quản trị: người dùng, shop, sản phẩm, đơn hàng, hoàn tiền, quy tắc tương thích, doanh thu
const router = require('express').Router();
const { User, Shop, Product, Order, Category, CompatRule, Review } = require('../models');
const { requireRole } = require('../middleware/auth');
const { escapeRegex } = require('../utils/helpers');
const { cancelOrder } = require('../utils/orders');
const compat = require('../utils/compat');
const stats = require('../utils/stats');
const { signIn } = require('./auth');

// ---------- Đăng nhập quản trị ----------
router.get('/login', (req, res) => {
  if (req.user && req.user.role === 'admin') return res.redirect('/admin');
  res.render('admin/login', { title: 'Đăng nhập quản trị', email: '' });
});
router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const user = await User.findOne({ email, role: 'admin' });
    if (!user || !(await user.checkPassword(req.body.password || '')) || user.status !== 'active') {
      return res.render('admin/login', { title: 'Đăng nhập quản trị', email, flash: { error: ['Thông tin đăng nhập không đúng.'], success: [], info: [] } });
    }
    user.lastLogin = new Date();
    await user.save();
    await signIn(req, user);
    res.redirect('/admin');
  } catch (e) { next(e); }
});

router.use((req, res, next) => {
  if (!req.user) return res.redirect('/admin/login');
  next();
}, requireRole('admin'));

router.use(async (req, res, next) => {
  const [pendingProducts, pendingShops, refunds] = await Promise.all([
    Product.countDocuments({ status: 'pending' }),
    Shop.countDocuments({ status: 'pending' }),
    Order.countDocuments({ paymentStatus: 'refund_pending' })
  ]);
  res.locals.badges = { pendingProducts, pendingShops, refunds };
  next();
});

// ---------- Dashboard ----------
router.get('/', async (req, res, next) => {
  try {
    const range = stats.parseRange({}, 14);
    const today = stats.parseRange({ from: range.toStr, to: range.toStr });
    const yStr = require('../utils/helpers').ymd(new Date(Date.now() - 86400e3));
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const [chart, t, y, ordersToday, customToday, newUsers, types, recent, topShops, totalUsers, activeShops, customShops, cancelled, allOrders] = await Promise.all([
      stats.series({}, range), stats.series({}, today), stats.series({}, stats.parseRange({ from: yStr, to: yStr })),
      Order.countDocuments({ createdAt: { $gte: startToday } }),
      Order.countDocuments({ createdAt: { $gte: startToday }, isCustom: true }),
      User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 86400e3) } }),
      stats.byType({}, stats.parseRange({}, 30)),
      Order.find().sort({ createdAt: -1 }).limit(6).populate('user', 'name').populate('shop', 'name'),
      stats.byShop({}, stats.parseRange({}, 30), 5).then(rows => rows.map(r => ({ shop: r.s, gmv: r.v, n: r.n }))),
      User.countDocuments(), Shop.countDocuments({ status: 'active' }), Shop.countDocuments({ status: 'active', offersCustom: true }),
      Order.countDocuments({ status: 'cancelled' }), Order.countDocuments()
    ]);
    res.render('admin/dashboard', {
      title: 'Bảng điều khiển hệ thống', active: 'dash', chart, t, y, ordersToday, customToday, newUsers, types, recent, topShops,
      health: { totalUsers, activeShops, customShops, cancelRate: allOrders ? (cancelled / allOrders * 100).toFixed(1) : 0 }
    });
  } catch (e) { next(e); }
});

// ---------- Người dùng ----------
router.get('/users', async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) filter.$or = [{ name: new RegExp(escapeRegex(req.query.q), 'i') }, { email: new RegExp(escapeRegex(req.query.q), 'i') }, { phone: new RegExp(escapeRegex(req.query.q), 'i') }];
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const [users, total, roles] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20),
    User.countDocuments(filter),
    User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }])
  ]);
  const ids = users.map(u => u._id);
  const spent = await Order.aggregate([{ $match: { user: { $in: ids }, status: { $ne: 'cancelled' } } }, { $group: { _id: '$user', t: { $sum: '$total' }, n: { $sum: 1 } } }]);
  const sm = {}; spent.forEach(s => { sm[String(s._id)] = s; });
  const rc = {}; roles.forEach(r => { rc[r._id] = r.n; });
  res.render('admin/users', { title: 'Quản lý người dùng', active: 'users', users, sm, rc, page, pages: Math.ceil(total / 20), total });
});
router.post('/users/:id/status', async (req, res) => {
  const u = await User.findById(req.params.id);
  if (u && u.role !== 'admin') {
    u.status = u.status === 'active' ? 'locked' : 'active';
    await u.save();
    if (u.role === 'seller' && u.status === 'locked') await Shop.updateOne({ owner: u._id }, { status: 'locked' });
    // mở khoá người bán → mở lại shop đã bị khoá theo tài khoản
    if (u.role === 'seller' && u.status === 'active') await Shop.updateOne({ owner: u._id, status: 'locked' }, { status: 'active' });
    req.flash('success', `${u.status === 'locked' ? 'Đã khoá' : 'Đã mở khoá'} tài khoản ${u.email}.`);
  }
  res.redirect('back');
});
router.post('/users/:id/verify', async (req, res) => {
  await User.updateOne({ _id: req.params.id }, { emailVerified: true, $unset: { verifyToken: 1 } });
  req.flash('success', 'Đã xác minh email thủ công.');
  res.redirect('back');
});

// ---------- Shop ----------
router.get('/shops', async (req, res) => {
  const st = req.query.status || 'pending';
  const filter = st === 'all' ? {} : { status: st };
  if (req.query.q) filter.name = new RegExp(escapeRegex(req.query.q), 'i');
  const shops = await Shop.find(filter).sort({ createdAt: -1 }).populate('owner', 'name email phone');
  const counts = {}; (await Shop.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])).forEach(c => { counts[c._id] = c.n; });
  const pc = {}; (await Product.aggregate([{ $group: { _id: '$shop', n: { $sum: 1 } } }])).forEach(c => { pc[String(c._id)] = c.n; });
  res.render('admin/shops', { title: 'Tài khoản Seller/Shop', active: 'shops', shops, st, counts, pc });
});
router.post('/shops/:id/:action', async (req, res) => {
  const s = await Shop.findById(req.params.id);
  if (s) {
    const a = req.params.action;
    if (a === 'approve') { s.status = 'active'; s.verified = true; s.rejectReason = undefined; }
    if (a === 'lock') { s.status = 'locked'; s.rejectReason = undefined; }
    if (a === 'unlock') s.status = 'active';
    if (a === 'reject') { s.status = 'locked'; s.rejectReason = req.body.reason || 'Hồ sơ chưa hợp lệ'; }
    await s.save();
    req.flash('success', `Đã cập nhật shop ${s.name}.`);
  }
  res.redirect('back');
});

// ---------- Sản phẩm: kiểm duyệt & quản lý ----------
router.get('/products', async (req, res) => {
  const st = req.query.status || 'pending';
  const filter = st === 'all' ? {} : { status: st };
  if (req.query.q) filter.name = new RegExp(escapeRegex(req.query.q), 'i');
  if (req.query.type) filter.partType = req.query.type;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const [products, total] = await Promise.all([
    Product.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).populate('shop', 'name slug').populate('category', 'name'),
    Product.countDocuments(filter)
  ]);
  const counts = {}; (await Product.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])).forEach(c => { counts[c._id] = c.n; });
  res.render('admin/products', { title: st === 'pending' ? 'Kiểm duyệt sản phẩm' : 'Quản lý sản phẩm', active: 'products', products, st, counts, page, pages: Math.ceil(total / 20) });
});
router.post('/products/:id/:action', async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (p) {
    const a = req.params.action;
    if (a === 'approve') { p.status = 'active'; p.rejectReason = undefined; }
    if (a === 'reject') { p.status = 'rejected'; p.rejectReason = req.body.reason || 'Thông tin chưa đạt chuẩn'; }
    if (a === 'hide') p.status = 'hidden';
    if (a === 'delete') {
      if (await Order.exists({ 'items.product': p._id })) { p.status = 'hidden'; req.flash('info', 'Sản phẩm có đơn hàng nên chỉ được ẩn.'); }
      else { await p.deleteOne(); req.flash('success', 'Đã xoá sản phẩm.'); return res.redirect('back'); }
    }
    await p.save();
    req.flash('success', `Đã cập nhật "${p.name}".`);
  }
  res.redirect('back');
});

// ---------- Đơn hàng ----------
router.get('/orders', async (req, res) => {
  const filter = {};
  const st = req.query.status || 'all';
  if (st !== 'all') filter.status = st;
  if (req.query.pay) filter.paymentStatus = req.query.pay;
  if (req.query.type === 'custom') filter.isCustom = true;
  if (req.query.q) filter.code = new RegExp(escapeRegex(req.query.q.replace('#', '')), 'i');
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).populate('user', 'name email').populate('shop', 'name'),
    Order.countDocuments(filter)
  ]);
  const counts = {}; (await Order.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])).forEach(c => { counts[c._id] = c.n; });
  res.render('admin/orders', { title: 'Quản lý đơn hàng', active: 'orders', orders, st, counts, page, pages: Math.ceil(total / 20) });
});
router.get('/orders/:code', async (req, res, next) => {
  const order = await Order.findOne({ code: req.params.code }).populate('user', 'name email phone').populate('shop').populate('build');
  if (!order) return next();
  res.render('admin/order-detail', { title: `Đơn #${order.code}`, active: 'orders', order });
});
router.post('/orders/:code/status', async (req, res, next) => {
  try {
    const order = await Order.findOne({ code: req.params.code });
    if (!order) return next();
    const to = req.body.status;
    if (to === 'cancelled' && ['delivered', 'completed'].includes(order.status)) {
      req.flash('error', 'Đơn đã giao tới khách, không thể huỷ (hãy xử lý đổi trả/hoàn tiền riêng).');
      return res.redirect(`/admin/orders/${order.code}`);
    }
    if (to === 'cancelled') await cancelOrder(order, 'admin', req.body.note || 'Quản trị viên huỷ');
    else if (Order.STATUS[to] && order.status !== 'cancelled') {
      order.status = to;
      // COD đã giao/hoàn thành = đã thu tiền
      if (['delivered', 'completed'].includes(to) && order.paymentMethod === 'cod' && order.paymentStatus === 'unpaid') { order.paymentStatus = 'paid'; order.paidAt = new Date(); }
      if (to === 'shipping' && !order.shipping.trackingCode) order.shipping.trackingCode = 'GHN' + Date.now().toString().slice(-9);
      order.history.push({ status: to, note: req.body.note || 'Cập nhật bởi quản trị viên', by: 'admin' });
      await order.save();
    }
    req.flash('success', `Đã cập nhật đơn #${order.code}.`);
    res.redirect(req.body.back || `/admin/orders/${order.code}`);
  } catch (e) { next(e); }
});

// ---------- Huỷ đơn & hoàn tiền ----------
router.get('/refunds', async (req, res) => {
  const tab = req.query.tab === 'done' ? 'done' : 'pending';
  const orders = await Order.find({ paymentStatus: tab === 'done' ? 'refunded' : 'refund_pending' }).sort({ updatedAt: -1 }).limit(50).populate('user', 'name email').populate('shop', 'name');
  res.render('admin/refunds', { title: 'Huỷ đơn & hoàn tiền', active: 'refunds', orders, tab });
});
router.post('/refunds/:code', async (req, res) => {
  const o = await Order.findOne({ code: req.params.code, paymentStatus: 'refund_pending' });
  if (o) {
    o.paymentStatus = 'refunded';
    o.history.push({ status: o.status, note: `Đã hoàn ${o.total.toLocaleString('vi-VN')}₫ qua VNPay${req.body.note ? ' — ' + req.body.note : ''}`, by: 'admin' });
    await o.save();
    req.flash('success', `Đã xác nhận hoàn tiền đơn #${o.code}.`);
  }
  res.redirect('/admin/refunds');
});

// ---------- Danh mục kỹ thuật & quy tắc tương thích ----------
router.get('/compat', async (req, res) => {
  await compat.seedRules();
  const [rules, cats, counts] = await Promise.all([
    CompatRule.find().sort({ level: 1, code: 1 }),
    Category.find().sort('order'),
    Product.aggregate([{ $group: { _id: '$category', n: { $sum: 1 } } }])
  ]);
  const cm = {}; counts.forEach(c => { cm[String(c._id)] = c.n; });
  res.render('admin/compat', { title: 'Danh mục kỹ thuật & tương thích', active: 'compat', rules, cats, cm });
});
router.post('/compat/:id', async (req, res) => {
  const { level, message, enabled } = req.body;
  const upd = { enabled: enabled === 'on' };
  if (['block', 'warn', 'suggest'].includes(level)) upd.level = level;
  if (message && message.trim()) upd.message = message.trim();
  await CompatRule.updateOne({ _id: req.params.id }, upd);
  compat.clearCache();
  req.flash('success', 'Đã lưu quy tắc tương thích.');
  res.redirect('/admin/compat');
});
router.post('/categories', async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const partType = String(req.body.partType || '');
  const icon = String(req.body.icon || '').trim().slice(0, 4) || '⌨';
  if (!name || !['kit', 'prebuilt', 'switch', 'keycap', 'stabilizer', 'accessory'].includes(partType)) {
    req.flash('error', 'Nhập tên danh mục và chọn loại linh kiện.'); return res.redirect('/admin/compat');
  }
  const slug = require('../utils/helpers').slugify(name) || 'danh-muc-' + Date.now().toString(36);
  if (await Category.exists({ $or: [{ slug }, { name: new RegExp('^' + escapeRegex(name) + '$', 'i') }] })) {
    req.flash('error', 'Danh mục này đã tồn tại.'); return res.redirect('/admin/compat');
  }
  await Category.create({ name, slug, icon, partType, order: 50 });
  if (req.app.locals.clearCatCache) req.app.locals.clearCatCache();
  req.flash('success', 'Đã thêm danh mục.');
  res.redirect('/admin/compat');
});
router.post('/categories/:id/delete', async (req, res) => {
  if (await Product.exists({ category: req.params.id })) req.flash('error', 'Danh mục đang có sản phẩm, không xoá được.');
  else { await Category.deleteOne({ _id: req.params.id }); if (req.app.locals.clearCatCache) req.app.locals.clearCatCache(); req.flash('success', 'Đã xoá danh mục.'); }
  res.redirect('/admin/compat');
});

// ---------- Doanh thu & thống kê ----------
router.get('/revenue', async (req, res, next) => {
  try {
    const range = stats.parseRange(req.query, 30);
    const m = req.query.shop && /^[a-f0-9]{24}$/.test(req.query.shop) ? { shop: req.query.shop } : {};
    const [chart, types, cats, status, top, shops] = await Promise.all([
      stats.series(m, range), stats.byType(m, range), stats.byCategory(m, range), stats.byStatus(m, range), stats.topProducts(m, range, 8),
      Shop.find({ status: { $ne: 'pending' } }).select('name')
    ]);
    const byShop = await stats.byShop(m, range, 10);
    res.render('admin/revenue', { title: 'Doanh thu & thống kê', active: 'revenue', range, chart, types, cats, status, top, shops, byShop, FEE: stats.PLATFORM_FEE });
  } catch (e) { next(e); }
});

module.exports = router;
