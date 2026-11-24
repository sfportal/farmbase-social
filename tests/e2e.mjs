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
  // Quảng cáo: tài khoản act_555 (VND), 2 chiến dịch, chỉ chiến dịch 1 có số liệu.
  const ad = u.pathname.match(/^\/v[\d.]+\/(me\/adaccounts|act_\d+(?:\/campaigns|\/insights)?|700[12](?:\/insights|\/adsets|\/ads)?)$/);
  if (ad) {
    if (u.searchParams.get('access_token') !== 'ma-nguoi-dung') { res.statusCode = 400; return res.end('{"error":{"message":"Mã truy cập không hợp lệ","code":190}}'); }
    const p = ad[1];
    if (p === 'me/adaccounts' && (u.searchParams.get('fields') || '').includes('business')) { res.statusCode = 400; return res.end('{"error":{"message":"(#100) Requires business_management permission to access the field.","code":100}}'); }
    if (p === 'me/adaccounts') return res.end(JSON.stringify({ data: [{ id: 'act_555', account_id: '555', name: 'QC FarmBase', currency: 'VND', account_status: 1, amount_spent: '1500000' }] }));
    if (p === 'act_555') return res.end(JSON.stringify({ id: 'act_555', account_id: '555', name: 'QC FarmBase', currency: 'VND', account_status: 1 }));
    if (p === 'act_555/campaigns') return res.end(JSON.stringify({ data: [
      { id: '7002', name: 'Chiến dịch tạm dừng', status: 'PAUSED', effective_status: 'PAUSED', objective: 'OUTCOME_TRAFFIC', lifetime_budget: '2000000' },
      { id: '7001', name: 'Tin nhắn sầu riêng', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT', daily_budget: '200000' }] }));
    const row = { spend: '700000', impressions: '35000', reach: '20000', clicks: '900', ctr: '2.57', cpm: '20000', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '35' }, { action_type: 'link_click', value: '400' }] };
    if (p === '7001' || p === '7002') return res.end(JSON.stringify({ id: p, name: p === '7001' ? 'Tin nhắn sầu riêng' : 'Chiến dịch tạm dừng', effective_status: p === '7001' ? 'ACTIVE' : 'PAUSED', objective: 'OUTCOME_ENGAGEMENT', daily_budget: '200000', account_id: '555', start_time: '2026-11-01T08:00:00+0700' }));
    if (p.startsWith('7002/')) return res.end('{"data":[]}');
    if (p === '7001/adsets') return res.end(JSON.stringify({ data: [{ id: '8001', name: 'Nông dân Đắk Lắk', effective_status: 'ACTIVE', targeting: { age_min: 25, age_max: 55, genders: [1], geo_locations: { regions: [{ name: 'Đắk Lắk' }] } } }] }));
    if (p === '7001/ads') return res.end(JSON.stringify({ data: [{ id: '9001', name: 'Ảnh vườn sầu riêng', effective_status: 'ACTIVE', adset_id: '8001', creative: { thumbnail_url: `${BASE}/icons/icon.svg`, body: 'Nhắn tin để được tư vấn mã số vùng trồng', effective_object_story_id: '111_1' } }] }));
    if (p === '7001/insights') {
      const q = u.searchParams;
      const detail = { ...row, frequency: '1.75', cpc: '777.78', cost_per_action_type: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '20000' }] };
      if (q.get('time_increment')) return res.end(JSON.stringify({ data: [{ date_start: '2026-11-19', ...row, spend: '300000' }, { date_start: '2026-11-20', ...row, spend: '400000' }] }));
      if (q.get('level') === 'adset') return res.end(JSON.stringify({ data: [{ adset_id: '8001', ...detail }] }));
      if (q.get('level') === 'ad') return res.end(JSON.stringify({ data: [{ ad_id: '9001', ...detail }] }));
      if (q.get('breakdowns') === 'age,gender') return res.end(JSON.stringify({ data: [{ age: '25-34', gender: 'male', spend: '500000', reach: '12000', impressions: '20000', clicks: '600', actions: row.actions }, { age: '35-44', gender: 'female', spend: '200000', reach: '8000', impressions: '15000', clicks: '300' }] }));
      if (q.get('breakdowns') === 'publisher_platform') return res.end(JSON.stringify({ data: [{ publisher_platform: 'facebook', spend: '600000', reach: '18000', impressions: '30000', clicks: '800' }, { publisher_platform: 'instagram', spend: '100000', reach: '2000', impressions: '5000', clicks: '100' }] }));
      return res.end(JSON.stringify({ data: [detail] }));
    }
    if (p === 'act_555/insights') return res.end(JSON.stringify({ data: u.searchParams.get('level') === 'campaign' ? [{ campaign_id: '7001', ...row }] : [row] }));
    res.statusCode = 400; return res.end('{"error":{"message":"(#200) Không có quyền","code":200}}');
  }
  const who = u.pathname.match(/^\/v[\d.]+\/(\d+)$/);
  // Khách 901: Facebook không cho đọc hồ sơ theo id, chỉ lấy được tên qua danh sách cuộc trò chuyện của Trang.
  if (who && who[1] === '901') { res.statusCode = 400; return res.end('{"error":{"message":"Unsupported get request.","code":100}}'); }
  const cv = u.pathname.match(/^\/v[\d.]+\/(\d+)\/conversations$/);
  if (cv) return res.end(JSON.stringify({ data: u.searchParams.get('user_id') === '901' ? [{ id: 't_1', participants: { data: [{ id: '901', name: 'Nguyễn Văn Khách' }, { id: cv[1], name: 'Trang' }] } }] : [] }));
  if (who && (u.searchParams.get('fields') || '').includes('name')) return res.end(JSON.stringify({ id: who[1], name: `Khách ${who[1]}`, profile_pic: `${BASE}/icons/icon.svg` }));
  // Số lượt thích, theo dõi của Trang; lượt xem từng bài (chỉ số mới post_media_view).
  const pinfo = u.pathname.match(/^\/v[\d.]+\/(\d+)$/);
  if (pinfo && (u.searchParams.get('fields') || '').includes('fan_count') && !(u.searchParams.get('fields') || '').includes('name')) return res.end(JSON.stringify({ id: pinfo[1], fan_count: 130, followers_count: 160 }));
  const pvw = u.pathname.match(/^\/v[\d.]+\/(\d+)_(\d+)\/insights$/);
  if (pvw) {
    if (u.searchParams.get('metric') !== 'post_media_view') { res.statusCode = 400; return res.end('{"error":{"message":"(#100) invalid metric","code":100}}'); }
    return res.end(JSON.stringify({ data: [{ name: 'post_media_view', period: 'lifetime', values: [{ value: 100 * Number(pvw[2]) }] }] }));
  }
  // Page Insights: chỉ 2 chỉ số còn dùng được, các chỉ số khác Facebook báo lỗi (giống khi bị bỏ).
  const pin = u.pathname.match(/^\/v[\d.]+\/(\d+)\/insights$/);
  if (pin) {
    const metric = u.searchParams.get('metric');
    if (metric === 'page_views_total') return res.end(JSON.stringify({ data: [{ name: metric, period: 'day', values: [] }] }));
    if (!['page_post_engagements', 'page_daily_follows_unique'].includes(metric)) { res.statusCode = 400; return res.end('{"error":{"message":"(#100) The value must be a valid insights metric","code":100}}'); }
    const since = Number(u.searchParams.get('since')); const until = Number(u.searchParams.get('until'));
    const values = [];
    for (let t = since + 86400; t <= until; t += 86400) values.push({ value: metric === 'page_post_engagements' ? 10 : 1, end_time: new Date(t * 1000).toISOString().replace('.000Z', '+0000') });
    return res.end(JSON.stringify({ data: [{ name: metric, period: 'day', values }] }));
  }
  // Website giả có RSS (để thử mục Nguồn nội dung) và video của Trang.
  if (u.pathname === '/site') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end('<html><head><title>Tin Nông Nghiệp Thử</title><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>Trang chủ</body></html>'); }
  if (u.pathname === '/feed.xml') { res.setHeader('content-type', 'application/rss+xml'); return res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Tin Nông Nghiệp Thử</title>
    <item><title>Kỹ thuật bón phân sầu riêng mùa mưa</title><link>http://localhost:8791/bai/1</link><pubDate>Thu, 19 Nov 2026 08:00:00 +0700</pubDate><description><![CDATA[<img src="${BASE}/icons/icon.svg"><p>Bà con cần chia nhỏ lượng phân &amp; bón theo tán.</p>]]></description></item>
    <item><title>Giá cà phê tuần này</title><link>http://localhost:8791/bai/2</link><pubDate>Wed, 18 Nov 2026 08:00:00 +0700</pubDate><description>Giá cà phê tăng nhẹ.</description></item></channel></rss>`); }
  if (u.pathname === '/news/search') {
    res.setHeader('content-type', 'application/rss+xml');
    const q = u.searchParams.get('q');
    const d = (ago) => new Date(Date.now() - ago * 86400000).toUTCString();
    const it = (n, ago) => `<item><title>Tin ${n}: ${q.replace(/&/g, '&amp;').replace(/</g, '&lt;')} &amp;#234;</title><link>http://localhost:8791/news/apiclick.aspx?ref=1&amp;url=${encodeURIComponent(`http://localhost:8791/bai/${n}`)}&amp;c=1</link><description>Tóm tắt tin ${n}</description><pubDate>${d(ago)}</pubDate><News:Source>Báo Thử</News:Source><News:Image>${BASE}/icons/icon.svg</News:Image></item>`;
    return res.end(`<?xml version="1.0"?><rss version="2.0" xmlns:News="https://www.bing.com/news/search?q=&amp;format=rss"><channel><title>Bing</title>${it(3, 1)}${it(4, 3)}${it(5, 40)}</channel></rss>`);
  }
  if (u.pathname.startsWith('/bai/')) { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(`<html><body><nav>Menu</nav><article><h1>Kỹ thuật bón phân</h1><p>${'Bà con nên chia phân thành nhiều lần bón trong mùa mưa để cây hấp thu tốt hơn. '.repeat(6)}</p></article></body></html>`); }
  const vid = u.pathname.match(/^\/v[\d.]+\/(\d+)\/videos$/);
  if (vid) return res.end(JSON.stringify({ data: [{ id: '5501', title: 'Video thăm vườn', description: 'Thăm vườn sầu riêng vùng 07', created_time: '2026-11-20T02:00:00+0000', permalink_url: `/${vid[1]}/videos/5501/`, picture: `${BASE}/icons/icon.svg` }] }));
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
sql("DELETE FROM social_topic_suggestions; DELETE FROM social_plans; DELETE FROM social_knowledge; UPDATE social_content SET topic_id = NULL; DELETE FROM social_topics; DELETE FROM social_sources; DELETE FROM social_messages; DELETE FROM social_conversations; DELETE FROM social_settings; DELETE FROM social_content; DELETE FROM social_sessions; DELETE FROM social_user_pages; DELETE FROM social_oauth_states; DELETE FROM social_audit_log; DELETE FROM social_pages; DELETE FROM social_users;");
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
const r0sched = r.data.items;
graphWrites.length = 0;
r = await owner.req(`/api/content/${schedId}/cancel`, { method: 'POST' });
assert.equal(r.data.item.status, 'draft');
assert.equal(graphWrites[0].method, 'DELETE');
// Sửa bài đã hẹn giờ (Trang 222): tạo lịch mới trước rồi gỡ lịch cũ; biên tập viên không sửa được; phải giữ giờ hẹn
const sched2 = r0sched[1];
r = await viewer.req(`/api/content/${sched2.id}`, { method: 'PATCH', body: { message: 'biên tập sửa', scheduled_at: at } });
assert.equal(r.status, 403, 'biên tập viên không sửa bài đã hẹn giờ');
r = await owner.req(`/api/content/${sched2.id}`, { method: 'PATCH', body: { message: 'Thông báo hội thảo (sửa)', link: 'https://farmbase.vn/', scheduled_at: null } });
assert.equal(r.status, 400, 'bài hẹn giờ phải giữ giờ đăng');
graphWrites.length = 0;
const at3 = at + 3600;
r = await owner.req(`/api/content/${sched2.id}`, { method: 'PATCH', body: { message: 'Thông báo hội thảo (sửa)', link: 'https://farmbase.vn/', scheduled_at: at3 } });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.item.status, 'scheduled'); assert.equal(r.data.item.scheduled_at, at3); assert.equal(r.data.item.message, 'Thông báo hội thảo (sửa)');
assert.deepEqual(graphWrites.map((w) => [w.method, w.path]), [['POST', '/v27.0/222/feed'], ['DELETE', `/v27.0/${sched2.fb_post_id}`]]);
assert.equal(graphWrites[0].params.scheduled_publish_time, String(at3));
assert.notEqual(r.data.item.fb_post_id, sched2.fb_post_id);
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
assert.ok(['post_published', 'post_scheduled', 'post_cancelled', 'post_rescheduled', 'post_rejected', 'post_publish_failed'].every((a) => r.data.entries.some((e) => e.action === a)));
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
  assert.match(conv.customer_pic, /icon\.svg$/);
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
  assert.match(r.data.conversation.links.inbox, /^https:\/\/business\.facebook\.com\/latest\/inbox\/all\?asset_id=111&.*selected_item_id=900/);
  assert.equal(r.data.conversation.counts.in, 1);
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
  assert.equal(r.data.conversation.links.comment, 'https://www.facebook.com/111/posts/1?comment_id=c2');
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
  await hook({ object: 'page', entry: [{ id: '111', messaging: [{ sender: { id: '901' }, recipient: { id: '111' }, timestamp: nowMs, message: { mid: 'mid.in901', text: 'hi' } }] }] });
  r = await owner.req('/api/inbox?kind=message');
  assert.equal(r.data.conversations.find((c) => c.customer_id === '901').customer_name, 'Nguyễn Văn Khách', 'lấy tên dự phòng qua danh sách cuộc trò chuyện');
  r = await owner.req('/api/audit');
  assert.ok(['inbox_replied', 'autoreply_updated'].every((a) => r.data.entries.some((e) => e.action === a)));
  step('hộp thư: webhook có chữ ký, chống trùng, tin nhắn và bình luận, tự nhắn riêng khi khách bình luận, trả lời, khung 24 giờ, đúng quyền');
}

// 10d. Báo cáo hiệu quả Fanpage
{
  let r = await owner.req('/api/report?page_id=111&days=15');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.daily.length, 15);
  assert.ok(r.data.inbox.messages_in >= 2, 'đếm tin nhắn của khách');
  assert.equal(r.data.inbox.comments_in, 2, 'đếm bình luận của khách (bỏ bình luận của chính Trang)');
  assert.ok(r.data.inbox.replies >= 3); assert.ok(r.data.inbox.auto_replies >= 1);
  assert.equal(r.data.inbox_prev.messages_in, 0);
  assert.ok(r.data.inbox.median_response_secs !== null, 'tính thời gian trả lời');
  assert.equal(r.data.daily.reduce((s, x) => s + x.messages_in, 0), r.data.inbox.messages_in);
  assert.equal(r.data.metrics.page_post_engagements.total, 150); assert.equal(r.data.metrics.page_post_engagements.prev, 150);
  assert.ok(!r.data.metrics.page_views_total, 'chỉ số lỗi thì bỏ qua');
  assert.ok(r.data.errors.some((e) => e.source === 'page_views_total'));
  assert.ok(r.data.posts.posts >= 1);
  assert.deepEqual(r.data.stats, { fan_count: 130, followers_count: 160 });
  assert.ok(r.data.today.today.messages_in >= 2, 'hôm nay có tin nhắn'); assert.equal(r.data.today.yesterday.messages_in, 0);
  assert.equal(r.data.heat.length, 7); assert.equal(r.data.heat[0].length, 24);
  assert.equal(r.data.heat.flat().reduce((a, b) => a + b, 0), r.data.inbox.messages_in + r.data.inbox.comments_in, 'khung giờ đếm đủ tin của khách');
  assert.equal(r.data.views_metric, 'post_media_view');
  assert.ok(r.data.recent_posts.length >= 1 && r.data.recent_posts[0].views > 0, 'lượt xem từng bài');
  r = await owner.req('/api/report?page_id=111&days=90');
  assert.equal(r.status, 200); assert.equal(r.data.metrics.page_post_engagements.prev, null);
  r = await owner.req('/api/report?page_id=111&days=12');
  assert.equal(r.status, 400);
  r = await viewer.req('/api/report?page_id=111&days=30');
  assert.equal(r.status, 404, 'biên tập Trang 222 không xem báo cáo Trang 111');
  r = await viewer.req('/api/report?page_id=222&days=7');
  assert.equal(r.status, 200);
  assert.ok(!graphWrites.some((g) => g.path.includes('insights')));
  step('báo cáo Fanpage: tin nhắn, bình luận, trả lời, thời gian phản hồi, so với kỳ trước, bài đăng, thống kê Trang, bỏ qua chỉ số lỗi, đúng quyền');
}

// 10c. Quảng cáo (chỉ đọc)
{
  let r = await owner.req('/api/ads/accounts');
  assert.equal(r.status, 409); assert.equal(r.data.code, 'no_ads_token');
  const encU = await encryptSecret('ma-nguoi-dung', KEY);
  sql(`INSERT INTO social_settings (key, value, updated_at) VALUES ('fb_user_token', '${JSON.stringify({ enc: encU, at: 0, expires_at: null }).replace(/"/g, '\\"')}', 0);`);
  r = await owner.req('/api/ads/accounts');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.accounts.length, 1);
  assert.equal(r.data.accounts[0].id, '555'); assert.equal(r.data.accounts[0].amount_spent, 1500000);
  r = await viewer.req('/api/ads/accounts');
  assert.equal(r.status, 403, 'biên tập viên không xem quảng cáo');
  r = await owner.req('/api/ads/accounts/555/campaigns?preset=xau');
  assert.equal(r.status, 400);
  r = await owner.req('/api/ads/accounts/abc/campaigns');
  assert.equal(r.status, 400);
  r = await owner.req('/api/ads/accounts/555/campaigns?preset=last_30d');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.totals.spend, 700000); assert.equal(r.data.totals.messages, 35); assert.equal(r.data.totals.cost_per_message, 20000);
  assert.deepEqual(r.data.campaigns.map((c) => c.id), ['7001', '7002'], 'chiến dịch đang chạy lên trước');
  assert.equal(r.data.campaigns[0].daily_budget, 200000);
  assert.equal(r.data.campaigns[1].has_data, false); assert.equal(r.data.campaigns[1].insights.spend, 0);
  assert.ok(graphHits.some((h) => h.includes('act_555/insights') && h.includes('date_preset=last_30d')));
  r = await owner.req('/api/ads/campaigns/7001?preset=maximum');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.campaign.name, 'Tin nhắn sầu riêng'); assert.equal(r.data.has_data, true);
  assert.equal(r.data.totals.frequency, 1.75);
  assert.equal(r.data.totals.actions[0].label, 'Lượt nhấp liên kết');
  assert.equal(r.data.totals.actions.find((a) => a.type.includes('messaging')).cost, 20000);
  assert.equal(r.data.daily.length, 2); assert.equal(r.data.daily[1].spend, 400000);
  assert.equal(r.data.adsets[0].targeting, 'Nam, 25–55 tuổi, Đắk Lắk');
  assert.equal(r.data.ads[0].post_link, 'https://www.facebook.com/111_1'); assert.equal(r.data.ads[0].adset, 'Nông dân Đắk Lắk');
  assert.equal(r.data.demographics.length, 2); assert.equal(r.data.platforms[0].platform, 'facebook');
  r = await owner.req('/api/ads/campaigns/7002?preset=today');
  assert.equal(r.status, 200); assert.equal(r.data.has_data, false);
  r = await owner.req('/api/ads/campaigns/abc');
  assert.equal(r.status, 400);
  r = await viewer.req('/api/ads/campaigns/7001');
  assert.equal(r.status, 403);
  assert.ok(!graphWrites.some((g) => g.path.includes('act_') || g.path.includes('700')), 'không ghi gì lên tài khoản quảng cáo');
  step('quảng cáo: chưa có quyền thì báo rõ, xem tài khoản, chiến dịch, chi tiêu, kết quả theo khoảng ngày, đúng phân quyền, chỉ đọc');
}

// 10e. Nguồn nội dung: website (RSS giả) và Fanpage đã kết nối, chia sẻ hoặc AI viết lại
{
  const cs = new Client();
  r = await owner.req('/api/users', { method: 'POST', body: { email: 'cskh2@example.test', role: 'agent', page_ids: ['111'] } });
  await cs.req('/api/auth/login', { method: 'POST', body: { email: 'cskh2@example.test', password: r.data.temp_password } });
  await cs.req('/api/auth/change-password', { method: 'POST', body: { current_password: r.data.temp_password, new_password: 'NhanVien2-2026' } });
  r = await cs.req('/api/sources');
  assert.equal(r.status, 403, 'CSKH không dùng nguồn nội dung');
  r = await owner.req('/api/sources', { method: 'POST', body: { kind: 'website', url: 'http://192.168.1.5/feed' } });
  assert.equal(r.status, 400, 'chặn địa chỉ nội bộ');
  r = await owner.req('/api/sources', { method: 'POST', body: { kind: 'website', url: 'https://www.facebook.com/trang-khac' } });
  assert.equal(r.data.code, 'facebook_url');
  r = await owner.req('/api/sources', { method: 'POST', body: { kind: 'website', url: 'http://localhost:8791/site' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const webId = r.data.id;
  r = await owner.req('/api/sources', { method: 'POST', body: { kind: 'website', url: 'http://localhost:8791/site' } });
  assert.equal(r.status, 409, 'không thêm trùng');
  r = await viewer.req('/api/sources', { method: 'POST', body: { kind: 'fanpage', page_id: '111' } });
  assert.equal(r.status, 400, 'biên tập không thêm Trang không được giao');
  r = await owner.req('/api/sources', { method: 'POST', body: { kind: 'fanpage', page_id: '111' } });
  assert.equal(r.status, 201);
  const fpId = r.data.id;
  r = await owner.req('/api/sources');
  assert.equal(r.data.sources.length, 2);
  assert.equal(r.data.sources.find((s) => s.id === webId).name, 'Tin Nông Nghiệp Thử');
  assert.equal(r.data.ai_provider, 'AI thử nghiệm');
  r = await viewer.req('/api/sources');
  assert.deepEqual(r.data.sources.map((s) => s.id), [webId], 'biên tập chỉ thấy website và Trang được giao');
  r = await viewer.req(`/api/sources/${fpId}/items`);
  assert.equal(r.status, 404);
  r = await viewer.req(`/api/sources/${webId}/items`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.items.length, 2);
  assert.equal(r.data.items[0].title, 'Kỹ thuật bón phân sầu riêng mùa mưa');
  assert.equal(r.data.items[0].summary, 'Bà con cần chia nhỏ lượng phân & bón theo tán.');
  assert.ok(r.data.items[0].image.endsWith('/icons/icon.svg'));
  r = await owner.req(`/api/sources/${fpId}/items`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.items[0].type, 'video');
  assert.equal(r.data.items[0].url, 'https://www.facebook.com/111/videos/5501/');
  assert.equal(r.data.items.filter((i) => i.type === 'post').length, 3);
  // Tin tức theo từ khóa (Bing News giả): liên kết gốc, ảnh, báo đăng, bỏ tin cũ hơn 15 ngày
  r = await owner.req('/api/sources', { method: 'POST', body: { kind: 'news', keyword: ' ' } });
  assert.equal(r.status, 400);
  r = await owner.req('/api/sources', { method: 'POST', body: { kind: 'news', keyword: 'sầu riêng', site: 'https://www.nongnghiepmoitruong.vn/' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const newsId = r.data.id;
  r = await owner.req('/api/sources', { method: 'POST', body: { kind: 'news', keyword: 'sầu riêng', site: 'nongnghiepmoitruong.vn' } });
  assert.equal(r.status, 409, 'không thêm trùng từ khóa');
  r = await viewer.req('/api/sources');
  const ns = r.data.sources.find((s) => s.id === newsId);
  assert.equal(ns.kind, 'news');
  assert.equal(ns.name, 'sầu riêng (nongnghiepmoitruong.vn)');
  r = await viewer.req(`/api/sources/${newsId}/items`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.items.map((i) => i.url), ['http://localhost:8791/bai/3', 'http://localhost:8791/bai/4'], 'liên kết gốc, bỏ tin quá 15 ngày');
  assert.equal(r.data.items[0].title, 'Tin 3: sầu riêng site:nongnghiepmoitruong.vn ê');
  assert.equal(r.data.items[0].publisher, 'Báo Thử');
  assert.ok(r.data.items[0].image.endsWith('/icons/icon.svg'));
  r = await viewer.req('/api/sources/write', { method: 'POST', body: { url: 'http://localhost:8791/bai/1', title: 'Kỹ thuật bón phân', summary: 'Tóm tắt', mode: 'share', page_ids: ['222'] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.link, 'http://localhost:8791/bai/1');
  assert.ok(!r.data.text.includes('Nguồn:'));
  r = await viewer.req('/api/sources/write', { method: 'POST', body: { url: 'http://localhost:8791/bai/1', title: 'Kỹ thuật bón phân', mode: 'rewrite', length: 'vua', page_ids: ['222'] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.link, null);
  assert.ok(r.data.text.endsWith('Nguồn: http://localhost:8791/bai/1'), r.data.text);
  // Liên hệ và hashtag chuẩn: hệ thống gắn đúng dòng liên hệ, hashtag trong danh sách
  r = await owner.req('/api/rules', { method: 'PUT', body: { text: 'Biểu tượng cảm xúc: tối đa 3 biểu tượng mỗi bài. Hashtag: 2 đến 4 hashtag, luôn có #FarmBase.', contact: 'Hotline BVI: 0944 374 068 · Website: https://farmbase.vn', hashtags: '#BVI #FarmBase #MaSoVungTrong #DakLak' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await viewer.req('/api/rules');
  assert.equal(r.data.hashtags, '#BVI #FarmBase #MaSoVungTrong #DakLak');
  r = await viewer.req('/api/sources/write', { method: 'POST', body: { url: 'http://localhost:8791/bai/1', title: 'Kỹ thuật bón phân', mode: 'rewrite', page_ids: ['222'] } });
  assert.equal(r.data.text, 'Bài AI viết thử\n\nNguồn: http://localhost:8791/bai/1\nHotline BVI: 0944 374 068 · Website: https://farmbase.vn\n\n#FarmBase #BVI');
  r = await owner.req('/api/rules', { method: 'PUT', body: { text: 'Gọi khách là Quý khách. Luôn có #FarmBase.', contact: '', hashtags: '' } });
  r = await viewer.req(`/api/sources/${webId}`, { method: 'DELETE', origin: false });
  assert.equal(r.status, 403, 'xóa cần cùng nguồn');
  r = await owner.req('/api/audit');
  assert.ok(r.data.entries.some((a) => a.action === 'source_added'), 'ghi nhật ký thêm nguồn');
  // Footer riêng từng Trang và nội dung riêng khi đăng nhiều Trang
  r = await viewer.req('/api/styles/222', { method: 'PUT', body: { hotline: 'x' } });
  assert.equal(r.status, 403, 'biên tập không sửa thiết lập Trang');
  r = await owner.req('/api/styles/111', { method: 'PUT', body: { cta: '👉 Nhắn tin cho Trang A', hotline: 'Hotline A: 0911 000 111', website: 'a.vn', hashtags: '#FarmBase, #TrangA' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.style.website, 'https://a.vn');
  assert.equal(r.data.style.hashtags, '#FarmBase #TrangA');
  r = await owner.req('/api/styles/222', { method: 'PUT', body: { hotline: 'Hotline B: 0922 000 222', hashtags: '#FarmBase #TrangB', note: 'Gần gũi với bà con' } });
  assert.equal(r.status, 200);
  r = await viewer.req('/api/styles');
  assert.deepEqual(r.data.pages.map((p) => p.id), ['222']);
  assert.equal(r.data.pages[0].style.note, 'Gần gũi với bà con');
  r = await viewer.req('/api/ai/adapt', { method: 'POST', body: { text: 'Bài chung\n\nNguồn: https://bao.vn/a', page_id: '111' } });
  assert.equal(r.status, 404, 'không chỉnh cho Trang không được giao');
  r = await viewer.req('/api/ai/adapt', { method: 'POST', body: { text: 'Bài chung\n\nNguồn: https://bao.vn/a', page_id: '222' } });
  assert.equal(r.data.body, 'Bài AI viết thử [Fanpage Thử B]\n\nNguồn: https://bao.vn/a', 'giữ dòng nguồn');
  r = await owner.req('/api/content', { method: 'POST', body: { message: '', messages: { 111: 'Bản cho A', 222: 'Bản cho B' }, page_ids: ['111', '222'], action: 'draft' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(r.data.items.map((i) => [i.page_id, i.message]).sort(), [['111', 'Bản cho A'], ['222', 'Bản cho B']]);
  // Tổng quan: số liệu hộp thư theo Trang, đúng phân quyền
  r = await owner.req('/api/overview');
  assert.equal(r.status, 200);
  assert.ok(r.data.pages['111'].msg_in >= 1 && r.data.pages['111'].unread >= 0, JSON.stringify(r.data));
  r = await cs.req('/api/overview');
  assert.deepEqual(Object.keys(r.data.pages), ['111'], 'CSKH chỉ thấy Trang được giao');
  step('nguồn nội dung: thêm website và Fanpage, đọc bài, video, chia sẻ và AI viết lại có ghi nguồn, đúng phân quyền');
}

// 11. Giao diện trên máy tính và điện thoại
// 10f. Chủ đề nội dung, kho kiến thức, trợ lý AI soạn bài chờ duyệt
{
  r = await owner.req('/api/topics?page_id=111');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.topics.length, 0, 'tên Trang không khớp bộ mẫu thì không tự nạp');
  r = await viewer.req('/api/topics?page_id=111');
  assert.equal(r.status, 404, 'biên tập không xem chủ đề Trang không được giao');
  r = await viewer.req('/api/topics/seed', { method: 'POST', body: { page_id: '222', template: 'farmbase' } });
  assert.equal(r.status, 403, 'biên tập không nạp bộ mẫu');
  r = await owner.req('/api/topics/seed', { method: 'POST', body: { page_id: '111', template: '10000ha' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await owner.req('/api/topics?page_id=111');
  assert.equal(r.data.topics.length, 5);
  assert.equal(r.data.topics.reduce((a, t) => a + t.share, 0), 100, 'tỷ trọng bộ mẫu bằng 100%');
  const sub = r.data.topics[0].children[0];
  assert.equal(sub.title, 'Chiến dịch 10.000 ha trong 60 giây');
  assert.ok(sub.hook && sub.cta && sub.facts && sub.prompt_ids && sub.ads, 'chủ đề con có hook, CTA, dữ kiện, prompt, ads');
  assert.ok(r.data.brief.includes('MỤC TIÊU'), 'hồ sơ Fanpage có quy tắc bắt buộc');
  // Bộ mẫu không có câu sai quy tắc nội dung
  const all = JSON.stringify(r.data.topics);
  assert.ok(!/DurianBase|8,2 tỷ|BVI cấp mã|FarmBase cấp mã/.test(all), 'bộ mẫu đúng quy tắc');
  r = await viewer.req('/api/topics', { method: 'POST', body: { page_id: '222', title: 'Chủ đề thử B' } });
  assert.equal(r.status, 201);
  const parentB = r.data.id;
  r = await viewer.req('/api/topics', { method: 'POST', body: { page_id: '222', parent_id: parentB, title: 'Con B', hook: 'Hook B', prompt_ids: 'ha-01, xx, cd-04', keywords: 'sầu riêng' } });
  assert.equal(r.status, 201);
  const subB = r.data.id;
  r = await viewer.req('/api/topics?page_id=222');
  assert.equal(r.data.topics[0].children[0].prompt_ids, 'ha-01,cd-04', 'chỉ giữ mã prompt hợp lệ');
  r = await viewer.req(`/api/topics/${subB}`, { method: 'PATCH', body: { cta: 'Nhắn tin Fanpage' } });
  assert.equal(r.status, 200);
  r = await viewer.req(`/api/topics/${subB}`, { method: 'DELETE' });
  assert.equal(r.status, 403, 'biên tập không xóa chủ đề');
  // Kho kiến thức: nạp tài liệu có tóm tắt, phân quyền
  r = await owner.req('/api/knowledge', { method: 'POST', body: { page_id: '111', title: 'Lịch tập huấn tháng 12', body: 'Ngày 05/12/2026 tập huấn tại xã Krông Pắc cho 20 bà con, nội dung hồ sơ mã số vùng trồng.' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.digest, 'Tóm tắt tài liệu thử');
  r = await viewer.req('/api/knowledge?page_id=222');
  assert.equal(r.data.items.length, 0, 'tài liệu riêng Trang A không hiện ở Trang B');
  // Trợ lý: chạy ngay → kế hoạch tuần, bài cho ngày mai ở trạng thái chờ duyệt, có lý do và kết quả tự kiểm tra
  r = await viewer.req('/api/assistant/run', { method: 'POST', body: { page_id: '222' } });
  assert.equal(r.status, 403, 'biên tập không chạy trợ lý');
  r = await owner.req('/api/assistant/settings', { method: 'PUT', body: { page_id: '111', on: true, per_day: 1, times: ['19:30'], website: true } });
  assert.equal(r.status, 200);
  r = await owner.req('/api/assistant/run', { method: 'POST', body: { page_id: '111', steps: ['learn', 'plan', 'drafts'] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.log.some((l) => /soạn 1 bài/.test(l)), r.data.log.join(' | '));
  r = await owner.req('/api/assistant?page_id=111');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.plans.length >= 1, true, 'có kế hoạch tuần');
  assert.equal(r.data.plans.at(-1).days.length, 7);
  const draft = r.data.drafts[0];
  assert.equal(draft.status, 'pending', 'bài trợ lý soạn luôn chờ duyệt');
  assert.ok(draft.ai_meta.reason && draft.ai_meta.check && draft.ai_meta.visual && draft.ai_meta.website?.title, JSON.stringify(draft.ai_meta));
  assert.ok(draft.message.startsWith('Bài viết thử của trợ lý AI'), draft.message);
  assert.ok(draft.ai_meta.media_prompt?.includes('4:5'), 'bài trợ lý có prompt sẵn để tạo hình');
  assert.ok(draft.scheduled_at > nowS() + 3600, 'hẹn giờ ngày mai');
  r = await owner.req('/api/assistant/run', { method: 'POST', body: { page_id: '111', steps: ['drafts'] } });
  assert.ok(r.data.log.some((l) => /đã có bài/.test(l)), 'không soạn trùng ngày');
  // Góp ý để AI viết lại: lưu góp ý vào kho kiến thức
  r = await owner.req(`/api/assistant/revise/${draft.id}`, { method: 'POST', body: { feedback: 'Nhắc buổi tập huấn ngày 05/12' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.message.includes('Đã sửa theo góp ý'));
  assert.equal(r.data.message.split('Hotline A').length, 2, 'không lặp phần cuối bài');
  assert.equal(r.data.message.split('Nhắn tin cho Trang A').length, 2, 'không lặp lời kêu gọi');
  r = await owner.req('/api/knowledge?page_id=111&kind=feedback');
  assert.equal(r.data.items.length, 1);
  r = await owner.req('/api/assistant/plan-feedback', { method: 'POST', body: { page_id: '111', feedback: 'Thêm bài thư mời' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // Đề xuất cập nhật chủ đề, chấp nhận thì thêm chủ đề con
  r = await owner.req('/api/assistant/run', { method: 'POST', body: { page_id: '111', steps: ['suggest'] } });
  assert.equal(r.status, 200);
  r = await owner.req('/api/topics/suggestions?page_id=111');
  assert.equal(r.data.items.length, 1, JSON.stringify(r.data));
  r = await owner.req(`/api/topics/suggestions/${r.data.items[0].id}/accept`, { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await owner.req('/api/topics?page_id=111');
  assert.ok(r.data.topics.some((t) => t.children.some((c) => c.title === 'Chủ đề con đề xuất thử')));
  // Lịch đăng thấy bài trợ lý kèm lý do
  r = await owner.req('/api/content?page_id=111&status=pending');
  assert.ok(r.data.items.some((i) => i.ai?.reason), 'lịch đăng có ghi chú trợ lý');
  step('chủ đề nội dung, bộ mẫu, kho kiến thức, trợ lý AI lập kế hoạch tuần, soạn bài chờ duyệt, tự kiểm tra, góp ý, đề xuất cập nhật, đúng quyền');
}

// 10g. Kho ảnh, video theo Fanpage; chọn model Claude; tương tác 7/15/30 ngày; cân chỉnh tỷ trọng; thay bộ mẫu
{
  const up = (who, q) => fetch(`${BASE}/api/media?${new URLSearchParams(q)}`, { method: 'POST', headers: { cookie: who.cookie, origin: BASE, 'content-type': 'image/png' }, body: png }).then(async (x) => ({ status: x.status, data: await x.json() }));
  r = await owner.req('/api/topics?page_id=111');
  const sub1 = r.data.topics[0].children[0].id;
  r = await up(owner, { name: 'tem-qr.png', page_id: '111', topic_id: sub1, source: 'ai', note: 'prompt fb-03' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const m1 = r.data.media;
  assert.equal(m1.page_id, '111'); assert.equal(m1.topic_id, sub1); assert.equal(m1.source, 'ai');
  r = await up(viewer, { name: 'x.png', page_id: '111' });
  assert.equal(r.status, 404, 'không tải vào kho Trang không được giao');
  r = await owner.req('/api/media?page_id=111');
  assert.ok(r.data.items.some((x) => x.id === m1.id && x.topic_title && x.note === 'prompt fb-03'), JSON.stringify(r.data));
  r = await viewer.req('/api/media?page_id=111');
  assert.equal(r.status, 404, 'biên tập không xem kho Trang không được giao');
  r = await owner.req('/api/media?page_id=111&source=ai');
  assert.equal(r.data.items.length, 1);
  r = await owner.req(`/api/media/${m1.id}`, { method: 'PATCH', body: { name: 'Tem QR sầu riêng', note: 'đã sửa' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await owner.req('/api/content', { method: 'POST', body: { page_ids: ['111'], message: 'Bài có ảnh từ kho', media_ids: [m1.id] } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  r = await owner.req('/api/media?page_id=111&q=Tem%20QR');
  assert.equal(r.data.items[0].used.length, 1, 'biết file đang dùng ở bài nào');
  r = await owner.req(`/api/media/${m1.id}`, { method: 'DELETE' });
  assert.equal(r.status, 409, 'không xóa file đang dùng trong bài');
  const m2 = (await up(owner, { name: 'xoa.png', page_id: '111' })).data.media;
  r = await viewer.req(`/api/media/${m2.id}`, { method: 'DELETE' });
  assert.equal(r.status, 403, 'biên tập không xóa file');
  r = await owner.req(`/api/media/${m2.id}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  // Chọn model Claude (chỉ Chủ hệ thống)
  r = await owner.req('/api/assistant/models', { method: 'PUT', body: { write: 'claude-haiku-5-5', fast: 'claude-haiku-5-5' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await owner.req('/api/assistant/models', { method: 'PUT', body: { write: 'gpt-5', fast: 'claude-haiku-5-5' } });
  assert.equal(r.status, 400);
  r = await viewer.req('/api/assistant/models', { method: 'PUT', body: { write: 'claude-opus-5-5', fast: 'claude-haiku-5-5' } });
  assert.equal(r.status, 403);
  r = await owner.req('/api/assistant?page_id=111');
  assert.equal(r.data.model_choices.length, 3);
  assert.ok(r.data.can_models);
  // Tương tác bài đã đăng 7, 15, 30 ngày (Facebook giả)
  assert.deepEqual(r.data.engagement.windows.map((w) => w.days), [7, 15, 30], JSON.stringify(r.data.engagement));
  assert.ok(r.data.engagement.windows[2].posts >= 1, 'đọc được bài 30 ngày');
  assert.ok(r.data.engagement.top.length >= 1);
  // Đề xuất cân chỉnh tỷ trọng: chấp nhận thì đổi tỷ trọng chủ đề cha
  const tops = (await owner.req('/api/topics?page_id=111')).data.topics;
  const shares = tops.map((t, i) => ({ topic_id: t.id, share: i === 0 ? t.share + 5 : i === 1 ? t.share - 5 : t.share, title: t.title, old: t.share }));
  sql(`INSERT INTO social_topic_suggestions (page_id, topic_id, action, payload, reason, created_at) VALUES ('111', ${tops[0].id}, 'update', '${JSON.stringify({ shares }).replace(/"/g, '\\"')}', 'thu', ${nowS()})`);
  r = await owner.req('/api/topics/suggestions?page_id=111');
  const sh = r.data.items.find((x) => Array.isArray(x.payload.shares));
  assert.ok(sh, JSON.stringify(r.data));
  r = await owner.req(`/api/topics/suggestions/${sh.id}/accept`, { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await owner.req('/api/topics?page_id=111');
  assert.equal(r.data.topics[0].share, tops[0].share + 5, 'đã cân chỉnh tỷ trọng');
  // Thay bằng bộ mẫu mới nhất
  r = await viewer.req('/api/topics/seed', { method: 'POST', body: { page_id: '222', template: 'farmbase', replace: true } });
  assert.equal(r.status, 403);
  r = await owner.req('/api/topics/seed', { method: 'POST', body: { page_id: '111', template: 'farmbase', replace: true } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await owner.req('/api/topics?page_id=111');
  assert.equal(r.data.topics.length, 5);
  assert.equal(r.data.topics[0].title, 'Truy xuất nguồn gốc: minh bạch từ gốc');
  assert.equal(r.data.topics[0].share, 40);
  assert.ok(r.data.brief.includes('TRỌNG TÂM'), 'hồ sơ Fanpage theo bộ mẫu mới');
  r = await owner.req('/api/media?page_id=111');
  assert.equal(r.data.items.find((x) => x.id === m1.id).topic_id, null, 'file vẫn còn, bỏ gắn chủ đề cũ');
  // Đề xuất prompt mới cho Thư viện: duyệt thì thành Prompt bổ sung bs-01
  r = await viewer.req('/api/assistant/prompts/suggest', { method: 'POST' });
  assert.equal(r.status, 403);
  r = await owner.req('/api/assistant/prompts/suggest', { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await owner.req('/api/assistant?page_id=111');
  assert.equal(r.data.prompt_suggestions.length, 1);
  const ps = r.data.prompt_suggestions[0];
  r = await owner.req(`/api/assistant/prompts/${ps.sid}/accept`, { method: 'POST' });
  assert.equal(r.data.id, 'bs-01');
  r = await owner.req('/api/assistant?page_id=111');
  assert.equal(r.data.prompt_suggestions.length, 0);
  assert.equal(r.data.prompt_extra[0].id, 'bs-01');
  step('kho ảnh, video theo Fanpage, chọn model Claude, tương tác 7/15/30 ngày, cân chỉnh tỷ trọng, thay bộ mẫu');
}

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
  await page.goto(`${BASE}/prompt/`);
  await page.waitForSelector('#email');
  assert.ok(page.url().endsWith('/#/dang-nhap'), 'thư viện prompt: chưa đăng nhập thì về trang đăng nhập');
  await page.goto(BASE + '/');
  await page.waitForSelector('#email');
  await page.screenshot({ path: `test-output/${label}-dang-nhap.png`, fullPage: true });
  await page.fill('#email', ADMIN.email);
  await page.fill('#password', NEW_ADMIN_PW);
  await page.click('button.btn');
  await page.waitForSelector('.stat');
  for (const route of ['tong-quan', 'hop-thu', 'lich-dang', 'quy-dinh', 'fanpage', 'bai-dang', 'bao-cao', 'quang-cao', 'nguon-noi-dung', 'chu-de', 'tro-ly', 'kho-media', 'nhan-vien', 'nhat-ky', 'tai-khoan']) {
    await page.goto(`${BASE}/#/${route}`);
    await page.waitForTimeout(['bai-dang', 'lich-dang', 'quang-cao', 'bao-cao', 'nguon-noi-dung', 'chu-de', 'tro-ly', 'kho-media'].includes(route) ? 1200 : 500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${label} ${route}: tràn ngang ${overflow}px`);
    await page.screenshot({ path: `test-output/${label}-${route}.png`, fullPage: true });
  }
  // Thư viện prompt: trang độc lập, mở từ menu, email liên hệ điền từ máy chủ
  await page.goto(`${BASE}/prompt/`);
  await page.waitForSelector('.card');
  const lib = await page.evaluate(() => ({ cards: document.querySelectorAll('.card').length, token: document.body.innerText.includes('@@EMAIL@@') || JSON.stringify(window.PROMPTS).includes('@@EMAIL@@'), ct: JSON.stringify(window.PROMPTS).includes(window.__CT), overflow: document.documentElement.scrollWidth - window.innerWidth }));
  assert.ok(lib.cards > 20 && !lib.token && lib.ct && lib.overflow <= 1, `${label} thư viện prompt: ${JSON.stringify(lib)}`);
  await page.screenshot({ path: `test-output/${label}-thu-vien-prompt.png` });
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
  await page.click('[data-view="month"]');
  await page.waitForSelector('.mgrid .mi2');
  const ovm = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(ovm <= 1, `${label} lịch tháng: tràn ngang ${ovm}px`);
  assert.ok((await page.locator('.mgrid .mt img').count()) >= 1, 'lịch tháng có ảnh bài đăng');
  await page.screenshot({ path: `test-output/${label}-lich-thang.png`, fullPage: true });
  await page.click('.mgrid .mi2');
  await page.waitForSelector('.post.flash');
  await page.click('#new');
  await page.waitForSelector('#cf');
  await page.click('#aibox summary');
  await page.check('input[name=pg][value="111"]');
  await page.check('input[name=pg][value="222"]');
  await page.fill('#msg', 'Mời bà con dự tập huấn');
  await page.waitForFunction(() => document.querySelectorAll('.pvar').length === 2 && document.querySelector('[data-var="111"]').value.includes('Hotline A') && document.querySelector('[data-var="222"]').value.startsWith('Mời'));
  assert.equal(await page.inputValue('[data-var="222"]'), 'Mời bà con dự tập huấn\n\nHotline B: 0922 000 222\n\n#FarmBase #TrangB');
  await page.screenshot({ path: `test-output/${label}-soan-bai.png`, fullPage: true });
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
  await page.goto(`${BASE}/#/quang-cao?cd=7001`);
  await page.waitForSelector('.bars');
  await page.waitForTimeout(400);
  const ovc = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(ovc <= 1, `${label} chi tiết chiến dịch: tràn ngang ${ovc}px`);
  await page.screenshot({ path: `test-output/${label}-chi-tiet-chien-dich.png`, fullPage: true });
  await page.goto(`${BASE}/#/nguon-noi-dung`);
  await page.waitForSelector('[data-rew]');
  assert.equal(await page.inputValue('#ssel'), 'all', 'mặc định xem tất cả nguồn');
  assert.ok((await page.locator('.srcitem').count()) >= 5, 'gộp bài từ website và Fanpage');
  await page.fill('#skw', 'xyz khong co, bon phan');
  await page.waitForFunction(() => document.querySelectorAll('.srcitem').length === 1);
  assert.match(await page.textContent('.srccount'), /Có 1 bài khớp/);
  await page.screenshot({ path: `test-output/${label}-nguon-tu-khoa.png`, fullPage: true });
  await page.click('[data-rew]');
  await page.waitForSelector('#wgo');
  await page.check('input[name=wpg]');
  await page.click('#wgo');
  await page.waitForSelector('#cf');
  assert.ok((await page.inputValue('#msg')).includes('Nguồn: http://localhost:8791/bai/1'), 'mở form soạn bài có sẵn nội dung AI');
  await page.screenshot({ path: `test-output/${label}-nguon-ai-viet.png` });
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}/#/chu-de`);
  await page.waitForSelector('#tpage');
  await page.selectOption('#tpage', '111');
  await page.waitForSelector('[data-view-sub]');
  await page.screenshot({ path: `test-output/${label}-chu-de-111.png`, fullPage: true });
  await page.click('[data-view-sub]');
  await page.waitForSelector('.modal .tf');
  await page.screenshot({ path: `test-output/${label}-chu-de-con.png` });
  await page.click('.modal [data-prompt]');
  await page.waitForSelector('.secret.pre');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  for (const tab of ['kien-thuc', 'de-xuat', 'ho-so']) {
    await page.click(`[data-tab="${tab}"]`);
    await page.waitForTimeout(500);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(ov <= 1, `${label} chủ đề ${tab}: tràn ngang ${ov}px`);
    await page.screenshot({ path: `test-output/${label}-chu-de-${tab}.png`, fullPage: true });
  }
  await page.goto(`${BASE}/#/tro-ly`);
  await page.waitForSelector('.adraft');
  const ova = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(ova <= 1, `${label} trợ lý: tràn ngang ${ova}px`);
  await page.screenshot({ path: `test-output/${label}-tro-ly-111.png`, fullPage: true });
  await page.goto(`${BASE}/#/kho-media`);
  await page.waitForSelector('.mcard');
  const ovmk = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(ovmk <= 1, `${label} kho ảnh: tràn ngang ${ovmk}px`);
  await page.screenshot({ path: `test-output/${label}-kho-media.png`, fullPage: true });
  await page.click('.mcard');
  await page.waitForSelector('.modal .mprev');
  await page.screenshot({ path: `test-output/${label}-kho-media-chi-tiet.png` });
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}/#/nhan-vien`);
  await page.waitForSelector('#view table'); // nút Thêm chỉ hoạt động sau khi tải xong danh sách
  await page.click('#add');
  await page.waitForSelector('.modal');
  await page.screenshot({ path: `test-output/${label}-them-nhan-vien.png` });
  await ctx.close();
}
await browser.close();
fakeGraph.close();
assert.deepEqual(errors, [], errors.join('\n'));
step('giao diện máy tính 1366px và điện thoại 390px: không tràn ngang, không lỗi JS; thư viện prompt cần đăng nhập');

console.log('e2e: đạt');
