const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const dir = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dir),
  filename: (req, file, cb) => {
    // Đuôi file lấy theo loại ảnh đã kiểm tra, KHÔNG theo tên gốc (chặn up "anh.html" giả làm ảnh → chạy mã độc)
    const ext = EXT[file.mimetype] || '.jpg';
    cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext);
  }
});

module.exports = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    const okExt = /\.(png|jpe?g|webp|gif)$/i.test(file.originalname || '');
    if (/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype) && okExt) cb(null, true);
    else cb(Object.assign(new Error('Chỉ chấp nhận ảnh PNG, JPG, WEBP, GIF'), { isUploadError: true }));
  }
});
