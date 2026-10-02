// Kênh người bán: sản phẩm, đơn hàng, dịch vụ custom, tiến độ gia công, đánh giá, doanh thu
const router = require('express').Router();
const { Shop, Product, Category, Order, CustomService, Review, Comment, User } = require('../models');
const { requireLogin, requireShop } = require('../middleware/auth');
const upload = require('../config/upload');
const { uniqueSlug, slugify, escapeRegex } = require('../utils/helpers');
const { cancelOrder, NEXT } = require('../utils/orders');
const stats = require('../utils/stats');

const COLORS = ['#1B62F5', '#E84708', '#7C3AED', '#079455', '#DC6803', '#0E7490', '#BE185D'];

// ---------- Đăng ký mở shop ----------
router.get('/register', requireLogin, (req, res) => {
  if (req.shop && req.shop.status === 'active') return res.redirect('/seller');
  res.render('seller/register', { title: 'Đăng ký bán hàng', form: req.shop || {} });
});
router.post('/register', requireLogin, async (req, res, next) => {
  try {
    if (req.user.role === 'admin') { req.flash('error', 'Tài khoản admin không mở shop.'); return res.redirect('/'); }
    const { name, description, address, city, phone } = req.body;
    if (!name || name.trim().length < 3) { req.flash('error', 'Tên shop tối thiểu 3 ký tự.'); return res.redirect('/seller/register'); }
    if (await Shop.exists({ name: new RegExp('^' + escapeRegex(name.trim()) + '$', 'i'), owner: { $ne: req.user._id } })) {
      req.flash('error', 'Tên shop đã tồn tại.'); return res.redirect('/seller/register');
    }
    let shop = req.shop || await Shop.findOne({ owner: req.user._id });
    if (!shop) shop = new Shop({ owner: req.user._id, slug: slugify(name) + '-' + Date.now().toString(36), color: COLORS[Math.floor(Math.random() * COLORS.length)] });
    Object.assign(shop, { name: name.trim(), description, address, city, phone, offersCustom: req.body.offersCustom === 'on' });
    if (shop.status !== 'active') shop.status = 'pending';
    await shop.save();
    req.user.role = 'seller';
    await req.user.save();
    req.flash('success', 'Đã gửi hồ sơ mở shop. Quản trị viên sẽ duyệt trong 24h.');
    res.redirect('/seller');
  } catch (e) { next(e); }
});

router.use(requireShop);

// ---------- Bảng điều khiển ----------
router.get('/', async (req, res, next) => {
  try {
    const sid = req.shop._id;
    const range = stats.parseRange({}, 14);
    const today = stats.parseRange({ from: range.toStr, to: range.toStr });
    const yRange = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
    const yesterday = stats.parseRange({ from: yRange, to: yRange });
    const [chart, t, y, newOrders, processing, lowStock, pendingProducts, unreplied, recent, types, top, nearDue] = await Promise.all([
      stats.series({ shop: sid }, range),
      stats.series({ shop: sid }, today),
      stats.series({ shop: sid }, yesterday),
      Order.countDocuments({ shop: sid, status: 'pending' }),
      Order.countDocuments({ shop: sid, status: 'processing' }),
      Product.find({ shop: sid }).select('stock lowStock').lean().then(ps => ps.filter(x => x.stock <= x.lowStock).length),
      Product.countDocuments({ shop: sid, status: 'pending' }),
      Review.countDocuments({ shop: sid, 'reply.content': { $exists: false } }),
      Order.find({ shop: sid }).sort({ createdAt: -1 }).limit(6).populate('user', 'name'),
      stats.byType({ shop: sid }, stats.parseRange({}, 30)),
      stats.topProducts({ shop: sid }, stats.parseRange({}, 30), 4),
      Order.countDocuments({ shop: sid, status: 'processing', 'customRequest.respondedAt': { $lte: new Date(Date.now() - 3 * 86400e3) } })
    ]);
    const weekLoad = await Order.countDocuments({ shop: sid, isCustom: true, status: 'processing' });
    res.render('seller/dashboard', {
      title: 'Bảng điều khiển', active: 'dash', chart, t, y, newOrders, processing, lowStock, pendingProducts, unreplied, recent, types, top, nearDue, weekLoad
    });
  } catch (e) { next(e); }
});

// ---------- Đơn hàng ----------
router.get('/orders', async (req, res, next) => {
  try {
    const st = req.query.status || 'all';
    const filter = { shop: req.shop._id };
    if (st !== 'all') filter.status = st;
    if (req.query.type === 'custom') filter.isCustom = true;
    if (req.query.type === 'normal') filter.isCustom = false;
    if (req.query.q) filter.code = new RegExp(escapeRegex(req.query.q.replace('#', '')), 'i');
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const [orders, total, countsAgg] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).populate('user', 'name email'),
      Order.countDocuments(filter),
      Order.aggregate([{ $match: { shop: req.shop._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
    ]);
    const counts = {}; countsAgg.forEach(c => { counts[c._id] = c.n; });
    res.render('seller/orders', { title: 'Quản lý đơn hàng', active: 'orders', orders, st, counts, page, pages: Math.ceil(total / 20) });
  } catch (e) { next(e); }
});

router.get('/orders/:code', async (req, res, next) => {
  try {
    const order = await Order.findOne({ code: req.params.code, shop: req.shop._id }).populate('user', 'name email phone').populate('build');
    if (!order) return next();
    res.render('seller/order-detail', { title: `Đơn #${order.code}`, active: 'orders', order, NEXT });
  } catch (e) { next(e); }
});

// Cập nhật trạng thái đơn (Tự chọn 4)
router.post('/orders/:code/status', async (req, res, next) => {
  try {
    const order = await Order.findOne({ code: req.params.code, shop: req.shop._id });
    if (!order) return next();
    const to = req.body.status;
    if (!(NEXT[order.status] || []).includes(to) || to === 'completed') {
      req.flash('error', 'Không thể chuyển sang trạng thái này.');
      return res.redirect(`/seller/orders/${order.code}`);
    }
    if (order.isCustom && order.status === 'pending' && to === 'confirmed') {
      req.flash('error', 'Đơn custom cần xử lý ở mục "Đơn custom chờ xác nhận".');
      return res.redirect('/seller/custom');
    }
    if (to === 'cancelled') {
      await cancelOrder(order, 'seller', req.body.note || 'Shop huỷ đơn');
    } else {
      if (order.paymentMethod === 'vnpay' && order.paymentStatus !== 'paid' && to !== 'cancelled') {
        req.flash('error', 'Đơn chưa được thanh toán VNPay, chưa thể xử lý.');
        return res.redirect(`/seller/orders/${order.code}`);
      }
      order.status = to;
      if (to === 'shipping' && req.body.trackingCode) order.shipping.trackingCode = req.body.trackingCode;
      if (to === 'shipping' && !order.shipping.trackingCode) order.shipping.trackingCode = 'GHN' + Date.now().toString().slice(-9);
      if (to === 'delivered' && order.paymentMethod === 'cod') { order.paymentStatus = 'paid'; order.paidAt = new Date(); }
      order.history.push({ status: to, note: req.body.note || '', by: 'seller' });
      await order.save();
    }
    req.flash('success', `Đã cập nhật đơn #${order.code}: ${Order.STATUS[order.status].label}.`);
    res.redirect(req.body.back || `/seller/orders/${order.code}`);
  } catch (e) { next(e); }
});

// ---------- Tiếp nhận yêu cầu gia công (Đặc trưng 2) ----------
router.get('/custom', async (req, res, next) => {
  try {
    const orders = await Order.find({ shop: req.shop._id, isCustom: true, status: 'pending', 'customRequest.status': 'waiting' })
      .sort({ createdAt: 1 }).populate('user', 'name email phone').populate('build');
    const sel = orders.find(o => o.code === req.query.code) || orders[0];
    const history = await Order.find({ shop: req.shop._id, isCustom: true, 'customRequest.status': { $in: ['accepted', 'rejected'] } }).sort({ 'customRequest.respondedAt': -1 }).limit(8).populate('user', 'name');
    const load = await Order.countDocuments({ shop: req.shop._id, isCustom: true, status: 'processing' });
    res.render('seller/custom', { title: 'Đơn custom chờ xác nhận', active: 'custom', orders, sel, history, load });
  } catch (e) { next(e); }
});

router.post('/custom/:code/accept', async (req, res, next) => {
  try {
    const order = await Order.findOne({ code: req.params.code, shop: req.shop._id, isCustom: true, 'customRequest.status': 'waiting', status: 'pending' });
    if (!order) return next();
    if (order.paymentStatus !== 'paid') { req.flash('error', 'Khách chưa thanh toán đơn này.'); return res.redirect('/seller/custom'); }
    const svc = order.service && order.service.ref ? await CustomService.findById(order.service.ref) : null;
    const stages = (svc && svc.stages && svc.stages.length) ? svc.stages : CustomService.DEFAULT_STAGES;
    order.customRequest.status = 'accepted';
    order.customRequest.respondedAt = new Date();
    order.customRequest.note = req.body.note || '';
    order.customRequest.deadline = new Date(Date.now() + ((order.service && order.service.days) || 5) * 86400e3);
    order.progress = stages.map((name, i) => ({ name, status: i === 0 ? 'doing' : 'todo' }));
    order.status = 'processing';
    order.history.push({ status: 'processing', note: 'Shop đã nhận gia công' + (req.body.note ? ': ' + req.body.note : ''), by: 'seller' });
    await order.save();
    req.flash('success', `Đã nhận gia công đơn #${order.code}. Cập nhật tiến độ trong mục "Tiến độ gia công".`);
    res.redirect(`/seller/progress?code=${order.code}`);
  } catch (e) { next(e); }
});

router.post('/custom/:code/reject', async (req, res, next) => {
  try {
    const order = await Order.findOne({ code: req.params.code, shop: req.shop._id, isCustom: true, 'customRequest.status': 'waiting' });
    if (!order) return next();
    const reason = (req.body.reason || '').trim();
    if (!reason) { req.flash('error', 'Vui lòng nhập lý do từ chối.'); return res.redirect(`/seller/custom?code=${order.code}`); }
    order.customRequest.note = reason;
    await cancelOrder(order, 'seller', reason);
    req.flash('success', `Đã từ chối đơn #${order.code}${order.paymentStatus === 'refund_pending' ? ' — hệ thống sẽ hoàn tiền cho khách' : ''}.`);
    res.redirect('/seller/custom');
  } catch (e) { next(e); }
});

// ---------- Cập nhật tiến độ gia công (Đặc trưng 3) ----------
router.get('/progress', async (req, res, next) => {
  try {
    const queue = await Order.find({ shop: req.shop._id, isCustom: true, status: 'processing' }).sort({ 'customRequest.deadline': 1 }).populate('user', 'name').populate('build');
    const sel = queue.find(o => o.code === req.query.code) || queue[0];
    const done = await Order.find({ shop: req.shop._id, isCustom: true, status: { $in: ['shipping', 'delivered', 'completed'] } }).sort({ updatedAt: -1 }).limit(5).populate('user', 'name');
    res.render('seller/progress', { title: 'Tiến độ gia công', active: 'progress', queue, sel, done });
  } catch (e) { next(e); }
});

router.post('/progress/:code/stage/:sid', upload.array('photos', 6), async (req, res, next) => {
  try {
    const order = await Order.findOne({ code: req.params.code, shop: req.shop._id, isCustom: true, status: 'processing' });
    if (!order) return next();
    const st = order.progress.id(req.params.sid);
    if (!st) return next();
    st.note = String(req.body.note || st.note || '').slice(0, 1000);
    st.photos.push(...(req.files || []).map(f => '/uploads/' + f.filename));
    st.updatedAt = new Date();
    if (req.body.action === 'done') {
      st.status = 'done';
      st.doneAt = new Date();
      const idx = order.progress.findIndex(s => String(s._id) === String(st._id));
      const nxt = order.progress[idx + 1];
      if (nxt && nxt.status === 'todo') nxt.status = 'doing';
      order.history.push({ status: 'processing', note: `Hoàn thành công đoạn: ${st.name}`, by: 'seller' });
      if (order.progress.every(s => s.status === 'done')) {
        order.status = 'shipping';
        order.shipping.trackingCode = order.shipping.trackingCode || 'GHN' + Date.now().toString().slice(-9);
        order.history.push({ status: 'shipping', note: 'Gia công xong — đã bàn giao đơn vị vận chuyển', by: 'seller' });
      }
    } else if (st.status === 'todo') {
      st.status = 'doing';
    }
    await order.save();
    req.flash('success', req.body.action === 'done' ? `Đã hoàn thành "${st.name}" (${order.progressPercent}%).` : 'Đã lưu ghi chú công đoạn.');
    res.redirect(order.status === 'shipping' ? `/seller/orders/${order.code}` : `/seller/progress?code=${order.code}`);
  } catch (e) { next(e); }
});

// ---------- Sản phẩm ----------
router.get('/products', async (req, res, next) => {
  try {
    const filter = { shop: req.shop._id };
    const st = req.query.status || 'all';
    if (st !== 'all') filter.status = st;
    if (req.query.q) filter.name = new RegExp(escapeRegex(req.query.q), 'i');
    if (req.query.type) filter.partType = req.query.type;
    const [products, countsAgg] = await Promise.all([
      Product.find(filter).sort({ createdAt: -1 }).populate('category', 'name'),
      Product.aggregate([{ $match: { shop: req.shop._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
    ]);
    const counts = {}; countsAgg.forEach(c => { counts[c._id] = c.n; });
    res.render('seller/products', { title: 'Danh sách sản phẩm', active: 'products', products, st, counts });
  } catch (e) { next(e); }
});

function readProductForm(body) {
  const num = (v) => (v === '' || v === undefined ? undefined : Number(v));
  const specs = [];
  const ks = [].concat(body.specK || []), vs = [].concat(body.specV || []);
  ks.forEach((k, i) => { if (k && vs[i]) specs.push({ k: String(k).trim(), v: String(vs[i]).trim() }); });
  const pins = [].concat(body.pins || []).map(Number).filter(Boolean);
  const layouts = [].concat(body.layouts || []).filter(Boolean);
  return {
    name: String(body.name || '').trim(),
    sku: body.sku || '',
    price: num(body.price) || 0,
    oldPrice: num(body.oldPrice) || 0,
    stock: Math.max(0, num(body.stock) || 0),
    lowStock: num(body.lowStock) || 5,
    description: body.description || '',
    specs,
    art: { kind: body.artKind || undefined, color: body.artColor || '#4B5563', accent: body.artAccent || '#1B62F5', bg: body.artBg || '#E7EBF0' },
    attrs: {
      layout: body.layout || undefined,
      keyCount: num(body.keyCount),
      mount: body.mount || undefined,
      hotswap: body.hotswap === 'yes' ? true : body.hotswap === 'no' ? false : undefined,
      pins,
      ledDirection: body.ledDirection || undefined,
      stabMount: body.stabMount || undefined,
      switchType: body.switchType || undefined,
      force: num(body.force),
      profile: body.profile || undefined,
      layouts,
      material: body.material || undefined
    }
  };
}

router.get('/products/new', async (req, res) => {
  res.render('seller/product-form', { title: 'Thêm sản phẩm', active: 'new', p: null });
});

router.post('/products', upload.array('images', 6), async (req, res, next) => {
  try {
    const data = readProductForm(req.body);
    const cat = await Category.findById(req.body.category);
    if (!data.name || !cat || data.price <= 0) { req.flash('error', 'Vui lòng nhập tên, danh mục và giá bán hợp lệ.'); return res.redirect('/seller/products/new'); }
    const p = new Product({ ...data, shop: req.shop._id, category: cat._id, partType: cat.partType, slug: uniqueSlug(data.name), status: 'pending' });
    p.images = (req.files || []).map(f => '/uploads/' + f.filename);
    if (!p.art.kind) p.art.kind = { kit: 'kit', prebuilt: 'kit', switch: 'switch', keycap: 'keycap', stabilizer: 'stab', accessory: 'cable' }[cat.partType];
    await p.save();
    req.flash('success', 'Đã gửi sản phẩm. Sản phẩm sẽ hiển thị sau khi sàn duyệt.');
    res.redirect('/seller/products');
  } catch (e) { next(e); }
});

router.get('/products/:id/edit', async (req, res, next) => {
  const p = await Product.findOne({ _id: req.params.id, shop: req.shop._id });
  if (!p) return next();
  res.render('seller/product-form', { title: 'Sửa sản phẩm', active: 'products', p });
});

router.post('/products/:id', upload.array('images', 6), async (req, res, next) => {
  try {
    const p = await Product.findOne({ _id: req.params.id, shop: req.shop._id });
    if (!p) return next();
    const data = readProductForm(req.body);
    const cat = await Category.findById(req.body.category);
    if (!data.name || !cat || data.price <= 0) { req.flash('error', 'Thông tin chưa hợp lệ.'); return res.redirect(`/seller/products/${p._id}/edit`); }
    Object.assign(p, data, { category: cat._id, partType: cat.partType });
    if (!p.art.kind) p.art.kind = { kit: 'kit', prebuilt: 'kit', switch: 'switch', keycap: 'keycap', stabilizer: 'stab', accessory: 'cable' }[cat.partType];
    const removed = [].concat(req.body.removeImg || []);
    p.images = p.images.filter(i => !removed.includes(i)).concat((req.files || []).map(f => '/uploads/' + f.filename));
    if (p.status === 'rejected') p.status = 'pending';
    await p.save();
    req.flash('success', 'Đã cập nhật sản phẩm.');
    res.redirect('/seller/products');
  } catch (e) { next(e); }
});

router.post('/products/:id/toggle', async (req, res) => {
  const p = await Product.findOne({ _id: req.params.id, shop: req.shop._id });
  if (p && ['active', 'hidden'].includes(p.status)) { p.status = p.status === 'active' ? 'hidden' : 'active'; await p.save(); }
  res.redirect('back');
});

router.post('/products/:id/delete', async (req, res) => {
  const p = await Product.findOne({ _id: req.params.id, shop: req.shop._id });
  if (p) {
    const used = await Order.exists({ 'items.product': p._id });
    if (used) { p.status = 'hidden'; await p.save(); req.flash('info', 'Sản phẩm đã có đơn hàng nên được ẩn thay vì xoá.'); }
    else { await p.deleteOne(); req.flash('success', 'Đã xoá sản phẩm.'); }
  }
  res.redirect('/seller/products');
});

// ---------- Tồn kho ----------
router.get('/inventory', async (req, res) => {
  const filter = { shop: req.shop._id };
  let products = await Product.find(filter).sort({ stock: 1 });
  if (req.query.low === '1') products = products.filter(p => p.stock <= p.lowStock);
  res.render('seller/inventory', { title: 'Quản lý tồn kho', active: 'inventory', products });
});
router.post('/inventory', async (req, res) => {
  const stock = req.body.stock || {};
  const low = req.body.low || {};
  for (const id of Object.keys(stock)) {
    const v = parseInt(stock[id]);
    const l = parseInt(low[id]);
    const upd = {};
    if (!isNaN(v) && v >= 0) upd.stock = v;
    if (!isNaN(l) && l >= 0) upd.lowStock = l;
    if (Object.keys(upd).length) await Product.updateOne({ _id: id, shop: req.shop._id }, upd);
  }
  req.flash('success', 'Đã cập nhật tồn kho.');
  res.redirect('/seller/inventory');
});

// ---------- Quản lý dịch vụ custom (Đặc trưng 1) ----------
router.get('/services', async (req, res) => {
  const services = await CustomService.find({ shop: req.shop._id }).sort({ price: 1 });
  const edit = req.query.edit ? services.find(s => String(s._id) === req.query.edit) : null;
  const load = await Order.countDocuments({ shop: req.shop._id, isCustom: true, status: 'processing' });
  res.render('seller/services', { title: 'Dịch vụ gia công', active: 'services', services, edit, load, DEFAULT_STAGES: CustomService.DEFAULT_STAGES });
});
function readService(body) {
  return {
    name: String(body.name || '').trim(),
    description: body.description || '',
    price: Math.max(0, Number(body.price) || 0),
    days: Math.max(1, parseInt(body.days) || 5),
    includes: String(body.includes || '').split('\n').map(s => s.trim()).filter(Boolean),
    stages: String(body.stages || '').split('\n').map(s => s.trim()).filter(Boolean),
    soldering: body.soldering === 'on',
    lube: body.lube === 'on',
    active: body.active !== 'off'
  };
}
router.post('/services', async (req, res) => {
  const data = readService(req.body);
  if (!data.name || !data.price) { req.flash('error', 'Nhập tên gói và giá.'); return res.redirect('/seller/services'); }
  if (!data.stages.length) data.stages = CustomService.DEFAULT_STAGES;
  await CustomService.create({ ...data, shop: req.shop._id });
  if (!req.shop.offersCustom) { req.shop.offersCustom = true; await req.shop.save(); }
  req.flash('success', 'Đã thêm gói gia công.');
  res.redirect('/seller/services');
});
router.post('/services/settings', async (req, res) => {
  req.shop.offersCustom = req.body.offersCustom === 'on';
  const cap = parseInt(req.body.capacityPerWeek);
  req.shop.capacityPerWeek = Number.isNaN(cap) ? 10 : Math.min(100, Math.max(1, cap));
  await req.shop.save();
  req.flash('success', 'Đã lưu cài đặt xưởng.');
  res.redirect('/seller/services');
});
router.post('/services/:id', async (req, res) => {
  const data = readService(req.body);
  if (!data.stages.length) data.stages = CustomService.DEFAULT_STAGES;
  await CustomService.updateOne({ _id: req.params.id, shop: req.shop._id }, data);
  req.flash('success', 'Đã cập nhật gói gia công.');
  res.redirect('/seller/services');
});
router.post('/services/:id/toggle', async (req, res) => {
  const s = await CustomService.findOne({ _id: req.params.id, shop: req.shop._id });
  if (s) { s.active = !s.active; await s.save(); }
  res.redirect('/seller/services');
});
router.post('/services/:id/delete', async (req, res) => {
  await CustomService.deleteOne({ _id: req.params.id, shop: req.shop._id });
  req.flash('success', 'Đã xoá gói.');
  res.redirect('/seller/services');
});

// ---------- Đánh giá & hỏi đáp (Trả lời bình luận — Tự chọn 5) ----------
router.get('/reviews', async (req, res) => {
  const tab = req.query.tab === 'qa' ? 'qa' : 'reviews';
  const filter = { shop: req.shop._id };
  if (req.query.f === 'unreplied') filter['reply.content'] = { $exists: false };
  if (req.query.star) filter.rating = Number(req.query.star);
  const [reviews, comments, dist] = await Promise.all([
    Review.find(filter).sort({ createdAt: -1 }).limit(50).populate('user', 'name color').populate('product', 'name slug images art partType'),
    Comment.find({ shop: req.shop._id }).sort({ createdAt: -1 }).limit(50).populate('user', 'name color').populate('product', 'name slug'),
    Review.aggregate([{ $match: { shop: req.shop._id } }, { $group: { _id: '$rating', n: { $sum: 1 } } }])
  ]);
  const d = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; dist.forEach(x => { d[x._id] = x.n; });
  res.render('seller/reviews', { title: 'Đánh giá & phản hồi', active: 'reviews', reviews, comments, tab, dist: d });
});
router.post('/reviews/:id/reply', async (req, res) => {
  const content = String(req.body.content || '').trim();
  if (content) await Review.updateOne({ _id: req.params.id, shop: req.shop._id }, { reply: { content: content.slice(0, 1000), at: new Date() } });
  req.flash('success', 'Đã phản hồi đánh giá.');
  res.redirect('/seller/reviews');
});

// ---------- Doanh thu (biểu đồ cột theo khoảng ngày + biểu đồ tròn) ----------
router.get('/revenue', async (req, res, next) => {
  try {
    const range = stats.parseRange(req.query, 30);
    const m = { shop: req.shop._id };
    const [chart, types, cats, status, top] = await Promise.all([
      stats.series(m, range), stats.byType(m, range), stats.byCategory(m, range), stats.byStatus(m, range), stats.topProducts(m, range, 8)
    ]);
    res.render('seller/revenue', { title: 'Doanh thu & phí', active: 'revenue', range, chart, types, cats, status, top, FEE: stats.PLATFORM_FEE });
  } catch (e) { next(e); }
});

// ---------- Hồ sơ shop ----------
router.get('/profile', (req, res) => res.render('seller/profile', { title: 'Hồ sơ shop', active: 'profile' }));
router.post('/profile', async (req, res) => {
  const { name, description, address, city, phone, color } = req.body;
  if (name && name.trim().length >= 3) req.shop.name = name.trim();
  Object.assign(req.shop, { description, address, city, phone });
  if (/^#[0-9a-fA-F]{6}$/.test(color || '')) req.shop.color = color;
  await req.shop.save();
  req.flash('success', 'Đã lưu hồ sơ shop.');
  res.redirect('/seller/profile');
});

module.exports = router;
