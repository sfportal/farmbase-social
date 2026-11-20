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
const graphWrites = [];
let fbSeq = 0;
const fakeGraph = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  graphHits.push(u.pathname + '?' + u.searchParams.toString());
  res.setHeader('content-type', 'application/json');
  if (req.method !== 'GET') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const params = Object.fromEntries(new URLSearchParams(req.method === 'DELETE' ? u.search : raw));
    const w = u.pathname.match(/^\/v[\d.]+\/(.+?)(?:\/(feed|photos|videos|messages|subscribed_apps|comments))?$/);
    const pageId = w[1];
    const token = params.access_token;
    delete params.access_token;
    graphWrites.push({ method: req.method, path: u.pathname, params, token });
    if (req.method === 'DELETE') return res.end('{"success":true}');
    const tokenOk = w[2] === 'comments' ? /^ma-trang-/.test(token || '') : token === `ma-trang-${pageId}`;
    if (!tokenOk) { res.statusCode = 400; return res.end('{"error":{"message":"Mã truy cập không hợp lệ","code":190}}'); }
    fbSeq++;
    if (w[2] === 'subscribed_apps') return res.end('{"success":true}');
    if (w[2] === 'comments') return res.end(JSON.stringify({ id: `reply${fbSeq}` }));
    if (w[2] === 'messages') {
      const rc = JSON.parse(params.recipient);
      return res.end(JSON.stringify({ recipient_id: rc.id || `psid-${rc.comment_id}`, message_id: `mid.out${fbSeq}` }));
    }
    return res.end(JSON.stringify(w[2] === 'photos' ? { id: `photo${fbSeq}`, post_id: `${pageId}_p${fbSeq}` } : { id: `${pageId}_f${fbSeq}` }));
  }
  const who = u.pathname.match(/^\/v[\d.]+\/(\d+)$/);
  if (who && u.searchParams.get('fields') === 'name') return res.end(JSON.stringify({ id: who[1], name: `Khách ${who[1]}` }));
  const m = u.pathname.match(/^\/v[\d.]+\/(\d+)\/posts$/);
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
sql("DELETE FROM social_messages; DELETE FROM social_conversations; DELETE FROM social_settings; DELETE FROM social_content; DELETE FROM social_sessions; DELETE FROM social_user_pages; DELETE FROM social_oauth_states; DELETE FROM social_audit_log; DELETE FROM social_pages; DELETE FROM social_users;");
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

// 8. Kết nối Facebook: chuyển sang hộp thoại đăng nhập của Facebook với đúng app và địa chỉ quay về
r = await owner.req('/api/fb/connect', { redirect: 'manual' });
assert.equal(r.status, 302);
assert.match(r.headers.get('location'), /^https:\/\/www\.facebook\.com\/v27\.0\/dialog\/oauth\?client_id=1683859133415974&redirect_uri=.*%2Fapi%2Ffb%2Fcallback/);
r = await new Client().req('/api/fb/connect', { redirect: 'manual' });
assert.match(r.headers.get('location'), /#\/dang-nhap/);
r = await owner.req('/api/audit');
assert.ok(r.data.entries.some((e) => e.action === 'user_created'));
step('kết nối Facebook chuyển sang hộp thoại đăng nhập; nhật ký ghi đủ thao tác');

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

// 10. Lịch đăng: soạn, gửi duyệt, duyệt, hẹn giờ, hủy lịch, từ chối, lỗi đăng (chỉ gọi Facebook giả)
const nowS = () => Math.floor(Date.now() / 1000);
// viewer = Biên tập, được giao Trang 222
r = await viewer.req('/api/content', { method: 'POST', body: { page_ids: ['222'], message: 'Bài nháp của biên tập', action: 'submit' } });
assert.equal(r.status, 201, JSON.stringify(r.data));
const pendingId = r.data.items[0].id;
assert.equal(r.data.items[0].status, 'pending');
r = await viewer.req('/api/content', { method: 'POST', body: { page_ids: ['111'], message: 'x' } });
assert.equal(r.status, 400, 'không soạn cho Trang không được giao');
r = await viewer.req('/api/content', { method: 'POST', body: { page_ids: ['222'], message: 'x', action: 'publish' } });
assert.equal(r.status, 403, 'biên tập không tự đăng được');
r = await viewer.req(`/api/content/${pendingId}/approve`, { method: 'POST' });
assert.equal(r.status, 403, 'biên tập không duyệt được');
r = await viewer.req('/api/content', { method: 'POST', body: { page_ids: ['222'], message: 'x', scheduled_at: nowS() + 40 * 86400 } });
assert.equal(r.status, 400, 'hẹn giờ quá 30 ngày');
r = await viewer.req('/api/content', { method: 'POST', body: { page_ids: ['222'], message: '', link: 'javascript:alert(1)' } });
assert.equal(r.status, 400, 'liên kết phải là http(s)');
// Chủ hệ thống từ chối, biên tập sửa và gửi lại, Chủ hệ thống duyệt đăng ngay
r = await owner.req(`/api/content/${pendingId}/reject`, { method: 'POST', body: { reason: 'Thiếu ảnh' } });
assert.equal(r.data.item.status, 'rejected');
r = await viewer.req(`/api/content/${pendingId}`, { method: 'PATCH', body: { message: 'Bài đã sửa', image_url: 'https://example.com/a.jpg' } });
assert.equal(r.data.item.status, 'draft');
r = await viewer.req(`/api/content/${pendingId}/submit`, { method: 'POST' });
assert.equal(r.data.item.status, 'pending');
graphWrites.length = 0;
r = await owner.req(`/api/content/${pendingId}/approve`, { method: 'POST' });
assert.equal(r.data.item.status, 'published', JSON.stringify(r.data));
assert.match(r.data.item.fb_post_id, /^222_p/);
assert.equal(graphWrites[0].path, '/v27.0/222/photos');
assert.equal(graphWrites[0].params.url, 'https://example.com/a.jpg');
assert.equal(graphWrites[0].params.caption, 'Bài đã sửa');
assert.equal(graphWrites[0].params.published, undefined, 'đăng ngay không gửi published=false');
r = await viewer.req(`/api/content/${pendingId}`, { method: 'PATCH', body: { message: 'sửa sau khi đăng' } });
assert.equal(r.status, 409, 'bài đã đăng không sửa được');
// Hẹn giờ trên 2 Trang một lần, rồi hủy lịch một bài
const at = nowS() + 3 * 3600;
graphWrites.length = 0;
r = await owner.req('/api/content', { method: 'POST', body: { page_ids: ['111', '222'], message: 'Thông báo hội thảo', link: 'https://farmbase.vn/', scheduled_at: at, action: 'publish' } });
assert.deepEqual(r.data.items.map((i) => i.status), ['scheduled', 'scheduled']);
assert.equal(graphWrites.length, 2);
assert.deepEqual([graphWrites[0].params.published, graphWrites[0].params.scheduled_publish_time, graphWrites[0].params.link], ['false', String(at), 'https://farmbase.vn/']);
const schedId = r.data.items[0].id;
graphWrites.length = 0;
r = await owner.req(`/api/content/${schedId}/cancel`, { method: 'POST' });
assert.equal(r.data.item.status, 'draft');
assert.equal(graphWrites[0].method, 'DELETE');
// Bước duyệt: người duyệt chọn lại Fanpage (thêm Trang 111) và giờ hẹn
r = await viewer.req('/api/content', { method: 'POST', body: { page_ids: ['222'], message: 'Bài chờ chọn Trang', action: 'submit' } });
const pickId = r.data.items[0].id;
r = await owner.req(`/api/content/${pickId}/approve`, { method: 'POST', body: { page_ids: ['999'] } });
assert.equal(r.status, 400, 'không đăng lên Trang không có');
r = await owner.req(`/api/content/${pickId}/approve`, { method: 'POST', body: { page_ids: [] } });
assert.equal(r.status, 400, 'phải chọn ít nhất một Trang');
const at2 = nowS() + 5 * 3600;
graphWrites.length = 0;
r = await owner.req(`/api/content/${pickId}/approve`, { method: 'POST', body: { page_ids: ['111', '222'], scheduled_at: at2 } });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.deepEqual(r.data.items.map((i) => [i.page_id, i.status, i.scheduled_at]), [['111', 'scheduled', at2], ['222', 'scheduled', at2]]);
assert.equal(r.data.item.id, pickId);
assert.deepEqual(graphWrites.map((w) => w.path), ['/v27.0/111/feed', '/v27.0/222/feed']);
assert.equal(graphWrites[1].params.scheduled_publish_time, String(at2));
// Quy định đăng bài và AI viết bài (AI giả trong wrangler.test.jsonc)
r = await viewer.req('/api/rules', { method: 'PUT', body: { text: 'x' } });
assert.equal(r.status, 403, 'biên tập không sửa quy định');
r = await owner.req('/api/rules', { method: 'PUT', body: { text: 'Gọi khách là Quý khách. Luôn có #FarmBase.' } });
assert.equal(r.status, 200, JSON.stringify(r.data));
r = await viewer.req('/api/rules');
assert.equal(r.data.text, 'Gọi khách là Quý khách. Luôn có #FarmBase.');
assert.equal(r.data.can_edit, false);
r = await viewer.req('/api/ai/write', { method: 'POST', body: { brief: '' } });
assert.equal(r.status, 400, 'AI cần ý chính');
r = await viewer.req('/api/ai/write', { method: 'POST', body: { brief: 'Mời dự hội thảo', page_ids: ['222'], length: 'ngan' } });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.text, 'Bài AI viết thử [theo quy định]');
// Tải ảnh, video lên kho (R2 cục bộ), Facebook giả tải về qua đường dẫn công khai
const upload = (who, bytes, type, name) => fetch(`${BASE}/api/media?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { cookie: who.cookie, origin: BASE, 'content-type': type }, body: bytes }).then(async (x) => ({ status: x.status, data: await x.json() }));
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex');
r = await upload(viewer, Buffer.from('xin chao'), 'text/plain', 'a.txt');
assert.equal(r.status, 400, 'chỉ nhận ảnh, video');
r = await upload(viewer, png, 'image/png', 'anh-1.png');
assert.equal(r.status, 201, JSON.stringify(r.data));
const img1 = r.data.media;
assert.match(img1.url, /^\/api\/media\/file\/[0-9a-f]{32}\.png$/);
let fileRes = await fetch(BASE + img1.url);
assert.equal(fileRes.status, 200);
assert.equal(fileRes.headers.get('content-type'), 'image/png');
assert.equal((await fileRes.arrayBuffer()).byteLength, png.length);
const img2 = (await upload(viewer, png, 'image/png', 'anh-2.png')).data.media;
const vid = (await upload(viewer, Buffer.alloc(2048, 1), 'video/mp4', 'clip.mp4')).data.media;
assert.equal(vid.kind, 'video');
r = await viewer.req('/api/content', { method: 'POST', body: { page_ids: ['222'], message: 'x', media_ids: [img1.id, vid.id] } });
assert.equal(r.status, 400, 'không trộn ảnh và video');
// Nhiều ảnh: tải từng ảnh ở chế độ chưa đăng rồi gắn vào một bài
graphWrites.length = 0;
r = await owner.req('/api/content', { method: 'POST', body: { page_ids: ['111'], message: 'Album ảnh vườn', media_ids: [img1.id, img2.id], action: 'publish' } });
assert.equal(r.data.items[0].status, 'published', JSON.stringify(r.data));
assert.equal(r.data.items[0].media.length, 2);
assert.deepEqual(graphWrites.map((w) => w.path), ['/v27.0/111/photos', '/v27.0/111/photos', '/v27.0/111/feed']);
assert.equal(graphWrites[0].params.published, 'false');
assert.ok(graphWrites[0].params.url.endsWith(img1.url), graphWrites[0].params.url);
assert.match(JSON.parse(graphWrites[2].params['attached_media[1]']).media_fbid, /^photo\d+$/);
assert.equal(graphWrites[2].params.message, 'Album ảnh vườn');
// Bài chỉ có video, hẹn giờ
graphWrites.length = 0;
r = await viewer.req('/api/content', { method: 'POST', body: { page_ids: ['222'], message: '', media_ids: [vid.id], action: 'submit' } });
assert.equal(r.status, 201, 'bài chỉ có video vẫn hợp lệ');
r = await owner.req(`/api/content/${r.data.items[0].id}/approve`, { method: 'POST', body: {} });
assert.equal(r.data.item.status, 'published', JSON.stringify(r.data));
assert.equal(graphWrites[0].path, '/v27.0/222/videos');
assert.ok(graphWrites[0].params.file_url.endsWith(vid.url));
// Mã Trang hỏng: bài chuyển sang lỗi, có lý do
const badEnc = await encryptSecret('ma-sai', KEY);
sql(`INSERT INTO social_pages (id, name, status, access_token_enc, connected_at, updated_at) VALUES ('333','Fanpage Lỗi','active','${badEnc}',0,0);`);
r = await owner.req('/api/content', { method: 'POST', body: { page_ids: ['333'], message: 'Thử lỗi', action: 'publish' } });
assert.equal(r.data.items[0].status, 'failed');
assert.match(r.data.items[0].last_error, /không hợp lệ/);
// Danh sách và quyền xem
r = await owner.req('/api/content');
assert.ok(r.data.counts.published >= 1 && r.data.counts.scheduled === 3 && r.data.counts.failed === 1 && r.data.counts.draft === 1, JSON.stringify(r.data.counts));
r = await viewer.req('/api/content');
assert.ok(r.data.items.every((i) => i.page_id === '222'), 'biên tập chỉ thấy bài của Trang được giao');
r = await owner.req('/api/audit');
assert.ok(['post_published', 'post_scheduled', 'post_cancelled', 'post_rejected', 'post_publish_failed'].every((a) => r.data.entries.some((e) => e.action === a)));
step('lịch đăng: gửi duyệt, từ chối, duyệt đăng ảnh, chọn Trang và giờ khi duyệt, quy định và AI viết bài, tải nhiều ảnh và video, hẹn giờ nhiều Trang, hủy lịch, báo lỗi, đúng quyền');


// 10b. Hộp thư: webhook (có chữ ký), tin nhắn, bình luận, tự nhắn riêng khi khách bình luận, trả lời, khung 24 giờ
{
  const { createHmac } = await import('node:crypto');
  const APP_SECRET = 'bi-mat-app-chi-dung-khi-thu';
  const vt = createHmac('sha256', KEY).update('fb-webhook-verify').digest('hex').slice(0, 32);
  let res = await fetch(`${BASE}/api/fb/webhook?hub.mode=subscribe&hub.verify_token=${vt}&hub.challenge=12345`);
  assert.equal(res.status, 200); assert.equal(await res.text(), '12345');
  res = await fetch(`${BASE}/api/fb/webhook?hub.mode=subscribe&hub.verify_token=sai&hub.challenge=1`);
  assert.equal(res.status, 403);
  r = await owner.req('/api/fb/status');
  assert.equal(r.data.webhook_verify_token, vt);
  const hook = async (body, sign = true) => {
    const raw = JSON.stringify(body);
    const headers = { 'content-type': 'application/json' };
    if (sign) headers['x-hub-signature-256'] = 'sha256=' + createHmac('sha256', APP_SECRET).update(raw).digest('hex');
    return fetch(`${BASE}/api/fb/webhook`, { method: 'POST', headers, body: raw });
  };
  const nowMs = Date.now();
  const msgEv = { object: 'page', entry: [{ id: '111', time: nowMs, messaging: [{ sender: { id: '900' }, recipient: { id: '111' }, timestamp: nowMs, message: { mid: 'mid.in1', text: 'Cho em hỏi giá dịch vụ' } }] }] };
  res = await hook(msgEv, false);
  assert.equal(res.status, 403, 'webhook không chữ ký bị từ chối');
  res = await hook(msgEv);
  assert.equal(res.status, 200);
  await hook(msgEv); // Facebook gửi lại: không ghi trùng
  r = await owner.req('/api/inbox');
  assert.equal(r.data.conversations.length, 1);
  const conv = r.data.conversations[0];
  assert.equal(conv.customer_name, 'Khách 900');
  assert.equal(conv.unread, 1); assert.equal(conv.can_message, true); assert.equal(r.data.unread_total, 1);
  r = await viewer.req('/api/inbox');
  assert.equal(r.data.conversations.length, 0, 'biên tập Trang 222 không thấy hộp thư Trang 111');
  r = await viewer.req(`/api/inbox/${conv.id}`);
  assert.equal(r.status, 404);
  // Trả lời tin nhắn
  graphWrites.length = 0;
  r = await owner.req(`/api/inbox/${conv.id}/reply`, { method: 'POST', body: { text: 'Chào anh, em gửi báo giá ạ' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.messages.length, 2); assert.equal(r.data.conversation.unread, 0);
  assert.equal(graphWrites[0].path, '/v27.0/111/messages');
  assert.deepEqual(JSON.parse(graphWrites[0].params.recipient), { id: '900' });
  assert.equal(graphWrites[0].params.messaging_type, 'RESPONSE');
  // Tin echo của chính tin vừa gửi không ghi trùng; tin nhân viên gửi từ Facebook thì ghi vào
  await hook({ object: 'page', entry: [{ id: '111', messaging: [{ sender: { id: '111' }, recipient: { id: '900' }, timestamp: nowMs + 1000, message: { mid: 'mid.out' + fbSeq, is_echo: true, text: 'Chào anh, em gửi báo giá ạ' } }] }] });
  await hook({ object: 'page', entry: [{ id: '111', messaging: [{ sender: { id: '111' }, recipient: { id: '900' }, timestamp: nowMs + 2000, message: { mid: 'mid.fb1', is_echo: true, text: 'Nhắn từ Facebook' } }] }] });
  r = await owner.req(`/api/inbox/${conv.id}`);
  assert.equal(r.data.messages.length, 3);
  // Quá 24 giờ: không cho gửi
  sql(`UPDATE social_conversations SET last_in_at = ${Math.floor(nowMs / 1000) - 90000} WHERE id = ${conv.id}`);
  r = await owner.req(`/api/inbox/${conv.id}/reply`, { method: 'POST', body: { text: 'Còn đó không ạ' } });
  assert.equal(r.status, 400); assert.equal(r.data.code, 'window_closed');

  // Cài tự trả lời (chỉ Chủ hệ thống, Quản lý)
  r = await viewer.req('/api/pages/222/autoreply', { method: 'PUT', body: { enabled: true, message: 'x' } });
  assert.equal(r.status, 403);
  r = await owner.req('/api/pages/111/autoreply', { method: 'PUT', body: { enabled: true, message: '' } });
  assert.equal(r.status, 400);
  r = await owner.req('/api/pages/111/autoreply', { method: 'PUT', body: { enabled: true, message: 'Chào {ten}, FarmBase đã nhận câu hỏi', public_enabled: true, public_text: 'Đã nhắn tin cho {ten} ạ' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // Khách bình luận: tự nhắn riêng + trả lời công khai, chỉ 1 lần cho mỗi bài
  graphWrites.length = 0;
  const cmt = (cid, text, from = { id: '777', name: 'Chị Lan' }) => ({ object: 'page', entry: [{ id: '111', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: cid, post_id: '111_1', from, message: text, created_time: Math.floor(nowMs / 1000) } }] }] });
  await hook(cmt('111_1_c1', 'Giá bao nhiêu vậy?'));
  assert.equal(graphWrites.length, 2, JSON.stringify(graphWrites));
  assert.equal(graphWrites[0].path, '/v27.0/111_1_c1/comments'); assert.equal(graphWrites[0].params.message, 'Đã nhắn tin cho Chị Lan ạ');
  assert.equal(graphWrites[1].path, '/v27.0/111/messages');
  assert.deepEqual(JSON.parse(graphWrites[1].params.recipient), { comment_id: '111_1_c1' });
  assert.equal(JSON.parse(graphWrites[1].params.message).text, 'Chào Chị Lan, FarmBase đã nhận câu hỏi');
  await hook(cmt('111_1_c2', 'Còn hàng không?'));
  await hook(cmt('111_1_c9', 'Trang tự bình luận', { id: '111', name: 'Fanpage Thử A' }));
  assert.equal(graphWrites.length, 2, 'không tự trả lời lần 2 cùng bài, bỏ qua bình luận của chính Trang');
  r = await owner.req('/api/inbox?kind=comment');
  assert.equal(r.data.conversations.length, 1);
  const cconv = r.data.conversations[0];
  r = await owner.req(`/api/inbox/${cconv.id}`);
  assert.equal(r.data.messages.length, 4);
  assert.equal(r.data.messages.find((m) => m.comment_id === '111_1_c1' && m.channel === 'comment').can_private, false);
  assert.equal(r.data.messages.find((m) => m.comment_id === '111_1_c2').can_private, true);
  // Nhân viên trả lời công khai và nhắn riêng bình luận thứ 2
  graphWrites.length = 0;
  r = await owner.req(`/api/inbox/${cconv.id}/reply`, { method: 'POST', body: { text: 'Dạ còn ạ', mode: 'public', comment_id: '111_1_c2' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await owner.req(`/api/inbox/${cconv.id}/reply`, { method: 'POST', body: { text: 'Em gửi chị chi tiết', mode: 'private', comment_id: '111_1_c2' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(graphWrites.map((g) => g.path), ['/v27.0/111_1_c2/comments', '/v27.0/111/messages']);
  r = await owner.req('/api/inbox?kind=message');
  assert.ok(r.data.conversations.some((c) => c.customer_id === 'psid-111_1_c1'), 'tin nhắn riêng tạo cuộc trò chuyện Messenger');
  r = await owner.req('/api/audit');
  assert.ok(['inbox_replied', 'autoreply_updated'].every((a) => r.data.entries.some((e) => e.action === a)));
  step('hộp thư: webhook có chữ ký, chống trùng, tin nhắn và bình luận, tự nhắn riêng khi khách bình luận, trả lời, khung 24 giờ, đúng quyền');
}

// 11. Giao diện trên máy tính và điện thoại
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
mkdirSync('test-output', { recursive: true });
const browser = await chromium.launch();
const errors = [];
for (const [label, viewport] of [['may-tinh', { width: 1366, height: 860 }], ['dien-thoai', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  // Ảnh thử trỏ ra ngoài (example.com) không tải được trong môi trường kiểm thử: bỏ qua lỗi tải ảnh đó.
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  await page.goto(BASE + '/');
  await page.waitForSelector('#email');
  await page.screenshot({ path: `test-output/${label}-dang-nhap.png`, fullPage: true });
  await page.fill('#email', ADMIN.email);
  await page.fill('#password', NEW_ADMIN_PW);
  await page.click('button.btn');
  await page.waitForSelector('.stat');
  for (const route of ['tong-quan', 'hop-thu', 'lich-dang', 'quy-dinh', 'fanpage', 'bai-dang', 'nhan-vien', 'nhat-ky', 'tai-khoan']) {
    await page.goto(`${BASE}/#/${route}`);
    await page.waitForTimeout(['bai-dang', 'lich-dang'].includes(route) ? 1200 : 500);
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
  await page.goto(`${BASE}/#/lich-dang`);
  await page.waitForSelector('#new');
  await page.waitForSelector('.chip');
  await page.click('#new');
  await page.waitForSelector('#cf');
  await page.click('#aibox summary');
  await page.screenshot({ path: `test-output/${label}-soan-bai.png` });
  await page.keyboard.press('Escape');
  await page.click('[data-c-approve]');
  await page.waitForSelector('#apf');
  await page.screenshot({ path: `test-output/${label}-duyet-chon-trang.png` });
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}/#/hop-thu`);
  await page.waitForSelector('.conv');
  await page.click('.conv');
  await page.waitForSelector('#rf');
  await page.screenshot({ path: `test-output/${label}-hop-thu-tro-chuyen.png` });
  await page.goto(`${BASE}/#/fanpage`);
  await page.waitForSelector('[data-auto]');
  await page.click('[data-auto]');
  await page.waitForSelector('#armsg');
  await page.screenshot({ path: `test-output/${label}-tu-tra-loi.png` });
  await page.keyboard.press('Escape');
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
