const router = require('express').Router();
const { Product, Category, Shop, Review, Comment, CustomService, Order, User } = require('../models');
const { requireLogin } = require('../middleware/auth');
const { escapeRegex } = require('../utils/helpers');
const svg = require('../utils/svg');
const compat = require('../utils/compat');

const ACTIVE = { status: 'active' };

async function activeShopIds() {
  return (await Shop.find({ status: 'active' }).select('_id')).map(s => s._id);
}

// Gợi ý sản phẩm (Tự chọn 10): dựa trên danh mục khách đã xem/mua, fallback theo đánh giá cao
async function suggestFor(user, limit = 6, excludeIds = []) {
  const shopIds = await activeShopIds();
  const base = { ...ACTIVE, shop: { $in: shopIds }, _id: { $nin: excludeIds } };
  if (user) {
    const orders = await Order.find({ user: user._id }).select('items.product').limit(20);
    const bought = orders.flatMap(o => o.items.map(i => i.product)).filter(Boolean);
    const seen = [...(user.viewed || []), ...bought];
    if (seen.length) {
      const ref = await Product.find({ _id: { $in: seen } }).select('category partType attrs');
      const cats = [...new Set(ref.map(p => String(p.category)))];
      const layouts = [...new Set(ref.map(p => p.attrs && p.attrs.layout).filter(Boolean))];
      const items = await Product.find({
        ...base, _id: { $nin: [...excludeIds, ...bought] },
        $or: [{ category: { $in: cats } }, { 'attrs.layout': { $in: layouts } }, { 'attrs.layouts': { $in: layouts } }]
      }).sort({ rating: -1, sold: -1 }).limit(limit).populate('shop', 'name slug');
      if (items.length >= Math.min(4, limit)) return items;
    }
  }
  return Product.find(base).sort({ rating: -1, reviewCount: -1, createdAt: -1 }).limit(limit).populate('shop', 'name slug');
}

router.get('/', async (req, res, next) => {
  try {
    const shopIds = await activeShopIds();
    const q = { ...ACTIVE, shop: { $in: shopIds } };
    const [bestsellers, counts, customShops, totalProducts, totalOrders, sale] = await Promise.all([
      Product.find(q).sort({ sold: -1 }).limit(6).populate('shop', 'name slug'),
      Product.aggregate([{ $match: q }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
      Shop.find({ status: 'active', offersCustom: true }).sort({ rating: -1 }).limit(4),
      Product.countDocuments(q),
      Order.countDocuments({ status: { $in: ['delivered', 'completed'] } }),
      Product.find({ ...q, oldPrice: { $gt: 0 } }).sort({ updatedAt: -1 }).limit(1)
    ]);
    const suggestions = await suggestFor(req.user, 6, bestsellers.map(p => p._id));
    const countMap = {};
    counts.forEach(c => { countMap[String(c._id)] = c.n; });
    res.render('shop/home', {
      title: 'KeebHub — Sàn bàn phím custom',
      bestsellers, suggestions, customShops, countMap, totalProducts, totalOrders,
      shopCount: await Shop.countDocuments({ status: 'active', offersCustom: true }), sale
    });
  } catch (e) { next(e); }
});

// Danh mục + tìm kiếm + lọc
async function listing(req, res, next, category) {
  try {
    const { q = '', sort = 'popular', min, max, layout, switchType, profile, hotswap, type } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const per = 20;
    const filter = { ...ACTIVE, shop: { $in: await activeShopIds() } };
    if (category) filter.category = category._id;
    if (type) filter.partType = type;
    if (q.trim()) filter.name = new RegExp(escapeRegex(q.trim()), 'i');
    if (min || max) {
      filter.price = {};
      const lo = Number(min), hi = Number(max);
      if (min && Number.isFinite(lo) && lo >= 0) filter.price.$gte = lo;
      if (max && Number.isFinite(hi) && hi >= 0) filter.price.$lte = hi;
      if (!Object.keys(filter.price).length) delete filter.price;
    }
    if (layout) filter.$or = [{ 'attrs.layout': layout }, { 'attrs.layouts': layout }];
    if (switchType) filter['attrs.switchType'] = switchType;
    if (profile) filter['attrs.profile'] = profile;
    if (hotswap === '1') filter['attrs.hotswap'] = true;
    if (req.query.shop) filter.shop = req.query.shop;
    const sorts = { popular: { sold: -1 }, new: { createdAt: -1 }, price_asc: { price: 1 }, price_desc: { price: -1 }, rating: { rating: -1, reviewCount: -1 } };
    const [items, total] = await Promise.all([
      Product.find(filter).sort(sorts[sort] || sorts.popular).skip((page - 1) * per).limit(per).populate('shop', 'name slug'),
      Product.countDocuments(filter)
    ]);
    // Shop khớp từ khoá (Tìm kiếm gian hàng — Tự chọn 6)
    const shops = q.trim() ? await Shop.find({ status: 'active', name: new RegExp(escapeRegex(q.trim()), 'i') }).limit(4) : [];
    res.render('shop/listing', {
      title: category ? category.name : (q ? `Tìm "${q}"` : 'Tất cả sản phẩm'),
      category, items, total, page, pages: Math.ceil(total / per), shops, q, sort
    });
  } catch (e) { next(e); }
}

router.get('/search', (req, res, next) => listing(req, res, next, null));
router.get('/c/:slug', async (req, res, next) => {
  const category = await Category.findOne({ slug: req.params.slug });
  if (!category) return next();
  listing(req, res, next, category);
});

// Ảnh minh hoạ SVG
router.get('/img/p/:id.svg', async (req, res) => {
  try {
    const p = await Product.findById(req.params.id).select('art partType name');
    res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'public, max-age=86400');
    res.send(svg.render(p || { partType: 'kit', name: 'x' }));
  } catch (e) {
    res.set('Content-Type', 'image/svg+xml').send(svg.render({ partType: 'kit', name: 'x' }));
  }
});
router.get('/img/hero.svg', (req, res) => {
  res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'public, max-age=86400');
  res.send(svg.keyboard({ color: '#1F3A6E', accent: '#FF5A1F', bg: 'transparent', key: '#2B4E96', seed: 7 }));
});

// Chi tiết sản phẩm
router.get('/p/:slug', async (req, res, next) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug }).populate('shop').populate('category');
    if (!product) return next();
    const isOwner = req.shop && String(req.shop._id) === String(product.shop._id);
    const isAdmin = req.user && req.user.role === 'admin';
    if ((product.status !== 'active' || product.shop.status !== 'active') && !isOwner && !isAdmin) return next();

    if (req.user) {
      req.user.viewed = [product._id, ...req.user.viewed.filter(id => String(id) !== String(product._id))].slice(0, 20);
      await req.user.save();
    }
    const [reviews, comments, related, services, dist] = await Promise.all([
      Review.find({ product: product._id }).sort({ createdAt: -1 }).limit(30).populate('user', 'name color'),
      Comment.find({ product: product._id }).sort({ createdAt: -1 }).limit(30).populate('user', 'name color'),
      Product.find({ ...ACTIVE, _id: { $ne: product._id }, $or: [{ shop: product.shop._id }, { partType: { $ne: product.partType } }] }).sort({ sold: -1 }).limit(4).populate('shop', 'name'),
      CustomService.find({ shop: product.shop._id, active: true }).limit(3),
      Review.aggregate([{ $match: { product: product._id } }, { $group: { _id: '$rating', n: { $sum: 1 } } }])
    ]);
    const distMap = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    dist.forEach(d => { distMap[d._id] = d.n; });

    // Tab tương thích: đối chiếu với các linh kiện phổ biến
    let compatList = [];
    const roleOf = { kit: 'kit', prebuilt: null, switch: 'sw', keycap: 'keycap', stabilizer: 'stab' };
    const myRole = roleOf[product.partType];
    if (myRole) {
      const targets = myRole === 'kit' ? ['switch', 'keycap', 'stabilizer'] : ['kit'];
      const others = await Product.find({ ...ACTIVE, partType: { $in: targets } }).sort({ sold: -1 }).limit(6);
      for (const o of others) {
        const parts = { qty: 999 };
        parts[myRole] = product;
        parts[roleOf[o.partType]] = o;
        const r = await compat.check(parts);
        const bad = r.issues.find(i => i.level === 'block') || r.issues.find(i => i.level === 'warn');
        compatList.push({ product: o, ok: !bad || bad.level !== 'block', issue: bad });
      }
    }
    const canReview = req.user ? await Order.exists({ user: req.user._id, status: { $in: ['delivered', 'completed'] }, 'items.product': product._id, 'items.reviewed': false }) : false;
    const wished = req.user ? req.user.wishlist.some(id => String(id) === String(product._id)) : false;
    res.render('shop/product', {
      title: product.name, product, reviews, comments, related, services, distMap, compatList, canReview, wished,
      tab: req.query.tab || 'desc'
    });
  } catch (e) { next(e); }
});

// Hỏi đáp dưới sản phẩm
router.post('/p/:slug/comments', requireLogin, async (req, res, next) => {
  try {
    const p = await Product.findOne({ slug: req.params.slug });
    if (!p) return next();
    const content = String(req.body.content || '').trim();
    if (content.length < 2) { req.flash('error', 'Nội dung quá ngắn.'); return res.redirect(`/p/${p.slug}?tab=qa#tabs`); }
    await Comment.create({ product: p._id, shop: p.shop, user: req.user._id, content: content.slice(0, 1000) });
    req.flash('success', 'Đã gửi câu hỏi. Shop sẽ trả lời sớm.');
    res.redirect(`/p/${p.slug}?tab=qa#tabs`);
  } catch (e) { next(e); }
});
// Trả lời bình luận (Tự chọn 5) — chủ shop của sản phẩm hoặc admin, hoặc khách khác
router.post('/comments/:id/reply', requireLogin, async (req, res, next) => {
  try {
    const c = await Comment.findById(req.params.id).populate('product', 'slug');
    if (!c) return next();
    const isSeller = req.shop && String(req.shop._id) === String(c.shop);
    const content = String(req.body.content || '').trim();
    if (content) {
      c.replies.push({ user: req.user._id, name: isSeller ? req.shop.name : req.user.name, isSeller: isSeller || req.user.role === 'admin', content: content.slice(0, 1000) });
      await c.save();
      req.flash('success', 'Đã trả lời bình luận.');
    }
    res.redirect(req.body.back || `/p/${c.product.slug}?tab=qa#tabs`);
  } catch (e) { next(e); }
});

// Yêu thích
router.post('/wishlist/:id', requireLogin, async (req, res) => {
  const id = req.params.id;
  const has = req.user.wishlist.some(x => String(x) === id);
  if (has) req.user.wishlist = req.user.wishlist.filter(x => String(x) !== id);
  else req.user.wishlist.push(id);
  await req.user.save();
  if (req.xhr || (req.headers.accept || '').includes('json')) return res.json({ wished: !has });
  res.redirect('back');
});

// Tìm kiếm gian hàng (Tự chọn 6)
router.get('/shops', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const filter = { status: 'active' };
    if (q) filter.$or = [{ name: new RegExp(escapeRegex(q), 'i') }, { city: new RegExp(escapeRegex(q), 'i') }, { description: new RegExp(escapeRegex(q), 'i') }];
    if (req.query.custom === '1') filter.offersCustom = true;
    const shops = await Shop.find(filter).sort({ rating: -1, followers: -1 }).limit(48);
    const counts = await Product.aggregate([{ $match: { ...ACTIVE, shop: { $in: shops.map(s => s._id) } } }, { $group: { _id: '$shop', n: { $sum: 1 } } }]);
    const cm = {}; counts.forEach(c => { cm[String(c._id)] = c.n; });
    res.render('shop/shops', { title: 'Tìm gian hàng', shops, q, cm });
  } catch (e) { next(e); }
});

router.get('/shop/:slug', async (req, res, next) => {
  try {
    const shop = await Shop.findOne({ slug: req.params.slug, status: 'active' }).populate('owner', 'name');
    if (!shop) return next();
    const sort = req.query.sort || 'popular';
    const sorts = { popular: { sold: -1 }, new: { createdAt: -1 }, price_asc: { price: 1 }, price_desc: { price: -1 } };
    const filter = { ...ACTIVE, shop: shop._id };
    if (req.query.q) filter.name = new RegExp(escapeRegex(req.query.q), 'i');
    const [products, services, reviews, total, sold] = await Promise.all([
      Product.find(filter).sort(sorts[sort] || sorts.popular).limit(60),
      CustomService.find({ shop: shop._id, active: true }),
      Review.find({ shop: shop._id }).sort({ createdAt: -1 }).limit(5).populate('user', 'name color').populate('product', 'name slug'),
      Product.countDocuments({ ...ACTIVE, shop: shop._id }),
      Order.countDocuments({ shop: shop._id, status: { $in: ['delivered', 'completed'] } })
    ]);
    res.render('shop/shop', { title: shop.name, s: shop, products, services, reviews, total, sold, sort });
  } catch (e) { next(e); }
});

router.get('/huong-dan', (req, res) => res.render('pages/guide', { title: 'Hướng dẫn mua hàng & build phím' }));
router.get('/chinh-sach', (req, res) => res.render('pages/policy', { title: 'Chính sách' }));

module.exports = router;
module.exports.suggestFor = suggestFor;
