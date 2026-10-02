const mongoose = require('mongoose');

// Cấu hình custom do khách tạo trong Custom Builder (Đặc trưng 4)
const buildSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, default: 'Cấu hình của tôi' },
  kit: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  switch: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  switchQty: { type: Number, default: 0 },
  keycap: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  stab: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomService' },
  note: { type: String, default: '' },
  total: { type: Number, default: 0 },
  compat: {
    ok: { type: Boolean, default: true },
    issues: [{ code: String, level: String, message: String }]
  },
  status: { type: String, enum: ['draft', 'saved', 'ordered'], default: 'saved' }
}, { timestamps: true });

buildSchema.pre('save', function (next) {
  if (!this.code) this.code = 'B-' + Math.floor(1000 + Math.random() * 9000) + Date.now().toString().slice(-3);
  next();
});

module.exports = mongoose.model('Build', buildSchema);
