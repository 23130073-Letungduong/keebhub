// Gom giỏ hàng theo shop, tính tiền — dùng cho trang giỏ hàng và checkout
const { User } = require('../models');

const SHIP = {
  standard: { label: 'Tiêu chuẩn', desc: '2-4 ngày', fee: 30000 },
  express: { label: 'Hoả tốc', desc: '1-2 ngày (nội thành)', fee: 55000 }
};
const FREE_SHIP_FROM = 500000;

function buildLines(b) {
  const lines = [];
  if (b.kit) lines.push({ role: 'kit', label: 'Kit', product: b.kit, qty: 1 });
  // Switch bán theo bộ 10 switch: số bộ = ceil(số switch / 10)
  if (b.switch) lines.push({ role: 'switch', label: 'Switch', product: b.switch, qty: Math.max(1, Math.ceil((b.switchQty || 10) / 10)), note: `×${Math.ceil((b.switchQty || 10) / 10) * 10} switch` });
  if (b.keycap) lines.push({ role: 'keycap', label: 'Keycap', product: b.keycap, qty: 1 });
  if (b.stab) lines.push({ role: 'stab', label: 'Stabilizer', product: b.stab, qty: 1 });
  return lines;
}
function lineTotal(l) {
  return l.product.price * l.qty;
}
function buildTotal(b) {
  const parts = buildLines(b).reduce((s, l) => s + lineTotal(l), 0);
  return { parts, service: b.service ? b.service.price : 0, total: parts + (b.service ? b.service.price : 0) };
}

async function loadCart(userId) {
  const user = await User.findById(userId)
    .populate({ path: 'cart.product', populate: { path: 'shop', select: 'name slug color status' } })
    .populate({ path: 'cart.build', populate: [{ path: 'kit' }, { path: 'switch' }, { path: 'keycap' }, { path: 'stab' }, { path: 'service', populate: { path: 'shop', select: 'name slug color status' } }] });
  const groups = {};
  const invalid = [];
  for (const it of user.cart) {
    if (it.product) {
      const p = it.product;
      if (p.status !== 'active' || !p.shop || p.shop.status !== 'active') { invalid.push(it); continue; }
      const key = String(p.shop._id);
      groups[key] = groups[key] || { shop: p.shop, items: [], builds: [] };
      groups[key].items.push({ id: it._id, product: p, qty: it.qty, total: p.price * it.qty, overStock: it.qty > p.stock });
    } else if (it.build && it.build.kit && it.build.switch && it.build.keycap && it.build.service && it.build.service.active !== false && it.build.service.shop && it.build.service.shop.status === 'active') {
      const b = it.build;
      const key = String(b.service.shop._id);
      groups[key] = groups[key] || { shop: b.service.shop, items: [], builds: [] };
      const t = buildTotal(b);
      const lines = buildLines(b).map(l => ({ ...l, total: lineTotal(l) }));
      const outOfStock = lines.some(l => !l.product || l.product.status !== 'active' || l.product.stock < l.qty);
      groups[key].builds.push({ id: it._id, build: b, lines, ...t, outOfStock });
    } else {
      invalid.push(it);
    }
  }
  const list = Object.values(groups).map(g => {
    g.subtotal = g.items.reduce((s, i) => s + i.total, 0) + g.builds.reduce((s, b) => s + b.total, 0);
    g.count = g.items.reduce((s, i) => s + i.qty, 0) + g.builds.length;
    return g;
  });
  const subtotal = list.reduce((s, g) => s + g.subtotal, 0);
  const hasCustom = list.some(g => g.builds.length);
  return { user, groups: list, subtotal, hasCustom, invalid };
}

function shipFee(groupSubtotal, method) {
  const m = SHIP[method] || SHIP.standard;
  if (method !== 'express' && groupSubtotal >= FREE_SHIP_FROM) return 0;
  return m.fee;
}

module.exports = { loadCart, buildTotal, buildLines, lineTotal, shipFee, SHIP, FREE_SHIP_FROM };
