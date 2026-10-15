// Bộ công cụ dùng chung cho các file kiểm thử: tự nạp dữ liệu mẫu vào DB test riêng,
// bật server ở cổng riêng, client HTTP có cookie, đọc email trong Hộp thư dev.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const mongoose = require('mongoose');

const ROOT = path.join(__dirname, '..');

function createHarness({ port, db }) {
  const PORT = Number(process.env.TEST_PORT || port);
  const BASE = `http://localhost:${PORT}`;
  const DB = process.env.TEST_MONGODB_URI || db;
  if (!/test/i.test(DB)) throw new Error('Database kiểm thử phải có chữ "test" trong tên để tránh xoá dữ liệu thật');
  const ENV = {
    ...process.env, PORT: String(PORT), BASE_URL: BASE, MONGODB_URI: DB, SESSION_SECRET: 'test-secret',
    SMTP_HOST: '', SMTP_USER: '', MAIL_DEV: '1', VNP_TMNCODE: '', VNP_HASHSECRET: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '',
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', FACEBOOK_APP_ID: '', FACEBOOK_APP_SECRET: ''
  };
  const h = { BASE, DB, ROOT, M: null, server: null, serverErrors: [] };

  class Client {
    constructor() { this.jar = {}; }
    cookieHeader() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
    store(res) {
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of set) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.jar[kv.slice(0, i)] = kv.slice(i + 1); }
    }
    async req(method, url, { form, multipart, json, follow = true, headers = {} } = {}) {
      let body;
      const hd = { ...headers, cookie: this.cookieHeader() };
      if (form) { body = new URLSearchParams(form).toString(); hd['content-type'] = 'application/x-www-form-urlencoded'; }
      if (json) { body = JSON.stringify(json); hd['content-type'] = 'application/json'; hd.accept = 'application/json'; }
      if (multipart) body = multipart;
      let res = await fetch(BASE + url, { method, body, headers: hd, redirect: 'manual' });
      this.store(res);
      let hops = 0;
      while (follow && res.status >= 300 && res.status < 400 && hops++ < 10) {
        const loc = new URL(res.headers.get('location'), BASE);
        res = await fetch(loc, { headers: { cookie: this.cookieHeader() }, redirect: 'manual' });
        this.store(res);
      }
      const text = await res.text();
      return { status: res.status, url: res.url ? res.url.replace(BASE, '') : url, text };
    }
    get(u, o) { return this.req('GET', u, o); }
    post(u, form, o = {}) { return this.req('POST', u, { form, ...o }); }
    login(email, password, admin = false) { return this.post(admin ? '/admin/login' : '/auth/login', { email, password }); }
  }
  h.Client = Client;
  h.has = (r, s) => (s instanceof RegExp ? s.test(r.text) : r.text.includes(s));
  // Không trang nào được hiện "Lỗi hệ thống" (500)
  h.ok = (r, msg = '') => { assert.ok(r.status < 500 && !r.text.includes('Lỗi hệ thống'), `${msg} → lỗi ${r.status} tại ${r.url}`); return r; };

  h.lastMailLink = async (kind) => {
    const c = new Client();
    const list = await c.get('/dev/mails');
    const idx = (list.text.match(/\/dev\/mails\/(\d+)/) || [])[1];
    assert.ok(idx !== undefined, 'Không có email trong Hộp thư dev');
    const mail = await c.get('/dev/mails/' + idx);
    const m = mail.text.match(new RegExp(`href="${BASE}(/auth/${kind}/[a-f0-9]+)"`));
    assert.ok(m, `Email không có link ${kind}`);
    return { link: m[1], mail, list };
  };

  h.start = async () => {
    const seed = spawnSync(process.execPath, ['seed/seed.js'], { cwd: ROOT, env: ENV, encoding: 'utf8' });
    if (seed.status !== 0) throw new Error('Nạp dữ liệu mẫu lỗi:\n' + seed.stdout + seed.stderr);
    h.server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    h.server.stderr.on('data', d => { const s = String(d); if (!/deprecated/.test(s)) { h.serverErrors.push(s); process.stderr.write('[server] ' + s); } });
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(BASE + '/'); if (r.status < 500) break; } catch (e) { /* chưa lên */ }
      await new Promise(r => setTimeout(r, 500));
    }
    await mongoose.connect(DB);
    h.M = require(path.join(ROOT, 'models'));
  };
  h.stop = async () => { if (h.server) h.server.kill(); await mongoose.disconnect(); };
  return h;
}

module.exports = { createHarness };
