// FarmBase Social: Worker phục vụ API /api/* ; giao diện PWA nằm trong public/ (Cloudflare Assets).
import { HttpError, json } from './lib/http.js';
import { currentUser } from './lib/auth.js';
import * as auth from './routes/auth.js';
import * as users from './routes/users.js';
import * as fb from './routes/facebook.js';
import * as posts from './routes/posts.js';
import * as content from './routes/content.js';
import * as media from './routes/media.js';
import * as writing from './routes/writing.js';
import * as inbox from './routes/inbox.js';
import * as ads from './routes/ads.js';
import * as report from './routes/report.js';

// [method, mẫu đường dẫn, hàm, tùy chọn]
// public: không cần đăng nhập · external: yêu cầu từ máy chủ khác (Facebook), bỏ kiểm tra cùng nguồn vì đã kiểm tra chữ ký · allowMustChange: dùng được khi chưa đổi mật khẩu lần đầu · nav: điều hướng trình duyệt (lỗi thì chuyển trang)
const ROUTES = [
  ['GET', '/api/health', () => json({ ok: true, service: 'farmbase-social' }), { public: true }],
  ['POST', '/api/auth/login', auth.login, { public: true }],
  ['POST', '/api/auth/logout', auth.logout, { public: true }],
  ['POST', '/api/auth/logout-all', auth.logoutAll, { allowMustChange: true }],
  ['GET', '/api/auth/me', auth.me, { public: true }],
  ['POST', '/api/auth/change-password', auth.changePassword, { allowMustChange: true }],
  ['GET', '/api/users', users.listUsers],
  ['POST', '/api/users', users.createUser],
  ['PATCH', '/api/users/:id', users.updateUser],
  ['POST', '/api/users/:id/reset-password', users.resetPassword],
  ['POST', '/api/users/:id/unlock', users.unlockUser],
  ['GET', '/api/audit', users.listAudit],
  ['GET', '/api/pages', fb.listPages],
  ['GET', '/api/pages/:id/posts', posts.pagePosts],
  ['GET', '/api/posts', posts.allPosts],
  ['POST', '/api/pages/:id/refresh', fb.refreshPage],
  ['POST', '/api/pages/:id/disconnect', fb.disconnectPage],
  ['GET', '/api/content', content.listContent],
  ['POST', '/api/content', content.createContent],
  ['PATCH', '/api/content/:id', content.updateContent],
  ['DELETE', '/api/content/:id', content.deleteContent],
  ['POST', '/api/content/:id/submit', content.submitContent],
  ['POST', '/api/content/:id/approve', content.approveContent],
  ['POST', '/api/content/:id/reject', content.rejectContent],
  ['POST', '/api/content/:id/cancel', content.cancelContent],
  ['POST', '/api/media', media.uploadMedia],
  ['GET', '/api/media/file/:key', media.mediaFile, { public: true }],
  ['GET', '/api/rules', writing.readRules],
  ['PUT', '/api/rules', writing.saveRules],
  ['POST', '/api/ai/write', writing.aiWrite],
  ['GET', '/api/fb/status', fb.fbStatus],
  ['GET', '/api/fb/webhook', inbox.webhookVerify, { public: true }],
  ['POST', '/api/fb/webhook', inbox.webhookReceive, { public: true, external: true }],
  ['GET', '/api/inbox', inbox.listInbox],
  ['GET', '/api/inbox/:id', inbox.readConversation],
  ['POST', '/api/inbox/:id/reply', inbox.replyConversation],
  ['GET', '/api/pages/:id/autoreply', inbox.readAutoReply],
  ['PUT', '/api/pages/:id/autoreply', inbox.saveAutoReply],
  ['GET', '/api/report', report.pageReport],
  ['GET', '/api/ads/accounts', ads.listAdAccounts],
  ['GET', '/api/ads/accounts/:id/campaigns', ads.accountCampaigns],
  ['GET', '/api/ads/campaigns/:id', ads.campaignDetail],
  ['GET', '/api/fb/connect', fb.fbConnect, { nav: true }],
  ['GET', '/api/fb/callback', fb.fbCallback, { nav: true }],
];

function match(method, pathname) {
  for (const [m, pattern, handler, opts = {}] of ROUTES) {
    if (m !== method) continue;
    const a = pattern.split('/');
    const b = pathname.split('/');
    if (a.length !== b.length) continue;
    const params = [];
    let ok = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i].startsWith(':')) params.push(decodeURIComponent(b[i]));
      else if (a[i] !== b[i]) { ok = false; break; }
    }
    if (ok) return { handler, opts, params };
  }
  return null;
}

// Chống giả mạo yêu cầu từ trang khác (CSRF): thao tác ghi phải đến từ chính trang này.
function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};

async function handleApi(request, env) {
  const url = new URL(request.url);
  const found = match(request.method, url.pathname.replace(/\/+$/, '') || '/');
  if (!found) throw new HttpError(404, 'Không tìm thấy', 'not_found');
  const { handler, opts, params } = found;

  if (request.method !== 'GET' && !opts.external && !sameOrigin(request)) {
    throw new HttpError(403, 'Yêu cầu không hợp lệ', 'bad_origin');
  }

  const user = await currentUser(env, request);
  if (!opts.public) {
    if (!user) {
      if (opts.nav) return Response.redirect(`${url.origin}/#/dang-nhap`, 302);
      throw new HttpError(401, 'Vui lòng đăng nhập', 'unauthenticated');
    }
    if (user.must_change_password && !opts.allowMustChange) {
      if (opts.nav) return Response.redirect(`${url.origin}/#/doi-mat-khau`, 302);
      throw new HttpError(403, 'Vui lòng đổi mật khẩu trước khi tiếp tục', 'must_change_password');
    }
  }
  return handler(request, env, user, ...params);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    let res;
    try {
      res = await handleApi(request, env);
    } catch (e) {
      if (e instanceof HttpError) {
        res = json({ error: e.message, code: e.code }, e.status);
      } else {
        console.error(e);
        res = json({ error: 'Lỗi hệ thống, vui lòng thử lại', code: 'internal' }, 500);
      }
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },
};
