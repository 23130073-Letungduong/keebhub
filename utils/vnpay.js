// Tích hợp cổng thanh toán VNPay (sandbox) — phiên bản API 2.1.0
// Tài liệu: https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html
const crypto = require('crypto');

function pad(n) { return String(n).padStart(2, '0'); }
function vnTime(d = new Date()) {
  // VNPay yêu cầu giờ GMT+7, định dạng yyyyMMddHHmmss
  const t = new Date(d.getTime() + (7 * 60 + d.getTimezoneOffset()) * 60000);
  return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
}

// Sắp xếp key và encode giống demo chính thức của VNPay (space -> '+')
function buildQuery(params) {
  return Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k])).replace(/%20/g, '+')}`)
    .join('&');
}
function sign(data, secret) {
  return crypto.createHmac('sha512', secret).update(Buffer.from(data, 'utf-8')).digest('hex');
}

function isConfigured() {
  return !!(process.env.VNP_TMNCODE && process.env.VNP_HASHSECRET);
}

function createPaymentUrl({ txnRef, amount, orderInfo, ipAddr, bankCode, createDate }) {
  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: process.env.VNP_TMNCODE,
    vnp_Locale: 'vn',
    vnp_CurrCode: 'VND',
    vnp_TxnRef: txnRef,
    vnp_OrderInfo: orderInfo,
    vnp_OrderType: 'other',
    vnp_Amount: Math.round(amount) * 100,
    vnp_ReturnUrl: process.env.VNP_RETURN_URL || `${process.env.BASE_URL || 'http://localhost:3000'}/payment/vnpay_return`,
    vnp_IpAddr: ipAddr || '127.0.0.1',
    vnp_CreateDate: createDate || vnTime(),
    vnp_ExpireDate: vnTime(new Date(Date.now() + 15 * 60000))
  };
  if (bankCode) params.vnp_BankCode = bankCode;
  const query = buildQuery(params);
  const hash = sign(query, process.env.VNP_HASHSECRET);
  return `${process.env.VNP_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'}?${query}&vnp_SecureHash=${hash}`;
}

// Kiểm tra chữ ký dữ liệu VNPay trả về (return URL và IPN)
function verify(query) {
  const params = { ...query };
  const secureHash = params.vnp_SecureHash;
  delete params.vnp_SecureHash;
  delete params.vnp_SecureHashType;
  const check = sign(buildQuery(params), process.env.VNP_HASHSECRET || '');
  return !!secureHash && secureHash.toLowerCase() === check.toLowerCase();
}

const RESPONSE = {
  '00': 'Giao dịch thành công',
  '07': 'Trừ tiền thành công nhưng giao dịch bị nghi ngờ',
  '09': 'Thẻ/Tài khoản chưa đăng ký InternetBanking',
  '10': 'Xác thực thông tin thẻ/tài khoản không đúng quá 3 lần',
  '11': 'Đã hết hạn chờ thanh toán',
  '12': 'Thẻ/Tài khoản bị khoá',
  '13': 'Sai mật khẩu OTP',
  '24': 'Khách hàng huỷ giao dịch',
  '51': 'Tài khoản không đủ số dư',
  '65': 'Vượt quá hạn mức giao dịch trong ngày',
  '75': 'Ngân hàng thanh toán đang bảo trì',
  '79': 'Nhập sai mật khẩu thanh toán quá số lần quy định',
  '99': 'Lỗi không xác định'
};

// ===== Hoàn tiền qua API VNPay (merchant_webapi, vnp_Command=refund) =====
// Tài liệu: https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr&refund.html
const REFUND_RESPONSE = {
  '00': 'Hoàn tiền thành công',
  '02': 'Mã merchant không hợp lệ hoặc tổng tiền hoàn vượt số tiền gốc',
  '03': 'Dữ liệu gửi sang không đúng định dạng',
  '04': 'Không cho phép hoàn toàn phần sau khi đã hoàn một phần',
  '13': 'Chỉ cho phép hoàn một phần',
  '91': 'Không tìm thấy giao dịch yêu cầu hoàn',
  '93': 'Số tiền hoàn không hợp lệ',
  '94': 'Giao dịch đã được gửi yêu cầu hoàn trước đó',
  '95': 'Giao dịch không thành công bên VNPay, VNPay từ chối xử lý',
  '97': 'Chữ ký không hợp lệ',
  '99': 'Lỗi khác'
};

// full = true → hoàn toàn bộ giao dịch (02), false → hoàn một phần (03)
async function refund({ txnRef, amount, transactionNo, transactionDate, full, createBy, orderInfo, ipAddr }) {
  const p = {
    vnp_RequestId: (Date.now().toString(36) + crypto.randomBytes(6).toString('hex')).slice(0, 32),
    vnp_Version: '2.1.0',
    vnp_Command: 'refund',
    vnp_TmnCode: process.env.VNP_TMNCODE,
    vnp_TransactionType: full ? '02' : '03',
    vnp_TxnRef: txnRef,
    vnp_Amount: Math.round(amount) * 100,
    vnp_TransactionNo: transactionNo || '0',
    vnp_TransactionDate: transactionDate,
    vnp_CreateBy: String(createBy || 'KeebHub').slice(0, 250),
    vnp_CreateDate: vnTime(),
    vnp_IpAddr: ipAddr || '127.0.0.1',
    vnp_OrderInfo: String(orderInfo || 'Hoan tien').slice(0, 250)
  };
  const keys = ['vnp_RequestId', 'vnp_Version', 'vnp_Command', 'vnp_TmnCode', 'vnp_TransactionType', 'vnp_TxnRef', 'vnp_Amount',
    'vnp_TransactionNo', 'vnp_TransactionDate', 'vnp_CreateBy', 'vnp_CreateDate', 'vnp_IpAddr', 'vnp_OrderInfo'];
  p.vnp_SecureHash = sign(keys.map(k => p[k]).join('|'), process.env.VNP_HASHSECRET);
  const url = process.env.VNP_API_URL || 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p), signal: AbortSignal.timeout(20000) });
  const j = await res.json();
  // Kiểm tra chữ ký VNPay trả về
  const rk = ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode',
    'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo'];
  const hashOk = !!j.vnp_SecureHash && sign(rk.map(k => (j[k] == null ? '' : j[k])).join('|'), process.env.VNP_HASHSECRET || '') === String(j.vnp_SecureHash).toLowerCase();
  if (!hashOk) console.warn('[VNPay refund] chữ ký phản hồi không khớp', j.vnp_ResponseCode);
  const code = String(j.vnp_ResponseCode || '99');
  return { ok: code === '00', code, hashOk, requestId: p.vnp_RequestId, transactionNo: j.vnp_TransactionNo, message: REFUND_RESPONSE[code] || j.vnp_Message || 'Lỗi không xác định', raw: j };
}

module.exports = { createPaymentUrl, verify, isConfigured, RESPONSE, REFUND_RESPONSE, refund, vnTime };
