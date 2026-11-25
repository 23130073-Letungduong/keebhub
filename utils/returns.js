// Trả hàng / hoàn tiền sau khi nhận hàng — tiền hoàn vào Ví KeebHub.
//
// Quy trình:  khách gửi yêu cầu (lý do + ảnh)  →  shop DUYỆT  →  khách gửi hàng về (mã vận đơn)
//             →  shop XÁC NHẬN ĐÃ NHẬN HÀNG  →  cộng lại kho + hoàn tiền vào ví
//             (shop từ chối / im lặng quá 72 giờ → khách khiếu nại lên sàn 1 lần → admin phân xử)
//
// Các luật chống lạm dụng (xem giải thích đầy đủ ở HUONG-DAN / tài liệu):
//  1. Chỉ đơn ĐÃ GIAO, trong 7 ngày kể từ lúc giao (mốc do máy chủ ghi, khách không sửa được)
//  2. Chỉ lý do lỗi phía người bán / vận chuyển — không nhận "đổi ý"
//  3. Bắt buộc ảnh chứng minh (1–5 ảnh) + mô tả ≥ 15 ký tự
//  4. Mỗi đơn chỉ 1 yêu cầu; bị từ chối chỉ được khiếu nại lên sàn 1 lần
//  5. Tối đa 3 yêu cầu trả hàng / khách / 30 ngày
//  6. Tiền chỉ hoàn khi SHOP XÁC NHẬN ĐÃ NHẬN hàng trả về (nhập mã vận đơn giả không có tác dụng)
//  7. Số tiền hoàn = đúng số đã trả của đơn, hoàn 1 lần (khoá nguyên tử), vào ví (không rút ra tiền mặt)
//  8. Mọi bước chuyển trạng thái đều nguyên tử → bấm 2 lần / 2 người bấm cùng lúc không bị hoàn 2 lần
const { Order, Product, Review } = require('../models');
const { refundOrder, recalcRating } = require('./orders');

const RETURN_DAYS = Number(process.env.RETURN_DAYS || 7);
const RETURN_LIMIT_30D = Number(process.env.RETURN_LIMIT || 3);
const SHOP_RESPONSE_HOURS = 72;
const WHO = { customer: 'khách hàng', seller: 'shop', admin: 'quản trị viên', system: 'hệ thống' };

// Thời điểm giao hàng: ưu tiên deliveredAt; đơn cũ thì lấy từ lịch sử
function deliveredAtOf(o) {
  if (o.deliveredAt) return o.deliveredAt;
  const h = (o.history || []).filter(x => ['delivered', 'completed'].includes(x.status));
  return h.length ? h[0].at : null;
}

function returnDeadline(o) {
  const d = deliveredAtOf(o);
  return d ? new Date(new Date(d).getTime() + RETURN_DAYS * 86400e3) : null;
}

// Kiểm tra khách có được gửi yêu cầu trả hàng cho đơn này không (chưa tính giới hạn 30 ngày)
function canRequestReturn(o, now = new Date()) {
  if (!['delivered', 'completed'].includes(o.status)) return { ok: false, message: 'Chỉ trả hàng được với đơn đã giao.' };
  if (o.returnRequest && o.returnRequest.status) return { ok: false, message: 'Đơn này đã có yêu cầu trả hàng (mỗi đơn chỉ 1 lần).' };
  const dl = returnDeadline(o);
  if (!dl) return { ok: false, message: 'Không xác định được ngày giao hàng của đơn.' };
  if (now > dl) return { ok: false, message: `Đã quá hạn trả hàng ${RETURN_DAYS} ngày kể từ khi nhận hàng.` };
  return { ok: true, deadline: dl };
}

async function recentReturnCount(userId) {
  return Order.countDocuments({ user: userId, 'returnRequest.requestedAt': { $gte: new Date(Date.now() - 30 * 86400e3) } });
}

// Chuyển trạng thái nguyên tử: chỉ thành công nếu đơn đang ở 1 trong các trạng thái "from"
async function transition(order, from, set, history) {
  const filter = { _id: order._id, 'returnRequest.status': { $in: from } };
  const update = { $set: set };
  if (history) update.$push = { history: { status: order.status, at: new Date(), ...history } };
  const r = await Order.updateOne(filter, update);
  return r.modifiedCount === 1;
}

async function requestReturn(order, userId, { reason, detail, photos }) {
  const chk = canRequestReturn(order);
  if (!chk.ok) return chk;
  if (!Order.RETURN_REASONS[reason]) return { ok: false, message: 'Vui lòng chọn lý do trả hàng.' };
  detail = String(detail || '').trim().slice(0, 1000);
  if (detail.length < 15) return { ok: false, message: 'Vui lòng mô tả rõ vấn đề (ít nhất 15 ký tự).' };
  if (!photos || !photos.length) return { ok: false, message: 'Vui lòng tải lên ít nhất 1 ảnh chụp sản phẩm / tình trạng lỗi.' };
  if ((await recentReturnCount(userId)) >= RETURN_LIMIT_30D) {
    return { ok: false, message: `Bạn đã gửi ${RETURN_LIMIT_30D} yêu cầu trả hàng trong 30 ngày. Vui lòng liên hệ quản trị viên để được hỗ trợ.` };
  }
  // Nguyên tử: chỉ đặt yêu cầu khi đơn CHƯA có yêu cầu nào (chặn gửi 2 lần cùng lúc)
  const r = await Order.updateOne(
    { _id: order._id, user: userId, status: { $in: ['delivered', 'completed'] }, $or: [{ 'returnRequest.status': { $exists: false } }, { 'returnRequest.status': '' }] },
    { $set: { returnRequest: { status: 'requested', reason, detail, photos: photos.slice(0, 5), requestedAt: new Date() } },
      $push: { history: { status: order.status, by: 'customer', at: new Date(), note: `Khách yêu cầu trả hàng: ${Order.RETURN_REASONS[reason]}` } } }
  );
  if (!r.modifiedCount) return { ok: false, message: 'Đơn này đã có yêu cầu trả hàng.' };
  return { ok: true, message: 'Đã gửi yêu cầu trả hàng. Shop sẽ phản hồi trong 72 giờ.' };
}

async function approveReturn(order, by, note = '') {
  const ok = await transition(order, ['requested'], { 'returnRequest.status': 'approved', 'returnRequest.approvedAt': new Date(), 'returnRequest.shopNote': String(note).slice(0, 500) },
    { by, note: `${by === 'admin' ? 'Quản trị viên' : 'Shop'} đồng ý trả hàng — chờ khách gửi hàng về` });
  return ok ? { ok: true, message: 'Đã đồng ý trả hàng. Khách sẽ gửi hàng về địa chỉ shop.' } : { ok: false, message: 'Yêu cầu không còn ở trạng thái chờ duyệt.' };
}

async function shipReturn(order, userId, trackingCode) {
  trackingCode = String(trackingCode || '').trim().slice(0, 40);
  if (!/^[A-Za-z0-9-]{6,40}$/.test(trackingCode)) return { ok: false, message: 'Mã vận đơn không hợp lệ (6–40 ký tự chữ/số).' };
  if (String(order.user._id || order.user) !== String(userId)) return { ok: false, message: 'Không có quyền.' };
  const ok = await transition(order, ['approved'], { 'returnRequest.status': 'shipped', 'returnRequest.trackingCode': trackingCode, 'returnRequest.shippedAt': new Date() },
    { by: 'customer', note: `Khách đã gửi hàng trả về — mã vận đơn ${trackingCode}` });
  return ok ? { ok: true, message: 'Đã ghi nhận. Tiền sẽ hoàn vào ví khi shop xác nhận đã nhận hàng.' } : { ok: false, message: 'Yêu cầu chưa được duyệt hoặc đã gửi hàng rồi.' };
}

// Hoàn tiền vào ví + đóng yêu cầu. restock = hàng đã về shop → cộng lại kho
async function finishRefund(order, by, { restock, note }) {
  const fresh = await Order.findById(order._id);
  // Đơn custom: linh kiện đã lắp ráp thành phím → không cộng lại kho linh kiện
  if (fresh.isCustom) restock = false;
  if (restock) for (const it of fresh.items) if (it.product) await Product.updateOne({ _id: it.product }, { $inc: { stock: it.qty, sold: -it.qty } });
  const wasPaid = fresh.paymentStatus === 'paid';
  await Order.updateOne({ _id: fresh._id }, {
    $set: { status: 'returned', ...(wasPaid ? { paymentStatus: 'refund_pending' } : {}) },
    $push: { history: { status: 'returned', by, at: new Date(), note: note || 'Trả hàng thành công' } }
  });
  fresh.status = 'returned';
  // Đã trả hàng = không còn là "người đã mua" → gỡ đánh giá của đơn này (chống mua – đánh giá – trả lại)
  const revs = await Review.find({ order: fresh._id }).select('product');
  if (revs.length) {
    await Review.deleteMany({ order: fresh._id });
    for (const pid of [...new Set(revs.map(r => String(r.product)))]) await recalcRating(pid);
  }
  if (!wasPaid) return { ok: true, message: 'Đã hoàn tất trả hàng (đơn chưa thu tiền nên không phát sinh hoàn tiền).' };
  fresh.paymentStatus = 'refund_pending';
  const r = await refundOrder(fresh, by, 'refund_return');
  return r.ok ? { ok: true, message: `Đã nhận hàng trả và ${r.message.charAt(0).toLowerCase() + r.message.slice(1)}.` } : r;
}

async function receiveReturn(order, by) {
  const ok = await transition(order, ['shipped'], { 'returnRequest.status': 'refunded', 'returnRequest.receivedAt': new Date(), 'returnRequest.resolvedBy': by },
    { by, note: `${by === 'admin' ? 'Quản trị viên' : 'Shop'} xác nhận đã nhận hàng trả về` });
  if (!ok) return { ok: false, message: 'Chỉ xác nhận được khi khách đã gửi hàng (và chưa xử lý).' };
  return finishRefund(order, by, { restock: true });
}

async function rejectReturn(order, by, reason) {
  reason = String(reason || '').trim().slice(0, 500);
  if (reason.length < 10) return { ok: false, message: 'Vui lòng nhập lý do từ chối (ít nhất 10 ký tự).' };
  const stage = order.returnRequest && order.returnRequest.status === 'shipped' ? 'receipt' : 'request';
  const ok = await transition(order, ['requested', 'shipped'], { 'returnRequest.status': 'rejected', 'returnRequest.rejectReason': reason, 'returnRequest.rejectStage': stage, 'returnRequest.rejectedAt': new Date() },
    { by, note: `${by === 'admin' ? 'Quản trị viên' : 'Shop'} từ chối trả hàng: ${reason}` });
  return ok ? { ok: true, message: 'Đã từ chối yêu cầu trả hàng. Khách có thể khiếu nại lên sàn.' } : { ok: false, message: 'Yêu cầu không ở trạng thái có thể từ chối.' };
}

// Khách khiếu nại lên sàn: khi bị từ chối, hoặc shop không phản hồi quá 72 giờ. Chỉ 1 lần.
function canDispute(o, now = new Date()) {
  const rr = o.returnRequest || {};
  if (rr.disputedAt) return false;
  if (rr.status === 'rejected') return true;
  if (rr.status === 'requested' && rr.requestedAt && now - new Date(rr.requestedAt) > SHOP_RESPONSE_HOURS * 3600e3) return true;
  return false;
}

async function disputeReturn(order, userId, note) {
  if (String(order.user._id || order.user) !== String(userId)) return { ok: false, message: 'Không có quyền.' };
  if (!canDispute(order)) return { ok: false, message: 'Chưa thể khiếu nại (chỉ khi shop từ chối hoặc không phản hồi sau 72 giờ, và mỗi đơn 1 lần).' };
  note = String(note || '').trim().slice(0, 1000);
  if (note.length < 10) return { ok: false, message: 'Vui lòng trình bày lý do khiếu nại (ít nhất 10 ký tự).' };
  const ok = await transition(order, ['rejected', 'requested'], { 'returnRequest.status': 'disputed', 'returnRequest.disputeNote': note, 'returnRequest.disputedAt': new Date() },
    { by: 'customer', note: 'Khách khiếu nại lên sàn — chờ quản trị viên phân xử' });
  return ok ? { ok: true, message: 'Đã gửi khiếu nại. Quản trị viên sẽ xem xét và phản hồi.' } : { ok: false, message: 'Không gửi được khiếu nại.' };
}

// Admin phân xử: decision = 'refund' (hoàn tiền vào ví) | 'close' (đóng, không hoàn)
async function adminResolve(order, decision, { note, restock }) {
  note = String(note || '').trim().slice(0, 500);
  const open = ['requested', 'approved', 'shipped', 'rejected', 'disputed'];
  if (decision === 'refund') {
    const set = { 'returnRequest.status': 'refunded', 'returnRequest.resolvedBy': 'admin', 'returnRequest.resolution': note };
    if (restock) set['returnRequest.receivedAt'] = new Date();
    const ok = await transition(order, open, set,
      { by: 'admin', note: `Quản trị viên quyết định hoàn tiền${note ? ': ' + note : ''}` });
    if (!ok) return { ok: false, message: 'Yêu cầu đã được xử lý xong trước đó.' };
    return finishRefund(order, 'admin', { restock: !!restock });
  }
  if (decision === 'close') {
    if (note.length < 10) return { ok: false, message: 'Vui lòng ghi lý do đóng yêu cầu (ít nhất 10 ký tự).' };
    const ok = await transition(order, open, { 'returnRequest.status': 'closed', 'returnRequest.resolvedBy': 'admin', 'returnRequest.resolution': note, 'returnRequest.closedAt': new Date() },
      { by: 'admin', note: `Quản trị viên đóng yêu cầu trả hàng, không hoàn tiền: ${note}` });
    return ok ? { ok: true, message: 'Đã đóng yêu cầu trả hàng.' } : { ok: false, message: 'Yêu cầu đã được xử lý xong trước đó.' };
  }
  return { ok: false, message: 'Quyết định không hợp lệ.' };
}

module.exports = { RETURN_DAYS, RETURN_LIMIT_30D, SHOP_RESPONSE_HOURS, deliveredAtOf, returnDeadline, canRequestReturn, canDispute, recentReturnCount,
  requestReturn, approveReturn, shipReturn, receiveReturn, rejectReturn, disputeReturn, adminResolve, WHO };
