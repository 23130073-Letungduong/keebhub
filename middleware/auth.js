const { User, Shop, Order } = require('../models');

// Nạp user đang đăng nhập + dữ liệu dùng chung cho mọi view
async function loadUser(req, res, next) {
  res.locals.user = null;
  res.locals.shop = null;
  res.locals.cartCount = 0;
  res.locals.path = req.path;
  res.locals.query = req.query;
  try {
    if (req.session.userId) {
      const user = await User.findById(req.session.userId);
      if (!user || user.status === 'locked') {
        req.session.userId = null;
      } else {
        req.user = user;
        res.locals.user = user;
        res.locals.cartCount = user.cart.reduce((s, i) => s + (i.build ? 1 : i.qty), 0);
        if (user.role === 'seller') {
          req.shop = await Shop.findOne({ owner: user._id });
          res.locals.shop = req.shop;
        }
      }
    }
    next();
  } catch (e) { next(e); }
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  if (req.xhr || (req.headers.accept || '').includes('application/json')) return res.status(401).json({ error: 'Vui lòng đăng nhập' });
  req.session.returnTo = req.originalUrl;
  req.flash('info', 'Bạn cần đăng nhập để sử dụng tính năng này.');
  res.redirect('/auth/login');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return requireLogin(req, res, next);
    if (roles.includes(req.user.role)) return next();
    res.status(403).render('pages/error', { title: 'Không có quyền truy cập', code: 403, message: 'Tài khoản của bạn không có quyền vào trang này.' });
  };
}

// Seller có shop đã được duyệt
async function requireShop(req, res, next) {
  if (!req.user) return requireLogin(req, res, next);
  if (req.user.role !== 'seller') return res.redirect('/seller/register');
  if (!req.shop) return res.redirect('/seller/register');
  if (req.shop.status !== 'active') {
    return res.render('seller/pending', { title: 'Shop đang chờ duyệt' });
  }
  // badge đếm cho rail
  const [pendingOrders, waitingCustom, processing] = await Promise.all([
    Order.countDocuments({ shop: req.shop._id, status: 'pending', 'customRequest.status': { $ne: 'waiting' } }),
    Order.countDocuments({ shop: req.shop._id, 'customRequest.status': 'waiting', status: 'pending' }),
    Order.countDocuments({ shop: req.shop._id, status: 'processing' })
  ]);
  res.locals.badges = { pendingOrders, waitingCustom, processing };
  next();
}

module.exports = { loadUser, requireLogin, requireRole, requireShop };
