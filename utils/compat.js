// Bộ kiểm tra độ tương thích linh kiện (Đặc trưng 5)
// Mỗi quy tắc có mã (code) cố định, còn mức độ (block/warn/suggest), bật/tắt và câu thông báo
// thì admin cấu hình trong trang "Danh mục kỹ thuật & tương thích".
const CompatRule = require('../models/CompatRule');

const pcbGroup = (m) => (m ? (String(m).startsWith('pcb') ? 'pcb' : m) : null);
const A = (p) => (p && p.attrs) || {};

// code -> { name, parts, description, level mặc định, message mặc định, test(build) => vars | null }
const CHECKS = {
  SWITCH_PINS: {
    name: 'Chân switch ↔ socket hotswap',
    parts: 'Kit ↔ Switch',
    description: 'Switch 5 chân không cắm được vào socket hotswap chỉ hỗ trợ 3 chân (và ngược lại tuỳ PCB).',
    level: 'block',
    message: '{switch} dùng {pins} chân, PCB hotswap của {kit} chỉ nhận {kitPins} chân. Cắm vào dễ gãy chân hoặc hỏng socket.',
    test: ({ kit, sw }) => {
      if (!kit || !sw || !A(kit).hotswap) return null;
      const kp = A(kit).pins || [], sp = A(sw).pins || [];
      if (!kp.length || !sp.length) return null;
      const ok = sp.some(p => kp.includes(p)) && Math.max(...sp) <= Math.max(...kp);
      return ok ? null : { pins: sp.join('/'), kitPins: kp.join('/') };
    }
  },
  SWITCH_QTY: {
    name: 'Đủ số lượng switch cho layout',
    parts: 'Kit ↔ Switch',
    description: 'Số switch đặt phải ≥ số phím của kit.',
    level: 'block',
    message: 'Kit {kit} có {keys} phím nhưng mới chọn {qty} switch.',
    test: ({ kit, sw, qty }) => {
      if (!kit || !sw || !A(kit).keyCount) return null;
      return qty >= A(kit).keyCount ? null : { keys: A(kit).keyCount, qty };
    }
  },
  STAB_MOUNT: {
    name: 'Kiểu mount stabilizer',
    parts: 'Kit ↔ Stabilizer',
    description: 'Stab PCB-mount (screw-in/clip-in) không lắp được lên kit chỉ hỗ trợ plate-mount và ngược lại.',
    level: 'block',
    message: '{stab} là loại {stabMount}, còn {kit} dùng stab {kitStab}.',
    test: ({ kit, stab }) => {
      if (!kit || !stab) return null;
      const k = pcbGroup(A(kit).stabMount), s = pcbGroup(A(stab).stabMount);
      if (!k || !s || k === s) return null;
      const lb = { pcb: 'PCB-mount', plate: 'plate-mount' };
      return { stabMount: lb[s] || s, kitStab: lb[k] || k };
    }
  },
  KEYCAP_LAYOUT: {
    name: 'Keycap phủ đủ layout',
    parts: 'Kit ↔ Keycap',
    description: 'Bộ keycap phải có đủ phím cho layout của kit.',
    level: 'block',
    message: 'Bộ {keycap} không hỗ trợ layout {layout} của {kit} (thiếu phím).',
    test: ({ kit, keycap }) => {
      if (!kit || !keycap) return null;
      const ls = A(keycap).layouts || [];
      if (!ls.length || !A(kit).layout) return null;
      return ls.includes(A(kit).layout) ? null : { layout: A(kit).layout };
    }
  },
  LED_PROFILE: {
    name: 'LED hướng bắc ↔ keycap Cherry',
    parts: 'Kit ↔ Keycap',
    description: 'PCB LED north-facing có thể làm keycap Cherry profile cấn vào vỏ switch ở hàng dưới.',
    level: 'warn',
    message: '{kit} dùng LED hướng bắc (north-facing); keycap Cherry profile {keycap} có thể bị cấn ở hàng phím dưới cùng.',
    test: ({ kit, keycap }) => {
      if (!kit || !keycap) return null;
      return A(kit).ledDirection === 'north' && A(keycap).profile === 'Cherry' ? {} : null;
    }
  },
  SOLDER_REQUIRED: {
    name: 'Kit hàn mạch cần gói có hàn',
    parts: 'Kit ↔ Gia công',
    description: 'Kit không hotswap phải chọn gói gia công có dịch vụ hàn switch.',
    level: 'warn',
    message: '{kit} là PCB hàn (không hotswap). Hãy chọn gói gia công có hàn switch.',
    test: ({ kit, service }) => {
      if (!kit || A(kit).hotswap !== false) return null;
      return service && service.soldering ? null : {};
    }
  },
  LUBE_SUGGEST: {
    name: 'Gợi ý lube cho switch linear',
    parts: 'Switch ↔ Gia công',
    description: 'Switch linear chưa lube nên chọn gói có lube để êm và mượt hơn.',
    level: 'suggest',
    message: '{switch} là switch linear — nên chọn gói gia công có lube để phím mượt hơn.',
    test: ({ sw, service }) => {
      if (!sw || A(sw).switchType !== 'linear') return null;
      return service && service.lube ? null : {};
    }
  },
  STAB_MISSING: {
    name: 'Chưa chọn stabilizer',
    parts: 'Kit ↔ Stabilizer',
    description: 'Phím dài (Space, Shift, Enter) cần stabilizer.',
    level: 'suggest',
    message: 'Bạn chưa chọn stabilizer — phím Space/Shift/Enter sẽ bị lệch và kêu lạch cạch.',
    test: ({ kit, stab, step }) => (kit && !stab && step >= 4 ? {} : null)
  }
};

let cache = null, cacheAt = 0;
async function loadRules() {
  if (cache && Date.now() - cacheAt < 30000) return cache;
  const docs = await CompatRule.find().lean();
  const map = {};
  docs.forEach(d => { map[d.code] = d; });
  cache = map; cacheAt = Date.now();
  return map;
}
function clearCache() { cache = null; }

function fill(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

// parts: { kit, sw, keycap, stab, service, qty, step } — các document đã populate
async function check(parts) {
  const rules = await loadRules();
  const names = {
    kit: parts.kit ? parts.kit.name : '', switch: parts.sw ? parts.sw.name : '',
    keycap: parts.keycap ? parts.keycap.name : '', stab: parts.stab ? parts.stab.name : '',
    service: parts.service ? parts.service.name : ''
  };
  const issues = [];
  for (const [code, c] of Object.entries(CHECKS)) {
    const r = rules[code];
    if (r && !r.enabled) continue;
    const vars = c.test(parts);
    if (!vars) continue;
    issues.push({ code, level: (r && r.level) || c.level, message: fill((r && r.message) || c.message, { ...names, ...vars }) });
  }
  const order = { block: 0, warn: 1, suggest: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  return { ok: !issues.some(i => i.level === 'block'), issues };
}

// Kiểm tra từng ứng viên ở một bước của builder -> trả về lý do bị chặn (nếu có)
async function checkCandidate(base, role, candidate) {
  const p = { ...base, [role]: candidate };
  if (role === 'sw' && base.kit) p.qty = Math.max(base.qty || 0, (A(base.kit).keyCount || 0));
  const res = await check(p);
  const relevant = res.issues.filter(i => {
    const map = { sw: ['SWITCH_PINS', 'SWITCH_QTY', 'LUBE_SUGGEST'], keycap: ['KEYCAP_LAYOUT', 'LED_PROFILE'], stab: ['STAB_MOUNT'], service: ['SOLDER_REQUIRED', 'LUBE_SUGGEST'], kit: Object.keys(CHECKS) };
    return (map[role] || []).includes(i.code);
  });
  return {
    blocked: relevant.find(i => i.level === 'block') || null,
    warn: relevant.find(i => i.level === 'warn') || null,
    suggest: relevant.find(i => i.level === 'suggest') || null
  };
}

async function seedRules() {
  for (const [code, c] of Object.entries(CHECKS)) {
    await CompatRule.updateOne({ code }, {
      $setOnInsert: { code, name: c.name, parts: c.parts, description: c.description, level: c.level, message: c.message, enabled: true }
    }, { upsert: true });
  }
  clearCache();
}

module.exports = { CHECKS, check, checkCandidate, seedRules, clearCache };
