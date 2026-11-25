const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name: String,
  image: String,
  partType: String,
  price: Number,
  qty: Number,
  role: { type: String, default: '' }, // kit/switch/keycap/stab khi thuộc build
  reviewed: { type: Boolean, default: false }
}, { _id: true });

const stageSchema = new mongoose.Schema({
  name: String,
  note: { type: String, default: '' },
  photos: [String],
  status: { type: String, enum: ['todo', 'doing', 'done'], default: 'todo' },
  doneAt: Date,
  updatedAt: Date
});

const historySchema = new mongoose.Schema({
  status: String,
  note: String,
  by: String,
  at: { type: Date, default: Date.now }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true },
  items: [itemSchema],
  isCustom: { type: Boolean, default: false },
  build: { type: mongoose.Schema.Types.ObjectId, ref: 'Build' },
  buildCode: String,
  service: {
    ref: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomService' },
    name: String,
    price: Number,
    days: Number
  },
  customRequest: {
    status: { type: String, enum: ['waiting', 'accepted', 'rejected', ''], default: '' },
    note: String,
    respondedAt: Date,
    deadline: Date
  },
  progress: [stageSchema],
  subtotal: { type: Number, default: 0 },
  serviceFee: { type: Number, default: 0 },
  shippingFee: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  paymentMethod: { type: String, enum: ['cod', 'vnpay', 'wallet'], default: 'cod' },
  paymentStatus: { type: String, enum: ['unpaid', 'paid', 'failed', 'refund_pending', 'refunded'], default: 'unpaid' },
  paymentGroup: String,
  paidAt: Date,
  vnpTransactionNo: String,
  vnpCreateDate: String, // vnp_CreateDate gửi lúc tạo link thanh toán — API hoàn tiền cần giá trị này
  vnpPayDate: String,    // thời điểm VNPay ghi nhận thanh toán (yyyyMMddHHmmss)
  vnpBankCode: String,
  // Kết quả hoàn tiền (từ 11/2026 mọi khoản hoàn đều vào Ví KeebHub)
  refund: {
    method: { type: String, enum: ['wallet', 'vnpay', 'manual', ''], default: '' },
    auto: Boolean,
    amount: Number,
    requestId: String,
    transactionNo: String,   // mã GD hoàn VNPay (dữ liệu cũ)
    code: String,
    message: String,
    tries: { type: Number, default: 0 },
    at: Date,
    processing: Boolean,
    processingAt: Date
  },
  cancelledAt: Date,
  deliveredAt: Date,        // máy chủ ghi khi đơn chuyển "Đã giao" — mốc tính hạn trả hàng 7 ngày
  // Yêu cầu trả hàng / hoàn tiền sau khi nhận hàng
  returnRequest: {
    status: { type: String, enum: ['', 'requested', 'approved', 'shipped', 'refunded', 'rejected', 'disputed', 'closed'], default: '' },
    reason: String,          // mã lý do (RETURN_REASONS)
    detail: String,
    photos: [String],
    requestedAt: Date,
    approvedAt: Date,
    shopNote: String,
    trackingCode: String,    // mã vận đơn khách gửi trả
    shippedAt: Date,
    receivedAt: Date,
    rejectReason: String,
    rejectStage: String,     // 'request' (từ chối yêu cầu) | 'receipt' (nhận hàng không đạt)
    rejectedAt: Date,
    disputeNote: String,
    disputedAt: Date,
    resolvedBy: String,      // 'seller' | 'admin'
    resolution: String,
    closedAt: Date
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipping', 'delivered', 'completed', 'cancelled', 'returned'],
    default: 'pending'
  },
  shipping: {
    fullName: String,
    phone: String,
    address: String,
    method: { type: String, default: 'standard' },
    carrier: { type: String, default: 'Giao Hàng Nhanh' },
    trackingCode: String
  },
  note: String,
  cancelReason: String,
  cancelledBy: String,
  history: [historySchema]
}, { timestamps: true });

let seq = Math.floor(Math.random() * 100);
orderSchema.pre('save', function (next) {
  if (!this.code) {
    seq = (seq + 1) % 100;
    this.code = 'KH-' + (Date.now() % 10000000).toString().padStart(7, '0') + String(seq).padStart(2, '0');
  }
  next();
});

orderSchema.virtual('progressPercent').get(function () {
  if (!this.progress || !this.progress.length) return 0;
  return Math.round(this.progress.filter(s => s.status === 'done').length / this.progress.length * 100);
});

orderSchema.statics.STATUS = {
  pending: { label: 'Chờ xác nhận', cls: 'warn' },
  confirmed: { label: 'Đã xác nhận', cls: 'new' },
  processing: { label: 'Đang gia công', cls: 'warn' },
  shipping: { label: 'Đang giao', cls: 'new' },
  delivered: { label: 'Đã giao', cls: 'ok' },
  completed: { label: 'Hoàn thành', cls: 'ok' },
  cancelled: { label: 'Đã huỷ', cls: 'err' },
  returned: { label: 'Đã trả hàng', cls: 'gray' }
};
orderSchema.statics.PAY = {
  unpaid: { label: 'Chưa thanh toán', cls: 'gray' },
  paid: { label: 'Đã thanh toán', cls: 'ok' },
  failed: { label: 'Thanh toán lỗi', cls: 'err' },
  refund_pending: { label: 'Chờ hoàn tiền', cls: 'warn' },
  refunded: { label: 'Đã hoàn tiền', cls: 'gray' }
};

// Lý do trả hàng: CHỈ lỗi phía người bán / vận chuyển (không nhận "đổi ý") — theo chính sách đổi trả 7 ngày
orderSchema.statics.RETURN_REASONS = {
  defect: 'Sản phẩm lỗi / không hoạt động',
  wrong_item: 'Giao sai sản phẩm / sai phân loại',
  missing: 'Thiếu hàng / thiếu phụ kiện',
  damaged: 'Hư hỏng, móp méo do vận chuyển'
};
orderSchema.statics.RETURN_STATUS = {
  requested: { label: 'Chờ shop duyệt', cls: 'warn' },
  approved: { label: 'Chờ khách gửi hàng', cls: 'new' },
  shipped: { label: 'Khách đã gửi hàng', cls: 'new' },
  refunded: { label: 'Đã hoàn tiền vào ví', cls: 'ok' },
  rejected: { label: 'Shop từ chối', cls: 'err' },
  disputed: { label: 'Đang khiếu nại lên sàn', cls: 'warn' },
  closed: { label: 'Đã đóng (không hoàn)', cls: 'gray' }
};

module.exports = mongoose.model('Order', orderSchema);
