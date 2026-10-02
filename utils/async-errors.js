// Express 4 không tự bắt lỗi của handler async → request bị treo, hoặc Node 22 tắt hẳn server
// khi có "unhandled rejection". File này bọc mọi handler của Router để lỗi được chuyển sang
// middleware xử lý lỗi (next(err)). Phải require trước khi tạo các router.
const Router = require('express').Router;
const Route = require('express/lib/router/route');

function wrap(fn) {
  if (typeof fn !== 'function' || fn.length === 4 || fn.__wrapped) return fn;
  const w = function (req, res, next) {
    let r;
    try { r = fn.call(this, req, res, next); } catch (e) { return next(e); }
    if (r && typeof r.catch === 'function') r.catch(next);
    return r;
  };
  w.__wrapped = true;
  return w;
}
const wrapArgs = args => args.map(a => (Array.isArray(a) ? a.map(wrap) : wrap(a)));

for (const m of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
  const orig = Route.prototype[m];
  Route.prototype[m] = function (...args) { return orig.apply(this, wrapArgs(args)); };
}
const origUse = Router.use;
Router.use = function (...args) { return origUse.apply(this, wrapArgs(args)); };
