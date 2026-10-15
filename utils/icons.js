// Biểu tượng SVG cho từng loại linh kiện (thay cho emoji không đúng nghĩa)
// Vẽ bằng nét (stroke) theo currentColor → tự ăn màu chữ của khung chứa, dùng được cả chế độ sáng/tối.
const PATHS = {
  // Kit bàn phím: khung phím + các hàng phím + phím cách
  kit: '<rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 13h.01M11 13h.01M14.5 13h.01M18 13h.01M8 15.5h8"/>',
  // Switch cơ: nắp switch, thân switch, chân cắm và lõi chữ thập
  switch: '<path d="M12 2.5v4M10 4.5h4"/><path d="M7 11l1.5-4.5h7L17 11"/><rect x="5" y="11" width="14" height="7" rx="1.5"/><path d="M9 18v3M15 18v3"/>',
  // Keycap: nút phím nhìn nghiêng — mặt trên lõm và chân đế
  keycap: '<path d="M4 19l2-12.5h12L20 19z"/><path d="M8.5 9h7l-.6 5h-5.8z"/>',
  // Stabilizer: 2 vỏ stab + thanh dây nối bên dưới
  stabilizer: '<rect x="3" y="8" width="5" height="8" rx="1.2"/><rect x="16" y="8" width="5" height="8" rx="1.2"/><path d="M5.5 5v3M18.5 5v3M5.5 16v2.5h13V16"/>',
  // Phụ kiện: đầu cáp USB-C + dây xoắn
  accessory: '<rect x="9" y="2" width="6" height="6" rx="1.5"/><path d="M11 5h2"/><path d="M12 8v1.5c-3 0-3 3 0 3s3 3 0 3-3 3 0 3V22"/>',
  // Gia công: cờ lê + tua vít bắt chéo
  service: '<path d="M14.7 6.3a4 4 0 0 0 4.9 4.9l-8.5 8.5a2.1 2.1 0 0 1-3-3z" /><path d="M14.7 6.3l2.6-2.6a4 4 0 0 1 2.9 2.9l-2.6 2.6"/><path d="M4 4l2.5.8 4 4-1.7 1.7-4-4z"/><path d="M13.5 13.5l5.5 5.5"/>',
  // Gian hàng: mái hiên + cửa hàng
  shop: '<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3"/><path d="M5 12v8h14v-8M10 20v-5h4v5"/>',
  // Build sẵn: bàn phím đã lắp + huy hiệu dấu tích
  prebuilt: '<rect x="2" y="9" width="15" height="10" rx="2"/><path d="M5.5 12.5h.01M8.5 12.5h.01M11.5 12.5h.01M6.5 15.5h6"/><circle cx="18.5" cy="6.5" r="4"/><path d="M16.8 6.6l1.2 1.2 2.3-2.4"/>'
};

// size: số (px) hoặc chuỗi CSS như '1.15em' để to bằng chữ xung quanh
function catIcon(partType, size = 24) {
  const d = PATHS[partType] || PATHS.accessory;
  return `<svg class="cat-ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

// Biểu tượng giao diện dạng nét mảnh (kiểu các sàn TMĐT): thanh đầu trang, menu tài khoản…
const UI = {
  dashboard: '<rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  plus: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M12 8v8M8 12h8"/>',
  external: '<path d="M14 3.5h6.5V10M20.5 3.5L11 13"/><path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10"/>',
  package: '<path d="M12 2.8l8.5 4.6v9.2L12 21.2l-8.5-4.6V7.4z"/><path d="M3.8 7.6L12 12l8.2-4.4M12 12v9M7.8 5.1l8.4 4.6"/>',
  wallet: '<path d="M19 7.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5a2 2 0 0 0 0 4h14.5a1 1 0 0 1 1 1v9.5a1.5 1.5 0 0 1-1.5 1.5H5a2 2 0 0 1-2-2V6"/><path d="M16.5 13.8h.01"/>',
  receipt: '<path d="M5 2.5h14v19l-2.3-1.6-2.4 1.6-2.3-1.6-2.3 1.6-2.4-1.6L5 21.5z"/><path d="M9 7.5h6M9 11.5h6M9 15.5h3.5"/>',
  bank: '<path d="M3 9.5L12 4l9 5.5M4.5 9.5h15M6 10v7.5M10 10v7.5M14 10v7.5M18 10v7.5M3.5 20.5h17"/>',
  banknote: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v.01M18 14.5v.01"/>',
  alert: '<path d="M10.3 3.9L2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8.3 12.3l2.5 2.5 5-5.2"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/>',
  bulb: '<path d="M9 18h6M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-3.9 11.7c.6.5.9 1.1.9 1.8v.5h6V16c0-.7.3-1.3.9-1.8A6.5 6.5 0 0 0 12 2.5z"/>',
  message: '<path d="M20.5 12a8 8 0 0 1-11.6 7.2L3.5 20.5l1.4-4.8A8 8 0 1 1 20.5 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4.5V8M9 13.5v1M15 13.5v1M2 13v3M22 13v3"/><circle cx="12" cy="3.5" r="1"/>',
  inbox: '<path d="M3 13.5l2.6-8a1.5 1.5 0 0 1 1.4-1h10a1.5 1.5 0 0 1 1.4 1l2.6 8V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z"/><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5"/>',
  mail: '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="M3 6.5l9 6.5 9-6.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3a6.5 6.5 0 0 1 3.5 5.7"/>',
  puzzle: '<path d="M10 3.5a2 2 0 0 1 4 0V5h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 0 0 0 4H19v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 0 0-4 0V19H6a1 1 0 0 1-1-1v-4h1.5a2 2 0 0 0 0-4H5V6a1 1 0 0 1 1-1h4z"/>',
  trend: '<path d="M3 17.5l6-6 4 4 8-8"/><path d="M15 7.5h6v6"/>',
  chart: '<path d="M3.5 20.5h17"/><rect x="5" y="11" width="3.5" height="7" rx=".8"/><rect x="10.3" y="6" width="3.5" height="12" rx=".8"/><rect x="15.6" y="13.5" width="3.5" height="4.5" rx=".8"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5l-9.2 9.2a2.1 2.1 0 0 1-3-3z"/><path d="M14.7 6.3a4 4 0 0 1 5 5l-2.6-.4-2-2z"/>',
  hourglass: '<path d="M6.5 2.5h11M6.5 21.5h11M7.5 2.5c0 4.5 4.5 5.5 4.5 9.5s-4.5 5-4.5 9.5M16.5 2.5c0 4.5-4.5 5.5-4.5 9.5s4.5 5 4.5 9.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  note: '<path d="M4.5 3.5h11l4 4v13h-15z"/><path d="M8 10h8M8 14h8M8 18h5"/>',
  camera: '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.7l1.6-2.5h6.4L16.8 7h2.7A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><circle cx="12" cy="13" r="3.6"/>',
  save: '<path d="M5 3.5h11.5l3 3V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M7.5 3.5v5h8v-5M7.5 20.5v-6.5h9v6.5"/>',
  pin: '<path d="M12 21.5s7-6.2 7-11.8a7 7 0 0 0-14 0c0 5.6 7 11.8 7 11.8z"/><circle cx="12" cy="9.7" r="2.6"/>',
  clipboard: '<rect x="5" y="4.5" width="14" height="17" rx="2"/><path d="M9 2.5h6v3.5H9zM8.5 11h7M8.5 15h5"/>',
  truck: '<path d="M2.5 5.5h11.5v10.5H2.5zM14 9h4l3.5 3.5V16H14"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
  trash: '<path d="M4 6.5h16M9.5 6.5V4h5v2.5M6 6.5l1 14h10l1-14M10 10.5v6M14 10.5v6"/>',
  pencil: '<path d="M16.5 3.8a2.1 2.1 0 0 1 3 3L8 18.3l-4.3 1.2L5 15.2z"/><path d="M14.5 5.8l3 3"/>',
  undo: '<path d="M9 14.5L4 9.5l5-5"/><path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/><path d="M19 3v4M17 5h4"/>',
  heartFill: '<path fill="currentColor" d="M12 20.5s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.6c0 5.7-7.5 10.3-7.5 10.3z"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.6c0 5.7-7.5 10.3-7.5 10.3z"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 7.5H6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  orders: '<path d="M6 2.5h9l4 4V21a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 21z"/><path d="M14.5 2.5v4.5H19M9 12h6M9 16h6"/>',
  builds: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  star: '<path d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1 6L12 17l-5.35 2.85 1-6L3.3 9.6l6-.9z"/>',
  store: '<path d="M3.5 9.5l1.3-5h14.4l1.3 5"/><path d="M3.5 9.5a2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.8 0 2.8 2.8 0 0 0 5.6 0"/><path d="M5 12.3V20.5h14v-8.2M10 20.5v-5h4v5"/>',
  shield: '<path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z"/><path d="M8.8 12l2.2 2.2 4.2-4.4"/>',
  logout: '<path d="M14 4h4.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 16.5L5.5 12 10 7.5M5.5 12H15"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20.5 20.5l-4.9-4.9"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  chevron: '<path d="M6.5 9.5L12 15l5.5-5.5"/>',
  tool: '<path d="M14.5 6a4 4 0 0 0 5 5L11 19.5a2.1 2.1 0 0 1-3-3z"/><path d="M14.5 6l2.6-2.6a4 4 0 0 1 3.5 3.5L18 9.5"/>'
};
function uiIcon(name, size = 20, sw = 1.8) {
  return `<svg class="ui-ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI[name] || ''}</svg>`;
}

module.exports = { catIcon, uiIcon, UI_ICONS: UI, ICON_TYPES: Object.keys(PATHS) };
