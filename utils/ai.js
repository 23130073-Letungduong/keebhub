// Trợ lý AI hỗ trợ khách hàng (Tự chọn 11)
// - Có GEMINI_API_KEY  -> gọi Google Gemini
// - Có ANTHROPIC_API_KEY -> gọi Claude
// - Không có key        -> trả lời theo luật + tìm sản phẩm trong CSDL
const { Product, Order, Shop } = require('../models');
const { money, escapeRegex, PART_LABEL } = require('./helpers');

const FAQ = `
- KeebHub là sàn TMĐT bàn phím cơ custom: bán kit, switch, keycap, stabilizer, phụ kiện và dịch vụ gia công (lube, cân stab, lắp ráp).
- Custom Builder (/builder): 5 bước Kit → Switch → Keycap & Stab → Gói gia công → Xem lại. Hệ thống tự kiểm tra tương thích (chân switch, mount stab, layout keycap, LED...).
- Thanh toán: VNPay (thẻ ATM/Visa/QR) hoặc COD. Đơn gia công custom KHÔNG hỗ trợ COD vì hàng làm riêng.
- Phí ship: 30.000₫, miễn phí cho đơn từ 500.000₫ mỗi shop.
- Đơn custom: shop có 24h để nhận/từ chối. Khi gia công, khách xem tiến độ từng công đoạn kèm ảnh trong "Đơn hàng của tôi".
- Huỷ đơn: được huỷ khi đơn còn "Chờ xác nhận"/"Đã xác nhận" (đơn thường) hoặc khi shop chưa nhận đơn custom. Đơn đã thanh toán VNPay sẽ được hoàn tiền trong 3-5 ngày.
- Đánh giá: chỉ đánh giá sản phẩm đã mua, sau khi đơn ở trạng thái Đã giao/Hoàn thành.
- Hotline 1900 6868, email hotro@keebhub.vn.`;

const STOP = new Set(['tôi', 'mình', 'cho', 'cần', 'muốn', 'mua', 'tìm', 'có', 'không', 'nào', 'gì', 'là', 'của', 'và', 'với', 'giá', 'bao', 'nhiêu', 'shop', 'bạn', 'ơi', 'được', 'cái', 'loại', 'một', 'những', 'các', 'về', 'hãy', 'giúp', 'gợi', 'ý', 'nên', 'tư', 'vấn', 'em', 'anh', 'chị', 'phím', 'bàn']);

async function findProducts(text, limit = 6) {
  const t = text.toLowerCase();
  const q = { status: 'active', shop: { $in: (await Shop.find({ status: 'active' }).select('_id')).map(s => s._id) } };
  const part = /switch/.test(t) ? 'switch' : /keycap|nút/.test(t) ? 'keycap' : /stab/.test(t) ? 'stabilizer' : /kit|vỏ|case/.test(t) ? 'kit' : /cáp|cable|phụ kiện/.test(t) ? 'accessory' : null;
  if (part) q.partType = part;
  const priceM = t.match(/(dưới|<|tầm|khoảng|max)\s*(\d+[.,]?\d*)\s*(k|tr|triệu|nghìn)?/);
  if (priceM) {
    let v = parseFloat(priceM[2].replace(',', '.'));
    const u = priceM[3] || '';
    v = /tr|triệu/.test(u) ? v * 1e6 : /k|nghìn/.test(u) ? v * 1e3 : (v < 1000 ? v * 1e3 : v);
    q.price = priceM[1] === 'dưới' || priceM[1] === '<' || priceM[1] === 'max' ? { $lte: v } : { $gte: v * 0.7, $lte: v * 1.3 };
  }
  if (/linear/.test(t)) q['attrs.switchType'] = 'linear';
  else if (/tactile/.test(t)) q['attrs.switchType'] = 'tactile';
  else if (/clicky/.test(t)) q['attrs.switchType'] = 'clicky';
  const m = t.match(/(60|65|75|tkl|full)\s*%?/);
  if (m && (part === 'kit' || part === 'keycap' || !part)) q['attrs.layout'] = m[1] === 'tkl' ? 'TKL' : m[1] === 'full' ? 'Full' : m[1] + '%';
  const words = t.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w) &&
    !['switch', 'keycap', 'kit', 'stab', 'stabilizer', 'linear', 'tactile', 'clicky', 'dưới', 'tầm', 'khoảng', 'triệu', 'nghìn'].includes(w));
  let items = [];
  if (words.length) {
    items = await Product.find({ ...q, $or: words.map(w => ({ name: new RegExp(escapeRegex(w), 'i') })) }).sort({ sold: -1 }).limit(limit).populate('shop', 'name');
  }
  if (!items.length && (part || q.price || q['attrs.switchType'] || q['attrs.layout'])) {
    items = await Product.find(q).sort({ sold: -1 }).limit(limit).populate('shop', 'name');
  }
  return items;
}

function productLine(p) {
  const a = p.attrs || {};
  const extra = [a.layout, a.switchType, a.force ? a.force + 'g' : '', a.profile, a.hotswap === true ? 'hotswap' : a.hotswap === false ? 'hàn mạch' : '', a.pins && a.pins.length ? a.pins.join('/') + ' pin' : '', a.stabMount].filter(Boolean).join(', ');
  return `- ${p.name} | ${PART_LABEL[p.partType]} | ${money(p.price)} | shop ${p.shop ? p.shop.name : ''} | còn ${p.stock} | ${extra} | link /p/${p.slug}`;
}

async function buildContext(user, text) {
  const products = await findProducts(text);
  const best = products.length ? [] : await Product.find({ status: 'active', shop: { $in: (await Shop.find({ status: 'active' }).select('_id')).map(s => s._id) } }).sort({ sold: -1 }).limit(5).populate('shop', 'name');
  let ctx = `Câu hỏi thường gặp:${FAQ}\n\nSản phẩm liên quan trong kho:\n${(products.length ? products : best).map(productLine).join('\n') || '(không có)'}`;
  if (user) {
    const orders = await Order.find({ user: user._id }).sort({ createdAt: -1 }).limit(5);
    if (orders.length) {
      ctx += `\n\nĐơn gần đây của khách ${user.name}:\n` + orders.map(o => `- #${o.code}: ${Order.STATUS[o.status].label}, ${Order.PAY[o.paymentStatus].label}, tổng ${money(o.total)}${o.isCustom ? `, gia công ${o.progressPercent}%` : ''}`).join('\n');
    }
  }
  return { ctx, products };
}

const SYSTEM = `Bạn là "Keeby" — trợ lý ảo của sàn KeebHub chuyên bàn phím cơ custom. Trả lời bằng tiếng Việt, ngắn gọn (tối đa ~120 từ), thân thiện, đúng trọng tâm.
Chỉ giới thiệu sản phẩm có trong phần "Sản phẩm liên quan" bên dưới, ghi đúng tên và giá; không bịa sản phẩm hoặc chính sách. Khi gợi ý build, nhắc khách dùng Custom Builder để kiểm tra tương thích. Nếu không chắc, hướng dẫn liên hệ hotline 1900 6868.`;

async function callGemini(system, history) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { temperature: 0.5, maxOutputTokens: 600 }
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ? data.error.message : 'Gemini lỗi');
  return data.candidates[0].content.parts.map(p => p.text).join('');
}

async function callClaude(system, history) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5', max_tokens: 600, system, messages: history })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ? data.error.message : 'Claude lỗi');
  return data.content.map(c => c.text || '').join('');
}

async function ruleBased(user, text, products) {
  const t = text.toLowerCase();
  if (/(đơn|order).*(đâu|tới|trạng thái|tiến độ)|kiểm tra đơn|theo dõi đơn|đơn hàng của tôi/.test(t)) {
    if (!user) return 'Bạn hãy đăng nhập rồi vào mục "Đơn hàng của tôi" để xem trạng thái và tiến độ gia công nhé.';
    const o = await Order.findOne({ user: user._id }).sort({ createdAt: -1 });
    if (!o) return 'Bạn chưa có đơn hàng nào. Ghé Custom Builder để bắt đầu build chiếc phím đầu tiên nhé!';
    return `Đơn gần nhất #${o.code} đang ở trạng thái "${Order.STATUS[o.status].label}" (${Order.PAY[o.paymentStatus].label})${o.isCustom ? `, tiến độ gia công ${o.progressPercent}%` : ''}. Xem chi tiết tại mục Đơn hàng của tôi.`;
  }
  if (/thanh toán|vnpay|cod|trả tiền/.test(t)) return 'KeebHub hỗ trợ thanh toán VNPay (ATM, Visa/Master, QR) và COD. Riêng đơn gia công custom chỉ thanh toán online vì đây là hàng làm riêng.';
  if (/ship|giao hàng|vận chuyển|phí ship/.test(t)) return 'Phí giao hàng 30.000₫/shop, miễn phí cho đơn từ 500.000₫. Hàng lẻ giao 2-4 ngày; đơn gia công cộng thêm thời gian gia công của gói (thường 3-7 ngày).';
  if (/huỷ|hủy|hoàn tiền/.test(t)) return 'Bạn có thể huỷ khi đơn còn "Chờ xác nhận" hoặc "Đã xác nhận" (đơn custom: trước khi shop nhận gia công). Đơn đã thanh toán VNPay sẽ được hoàn trong 3-5 ngày làm việc.';
  if (/tương thích|build|lắp|ráp|custom/.test(t) && !products.length) return 'Bạn mở Custom Builder (/builder) nhé: chọn Kit → Switch → Keycap & Stab → Gói gia công. Hệ thống tự khoá linh kiện không lắp vừa và giải thích lý do cụ thể.';
  if (/xin chào|chào|hello|hi\b/.test(t)) return 'Chào bạn! Mình là Keeby 🤖. Mình có thể gợi ý switch/keycap/kit theo ngân sách, giải thích tương thích, hoặc kiểm tra đơn hàng giúp bạn.';
  if (products.length) return `Mình tìm được ${products.length} sản phẩm phù hợp:\n` + products.slice(0, 4).map(p => `• ${p.name} — ${money(p.price)}`).join('\n') + '\nBấm vào thẻ bên dưới để xem chi tiết nhé.';
  return 'Mình chưa hiểu rõ ý bạn. Bạn thử hỏi: "switch linear dưới 500k", "keycap cho kit 65%", "đơn hàng của tôi tới đâu rồi", hoặc "thanh toán thế nào?"';
}

async function chat(user, messages) {
  const history = (Array.isArray(messages) ? messages : []).filter(m => m && typeof m === 'object' && m.content).slice(-10).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 1500) }));
  const last = history.length ? history[history.length - 1].content : '';
  const { ctx, products } = await buildContext(user, last);
  const cards = products.slice(0, 4).map(p => ({ name: p.name, price: money(p.price), url: `/p/${p.slug}`, image: p.image }));
  const system = `${SYSTEM}\n\n${ctx}`;
  let reply, engine = 'rule';
  try {
    if (process.env.GEMINI_API_KEY) { reply = await callGemini(system, history); engine = 'gemini'; }
    else if (process.env.ANTHROPIC_API_KEY) { reply = await callClaude(system, history); engine = 'claude'; }
  } catch (e) {
    console.error('[AI]', e.message);
  }
  if (!reply) reply = await ruleBased(user, last, products);
  return { reply, products: cards, engine };
}

module.exports = { chat };
