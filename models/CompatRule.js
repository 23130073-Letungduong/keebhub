const mongoose = require('mongoose');

// Quy tắc tương thích 3 mức do admin cấu hình (Chặn / Cảnh báo / Gợi ý)
const ruleSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  parts: { type: String, default: '' },     // VD: "Kit ↔ Switch"
  description: { type: String, default: '' },
  level: { type: String, enum: ['block', 'warn', 'suggest'], default: 'warn' },
  message: { type: String, default: '' },  // có thể dùng {kit}, {switch}, {keycap}, {stab}, {service}
  enabled: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('CompatRule', ruleSchema);
