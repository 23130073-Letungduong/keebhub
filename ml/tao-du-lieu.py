# -*- coding: utf-8 -*-
"""
Tạo tập dữ liệu huấn luyện cho mô hình phân loại ý định (intent) của chatbot Keeby.

Chạy:  python ml/tao-du-lieu.py      →  ml/data/intents.csv  (text,intent)

Cách tạo: mỗi ý định có nhiều MẪU CÂU + từ đồng nghĩa (slot), rồi "làm nhiễu" giống cách
khách gõ thật: bỏ dấu, viết tắt (ko, k, dc, sp, ntn...), thêm "shop ơi / ad ơi / ạ / nhé".
Tập KIỂM TRA (ml/data/intents_test.csv) được viết TAY riêng, không sinh từ các mẫu này,
để đo độ chính xác trung thực.
"""
import csv, random, re, unicodedata, itertools, os

random.seed(2026)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'intents.csv')

# ---------------- slot dùng chung ----------------
PART = ['switch', 'keycap', 'kit', 'kit bàn phím', 'stab', 'stabilizer', 'bàn phím', 'phím cơ', 'cáp', 'dây cáp', 'switch linear', 'switch tactile',
        'switch clicky', 'keycap pbt', 'keycap cherry profile', 'kit nhôm', 'kit 65%', 'kit 75%', 'bàn phím tkl', 'phím full size', 'kê tay', 'switch gateron',
        'switch akko', 'keycap gmk', 'kit gasket', 'bộ phím 60%', 'phím hotswap']
BUDGET = ['dưới 500k', 'tầm 1 triệu', 'khoảng 2tr', 'dưới 300k', 'tầm 150k', 'dưới 1 triệu', 'khoảng 800k', 'tầm 3 triệu', 'rẻ rẻ', 'giá sinh viên', 'dưới 200 nghìn', '']
USE = ['để gõ văn bản', 'chơi game', 'gõ êm', 'gõ cho đã tay', 'làm văn phòng', 'lập trình', 'tiếng thocky', 'tiếng lách cách', 'nhẹ tay', '']

T = {}
T['greet'] = ['xin chào', 'chào shop', 'chào bạn', 'hello', 'hi', 'alo', 'chào ad', 'hey keeby', 'chào buổi sáng', 'có ai không', 'shop ơi',
              'chào em', 'hế lô', 'helo shop', 'chào keeby nhé', 'ê bot', 'bạn là ai', 'bạn là ai vậy', 'bạn làm được gì', 'keeby là gì', 'bạn giúp được gì cho mình',
              'có ai trực không', 'chào nha', 'hi bạn', 'xin chào keebhub']
T['thanks'] = ['cảm ơn', 'cảm ơn bạn', 'cám ơn shop nhiều', 'thanks', 'thank you', 'ok cảm ơn', 'oke thanks nha', 'tks', 'cảm ơn nhé', 'được rồi cảm ơn',
               'tạm biệt', 'bye', 'bai bai', 'ok mình hiểu rồi', 'hay quá cảm ơn', 'cảm ơn đã hỗ trợ', 'thế thôi nhé', 'oke', 'ok nha', 'cám ơn keeby',
               'tuyệt vời cảm ơn', 'mình biết rồi thanks', 'vậy là xong cảm ơn']
T['find_product'] = ['tìm {p} {b}', 'gợi ý {p} {b}', 'có {p} nào {b} không', 'tư vấn {p} {u}', 'mình muốn mua {p} {b}', 'cho xem {p} {b}',
                     '{p} nào tốt {u}', '{p} nào đáng mua nhất', 'nên mua {p} gì {b}', 'có bán {p} không', 'shop có {p} không', '{p} giá bao nhiêu',
                     'giới thiệu {p} {u}', 'cần {p} {u} {b}', 'mua {p} ở đâu', 'list {p} {b}', 'có {p} nào hot không', '{p} bán chạy nhất',
                     'tìm giúp {p} {u}', 'recommend {p} {b}', 'đề xuất {p} {u}', '{p} {b} có không', 'còn hàng {p} không', 'mẫu {p} mới nhất',
                     'so sánh các loại {p}', '{p} nào hợp {u}', 'chọn {p} thế nào {u}']
T['order_status'] = ['đơn hàng của tôi tới đâu rồi', 'kiểm tra đơn hàng', 'đơn của mình đang ở đâu', 'bao giờ đơn tới', 'theo dõi đơn hàng', 'trạng thái đơn hàng',
                     'đơn {c} sao rồi', 'xem tình trạng đơn', 'đơn mình đã giao chưa', 'shop đã xác nhận đơn chưa', 'khi nào nhận được hàng', 'hàng giao chưa',
                     'tra cứu đơn', 'đơn gia công tới bước nào rồi', 'tiến độ gia công phím của mình', 'build của mình làm tới đâu rồi', 'mã vận đơn là gì',
                     'đơn đang ở trạng thái nào', 'sao đơn chưa được xác nhận', 'đơn hàng gần nhất của tôi', 'kiểm tra giúp đơn {c}', 'đơn bị kẹt à',
                     'shipper giao chưa', 'xem lịch sử mua hàng', 'đơn của tôi bao giờ giao']
T['payment'] = ['thanh toán như thế nào', 'có những hình thức thanh toán nào', 'trả tiền bằng cách nào', 'thanh toán vnpay được không', 'có cod không',
                'có thanh toán khi nhận hàng không', 'quẹt thẻ được không', 'thanh toán bằng thẻ atm', 'chuyển khoản được không', 'quét mã qr thanh toán',
                'thanh toán visa được không', 'thanh toán bằng ví keebhub được không', 'dùng ví để trả tiền đơn hàng', 'đơn custom có cod không',
                'sao không chọn được cod', 'thanh toán lỗi thì sao', 'thanh toán vnpay bị lỗi', 'trả góp được không', 'thanh toán online có an toàn không',
                'thanh toán xong chưa thấy cập nhật', 'trả tiền sau được không', 'momo được không', 'thanh toán bằng gì']
T['shipping'] = ['phí ship bao nhiêu', 'phí vận chuyển thế nào', 'có miễn phí ship không', 'freeship không', 'ship về {city} bao nhiêu', 'giao hàng mất mấy ngày',
                 'có giao hoả tốc không', 'ship hoả tốc giá sao', 'giao hàng toàn quốc không', 'đơn bao nhiêu thì free ship', 'phí ship mỗi shop tính sao',
                 'giao bằng đơn vị nào', 'có giao tận nhà không', 'ship có nhanh không', 'tiền ship tính thế nào', 'mua 2 shop có tính 2 lần phí ship không',
                 'ship tiêu chuẩn giá bao nhiêu', 'vận chuyển bằng gì', 'có ship ra {city} không', 'phí giao hàng']
T['cancel_refund'] = ['huỷ đơn thế nào', 'làm sao để huỷ đơn', 'tôi muốn huỷ đơn hàng', 'huỷ đơn được không', 'đặt nhầm muốn huỷ', 'huỷ đơn có mất phí không',
                      'huỷ đơn thì tiền hoàn về đâu', 'huỷ đơn bao lâu được hoàn tiền', 'sao không huỷ được đơn', 'đơn đã thanh toán huỷ có được hoàn không',
                      'shop huỷ đơn của tôi thì sao', 'hoàn tiền khi huỷ đơn', 'đơn custom huỷ được không', 'muốn huỷ đơn gia công', 'bỏ đơn được không',
                      'không muốn mua nữa huỷ sao', 'tôi đổi ý muốn huỷ', 'huỷ đơn vnpay có hoàn tiền không', 'nút huỷ đơn ở đâu', 'đơn bị huỷ tiền đi đâu',
                      'huỷ nhiều đơn có sao không']
T['return_item'] = ['trả hàng thế nào', 'muốn trả hàng', 'đổi trả ra sao', 'chính sách đổi trả', 'hàng bị lỗi thì làm sao', 'phím bị liệt nút muốn trả',
                    'giao sai hàng thì sao', 'giao nhầm switch', 'nhận được hàng bị móp', 'hàng bị vỡ khi vận chuyển', 'thiếu phụ kiện trong hộp',
                    'thiếu keycap', 'trả hàng được hoàn tiền không', 'mấy ngày được trả hàng', 'hàng lỗi có được đổi không', 'bảo hành thế nào',
                    'không thích nữa trả được không', 'shop không đồng ý trả hàng', 'khiếu nại shop', 'shop từ chối trả hàng thì sao', 'gửi hàng trả về ở đâu',
                    'trả hàng cần những gì', 'phím không lên đèn muốn đổi', 'switch bị kẹt muốn trả lại', 'khiếu nại lên sàn thế nào']
T['wallet'] = ['ví keebhub là gì', 'số dư ví của tôi', 'ví còn bao nhiêu tiền', 'xem số dư', 'tiền trong ví dùng làm gì', 'rút tiền từ ví được không',
               'nạp tiền vào ví', 'ví keebhub ở đâu', 'lịch sử giao dịch ví', 'sao ví có tiền', 'ví của mình bao nhiêu', 'kiểm tra ví', 'số dư tài khoản',
               'tiền hoàn trong ví rút ra ngân hàng được không', 'ví có hết hạn không', 'chuyển tiền ví cho bạn được không', 'ví bị trừ tiền',
               'tiền ví dùng mua hàng được không', 'xem ví']
T['builder_compat'] = ['custom builder là gì', 'build phím thế nào', 'muốn build bàn phím', 'tự lắp phím được không', 'switch {s} có lắp vừa kit {l} không',
                       'keycap này có hợp kit {l} không', 'kiểm tra tương thích', 'switch 3 pin lắp mạch 5 pin được không', 'stab plate mount hay pcb mount',
                       'kit {l} dùng keycap gì', 'nhờ shop lube switch', 'gói gia công gồm những gì', 'lube switch giá bao nhiêu', 'đặt build custom',
                       'lắp ráp giúp mình được không', 'hàn mạch có không', 'build mất bao lâu', 'cấu hình phím chơi game', 'phối phím custom',
                       'linh kiện có tương thích không', 'chọn switch cho kit {l}', 'kit hotswap là gì', 'gasket mount là gì', 'xưởng gia công nào uy tín',
                       'lưu cấu hình build', 'sửa lại build đã lưu']
T['account'] = ['quên mật khẩu', 'đổi mật khẩu thế nào', 'không đăng nhập được', 'đăng ký tài khoản', 'tạo tài khoản', 'không nhận được email xác nhận',
                'gửi lại email xác nhận', 'đăng nhập bằng google', 'đăng nhập facebook được không', 'tài khoản bị khoá', 'đổi số điện thoại', 'sửa địa chỉ nhận hàng',
                'đổi email được không', 'xoá tài khoản', 'cập nhật thông tin cá nhân', 'đổi ảnh đại diện', 'sao bị đăng xuất', 'link đặt lại mật khẩu hết hạn',
                'nhập sai mật khẩu bị khoá', 'đăng nhập bằng số điện thoại']
T['seller'] = ['muốn mở shop', 'đăng ký bán hàng', 'làm người bán thế nào', 'bán hàng trên keebhub', 'mở gian hàng', 'phí sàn bao nhiêu', 'shop thu phí gì',
               'đăng sản phẩm lên bán', 'bao lâu shop được duyệt', 'trở thành người bán', 'muốn hợp tác bán phím', 'kênh người bán ở đâu',
               'nhận gia công trên sàn', 'sản phẩm bị từ chối duyệt', 'đăng ký xưởng gia công', 'bán switch trên sàn được không', 'shop của tôi bị khoá']
T['contact'] = ['gặp nhân viên', 'cho mình nói chuyện với người thật', 'hotline là gì', 'số điện thoại shop', 'liên hệ admin', 'email hỗ trợ', 'tư vấn viên đâu',
                'gọi cho ai', 'cần hỗ trợ gấp', 'liên hệ chăm sóc khách hàng', 'địa chỉ cửa hàng', 'shop ở đâu', 'làm việc giờ nào', 'có cửa hàng offline không',
                'cho xin số zalo', 'nói chuyện với quản trị viên', 'báo lỗi web']
T['other'] = ['thời tiết hôm nay thế nào', 'kể chuyện cười đi', 'giải bài toán này giúp', 'viết code python', 'hôm nay ăn gì', 'bóng đá tối nay',
              'giá vàng hôm nay', 'bạn có người yêu chưa', 'dịch sang tiếng anh', 'làm thơ đi', 'mấy giờ rồi', 'tỉ giá đô', 'cách nấu phở', 'chơi game gì vui',
              'phim gì hay', 'bạn bao nhiêu tuổi', 'hát một bài đi', 'tin tức hôm nay', 'giải thích thuyết tương đối', 'làm bài tập tiếng anh giúp',
              'asdfgh', 'lol', 'mua điện thoại iphone', 'bán laptop không', 'ăn cơm chưa', 'chuyện tình cảm', 'xổ số hôm nay', 'đặt vé máy bay',
              'cách giảm cân', 'học lập trình ở đâu', 'mua chuột gaming', 'tai nghe nào tốt']

SLOTS = {'p': PART, 'b': BUDGET, 'u': USE, 'c': ['KH-1234567', '#KH-0012345', 'của em', 'hôm qua', 'mới đặt', ''],
         'city': ['Hà Nội', 'Đà Nẵng', 'Cần Thơ', 'TP.HCM', 'Huế', 'Hải Phòng', 'tỉnh'],
         's': ['linear', '3 pin', '5 pin', 'gateron', 'kailh box', 'akko'], 'l': ['65%', '75%', 'tkl', '60%', 'full', 'gasket']}

PRE = ['', '', '', 'shop ơi ', 'ad ơi ', 'cho mình hỏi ', 'bạn ơi ', 'cho em hỏi ', 'mình muốn hỏi ', 'keeby ơi ', 'xin hỏi ']
SUF = ['', '', '', ' ạ', ' vậy', ' nhé', '?', ' ạ?', ' vậy shop', ' với', ' nha', ' thế']
TEEN = [(r'\bkhông\b', ['ko', 'k', 'không', 'hông']), (r'\bđược\b', ['dc', 'đc', 'được']), (r'\bsản phẩm\b', ['sp', 'sản phẩm']),
        (r'\bnhư thế nào\b', ['ntn', 'như thế nào']), (r'\bbao nhiêu\b', ['bn', 'bao nhiêu', 'bnh']), (r'\bmình\b', ['mk', 'mình', 'mik']),
        (r'\bthế nào\b', ['tn', 'thế nào', 'sao']), (r'\btriệu\b', ['tr', 'triệu']), (r'\bhuỷ\b', ['hủy', 'huỷ']), (r'\bvậy\b', ['v', 'vậy', 'zậy'])]


def strip_accents(s):
    s = unicodedata.normalize('NFD', s)
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    return s.replace('đ', 'd').replace('Đ', 'D')


def fill(tpl):
    keys = re.findall(r'\{(\w+)\}', tpl)
    if not keys:
        return [tpl]
    combos = list(itertools.product(*[SLOTS[k] for k in keys]))
    random.shuffle(combos)
    out = []
    for combo in combos[:14]:
        s = tpl
        for k, v in zip(keys, combo):
            s = s.replace('{' + k + '}', v, 1)
        out.append(re.sub(r'\s+', ' ', s).strip())
    return out


def noisy(s, n=3):
    variants = {s}
    for _ in range(n):
        x = random.choice(PRE) + s + random.choice(SUF)
        for pat, reps in TEEN:
            if re.search(pat, x) and random.random() < 0.6:
                x = re.sub(pat, random.choice(reps), x)
        if random.random() < 0.4:
            x = strip_accents(x)
        if random.random() < 0.2:
            x = x.capitalize()
        variants.add(re.sub(r'\s+', ' ', x).strip())
    return variants


MAX_PER_INTENT = 300  # cân bằng số câu giữa các ý định
rows = []
for intent, tpls in T.items():
    bases = [b for tpl in tpls for b in fill(tpl)]
    n = max(3, round(260 / len(bases)))          # ý định ít mẫu → sinh nhiều biến thể hơn
    got = sorted({v for b in bases for v in noisy(b, n)})
    random.shuffle(got)
    rows += [(v, intent) for v in got[:MAX_PER_INTENT]]

# Loại bỏ mọi câu trùng với tập kiểm tra viết tay → đo độ chính xác trung thực (không "học trước đề")
TEST = os.path.join(os.path.dirname(OUT), 'intents_test.csv')
if os.path.exists(TEST):
    with open(TEST, encoding='utf-8') as f:
        test_texts = {r['text'].strip().lower() for r in csv.DictReader(f)}
    rows = [r for r in rows if r[0].strip().lower() not in test_texts]
rows = sorted(set(rows))
random.shuffle(rows)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['text', 'intent'])
    w.writerows(rows)

from collections import Counter
print('Đã tạo', len(rows), 'câu →', OUT)
for k, n in sorted(Counter(i for _, i in rows).items()):
    print(f'  {k:15s} {n}')
