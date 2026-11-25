const router = require('express').Router();
const ai = require('../utils/ai');

// Chat AI hỗ trợ người dùng (Tự chọn 11)
const hits = new Map();
router.post('/chat', async (req, res) => {
  // khách vãng lai không có phiên cố định → tính theo IP; đã đăng nhập → theo tài khoản
  const key = req.user ? 'u' + req.user._id : 'ip' + req.ip;
  const now = Date.now();
  const h = (hits.get(key) || []).filter(t => now - t < 60000);
  if (h.length >= (Number(process.env.CHAT_RATE) || 15)) return res.status(429).json({ reply: 'Bạn hỏi hơi nhanh, đợi mình một chút nhé 😅' });
  h.push(now); hits.set(key, h);
  try {
    const out = await ai.chat(req.user, req.body.messages);
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ reply: 'Xin lỗi, trợ lý đang gặp sự cố. Vui lòng thử lại sau.' });
  }
});

module.exports = router;
