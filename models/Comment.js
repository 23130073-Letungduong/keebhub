const mongoose = require('mongoose');

// Hỏi đáp / bình luận dưới sản phẩm — seller & admin có thể trả lời
const replySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: String,
  isSeller: { type: Boolean, default: false },
  content: String,
  at: { type: Date, default: Date.now }
});

const commentSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  replies: [replySchema]
}, { timestamps: true });

module.exports = mongoose.model('Comment', commentSchema);
