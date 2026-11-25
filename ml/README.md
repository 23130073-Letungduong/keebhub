# Mô hình phân loại ý định cho chatbot Keeby

Keeby dùng một mô hình **học máy tự huấn luyện** để hiểu khách đang hỏi gì, rồi web lấy **dữ liệu thật** trong CSDL (sản phẩm, đơn hàng, số dư ví) để trả lời.

```
Câu hỏi ──► Mô hình ý định (utils/intent.js) ──► ý định + độ tin cậy
                                                   │
             Dữ liệu thật từ MongoDB ◄─────────────┘ (sản phẩm, đơn, ví…)
                                                   │
      Có API AI (Gemini/Claude)? ── có ──► AI viết câu trả lời từ dữ liệu thật (biết thêm ý định)
                                  └ không ► Câu trả lời theo ý định + dữ liệu thật (utils/ai.js)
```

## 14 ý định

| Mã | Ý nghĩa | Ví dụ |
|---|---|---|
| greet | Chào hỏi | "chào shop", "bạn là ai" |
| thanks | Cảm ơn / tạm biệt | "ok tks", "bye" |
| find_product | Tìm / gợi ý sản phẩm | "switch linear dưới 300k" |
| order_status | Hỏi đơn hàng | "đơn của mình tới đâu rồi" |
| payment | Thanh toán | "có cod không", "trả bằng ví được không" |
| shipping | Phí ship / giao hàng | "phí ship bn" |
| cancel_refund | Huỷ đơn & hoàn tiền | "huỷ đơn thì tiền về đâu" |
| return_item | Trả hàng / hàng lỗi | "phím bị liệt muốn trả" |
| wallet | Ví KeebHub | "ví còn bao nhiêu tiền" |
| builder_compat | Build, tương thích, gia công | "kit 65% dùng keycap gì" |
| account | Tài khoản, mật khẩu | "quên mật khẩu" |
| seller | Mở shop, bán hàng | "phí sàn bao nhiêu" |
| contact | Liên hệ người thật | "hotline là gì" |
| other | Ngoài phạm vi | "thời tiết hôm nay" |

## Mô hình
- **Đặc trưng:** từ, cặp từ liền nhau, từ không dấu, n-gram ký tự 3–5 (không dấu) → hiểu câu **không dấu, viết tắt, sai chính tả nhẹ**.
- **TF-IDF** (tf dạng log, chuẩn hoá L2) + **Hồi quy Logistic đa lớp** (softmax), `class_weight=balanced`.
- Trọng số: `keeby-intent.json` (~770 KB, ~5.900 đặc trưng). Chạy bằng JavaScript thuần, ~0,1 ms/câu, không cần GPU hay Python khi chạy web.
- Độ tin cậy < 0,45 → coi là "chưa hiểu", Keeby trả lời gợi ý cách hỏi.

## Dữ liệu
- `data/intents.csv` — **3.816 câu huấn luyện**, sinh bằng `tao-du-lieu.py` từ mẫu câu + từ đồng nghĩa, rồi làm nhiễu như người gõ thật (bỏ dấu, "ko/dc/bn/sp", "shop ơi… ạ").
- `data/intents_test.csv` — **161 câu kiểm tra viết tay riêng**, không trùng câu nào với dữ liệu huấn luyện (có bài test kiểm tra điều này).

## Kết quả (25/11/2026)
- Độ chính xác trên tập kiểm tra viết tay: **96,9 %** (156/161). Ma trận nhầm lẫn: `confusion_matrix.png`.
- Trên 20 % dữ liệu sinh tách riêng: 99,9 % (dễ hơn vì cùng kiểu câu — chỉ dùng tham khảo).
- Bản JavaScript cho kết quả giống hệt scikit-learn trên 221 câu mẫu (`data/parity.json`).

## Huấn luyện lại trên Google Colab
1. Mở https://colab.research.google.com → *Upload* → chọn `ml/Keeby_Intent_Colab.ipynb`.
2. *Runtime → Run all* (không cần GPU). Khi được hỏi, tải lên `ml/data/intents.csv` và `ml/data/intents_test.csv`.
3. Chạy xong trình duyệt tải về `keeby-intent.json`, `parity.json`, `confusion_matrix.png`.
4. Chép `keeby-intent.json` vào `ml/`, `parity.json` vào `ml/data/` → khởi động lại web → chạy `npm run test:keeby`.

Muốn thêm câu / ý định mới: sửa `tao-du-lieu.py` → `python ml/tao-du-lieu.py` → huấn luyện lại như trên.
Huấn luyện ngay trên máy (cần Python + `pip install scikit-learn`): `npm run train:keeby`.
