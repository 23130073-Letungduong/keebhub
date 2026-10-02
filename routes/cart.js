const router = require('express').Router();
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Product, Order, Build, CustomService } = require('../models');
const { requireLogin } = require('../middleware/auth');
const { loadCart, shipFee, SHIP, FREE_SHIP_FROM } = require('../utils/cart');
const compat = require('../utils/compat');
const mailer = require('../utils/mailer');

// ---------- Giỏ hàng ----------
router.get('/cart', requireLogin, async (req, res, next) => {
  try {
    const cart = await loadCart(req.user._id);
    if (cart.invalid.length) {
      cart.user.cart = cart.user.cart.filter(i => !cart.invalid.includes(i));
      await cart.user.save();
    }
    res.render('cart/cart', { title: 'Giỏ hàng', cart, FREE_SHIP_FROM });
  } catch (e) { next(e); }
});

router.post('/cart/add', requireLogin, async (req, res, next) => {
  try {
    const pid = String(req.body.productId || '');
    const p = mongoose.isValidObjectId(pid) ? await Product.findById(pid).populate('shop') : null;
    const wantsJson = req.xhr || (req.headers.accept || '').includes('json');
    if (!p || p.status !== 'active' || p.shop.status !== 'active') {
      if (wantsJson) return res.status(400).json({ error: 'Sản phẩm không khả dụng' });
      req.flash('error', 'Sản phẩm không khả dụng.'); return res.redirect('back');
    }
    if (req.shop && String(req.shop._id) === String(p.shop._id)) {
      req.flash('error', 'Bạn không thể mua sản phẩm của chính shop mình.'); return res.redirect('back');
    }
    const qty = Math.max(1, parseInt(req.body.qty) || 1);
    const line = req.user.cart.find(i => i.product && String(i.product) === String(p._id));
    const newQty = (line ? line.qty : 0) + qty;
    if (newQty > p.stock) {
      if (wantsJson) return res.status(400).json({ error: `Chỉ còn ${p.stock} sản phẩm` });
      req.flash('error', `Kho chỉ còn ${p.stock} sản phẩm.`); return res.redirect('back');
    }
    if (line) line.qty = newQty; else req.user.cart.push({ product: p._id, qty });
    await req.user.save();
    if (req.body.buy) return res.redirect('/checkout');
    if (wantsJson) return res.json({ ok: true, count: req.user.cart.reduce((s, i) => s + (i.build ? 1 : i.qty), 0) });
    req.flash('success', 'Đã thêm vào giỏ hàng.');
    res.redirect('back');
  } catch (e) { next(e); }
});

router.post('/cart/update/:id', requireLogin, async (req, res, next) => {
  try {
  const it = mongoose.isValidObjectId(req.params.id) ? req.user.cart.id(req.params.id) : null;
  if (it && it.product) {
    const p = await Product.findById(it.product);
    let qty = parseInt(req.body.qty) || 1;
    if (req.body.op === 'inc') qty = it.qty + 1;
    if (req.body.op === 'dec') qty = it.qty - 1;
    if (qty < 1) qty = 1;
    if (p && qty > p.stock) { qty = p.stock; req.flash('error', `Kho chỉ còn ${p.stock} sản phẩm.`); }
    it.qty = Math.max(1, qty);
    await req.user.save();
  }
  res.redirect('/cart');
  } catch (e) { next(e); }
});

router.post('/cart/remove/:id', requireLogin, async (req, res, next) => {
  try {
    const it = mongoose.isValidObjectId(req.params.id) ? req.user.cart.id(req.params.id) : null;
    if (it) {
      if (it.build) await Build.updateOne({ _id: it.build, status: 'draft' }, { status: 'saved' });
      // Gán lại cả mảng (lệnh $set) thay vì $pull có điều kiện → chạy được trên mọi phiên bản MongoDB
      req.user.cart = req.user.cart.filter(x => String(x._id) !== String(it._id));
      await req.user.save();
    }
    req.flash('success', 'Đã xoá khỏi giỏ hàng.');
    res.redirect('/cart');
  } catch (e) { next(e); }
});

// ---------- Đặt hàng ----------
router.get('/checkout', requireLogin, async (req, res, next) => {
  try {
    const cart = await loadCart(req.user._id);
    if (!cart.groups.length) { req.flash('info', 'Giỏ hàng đang trống.'); return res.redirect('/cart'); }
    const method = req.query.ship === 'express' ? 'express' : 'standard';
    cart.groups.forEach(g => { g.ship = shipFee(g.subtotal, method); });
    const shipTotal = cart.groups.reduce((s, g) => s + g.ship, 0);
    res.render('cart/checkout', { title: 'Thanh toán', cart, SHIP, method, shipTotal });
  } catch (e) { next(e); }
});

router.post('/checkout', requireLogin, async (req, res, next) => {
  const created = [];
  const decremented = [];
  try {
    const cart = await loadCart(req.user._id);
    if (!cart.groups.length) return res.redirect('/cart');
    const { fullName, phone, address, note } = req.body;
    const method = req.body.ship === 'express' ? 'express' : 'standard';
    let payment = req.body.payment === 'cod' ? 'cod' : 'vnpay';
    if (!fullName || !phone || !address || !/^0\d{9,10}$/.test(String(phone).trim())) {
      req.flash('error', 'Vui lòng nhập đầy đủ họ tên, số điện thoại hợp lệ và địa chỉ nhận hàng.');
      return res.redirect('/checkout');
    }
    if (cart.hasCustom && payment === 'cod') {
      req.flash('error', 'Đơn gia công custom không hỗ trợ COD. Vui lòng chọn VNPay.');
      return res.redirect('/checkout');
    }
    // Kiểm tra tồn kho + tương thích trước khi tạo đơn
    for (const g of cart.groups) {
      for (const i of g.items) if (i.qty > i.product.stock) { req.flash('error', `"${i.product.name}" chỉ còn ${i.product.stock} sản phẩm.`); return res.redirect('/cart'); }
      for (const b of g.builds) {
        if (b.outOfStock) { req.flash('error', `Build #${b.build.code} có linh kiện đã hết hàng.`); return res.redirect('/cart'); }
        const r = await compat.check({ kit: b.build.kit, sw: b.build.switch, keycap: b.build.keycap, stab: b.build.stab, service: b.build.service, qty: b.build.switchQty, step: 5 });
        if (!r.ok) { req.flash('error', `Build #${b.build.code} có linh kiện không tương thích. Mở lại Custom Builder để sửa.`); return res.redirect('/cart'); }
      }
    }
    // Lưu địa chỉ mặc định
    req.user.address = { fullName: fullName.trim(), phone: phone.trim(), line: address.trim() };

    const group = 'PG' + Date.now() + crypto.randomBytes(2).toString('hex').toUpperCase();
    const shipping = { fullName: fullName.trim(), phone: phone.trim(), address: address.trim(), method };
    const dec = async (productId, qty) => {
      const r = await Product.updateOne({ _id: productId, stock: { $gte: qty } }, { $inc: { stock: -qty, sold: qty } });
      if (!r.modifiedCount) throw new Error('Một sản phẩm vừa hết hàng, vui lòng kiểm tra lại giỏ.');
      decremented.push({ productId, qty });
    };

    for (const g of cart.groups) {
      let shipLeft = shipFee(g.subtotal, method);
      // Đơn hàng lẻ
      if (g.items.length) {
        for (const i of g.items) await dec(i.product._id, i.qty);
        const subtotal = g.items.reduce((s, i) => s + i.total, 0);
        const o = await Order.create({
          user: req.user._id, shop: g.shop._id, paymentMethod: payment, paymentGroup: group, shipping, note,
          items: g.items.map(i => ({ product: i.product._id, name: i.product.name, image: i.product.image, partType: i.product.partType, price: i.product.price, qty: i.qty })),
          subtotal, shippingFee: shipLeft, total: subtotal + shipLeft,
          history: [{ status: 'pending', note: 'Đặt hàng thành công', by: 'customer' }]
        });
        shipLeft = 0;
        created.push(o);
      }
      // Mỗi build -> 1 đơn gia công custom (Tiếp nhận yêu cầu gia công — Đặc trưng 2)
      for (const b of g.builds) {
        for (const l of b.lines) await dec(l.product._id, l.qty);
        const svc = b.build.service;
        const o = await Order.create({
          user: req.user._id, shop: g.shop._id, paymentMethod: 'vnpay', paymentGroup: group, shipping, note: [note, b.build.note].filter(Boolean).join(' | '),
          isCustom: true, build: b.build._id, buildCode: b.build.code,
          service: { ref: svc._id, name: svc.name, price: svc.price, days: svc.days },
          customRequest: { status: 'waiting', deadline: new Date(Date.now() + 24 * 3600e3) },
          items: b.lines.map(l => ({ product: l.product._id, name: l.product.name + (l.note ? ` (${l.note})` : ''), image: l.product.image, partType: l.product.partType, price: l.product.price, qty: l.qty, role: l.role })),
          subtotal: b.parts, serviceFee: b.service, shippingFee: shipLeft, total: b.total + shipLeft,
          history: [{ status: 'pending', note: 'Gửi yêu cầu gia công tới shop', by: 'customer' }]
        });
        shipLeft = 0;
        await Build.updateOne({ _id: b.build._id }, { status: 'ordered' });
        await CustomService.updateOne({ _id: svc._id }, { $inc: { orders: 1 } });
        created.push(o);
      }
    }
    req.user.cart = [];
    await req.user.save();

    if (payment === 'vnpay') return res.redirect(`/payment/vnpay/${group}`);
    mailer.sendOrder(req.user, created, `${process.env.BASE_URL || 'http://localhost:3000'}/account/orders`).catch(() => {});
    res.redirect(`/payment/result/${group}`);
  } catch (e) {
    // hoàn tác nếu lỗi giữa chừng
    for (const d of decremented) await Product.updateOne({ _id: d.productId }, { $inc: { stock: d.qty, sold: -d.qty } });
    if (created.length) await Order.deleteMany({ _id: { $in: created.map(o => o._id) } });
    if (/hết hàng/.test(e.message)) { req.flash('error', e.message); return res.redirect('/cart'); }
    next(e);
  }
});

module.exports = router;
