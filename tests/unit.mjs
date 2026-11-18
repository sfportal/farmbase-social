// Kiểm tra hàm băm mật khẩu và mã hóa (chạy bằng Node 20+): node tests/unit.mjs
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, encryptSecret, decryptSecret, tempPassword } from '../src/lib/crypto.js';
import { checkPasswordStrength } from '../src/lib/http.js';

const h = await hashPassword('MatKhau-2026');
assert.ok(h.startsWith('pbkdf2$100000$'));
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
console.log('unit: đạt');
