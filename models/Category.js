const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  icon: { type: String, default: '⌨' },
  bg: { type: String, default: '#EEF4FF' },
  fg: { type: String, default: '#1B62F5' },
  partType: { type: String, enum: ['kit', 'switch', 'keycap', 'stabilizer', 'accessory', 'prebuilt'], required: true },
  order: { type: Number, default: 0 }
});

module.exports = mongoose.model('Category', categorySchema);
