const mongoose = require('mongoose');

const shopSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  address: { type: String, default: '' },
  city: { type: String, default: '' },
  phone: { type: String, default: '' },
  color: { type: String, default: '#1B62F5' },
  status: { type: String, enum: ['pending', 'active', 'locked'], default: 'pending' },
  verified: { type: Boolean, default: false },
  offersCustom: { type: Boolean, default: false },
  capacityPerWeek: { type: Number, default: 10 },
  followers: { type: Number, default: 0 },
  rating: { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 },
  rejectReason: String
}, { timestamps: true });

shopSchema.virtual('initials').get(function () {
  const w = this.name.trim().split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
});

module.exports = mongoose.model('Shop', shopSchema);
