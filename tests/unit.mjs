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
console.log('unit: đạt');
