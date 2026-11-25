const router = require('express').Router();
const crypto = require('crypto');
const { Order } = require('../models');
const { requireLogin } = require('../middleware/auth');
const vnpay = require('../utils/vnpay');
const mailer = require('../utils/mailer');
const { refundOrder } = require('../utils/orders');

// Ghi nhận kết quả thanh toán cho cả nhóm đơn — NGUYÊN TỬ từng đơn:
//  - chỉ đơn đang "chưa thanh toán / thất bại" mới được đổi (VNPay gọi lại nhiều lần không xử lý lặp)
//  - đơn đã bị huỷ / trả hàng mà tiền vẫn về → chuyển "Chờ hoàn tiền" và hoàn ngay vào Ví KeebHub
//    (kiểm tra lại SAU khi ghi "đã thanh toán" → không lọt trường hợp khách bấm huỷ đúng lúc tiền về)
async function markGroup(group, ok, info = {}) {
  const orders = await Order.find({ paymentGroup: group });
  const now = new Date();
  for (const o of orders) {
    if (ok) {
      const set = { paymentStatus: 'paid', paidAt: now, vnpTransactionNo: info.transactionNo };
      if (info.payDate) set.vnpPayDate = info.payDate;
      if (info.bank) set.vnpBankCode = info.bank;
      const r = await Order.updateOne({ _id: o._id, paymentStatus: { $in: ['unpaid', 'failed'] } },
        { $set: set, $push: { history: { status: o.status, at: now, by: 'system', note: `Thanh toán VNPay thành công${info.bank ? ' (' + info.bank + ')' : ''}` } } });
      if (r.modifiedCount) await settleLatePayment(o._id);
    } else {
      await Order.updateOne({ _id: o._id, paymentStatus: 'unpaid' },
        { $set: { paymentStatus: 'failed' }, $push: { history: { status: o.status, at: now, by: 'system', note: 'Thanh toán VNPay không thành công' } } });
    }
  }
  return Order.find({ paymentGroup: group });
}
// Đơn đã huỷ / trả hàng nhưng đang "đã thanh toán" → chuyển chờ hoàn + hoàn vào ví (khoá nguyên tử trong refundOrder)
async function settleLatePayment(id) {
  const r = await Order.findOneAndUpdate({ _id: id, paymentStatus: 'paid', status: { $in: ['cancelled', 'returned'] } }, { $set: { paymentStatus: 'refund_pending' } }, { new: true });
  if (r) await refundOrder(r, 'system').catch(e => console.error('[Hoàn tiền]', e.message));
}
async function refundLate() { /* đã xử lý ngay trong markGroup */ }

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
    // Lưu vnp_CreateDate của giao dịch — API hoàn tiền VNPay bắt buộc gửi lại đúng giá trị này
    const createDate = vnpay.vnTime();
    await Order.updateMany({ _id: { $in: orders.map(o => o._id) } }, { vnpCreateDate: createDate });
    res.redirect(vnpay.createPaymentUrl({ txnRef: req.params.group, amount, orderInfo: info, ipAddr: ip, bankCode: req.query.bank, createDate }));
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
        const marked = await markGroup(group, ok, { transactionNo: req.query.vnp_TransactionNo, bank: req.query.vnp_BankCode, payDate: req.query.vnp_PayDate });
        if (ok) await refundLate(marked);
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
    const ipnOk = req.query.vnp_ResponseCode === '00' && req.query.vnp_TransactionStatus === '00';
    const marked = await markGroup(req.query.vnp_TxnRef, ipnOk,
      { transactionNo: req.query.vnp_TransactionNo, bank: req.query.vnp_BankCode, payDate: req.query.vnp_PayDate });
    if (ipnOk) await refundLate(marked);
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
