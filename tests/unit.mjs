// Kiểm tra hàm băm mật khẩu và mã hóa (chạy bằng Node 20+): node tests/unit.mjs
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, encryptSecret, decryptSecret, tempPassword } from '../src/lib/crypto.js';
import { checkPasswordStrength } from '../src/lib/http.js';

const h = await hashPassword('MatKhau-2026');
assert.ok(h.startsWith('pbkdf2$25000$'));
assert.equal(await verifyPassword('MatKhau-2026', h), true);
assert.equal(await verifyPassword('matkhau-2026', h), false);
assert.equal(await verifyPassword('x', 'rác'), false);
assert.notEqual(await hashPassword('MatKhau-2026'), h, 'mỗi lần băm phải có muối khác nhau');

const blob = await encryptSecret('EAAB-ma-trang', 'khoa-1');
assert.ok(blob.startsWith('v1:'));
assert.equal(await decryptSecret(blob, 'khoa-1'), 'EAAB-ma-trang');
await assert.rejects(() => decryptSecret(blob, 'khoa-sai'));

const t = tempPassword();
assert.match(t, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}7$/);

assert.ok(checkPasswordStrength('ngan1'));
assert.ok(checkPasswordStrength('chichucaidaithoi'));
assert.equal(checkPasswordStrength('Matkhau2026'), null);

// Nguồn nội dung: đọc RSS, Atom, WordPress; chặn địa chỉ nội bộ
const { parseFeed, parseWp, safeUrl } = await import('../src/routes/sources.js');
const atom = parseFeed('<feed><entry><title type="html">Tin &amp; bài</title><link rel="alternate" href="https://a.vn/x"/><updated>2026-11-20T00:00:00Z</updated><summary>Tóm tắt</summary></entry></feed>');
assert.equal(atom.length, 1);
assert.equal(atom[0].title, 'Tin & bài');
assert.equal(atom[0].url, 'https://a.vn/x');
const wp = parseWp([{ link: 'https://b.vn/y', date_gmt: '2026-11-20T00:00:00', title: { rendered: 'Bài &#8211; WP' }, excerpt: { rendered: '<p>Đoạn đầu</p>' } }]);
assert.equal(wp[0].url, 'https://b.vn/y');
assert.equal(wp[0].summary, 'Đoạn đầu');
for (const bad of ['http://localhost/x', 'http://10.0.0.1/', 'ftp://a.vn', 'http://[::1]/', 'khong-phai-url']) assert.throws(() => safeUrl(bad), bad);
assert.equal(safeUrl('https://farmbase.vn/blog').hostname, 'farmbase.vn');
const { parseNews, newsFeedUrl } = await import('../src/routes/sources.js');
const nowTs = Date.UTC(2026, 10, 21) / 1000;
const news = parseNews('<rss><channel><item><title>S&#7847;u ri&#234;ng</title><link>https://www.bing.com/news/apiclick.aspx?ref=x&amp;url=https%3a%2f%2fbao.vn%2fa.html&amp;c=1</link><pubDate>Thu, 19 Nov 2026 22:30:00 GMT</pubDate><News:Source>Báo A</News:Source><News:Image>https://www.bing.com/th?id=1</News:Image></item><item><title>Cũ</title><link>https://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fbao.vn%2fb.html</link><pubDate>Thu, 01 Oct 2026 22:30:00 GMT</pubDate></item></channel></rss>', nowTs);
assert.equal(news.length, 1);
assert.equal(news[0].url, 'https://bao.vn/a.html');
assert.equal(news[0].title, 'Sầu riêng');
assert.equal(news[0].image, 'https://www.bing.com/th?id=1');
assert.ok(newsFeedUrl({}, 'sầu riêng', 'bao.vn').startsWith('https://www.bing.com/news/search?q=s%E1%BA%A7u%20ri%C3%AAng%20site%3Abao.vn&format=rss'));
const { enforceStyle } = await import('../src/routes/writing.js');
const styled = enforceStyle('🌱 Tin vui! 🚀🔥🎉 Quý khách chuẩn bị.\nLiên hệ qua số 0934567890 hoặc website farmbase.vn nhé.\n#FarmBase #TuNghiRa #MaSoVungTrong', { rules: 'tối đa 3 biểu tượng mỗi bài; 2 đến 4 hashtag', contact: 'Hotline BVI: 0944 374 068', hashtags: '#BVI #FarmBase #MaSoVungTrong' });
assert.equal(styled, '🌱 Tin vui! 🚀 Quý khách chuẩn bị.\n\nHotline BVI: 0944 374 068\n\n#FarmBase #MaSoVungTrong');
assert.equal(enforceStyle('Gọi 0911 111 222 nhé. Chào bà con.', {}), 'Chào bà con.', 'bỏ số điện thoại không có trong quy định');
assert.equal(enforceStyle('Gọi 0911 111 222 nhé.', { rules: 'Liên hệ 0911 111 222' }), 'Gọi 0911 111 222 nhé.');
assert.equal(enforceStyle('Tin mới 🌱🌱🔥. Ý một ✅. Ý hai 📌. Kêu gọi 👉', { rules: '2 đến 3 biểu tượng mỗi bài' }), 'Tin mới 🌱. Ý một ✅.\n\nÝ hai 📌. Kêu gọi', 'gộp biểu tượng liền nhau, tối đa 3');
assert.equal(enforceStyle('Chào bà con.', { rules: '2 đến 3 biểu tượng mỗi bài' }), '🌱 Chào bà con.', 'thiếu biểu tượng thì thêm ở câu mở đầu');
const { shortParagraphs } = await import('../src/routes/writing.js');
const longP = 'Câu một khá dài về kỹ thuật chăm sóc vườn sầu riêng sau thu hoạch cho bà con. Câu hai nói về lịch bón phân hợp lý trong mùa mưa. Câu ba mời bà con đăng ký tham gia buổi tập huấn sắp tới.';
assert.equal(shortParagraphs(longP), 'Câu một khá dài về kỹ thuật chăm sóc vườn sầu riêng sau thu hoạch cho bà con. Câu hai nói về lịch bón phân hợp lý trong mùa mưa.\n\nCâu ba mời bà con đăng ký tham gia buổi tập huấn sắp tới.');
assert.equal(shortParagraphs('Mở đầu.\n- Ý một\n- Ý hai\nKết.'), 'Mở đầu.\n\n- Ý một\n- Ý hai\n\nKết.');
assert.equal(enforceStyle('Chào bà con.\n\nDakLak FarmBase', { strip: true }), 'Chào bà con.', 'bỏ dòng hashtag thiếu dấu #');

// Trợ lý: ngày giờ Việt Nam, kiểm tra quy tắc, đọc JSON của AI, bộ chủ đề mẫu
{
  const { vnDate, weekStart, addDays, tsAt, ruleCheck } = await import('../src/routes/assistant.js');
  const { parseJson } = await import('../src/lib/ai.js');
  const { TEMPLATES, templateFor } = await import('../src/lib/topic-templates.js');
  assert.equal(vnDate(Date.UTC(2026, 10, 23, 18, 0) / 1000), '2026-11-24', '1h sáng giờ Việt Nam đã sang ngày mới');
  assert.equal(weekStart('2026-11-29'), '2026-11-23', 'Chủ nhật thuộc tuần bắt đầu thứ Hai');
  assert.equal(weekStart('2026-11-23'), '2026-11-23');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(tsAt('2026-11-25', '19:30'), Date.UTC(2026, 10, 25, 12, 30) / 1000);
  assert.deepEqual(ruleCheck('FarmBase giúp bà con ghi nhật ký.'), []);
  assert.ok(ruleCheck('BVI cấp mã vùng trồng nhanh').length === 1);
  assert.deepEqual(ruleCheck('Việc cấp mã số vùng trồng thuộc thẩm quyền cơ quan quản lý nhà nước; BVI hỗ trợ kỹ thuật.'), []);
  assert.ok(ruleCheck('Gói Vàng 1,5 tỷ đồng', { campaign: true }).length >= 1, 'chặn chi phí tài trợ trên Fanpage chiến dịch');
  assert.ok(ruleCheck('Chiến dịch đã đạt 10.000 ha', { campaign: true }).length === 1);
  assert.ok(ruleCheck('Giải pháp số 1 cho bà con').length === 1);
  assert.ok(ruleCheck('FarmBase có trên 1.500 nông hộ, khoảng 1.600 ha').length === 1, 'không nêu số hộ, diện tích đã triển khai');
  assert.deepEqual(ruleCheck('FarmBase có trên 1.500 nông hộ', { stats: true }), [], 'được nêu khi người duyệt yêu cầu');
  assert.deepEqual(ruleCheck('Hướng tới 10.000 ha và 20.000 hộ', { campaign: true }), [], 'mục tiêu chiến dịch được nêu');
  assert.deepEqual(ruleCheck('Kế hoạch gồm 10 hội nghị'), [], 'không nhầm "hội nghị" với "hộ"');
  assert.ok(ruleCheck('Mang theo CCCD và sổ đỏ').length === 1);
  assert.ok(ruleCheck('Bà con ủy quyền cho HTX làm mã').length === 1);
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('Đây là kết quả: {"posts":[{"x":"y"}]} xong'), { posts: [{ x: 'y' }] });
  assert.equal(parseJson('không có'), null);
  assert.deepEqual(parseJson('{"posts":[{"message":"Dòng 1\nDòng 2\tx",}]}'), { posts: [{ message: 'Dòng 1\nDòng 2 x' }] }, 'sửa xuống dòng trong chuỗi và dấu phẩy thừa');
  assert.equal(templateFor('Chiến dịch 10000ha'), '10000ha');
  assert.equal(templateFor('Chiến dịch 10.000 ha'), '10000ha');
  assert.equal(templateFor('FarmBase'), 'farmbase');
  assert.equal(templateFor('HTX An Nông'), null);
  for (const [k, tpl] of Object.entries(TEMPLATES)) {
    assert.equal(tpl.topics.reduce((a, t) => a + t.share, 0), 100, `${k}: tỷ trọng 100%`);
    for (const t of tpl.topics) for (const c of t.children) {
      assert.ok(c.title && c.goal && c.hook && c.message && c.cta && c.facts && c.formats && c.visual && c.prompt_ids, `${k}/${c.title}: đủ trường`);
      assert.deepEqual(ruleCheck(`${c.hook}\n${c.message}\n${c.cta}`, { campaign: k === '10000ha' }), [], `${k}/${c.title}: đúng quy tắc`);
    }
  }
  // Mã prompt trong bộ mẫu đều có trong Thư viện prompt
  globalThis.window = {};
  await import('../public/prompt/data.js');
  await import('../public/prompt/storyboard-mau.js');
  const ids = new Set(window.PROMPTS.map((p) => p.id));
  const sbs = new Set(window.SB_MAU.map((x) => x.id));
  for (const tpl of Object.values(TEMPLATES)) for (const t of tpl.topics) for (const c of t.children) {
    for (const id of c.prompt_ids.split(',')) assert.ok(ids.has(id), `prompt ${id} có trong thư viện`);
    if (c.storyboard_id) assert.ok(sbs.has(c.storyboard_id), `storyboard ${c.storyboard_id} có trong thư viện`);
  }
}
console.log('unit: đạt');
