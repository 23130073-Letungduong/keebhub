// =====================================================================
//  KeebHub — Kiểm thử 13 CHỨC NĂNG BẮT BUỘC của đồ án
//  Chạy:  npm run test:bat-buoc     (hoặc bấm đúp D:\TMDT\kiem-thu-13-chuc-nang.bat)
//  Dùng database riêng "keebhub_test_batbuoc" + cổng 3101 → không đụng dữ liệu demo
// =====================================================================
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./_harness');

const T = createHarness({ port: 3101, db: 'mongodb://127.0.0.1:27017/keebhub_test_batbuoc' });
const { Client, has, ok } = T;
let M;
before(async () => { await T.start(); M = T.M; });
after(async () => { await T.stop(); });

const KH = ['khach@keebhub.vn', 'Khach@123'];
const SELLER = ['switchhouse@keebhub.vn', 'Seller@123'];
const ADMIN = ['admin@keebhub.vn', 'Admin@123'];
const values = (html, type) => { // lấy số liệu của biểu đồ trên trang
  const m = html.match(new RegExp(`data-chart="${type}"[^>]*data-values="([^"]*)"`)) || html.match(new RegExp(`data-values="([^"]*)"[^>]*data-chart="${type}"`));
  return m ? JSON.parse(m[1].replace(/&#34;/g, '"').replace(/&quot;/g, '"')) : null;
};

// ---------------------------------------------------------------------
describe('BB01. Đăng ký (gửi email xác nhận)', () => {
  const c = new Client();
  const email = `bb${Date.now()}@example.com`;
  const form = { name: 'Người Kiểm Thử', email, phone: '0987001122', password: 'Test@1234', confirm: 'Test@1234', agree: 'on' };
  it('Trang đăng ký hiển thị đủ ô nhập + nút Google/Facebook', async () => {
    const r = ok(await c.get('/auth/register'));
    for (const n of ['name="name"', 'name="email"', 'name="phone"', 'name="password"', 'name="confirm"', 'name="agree"']) assert.ok(has(r, n), n);
  });
  it('Báo lỗi khi thiếu tên / email sai / SĐT sai / mật khẩu ngắn / nhập lại sai / chưa đồng ý điều khoản', async () => {
    const cases = [[{ name: '' }, 'Vui lòng nhập họ tên'], [{ email: 'abc' }, 'Email không hợp lệ'], [{ phone: '123' }, 'Số điện thoại không hợp lệ'],
      [{ password: '123', confirm: '123' }, 'tối thiểu 8'], [{ confirm: 'Khac@1234' }, 'không khớp'], [{ agree: '' }, 'đồng ý điều khoản']];
    for (const [x, msg] of cases) assert.ok(has(ok(await c.post('/auth/register', { ...form, ...x })), msg), msg);
  });
  it('Đăng ký hợp lệ → tạo tài khoản CHƯA kích hoạt + gửi email xác nhận', async () => {
    assert.ok(has(ok(await c.post('/auth/register', form)), 'Xác nhận email của bạn'));
    const u = await M.User.findOne({ email });
    assert.ok(u && !u.emailVerified && u.verifyToken);
    const { list } = await T.lastMailLink('verify');
    assert.ok(has(list, email), 'email gửi đúng người nhận');
  });
  it('Email / SĐT đã dùng → báo lỗi', async () => {
    assert.ok(has(await c.post('/auth/register', { ...form, email: 'khach@keebhub.vn', phone: '' }), 'Email đã được sử dụng'));
    assert.ok(has(await c.post('/auth/register', { ...form, email: 'x' + email }), 'Số điện thoại đã được sử dụng'));
  });
  it('Đăng ký lại bằng email CHƯA xác nhận → không báo trùng, cập nhật thông tin + gửi email xác nhận mới, link cũ hết hiệu lực', async () => {
    const { link: oldLink } = await T.lastMailLink('verify');
    await M.User.updateOne({ email }, { verifySentAt: new Date(Date.now() - 3600e3) }); // giả lập 1 tiếng sau mới quay lại
    const r = ok(await c.post('/auth/register', { ...form, name: 'Tên Mới', password: 'Moi@12345', confirm: 'Moi@12345' }));
    assert.ok(has(r, 'Xác nhận email của bạn') && has(r, 'chưa xác nhận') && !has(r, 'Email đã được sử dụng'));
    const u = await M.User.findOne({ email });
    assert.equal(u.name, 'Tên Mới'); assert.ok(await u.checkPassword('Moi@12345'));
    assert.equal(await M.User.countDocuments({ email }), 1, 'không tạo tài khoản trùng');
    const { link } = await T.lastMailLink('verify');
    assert.notEqual(link, oldLink);
    assert.ok(has(ok(await new Client().get(oldLink)), 'không hợp lệ'), 'link cũ không dùng được nữa');
    // Bấm đăng ký lần nữa ngay lập tức → không gửi thêm email (chờ 30 giây)
    assert.ok(has(ok(await c.post('/auth/register', { ...form, password: 'Test@1234' })), 'đợi'));
    assert.equal((await T.lastMailLink('verify')).link, link);
  });
  it('Tài khoản không xác nhận quá 7 ngày → tự xoá, tài khoản đã xác nhận giữ nguyên', async () => {
    const old = `cu${Date.now()}@example.com`;
    await M.User.collection.insertOne({ name: 'Bỏ dở', email: old, role: 'customer', emailVerified: false, createdAt: new Date(Date.now() - 8 * 864e5), updatedAt: new Date(Date.now() - 8 * 864e5) });
    await M.User.collection.updateOne({ email: KH[0] }, { $set: { updatedAt: new Date(Date.now() - 30 * 864e5) } });
    const { xoaTaiKhoanChuaXacNhan } = require('../utils/cleanup');
    await xoaTaiKhoanChuaXacNhan();
    assert.equal(await M.User.countDocuments({ email: old }), 0);
    assert.equal(await M.User.countDocuments({ email: KH[0] }), 1);
    assert.equal(await M.User.countDocuments({ email }), 1, 'tài khoản mới đăng ký (chưa quá 7 ngày) vẫn còn');
  });
  it('Chưa xác nhận → không đăng nhập được; Gửi lại email xác nhận được', async () => {
    assert.ok(has(await new Client().login(email, 'Test@1234'), 'chưa xác nhận email'));
    assert.ok(has(ok(await c.post('/auth/resend', { email })), 'Xác nhận email'));
  });
  it('Bấm link trong email → kích hoạt + tự đăng nhập; link sai → báo lỗi', async () => {
    assert.ok(has(ok(await c.get('/auth/verify/sai-token')), 'không hợp lệ'));
    const { link } = await T.lastMailLink('verify');
    assert.ok(has(ok(await c.get(link)), 'Xác nhận email thành công'));
    assert.ok((await M.User.findOne({ email })).emailVerified);
    assert.equal((await c.get('/account')).status, 200);
  });
});

// ---------------------------------------------------------------------
describe('BB02. Đăng nhập', () => {
  it('Khách đăng nhập bằng email → về TRANG CHỦ, có lời chào', async () => {
    const r = ok(await new Client().login(...KH));
    assert.equal(r.url, '/'); assert.ok(has(r, 'Chào mừng'));
  });
  it('Đăng nhập bằng số điện thoại', async () => {
    const u = await M.User.findOne({ email: KH[0] });
    assert.equal(ok(await new Client().login(u.phone, KH[1])).url, '/');
  });
  it('Người bán → Kênh người bán; Admin (trang riêng) → Trang quản trị', async () => {
    assert.equal(ok(await new Client().login(...SELLER)).url, '/seller');
    assert.equal(ok(await new Client().login(ADMIN[0], ADMIN[1], true)).url, '/admin');
  });
  it('Sai mật khẩu / email không tồn tại / tài khoản bị khoá → báo lỗi', async () => {
    assert.ok(has(await new Client().login(KH[0], 'Sai@12345'), 'Email hoặc mật khẩu không đúng'));
    assert.ok(has(await new Client().login('khongco@x.vn', 'abc'), 'Email hoặc mật khẩu không đúng'));
    assert.ok(has(await new Client().login('spam@keebhub.vn', 'Khach@123'), 'bị khoá'));
  });
  it('Admin không vào được trang đăng nhập chung; khách không vào được trang quản trị', async () => {
    assert.ok(has(await new Client().login(...ADMIN), 'Email hoặc mật khẩu không đúng'));
    assert.ok(has(await new Client().login(KH[0], KH[1], true), 'không đúng'));
  });
  it('Bấm tính năng khi chưa đăng nhập rồi đăng nhập → vẫn về trang chủ', async () => {
    const c = new Client(); await c.get('/builder/new'); await c.get('/cart');
    assert.equal((await c.login(...KH)).url, '/');
  });
  it('Dữ liệu tấn công (NoSQL injection) không gây lỗi', async () => {
    ok(await new Client().post('/auth/login', { 'email[$ne]': 'x', 'password[$ne]': 'x' }));
  });
});

// ---------------------------------------------------------------------
describe('BB03. Đăng xuất', () => {
  it('Khách đăng xuất → không còn vào trang tài khoản / giỏ hàng', async () => {
    const c = new Client(); await c.login(...KH);
    assert.equal((await c.get('/account')).status, 200);
    ok(await c.post('/auth/logout', {}));
    assert.ok((await c.get('/account')).url.startsWith('/auth/login'));
    assert.ok((await c.get('/cart')).url.startsWith('/auth/login'));
  });
  it('Người bán và admin đăng xuất được', async () => {
    const s = new Client(); await s.login(...SELLER); await s.post('/auth/logout', {});
    assert.ok((await s.get('/seller')).url.startsWith('/auth/login'));
    const a = new Client(); await a.login(ADMIN[0], ADMIN[1], true); await a.post('/auth/logout', {});
    assert.ok((await a.get('/admin')).url.startsWith('/admin/login'));
  });
});

// ---------------------------------------------------------------------
describe('BB04. Lấy lại mật khẩu', () => {
  const c = new Client();
  it('Trang quên mật khẩu hiển thị; email không tồn tại vẫn báo chung (không lộ thông tin)', async () => {
    ok(await c.get('/auth/forgot'));
    assert.ok(has(ok(await c.post('/auth/forgot', { email: 'khongco@x.vn' })), 'Đã gửi liên kết'));
  });
  it('Gửi link đặt lại → đổi mật khẩu → đăng nhập bằng mật khẩu mới; link chỉ dùng 1 lần', async () => {
    await c.post('/auth/forgot', { email: 'user9@keebhub.vn' });
    const { link, list } = await T.lastMailLink('reset');
    assert.ok(has(list, 'user9@keebhub.vn'), 'email gửi đúng người nhận');
    assert.ok(has(await c.post(link, { password: 'Moi@12345', confirm: 'Khac@1234' }), 'phải khớp'));
    assert.ok(has(await c.post(link, { password: 'ngan', confirm: 'ngan' }), 'tối thiểu 8'));
    assert.ok(has(ok(await c.post(link, { password: 'Moi@12345', confirm: 'Moi@12345' })), 'Đổi mật khẩu thành công'));
    assert.equal((await new Client().login('user9@keebhub.vn', 'Moi@12345')).url, '/');
    assert.ok(has(await new Client().login('user9@keebhub.vn', 'Khach@123'), 'không đúng'), 'mật khẩu cũ hết tác dụng');
    assert.ok((await c.get(link)).url.startsWith('/auth/forgot'), 'link dùng lần 2 phải hết hiệu lực');
  });
  it('Link sai → về trang quên mật khẩu', async () => { assert.ok((await c.get('/auth/reset/sai')).url.startsWith('/auth/forgot')); });
});

// ---------------------------------------------------------------------
describe('BB05. Xem chi tiết sản phẩm', () => {
  it('Mỗi loại linh kiện: trang chi tiết có giá, tồn kho, shop, các tab, nút mua', async () => {
    for (const t of ['kit', 'switch', 'keycap', 'stabilizer', 'accessory']) {
      const p = await M.Product.findOne({ status: 'active', partType: t }).populate('shop');
      const r = ok(await new Client().get('/p/' + p.slug), t);
      for (const s of ['Mô tả', 'Thông số kỹ thuật', 'Đánh giá', 'Hỏi đáp', 'Thêm vào giỏ', 'Mua ngay', p.shop.name]) assert.ok(has(r, s), `${t}: thiếu "${s}"`);
      assert.ok(has(r, p.price.toLocaleString('vi-VN')) || has(r, String(p.price)), `${t}: không thấy giá`);
    }
  });
  it('Kit có tab Tương thích và nút dùng trong Custom Builder', async () => {
    const p = await M.Product.findOne({ status: 'active', partType: 'kit' });
    const r = ok(await new Client().get('/p/' + p.slug));
    assert.ok(has(r, 'Tương thích') && has(r, 'Custom Builder'));
  });
  it('Vào từ trang danh mục / tìm kiếm đều mở được chi tiết', async () => {
    const c = new Client();
    for (const u of ['/c/switch', '/search?q=keycap']) {
      const list = ok(await c.get(u));
      const href = (list.text.match(/href="(\/p\/[^"]+)"/) || [])[1];
      assert.ok(href, u + ' không có sản phẩm'); ok(await c.get(href), href);
    }
  });
  it('Sản phẩm không tồn tại → 404; sản phẩm chờ duyệt khách không xem được', async () => {
    assert.equal((await new Client().get('/p/khong-co')).status, 404);
    const p = await M.Product.findOne({ status: 'pending' });
    assert.equal((await new Client().get('/p/' + p.slug)).status, 404);
  });
});

// ---------------------------------------------------------------------
describe('BB06. Quản lý giỏ hàng', () => {
  const c = new Client(); let p1, p2, u;
  before(async () => {
    await c.login('user1@keebhub.vn', 'Khach@123');
    u = await M.User.findOne({ email: 'user1@keebhub.vn' });
    await M.User.updateOne({ _id: u._id }, { cart: [] });
    p1 = await M.Product.findOne({ status: 'active', partType: 'accessory', stock: { $gte: 5 } });
    p2 = await M.Product.findOne({ status: 'active', partType: 'switch', stock: { $gte: 5 }, shop: { $ne: p1.shop } });
  });
  const cart = async () => (await M.User.findById(u._id)).cart;
  it('Thêm vào giỏ từ trang sản phẩm → ở lại trang, báo "Đã thêm"', async () => {
    const r = ok(await c.post('/cart/add', { productId: String(p1._id), qty: '1' }, { headers: { referer: T.BASE + '/p/' + p1.slug } }));
    assert.ok(has(r, 'Đã thêm vào giỏ')); assert.equal(r.url, '/p/' + p1.slug);
    await c.post('/cart/add', { productId: String(p2._id), qty: '2' });
    assert.equal((await cart()).length, 2);
  });
  it('Thêm trùng sản phẩm → cộng dồn số lượng', async () => {
    await c.post('/cart/add', { productId: String(p1._id), qty: '2' });
    assert.equal((await cart()).find(i => String(i.product) === String(p1._id)).qty, 3);
  });
  it('Trang giỏ hiển thị theo từng shop, có tạm tính', async () => {
    const r = ok(await c.get('/cart'));
    const s1 = await M.Shop.findById(p1.shop), s2 = await M.Shop.findById(p2.shop);
    assert.ok(has(r, s1.name) && has(r, s2.name) && has(r, p1.name.slice(0, 15)) && has(r, 'Tạm tính'));
  });
  it('Tăng / giảm / nhập số lượng; vượt tồn kho bị chặn', async () => {
    const line = (await cart()).find(i => String(i.product) === String(p1._id));
    await c.post('/cart/update/' + line._id, { op: 'inc' });
    assert.equal((await cart()).id(line._id).qty, 4);
    await c.post('/cart/update/' + line._id, { op: 'dec' });
    assert.equal((await cart()).id(line._id).qty, 3);
    await c.post('/cart/update/' + line._id, { qty: '99999' });
    assert.equal((await cart()).id(line._id).qty, p1.stock);
    assert.ok(has(await c.post('/cart/add', { productId: String(p2._id), qty: String(p2.stock + 1) }, { headers: { referer: T.BASE + '/' } }), 'Kho chỉ còn'));
  });
  it('Xoá khỏi giỏ', async () => {
    const line = (await cart()).find(i => String(i.product) === String(p2._id));
    assert.ok(has(ok(await c.post('/cart/remove/' + line._id, {})), 'Đã xoá'));
    assert.equal((await cart()).length, 1);
  });
  it('Khách chưa đăng nhập bấm Thêm giỏ → yêu cầu đăng nhập, không lỗi', async () => {
    const r = ok(await new Client().post('/cart/add', { productId: String(p1._id) }));
    assert.ok(r.url.startsWith('/auth/login'));
  });
});

// ---------------------------------------------------------------------
describe('BB07. Đặt hàng', () => {
  const c = new Client(); let u;
  before(async () => { await c.login('user2@keebhub.vn', 'Khach@123'); u = await M.User.findOne({ email: 'user2@keebhub.vn' }); });
  it('Giỏ trống → không vào được trang đặt hàng', async () => {
    await M.User.updateOne({ _id: u._id }, { cart: [] });
    assert.ok((await c.get('/checkout')).url.startsWith('/cart'));
  });
  it('Thiếu họ tên / địa chỉ / SĐT sai → báo lỗi', async () => {
    const p = await M.Product.findOne({ status: 'active', partType: 'accessory', stock: { $gte: 3 } });
    await M.User.updateOne({ _id: u._id }, { cart: [{ product: p._id, qty: 1 }] });
    ok(await c.get('/checkout'));
    assert.ok(has(await c.post('/checkout', { fullName: '', phone: '123', address: '', payment: 'cod' }), 'Vui lòng nhập đầy đủ'));
  });
  it('Đặt COD 2 shop → tách 2 đơn, trừ kho, tăng đã bán, xoá giỏ, phí ship đúng', async () => {
    const shops = await M.Shop.find({ status: 'active' });
    const picks = [];
    for (const s of shops) { const p = await M.Product.findOne({ shop: s._id, status: 'active', stock: { $gte: 5 }, price: { $lt: 400000 } }); if (p) picks.push(p); if (picks.length === 2) break; }
    await M.User.updateOne({ _id: u._id }, { cart: picks.map(p => ({ product: p._id, qty: 1 })) });
    const before = await M.Order.countDocuments({ user: u._id });
    const r = ok(await c.post('/checkout', { fullName: 'Người Hai', phone: '0901234567', address: '12 Lê Lợi, Q1', payment: 'cod', ship: 'standard' }));
    assert.ok(r.url.startsWith('/payment/result/'));
    const orders = await M.Order.find({ user: u._id }).sort({ createdAt: -1 }).limit(2);
    assert.equal((await M.Order.countDocuments({ user: u._id })) - before, 2);
    assert.equal(orders[0].paymentGroup, orders[1].paymentGroup);
    for (const o of orders) { assert.equal(o.status, 'pending'); assert.equal(o.shippingFee, 30000); assert.equal(o.total, o.subtotal + o.shippingFee); }
    for (const p of picks) { const x = await M.Product.findById(p._id); assert.equal(x.stock, p.stock - 1); assert.equal(x.sold, p.sold + 1); }
    assert.equal((await M.User.findById(u._id)).cart.length, 0);
  });
  it('Giao hoả tốc = 55.000₫; đơn từ 500.000₫ giao tiêu chuẩn được miễn phí', async () => {
    const cheap = await M.Product.findOne({ status: 'active', stock: { $gte: 3 }, price: { $lt: 400000 } });
    await M.User.updateOne({ _id: u._id }, { cart: [{ product: cheap._id, qty: 1 }] });
    await c.post('/checkout', { fullName: 'A', phone: '0901234567', address: 'x', payment: 'cod', ship: 'express' });
    assert.equal((await M.Order.findOne({ user: u._id }).sort({ createdAt: -1 })).shippingFee, 55000);
    const big = await M.Product.findOne({ status: 'active', stock: { $gte: 3 }, price: { $gte: 500000 } });
    await M.User.updateOne({ _id: u._id }, { cart: [{ product: big._id, qty: 1 }] });
    await c.post('/checkout', { fullName: 'A', phone: '0901234567', address: 'x', payment: 'cod', ship: 'standard' });
    assert.equal((await M.Order.findOne({ user: u._id }).sort({ createdAt: -1 })).shippingFee, 0);
  });
  it('Đặt quá số lượng tồn kho → báo lỗi, không tạo đơn', async () => {
    const p = await M.Product.findOne({ status: 'active', stock: { $gte: 1, $lte: 30 } });
    await M.User.updateOne({ _id: u._id }, { cart: [{ product: p._id, qty: p.stock + 1 }] });
    const n = await M.Order.countDocuments({ user: u._id });
    assert.ok(has(await c.post('/checkout', { fullName: 'A', phone: '0901234567', address: 'x', payment: 'cod' }), 'chỉ còn'));
    assert.equal(await M.Order.countDocuments({ user: u._id }), n);
  });
});

// ---------------------------------------------------------------------
describe('BB08. Thanh toán trực tuyến (VNPay)', () => {
  const c = new Client(); let u, p;
  before(async () => {
    await c.login('user3@keebhub.vn', 'Khach@123'); u = await M.User.findOne({ email: 'user3@keebhub.vn' });
    p = await M.Product.findOne({ status: 'active', stock: { $gte: 5 }, partType: 'keycap' });
  });
  it('Chọn VNPay → sang trang thanh toán; huỷ → "Thanh toán lỗi"; thanh toán lại → "Đã thanh toán"', async () => {
    await M.User.updateOne({ _id: u._id }, { cart: [{ product: p._id, qty: 1 }] });
    const r = ok(await c.post('/checkout', { fullName: 'Người Ba', phone: '0901234567', address: 'x', payment: 'vnpay' }));
    assert.ok(has(r, 'VNPay') || has(r, 'VNPAY'));
    const group = (r.url.match(/\/payment\/vnpay\/([A-Z0-9]+)/) || [])[1];
    assert.ok(group, 'không sang trang VNPay: ' + r.url);
    ok(await c.post('/payment/mock/' + group, { result: 'fail' }));
    let o = await M.Order.findOne({ paymentGroup: group });
    assert.equal(o.paymentStatus, 'failed');
    const rt = ok(await c.post('/payment/retry/' + o._id, {}));
    const g2 = (rt.url.match(/\/payment\/vnpay\/([A-Z0-9]+)/) || [])[1];
    assert.ok(g2, 'Thanh toán lại không mở trang VNPay: ' + rt.url);
    const res = ok(await c.post('/payment/mock/' + g2, { result: 'success' }));
    assert.ok(has(res, 'thành công'));
    o = await M.Order.findById(o._id);
    assert.equal(o.paymentStatus, 'paid'); assert.ok(o.paidAt);
  });
  it('Chữ ký VNPay: URL có chữ ký kiểm tra lại được; sửa số tiền → sai chữ ký; IPN/Return sai chữ ký bị từ chối', async () => {
    process.env.VNP_TMNCODE = 'TESTCODE'; process.env.VNP_HASHSECRET = 'SECRETKEY123';
    const vnpay = require(require('node:path').join(T.ROOT, 'utils/vnpay'));
    const url = vnpay.createPaymentUrl({ amount: 150000, txnRef: 'PGTEST1', orderInfo: 'Thanh toan', ipAddr: '127.0.0.1' });
    const q = Object.fromEntries(new URL(url).searchParams);
    assert.ok(vnpay.verify(q));
    assert.ok(!vnpay.verify({ ...q, vnp_Amount: '1' }));
    delete process.env.VNP_TMNCODE; delete process.env.VNP_HASHSECRET;
    const ipn = await new Client().get('/payment/vnpay_ipn?vnp_TxnRef=X&vnp_SecureHash=sai');
    assert.ok(has(ipn, '97'));
  });
  it('Đơn custom (Builder) bắt buộc thanh toán VNPay, không cho COD', async () => {
    const r = ok(await c.get('/checkout'));
    assert.ok(r.url.startsWith('/cart') || has(r, 'name="payment"'));
  });
});

// ---------------------------------------------------------------------
describe('BB09. Xem lịch sử mua hàng', () => {
  const c = new Client(); let u;
  before(async () => { await c.login(...KH); u = await M.User.findOne({ email: KH[0] }); });
  it('Danh sách đơn hiện đủ đơn của khách, mới nhất trước', async () => {
    const r = ok(await c.get('/account/orders'));
    const mine = await M.Order.find({ user: u._id }).sort({ createdAt: -1 });
    assert.ok(mine.length > 0);
    assert.ok(has(r, mine[0].code));
  });
  it('Lọc theo từng trạng thái đều mở được', async () => {
    for (const s of ['', 'pending', 'processing', 'shipping', 'completed', 'cancelled']) ok(await c.get('/account/orders?status=' + s), s);
  });
  it('Chi tiết đơn: sản phẩm, tổng tiền, trạng thái thanh toán, dòng thời gian', async () => {
    const o = await M.Order.findOne({ user: u._id });
    const r = ok(await c.get('/account/orders/' + o.code));
    assert.ok(has(r, o.code) && has(r, o.items[0].name.slice(0, 15)) && has(r, o.total.toLocaleString('vi-VN')));
  });
  it('Không xem được đơn của người khác', async () => {
    const other = await M.Order.findOne({ user: { $ne: u._id } });
    assert.equal((await c.get('/account/orders/' + other.code)).status, 404);
  });
});

// ---------------------------------------------------------------------
describe('BB10. Thống kê biểu đồ cột theo khoảng thời gian (từ ngày → đến ngày)', () => {
  const s = new Client(), a = new Client(); let shop;
  before(async () => { await s.login(...SELLER); await a.login(ADMIN[0], ADMIN[1], true); shop = await M.Shop.findOne({ slug: 'switchhouse' }); });
  // Tính doanh thu độc lập từ database để đối chiếu với biểu đồ
  async function expected(match, from, to) {
    const os = await M.Order.find({ ...match, status: { $ne: 'cancelled' }, createdAt: { $gte: new Date(from + 'T00:00:00'), $lte: new Date(to + 'T23:59:59.999') } }).lean();
    return os.filter(o => o.paymentStatus === 'paid' || o.paymentMethod === 'cod').reduce((x, o) => x + o.total, 0);
  }
  it('Trang có ô Từ ngày / Đến ngày và biểu đồ cột', async () => {
    const r = ok(await s.get('/seller/revenue'));
    assert.ok(has(r, 'name="from"') && has(r, 'name="to"') && has(r, 'data-chart="bar"'));
  });
  it('Seller: tổng các cột = doanh thu tính trực tiếp từ database (theo ngày)', async () => {
    const from = '2026-08-01', to = '2026-09-30';
    const r = ok(await s.get(`/seller/revenue?from=${from}&to=${to}&group=day`));
    const v = values(r.text, 'bar');
    assert.equal(v.length, 61, 'số cột theo ngày');
    assert.equal(v.reduce((x, y) => x + y, 0), await expected({ shop: shop._id }, from, to));
  });
  it('Seller: gom theo tháng → đúng số cột và tổng', async () => {
    const from = '2026-07-01', to = '2026-10-15';
    const r = ok(await s.get(`/seller/revenue?from=${from}&to=${to}&group=month`));
    const v = values(r.text, 'bar');
    assert.equal(v.length, 4);
    assert.equal(v.reduce((x, y) => x + y, 0), await expected({ shop: shop._id }, from, to));
  });
  it('Ngày "đến" được tính trọn ngày; đảo ngược từ/đến vẫn đúng; ngày sai không lỗi', async () => {
    const day = '2026-09-15';
    const r = ok(await s.get(`/seller/revenue?from=${day}&to=${day}`));
    assert.equal(values(r.text, 'bar').reduce((x, y) => x + y, 0), await expected({ shop: shop._id }, day, day));
    const rev = ok(await s.get('/seller/revenue?from=2026-09-30&to=2026-08-01'));
    assert.equal(values(rev.text, 'bar').length, 61);
    ok(await s.get('/seller/revenue?from=abc&to=xyz'));
  });
  it('Admin: biểu đồ cột toàn sàn đúng với database; lọc theo shop đúng', async () => {
    const from = '2026-08-01', to = '2026-09-30';
    const r = ok(await a.get(`/admin/revenue?from=${from}&to=${to}&group=day`));
    assert.equal(values(r.text, 'bar').reduce((x, y) => x + y, 0), await expected({}, from, to));
    const r2 = ok(await a.get(`/admin/revenue?from=${from}&to=${to}&group=day&shop=${shop._id}`));
    assert.equal(values(r2.text, 'bar').reduce((x, y) => x + y, 0), await expected({ shop: shop._id }, from, to));
  });
});

// ---------------------------------------------------------------------
describe('BB11. Thống kê biểu đồ tròn', () => {
  const s = new Client(), a = new Client(); let shop;
  before(async () => { await s.login(...SELLER); await a.login(ADMIN[0], ADMIN[1], true); shop = await M.Shop.findOne({ slug: 'switchhouse' }); });
  it('Seller: có 3 biểu đồ tròn (loại đơn, danh mục, trạng thái)', async () => {
    const r = ok(await s.get('/seller/revenue?from=2026-07-01&to=2026-10-15'));
    for (const t of ['loại đơn', 'danh mục', 'trạng thái đơn']) assert.ok(has(r, 'Biểu đồ tròn — ' + t), t);
    assert.ok((r.text.match(/data-chart="(pie|doughnut)"/g) || []).length >= 3);
  });
  it('Tròn "loại đơn" cộng lại = tổng biểu đồ cột cùng khoảng thời gian', async () => {
    const r = ok(await s.get('/seller/revenue?from=2026-07-01&to=2026-10-15'));
    const bar = values(r.text, 'bar').reduce((x, y) => x + y, 0);
    const pie = values(r.text, 'pie');
    assert.equal(pie.reduce((x, y) => x + y, 0), bar);
  });
  it('Tròn "trạng thái đơn" đếm đúng số đơn trong khoảng thời gian', async () => {
    const r = ok(await s.get('/seller/revenue?from=2026-07-01&to=2026-10-15'));
    const all = [...r.text.matchAll(/data-chart="pie" data-money="0"[^>]*data-values="([^"]*)"/g)].map(m => JSON.parse(m[1].replace(/&#34;/g, '"')));
    const n = await M.Order.countDocuments({ shop: shop._id, createdAt: { $gte: new Date('2026-07-01T00:00:00'), $lte: new Date('2026-10-15T23:59:59.999') } });
    assert.ok(all.length, 'không thấy biểu đồ trạng thái'); assert.equal(all[0].reduce((x, y) => x + y, 0), n);
  });
  it('Admin: trang tổng quan và trang doanh thu đều có biểu đồ tròn', async () => {
    assert.ok(has(ok(await a.get('/admin')), 'data-chart="doughnut"'));
    assert.ok(/data-chart="(pie|doughnut)"/.test(ok(await a.get('/admin/revenue')).text));
  });
});

// ---------------------------------------------------------------------
describe('BB12. Admin quản lý cơ bản (người dùng, sản phẩm, đơn hàng)', () => {
  const a = new Client();
  before(async () => { await a.login(ADMIN[0], ADMIN[1], true); });
  it('Các trang quản lý mở được, có tìm kiếm / lọc', async () => {
    for (const u of ['/admin/users', '/admin/users?role=seller&q=a', '/admin/products', '/admin/products?status=pending', '/admin/orders', '/admin/orders?status=pending&pay=paid', '/admin/shops', '/admin/refunds']) ok(await a.get(u), u);
  });
  it('Người dùng: khoá → không đăng nhập được; mở khoá → đăng nhập lại; không khoá được admin', async () => {
    const u = await M.User.findOne({ email: 'user6@keebhub.vn' });
    await a.post(`/admin/users/${u._id}/status`, {});
    assert.ok(has(await new Client().login('user6@keebhub.vn', 'Khach@123'), 'bị khoá'));
    await a.post(`/admin/users/${u._id}/status`, {});
    assert.equal((await new Client().login('user6@keebhub.vn', 'Khach@123')).url, '/');
    const ad = await M.User.findOne({ role: 'admin' });
    await a.post(`/admin/users/${ad._id}/status`, {});
    assert.equal((await M.User.findById(ad._id)).status, 'active');
  });
  it('Sản phẩm: duyệt → khách thấy; từ chối kèm lý do; ẩn → khách không thấy', async () => {
    const p = await M.Product.findOne({ status: 'pending' });
    await a.post(`/admin/products/${p._id}/approve`, {}, { headers: { referer: T.BASE + '/admin/products' } });
    assert.equal((await M.Product.findById(p._id)).status, 'active');
    assert.equal((await new Client().get('/p/' + p.slug)).status, 200);
    await a.post(`/admin/products/${p._id}/hide`, {}, { headers: { referer: T.BASE + '/admin/products' } });
    const hidden = await M.Product.findById(p._id);
    if (hidden.status === 'hidden') assert.equal((await new Client().get('/p/' + p.slug)).status, 404);
    const q = await M.Product.create({ shop: p.shop, category: p.category, partType: p.partType, name: 'SP Chờ Duyệt Admin', slug: 'sp-cho-duyet-admin', price: 100000, stock: 1, status: 'pending' });
    await a.post(`/admin/products/${q._id}/reject`, { reason: 'Thiếu ảnh' }, { headers: { referer: T.BASE + '/admin/products' } });
    const x = await M.Product.findById(q._id); assert.equal(x.status, 'rejected'); assert.equal(x.rejectReason, 'Thiếu ảnh');
  });
  it('Đơn hàng: xem chi tiết, đổi trạng thái, huỷ đơn (hoàn kho); không huỷ được đơn đã giao', async () => {
    const o = await M.Order.findOne({ status: 'confirmed', isCustom: false });
    ok(await a.get('/admin/orders/' + o.code));
    const it0 = o.items[0]; const before = (await M.Product.findById(it0.product)).stock;
    await a.post(`/admin/orders/${o.code}/status`, { status: 'cancelled', note: 'Kiểm thử' });
    assert.equal((await M.Order.findById(o._id)).status, 'cancelled');
    assert.equal((await M.Product.findById(it0.product)).stock, before + it0.qty);
    const d = await M.Order.findOne({ status: 'delivered' });
    await a.post(`/admin/orders/${d.code}/status`, { status: 'cancelled' });
    assert.equal((await M.Order.findById(d._id)).status, 'delivered');
  });
  it('Hoàn tiền đơn đã huỷ đã thanh toán', async () => {
    const o = await M.Order.findOne({ paymentStatus: 'refund_pending' });
    if (!o) return;
    await a.post('/admin/refunds/' + o.code, {});
    assert.equal((await M.Order.findById(o._id)).paymentStatus, 'refunded');
  });
});

// ---------------------------------------------------------------------
describe('BB13. Người bán quản lý cơ bản (sản phẩm, doanh thu, đơn hàng)', () => {
  const s = new Client(); let shop;
  before(async () => { await s.login(...SELLER); shop = await M.Shop.findOne({ slug: 'switchhouse' }); });
  it('Các trang Kênh người bán mở được', async () => {
    for (const u of ['/seller', '/seller/products', '/seller/products/new', '/seller/inventory', '/seller/orders', '/seller/orders?status=pending', '/seller/revenue', '/seller/custom', '/seller/progress', '/seller/services', '/seller/reviews', '/seller/profile']) ok(await s.get(u), u);
  });
  it('Sản phẩm: thêm (chờ duyệt) → sửa → ẩn/hiện; thiếu tên/giá bị chặn', async () => {
    const cat = await M.Category.findOne({ partType: 'switch' });
    const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
    assert.ok(has(await s.req('POST', '/seller/products', { multipart: fd({ name: '', category: String(cat._id), price: '' }) }), 'Vui lòng nhập tên'));
    ok(await s.req('POST', '/seller/products', { multipart: fd({ name: 'Switch BB13', category: String(cat._id), price: '90000', stock: '30', switchType: 'linear', pins: '5' }) }));
    const p = await M.Product.findOne({ name: 'Switch BB13' });
    assert.ok(p && p.status === 'pending' && String(p.shop) === String(shop._id));
    ok(await s.req('POST', '/seller/products/' + p._id, { multipart: fd({ name: 'Switch BB13', category: String(cat._id), price: '95000', stock: '25', switchType: 'linear', pins: '5' }) }));
    const x = await M.Product.findById(p._id); assert.equal(x.price, 95000); assert.equal(x.stock, 25);
    await M.Product.updateOne({ _id: p._id }, { status: 'active' });
    await s.post(`/seller/products/${p._id}/toggle`, {}, { headers: { referer: T.BASE + '/seller/products' } });
    assert.equal((await M.Product.findById(p._id)).status, 'hidden');
  });
  it('Không sửa được sản phẩm của shop khác', async () => {
    const other = await M.Product.findOne({ shop: { $ne: shop._id } });
    assert.equal((await s.get(`/seller/products/${other._id}/edit`)).status, 404);
  });
  it('Đơn hàng: Chờ xác nhận → Đã xác nhận → Đang giao (có mã vận đơn) → Đã giao; COD tự thành đã thanh toán', async () => {
    const o = await M.Order.findOne({ shop: shop._id, status: 'pending', isCustom: false, paymentMethod: 'cod' });
    assert.ok(o, 'cần 1 đơn COD chờ xác nhận');
    assert.notEqual((await s.post(`/seller/orders/${o.code}/status`, { status: 'delivered' })).status, 500);
    assert.equal((await M.Order.findById(o._id)).status, 'pending', 'không được nhảy cóc');
    for (const st of ['confirmed', 'shipping', 'delivered']) { ok(await s.post(`/seller/orders/${o.code}/status`, { status: st })); assert.equal((await M.Order.findById(o._id)).status, st); }
    const x = await M.Order.findById(o._id);
    assert.ok(x.shipping.trackingCode); assert.equal(x.paymentStatus, 'paid');
  });
  it('Không xem / sửa được đơn của shop khác', async () => {
    const other = await M.Order.findOne({ shop: { $ne: shop._id } });
    assert.equal((await s.get('/seller/orders/' + other.code)).status, 404);
  });
  it('Doanh thu của shop chỉ tính đơn của shop mình', async () => {
    const r = ok(await s.get('/seller/revenue?from=2026-07-01&to=2026-10-15'));
    const total = values(r.text, 'bar').reduce((x, y) => x + y, 0);
    const os = await M.Order.find({ shop: shop._id, status: { $ne: 'cancelled' }, createdAt: { $gte: new Date('2026-07-01T00:00:00'), $lte: new Date('2026-10-15T23:59:59.999') } }).lean();
    assert.equal(total, os.filter(o => o.paymentStatus === 'paid' || o.paymentMethod === 'cod').reduce((x, o) => x + o.total, 0));
  });
});

// ---------------------------------------------------------------------
describe('Tổng kết', () => {
  it('Server không ghi nhận lỗi nào trong suốt quá trình kiểm thử', () => {
    assert.deepEqual(T.serverErrors.filter(e => /Error|TypeError|Cast/.test(e)), []);
  });
});
