// Tạo dữ liệu mẫu cho KeebHub:  npm run seed
// CẢNH BÁO: xoá toàn bộ dữ liệu cũ trong database MONGODB_URI
require('dotenv').config();
const mongoose = require('mongoose');
const { User, Shop, Category, Product, CustomService, Order, Review, Comment, Build } = require('../models');
const { slugify } = require('../utils/helpers');
const compat = require('../utils/compat');
const { recalcRating } = require('../utils/orders');

const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/keebhub';
let rnd = 42;
const rand = () => { rnd = (rnd * 16807) % 2147483647; return (rnd - 1) / 2147483646; };
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (a, b) => Math.floor(a + rand() * (b - a + 1));

async function mkUser(name, email, pw, role = 'customer', extra = {}) {
  const u = new User({ name, email, role, emailVerified: true, ...extra });
  await u.setPassword(pw);
  return u.save();
}

async function main() {
  await mongoose.connect(URI);
  console.log('Đã kết nối', URI);
  await mongoose.connection.db.dropDatabase();
  console.log('Đã xoá dữ liệu cũ');
  await Promise.all(Object.values(require('../models')).map(m => m.syncIndexes()));

  // ---------- Danh mục ----------
  const catDefs = [
    ['Kit bàn phím', 'kit', '⌨', '#EEF4FF', '#1B62F5'],
    ['Switch', 'switch', '🔘', '#FFF3ED', '#E84708'],
    ['Keycap', 'keycap', '🎨', '#F3F0FF', '#7C3AED'],
    ['Stabilizer', 'stabilizer', '⚖', '#ECFDF3', '#079455'],
    ['Phụ kiện', 'accessory', '🔌', '#FFFAEB', '#DC6803'],
    ['Build sẵn', 'prebuilt', '📦', '#EEF2F6', '#475467']
  ];
  const cats = {};
  for (let i = 0; i < catDefs.length; i++) {
    const [name, partType, icon, bg, fg] = catDefs[i];
    cats[partType] = await Category.create({ name, slug: slugify(name), partType, icon, bg, fg, order: i });
  }

  // ---------- Người dùng ----------
  const admin = await mkUser('Lê Tùng Dương', 'admin@keebhub.vn', 'Admin@123', 'admin', { color: '#1B62F5' });
  const sellersDef = [
    ['Trần Minh Khang', 'switchhouse@keebhub.vn', 'SwitchHouse', '#E84708', 'TP.HCM', true, 'Xưởng lube & build phím custom lâu năm, chuyên switch linear và gasket mount.'],
    ['Phan Văn Gia Bảo', 'keeblab@keebhub.vn', 'KeebLab Store', '#1B62F5', 'TP.HCM', true, 'Phân phối kit nhôm CNC, nhận hàn mạch và build trọn gói.'],
    ['Đỗ Lan', 'keycapdongnam@keebhub.vn', 'Keycap Đông Nam', '#7C3AED', 'Hà Nội', false, 'Chuyên keycap GMK, PBT, MW chính hãng.'],
    ['Vũ Minh', 'akko@keebhub.vn', 'Akko Official', '#079455', 'Đà Nẵng', false, 'Nhà phân phối chính hãng Akko & Monsgeek tại Việt Nam.']
  ];
  const shops = {};
  for (const [name, email, shopName, color, city, custom, desc] of sellersDef) {
    const u = await mkUser(name, email, 'Seller@123', 'seller', { phone: '09' + between(10000000, 99999999) });
    shops[shopName] = await Shop.create({
      owner: u._id, name: shopName, slug: slugify(shopName), color, city, description: desc,
      address: `${between(10, 300)} Nguyễn Trãi, ${city}`, phone: u.phone, status: 'active', verified: true,
      offersCustom: custom, capacityPerWeek: custom ? 10 : 5, followers: between(1500, 12000)
    });
  }
  const pendingOwner = await mkUser('Lý Hạnh', 'newshop@keebhub.vn', 'Seller@123', 'seller');
  await Shop.create({ owner: pendingOwner._id, name: 'Phím Cơ 24h', slug: 'phim-co-24h', color: '#475467', city: 'Cần Thơ', description: 'Shop mới, chờ duyệt.', status: 'pending', offersCustom: true });

  const customers = [];
  customers.push(await mkUser('Trần Hữu Thắng', 'khach@keebhub.vn', 'Khach@123', 'customer', {
    phone: '0987654321', address: { fullName: 'Trần Hữu Thắng', phone: '0987654321', line: '128 Nguyễn Văn Cừ, Phường 2, Quận 5, TP. Hồ Chí Minh' }
  }));
  const names = ['Phạm Vũ', 'Nguyễn Minh', 'Trần Hoàng', 'Vũ Thành', 'Ngô Sơn', 'Mai Chi', 'Hoàng Yến', 'Đặng Khoa', 'Bùi Long', 'Lưu Trang', 'Phan Tú', 'Tạ Quân'];
  for (let i = 0; i < names.length; i++) {
    customers.push(await mkUser(names[i], `user${i + 1}@keebhub.vn`, 'Khach@123', 'customer', {
      phone: '09' + between(10000000, 99999999),
      address: { fullName: names[i], phone: '09' + between(10000000, 99999999), line: `${between(1, 200)} Lê Lợi, Quận ${between(1, 12)}, TP.HCM` },
      createdAt: new Date(Date.now() - between(1, 120) * 86400e3)
    }));
  }
  const locked = await mkUser('Spam Bot', 'spam@keebhub.vn', 'Khach@123');
  locked.status = 'locked'; await locked.save();

  // ---------- Sản phẩm ----------
  const S = shops;
  const P = [];
  async function prod(shop, partType, name, price, oldPrice, stock, attrs, art, desc, specs = [], sold = 0, status = 'active') {
    const p = await Product.create({
      shop: shop._id, category: cats[partType]._id, partType, name, slug: slugify(name) + '-' + between(100, 999),
      price, oldPrice, stock, sold, attrs, art, description: desc, specs, status,
      sku: 'KH-' + partType.slice(0, 2).toUpperCase() + between(100, 999), createdAt: new Date(Date.now() - between(3, 160) * 86400e3)
    });
    P.push(p);
    return p;
  }
  const kitDesc = (n, l) => `${n} — kit layout ${l} hoàn thiện cao, phù hợp cả người mới lẫn người chơi lâu năm.\nVỏ nhôm CNC anodized, foam và PET sheet đi kèm giúp âm thanh gọn, đầm.\nCó thể đặt gia công lube, cân stab và lắp ráp trọn gói qua Custom Builder.`;

  const tofu = await prod(S['KeebLab Store'], 'kit', 'Kit Tofu60 2.0 Aluminium — Hotswap, gasket mount, foam sẵn', 2690000, 3280000, 38,
    { layout: '60%', keyCount: 61, mount: 'gasket', hotswap: true, pins: [3, 5], ledDirection: 'south', stabMount: 'pcb-screw', material: 'Nhôm CNC 6063' },
    { kind: 'kit', color: '#C9CED6', accent: '#1B62F5', bg: '#E7EBF0' }, kitDesc('Tofu60 2.0', '60%'),
    [{ k: 'Kết nối', v: 'USB-C có dây' }, { k: 'Plate', v: 'Brass' }, { k: 'Trọng lượng', v: '1.6kg' }], 1200);
  await prod(S['KeebLab Store'], 'kit', 'Kit Keychron Q1 Pro QMK/VIA — knob, gasket, nhôm full', 4290000, 4790000, 22,
    { layout: '75%', keyCount: 81, mount: 'gasket', hotswap: true, pins: [3, 5], ledDirection: 'south', stabMount: 'pcb-screw', material: 'Nhôm CNC' },
    { kind: 'kit', color: '#374151', accent: '#EF4444', bg: '#E7EBF0' }, kitDesc('Keychron Q1 Pro', '75%'), [{ k: 'Kết nối', v: 'Bluetooth 5.1 + USB-C' }], 2100);
  await prod(S['SwitchHouse'], 'kit', 'Kit Zoom65 V3 — gasket, tri-mode, plate FR4', 5890000, 0, 12,
    { layout: '65%', keyCount: 67, mount: 'gasket', hotswap: true, pins: [3, 5], ledDirection: 'south', stabMount: 'pcb-screw', material: 'Nhôm' },
    { kind: 'kit', color: '#1F3A6E', accent: '#FF5A1F', bg: '#E7EBF0' }, kitDesc('Zoom65 V3', '65%'), [{ k: 'Kết nối', v: 'Tri-mode' }], 94);
  await prod(S['Akko Official'], 'kit', 'Kit Monsgeek M1W — nhôm CNC, 3 mode, LED north-facing', 2150000, 0, 40,
    { layout: '75%', keyCount: 82, mount: 'gasket', hotswap: true, pins: [3, 5], ledDirection: 'north', stabMount: 'pcb-screw', material: 'Nhôm' },
    { kind: 'kit', color: '#F3F4F6', accent: '#10B981', bg: '#EEF2F6' }, kitDesc('Monsgeek M1W', '75%'), [], 540);
  await prod(S['SwitchHouse'], 'kit', 'Kit KBD67 Lite R4 — PCB hotswap 3 pin, stab plate-mount', 1890000, 2190000, 18,
    { layout: '65%', keyCount: 67, mount: 'gasket', hotswap: true, pins: [3], ledDirection: 'south', stabMount: 'plate', material: 'Nhựa polycarbonate' },
    { kind: 'kit', color: '#E5E7EB', accent: '#7C3AED', bg: '#F3F0FF' }, kitDesc('KBD67 Lite R4', '65%'), [], 310);
  await prod(S['KeebLab Store'], 'kit', 'Kit Bakeneko60 — PCB hàn mạch, o-ring mount', 2390000, 0, 9,
    { layout: '60%', keyCount: 61, mount: 'o-ring', hotswap: false, pins: [3, 5], ledDirection: 'south', stabMount: 'pcb-screw', material: 'Nhôm' },
    { kind: 'kit', color: '#7C2D12', accent: '#FDBA74', bg: '#FFF3ED' }, kitDesc('Bakeneko60', '60%'), [], 75);
  await prod(S['Akko Official'], 'kit', 'Kit Akko MOD 007B TKL — gasket, hotswap 5 pin', 2590000, 2890000, 25,
    { layout: 'TKL', keyCount: 87, mount: 'gasket', hotswap: true, pins: [3, 5], ledDirection: 'south', stabMount: 'pcb-screw', material: 'Nhôm' },
    { kind: 'kit', color: '#111827', accent: '#F472B6', bg: '#E7EBF0' }, kitDesc('Akko MOD 007B', 'TKL'), [], 180);
  await prod(S['Akko Official'], 'prebuilt', 'Bàn phím build sẵn Akko 5075B Plus — switch Cream Yellow, keycap ASA', 1890000, 2290000, 50,
    { layout: '75%', keyCount: 82, hotswap: true, pins: [3, 5] },
    { kind: 'kit', color: '#F9A8D4', accent: '#111827', bg: '#FDF2F8' }, 'Bàn phím hoàn chỉnh, mở hộp dùng ngay. Hotswap để thay switch về sau.', [], 760);

  const swDesc = (n, t, f) => `${n} — switch ${t} lực nhấn ${f}g. Giá niêm yết cho 1 bộ 10 switch.\nPhù hợp build gõ văn bản lẫn chơi game.`;
  const oil = await prod(S['SwitchHouse'], 'switch', 'Switch Gateron Oil King — Linear 55g, lube nhà máy (bộ 10)', 127000, 150000, 400,
    { switchType: 'linear', force: 55, pins: [5] }, { kind: 'switch', color: '#111827', accent: '#F59E0B' }, swDesc('Gateron Oil King', 'linear', 55), [{ k: 'Hành trình', v: '4.0mm' }], 430);
  await prod(S['Akko Official'], 'switch', 'Switch Akko Cream Yellow V3 Pro — Linear 50g (bộ 10)', 45000, 59000, 900,
    { switchType: 'linear', force: 50, pins: [5] }, { kind: 'switch', color: '#FBBF24', accent: '#1B222C' }, swDesc('Akko Cream Yellow V3 Pro', 'linear', 50), [], 3400);
  await prod(S['SwitchHouse'], 'switch', 'Switch HMX Xinhai — Linear 52g, đã lube nhà máy (bộ 10)', 77000, 0, 300,
    { switchType: 'linear', force: 52, pins: [5] }, { kind: 'switch', color: '#38BDF8', accent: '#0C4A6E' }, swDesc('HMX Xinhai', 'linear', 52), [], 310);
  await prod(S['KeebLab Store'], 'switch', 'Switch Gateron Ink Black V2 — Linear 60g (bộ 10)', 164000, 0, 120,
    { switchType: 'linear', force: 60, pins: [5] }, { kind: 'switch', color: '#1F2937', accent: '#6366F1' }, swDesc('Gateron Ink Black V2', 'linear', 60), [], 42);
  await prod(S['KeebLab Store'], 'switch', 'Switch Boba U4T Thocky — Tactile 62g (bộ 10)', 140000, 0, 150,
    { switchType: 'tactile', force: 62, pins: [5] }, { kind: 'switch', color: '#7C3AED', accent: '#C4B5FD' }, swDesc('Boba U4T', 'tactile', 62), [], 74);
  await prod(S['SwitchHouse'], 'switch', 'Switch Kailh Box Jade — Clicky 50g, 3 pin (bộ 10)', 59000, 0, 200,
    { switchType: 'clicky', force: 50, pins: [3] }, { kind: 'switch', color: '#6EE7B7', accent: '#065F46' }, swDesc('Kailh Box Jade', 'clicky', 50), [], 30);
  await prod(S['Akko Official'], 'switch', 'Switch Akko Jelly Purple — Tactile 50g, 3 pin (bộ 10)', 39000, 0, 500,
    { switchType: 'tactile', force: 50, pins: [3] }, { kind: 'switch', color: '#A78BFA', accent: '#4C1D95' }, swDesc('Akko Jelly Purple', 'tactile', 50), [], 890);
  await prod(S['SwitchHouse'], 'switch', 'Switch Gateron Silent Black — Silent linear 60g (bộ 10)', 99000, 0, 160,
    { switchType: 'silent', force: 60, pins: [5] }, { kind: 'switch', color: '#374151', accent: '#9CA3AF' }, swDesc('Gateron Silent Black', 'silent', 60), [], 120);

  const kcDesc = (n, p) => `${n} — profile ${p}, nhựa chất lượng cao, in sắc nét không phai.`;
  await prod(S['Keycap Đông Nam'], 'keycap', 'Keycap GMK Olivia++ Cherry profile — Base kit 137 phím', 4150000, 0, 15,
    { profile: 'Cherry', layouts: ['60%', '65%', '75%', 'TKL', 'Full'], material: 'ABS double-shot' }, { kind: 'keycap', color: '#E8E3DC', accent: '#E6A4B4', bg: '#F4F1EC' }, kcDesc('GMK Olivia++', 'Cherry'), [], 86);
  await prod(S['Akko Official'], 'keycap', 'Keycap Akko Black & Pink ASA profile — 158 phím', 690000, 890000, 80,
    { profile: 'ASA', layouts: ['60%', '65%', '75%', 'TKL', 'Full'], material: 'PBT double-shot' }, { kind: 'keycap', color: '#1F2937', accent: '#F472B6', bg: '#F3F4F6' }, kcDesc('Akko Black & Pink', 'ASA'), [], 1800);
  await prod(S['Keycap Đông Nam'], 'keycap', 'Keycap MW Jamón Cherry profile — bộ base + novelty', 3250000, 3650000, 10,
    { profile: 'Cherry', layouts: ['60%', '65%', '75%', 'TKL'], material: 'ABS double-shot' }, { kind: 'keycap', color: '#F5E6D3', accent: '#C8553D', bg: '#F4F1EC' }, kcDesc('MW Jamón', 'Cherry'), [], 120);
  await prod(S['Keycap Đông Nam'], 'keycap', 'Keycap PBTfans BoW Cherry — bộ nhỏ cho 60%/65%', 1150000, 0, 30,
    { profile: 'Cherry', layouts: ['60%', '65%'], material: 'PBT dye-sub' }, { kind: 'keycap', color: '#FFFFFF', accent: '#111827', bg: '#F1F4F8' }, kcDesc('PBTfans BoW', 'Cherry'), [], 210);
  await prod(S['Keycap Đông Nam'], 'keycap', 'Keycap XDA Canvas — PBT dye-sub, 140 phím', 890000, 990000, 45,
    { profile: 'XDA', layouts: ['60%', '65%', '75%', 'TKL', 'Full'], material: 'PBT dye-sub' }, { kind: 'keycap', color: '#FEF3C7', accent: '#2563EB', bg: '#FFFBEB' }, kcDesc('XDA Canvas', 'XDA'), [], 330);
  await prod(S['Akko Official'], 'keycap', 'Keycap Domikey SA Retro — 160 phím', 1350000, 0, 20,
    { profile: 'SA', layouts: ['60%', '65%', 'TKL', 'Full'], material: 'ABS double-shot' }, { kind: 'keycap', color: '#E7E5E4', accent: '#B45309', bg: '#F5F5F4' }, kcDesc('Domikey SA Retro', 'SA'), [], 64);
  await prod(S['Keycap Đông Nam'], 'keycap', 'Keycap MDA Matcha — PBT, 128 phím', 750000, 0, 35,
    { profile: 'MDA', layouts: ['60%', '65%', '75%', 'TKL'], material: 'PBT' }, { kind: 'keycap', color: '#D9F99D', accent: '#365314', bg: '#F7FEE7' }, kcDesc('MDA Matcha', 'MDA'), [], 140);

  await prod(S['SwitchHouse'], 'stabilizer', 'Stabilizer Durock V2 PCB screw-in — đã lube sẵn', 420000, 0, 60,
    { stabMount: 'pcb-screw' }, { kind: 'stab', color: '#C7D2FE', accent: '#3730A3' }, 'Stab screw-in chắc chắn, đã lube dây và housing.', [], 760);
  await prod(S['KeebLab Store'], 'stabilizer', 'Stabilizer TX AP Rev 3 — plate-mount', 520000, 0, 25,
    { stabMount: 'plate' }, { kind: 'stab', color: '#FDE68A', accent: '#92400E' }, 'Stab plate-mount cao cấp, ít rattle.', [], 95);
  await prod(S['Akko Official'], 'stabilizer', 'Stabilizer Everglide Panda — PCB clip-in', 250000, 290000, 70,
    { stabMount: 'pcb-clip' }, { kind: 'stab', color: '#F3F4F6', accent: '#111827' }, 'Stab clip-in giá tốt.', [], 300);
  await prod(S['SwitchHouse'], 'stabilizer', 'Stabilizer Cherry clip-in plate-mount — bộ 4 cái', 150000, 0, 100,
    { stabMount: 'plate' }, { kind: 'stab', color: '#BBF7D0', accent: '#166534' }, 'Stab plate-mount phổ thông.', [], 210);

  await prod(S['SwitchHouse'], 'accessory', 'Cáp coiled aviator custom — dài 1.8m, nhiều màu', 450000, 590000, 70, {}, { kind: 'cable', color: '#1B62F5', accent: '#FF5A1F' }, 'Cáp xoắn đầu aviator GX16, USB-C.', [], 2600);
  await prod(S['KeebLab Store'], 'accessory', 'Lube Krytox 205g0 — hũ 5ml', 280000, 0, 90, {}, { kind: 'cable', color: '#9CA3AF', accent: '#111827', bg: '#F9FAFB' }, 'Mỡ lube switch chuẩn.', [], 480);
  await prod(S['Akko Official'], 'accessory', 'Bộ dụng cụ mở switch & nhổ keycap', 120000, 0, 200, {}, { kind: 'cable', color: '#F59E0B', accent: '#1F2937' }, 'Switch opener nhôm + keycap puller.', [], 900);
  await prod(S['SwitchHouse'], 'accessory', 'Deskmat Wave 900×400mm', 350000, 420000, 55, {}, { kind: 'cable', color: '#0EA5E9', accent: '#0F172A' }, 'Lót chuột cỡ lớn, may viền.', [], 650);
  // sản phẩm chờ duyệt để demo kiểm duyệt
  await prod(S['SwitchHouse'], 'switch', 'Switch Gateron Milky Yellow Pro — Linear 50g (bộ 10)', 35000, 0, 500,
    { switchType: 'linear', force: 50, pins: [5] }, { kind: 'switch', color: '#FEF08A', accent: '#A16207' }, 'Switch giá rẻ cho người mới.', [], 0, 'pending');
  await prod(S['Keycap Đông Nam'], 'keycap', 'Keycap GMK Botanical — Cherry profile', 3890000, 0, 8,
    { profile: 'Cherry', layouts: ['60%', '65%', '75%', 'TKL'] }, { kind: 'keycap', color: '#D1FAE5', accent: '#047857' }, 'Set keycap xanh lá.', [], 0, 'pending');

  // ---------- Dịch vụ gia công ----------
  const svc = {};
  svc.basic = await CustomService.create({ shop: S['SwitchHouse']._id, name: 'Lắp ráp cơ bản', price: 250000, days: 3, description: 'Lắp switch, keycap, stab và test toàn phím.', includes: ['Lắp ráp toàn bộ', 'Test từng phím bằng VIA', 'Đóng gói chống sốc'], soldering: false, lube: false, stages: ['Kiểm tra linh kiện & PCB', 'Lắp ráp & test toàn phím', 'Đóng gói & bàn giao vận chuyển'] });
  svc.full = await CustomService.create({ shop: S['SwitchHouse']._id, name: 'Full lube + tune', price: 750000, days: 5, description: 'Rã switch, lube Krytox 205g0, film Deskeys, cân stab và lắp ráp.', includes: ['Lube toàn bộ switch', 'Film switch', 'Cân & lube stabilizer', 'Band-aid mod'], soldering: false, lube: true });
  svc.solder = await CustomService.create({ shop: S['SwitchHouse']._id, name: 'Hàn mạch + lube trọn gói', price: 1100000, days: 7, description: 'Dành cho kit PCB hàn: hàn switch, lube, cân stab.', includes: ['Hàn switch', 'Lube switch', 'Cân stab', 'Test mạch'], soldering: true, lube: true, stages: ['Kiểm tra PCB', 'Lube switch', 'Hàn switch lên PCB', 'Cân chỉnh stabilizer', 'Lắp ráp & test toàn phím', 'Đóng gói & bàn giao vận chuyển'] });
  svc.lab = await CustomService.create({ shop: S['KeebLab Store']._id, name: 'Lube switch + cân stab', price: 550000, days: 4, description: 'Gói phổ biến, cân bằng giữa giá và chất lượng.', includes: ['Lube switch', 'Cân stab', 'Lắp ráp & test'], soldering: false, lube: true });
  svc.premium = await CustomService.create({ shop: S['KeebLab Store']._id, name: 'Build Premium (hàn + mod)', price: 1250000, days: 6, description: 'Trọn gói cao cấp: hàn/rã hàn, lube, tape mod, PE foam.', includes: ['Hàn / rã hàn', 'Lube + film', 'Tape & PE foam mod', 'Video test âm thanh'], soldering: true, lube: true });

  await compat.seedRules();

  // ---------- Đơn hàng mẫu (90 ngày) ----------
  const active = P.filter(p => p.status === 'active');
  const byShop = {};
  active.forEach(p => { (byShop[p.shop] = byShop[p.shop] || []).push(p); });
  const shopList = Object.values(S);
  const docs = [];
  let seq = 100000;
  const mkCode = () => 'KH-' + (seq += between(3, 97));

  for (let d = 89; d >= 0; d--) {
    const n = between(0, 3) + (d < 14 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const shop = pick(shopList);
      const cust = pick(customers);
      const items = [];
      const list = byShop[shop._id] || [];
      const cnt = between(1, 3);
      for (let j = 0; j < cnt; j++) {
        const p = pick(list);
        if (items.find(i => String(i.product) === String(p._id))) continue;
        items.push({ product: p._id, name: p.name, image: `/img/p/${p._id}.svg`, partType: p.partType, price: p.price, qty: p.partType === 'switch' ? between(4, 9) : 1 });
      }
      const created = new Date(Date.now() - d * 86400e3 - between(0, 20) * 3600e3);
      const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
      const ship = subtotal >= 500000 ? 0 : 30000;
      const cod = rand() < 0.3;
      let status = d > 10 ? pick(['completed', 'completed', 'completed', 'delivered', 'cancelled']) : pick(['pending', 'confirmed', 'shipping', 'delivered', 'completed', 'completed']);
      const paid = !cod && status !== 'pending' ? 'paid' : (cod && ['completed', 'delivered'].includes(status) ? 'paid' : (status === 'pending' && !cod ? pick(['paid', 'unpaid']) : 'unpaid'));
      let paymentStatus = paid;
      if (status === 'cancelled') paymentStatus = cod ? 'unpaid' : pick(['refunded', 'refund_pending']);
      const o = new Order({
        code: mkCode(), user: cust._id, shop: shop._id, items, subtotal, shippingFee: ship, total: subtotal + ship,
        paymentMethod: cod ? 'cod' : 'vnpay', paymentStatus, paymentGroup: 'PGSEED' + seq, paidAt: paymentStatus === 'paid' ? created : undefined,
        status, shipping: { fullName: cust.address.fullName || cust.name, phone: cust.address.phone || '0900000000', address: cust.address.line || 'TP.HCM', trackingCode: ['shipping', 'delivered', 'completed'].includes(status) ? 'GHN' + seq : undefined },
        cancelReason: status === 'cancelled' ? pick(['Đặt nhầm, muốn đặt lại', 'Tìm được giá tốt hơn']) : undefined, cancelledBy: status === 'cancelled' ? 'customer' : undefined,
        history: [{ status: 'pending', note: 'Đặt hàng thành công', by: 'customer', at: created }].concat(status !== 'pending' ? [{ status, note: Order.STATUS[status].label, by: 'seller', at: new Date(created.getTime() + 86400e3) }] : []),
        createdAt: created, updatedAt: created
      });
      docs.push(o);
    }
  }

  // Đơn custom (gia công)
  const kits = active.filter(p => p.partType === 'kit' && p.attrs.hotswap && p.attrs.stabMount === 'pcb-screw');
  const sws = active.filter(p => p.partType === 'switch' && (p.attrs.pins || []).includes(5));
  const kcs = active.filter(p => p.partType === 'keycap');
  const stabs = active.filter(p => p.partType === 'stabilizer' && p.attrs.stabMount.startsWith('pcb'));
  const services = [svc.full, svc.basic, svc.lab, svc.premium];
  const plan = [
    ...Array(10).fill('completed'), 'delivered', 'shipping', 'processing', 'processing', 'processing', 'pending', 'pending'
  ];
  for (let i = 0; i < plan.length; i++) {
    const status = plan[i];
    const cust = i >= plan.length - 4 ? customers[0] : pick(customers);
    const kit = i === plan.length - 3 ? tofu : pick(kits);
    const sw = i === plan.length - 3 ? oil : pick(sws);
    const kc = pick(kcs.filter(k => (k.attrs.layouts || []).includes(kit.attrs.layout)));
    const st = pick(stabs);
    const s = pick(services);
    const qty = Math.ceil(kit.attrs.keyCount / 10);
    const build = await Build.create({ user: cust._id, name: 'Build ' + kit.name.split('—')[0].replace('Kit ', '').trim(), kit: kit._id, switch: sw._id, switchQty: qty * 10, keycap: kc._id, stab: st._id, service: s._id, status: 'ordered' });
    const items = [
      { product: kit._id, name: kit.name, image: `/img/p/${kit._id}.svg`, partType: 'kit', price: kit.price, qty: 1, role: 'kit' },
      { product: sw._id, name: `${sw.name} (×${qty * 10} switch)`, image: `/img/p/${sw._id}.svg`, partType: 'switch', price: sw.price, qty, role: 'switch' },
      { product: kc._id, name: kc.name, image: `/img/p/${kc._id}.svg`, partType: 'keycap', price: kc.price, qty: 1, role: 'keycap' },
      { product: st._id, name: st.name, image: `/img/p/${st._id}.svg`, partType: 'stabilizer', price: st.price, qty: 1, role: 'stab' }
    ];
    const subtotal = items.reduce((a, b) => a + b.price * b.qty, 0);
    const d = status === 'completed' ? between(8, 85) : status === 'pending' ? 0 : between(1, 6);
    const created = new Date(Date.now() - d * 86400e3 - between(1, 10) * 3600e3);
    const stagesN = (s.stages && s.stages.length) ? s.stages : CustomService.DEFAULT_STAGES;
    let progress = [];
    if (status !== 'pending') {
      const doneCount = status === 'processing' ? between(1, stagesN.length - 1) : stagesN.length;
      progress = stagesN.map((name, idx) => ({
        name, status: idx < doneCount ? 'done' : idx === doneCount ? 'doing' : 'todo',
        note: idx < doneCount ? pick(['Đã kiểm tra, không lỗi.', 'Lube Krytox 205g0 cho toàn bộ switch, film Deskeys.', 'Clip + lube stab, band-aid mod, hết rattle.', 'Lắp ráp xong, test toàn bộ phím bằng VIA.', 'Đóng thùng chống sốc, quay video test.']) : '',
        photos: idx < doneCount && idx < 3 ? [`/img/p/${kit._id}.svg`] : [],
        doneAt: idx < doneCount ? new Date(created.getTime() + (idx + 1) * 20 * 3600e3) : undefined
      }));
    }
    const o = new Order({
      code: mkCode(), user: cust._id, shop: s.shop, items, isCustom: true, build: build._id, buildCode: build.code,
      service: { ref: s._id, name: s.name, price: s.price, days: s.days },
      customRequest: status === 'pending' ? { status: 'waiting', deadline: new Date(created.getTime() + 24 * 3600e3) } : { status: 'accepted', respondedAt: new Date(created.getTime() + 5 * 3600e3), deadline: new Date(created.getTime() + s.days * 86400e3) },
      progress, subtotal, serviceFee: s.price, shippingFee: 0, total: subtotal + s.price,
      paymentMethod: 'vnpay', paymentStatus: i === plan.length - 1 ? 'unpaid' : 'paid', paidAt: i === plan.length - 1 ? undefined : created, paymentGroup: 'PGSEEDC' + i, vnpTransactionNo: '1400' + between(1000, 9999),
      status, shipping: { fullName: cust.address.fullName || cust.name, phone: cust.address.phone || '0900000000', address: cust.address.line || 'TP.HCM', trackingCode: ['shipping', 'delivered', 'completed'].includes(status) ? 'GHN' + seq : undefined },
      history: [{ status: 'pending', note: 'Gửi yêu cầu gia công tới shop', by: 'customer', at: created }],
      createdAt: created, updatedAt: created
    });
    docs.push(o);
  }
  await Order.collection.insertMany(docs.map(d => d.toObject()));
  console.log(`Đã tạo ${docs.length} đơn hàng`);

  // ---------- Đánh giá ----------
  const contents = {
    5: ['Gõ cực sướng, âm thanh thocky đúng ý. Shop đóng gói rất kỹ.', 'Chất lượng vượt mong đợi, giao nhanh.', 'Xưởng làm kỹ, gửi ảnh từng công đoạn rất yên tâm.', 'Hàng chuẩn chính hãng, sẽ ủng hộ tiếp.'],
    4: ['Sản phẩm tốt, giao hơi chậm 1 ngày.', 'Ổn trong tầm giá, stab hơi kêu nhẹ.'],
    3: ['Tạm được, keycap có vài phím hơi lệch màu.']
  };
  const done = await Order.find({ status: { $in: ['completed', 'delivered'] } });
  let rc = 0;
  for (const o of done) {
    if (rand() < 0.45) continue;
    for (const it of o.items) {
      if (rand() < 0.35) continue;
      const r = pick([5, 5, 5, 4, 4, 3]);
      await Review.create({ product: it.product, shop: o.shop, user: o.user, order: o._id, rating: r, content: pick(contents[r]), createdAt: new Date(o.createdAt.getTime() + 4 * 86400e3),
        reply: rand() < 0.5 ? { content: 'Cảm ơn bạn đã ủng hộ shop! Có gì cần hỗ trợ cứ nhắn shop nhé.', at: new Date() } : undefined });
      it.reviewed = true;
      rc++;
    }
    await o.save();
  }
  for (const p of active) await recalcRating(p._id);
  console.log(`Đã tạo ${rc} đánh giá`);

  // ---------- Hỏi đáp ----------
  const qs = [
    [tofu, 'Kit này dùng được switch 5 chân không shop?', 'Dạ được ạ, PCB hotswap hỗ trợ cả 3 và 5 chân.'],
    [tofu, 'Có kèm stab không ạ?', null],
    [oil, 'Giá này là 1 bộ bao nhiêu con vậy shop?', 'Giá cho 1 bộ 10 switch bạn nhé. Build 60% cần 7 bộ.']
  ];
  for (const [p, q, a] of qs) {
    const shop = await Shop.findById(p.shop);
    await Comment.create({ product: p._id, shop: p.shop, user: pick(customers)._id, content: q, replies: a ? [{ user: shop.owner, name: shop.name, isSeller: true, content: a }] : [] });
  }

  console.log('\n✓ Seed xong. Tài khoản demo:');
  console.log('  Admin   : admin@keebhub.vn / Admin@123   (đăng nhập tại /admin/login)');
  console.log('  Seller  : switchhouse@keebhub.vn / Seller@123 (xưởng gia công)');
  console.log('            keeblab@keebhub.vn / Seller@123');
  console.log('  Khách   : khach@keebhub.vn / Khach@123');
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
