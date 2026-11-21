// Thư viện prompt: chỉ mở cho người đã đăng nhập FarmBase Social.
// Gọi đồng bộ để dữ liệu mẫu có email liên hệ trước khi trang dựng.
(function () {
  var x = new XMLHttpRequest(), r = {};
  try { x.open('GET', '/api/prompt/lien-he', false); x.send(); r = JSON.parse(x.responseText); } catch (e) { r = {}; }
  if (!r.login) { location.replace('/#/dang-nhap'); return; }
  if (r.must_change_password) { location.replace('/#/doi-mat-khau'); return; }
  window.__CT = r.email || '';
})();
