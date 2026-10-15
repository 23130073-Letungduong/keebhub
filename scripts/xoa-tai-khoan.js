// Xoá hẳn 1 tài khoản khỏi database (kèm đơn hàng, đánh giá, hỏi đáp, cấu hình build, shop nếu là người bán)
// để đăng ký lại từ đầu bằng chính email đó.
// Chạy: node scripts/xoa-tai-khoan.js [email]     (xoa-tai-khoan.bat tự gọi)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, a => r(a.trim())));

(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/keebhub';
  try { await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 }); }
  catch (e) { console.log('✗ Không kết nối được MongoDB (' + uri + '). Hãy bật MongoDB rồi chạy lại.'); return done(1); }
  const { User, Shop, Product, CustomService, Order, Review, Comment, Build } = require('../models');

  let email = (process.argv[2] || '').trim();
  if (!email) email = await ask('Nhập email tài khoản cần xoá: ');
  email = email.toLowerCase();
  if (!email) { console.log('Chưa nhập email.'); return done(1); }

  const u = await User.findOne({ email });
  if (!u) { console.log('✗ Không có tài khoản nào với email ' + email + ' trong database "' + mongoose.connection.name + '".'); return done(0); }
  if (u.role === 'admin') { console.log('✗ Đây là tài khoản ADMIN — không xoá để tránh mất quyền quản trị.'); return done(1); }

  const shop = await Shop.findOne({ owner: u._id });
  const count = {
    orders: await Order.countDocuments({ user: u._id }),
    reviews: await Review.countDocuments({ user: u._id }),
    comments: await Comment.countDocuments({ user: u._id }),
    builds: await Build.countDocuments({ user: u._id })
  };
  console.log('\nTìm thấy tài khoản:');
  console.log('  Tên       : ' + u.name);
  console.log('  Email     : ' + u.email + (u.phone ? '   SĐT: ' + u.phone : ''));
  console.log('  Vai trò   : ' + u.role + (u.emailVerified ? ' (đã xác nhận email)' : ' (chưa xác nhận email)'));
  console.log('  Dữ liệu đi kèm sẽ xoá: ' + count.orders + ' đơn hàng, ' + count.reviews + ' đánh giá, ' + count.comments + ' hỏi đáp, ' + count.builds + ' cấu hình build'
    + (shop ? ', shop "' + shop.name + '" cùng sản phẩm và dịch vụ của shop' : ''));

  const ok = await ask('\nXoá HẲN tài khoản này? Gõ  y  rồi Enter để xoá, phím khác để huỷ: ');
  if (ok.toLowerCase() !== 'y') { console.log('Đã huỷ, không xoá gì.'); return done(0); }

  // Trả lại tồn kho cho các đơn chưa huỷ để số liệu kho đúng
  const orders = await Order.find({ user: u._id, status: { $ne: 'cancelled' } });
  for (const o of orders) for (const i of o.items) if (i.product) await Product.updateOne({ _id: i.product }, { $inc: { stock: i.qty || 0, sold: -(i.qty || 0) } });

  await Order.deleteMany({ user: u._id });
  await Review.deleteMany({ user: u._id });
  await Comment.deleteMany({ user: u._id });
  await Comment.updateMany({}, { $pull: { replies: { user: u._id } } });
  await Build.deleteMany({ user: u._id });
  if (shop) {
    await Product.deleteMany({ shop: shop._id });
    await CustomService.deleteMany({ shop: shop._id });
    await Shop.deleteOne({ _id: shop._id });
  }
  await User.deleteOne({ _id: u._id });
  // Đăng xuất mọi trình duyệt đang đăng nhập bằng tài khoản này
  try { await mongoose.connection.db.collection('sessions').deleteMany({ session: { $regex: String(u._id) } }); } catch (e) { /* bỏ qua */ }

  console.log('\n✓ Đã xoá tài khoản ' + email + '. Bây giờ có thể đăng ký lại bằng email này.');
  done(0);
})().catch(e => { console.log('✗ Lỗi: ' + e.message); done(1); });

function done(code) { rl.close(); mongoose.disconnect().finally(() => process.exit(code)); }
