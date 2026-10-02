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

function createPaymentUrl({ txnRef, amount, orderInfo, ipAddr, bankCode }) {
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
    vnp_CreateDate: vnTime(),
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

module.exports = { createPaymentUrl, verify, isConfigured, RESPONSE, vnTime };
