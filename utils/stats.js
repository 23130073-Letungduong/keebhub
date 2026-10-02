// Thống kê doanh thu cho biểu đồ cột (theo khoảng ngày) và biểu đồ tròn.
// Gom số liệu bằng JavaScript sau một truy vấn find() để chạy được trên mọi phiên bản MongoDB.
const { Order, Category, Shop } = require('../models');
const { ymd } = require('./helpers');

const PLATFORM_FEE = 0.05; // phí sàn 5%

// Đơn được tính doanh thu: không huỷ và đã thanh toán (VNPay) hoặc COD
const REVENUE_MATCH = { status: { $ne: 'cancelled' }, $or: [{ paymentStatus: 'paid' }, { paymentMethod: 'cod' }] };

function parseRange(q, defDays = 14) {
  let to = q.to ? new Date(q.to + 'T23:59:59') : new Date();
  let from = q.from ? new Date(q.from + 'T00:00:00') : new Date(Date.now() - (defDays - 1) * 86400e3);
  if (isNaN(to)) to = new Date();
  if (isNaN(from)) from = new Date(Date.now() - (defDays - 1) * 86400e3);
  if (from > to) [from, to] = [to, from];
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  const days = Math.round((to - from) / 86400e3);
  const group = q.group === 'month' || (q.group !== 'day' && days > 92) ? 'month' : 'day';
  return { from, to, group, fromStr: ymd(from), toStr: ymd(to) };
}

function revenueOrders(extraMatch, { from, to }, fields = 'total createdAt isCustom items.partType items.price items.qty items.product items.name items.image shop') {
  return Order.find({ ...REVENUE_MATCH, ...extraMatch, createdAt: { $gte: from, $lte: to } }).select(fields).lean();
}
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Chuỗi doanh thu theo ngày / tháng (biểu đồ cột)
async function series(extraMatch, range) {
  const { from, to, group } = range;
  const orders = await revenueOrders(extraMatch, range, 'total createdAt');
  const keyOf = (d) => (group === 'month' ? monthKey(d) : ymd(d));
  const map = {};
  orders.forEach(o => {
    const k = keyOf(new Date(o.createdAt));
    map[k] = map[k] || { revenue: 0, orders: 0 };
    map[k].revenue += o.total; map[k].orders += 1;
  });
  const labels = [], revenue = [], counts = [], seen = new Set();
  const d = new Date(from);
  while (d <= to) {
    const key = keyOf(d);
    if (!seen.has(key)) {
      seen.add(key);
      labels.push(group === 'month' ? `T${d.getMonth() + 1}/${d.getFullYear()}` : `${d.getDate()}/${d.getMonth() + 1}`);
      revenue.push(map[key] ? map[key].revenue : 0);
      counts.push(map[key] ? map[key].orders : 0);
    }
    if (group === 'month') { d.setDate(1); d.setMonth(d.getMonth() + 1); } else d.setDate(d.getDate() + 1);
  }
  const total = revenue.reduce((a, b) => a + b, 0);
  const count = counts.reduce((a, b) => a + b, 0);
  return { labels, revenue, orders: counts, total, count, fee: Math.round(total * PLATFORM_FEE) };
}

// Cơ cấu theo trạng thái đơn (biểu đồ tròn)
async function byStatus(extraMatch, { from, to }) {
  const orders = await Order.find({ ...extraMatch, createdAt: { $gte: from, $lte: to } }).select('status').lean();
  const m = {};
  orders.forEach(o => { m[o.status] = (m[o.status] || 0) + 1; });
  return Object.keys(m).map(k => ({ label: Order.STATUS[k] ? Order.STATUS[k].label : k, key: k, value: m[k] }));
}

// Cơ cấu doanh thu theo loại đơn
async function byType(extraMatch, range) {
  const orders = await revenueOrders(extraMatch, range, 'total isCustom');
  const m = {};
  orders.forEach(o => { const k = o.isCustom ? 1 : 0; m[k] = m[k] || { v: 0, n: 0 }; m[k].v += o.total; m[k].n++; });
  return Object.keys(m).map(k => ({ label: k === '1' ? 'Đơn custom có gia công' : 'Bán lẻ linh kiện', value: m[k].v, count: m[k].n }));
}

// Cơ cấu doanh thu theo danh mục sản phẩm
async function byCategory(extraMatch, range) {
  const orders = await revenueOrders(extraMatch, range, 'items.partType items.price items.qty');
  const m = {};
  orders.forEach(o => o.items.forEach(i => { m[i.partType] = (m[i.partType] || 0) + i.price * i.qty; }));
  const cats = await Category.find().lean();
  const name = {}; cats.forEach(c => { name[c.partType] = name[c.partType] || c.name; });
  return Object.keys(m).sort((a, b) => m[b] - m[a]).map(k => ({ label: name[k] || k, value: m[k] }));
}

async function topProducts(extraMatch, range, limit = 5) {
  const orders = await revenueOrders(extraMatch, range, 'items');
  const m = {};
  orders.forEach(o => o.items.forEach(i => {
    const k = String(i.product);
    m[k] = m[k] || { _id: i.product, name: i.name, image: i.image, qty: 0, v: 0 };
    m[k].qty += i.qty; m[k].v += i.price * i.qty;
  }));
  return Object.values(m).sort((a, b) => b.v - a.v).slice(0, limit);
}

async function byShop(extraMatch, range, limit = 10) {
  const orders = await revenueOrders(extraMatch, range, 'total shop');
  const m = {};
  orders.forEach(o => { const k = String(o.shop); m[k] = m[k] || { _id: o.shop, v: 0, n: 0 }; m[k].v += o.total; m[k].n++; });
  const rows = Object.values(m).sort((a, b) => b.v - a.v).slice(0, limit);
  const shops = await Shop.find({ _id: { $in: rows.map(r => r._id) } });
  const sm = {}; shops.forEach(s => { sm[String(s._id)] = s; });
  return rows.filter(r => sm[String(r._id)]).map(r => ({ ...r, s: sm[String(r._id)] }));
}

module.exports = { parseRange, series, byStatus, byType, byCategory, topProducts, byShop, REVENUE_MATCH, PLATFORM_FEE };
