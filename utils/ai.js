// Trợ lý AI hỗ trợ khách hàng (Tự chọn 11)
// - Có GEMINI_API_KEY  -> gọi Google Gemini
// - Có ANTHROPIC_API_KEY -> gọi Claude
// - Không có key        -> trả lời theo Ý ĐỊNH do mô hình học máy dự đoán (utils/intent.js) + dữ liệu thật trong CSDL
// Mọi chế độ đều lấy sản phẩm / đơn hàng / số dư ví THẬT từ CSDL → không bịa giá, không bịa trạng thái đơn.
const { Product, Order, Shop, User } = require('../models');
const { money, escapeRegex, PART_LABEL } = require('./helpers');
const intentModel = require('./intent');
const { SHIP, FREE_SHIP_FROM } = require('./cart');
const { PLATFORM_FEE } = require('./stats');

const FAQ = `
- KeebHub là sàn TMĐT bàn phím cơ custom: bán kit, switch, keycap, stabilizer, phụ kiện và dịch vụ gia công (lube, cân stab, hàn mạch, lắp ráp).
- Custom Builder (/builder) 6 bước: Kit → Switch → Keycap → Stabilizer → Gói gia công → Xem lại. Hệ thống tự kiểm tra tương thích (chân switch, mount stab, layout keycap, LED...).
- Thanh toán: VNPay (ATM/Visa/QR), COD, hoặc Ví KeebHub (trừ thẳng số dư). Đơn gia công custom KHÔNG hỗ trợ COD.
- Phí ship: tiêu chuẩn 30.000₫, hoả tốc 55.000₫ mỗi shop; miễn phí ship tiêu chuẩn cho đơn từ 500.000₫ mỗi shop.
- Huỷ đơn: tự huỷ khi đơn còn "Chờ xác nhận"/"Đã xác nhận" (đơn custom: trước khi shop nhận gia công). Đơn đã thanh toán bị huỷ → hoàn NGAY toàn bộ tiền vào Ví KeebHub.
- Trả hàng: trong 7 ngày kể từ khi nhận, chỉ khi hàng lỗi / giao sai / thiếu / hư hỏng do vận chuyển (không nhận đổi ý), cần ảnh chứng minh. Shop duyệt trong 72 giờ; khách gửi hàng về; shop xác nhận đã nhận → hoàn tiền vào Ví KeebHub. Shop từ chối hoặc im lặng → khiếu nại lên sàn 1 lần.
- Ví KeebHub (/account/wallet): chứa tiền hoàn, dùng để thanh toán đơn sau, không rút ra tiền mặt.
- Đánh giá: chỉ đánh giá sản phẩm đã mua, sau khi đơn Đã giao/Hoàn thành.
- Mở shop: đăng ký ở /seller/register, admin duyệt hồ sơ; sàn thu phí 5% mỗi đơn hoàn tất; sản phẩm mới phải được duyệt.
- Hotline 1900 6868, email letungduong.nvn@gmail.com.`;

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

// ---------- Trả lời theo ý định (khi không có API AI, hoặc AI lỗi) ----------
const link = (href, text) => `${text} (${href})`;
async function ruleBased(user, text, products, intent) {
  const fee = (k) => money(SHIP[k].fee);
  switch (intent) {
    case 'greet':
      return 'Chào bạn! Mình là Keeby 🤖 — trợ lý của KeebHub. Mình có thể gợi ý switch/keycap/kit theo ngân sách, hướng dẫn build & tương thích, kiểm tra đơn hàng, ví, huỷ đơn hoặc trả hàng giúp bạn.';
    case 'thanks':
      return 'Rất vui được hỗ trợ bạn! Cần gì cứ nhắn Keeby nhé 👋';
    case 'order_status': {
      if (!user) return 'Bạn hãy đăng nhập rồi vào mục "Đơn hàng của tôi" (/account/orders) để xem trạng thái và tiến độ gia công nhé.';
      const o = await Order.findOne({ user: user._id }).sort({ createdAt: -1 });
      if (!o) return 'Bạn chưa có đơn hàng nào. Ghé Custom Builder (/builder) để bắt đầu build chiếc phím đầu tiên nhé!';
      const rr = o.returnRequest && o.returnRequest.status ? ` · Yêu cầu trả hàng: ${Order.RETURN_STATUS[o.returnRequest.status].label}` : '';
      return `Đơn gần nhất #${o.code} đang ở trạng thái "${Order.STATUS[o.status].label}" (${Order.PAY[o.paymentStatus].label})${o.isCustom && o.progress.length ? `, tiến độ gia công ${o.progressPercent}%` : ''}${o.shipping && o.shipping.trackingCode ? `, mã vận đơn ${o.shipping.trackingCode}` : ''}${rr}. Xem chi tiết tại /account/orders/${o.code}.`;
    }
    case 'payment': {
      let w = '';
      if (user) { const u = await User.findById(user._id).select('wallet'); w = ` Ví của bạn hiện có ${money(u ? u.wallet : 0)}.`; }
      return `KeebHub hỗ trợ 3 cách thanh toán: VNPay (ATM, Visa/Master, QR), COD (trả tiền khi nhận hàng) và Ví KeebHub (trừ thẳng số dư, chọn được khi ví đủ tiền).${w} Riêng đơn gia công custom không hỗ trợ COD vì là hàng làm riêng. Nếu VNPay lỗi, bạn vào chi tiết đơn bấm "Thanh toán VNPay" để thử lại.`;
    }
    case 'shipping':
      return `Phí giao hàng tính theo từng shop: tiêu chuẩn ${fee('standard')}, hoả tốc ${fee('express')}. Đơn từ ${money(FREE_SHIP_FROM)} mỗi shop được miễn phí ship tiêu chuẩn. Giao toàn quốc; mã vận đơn hiện trong chi tiết đơn khi shop bàn giao vận chuyển.`;
    case 'cancel_refund':
      return 'Bạn tự huỷ được khi đơn còn "Chờ xác nhận" hoặc "Đã xác nhận" (đơn custom: trước khi shop nhận gia công) — vào /account/orders, mở đơn và bấm "Huỷ đơn hàng". Đơn đã thanh toán sẽ được hoàn NGAY toàn bộ số tiền vào Ví KeebHub để dùng cho đơn sau. Lưu ý: tự huỷ quá 3 đơn trong 7 ngày sẽ cần liên hệ shop/admin.';
    case 'return_item': {
      let extra = '';
      if (user) {
        const o = await Order.findOne({ user: user._id, status: { $in: ['delivered', 'completed'] } }).sort({ deliveredAt: -1, createdAt: -1 });
        if (o) extra = ` Đơn đã giao gần nhất của bạn là #${o.code} — mở /account/orders/${o.code} và bấm "Trả hàng / Hoàn tiền".`;
      }
      return `Bạn được yêu cầu trả hàng trong 7 ngày kể từ khi nhận nếu sản phẩm lỗi, giao sai, thiếu hoặc hư hỏng do vận chuyển (không áp dụng đổi ý). Cần chọn lý do, mô tả và kèm ảnh. Shop duyệt trong 72 giờ → bạn gửi hàng về và nhập mã vận đơn → shop xác nhận đã nhận thì tiền hoàn ngay vào Ví KeebHub. Nếu shop từ chối hoặc không phản hồi, bạn được khiếu nại lên sàn.${extra}`;
    }
    case 'wallet': {
      if (!user) return 'Ví KeebHub chứa tiền hoàn từ đơn huỷ / trả hàng và dùng để thanh toán đơn sau (không rút tiền mặt). Bạn đăng nhập rồi vào /account/wallet để xem số dư nhé.';
      const u = await User.findById(user._id).select('wallet');
      return `Ví KeebHub của bạn đang có ${money(u ? u.wallet : 0)}. Số dư dùng để thanh toán đơn tiếp theo (chọn "Ví KeebHub" khi đặt hàng), không rút ra tiền mặt hay chuyển cho tài khoản khác. Lịch sử từng khoản cộng/trừ xem tại /account/wallet.`;
    }
    case 'builder_compat':
    {
      const base = 'Bạn mở Custom Builder (/builder) nhé: 6 bước Kit → Switch → Keycap → Stabilizer → Gói gia công → Xem lại. Hệ thống tự kiểm tra tương thích (số chân switch, kiểu mount stab, layout keycap...) và báo lỗi trước khi đặt; xưởng sẽ lube, cân stab, lắp ráp theo gói bạn chọn.';
      // chỉ kèm linh kiện khi khách nhắc tới loại linh kiện cụ thể
      const part = /switch|keycap|kit|stab|nút|vỏ|case/i.test(text);
      return part && products.length ? base + '\nMột vài linh kiện liên quan:\n' + products.slice(0, 3).map(p => `• ${p.name} — ${money(p.price)}`).join('\n') : base;
    }
    case 'account':
      return 'Quên mật khẩu: vào /auth/forgot để nhận link đặt lại (hiệu lực 30 phút). Đổi mật khẩu / thông tin cá nhân / địa chỉ: mục Hồ sơ cá nhân (/account). Chưa nhận email xác nhận: ở trang đăng nhập bấm "Gửi lại email". Lưu ý: nhập sai mật khẩu 5 lần sẽ bị tạm khoá đăng nhập 15 phút.';
    case 'seller':
      return `Bạn đăng ký mở shop tại /seller/register; quản trị viên duyệt hồ sơ rồi bạn đăng sản phẩm (mỗi sản phẩm mới được sàn kiểm duyệt trước khi hiển thị). Sàn thu phí ${Math.round(PLATFORM_FEE * 100)}% trên mỗi đơn hoàn tất. Shop có thể nhận gia công custom và quản lý đơn, trả hàng, doanh thu trong Kênh người bán (/seller).`;
    case 'contact':
      return 'Bạn liên hệ KeebHub qua hotline 1900 6868 hoặc email letungduong.nvn@gmail.com nhé. Vấn đề về đơn hàng cụ thể, bạn có thể nhắn mã đơn để mình kiểm tra trước.';
    case 'other':
      return 'Câu này nằm ngoài phạm vi của mình rồi 😅 Keeby chỉ hỗ trợ về KeebHub: tìm bàn phím/linh kiện, build & tương thích, đơn hàng, thanh toán, ví, huỷ đơn, trả hàng.';
    case 'find_product':
    default:
      if (products.length) return `Mình tìm được ${products.length} sản phẩm phù hợp:\n` + products.slice(0, 4).map(p => `• ${p.name} — ${money(p.price)}`).join('\n') + '\nBấm vào thẻ bên dưới để xem chi tiết nhé.';
      if (intent === 'find_product') return 'Mình chưa tìm thấy sản phẩm khớp. Bạn nói rõ hơn loại linh kiện và ngân sách nhé, ví dụ "switch linear dưới 300k", "kit 75% tầm 2 triệu" — hoặc xem tất cả tại /search.';
      return 'Mình chưa hiểu rõ ý bạn. Bạn thử hỏi: "switch linear dưới 500k", "đơn hàng của tôi tới đâu rồi", "ví còn bao nhiêu tiền", "muốn trả hàng lỗi" hoặc "thanh toán thế nào?"';
  }
}

const SHOW_CARDS = new Set(['find_product', 'builder_compat']);
const PART_WORD = /switch|keycap|kit|stab|nút|vỏ|case|cáp|kê tay/i;
async function chat(user, messages) {
  const history = (Array.isArray(messages) ? messages : []).filter(m => m && typeof m === 'object' && m.content).slice(-10).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 1500) }));
  const last = history.length ? history[history.length - 1].content : '';
  // 1) Mô hình học máy đoán ý định của câu hỏi
  const pi = intentModel.predict(last);
  const intent = pi.known ? pi.intent : null;
  // 2) Lấy dữ liệu thật từ CSDL
  const { ctx, products } = await buildContext(user, last);
  const cards = (intent === 'find_product' || (SHOW_CARDS.has(intent) && PART_WORD.test(last)) || (!intent && products.length) ? products : []).slice(0, 4).map(p => ({ name: p.name, price: money(p.price), url: `/p/${p.slug}`, image: p.image }));
  const system = `${SYSTEM}\n\nÝ định của khách (mô hình phân loại dự đoán): ${intent || 'chưa rõ'}.\n\n${ctx}`;
  // 3) Có API AI → AI viết câu trả lời; không có / lỗi → trả lời theo ý định
  let reply, engine = 'intent';
  try {
    if (process.env.GEMINI_API_KEY) { reply = await callGemini(system, history); engine = 'gemini'; }
    else if (process.env.ANTHROPIC_API_KEY) { reply = await callClaude(system, history); engine = 'claude'; }
  } catch (e) {
    console.error('[AI]', e.message);
  }
  if (!reply) { engine = 'intent'; reply = await ruleBased(user, last, products, intent); }
  return { reply, products: cards, engine, intent: { name: pi.intent, confidence: Math.round(pi.confidence * 1000) / 1000, used: intent } };
}

module.exports = { chat };
