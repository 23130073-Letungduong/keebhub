const mongoose = require('mongoose');

// Gói dịch vụ gia công do seller quản lý (Đặc trưng 1)
const serviceSchema = new mongoose.Schema({
  shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  days: { type: Number, default: 5 },
  includes: [String],
  soldering: { type: Boolean, default: false }, // có hàn/rã hàn PCB không
  lube: { type: Boolean, default: false },
  stages: { type: [String], default: undefined }, // các công đoạn gia công
  active: { type: Boolean, default: true },
  orders: { type: Number, default: 0 }
}, { timestamps: true });

serviceSchema.statics.DEFAULT_STAGES = [
  'Kiểm tra linh kiện & PCB',
  'Lube switch',
  'Cân chỉnh stabilizer',
  'Lắp ráp & test toàn phím',
  'Đóng gói & bàn giao vận chuyển'
];

module.exports = mongoose.model('CustomService', serviceSchema);
