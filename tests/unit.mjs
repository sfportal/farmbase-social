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
console.log('unit: đạt');
