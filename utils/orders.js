const { Product, Order, Review, Shop, CustomService } = require('../models');
const wallet = require('./wallet');
const { money } = require('./helpers');

// Huỷ đơn: hoàn kho; đơn đã thanh toán → hoàn tiền vào Ví KeebHub ngay
async function cancelOrder(order, by, reason) {
  // Khoá nguyên tử: chỉ 1 yêu cầu được chuyển đơn sang "Đã huỷ" (chặn bấm huỷ 2 lần / 2 người huỷ cùng lúc → hoàn kho, hoàn tiền 2 lần)
  const now = new Date();
  const claim = await Order.updateOne({ _id: order._id, status: { $nin: ['cancelled', 'returned'] } }, { $set: { status: 'cancelled', cancelledAt: now } });
  if (!claim.modifiedCount) {
    const fresh = await Order.findById(order._id);
    if (fresh) Object.assign(order, { status: fresh.status, paymentStatus: fresh.paymentStatus });
    return order;
  }
  for (const it of order.items) {
    if (it.product) await Product.updateOne({ _id: it.product }, { $inc: { stock: it.qty, sold: -it.qty } });
  }
  order.status = 'cancelled';
  order.cancelledAt = now;
  order.cancelReason = reason || '';
  order.cancelledBy = by;
  if (order.paymentStatus === 'paid') order.paymentStatus = 'refund_pending';
  if (order.isCustom && order.customRequest && order.customRequest.status === 'waiting') {
    // Shop huỷ = từ chối; khách/admin huỷ = rút yêu cầu (không còn "chờ thanh toán")
    order.customRequest.status = by === 'seller' ? 'rejected' : '';
    order.customRequest.respondedAt = now;
  }
  if (order.isCustom && order.service && order.service.ref) await CustomService.updateOne({ _id: order.service.ref }, { $inc: { orders: -1 } });
  order.history.push({ status: 'cancelled', note: `Huỷ bởi ${({ customer: 'khách hàng', seller: 'shop', admin: 'quản trị viên' })[by] || by}${reason ? ': ' + reason : ''}`, by });
  await order.save();
  if (order.paymentStatus === 'refund_pending') await refundOrder(order, by, 'refund_cancel').catch(e => console.error('[Hoàn tiền]', e.message));
  return order;
}

// Hoàn tiền 1 đơn VÀO VÍ KEEBHUB của khách.
//  - Chỉ đơn "Chờ hoàn tiền" mới hoàn được; chuyển sang "Đã hoàn tiền" bằng lệnh NGUYÊN TỬ trước khi cộng ví
//    → gọi 2 lần / 2 người bấm cùng lúc thì chỉ 1 lần cộng ví.
//  - Số tiền hoàn = đúng tổng tiền khách đã trả cho đơn này (không hơn).
async function refundOrder(order, by = 'system', kind = 'refund_cancel') {
  const now = new Date();
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, paymentStatus: 'refund_pending' },
    { $set: { paymentStatus: 'refunded', 'refund.method': 'wallet', 'refund.auto': true, 'refund.amount': order.total, 'refund.at': now, 'refund.message': '' } },
    { new: true }
  );
  if (!claimed) return { ok: false, busy: true, message: 'Đơn không ở trạng thái chờ hoàn tiền (có thể đã được hoàn rồi).' };
  try {
    const amount = claimed.total;
    if (amount > 0) {
      await wallet.credit(claimed.user, amount, {
        type: kind, order: claimed._id, orderCodes: [claimed.code],
        note: kind === 'refund_return' ? `Hoàn tiền trả hàng đơn #${claimed.code}` : `Hoàn tiền đơn huỷ #${claimed.code}`
      });
    }
    await Order.updateOne({ _id: claimed._id }, { $push: { history: { status: claimed.status, by: 'system', note: `Đã hoàn ${money(amount)} vào Ví KeebHub của khách` } } });
    order.paymentStatus = 'refunded';
    order.refund = { method: 'wallet', auto: true, amount, at: now };
    return { ok: true, amount, message: `Đã hoàn ${money(amount)} vào Ví KeebHub` };
  } catch (e) {
    // cộng ví lỗi → trả đơn về "Chờ hoàn tiền" để admin thử lại
    await Order.updateOne({ _id: claimed._id }, { $set: { paymentStatus: 'refund_pending', 'refund.message': e.message } });
    console.error('[Hoàn tiền vào ví]', e.message);
    return { ok: false, message: 'Chưa hoàn được vào ví: ' + e.message };
  }
}

// Các trạng thái mà từng vai trò được phép chuyển (Tự chọn 4 — Cập nhật trạng thái đơn hàng)
const NEXT = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipping', 'cancelled'],
  processing: ['shipping'],
  shipping: ['delivered'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
  returned: []
};

function canCustomerCancel(o) {
  if (['cancelled', 'returned'].includes(o.status)) return false;
  if (o.isCustom) return o.status === 'pending';
  return ['pending', 'confirmed'].includes(o.status);
}

async function recalcRating(productId) {
  const avg = (rs) => (rs.length ? Math.round(rs.reduce((a, r) => a + r.rating, 0) / rs.length * 10) / 10 : 0);
  const rs = await Review.find({ product: productId }).select('rating').lean();
  const p = await Product.findByIdAndUpdate(productId, { rating: avg(rs), reviewCount: rs.length }, { new: true });
  if (p) {
    const ss = await Review.find({ shop: p.shop }).select('rating').lean();
    await Shop.updateOne({ _id: p.shop }, { rating: avg(ss), reviewCount: ss.length });
  }
}

module.exports = { cancelOrder, refundOrder, NEXT, canCustomerCancel, recalcRating, Order };
