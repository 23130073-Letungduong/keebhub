// Kiểm thử mô hình phân loại ý định của chatbot Keeby (không cần bật web / CSDL)
// Chạy: npm run test:keeby
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const intent = require('../utils/intent');

const ROOT = path.join(__dirname, '..');
const readCsv = f => fs.readFileSync(path.join(ROOT, 'ml', 'data', f), 'utf8').trim().split(/\r?\n/).slice(1).map(l => { const i = l.lastIndexOf(','); return { text: l.slice(0, i).replace(/^"|"$/g, '').replace(/""/g, '"'), intent: l.slice(i + 1) }; });

describe('Mô hình ý định Keeby', () => {
  const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'ml', 'keeby-intent.json'), 'utf8'));
  it('File trọng số hợp lệ: 14 ý định, kích thước ma trận khớp', () => {
    assert.equal(model.classes.length, 14);
    assert.equal(model.coef.length, model.classes.length);
    assert.equal(model.intercept.length, model.classes.length);
    for (const row of model.coef) assert.equal(row.length, model.idf.length);
    assert.equal(Object.keys(model.vocab).length, model.idf.length);
  });
  it('Bản JavaScript cho kết quả GIỐNG HỆT bản Python (scikit-learn) trên 221 câu mẫu', () => {
    const parity = JSON.parse(fs.readFileSync(path.join(ROOT, 'ml', 'data', 'parity.json'), 'utf8'));
    for (const p of parity) {
      const r = intent.predict(p.text);
      assert.equal(r.intent, p.intent, p.text);
      assert.ok(Math.abs(r.confidence - p.prob) < 1e-5, p.text);
    }
  });
  it('Độ chính xác trên tập kiểm tra viết tay (không dùng khi huấn luyện) ≥ 90%', () => {
    const test = readCsv('intents_test.csv');
    const ok = test.filter(t => intent.predict(t.text).intent === t.intent).length;
    assert.ok(ok / test.length >= 0.9, `${ok}/${test.length}`);
  });
  it('Tập kiểm tra không trùng câu nào với tập huấn luyện', () => {
    const train = new Set(readCsv('intents.csv').map(t => t.text.toLowerCase()));
    const dup = readCsv('intents_test.csv').filter(t => train.has(t.text.toLowerCase()));
    assert.deepEqual(dup, []);
  });
  it('Hiểu câu gõ không dấu / viết tắt', () => {
    const cases = { 'chao shop': 'greet', 'vi con bao nhieu tien': 'wallet', 'phi ship bn': 'shipping', 'huy don sao': 'cancel_refund', 'hang bi loi muon tra': 'return_item', 'don toi dau r': 'order_status', 'switch linear duoi 300k': 'find_product', 'quen mat khau': 'account' };
    for (const [q, want] of Object.entries(cases)) assert.equal(intent.predict(q).intent, want, q);
  });
  it('Dữ liệu lạ không gây lỗi; câu vô nghĩa → độ tin cậy thấp (known=false)', () => {
    for (const q of ['', '   ', '😀😀', '!!!???', 'x'.repeat(5000), null, undefined, 12345]) {
      const r = intent.predict(q);
      assert.ok(r && typeof r.confidence === 'number');
    }
    assert.equal(intent.predict('').known, false);
    assert.equal(intent.predict('qqqzzzxxx').known, false);
  });
  it('Đoán nhanh: 1000 câu < 1 giây', () => {
    const t = Date.now();
    for (let i = 0; i < 1000; i++) intent.predict('cho minh hoi switch linear duoi 500k nhe shop');
    assert.ok(Date.now() - t < 1000);
  });
});
