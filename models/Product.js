const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  partType: { type: String, enum: ['kit', 'switch', 'keycap', 'stabilizer', 'accessory', 'prebuilt'], required: true },
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true },
  sku: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  oldPrice: { type: Number, default: 0 },
  stock: { type: Number, default: 0, min: 0 },
  lowStock: { type: Number, default: 5 },
  sold: { type: Number, default: 0 },
  images: [String],
  // Thông số để vẽ ảnh minh hoạ SVG khi shop chưa upload ảnh
  art: {
    kind: { type: String, default: 'kit' },
    color: { type: String, default: '#4B5563' },
    accent: { type: String, default: '#1B62F5' },
    bg: { type: String, default: '#E7EBF0' }
  },
  description: { type: String, default: '' },
  specs: [{ k: String, v: String }],
  // Thuộc tính kỹ thuật dùng cho kiểm tra tương thích
  attrs: {
    layout: String,          // kit/keycap: 60%, 65%, 75%, TKL, Full
    keyCount: Number,        // kit: số phím (số switch cần)
    mount: String,           // kit: gasket, tray, top...
    hotswap: Boolean,        // kit
    pins: [Number],          // kit: số chân hỗ trợ [3,5]; switch: [3] hoặc [5]
    ledDirection: String,    // kit: south | north
    stabMount: String,       // kit + stab: pcb-screw | pcb-clip | plate
    switchType: String,      // switch: linear | tactile | clicky | silent
    force: Number,           // switch: g
    profile: String,         // keycap: Cherry, OEM, SA, XDA, MDA, ASA
    layouts: [String],       // keycap: các layout hỗ trợ
    material: String
  },
  status: { type: String, enum: ['pending', 'active', 'hidden', 'rejected'], default: 'pending' },
  rejectReason: String,
  rating: { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 }
}, { timestamps: true });


productSchema.virtual('discount').get(function () {
  if (!this.oldPrice || this.oldPrice <= this.price) return 0;
  return Math.round((1 - this.price / this.oldPrice) * 100);
});
productSchema.virtual('image').get(function () {
  return this.images && this.images.length ? this.images[0] : `/img/p/${this._id}.svg`;
});

module.exports = mongoose.model('Product', productSchema);
