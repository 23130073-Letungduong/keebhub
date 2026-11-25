// Sổ giao dịch Ví KeebHub — mỗi lần cộng/trừ ví là 1 dòng, không sửa/xoá
const mongoose = require('mongoose');

const walletTxnSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['refund_cancel', 'refund_return', 'payment', 'payment_reverse'], required: true },
  amount: { type: Number, required: true },        // + cộng vào ví, - trừ khỏi ví
  balanceAfter: { type: Number, required: true },  // số dư sau giao dịch
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  orderCodes: [String],
  note: { type: String, default: '' }
}, { timestamps: true });

walletTxnSchema.statics.TYPE = {
  refund_cancel: { label: 'Hoàn tiền đơn huỷ', cls: 'ok' },
  refund_return: { label: 'Hoàn tiền trả hàng', cls: 'ok' },
  payment: { label: 'Thanh toán đơn hàng', cls: 'warn' },
  payment_reverse: { label: 'Hoàn lại (đặt hàng không thành công)', cls: 'ok' }
};

module.exports = mongoose.model('WalletTxn', walletTxnSchema);
