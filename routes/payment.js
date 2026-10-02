const router = require('express').Router();
const crypto = require('crypto');
const { Order } = require('../models');
const { requireLogin } = require('../middleware/auth');
const vnpay = require('../utils/vnpay');
const mailer = require('../utils/mailer');

async function markGroup(group, ok, info = {}) {
  const orders = await Order.find({ paymentGroup: group });
  for (const o of orders) {
    if (o.paymentStatus === 'paid') continue;
    if (ok) {
      // Đơn đã bị huỷ mà khách vẫn trả tiền → đưa vào hàng chờ hoàn tiền
      o.paymentStatus = o.status === 'cancelled' ? 'refund_pending' : 'paid';
      o.paidAt = new Date();
      o.vnpTransactionNo = info.transactionNo;
      o.history.push({ status: o.status, note: `Thanh toán VNPay thành công${info.bank ? ' (' + info.bank + ')' : ''}`, by: 'system' });
    } else if (o.paymentStatus === 'unpaid') {
      o.paymentStatus = 'failed';
      o.history.push({ status: o.status, note: 'Thanh toán VNPay không thành công', by: 'system' });
    }
    await o.save();
  }
  return orders;
}

// Chuyển sang VNPay
router.get('/vnpay/:group', requireLogin, async (req, res, next) => {
  try {
    const orders = await Order.find({ paymentGroup: req.params.group, user: req.user._id, status: { $ne: 'cancelled' }, paymentStatus: { $in: ['unpaid', 'failed'] } });
    if (!orders.length) return res.redirect(`/payment/result/${req.params.group}`);
    // Thanh toán lại sau khi thất bại -> cần mã giao dịch (vnp_TxnRef) mới
    if (orders.some(o => o.paymentStatus === 'failed')) {
      const g = 'PG' + Date.now() + crypto.randomBytes(2).toString('hex').toUpperCase();
      await Order.updateMany({ _id: { $in: orders.map(o => o._id) } }, { paymentGroup: g, paymentStatus: 'unpaid' });
      return res.redirect(`/payment/vnpay/${g}`);
    }
    const amount = orders.reduce((s, o) => s + o.total, 0);
    const info = `Thanh toan don hang KeebHub ${orders.map(o => o.code).join(' ')}`.slice(0, 250);
    if (!vnpay.isConfigured()) {
      return res.render('cart/vnpay-mock', { title: 'Mô phỏng VNPay', orders, amount, group: req.params.group, info });
    }
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').split(',')[0].replace('::ffff:', '').replace('::1', '127.0.0.1');
    res.redirect(vnpay.createPaymentUrl({ txnRef: req.params.group, amount, orderInfo: info, ipAddr: ip, bankCode: req.query.bank }));
  } catch (e) { next(e); }
});

// Thanh toán lại một đơn (tạo mã giao dịch mới)
router.post('/retry/:id', requireLogin, async (req, res, next) => {
  try {
    const o = await Order.findOne({ _id: req.params.id, user: req.user._id, paymentMethod: 'vnpay', paymentStatus: { $in: ['unpaid', 'failed'] }, status: { $ne: 'cancelled' } });
    if (!o) return res.redirect('/account/orders');
    o.paymentGroup = 'PG' + Date.now() + crypto.randomBytes(2).toString('hex').toUpperCase();
    o.paymentStatus = 'unpaid';
    await o.save();
    res.redirect(`/payment/vnpay/${o.paymentGroup}`);
  } catch (e) { next(e); }
});

// Trang mô phỏng khi chưa có key sandbox (chỉ để demo)
router.post('/mock/:group', requireLogin, async (req, res, next) => {
  try {
    if (vnpay.isConfigured()) return res.redirect('/');
    if (!(await Order.exists({ paymentGroup: req.params.group, user: req.user._id }))) return res.redirect('/account/orders');
    const ok = req.body.result === 'success';
    const orders = await markGroup(req.params.group, ok, { transactionNo: 'MOCK' + Date.now(), bank: 'NCB' });
    if (ok) mailer.sendOrder(req.user, orders, `${process.env.BASE_URL || 'http://localhost:3000'}/account/orders`).catch(() => {});
    res.redirect(`/payment/result/${req.params.group}?code=${ok ? '00' : '24'}`);
  } catch (e) { next(e); }
});

// Return URL — VNPay chuyển trình duyệt về
router.get('/vnpay_return', async (req, res, next) => {
  try {
    const valid = vnpay.verify(req.query);
    const code = req.query.vnp_ResponseCode;
    const group = req.query.vnp_TxnRef;
    if (valid) {
      const orders = await Order.find({ paymentGroup: group });
      const amount = orders.reduce((s, o) => s + o.total, 0) * 100;
      if (orders.length && Number(req.query.vnp_Amount) === amount) {
        const ok = code === '00' && req.query.vnp_TransactionStatus === '00';
        await markGroup(group, ok, { transactionNo: req.query.vnp_TransactionNo, bank: req.query.vnp_BankCode });
        if (ok && orders[0]) {
          const u = await require('../models').User.findById(orders[0].user);
          if (u) mailer.sendOrder(u, orders, `${process.env.BASE_URL || 'http://localhost:3000'}/account/orders`).catch(() => {});
        }
      }
    }
    res.redirect(`/payment/result/${group}?code=${valid ? code : '97'}`);
  } catch (e) { next(e); }
});

// IPN — VNPay gọi server-to-server
router.get('/vnpay_ipn', async (req, res) => {
  try {
    if (!vnpay.verify(req.query)) return res.json({ RspCode: '97', Message: 'Invalid signature' });
    const orders = await Order.find({ paymentGroup: req.query.vnp_TxnRef });
    if (!orders.length) return res.json({ RspCode: '01', Message: 'Order not found' });
    const amount = orders.reduce((s, o) => s + o.total, 0) * 100;
    if (Number(req.query.vnp_Amount) !== amount) return res.json({ RspCode: '04', Message: 'Invalid amount' });
    if (orders.every(o => o.paymentStatus === 'paid')) return res.json({ RspCode: '02', Message: 'Order already confirmed' });
    await markGroup(req.query.vnp_TxnRef, req.query.vnp_ResponseCode === '00' && req.query.vnp_TransactionStatus === '00',
      { transactionNo: req.query.vnp_TransactionNo, bank: req.query.vnp_BankCode });
    res.json({ RspCode: '00', Message: 'Confirm Success' });
  } catch (e) {
    res.json({ RspCode: '99', Message: 'Unknown error' });
  }
});

// Kết quả
router.get('/result/:group', requireLogin, async (req, res, next) => {
  try {
    const orders = await Order.find({ paymentGroup: req.params.group, user: req.user._id }).populate('shop', 'name');
    if (!orders.length) return res.redirect('/account/orders');
    const paid = orders.every(o => o.paymentStatus === 'paid');
    const cod = orders.every(o => o.paymentMethod === 'cod');
    const code = req.query.code;
    res.render('cart/result', {
      title: 'Kết quả đặt hàng', orders, paid, cod, group: req.params.group,
      success: cod || paid, message: code ? (vnpay.RESPONSE[code] || (code === '97' ? 'Chữ ký không hợp lệ' : 'Giao dịch không thành công')) : '',
      total: orders.reduce((s, o) => s + o.total, 0)
    });
  } catch (e) { next(e); }
});

module.exports = router;
