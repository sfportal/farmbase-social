// Điền email liên hệ (lấy từ máy chủ, không lưu trong repo công khai) vào dữ liệu mẫu và chữ trên trang.
(function () {
  var T = '@@EMAIL@@', E = window.__CT || 'email Salefronts';
  function fix(v) {
    if (typeof v === 'string') return v.split(T).join(E);
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) v[i] = fix(v[i]); return v; }
    if (v && typeof v === 'object') { for (var k in v) v[k] = fix(v[k]); return v; }
    return v;
  }
  ['PROMPTS', 'KHUNG', 'KHUNGS', 'KHUNGS_EN', 'DINHNGHIA', 'SB_MAU', 'TINHHUONG', 'CACHVIET'].forEach(function (n) { if (window[n] != null) window[n] = fix(window[n]); });
  var b = window.buildAIJson;
  if (b) window.buildAIJson = function () { return fix(b.apply(this, arguments)); };
  var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), n;
  while ((n = w.nextNode())) if (n.nodeValue.indexOf(T) >= 0) n.nodeValue = fix(n.nodeValue);
})();
