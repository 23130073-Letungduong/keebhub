const { Product, Order, Review, Shop, CustomService } = require('../models');

// Huỷ đơn: hoàn kho, chuyển trạng thái thanh toán sang chờ hoàn tiền nếu đã trả
async function cancelOrder(order, by, reason) {
  if (order.status === 'cancelled') return order;
  for (const it of order.items) {
    if (it.product) await Product.updateOne({ _id: it.product }, { $inc: { stock: it.qty, sold: -it.qty } });
  }
  order.status = 'cancelled';
  order.cancelReason = reason || '';
  order.cancelledBy = by;
  if (order.paymentStatus === 'paid') order.paymentStatus = 'refund_pending';
  if (order.isCustom && order.customRequest && order.customRequest.status === 'waiting') {
    order.customRequest.status = by === 'seller' ? 'rejected' : order.customRequest.status;
    order.customRequest.respondedAt = new Date();
  }
  if (order.isCustom && order.service && order.service.ref) await CustomService.updateOne({ _id: order.service.ref }, { $inc: { orders: -1 } });
  order.history.push({ status: 'cancelled', note: `Huỷ bởi ${({ customer: 'khách hàng', seller: 'shop', admin: 'quản trị viên' })[by] || by}${reason ? ': ' + reason : ''}`, by });
  await order.save();
  return order;
}

// Các trạng thái mà từng vai trò được phép chuyển (Tự chọn 4 — Cập nhật trạng thái đơn hàng)
const NEXT = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipping', 'cancelled'],
  processing: ['shipping'],
  shipping: ['delivered'],
  delivered: ['completed'],
  completed: [],
  cancelled: []
};

function canCustomerCancel(o) {
  if (o.status === 'cancelled') return false;
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

module.exports = { cancelOrder, NEXT, canCustomerCancel, recalcRating, Order };
