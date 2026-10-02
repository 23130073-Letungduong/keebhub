// Vẽ ảnh minh hoạ sản phẩm dạng SVG theo đúng phong cách bộ thiết kế (design/02-trang-chu.html)
// Dùng khi shop chưa upload ảnh thật.

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function rnd(seed) {
  let s = seed || 1;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
const open = (bg) => `<svg viewBox="0 0 320 320" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="320" fill="${bg}"/>`;

function keyboard({ color = '#4B5563', accent = '#1B62F5', bg = '#E7EBF0', seed = 1, plate = '#F4F7FA', key = '#D1D5DB' }) {
  const r = rnd(seed);
  let s = open(bg);
  s += `<rect x="20" y="80" width="280" height="160" rx="16" fill="${color}"/><rect x="28" y="88" width="264" height="144" rx="11" fill="${plate}"/>`;
  const rows = [14, 14, 13, 12, 8];
  rows.forEach((n, ri) => {
    const y = 96 + ri * 26;
    const w = (258 - (n - 1) * 4) / n;
    for (let i = 0; i < n; i++) {
      const x = 34 + i * (w + 4);
      const f = r() < 0.12 ? accent : key;
      s += `<rect x="${x.toFixed(1)}" y="${y}" width="${(w - 0).toFixed(1)}" height="22" rx="4" fill="${f}"/>`;
    }
  });
  return s + '</svg>';
}

function sw({ color = '#111827', accent = '#F59E0B', bg = '#F1F4F8' }) {
  return open(bg) +
    `<rect x="96" y="132" width="128" height="16" rx="4" fill="${color}" opacity=".55"/>` +
    `<rect x="88" y="146" width="144" height="92" rx="10" fill="${color}"/>` +
    `<rect x="100" y="156" width="120" height="68" rx="7" fill="#fff" opacity=".16"/>` +
    `<rect x="112" y="118" width="96" height="30" rx="6" fill="${accent}" opacity=".9"/>` +
    `<rect x="146" y="72" width="28" height="56" rx="5" fill="${accent}"/>` +
    `<rect x="130" y="88" width="60" height="18" rx="5" fill="${accent}"/>` +
    `<rect x="116" y="238" width="16" height="18" rx="3" fill="#9AA5B4"/><rect x="188" y="238" width="16" height="18" rx="3" fill="#9AA5B4"/>` +
    `<rect x="88" y="230" width="144" height="10" rx="5" fill="#000" opacity=".08"/></svg>`;
}

function keycaps({ color = '#E8E3DC', accent = '#C8553D', bg = '#F4F1EC', seed = 1 }) {
  const r = rnd(seed);
  let s = open(bg);
  for (let row = 0; row < 4; row++) {
    for (let c = 0; c < 5; c++) {
      const x = 44 + c * 48, y = 62 + row * 48;
      const f = r() < 0.25 ? accent : color;
      s += `<rect x="${x}" y="${y}" width="40" height="40" rx="6" fill="${f}"/><rect x="${x + 5}" y="${y + 4}" width="30" height="26" rx="5" fill="#fff" opacity=".38"/><rect x="${x}" y="${y + 34}" width="40" height="6" rx="3" fill="#000" opacity=".1"/>`;
    }
  }
  return s + '</svg>';
}

function stab({ color = '#C7D2FE', accent = '#3730A3', bg = '#F1F4F8' }) {
  return sw({ color, accent, bg });
}

function cable({ color = '#1B62F5', accent = '#FF5A1F', bg = '#F1F4F8' }) {
  let path = 'M40 250 ';
  for (let i = 0; i < 9; i++) path += `C ${60 + i * 22} 120, ${70 + i * 22} 120, ${80 + i * 22} 200 `;
  return open(bg) + `<path d="${path}" stroke="${color}" stroke-width="12" fill="none" stroke-linecap="round"/>` +
    `<rect x="236" y="168" width="44" height="64" rx="10" fill="${accent}"/><rect x="248" y="232" width="20" height="30" rx="4" fill="#9AA5B4"/>` +
    `<rect x="24" y="236" width="34" height="40" rx="8" fill="#475467"/></svg>`;
}

function service({ color = '#1B62F5', accent = '#FF5A1F', bg = '#EEF4FF' }) {
  return open(bg) +
    `<circle cx="160" cy="160" r="86" fill="#fff"/><circle cx="160" cy="160" r="62" fill="${color}" opacity=".12"/>` +
    `<path d="M120 200 L190 130" stroke="${color}" stroke-width="16" stroke-linecap="round"/>` +
    `<circle cx="198" cy="122" r="24" fill="none" stroke="${color}" stroke-width="14"/>` +
    `<rect x="132" y="176" width="22" height="58" rx="8" transform="rotate(45 143 205)" fill="${accent}"/></svg>`;
}

function render(product) {
  const a = (product.art && product.art.kind) ? product.art : {};
  const seed = hash(String(product._id || product.name || 'x'));
  const kind = a.kind || ({ kit: 'kit', prebuilt: 'kit', switch: 'switch', keycap: 'keycap', stabilizer: 'stab', accessory: 'cable' }[product.partType] || 'kit');
  const opt = { color: a.color, accent: a.accent, bg: a.bg, seed };
  Object.keys(opt).forEach(k => opt[k] === undefined && delete opt[k]);
  switch (kind) {
    case 'switch': return sw(opt);
    case 'keycap': return keycaps(opt);
    case 'stab': return stab(opt);
    case 'cable': return cable(opt);
    case 'service': return service(opt);
    default: return keyboard(opt);
  }
}

module.exports = { render, keyboard, sw, keycaps, stab, cable, service };
