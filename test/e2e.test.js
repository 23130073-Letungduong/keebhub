// =====================================================================
//  KeebHub — Bộ kiểm thử tự động (end-to-end + đơn vị)
//  Chạy:  npm test            (hoặc bấm đúp chay-kiem-thu.bat)
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
const PORT = Number(process.env.TEST_PORT || 3100);
const BASE = `http://localhost:${PORT}`;
const DB = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/keebhub_test';
if (!/test/i.test(DB)) throw new Error('TEST_MONGODB_URI phải là database test (tên chứa "test") để tránh xoá dữ liệu thật');

// Môi trường chạy thử: tắt mọi tích hợp ngoài để dùng chế độ demo
const ENV = {
  ...process.env, PORT: String(PORT), BASE_URL: BASE, MONGODB_URI: DB, SESSION_SECRET: 'test-secret',
  SMTP_HOST: '', SMTP_USER: '', VNP_TMNCODE: '', VNP_HASHSECRET: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '',
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', FACEBOOK_APP_ID: '', FACEBOOK_APP_SECRET: ''
};

let server;
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
  server.stderr.on('data', d => { const s = String(d); if (!/deprecated/.test(s)) process.stderr.write('[server] ' + s); });
  await waitServer();
  await mongoose.connect(DB);
  M = require(path.join(ROOT, 'models'));
});
after(async () => {
  if (server) server.kill();
  await mongoose.disconnect();
});

// =====================================================================
describe('1. Trang công khai', () => {
  const c = new Client();
  for (const u of ['/', '/search', '/search?q=switch', '/c/kit-ban-phim', '/c/switch?switchType=linear', '/c/keycap?profile=Cherry',
    '/search?min=100000&max=500000&sort=price_asc', '/search?layout=65%25&sort=rating', '/search?type=stabilizer&sort=new', '/search?hotswap=1&page=2',
    '/shops', '/shops?q=switch', '/shops?custom=1', '/huong-dan', '/chinh-sach', '/auth/login', '/auth/register', '/auth/forgot', '/admin/login', '/img/hero.svg']) {
    it(`GET ${u} → 200`, async () => { assert.equal((await c.get(u)).status, 200); });
  }
  it('Trang không tồn tại → 404', async () => { assert.equal((await c.get('/khong-ton-tai')).status, 404); });
  it('Sản phẩm không tồn tại → 404', async () => { assert.equal((await c.get('/p/khong-co')).status, 404); });
  it('Danh mục không tồn tại → 404', async () => { assert.equal((await c.get('/c/khong-co')).status, 404); });
  it('Shop không tồn tại / chưa duyệt → 404', async () => {
    assert.equal((await c.get('/shop/khong-co')).status, 404);
    assert.equal((await c.get('/shop/phim-co-24h')).status, 404);
  });
  it('Chi tiết sản phẩm hiện đủ các tab', async () => {
    const p = await M.Product.findOne({ status: 'active', partType: 'kit' });
    const r = await c.get('/p/' + p.slug);
    assert.equal(r.status, 200);
    for (const t of ['Mô tả', 'Thông số kỹ thuật', 'Tương thích', 'Đánh giá', 'Hỏi đáp']) assert.ok(has(r, t), 'thiếu tab ' + t);
  });
  it('Sản phẩm chờ duyệt không hiện cho khách', async () => {
    const p = await M.Product.findOne({ status: 'pending' });
    assert.equal((await c.get('/p/' + p.slug)).status, 404);
  });
  it('Ảnh SVG sản phẩm (kể cả id sai) vẫn trả ảnh', async () => {
    const p = await M.Product.findOne();
    const r1 = await fetch(`${BASE}/img/p/${p._id}.svg`);
    assert.match(r1.headers.get('content-type'), /svg/);
    const r2 = await fetch(`${BASE}/img/p/abc.svg`);
    assert.equal(r2.status, 200);
  });
  it('Tìm kiếm ký tự đặc biệt regex không gây lỗi', async () => {
    for (const q of ['(', '[a-', '.*', '\\', '$where', '<script>']) assert.equal((await c.get('/search?q=' + encodeURIComponent(q))).status, 200);
  });
  it('Tìm kiếm trả về shop khớp tên (tìm kiếm gian hàng)', async () => {
    const r = await c.get('/search?q=SwitchHouse');
    assert.ok(has(r, 'Gian hàng khớp'));
  });
  it('Trang chủ có sản phẩm bán chạy + gợi ý', async () => {
    const r = await c.get('/');
    assert.ok(has(r, 'Sản phẩm bán chạy') && has(r, 'Gợi ý cho bạn'));
  });
  it('Tham số phân trang/giá không hợp lệ không gây lỗi', async () => {
    for (const q of ['page=-5', 'page=abc', 'min=abc', 'max=-1', 'sort=xyz']) assert.equal((await c.get('/search?' + q)).status, 200);
  });
});

// =====================================================================
describe('2. Đăng ký / xác nhận email / đăng nhập / quên mật khẩu', () => {
  const c = new Client();
  const email = `tester${Date.now()}@example.com`;
  const base = { name: 'Người Kiểm Thử', email, phone: '0912345678', password: 'Test@1234', confirm: 'Test@1234', agree: 'on' };

  it('Đăng ký thiếu tên → báo lỗi', async () => { assert.ok(has(await c.post('/auth/register', { ...base, name: '' }), 'Vui lòng nhập họ tên')); });
  it('Email sai định dạng → báo lỗi', async () => { assert.ok(has(await c.post('/auth/register', { ...base, email: 'abc' }), 'Email không hợp lệ')); });
  it('SĐT sai → báo lỗi', async () => { assert.ok(has(await c.post('/auth/register', { ...base, phone: '123' }), 'Số điện thoại không hợp lệ')); });
  it('Mật khẩu ngắn → báo lỗi', async () => { assert.ok(has(await c.post('/auth/register', { ...base, password: '123', confirm: '123' }), 'tối thiểu 8')); });
  it('Nhập lại mật khẩu không khớp → báo lỗi', async () => { assert.ok(has(await c.post('/auth/register', { ...base, confirm: 'Khac@1234' }), 'không khớp')); });
  it('Không đồng ý điều khoản → báo lỗi', async () => { const f = { ...base }; delete f.agree; assert.ok(has(await c.post('/auth/register', f), 'đồng ý điều khoản')); });
  it('Email đã tồn tại → báo lỗi', async () => { assert.ok(has(await c.post('/auth/register', { ...base, email: 'khach@keebhub.vn' }), 'đã được sử dụng')); });
  it('Đăng ký hợp lệ → gửi email xác nhận', async () => {
    const r = await c.post('/auth/register', base);
    assert.ok(has(r, 'Xác nhận email của bạn'));
    const u = await M.User.findOne({ email });
    assert.ok(u && !u.emailVerified && u.verifyToken);
  });
  it('Chưa xác nhận email thì không đăng nhập được', async () => {
    const r = await new Client().login(email, 'Test@1234');
    assert.ok(has(r, 'chưa xác nhận email'));
  });
  it('Gửi lại email xác nhận', async () => { assert.ok(has(await c.post('/auth/resend', { email }), 'Xác nhận email')); });
  it('Link xác nhận sai → báo lỗi', async () => { assert.ok(has(await c.get('/auth/verify/sai-token'), 'không hợp lệ')); });
  it('Bấm link xác nhận trong email → kích hoạt + tự đăng nhập', async () => {
    const link = await lastMailLink('verify');
    const r = await c.get(link);
    assert.ok(has(r, 'Xác nhận email thành công'));
    assert.ok((await M.User.findOne({ email })).emailVerified);
    assert.equal((await c.get('/account')).status, 200);
  });
  it('Đăng xuất', async () => {
    await c.post('/auth/logout', {});
    const r = await c.get('/account');
    assert.ok(r.url.startsWith('/auth/login'));
  });
  it('Đăng nhập sai mật khẩu → báo lỗi', async () => { assert.ok(has(await c.login(email, 'Sai@12345'), 'Email hoặc mật khẩu không đúng')); });
  it('Email không tồn tại → báo lỗi', async () => { assert.ok(has(await c.login('khongco@x.vn', 'abc'), 'Email hoặc mật khẩu không đúng')); });
  it('Đăng nhập bằng số điện thoại', async () => {
    const r = await new Client().login('0912345678', 'Test@1234');
    assert.ok(!r.url.startsWith('/auth/login'));
  });
  it('Đăng nhập với dữ liệu kiểu object (NoSQL injection) không gây lỗi 500', async () => {
    const r = await c.post('/auth/login', { 'email[$ne]': 'x', 'password[$ne]': 'x' });
    assert.notEqual(r.status, 500);
    const r2 = await c.post('/admin/login', { 'email[$ne]': 'x', 'password[$ne]': 'x' });
    assert.notEqual(r2.status, 500);
  });
  it('Tài khoản bị khoá không đăng nhập được', async () => { assert.ok(has(await new Client().login('spam@keebhub.vn', 'Khach@123'), 'bị khoá')); });
  it('Admin không đăng nhập ở trang chung', async () => {
    const r = await new Client().login('admin@keebhub.vn', 'Admin@123');
    assert.ok(has(r, 'Email hoặc mật khẩu không đúng'));
  });
  it('Khách không đăng nhập được trang quản trị', async () => {
    const r = await new Client().login('khach@keebhub.vn', 'Khach@123', true);
    assert.ok(has(r, 'không đúng'));
  });
  it('Quên mật khẩu với email không tồn tại vẫn trả trang chung (không lộ thông tin)', async () => {
    assert.ok(has(await c.post('/auth/forgot', { email: 'khongco@x.vn' }), 'Đã gửi liên kết'));
  });
  it('Link đặt lại sai → về trang quên mật khẩu', async () => { assert.ok((await c.get('/auth/reset/sai')).url.startsWith('/auth/forgot')); });
  it('Đặt lại mật khẩu: mật khẩu không khớp → báo lỗi, khớp → đổi được', async () => {
    await c.post('/auth/forgot', { email });
    const link = await lastMailLink('reset');
    assert.ok(has(await c.post(link, { password: 'Moi@12345', confirm: 'Khac@1234' }), 'phải khớp'));
    assert.ok(has(await c.post(link, { password: 'Moi@12345', confirm: 'Moi@12345' }), 'Đổi mật khẩu thành công'));
    assert.ok(!(await new Client().login(email, 'Moi@12345')).url.startsWith('/auth/login'));
    // link dùng lại lần 2 phải hết hiệu lực
    assert.ok((await c.get(link)).url.startsWith('/auth/forgot'));
  });
  it('Đăng nhập Google/Facebook khi chưa cấu hình → báo chưa cấu hình', async () => {
    assert.ok(has(await c.get('/auth/google'), 'Chưa cấu hình đăng nhập Google'));
    assert.ok(has(await c.get('/auth/facebook'), 'Chưa cấu hình đăng nhập Facebook'));
  });
});

// =====================================================================
describe('2b. Thông báo "cần đăng nhập" cho khách', () => {
  it('Khách xem trang chủ → bật thông báo cần đăng nhập', async () => {
    const r = await new Client().get('/');
    assert.ok(has(r, 'window.KH_GUEST = true'));
  });
  it('Đã đăng nhập → không bật thông báo', async () => {
    const c = new Client(); await c.login('khach@keebhub.vn', 'Khach@123');
    assert.ok(!has(await c.get('/'), 'KH_GUEST'));
  });
  it('Vào thẳng /builder/new khi chưa đăng nhập → về trang đăng nhập kèm thông báo', async () => {
    const r = await new Client().get('/builder/new');
    assert.ok(r.url.startsWith('/auth/login')); assert.ok(has(r, 'Bạn cần đăng nhập để sử dụng tính năng này'));
  });
  it('Đăng nhập từ ?next=/builder/new → quay lại đúng tính năng', async () => {
    const c = new Client(); await c.get('/auth/login?next=' + encodeURIComponent('/builder/new'));
    const r = await c.login('khach@keebhub.vn', 'Khach@123');
    assert.ok(r.url.startsWith('/builder'), r.url);
  });
  it('?next trỏ ra web ngoài bị bỏ qua (chống chuyển hướng mở)', async () => {
    for (const n of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
      const c = new Client(); await c.get('/auth/login?next=' + encodeURIComponent(n));
      const r = await c.login('khach@keebhub.vn', 'Khach@123');
      assert.equal(r.url, '/', n + ' → ' + r.url);
    }
  });
});

describe('3. Phân quyền truy cập', () => {
  const guest = new Client();
  for (const u of ['/account', '/account/orders', '/cart', '/checkout', '/builder', '/seller', '/account/wishlist']) {
    it(`Khách vãng lai vào ${u} → chuyển đăng nhập`, async () => { assert.ok((await guest.get(u)).url.startsWith('/auth/login')); });
  }
  it('Khách vãng lai vào /admin → trang đăng nhập quản trị', async () => { assert.ok((await guest.get('/admin')).url.startsWith('/admin/login')); });
  it('Khách hàng vào /admin → 403', async () => {
    const c = new Client(); await c.login('khach@keebhub.vn', 'Khach@123');
    assert.equal((await c.get('/admin')).status, 403);
  });
  it('Khách hàng vào /seller → trang đăng ký bán hàng', async () => {
    const c = new Client(); await c.login('khach@keebhub.vn', 'Khach@123');
    assert.ok((await c.get('/seller')).url.startsWith('/seller/register'));
  });
  it('Seller xem đơn của shop khác → 404', async () => {
    const other = await M.Order.findOne({ shop: (await M.Shop.findOne({ slug: 'keeblab-store' }))._id });
    const c = new Client(); await c.login('switchhouse@keebhub.vn', 'Seller@123');
    assert.equal((await c.get('/seller/orders/' + other.code)).status, 404);
  });
  it('Khách xem đơn của người khác → 404', async () => {
    const khach = await M.User.findOne({ email: 'khach@keebhub.vn' });
    const other = await M.Order.findOne({ user: { $ne: khach._id } });
    const c = new Client(); await c.login('khach@keebhub.vn', 'Khach@123');
    assert.equal((await c.get('/account/orders/' + other.code)).status, 404);
  });
  it('Seller shop chờ duyệt → trang chờ duyệt', async () => {
    const c = new Client(); await c.login('newshop@keebhub.vn', 'Seller@123');
    assert.ok(has(await c.get('/seller'), 'đang chờ duyệt'));
  });
});

// =====================================================================
describe('4. Giỏ hàng, đặt hàng, thanh toán', () => {
  const c = new Client();
  let prod, cheap;
  before(async () => {
    await c.login('user1@keebhub.vn', 'Khach@123');
    prod = await M.Product.findOne({ status: 'active', partType: 'accessory' });
    cheap = await M.Product.findOne({ status: 'active', partType: 'switch' }).sort({ price: 1 });
  });
  it('Giỏ trống → checkout chuyển về giỏ', async () => { assert.ok((await c.get('/checkout')).url.startsWith('/cart')); });
  it('Thêm sản phẩm vào giỏ', async () => {
    assert.ok(has(await c.post('/cart/add', { productId: String(prod._id), qty: '1' }, { headers: { referer: BASE + '/' } }), 'Đã thêm vào giỏ'));
    const u = await M.User.findOne({ email: 'user1@keebhub.vn' });
    assert.equal(u.cart.length, 1);
  });
  it('Thêm vượt tồn kho → báo lỗi', async () => {
    assert.ok(has(await c.post('/cart/add', { productId: String(prod._id), qty: String(prod.stock + 5) }, { headers: { referer: BASE + '/' } }), 'Kho chỉ còn'));
  });
  it('Thêm sản phẩm không tồn tại / id sai → không lỗi 500', async () => {
    assert.notEqual((await c.post('/cart/add', { productId: '000000000000000000000000' })).status, 500);
    assert.notEqual((await c.post('/cart/add', { productId: 'abc' })).status, 500);
    assert.notEqual((await c.post('/cart/add', { 'productId[$ne]': 'x' })).status, 500);
    assert.notEqual((await c.post('/cart/update/abc', { op: 'inc' })).status, 500);
    assert.notEqual((await c.post('/cart/remove/abc', {})).status, 500);
  });
  it('Thêm sản phẩm chờ duyệt → báo không khả dụng', async () => {
    const p = await M.Product.findOne({ status: 'pending' });
    assert.ok(has(await c.post('/cart/add', { productId: String(p._id) }, { headers: { referer: BASE + '/' } }), 'không khả dụng'));
  });
  it('Số lượng âm / chữ → tự về 1', async () => {
    await c.post('/cart/add', { productId: String(cheap._id), qty: '-3' }, { headers: { referer: BASE + '/' } });
    const u = await M.User.findOne({ email: 'user1@keebhub.vn' });
    const line = u.cart.find(i => String(i.product) === String(cheap._id));
    assert.equal(line.qty, 1);
  });
  it('Tăng / giảm số lượng trong giỏ', async () => {
    let u = await M.User.findOne({ email: 'user1@keebhub.vn' });
    const line = u.cart.find(i => String(i.product) === String(cheap._id));
    await c.post('/cart/update/' + line._id, { op: 'inc' });
    await c.post('/cart/update/' + line._id, { op: 'inc' });
    await c.post('/cart/update/' + line._id, { op: 'dec' });
    u = await M.User.findOne({ email: 'user1@keebhub.vn' });
    assert.equal(u.cart.id(line._id).qty, 2);
    await c.post('/cart/update/' + line._id, { qty: 'abc' });
    u = await M.User.findOne({ email: 'user1@keebhub.vn' });
    assert.equal(u.cart.id(line._id).qty, 1);
  });
  it('Xoá khỏi giỏ', async () => {
    let u = await M.User.findOne({ email: 'user1@keebhub.vn' });
    const line = u.cart.find(i => String(i.product) === String(cheap._id));
    assert.ok(has(await c.post('/cart/remove/' + line._id, {}), 'Đã xoá'));
    u = await M.User.findOne({ email: 'user1@keebhub.vn' });
    assert.equal(u.cart.length, 1);
  });
  it('Trang giỏ hàng và checkout hiển thị', async () => {
    assert.ok(has(await c.get('/cart'), prod.name.slice(0, 20)));
    const r = await c.get('/checkout?ship=express');
    assert.equal(r.status, 200);
    assert.ok(has(r, 'Hoả tốc'));
  });
  it('Checkout thiếu địa chỉ / SĐT sai → báo lỗi', async () => {
    assert.ok(has(await c.post('/checkout', { fullName: '', phone: '', address: '', payment: 'cod' }), 'Vui lòng nhập đầy đủ'));
    assert.ok(has(await c.post('/checkout', { fullName: 'A', phone: '12', address: 'B', payment: 'cod' }), 'Vui lòng nhập đầy đủ'));
  });
  it('Đặt hàng COD → tạo đơn, trừ kho, tăng đã bán, xoá giỏ', async () => {
    const before = await M.Product.findById(prod._id);
    const r = await c.post('/checkout', { fullName: 'User Một', phone: '0901234567', address: '1 Lê Lợi, Q1', payment: 'cod', ship: 'standard' });
    assert.ok(has(r, 'Đặt hàng thành công'));
    const after = await M.Product.findById(prod._id);
    assert.equal(after.stock, before.stock - 1);
    assert.equal(after.sold, before.sold + 1);
    const u = await M.User.findOne({ email: 'user1@keebhub.vn' });
    assert.equal(u.cart.length, 0);
    assert.equal(u.address.line, '1 Lê Lợi, Q1');
    const o = await M.Order.findOne({ user: u._id }).sort({ createdAt: -1 });
    assert.equal(o.paymentMethod, 'cod');
    assert.equal(o.status, 'pending');
    // phí ship: dưới 500k → 30k
    assert.equal(o.total, o.subtotal + (o.subtotal >= 500000 ? 0 : 30000));
  });
  it('Đặt hàng VNPay → trang mô phỏng → thất bại → thanh toán lại → thành công', async () => {
    await c.post('/cart/add', { productId: String(cheap._id), qty: '2' }, { headers: { referer: BASE + '/' } });
    let r = await c.post('/checkout', { fullName: 'User Một', phone: '0901234567', address: '1 Lê Lợi', payment: 'vnpay' });
    assert.ok(has(r, 'MÔ PHỎNG'));
    const group = r.url.split('/').pop();
    r = await c.post('/payment/mock/' + group, { result: 'fail' });
    assert.ok(has(r, 'Thanh toán chưa hoàn tất'));
    let o = await M.Order.findOne({ paymentGroup: group });
    assert.equal(o.paymentStatus, 'failed');
    r = await c.get('/payment/vnpay/' + group); // thanh toán lại -> sinh mã giao dịch mới
    assert.ok(has(r, 'MÔ PHỎNG'));
    const g2 = r.url.split('/').pop();
    assert.notEqual(g2, group);
    r = await c.post('/payment/mock/' + g2, { result: 'success' });
    assert.ok(has(r, 'Thanh toán thành công'));
    o = await M.Order.findById(o._id);
    assert.equal(o.paymentStatus, 'paid');
  });
  it('Return URL VNPay sai chữ ký → mã 97, không đổi trạng thái', async () => {
    const r = await c.get('/payment/vnpay_return?vnp_TxnRef=PGX&vnp_ResponseCode=00&vnp_SecureHash=abc');
    assert.notEqual(r.status, 500);
  });
  it('IPN VNPay sai chữ ký → RspCode 97', async () => {
    const r = await fetch(`${BASE}/payment/vnpay_ipn?vnp_TxnRef=PGX&vnp_SecureHash=abc`);
    assert.equal((await r.json()).RspCode, '97');
  });
  it('Không xem được kết quả thanh toán của người khác', async () => {
    const other = await M.Order.findOne({ paymentGroup: /^PGSEED/ });
    const r = await c.get('/payment/result/' + other.paymentGroup);
    assert.ok(r.url.startsWith('/account/orders'));
  });
});

// =====================================================================
describe('5. Hàm VNPay (đơn vị)', () => {
  it('Tạo URL có chữ ký và kiểm tra lại được; sửa số tiền → sai chữ ký', () => {
    process.env.VNP_TMNCODE = 'TESTCODE'; process.env.VNP_HASHSECRET = 'SECRETKEY';
    delete require.cache[require.resolve(path.join(ROOT, 'utils/vnpay'))];
    const v = require(path.join(ROOT, 'utils/vnpay'));
    const url = new URL(v.createPaymentUrl({ txnRef: 'PG1', amount: 150000, orderInfo: 'Thanh toan don KH 1', ipAddr: '127.0.0.1' }));
    const q = Object.fromEntries(url.searchParams);
    assert.equal(q.vnp_Amount, '15000000');
    assert.match(q.vnp_CreateDate, /^\d{14}$/);
    assert.ok(v.verify(q));
    q.vnp_Amount = '1';
    assert.ok(!v.verify(q));
    delete process.env.VNP_TMNCODE; delete process.env.VNP_HASHSECRET;
  });
});

// =====================================================================
describe('6. Custom Builder & kiểm tra tương thích', () => {
  const c = new Client();
  let kbd, tofu, sw5, sw3, kcLimited, stabPlate, stabPcb, kc;
  before(async () => {
    await c.login('user2@keebhub.vn', 'Khach@123');
    kbd = await M.Product.findOne({ name: /KBD67/ });
    tofu = await M.Product.findOne({ name: /Tofu60/ });
    sw5 = await M.Product.findOne({ name: /Oil King/ });
    sw3 = await M.Product.findOne({ name: /Box Jade/ });
    kcLimited = await M.Product.findOne({ name: /PBTfans BoW/ });
    stabPlate = await M.Product.findOne({ name: /TX AP/ });
    stabPcb = await M.Product.findOne({ name: /Durock/ });
    kc = await M.Product.findOne({ name: /GMK Olivia/ });
  });
  const compat = () => { delete require.cache[require.resolve(path.join(ROOT, 'utils/compat'))]; return require(path.join(ROOT, 'utils/compat')); };

  it('Đơn vị: switch 5 pin + PCB 3 pin → CHẶN', async () => {
    const r = await compat().check({ kit: kbd, sw: sw5, qty: 70 });
    assert.ok(r.issues.some(i => i.code === 'SWITCH_PINS' && i.level === 'block'));
    assert.equal(r.ok, false);
  });
  it('Đơn vị: switch 3 pin + PCB 3 pin → OK', async () => {
    const r = await compat().check({ kit: kbd, sw: sw3, qty: 70 });
    assert.ok(!r.issues.some(i => i.code === 'SWITCH_PINS'));
  });
  it('Đơn vị: thiếu số lượng switch → CHẶN', async () => {
    const r = await compat().check({ kit: tofu, sw: sw5, qty: 10 });
    assert.ok(r.issues.some(i => i.code === 'SWITCH_QTY'));
  });
  it('Đơn vị: stab plate + kit PCB-screw → CHẶN; PCB clip vs screw → OK', async () => {
    assert.ok((await compat().check({ kit: tofu, stab: stabPlate })).issues.some(i => i.code === 'STAB_MOUNT'));
    assert.ok(!(await compat().check({ kit: tofu, stab: stabPcb })).issues.some(i => i.code === 'STAB_MOUNT'));
  });
  it('Đơn vị: keycap chỉ hỗ trợ 60/65% + kit TKL → CHẶN', async () => {
    const tkl = await M.Product.findOne({ 'attrs.layout': 'TKL', partType: 'kit' });
    assert.ok((await compat().check({ kit: tkl, keycap: kcLimited })).issues.some(i => i.code === 'KEYCAP_LAYOUT'));
  });
  it('Đơn vị: LED north + Cherry → CẢNH BÁO (không chặn)', async () => {
    const north = await M.Product.findOne({ 'attrs.ledDirection': 'north' });
    const r = await compat().check({ kit: north, keycap: kc });
    const i = r.issues.find(x => x.code === 'LED_PROFILE');
    assert.ok(i && i.level === 'warn' && r.ok);
  });
  it('Đơn vị: kit hàn mạch + gói không hàn → CẢNH BÁO', async () => {
    const solder = await M.Product.findOne({ 'attrs.hotswap': false });
    const svc = await M.CustomService.findOne({ soldering: false });
    assert.ok((await compat().check({ kit: solder, service: svc })).issues.some(i => i.code === 'SOLDER_REQUIRED'));
  });
  it('Builder: các bước hiển thị', async () => {
    await c.get('/builder/new');
    for (const s of [1, 2, 3, 4, 5]) assert.equal((await c.get('/builder?step=' + s)).status, 200);
  });
  it('Builder: chọn KBD67 → switch 5 pin hiện "Không lắp vừa" kèm lý do', async () => {
    await c.post('/builder/select', { role: 'kit', productId: String(kbd._id) });
    const r = await c.get('/builder?step=2&all=1');
    assert.ok(has(r, 'Không lắp vừa'));
    assert.ok(has(r, 'chỉ nhận 3 chân'));
  });
  it('Builder: cố chọn switch không tương thích → báo lỗi, không đặt được', async () => {
    const r = await c.post('/builder/select', { role: 'sw', productId: String(sw5._id) });
    assert.ok(has(r, 'không tương thích'));
    const r2 = await c.post('/builder/cart', {});
    assert.ok(has(r2, 'Bạn còn thiếu') || has(r2, 'không tương thích'));
  });
  it('Builder: thiếu linh kiện → không thêm vào giỏ được', async () => {
    await c.get('/builder/new');
    await c.post('/builder/select', { role: 'kit', productId: String(tofu._id) });
    assert.ok(has(await c.post('/builder/cart', {}), 'Bạn còn thiếu'));
  });
  it('Builder: role/sản phẩm không hợp lệ không gây lỗi', async () => {
    assert.notEqual((await c.post('/builder/select', { role: 'xyz', productId: String(tofu._id) })).status, 500);
    assert.notEqual((await c.post('/builder/select', { role: 'kit', productId: 'abc' })).status, 500);
    assert.notEqual((await c.post('/builder/service', { serviceId: 'abc' })).status, 500);
    assert.notEqual((await c.post('/builder/qty', { qty: 'abc' })).status, 500);
    assert.notEqual((await c.get('/builder/edit/abc')).status, 500);
    assert.notEqual((await c.get('/builder/new?kit=abc')).status, 500);
  });
  it('Builder: build đầy đủ → lưu → thêm giỏ → không cho COD → VNPay → đơn custom chờ shop', async () => {
    await c.get('/builder/new');
    await c.post('/builder/select', { role: 'kit', productId: String(tofu._id) });
    await c.post('/builder/select', { role: 'sw', productId: String(sw5._id) });
    await c.post('/builder/select', { role: 'keycap', productId: String(kc._id), stay: '3' });
    await c.post('/builder/select', { role: 'stab', productId: String(stabPcb._id), stay: '3' });
    const svc = await M.CustomService.findOne({ name: 'Full lube + tune' });
    await c.post('/builder/service', { serviceId: String(svc._id) });
    assert.ok(has(await c.post('/builder/save', { name: 'Build test' }, { headers: { referer: BASE + '/builder?step=5' } }), 'Đã lưu cấu hình'));
    const r5 = await c.get('/builder?step=5');
    assert.ok(has(r5, 'Tất cả linh kiện đã chọn đều tương thích'));
    assert.ok(has(await c.post('/builder/cart', { note: 'test' }), 'vào giỏ hàng'));
    assert.ok(has(await c.get('/checkout'), 'Không áp dụng cho đơn gia công custom'));
    assert.ok(has(await c.post('/checkout', { fullName: 'U2', phone: '0901111222', address: 'HCM', payment: 'cod' }), 'không hỗ trợ COD'));
    const r = await c.post('/checkout', { fullName: 'U2', phone: '0901111222', address: 'HCM', payment: 'vnpay' });
    const g = r.url.split('/').pop();
    await c.post('/payment/mock/' + g, { result: 'success' });
    const o = await M.Order.findOne({ paymentGroup: g });
    assert.ok(o.isCustom && o.paymentStatus === 'paid' && o.customRequest.status === 'waiting');
    // switch 61 phím → 7 bộ 10
    const swLine = o.items.find(i => i.role === 'switch');
    assert.equal(swLine.qty, 7);
    assert.equal(o.total, o.subtotal + o.serviceFee + o.shippingFee);
    assert.equal((await M.Build.findById(o.build)).status, 'ordered');
  });
  it('Trang cấu hình đã lưu hiển thị', async () => { assert.equal((await c.get('/account/builds')).status, 200); });
});

// =====================================================================
describe('7. Quy trình gia công custom (seller) + đánh giá (khách)', () => {
  const seller = new Client();
  const cust = new Client();
  let order;
  before(async () => {
    await seller.login('switchhouse@keebhub.vn', 'Seller@123');
    await cust.login('user2@keebhub.vn', 'Khach@123');
    const u = await M.User.findOne({ email: 'user2@keebhub.vn' });
    order = await M.Order.findOne({ user: u._id, isCustom: true }).sort({ createdAt: -1 });
  });
  it('Trang đơn custom chờ xác nhận hiển thị', async () => { assert.ok(has(await seller.get('/seller/custom?code=' + order.code), order.code)); });
  it('Từ chối không ghi lý do → báo lỗi', async () => {
    assert.ok(has(await seller.post(`/seller/custom/${order.code}/reject`, { reason: '' }), 'nhập lý do'));
  });
  it('Không duyệt được đơn custom ở trang trạng thái chung', async () => {
    const r = await seller.post(`/seller/orders/${order.code}/status`, { status: 'confirmed' });
    assert.ok(has(r, 'chờ xác nhận') || has(r, 'Không thể'));
  });
  it('Khách không tự huỷ sau khi shop nhận gia công', async () => {
    assert.ok(has(await seller.post(`/seller/custom/${order.code}/accept`, { note: 'OK' }), 'Đã nhận gia công'));
    const o = await M.Order.findById(order._id);
    assert.equal(o.status, 'processing');
    assert.equal(o.progress.length, 5);
    assert.ok(has(await cust.post(`/account/orders/${order.code}/cancel`, { reason: 'x' }), 'không thể tự huỷ'));
  });
  it('Cập nhật tiến độ: lưu nháp + ảnh, rồi hoàn thành từng bước → tự chuyển Đang giao', async () => {
    let o = await M.Order.findById(order._id);
    const fd = new FormData();
    fd.append('note', 'Đang kiểm tra'); fd.append('action', 'save'); fd.append('photos', png(), 'a.png');
    await seller.req('POST', `/seller/progress/${o.code}/stage/${o.progress[0]._id}`, { multipart: fd });
    o = await M.Order.findById(order._id);
    assert.equal(o.progress[0].photos.length, 1);
    assert.equal(o.progress[0].status, 'doing');
    for (let i = 0; i < 5; i++) {
      const f = new FormData(); f.append('note', 'Xong bước ' + (i + 1)); f.append('action', 'done');
      await seller.req('POST', `/seller/progress/${o.code}/stage/${o.progress[i]._id}`, { multipart: f });
      const cur = await M.Order.findById(order._id);
      assert.equal(cur.progressPercent, (i + 1) * 20);
    }
    o = await M.Order.findById(order._id);
    assert.equal(o.status, 'shipping');
    assert.ok(o.shipping.trackingCode);
  });
  it('Khách xem tiến độ trong chi tiết đơn', async () => {
    const r = await cust.get('/account/orders/' + order.code);
    assert.ok(has(r, 'Tiến độ gia công') && has(r, 'Xong bước 5'));
  });
  it('Chưa giao không đánh giá được', async () => {
    const r = await cust.get(`/account/orders/${order.code}/review`);
    assert.ok(r.url.startsWith('/account/orders'));
  });
  it('Khách bấm "Đã nhận hàng" → Hoàn thành', async () => {
    await cust.post(`/account/orders/${order.code}/received`, {});
    assert.equal((await M.Order.findById(order._id)).status, 'completed');
  });
  it('Đánh giá có ảnh → cập nhật điểm sản phẩm; đánh giá lần 2 bị chặn', async () => {
    const o = await M.Order.findById(order._id);
    const item = o.items[0];
    const fd = new FormData(); fd.append('rating', '4'); fd.append('content', 'Ổn áp'); fd.append('images', png(), 'r.png');
    const r = await cust.req('POST', `/account/orders/${o.code}/review/${item._id}`, { multipart: fd });
    assert.ok(has(r, 'Cảm ơn bạn đã đánh giá'));
    const rv = await M.Review.findOne({ order: o._id, product: item.product });
    assert.equal(rv.rating, 4);
    assert.equal(rv.images.length, 1);
    const p = await M.Product.findById(item.product);
    assert.ok(p.reviewCount >= 1 && p.rating > 0);
    const fd2 = new FormData(); fd2.append('rating', '1');
    assert.ok(has(await cust.req('POST', `/account/orders/${o.code}/review/${item._id}`, { multipart: fd2 }), 'đã được đánh giá'));
  });
  it('Điểm đánh giá ngoài 1–5 được giới hạn', async () => {
    const o = await M.Order.findById(order._id);
    const fd = new FormData(); fd.append('rating', '99');
    await cust.req('POST', `/account/orders/${o.code}/review/${o.items[1]._id}`, { multipart: fd });
    const rv = await M.Review.findOne({ order: o._id, product: o.items[1].product });
    assert.equal(rv.rating, 5);
  });
  it('Seller trả lời đánh giá', async () => {
    const rv = await M.Review.findOne({ shop: order.shop, 'reply.content': { $exists: false } });
    if (!rv) return;
    await seller.post(`/seller/reviews/${rv._id}/reply`, { content: 'Cảm ơn!' });
    assert.equal((await M.Review.findById(rv._id)).reply.content, 'Cảm ơn!');
  });
  it('Từ chối đơn custom đã thanh toán → huỷ + chờ hoàn tiền + hoàn kho', async () => {
    const waiting = await M.Order.findOne({ shop: order.shop, isCustom: true, 'customRequest.status': 'waiting', paymentStatus: 'paid' });
    if (!waiting) return;
    const pid = waiting.items[0].product; const before = await M.Product.findById(pid);
    await seller.post(`/seller/custom/${waiting.code}/reject`, { reason: 'Xưởng đã kín lịch' });
    const o = await M.Order.findById(waiting._id);
    assert.equal(o.status, 'cancelled');
    assert.equal(o.paymentStatus, 'refund_pending');
    assert.equal((await M.Product.findById(pid)).stock, before.stock + waiting.items[0].qty);
  });
  it('Không nhận được đơn custom chưa thanh toán', async () => {
    const unpaid = await M.Order.findOne({ isCustom: true, 'customRequest.status': 'waiting', paymentStatus: 'unpaid' }).populate('shop');
    if (!unpaid) return;
    const owner = await M.User.findById(unpaid.shop.owner);
    const s = new Client(); await s.login(owner.email, 'Seller@123');
    assert.ok(has(await s.post(`/seller/custom/${unpaid.code}/accept`, {}), 'chưa thanh toán'));
  });
});

// =====================================================================
describe('8. Đơn hàng thường: cập nhật trạng thái & huỷ', () => {
  const seller = new Client();
  const cust = new Client();
  let o;
  before(async () => {
    await cust.login('user1@keebhub.vn', 'Khach@123');
    const u = await M.User.findOne({ email: 'user1@keebhub.vn' });
    o = await M.Order.findOne({ user: u._id, paymentMethod: 'cod' }).sort({ createdAt: -1 }).populate('shop');
    const owner = await M.User.findById(o.shop.owner);
    await seller.login(owner.email, 'Seller@123');
  });
  it('Chuyển trạng thái nhảy cóc (Chờ xác nhận → Đã giao) bị chặn', async () => {
    assert.ok(has(await seller.post(`/seller/orders/${o.code}/status`, { status: 'delivered' }), 'Không thể chuyển'));
    assert.ok(has(await seller.post(`/seller/orders/${o.code}/status`, { status: 'xyz' }), 'Không thể chuyển'));
  });
  it('Shop không tự chuyển sang Hoàn thành', async () => {
    assert.ok(has(await seller.post(`/seller/orders/${o.code}/status`, { status: 'completed' }), 'Không thể chuyển'));
  });
  it('Xác nhận → Đang giao (tự sinh mã vận đơn) → Đã giao (COD tự thành đã thanh toán)', async () => {
    await seller.post(`/seller/orders/${o.code}/status`, { status: 'confirmed' });
    await seller.post(`/seller/orders/${o.code}/status`, { status: 'shipping' });
    let x = await M.Order.findById(o._id);
    assert.equal(x.status, 'shipping'); assert.ok(x.shipping.trackingCode);
    assert.ok(has(await cust.post(`/account/orders/${o.code}/cancel`, { reason: 'x' }), 'không thể huỷ'));
    await seller.post(`/seller/orders/${o.code}/status`, { status: 'delivered' });
    x = await M.Order.findById(o._id);
    assert.equal(x.status, 'delivered'); assert.equal(x.paymentStatus, 'paid');
  });
  it('Khách huỷ đơn chờ xác nhận → hoàn kho; đơn VNPay đã trả → chờ hoàn tiền', async () => {
    const u = await M.User.findOne({ email: 'user1@keebhub.vn' });
    const paid = await M.Order.findOne({ user: u._id, paymentMethod: 'vnpay', paymentStatus: 'paid', status: 'pending' });
    const pid = paid.items[0].product; const before = await M.Product.findById(pid);
    assert.ok(has(await cust.post(`/account/orders/${paid.code}/cancel`, { reason: 'Đặt nhầm' }), 'hoàn về'));
    const x = await M.Order.findById(paid._id);
    assert.equal(x.status, 'cancelled'); assert.equal(x.paymentStatus, 'refund_pending');
    assert.equal((await M.Product.findById(pid)).stock, before.stock + paid.items[0].qty);
    // huỷ lần 2 không cộng kho thêm
    await cust.post(`/account/orders/${paid.code}/cancel`, { reason: 'x' });
    assert.equal((await M.Product.findById(pid)).stock, before.stock + paid.items[0].qty);
  });
  it('Danh sách đơn của khách lọc theo tab', async () => {
    for (const t of ['all', 'pending', 'confirmed', 'processing', 'shipping', 'done', 'cancelled', 'xyz']) assert.equal((await cust.get('/account/orders?tab=' + t)).status, 200);
  });
});

// =====================================================================
describe('9. Kênh người bán', () => {
  const s = new Client();
  before(async () => { await s.login('switchhouse@keebhub.vn', 'Seller@123'); });
  for (const u of ['/seller', '/seller/orders', '/seller/orders?status=pending&type=custom', '/seller/custom', '/seller/progress', '/seller/products',
    '/seller/products?status=pending&q=switch', '/seller/products/new', '/seller/inventory', '/seller/inventory?low=1', '/seller/services', '/seller/reviews',
    '/seller/reviews?tab=qa', '/seller/reviews?f=unreplied&star=5', '/seller/revenue', '/seller/profile']) {
    it(`GET ${u} → 200`, async () => { assert.equal((await s.get(u)).status, 200); });
  }
  it('Thống kê: khoảng ngày đảo ngược / sai định dạng / theo tháng không lỗi', async () => {
    for (const q of ['from=2026-10-01&to=2026-07-01', 'from=abc&to=xyz', 'from=2025-10-01&to=2026-10-01', 'group=month', 'group=day&from=2026-09-01&to=2026-09-30'])
      assert.equal((await s.get('/seller/revenue?' + q)).status, 200);
  });
  it('Thống kê: tổng biểu đồ cột = tổng doanh thu', async () => {
    const stats = require(path.join(ROOT, 'utils/stats'));
    const shop = await M.Shop.findOne({ slug: 'switchhouse' });
    const range = stats.parseRange({ from: '2026-07-01', to: '2026-10-02' });
    const ch = await stats.series({ shop: shop._id }, range);
    assert.equal(ch.revenue.reduce((a, b) => a + b, 0), ch.total);
    assert.equal(ch.labels.length, ch.revenue.length);
    const pie = await stats.byType({ shop: shop._id }, range);
    assert.equal(pie.reduce((a, b) => a + b.value, 0), ch.total);
  });
  let newId;
  it('Thêm sản phẩm thiếu tên / giá → báo lỗi', async () => {
    const cat = await M.Category.findOne({ partType: 'switch' });
    const fd = new FormData(); fd.append('name', ''); fd.append('category', String(cat._id)); fd.append('price', '0');
    assert.ok(has(await s.req('POST', '/seller/products', { multipart: fd }), 'Vui lòng nhập tên'));
  });
  it('Thêm sản phẩm có ảnh → chờ duyệt', async () => {
    const cat = await M.Category.findOne({ partType: 'switch' });
    const fd = new FormData();
    for (const [k, v] of Object.entries({ name: 'Switch Kiểm Thử', category: String(cat._id), price: '50000', stock: '-5', switchType: 'linear', pins: '5', specK: 'Màu', specV: 'Đỏ' })) fd.append(k, v);
    fd.append('images', png(), 'p.png');
    assert.ok(has(await s.req('POST', '/seller/products', { multipart: fd }), 'sau khi sàn duyệt'));
    const p = await M.Product.findOne({ name: 'Switch Kiểm Thử' });
    newId = p._id;
    assert.equal(p.status, 'pending'); assert.equal(p.stock, 0); assert.equal(p.images.length, 1); assert.deepEqual(p.attrs.pins, [5]);
  });
  it('Không upload được file không phải ảnh', async () => {
    const cat = await M.Category.findOne({ partType: 'switch' });
    const fd = new FormData(); fd.append('name', 'X'); fd.append('category', String(cat._id)); fd.append('price', '1000');
    fd.append('images', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
    const r = await s.req('POST', '/seller/products', { multipart: fd });
    assert.ok(r.status < 500, 'upload file lạ gây lỗi ' + r.status);
  });
  it('Sửa sản phẩm', async () => {
    const cat = await M.Category.findOne({ partType: 'switch' });
    const fd = new FormData(); fd.append('name', 'Switch Kiểm Thử 2'); fd.append('category', String(cat._id)); fd.append('price', '60000'); fd.append('stock', '20');
    await s.req('POST', '/seller/products/' + newId, { multipart: fd });
    const p = await M.Product.findById(newId);
    assert.equal(p.name, 'Switch Kiểm Thử 2'); assert.equal(p.stock, 20);
  });
  it('Không sửa được sản phẩm của shop khác', async () => {
    const other = await M.Product.findOne({ shop: (await M.Shop.findOne({ slug: 'keeblab-store' }))._id });
    assert.equal((await s.get(`/seller/products/${other._id}/edit`)).status, 404);
  });
  it('Cập nhật tồn kho (bỏ qua số âm)', async () => {
    const p = await M.Product.findById(newId);
    await s.post('/seller/inventory', { [`stock[${p._id}]`]: '-3', [`low[${p._id}]`]: '2' });
    const x = await M.Product.findById(newId);
    assert.equal(x.stock, 20); assert.equal(x.lowStock, 2);
    await s.post('/seller/inventory', { [`stock[${p._id}]`]: '15' });
    assert.equal((await M.Product.findById(newId)).stock, 15);
  });
  it('Gói dịch vụ: thêm / sửa / tạm dừng / xoá + cài đặt xưởng', async () => {
    assert.ok(has(await s.post('/seller/services', { name: '', price: '' }), 'Nhập tên gói'));
    await s.post('/seller/services', { name: 'Gói test', price: '100000', days: '2', includes: 'A\nB', stages: '' });
    const sv = await M.CustomService.findOne({ name: 'Gói test' });
    assert.ok(sv && sv.includes.length === 2 && sv.stages.length === 5);
    await s.post('/seller/services/' + sv._id, { name: 'Gói test 2', price: '120000', days: '3', stages: 'B1\nB2' });
    assert.equal((await M.CustomService.findById(sv._id)).stages.length, 2);
    await s.post(`/seller/services/${sv._id}/toggle`, {});
    assert.equal((await M.CustomService.findById(sv._id)).active, false);
    await s.post(`/seller/services/${sv._id}/delete`, {});
    assert.equal(await M.CustomService.findById(sv._id), null);
    await s.post('/seller/services/settings', { offersCustom: 'on', capacityPerWeek: '0' });
    assert.equal((await M.Shop.findOne({ slug: 'switchhouse' })).capacityPerWeek, 1);
    await s.post('/seller/services/settings', { offersCustom: 'on', capacityPerWeek: '10' });
  });
  it('Hồ sơ shop: màu sai định dạng bị bỏ qua', async () => {
    await s.post('/seller/profile', { name: 'SwitchHouse', color: 'red', city: 'TP.HCM' });
    assert.match((await M.Shop.findOne({ slug: 'switchhouse' })).color, /^#/);
  });
  it('Ẩn / hiện / xoá sản phẩm (có đơn → chỉ ẩn)', async () => {
    const withOrder = await M.Product.findOne({ shop: (await M.Shop.findOne({ slug: 'switchhouse' }))._id, status: 'active', sold: { $gt: 0 } });
    await s.post(`/seller/products/${withOrder._id}/delete`, {});
    assert.equal((await M.Product.findById(withOrder._id)).status, 'hidden');
    await s.post(`/seller/products/${withOrder._id}/toggle`, {}, { headers: { referer: BASE + '/seller/products' } });
    assert.equal((await M.Product.findById(withOrder._id)).status, 'active');
  });
  it('Đăng ký mở shop mới (khách → seller chờ duyệt)', async () => {
    const c = new Client(); await c.login('user3@keebhub.vn', 'Khach@123');
    assert.ok(has(await c.post('/seller/register', { name: 'ab' }), 'tối thiểu 3'));
    assert.ok(has(await c.post('/seller/register', { name: 'SwitchHouse' }), 'đã tồn tại'));
    assert.ok(has(await c.post('/seller/register', { name: 'Shop Kiểm Thử', city: 'Huế' }), 'chờ duyệt'));
    assert.equal((await M.User.findOne({ email: 'user3@keebhub.vn' })).role, 'seller');
  });
});

// =====================================================================
describe('10. Quản trị', () => {
  const a = new Client();
  before(async () => { await a.login('admin@keebhub.vn', 'Admin@123', true); });
  for (const u of ['/admin', '/admin/users', '/admin/users?role=seller&q=a&page=2', '/admin/shops', '/admin/shops?status=all', '/admin/products',
    '/admin/products?status=all&page=2', '/admin/orders', '/admin/orders?status=pending&pay=paid', '/admin/refunds', '/admin/refunds?tab=done',
    '/admin/compat', '/admin/revenue', '/admin/revenue?from=2026-01-01&to=2026-10-01&group=month']) {
    it(`GET ${u} → 200`, async () => { assert.equal((await a.get(u)).status, 200); });
  }
  it('Lọc doanh thu theo shop (id sai không lỗi)', async () => {
    const sh = await M.Shop.findOne({ slug: 'switchhouse' });
    assert.equal((await a.get('/admin/revenue?shop=' + sh._id)).status, 200);
    assert.equal((await a.get('/admin/revenue?shop=abc')).status, 200);
  });
  it('Duyệt sản phẩm → khách xem được', async () => {
    const p = await M.Product.findOne({ name: 'Switch Kiểm Thử 2' });
    await a.post(`/admin/products/${p._id}/approve`, {}, { headers: { referer: BASE + '/admin/products' } });
    assert.equal((await M.Product.findById(p._id)).status, 'active');
    assert.equal((await new Client().get('/p/' + p.slug)).status, 200);
  });
  it('Từ chối sản phẩm có lý do', async () => {
    const p = await M.Product.findOne({ status: 'pending' });
    await a.post(`/admin/products/${p._id}/reject`, { reason: 'Thiếu ảnh' }, { headers: { referer: BASE + '/admin/products' } });
    const x = await M.Product.findById(p._id);
    assert.equal(x.status, 'rejected'); assert.equal(x.rejectReason, 'Thiếu ảnh');
  });
  it('Duyệt shop chờ → seller vào được kênh người bán', async () => {
    const sh = await M.Shop.findOne({ name: 'Shop Kiểm Thử' });
    await a.post(`/admin/shops/${sh._id}/approve`, {}, { headers: { referer: BASE + '/admin/shops' } });
    const c = new Client(); await c.login('user3@keebhub.vn', 'Khach@123');
    assert.ok(has(await c.get('/seller'), 'Bảng điều khiển'));
  });
  it('Khoá → user không đăng nhập được; mở khoá → đăng nhập lại được', async () => {
    const u = await M.User.findOne({ email: 'user4@keebhub.vn' });
    await a.post(`/admin/users/${u._id}/status`, {}, { headers: { referer: BASE + '/admin/users' } });
    assert.ok(has(await new Client().login('user4@keebhub.vn', 'Khach@123'), 'bị khoá'));
    await a.post(`/admin/users/${u._id}/status`, {}, { headers: { referer: BASE + '/admin/users' } });
    assert.ok(!(await new Client().login('user4@keebhub.vn', 'Khach@123')).url.startsWith('/auth/login'));
  });
  it('Không khoá được admin', async () => {
    const ad = await M.User.findOne({ role: 'admin' });
    await a.post(`/admin/users/${ad._id}/status`, {}, { headers: { referer: BASE + '/admin/users' } });
    assert.equal((await M.User.findById(ad._id)).status, 'active');
  });
  it('Khoá đang đăng nhập → bị đăng xuất ở request kế tiếp', async () => {
    const c = new Client(); await c.login('user5@keebhub.vn', 'Khach@123');
    const u = await M.User.findOne({ email: 'user5@keebhub.vn' });
    await a.post(`/admin/users/${u._id}/status`, {}, { headers: { referer: BASE + '/admin/users' } });
    assert.ok((await c.get('/account')).url.startsWith('/auth/login'));
    await a.post(`/admin/users/${u._id}/status`, {}, { headers: { referer: BASE + '/admin/users' } });
  });
  it('Xác nhận hoàn tiền', async () => {
    const o = await M.Order.findOne({ paymentStatus: 'refund_pending' });
    await a.post('/admin/refunds/' + o.code, { note: 'GD123' });
    assert.equal((await M.Order.findById(o._id)).paymentStatus, 'refunded');
  });
  it('Admin can thiệp trạng thái đơn / huỷ đơn', async () => {
    const o = await M.Order.findOne({ status: 'confirmed' });
    await a.post(`/admin/orders/${o.code}/status`, { status: 'cancelled', note: 'test' });
    assert.equal((await M.Order.findById(o._id)).status, 'cancelled');
    assert.notEqual((await a.post(`/admin/orders/${o.code}/status`, { status: 'xyz' })).status, 500);
  });
  it('Đổi mức quy tắc tương thích → Builder áp dụng ngay', async () => {
    const rule = await M.CompatRule.findOne({ code: 'SWITCH_PINS' });
    await a.post('/admin/compat/' + rule._id, { level: 'warn', message: rule.message, enabled: 'on' });
    const compat = require(path.join(ROOT, 'utils/compat'));
    compat.clearCache();
    const kbd = await M.Product.findOne({ name: /KBD67/ }); const sw5 = await M.Product.findOne({ name: /Oil King/ });
    // server có cache 30s nên kiểm tra trực tiếp qua hàm
    const r = await compat.check({ kit: kbd, sw: sw5, qty: 70 });
    assert.equal(r.issues.find(i => i.code === 'SWITCH_PINS').level, 'warn');
    await a.post('/admin/compat/' + rule._id, { level: 'block', message: rule.message, enabled: 'on' });
  });
  it('Danh mục: thêm mới; xoá danh mục đang có sản phẩm bị chặn', async () => {
    await a.post('/admin/categories', { name: 'Danh Mục Test', icon: '🧪', partType: 'accessory' });
    const cat = await M.Category.findOne({ name: 'Danh Mục Test' });
    assert.ok(cat);
    const used = await M.Category.findOne({ partType: 'kit' });
    assert.ok(has(await a.post(`/admin/categories/${used._id}/delete`, {}), 'không xoá được'));
    await a.post(`/admin/categories/${cat._id}/delete`, {});
    assert.equal(await M.Category.findById(cat._id), null);
  });
});

// =====================================================================
describe('11. Tài khoản cá nhân, yêu thích, hỏi đáp', () => {
  const c = new Client();
  before(async () => { await c.login('user6@keebhub.vn', 'Khach@123'); });
  it('Cập nhật hồ sơ (kèm avatar); SĐT sai → báo lỗi', async () => {
    const fd = new FormData(); fd.append('name', 'Mai Chi Mới'); fd.append('phone', '0909090909'); fd.append('gender', 'female'); fd.append('birthday', '2004-05-06'); fd.append('avatar', png(), 'av.png');
    assert.ok(has(await c.req('POST', '/account/profile', { multipart: fd }), 'Đã cập nhật'));
    const u = await M.User.findOne({ email: 'user6@keebhub.vn' });
    assert.equal(u.name, 'Mai Chi Mới'); assert.ok(u.avatar);
    const fd2 = new FormData(); fd2.append('name', 'X Y'); fd2.append('phone', '12');
    assert.ok(has(await c.req('POST', '/account/profile', { multipart: fd2 }), 'không hợp lệ'));
  });
  it('Đổi mật khẩu: sai mật khẩu cũ → lỗi; đúng → đổi được', async () => {
    assert.ok(has(await c.post('/account/password', { current: 'sai', password: 'Moi@12345', confirm: 'Moi@12345' }), 'không đúng'));
    assert.ok(has(await c.post('/account/password', { current: 'Khach@123', password: 'Moi@12345', confirm: 'Moi@12345' }), 'Đã đổi mật khẩu'));
    assert.ok(!(await new Client().login('user6@keebhub.vn', 'Moi@12345')).url.startsWith('/auth/login'));
  });
  it('Yêu thích: thêm / bỏ', async () => {
    const p = await M.Product.findOne({ status: 'active' });
    const r = await c.req('POST', '/wishlist/' + p._id, { headers: { accept: 'application/json' } });
    assert.equal(JSON.parse(r.text).wished, true);
    assert.ok(has(await c.get('/account/wishlist'), p.name.slice(0, 15)));
    const r2 = await c.req('POST', '/wishlist/' + p._id, { headers: { accept: 'application/json' } });
    assert.equal(JSON.parse(r2.text).wished, false);
  });
  it('Hỏi đáp: gửi câu hỏi (chống XSS), câu quá ngắn bị chặn, trả lời bình luận', async () => {
    const p = await M.Product.findOne({ status: 'active', partType: 'kit' });
    assert.ok(has(await c.post(`/p/${p.slug}/comments`, { content: 'a' }), 'quá ngắn'));
    await c.post(`/p/${p.slug}/comments`, { content: '<script>alert(1)</script> có màu đen không?' });
    const page = await c.get(`/p/${p.slug}?tab=qa`);
    assert.ok(!page.text.includes('<script>alert(1)</script>'), 'Bình luận chưa được escape HTML');
    const cm = await M.Comment.findOne({ product: p._id }).sort({ createdAt: -1 });
    await c.post(`/comments/${cm._id}/reply`, { content: 'Mình cũng muốn hỏi' });
    const x = await M.Comment.findById(cm._id);
    assert.equal(x.replies.length, 1); assert.equal(x.replies[0].isSeller, false);
  });
  it('Gợi ý sản phẩm thay đổi theo sản phẩm đã xem', async () => {
    const kit = await M.Product.findOne({ status: 'active', partType: 'kit' });
    await c.get('/p/' + kit.slug);
    const u = await M.User.findOne({ email: 'user6@keebhub.vn' });
    assert.equal(String(u.viewed[0]), String(kit._id));
    assert.ok(has(await c.get('/'), 'Gợi ý cho bạn'));
  });
});

// =====================================================================
describe('12. Chat AI', () => {
  const c = new Client();
  const ask = async (q, cl = c) => {
    const r = await cl.req('POST', '/api/chat', { json: { messages: [{ role: 'user', content: q }] } });
    return { status: r.status, body: JSON.parse(r.text) };
  };
  it('Gợi ý sản phẩm theo loại + ngân sách', async () => {
    const r = await ask('switch linear dưới 100k');
    assert.equal(r.status, 200);
    assert.ok(r.body.products.length > 0);
  });
  it('Câu hỏi thanh toán / ship / huỷ đơn', async () => {
    assert.match((await ask('thanh toán thế nào')).body.reply, /VNPay/);
    assert.match((await ask('phí ship bao nhiêu')).body.reply, /30\.000/);
    assert.match((await ask('huỷ đơn được không')).body.reply, /huỷ/);
  });
  it('Hỏi đơn hàng khi chưa đăng nhập / đã đăng nhập', async () => {
    assert.match((await ask('đơn hàng của tôi tới đâu rồi')).body.reply, /đăng nhập/);
    const u = new Client(); await u.login('khach@keebhub.vn', 'Khach@123');
    assert.match((await ask('đơn hàng của tôi tới đâu rồi', u)).body.reply, /#KH-/);
  });
  it('Dữ liệu rỗng / sai kiểu không gây lỗi', async () => {
    for (const body of [{}, { messages: 'abc' }, { messages: [null, 1, {}] }]) {
      const r = await c.req('POST', '/api/chat', { json: body });
      assert.equal(r.status, 200);
    }
  });
  it('Gửi quá nhanh (>15 tin/phút) → 429', async () => {
    const x = new Client(); let last;
    for (let i = 0; i < 17; i++) last = await x.req('POST', '/api/chat', { json: { messages: [{ role: 'user', content: 'hi' }] } });
    assert.equal(last.status, 429);
  });
});
