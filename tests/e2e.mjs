// Kiểm tra toàn luồng trên máy: cần `npm run dev` đang chạy ở cổng 8790 (D1 cục bộ, không đụng dữ liệu thật).
// Chạy: node tests/e2e.mjs   (ảnh chụp lưu ở test-output/)
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { encryptSecret } from '../src/lib/crypto.js';

// Máy chủ Facebook giả (cổng 8791, khớp FB_GRAPH_BASE trong wrangler.test.jsonc).
const graphHits = [];
const fakePost = (pageId, i) => ({
  id: `${pageId}_${i}`, message: `Bài thử số ${i} của Trang ${pageId}\nDòng thứ hai`, created_time: new Date(Date.UTC(2026, 10, 18 - i)).toISOString(),
  permalink_url: `https://www.facebook.com/${pageId}/posts/${i}`, status_type: 'added_photos',
  reactions: { data: [], summary: { total_count: 10 * i } }, comments: { data: [], summary: { total_count: i } }, shares: { count: i % 2 },
});
const fakeGraph = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  graphHits.push(u.pathname + '?' + u.searchParams.toString());
  const m = u.pathname.match(/^\/v[\d.]+\/(\d+)\/posts$/);
  res.setHeader('content-type', 'application/json');
  if (!m) { res.statusCode = 404; return res.end('{"error":{"message":"không có","code":100}}'); }
  if (u.searchParams.get('access_token') !== `ma-trang-${m[1]}`) { res.statusCode = 400; return res.end('{"error":{"message":"Mã truy cập không hợp lệ","code":190}}'); }
  const page2 = u.searchParams.get('after') === 'trang2';
  const ids = page2 ? [4, 5] : [1, 2, 3];
  res.end(JSON.stringify({ data: ids.map((i) => fakePost(m[1], i)), paging: page2 ? { cursors: { after: 'het' } } : { cursors: { after: 'trang2' }, next: 'https://graph/next' } }));
});
await new Promise((ok) => fakeGraph.listen(8791, ok));

const BASE = process.env.BASE || 'http://localhost:8790';
const ADMIN = { email: 'admin@example.test', password: 'MatKhauTam-2026' };
const NEW_ADMIN_PW = 'ChuHeThong-2026';

function sql(command) {
  execSync(`npx wrangler@4 d1 execute DB --local -c wrangler.test.jsonc --command "${command}"`, { stdio: 'pipe' });
}

// Làm sạch D1 cục bộ và thêm 2 Fanpage giả để thử phân quyền.
sql("DELETE FROM social_sessions; DELETE FROM social_user_pages; DELETE FROM social_oauth_states; DELETE FROM social_audit_log; DELETE FROM social_pages; DELETE FROM social_users;");
const KEY = 'khoa-thu-nghiem-chi-dung-tren-may';
const encA = await encryptSecret('ma-trang-111', KEY);
const encB = await encryptSecret('ma-trang-222', KEY);
sql(`INSERT INTO social_pages (id, name, status, fan_count, followers_count, access_token_enc, connected_at, updated_at) VALUES ('111','Fanpage Thử A','active',120,150,'${encA}',0,0), ('222','Fanpage Thử B','active',30,45,'${encB}',0,0);`);

class Client {
  constructor() { this.cookie = ''; }
  async req(path, { method = 'GET', body, origin = true, redirect = 'follow' } = {}) {
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (body) headers['content-type'] = 'application/json';
    if (origin && method !== 'GET') headers.origin = BASE;
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    return { status: res.status, data, headers: res.headers };
  }
}

const step = (name) => console.log('  ✓', name);

// 1. Đăng nhập lần đầu bằng tài khoản mặc định
const owner = new Client();
let r = await owner.req('/api/auth/login', { method: 'POST', body: { email: ADMIN.email, password: 'sai-mat-khau' } });
assert.equal(r.status, 401);
r = await owner.req('/api/auth/login', { method: 'POST', body: { email: ADMIN.email.toUpperCase(), password: ADMIN.password } });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.user.role, 'owner');
assert.equal(r.data.user.must_change_password, true);
assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
step('tạo Chủ hệ thống từ biến bí mật, đăng nhập không phân biệt hoa thường');

r = await owner.req('/api/users');
assert.equal(r.status, 403);
assert.equal(r.data.code, 'must_change_password');
r = await owner.req('/api/auth/change-password', { method: 'POST', body: { current_password: ADMIN.password, new_password: 'ngan' } });
assert.equal(r.status, 400);
r = await owner.req('/api/auth/change-password', { method: 'POST', body: { current_password: ADMIN.password, new_password: NEW_ADMIN_PW } });
assert.equal(r.status, 200);
r = await owner.req('/api/users');
assert.equal(r.status, 200);
step('bắt buộc đổi mật khẩu lần đầu, từ chối mật khẩu yếu');

// 2. Chống CSRF
r = await owner.req('/api/users', { method: 'POST', body: { email: 'x@example.test' }, origin: false });
assert.equal(r.status, 403);
step('từ chối thao tác ghi không đến từ chính trang');

// 3. Tạo nhân viên, giao Fanpage A
r = await owner.req('/api/users', { method: 'POST', body: { email: 'cskh@example.test', name: 'Nhân viên CSKH', role: 'agent', page_ids: ['111'] } });
assert.equal(r.status, 201, JSON.stringify(r.data));
const tempPw = r.data.temp_password;
const agentId = r.data.user.id;
assert.deepEqual(r.data.user.page_ids, ['111']);
r = await owner.req('/api/users', { method: 'POST', body: { email: 'cskh@example.test', role: 'agent' } });
assert.equal(r.status, 409);
r = await owner.req('/api/users', { method: 'POST', body: { email: 'b@example.test', role: 'agent', page_ids: ['999'] } });
assert.equal(r.status, 400);
step('tạo nhân viên với mật khẩu tạm, chặn email trùng và Fanpage không tồn tại');

// 4. Nhân viên đăng nhập, chỉ thấy Fanpage được giao
const agent = new Client();
r = await agent.req('/api/auth/login', { method: 'POST', body: { email: 'cskh@example.test', password: tempPw } });
assert.equal(r.status, 200);
assert.equal(r.data.user.must_change_password, true);
r = await agent.req('/api/auth/change-password', { method: 'POST', body: { current_password: tempPw, new_password: 'NhanVien-2026' } });
assert.equal(r.status, 200);
r = await agent.req('/api/pages');
assert.deepEqual(r.data.pages.map((p) => p.id), ['111']);
r = await agent.req('/api/users');
assert.equal(r.status, 403);
r = await agent.req('/api/pages/222/refresh', { method: 'POST' });
assert.equal(r.status, 403);
r = await owner.req('/api/pages');
assert.equal(r.data.pages.length, 2);
step('nhân viên chỉ thấy Fanpage được giao, không vào được mục quản trị');

// 5. Khóa tạm sau 5 lần sai
const bad = new Client();
for (let i = 0; i < 4; i++) {
  r = await bad.req('/api/auth/login', { method: 'POST', body: { email: 'cskh@example.test', password: 'sai' } });
  assert.equal(r.status, 401);
}
r = await bad.req('/api/auth/login', { method: 'POST', body: { email: 'cskh@example.test', password: 'sai' } });
assert.equal(r.status, 429);
r = await bad.req('/api/auth/login', { method: 'POST', body: { email: 'cskh@example.test', password: 'NhanVien-2026' } });
assert.equal(r.status, 429, 'đang khóa thì mật khẩu đúng cũng bị chặn');
r = await owner.req('/api/users');
assert.equal(r.data.users.find((u) => u.id === agentId).locked, true);
r = await owner.req(`/api/users/${agentId}/unlock`, { method: 'POST' });
assert.equal(r.status, 200);
r = await bad.req('/api/auth/login', { method: 'POST', body: { email: 'cskh@example.test', password: 'NhanVien-2026' } });
assert.equal(r.status, 200);
step('khóa 15 phút sau 5 lần sai, Chủ hệ thống mở khóa được');

// 6. Cấp lại mật khẩu và vô hiệu hóa đăng xuất nhân viên
r = await owner.req(`/api/users/${agentId}/reset-password`, { method: 'POST' });
assert.equal(r.status, 200);
r = await agent.req('/api/pages');
assert.equal(r.status, 401, 'cấp lại mật khẩu phải đăng xuất mọi thiết bị');
r = await owner.req(`/api/users/${agentId}`, { method: 'PATCH', body: { status: 'disabled' } });
assert.equal(r.status, 200);
r = await agent.req('/api/auth/login', { method: 'POST', body: { email: 'cskh@example.test', password: r.data.temp_password || 'x' } });
assert.equal(r.status, 403);
step('cấp lại mật khẩu đăng xuất nhân viên; tài khoản vô hiệu không đăng nhập được');

// 7. Bảo vệ Chủ hệ thống cuối cùng
r = await owner.req('/api/users');
const ownerId = r.data.users.find((u) => u.role === 'owner').id;
r = await owner.req(`/api/users/${ownerId}`, { method: 'PATCH', body: { role: 'agent' } });
assert.equal(r.status, 400);
r = await owner.req(`/api/users/${ownerId}`, { method: 'PATCH', body: { status: 'disabled' } });
assert.equal(r.status, 400);
step('không tự hạ quyền hoặc vô hiệu Chủ hệ thống cuối cùng');

// 8. Kết nối Facebook khi chưa có khóa: chuyển về trang hướng dẫn
r = await owner.req('/api/fb/connect', { redirect: 'manual' });
assert.equal(r.status, 302);
assert.match(r.headers.get('location'), /#\/fanpage\?loi=chua-cau-hinh/);
r = await new Client().req('/api/fb/connect', { redirect: 'manual' });
assert.match(r.headers.get('location'), /#\/dang-nhap/);
r = await owner.req('/api/audit');
assert.ok(r.data.entries.some((e) => e.action === 'user_created'));
step('kết nối Facebook báo thiếu cấu hình; nhật ký ghi đủ thao tác');

// 9. Bài đăng và số tương tác (đọc từ Facebook giả)
r = await owner.req('/api/pages/111/posts');
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.posts.length, 3);
assert.deepEqual([r.data.posts[2].reactions, r.data.posts[2].comments, r.data.posts[2].shares, r.data.posts[2].engagement], [30, 3, 1, 34]);
assert.equal(r.data.after, 'trang2');
assert.ok(!JSON.stringify(r.data).includes('ma-trang'), 'không lộ mã Trang ra trình duyệt');
r = await owner.req('/api/pages/111/posts?after=trang2');
assert.deepEqual(r.data.posts.map((p) => p.id), ['111_4', '111_5']);
assert.equal(r.data.after, null);
r = await owner.req('/api/posts');
assert.equal(r.data.posts.length, 6);
assert.deepEqual(new Set(r.data.posts.map((p) => p.page_id)), new Set(['111', '222']));
assert.ok(r.data.posts[0].created_time >= r.data.posts[5].created_time, 'gộp theo thời gian mới nhất');
assert.ok(graphHits.some((h) => h.includes('reactions.summary')), 'hỏi Facebook số cảm xúc');
const viewer = new Client();
r = await owner.req('/api/users', { method: 'POST', body: { email: 'bientap@example.test', role: 'editor', page_ids: ['222'] } });
const edPw = r.data.temp_password;
await viewer.req('/api/auth/login', { method: 'POST', body: { email: 'bientap@example.test', password: edPw } });
await viewer.req('/api/auth/change-password', { method: 'POST', body: { current_password: edPw, new_password: 'BienTap-2026' } });
r = await viewer.req('/api/pages/111/posts');
assert.equal(r.status, 404, 'không xem bài của Trang không được giao');
r = await viewer.req('/api/posts');
assert.deepEqual([...new Set(r.data.posts.map((p) => p.page_id))], ['222']);
step('xem bài đăng và tương tác theo Trang, tải thêm, gộp mọi Trang, đúng phân quyền');

// Trang công khai cho Meta duyệt: mở được khi chưa đăng nhập
for (const f of ['chinh-sach-quyen-rieng-tu', 'dieu-khoan', 'xoa-du-lieu']) {
  const res = await fetch(`${BASE}/${f}.html`);
  assert.equal(res.status, 200, f);
  const body = await res.text();
  assert.ok(body.includes('id="en"') && body.includes('info@bvi.vn'), f);
}
step('trang chính sách, điều khoản, xóa dữ liệu công khai, có tiếng Anh');

// 10. Giao diện trên máy tính và điện thoại
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
mkdirSync('test-output', { recursive: true });
const browser = await chromium.launch();
const errors = [];
for (const [label, viewport] of [['may-tinh', { width: 1366, height: 860 }], ['dien-thoai', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  await page.goto(BASE + '/');
  await page.waitForSelector('#email');
  await page.screenshot({ path: `test-output/${label}-dang-nhap.png`, fullPage: true });
  await page.fill('#email', ADMIN.email);
  await page.fill('#password', NEW_ADMIN_PW);
  await page.click('button.btn');
  await page.waitForSelector('.stat');
  for (const route of ['tong-quan', 'fanpage', 'bai-dang', 'nhan-vien', 'nhat-ky', 'tai-khoan']) {
    await page.goto(`${BASE}/#/${route}`);
    await page.waitForTimeout(route === 'bai-dang' ? 1200 : 500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${label} ${route}: tràn ngang ${overflow}px`);
    await page.screenshot({ path: `test-output/${label}-${route}.png`, fullPage: true });
  }
  for (const f of ['chinh-sach-quyen-rieng-tu', 'xoa-du-lieu']) {
    await page.goto(`${BASE}/${f}.html`);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(ov <= 1, `${label} ${f}: tràn ngang ${ov}px`);
    await page.screenshot({ path: `test-output/${label}-${f}.png`, fullPage: true });
  }
  await page.goto(`${BASE}/#/bai-dang?trang=111`);
  await page.waitForSelector('#more');
  await page.click('#more');
  await page.waitForFunction(() => document.querySelectorAll('.post').length === 5);
  await page.screenshot({ path: `test-output/${label}-bai-dang-mot-trang.png`, fullPage: true });
  await page.goto(`${BASE}/#/nhan-vien`);
  await page.click('#add');
  await page.waitForSelector('.modal');
  await page.screenshot({ path: `test-output/${label}-them-nhan-vien.png` });
  await ctx.close();
}
await browser.close();
fakeGraph.close();
assert.deepEqual(errors, [], errors.join('\n'));
step('giao diện máy tính 1366px và điện thoại 390px: không tràn ngang, không lỗi JS');

console.log('e2e: đạt');
