// KeebHub — JS phía trình duyệt
(function () {
  // Dropdown (header user menu, danh mục)
  document.querySelectorAll('.dd').forEach(function (dd) {
    dd.addEventListener('click', function (e) {
      if (e.target.closest('.ddm a, .ddm button')) return;
      document.querySelectorAll('.dd.open').forEach(function (x) { if (x !== dd) x.classList.remove('open'); });
      dd.classList.toggle('open');
    });
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.dd')) document.querySelectorAll('.dd.open').forEach(function (x) { x.classList.remove('open'); });
  });

  // Hiện/ẩn mật khẩu
  document.querySelectorAll('.pw .eye').forEach(function (b) {
    b.addEventListener('click', function () {
      var i = b.parentNode.querySelector('input');
      i.type = i.type === 'password' ? 'text' : 'password';
    });
  });
  // Độ mạnh mật khẩu
  var pw = document.getElementById('pw'), st = document.getElementById('strength');
  if (pw && st) pw.addEventListener('input', function () {
    var v = pw.value, s = 0;
    if (v.length >= 8) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++;
    var c = ['#D92D20', '#DC6803', '#FDB022', '#079455'][s - 1];
    st.querySelectorAll('i').forEach(function (i, k) { i.style.background = k < s ? c : ''; });
  });

  // Stepper số lượng ở trang sản phẩm
  document.querySelectorAll('.stepper.qty').forEach(function (sp) {
    var inp = sp.querySelector('input');
    sp.querySelectorAll('b[data-d]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = (parseInt(inp.value) || 1) + parseInt(b.dataset.d);
        var max = parseInt(inp.max) || 999;
        inp.value = Math.max(1, Math.min(max, v));
      });
    });
  });

  // Tabs trang sản phẩm
  var tabs = document.querySelectorAll('.ptabs a[data-tab]');
  tabs.forEach(function (a) {
    a.addEventListener('click', function () {
      tabs.forEach(function (x) { x.classList.toggle('on', x === a); });
      document.querySelectorAll('.tabp').forEach(function (p) { p.hidden = p.dataset.tab !== a.dataset.tab; });
      history.replaceState(null, '', '?tab=' + a.dataset.tab + '#tabs');
    });
  });

  // Hiển thị tên file đã chọn
  document.querySelectorAll('input[type=file]').forEach(function (f) {
    f.addEventListener('change', function () {
      var box = f.closest('form'), lbl = box && box.querySelector('.filelbl');
      if (lbl) lbl.textContent = f.files.length ? 'Đã chọn ' + f.files.length + ' ảnh: ' + Array.from(f.files).map(function (x) { return x.name; }).join(', ') : '';
    });
  });

  // Chọn sao đánh giá
  document.querySelectorAll('[data-stars]').forEach(function (g) {
    var labels = ['Rất tệ', 'Tệ', 'Bình thường', 'Tốt', 'Tuyệt vời'];
    var spans = g.querySelectorAll('label span'), lbl = g.querySelector('.starlbl');
    function paint(n) { spans.forEach(function (s, i) { s.style.color = i < n ? 'var(--star)' : 'var(--border2)'; }); if (lbl) lbl.textContent = labels[n - 1]; }
    g.querySelectorAll('input').forEach(function (r) { r.addEventListener('change', function () { paint(parseInt(r.value)); }); });
    paint(5);
  });

  // Form sản phẩm (seller): hiện thuộc tính theo loại danh mục
  var cat = document.getElementById('catSel');
  if (cat) {
    var apply = function () {
      var t = cat.options[cat.selectedIndex].dataset.type;
      document.querySelectorAll('[data-for]').forEach(function (el) {
        el.style.display = el.dataset.for.split(' ').indexOf(t) >= 0 ? '' : 'none';
      });
    };
    cat.addEventListener('change', apply); apply();
  }

  // Tự ẩn flash sau 6s
  setTimeout(function () { document.querySelectorAll('.flash.ok').forEach(function (f) { f.style.opacity = '0'; setTimeout(function () { f.remove(); }, 400); }); }, 6000);

  // ===== Chat AI =====
  var fab = document.getElementById('chatFab'), box = document.getElementById('chatBox');
  if (!fab || !box) return;
  var body = document.getElementById('chatBody'), form = document.getElementById('chatForm'), input = document.getElementById('chatInput');
  var chatHist = [];
  try { chatHist = JSON.parse(sessionStorage.getItem('keeby') || '[]'); } catch (e) { chatHist = []; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function add(role, text, products) {
    var d = document.createElement('div');
    d.className = 'msg ' + (role === 'user' ? 'me' : 'bot');
    d.innerHTML = esc(text).replace(/\n/g, '<br>');
    body.appendChild(d);
    if (products && products.length) {
      var w = document.createElement('div'); w.className = 'cprods';
      products.forEach(function (p) {
        w.insertAdjacentHTML('beforeend', '<a href="' + p.url + '"><img src="' + p.image + '"><span>' + esc(p.name) + '</span><b>' + p.price + '</b></a>');
      });
      body.appendChild(w);
    }
    body.scrollTop = body.scrollHeight;
  }
  chatHist.forEach(function (m) { add(m.role, m.content); });
  function save() { try { sessionStorage.setItem('keeby', JSON.stringify(chatHist.slice(-20))); } catch (e) {} }
  fab.addEventListener('click', function () { box.hidden = !box.hidden; if (!box.hidden) input.focus(); });
  document.getElementById('chatClose').addEventListener('click', function () { box.hidden = true; });
  function send(text) {
    text = text.trim(); if (!text) return;
    add('user', text); chatHist.push({ role: 'user', content: text }); save();
    input.value = '';
    var typing = document.createElement('div'); typing.className = 'msg bot typing'; typing.textContent = 'Keeby đang trả lời…'; body.appendChild(typing);
    body.scrollTop = body.scrollHeight;
    fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ messages: chatHist }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { typing.remove(); add('assistant', d.reply || 'Xin lỗi, mình chưa trả lời được.', d.products); chatHist.push({ role: 'assistant', content: d.reply || '' }); save(); })
      .catch(function () { typing.remove(); add('assistant', 'Mất kết nối, bạn thử lại nhé.'); });
  }
  form.addEventListener('submit', function (e) { e.preventDefault(); send(input.value); });
  body.querySelectorAll('.sugg button').forEach(function (b) { b.addEventListener('click', function () { send(b.textContent); }); });
})();

// ---------- Khách chưa đăng nhập bấm vào tính năng cần tài khoản → thông báo nhỏ ở góc, tự ẩn ----------
(function () {
  if (!window.KH_GUEST) return;
  // Các đường dẫn bắt buộc đăng nhập (khớp với requireLogin ở server)
  var NEED = /^\/(builder|cart|checkout|account|seller|payment|wishlist)(\/|$)|^\/p\/[^/]+\/comments|^\/comments\//;
  var NAMES = { builder: 'Custom Builder', cart: 'Giỏ hàng', checkout: 'Đặt hàng', account: 'Tài khoản', seller: 'Kênh người bán', payment: 'Thanh toán', wishlist: 'Yêu thích' };
  var PATHS = { '/account/wishlist': 'Yêu thích', '/account/orders': 'Đơn hàng của tôi', '/account/builds': 'Cấu hình đã lưu', '/account/reviews': 'Đánh giá của tôi', '/seller/register': 'Đăng ký bán hàng' };
  var DUR = 3500, timer = null, toast = null;

  function featureName(el, path) {
    var t = el.getAttribute('data-feature') || el.getAttribute('aria-label') || el.getAttribute('title') || '';
    if (!t && el.tagName !== 'FORM') t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t && el.tagName === 'FORM') { var b = el.querySelector('button[type=submit],button:not([type]),input[type=submit]'); if (b) t = (b.textContent || b.value || '').replace(/\s+/g, ' ').trim(); }
    t = t.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[→›»]+$/, '').trim();
    if (!t || t.length > 40 || /^\d+$/.test(t)) t = PATHS[path.split('?')[0]] || NAMES[(path.split('/')[1] || '')] || '';
    return t;
  }
  function esc(s) { return s.replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function hide() { if (toast) toast.classList.remove('show'); clearTimeout(timer); }
  function startTimer() { clearTimeout(timer); timer = setTimeout(hide, DUR); }
  function show(el, path) {
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'kh-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
      toast.style.setProperty('--dur', DUR + 'ms');
      document.body.appendChild(toast);
      toast.addEventListener('mouseenter', function () { clearTimeout(timer); });
      toast.addEventListener('mouseleave', startTimer);
      toast.addEventListener('click', function (e) { if (e.target.closest('.x')) hide(); });
    }
    var name = featureName(el, path);
    var back = el.tagName === 'A' ? path : location.pathname + location.search;
    toast.innerHTML = '<span class="ic">🔒</span><div>Bạn cần đăng nhập để sử dụng tính năng ' + (name ? '<b>' + esc(name) + '</b>' : 'này') +
      '. <a href="/auth/login?next=' + encodeURIComponent(back) + '">Đăng nhập</a></div><button type="button" class="x" aria-label="Đóng">×</button><span class="bar"></span>';
    toast.classList.remove('show'); void toast.offsetWidth; // chạy lại hiệu ứng khi bấm liên tiếp
    toast.classList.add('show');
    startTimer();
  }
  function needs(url) {
    try { var u = new URL(url, location.href); return u.origin === location.origin && NEED.test(u.pathname) ? u.pathname + u.search : null; } catch (e) { return null; }
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || (toast && toast.contains(a))) return;
    var path = needs(a.getAttribute('href'));
    if (!path) return;
    e.preventDefault();
    show(a, path);
  }, true);
  document.addEventListener('submit', function (e) {
    var f = e.target;
    var path = needs(f.getAttribute('action') || location.href);
    if (!path) return;
    e.preventDefault();
    show(f, path);
  }, true);
})();
