# -*- coding: utf-8 -*-
"""
Huấn luyện mô hình phân loại ý định (intent) cho chatbot Keeby.
(Notebook Colab ml/Keeby_Intent_Colab.ipynb chạy ĐÚNG đoạn mã này — file .py để chạy được cả trên máy.)

Mô hình: TF-IDF (từ + cặp từ + n-gram ký tự không dấu)  →  Hồi quy Logistic đa lớp (softmax)
 - Nhẹ (vài trăm KB), chạy tức thì bằng JavaScript trong web (utils/intent.js), không cần GPU / Python khi chạy web.
 - Hiểu được câu gõ không dấu, viết tắt, sai chính tả nhẹ nhờ n-gram ký tự.

Chạy:  pip install scikit-learn
       python ml/train_intent.py
Ra:    ml/keeby-intent.json   (trọng số — web đọc file này)
       ml/data/parity.json    (kết quả dự đoán mẫu để kiểm tra bản JavaScript cho kết quả giống hệt Python)
"""
import csv, json, math, os, unicodedata, datetime, random
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import train_test_split

HERE = os.path.dirname(os.path.abspath(__file__))
TRAIN = os.path.join(HERE, 'data', 'intents.csv')
TEST = os.path.join(HERE, 'data', 'intents_test.csv')
OUT = os.path.join(HERE, 'keeby-intent.json')
PARITY = os.path.join(HERE, 'data', 'parity.json')
THRESHOLD = 0.45   # độ tin cậy thấp hơn mức này → coi là "chưa hiểu", web dùng cách trả lời dự phòng


# ---------- Trích đặc trưng: PHẢI giống hệt hàm features() trong utils/intent.js ----------
def normalize(s):
    s = unicodedata.normalize('NFC', str(s)).lower()
    s = ''.join(ch if (ch.isalnum() or ch == '%' or ch.isspace()) else ' ' for ch in s)
    return ' '.join(s.split())


def strip_accents(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    return s.replace('đ', 'd')


def features(text):
    t = normalize(text)
    words = t.split()
    plain = strip_accents(t).split()
    out = ['w:' + w for w in words]                                       # từ có dấu
    out += ['b:' + a + '_' + b for a, b in zip(words, words[1:])]         # cặp từ liền nhau
    out += ['a:' + w for w in plain]                                      # từ không dấu
    for w in plain:                                                        # n-gram ký tự 3..5 (không dấu)
        p = ' ' + w + ' '
        for n in (3, 4, 5):
            out += ['c:' + p[i:i + n] for i in range(len(p) - n + 1)]
    return out


def read(path):
    with open(path, encoding='utf-8') as f:
        r = list(csv.DictReader(f))
    return [x['text'] for x in r], [x['intent'] for x in r]


def softmax_predict(model, text):
    """Suy luận từ file JSON đã xuất (giống cách utils/intent.js làm) — dùng để đối chiếu."""
    vocab, idf, coef, b = model['vocab'], model['idf'], model['coef'], model['intercept']
    tf = {}
    for f in features(text):
        if f in vocab:
            tf[vocab[f]] = tf.get(vocab[f], 0) + 1
    vec = {i: (1 + math.log(c)) * idf[i] for i, c in tf.items()}
    norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
    scores = [b[k] + sum(coef[k][i] * v / norm for i, v in vec.items()) for k in range(len(b))]
    m = max(scores)
    e = [math.exp(s - m) for s in scores]
    z = sum(e)
    return [x / z for x in e]


def main():
    X, y = read(TRAIN)
    Xt, yt = read(TEST)
    print(f'Dữ liệu huấn luyện: {len(X)} câu, {len(set(y))} ý định · Tập kiểm tra viết tay: {len(Xt)} câu')

    vec = TfidfVectorizer(analyzer=features, sublinear_tf=True, min_df=2, norm='l2', smooth_idf=True)
    clf = LogisticRegression(C=8, max_iter=3000, class_weight='balanced')

    # 1) Kiểm tra nội bộ: tách 20% dữ liệu sinh ra để đo
    Xa, Xb, ya, yb = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    clf.fit(vec.fit_transform(Xa), ya)
    print('Độ chính xác trên 20% dữ liệu tách riêng:', round(accuracy_score(yb, clf.predict(vec.transform(Xb))), 4))

    # 2) Huấn luyện lại trên toàn bộ dữ liệu, đo trên tập viết tay (thước đo chính)
    clf.fit(vec.fit_transform(X), y)
    pred = clf.predict(vec.transform(Xt))
    acc = accuracy_score(yt, pred)
    print('ĐỘ CHÍNH XÁC TRÊN TẬP KIỂM TRA VIẾT TAY:', round(acc, 4))
    print(classification_report(yt, pred, digits=3, zero_division=0))
    labels = list(clf.classes_)
    cm = confusion_matrix(yt, pred, labels=labels)
    print('Ma trận nhầm lẫn (hàng = đúng, cột = dự đoán):')
    print(' ' * 15 + ' '.join(l[:5].rjust(5) for l in labels))
    for l, row in zip(labels, cm):
        print(l[:14].ljust(15) + ' '.join(str(v).rjust(5) for v in row))
    wrong = [(t, a, p) for t, a, p in zip(Xt, yt, pred) if a != p]
    if wrong:
        print('\nCâu đoán sai:')
        for t, a, p in wrong:
            print(f'  "{t}"  đúng={a}  đoán={p}')

    # 3) Xuất trọng số: bỏ đặc trưng gần như không ảnh hưởng, làm tròn 4 chữ số → file nhỏ
    coef = clf.coef_
    vocab_items = sorted(vec.vocabulary_.items(), key=lambda kv: kv[1])
    keep = [i for _, i in vocab_items if np.abs(coef[:, i]).max() >= 0.02]
    remap = {old: new for new, old in enumerate(keep)}
    model = {
        'name': 'keeby-intent', 'version': 1,
        'trainedAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
        'algorithm': 'TF-IDF (word 1-2gram + char 3-5gram, sublinear tf, l2) + Logistic Regression (softmax)',
        'trainSize': len(X), 'testSize': len(Xt), 'testAccuracy': round(float(acc), 4),
        'threshold': THRESHOLD,
        'classes': labels,
        'vocab': {f: remap[i] for f, i in vocab_items if i in remap},
        'idf': [round(float(vec.idf_[i]), 5) for i in keep],
        'coef': [[round(float(coef[k, i]), 4) for i in keep] for k in range(len(labels))],
        'intercept': [round(float(v), 5) for v in clf.intercept_],
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(model, f, ensure_ascii=False, separators=(',', ':'))
    print(f'\nĐã lưu trọng số: {OUT} ({os.path.getsize(OUT) // 1024} KB, {len(keep)} đặc trưng)')

    # 4) Đối chiếu: suy luận từ JSON (đã làm tròn) phải ra cùng nhãn với scikit-learn
    same = 0
    parity = []
    samples = Xt + random.Random(1).sample(X, 60)
    skl = clf.predict(vec.transform(samples))
    for t, sp in zip(samples, skl):
        pr = softmax_predict(model, t)
        k = int(np.argmax(pr))
        same += labels[k] == sp
        parity.append({'text': t, 'intent': labels[k], 'prob': round(pr[k], 6)})
    print(f'Suy luận từ file JSON khớp scikit-learn: {same}/{len(samples)}')
    with open(PARITY, 'w', encoding='utf-8') as f:
        json.dump(parity, f, ensure_ascii=False, indent=0)


if __name__ == '__main__':
    main()
