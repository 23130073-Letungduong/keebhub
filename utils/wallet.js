// Ví KeebHub — mọi thay đổi số dư đi qua 2 hàm dưới đây:
//  - Cập nhật bằng $inc NGUYÊN TỬ trong MongoDB (không đọc-sửa-ghi) → 2 yêu cầu cùng lúc không làm sai số dư
//  - Trừ tiền có điều kiện "số dư ≥ số tiền" ngay trong câu lệnh → không bao giờ âm ví, không tiêu 2 lần cùng 1 khoản
//  - Mỗi lần cộng/trừ ghi 1 dòng sổ WalletTxn (kèm số dư sau giao dịch) để đối soát
const { User, WalletTxn } = require('../models');

function checkAmount(amount) {
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount) !== amount) throw new Error('Số tiền ví không hợp lệ');
}

async function credit(userId, amount, { type, order, orderCodes = [], note = '' } = {}) {
  checkAmount(amount);
  const u = await User.findOneAndUpdate({ _id: userId }, { $inc: { wallet: amount } }, { new: true }).select('wallet');
  if (!u) throw new Error('Không tìm thấy tài khoản để cộng ví');
  await WalletTxn.create({ user: userId, type, amount, balanceAfter: u.wallet, order, orderCodes, note });
  return u.wallet;
}

// Trả về số dư mới, hoặc null nếu không đủ tiền
async function debit(userId, amount, { type = 'payment', order, orderCodes = [], note = '' } = {}) {
  checkAmount(amount);
  const u = await User.findOneAndUpdate({ _id: userId, wallet: { $gte: amount } }, { $inc: { wallet: -amount } }, { new: true }).select('wallet');
  if (!u) return null;
  await WalletTxn.create({ user: userId, type, amount: -amount, balanceAfter: u.wallet, order, orderCodes, note });
  return u.wallet;
}

async function balance(userId) {
  const u = await User.findById(userId).select('wallet');
  return u ? u.wallet || 0 : 0;
}

module.exports = { credit, debit, balance };
