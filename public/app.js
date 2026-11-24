// FarmBase Social: giao diện một trang (định tuyến bằng #hash), dùng chung cho máy tính và điện thoại.

const $app = document.getElementById('app');
let me = null; // tài khoản đang đăng nhập

// ---------- Tiện ích ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (n) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('vi-VN'));
const fmtTime = (t) => (t ? new Date(t * 1000).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '–');

function toast(msg) {
  if (!msg) return;
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 3200);
}

// Mỗi lần chuyển trang tăng navSeq. Lệnh đọc (GET) của trang cũ trả về sau khi đã chuyển trang
// thì dừng lại (lỗi rỗng, không hiện), để trang cũ không ghi đè hoặc báo lỗi lên trang mới.
let navSeq = 0;
class StaleView extends Error { constructor() { super(''); this.stale = true; } }

async function api(path, { method = 'GET', body, quiet = false } = {}) {
  const seq = navSeq;
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (method === 'GET' && seq !== navSeq) throw new StaleView();
  if (!res.ok) {
    if (!quiet && data.code === 'unauthenticated') { me = null; go('dang-nhap'); }
    if (!quiet && data.code === 'must_change_password') { go('doi-mat-khau'); }
    const err = new Error(data.error || 'Có lỗi xảy ra, vui lòng thử lại');
    err.code = data.code;
    throw err;
  }
  return data;
}

function go(route) {
  if (location.hash !== `#/${route}`) location.hash = `#/${route}`;
  else render();
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  return { path: path || 'tong-quan', q: new URLSearchParams(query) };
}

function modal(html, onMount) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });
  document.body.appendChild(bg);
  onMount?.(bg.querySelector('.modal'), close);
  bg.querySelector('input, select, button')?.focus();
  return close;
}

function confirmBox(title, text, okLabel = 'Đồng ý', danger = false) {
  return new Promise((resolve) => {
    modal(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
      <div class="actions"><button class="btn ghost" data-no>Hủy</button><button class="btn ${danger ? 'danger' : ''}" data-yes>${esc(okLabel)}</button></div>`,
    (m, close) => {
      m.querySelector('[data-no]').onclick = () => { close(); resolve(false); };
      m.querySelector('[data-yes]').onclick = () => { close(); resolve(true); };
    });
  });
}

function showSecret(title, email, password) {
  modal(`<h2>${esc(title)}</h2>
    <p class="muted small">Mật khẩu tạm chỉ hiện một lần. Quý khách gửi riêng cho nhân viên; nhân viên phải đổi mật khẩu ở lần đăng nhập đầu.</p>
    <label>Email</label><div class="secret">${esc(email)}</div>
    <label>Mật khẩu tạm</label><div class="secret" id="pw">${esc(password)}</div>
    <div class="actions"><button class="btn ghost" data-copy>Sao chép</button><button class="btn" data-ok>Đã lưu</button></div>`,
  (m, close) => {
    m.querySelector('[data-ok]').onclick = close;
    m.querySelector('[data-copy]').onclick = async () => {
      try { await navigator.clipboard.writeText(`Email: ${email}\nMật khẩu tạm: ${password}\nĐịa chỉ: ${location.origin}`); toast('Đã sao chép'); }
      catch { toast('Không sao chép được, vui lòng chép tay'); }
    };
  });
}

// ---------- Biểu tượng ----------
const I = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  inbox: '<path d="M4 4h16v12H14l-2 3-2-3H4z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  pages: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5 6.5-5s5.7 1.5 6.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.3 0 4 1.2 4.6 3.5"/>',
  log: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.2-6 8-6s7 2 8 6"/>',
  report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  ads: '<path d="M3 10v4l11 5V5z"/><path d="M14 8a4 4 0 0 1 0 8M6 14.5 7.5 20h3l-1.3-4.3"/>',
  lib: '<path d="M4 4h5v16H4zM10 4h4v16h-4z"/><path d="m15.5 5 3.8-1 2.2 15.6-3.8 1z"/>',
  rule: '<path d="M5 3h11l3 3v15H5z"/><path d="m8.5 12 2 2 4-4M8.5 17h7"/>',
  src: '<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/><path d="m15 15 2 2 3-3"/>',
  topic: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.5 6H12v12H8.5M12 12h3.5"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 17h5"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8zM5 3l.6 1.4L7 5l-1.4.6L5 7l-.6-1.4L3 5l1.4-.6z"/>',
  post: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 13h6M7 16h10"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  media: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;

// ---------- Khung trang ----------
// Menu chia nhóm: Làm việc hằng ngày · Nội dung · Hiệu quả · Quản trị. Tài khoản nằm ở chân menu.
function navItems() {
  const staff = me.role !== 'agent';
  const mgr = me.role === 'owner' || me.role === 'manager';
  const items = [
    { r: 'tong-quan', label: 'Tổng quan', ic: 'home', sec: '' },
    { r: 'hop-thu', label: 'Hộp thư', ic: 'inbox', sec: '' },
    { r: 'lich-dang', label: 'Lịch đăng', ic: 'cal', sec: '' },
    ...(staff ? [{ r: 'tro-ly', label: 'Trợ lý AI', ic: 'ai', sec: 'Nội dung' }, { r: 'chu-de', label: 'Chủ đề nội dung', ic: 'topic', sec: 'Nội dung' }, { r: 'kho-media', label: 'Kho ảnh, video', ic: 'media', sec: 'Nội dung' }, { r: 'nguon-noi-dung', label: 'Nguồn nội dung', ic: 'src', sec: 'Nội dung' }] : []),
    { r: 'thu-vien-prompt', href: '/prompt/', label: 'Thư viện prompt', ic: 'lib', sec: 'Nội dung' },
    { r: 'bai-dang', label: 'Bài đăng', ic: 'post', sec: 'Hiệu quả' },
    { r: 'bao-cao', label: 'Báo cáo', ic: 'report', sec: 'Hiệu quả' },
    ...(mgr ? [{ r: 'quang-cao', label: 'Quảng cáo', ic: 'ads', sec: 'Hiệu quả' }] : []),
    { r: 'fanpage', label: 'Fanpage', ic: 'pages', sec: 'Quản trị' },
    { r: 'quy-dinh', label: 'Quy định đăng bài', ic: 'rule', sec: 'Quản trị' },
    ...(me.role === 'owner' ? [{ r: 'nhan-vien', label: 'Nhân viên', ic: 'users', sec: 'Quản trị' }, { r: 'nhat-ky', label: 'Nhật ký', ic: 'log', sec: 'Quản trị' }] : []),
    { r: 'tai-khoan', label: 'Tài khoản', ic: 'me', sec: 'foot' },
  ];
  return items;
}

const navLink = (i, active) => `<a href="${i.href || '#/' + i.r}" class="${i.r === active ? 'on' : ''}" ${i.r === active ? 'aria-current="page"' : ''}>${icon(i.ic)}<span>${i.label}</span>${i.r === 'hop-thu' ? '<span class="tag unread" data-unread hidden></span>' : ''}</a>`;
function navHtml(items, active) {
  let html = '';
  let sec = null;
  for (const i of items.filter((x) => x.sec !== 'foot')) {
    if (i.sec !== sec) { sec = i.sec; if (sec) html += `<div class="nsec">${esc(sec)}</div>`; }
    html += navLink(i, active);
  }
  return html;
}

function layout(active, title, sub, body, actions = '') {
  const items = navItems();
  const side = navHtml(items, active);
  const mob = ['tong-quan', 'hop-thu', 'lich-dang', me.role !== 'agent' ? 'tro-ly' : 'fanpage'].map((r) => items.find((i) => i.r === r)).filter(Boolean);
  const inMob = mob.some((i) => i.r === active);
  const mobile = mob.map((i) => `<a href="#/${i.r}" class="${i.r === active ? 'on' : ''}">${icon(i.ic)}<span>${i.label}</span>${i.r === 'hop-thu' ? '<span class="tag unread" data-unread hidden></span>' : ''}</a>`).join('')
    + `<a href="#" id="navmore" class="${inMob ? '' : 'on'}">${icon('menu')}<span>Thêm</span></a>`;
  $app.innerHTML = `<div class="shell">
    <aside class="side"><div class="brand"><img src="/icons/icon.svg" alt="">FarmBase Social</div>
      <nav class="nav" aria-label="Menu chính">${side}</nav>
      <a class="who ${active === 'tai-khoan' ? 'on' : ''}" href="#/tai-khoan" title="Tài khoản">${icon('me')}<span><b>${esc(me.name || me.email)}</b><span>${esc(me.role_label)}</span></span></a></aside>
    <main class="main"><div class="top"><div><h1>${esc(title)}</h1>${sub ? `<div class="muted">${sub}</div>` : ''}</div><div class="row">${actions}</div></div>
      <div id="view">${body}</div></main>
    <nav class="bottom" aria-label="Menu">${mobile}</nav></div>`;
  document.getElementById("navmore").onclick = (e) => {
    e.preventDefault();
    modal(`<h2>Menu</h2><nav class="nav sheet" aria-label="Menu đầy đủ">${navHtml(items, active)}${navLink(items.find((i) => i.r === 'tai-khoan'), active)}</nav>`, (m, close) => m.querySelectorAll('a').forEach((a) => a.addEventListener('click', close)));
  };
  window.scrollTo(0, 0);
  refreshUnread();
}

// Số cuộc trò chuyện chưa đọc, hiện cạnh mục Hộp thư.
async function refreshUnread(n) {
  if (n === undefined) {
    try { n = (await api('/api/inbox?unread=1', { quiet: true })).unread_total; } catch { return; }
  }
  document.querySelectorAll('[data-unread]').forEach((el) => { el.textContent = n > 99 ? '99+' : String(n); el.hidden = !n; });
}

// ---------- Đăng nhập ----------
function viewLogin() {
  $app.innerHTML = `<div class="auth"><form class="card" id="f" novalidate>
    <div class="brand"><img src="/icons/icon.svg" alt="" width="36" height="36">FarmBase Social</div>
    <p class="muted" style="margin-top:0">Đăng nhập để quản lý Fanpage, tin nhắn và bài viết.</p>
    <label for="email">Email</label><input id="email" type="email" autocomplete="username" required>
    <label for="password">Mật khẩu</label><input id="password" type="password" autocomplete="current-password" required>
    <div id="msg"></div>
    <button class="btn block" style="margin-top:18px">Đăng nhập</button>
    <p class="muted small" style="margin-bottom:0">Quên mật khẩu? Vui lòng liên hệ Chủ hệ thống để được cấp mật khẩu tạm.</p>
    <p class="muted small" style="margin-bottom:0"><a href="/chinh-sach-quyen-rieng-tu.html">Quyền riêng tư</a> · <a href="/dieu-khoan.html">Điều khoản</a> · <a href="/xoa-du-lieu.html">Xóa dữ liệu</a></p>
  </form></div>`;
  const f = document.getElementById('f');
  f.email.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button');
    btn.disabled = true;
    try {
      const d = await api('/api/auth/login', { method: 'POST', quiet: true, body: { email: f.email.value, password: f.password.value } });
      me = d.user;
      go(me.must_change_password ? 'doi-mat-khau' : 'tong-quan');
    } catch (err) {
      document.getElementById('msg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  };
}

function passwordForm(forced) {
  return `<form id="pf" novalidate>
    ${forced ? '<div class="alert warn">Đây là lần đăng nhập đầu tiên hoặc mật khẩu vừa được cấp lại. Vui lòng đặt mật khẩu mới để tiếp tục.</div>' : ''}
    <label for="cur">Mật khẩu hiện tại</label><input id="cur" type="password" autocomplete="current-password">
    <label for="nw">Mật khẩu mới</label><input id="nw" type="password" autocomplete="new-password" aria-describedby="hint">
    <div id="hint" class="muted small" style="margin-top:4px">Ít nhất 10 ký tự, có cả chữ và số.</div>
    <label for="nw2">Nhập lại mật khẩu mới</label><input id="nw2" type="password" autocomplete="new-password">
    <div id="msg"></div>
    <button class="btn ${forced ? 'block' : ''}" style="margin-top:18px">Đổi mật khẩu</button>
  </form>`;
}

function bindPasswordForm(onDone) {
  const f = document.getElementById('pf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('msg');
    if (f.nw.value !== f.nw2.value) { msg.innerHTML = '<div class="alert err">Hai lần nhập mật khẩu mới chưa khớp</div>'; return; }
    const btn = f.querySelector('button');
    btn.disabled = true;
    try {
      const d = await api('/api/auth/change-password', { method: 'POST', body: { current_password: f.cur.value, new_password: f.nw.value } });
      me = d.user;
      toast('Đã đổi mật khẩu');
      onDone();
    } catch (err) {
      msg.innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  };
}

function viewForceChange() {
  $app.innerHTML = `<div class="auth"><div class="card">
    <div class="brand"><img src="/icons/icon.svg" alt="" width="36" height="36">Đặt mật khẩu mới</div>
    <p class="muted" style="margin-top:0">${esc(me.email)}</p>${passwordForm(true)}
    <button class="btn ghost block" id="out" style="margin-top:8px">Đăng xuất</button></div></div>`;
  document.getElementById('cur').focus();
  bindPasswordForm(() => go('tong-quan'));
  document.getElementById('out').onclick = logout;
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  me = null;
  go('dang-nhap');
}

// ---------- Tổng quan: hoạt động nội dung và tình hình từng Fanpage ----------
async function viewHome() {
  layout('tong-quan', `Chào ${me.name || 'Quý khách'}`, 'Hoạt động nội dung và tình hình các Fanpage Quý khách đang quản lý', '<div class="muted">Đang tải…</div>',
    me.role !== 'agent' ? '<a class="btn" href="#/lich-dang" id="hnew">Soạn bài</a>' : '');
  const [{ pages }, cont, ov] = await Promise.all([
    api('/api/pages'),
    api('/api/content').catch(() => ({ items: [] })),
    api('/api/overview').catch(() => ({ pages: {} })),
  ]);
  const v = document.getElementById('view');
  if (!pages.length) {
    v.innerHTML = `<div class="card"><h2>Bắt đầu</h2><p class="muted">${me.role === 'owner'
      ? 'Chưa có Fanpage nào. Vào mục Fanpage và bấm "Kết nối Fanpage" để đăng nhập Facebook và chọn các Trang cần quản lý.'
      : 'Quý khách chưa được giao Fanpage nào. Vui lòng liên hệ Chủ hệ thống.'}</p>${me.role === 'owner' ? '<a class="btn" href="#/fanpage">Đến mục Fanpage</a>' : ''}</div>`;
    return;
  }
  const t = Date.now() / 1000; const week = t - 7 * 86400;
  const items = cont.items || [];
  const shown = pages.filter((p) => p.status !== 'disconnected');
  const per = Object.fromEntries(shown.map((p) => [p.id, { scheduled: 0, pending: 0, failed: 0, draft: 0, pub7: 0, last: 0, next: 0, ...(ov.pages?.[p.id] || {}) }]));
  for (const c of items) {
    const x = per[c.page_id]; if (!x) continue;
    if (c.status === 'scheduled' && c.scheduled_at > t) { x.scheduled++; if (!x.next || c.scheduled_at < x.next) x.next = c.scheduled_at; }
    if (c.status === 'pending') x.pending++;
    if (c.status === 'failed') x.failed++;
    if (c.status === 'draft' || c.status === 'rejected') x.draft++;
    if (c.status === 'published') { if (c.published_at >= week) x.pub7++; if (c.published_at > x.last) x.last = c.published_at; }
  }
  const sum = (k) => Object.values(per).reduce((a, x) => a + (x[k] || 0), 0);
  const active = shown.filter((p) => p.status === 'active');
  const errors = shown.filter((p) => p.status === 'error');
  const followers = active.reduce((a, p) => a + (p.followers_count || 0), 0);
  const upcoming = items.filter((c) => c.status === 'scheduled' && c.scheduled_at > t).sort((a, b) => a.scheduled_at - b.scheduled_at).slice(0, 6);
  const recent = items.filter((c) => c.status === 'published').sort((a, b) => (b.published_at || 0) - (a.published_at || 0)).slice(0, 5);
  const kpi = (label, n, sub, href, attn) => `<a class="card stat kpi ${attn ? 'attn' : ''}" href="${href}"><div class="muted small">${label}</div><div class="n">${fmtNum(n)}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</a>`;
  const row = (c, when) => `<a class="hrow" href="#/lich-dang" data-hgo="${c.id}"><span class="mt">${itemThumb(c) || ''}</span>
      <span class="grow"><span class="small"><b>${esc(when)}</b> · ${esc(c.page_name)}</span><span class="muted small ellipsis">${esc((c.message || '(Bài chỉ có ảnh, video hoặc liên kết)').split('\n')[0])}</span></span></a>`;
  const todo = [
    sum('pending') && (me.role === 'owner' || me.role === 'manager') ? `<a class="todo" href="#/lich-dang" data-hst="pending"><b>${sum('pending')}</b> bài chờ duyệt</a>` : '',
    sum('pending') && !(me.role === 'owner' || me.role === 'manager') ? `<a class="todo" href="#/lich-dang" data-hst="pending"><b>${sum('pending')}</b> bài đang chờ Quản lý duyệt</a>` : '',
    sum('failed') ? `<a class="todo err" href="#/lich-dang" data-hst="failed"><b>${sum('failed')}</b> bài đăng lỗi, cần đăng lại</a>` : '',
    sum('waiting') ? `<a class="todo" href="#/hop-thu"><b>${sum('waiting')}</b> khách đang chờ trả lời (7 ngày)</a>` : '',
    sum('unread') ? `<a class="todo" href="#/hop-thu"><b>${sum('unread')}</b> tin nhắn, bình luận chưa đọc</a>` : '',
    errors.length ? `<a class="todo err" href="#/fanpage"><b>${errors.length}</b> Fanpage lỗi kết nối</a>` : '',
    sum('draft') && me.role !== 'agent' ? `<a class="todo" href="#/lich-dang" data-hst="draft"><b>${sum('draft')}</b> bài nháp chưa gửi</a>` : '',
  ].filter(Boolean);
  v.innerHTML = `
    <div class="kpis">
      ${kpi('Fanpage đang hoạt động', active.length, `trên ${shown.length} Trang`, '#/fanpage', errors.length)}
      ${kpi('Người theo dõi', followers, 'tổng các Trang', '#/bao-cao')}
      ${kpi('Chưa đọc', sum('unread'), `${fmtNum(sum('waiting'))} khách chờ trả lời`, '#/hop-thu', sum('waiting'))}
      ${kpi('Chờ duyệt', sum('pending'), `${fmtNum(sum('failed'))} bài lỗi`, '#/lich-dang', sum('failed'))}
      ${kpi('Hẹn giờ sắp đăng', sum('scheduled'), upcoming[0] ? `gần nhất ${fmtTime(upcoming[0].scheduled_at)}` : 'chưa có lịch', '#/lich-dang')}
      ${kpi('Đã đăng 7 ngày', sum('pub7'), `${fmtNum(sum('msg_in'))} tin nhắn · ${fmtNum(sum('cmt_in'))} bình luận`, '#/bai-dang')}
    </div>
    <div class="ovgrid">
      <div class="card"><div class="row between"><h2>Sắp đăng</h2><a class="small" href="#/lich-dang" data-hview="month">Xem lịch tháng</a></div>
        ${upcoming.length ? upcoming.map((c) => row(c, fmtTime(c.scheduled_at))).join('') : `<p class="muted small" style="margin:0">Chưa có bài hẹn giờ.${me.role !== 'agent' ? ' <a href="#/lich-dang">Soạn bài</a> hoặc lấy ý tưởng ở <a href="#/nguon-noi-dung">Nguồn nội dung</a>.' : ''}</p>`}
        ${recent.length ? `<h3 class="sub">Vừa đăng</h3>${recent.map((c) => row(c, fmtTime(c.published_at))).join('')}` : ''}
      </div>
      <div class="card"><h2>Cần xử lý</h2>
        ${todo.length ? `<div class="todos">${todo.join('')}</div>` : '<p class="muted small" style="margin:0">Không có việc tồn đọng. Mọi thứ đang ổn.</p>'}
      </div>
    </div>
    <h2 class="sec">Từng Fanpage</h2>
    <div class="pcards">${shown.map((p) => { const x = per[p.id]; const [sl, sc] = STATUS[p.status] || [p.status, 'off']; return `<div class="card pcard">
      <div class="row pch">${p.picture_url ? `<img class="av" src="${esc(p.picture_url)}" alt="" referrerpolicy="no-referrer">` : '<span class="av"></span>'}
        <div class="grow"><b class="ellipsis">${esc(p.name)}</b><div class="small"><span class="badge ${sc}">${sl}</span>${x.next ? ` <span class="muted">· Bài kế tiếp ${fmtTime(x.next)}</span>` : ''}</div></div></div>
      <div class="pm">
        <div><span>${fmtNum(p.followers_count || 0)}</span>theo dõi</div><div><span>${fmtNum(p.fan_count || 0)}</span>lượt thích</div>
        <div class="${x.unread ? 'hot' : ''}"><span>${fmtNum(x.unread)}</span>chưa đọc</div><div class="${x.waiting ? 'hot' : ''}"><span>${fmtNum(x.waiting)}</span>chờ trả lời</div>
        <div><span>${fmtNum(x.msg_in)}</span>tin nhắn 7 ngày</div><div><span>${fmtNum(x.cmt_in)}</span>bình luận 7 ngày</div>
        <div><span>${fmtNum(x.pub7)}</span>đã đăng 7 ngày</div><div><span>${fmtNum(x.scheduled)}</span>hẹn giờ</div>
      </div>
      <div class="muted small">${x.last ? `Bài gần nhất: ${fmtTime(x.last)}` : 'Chưa có bài đăng qua hệ thống'}${x.pending ? ` · ${x.pending} chờ duyệt` : ''}${x.failed ? ` · <span class="err-t">${x.failed} lỗi</span>` : ''}</div>
      <div class="row pact"><a class="btn ghost sm" href="#/bao-cao" data-hrep="${esc(p.id)}">Báo cáo</a><a class="btn ghost sm" href="#/hop-thu">Hộp thư</a>${me.role !== 'agent' ? `<a class="btn ghost sm" href="#/lich-dang" data-hpage="${esc(p.id)}">Lịch đăng</a>` : ''}</div>
    </div>`; }).join('')}</div>`;
  v.querySelectorAll('[data-hst]').forEach((a) => (a.onclick = () => { calState.status = a.dataset.hst; calState.view = 'list'; }));
  v.querySelectorAll('[data-hview]').forEach((a) => (a.onclick = () => { calState.view = 'month'; calState.status = ''; }));
  v.querySelectorAll('[data-hgo]').forEach((a) => (a.onclick = () => { calState.view = 'list'; calState.status = ''; }));
  v.querySelectorAll('[data-hpage]').forEach((a) => (a.onclick = () => { calState.page = a.dataset.hpage; calState.status = ''; }));
  v.querySelectorAll('[data-hrep]').forEach((a) => (a.onclick = () => { repState.page = a.dataset.hrep; }));
}

// ---------- Fanpage ----------
const STATUS = { active: ['Đang hoạt động', ''], error: ['Lỗi kết nối', 'err'], disconnected: ['Đã ngắt', 'off'] };

async function viewPages(q) {
  const owner = me.role === 'owner';
  const canRefresh = owner || me.role === 'manager';
  layout('fanpage', 'Fanpage', 'Các Trang Facebook đã kết nối với hệ thống', '<div class="muted">Đang tải…</div>',
    owner ? '<a class="btn" href="/api/fb/connect">Kết nối Fanpage</a>' : '');
  let notice = '';
  if (q.get('ket-noi')) notice = `<div class="alert ok">Đã kết nối ${esc(q.get('ket-noi'))} Fanpage.</div>`;
  const err = q.get('loi');
  if (err === 'chua-cau-hinh') notice = '<div class="alert warn">Chưa cài đặt khóa Facebook trên Cloudflare (FB_APP_SECRET, TOKEN_KEY). Xem hướng dẫn trong docs/CAI-DAT.md.</div>';
  if (err === 'huy') notice = '<div class="alert warn">Quý khách đã hủy đăng nhập Facebook.</div>';
  if (err === 'het-han') notice = '<div class="alert err">Phiên kết nối đã hết hạn, vui lòng bấm "Kết nối Fanpage" lại.</div>';
  if (err === 'facebook') notice = `<div class="alert err">Facebook báo lỗi: ${esc(q.get('chi-tiet') || '')}</div>`;

  const [{ pages }, status] = await Promise.all([api('/api/pages'), owner ? api('/api/fb/status') : Promise.resolve(null)]);
  const setup = status && (!status.has_secret || !status.has_token_key)
    ? `<div class="alert warn">Cần cài đặt trước khi kết nối: ${!status.has_secret ? '<code>FB_APP_SECRET</code> ' : ''}${!status.has_token_key ? '<code>TOKEN_KEY</code>' : ''}. Địa chỉ chuyển hướng cần khai báo trong app Facebook: <code>${esc(status.redirect_uri)}</code></div>` : '';

  const rows = pages.map((p) => {
    const [label, cls] = STATUS[p.status] || [p.status, 'off'];
    return `<div class="list-item">
      ${p.picture_url ? `<img class="avatar" src="${esc(p.picture_url)}" alt="" referrerpolicy="no-referrer">` : '<div class="avatar"></div>'}
      <div class="grow"><div class="ellipsis"><b>${esc(p.name)}</b> <span class="badge ${cls}">${label}</span></div>
        <div class="muted small">${fmtNum(p.followers_count)} người theo dõi · ${fmtNum(p.fan_count)} lượt thích${owner ? ` · ${p.staff_count} nhân viên được giao` : ''}</div>
        <div class="muted small">Cập nhật: ${fmtTime(p.stats_at)}${p.last_error ? ` · ${esc(p.last_error)}` : ''}</div></div>
      <div class="row"><a class="btn ghost sm" href="#/bai-dang?trang=${encodeURIComponent(p.id)}">Bài đăng</a>${canRefresh ? `<button class="btn ghost sm" data-auto="${esc(p.id)}" data-name="${esc(p.name)}">Tự trả lời</button><button class="btn ghost sm" data-refresh="${esc(p.id)}">Cập nhật</button>` : ''}
        ${owner ? `<button class="btn ghost sm" data-staff="${esc(p.id)}" data-name="${esc(p.name)}">Giao nhân viên</button><button class="btn danger sm" data-disc="${esc(p.id)}" data-name="${esc(p.name)}">Ngắt</button>` : ''}</div></div>`;
  }).join('');
  document.getElementById('view').innerHTML = `${notice}${setup}<div class="card">${rows || `<p class="muted" style="margin:0">${owner ? 'Chưa có Fanpage nào. Bấm "Kết nối Fanpage", đăng nhập Facebook và chọn các Trang Quý khách quản trị.' : 'Quý khách chưa được giao Fanpage nào.'}</p>`}</div>
    ${owner ? '<p class="muted small">Kết nối lại bất cứ lúc nào để thêm Trang mới hoặc làm mới mã truy cập. Mã truy cập được mã hóa trước khi lưu.</p>' : ''}
    ${status && status.webhook_url ? `<details class="card hook"><summary><b>Cài đặt nhận tin nhắn, bình luận (webhook)</b></summary>
      <p class="muted small">Khai báo một lần trong app Facebook (mục Webhooks của Messenger và của Page). Sau đó bấm "Cập nhật" ở từng Trang để Trang bắt đầu gửi tin nhắn, bình luận về hệ thống.</p>
      <label>Callback URL</label><div class="secret">${esc(status.webhook_url)}</div>
      <label>Verify token</label><div class="secret">${esc(status.webhook_verify_token)}</div>
      <p class="muted small">Trường cần đăng ký: <code>messages</code>, <code>message_echoes</code> (Messenger) và <code>feed</code> (Page).</p></details>` : ''}`;

  document.querySelectorAll('[data-refresh]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await api(`/api/pages/${encodeURIComponent(b.dataset.refresh)}/refresh`, { method: 'POST' }); toast('Đã cập nhật số liệu'); viewPages(new URLSearchParams()); }
    catch (e) { toast(e.message); b.disabled = false; }
  }));
  document.querySelectorAll('[data-auto]').forEach((b) => (b.onclick = () => openAutoReply(b.dataset.auto, b.dataset.name)));
  document.querySelectorAll('[data-staff]').forEach((b) => (b.onclick = () => openPageStaff(b.dataset.staff, b.dataset.name)));
  document.querySelectorAll('[data-disc]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Ngắt kết nối Fanpage?', `Hệ thống sẽ xóa mã truy cập của "${b.dataset.name}" và dừng mọi việc tự động trên Trang này. Có thể kết nối lại sau.`, 'Ngắt kết nối', true))) return;
    try { await api(`/api/pages/${encodeURIComponent(b.dataset.disc)}/disconnect`, { method: 'POST' }); toast('Đã ngắt kết nối'); viewPages(new URLSearchParams()); }
    catch (e) { toast(e.message); }
  }));
}

// Giao Fanpage cho nhân viên ngay tại mục Fanpage (chỉ Chủ hệ thống). Lưu vào danh sách Trang của từng người.
function openPageStaff(pageId, pageName) {
  modal(`<h2>Giao nhân viên cho Fanpage</h2><p class="muted small" style="margin-top:0">${esc(pageName)}</p><div id="psbox" class="muted">Đang tải…</div>`, async (m, close) => {
    let users;
    try { ({ users } = await api('/api/users')); } catch (e) { m.querySelector('#psbox').textContent = e.message; return; }
    const staff = users.filter((u) => u.role !== 'owner');
    m.querySelector('#psbox').outerHTML = `
      <p class="muted small">Đánh dấu những người được làm việc trên Trang này. Chủ hệ thống luôn thấy mọi Fanpage.</p>
      ${staff.length ? staff.map((u) => `<label class="check"><input type="checkbox" data-uid="${u.id}" ${u.page_ids.includes(pageId) ? 'checked' : ''}> <span><b>${esc(u.name || u.email)}</b> <span class="muted small">${esc(u.role_label)}${u.status === 'disabled' ? ' · đã vô hiệu' : ''}</span></span></label>`).join('')
        : '<div class="muted small">Chưa có nhân viên. Vào mục Nhân viên để thêm tài khoản.</div>'}
      <div id="psmsg"></div>
      <div class="actions"><button class="btn ghost" data-x>Đóng</button>${staff.length ? '<button class="btn" data-save>Lưu</button>' : ''}</div>`;
    m.querySelector('[data-x]').onclick = close;
    const save = m.querySelector('[data-save]');
    if (save) save.onclick = async () => {
      save.disabled = true;
      try {
        for (const u of staff) {
          const on = m.querySelector(`[data-uid="${u.id}"]`).checked;
          if (on === u.page_ids.includes(pageId)) continue;
          const page_ids = on ? [...u.page_ids, pageId] : u.page_ids.filter((x) => x !== pageId);
          await api(`/api/users/${u.id}`, { method: 'PATCH', body: { page_ids } });
        }
        toast('Đã lưu nhân viên được giao'); close(); viewPages(new URLSearchParams());
      } catch (e) { m.querySelector('#psmsg').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; save.disabled = false; }
    };
  });
}

// ---------- Hộp thư ----------
const CHANNEL = { message: '', comment: 'Bình luận', public_reply: 'Trả lời bình luận', private_reply: 'Nhắn riêng' };
const inboxState = { kind: '', page: '', unread: false };

function openAutoReply(pageId, pageName) {
  modal(`<h2>Tự trả lời khi khách bình luận</h2><p class="muted small" style="margin-top:0">${esc(pageName)}</p><div id="arbox" class="muted">Đang tải…</div>`, async (m, close) => {
    let d;
    try { d = await api(`/api/pages/${encodeURIComponent(pageId)}/autoreply`); } catch (e) { m.querySelector('#arbox').textContent = e.message; return; }
    const a = d.autoreply;
    m.querySelector('#arbox').outerHTML = `
      <p class="muted small">Khi khách bình luận lần đầu trên một bài, hệ thống tự gửi. Mỗi khách chỉ nhận 1 lần cho mỗi bài. Viết <code>{ten}</code> để chèn tên khách.</p>
      <label class="check"><input type="checkbox" id="aron" ${a.enabled ? 'checked' : ''}> Nhắn tin riêng (Messenger) cho khách</label>
      <textarea id="armsg" rows="4" maxlength="2000" placeholder="Ví dụ: Chào {ten}, cảm ơn Quý khách đã quan tâm. FarmBase xin gửi thông tin chi tiết…">${esc(a.message)}</textarea>
      <label class="check"><input type="checkbox" id="arpub" ${a.public_enabled ? 'checked' : ''}> Trả lời công khai dưới bình luận</label>
      <textarea id="artxt" rows="2" maxlength="1000" placeholder="Ví dụ: FarmBase đã nhắn tin cho {ten}, Quý khách kiểm tra hộp thư nhé.">${esc(a.public_text)}</textarea>
      <p class="muted small">Tin nhắn gửi thật tới khách trên Facebook. Facebook chỉ cho nhắn riêng 1 lần cho mỗi bình luận, trong vòng 7 ngày.</p>
      <div class="actions"><button class="btn ghost" data-x>Đóng</button>${d.can_edit ? '<button class="btn" data-save>Lưu</button>' : ''}</div>`;
    m.querySelector('[data-x]').onclick = close;
    const save = m.querySelector('[data-save]');
    if (save) save.onclick = async () => {
      save.disabled = true;
      try {
        await api(`/api/pages/${encodeURIComponent(pageId)}/autoreply`, { method: 'PUT', body: {
          enabled: m.querySelector('#aron').checked, message: m.querySelector('#armsg').value,
          public_enabled: m.querySelector('#arpub').checked, public_text: m.querySelector('#artxt').value } });
        toast('Đã lưu cài đặt tự trả lời'); close();
      } catch (e) { toast(e.message); save.disabled = false; }
    };
  });
}

const custAvatar = (c, big = false) => c.customer_pic
  ? `<img class="avatar ${big ? 'big' : 'ini'}" src="${esc(c.customer_pic)}" alt="" referrerpolicy="no-referrer">`
  : `<div class="avatar ini ${big ? 'big' : ''}">${esc((c.customer_name || '?').trim().charAt(0).toUpperCase())}</div>`;

async function viewInbox(q) {
  const cid = Number(q.get('c')) || 0;
  layout('hop-thu', 'Hộp thư', 'Tin nhắn Messenger và bình luận của các Fanpage Quý khách quản lý', '<div class="muted">Đang tải…</div>');
  const params = new URLSearchParams();
  if (inboxState.kind) params.set('kind', inboxState.kind);
  if (inboxState.page) params.set('page_id', inboxState.page);
  if (inboxState.unread) params.set('unread', '1');
  const [d, { pages }] = await Promise.all([api(`/api/inbox?${params}`), api('/api/pages')]);
  refreshUnread(d.unread_total);
  const chips = [['', 'Tất cả'], ['message', 'Tin nhắn'], ['comment', 'Bình luận']]
    .map(([k, l]) => `<button class="chip ${inboxState.kind === k ? 'on' : ''}" data-kind="${k}">${l}</button>`).join('')
    + `<button class="chip ${inboxState.unread ? 'on' : ''}" data-unr>Chưa đọc <span>${d.unread_total}</span></button>`
    + (pages.length > 1 ? `<select id="ipage" class="sm"><option value="">Mọi Fanpage</option>${pages.map((p) => `<option value="${esc(p.id)}" ${inboxState.page === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : '');
  const list = d.conversations.map((c) => `<a class="conv ${c.id === cid ? 'on' : ''} ${c.unread ? 'new' : ''}" href="#/hop-thu?c=${c.id}">
      ${custAvatar(c)}
      <div class="grow"><div class="row between"><b class="ellipsis">${esc(c.customer_name || 'Khách Facebook')}</b><span class="muted small">${fmtTime(c.last_at)}</span></div>
        <div class="ellipsis small">${c.kind === 'comment' ? '<span class="badge warn">Bình luận</span> ' : ''}${esc(c.last_text || '')}</div>
        <div class="muted small ellipsis">${esc(c.page_name)}</div></div>
      ${c.unread ? `<span class="dot" aria-label="${c.unread} chưa đọc">${c.unread}</span>` : ''}</a>`).join('');
  const empty = `<p class="muted">Chưa có tin nhắn hay bình luận nào. Tin mới sẽ hiện ở đây sau khi webhook được cài đặt (xem mục Fanpage).</p>`;
  document.getElementById('view').innerHTML = `<div class="chips">${chips}</div>
    <div class="inbox ${cid ? 'has-conv' : ''}"><div class="card convs">${list || empty}</div><div class="card thread" id="thread">${cid ? '<div class="muted">Đang tải…</div>' : '<p class="muted">Chọn một cuộc trò chuyện để xem và trả lời.</p>'}</div></div>`;
  document.querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => { inboxState.kind = b.dataset.kind; viewInbox(q); }));
  document.querySelector('[data-unr]').onclick = () => { inboxState.unread = !inboxState.unread; viewInbox(q); };
  const sel = document.getElementById('ipage');
  if (sel) sel.onchange = () => { inboxState.page = sel.value; viewInbox(q); };
  if (cid) await loadThread(cid);
}

async function loadThread(cid, data) {
  const box = document.getElementById('thread');
  let d = data;
  try { d = d || await api(`/api/inbox/${cid}`); } catch (e) { box.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return; }
  const c = d.conversation;
  if (!data) { const a = document.querySelector(`.conv[href="#/hop-thu?c=${cid}"]`); a?.classList.remove('new'); a?.querySelector('.dot')?.remove(); refreshUnread(); }
  const msgs = d.messages.map((m) => `<div class="msg ${m.direction}">
      ${CHANNEL[m.channel] ? `<div class="muted small">${CHANNEL[m.channel]}${m.auto ? ' · tự động' : ''}</div>` : (m.auto ? '<div class="muted small">tự động</div>' : '')}
      <div class="bubble">${esc(m.text || '')}</div>
      <div class="muted small">${fmtTime(m.created_at)}${m.sent_by_name ? ` · ${esc(m.sent_by_name)}` : ''}
        ${m.channel === 'comment' ? ` · <button class="link" data-reply="${esc(m.comment_id)}">Trả lời</button>${m.can_private ? ` · <button class="link" data-priv="${esc(m.comment_id)}">Nhắn riêng</button>` : ''}` : ''}</div></div>`).join('');
  const isMsg = c.kind === 'message';
  const note = isMsg && !c.can_message ? '<div class="alert warn">Đã quá 24 giờ kể từ tin nhắn cuối của khách. Facebook chỉ cho Trang trả lời trong 24 giờ; chờ khách nhắn lại.</div>' : '';
  const L = c.links || {};
  const linkBtns = [
    L.inbox ? `<a class="btn ghost sm" href="${esc(L.inbox)}" target="_blank" rel="noopener">Mở trong Meta Business Suite</a>` : '',
    L.comment ? `<a class="btn ghost sm" href="${esc(L.comment)}" target="_blank" rel="noopener">Xem bình luận</a>` : '',
  ].join('');
  box.innerHTML = `<div class="thead"><a class="btn ghost sm only-mobile" href="#/hop-thu">← Danh sách</a>
      <div class="cust">${custAvatar(c, true)}<div class="grow"><b>${esc(c.customer_name || 'Khách Facebook')}</b>
        <div class="muted small">${esc(c.page_name)} · ${isMsg ? 'Tin nhắn Messenger' : 'Bình luận trên bài viết'}</div>
        <div class="muted small">Liên hệ lần đầu: ${fmtTime(c.created_at)} · ${c.counts ? `${c.counts.in} tin của khách, ${c.counts.out} tin đã trả lời` : ''}</div></div></div>
      ${linkBtns ? `<div class="row">${linkBtns}</div>` : ''}
      ${c.profile_error ? `<div class="muted small">Chưa lấy được tên khách: ${esc(c.profile_error)}</div>` : ''}
      <div class="muted small">Facebook không cho phần mềm ngoài mở trực tiếp trang cá nhân của khách. ${isMsg ? 'Bấm "Mở trong Meta Business Suite"' : 'Bấm "Xem bình luận"'}, rồi bấm tên khách ở đó để xem trang cá nhân.</div></div>
    <div class="msgs" id="msgs">${msgs || '<p class="muted">Chưa có nội dung.</p>'}</div>${note}
    <form id="rf" class="reply">${isMsg ? '' : `<div class="row small" id="rmode"><label class="check"><input type="radio" name="mode" value="public" checked> Trả lời công khai</label><label class="check"><input type="radio" name="mode" value="private"> Nhắn riêng (Messenger)</label><span class="muted" id="rto"></span></div>`}
      <textarea id="rt" rows="2" maxlength="2000" placeholder="Nhập nội dung trả lời…" ${isMsg && !c.can_message ? 'disabled' : ''}></textarea>
      <div class="row between"><span class="muted small">Gửi thật tới khách trên Facebook</span><button class="btn" id="rs" ${isMsg && !c.can_message ? 'disabled' : ''}>Gửi</button></div></form>`;
  const ml = document.getElementById('msgs'); ml.scrollTop = ml.scrollHeight;
  let commentId = '';
  const setTarget = (id, mode) => {
    commentId = id;
    const r = box.querySelector(`input[name=mode][value=${mode}]`); if (r) r.checked = true;
    const m = d.messages.find((x) => x.comment_id === id && x.channel === 'comment');
    document.getElementById('rto').textContent = m ? `→ "${(m.text || '').slice(0, 40)}"` : '';
    document.getElementById('rt').focus();
  };
  box.querySelectorAll('[data-reply]').forEach((b) => (b.onclick = () => setTarget(b.dataset.reply, 'public')));
  box.querySelectorAll('[data-priv]').forEach((b) => (b.onclick = () => setTarget(b.dataset.priv, 'private')));
  document.getElementById('rf').onsubmit = async (e) => {
    e.preventDefault();
    const text = document.getElementById('rt').value.trim();
    if (!text) return;
    const btn = document.getElementById('rs'); btn.disabled = true;
    const mode = isMsg ? 'message' : box.querySelector('input[name=mode]:checked').value;
    try {
      const nd = await api(`/api/inbox/${cid}/reply`, { method: 'POST', body: { text, mode, comment_id: commentId || undefined } });
      toast('Đã gửi'); loadThread(cid, nd);
    } catch (err) { toast(err.message); btn.disabled = false; }
  };
}

// ---------- Lịch đăng ----------
const CSTATUS = {
  draft: ['Nháp', 'off'], pending: ['Chờ duyệt', 'warn'], rejected: ['Bị từ chối', 'err'],
  scheduled: ['Đã hẹn giờ', ''], published: ['Đã đăng', 'ok'], failed: ['Đăng lỗi', 'err'],
};
const calState = { status: '', page: '', view: 'list', month: '', focus: null };
const toLocalInput = (t) => { if (!t) return ''; const d = new Date(t * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const dayKey = (t) => new Date(t * 1000).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

async function uploadFile(file, opt = {}) {
  const qs = new URLSearchParams({ name: file.name });
  for (const k of ['page_id', 'topic_id', 'source', 'note']) if (opt[k]) qs.set(k, opt[k]);
  const res = await fetch(`/api/media?${qs}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Tải lên lỗi, vui lòng thử lại');
  return data;
}

// ---------- Footer riêng từng Fanpage (lời kêu gọi, hotline, website, hashtag) ----------
let stylesCache = null;
async function loadStyles(force) {
  if (!stylesCache || force) stylesCache = await api('/api/styles').catch(() => ({ global: {}, pages: [] }));
  return stylesCache;
}
function pageFooter(st, pageId) {
  const ps = (st?.pages || []).find((p) => p.id === pageId)?.style || {};
  const has = ps.cta || ps.hotline || ps.website || ps.hashtags;
  const contact = has ? [ps.cta, ps.hotline, ps.website ? `Website: ${ps.website}` : ''].filter(Boolean).join('\n') : (st?.global?.contact || '');
  const tags = has ? ps.hashtags : (st?.global?.hashtags || '');
  return [contact, tags].filter(Boolean).join('\n\n');
}
const composeFor = (st, pageId, main) => [String(main || '').trim(), pageFooter(st, pageId)].filter(Boolean).join('\n\n');

function contentForm(pages, item, perms, pre) {
  const editing = !!item;
  const v = item || pre || {};
  const pagePick = editing
    ? `<div class="muted">${esc(item.page_name)}</div>`
    : `<div class="pick">${pages.map((p) => `<label class="check"><input type="checkbox" name="pg" value="${esc(p.id)}" ${pages.length === 1 ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>`;
  const btns = editing && item.status === 'scheduled'
    ? '<button type="button" class="btn" data-act="reschedule">Lưu và cập nhật lịch</button>'
    : perms.can_approve
    ? `<button type="button" class="btn ghost" data-act="draft">Lưu nháp</button><button type="button" class="btn" data-act="publish">Duyệt và đăng</button>`
    : `<button type="button" class="btn ghost" data-act="draft">Lưu nháp</button><button type="button" class="btn" data-act="submit">Gửi duyệt</button>`;
  return `<h2>${editing ? 'Sửa bài' : 'Soạn bài mới'}</h2>
    <form id="cf" novalidate>
      <label>Fanpage</label>${pagePick}
      <details class="ai" id="aibox" ${pre?.brief ? 'open' : ''}><summary>✨ Viết bằng AI theo quy định đăng bài</summary>
        <label for="brief">Ý chính cần viết</label>
        <textarea id="brief" rows="3" maxlength="2000" placeholder="Ví dụ: Mời bà con dự hội thảo kỹ thuật chăm sóc sầu riêng sau thu hoạch, sáng 25/11 tại HTX...">${esc(pre?.brief || '')}</textarea>
        <div class="row ai-row"><select id="alen" aria-label="Độ dài"><option value="ngan">Ngắn</option><option value="vua" selected>Vừa</option><option value="dai">Dài</option></select>
          <button type="button" class="btn sm" id="aigo">Viết bài</button><button type="button" class="btn ghost sm" id="airew">Viết lại nội dung bên dưới</button>
          <a class="small" href="#/quy-dinh" target="_blank" rel="noopener">Xem quy định</a></div>
        <div id="aimsg"></div>
      </details>
      <label for="msg">${editing ? 'Nội dung' : 'Nội dung chung'}</label><textarea id="msg" rows="7" maxlength="5000" placeholder="Viết nội dung bài đăng…">${esc(v.message || '')}</textarea>
      <div class="muted small" id="cnt"></div>
      ${editing ? '' : '<div id="pv"></div>'}
      <label for="lnk">Liên kết (không bắt buộc)</label><input id="lnk" type="url" placeholder="https://farmbase.vn/…" value="${esc(v.link || '')}">
      <label>Ảnh hoặc video</label>
      ${perms.media_enabled
        ? `<div class="media-pick"><div class="media-list" id="mlist"></div>
            <div class="row"><label class="btn ghost sm upl">Tải ảnh, video lên<input id="mfile" type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime" multiple hidden></label><button type="button" class="btn ghost sm" id="mlib">Chọn từ kho</button></div>
            <div class="muted small">Tối đa 10 ảnh (mỗi ảnh 10 MB) hoặc 1 video MP4 (95 MB). Có ảnh hoặc video thì nội dung làm chú thích.</div><div id="mmsg"></div></div>`
        : '<div class="muted small">Chưa bật kho lưu ảnh, video. Tạm thời dán đường dẫn ảnh công khai bên dưới.</div>'}
      <label for="img">Hoặc địa chỉ ảnh có sẵn (không bắt buộc)</label><input id="img" type="url" placeholder="https://… .jpg" value="${esc(v.image_url || '')}">
      <label for="when">Thời gian đăng</label><input id="when" type="datetime-local" value="${toLocalInput(item?.scheduled_at)}">
      <div class="muted small">${editing && item.status === 'scheduled' ? 'Bài đang hẹn giờ trên Facebook: khi lưu, lịch cũ được thay bằng nội dung và giờ mới. Giờ đăng cách hiện tại ít nhất 10 phút.' : 'Để trống: đăng ngay khi duyệt. Hẹn giờ: cách hiện tại ít nhất 10 phút, tối đa 30 ngày; Facebook tự đăng đúng giờ.'}</div>
      <div id="fmsg"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Hủy</button>${editing && !perms.can_approve ? '' : ''}${btns}</div>
    </form>`;
}

function openContentForm(pages, item, perms, pre) {
  modal(contentForm(pages, item, perms, pre), (m, close) => {
    const f = m.querySelector('#cf');
    const cnt = m.querySelector('#cnt');
    const upd = () => (cnt.textContent = `${f.msg.value.length}/5000 ký tự`);
    // Bài mới: mỗi Trang một bản = nội dung chung + footer riêng của Trang; sửa riêng từng bản được.
    const variants = {};
    let st = null;
    const pv = m.querySelector('#pv');
    const drawVariants = () => {
      if (!pv || !st) return;
      const ids = pickedPages();
      for (const id of ids) if (!variants[id]) variants[id] = { text: composeFor(st, id, f.msg.value), edited: false };
      for (const id of ids) if (!variants[id].edited) variants[id].text = composeFor(st, id, f.msg.value);
      if (!ids.length) { pv.innerHTML = ''; return; }
      pv.innerHTML = `<div class="pvhead"><b>Bài sẽ đăng trên từng Trang</b><span class="muted small">Tự gắn lời kêu gọi, hotline, website, hashtag của từng Trang. <a href="#/quy-dinh" target="_blank" rel="noopener">Thiết lập</a></span></div>
        ${ids.map((id) => { const p = pages.find((x) => x.id === id); const note = (st.pages.find((x) => x.id === id)?.style || {}).note; return `<div class="pvar" data-pid="${esc(id)}">
          <div class="row between"><b class="small">${esc(p?.name || id)}</b><span class="tag ${variants[id].edited ? '' : 'muted'}">${variants[id].edited ? 'Đã sửa riêng' : 'Theo nội dung chung'}</span></div>
          <textarea rows="${ids.length > 1 ? 6 : 5}" maxlength="5000" data-var="${esc(id)}">${esc(variants[id].text)}</textarea>
          <div class="row sact"><button type="button" class="btn ghost sm" data-adapt="${esc(id)}">✨ AI chỉnh cho Trang này</button>${variants[id].edited ? `<button type="button" class="btn ghost sm" data-resync="${esc(id)}">Lấy lại theo nội dung chung</button>` : ''}${note ? `<span class="muted small" title="${esc(note)}">Có lưu ý riêng</span>` : ''}</div></div>`; }).join('')}`;
      pv.querySelectorAll('[data-var]').forEach((t) => (t.oninput = () => {
        const v = variants[t.dataset.var]; const was = v.edited; v.text = t.value; v.edited = true;
        if (!was) { const tag = t.closest('.pvar').querySelector('.tag'); tag.textContent = 'Đã sửa riêng'; tag.classList.remove('muted'); }
      }));
      pv.querySelectorAll('[data-resync]').forEach((b) => (b.onclick = () => { variants[b.dataset.resync].edited = false; drawVariants(); }));
      pv.querySelectorAll('[data-adapt]').forEach((b) => (b.onclick = async () => {
        const id = b.dataset.adapt;
        if (!f.msg.value.trim()) return toast('Chưa có nội dung chung để chỉnh');
        b.disabled = true; b.textContent = 'AI đang chỉnh…';
        try {
          const d = await api('/api/ai/adapt', { method: 'POST', body: { text: f.msg.value, page_id: id } });
          variants[id] = { text: composeFor(st, id, d.body), edited: true }; drawVariants();
        } catch (e) { toast(e.message); b.disabled = false; b.textContent = '✨ AI chỉnh cho Trang này'; }
      }));
    };
    if (pv) {
      loadStyles().then((x) => { st = x; drawVariants(); });
      f.querySelectorAll('input[name=pg]').forEach((c) => c.addEventListener('change', drawVariants));
    }
    let syncT;
    f.msg.oninput = () => { upd(); clearTimeout(syncT); syncT = setTimeout(drawVariants, 200); };
    upd();
    m.querySelector('[data-close]').onclick = close;
    const media = [...(item?.media || pre?.media || [])];
    const mlist = m.querySelector('#mlist');
    const drawMedia = () => {
      if (!mlist) return;
      mlist.innerHTML = media.map((x, i) => `<div class="mi">${x.kind === 'video' ? `<video src="${esc(x.url)}" muted preload="metadata"></video><span class="tag">Video</span>` : `<img src="${esc(x.url)}" alt="">`}
        <button type="button" class="mx" data-mrm="${i}" aria-label="Bỏ file này">×</button></div>`).join('');
      mlist.querySelectorAll('[data-mrm]').forEach((b) => (b.onclick = () => { media.splice(Number(b.dataset.mrm), 1); drawMedia(); }));
    };
    drawMedia();
    const mfile = m.querySelector('#mfile');
    if (mfile) mfile.onchange = async () => {
      const mmsg = m.querySelector('#mmsg');
      const files = [...mfile.files];
      mfile.value = '';
      for (const [i, file] of files.entries()) {
        mmsg.innerHTML = `<div class="muted small">Đang tải ${i + 1}/${files.length}: ${esc(file.name)}…</div>`;
        try { media.push((await uploadFile(file, { page_id: pickedPages()[0] || '', topic_id: item?.topic_id || '' })).media); drawMedia(); }
        catch (e) { mmsg.innerHTML = `<div class="alert err small">${esc(file.name)}: ${esc(e.message)}</div>`; return; }
      }
      mmsg.innerHTML = '';
    };
    const pickedPages = () => (item ? [item.page_id] : [...f.querySelectorAll('input[name=pg]:checked')].map((i) => i.value));
    const mlib = m.querySelector('#mlib');
    if (mlib) mlib.onclick = () => {
      const pid = pickedPages()[0];
      if (!pid) { m.querySelector('#mmsg').innerHTML = '<div class="alert err small">Vui lòng chọn Fanpage trước.</div>'; return; }
      pickMedia(pid, (picked) => { for (const x of picked) if (!media.some((y) => y.id === x.id)) media.push(x); drawMedia(); });
    };
    const runAi = async (rewrite) => {
      const aimsg = m.querySelector('#aimsg');
      const brief = f.brief.value.trim();
      if (!rewrite && !brief) { aimsg.innerHTML = '<div class="alert err small">Vui lòng nhập ý chính.</div>'; return; }
      if (rewrite && !f.msg.value.trim()) { aimsg.innerHTML = '<div class="alert err small">Chưa có nội dung để viết lại.</div>'; return; }
      if (!rewrite && f.msg.value.trim() && !(await confirmBox('Thay nội dung hiện tại?', 'Bài AI viết sẽ thay cho nội dung đang có trong ô Nội dung.', 'Thay'))) return;
      const btns = [m.querySelector('#aigo'), m.querySelector('#airew')];
      btns.forEach((b) => (b.disabled = true));
      aimsg.innerHTML = '<div class="muted small">AI đang viết, khoảng 10 đến 20 giây…</div>';
      try {
        const d = await api('/api/ai/write', { method: 'POST', body: { brief, length: f.alen.value, page_ids: pickedPages(), current: rewrite ? f.msg.value : '', body_only: !!pv } });
        f.msg.value = pv ? (d.body ?? d.text) : d.text; upd(); drawVariants();
        aimsg.innerHTML = '<div class="muted small">Đã viết xong. Quý khách đọc lại, sửa số liệu và tên riêng cho đúng trước khi gửi.</div>';
      } catch (e) { aimsg.innerHTML = `<div class="alert err small">${esc(e.message)}</div>`; }
      btns.forEach((b) => (b.disabled = false));
    };
    m.querySelector('#aigo').onclick = () => runAi(false);
    m.querySelector('#airew').onclick = () => runAi(true);
    m.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
      const act = b.dataset.act;
      const page_ids = pickedPages();
      const body = {
        message: f.msg.value, link: f.lnk.value.trim(), image_url: f.img.value.trim(), media_ids: media.map((x) => x.id),
        scheduled_at: f.when.value ? Math.floor(new Date(f.when.value).getTime() / 1000) : null,
      };
      const msgBox = m.querySelector('#fmsg');
      if (!item && !page_ids.length) { msgBox.innerHTML = '<div class="alert err">Vui lòng chọn ít nhất một Fanpage.</div>'; return; }
      if (act === 'reschedule') {
        if (!body.scheduled_at) { msgBox.innerHTML = '<div class="alert err">Vui lòng chọn giờ đăng. Muốn đăng ngay, bấm Hủy lịch rồi Duyệt và đăng.</div>'; return; }
        if (!(await confirmBox('Cập nhật bài hẹn giờ?', `Lịch trên Facebook sẽ được thay bằng nội dung mới, đăng lúc ${fmtTime(body.scheduled_at)} trên: ${item.page_name}.`, 'Cập nhật'))) return;
      }
      if (act === 'publish') {
        const names = item ? item.page_name : pages.filter((p) => page_ids.includes(p.id)).map((p) => p.name).join(', ');
        const when = body.scheduled_at && body.scheduled_at > Date.now() / 1000 + 600 ? `hẹn giờ đăng lúc ${fmtTime(body.scheduled_at)}` : 'đăng ngay';
        if (!(await confirmBox('Đăng thật lên Fanpage?', `Bài sẽ được ${when} trên: ${names}.`, 'Đăng'))) return;
      }
      m.querySelectorAll('button').forEach((x) => (x.disabled = true));
      try {
        let items;
        if (item) {
          const d = await api(`/api/content/${item.id}`, { method: 'PATCH', body });
          items = [d.item];
          if (act === 'submit') items = [(await api(`/api/content/${item.id}/submit`, { method: 'POST' })).item];
          if (act === 'publish') items = [(await api(`/api/content/${item.id}/approve`, { method: 'POST' })).item];
        } else {
          const messages = pv && st ? Object.fromEntries(page_ids.map((id) => [id, (variants[id]?.text ?? composeFor(st, id, f.msg.value))])) : undefined;
          items = (await api('/api/content', { method: 'POST', body: { ...body, page_ids, action: act, messages } })).items;
        }
        close();
        const failed = items.filter((i) => i.status === 'failed');
        toast(failed.length ? `Có ${failed.length} bài đăng lỗi, xem chi tiết trong danh sách` : { draft: 'Đã lưu nháp', submit: 'Đã gửi duyệt', publish: 'Đã gửi lên Facebook', reschedule: 'Đã cập nhật bài hẹn giờ' }[act]);
        if (document.getElementById('cal')) loadCalendar();
      } catch (e) {
        msgBox.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
        m.querySelectorAll('button').forEach((x) => (x.disabled = false));
      }
    }));
  });
}

function cardThumb(c) {
  const first = c.media?.[0];
  const n = c.media?.length || 0;
  if (first) return `<div class="thumbw">${first.kind === 'video' ? `<video class="thumb" src="${esc(first.url)}" muted preload="metadata"></video>` : `<img class="thumb" src="${esc(first.url)}" alt="" loading="lazy">`}${first.kind === 'video' ? '<span class="tag">Video</span>' : n > 1 ? `<span class="tag">${n} ảnh</span>` : ''}</div>`;
  return c.image_url ? `<img class="thumb" src="${esc(c.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="thumb empty"></div>';
}

// Lịch tháng: mỗi ô ngày có ảnh nhỏ, giờ đăng, màu theo trạng thái; bấm để xem bài trong danh sách.
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function itemThumb(c) {
  const m = c.media?.[0];
  if (m && m.kind !== 'video') return `<img src="${esc(m.url)}" alt="" loading="lazy">`;
  if (m) return '<span class="vid">▶</span>';
  if (c.image_url) return `<img src="${esc(c.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  return '';
}
function monthGrid(items) {
  const now = new Date();
  if (!calState.month) calState.month = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const [y, mo] = calState.month.split('-').map(Number);
  const first = new Date(y, mo - 1, 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); // bắt đầu từ thứ Hai
  const byDay = {};
  for (const c of items) {
    const t = c.status === 'published' ? c.published_at : (c.scheduled_at || c.created_at);
    if (!t) continue;
    (byDay[ymd(new Date(t * 1000))] ||= []).push({ c, t });
  }
  Object.values(byDay).forEach((l) => l.sort((a, b) => a.t - b.t));
  const prev = new Date(y, mo - 2, 1); const next = new Date(y, mo, 1);
  const today = ymd(now);
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i === 35 && d.getMonth() !== mo - 1) break;
    const list = byDay[ymd(d)] || [];
    cells += `<div class="mc ${d.getMonth() !== mo - 1 ? 'out' : ''} ${ymd(d) === today ? 'today' : ''}"><div class="mn">${d.getDate()}</div>
      ${list.slice(0, 3).map(({ c, t }) => `<button class="mi2 st-${esc(c.status)}" data-goto="${c.id}" title="${esc(`${c.page_name}: ${(c.message || '').slice(0, 120)}`)}">${itemThumb(c) ? `<span class="mt">${itemThumb(c)}</span>` : ''}<span class="mx2"><b>${new Date(t * 1000).toTimeString().slice(0, 5)}</b> <span class="mp">${esc((c.message || c.page_name || '').slice(0, 40))}</span></span></button>`).join('')}
      ${list.length > 3 ? `<button class="more2" data-goto="${list[3].c.id}">+${list.length - 3} bài</button>` : ''}</div>`;
  }
  return `<div class="card month">
    <div class="row between mhead"><button class="btn ghost sm" data-mon="${prev.getFullYear()}-${pad2(prev.getMonth() + 1)}" aria-label="Tháng trước">‹</button><b>Tháng ${mo}/${y}</b><button class="btn ghost sm" data-mon="${next.getFullYear()}-${pad2(next.getMonth() + 1)}" aria-label="Tháng sau">›</button></div>
    <div class="mgrid">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((w) => `<div class="mw">${w}</div>`).join('')}${cells}</div>
    <div class="mlegend small muted"><span class="lg st-scheduled"></span>Hẹn giờ <span class="lg st-published"></span>Đã đăng <span class="lg st-pending"></span>Chờ duyệt <span class="lg st-draft"></span>Nháp <span class="lg st-failed"></span>Lỗi</div></div>`;
}

function contentCard(c, perms) {
  const [label, cls] = CSTATUS[c.status] || [c.status, 'off'];
  const mine = c.created_by === me.id;
  const editable = ['draft', 'pending', 'rejected', 'failed'].includes(c.status) && (perms.can_approve || (perms.can_create && mine));
  const t = c.status === 'published' ? c.published_at : c.scheduled_at;
  const when = c.status === 'published' ? `Đăng lúc ${fmtTime(t)}` : (c.scheduled_at ? `Hẹn ${fmtTime(c.scheduled_at)}` : 'Đăng ngay khi duyệt');
  const acts = [];
  if (editable) acts.push(`<button class="btn ghost sm" data-c-edit="${c.id}">Sửa</button>`);
  if (['draft', 'rejected'].includes(c.status) && !perms.can_approve && perms.can_create && mine) acts.push(`<button class="btn sm" data-c-submit="${c.id}">Gửi duyệt</button>`);
  if (perms.can_approve && ['pending', 'draft', 'rejected', 'failed'].includes(c.status)) acts.push(`<button class="btn sm" data-c-approve="${c.id}">${c.status === 'failed' ? 'Đăng lại' : 'Duyệt và đăng'}</button>`);
  if (perms.can_approve && c.status === 'pending') acts.push(`<button class="btn danger sm" data-c-reject="${c.id}">Từ chối</button>`);
  if (perms.can_approve && c.status === 'scheduled') acts.push(`<button class="btn ghost sm" data-c-edit="${c.id}">Sửa</button>`);
  if (perms.can_approve && c.status === 'scheduled') acts.push(`<button class="btn danger sm" data-c-cancel="${c.id}">Hủy lịch</button>`);
  if (editable) acts.push(`<button class="btn ghost sm" data-c-del="${c.id}">Xóa</button>`);
  if (c.fb_post_id && c.status === 'published') acts.push(`<a class="btn ghost sm" href="https://www.facebook.com/${esc(c.fb_post_id)}" target="_blank" rel="noopener">Xem trên Facebook</a>`);
  return `<article class="post" id="c-${c.id}">
    ${cardThumb(c)}
    <div class="grow">
      <div class="muted small ellipsis"><b>${esc(c.page_name)}</b> · ${when} <span class="badge ${cls}">${label}</span></div>
      <div class="msg">${c.message ? esc(c.message) : '<span class="muted">(Bài chỉ có ảnh, video hoặc liên kết)</span>'}</div>
      ${c.link ? `<div class="small ellipsis"><a href="${esc(c.link)}" target="_blank" rel="noopener">${esc(c.link)}</a></div>` : ''}
      ${c.reject_reason ? `<div class="alert warn small">Lý do từ chối: ${esc(c.reject_reason)}</div>` : ''}
      ${c.status === 'failed' && c.last_error ? `<div class="alert err small">Facebook báo lỗi: ${esc(c.last_error)}</div>` : ''}
      ${c.ai?.reason ? `<div class="small aiwhy">${icon('ai')} ${esc(c.ai.topic_title ? `${c.ai.topic_title}: ` : '')}${esc(c.ai.reason)}${c.ai.check && !c.ai.check.ok ? ' <span class="badge warn">Cần xem lại</span>' : ''}</div>` : ''}
      <div class="muted small">Soạn: ${c.ai && !c.created_by_name ? `<span class="aibadge">${icon('ai')}Trợ lý AI</span>` : esc(c.created_by_name || '–')}${c.approved_by_name ? ` · Duyệt: ${esc(c.approved_by_name)}` : ''}</div>
      ${acts.length ? `<div class="row" style="margin-top:8px">${acts.join('')}</div>` : ''}
    </div></article>`;
}

// Bước duyệt: người duyệt chọn Fanpage (một hoặc nhiều) và giờ đăng, rồi đăng ngay hoặc hẹn giờ.
function openApprove(c) {
  const pages = calPages.some((p) => p.id === c.page_id) ? calPages : [{ id: c.page_id, name: c.page_name }, ...calPages];
  modal(`<h2>Duyệt và lên lịch đăng</h2>
    <div class="muted small ellipsis">${esc((c.message || '(Bài chỉ có ảnh hoặc liên kết)').slice(0, 140))}</div>
    <form id="apf" novalidate>
      <label>Đăng lên Fanpage</label>
      <div class="pick">${pages.map((p) => `<label class="check"><input type="checkbox" name="pg" value="${esc(p.id)}" ${p.id === c.page_id ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>
      <label for="apw">Thời gian đăng</label><input id="apw" type="datetime-local" value="${toLocalInput(c.scheduled_at)}">
      <div class="muted small">Để trống: đăng ngay. Hẹn giờ: cách hiện tại ít nhất 10 phút, tối đa 30 ngày; Facebook tự đăng đúng giờ.</div>
      <div id="apmsg"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Hủy</button><button type="button" class="btn" data-go>Đăng</button></div>
    </form>`, (m, close) => {
    const f = m.querySelector('#apf');
    const go = m.querySelector('[data-go]');
    const msgBox = m.querySelector('#apmsg');
    const label = () => {
      const t = f.apw.value ? Math.floor(new Date(f.apw.value).getTime() / 1000) : null;
      const n = f.querySelectorAll('input[name=pg]:checked').length;
      go.textContent = `${t && t > Date.now() / 1000 + 600 ? 'Hẹn giờ đăng' : 'Đăng ngay'}${n > 1 ? ` lên ${n} Fanpage` : ''}`;
    };
    f.oninput = label; f.onchange = label; label();
    m.querySelector('[data-close]').onclick = close;
    go.onclick = async () => {
      const page_ids = [...f.querySelectorAll('input[name=pg]:checked')].map((i) => i.value);
      if (!page_ids.length) { msgBox.innerHTML = '<div class="alert err">Vui lòng chọn ít nhất một Fanpage.</div>'; return; }
      const scheduled_at = f.apw.value ? Math.floor(new Date(f.apw.value).getTime() / 1000) : null;
      m.querySelectorAll('button').forEach((x) => (x.disabled = true));
      try {
        const r = await api(`/api/content/${c.id}/approve`, { method: 'POST', body: { page_ids, scheduled_at } });
        close();
        const failed = r.items.filter((i) => i.status === 'failed').length;
        toast(failed ? `Có ${failed} bài đăng lỗi, xem chi tiết trong danh sách` : 'Đã gửi lên Facebook');
        loadCalendar();
      } catch (e) {
        msgBox.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
        m.querySelectorAll('button').forEach((x) => (x.disabled = false));
      }
    };
  });
}

let calPages = [];
let calMedia = false;
async function loadCalendar() {
  const box = document.getElementById('cal');
  if (!box) return;
  const qs = new URLSearchParams();
  if (calState.status) qs.set('status', calState.status);
  if (calState.page) qs.set('page_id', calState.page);
  const d = await api(`/api/content?${qs}`);
  const perms = { can_create: d.can_create, can_approve: d.can_approve, media_enabled: d.media_enabled };
  calMedia = !!d.media_enabled;
  const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
  const chips = [['', 'Tất cả', total], ...Object.entries(CSTATUS).map(([k, [l]]) => [k, l, d.counts[k] || 0])]
    .map(([k, l, n]) => `<button class="chip ${calState.status === k ? 'on' : ''}" data-st="${k}">${l} <span>${n}</span></button>`).join('');
  const groups = {};
  for (const c of d.items) {
    const t = c.status === 'published' ? c.published_at : (c.scheduled_at || c.created_at);
    (groups[dayKey(t)] ||= []).push(c);
  }
  const seg = `<div class="seg" role="group" aria-label="Kiểu xem"><button class="${calState.view === 'list' ? 'on' : ''}" data-view="list">Danh sách</button><button class="${calState.view === 'month' ? 'on' : ''}" data-view="month">Lịch tháng</button></div>`;
  if (calState.view === 'month') {
    box.innerHTML = `<div class="calbar"><div class="chips">${chips}</div>${seg}</div>${monthGrid(d.items)}`;
    box.querySelectorAll('[data-st]').forEach((b) => (b.onclick = () => { calState.status = b.dataset.st; loadCalendar(); }));
    box.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { calState.view = b.dataset.view; loadCalendar(); }));
    box.querySelectorAll('[data-mon]').forEach((b) => (b.onclick = () => { calState.month = b.dataset.mon; loadCalendar(); }));
    box.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = async () => {
      calState.view = 'list'; await loadCalendar();
      const el = document.getElementById(`c-${b.dataset.goto}`);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2000); }
    }));
    return;
  }
  box.innerHTML = `<div class="calbar"><div class="chips">${chips}</div>${seg}</div>
    ${d.items.length ? Object.entries(groups).map(([day, list]) => `<h3 class="day">${esc(day)}</h3><div class="card">${list.map((c) => contentCard(c, perms)).join('')}</div>`).join('')
      : `<div class="card"><p class="muted" style="margin:0">${perms.can_create ? 'Chưa có bài nào. Bấm "Soạn bài" để bắt đầu.' : 'Chưa có bài nào.'}</p></div>`}`;
  box.querySelectorAll('[data-st]').forEach((b) => (b.onclick = () => { calState.status = b.dataset.st; loadCalendar(); }));
  box.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { calState.view = b.dataset.view; loadCalendar(); }));
  const byId = Object.fromEntries(d.items.map((c) => [c.id, c]));
  const act = async (btn, fn, ok) => { btn.disabled = true; try { await fn(); toast(ok); loadCalendar(); } catch (e) { toast(e.message); btn.disabled = false; } };
  box.querySelectorAll('[data-c-edit]').forEach((b) => (b.onclick = () => openContentForm(calPages, byId[b.dataset.cEdit], perms)));
  box.querySelectorAll('[data-c-submit]').forEach((b) => (b.onclick = () => act(b, () => api(`/api/content/${b.dataset.cSubmit}/submit`, { method: 'POST' }), 'Đã gửi duyệt')));
  box.querySelectorAll('[data-c-approve]').forEach((b) => (b.onclick = () => openApprove(byId[b.dataset.cApprove])));
  if (calState.focus) { const el = document.getElementById(`c-${calState.focus}`); calState.focus = null; if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2000); } }
  box.querySelectorAll('[data-c-reject]').forEach((b) => (b.onclick = () => {
    modal(`<h2>Từ chối bài</h2><label for="why">Lý do (người soạn sẽ thấy)</label><textarea id="why" rows="3" maxlength="500"></textarea>
      <div class="actions"><button class="btn ghost" data-no>Hủy</button><button class="btn danger" data-yes>Từ chối</button></div>`, (m, close) => {
      m.querySelector('[data-no]').onclick = close;
      m.querySelector('[data-yes]').onclick = () => { close(); act(b, () => api(`/api/content/${b.dataset.cReject}/reject`, { method: 'POST', body: { reason: m.querySelector('#why').value } }), 'Đã từ chối'); };
    });
  }));
  box.querySelectorAll('[data-c-cancel]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Hủy lịch đăng?', 'Bài hẹn giờ sẽ bị gỡ khỏi lịch của Facebook và quay về nháp.', 'Hủy lịch', true))) return;
    act(b, () => api(`/api/content/${b.dataset.cCancel}/cancel`, { method: 'POST' }), 'Đã hủy lịch, bài quay về nháp');
  }));
  box.querySelectorAll('[data-c-del]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Xóa bài này?', 'Bài chưa lên Facebook sẽ bị xóa khỏi hệ thống, không khôi phục được.', 'Xóa', true))) return;
    act(b, () => api(`/api/content/${b.dataset.cDel}`, { method: 'DELETE' }), 'Đã xóa');
  }));
}

async function viewCalendar(q) {
  const canCreate = me.role !== 'agent';
  layout('lich-dang', 'Lịch đăng', 'Soạn bài, duyệt, đăng ngay hoặc hẹn giờ lên Fanpage', '<div class="muted">Đang tải…</div>',
    `<a class="btn ghost" href="#/quy-dinh">Quy định</a>${canCreate ? '<button class="btn" id="new">Soạn bài</button>' : ''}`);
  const { pages } = await api('/api/pages');
  calPages = pages.filter((p) => p.status !== 'disconnected');
  document.getElementById('view').innerHTML = `
    ${calPages.length ? `<div class="card filters f2"><div><label for="cpg">Fanpage</label><select id="cpg"><option value="">Tất cả Fanpage</option>${calPages.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div></div>` : ''}
    <div id="cal"></div>`;
  const sel = document.getElementById('cpg');
  if (sel) { sel.value = calState.page; sel.onchange = () => { calState.page = sel.value; loadCalendar(); }; }
  const nb = document.getElementById('new');
  if (nb) nb.onclick = () => {
    if (!calPages.length) return toast(me.role === 'owner' ? 'Vui lòng kết nối Fanpage trước' : 'Quý khách chưa được giao Fanpage nào');
    openContentForm(calPages, null, { can_create: true, can_approve: me.role === 'owner' || me.role === 'manager', media_enabled: calMedia });
  };
  await loadCalendar();
}

// ---------- Quy định đăng bài ----------
const RULES_SAMPLE = `1. Xưng hô: gọi khách là "Quý khách", gọi nông dân là "bà con"; doanh nghiệp xưng "FarmBase" hoặc "chúng tôi".
2. Giọng văn: thân thiện, rõ ràng, chuyên nghiệp; câu ngắn; không dùng tiếng lóng.
3. Cấu trúc: câu mở đầu thu hút, 2 đến 4 đoạn ngắn, kết bằng lời kêu gọi (liên hệ, đăng ký, nhắn tin).
4. Biểu tượng cảm xúc: tối đa 3 biểu tượng mỗi bài.
5. Hashtag: cuối bài, 2 đến 4 hashtag, luôn có #FarmBase.
6. Không được: bịa số liệu, hứa hẹn kết quả, nói xấu đối thủ, đăng thông tin cá nhân của bà con.
7. Liên hệ cuối bài: (ghi số điện thoại, Zalo, website của Trang).`;

async function viewRules() {
  layout('quy-dinh', 'Quy định đăng bài', 'Văn phong chung cho mọi bài; AI viết bài luôn làm theo quy định này', '<div class="muted">Đang tải…</div>');
  const d = await api('/api/rules');
  const meta = d.updated_at ? `Cập nhật ${fmtTime(d.updated_at)}${d.updated_by_name ? ` bởi ${esc(d.updated_by_name)}` : ''}` : 'Chưa có quy định';
  document.getElementById('view').innerHTML = `<div class="card">
    <p class="muted small" style="margin-top:0">${meta}</p>
    ${d.can_edit ? `<form id="rf" novalidate>
      <label for="rules">Quy định (xưng hô, giọng văn, độ dài, hashtag, từ cấm, thông tin liên hệ…)</label>
      <textarea id="rules" rows="16" maxlength="8000" placeholder="${esc(RULES_SAMPLE)}">${esc(d.text)}</textarea>
      <div class="muted small" id="rcnt"></div>
      <label for="rcontact">Liên hệ cuối bài (AI luôn gắn đúng dòng này, không tự viết số khác)</label>
      <input id="rcontact" maxlength="500" placeholder="Ví dụ: Hotline BVI: 0944 374 068 · Website: https://farmbase.vn" value="${esc(d.contact || '')}">
      <label for="rtags">Hashtag được dùng (AI chỉ chọn trong danh sách này, luôn có #FarmBase)</label>
      <input id="rtags" maxlength="600" placeholder="#FarmBase #BVI #MaSoVungTrong" value="${esc(d.hashtags || '')}">
      <div class="muted small">Sau khi AI viết, hệ thống tự bỏ số điện thoại, website, hashtag AI tự đặt ra, giới hạn số biểu tượng cảm xúc theo quy định, rồi gắn dòng liên hệ và 2 đến 4 hashtag ở trên vào cuối bài.</div>
      <div id="rmsg"></div>
      <div class="actions">${d.text ? '' : '<button type="button" class="btn ghost" id="sample">Dùng mẫu gợi ý</button>'}<button type="submit" class="btn">Lưu quy định</button></div>
    </form>` : `<div class="rules">${d.text ? esc(d.text) : '<span class="muted">Quản lý chưa soạn quy định.</span>'}</div>${d.contact || d.hashtags ? `<p class="small"><b>Liên hệ cuối bài:</b> ${esc(d.contact || '(chưa có)')}<br><b>Hashtag:</b> ${esc(d.hashtags || '(chưa có)')}</p>` : ''}`}
  </div>`;
  renderPageStyles();
  const f = document.getElementById('rf');
  if (!f) return;
  const cnt = document.getElementById('rcnt');
  const upd = () => (cnt.textContent = `${f.rules.value.length}/8000 ký tự`);
  f.rules.oninput = upd; upd();
  const sample = document.getElementById('sample');
  if (sample) sample.onclick = () => { f.rules.value = RULES_SAMPLE; upd(); f.rules.focus(); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/rules', { method: 'PUT', body: { text: f.rules.value, contact: f.rcontact.value, hashtags: f.rtags.value } }); toast('Đã lưu quy định'); viewRules(); }
    catch (err) { document.getElementById('rmsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
  };
}

async function renderPageStyles() {
  const view = document.getElementById('view');
  const box = document.createElement('div');
  box.className = 'card'; box.id = 'pstyles'; box.style.marginTop = '16px';
  box.innerHTML = '<div class="muted">Đang tải thiết lập từng Fanpage…</div>';
  view.appendChild(box);
  const d = await loadStyles(true);
  if (!d.pages.length) { box.innerHTML = '<p class="muted" style="margin:0">Chưa có Fanpage nào để thiết lập.</p>'; return; }
  const ed = d.can_edit;
  box.innerHTML = `<h2 style="margin-top:0">Thiết lập theo từng Fanpage</h2>
    <p class="muted small">Khi soạn một bài cho nhiều Trang, mỗi Trang tự gắn phần cuối bài riêng dưới đây. Trang để trống thì dùng liên hệ và hashtag chung ở trên. "Lưu ý nội dung" giúp AI chỉnh bài cho hợp từng Trang.</p>
    <div class="pslist">${d.pages.map((p) => { const s = p.style || {}; return `<details class="pstyle" ${d.pages.length === 1 ? 'open' : ''}><summary><b>${esc(p.name)}</b> <span class="muted small">${s.hotline || s.hashtags || s.cta ? 'Đã thiết lập' : 'Dùng thiết lập chung'}</span></summary>
      <form data-ps="${esc(p.id)}" novalidate>
        <label>Lời kêu gọi (call-to-action)</label><input name="cta" maxlength="300" placeholder="Ví dụ: 👉 Nhắn tin cho Trang để đăng ký tham gia" value="${esc(s.cta || '')}" ${ed ? '' : 'disabled'}>
        <label>Hotline</label><input name="hotline" maxlength="200" placeholder="Ví dụ: Hotline BVI: 0944 374 068" value="${esc(s.hotline || '')}" ${ed ? '' : 'disabled'}>
        <label>Website</label><input name="website" maxlength="200" placeholder="https://farmbase.vn" value="${esc(s.website || '')}" ${ed ? '' : 'disabled'}>
        <label>Hashtag</label><input name="hashtags" maxlength="600" placeholder="#FarmBase #MaSoVungTrong" value="${esc(s.hashtags || '')}" ${ed ? '' : 'disabled'}>
        <label>Lưu ý nội dung cho Trang này</label><textarea name="note" rows="3" maxlength="1500" placeholder="Ví dụ: Trang hướng tới bà con nông dân, lời lẽ gần gũi; nhấn mạnh tập huấn miễn phí; không nói về giá." ${ed ? '' : 'disabled'}>${esc(s.note || '')}</textarea>
        <div class="muted small">Xem trước phần cuối bài:</div><pre class="pfoot">${esc(pageFooter(d, p.id) || '(trống)')}</pre>
        ${ed ? '<div class="actions"><button type="submit" class="btn sm">Lưu cho Trang này</button></div>' : ''}
      </form></details>`; }).join('')}</div>`;
  box.querySelectorAll('form[data-ps]').forEach((fm) => {
    const prev = fm.querySelector('.pfoot');
    const live = () => { const tmp = { ...d, pages: d.pages.map((p) => (p.id === fm.dataset.ps ? { ...p, style: { cta: fm.cta.value, hotline: fm.hotline.value, website: fm.website.value, hashtags: fm.hashtags.value } } : p)) }; prev.textContent = pageFooter(tmp, fm.dataset.ps) || '(trống)'; };
    fm.querySelectorAll('input').forEach((i) => (i.oninput = live));
    fm.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(`/api/styles/${encodeURIComponent(fm.dataset.ps)}`, { method: 'PUT', body: { cta: fm.cta.value, hotline: fm.hotline.value, website: fm.website.value, hashtags: fm.hashtags.value, note: fm.note.value } });
        toast('Đã lưu thiết lập Trang'); stylesCache = null;
      } catch (err) { toast(err.message); }
    };
  });
}

// ---------- Bài đăng ----------
const postState = { page: 'all', sort: 'new', posts: [], after: null, errors: [] };

function postCard(p, showPage) {
  const time = fmtTime(p.created_time);
  return `<article class="post">
    ${p.picture ? `<img class="thumb" src="${esc(p.picture)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="thumb empty"></div>'}
    <div class="grow">
      <div class="muted small ellipsis">${showPage ? `<b>${esc(p.page_name)}</b> · ` : ''}${time}</div>
      <div class="msg">${p.message ? esc(p.message) : '<span class="muted">(Bài không có chữ)</span>'}</div>
      <div class="metrics">
        <span title="Cảm xúc (thích, yêu thích…)">👍 <b>${fmtNum(p.reactions)}</b> cảm xúc</span>
        <span title="Bình luận">💬 <b>${fmtNum(p.comments)}</b> bình luận</span>
        <span title="Chia sẻ">↗ <b>${fmtNum(p.shares)}</b> chia sẻ</span>
        ${p.permalink_url ? `<a href="${esc(p.permalink_url)}" target="_blank" rel="noopener">Xem trên Facebook</a>` : ''}
      </div>
    </div></article>`;
}

function renderPosts() {
  const list = [...postState.posts];
  if (postState.sort === 'top') list.sort((a, b) => b.engagement - a.engagement);
  const sum = (k) => list.reduce((s, p) => s + (p[k] || 0), 0);
  const n = list.length;
  const avg = n ? Math.round(sum('engagement') / n) : 0;
  const all = postState.page === 'all';
  const errs = postState.errors.map((e) => `<div class="alert err">${esc(e.page_name)}: ${esc(e.message)}</div>`).join('');
  document.getElementById('posts').innerHTML = `${errs}
    <div class="grid stats4">
      <div class="card stat"><div class="muted small">Số bài đang xem</div><div class="n">${fmtNum(n)}</div></div>
      <div class="card stat"><div class="muted small">Tổng cảm xúc</div><div class="n">${fmtNum(sum('reactions'))}</div></div>
      <div class="card stat"><div class="muted small">Tổng bình luận</div><div class="n">${fmtNum(sum('comments'))}</div></div>
      <div class="card stat"><div class="muted small">Tổng chia sẻ</div><div class="n">${fmtNum(sum('shares'))}</div></div>
    </div>
    <p class="muted small">Trung bình ${fmtNum(avg)} tương tác mỗi bài. Số liệu lấy trực tiếp từ Facebook lúc tải trang.</p>
    <div class="card">${n ? list.map((p) => postCard(p, all)).join('') : '<p class="muted" style="margin:0">Chưa có bài đăng nào.</p>'}</div>
    ${!all && postState.after ? '<div class="row" style="justify-content:center;margin-top:16px"><button class="btn ghost" id="more">Tải thêm bài</button></div>' : ''}`;
  const more = document.getElementById('more');
  if (more) more.onclick = async () => {
    more.disabled = true; more.textContent = 'Đang tải…';
    try {
      const d = await api(`/api/pages/${encodeURIComponent(postState.page)}/posts?limit=25&after=${encodeURIComponent(postState.after)}`);
      postState.posts.push(...d.posts); postState.after = d.after; renderPosts();
    } catch (e) { toast(e.message); more.disabled = false; more.textContent = 'Tải thêm bài'; }
  };
}

async function loadPosts() {
  const box = document.getElementById('posts');
  box.innerHTML = '<div class="muted">Đang tải bài đăng từ Facebook…</div>';
  try {
    if (postState.page === 'all') {
      const d = await api('/api/posts?limit=10');
      Object.assign(postState, { posts: d.posts, after: null, errors: d.errors || [] });
    } else {
      const d = await api(`/api/pages/${encodeURIComponent(postState.page)}/posts?limit=25`);
      Object.assign(postState, { posts: d.posts, after: d.after, errors: [] });
    }
    renderPosts();
  } catch (e) {
    box.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
  }
}

async function viewPosts(q) {
  layout('bai-dang', 'Bài đăng', 'Bài đã đăng và số tương tác theo từng Fanpage', '<div class="muted">Đang tải…</div>');
  const { pages } = await api('/api/pages');
  const usable = pages.filter((p) => p.status !== 'disconnected');
  if (!usable.length) {
    document.getElementById('view').innerHTML = `<div class="card"><p class="muted" style="margin:0">${me.role === 'owner'
      ? 'Chưa có Fanpage nào. Vào mục Fanpage và bấm "Kết nối Fanpage" trước.' : 'Quý khách chưa được giao Fanpage nào.'}</p></div>`;
    return;
  }
  const want = q.get('trang');
  postState.page = want && usable.some((p) => p.id === want) ? want : (usable.length === 1 ? usable[0].id : 'all');
  document.getElementById('view').innerHTML = `
    <div class="card filters">
      <div><label for="pg">Fanpage</label><select id="pg">
        ${usable.length > 1 ? '<option value="all">Tất cả Fanpage (10 bài mới nhất mỗi Trang)</option>' : ''}
        ${usable.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div><label for="sort">Sắp xếp</label><select id="sort">
        <option value="new">Mới nhất</option><option value="top">Nhiều tương tác nhất</option></select></div>
      <div class="end"><button class="btn ghost" id="reload">Tải lại</button></div>
    </div>
    <div id="posts"></div>`;
  const pg = document.getElementById('pg');
  const sort = document.getElementById('sort');
  pg.value = postState.page; sort.value = postState.sort;
  pg.onchange = () => { postState.page = pg.value; loadPosts(); };
  sort.onchange = () => { postState.sort = sort.value; renderPosts(); };
  document.getElementById('reload').onclick = loadPosts;
  await loadPosts();
}

// ---------- Báo cáo hiệu quả Fanpage ----------
const repState = { page: '', days: 30, group: 'day', metric: 'messages_in' };
// Chỉ số vẽ biểu đồ: [khóa, nhãn, cách lấy giá trị từ một ngày]
const REP_SERIES = [
  ['messages_in', 'Tin nhắn từ khách', (d) => d.messages_in],
  ['comments_in', 'Bình luận của khách', (d) => d.comments_in],
  ['new_chats', 'Khách nhắn mới', (d) => d.new_chats],
  ['replies', 'Trả lời của Trang', (d) => d.replies],
  ['engagement', 'Tương tác bài đăng', (d) => d.reactions + d.post_comments + d.shares],
  ['page_post_engagements', 'Tương tác với nội dung', (d) => d.insights.page_post_engagements],
  ['page_impressions_unique', 'Người tiếp cận', (d) => d.insights.page_impressions_unique],
  ['page_media_view', 'Lượt xem nội dung', (d) => d.insights.page_media_view],
  ['page_views_total', 'Lượt xem Trang', (d) => d.insights.page_views_total],
  ['page_total_actions', 'Lượt nhấp nút liên hệ', (d) => d.insights.page_total_actions],
  ['page_daily_follows_unique', 'Người theo dõi mới', (d) => d.insights.page_daily_follows_unique],
];
const fmtDur = (s) => (s === null || s === undefined ? '–' : s < 60 ? `${s} giây` : s < 3600 ? `${Math.round(s / 60)} phút` : `${(s / 3600).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ`);
const ddmm = (k) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;
// So với kỳ trước: mũi tên và phần trăm (chữ màu chữ thường, không dùng màu để báo tốt xấu).
const delta = (cur, prev) => {
  if (prev === null || prev === undefined) return '';
  if (!prev) return cur ? '<span class="delta">kỳ trước 0</span>' : '';
  const p = Math.round(((cur - prev) / prev) * 100);
  return `<span class="delta">${p > 0 ? '▲' : p < 0 ? '▼' : '='} ${Math.abs(p)}% so với kỳ trước</span>`;
};

// Gộp theo tuần (bắt đầu thứ Hai).
function groupWeeks(daily) {
  const weeks = [];
  for (const d of daily) {
    const dt = new Date(`${d.date}T00:00:00Z`);
    const mon = new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    let w = weeks[weeks.length - 1];
    if (!w || w.key !== mon) { w = { key: mon, date: d.date, end: d.date, days: [] }; weeks.push(w); }
    w.end = d.date; w.days.push(d);
  }
  return weeks;
}

// ---------- Nguồn nội dung: website và Fanpage để chọn bài chia sẻ hoặc cho AI viết lại ----------
const SRC_TYPE = { article: 'Bài viết', post: 'Bài đăng', video: 'Video' };
let srcState = { id: null, type: '', kw: (() => { try { return localStorage.getItem('fbsKw') || ''; } catch { return ''; } })() };
let srcCache = { key: '', items: [], errors: [] };
// Bỏ dấu để tìm "sau rieng" vẫn khớp "sầu riêng".
const fold = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
const kwList = (t) => String(t || '').split(/[,;\n]/).map((k) => fold(k).trim()).filter(Boolean);
async function viewSources() {
  layout('nguon-noi-dung', 'Nguồn nội dung', 'Xem bài viết, bài đăng, video từ website và Fanpage để chia sẻ hoặc cho AI viết bài mới', '<div class="muted">Đang tải…</div>', '<button class="btn" id="addsrc">Thêm nguồn</button>');
  const [{ sources, ai_provider }, { pages }] = await Promise.all([api('/api/sources'), api('/api/pages')]);
  const usable = pages.filter((p) => p.status !== 'disconnected');
  const v = document.getElementById('view');
  const aiNote = ai_provider
    ? `<div class="muted small">AI đang dùng: <b>${esc(ai_provider)}</b>.</div>`
    : `<div class="muted small">Chưa bật AI.${me.role === 'owner' ? ' Để dùng Claude hoặc DeepSeek, Quý khách thêm biến bí mật ANTHROPIC_API_KEY hoặc DEEPSEEK_API_KEY trong Cloudflare (Worker farmbase-social, Settings, Variables and Secrets).' : ''}</div>`;
  if (!sources.length) {
    v.innerHTML = `<div class="card"><p style="margin-top:0">Chưa có nguồn nào. Bấm <b>Thêm nguồn</b> để thêm tin tức theo từ khóa (ví dụ sầu riêng), website hoặc Fanpage đã kết nối.</p>${aiNote}</div>`;
  } else {
    if (srcState.id !== 'all' && !sources.some((s) => String(s.id) === String(srcState.id))) srcState.id = sources.length > 1 ? 'all' : sources[0].id;
    v.innerHTML = `<div class="card filters fsrc">
        <div><label for="ssel">Nguồn</label><select id="ssel">${sources.length > 1 ? `<option value="all">Tất cả nguồn (${sources.length})</option>` : ''}${sources.map((s) => `<option value="${s.id}">${{ fanpage: 'Fanpage: ', news: 'Tin tức: ' }[s.kind] || 'Website: '}${esc(s.name)}</option>`).join('')}</select></div>
        <div><label for="stype">Loại</label><select id="stype"><option value="">Tất cả</option><option value="article">Bài viết</option><option value="post">Bài đăng</option><option value="video">Video</option></select></div>
        <div class="kw"><label for="skw">Từ khóa</label><input id="skw" type="search" placeholder="Ví dụ: sầu riêng, truy xuất nguồn gốc" value="${esc(srcState.kw)}"></div>
        <div class="end row"><button class="btn ghost" id="sreload">Tải lại</button>${me.role === 'owner' || me.role === 'manager' ? '<button class="btn ghost danger" id="srm">Bỏ nguồn</button>' : ''}</div></div>
      <div class="card">${aiNote}<div class="muted small">Chia sẻ: AI viết lời giới thiệu ngắn kèm liên kết bài gốc. AI viết bài: AI đọc bài gốc và viết bài mới, cuối bài luôn ghi "Nguồn:". Bài chỉ lên Fanpage sau khi Quý khách duyệt.</div></div>
      <div id="sitems"></div>`;
    const sel = document.getElementById('ssel'); const ty = document.getElementById('stype'); const kw = document.getElementById('skw');
    const rm = document.getElementById('srm');
    const syncRm = () => { if (rm) rm.disabled = srcState.id === 'all'; };
    sel.value = String(srcState.id); ty.value = srcState.type; syncRm();
    sel.onchange = () => { srcState.id = sel.value; syncRm(); loadSourceItems(usable, sources); };
    ty.onchange = () => { srcState.type = ty.value; renderSourceItems(usable); };
    let t;
    kw.oninput = () => { clearTimeout(t); t = setTimeout(() => { srcState.kw = kw.value; try { localStorage.setItem('fbsKw', kw.value); } catch {} renderSourceItems(usable); }, 250); };
    document.getElementById('sreload').onclick = () => { srcCache.key = ''; loadSourceItems(usable, sources); };
    if (rm) rm.onclick = () => removeSource(sources.find((s) => String(s.id) === String(srcState.id)));
    loadSourceItems(usable, sources);
  }
  document.getElementById('addsrc').onclick = () => openAddSource(usable);
}

function openAddSource(pages) {
  modal(`<h2>Thêm nguồn nội dung</h2>
    <form id="sf" novalidate>
      <label>Loại nguồn</label>
      <div class="pick"><label class="check"><input type="radio" name="kind" value="news" checked> Tin tức theo từ khóa</label><label class="check"><input type="radio" name="kind" value="website"> Website</label><label class="check"><input type="radio" name="kind" value="fanpage"> Fanpage đã kết nối</label></div>
      <div id="sfn"><label for="skey">Từ khóa</label><input id="skey" maxlength="100" placeholder="Ví dụ: sầu riêng">
        <label for="ssite">Chỉ lấy từ báo, website (không bắt buộc)</label><input id="ssite" placeholder="Ví dụ: nongnghiepmoitruong.vn">
        <div class="muted small">Hệ thống tìm tin mới trong ${15} ngày gần nhất trên các báo (qua Bing News), có ảnh và liên kết bài gốc. Bài trên Fanpage của báo thường lấy từ website của báo, nên Quý khách nhập website báo để lấy cùng nội dung.</div></div>
      <div id="sfw" hidden><label for="surl">Địa chỉ website</label><input id="surl" type="url" placeholder="https://farmbase.vn">
        <div class="muted small">Hệ thống tự tìm RSS hoặc dữ liệu bài viết công khai của website. Có thể dán thẳng địa chỉ RSS.</div></div>
      <div id="sfp" hidden><label for="spg">Fanpage</label>${pages.length ? `<select id="spg">${pages.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>` : '<div class="muted">Chưa có Fanpage nào được kết nối.</div>'}
        <div class="muted small">Facebook chỉ cho đọc bài của Fanpage mà Quý khách quản lý và đã kết nối vào hệ thống.</div></div>
      <div id="sfmsg"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Hủy</button><button type="button" class="btn" id="sfgo">Thêm</button></div>
    </form>`, (m, close) => {
    const f = m.querySelector('#sf');
    const sw = () => { const k = f.querySelector('input[name=kind]:checked').value; m.querySelector('#sfw').hidden = k !== 'website'; m.querySelector('#sfp').hidden = k !== 'fanpage'; m.querySelector('#sfn').hidden = k !== 'news'; };
    f.querySelectorAll('input[name=kind]').forEach((r) => (r.onchange = sw));
    m.querySelector('[data-close]').onclick = close;
    m.querySelector('#sfgo').onclick = async (e) => {
      const kind = f.querySelector('input[name=kind]:checked').value;
      const body = kind === 'website' ? { kind, url: f.surl.value.trim() } : kind === 'news' ? { kind, keyword: f.skey.value.trim(), site: f.ssite.value.trim() } : { kind, page_id: f.spg?.value };
      if (kind === 'news' && !body.keyword) { m.querySelector('#sfmsg').innerHTML = '<div class="alert err">Vui lòng nhập từ khóa.</div>'; return; }
      const box = m.querySelector('#sfmsg');
      if (kind === 'website' && !body.url) { box.innerHTML = '<div class="alert err">Vui lòng nhập địa chỉ website.</div>'; return; }
      if (kind === 'fanpage' && !body.page_id) { box.innerHTML = '<div class="alert err">Chưa có Fanpage để chọn.</div>'; return; }
      e.target.disabled = true; box.innerHTML = '<div class="muted small">Đang kiểm tra nguồn…</div>';
      try { const r = await api('/api/sources', { method: 'POST', body }); srcState.id = r.id; close(); toast('Đã thêm nguồn'); viewSources(); }
      catch (err) { box.innerHTML = `<div class="alert err">${esc(err.message)}</div>`; e.target.disabled = false; }
    };
  });
}

async function removeSource(s) {
  if (!s) return;
  if (!(await confirmBox('Bỏ nguồn này?', `"${s.name}" sẽ không còn trong danh sách nguồn. Bài trên website và Fanpage không bị ảnh hưởng.`, 'Bỏ nguồn', true))) return;
  try { await api(`/api/sources/${s.id}`, { method: 'DELETE' }); srcState.id = null; toast('Đã bỏ nguồn'); viewSources(); } catch (e) { toast(e.message); }
}

async function loadSourceItems(pages, sources) {
  const box = document.getElementById('sitems');
  if (!box) return;
  const list = srcState.id === 'all' ? sources : sources.filter((s) => String(s.id) === String(srcState.id));
  const key = list.map((s) => s.id).join(',');
  if (srcCache.key !== key) {
    box.innerHTML = `<div class="muted">Đang đọc nội dung${list.length > 1 ? ` từ ${list.length} nguồn` : ''}…</div>`;
    const res = await Promise.allSettled(list.map((s) => api(`/api/sources/${encodeURIComponent(s.id)}/items`, { quiet: true })));
    const items = []; const errors = [];
    res.forEach((r, i) => {
      if (r.status === 'fulfilled') r.value.items.forEach((it) => items.push({ ...it, src: list[i].name }));
      else errors.push(`${list[i].name}: ${r.reason.message}`);
    });
    items.sort((a, b) => (b.date || 0) - (a.date || 0));
    const seen = new Set();
    srcCache = { key, items: items.filter((it) => (seen.has(it.url) ? false : seen.add(it.url))), errors };
  }
  renderSourceItems(pages);
}

function renderSourceItems(pages) {
  const box = document.getElementById('sitems');
  if (!box) return;
  const kws = kwList(srcState.kw);
  const many = srcState.id === 'all';
  const items = srcCache.items.filter((i) => (!srcState.type || i.type === srcState.type)
    && (!kws.length || kws.some((k) => fold(`${i.title} ${i.summary}`).includes(k))));
  const err = srcCache.errors.length ? `<div class="alert err small">Không đọc được: ${srcCache.errors.map(esc).join('; ')}</div>` : '';
  const head = kws.length ? `<div class="muted small srccount">Có <b>${items.length}</b> bài khớp từ khóa (${kws.length > 1 ? 'chứa một trong các từ' : 'chứa từ'} đã nhập), trong ${srcCache.items.length} bài mới nhất.</div>` : '';
  if (!items.length) { box.innerHTML = `${err}${head}<div class="card"><p class="muted" style="margin:0">${kws.length ? 'Chưa có bài nào khớp từ khóa. Quý khách thử từ khóa khác hoặc chọn "Tất cả nguồn".' : 'Chưa có nội dung phù hợp.'}</p></div>`; return; }
  box.innerHTML = `${err}${head}<div class="srcgrid">${items.map((it, i) => `<article class="srcitem">
      ${it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="noimg"></div>'}
      <div class="sbody"><div class="muted small"><span class="tag">${SRC_TYPE[it.type] || 'Bài viết'}</span> ${it.date ? fmtTime(it.date) : ''}</div>${many || it.publisher ? `<div class="muted small">${esc([it.publisher, many ? it.src : ''].filter(Boolean).join(' · '))}</div>` : ''}
        <h3>${esc(it.title)}</h3><p class="muted small">${esc(it.summary || '')}</p></div>
      <div class="row sact"><button class="btn sm" data-share="${i}">Chia sẻ</button><button class="btn ghost sm" data-rew="${i}">AI viết bài</button><a class="btn ghost sm" href="${esc(it.url)}" target="_blank" rel="noopener">Mở</a></div>
    </article>`).join('')}</div>`;
  const run = (it, mode) => {
    if (!pages.length) return toast(me.role === 'owner' ? 'Vui lòng kết nối Fanpage trước' : 'Quý khách chưa được giao Fanpage nào');
    modal(`<h2>${mode === 'share' ? 'Chia sẻ bài này' : 'AI viết bài mới từ bài này'}</h2>
      <p class="muted small">${esc(it.title)}</p>
      <label>Đăng lên Fanpage</label><div class="pick">${pages.map((p) => `<label class="check"><input type="checkbox" name="wpg" value="${esc(p.id)}" ${pages.length === 1 ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>
      ${mode === 'rewrite' ? '<label for="wlen">Độ dài</label><select id="wlen"><option value="ngan">Ngắn</option><option value="vua" selected>Vừa</option><option value="dai">Dài</option></select>' : ''}
      <div id="wmsg"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Hủy</button><button type="button" class="btn" id="wgo">Viết bằng AI</button></div>`, (m, close) => {
      m.querySelector('[data-close]').onclick = close;
      m.querySelector('#wgo').onclick = async (e) => {
        const page_ids = [...m.querySelectorAll('input[name=wpg]:checked')].map((x) => x.value);
        const box2 = m.querySelector('#wmsg');
        if (!page_ids.length) { box2.innerHTML = '<div class="alert err">Vui lòng chọn ít nhất một Fanpage.</div>'; return; }
        e.target.disabled = true; box2.innerHTML = '<div class="muted small">AI đang viết, khoảng 10 đến 30 giây…</div>';
        try {
          const [r, c] = await Promise.all([
            api('/api/sources/write', { method: 'POST', body: { url: it.url, title: it.title, summary: it.summary, mode, length: m.querySelector('#wlen')?.value || 'vua', page_ids } }),
            api('/api/content?status=draft').catch(() => ({})),
          ]);
          close();
          const chosen = pages.filter((p) => page_ids.includes(p.id));
          const isFb = /facebook\.com/.test(it.url);
          openContentForm(chosen, null, { can_create: true, can_approve: me.role === 'owner' || me.role === 'manager', media_enabled: !!c.media_enabled },
            { message: r.body ?? r.text, link: r.link || '', image_url: mode === 'rewrite' && it.image && !isFb ? it.image : '' });
          toast('AI đã viết xong. Quý khách đọc lại trước khi lưu hoặc đăng.');
        } catch (err) { box2.innerHTML = `<div class="alert err">${esc(err.message)}</div>`; e.target.disabled = false; }
      };
    });
  };
  box.querySelectorAll('[data-share]').forEach((b) => (b.onclick = () => run(items[Number(b.dataset.share)], 'share')));
  box.querySelectorAll('[data-rew]').forEach((b) => (b.onclick = () => run(items[Number(b.dataset.rew)], 'rewrite')));
}

async function viewReport() {
  layout('bao-cao', 'Báo cáo', 'Hiệu quả tương tác, tin nhắn, bình luận của từng Fanpage theo ngày, theo tuần', '<div class="muted">Đang tải…</div>');
  const { pages } = await api('/api/pages');
  const usable = pages.filter((p) => p.status !== 'disconnected');
  const v = document.getElementById('view');
  if (!usable.length) { v.innerHTML = '<div class="card"><p class="muted" style="margin:0">Chưa có Fanpage nào để báo cáo.</p></div>'; return; }
  if (!usable.some((p) => p.id === repState.page)) repState.page = usable[0].id;
  v.innerHTML = `<div class="card filters f3">
      <div><label for="rpg">Fanpage</label><select id="rpg">${usable.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div><label for="rdays">Khoảng thời gian</label><select id="rdays">${[7, 15, 30, 90].map((n) => `<option value="${n}">${n} ngày gần nhất</option>`).join('')}</select></div>
      <div><label for="rgrp">Xem theo</label><select id="rgrp"><option value="day">Ngày</option><option value="week">Tuần</option></select></div>
      <div class="end"><button class="btn ghost" id="reload">Tải lại</button></div></div><div id="rep"></div>`;
  const pg = document.getElementById('rpg'); const dy = document.getElementById('rdays'); const gr = document.getElementById('rgrp');
  pg.value = repState.page; dy.value = String(repState.days); gr.value = repState.group;
  let data = null;
  const load = async () => {
    const box = document.getElementById('rep');
    box.innerHTML = '<div class="muted">Đang tổng hợp số liệu…</div>';
    try { data = await api(`/api/report?page_id=${encodeURIComponent(repState.page)}&days=${repState.days}`, { quiet: true }); } catch (e) { box.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return; }
    renderReport(data);
  };
  pg.onchange = () => { repState.page = pg.value; load(); };
  dy.onchange = () => { repState.days = Number(dy.value); load(); };
  gr.onchange = () => { repState.group = gr.value; if (data) renderReport(data); };
  document.getElementById('reload').onclick = load;
  await load();
}

function renderReport(d) {
  const box = document.getElementById('rep');
  const ib = d.inbox; const pv = d.inbox_prev; const m = d.metrics;
  const has = (k) => m[k] !== undefined;
  const stat = (label, n, sub) => `<div class="card stat"><div class="muted small">${label}</div><div class="n">${n}</div><div class="muted small">${sub || '&nbsp;'}</div></div>`;
  const insightCards = ['page_post_engagements', 'page_impressions_unique', 'page_media_view', 'page_views_total', 'page_total_actions']
    .filter(has).map((k) => stat(esc(m[k].label), fmtNum(m[k].total), delta(m[k].total, m[k].prev))).join('');
  const series = REP_SERIES.filter(([k]) => !k.startsWith('page_') || has(k));
  if (!series.some(([k]) => k === repState.metric)) repState.metric = 'messages_in';
  const [mk, ml, mf] = series.find(([k]) => k === repState.metric);
  const periods = repState.group === 'week'
    ? groupWeeks(d.daily).map((w) => ({ label: `${ddmm(w.date)}–${ddmm(w.end)}`, sum: (f) => w.days.reduce((s, x) => s + (f(x) || 0), 0), days: w.days }))
    : d.daily.map((x) => ({ label: ddmm(x.date), sum: (f) => f(x) || 0, days: [x] }));
  const vals = periods.map((p) => p.sum(mf));
  const max = Math.max(0, ...vals);
  const chips = series.map(([k, l]) => `<button class="chip ${k === mk ? 'on' : ''}" data-m="${k}">${l}</button>`).join('');
  const chart = `<div class="card"><h2>${esc(ml)} theo ${repState.group === 'week' ? 'tuần' : 'ngày'}</h2><div class="chips">${chips}</div>
    <div class="bars ${periods.length > 40 ? 'dense' : ''}" role="img" aria-label="${esc(ml)}, cao nhất ${fmtNum(max)}">${periods.map((p, i) => `<div class="bar" tabindex="0" data-tip="${esc(p.label)}: ${fmtNum(vals[i])}"><span style="height:${max ? Math.max(vals[i] ? 2 : 0, Math.round((vals[i] / max) * 100)) : 0}%"></span></div>`).join('')}</div>
    <div class="row between muted small" style="flex-wrap:nowrap"><span>${esc(periods[0].label)}</span><span>Cao nhất ${fmtNum(max)}</span><span>${esc(periods[periods.length - 1].label)}</span></div></div>`;
  const cols = [
    ['Tin nhắn', (x) => x.messages_in], ['Bình luận', (x) => x.comments_in], ['Khách mới', (x) => x.new_chats + x.new_commenters], ['Trả lời', (x) => x.replies],
    ['Bài đăng', (x) => x.posts], ['Tương tác bài', (x) => x.reactions + x.post_comments + x.shares],
    ...['page_post_engagements', 'page_impressions_unique', 'page_media_view', 'page_total_actions', 'page_daily_follows_unique'].filter(has).map((k) => [REP_SERIES.find(([s]) => s === k)[1], (x) => x.insights[k]]),
  ];
  const table = `<details class="card" ${window.innerWidth >= 900 ? 'open' : ''}><summary><h2 style="display:inline">Bảng số liệu theo ${repState.group === 'week' ? 'tuần' : 'ngày'}</h2></summary><div class="tscroll"><table class="cards rep"><thead><tr><th>${repState.group === 'week' ? 'Tuần' : 'Ngày'}</th>${cols.map(([l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>
    ${[...periods].reverse().map((p) => `<tr><td><b>${esc(p.label)}</b></td>${cols.map(([l, f]) => `<td data-l="${esc(l)}">${fmtNum(p.sum(f))}</td>`).join('')}</tr>`).join('')}
    <tr class="total"><td><b>Tổng</b></td>${cols.map(([l, f]) => `<td data-l="${esc(l)}"><b>${fmtNum(d.daily.reduce((s, x) => s + (f(x) || 0), 0))}</b></td>`).join('')}</tr></tbody></table></div></details>`;
  const insightErr = Object.keys(m).length === 0 && d.errors.some((e) => e.source.startsWith('page_'));
  const notes = [
    d.inbox_since ? `Tin nhắn, bình luận được hệ thống ghi nhận từ ${fmtTime(d.inbox_since)} (lúc bật nhận tin tự động); trước đó chưa có số liệu.` : 'Hệ thống chưa ghi nhận tin nhắn, bình luận nào của Fanpage này.',
    'Tương tác bài đăng là tổng cảm xúc, bình luận, chia sẻ của các bài đăng trong ngày đó (tính đến hiện tại).',
    insightErr ? 'Chưa lấy được lượt xem, người tiếp cận, người theo dõi mới từ Facebook: Chủ hệ thống cần kết nối lại Fanpage để cấp thêm quyền xem thống kê Trang.' : '',
    d.errors.some((e) => e.source === 'posts') ? `Chưa lấy được bài đăng: ${esc(d.errors.find((e) => e.source === 'posts').message)}` : '',
  ].filter(Boolean).map((t) => `<li>${t}</li>`).join('');
  // Hôm nay so với hôm qua cùng giờ.
  const td = d.today;
  const cmp = (k, label) => {
    const a = td.today[k]; const b = td.yesterday_same_time[k];
    return stat(label, fmtNum(a), `${delta(a, b).replace('so với kỳ trước', 'so với hôm qua') || `Hôm qua cùng giờ: ${fmtNum(b)}`} · cả ngày hôm qua ${fmtNum(td.yesterday[k])}`);
  };
  const todayBox = `<h2 class="sec">Hôm nay so với hôm qua <span class="muted small" style="font-weight:400">(tính tới ${td.hour} giờ, so với cùng giờ hôm qua)</span></h2>
    <div class="grid stats4">${cmp('messages_in', 'Tin nhắn hôm nay')}${cmp('comments_in', 'Bình luận hôm nay')}${cmp('new_customers', 'Khách mới hôm nay')}${cmp('replies', 'Trang trả lời hôm nay')}</div>`;
  const follows = m.page_daily_follows_unique;
  const unf = m.page_daily_unfollows_unique;
  const pageCards = (d.stats.fan_count !== null ? stat('Lượt thích Trang', fmtNum(d.stats.fan_count), 'Số hiện tại') : '')
    + (d.stats.followers_count !== null ? stat('Người theo dõi', fmtNum(d.stats.followers_count), follows ? `+${fmtNum(follows.total)} trong kỳ${unf ? `, bỏ theo dõi ${fmtNum(unf.total)}` : ''}` : 'Số hiện tại') : '');
  // Khung giờ: lưới thứ × giờ, màu một sắc đậm dần theo số tương tác.
  const WD = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];
  const hmax = Math.max(0, ...d.heat.flat());
  const hourTot = Array.from({ length: 24 }, (_, h) => d.heat.reduce((s2, r) => s2 + r[h], 0));
  const dayTot = d.heat.map((r) => r.reduce((a, b) => a + b, 0));
  const topH = hourTot.indexOf(Math.max(...hourTot)); const topD = dayTot.indexOf(Math.max(...dayTot));
  const lvl = (v) => (!v || !hmax ? 0 : Math.min(4, Math.ceil((v / hmax) * 4)));
  const heat = `<div class="card"><h2>Khung giờ khách tương tác</h2>
    <p class="muted small" style="margin-top:0">${hmax ? `Khách nhắn tin, bình luận nhiều nhất lúc <b>${topH}–${topH + 1} giờ</b> và vào <b>${WD[topD]}</b>. Nên đăng bài và trực hộp thư trước khung giờ này.` : 'Chưa có tin nhắn, bình luận nào trong kỳ để tính khung giờ.'}</p>
    <div class="tscroll"><div class="heat" role="img" aria-label="Số tin nhắn và bình luận của khách theo thứ và giờ">
      <span></span>${Array.from({ length: 24 }, (_, h) => `<span class="hh">${h % 3 === 0 ? h : ''}</span>`).join('')}
      ${d.heat.map((r, i) => `<span class="hd">${WD[i].replace('Thứ ', 'T').replace('Chủ Nhật', 'CN')}</span>${r.map((v, h) => `<span class="hc l${lvl(v)}" title="${WD[i]}, ${h}–${h + 1} giờ: ${v} tương tác"></span>`).join('')}`).join('')}
    </div></div>
    <div class="row muted small heat-key">Ít <span class="hc l0"></span><span class="hc l1"></span><span class="hc l2"></span><span class="hc l3"></span><span class="hc l4"></span> Nhiều · tính trên tin nhắn và bình luận của khách trong kỳ</div></div>`;
  // Hiệu quả từng bài gần đây.
  const vLabel = d.views_metric === 'post_impressions_unique' ? 'người tiếp cận' : 'lượt xem';
  const recent = d.recent_posts.length ? `<div class="card"><h2>Bài đăng gần đây</h2><div class="rposts">${d.recent_posts.map((p) => `<a class="rpost" ${p.permalink_url ? `href="${esc(p.permalink_url)}" target="_blank" rel="noopener"` : ''}>
      ${p.picture ? `<img src="${esc(p.picture)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="rtext">${esc(p.message || '(Không có chữ)')}</div>`}
      <div class="rbody"><div class="muted small">${fmtTime(p.created_time)}</div>
        ${p.views !== null ? `<div class="rv"><b>${fmtNum(p.views)}</b> ${vLabel}</div>` : `<div class="rv"><b>${fmtNum(p.engagement)}</b> tương tác</div>`}
        <div class="muted small">👍 ${fmtNum(p.reactions)} · 💬 ${fmtNum(p.comments)} · ↗ ${fmtNum(p.shares)}</div></div></a>`).join('')}</div>
      ${d.views_metric ? '' : '<p class="muted small" style="margin-bottom:0">Lượt xem từng bài sẽ hiện sau khi Chủ hệ thống kết nối lại Fanpage và cấp quyền xem thống kê Trang.</p>'}</div>` : '';
  box.innerHTML = `<p class="muted small" style="margin-top:0">${esc(d.page.name)} · từ ${d.from.split('-').reverse().join('/')} đến ${d.to.split('-').reverse().join('/')}</p>
    ${todayBox}
    <h2 class="sec">Tin nhắn và bình luận trong kỳ</h2>
    <div class="grid stats4">
      ${stat('Tin nhắn từ khách', fmtNum(ib.messages_in), delta(ib.messages_in, pv.messages_in))}
      ${stat('Bình luận của khách', fmtNum(ib.comments_in), delta(ib.comments_in, pv.comments_in))}
      ${stat('Khách mới', fmtNum(ib.new_chats + ib.new_commenters), `${fmtNum(ib.new_chats)} nhắn tin, ${fmtNum(ib.new_commenters)} bình luận`)}
      ${stat('Thời gian trả lời tin nhắn', fmtDur(ib.median_response_secs), `${fmtNum(ib.replies)} lượt trả lời${ib.auto_replies ? `, ${fmtNum(ib.auto_replies)} tự động` : ''}${ib.unanswered ? ` · ${fmtNum(ib.unanswered)} khách chờ` : ''}`)}
    </div>
    <h2 class="sec">Nội dung và Trang</h2>
    <div class="grid stats4">
      ${pageCards}
      ${d.posts ? stat('Bài đăng', fmtNum(d.posts.posts), `${fmtNum(d.posts.reactions)} cảm xúc, ${fmtNum(d.posts.post_comments)} bình luận, ${fmtNum(d.posts.shares)} chia sẻ`) : ''}
      ${insightCards}
    </div>
    ${chart}${heat}${recent}${table}<div class="card"><ul class="muted small" style="margin:0;padding-left:18px">${notes}</ul></div>`;
  box.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { repState.metric = b.dataset.m; renderReport(d); }; });
  box.querySelectorAll('.bar').forEach((b) => { b.onclick = () => toast(b.dataset.tip); });
}

// ---------- Quảng cáo (chỉ xem) ----------
const ADS_PRESETS = [['today', 'Hôm nay'], ['yesterday', 'Hôm qua'], ['last_7d', '7 ngày qua'], ['last_30d', '30 ngày qua'], ['this_month', 'Tháng này'], ['last_month', 'Tháng trước'], ['maximum', 'Toàn thời gian']];
const CAMP_STATUS = {
  ACTIVE: ['Đang chạy', ''], PAUSED: ['Tạm dừng', 'off'], CAMPAIGN_PAUSED: ['Tạm dừng', 'off'], ARCHIVED: ['Lưu trữ', 'off'], DELETED: ['Đã xóa', 'off'],
  IN_PROCESS: ['Đang xử lý', 'warn'], WITH_ISSUES: ['Có vấn đề', 'err'], PENDING_REVIEW: ['Chờ duyệt', 'warn'], DISAPPROVED: ['Bị từ chối', 'err'], PENDING_BILLING_INFO: ['Thiếu thanh toán', 'err'],
};
const ACC_STATUS = { active: ['Đang hoạt động', ''], disabled: ['Bị vô hiệu hóa', 'err'], unsettled: ['Chưa thanh toán', 'err'], pending_review: ['Đang xét duyệt', 'warn'], grace_period: ['Gia hạn thanh toán', 'warn'], closed: ['Đã đóng', 'off'] };
const OBJECTIVE = {
  OUTCOME_ENGAGEMENT: 'Tương tác', OUTCOME_TRAFFIC: 'Lưu lượng truy cập', OUTCOME_AWARENESS: 'Nhận biết', OUTCOME_LEADS: 'Khách hàng tiềm năng',
  OUTCOME_SALES: 'Doanh số', OUTCOME_APP_PROMOTION: 'Quảng bá ứng dụng', MESSAGES: 'Tin nhắn', POST_ENGAGEMENT: 'Tương tác bài viết', LINK_CLICKS: 'Lượt nhấp',
};
const adsState = { account: '', preset: 'last_7d', accounts: [] };
const fmtMoney = (v, cur) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: cur === 'VND' ? 0 : 2 }) + (cur === 'VND' ? ' ₫' : ` ${cur}`));

async function viewAds(q) {
  if (q && q.get('cd')) return viewCampaign(q.get('cd'));
  layout('quang-cao', 'Quảng cáo', 'Chiến dịch, chi tiêu và kết quả của các tài khoản quảng cáo Facebook', '<div class="muted">Đang tải…</div>');
  const v = document.getElementById('view');
  let d;
  try { d = await api('/api/ads/accounts', { quiet: true }); } catch (e) {
    v.innerHTML = `<div class="card"><h2>Chưa xem được quảng cáo</h2><p class="muted">${esc(e.message)}</p>
      ${me.role === 'owner' ? '<a class="btn" href="#/fanpage">Đến mục Fanpage</a>' : ''}</div>`;
    return;
  }
  adsState.accounts = d.accounts;
  if (!d.accounts.length) {
    v.innerHTML = `<div class="card"><p class="muted" style="margin:0">Tài khoản Facebook đã kết nối chưa có tài khoản quảng cáo nào, hoặc chưa đồng ý quyền xem quảng cáo khi đăng nhập. Chủ hệ thống có thể bấm "Kết nối Fanpage" ở mục Fanpage để đăng nhập lại và chọn tài khoản quảng cáo.</p></div>`;
    return;
  }
  if (!d.accounts.some((a) => a.id === adsState.account)) adsState.account = (d.accounts.find((a) => a.status === 'active') || d.accounts[0]).id;
  v.innerHTML = `
    <div class="card filters">
      <div><label for="acc">Tài khoản quảng cáo</label><select id="acc">${d.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></div>
      <div><label for="pre">Thời gian</label><select id="pre">${ADS_PRESETS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div class="end"><button class="btn ghost" id="reload">Tải lại</button></div>
    </div>
    <div id="ads"></div>`;
  const acc = document.getElementById('acc');
  const pre = document.getElementById('pre');
  acc.value = adsState.account; pre.value = adsState.preset;
  acc.onchange = () => { adsState.account = acc.value; loadAds(); };
  pre.onchange = () => { adsState.preset = pre.value; loadAds(); };
  document.getElementById('reload').onclick = loadAds;
  await loadAds();
}

async function loadAds() {
  const box = document.getElementById('ads');
  box.innerHTML = '<div class="muted">Đang tải số liệu từ Facebook…</div>';
  let d;
  try { d = await api(`/api/ads/accounts/${encodeURIComponent(adsState.account)}/campaigns?preset=${adsState.preset}`, { quiet: true }); } catch (e) {
    box.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return;
  }
  const cur = d.account.currency;
  const t = d.totals;
  const info = adsState.accounts.find((a) => a.id === d.account.id) || {};
  const [al, ac] = ACC_STATUS[d.account.status] || ['Khác', 'off'];
  const rows = d.campaigns.map((c) => {
    const [sl, sc] = CAMP_STATUS[c.status] || [c.status, 'off'];
    const i = c.insights;
    const budget = c.daily_budget !== null ? `${fmtMoney(c.daily_budget, cur)}/ngày` : c.lifetime_budget !== null ? `${fmtMoney(c.lifetime_budget, cur)} trọn đời` : 'Theo nhóm quảng cáo';
    return `<tr>
      <td><b><a href="#/quang-cao?cd=${encodeURIComponent(c.id)}">${esc(c.name)}</a></b><div class="muted small">${esc(OBJECTIVE[c.objective] || c.objective || '')}</div></td>
      <td><span class="badge ${sc}">${esc(sl)}</span></td>
      <td data-l="Ngân sách">${budget}</td>
      <td data-l="Chi tiêu"><b>${c.has_data ? fmtMoney(i.spend, cur) : '–'}</b></td>
      <td data-l="Hiển thị">${c.has_data ? fmtNum(i.impressions) : '–'}</td>
      <td data-l="Lượt nhấp">${c.has_data ? fmtNum(i.clicks) : '–'}</td>
      <td data-l="Tin nhắn">${c.has_data ? fmtNum(i.messages) : '–'}</td>
      <td data-l="Chi phí/tin nhắn">${i.cost_per_message !== null ? fmtMoney(i.cost_per_message, cur) : '–'}</td>
    </tr>`;
  }).join('');
  box.innerHTML = `
    <div class="row between ads-head"><div><span class="badge ${ac}">${esc(al)}</span> <span class="muted small">Đã chi từ trước tới nay: ${fmtMoney(info.amount_spent, cur)}</span></div>
      ${info.link ? `<a class="btn ghost sm" href="${esc(info.link)}" target="_blank" rel="noopener">Mở trong Trình quản lý quảng cáo</a>` : ''}</div>
    <div class="grid stats4">
      <div class="card stat"><div class="muted small">Chi tiêu</div><div class="n">${fmtMoney(t.spend, cur)}</div></div>
      <div class="card stat"><div class="muted small">Tin nhắn mới</div><div class="n">${fmtNum(t.messages)}</div><div class="muted small">${t.cost_per_message !== null ? `${fmtMoney(t.cost_per_message, cur)} mỗi tin nhắn` : '&nbsp;'}</div></div>
      <div class="card stat"><div class="muted small">Người tiếp cận</div><div class="n">${fmtNum(t.reach)}</div><div class="muted small">${fmtNum(t.impressions)} lượt hiển thị</div></div>
      <div class="card stat"><div class="muted small">Lượt nhấp</div><div class="n">${fmtNum(t.clicks)}</div><div class="muted small">${t.ctr !== null ? `Tỷ lệ nhấp ${t.ctr.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%` : '&nbsp;'}</div></div>
    </div>
    <p class="muted small">Số liệu lấy trực tiếp từ Facebook lúc tải trang, có thể chênh nhẹ so với Trình quản lý quảng cáo trong vài giờ gần nhất. Ở đây chỉ xem; bấm tên chiến dịch để xem chi tiết; muốn bật, tắt hay sửa thì mở Trình quản lý quảng cáo.</p>
    <div class="card">${rows ? `<table class="cards ads"><thead><tr><th>Chiến dịch</th><th>Trạng thái</th><th>Ngân sách</th><th>Chi tiêu</th><th>Hiển thị</th><th>Lượt nhấp</th><th>Tin nhắn</th><th>Chi phí/tin nhắn</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted" style="margin:0">Tài khoản này chưa có chiến dịch nào.</p>'}</div>`;
}

const GENDER = { male: 'Nam', female: 'Nữ', unknown: 'Không rõ' };
const PLATFORM = { facebook: 'Facebook', instagram: 'Instagram', messenger: 'Messenger', audience_network: 'Audience Network', threads: 'Threads', whatsapp: 'WhatsApp' };
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const fmtPct = (v) => (v === null || v === undefined ? '–' : `${Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`);

// Thanh ngang cho bảng (độ lớn tương đối), kèm số ở bên phải.
const hbar = (v, max, label) => `<div class="hbar"><span style="width:${max ? Math.max(2, Math.round((v / max) * 100)) : 0}%"></span><b>${label}</b></div>`;

function insightsCells(i, cur, hasData) {
  if (!hasData) return '<td data-l="Chi tiêu">–</td><td data-l="Tiếp cận">–</td><td data-l="Lượt nhấp">–</td><td data-l="Tin nhắn">–</td><td data-l="Chi phí/tin nhắn">–</td>';
  return `<td data-l="Chi tiêu"><b>${fmtMoney(i.spend, cur)}</b></td><td data-l="Tiếp cận">${fmtNum(i.reach)}</td><td data-l="Lượt nhấp">${fmtNum(i.clicks)}</td>
    <td data-l="Tin nhắn">${fmtNum(i.messages)}</td><td data-l="Chi phí/tin nhắn">${i.cost_per_message !== null ? fmtMoney(i.cost_per_message, cur) : '–'}</td>`;
}

async function viewCampaign(id) {
  layout('quang-cao', 'Chi tiết chiến dịch', '<a href="#/quang-cao">← Danh sách chiến dịch</a>', '<div class="muted">Đang tải…</div>');
  const v = document.getElementById('view');
  v.innerHTML = `<div class="card filters"><div><label for="pre">Thời gian</label><select id="pre">${ADS_PRESETS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div><div></div>
    <div class="end"><button class="btn ghost" id="reload">Tải lại</button></div></div><div id="cd"></div>`;
  const pre = document.getElementById('pre');
  pre.value = adsState.preset;
  const load = async () => {
    const box = document.getElementById('cd');
    box.innerHTML = '<div class="muted">Đang tải số liệu từ Facebook…</div>';
    let d;
    try { d = await api(`/api/ads/campaigns/${encodeURIComponent(id)}?preset=${adsState.preset}`, { quiet: true }); } catch (e) {
      box.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return;
    }
    renderCampaign(box, d);
  };
  pre.onchange = () => { adsState.preset = pre.value; load(); };
  document.getElementById('reload').onclick = load;
  await load();
}

function renderCampaign(box, d) {
  const cur = d.currency;
  const c = d.campaign;
  const t = d.totals;
  const [sl, sc] = CAMP_STATUS[c.status] || [c.status, 'off'];
  const budget = c.daily_budget !== null ? `${fmtMoney(c.daily_budget, cur)}/ngày` : c.lifetime_budget !== null ? `${fmtMoney(c.lifetime_budget, cur)} trọn đời` : 'Đặt ở nhóm quảng cáo';
  const presetLabel = (ADS_PRESETS.find(([k]) => k === d.preset) || [, ''])[1].toLowerCase();
  const head = `<div class="card"><div class="row between ads-head" style="margin:0"><div class="grow"><h2 style="margin:0 0 4px">${esc(c.name)}</h2>
      <div class="muted small"><span class="badge ${sc}">${esc(sl)}</span> ${esc(OBJECTIVE[c.objective] || c.objective || '')} · Tài khoản ${esc(d.account.name)}</div>
      <div class="muted small">Ngân sách ${budget}${c.start_time ? ` · Bắt đầu ${fmtDate(c.start_time)}` : ''}${c.stop_time ? ` · Kết thúc ${fmtDate(c.stop_time)}` : ''}</div></div>
      <a class="btn ghost sm" href="${esc(c.link)}" target="_blank" rel="noopener">Mở trong Trình quản lý quảng cáo</a></div></div>`;
  if (!d.has_data) {
    box.innerHTML = `${head}<div class="card"><p class="muted" style="margin:0">Chiến dịch không có số liệu trong khoảng ${esc(presetLabel)}. Quý khách thử chọn "Toàn thời gian".</p></div>`;
    return;
  }
  const main = t.messages ? ['Tin nhắn mới', fmtNum(t.messages), `${fmtMoney(t.cost_per_message, cur)} mỗi tin nhắn`]
    : t.link_clicks ? ['Lượt nhấp liên kết', fmtNum(t.link_clicks), `${fmtMoney(t.cost_per_link_click, cur)} mỗi lượt`]
    : t.actions[0] ? [t.actions[0].label, fmtNum(t.actions[0].value), t.actions[0].cost !== null ? `${fmtMoney(t.actions[0].cost, cur)} mỗi kết quả` : '&nbsp;'] : ['Kết quả', '0', '&nbsp;'];
  const stats = `<div class="grid stats4">
      <div class="card stat"><div class="muted small">Chi tiêu</div><div class="n">${fmtMoney(t.spend, cur)}</div><div class="muted small">CPM ${fmtMoney(t.cpm, cur)}</div></div>
      <div class="card stat"><div class="muted small">${esc(main[0])}</div><div class="n">${main[1]}</div><div class="muted small">${main[2]}</div></div>
      <div class="card stat"><div class="muted small">Người tiếp cận</div><div class="n">${fmtNum(t.reach)}</div><div class="muted small">${fmtNum(t.impressions)} lượt hiển thị${t.frequency ? `, tần suất ${t.frequency.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}` : ''}</div></div>
      <div class="card stat"><div class="muted small">Lượt nhấp</div><div class="n">${fmtNum(t.clicks)}</div><div class="muted small">Tỷ lệ nhấp ${fmtPct(t.ctr)}${t.cpc ? `, ${fmtMoney(t.cpc, cur)}/lượt` : ''}</div></div></div>`;
  const acts = t.actions.length ? `<div class="card"><h2>Tất cả kết quả</h2><table class="cards ads2"><thead><tr><th>Kết quả</th><th>Số lượng</th><th>Chi phí mỗi kết quả</th></tr></thead><tbody>
      ${t.actions.map((a) => `<tr><td>${esc(a.label)}</td><td data-l="Số lượng"><b>${fmtNum(a.value)}</b></td><td data-l="Chi phí mỗi kết quả">${a.cost !== null ? fmtMoney(a.cost, cur) : '–'}</td></tr>`).join('')}</tbody></table></div>` : '';
  // Biểu đồ chi tiêu theo ngày: một chuỗi, cột mảnh, rê chuột hoặc chạm để xem số.
  const maxS = Math.max(...d.daily.map((x) => x.spend), 0);
  const days = d.daily.length > 1 ? `<div class="card"><h2>Chi tiêu theo ngày</h2>
      <div class="bars" role="img" aria-label="Chi tiêu theo ngày, cao nhất ${fmtMoney(maxS, cur)}">${d.daily.map((x) => `<div class="bar" tabindex="0" data-tip="${esc(fmtDate(x.date))}: ${esc(fmtMoney(x.spend, cur))} · ${fmtNum(x.messages)} tin nhắn · ${fmtNum(x.clicks)} lượt nhấp"><span style="height:${maxS ? Math.max(2, Math.round((x.spend / maxS) * 100)) : 0}%"></span></div>`).join('')}</div>
      <div class="row between muted small" style="flex-wrap:nowrap"><span>${fmtDate(d.daily[0].date)}</span><span>Cao nhất ${fmtMoney(maxS, cur)}/ngày</span><span>${fmtDate(d.daily[d.daily.length - 1].date)}</span></div>
      <details><summary class="small">Xem bảng số liệu theo ngày</summary><table class="cards ads2"><thead><tr><th>Ngày</th><th>Chi tiêu</th><th>Lượt nhấp</th><th>Tin nhắn</th></tr></thead><tbody>
      ${[...d.daily].reverse().map((x) => `<tr><td>${fmtDate(x.date)}</td><td data-l="Chi tiêu">${fmtMoney(x.spend, cur)}</td><td data-l="Lượt nhấp">${fmtNum(x.clicks)}</td><td data-l="Tin nhắn">${fmtNum(x.messages)}</td></tr>`).join('')}</tbody></table></details></div>` : '';
  const head5 = '<th>Chi tiêu</th><th>Tiếp cận</th><th>Lượt nhấp</th><th>Tin nhắn</th><th>Chi phí/tin nhắn</th>';
  const adsets = d.adsets.length ? `<div class="card"><h2>Nhóm quảng cáo (${d.adsets.length})</h2><table class="cards ads"><thead><tr><th>Nhóm quảng cáo</th><th>Trạng thái</th>${head5}</tr></thead><tbody>
      ${d.adsets.map((a) => { const [l, k] = CAMP_STATUS[a.status] || [a.status, 'off']; return `<tr><td><b>${esc(a.name)}</b>${a.targeting ? `<div class="muted small">${esc(a.targeting)}</div>` : ''}</td><td><span class="badge ${k}">${esc(l)}</span></td>${insightsCells(a.insights, cur, a.has_data)}</tr>`; }).join('')}</tbody></table></div>` : '';
  const ads = d.ads.length ? `<div class="card"><h2>Mẫu quảng cáo (${d.ads.length})</h2>${d.ads.map((a) => { const [l, k] = CAMP_STATUS[a.status] || [a.status, 'off']; const i = a.insights; return `<article class="post">
      ${a.thumbnail ? `<img class="thumb" src="${esc(a.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="thumb empty"></div>'}
      <div class="grow"><div class="row between" style="flex-wrap:nowrap"><b class="ellipsis">${esc(a.name)}</b><span class="badge ${k}">${esc(l)}</span></div>
        <div class="muted small ellipsis">${esc(a.adset || '')}</div>
        ${a.text ? `<div class="msg">${esc(a.text)}</div>` : ''}
        <div class="metrics">${a.has_data ? `<span>Chi tiêu <b>${fmtMoney(i.spend, cur)}</b></span><span>Tiếp cận <b>${fmtNum(i.reach)}</b></span><span>Nhấp <b>${fmtNum(i.clicks)}</b></span><span>Tin nhắn <b>${fmtNum(i.messages)}</b></span>${i.cost_per_message !== null ? `<span><b>${fmtMoney(i.cost_per_message, cur)}</b>/tin nhắn</span>` : ''}` : '<span>Không có số liệu trong khoảng này</span>'}
        ${a.post_link ? `<a href="${esc(a.post_link)}" target="_blank" rel="noopener">Xem bài quảng cáo</a>` : ''}</div></div></article>`; }).join('')}</div>` : '';
  // Độ tuổi và giới tính: gộp theo nhóm tuổi, tách nam/nữ.
  const ages = [...new Set(d.demographics.map((x) => x.age))].sort();
  const cell = (age, g) => d.demographics.filter((x) => x.age === age && x.gender === g).reduce((s, x) => ({ spend: s.spend + x.spend, reach: s.reach + x.reach, messages: s.messages + x.messages }), { spend: 0, reach: 0, messages: 0 });
  const maxD = Math.max(0, ...ages.map((a) => cell(a, 'male').spend + cell(a, 'female').spend + cell(a, 'unknown').spend));
  const demo = ages.length ? `<div class="card"><h2>Độ tuổi và giới tính</h2><table class="cards ads2"><thead><tr><th>Độ tuổi</th><th>Chi tiêu</th><th>Nam (tiếp cận · tin nhắn)</th><th>Nữ (tiếp cận · tin nhắn)</th></tr></thead><tbody>
      ${ages.map((a) => { const m = cell(a, 'male'); const f = cell(a, 'female'); const all = m.spend + f.spend + cell(a, 'unknown').spend; return `<tr><td><b>${esc(a)}</b></td><td data-l="Chi tiêu">${hbar(all, maxD, fmtMoney(all, cur))}</td><td data-l="Nam">${fmtNum(m.reach)} · ${fmtNum(m.messages)}</td><td data-l="Nữ">${fmtNum(f.reach)} · ${fmtNum(f.messages)}</td></tr>`; }).join('')}</tbody></table></div>` : '';
  const maxP = Math.max(0, ...d.platforms.map((x) => x.spend));
  const plat = d.platforms.length ? `<div class="card"><h2>Nền tảng hiển thị</h2><table class="cards ads2"><thead><tr><th>Nền tảng</th><th>Chi tiêu</th><th>Tiếp cận</th><th>Tin nhắn</th></tr></thead><tbody>
      ${d.platforms.map((p) => `<tr><td><b>${esc(PLATFORM[p.platform] || p.platform)}</b></td><td data-l="Chi tiêu">${hbar(p.spend, maxP, fmtMoney(p.spend, cur))}</td><td data-l="Tiếp cận">${fmtNum(p.reach)}</td><td data-l="Tin nhắn">${fmtNum(p.messages)}</td></tr>`).join('')}</tbody></table></div>` : '';
  box.innerHTML = `${head}${stats}<p class="muted small">Số liệu ${esc(presetLabel)}, lấy trực tiếp từ Facebook lúc tải trang.</p>${acts}${days}${adsets}${ads}${demo}${plat}`;
  box.querySelectorAll('.bar').forEach((b) => { b.onclick = () => toast(b.dataset.tip); });
}

// ---------- Nhân viên ----------
async function viewUsers() {
  layout('nhan-vien', 'Nhân viên', 'Cấp tài khoản và giao Fanpage cho từng người', '<div class="muted">Đang tải…</div>', '<button class="btn" id="add">Thêm nhân viên</button>');
  const [{ users, roles }, { pages }] = await Promise.all([api('/api/users'), api('/api/pages')]);
  const pageName = Object.fromEntries(pages.map((p) => [p.id, p.name]));
  const rows = users.map((u) => {
    const badges = [
      u.status === 'disabled' ? '<span class="badge off">Đã vô hiệu</span>' : '',
      u.locked ? '<span class="badge err">Tạm khóa</span>' : '',
      u.must_change_password ? '<span class="badge warn">Chưa đổi mật khẩu</span>' : '',
    ].join(' ');
    const pg = u.role === 'owner' ? 'Tất cả' : (u.page_ids.map((id) => esc(pageName[id] || id)).join(', ') || '<span class="muted">Chưa giao</span>');
    return `<tr><td><b>${esc(u.name || '–')}</b><div class="muted small">${esc(u.email)}</div>${badges}</td>
      <td>${esc(u.role_label)}</td><td class="small">${pg}</td><td class="small muted">${fmtTime(u.last_login_at)}</td>
      <td><div class="row"><button class="btn ghost sm" data-edit="${u.id}">Sửa</button>
        ${u.locked ? `<button class="btn ghost sm" data-unlock="${u.id}">Mở khóa</button>` : ''}
        <button class="btn ghost sm" data-reset="${u.id}">Cấp lại mật khẩu</button></div></td></tr>`;
  }).join('');
  document.getElementById('view').innerHTML = `<div class="card"><table class="cards"><thead><tr><th>Nhân viên</th><th>Vai trò</th><th>Fanpage được giao</th><th>Đăng nhập gần nhất</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="card"><h2>Quyền của từng vai trò</h2><ul class="muted small" style="margin:0;padding-left:20px">
      <li><b>Chủ hệ thống:</b> mọi quyền, kết nối Fanpage, quản lý nhân viên, xem nhật ký.</li>
      <li><b>Quản lý:</b> duyệt và đăng bài, sửa kịch bản trả lời, xem báo cáo trên các Fanpage được giao.</li>
      <li><b>Biên tập:</b> soạn bài và lên lịch nháp, chờ Quản lý duyệt.</li>
      <li><b>Chăm sóc khách hàng:</b> trả lời tin nhắn và bình luận, ghi đơn.</li></ul></div>`;

  const userForm = (u) => `<h2>${u ? 'Sửa nhân viên' : 'Thêm nhân viên'}</h2>
    <form id="uf" novalidate>
      <label for="u-name">Họ tên</label><input id="u-name" value="${esc(u?.name || '')}" maxlength="100">
      <label for="u-email">Email đăng nhập</label><input id="u-email" type="email" value="${esc(u?.email || '')}" ${u ? 'disabled' : ''}>
      <label for="u-role">Vai trò</label><select id="u-role">${roles.map((r) => `<option value="${r.id}" ${(u?.role || 'agent') === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
      ${u ? `<label for="u-status">Trạng thái</label><select id="u-status"><option value="active" ${u.status === 'active' ? 'selected' : ''}>Đang hoạt động</option><option value="disabled" ${u.status === 'disabled' ? 'selected' : ''}>Vô hiệu hóa (nghỉ việc)</option></select>` : ''}
      <div id="u-pages"><label>Fanpage được giao</label>
      ${pages.length > 1 ? '<label class="check"><input type="checkbox" id="u-all"> <b>Chọn tất cả</b></label>' : ''}
      ${pages.length ? pages.map((p) => `<label class="check"><input type="checkbox" data-pg value=""${esc(p.id)}" ${u?.page_ids.includes(p.id) ? 'checked' : ''}>${esc(p.name)}</label>`).join('') : '<div class="muted small">Chưa có Fanpage nào được kết nối.</div>'}
      </div><div class="muted small" id="u-ownernote">Chủ hệ thống luôn thấy mọi Fanpage.</div>
      <div id="umsg"></div>
      <div class="actions"><button type="button" class="btn ghost" data-cancel>Hủy</button><button class="btn">${u ? 'Lưu' : 'Tạo tài khoản'}</button></div>
    </form>`;

  const openForm = (u) => modal(userForm(u), (m, close) => {
    m.querySelector('[data-cancel]').onclick = close;
    const role = m.querySelector('#u-role'); const all = m.querySelector('#u-all');
    const pgs = [...m.querySelectorAll('[data-pg]')];
    const sync = () => { m.querySelector('#u-pages').hidden = role.value === 'owner'; if (all) all.checked = pgs.length && pgs.every((i) => i.checked); };
    role.onchange = sync; sync();
    if (all) all.onchange = () => pgs.forEach((i) => (i.checked = all.checked));
    pgs.forEach((i) => i.addEventListener('change', sync));
    m.querySelector('#uf').onsubmit = async (e) => {
      e.preventDefault();
      const body = {
        name: m.querySelector('#u-name').value,
        role: m.querySelector('#u-role').value,
        page_ids: [...m.querySelectorAll('[data-pg]:checked')].map((i) => i.value),
      };
      try {
        if (u) {
          body.status = m.querySelector('#u-status').value;
          await api(`/api/users/${u.id}`, { method: 'PATCH', body });
          close(); toast('Đã lưu'); viewUsers();
        } else {
          body.email = m.querySelector('#u-email').value;
          const d = await api('/api/users', { method: 'POST', body });
          close(); viewUsers(); showSecret('Đã tạo tài khoản', d.user.email, d.temp_password);
        }
      } catch (err) {
        m.querySelector('#umsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
      }
    };
  });

  document.getElementById('add').onclick = () => openForm(null);
  document.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openForm(users.find((u) => u.id === Number(b.dataset.edit)))));
  document.querySelectorAll('[data-unlock]').forEach((b) => (b.onclick = async () => {
    try { await api(`/api/users/${b.dataset.unlock}/unlock`, { method: 'POST' }); toast('Đã mở khóa'); viewUsers(); } catch (e) { toast(e.message); }
  }));
  document.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = async () => {
    const u = users.find((x) => x.id === Number(b.dataset.reset));
    if (!(await confirmBox('Cấp lại mật khẩu?', `${u.email} sẽ bị đăng xuất khỏi mọi thiết bị và phải đổi mật khẩu khi đăng nhập lại.`, 'Cấp lại'))) return;
    try { const d = await api(`/api/users/${u.id}/reset-password`, { method: 'POST' }); showSecret('Mật khẩu tạm mới', u.email, d.temp_password); viewUsers(); } catch (e) { toast(e.message); }
  }));
}

// ---------- Nhật ký ----------
const ACTIONS = {
  login: 'Đăng nhập', logout: 'Đăng xuất', logout_all: 'Đăng xuất mọi thiết bị', login_failed: 'Đăng nhập sai',
  account_locked: 'Tạm khóa do nhập sai', password_changed: 'Đổi mật khẩu', password_reset: 'Cấp lại mật khẩu',
  user_created: 'Tạo tài khoản', user_updated: 'Sửa tài khoản', user_unlocked: 'Mở khóa tài khoản',
  post_created: 'Soạn bài nháp', post_updated: 'Sửa bài', post_submitted: 'Gửi duyệt bài', post_rejected: 'Từ chối bài',
  post_published: 'Đăng bài lên Fanpage', post_scheduled: 'Hẹn giờ đăng bài', post_publish_failed: 'Đăng bài lỗi',
  post_cancelled: 'Hủy lịch đăng', post_rescheduled: 'Sửa bài hẹn giờ', page_style_updated: 'Thiết lập footer Fanpage', source_added: 'Thêm nguồn nội dung', source_removed: 'Bỏ nguồn nội dung', post_deleted: 'Xóa bài nháp',
  media_uploaded: 'Tải ảnh/video lên', media_updated: 'Sửa thông tin ảnh/video', media_deleted: 'Xóa ảnh/video khỏi kho', ai_models_updated: 'Đổi model Claude', prompt_accepted: 'Thêm prompt bổ sung', prompt_dismissed: 'Bỏ qua prompt đề xuất', rules_updated: 'Sửa quy định đăng bài', ai_written: 'AI viết bài',
  inbox_replied: 'Trả lời khách', autoreply_updated: 'Sửa tự trả lời bình luận',
  topics_seeded: 'Nạp bộ chủ đề mẫu', topics_replaced: 'Thay bộ chủ đề mẫu', topic_created: 'Thêm chủ đề', topic_updated: 'Sửa chủ đề', topic_deleted: 'Xóa chủ đề', page_brief_updated: 'Sửa hồ sơ Fanpage',
  knowledge_added: 'Nạp tài liệu', knowledge_updated: 'Sửa tài liệu kiến thức', knowledge_deleted: 'Xóa kiến thức', suggestion_accepted: 'Chấp nhận đề xuất chủ đề', suggestion_dismissed: 'Bỏ qua đề xuất chủ đề',
  assistant_run: 'Trợ lý AI chạy', assistant_settings: 'Cài đặt trợ lý AI', plan_regenerated: 'Lập lại kế hoạch tuần', ai_revised: 'AI viết lại theo góp ý',
  pages_connected: 'Kết nối Fanpage', pages_connect_failed: 'Kết nối Fanpage lỗi', page_disconnected: 'Ngắt Fanpage',
};

async function viewAudit() {
  layout('nhat-ky', 'Nhật ký', 'Ai làm gì, lúc nào (200 thao tác gần nhất)', '<div class="muted">Đang tải…</div>');
  const { entries } = await api('/api/audit?limit=200');
  document.getElementById('view').innerHTML = `<div class="card"><table class="cards"><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Thao tác</th><th>Đối tượng</th></tr></thead><tbody>
    ${entries.map((e) => `<tr><td class="small muted">${fmtTime(e.created_at)}</td><td class="small">${esc(e.user_name || e.user_email || '–')}</td>
      <td>${esc(ACTIONS[e.action] || e.action)}</td><td class="small">${esc(e.target || '')}</td></tr>`).join('')}
  </tbody></table></div>`;
}

// ---------- Tài khoản ----------
function viewAccount() {
  layout('tai-khoan', 'Tài khoản', esc(`${me.email} · ${me.role_label}`), `
    ${me.role === 'owner' ? '<div class="card only-mobile"><h2>Quản trị</h2><div class="row"><a class="btn ghost" href="#/nhan-vien">Nhân viên</a><a class="btn ghost" href="#/nhat-ky">Nhật ký</a></div></div>' : ''}
    <div class="card only-mobile"><h2>Mục khác</h2><div class="row"><a class="btn ghost" href="#/bai-dang">Bài đăng</a><a class="btn ghost" href="#/quy-dinh">Quy định đăng bài</a><a class="btn ghost" href="#/bao-cao">Báo cáo</a><a class="btn ghost" href="/prompt/">Thư viện prompt</a>${me.role !== 'agent' ? '<a class="btn ghost" href="#/nguon-noi-dung">Nguồn nội dung</a>' : ''}${me.role === 'owner' || me.role === 'manager' ? '<a class="btn ghost" href="#/quang-cao">Quảng cáo</a>' : ''}</div></div>
    <div class="card"><h2>Đổi mật khẩu</h2>${passwordForm(false)}</div>
    <div class="card"><h2>Cài lên điện thoại</h2><p class="muted small" style="margin-top:0">
      <b>Android:</b> mở trang này bằng Chrome, bấm menu ⋮ rồi "Cài đặt ứng dụng".<br>
      <b>iPhone:</b> mở bằng Safari, bấm nút Chia sẻ rồi "Thêm vào Màn hình chính".</p></div>
    <div class="card"><h2>Phiên đăng nhập</h2><div class="row">
      <button class="btn ghost" id="out">Đăng xuất</button><button class="btn danger" id="outall">Đăng xuất mọi thiết bị</button></div></div>`);
  bindPasswordForm(() => viewAccount());
  document.getElementById('out').onclick = logout;
  document.getElementById('outall').onclick = async () => {
    if (!(await confirmBox('Đăng xuất mọi thiết bị?', 'Mọi máy tính và điện thoại đang đăng nhập tài khoản này sẽ phải đăng nhập lại.', 'Đăng xuất hết', true))) return;
    await api('/api/auth/logout-all', { method: 'POST' }).catch(() => {});
    me = null; go('dang-nhap');
  };
}

// ---------- Định tuyến ----------
// ---------- Chủ đề nội dung: chủ đề → chủ đề con → bài viết, hình ảnh, video, ads ----------
const topicState = { page: localStorage.getItem('fbsTopicPage') || '', tab: 'chu-de' };
const TOPIC_LABELS = { goal: 'Mục tiêu truyền thông', audience: 'Đối tượng', hook: 'Câu móc (hook), mỗi dòng một phương án', message: 'Thông điệp chính', cta: 'Lời kêu gọi hành động (CTA)', facts: 'Dữ kiện được phép dùng, mỗi dòng một ý', ideas: 'Ý bài viết, mỗi dòng một ý', formats: 'Định dạng', visual: 'Hình ảnh, video cần làm', prompt_ids: 'Mẫu prompt (Thư viện prompt)', storyboard_id: 'Storyboard mẫu', ads: 'Gợi ý chạy quảng cáo', keywords: 'Từ khóa đọc tin (cách nhau dấu phẩy)' };
const canEditTopics = () => ['owner', 'manager', 'editor'].includes(me.role);
const isMgr = () => me.role === 'owner' || me.role === 'manager';

// Thư viện prompt (tải một lần từ /prompt/, dùng để hiện tên mẫu và nội dung prompt cạnh chủ đề).
let promptLib = null;
function loadPromptLib() {
  if (promptLib) return promptLib;
  const load = (src) => new Promise((res) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = res; document.head.appendChild(s); });
  promptLib = Promise.all([window.PROMPTS ? null : load('/prompt/data.js'), window.SB_MAU ? null : load('/prompt/storyboard-mau.js')]).then(() => ({
    prompts: Object.fromEntries((window.PROMPTS || []).map((p) => [p.id, p])),
    list: window.PROMPTS || [],
    sbs: Object.fromEntries((window.SB_MAU || []).map((s) => [s.id, s])),
  }));
  return promptLib;
}
const promptChip = (lib, id) => { const p = lib?.prompts[id]; return `<button type="button" class="chip pchip" data-prompt="${esc(id)}" title="${esc(p?.name || id)}">${esc(id)}${p ? ` · ${esc(p.name.slice(0, 42))}` : ''}</button>`; };

function openPrompt(lib, id) {
  const p = lib.prompts[id];
  if (!p) { toast('Không tìm thấy mẫu prompt này'); return; }
  modal(`<h2>${esc(p.id)} · ${esc(p.name)}</h2>
    <div class="muted small">${esc(p.groupName)} · ${esc({ video: 'Video', image: 'Hình ảnh', doc: 'Tài liệu' }[p.kind] || p.kind)} · Công cụ: ${esc(p.tool || '')}</div>
    ${p.dungcho ? `<p class="small">Dùng cho: ${esc(p.dungcho)}</p>` : ''}
    <div class="secret pre">${esc(p.text)}</div>
    <div class="actions"><a class="btn ghost" href="/prompt/" target="_blank" rel="noopener">Mở Thư viện prompt</a><button class="btn ghost" data-copy>Sao chép prompt</button><button class="btn" data-close>Đóng</button></div>`,
  (m, close) => {
    m.querySelector('[data-close]').onclick = close;
    m.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(p.text); toast('Đã sao chép prompt'); } catch { toast('Không sao chép được, vui lòng chép tay'); } };
  });
}
function bindPrompts(root, lib) { root.querySelectorAll('[data-prompt]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openPrompt(lib, b.dataset.prompt); })); }

function storyboardHtml(lib, id) {
  const s = lib?.sbs[id];
  if (!s) return '';
  return `<details class="sb"><summary>Storyboard mẫu: ${esc(s.ten)} (${esc(s.kho || '')}, ${s.dur} giây)</summary>
    <table class="sbt"><thead><tr><th>Cảnh</th><th>Hình ảnh</th><th>Chữ trên màn hình</th><th>Lời đọc</th></tr></thead><tbody>
    ${(s.scenes || []).map((c, i) => `<tr><td>${i + 1}${c[1] ? ` <button type="button" class="link" data-prompt="${esc(c[1])}">${esc(c[1])}</button>` : ''}</td><td>${esc(c[2] || '')}</td><td>${esc(c[3] || '')}</td><td>${esc(c[4] || '')}</td></tr>`).join('')}
    </tbody></table></details>`;
}

async function topicPagePick(active) {
  const { pages } = await api('/api/pages');
  const usable = pages.filter((p) => p.status !== 'disconnected');
  if (!usable.some((p) => p.id === topicState.page)) topicState.page = usable[0]?.id || '';
  const sel = usable.length > 1 ? `<select id="tpage" class="sm" aria-label="Fanpage">${usable.map((p) => `<option value="${esc(p.id)}" ${p.id === topicState.page ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : '';
  return { usable, sel, bind: () => { const s = document.getElementById('tpage'); if (s) s.onchange = () => { topicState.page = s.value; try { localStorage.setItem('fbsTopicPage', s.value); } catch {} render(); }; } };
}

async function viewTopics(q) {
  if (q?.get('tab')) topicState.tab = q.get('tab');
  layout('chu-de', 'Chủ đề nội dung', 'Chủ đề, chủ đề con, kho kiến thức: nền để AI soạn bài, chọn hình ảnh, video và chạy quảng cáo', '<div class="muted">Đang tải…</div>');
  const pick = await topicPagePick();
  const v = document.getElementById('view');
  document.querySelector('.top .row').innerHTML = pick.sel;
  pick.bind();
  if (!topicState.page) { v.innerHTML = '<div class="card">Chưa có Fanpage nào. Vui lòng kết nối Fanpage trước.</div>'; return; }
  const [d, lib] = await Promise.all([api(`/api/topics?page_id=${encodeURIComponent(topicState.page)}`), loadPromptLib()]);
  if (d.seeded) toast(`Đã nạp bộ chủ đề mẫu "${d.templates.find((t) => t.key === d.seeded)?.name}" cho Trang này`);
  const tabs = [['chu-de', 'Chủ đề'], ['kien-thuc', 'Kho kiến thức'], ['de-xuat', `Đề xuất cập nhật${d.pending_suggestions ? ` (${d.pending_suggestions})` : ''}`], ['ho-so', 'Hồ sơ Fanpage']];
  v.innerHTML = `<div class="seg tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" class="${topicState.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div><div id="tbody"></div>`;
  v.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { topicState.tab = b.dataset.tab; viewTopicsTab(d, lib); v.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b)); }));
  viewTopicsTab(d, lib);
}

function viewTopicsTab(d, lib) {
  const box = document.getElementById('tbody');
  if (topicState.tab === 'kien-thuc') return renderKnowledge(box, d);
  if (topicState.tab === 'de-xuat') return renderSuggestions(box, d);
  if (topicState.tab === 'ho-so') return renderBrief(box, d);
  return renderTopicTree(box, d, lib);
}

function renderTopicTree(box, d, lib) {
  const total = d.topics.reduce((a, t) => a + (t.share || 0), 0);
  const tplPick = `<select id="tpl" class="sm">${d.templates.map((t) => `<option value="${t.key}" ${t.key === d.suggested_template ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
  if (!d.topics.length) {
    box.innerHTML = `<div class="card"><h2>Trang "${esc(d.page.name)}" chưa có chủ đề</h2>
      <p class="muted">Quý khách nạp bộ chủ đề mẫu (đã có hook, thông điệp, CTA, dữ kiện, hình ảnh, prompt, gợi ý ads) rồi chỉnh lại, hoặc tự tạo chủ đề.</p>
      <div class="row">${isMgr() ? `${tplPick}<button class="btn" id="seed">Nạp bộ mẫu</button>` : ''}${d.can_edit ? '<button class="btn ghost" id="addtop">Tạo chủ đề</button>' : ''}</div></div>`;
  } else {
    box.innerHTML = `<div class="card row between"><div class="muted small">${d.topics.length} chủ đề, ${d.topics.reduce((a, t) => a + t.children.length, 0)} chủ đề con · tổng tỷ trọng ${total}%${total !== 100 ? ' (nên bằng 100%)' : ''}. Trợ lý AI chỉ soạn bài theo chủ đề con đang bật.</div>
      <div class="row">${d.can_edit ? '<button class="btn sm" id="addtop">Thêm chủ đề</button>' : ''}${isMgr() && d.suggested_template ? '<button class="btn ghost sm" id="reseed">Thay bằng bộ mẫu mới nhất</button>' : ''}<a class="btn ghost sm" href="#/tro-ly">Trợ lý AI</a></div></div>
      ${d.topics.map((t) => `<section class="card topic ${t.status === 'paused' ? 'paused' : ''}">
        <div class="row between thead2"><div class="grow"><h2 style="margin:0">${esc(t.title)} ${t.share ? `<span class="badge">${t.share}%</span>` : ''} ${t.status === 'paused' ? '<span class="badge off">Tạm dừng</span>' : ''}</h2>
          ${t.goal ? `<div class="muted small">${esc(t.goal)}</div>` : ''}${t.message ? `<div class="small">Thông điệp: ${esc(t.message)}</div>` : ''}</div>
          ${d.can_edit ? `<div class="row"><button class="btn ghost sm" data-edit="${t.id}">Sửa</button><button class="btn sm" data-addsub="${t.id}">+ Chủ đề con</button></div>` : ''}</div>
        <div class="subs">${t.children.map((c) => `<div class="sub ${c.status === 'paused' ? 'paused' : ''}" data-view-sub="${c.id}" tabindex="0">
          <div class="row between"><b>${esc(c.title)}</b>${c.status === 'paused' ? '<span class="badge off">Tạm dừng</span>' : ''}</div>
          ${c.hook ? `<div class="small hk">“${esc(c.hook.split('\n')[0])}”</div>` : ''}
          ${c.cta ? `<div class="small muted">👉 ${esc(c.cta)}</div>` : ''}
          <div class="chips">${c.formats ? `<span class="chip">${esc(c.formats)}</span>` : ''}${(c.prompt_ids || '').split(',').filter(Boolean).slice(0, 3).map((id) => promptChip(lib, id)).join('')}</div>
        </div>`).join('') || '<div class="muted small">Chưa có chủ đề con.</div>'}</div></section>`).join('')}`;
  }
  const byId = {};
  for (const t of d.topics) { byId[t.id] = t; for (const c of t.children) byId[c.id] = { ...c, parent: t }; }
  box.querySelector('#seed')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await api('/api/topics/seed', { method: 'POST', body: { page_id: d.page.id, template: box.querySelector('#tpl').value } }); toast('Đã nạp bộ chủ đề mẫu'); render(); } catch (err) { toast(err.message); e.target.disabled = false; }
  });
  box.querySelector('#reseed')?.addEventListener('click', async (e) => {
    const name = d.templates.find((t) => t.key === d.suggested_template)?.name || '';
    if (!(await confirmBox('Thay bằng bộ mẫu mới nhất?', `Toàn bộ chủ đề hiện tại của Trang sẽ bị xóa và thay bằng bộ mẫu "${name}" mới nhất; Hồ sơ Fanpage cũng được thay theo bộ mẫu. Bài đã soạn vẫn giữ nguyên. Không khôi phục được chủ đề cũ.`, 'Thay bộ mẫu', true))) return;
    e.target.disabled = true;
    try { await api('/api/topics/seed', { method: 'POST', body: { page_id: d.page.id, template: d.suggested_template, replace: true } }); toast('Đã thay bằng bộ chủ đề mẫu mới nhất'); render(); } catch (err) { toast(err.message); e.target.disabled = false; }
  });
  box.querySelector('#addtop')?.addEventListener('click', () => openTopicForm(d, null, null, lib));
  box.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openTopicForm(d, byId[b.dataset.edit], null, lib)));
  box.querySelectorAll('[data-addsub]').forEach((b) => (b.onclick = () => openTopicForm(d, null, byId[b.dataset.addsub], lib)));
  box.querySelectorAll('[data-view-sub]').forEach((el) => {
    const open = () => openSubTopic(d, byId[el.dataset.viewSub], lib);
    el.onclick = open; el.onkeydown = (e) => { if (e.key === 'Enter') open(); };
  });
  bindPrompts(box, lib);
}

function openSubTopic(d, c, lib) {
  const row = (k, pre = false) => (c[k] ? `<div class="tf"><div class="muted small">${TOPIC_LABELS[k]}</div><div class="${pre ? 'pre' : ''}">${esc(c[k])}</div></div>` : '');
  modal(`<div class="muted small">${esc(c.parent.title)}</div><h2>${esc(c.title)}</h2>
    <div class="tgrid">${row('goal')}${row('audience')}</div>${row('hook', true)}${row('message')}${row('cta')}${row('facts', true)}${row('ideas', true)}
    <div class="tgrid">${row('formats')}${row('visual')}</div>
    ${c.prompt_ids ? `<div class="tf"><div class="muted small">${TOPIC_LABELS.prompt_ids}</div><div class="chips">${c.prompt_ids.split(',').map((id) => promptChip(lib, id)).join('')}</div></div>` : ''}
    ${storyboardHtml(lib, c.storyboard_id)}
    ${row('ads', true)}${row('keywords')}
    <div class="actions">${d.can_edit ? '<button class="btn ghost" data-edit>Sửa</button>' : ''}<button class="btn ghost" data-write>Soạn bài từ chủ đề này</button><button class="btn" data-close>Đóng</button></div>`,
  (m, close) => {
    m.querySelector('[data-close]').onclick = close;
    m.querySelector('[data-edit]')?.addEventListener('click', () => { close(); openTopicForm(d, c, c.parent, lib); });
    m.querySelector('[data-write]').onclick = () => {
      close();
      const brief = [`Chủ đề: ${c.title}`, c.hook ? `Hook: ${c.hook.split('\n')[0]}` : '', c.message ? `Thông điệp: ${c.message}` : '', c.cta ? `CTA: ${c.cta}` : '', c.facts ? `Dữ kiện: ${c.facts.replace(/\n/g, '; ')}` : ''].filter(Boolean).join('\n');
      openContentForm([{ id: d.page.id, name: d.page.name }], null, { can_create: true, can_approve: isMgr(), media_enabled: true }, { brief });
    };
    bindPrompts(m, lib);
  });
}

function openTopicForm(d, item, parent, lib) {
  const isSub = item ? !!item.parent_id : !!parent;
  const v = item || {};
  const fields = isSub ? Object.keys(TOPIC_LABELS) : ['goal', 'audience', 'message'];
  const ta = (k, rows = 2) => `<label for="tf-${k}">${TOPIC_LABELS[k]}</label><textarea id="tf-${k}" rows="${rows}">${esc(v[k] || '')}</textarea>`;
  const inp = (k) => `<label for="tf-${k}">${TOPIC_LABELS[k]}</label><input id="tf-${k}" value="${esc(v[k] || '')}">`;
  const sbs = Object.values(lib.sbs);
  const body = fields.map((k) => {
    if (k === 'prompt_ids') return `${inp(k)}<details class="ppick"><summary>Chọn từ Thư viện prompt</summary><input id="psearch" type="search" placeholder="Tìm mẫu: ảnh 4:5, Reels, sự kiện..."><div id="plist" class="plist"></div></details>`;
    if (k === 'storyboard_id') return `<label for="tf-${k}">${TOPIC_LABELS[k]}</label><select id="tf-${k}"><option value="">(Không dùng)</option>${sbs.map((s) => `<option value="${esc(s.id)}" ${s.id === v[k] ? 'selected' : ''}>${esc(s.ten)}</option>`).join('')}</select>`;
    if (['facts', 'ideas', 'hook', 'ads'].includes(k)) return ta(k, k === 'facts' ? 5 : 3);
    if (['formats', 'keywords', 'audience', 'cta'].includes(k)) return inp(k);
    return ta(k);
  }).join('');
  modal(`<h2>${item ? 'Sửa' : 'Thêm'} ${isSub ? 'chủ đề con' : 'chủ đề'}</h2>${parent && !item ? `<div class="muted small">Thuộc chủ đề: ${esc(parent.title)}</div>` : ''}
    <form id="tf" novalidate><label for="tf-title">Tên ${isSub ? 'chủ đề con' : 'chủ đề'}</label><input id="tf-title" maxlength="160" value="${esc(v.title || '')}">
      ${!isSub ? `<label for="tf-share">Tỷ trọng trong kế hoạch (%)</label><input id="tf-share" type="number" min="0" max="100" value="${v.share || 0}">` : ''}
      ${body}
      <label class="check"><input type="checkbox" id="tf-paused" ${v.status === 'paused' ? 'checked' : ''}> Tạm dừng (trợ lý AI không soạn bài theo ${isSub ? 'chủ đề con' : 'chủ đề'} này)</label>
      <div id="tfmsg"></div>
      <div class="actions">${item && isMgr() ? '<button type="button" class="btn ghost danger" data-del>Xóa</button>' : ''}<button type="button" class="btn ghost" data-close>Hủy</button><button type="button" class="btn" data-save>Lưu</button></div></form>`,
  (m, close) => {
    m.querySelector('[data-close]').onclick = close;
    const pl = m.querySelector('#plist');
    if (pl) {
      const ids = () => m.querySelector('#tf-prompt_ids').value.split(/[\s,;]+/).filter(Boolean);
      const draw = () => {
        const qv = m.querySelector('#psearch').value.toLowerCase();
        const cur = new Set(ids());
        pl.innerHTML = lib.list.filter((p) => !qv || `${p.id} ${p.name} ${p.groupName}`.toLowerCase().includes(qv)).slice(0, 60)
          .map((p) => `<label class="check"><input type="checkbox" value="${esc(p.id)}" ${cur.has(p.id) ? 'checked' : ''}> <b>${esc(p.id)}</b> ${esc(p.name)} <span class="muted">· ${esc(p.groupName)}</span></label>`).join('');
        pl.querySelectorAll('input').forEach((i) => (i.onchange = () => {
          const s = new Set(ids()); if (i.checked) s.add(i.value); else s.delete(i.value);
          m.querySelector('#tf-prompt_ids').value = [...s].slice(0, 8).join(',');
        }));
      };
      m.querySelector('#psearch').oninput = draw; draw();
    }
    m.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmBox('Xóa chủ đề?', `Xóa "${v.title}"${!isSub ? ' và toàn bộ chủ đề con' : ''}. Bài đã soạn vẫn giữ nguyên. Không hoàn tác được.`, 'Xóa', true))) return;
      try { await api(`/api/topics/${item.id}`, { method: 'DELETE' }); close(); toast('Đã xóa'); render(); } catch (e) { toast(e.message); }
    });
    m.querySelector('[data-save]').onclick = async (e) => {
      const b = { title: m.querySelector('#tf-title').value, status: m.querySelector('#tf-paused').checked ? 'paused' : 'active' };
      for (const k of fields) b[k] = m.querySelector(`#tf-${k}`).value;
      if (!isSub) b.share = m.querySelector('#tf-share').value;
      if (!b.title.trim()) { m.querySelector('#tfmsg').innerHTML = '<div class="alert err">Vui lòng nhập tên.</div>'; return; }
      e.target.disabled = true;
      try {
        if (item) await api(`/api/topics/${item.id}`, { method: 'PATCH', body: b });
        else await api('/api/topics', { method: 'POST', body: { ...b, page_id: d.page.id, parent_id: parent?.id || null } });
        close(); toast('Đã lưu'); render();
      } catch (err) { m.querySelector('#tfmsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; e.target.disabled = false; }
    };
  });
}

const KKIND = { doc: ['Tài liệu', ''], news: ['Tin tức', 'warn'], feedback: ['Góp ý', 'ok'] };
async function renderKnowledge(box, d) {
  box.innerHTML = '<div class="muted">Đang tải…</div>';
  const k = await api(`/api/knowledge?page_id=${encodeURIComponent(d.page.id)}`);
  box.innerHTML = `<div class="card row between"><div class="muted small">AI chỉ đọc bản tóm tắt ngắn của mỗi mục (tiết kiệm chi phí). Tin tức được trợ lý tự đọc mỗi sáng từ <a href="#/nguon-noi-dung">Nguồn nội dung</a>, chọn tin khớp từ khóa của chủ đề.</div>
    <div class="row">${k.can_edit ? '<button class="btn sm" id="addk">Nạp tài liệu</button>' : ''}${isMgr() ? '<button class="btn ghost sm" id="learn">Đọc tin ngay</button>' : ''}</div></div>
    <div class="card">${k.items.length ? k.items.map((i) => `<div class="list-item kitem"><div class="grow">
      <div class="row"><span class="badge ${KKIND[i.kind][1]}">${KKIND[i.kind][0]}</span><b>${esc(i.title)}</b>${!i.page_id ? '<span class="badge off">Mọi Trang</span>' : ''}</div>
      <div class="small">${esc(i.digest || i.preview || '')}</div>
      <div class="muted small">${fmtTime(i.created_at)}${i.created_by_name ? ` · ${esc(i.created_by_name)}` : ''}${i.url ? ` · <a href="${esc(i.url)}" target="_blank" rel="noopener">Nguồn</a>` : ''}</div></div>
      <div class="row">${k.can_edit ? `<button class="btn ghost sm" data-kedit="${i.id}">Sửa</button>` : ''}${isMgr() ? `<button class="btn ghost sm danger" data-kdel="${i.id}">Xóa</button>` : ''}</div></div>`).join('') : '<div class="muted">Chưa có kiến thức. Nạp tài liệu (hồ sơ năng lực, kế hoạch sự kiện, báo cáo, bài báo) để AI viết đúng dữ kiện.</div>'}</div>`;
  const byId = Object.fromEntries(k.items.map((i) => [i.id, i]));
  box.querySelector('#addk')?.addEventListener('click', () => openKnowledgeForm(d));
  box.querySelector('#learn')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Đang đọc tin…';
    try { const r = await api('/api/assistant/run', { method: 'POST', body: { page_id: d.page.id, steps: ['learn'] } }); toast(r.log?.[r.log.length - 1] || 'Đã đọc tin'); renderKnowledge(box, d); } catch (err) { toast(err.message); e.target.disabled = false; }
  });
  box.querySelectorAll('[data-kedit]').forEach((b) => (b.onclick = async () => {
    let i = byId[b.dataset.kedit];
    try { i = (await api(`/api/knowledge/${i.id}`)).item; } catch (e) { toast(e.message); return; }
    modal(`<h2>Sửa tài liệu</h2>
      <label for="kt2">Tên</label><input id="kt2" maxlength="200" value="${esc(i.title)}">
      <label for="kb2">Nội dung (tối đa 20.000 ký tự)</label><textarea id="kb2" rows="12" maxlength="20000">${esc(i.body || '')}</textarea>
      <label for="kd">Bản tóm tắt AI đọc khi viết bài</label><textarea id="kd" rows="5">${esc(i.digest || '')}</textarea>
      <label class="check"><input type="checkbox" id="kre"> AI tóm tắt lại theo nội dung mới</label>
      <div class="actions"><button class="btn ghost" data-close>Hủy</button><button class="btn" data-save>Lưu</button></div>`, (m, close) => {
      m.querySelector('[data-close]').onclick = close;
      m.querySelector('[data-save]').onclick = async (e) => {
        const re = m.querySelector('#kre').checked;
        e.target.disabled = true; e.target.textContent = re ? 'AI đang tóm tắt…' : 'Đang lưu…';
        try { await api(`/api/knowledge/${i.id}`, { method: 'PATCH', body: { title: m.querySelector('#kt2').value, body: m.querySelector('#kb2').value, ...(re ? { redigest: true } : { digest: m.querySelector('#kd').value }) } }); close(); renderKnowledge(box, d); } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Lưu'; }
      };
    });
  }));
  box.querySelectorAll('[data-kdel]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Xóa mục kiến thức?', `Xóa "${byId[b.dataset.kdel].title}". Không hoàn tác được.`, 'Xóa', true))) return;
    try { await api(`/api/knowledge/${b.dataset.kdel}`, { method: 'DELETE' }); renderKnowledge(box, d); } catch (e) { toast(e.message); }
  }));
}

function openKnowledgeForm(d) {
  modal(`<h2>Nạp tài liệu vào kho kiến thức</h2>
    <form id="kf" novalidate><label for="kt">Tên tài liệu</label><input id="kt" maxlength="200" placeholder="Ví dụ: Kế hoạch tập huấn tháng 12 tại Krông Pắc">
      <label for="kfile">Chọn file chữ (.txt, .md, .csv) hoặc dán nội dung bên dưới</label><input id="kfile" type="file" accept=".txt,.md,.csv,text/plain,text/markdown,text/csv">
      <label for="kb">Nội dung</label><textarea id="kb" rows="8" placeholder="Dán nội dung tài liệu (tối đa 20.000 ký tự). Với PDF, Word: mở file, chép phần chữ rồi dán vào đây."></textarea>
      <label for="ku">Liên kết nguồn (không bắt buộc)</label><input id="ku" type="url" placeholder="https://">
      <label class="check"><input type="checkbox" id="kall"> Dùng cho mọi Fanpage</label>
      <div class="muted small">AI tóm tắt tài liệu thành bản ngắn để dùng khi soạn bài. Không dán dữ liệu cá nhân của bà con (tên, số điện thoại, CCCD).</div>
      <div id="kmsg"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Hủy</button><button type="button" class="btn" data-save>Nạp</button></div></form>`,
  (m, close) => {
    m.querySelector('[data-close]').onclick = close;
    m.querySelector('#kfile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 400000) { toast('File quá lớn (tối đa khoảng 400 KB chữ)'); return; }
      m.querySelector('#kb').value = (await f.text()).slice(0, 20000);
      if (!m.querySelector('#kt').value) m.querySelector('#kt').value = f.name.replace(/\.[^.]+$/, '');
    };
    m.querySelector('[data-save]').onclick = async (e) => {
      e.target.disabled = true; m.querySelector('#kmsg').innerHTML = '<div class="muted small">Đang nạp và tóm tắt…</div>';
      try {
        await api('/api/knowledge', { method: 'POST', body: { page_id: d.page.id, title: m.querySelector('#kt').value, body: m.querySelector('#kb').value, url: m.querySelector('#ku').value, all_pages: m.querySelector('#kall').checked } });
        close(); toast('Đã nạp tài liệu'); renderKnowledge(document.getElementById('tbody'), d);
      } catch (err) { m.querySelector('#kmsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; e.target.disabled = false; }
    };
  });
}

async function renderSuggestions(box, d) {
  box.innerHTML = '<div class="muted">Đang tải…</div>';
  const s = await api(`/api/topics/suggestions?page_id=${encodeURIComponent(d.page.id)}`);
  const F = { title: 'Tên', hook: 'Hook', message: 'Thông điệp', cta: 'CTA', facts: 'Dữ kiện mới', formats: 'Định dạng', keywords: 'Từ khóa' };
  box.innerHTML = `<div class="card row between"><div class="muted small">Trợ lý xem tương tác bài đã đăng (7, 15, 30 ngày), tin tức, tài liệu và góp ý rồi đề xuất cân chỉnh chủ đề vào sáng thứ Hai và thứ Năm. Quý khách chấp nhận thì chủ đề được cập nhật, bỏ qua thì giữ nguyên.</div>
    ${isMgr() ? '<button class="btn ghost sm" id="sugnow">Đề xuất ngay</button>' : ''}</div>
    ${s.items.length ? s.items.map((x) => `<div class="card sugg"><div class="row between"><b>${Array.isArray(x.payload.shares) ? 'Cân chỉnh tỷ trọng chủ đề' : x.action === 'new' ? `Thêm chủ đề con${x.parent_title ? ` vào "${esc(x.parent_title)}"` : ''}` : `Cập nhật "${esc(x.topic_title || '')}"`}</b><span class="muted small">${fmtTime(x.created_at)}</span></div>
      ${x.reason ? `<div class="small">Lý do: ${esc(x.reason)}</div>` : ''}
      ${Array.isArray(x.payload.shares) ? `<div class="tf"><div class="muted small">Cân chỉnh tỷ trọng chủ đề</div>${x.payload.shares.map((r) => `<div class="small">${esc(r.title)}: ${r.old}% → <b>${r.share}%</b></div>`).join('')}</div>` : ''}
      <div class="tgrid">${Object.entries(F).filter(([k]) => x.payload[k]).map(([k, l]) => `<div class="tf"><div class="muted small">${l}</div><div class="pre small">${esc(x.payload[k])}</div></div>`).join('')}</div>
      ${d.can_edit ? `<div class="row"><button class="btn sm" data-acc="${x.id}">Chấp nhận</button><button class="btn ghost sm" data-dis="${x.id}">Bỏ qua</button></div>` : ''}</div>`).join('') : '<div class="card muted">Chưa có đề xuất nào đang chờ.</div>'}`;
  box.querySelector('#sugnow')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Đang đề xuất…';
    try { const r = await api('/api/assistant/run', { method: 'POST', body: { page_id: d.page.id, steps: ['suggest'] } }); toast(r.log?.[r.log.length - 1] || 'Xong'); renderSuggestions(box, d); } catch (err) { toast(err.message); e.target.disabled = false; }
  });
  box.querySelectorAll('[data-acc],[data-dis]').forEach((b) => (b.onclick = async () => {
    const id = b.dataset.acc || b.dataset.dis;
    try { await api(`/api/topics/suggestions/${id}/${b.dataset.acc ? 'accept' : 'dismiss'}`, { method: 'POST' }); toast(b.dataset.acc ? 'Đã cập nhật chủ đề' : 'Đã bỏ qua'); renderSuggestions(box, d); } catch (e) { toast(e.message); }
  }));
}

function renderBrief(box, d) {
  box.innerHTML = `<div class="card"><h2>Hồ sơ Fanpage "${esc(d.page.name)}"</h2>
    <p class="muted small">AI đọc phần này trước mọi bài: Trang là ai, nói với ai, giọng văn, liên hệ, điều bắt buộc và điều không được viết. Lời kêu gọi, hotline, hashtag cuối bài thiết lập ở <a href="#/quy-dinh">Quy định đăng bài</a>.</p>
    <textarea id="brief" rows="14" ${d.can_edit ? '' : 'readonly'}>${esc(d.brief)}</textarea>
    ${d.can_edit ? '<div class="actions"><button class="btn" id="savebrief">Lưu hồ sơ</button></div>' : ''}</div>`;
  box.querySelector('#savebrief')?.addEventListener('click', async () => {
    try { await api('/api/topics/brief', { method: 'PUT', body: { page_id: d.page.id, brief: box.querySelector('#brief').value } }); d.brief = box.querySelector('#brief').value; toast('Đã lưu hồ sơ Fanpage'); } catch (e) { toast(e.message); }
  });
}

// ---------- Trợ lý AI: kế hoạch tuần, bài cho ngày mai, tự kiểm tra, góp ý ----------
const DSTATUS = { pending: ['Chờ duyệt', 'warn'], draft: ['Nháp', 'off'], scheduled: ['Đã hẹn giờ', 'ok'], published: ['Đã đăng', 'ok'], rejected: ['Từ chối', 'err'], failed: ['Lỗi', 'err'] };
const MODEL_NAME = (id, choices) => choices.find((c) => c.id === id)?.name || id;
function modelBox(a) {
  const ch = a.model_choices || [];
  const usd = (n) => `${n.toLocaleString('vi-VN', { maximumFractionDigits: 4 })} USD`;
  const opts = (sel) => ch.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}: ${esc(c.note)}</option>`).join('');
  const per = ch.find((c) => c.id === a.models.write)?.per_post;
  const cheap = a.models.cheap === 'workers' ? 'Workers AI (miễn phí)' : 'Claude Haiku';
  const info = `<div class="small">Viết bài, kế hoạch tuần, prompt hình: <b>${esc(MODEL_NAME(a.models.write, ch))}</b> · Tự kiểm tra, đề xuất: <b>${esc(MODEL_NAME(a.models.fast, ch))}</b> · Đọc tin báo hằng ngày: <b>${esc(cheap)}</b></div>
    ${per ? `<div class="muted small">Ước tính mỗi bài khoảng ${usd(per)}. Mỗi ngày 2 phương án và 1 bài chia sẻ tin báo khoảng ${usd(Math.round(per * 2.5 * 10000) / 10000)}; 2 Trang cả tháng khoảng ${usd(Math.round(per * 2.5 * 60 * 100 + 30) / 100)} (đã gồm kế hoạch tuần).</div>` : ''}`;
  if (!a.can_models) return info;
  return `${info}<details class="pfb"><summary>Đổi model Claude</summary>
    <label for="mw">Viết bài, kế hoạch tuần</label><select id="mw">${opts(a.models.write)}</select>
    <label for="mf">Việc nhanh (tự kiểm tra, đề xuất)</label><select id="mf">${opts(a.models.fast)}</select>
    <label for="mc">Đọc, tóm tắt tin báo hằng ngày</label><select id="mc"><option value="workers" ${a.models.cheap === 'workers' ? 'selected' : ''}>Workers AI của Cloudflare: miễn phí, Claude kiểm lại khi đọc lỗi (khuyên dùng)</option><option value="claude" ${a.models.cheap === 'claude' ? 'selected' : ''}>Claude Haiku: chính xác hơn, tốn thêm chút ít</option></select>
    <div class="muted small">Giá tham khảo cho 1 triệu token (vào/ra): ${ch.map((c) => `${esc(c.name)} ${c.price[0]}/${c.price[1]} USD`).join(' · ')}. Khuyên dùng: Sonnet để viết bài, Haiku cho việc nhanh. Muốn tiết kiệm tối đa: chọn Haiku cho cả hai.</div>
    <button class="btn sm" id="msave2">Lưu model</button></details>`;
}

function engagementHtml(a) {
  const e = a.engagement;
  if (!e) return '';
  if (!e.windows?.length) return `<div class="card"><h2>Tương tác bài đã đăng</h2><div class="muted small">${e.error ? `Chưa đọc được số liệu từ Facebook: ${esc(e.error)}` : 'Chưa có bài nào trong 30 ngày qua.'}</div></div>`;
  const w = e.windows.map((x) => `<div class="stat"><span class="muted small">${x.days} ngày qua</span><span class="n">${fmtNum(x.posts)} bài</span><span class="small">${fmtNum(x.engagement)} tương tác · TB ${fmtNum(x.avg)}/bài</span></div>`).join('');
  const tp = (e.topics || []).filter((t) => t.share || t.posts).map((t) => `<tr><td data-l="Chủ đề">${esc(t.title)}</td><td data-l="Kế hoạch">${t.share}%</td><td data-l="Thực tế">${t.posts ? `${t.actual}% (${t.posts} bài)` : '–'}</td><td data-l="TB tương tác">${t.posts ? fmtNum(t.avg) : '–'}</td></tr>`).join('');
  const pl = (list) => list.map((p) => `<div class="small">• <b>${fmtNum(p.engagement)}</b> ${p.permalink_url ? `<a href="${esc(p.permalink_url)}" target="_blank" rel="noopener">${esc(p.line || '(không có chữ)')}</a>` : esc(p.line)}${p.topic ? ` <span class="muted">[${esc(p.topic)}]</span>` : ''}</div>`).join('');
  return `<section class="card eng"><div class="row between"><h2 style="margin:0">Tương tác bài đã đăng</h2><span class="muted small">cập nhật ${fmtTime(e.at)}${e.error ? ' · lần đọc gần nhất lỗi' : ''}</span></div>
    <div class="grid g3">${w}</div>
    ${tp ? `<h3>Theo chủ đề (30 ngày, ${e.tagged}/${e.total} bài do hệ thống đăng có gắn chủ đề)</h3><div class="tscroll"><table class="cards"><thead><tr><th>Chủ đề</th><th>Tỷ trọng kế hoạch</th><th>Thực tế</th><th>TB tương tác/bài</th></tr></thead><tbody>${tp}</tbody></table></div>` : ''}
    <div class="grid g2">${e.top?.length ? `<div><h3>Tương tác cao</h3>${pl(e.top)}</div>` : ''}${e.low?.length ? `<div><h3>Tương tác thấp</h3>${pl(e.low)}</div>` : ''}</div>
    <div class="muted small">Trợ lý dùng số liệu này khi lập kế hoạch, soạn bài, và đề xuất cân chỉnh chủ đề vào sáng thứ Hai, thứ Năm. Đề xuất chỉ áp dụng khi Quý khách bấm Chấp nhận.</div>
    ${a.can_run ? '<div class="row"><button class="btn ghost sm" id="engsug">Phân tích và đề xuất cân chỉnh chủ đề</button></div>' : ''}</section>`;
}
function promptsHtml(a) {
  const sug = a.prompt_suggestions || [];
  const extra = a.prompt_extra || [];
  const kind = (k) => (k === 'video' ? 'Video' : 'Ảnh');
  return `<h2 class="sec">Prompt cho hình ảnh, video</h2>
    <div class="card"><div class="row between"><div class="muted small">Mỗi sáng thứ Hai, trợ lý đề xuất vài mẫu prompt mới (hiệu ứng, kiểu thiết kế) chưa có trong Thư viện. Quý khách duyệt thì mẫu vào mục Prompt bổ sung và trợ lý dùng cho các bài sau.</div>
      ${a.can_settings ? '<button class="btn ghost sm" id="psug">Đề xuất prompt mới</button>' : ''}</div>
    ${sug.map((x) => `<div class="tf psug"><div class="row between"><b>${esc(x.name)}</b><span class="badge off">${kind(x.kind)}</span></div>
      ${x.why ? `<div class="small">${esc(x.why)}</div>` : ''}${x.keywords ? `<div class="muted small">Từ khóa: ${esc(x.keywords)}</div>` : ''}
      <div class="pre small mprompt">${esc(x.text)}</div>
      <div class="row">${a.can_settings ? `<button class="btn sm" data-pacc="${esc(x.sid)}">Thêm vào Thư viện</button><button class="btn ghost sm" data-pdis="${esc(x.sid)}">Bỏ qua</button>` : ''}<button class="btn ghost sm" data-cpx="${esc(x.sid)}">Sao chép</button></div></div>`).join('') || '<div class="muted small" style="margin-top:8px">Chưa có prompt đề xuất nào đang chờ.</div>'}
    ${extra.length ? `<details style="margin-top:12px"><summary>Prompt bổ sung đã duyệt (${extra.length})</summary>${extra.map((x) => `<div class="tf"><div class="row between"><b>${esc(x.id)} · ${esc(x.name)}</b><button class="btn ghost sm" data-cpx="${esc(x.id)}">Sao chép</button></div><div class="pre small mprompt">${esc(x.text)}</div></div>`).join('')}</details>` : ''}</div>`;
}
async function viewAssistant() {
  layout('tro-ly', 'Trợ lý AI', 'Mỗi sáng 7h00: đọc tin, lập kế hoạch tuần, soạn bài cho ngày mai để Quý khách duyệt trong ngày', '<div class="muted">Đang tải…</div>');
  const pick = await topicPagePick();
  document.querySelector('.top .row').innerHTML = pick.sel;
  pick.bind();
  const v = document.getElementById('view');
  if (!topicState.page) { v.innerHTML = '<div class="card">Chưa có Fanpage nào.</div>'; return; }
  const [a, lib0] = await Promise.all([api(`/api/assistant?page_id=${encodeURIComponent(topicState.page)}`), loadPromptLib()]);
  // Prompt bổ sung đã duyệt hiện cùng Thư viện prompt
  const lib = { ...lib0, prompts: { ...lib0.prompts } };
  for (const x of a.prompt_extra || []) lib.prompts[x.id] = { id: x.id, name: x.name, kind: x.kind, text: x.text, groupName: 'Prompt bổ sung', tool: 'Claude', dungcho: x.why };
  const cfg = a.cfg;
  const tname = (id) => { for (const d of a.drafts) if (d.topic_id === id) return d.ai_meta.topic_title; return ''; };
  const topicsHint = a.page.subs ? '' : `<div class="alert warn">Trang này chưa có chủ đề con. <a href="#/chu-de">Mở Chủ đề</a> để nạp bộ mẫu hoặc tạo chủ đề, trợ lý mới soạn bài được.</div>`;
  const usage = a.usage;
  const plansHtml = a.plans.map((p) => `<section class="card plan"><div class="row between"><h2 style="margin:0">Kế hoạch tuần ${esc(p.week_start)}</h2><span class="muted small">${p.provider ? esc(p.provider) + ' · ' : ''}cập nhật ${fmtTime(p.updated_at)}</span></div>
      ${p.focus ? `<p><b>Định hướng tuần:</b> ${esc(p.focus)}</p>` : ''}${p.note ? `<p class="muted small">Lưu ý: ${esc(p.note)}</p>` : ''}
      <div class="tscroll"><table class="cards ptable"><thead><tr><th>Ngày</th><th>Giờ</th><th>Chủ đề con</th><th>Góc bài</th><th>Định dạng, hình ảnh</th><th>Vì sao</th></tr></thead><tbody>
      ${(p.days || []).flatMap((d) => (d.posts.length ? d.posts : [{}]).map((x, i) => `<tr class="${d.date === a.tomorrow ? 'tmr' : ''}"><td data-l="Ngày">${i ? '' : `<b>${esc(d.weekday || '')}</b> ${esc(d.date.slice(8))}/${esc(d.date.slice(5, 7))}${d.date === a.tomorrow ? ' <span class="badge warn">Ngày mai</span>' : ''}`}</td>
        <td data-l="Giờ">${esc(x.time || '')}</td><td data-l="Chủ đề">${esc(x.topic_title || tname(x.topic_id) || (x.topic_id ? `#${x.topic_id}` : '–'))}</td><td data-l="Góc bài">${esc(x.angle || '')}</td>
        <td data-l="Định dạng">${esc(x.format || '')}${x.visual ? `<div class="muted small">${esc(x.visual)}</div>` : ''}${x.prompt_id ? promptChip(lib, x.prompt_id) : ''}</td><td data-l="Vì sao" class="small">${esc(x.why || '')}</td></tr>`)).join('')}
      </tbody></table></div>
      ${p.website?.length ? `<h3>Gợi ý bài website tuần này</h3>${p.website.map((w) => `<div class="tf"><b>${esc(w.title)}</b><div class="small pre">${esc(w.outline)}</div></div>`).join('')}` : ''}
      ${a.can_run ? `<details class="pfb"><summary>Góp ý để AI lập lại kế hoạch tuần</summary><textarea rows="3" data-pfb="${esc(p.week_start)}" placeholder="Ví dụ: thứ Năm có tập huấn tại Krông Pắc, thêm bài thư mời; giảm bài kiến thức, tăng bài hình ảnh thật"></textarea><button class="btn sm" data-pfbgo="${esc(p.week_start)}">Lập lại kế hoạch</button></details>` : ''}
    </section>`).join('') || `<div class="card muted">Chưa có kế hoạch tuần. ${a.can_run ? 'Bấm "Chạy ngay" để trợ lý lập kế hoạch và soạn bài cho ngày mai.' : ''}</div>`;
  const draftCard = (d) => {
    const m = d.ai_meta; const [lb, cls] = DSTATUS[d.status] || [d.status, 'off'];
    const chk = m.check || {};
    const tag = m.kind === 'share' ? '<span class="badge share">Chia sẻ tin báo</span> ' : m.option ? `<span class="badge opt">Phương án ${esc(m.option)}</span> ` : '';
    return `<article class="card adraft${m.kind === 'share' ? ' isshare' : ''}" id="ad-${d.id}"><div class="row between"><div><span class="aibadge">${icon('ai')}Trợ lý AI</span> ${tag}<span class="badge ${cls}">${lb}</span> <b>${esc(m.kind === 'share' ? m.share_title || 'Bài chia sẻ' : m.topic_title || 'Bài trợ lý')}</b> <span class="muted small">${m.angle ? `· ${esc(m.angle)}` : ''}${m.parent_title ? ` · ${esc(m.parent_title)}` : ''}</span></div>
        <span class="muted small">${d.scheduled_at ? `Hẹn ${fmtTime(d.scheduled_at)}` : ''}</span></div>
      <div class="adgrid"><div class="msg">${esc(d.message)}</div>
      <div class="admeta">
        ${m.kind === 'share' && m.share_url ? `<div class="tf"><div class="muted small">Bài báo gốc${m.share_source ? ` (${esc(m.share_source)})` : ''}</div><a href="${esc(m.share_url)}" target="_blank" rel="noopener">${esc(m.share_title || m.share_url)}</a><div class="muted small">Đăng dạng chia sẻ liên kết: Facebook tự hiện ảnh, tiêu đề bài báo.</div></div>` : ''}
        ${m.reason ? `<div class="tf"><div class="muted small">${m.kind === 'share' ? 'Vì sao chọn tin này' : 'Vì sao nên đăng'}</div>${esc(m.reason)}</div>` : ''}
        <div class="tf"><div class="muted small">Tự kiểm tra (${esc(chk.by || '')})</div>${chk.ok ? '<span class="badge ok">Đạt</span>' : `<span class="badge warn">Cần xem lại</span>`}${chk.fixed ? ' <span class="muted small">AI đã tự sửa</span>' : ''}${(chk.ok ? [] : chk.remaining?.length ? chk.remaining : chk.issues || []).map((x) => `<div class="small">• ${esc(x)}</div>`).join('')}</div>
        ${m.visual ? `<div class="tf"><div class="muted small">Hình ảnh, video cần làm</div>${esc(m.visual)}${m.prompt_id ? `<div>Mẫu gốc: ${promptChip(lib, m.prompt_id)}</div>` : ''}</div>` : ''}
        ${m.media_prompt ? `<div class="tf"><div class="row between"><span class="muted small">Prompt sẵn để tạo hình (dán vào Claude)${chk.media_fixed ? ' · đã chỉnh cho khớp bài' : ''}</span><button type="button" class="btn ghost sm" data-cp="${d.id}">Sao chép</button></div><div class="pre small mprompt">${esc(m.media_prompt)}</div></div>` : ''}
        ${m.storyboard ? `<div class="tf"><div class="muted small">Storyboard</div><div class="pre small">${esc(m.storyboard)}</div></div>` : ''}${storyboardHtml(lib, m.storyboard_id)}
        ${m.website ? `<div class="tf"><div class="muted small">Gợi ý bài website</div><b>${esc(m.website.title)}</b><div class="small pre">${esc(m.website.outline || '')}</div></div>` : ''}
        ${m.ads ? `<div class="tf"><div class="muted small">Gợi ý quảng cáo</div><div class="small">${esc(m.ads)}</div></div>` : ''}
        ${(m.feedback || []).length ? `<div class="tf"><div class="muted small">Góp ý đã gửi</div>${m.feedback.map((f) => `<div class="small">• ${esc(f.text)}</div>`).join('')}</div>` : ''}
      </div></div>
      ${['draft', 'pending', 'rejected', 'failed'].includes(d.status) ? `<details class="pfb"><summary>Góp ý để AI viết lại</summary><textarea rows="2" data-rv="${d.id}" placeholder="Ví dụ: mở bài bằng câu hỏi, nhắc buổi tập huấn ngày 5/12, bớt biểu tượng"></textarea><button class="btn sm" data-rvgo="${d.id}">Viết lại</button></details>
      <div class="row">${a.can_run ? `<button class="btn sm" data-appr="${d.id}">${m.option ? `Chọn phương án ${esc(m.option)}, hẹn đăng` : 'Duyệt, hẹn đăng'} ${d.scheduled_at ? fmtTime(d.scheduled_at) : ''}</button>` : ''}<button class="btn ghost sm" data-cedit="${d.id}">Sửa trong Lịch đăng</button>${a.can_run && d.status === 'pending' ? `<button class="btn ghost sm danger" data-rej="${d.id}">Từ chối</button>` : ''}</div>` : ''}
    </article>`;
  };
  // Gom các phương án của cùng một chỗ đăng vào một khung để Quý khách so sánh và chọn 1.
  const groups = [];
  const gIdx = {};
  for (const d of a.drafts) {
    const k = d.ai_meta.slot;
    if (k && gIdx[k] !== undefined) groups[gIdx[k]].push(d);
    else { if (k) gIdx[k] = groups.length; groups.push([d]); }
  }
  const draftsHtml = groups.length ? groups.map((g) => {
    if (g.length < 2) return draftCard(g[0]);
    g.sort((x, y) => String(x.ai_meta.option).localeCompare(String(y.ai_meta.option)));
    const open = g.filter((d) => ['pending', 'draft'].includes(d.status)).length;
    return `<section class="optgrp"><div class="optgrp-h">${icon('ai')}<b>${g.length} phương án cho bài ${g[0].scheduled_at ? fmtTime(g[0].scheduled_at) : ''}</b><span class="muted small">${open > 1 ? 'Chọn 1 phương án để duyệt, phương án còn lại tự chuyển sang Từ chối.' : 'Đã chọn xong.'}</span></div>${g.map(draftCard).join('')}</section>`;
  }).join('') : '<div class="card muted">Chưa có bài nào do trợ lý soạn.</div>';
  v.innerHTML = `${topicsHint}
    <div class="grid ascfg"><div class="card"><h2>Chạy tự động</h2>
      <label class="check"><input type="checkbox" id="aon" ${cfg.on ? 'checked' : ''} ${a.can_settings ? '' : 'disabled'}> Mỗi sáng 7h00 soạn bài cho ngày mai (chờ Quý khách duyệt, không tự đăng)</label>
      <div class="row"><label for="aper" class="grow">Số bài mỗi ngày</label><select id="aper" class="sm" ${a.can_settings ? '' : 'disabled'}><option value="1" ${cfg.per_day === 1 ? 'selected' : ''}>1 bài</option><option value="2" ${cfg.per_day === 2 ? 'selected' : ''}>2 bài</option></select></div>
      <div class="row"><label for="at1" class="grow">Giờ đăng gợi ý</label><input id="at1" type="time" value="${esc(cfg.times[0] || '19:30')}" ${a.can_settings ? '' : 'disabled'}><input id="at2" type="time" value="${esc(cfg.times[1] || '11:30')}" ${a.can_settings ? '' : 'disabled'}></div>
      <div class="row"><label for="aopt" class="grow">Phương án cho mỗi bài</label><select id="aopt" class="sm" ${a.can_settings ? '' : 'disabled'}><option value="2" ${cfg.options !== 1 ? 'selected' : ''}>2 phương án để chọn</option><option value="1" ${cfg.options === 1 ? 'selected' : ''}>1 phương án</option></select></div>
      <label class="check"><input type="checkbox" id="ashare" ${cfg.share !== false ? 'checked' : ''} ${a.can_settings ? '' : 'disabled'}> Thêm 1 bài chia sẻ tin báo mỗi ngày (có nguồn, liên kết bài gốc)</label>
      <label class="check"><input type="checkbox" id="aweb" ${cfg.website ? 'checked' : ''} ${a.can_settings ? '' : 'disabled'}> Gợi ý thêm bài cho website</label>
      ${a.can_run ? `<div class="row">${a.can_settings ? '<button class="btn sm" id="asave">Lưu cài đặt</button>' : ''}<button class="btn ghost sm" id="arun">Chạy ngay</button></div>` : ''}
      ${a.can_settings ? '' : '<div class="muted small">Thiết lập AI (chạy tự động, số bài, phương án, model, Thư viện prompt) do Chủ hệ thống quản lý. Quý khách vẫn chạy, góp ý, viết lại và duyệt bài được.</div>'}
      <div class="muted small">Lần chạy gần nhất: ${a.last_run ? fmtTime(a.last_run) : 'chưa chạy'}</div>${a.last_log.length ? `<details><summary class="small">Nhật ký lần chạy</summary>${a.last_log.map((l) => `<div class="small">• ${esc(l)}</div>`).join('')}</details>` : ''}</div>
    <div class="card"><h2>AI và chi phí tháng ${esc(usage.month.slice(5))}/${esc(usage.month.slice(0, 4))}</h2>
      <div>AI đang dùng: <b>${esc(a.provider || 'chưa cài')}</b></div>
      ${a.models ? modelBox(a) : `<div class="muted small">${me.role === 'owner' ? 'Để dùng Claude: thêm biến bí mật ANTHROPIC_API_KEY trong Cloudflare (Worker farmbase-social, Settings, Variables and Secrets). Chưa có thì hệ thống dùng Workers AI miễn phí.' : ''}</div>`}
      <div class="stat"><span class="n">${usage.usd ? `~${usage.usd.toLocaleString('vi-VN')} USD` : '0 USD'}</span> <span class="muted small">ước tính tháng này${usage.rows.length ? ` · ${usage.rows.reduce((x, r) => x + r.calls, 0)} lượt gọi` : ''}</span></div>
      <div class="muted small">Claude điều phối: Sonnet viết bài và prompt hình, Haiku tự kiểm tra; Workers AI miễn phí đọc tin báo hằng ngày. AI chỉ đọc bản tóm tắt chủ đề và kiến thức; phần hướng dẫn cố định được cache; mỗi Trang 1 lần lập kế hoạch mỗi tuần.</div></div></div>
    ${engagementHtml(a)}
    <h2 class="sec">Bài trợ lý soạn</h2>${draftsHtml}
    ${promptsHtml(a)}
    <h2 class="sec">Kế hoạch tuần</h2>${plansHtml}`;
  bindPrompts(v, lib);
  const copy = async (txt) => { try { await navigator.clipboard.writeText(txt); toast('Đã sao chép prompt'); } catch { toast('Không sao chép được, vui lòng chép tay'); } };
  v.querySelectorAll('[data-cp]').forEach((b) => (b.onclick = () => copy(a.drafts.find((x) => String(x.id) === b.dataset.cp)?.ai_meta.media_prompt || '')));
  v.querySelectorAll('[data-cpx]').forEach((b) => (b.onclick = () => copy([...(a.prompt_extra || []), ...(a.prompt_suggestions || [])].find((x) => (x.id || x.sid) === b.dataset.cpx)?.text || '')));
  v.querySelectorAll('[data-pacc],[data-pdis]').forEach((b) => (b.onclick = async () => {
    try { const r = await api(`/api/assistant/prompts/${b.dataset.pacc || b.dataset.pdis}/${b.dataset.pacc ? 'accept' : 'dismiss'}`, { method: 'POST' }); toast(b.dataset.pacc ? `Đã thêm vào Prompt bổ sung (${r.id})` : 'Đã bỏ qua'); viewAssistant(); } catch (e) { toast(e.message); }
  }));
  v.querySelector('#psug')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Đang đề xuất…';
    try { const r = await api('/api/assistant/prompts/suggest', { method: 'POST' }); toast(r.log?.slice(-1)[0] || 'Xong'); viewAssistant(); } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Đề xuất prompt mới'; }
  });
  v.querySelector('#msave2')?.addEventListener('click', async () => {
    try { await api('/api/assistant/models', { method: 'PUT', body: { write: v.querySelector('#mw').value, fast: v.querySelector('#mf').value, cheap: v.querySelector('#mc').value } }); toast('Đã đổi model Claude'); viewAssistant(); } catch (e) { toast(e.message); }
  });
  v.querySelector('#engsug')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Đang phân tích…';
    try { const r = await api('/api/assistant/run', { method: 'POST', body: { page_id: a.page.id, steps: ['suggest'] } }); toast(r.log?.slice(-1)[0] || 'Xong'); topicState.tab = 'de-xuat'; go('chu-de'); } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Phân tích và đề xuất cân chỉnh chủ đề'; }
  });
  const times = () => [v.querySelector('#at1').value, v.querySelector('#at2').value].filter(Boolean);
  v.querySelector('#asave')?.addEventListener('click', async () => {
    try { await api('/api/assistant/settings', { method: 'PUT', body: { page_id: a.page.id, on: v.querySelector('#aon').checked, per_day: Number(v.querySelector('#aper').value), times: times(), website: v.querySelector('#aweb').checked, options: Number(v.querySelector('#aopt').value), share: v.querySelector('#ashare').checked } }); toast('Đã lưu cài đặt'); } catch (e) { toast(e.message); }
  });
  v.querySelector('#arun')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Đang chạy, khoảng 1 phút…';
    try { const r = await api('/api/assistant/run', { method: 'POST', body: { page_id: a.page.id, steps: ['learn', 'plan', 'drafts'] } }); toast(r.log?.slice(-1)[0] || 'Xong'); viewAssistant(); } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = 'Chạy ngay'; }
  });
  v.querySelectorAll('[data-pfbgo]').forEach((b) => (b.onclick = async () => {
    const fb = v.querySelector(`[data-pfb="${b.dataset.pfbgo}"]`).value.trim();
    if (!fb) { toast('Vui lòng nhập góp ý'); return; }
    b.disabled = true; b.textContent = 'Đang lập lại…';
    try { await api('/api/assistant/plan-feedback', { method: 'POST', body: { page_id: a.page.id, week_start: b.dataset.pfbgo, feedback: fb } }); toast('Đã lập lại kế hoạch tuần'); viewAssistant(); } catch (e) { toast(e.message); b.disabled = false; b.textContent = 'Lập lại kế hoạch'; }
  }));
  v.querySelectorAll('[data-rvgo]').forEach((b) => (b.onclick = async () => {
    const fb = v.querySelector(`[data-rv="${b.dataset.rvgo}"]`).value.trim();
    if (!fb) { toast('Vui lòng nhập góp ý'); return; }
    b.disabled = true; b.textContent = 'AI đang viết lại…';
    try { await api(`/api/assistant/revise/${b.dataset.rvgo}`, { method: 'POST', body: { feedback: fb } }); toast('Đã viết lại theo góp ý. Góp ý được lưu cho các bài sau.'); viewAssistant(); } catch (e) { toast(e.message); b.disabled = false; b.textContent = 'Viết lại'; }
  }));
  const byId = Object.fromEntries(a.drafts.map((d) => [d.id, d]));
  v.querySelectorAll('[data-appr]').forEach((b) => (b.onclick = async () => {
    const d = byId[b.dataset.appr];
    const when = d.scheduled_at && d.scheduled_at > Date.now() / 1000 + 600 ? `hẹn đăng lúc ${fmtTime(d.scheduled_at)}` : 'đăng ngay';
    if (!(await confirmBox(d.ai_meta.option ? `Chọn phương án ${d.ai_meta.option}?` : 'Duyệt bài?', `Bài sẽ được gửi lên Fanpage "${a.page.name}" và ${when}.${d.ai_meta.option ? ' Phương án còn lại tự chuyển sang Từ chối.' : ''}`, 'Duyệt'))) return;
    b.disabled = true;
    try { const r = await api(`/api/content/${d.id}/approve`, { method: 'POST' }); toast(r.item.status === 'failed' ? `Facebook báo lỗi: ${r.item.last_error || ''}` : 'Đã duyệt và gửi lên Facebook'); viewAssistant(); } catch (e) { toast(e.message); b.disabled = false; }
  }));
  v.querySelectorAll('[data-rej]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Từ chối bài?', 'Bài chuyển sang Từ chối, có thể sửa lại sau.', 'Từ chối', true))) return;
    try { await api(`/api/content/${b.dataset.rej}/reject`, { method: 'POST', body: { reason: 'Từ chối ở Trợ lý AI' } }); viewAssistant(); } catch (e) { toast(e.message); }
  }));
  v.querySelectorAll('[data-cedit]').forEach((b) => (b.onclick = () => { Object.assign(calState, { status: '', page: a.page.id, view: 'list', focus: Number(b.dataset.cedit) }); go('lich-dang'); }));
}

// ---------- Kho ảnh, video theo Fanpage ----------
const mediaState = { kind: '', topic: '', source: '', q: '' };
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const MSRC = { upload: 'Tải lên', ai: 'AI tạo' };
const mediaThumb = (x) => (x.kind === 'video' ? `<video src="${esc(x.url)}" muted preload="metadata"></video><span class="tag">Video</span>` : `<img src="${esc(x.url)}" alt="${esc(x.name || '')}" loading="lazy">`);
async function subTopicsOf(pageId) {
  try { const d = await api(`/api/topics?page_id=${encodeURIComponent(pageId)}`); return d.topics.flatMap((t) => t.children.map((c) => ({ id: c.id, title: c.title, parent: t.title }))); } catch { return []; }
}
const topicOptions = (subs, sel) => `<option value="">Chưa gắn chủ đề</option>${subs.map((c) => `<option value="${c.id}" ${Number(sel) === c.id ? 'selected' : ''}>${esc(c.parent)} › ${esc(c.title)}</option>`).join('')}`;

async function viewMedia(q) {
  layout('kho-media', 'Kho ảnh, video', 'Ảnh, video của từng Fanpage: tải lên hoặc do AI tạo, gắn chủ đề để dùng lại khi đăng bài', '<div class="muted">Đang tải…</div>');
  const pick = await topicPagePick();
  document.querySelector('.top .row').innerHTML = pick.sel;
  pick.bind();
  const v = document.getElementById('view');
  if (!topicState.page) { v.innerHTML = '<div class="card">Chưa có Fanpage nào.</div>'; return; }
  if (q?.get('topic')) mediaState.topic = q.get('topic');
  const qs = new URLSearchParams({ page_id: topicState.page });
  if (mediaState.kind) qs.set('kind', mediaState.kind);
  if (mediaState.topic) qs.set('topic_id', mediaState.topic);
  if (mediaState.source) qs.set('source', mediaState.source);
  if (mediaState.q) qs.set('q', mediaState.q);
  const [d, subs] = await Promise.all([api(`/api/media?${qs}`), subTopicsOf(topicState.page)]);
  if (!d.enabled) { v.innerHTML = '<div class="card">Chưa bật kho lưu ảnh, video (Cloudflare R2). Vui lòng liên hệ Chủ hệ thống.</div>'; return; }
  v.innerHTML = `<div class="card mup"><h2>Thêm vào kho</h2>
      <div class="grid g3"><div><label for="mtopic">Chủ đề con</label><select id="mtopic">${topicOptions(subs, mediaState.topic)}</select></div>
      <div><label for="msrc">Nguồn</label><select id="msrc"><option value="upload">Tải lên (ảnh chụp, thiết kế)</option><option value="ai">AI tạo (ghi prompt bên cạnh)</option></select></div>
      <div><label for="mnote">Ghi chú hoặc prompt đã dùng</label><input id="mnote" maxlength="1000" placeholder="Ví dụ: prompt fb-03, ảnh tem QR trên trái sầu riêng"></div></div>
      <div class="row"><label class="btn upl">Chọn ảnh, video<input id="mfiles" type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime" multiple hidden></label>
      <span class="muted small">Ảnh tối đa 10 MB, video MP4 tối đa 95 MB. Kho đang có ${fmtNum(d.total.n)} file, ${fmtSize(d.total.bytes || 0)}.</span></div><div id="mupmsg"></div></div>
    <div class="row mfilter"><select id="fk" class="sm" aria-label="Loại"><option value="">Ảnh và video</option><option value="image" ${mediaState.kind === 'image' ? 'selected' : ''}>Ảnh</option><option value="video" ${mediaState.kind === 'video' ? 'selected' : ''}>Video</option></select>
      <select id="ft" class="sm" aria-label="Chủ đề"><option value="">Mọi chủ đề</option>${subs.map((c) => `<option value="${c.id}" ${Number(mediaState.topic) === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select>
      <select id="fs" class="sm" aria-label="Nguồn"><option value="">Mọi nguồn</option><option value="upload" ${mediaState.source === 'upload' ? 'selected' : ''}>Tải lên</option><option value="ai" ${mediaState.source === 'ai' ? 'selected' : ''}>AI tạo</option></select>
      <input id="fq" class="sm" placeholder="Tìm theo tên, ghi chú" value="${esc(mediaState.q)}"></div>
    ${d.items.length ? `<div class="mgrid">${d.items.map((x) => `<button type="button" class="mcard" data-mid="${x.id}"><div class="mth">${mediaThumb(x)}</div>
      <div class="small mname">${esc(x.name || 'Không tên')}</div><div class="muted small">${esc(x.topic_title || 'Chưa gắn chủ đề')}</div>
      <div class="row small"><span class="badge ${x.source === 'ai' ? 'warn' : 'off'}">${MSRC[x.source] || x.source}</span>${x.used.length ? `<span class="badge ok">Dùng ở ${x.used.length} bài</span>` : ''}</div></button>`).join('')}</div>`
      : '<div class="card muted">Chưa có ảnh, video nào trong kho của Trang này.</div>'}`;
  const reload = () => viewMedia();
  v.querySelector('#fk').onchange = (e) => { mediaState.kind = e.target.value; reload(); };
  v.querySelector('#ft').onchange = (e) => { mediaState.topic = e.target.value; reload(); };
  v.querySelector('#fs').onchange = (e) => { mediaState.source = e.target.value; reload(); };
  v.querySelector('#fq').onchange = (e) => { mediaState.q = e.target.value.trim(); reload(); };
  v.querySelector('#mfiles').onchange = async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    const msg = v.querySelector('#mupmsg');
    const opt = { page_id: topicState.page, topic_id: v.querySelector('#mtopic').value, source: v.querySelector('#msrc').value, note: v.querySelector('#mnote').value.trim() };
    for (const [i, file] of files.entries()) {
      msg.innerHTML = `<div class="muted small">Đang tải ${i + 1}/${files.length}: ${esc(file.name)}…</div>`;
      try { await uploadFile(file, opt); } catch (err) { msg.innerHTML = `<div class="alert err small">${esc(file.name)}: ${esc(err.message)}</div>`; return; }
    }
    toast(`Đã thêm ${files.length} file vào kho`); reload();
  };
  const byId = Object.fromEntries(d.items.map((x) => [x.id, x]));
  v.querySelectorAll('[data-mid]').forEach((b) => (b.onclick = () => openMediaItem(byId[b.dataset.mid], subs, d.can_delete, reload)));
}

function openMediaItem(x, subs, canDelete, done) {
  const full = `${location.origin}${x.url}`;
  modal(`<h2>${esc(x.name || 'Ảnh, video')}</h2>
    <div class="mprev">${x.kind === 'video' ? `<video src="${esc(x.url)}" controls preload="metadata"></video>` : `<img src="${esc(x.url)}" alt="">`}</div>
    <div class="muted small">${MSRC[x.source] || ''} · ${fmtSize(x.size)} · ${fmtTime(x.created_at)}${x.created_by_name ? ` · ${esc(x.created_by_name)}` : ''}</div>
    <label for="mn">Tên</label><input id="mn" maxlength="200" value="${esc(x.name || '')}">
    <label for="mt">Chủ đề con</label><select id="mt">${topicOptions(subs, x.topic_id)}</select>
    <label for="mo">Ghi chú hoặc prompt đã dùng</label><textarea id="mo" rows="3" maxlength="1000">${esc(x.note || '')}</textarea>
    ${x.used.length ? `<div class="tf"><div class="muted small">Đang dùng trong bài</div>${x.used.map((u) => `<div class="small">• ${esc((CSTATUS[u.status] || [u.status])[0])}: ${esc(u.line)}</div>`).join('')}</div>` : ''}
    <div class="row"><button type="button" class="btn ghost sm" id="mcopy">Sao chép đường dẫn</button><button type="button" class="btn ghost sm" id="mpost">Tạo bài với file này</button></div>
    <div id="mmsg2"></div>
    <div class="actions">${canDelete ? `<button class="btn ghost danger" id="mdel" ${x.used.length ? 'disabled title="File đang dùng trong bài"' : ''}>Xóa khỏi kho</button>` : ''}<button class="btn ghost" data-close>Đóng</button><button class="btn" id="msave">Lưu</button></div>`,
  (m, close) => {
    m.querySelector('[data-close]').onclick = close;
    m.querySelector('#mcopy').onclick = async () => { try { await navigator.clipboard.writeText(full); toast('Đã sao chép đường dẫn'); } catch { m.querySelector('#mmsg2').innerHTML = `<div class="small">${esc(full)}</div>`; } };
    m.querySelector('#mpost').onclick = async () => {
      close();
      const { pages } = await api('/api/pages');
      openContentForm(pages.filter((p) => p.id === x.page_id), null, { can_create: true, can_approve: isMgr(), media_enabled: true }, { media: [x] });
    };
    m.querySelector('#msave').onclick = async () => {
      try { await api(`/api/media/${x.id}`, { method: 'PATCH', body: { name: m.querySelector('#mn').value.trim(), topic_id: m.querySelector('#mt').value || null, note: m.querySelector('#mo').value.trim() } }); toast('Đã lưu'); close(); done(); }
      catch (e) { m.querySelector('#mmsg2').innerHTML = `<div class="alert err small">${esc(e.message)}</div>`; }
    };
    m.querySelector('#mdel')?.addEventListener('click', async () => {
      close();
      if (!(await confirmBox('Xóa file khỏi kho?', `File "${x.name || ''}" sẽ bị xóa vĩnh viễn, không khôi phục được.`, 'Xóa', true))) return;
      try { await api(`/api/media/${x.id}`, { method: 'DELETE' }); toast('Đã xóa'); done(); } catch (e) { toast(e.message); }
    });
  });
}

// Chọn ảnh, video có sẵn trong kho của Trang để gắn vào bài.
async function pickMedia(pageId, onPick) {
  const d = await api(`/api/media?page_id=${encodeURIComponent(pageId)}`);
  const chosen = new Set();
  modal(`<h2>Chọn từ kho ảnh, video</h2>
    ${d.items.length ? `<div class="mgrid sm">${d.items.map((x) => `<button type="button" class="mcard" data-pk="${x.id}"><div class="mth">${mediaThumb(x)}</div><div class="small mname">${esc(x.name || '')}</div><div class="muted small">${esc(x.topic_title || '')}</div></button>`).join('')}</div>` : '<div class="muted">Kho của Trang này chưa có file nào. Mở mục Kho ảnh, video để thêm.</div>'}
    <div class="actions"><button class="btn ghost" data-close>Hủy</button><button class="btn" id="pkok">Gắn vào bài</button></div>`,
  (m, close) => {
    m.querySelector('[data-close]').onclick = close;
    m.querySelectorAll('[data-pk]').forEach((b) => (b.onclick = () => { const id = Number(b.dataset.pk); if (chosen.has(id)) chosen.delete(id); else chosen.add(id); b.classList.toggle('on', chosen.has(id)); }));
    m.querySelector('#pkok').onclick = () => { onPick(d.items.filter((x) => chosen.has(x.id))); close(); };
  });
}

async function render() {
  const seq = ++navSeq;
  const { path, q } = parseHash();
  if (!me) {
    try { me = (await api('/api/auth/me', { quiet: true })).user || null; } catch (e) { if (e.stale) return; me = null; }
  }
  if (!me) { if (path !== 'dang-nhap') { location.hash = '#/dang-nhap'; return; } return viewLogin(); }
  if (me.must_change_password) { if (path !== 'doi-mat-khau') { location.hash = '#/doi-mat-khau'; return; } return viewForceChange(); }
  try {
    switch (path) {
      case 'hop-thu': return await viewInbox(q);
      case 'fanpage': return await viewPages(q);
      case 'bai-dang': return await viewPosts(q);
      case 'bao-cao': return await viewReport();
      case 'nguon-noi-dung': return await viewSources();
      case 'chu-de': return me.role !== 'agent' ? await viewTopics(q) : go('tong-quan');
      case 'tro-ly': return me.role !== 'agent' ? await viewAssistant() : go('tong-quan');
      case 'kho-media': return me.role !== 'agent' ? await viewMedia(q) : go('tong-quan');
      case 'quang-cao': return me.role === 'owner' || me.role === 'manager' ? await viewAds(q) : go('tong-quan');
      case 'lich-dang': return await viewCalendar(q);
      case 'quy-dinh': return await viewRules();
      case 'nhan-vien': return me.role === 'owner' ? await viewUsers() : go('tong-quan');
      case 'nhat-ky': return me.role === 'owner' ? await viewAudit() : go('tong-quan');
      case 'tai-khoan': return viewAccount();
      case 'dang-nhap': case 'doi-mat-khau': return go('tong-quan');
      default: return await viewHome();
    }
  } catch (e) {
    if (e.stale || seq !== navSeq) return;
    const v = document.getElementById('view');
    if (v) v.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
  }
}

window.addEventListener('hashchange', render);
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
