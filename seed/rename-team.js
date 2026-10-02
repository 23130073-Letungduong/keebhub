// Đổi tên các tài khoản demo thành thành viên nhóm — KHÔNG xoá dữ liệu
// Chạy: node seed/rename-team.js
require('dotenv').config();
const mongoose = require('mongoose');
const { User, Order } = require('../models');

const TEAM = [
  { email: 'admin@keebhub.vn', name: 'Lê Tùng Dương' },
  { email: 'switchhouse@keebhub.vn', name: 'Trần Minh Khang' },
  { email: 'keeblab@keebhub.vn', name: 'Phan Văn Gia Bảo' },
  { email: 'khach@keebhub.vn', name: 'Trần Hữu Thắng' }
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/keebhub');
  for (const t of TEAM) {
    const u = await User.findOne({ email: t.email });
    if (!u) { console.log('  - Không thấy', t.email); continue; }
    const old = u.name;
    u.name = t.name;
    if (u.address && (!u.address.fullName || u.address.fullName === old)) u.address.fullName = t.name;
    await u.save();
    const r = await Order.updateMany({ user: u._id, 'shipping.fullName': old }, { 'shipping.fullName': t.name });
    console.log(`  ✓ ${t.email}: ${old} → ${t.name} (${r.modifiedCount} đơn hàng)`);
  }
  await mongoose.disconnect();
  console.log('Xong!');
})().catch(e => { console.error(e); process.exit(1); });
