const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const COLORS = ['#1B62F5', '#E84708', '#7C3AED', '#079455', '#DC6803', '#0E7490', '#BE185D', '#475467'];

const cartItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  build: { type: mongoose.Schema.Types.ObjectId, ref: 'Build' },
  qty: { type: Number, default: 1, min: 1 },
  addedAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String },
  phone: { type: String, default: '' },
  gender: { type: String, enum: ['', 'male', 'female', 'other'], default: '' },
  birthday: { type: Date },
  color: { type: String, default: () => COLORS[Math.floor(Math.random() * COLORS.length)] },
  avatar: { type: String, default: '' },
  role: { type: String, enum: ['customer', 'seller', 'admin'], default: 'customer' },
  status: { type: String, enum: ['active', 'locked'], default: 'active' },
  emailVerified: { type: Boolean, default: false },
  verifyToken: String,
  verifyExpires: Date,
  verifySentAt: Date, // lần gửi email xác nhận gần nhất (chống bấm Gửi lại liên tục)
  resetToken: String,
  resetExpires: Date,
  resetSentAt: Date,
  pwdAt: Date,        // lần đổi mật khẩu gần nhất → các phiên đăng nhập cũ (thiết bị khác) bị đăng xuất  // lần gửi email đặt lại mật khẩu gần nhất (chống spam)
  checkoutAt: Date,   // khoá đặt hàng tạm thời (chống bấm Đặt hàng 2 lần)
  googleId: String,
  facebookId: String,
  address: {
    fullName: { type: String, default: '' },
    phone: { type: String, default: '' },
    line: { type: String, default: '' }
  },
  cart: [cartItemSchema],
  wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  viewed: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  lastLogin: Date,
  // Ví KeebHub: chỉ thay đổi qua utils/wallet.js ($inc nguyên tử + ghi sổ WalletTxn), KHÔNG gán trực tiếp
  wallet: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

userSchema.methods.setPassword = async function (plain) {
  this.password = await bcrypt.hash(plain, 10);
};
userSchema.methods.checkPassword = function (plain) {
  if (!this.password) return false;
  return bcrypt.compare(plain, this.password);
};
userSchema.virtual('initials').get(function () {
  const parts = (this.name || '?').trim().split(/\s+/);
  const a = parts.length > 1 ? parts[parts.length - 2][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return a.toUpperCase();
});

module.exports = mongoose.model('User', userSchema);
