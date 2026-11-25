// Mô hình phân loại ý định (intent) của chatbot Keeby — chạy bằng JavaScript thuần, không cần thư viện.
// Trọng số được huấn luyện trên Google Colab (ml/Keeby_Intent_Colab.ipynb) rồi lưu ở ml/keeby-intent.json.
//
// Thuật toán suy luận (giống hệt scikit-learn lúc huấn luyện):
//   1. Trích đặc trưng: từ, cặp từ, từ không dấu, n-gram ký tự 3..5 (không dấu)
//   2. TF-IDF: (1 + ln(số lần xuất hiện)) × idf, chuẩn hoá độ dài vector = 1
//   3. Điểm từng ý định = trọng số · vector + hệ số chặn  →  softmax ra xác suất
const fs = require('fs');
const path = require('path');

const MODEL_FILE = path.join(__dirname, '..', 'ml', 'keeby-intent.json');
let model = null;
function load() {
  if (model === null) {
    try { model = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8')); } catch (e) { console.error('[Keeby] Không đọc được mô hình ý định:', e.message); model = false; }
  }
  return model;
}

// ---------- trích đặc trưng: PHẢI giống hàm features() trong ml/train_intent.py ----------
function normalize(s) {
  return String(s || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}%\s]/gu, ' ').split(/\s+/).filter(Boolean).join(' ');
}
function stripAccents(s) {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '').replace(/đ/g, 'd');
}
function features(text) {
  const t = normalize(text);
  const words = t ? t.split(' ') : [];
  const plain = t ? stripAccents(t).split(' ').filter(Boolean) : [];
  const out = words.map(w => 'w:' + w);
  for (let i = 0; i + 1 < words.length; i++) out.push('b:' + words[i] + '_' + words[i + 1]);
  for (const w of plain) out.push('a:' + w);
  for (const w of plain) {
    const p = ' ' + w + ' ';
    const chars = Array.from(p); // tách theo ký tự Unicode (giống Python)
    for (const n of [3, 4, 5]) for (let i = 0; i + n <= chars.length; i++) out.push('c:' + chars.slice(i, i + n).join(''));
  }
  return out;
}

// Trả về { intent, confidence, probs, known } — known=false khi độ tin cậy thấp (dùng cách trả lời dự phòng)
function predict(text) {
  const m = load();
  if (!m) return { intent: null, confidence: 0, probs: {}, known: false };
  const tf = new Map();
  for (const f of features(text)) {
    const i = m.vocab[f];
    if (i !== undefined) tf.set(i, (tf.get(i) || 0) + 1);
  }
  const vec = [];
  let norm = 0;
  for (const [i, c] of tf) { const v = (1 + Math.log(c)) * m.idf[i]; vec.push([i, v]); norm += v * v; }
  norm = Math.sqrt(norm) || 1;
  const scores = m.intercept.map((b, k) => { let s = b; for (const [i, v] of vec) s += m.coef[k][i] * v / norm; return s; });
  const max = Math.max(...scores);
  const exp = scores.map(s => Math.exp(s - max));
  const z = exp.reduce((a, b) => a + b, 0);
  const probs = {};
  m.classes.forEach((c, k) => { probs[c] = exp[k] / z; });
  let best = 0;
  for (let k = 1; k < scores.length; k++) if (scores[k] > scores[best]) best = k;
  const confidence = exp[best] / z;
  return { intent: m.classes[best], confidence, probs, known: tf.size > 0 && confidence >= (m.threshold || 0.45) };
}

function info() {
  const m = load();
  return m ? { name: m.name, trainedAt: m.trainedAt, testAccuracy: m.testAccuracy, classes: m.classes, features: m.idf.length } : null;
}

module.exports = { predict, features, normalize, info };
