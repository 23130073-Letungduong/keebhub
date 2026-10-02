const router = require('express').Router();
const { User, Order, Review, Build, Product, Shop } = require('../models');
const { requireLogin } = require('../middleware/auth');
const upload = require('../config/upload');
const { cancelOrder, canCustomerCancel, recalcRating } = require('../utils/orders');
const { buildTotal } = require('../utils/cart');

router.use(requireLogin);

async function sideCounts(req, res, next) {
  const [orders, builds, toReview] = await Promise.all([
    Order.countDocuments({ user: req.user._id, status: { $in: ['pending', 'confirmed', 'processing', 'shipping'] } }),
    Build.countDocuments({ user: req.user._id, status: { $ne: 'ordered' } }),
    Order.countDocuments({ user: req.user._id, status: { $in: ['delivered', 'completed'] }, 'items.reviewed': false })
  ]);
  res.locals.side = { orders, builds, toReview };
  next();
}
router.use(sideCounts);

// ---------- Hồ sơ cá nhân (Tự chọn 3) ----------
router.get('/', async (req, res) => {
  const [orderCount, spent, reviewCount] = await Promise.all([
    Order.countDocuments({ user: req.user._id }),
    Order.aggregate([{ $match: { user: req.user._id, status: { $ne: 'cancelled' } } }, { $group: { _id: null, t: { $sum: '$total' } } }]),
    Review.countDocuments({ user: req.user._id })
  ]);
  res.render('account/profile', { title: 'Hồ sơ cá nhân', active: 'profile', stats: { orderCount, spent: spent[0] ? spent[0].t : 0, reviewCount } });
});

router.post('/profile', upload.single('avatar'), async (req, res, next) => {
  try {
    const f = (k, n = 200) => String(req.body[k] == null ? '' : req.body[k]).trim().slice(0, n);
    const name = f('name', 80), phone = f('phone', 15), gender = f('gender'), birthday = f('birthday', 10), fullName = f('fullName', 80), addrPhone = f('addrPhone', 15), line = f('line', 300);
    const PHONE = /^0\d{9,10}$/;
    if (name.length < 2) { req.flash('error', 'Họ tên không hợp lệ.'); return res.redirect('/account'); }
    if (phone && !PHONE.test(phone)) { req.flash('error', 'Số điện thoại không hợp lệ.'); return res.redirect('/account'); }
    if (addrPhone && !PHONE.test(addrPhone)) { req.flash('error', 'Số điện thoại người nhận không hợp lệ.'); return res.redirect('/account'); }
    let bday;
    if (birthday) {
      bday = new Date(birthday);
      if (isNaN(bday) || bday > new Date() || bday.getFullYear() < 1900) { req.flash('error', 'Ngày sinh không hợp lệ.'); return res.redirect('/account'); }
    }
    if (phone && phone !== req.user.phone && await User.exists({ phone, _id: { $ne: req.user._id } })) { req.flash('error', 'Số điện thoại đã được tài khoản khác sử dụng.'); return res.redirect('/account'); }
    req.user.name = name;
    req.user.phone = phone;
    req.user.gender = ['male', 'female', 'other'].includes(gender) ? gender : '';
    req.user.birthday = bday;
    req.user.address = { fullName, phone: addrPhone, line };
    if (req.file) req.user.avatar = '/uploads/' + req.file.filename;
    await req.user.save();
    req.flash('success', 'Đã cập nhật thông tin cá nhân.');
    res.redirect('/account');
  } catch (e) { next(e); }
});

router.post('/password', async (req, res, next) => {
  try {
    const { current, password, confirm } = req.body;
    if (req.user.password && !(await req.user.checkPassword(current || ''))) {
      req.flash('error', 'Mật khẩu hiện tại không đúng.'); return res.redirect('/account#security');
    }
    if (!password || password.length < 8 || password !== confirm) {
      req.flash('error', 'Mật khẩu mới tối thiểu 8 ký tự và phải khớp.'); return res.redirect('/account#security');
    }
    await req.user.setPassword(password);
    await req.user.save();
    req.flash('success', 'Đã đổi mật khẩu.');
    res.redirect('/account');
  } catch (e) { next(e); }
});

// ---------- Lịch sử mua hàng ----------
const TABS = {
  all: {}, pending: { status: 'pending' }, confirmed: { status: 'confirmed' }, processing: { status: 'processing' },
  shipping: { status: 'shipping' }, done: { status: { $in: ['delivered', 'completed'] } }, cancelled: { status: 'cancelled' }
};
router.get('/orders', async (req, res, next) => {
  try {
    const tab = TABS[req.query.tab] ? req.query.tab : 'all';
    const filter = { user: req.user._id, ...TABS[tab] };
    const [orders, countsAgg] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).limit(50).populate('shop', 'name slug color'),
      Order.aggregate([{ $match: { user: req.user._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
    ]);
    const counts = {}; countsAgg.forEach(c => { counts[c._id] = c.n; });
    res.render('account/orders', { title: 'Đơn hàng của tôi', active: 'orders', orders, tab, counts, canCancel: canCustomerCancel });
  } catch (e) { next(e); }
});

router.get('/orders/:code', async (req, res, next) => {
  try {
    const order = await Order.findOne({ code: req.params.code, user: req.user._id }).populate('shop').populate('build');
    if (!order) return next();
    res.render('account/order-detail', { title: `Đơn hàng #${order.code}`, active: 'orders', order, canCancel: canCustomerCancel(order) });
  } catch (e) { next(e); }
});

// Huỷ đơn hàng (Tự chọn 8)
router.post('/orders/:code/cancel', async (req, res, next) => {
  try {
    const order = await Order.findOne({ code: req.params.code, user: req.user._id });
    if (!order) return next();
    if (!canCustomerCancel(order)) {
      req.flash('error', order.isCustom ? 'Shop đã nhận gia công, không thể tự huỷ. Vui lòng gửi khiếu nại tới shop/admin.' : 'Đơn đã giao cho đơn vị vận chuyển, không thể huỷ.');
      return res.redirect(`/account/orders/${order.code}`);
    }
    await cancelOrder(order, 'customer', (req.body.reason || '').slice(0, 300));
    req.flash('success', order.paymentStatus === 'refund_pending' ? 'Đã huỷ đơn. Tiền sẽ được hoàn về tài khoản trong 3-5 ngày làm việc.' : 'Đã huỷ đơn hàng.');
    res.redirect(`/account/orders/${order.code}`);
  } catch (e) { next(e); }
});

router.post('/orders/:code/received', async (req, res, next) => {
  try {
    const order = await Order.findOne({ code: req.params.code, user: req.user._id });
    if (!order) return next();
    if (['shipping', 'delivered'].includes(order.status)) {
      order.status = 'completed';
      if (order.paymentMethod === 'cod') { order.paymentStatus = 'paid'; order.paidAt = new Date(); }
      order.history.push({ status: 'completed', note: 'Khách xác nhận đã nhận hàng', by: 'customer' });
      await order.save();
      req.flash('success', 'Cảm ơn bạn! Hãy đánh giá sản phẩm để giúp người mua khác nhé.');
    }
    res.redirect(`/account/orders/${order.code}`);
  } catch (e) { next(e); }
});

// ---------- Đánh giá sản phẩm đã mua (Tự chọn 7) ----------
router.get('/orders/:code/review', async (req, res, next) => {
  try {
    const order = await Order.findOne({ code: req.params.code, user: req.user._id, status: { $in: ['delivered', 'completed'] } }).populate('shop', 'name');
    if (!order) { req.flash('error', 'Chỉ đánh giá được đơn đã giao.'); return res.redirect('/account/orders'); }
    res.render('account/review', { title: 'Đánh giá sản phẩm', active: 'reviews', order });
  } catch (e) { next(e); }
});

router.post('/orders/:code/review/:itemId', upload.array('images', 5), async (req, res, next) => {
  try {
    const order = await Order.findOne({ code: req.params.code, user: req.user._id, status: { $in: ['delivered', 'completed'] } });
    if (!order) return next();
    const item = order.items.id(req.params.itemId);
    if (!item || item.reviewed || !item.product) { req.flash('error', 'Sản phẩm đã được đánh giá.'); return res.redirect(`/account/orders/${order.code}/review`); }
    const rating = Math.min(5, Math.max(1, parseInt(req.body.rating) || 5));
    await Review.create({
      product: item.product, shop: order.shop, user: req.user._id, order: order._id, rating,
      content: String(req.body.content || '').slice(0, 2000), images: (req.files || []).map(f => '/uploads/' + f.filename)
    });
    item.reviewed = true;
    await order.save();
    await recalcRating(item.product);
    req.flash('success', 'Cảm ơn bạn đã đánh giá!');
    res.redirect(`/account/orders/${order.code}/review`);
  } catch (e) { next(e); }
});

router.get('/reviews', async (req, res, next) => {
  try {
    const [reviews, pending] = await Promise.all([
      Review.find({ user: req.user._id }).sort({ createdAt: -1 }).populate('product', 'name slug images art partType'),
      Order.find({ user: req.user._id, status: { $in: ['delivered', 'completed'] }, 'items.reviewed': false }).sort({ createdAt: -1 }).populate('shop', 'name')
    ]);
    res.render('account/reviews', { title: 'Đánh giá của tôi', active: 'reviews', reviews, pending });
  } catch (e) { next(e); }
});

// ---------- Cấu hình đã lưu ----------
router.get('/builds', async (req, res, next) => {
  try {
    const builds = await Build.find({ user: req.user._id }).sort({ updatedAt: -1 }).populate('kit switch keycap stab').populate({ path: 'service', populate: { path: 'shop', select: 'name' } });
    res.render('account/builds', { title: 'Cấu hình đã lưu', active: 'builds', builds, buildTotal });
  } catch (e) { next(e); }
});
router.post('/builds/:id/delete', async (req, res) => {
  await Build.deleteOne({ _id: req.params.id, user: req.user._id, status: { $ne: 'ordered' } });
  req.user.cart = req.user.cart.filter(i => String(i.build) !== req.params.id);
  await req.user.save();
  req.flash('success', 'Đã xoá cấu hình.');
  res.redirect('/account/builds');
});

router.get('/wishlist', async (req, res) => {
  const live = (await Shop.find({ status: 'active' }).select('_id')).map(s => s._id);
  const items = await Product.find({ _id: { $in: req.user.wishlist }, status: 'active', shop: { $in: live } }).populate('shop', 'name slug');
  res.render('account/wishlist', { title: 'Sản phẩm yêu thích', active: 'wishlist', items });
});

module.exports = router;
