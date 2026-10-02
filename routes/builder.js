// Custom Builder — Tùy chỉnh cấu hình custom (Đặc trưng 4) + Kiểm tra tương thích (Đặc trưng 5)
const router = require('express').Router();
const { isValidObjectId } = require('mongoose');
const { Build, Product, CustomService, Shop, Order } = require('../models');
const { requireLogin } = require('../middleware/auth');
const compat = require('../utils/compat');
const { buildTotal, buildLines } = require('../utils/cart');

router.use(requireLogin);

const STEPS = [
  { n: 1, key: 'kit', label: 'Kit' },
  { n: 2, key: 'switch', label: 'Switch' },
  { n: 3, key: 'keycap', label: 'Keycap & Stab' },
  { n: 4, key: 'service', label: 'Gia công' },
  { n: 5, key: 'review', label: 'Xem lại' }
];

async function currentBuild(req) {
  let b = null;
  if (req.session.buildId) b = await Build.findOne({ _id: req.session.buildId, user: req.user._id, status: { $ne: 'ordered' } });
  if (!b) {
    b = await Build.create({ user: req.user._id, status: 'draft', name: 'Build ' + new Date().toLocaleDateString('vi-VN') });
    req.session.buildId = String(b._id);
  }
  return b;
}
async function populated(b) {
  return Build.findById(b._id).populate('kit switch keycap stab').populate({ path: 'service', populate: { path: 'shop', select: 'name slug color' } });
}
function partsOf(b, step) {
  return { kit: b.kit, sw: b.switch, keycap: b.keycap, stab: b.stab, service: b.service, qty: b.switchQty, step };
}
async function refresh(b) {
  const p = await populated(b);
  const res = await compat.check(partsOf(p, 5));
  p.compat = res;
  p.total = buildTotal(p).total;
  await p.save();
  return p;
}
async function activeShopIds() {
  return (await Shop.find({ status: 'active' }).select('_id')).map(s => s._id);
}

router.get('/new', async (req, res) => {
  req.session.buildId = null;
  const b = await currentBuild(req);
  if (req.query.kit && isValidObjectId(String(req.query.kit))) {
    const kit = await Product.findOne({ _id: req.query.kit, partType: 'kit', status: 'active' });
    if (kit) {
      b.kit = kit._id;
      b.switchQty = Math.ceil((kit.attrs.keyCount || 60) / 10) * 10;
      await b.save();
      return res.redirect('/builder?step=2');
    }
  }
  res.redirect('/builder?step=1');
});

router.get('/edit/:id', async (req, res) => {
  const b = isValidObjectId(req.params.id) ? await Build.findOne({ _id: req.params.id, user: req.user._id, status: { $ne: 'ordered' } }) : null;
  if (!b) { req.flash('error', 'Không tìm thấy cấu hình.'); return res.redirect('/account/builds'); }
  req.session.buildId = String(b._id);
  res.redirect('/builder?step=5');
});

router.get('/', async (req, res, next) => {
  try {
    const raw = await currentBuild(req);
    const b = await populated(raw);
    let step = parseInt(req.query.step) || (b.kit ? (b.switch ? (b.keycap ? (b.service ? 5 : 4) : 3) : 2) : 1);
    if (step > 1 && !b.kit) step = 1;
    const onlyOk = req.query.all !== '1';
    const f = req.query.f || '';
    const shopIds = await activeShopIds();
    const base = { status: 'active', shop: { $in: shopIds }, stock: { $gt: 0 } };
    const parts = partsOf(b, step);

    let groups = [];
    async function options(role, partType, extra = {}, label) {
      const items = await Product.find({ ...base, partType, ...extra }).sort({ sold: -1 }).limit(24).populate('shop', 'name');
      const list = [];
      for (const p of items) {
        const r = await compat.checkCandidate(parts, role, p);
        list.push({ p, ...r });
      }
      const blocked = list.filter(x => x.blocked).length;
      list.sort((a, c) => (a.blocked ? 1 : 0) - (c.blocked ? 1 : 0));
      groups.push({ role, label, list: onlyOk ? list.filter(x => !x.blocked).concat(list.filter(x => x.blocked).slice(0, 2)) : list, blocked, total: list.length });
    }

    if (step === 1) {
      const extra = {};
      if (f) extra['attrs.layout'] = f;
      await options('kit', 'kit', extra, 'Kit bàn phím');
    } else if (step === 2) {
      const extra = {};
      if (f) extra['attrs.switchType'] = f;
      await options('sw', 'switch', extra, 'Switch');
    } else if (step === 3) {
      const extra = {};
      if (f) extra['attrs.profile'] = f;
      await options('keycap', 'keycap', extra, 'Keycap');
      await options('stab', 'stabilizer', {}, 'Stabilizer');
    }

    let services = [];
    if (step === 4) {
      const shops = await Shop.find({ status: 'active', offersCustom: true });
      const svc = await CustomService.find({ active: true, shop: { $in: shops.map(s => s._id) } }).populate('shop', 'name slug color capacityPerWeek rating');
      const load = await Order.aggregate([{ $match: { isCustom: true, status: { $in: ['pending', 'processing'] } } }, { $group: { _id: '$shop', n: { $sum: 1 } } }]);
      const lm = {}; load.forEach(l => { lm[String(l._id)] = l.n; });
      for (const s of svc) {
        const r = await compat.checkCandidate(parts, 'service', s);
        services.push({ s, ...r, load: lm[String(s.shop._id)] || 0 });
      }
      services.sort((a, c) => (a.warn ? 1 : 0) - (c.warn ? 1 : 0) || a.s.price - c.s.price);
    }

    const result = await compat.check(parts);
    const totals = buildTotal(b);
    res.render('builder/builder', {
      title: 'Custom Builder', b, step, STEPS, groups, services, result, totals, lines: buildLines(b), onlyOk, f
    });
  } catch (e) { next(e); }
});

router.post('/select', async (req, res, next) => {
  try {
    const b = await currentBuild(req);
    const role = req.body.role;
    const map = { kit: 'kit', sw: 'switch', keycap: 'keycap', stab: 'stab' };
    const field = map[role];
    if (!field) return res.redirect('/builder');
    const p = isValidObjectId(String(req.body.productId || '')) ? await Product.findOne({ _id: req.body.productId, status: 'active' }) : null;
    if (!p) { req.flash('error', 'Sản phẩm không khả dụng.'); return res.redirect('back'); }
    b[field] = p._id;
    if (field === 'kit') b.switchQty = Math.ceil((p.attrs.keyCount || 60) / 10) * 10;
    if (field === 'switch' && b.kit) {
      const kit = await Product.findById(b.kit);
      b.switchQty = Math.max(b.switchQty || 0, Math.ceil(((kit && kit.attrs.keyCount) || 60) / 10) * 10);
    }
    await b.save();
    const fresh = await refresh(b);
    const nextStep = { kit: 2, switch: 3, keycap: 3, stab: 3 }[field];
    const blocking = fresh.compat.issues.filter(i => i.level === 'block');
    if (blocking.length) req.flash('error', 'Cấu hình hiện có linh kiện không tương thích: ' + blocking[0].message);
    const stay = parseInt(req.body.stay);
    res.redirect(`/builder?step=${stay >= 1 && stay <= 5 ? stay : nextStep}`);
  } catch (e) { next(e); }
});

router.post('/qty', async (req, res) => {
  const b = await currentBuild(req);
  b.switchQty = Math.max(10, Math.ceil((parseInt(req.body.qty) || 10) / 10) * 10);
  await b.save();
  await refresh(b);
  res.redirect('back');
});

router.post('/clear', async (req, res) => {
  const b = await currentBuild(req);
  const map = { kit: 'kit', sw: 'switch', keycap: 'keycap', stab: 'stab', service: 'service' };
  if (map[req.body.role]) b[map[req.body.role]] = undefined;
  await b.save();
  await refresh(b);
  res.redirect('back');
});

router.post('/service', async (req, res, next) => {
  try {
    const b = await currentBuild(req);
    const s = isValidObjectId(String(req.body.serviceId || '')) ? await CustomService.findOne({ _id: req.body.serviceId, active: true }).populate('shop') : null;
    if (!s || s.shop.status !== 'active') { req.flash('error', 'Gói gia công không khả dụng.'); return res.redirect('/builder?step=4'); }
    b.service = s._id;
    await b.save();
    await refresh(b);
    res.redirect('/builder?step=5');
  } catch (e) { next(e); }
});

router.post('/save', async (req, res) => {
  const b = await currentBuild(req);
  if (req.body.name) b.name = String(req.body.name).slice(0, 80);
  if (req.body.note !== undefined) b.note = String(req.body.note).slice(0, 500);
  b.status = 'saved';
  await b.save();
  await refresh(b);
  req.flash('success', `Đã lưu cấu hình #${b.code}. Xem lại trong mục "Cấu hình đã lưu".`);
  res.redirect('back');
});

// Thêm build vào giỏ & đặt hàng
router.post('/cart', async (req, res, next) => {
  try {
    const raw = await currentBuild(req);
    if (req.body.note !== undefined) { raw.note = String(req.body.note).slice(0, 500); await raw.save(); }
    const b = await refresh(raw);
    const missing = [];
    if (!b.kit) missing.push('kit');
    if (!b.switch) missing.push('switch');
    if (!b.keycap) missing.push('keycap');
    if (!b.service) missing.push('gói gia công');
    if (missing.length) { req.flash('error', 'Bạn còn thiếu: ' + missing.join(', ')); return res.redirect('/builder?step=5'); }
    if (!b.compat.ok) { req.flash('error', 'Cấu hình còn linh kiện không tương thích, vui lòng sửa trước khi đặt.'); return res.redirect('/builder?step=5'); }
    if (req.shop && String(req.shop._id) === String(b.service.shop._id)) { req.flash('error', 'Không thể đặt gia công tại chính shop của bạn.'); return res.redirect('/builder?step=4'); }
    if (b.status === 'draft') b.status = 'saved';
    await b.save();
    if (!req.user.cart.some(i => String(i.build) === String(b._id))) req.user.cart.push({ build: b._id, qty: 1 });
    await req.user.save();
    req.session.buildId = null;
    req.flash('success', `Đã thêm Build #${b.code} vào giỏ hàng.`);
    res.redirect(req.body.checkout ? '/checkout' : '/cart');
  } catch (e) { next(e); }
});

module.exports = router;
