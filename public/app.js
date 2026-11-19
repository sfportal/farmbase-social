// FarmBase Social: giao diện một trang (định tuyến bằng #hash), dùng chung cho máy tính và điện thoại.

const $app = document.getElementById('app');
let me = null; // tài khoản đang đăng nhập

// ---------- Tiện ích ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (n) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('vi-VN'));
const fmtTime = (t) => (t ? new Date(t * 1000).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '–');

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 3200);
}

async function api(path, { method = 'GET', body, quiet = false } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
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
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;

// ---------- Khung trang ----------
function navItems() {
  const items = [
    { r: 'tong-quan', label: 'Tổng quan', ic: 'home' },
    { r: 'hop-thu', label: 'Hộp thư', ic: 'inbox', soon: 'GĐ 3' },
    { r: 'lich-dang', label: 'Lịch đăng', ic: 'cal', soon: 'GĐ 2' },
    { r: 'fanpage', label: 'Fanpage', ic: 'pages' },
    { r: 'bai-dang', label: 'Bài đăng', ic: 'chart' },
  ];
  if (me.role === 'owner') {
    items.push({ r: 'nhan-vien', label: 'Nhân viên', ic: 'users' });
    items.push({ r: 'nhat-ky', label: 'Nhật ký', ic: 'log' });
  }
  items.push({ r: 'tai-khoan', label: 'Tài khoản', ic: 'me' });
  return items;
}

function layout(active, title, sub, body, actions = '') {
  const items = navItems();
  const side = items.map((i) => `<a href="#/${i.r}" class="${i.r === active ? 'on' : ''} ${i.soon ? 'soon' : ''}" ${i.soon ? 'aria-disabled="true" tabindex="-1"' : ''}>${icon(i.ic)}<span>${i.label}</span>${i.soon ? `<span class="tag">${i.soon}</span>` : ''}</a>`).join('');
  const mobile = ['tong-quan', 'fanpage', 'bai-dang', me.role === 'owner' ? 'nhan-vien' : null, 'tai-khoan']
    .filter(Boolean).map((r) => items.find((i) => i.r === r))
    .map((i) => `<a href="#/${i.r}" class="${i.r === active ? 'on' : ''}">${icon(i.ic)}<span>${i.label}</span></a>`).join('');
  $app.innerHTML = `<div class="shell">
    <aside class="side"><div class="brand"><img src="/icons/icon.svg" alt="">FarmBase Social</div>
      <nav class="nav" aria-label="Menu chính">${side}</nav>
      <div class="who"><b>${esc(me.name || me.email)}</b><span>${esc(me.role_label)}</span></div></aside>
    <main class="main"><div class="top"><div><h1>${esc(title)}</h1>${sub ? `<div class="muted">${sub}</div>` : ''}</div><div class="row">${actions}</div></div>
      <div id="view">${body}</div></main>
    <nav class="bottom" aria-label="Menu">${mobile}</nav></div>`;
  window.scrollTo(0, 0);
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

// ---------- Tổng quan ----------
async function viewHome() {
  layout('tong-quan', `Chào ${me.name || 'Quý khách'}`, 'Tình hình các Fanpage Quý khách đang quản lý', '<div class="muted">Đang tải…</div>');
  const { pages } = await api('/api/pages');
  const active = pages.filter((p) => p.status === 'active');
  const followers = active.reduce((s, p) => s + (p.followers_count || 0), 0);
  const fans = active.reduce((s, p) => s + (p.fan_count || 0), 0);
  const errors = pages.filter((p) => p.status === 'error');
  document.getElementById('view').innerHTML = `
    ${errors.length ? `<div class="alert err">${errors.length} Fanpage đang lỗi kết nối. <a href="#/fanpage">Xem chi tiết</a></div>` : ''}
    <div class="grid">
      <div class="card stat"><div class="muted small">Fanpage đang quản lý</div><div class="n">${fmtNum(active.length)}</div></div>
      <div class="card stat"><div class="muted small">Tổng người theo dõi</div><div class="n">${fmtNum(followers)}</div></div>
      <div class="card stat"><div class="muted small">Tổng lượt thích Trang</div><div class="n">${fmtNum(fans)}</div></div>
    </div>
    ${pages.length ? '' : `<div class="card" style="margin-top:16px"><h2>Bắt đầu</h2><p class="muted">${me.role === 'owner'
      ? 'Chưa có Fanpage nào. Vào mục Fanpage và bấm "Kết nối Fanpage" để đăng nhập Facebook và chọn các Trang cần quản lý.'
      : 'Quý khách chưa được giao Fanpage nào. Vui lòng liên hệ Chủ hệ thống.'}</p>
      ${me.role === 'owner' ? '<a class="btn" href="#/fanpage">Đến mục Fanpage</a>' : ''}</div>`}
    <div class="card" style="margin-top:16px"><h2>Lộ trình</h2>
      <ul class="muted" style="margin:0;padding-left:20px">
        <li><b>Giai đoạn 1 (đang dùng):</b> tài khoản, phân quyền, kết nối Fanpage, số liệu cơ bản.</li>
        <li><b>Đã có:</b> xem bài đăng và số tương tác từng bài theo Fanpage (mục Bài đăng).</li>
        <li><b>Giai đoạn 2:</b> lịch nội dung, duyệt và đăng bài tự động.</li>
        <li><b>Giai đoạn 3:</b> hộp thư chung, trả lời bình luận và tin nhắn tự động.</li>
        <li><b>Giai đoạn 4:</b> CRM mini, ghi đơn, AI bán hàng, báo cáo tuần.</li>
      </ul></div>`;
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
      <div class="row"><a class="btn ghost sm" href="#/bai-dang?trang=${encodeURIComponent(p.id)}">Bài đăng</a>${canRefresh ? `<button class="btn ghost sm" data-refresh="${esc(p.id)}">Cập nhật</button>` : ''}
        ${owner ? `<button class="btn danger sm" data-disc="${esc(p.id)}" data-name="${esc(p.name)}">Ngắt</button>` : ''}</div></div>`;
  }).join('');
  document.getElementById('view').innerHTML = `${notice}${setup}<div class="card">${rows || `<p class="muted" style="margin:0">${owner ? 'Chưa có Fanpage nào. Bấm "Kết nối Fanpage", đăng nhập Facebook và chọn các Trang Quý khách quản trị.' : 'Quý khách chưa được giao Fanpage nào.'}</p>`}</div>
    ${owner ? '<p class="muted small">Kết nối lại bất cứ lúc nào để thêm Trang mới hoặc làm mới mã truy cập. Mã truy cập được mã hóa trước khi lưu.</p>' : ''}`;

  document.querySelectorAll('[data-refresh]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await api(`/api/pages/${encodeURIComponent(b.dataset.refresh)}/refresh`, { method: 'POST' }); toast('Đã cập nhật số liệu'); viewPages(new URLSearchParams()); }
    catch (e) { toast(e.message); b.disabled = false; }
  }));
  document.querySelectorAll('[data-disc]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Ngắt kết nối Fanpage?', `Hệ thống sẽ xóa mã truy cập của "${b.dataset.name}" và dừng mọi việc tự động trên Trang này. Có thể kết nối lại sau.`, 'Ngắt kết nối', true))) return;
    try { await api(`/api/pages/${encodeURIComponent(b.dataset.disc)}/disconnect`, { method: 'POST' }); toast('Đã ngắt kết nối'); viewPages(new URLSearchParams()); }
    catch (e) { toast(e.message); }
  }));
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
      <label>Fanpage được giao</label>
      ${pages.length ? pages.map((p) => `<label class="check"><input type="checkbox" value="${esc(p.id)}" ${u?.page_ids.includes(p.id) ? 'checked' : ''}>${esc(p.name)}</label>`).join('') : '<div class="muted small">Chưa có Fanpage nào được kết nối.</div>'}
      <div class="muted small">Chủ hệ thống luôn thấy mọi Fanpage.</div>
      <div id="umsg"></div>
      <div class="actions"><button type="button" class="btn ghost" data-cancel>Hủy</button><button class="btn">${u ? 'Lưu' : 'Tạo tài khoản'}</button></div>
    </form>`;

  const openForm = (u) => modal(userForm(u), (m, close) => {
    m.querySelector('[data-cancel]').onclick = close;
    m.querySelector('#uf').onsubmit = async (e) => {
      e.preventDefault();
      const body = {
        name: m.querySelector('#u-name').value,
        role: m.querySelector('#u-role').value,
        page_ids: [...m.querySelectorAll('.check input:checked')].map((i) => i.value),
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
async function render() {
  const { path, q } = parseHash();
  if (!me) {
    try { me = (await api('/api/auth/me', { quiet: true })).user || null; } catch { me = null; }
  }
  if (!me) { if (path !== 'dang-nhap') { location.hash = '#/dang-nhap'; return; } return viewLogin(); }
  if (me.must_change_password) { if (path !== 'doi-mat-khau') { location.hash = '#/doi-mat-khau'; return; } return viewForceChange(); }
  try {
    switch (path) {
      case 'fanpage': return await viewPages(q);
      case 'bai-dang': return await viewPosts(q);
      case 'nhan-vien': return me.role === 'owner' ? await viewUsers() : go('tong-quan');
      case 'nhat-ky': return me.role === 'owner' ? await viewAudit() : go('tong-quan');
      case 'tai-khoan': return viewAccount();
      case 'dang-nhap': case 'doi-mat-khau': return go('tong-quan');
      default: return await viewHome();
    }
  } catch (e) {
    const v = document.getElementById('view');
    if (v) v.innerHTML = `<div class="alert err">${esc(e.message)}</div>`;
  }
}

window.addEventListener('hashchange', render);
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
