// =====================================================================
//  KeebHub — Kiểm thử LÁCH LUẬT / bảo mật cho cả 3 vai trò
//  Chạy:  npm run test:lach-luat
//
//  - Dùng database RIÊNG "keebhub_test" (không đụng dữ liệu thật)
//  - Tự nạp dữ liệu mẫu, tự bật server ở cổng 3100, tự tắt khi xong
//  - Không cần cài thêm thư viện (dùng node:test + fetch có sẵn trong Node 18+)
// =====================================================================
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.TEST_PORT_LACH || 3101);
const BASE = `http://localhost:${PORT}`;
const DB = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/keebhub_test_lach';
if (!/test/i.test(DB)) throw new Error('TEST_MONGODB_URI phải là database test (tên chứa "test") để tránh xoá dữ liệu thật');

// Môi trường chạy thử: tắt mọi tích hợp ngoài để dùng chế độ demo
const ENV = {
  ...process.env, PORT: String(PORT), BASE_URL: BASE, MONGODB_URI: DB, SESSION_SECRET: 'test-secret',
  SMTP_HOST: '', SMTP_USER: '', MAIL_DEV: '1', VNP_TMNCODE: '', VNP_HASHSECRET: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '',
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', FACEBOOK_APP_ID: '', FACEBOOK_APP_SECRET: ''
};

let server;
let serverErr = '';
let serverDied = null;
let M; // models

// ---------- HTTP client có cookie ----------
class Client {
  constructor() { this.jar = {}; }
  cookieHeader() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) {
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of set) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.jar[kv.slice(0, i)] = kv.slice(i + 1); }
  }
  async req(method, url, { form, multipart, json, follow = true, headers = {} } = {}) {
    let body;
    const h = { ...headers, cookie: this.cookieHeader() };
    if (form) { body = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    if (json) { body = JSON.stringify(json); h['content-type'] = 'application/json'; h.accept = 'application/json'; }
    if (multipart) { body = multipart; }
    let res = await fetch(BASE + url, { method, body, headers: h, redirect: 'manual' });
    this.store(res);
    let hops = 0;
    while (follow && res.status >= 300 && res.status < 400 && hops++ < 10) {
      const loc = new URL(res.headers.get('location'), BASE);
      res = await fetch(loc, { headers: { cookie: this.cookieHeader() }, redirect: 'manual' });
      this.store(res);
    }
    const text = await res.text();
    return { status: res.status, url: res.url ? res.url.replace(BASE, '') : url, location: res.headers.get('location'), text };
  }
  get(u, o) { return this.req('GET', u, o); }
  post(u, form, o = {}) { return this.req('POST', u, { form, ...o }); }
  async login(email, password, admin = false) {
    return this.post(admin ? '/admin/login' : '/auth/login', { email, password });
  }
}
const has = (r, s) => (s instanceof RegExp ? s.test(r.text) : r.text.includes(s));
const png = () => new Blob([Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')], { type: 'image/png' });

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/'); if (r.status < 500) return; } catch (e) { /* chưa lên */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Server không khởi động được');
}
async function lastMailLink(kind) {
  const c = new Client();
  const list = await c.get('/dev/mails');
  const idx = (list.text.match(/\/dev\/mails\/(\d+)/) || [])[1];
  assert.ok(idx !== undefined, 'Không có email trong hộp thư dev');
  const mail = await c.get('/dev/mails/' + idx);
  const m = mail.text.match(new RegExp(`href="${BASE}(/auth/${kind}/[a-f0-9]+)"`));
  assert.ok(m, `Không thấy link ${kind} trong email`);
  return m[1];
}

before(async () => {
  const seed = spawnSync(process.execPath, ['seed/seed.js'], { cwd: ROOT, env: ENV, encoding: 'utf8' });
  if (seed.status !== 0) throw new Error('Seed lỗi:\n' + seed.stdout + seed.stderr);
  server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', d => { const s = String(d); if (!/deprecated/.test(s)) { serverErr += s; process.stderr.write('[server] ' + s); } });
  server.on('exit', code => { serverDied = code; });
  await waitServer();
  await mongoose.connect(DB);
  M = require(path.join(ROOT, 'models'));
  await setup();
});
after(async () => {
  if (server) server.kill();
  await mongoose.disconnect();
});

// ---------- tiện ích ----------
const stamp = Date.now();
let seq = 0;
async function mkUser(tag, extra = {}) {
  const u = new M.User({ name: 'Lách ' + tag, email: `lach-${tag}-${stamp}-${seq++}@example.com`, role: 'customer', emailVerified: true, ...extra });
  await u.setPassword('Test@1234'); await u.save();
  const c = new Client(); await c.login(u.email, 'Test@1234');
  return { u, c };
}
const loggedIn = async c => !(await c.get('/account')).url.startsWith('/auth/login');
let shopA, shopB, prodA, prodB, sellerA, sellerB, admin;
async function mkOrder(u, extra = {}, prod = prodA, shop = shopA) {
  const total = prod.price + 30000;
  return M.Order.create({
    user: u._id, shop: shop._id, paymentMethod: 'vnpay', paymentStatus: 'paid', status: 'pending', paymentGroup: 'PGL' + Math.random().toString(36).slice(2),
    shipping: { fullName: u.name, phone: '0900000000', address: 'HCM', method: 'standard' },
    items: [{ product: prod._id, name: prod.name, image: prod.image, partType: prod.partType, price: prod.price, qty: 1 }],
    subtotal: prod.price, shippingFee: 30000, total, paidAt: new Date(),
    history: [{ status: 'pending', note: 'Đặt hàng thành công', by: 'customer' }], ...extra
  });
}
const CHECKOUT = { fullName: 'Lách Luật', phone: '0901234567', address: '1 Lê Lợi, Q1' };

async function setup() {
  shopA = await M.Shop.findOne({ slug: 'keeblab-store' });
  shopB = await M.Shop.findOne({ slug: 'switchhouse' });
  prodA = await M.Product.findOne({ shop: shopA._id, status: 'active', stock: { $gt: 30 } });
  prodB = await M.Product.findOne({ shop: shopB._id, status: 'active', stock: { $gt: 30 } });
  sellerA = new Client(); await sellerA.login('keeblab@keebhub.vn', 'Seller@123');
  sellerB = new Client(); await sellerB.login('switchhouse@keebhub.vn', 'Seller@123');
  admin = new Client(); await admin.login('admin@keebhub.vn', 'Admin@123', true);
}

// =====================================================================
describe('A. Đăng nhập / tài khoản', () => {
  it('Chèn toán tử MongoDB vào form đăng nhập (email[$ne]) → không đăng nhập được', async () => {
    const c = new Client();
    await c.post('/auth/login', { 'email[$ne]': 'x', 'password[$ne]': 'x' });
    assert.equal(await loggedIn(c), false);
    const a = new Client();
    await a.post('/admin/login', { 'email[$ne]': 'x', 'password[$ne]': 'x' });
    assert.ok((await a.get('/admin')).url.startsWith('/admin/login'));
  });
  it('Chèn toán tử qua JSON → không đăng nhập được', async () => {
    const c = new Client();
    await c.req('POST', '/auth/login', { json: { email: { $gt: '' }, password: { $gt: '' } } });
    assert.equal(await loggedIn(c), false);
  });
  it('Dò mật khẩu: sai 5 lần → tạm khoá đăng nhập 15 phút (kể cả nhập đúng), tài khoản khác không ảnh hưởng', async () => {
    const { u } = await mkUser('brute');
    for (let i = 0; i < 5; i++) await new Client().login(u.email, 'Sai@' + i + '1234');
    const r = await new Client().login(u.email, 'Test@1234');
    assert.ok(has(r, 'thử lại sau'), 'phải báo tạm khoá');
    const { c: other } = await mkUser('brute2');
    assert.ok(await loggedIn(other));
  });
  it('Dò mật khẩu admin: sai 5 lần → tạm khoá', async () => {
    for (let i = 0; i < 5; i++) await new Client().post('/admin/login', { email: 'admin@keebhub.vn', password: 'Sai' + i });
    const r = await new Client().post('/admin/login', { email: 'admin@keebhub.vn', password: 'Admin@123' });
    assert.ok(has(r, 'thử lại sau'));
  });
  it('Đăng ký chèn role=admin / wallet / emailVerified → bị bỏ qua', async () => {
    const email = `reg-${stamp}@example.com`;
    await new Client().post('/auth/register', { name: 'Hacker', email, password: 'Test@1234', confirm: 'Test@1234', agree: 'on', role: 'admin', wallet: '99999999', emailVerified: 'true', status: 'active' });
    const u = await M.User.findOne({ email });
    assert.equal(u.role, 'customer'); assert.equal(u.wallet, 0); assert.equal(u.emailVerified, false);
  });
  it('Quên mật khẩu bấm liên tục → không đổi token liên tục (chống spam email)', async () => {
    const { u } = await mkUser('forgot');
    await new Client().post('/auth/forgot', { email: u.email });
    const t1 = (await M.User.findById(u._id)).resetToken;
    const r = await new Client().post('/auth/forgot', { email: u.email });
    assert.equal(r.status, 200);
    assert.equal((await M.User.findById(u._id)).resetToken, t1);
  });
  it('Đổi mật khẩu → link đặt lại mật khẩu cũ mất hiệu lực; mật khẩu dạng mảng không gây lỗi', async () => {
    const { u, c } = await mkUser('pw');
    await M.User.updateOne({ _id: u._id }, { resetToken: 'tok' + stamp, resetExpires: Date.now() + 600e3 });
    const r0 = await c.post('/account/password', { current: 'Test@1234', 'password[]': 'a', confirm: 'a' });
    assert.ok(r0.status < 500);
    await c.post('/account/password', { current: 'Test@1234', password: 'Moi@12345', confirm: 'Moi@12345' });
    assert.ok(!(await M.User.findById(u._id)).resetToken);
  });
  it('Tài khoản bị admin khoá → phiên đang mở bị đăng xuất ngay', async () => {
    const { u, c } = await mkUser('lock');
    assert.ok(await loggedIn(c));
    await admin.post(`/admin/users/${u._id}/status`, {});
    assert.equal(await loggedIn(c), false);
  });
  it('Khách / seller gọi API quản trị → không có tác dụng', async () => {
    const { u, c } = await mkUser('notadmin');
    const victim = await mkUser('victim');
    const pend = await M.Product.findOne({ status: 'pending' });
    const pendShop = await M.Shop.findOne({ status: 'pending' });
    for (const cl of [c, sellerA]) {
      await cl.post(`/admin/users/${victim.u._id}/status`, {});
      await cl.post(`/admin/products/${pend._id}/approve`, {});
      await cl.post(`/admin/shops/${pendShop._id}/approve`, {});
      await cl.post('/admin/categories', { name: 'Hack' + stamp, partType: 'kit' });
    }
    assert.equal((await M.User.findById(victim.u._id)).status, 'active');
    assert.equal((await M.Product.findById(pend._id)).status, 'pending');
    assert.equal((await M.Shop.findById(pendShop._id)).status, 'pending');
    assert.equal(await M.Category.countDocuments({ name: 'Hack' + stamp }), 0);
    assert.ok(u);
  });
  it('Admin không khoá được tài khoản admin; tài khoản khách không vào được /admin/login', async () => {
    const ad = await M.User.findOne({ role: 'admin' });
    await admin.post(`/admin/users/${ad._id}/status`, {});
    assert.equal((await M.User.findById(ad._id)).status, 'active');
    const r = await new Client().post('/admin/login', { email: 'khach@keebhub.vn', password: 'Khach@123' });
    assert.ok(has(r, 'không đúng'));
  });
});

// =====================================================================
describe('B. Giỏ hàng & đặt hàng', () => {
  it('Số lượng âm / chữ / quá lớn → luôn trong khoảng 1..tồn kho', async () => {
    const { u, c } = await mkUser('qty');
    await c.post('/cart/add', { productId: String(prodA._id), qty: '-5' });
    await c.post('/cart/add', { productId: String(prodA._id), qty: 'abc' });
    await c.post('/cart/add', { productId: String(prodA._id), qty: '999999999' });
    let x = await M.User.findById(u._id);
    assert.equal(x.cart.length, 1); assert.equal(x.cart[0].qty, 2);
    await c.post(`/cart/update/${x.cart[0]._id}`, { qty: '-3' });
    assert.equal((await M.User.findById(u._id)).cart[0].qty, 1);
    await c.post(`/cart/update/${x.cart[0]._id}`, { qty: '99999999' });
    const p = await M.Product.findById(prodA._id);
    assert.equal((await M.User.findById(u._id)).cart[0].qty, p.stock);
  });
  it('Không thêm được sản phẩm chờ duyệt / đã ẩn / của shop bị khoá', async () => {
    const { u, c } = await mkUser('bad');
    const pend = await M.Product.findOne({ status: 'pending' });
    const lockedShopProd = await M.Product.findOne({ shop: (await M.Shop.findOne({ status: { $ne: 'active' } }))._id });
    for (const p of [pend, lockedShopProd].filter(Boolean)) await c.post('/cart/add', { productId: String(p._id) });
    await c.post('/cart/add', { productId: 'khong-hop-le' });
    assert.equal((await M.User.findById(u._id)).cart.length, 0);
  });
  it('Sửa giá trong form đặt hàng không có tác dụng (giá lấy từ CSDL)', async () => {
    const { u, c } = await mkUser('price');
    await c.post('/cart/add', { productId: String(prodA._id), qty: '1' });
    await c.post('/checkout', { ...CHECKOUT, payment: 'cod', price: '1', total: '1', subtotal: '1', shippingFee: '0' });
    const o = await M.Order.findOne({ user: u._id });
    assert.equal(o.items[0].price, prodA.price); assert.ok(o.total >= prodA.price);
  });
  it('Bấm "Đặt hàng" 2 lần cùng lúc (thanh toán ví) → chỉ 1 đơn, ví chỉ trừ 1 lần', async () => {
    const { u, c } = await mkUser('dbl', { wallet: 100000000 });
    await c.post('/cart/add', { productId: String(prodA._id), qty: '1' });
    await Promise.all([1, 2, 3].map(() => c.post('/checkout', { ...CHECKOUT, payment: 'wallet' })));
    const orders = await M.Order.find({ user: u._id });
    assert.equal(orders.length, 1, 'chỉ được tạo 1 đơn');
    assert.equal((await M.User.findById(u._id)).wallet, 100000000 - orders[0].total);
  });
  it('2 khách tranh mua sản phẩm còn 1 cái → chỉ 1 người mua được, kho không âm', async () => {
    const p = await M.Product.findOne({ shop: shopA._id, status: 'active', _id: { $ne: prodA._id } });
    await M.Product.updateOne({ _id: p._id }, { stock: 1 });
    const buyers = await Promise.all([1, 2, 3].map(i => mkUser('race' + i)));
    for (const b of buyers) await b.c.post('/cart/add', { productId: String(p._id), qty: '1' });
    await Promise.all(buyers.map(b => b.c.post('/checkout', { ...CHECKOUT, payment: 'cod' })));
    const n = await M.Order.countDocuments({ 'items.product': p._id, user: { $in: buyers.map(b => b.u._id) } });
    assert.equal(n, 1);
    assert.equal((await M.Product.findById(p._id)).stock, 0);
    await M.Product.updateOne({ _id: p._id }, { stock: 50 });
  });
  it('Người bán không đặt mua được sản phẩm của chính shop mình (kể cả hàng đã nằm sẵn trong giỏ)', async () => {
    const owner = await M.User.findOne({ email: 'keeblab@keebhub.vn' });
    await M.User.updateOne({ _id: owner._id }, { cart: [{ product: prodA._id, qty: 1 }] });
    await sellerA.post('/checkout', { ...CHECKOUT, payment: 'cod' });
    assert.equal(await M.Order.countDocuments({ user: owner._id }), 0);
    await M.User.updateOne({ _id: owner._id }, { cart: [] });
  });
  it('Giỏ có sản phẩm vượt tồn kho → không tạo đơn nào (không tạo đơn dở dang)', async () => {
    const { u, c } = await mkUser('partial');
    await c.post('/cart/add', { productId: String(prodA._id), qty: '1' });
    await c.post('/cart/add', { productId: String(prodB._id), qty: '1' });
    const x = await M.User.findById(u._id);
    await M.User.updateOne({ _id: u._id, 'cart.product': prodB._id }, { $set: { 'cart.$.qty': 100000 } });
    await c.post('/checkout', { ...CHECKOUT, payment: 'cod' });
    assert.equal(await M.Order.countDocuments({ user: u._id }), 0);
    assert.ok(x);
  });
});

// =====================================================================
describe('C. Thanh toán VNPay', () => {
  it('Giả mạo kết quả VNPay (không có chữ ký) → đơn vẫn chưa thanh toán', async () => {
    const { u } = await mkUser('forge');
    const o = await mkOrder(u, { paymentStatus: 'unpaid' });
    const qs = `vnp_TxnRef=${o.paymentGroup}&vnp_ResponseCode=00&vnp_TransactionStatus=00&vnp_Amount=${o.total * 100}&vnp_SecureHash=abc`;
    await new Client().get('/payment/vnpay_return?' + qs);
    const ipn = await new Client().get('/payment/vnpay_ipn?' + qs);
    assert.ok(has(ipn, '97'));
    assert.equal((await M.Order.findById(o._id)).paymentStatus, 'unpaid');
  });
  it('Thanh toán mô phỏng / xem kết quả / thanh toán lại đơn của người khác → không có tác dụng', async () => {
    const { u } = await mkUser('owner');
    const { c: other } = await mkUser('other');
    const o = await mkOrder(u, { paymentStatus: 'unpaid' });
    await other.post('/payment/mock/' + o.paymentGroup, { result: 'success' });
    assert.equal((await M.Order.findById(o._id)).paymentStatus, 'unpaid');
    assert.ok(!has(await other.get('/payment/result/' + o.paymentGroup), o.code));
    await other.post('/payment/retry/' + o._id, {});
    assert.equal((await M.Order.findById(o._id)).paymentGroup, o.paymentGroup);
  });
  it('Trả tiền sau khi đơn đã huỷ → hoàn vào ví đúng 1 lần (kể cả VNPay báo về nhiều lần)', async () => {
    const { u, c } = await mkUser('late');
    const o = await mkOrder(u, { paymentStatus: 'unpaid' });
    await c.post(`/account/orders/${o.code}/cancel`, { reason: 'Đặt nhầm' });
    for (let i = 0; i < 3; i++) await c.post('/payment/mock/' + o.paymentGroup, { result: 'success' });
    assert.equal((await M.User.findById(u._id)).wallet, o.total);
    assert.equal((await M.Order.findById(o._id)).paymentStatus, 'refunded');
  });
  it('Huỷ đơn ĐÚNG LÚC VNPay báo đã trả tiền → không bao giờ mất tiền của khách (đơn huỷ luôn được hoàn)', async () => {
    for (let i = 0; i < 6; i++) {
      const { u, c } = await mkUser('race-pay' + i);
      const o = await mkOrder(u, { paymentStatus: 'unpaid' });
      await Promise.all([c.post(`/account/orders/${o.code}/cancel`, { reason: 'Đặt nhầm' }), c.post('/payment/mock/' + o.paymentGroup, { result: 'success' })]);
      const x = await M.Order.findById(o._id);
      const w = (await M.User.findById(u._id)).wallet;
      if (x.status === 'cancelled') {
        assert.ok(['refunded', 'unpaid'].includes(x.paymentStatus), `lần ${i}: đơn huỷ mà trạng thái tiền = ${x.paymentStatus}`);
        assert.equal(w, x.paymentStatus === 'refunded' ? o.total : 0);
      } else assert.equal(x.paymentStatus, 'paid');
    }
  });
});

// =====================================================================
describe('D. Đơn hàng: khách / người bán / admin', () => {
  it('Khách thao tác đơn của người khác → 404, không đổi gì', async () => {
    const { u } = await mkUser('o1');
    const { c: other } = await mkUser('o2');
    const o = await mkOrder(u, { status: 'shipping' });
    assert.equal((await other.get(`/account/orders/${o.code}`)).status, 404);
    assert.equal((await other.post(`/account/orders/${o.code}/cancel`, { reason: 'x' })).status, 404);
    assert.equal((await other.post(`/account/orders/${o.code}/received`, {})).status, 404);
    assert.equal((await M.Order.findById(o._id)).status, 'shipping');
  });
  it('Khách bấm "Đã nhận hàng" khi đơn chưa giao → không có tác dụng', async () => {
    const { u, c } = await mkUser('recv');
    const o = await mkOrder(u, { status: 'confirmed' });
    await c.post(`/account/orders/${o.code}/received`, {});
    assert.equal((await M.Order.findById(o._id)).status, 'confirmed');
  });
  it('Đánh giá: gửi 4 lần cùng lúc → chỉ 1 đánh giá; điểm bị giới hạn 1..5; không đánh giá đơn người khác', async () => {
    const { u, c } = await mkUser('rv');
    const o = await mkOrder(u, { status: 'completed', deliveredAt: new Date() });
    const it0 = o.items[0]._id;
    await Promise.all([1, 2, 3, 4].map(() => c.post(`/account/orders/${o.code}/review/${it0}`, { rating: '100', content: 'Tốt lắm' })));
    const rs = await M.Review.find({ order: o._id });
    assert.equal(rs.length, 1); assert.equal(rs[0].rating, 5);
    const { c: other } = await mkUser('rv2');
    const o2 = await mkOrder(u, { status: 'completed' });
    assert.equal((await other.post(`/account/orders/${o2.code}/review/${o2.items[0]._id}`, { rating: '1', content: 'x' })).status, 404);
  });
  it('Người bán: không sửa đơn shop khác; không tự "Hoàn thành"; không nhảy cóc; không huỷ đơn đã giao; không giao đơn VNPay chưa trả', async () => {
    const { u } = await mkUser('sl');
    const oB = await mkOrder(u, {}, prodB, shopB);
    assert.equal((await sellerA.post(`/seller/orders/${oB.code}/status`, { status: 'confirmed' })).status, 404);
    const o = await mkOrder(u);
    await sellerA.post(`/seller/orders/${o.code}/status`, { status: 'delivered' });
    await sellerA.post(`/seller/orders/${o.code}/status`, { status: 'completed' });
    assert.equal((await M.Order.findById(o._id)).status, 'pending');
    const d = await mkOrder(u, { status: 'delivered' });
    await sellerA.post(`/seller/orders/${d.code}/status`, { status: 'cancelled' });
    assert.equal((await M.Order.findById(d._id)).status, 'delivered');
    const un = await mkOrder(u, { status: 'confirmed', paymentStatus: 'unpaid' });
    await sellerA.post(`/seller/orders/${un.code}/status`, { status: 'shipping' });
    assert.equal((await M.Order.findById(un._id)).status, 'confirmed');
  });
  it('Admin không "hồi sinh" đơn đã huỷ', async () => {
    const { u } = await mkUser('rev');
    const o = await mkOrder(u, { status: 'cancelled', paymentStatus: 'unpaid' });
    await admin.post(`/admin/orders/${o.code}/status`, { status: 'delivered' });
    assert.equal((await M.Order.findById(o._id)).status, 'cancelled');
  });
  it('Tiến độ gia công: shop khác không cập nhật được; không đánh dấu xong công đoạn sau khi công đoạn trước chưa xong', async () => {
    const { u } = await mkUser('prog');
    const o = await mkOrder(u, { isCustom: true, status: 'processing', progress: [{ name: 'Lube', status: 'doing' }, { name: 'Hàn', status: 'todo' }, { name: 'Test', status: 'todo' }] }, prodB, shopB);
    const last = o.progress[2]._id;
    assert.equal((await sellerA.post(`/seller/progress/${o.code}/stage/${last}`, { action: 'done' })).status, 404);
    await sellerB.post(`/seller/progress/${o.code}/stage/${last}`, { action: 'done' });
    const x = await M.Order.findById(o._id);
    assert.equal(x.progress[2].status, 'todo'); assert.equal(x.status, 'processing');
  });
});

// =====================================================================
describe('E. Người bán', () => {
  it('Không sửa / ẩn / xoá sản phẩm của shop khác', async () => {
    const before = await M.Product.findById(prodB._id);
    await sellerA.post(`/seller/products/${prodB._id}/toggle`, {});
    await sellerA.post(`/seller/products/${prodB._id}/delete`, {});
    await sellerA.post(`/seller/products/${prodB._id}`, { name: 'Hack', price: '1', category: String(before.category) });
    const after = await M.Product.findById(prodB._id);
    assert.ok(after); assert.equal(after.status, before.status); assert.equal(after.name, before.name); assert.equal(after.price, before.price);
  });
  it('Tạo sản phẩm chèn status=active → vẫn phải chờ duyệt; giá âm bị từ chối; tồn kho âm thành 0', async () => {
    const cat = await M.Category.findOne({ partType: 'switch' });
    await sellerA.post('/seller/products', { name: 'Lách duyệt ' + stamp, price: '100000', stock: '-5', category: String(cat._id), status: 'active', shop: String(shopB._id) });
    const p = await M.Product.findOne({ name: 'Lách duyệt ' + stamp });
    assert.equal(p.status, 'pending'); assert.equal(p.stock, 0); assert.equal(String(p.shop), String(shopA._id));
    await sellerA.post('/seller/products', { name: 'Giá âm ' + stamp, price: '-100', category: String(cat._id) });
    assert.equal(await M.Product.countDocuments({ name: 'Giá âm ' + stamp }), 0);
  });
  it('Sản phẩm bị ADMIN ẩn (vi phạm) → người bán không tự bật bán lại được', async () => {
    const p = await M.Product.findOne({ shop: shopA._id, status: 'active', _id: { $ne: prodA._id } });
    await admin.post(`/admin/products/${p._id}/hide`, {});
    await sellerA.post(`/seller/products/${p._id}/toggle`, {});
    assert.equal((await M.Product.findById(p._id)).status, 'hidden');
    await admin.post(`/admin/products/${p._id}/approve`, {});
    assert.equal((await M.Product.findById(p._id)).status, 'active');
    // shop tự ẩn thì tự bật lại được
    await sellerA.post(`/seller/products/${p._id}/toggle`, {});
    await sellerA.post(`/seller/products/${p._id}/toggle`, {});
    assert.equal((await M.Product.findById(p._id)).status, 'active');
  });
  it('Tồn kho: không sửa kho shop khác; id sai / số âm không gây lỗi', async () => {
    const before = (await M.Product.findById(prodB._id)).stock;
    const r = await sellerA.post('/seller/inventory', { [`stock[${prodB._id}]`]: '0', 'stock[abc]': '5', [`stock[${prodA._id}]`]: '-9' });
    assert.ok(r.status < 500);
    assert.equal((await M.Product.findById(prodB._id)).stock, before);
    assert.ok((await M.Product.findById(prodA._id)).stock >= 0);
  });
  it('Gói gia công: không sửa / xoá gói của shop khác; giá âm bị từ chối', async () => {
    const svc = await M.CustomService.findOne({ shop: shopB._id });
    await sellerA.post(`/seller/services/${svc._id}`, { name: 'Hack', price: '1' });
    await sellerA.post(`/seller/services/${svc._id}/delete`, {});
    await sellerA.post(`/seller/services/${svc._id}/toggle`, {});
    const x = await M.CustomService.findById(svc._id);
    assert.ok(x); assert.equal(x.name, svc.name); assert.equal(x.active, svc.active);
    await sellerB.post('/seller/services', { name: 'Giá âm ' + stamp, price: '-5' });
    assert.equal(await M.CustomService.countDocuments({ name: 'Giá âm ' + stamp }), 0);
    const r = await sellerB.post('/seller/services/abc', { name: 'x', price: '1' });
    assert.ok(r.status < 500);
  });
  it('Không trả lời đánh giá của shop khác', async () => {
    const rv = await M.Review.findOne({ shop: shopB._id });
    await sellerA.post(`/seller/reviews/${rv._id}/reply`, { content: 'Hack reply' });
    const x = await M.Review.findById(rv._id);
    assert.ok(!x.reply || x.reply.content !== 'Hack reply');
  });
  it('Hồ sơ shop: không đổi trùng tên shop khác (mạo danh); dữ liệu dạng mảng không gây lỗi; không chèn status/owner', async () => {
    await sellerA.post('/seller/profile', { name: shopB.name, status: 'active', owner: String(shopB.owner), verified: 'false' });
    let x = await M.Shop.findById(shopA._id);
    assert.equal(x.name, shopA.name); assert.equal(String(x.owner), String(shopA.owner));
    await sellerA.post('/seller/profile', { name: shopB.name.toUpperCase() });
    assert.equal((await M.Shop.findById(shopA._id)).name, shopA.name);
    const r = await sellerA.post('/seller/profile', { 'name[]': 'a', 'description[]': 'b' });
    assert.ok(r.status < 500);
  });
  it('Shop chờ duyệt / khách thường không dùng được chức năng người bán', async () => {
    const pend = new Client(); await pend.login('newshop@keebhub.vn', 'Seller@123');
    const cat = await M.Category.findOne();
    await pend.post('/seller/products', { name: 'Shop chưa duyệt ' + stamp, price: '1000', category: String(cat._id) });
    const { c } = await mkUser('cus');
    await c.post('/seller/products', { name: 'Khách đăng ' + stamp, price: '1000', category: String(cat._id) });
    assert.equal(await M.Product.countDocuments({ name: { $in: ['Shop chưa duyệt ' + stamp, 'Khách đăng ' + stamp] } }), 0);
    assert.ok((await c.get('/seller/orders')).url.startsWith('/seller/register'));
  });
  it('Đăng ký shop trùng tên shop đang hoạt động → bị từ chối', async () => {
    const { c, u } = await mkUser('dupshop');
    await c.post('/seller/register', { name: shopA.name, address: 'x', city: 'HCM', phone: '0901234567' });
    assert.equal(await M.Shop.countDocuments({ owner: u._id }), 0);
  });
});

// =====================================================================
describe('F. Khác: dữ liệu bẩn, XSS, chuyển hướng, tải tệp', () => {
  it('ID sai định dạng ở mọi đường dẫn → không lỗi 500, server không sập', async () => {
    const { c } = await mkUser('badid');
    const gets = [[c, '/account/orders/abc'], [c, '/builder/edit/abc'], [sellerA, '/seller/products/abc/edit'], [sellerA, '/seller/orders/abc'], [admin, '/admin/orders/abc'], [c, '/p/%00'], [c, '/shop/abc']];
    const posts = [[c, '/wishlist/abc'], [c, '/account/builds/abc/delete'], [c, '/cart/update/abc'], [c, '/cart/remove/abc'], [c, '/comments/abc/reply'],
      [sellerA, '/seller/products/abc/toggle'], [sellerA, '/seller/products/abc/delete'], [sellerA, '/seller/products/abc'], [sellerA, '/seller/services/abc/toggle'], [sellerA, '/seller/services/abc/delete'], [sellerA, '/seller/reviews/abc/reply'], [sellerA, '/seller/progress/abc/stage/abc'],
      [admin, '/admin/users/abc/status'], [admin, '/admin/users/abc/verify'], [admin, '/admin/shops/abc/approve'], [admin, '/admin/products/abc/approve'], [admin, '/admin/compat/abc'], [admin, '/admin/categories/abc/delete'], [c, '/payment/retry/abc']];
    for (const [cl, u] of gets) { const r = await cl.get(u); assert.ok(r.status < 500, 'GET ' + u + ' → ' + r.status); }
    for (const [cl, u] of posts) { const r = await cl.post(u, { content: 'x', name: 'x', price: '1' }); assert.ok(r.status < 500, 'POST ' + u + ' → ' + r.status); }
    assert.equal(serverDied, null, 'server đã sập');
    assert.equal((await c.get('/')).status, 200);
  });
  it('Nội dung chứa mã độc (XSS) được hiển thị dạng chữ, không chạy', async () => {
    const { c } = await mkUser('xss');
    const X = '<script>alert(1)</script>';
    await c.post(`/p/${prodA.slug}/comments`, { content: 'Hỏi ' + X });
    await c.post('/account/profile', { name: 'Tên ' + X });
    const page = await c.get(`/p/${prodA.slug}?tab=qa`);
    assert.ok(!page.text.includes(X)); assert.ok(page.text.includes('&lt;script&gt;'));
    assert.ok(!(await sellerA.get('/seller/reviews?tab=qa')).text.includes(X));
  });
  it('Tham số "back" trỏ ra web ngoài → không chuyển hướng ra ngoài (open redirect)', async () => {
    const cm = await M.Comment.findOne({ shop: shopA._id });
    const r = await sellerA.post(`/comments/${cm._id}/reply`, { content: 'Cảm ơn', back: 'https://evil.example/phish' }, { follow: false });
    assert.ok(!String(r.location).includes('evil.example'), r.location);
    const r2 = await admin.post('/admin/refunds/xyz', { back: '//evil.example' }, { follow: false });
    assert.ok(!String(r2.location).includes('evil.example'), r2.location);
    const r3 = await sellerA.post('/seller/returns/xyz/approve', { back: 'https://evil.example' }, { follow: false });
    assert.ok(!String(r3.location || '').includes('evil.example'));
  });
  it('Tải lên tệp không phải ảnh (HTML/SVG giả ảnh) → bị từ chối', async () => {
    const { u, c } = await mkUser('upl');
    for (const [name, type] of [['x.html', 'text/html'], ['x.svg', 'image/svg+xml']]) {
      const fd = new FormData(); fd.append('name', 'Up Load'); fd.append('avatar', new Blob(['<script>alert(1)</script>'], { type }), name);
      const r = await c.post('/account/profile', null, { multipart: fd });
      assert.ok(r.status < 500);
    }
    assert.ok(!(await M.User.findById(u._id)).avatar);
  });
  it('Custom Builder: không chọn được linh kiện sai loại (vd. switch vào ô kit) hoặc sản phẩm chưa duyệt', async () => {
    const { c } = await mkUser('bld');
    const sw = await M.Product.findOne({ partType: 'switch', status: 'active' });
    const pend = await M.Product.findOne({ partType: 'kit', status: 'pending' });
    await c.get('/builder/new');
    await c.post('/builder/select', { role: 'kit', productId: String(sw._id) });
    if (pend) await c.post('/builder/select', { role: 'kit', productId: String(pend._id) });
    const b = await M.Build.findOne({ user: (await M.User.findOne({ email: { $regex: 'lach-bld' } }))._id });
    assert.ok(!b.kit, 'ô kit phải trống');
  });
  it('Chatbot: khách vãng lai gửi dồn dập → bị giới hạn tốc độ', async () => {
    const codes = [];
    for (let i = 0; i < 20; i++) codes.push((await fetch(BASE + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'switch' }] }) })).status);
    assert.ok(codes.includes(429), 'không thấy giới hạn tốc độ');
  });
  it('Tải tệp HTML đổi kiểu thành image/png → bị từ chối, không lưu tệp .html lên máy chủ', async () => {
    const { u, c } = await mkUser('upl2');
    const fd = new FormData(); fd.append('name', 'Up Load'); fd.append('avatar', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'evil.html');
    await c.post('/account/profile', null, { multipart: fd });
    const av = (await M.User.findById(u._id)).avatar;
    assert.ok(!av || !/\.html?$/i.test(av), av);
    const fs = require('fs');
    assert.ok(!fs.readdirSync(path.join(ROOT, 'public', 'uploads')).some(f => /\.html?$/i.test(f)));
  });
  it('Có header bảo mật: nosniff, chống nhúng iframe', async () => {
    const r = await fetch(BASE + '/');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  });
  it('Đổi mật khẩu → các thiết bị khác bị đăng xuất, thiết bị đang dùng vẫn đăng nhập', async () => {
    const { u, c } = await mkUser('sess');
    const other = new Client(); await other.login(u.email, 'Test@1234');
    assert.ok(await loggedIn(other));
    await c.post('/account/password', { current: 'Test@1234', password: 'Moi@12345', confirm: 'Moi@12345' });
    assert.ok(await loggedIn(c));
    assert.equal(await loggedIn(other), false);
  });
  it('Không đặt câu hỏi trên sản phẩm chưa duyệt / đã ẩn', async () => {
    const { c } = await mkUser('cmt');
    const pend = await M.Product.findOne({ status: 'pending' });
    await c.post(`/p/${pend.slug}/comments`, { content: 'Spam vào sản phẩm chưa duyệt' });
    assert.equal(await M.Comment.countDocuments({ product: pend._id, content: 'Spam vào sản phẩm chưa duyệt' }), 0);
  });
  it('Build có linh kiện của shop vừa bị khoá → không đặt được', async () => {
    const { u, c } = await mkUser('bshop');
    const akko = await M.Shop.findOne({ slug: { $regex: '^akko' } });
    const kc = await M.Product.findOne({ shop: akko._id, partType: 'keycap', status: 'active' });
    const kit = await M.Product.findOne({ partType: 'kit', status: 'active', stock: { $gt: 3 } });
    const sw = await M.Product.findOne({ partType: 'switch', status: 'active', stock: { $gt: 20 } });
    const svc = await M.CustomService.findOne({ shop: shopB._id, active: true });
    if (!kc) return;
    const b = await M.Build.create({ user: u._id, status: 'saved', name: 'B', kit: kit._id, switch: sw._id, keycap: kc._id, service: svc._id, switchQty: 70 });
    await M.User.updateOne({ _id: u._id }, { cart: [{ build: b._id, qty: 1 }] });
    await M.Shop.updateOne({ _id: akko._id }, { status: 'locked' });
    try {
      await c.post('/checkout', { ...CHECKOUT, payment: 'vnpay' });
      assert.equal(await M.Order.countDocuments({ user: u._id }), 0);
    } finally { await M.Shop.updateOne({ _id: akko._id }, { status: 'active' }); }
  });
  it('Trả hàng cho đơn đã huỷ / chưa giao / của người khác → không được', async () => {
    const { u, c } = await mkUser('rt');
    const fd = () => { const f = new FormData(); f.append('reason', 'defect'); f.append('detail', 'Phím Enter không nhận khi bấm vào'); f.append('photos', png(), 'a.png'); return f; };
    const cancelled = await mkOrder(u, { status: 'cancelled', paymentStatus: 'refunded' });
    await c.post(`/account/orders/${cancelled.code}/return`, null, { multipart: fd() });
    assert.equal((await M.Order.findById(cancelled._id)).returnRequest.status, '');
    const { c: other } = await mkUser('rt2');
    const del = await mkOrder(u, { status: 'delivered', deliveredAt: new Date() });
    assert.equal((await other.post(`/account/orders/${del.code}/return`, null, { multipart: fd() })).status, 404);
    assert.equal((await M.Order.findById(del._id)).returnRequest.status, '');
  });
  it('Admin bấm "Hoàn tiền" cho đơn KHÔNG ở trạng thái chờ hoàn → không cộng ví', async () => {
    const { u } = await mkUser('nofund');
    const o = await mkOrder(u, { status: 'delivered' });
    await admin.post(`/admin/refunds/${o.code}`, {});
    assert.equal((await M.User.findById(u._id)).wallet, 0);
    assert.equal((await M.Order.findById(o._id)).paymentStatus, 'paid');
  });
  it('Không có lỗi máy chủ nào bị ghi lại trong suốt quá trình kiểm thử', async () => {
    assert.ok(!/TypeError|CastError|ReferenceError|Unhandled|ValidationError/.test(serverErr), serverErr.slice(0, 2000));
    assert.equal(serverDied, null);
  });
});
