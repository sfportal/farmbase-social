// Theo dõi đối thủ (cách miễn phí): danh sách đối thủ, nút mở Thư viện quảng cáo Meta theo từng đối thủ,
// nhân sự dán link quảng cáo hoặc bài để lưu theo ngày, AI phân tích từng mục và tổng hợp tuần.
// Hằng ngày hệ thống tự lấy những gì đọc được công khai, miễn phí: bài trên website đối thủ (RSS, WordPress)
// và tin báo nhắc tới đối thủ. Meta không có API cho quảng cáo thương mại tại Việt Nam và không cho đọc bài
// của Trang mình không quản lý, nên quảng cáo và bài Fanpage của đối thủ do nhân sự dán link.
import { HttpError, json, readJson, now } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { generate, aiProvider, parseJson } from '../lib/ai.js';
import { safeUrl, fetchText, discover, parseFeed, parseWp, parseNews, newsFeedUrl, stripTags } from './sources.js';

const MAX_COMPETITORS = 40;
const KEEP_DAYS = 30; // chỉ lấy bài website, tin báo trong 30 ngày gần nhất
export const KINDS = { ad: 'Quảng cáo', post: 'Bài Fanpage', article: 'Bài website', news: 'Tin báo' };

const staffOnly = (user) => { if (user.role === 'agent') throw new HttpError(403, 'Tài khoản Chăm sóc khách hàng không dùng mục này', 'forbidden'); };
const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Đường dẫn Thư viện quảng cáo Meta: quảng cáo đang chạy tại Việt Nam của một Trang (theo id) hoặc theo từ khóa.
export function adLibraryUrl(c) {
  const base = 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=VN&media_type=all';
  if (c.fb_page_id) return `${base}&search_type=page&view_all_page_id=${encodeURIComponent(c.fb_page_id)}`;
  const q = c.keywords || c.name;
  return `${base}&search_type=keyword_unordered&q=${encodeURIComponent(q)}`;
}

// Nhận diện link dán vào: mẫu quảng cáo trong Thư viện (?id=), bài Fanpage, hoặc bài website.
export function parseLink(raw) {
  const u = safeUrl(raw);
  const host = u.hostname.toLowerCase().replace(/^(www|m|web|mbasic)\./, '');
  if (host === 'facebook.com' || host === 'fb.com' || host === 'fb.watch') {
    const id = u.searchParams.get('id');
    if (u.pathname.startsWith('/ads/library')) {
      if (!/^\d{5,25}$/.test(id || '')) throw new HttpError(400, 'Link Thư viện quảng cáo cần có mã mẫu quảng cáo (dạng ...ads/library/?id=123...). Bấm vào mẫu quảng cáo, chọn "Xem chi tiết mẫu quảng cáo" rồi sao chép link.', 'bad_ad_link');
      return { kind: 'ad', ext_id: id, url: `https://www.facebook.com/ads/library/?id=${id}` };
    }
    // Bài Fanpage: giữ đường dẫn và các tham số nhận diện bài (story_fbid, id, v), bỏ tham số theo dõi.
    const keep = new URLSearchParams();
    for (const k of ['story_fbid', 'id', 'v', 'fbid']) if (u.searchParams.get(k)) keep.set(k, u.searchParams.get(k));
    const path = u.pathname.replace(/\/+$/, '');
    if (!path || path === '/') throw new HttpError(400, 'Vui lòng dán link của một bài cụ thể, không phải trang chủ Facebook', 'bad_post_link');
    const qs = keep.toString();
    const url = `https://www.facebook.com${path}${qs ? `?${qs}` : ''}`;
    return { kind: 'post', ext_id: `${path}${qs ? `?${qs}` : ''}`.slice(0, 300), url };
  }
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
  return { kind: 'article', ext_id: u.toString().slice(0, 300), url: u.toString() };
}

function shape(c, counts = {}) {
  return {
    id: c.id, name: c.name, kind: c.kind, fb_url: c.fb_url, fb_page_id: c.fb_page_id, keywords: c.keywords, website: c.website,
    note: c.note, active: !!c.active, last_fetch_at: c.last_fetch_at, last_error: c.last_error,
    ad_library_url: adLibraryUrl(c), counts: { ad: 0, post: 0, article: 0, news: 0, new7: 0, ...counts },
  };
}

async function loadCompetitor(env, id) {
  const c = await env.DB.prepare('SELECT * FROM social_competitors WHERE id = ?').bind(Number(id)).first();
  if (!c) throw new HttpError(404, 'Không tìm thấy đối thủ', 'not_found');
  return c;
}

async function getReport(env) {
  const r = await env.DB.prepare("SELECT value FROM social_settings WHERE key = 'competitor_report'").first();
  try { return r ? JSON.parse(r.value) : null; } catch { return null; }
}

// GET /api/competitors?competitor_id=&kind=&days=
export async function listCompetitors(request, env, user) {
  staffOnly(user);
  const q = new URL(request.url).searchParams;
  const days = Math.min(Math.max(Number(q.get('days')) || 30, 1), 365);
  const t = now();
  const { results: comps } = await env.DB.prepare('SELECT * FROM social_competitors ORDER BY active DESC, name').all();
  const { results: cnt } = await env.DB.prepare('SELECT competitor_id, kind, COUNT(*) AS n, SUM(CASE WHEN first_seen_at >= ? THEN 1 ELSE 0 END) AS n7 FROM social_competitor_items GROUP BY competitor_id, kind').bind(t - 7 * 86400).all();
  const counts = {};
  for (const r of cnt) { const x = (counts[r.competitor_id] ||= {}); x[r.kind] = r.n; x.new7 = (x.new7 || 0) + (r.n7 || 0); }
  const where = ['i.first_seen_at >= ?']; const args = [t - days * 86400];
  if (q.get('competitor_id')) { where.push('i.competitor_id = ?'); args.push(Number(q.get('competitor_id'))); }
  if (KINDS[q.get('kind')]) { where.push('i.kind = ?'); args.push(q.get('kind')); }
  const { results: items } = await env.DB.prepare(`SELECT i.*, c.name AS competitor_name FROM social_competitor_items i JOIN social_competitors c ON c.id = i.competitor_id
    WHERE ${where.join(' AND ')} ORDER BY i.first_seen_at DESC, COALESCE(i.started_at, 0) DESC, i.id DESC LIMIT 300`).bind(...args).all();
  return json({
    competitors: comps.map((c) => shape(c, counts[c.id])),
    items: items.map((i) => ({ ...i, active: !!i.active })),
    report: await getReport(env),
    can_edit: user.role === 'owner' || user.role === 'manager',
    has_ai: !!aiProvider(env),
    kinds: KINDS,
  });
}

function readCompetitor(body, env) {
  const name = clean(body.name, 120);
  if (name.length < 2) throw new HttpError(400, 'Vui lòng nhập tên đối thủ', 'bad_name');
  let fbUrl = null; let pageId = clean(body.fb_page_id, 30) || null;
  if (clean(body.fb_url, 300)) {
    const u = safeUrl(body.fb_url, env);
    if (!/(^|\.)facebook\.com$/.test(u.hostname)) throw new HttpError(400, 'Link Fanpage phải là địa chỉ facebook.com', 'bad_fb');
    fbUrl = `https://www.facebook.com${u.pathname}${u.searchParams.get('id') ? `?id=${u.searchParams.get('id')}` : ''}`;
    pageId ||= (u.pathname.match(/^\/(\d{6,})/) || [])[1] || u.searchParams.get('id') || null;
  }
  if (pageId && !/^\d{5,25}$/.test(pageId)) throw new HttpError(400, 'Mã Trang (Page ID) chỉ gồm chữ số', 'bad_page_id');
  const website = clean(body.website, 300) ? safeUrl(body.website, env).toString() : null;
  return { name, kind: clean(body.kind, 200), fb_url: fbUrl, fb_page_id: pageId, keywords: clean(body.keywords, 100) || name.replace(/\s*\(.*?\)/g, ''), website, note: String(body.note ?? '').trim().slice(0, 2000) };
}

// POST /api/competitors
export async function createCompetitor(request, env, user) {
  requireRole(user, 'owner', 'manager');
  const c = readCompetitor(await readJson(request), env);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM social_competitors').first();
  if (n.n >= MAX_COMPETITORS) throw new HttpError(400, `Tối đa ${MAX_COMPETITORS} đối thủ`, 'too_many');
  const row = await env.DB.prepare('INSERT INTO social_competitors (name, kind, fb_url, fb_page_id, keywords, website, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(c.name, c.kind, c.fb_url, c.fb_page_id, c.keywords, c.website, c.note, user.id, now()).first();
  await audit(env, request, user.id, 'competitor_added', c.name, { id: row.id });
  return json({ id: row.id }, 201);
}

// PATCH /api/competitors/:id
export async function updateCompetitor(request, env, user, id) {
  requireRole(user, 'owner', 'manager');
  const old = await loadCompetitor(env, id);
  const body = await readJson(request);
  const c = readCompetitor({ ...old, ...body }, env);
  const active = body.active === undefined ? old.active : (body.active ? 1 : 0);
  const feedReset = c.website !== old.website;
  await env.DB.prepare(`UPDATE social_competitors SET name = ?, kind = ?, fb_url = ?, fb_page_id = ?, keywords = ?, website = ?, note = ?, active = ?${feedReset ? ', feed_url = NULL, feed_type = NULL, feed_checked_at = NULL' : ''} WHERE id = ?`)
    .bind(c.name, c.kind, c.fb_url, c.fb_page_id, c.keywords, c.website, c.note, active, old.id).run();
  await audit(env, request, user.id, 'competitor_updated', c.name, { id: old.id });
  return json({ ok: true });
}

// DELETE /api/competitors/:id (xóa đối thủ và các mục đã ghi nhận; giao diện hỏi xác nhận trước)
export async function deleteCompetitor(request, env, user, id) {
  requireRole(user, 'owner');
  const c = await loadCompetitor(env, id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM social_competitor_items WHERE competitor_id = ?').bind(c.id),
    env.DB.prepare('DELETE FROM social_competitors WHERE id = ?').bind(c.id),
  ]);
  await audit(env, request, user.id, 'competitor_removed', c.name, { id: c.id });
  return json({ ok: true });
}

const ITEM_SYSTEM = `Bạn là chuyên viên phân tích marketing của FarmBase (giải pháp số hóa vùng trồng, truy xuất nguồn gốc do BVI và Salefronts đồng phát triển).
Đọc nội dung quảng cáo hoặc bài đăng của một đối thủ và rút ra ý chính bằng tiếng Việt, ngắn gọn, khách quan. Không chép nguyên văn câu chữ của đối thủ.
Chỉ trả về JSON: {"title": "tiêu đề ngắn dưới 100 ký tự", "fmt": "định dạng (Ảnh, Video, Carousel, Bài dài, Sự kiện...)", "angle": "góc tiếp cận, nỗi đau, lời hứa, 1 đến 2 câu", "cta": "lời kêu gọi hành động"}`;

async function analyzeText(env, competitor, kind, text) {
  if (!aiProvider(env) || text.length < 20) return null;
  try {
    const r = await generate(env, { tier: 'fast', maxTokens: 4000, system: ITEM_SYSTEM,
      prompt: `[VIEC:cmp_item] Đối thủ: ${competitor.name} (${competitor.kind || 'chưa rõ lĩnh vực'}). Loại: ${KINDS[kind]}.\nNội dung:\n${text.slice(0, 4000)}\n\nTrả về JSON như hướng dẫn.` });
    const j = parseJson(r.text);
    if (!j) return null;
    return { title: clean(j.title, 120), fmt: clean(j.fmt, 60), angle: clean(j.angle, 600), cta: clean(j.cta, 120) };
  } catch { return null; }
}

// POST /api/competitors/:id/items { url, text, fmt, angle, cta, started }  (dán link quảng cáo hoặc bài)
export async function addItem(request, env, user, id) {
  staffOnly(user);
  const c = await loadCompetitor(env, id);
  const body = await readJson(request);
  const link = parseLink(body.url);
  const text = String(body.text ?? '').trim().slice(0, 8000);
  const t = now();
  let started = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(body.started || ''))) started = Math.floor(Date.parse(`${body.started}T12:00:00+07:00`) / 1000);
  const manual = { title: clean(body.title, 120), fmt: clean(body.fmt, 60), angle: clean(body.angle, 600), cta: clean(body.cta, 120) };
  const ai = !manual.angle && text ? await analyzeText(env, c, link.kind, text) : null;
  const f = { title: manual.title || ai?.title || (text ? clean(text.split('\n')[0], 120) : `${KINDS[link.kind]} của ${c.name}`), fmt: manual.fmt || ai?.fmt || '', angle: manual.angle || ai?.angle || '', cta: manual.cta || ai?.cta || '' };
  const old = await env.DB.prepare('SELECT id FROM social_competitor_items WHERE competitor_id = ? AND kind = ? AND ext_id = ?').bind(c.id, link.kind, link.ext_id).first();
  if (old) {
    await env.DB.prepare(`UPDATE social_competitor_items SET last_seen_at = ?, active = 1, url = ?${text ? ', body = ?' : ''}${f.angle ? ', title = ?, fmt = ?, angle = ?, cta = ?' : ''}${started ? ', started_at = ?' : ''} WHERE id = ?`)
      .bind(t, link.url, ...(text ? [text] : []), ...(f.angle ? [f.title, f.fmt, f.angle, f.cta] : []), ...(started ? [started] : []), old.id).run();
    return json({ id: old.id, updated: true, kind: link.kind, ai: !!ai });
  }
  const row = await env.DB.prepare(`INSERT INTO social_competitor_items (competitor_id, kind, ext_id, url, title, body, fmt, angle, cta, started_at, first_seen_at, last_seen_at, source, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?) RETURNING id`)
    .bind(c.id, link.kind, link.ext_id, link.url, f.title, text, f.fmt, f.angle, f.cta, started, t, t, user.id).first();
  await audit(env, request, user.id, 'competitor_item_added', `${c.name}: ${link.url}`.slice(0, 200), { id: row.id });
  return json({ id: row.id, updated: false, kind: link.kind, ai: !!ai }, 201);
}

// DELETE /api/competitors/items/:id
export async function deleteItem(request, env, user, id) {
  requireRole(user, 'owner', 'manager');
  const it = await env.DB.prepare('SELECT * FROM social_competitor_items WHERE id = ?').bind(Number(id)).first();
  if (!it) throw new HttpError(404, 'Không tìm thấy mục', 'not_found');
  await env.DB.prepare('DELETE FROM social_competitor_items WHERE id = ?').bind(it.id).run();
  await audit(env, request, user.id, 'competitor_item_removed', it.url || it.title, { id: it.id });
  return json({ ok: true });
}

// ---------- Tự lấy hằng ngày (miễn phí): bài website đối thủ và tin báo nhắc tới đối thủ ----------
async function upsertAuto(env, c, kind, it, t) {
  if (!it.url) return 0;
  const ext = String(it.url).slice(0, 300);
  const old = await env.DB.prepare('SELECT id FROM social_competitor_items WHERE competitor_id = ? AND kind = ? AND ext_id = ?').bind(c.id, kind, ext).first();
  if (old) { await env.DB.prepare('UPDATE social_competitor_items SET last_seen_at = ? WHERE id = ?').bind(t, old.id).run(); return 0; }
  await env.DB.prepare(`INSERT INTO social_competitor_items (competitor_id, kind, ext_id, url, title, body, image, started_at, first_seen_at, last_seen_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto')`)
    .bind(c.id, kind, ext, it.url, clean(it.title, 200) || it.url, clean(it.summary, 1000), it.image || null, it.date || null, t, t).run();
  return 1;
}

// Tin báo: chỉ giữ tin có nhắc tên hoặc từ khóa của đối thủ trong tiêu đề, tóm tắt.
export function mentions(it, c) {
  const txt = `${it.title} ${it.summary}`.toLowerCase();
  const keys = [c.keywords, c.name.replace(/\s*\(.*?\)/g, '')].filter(Boolean).map((k) => k.toLowerCase().trim()).filter((k) => k.length >= 3);
  return keys.some((k) => txt.includes(k));
}

export async function fetchCompetitor(env, c, log = []) {
  const t = now(); const since = t - KEEP_DAYS * 86400;
  let added = 0; const errs = [];
  // Website không có RSS: đánh dấu 'none', 7 ngày mới dò lại (mỗi lần dò tốn nhiều lượt gọi ra ngoài).
  if (c.website && (c.feed_type !== 'none' || websiteRecheckDue(c, t))) {
    try {
      let feed = c.feed_url ? { feed_url: c.feed_url, feed_type: c.feed_type } : null;
      if (!feed) {
        try { feed = await discover(safeUrl(c.website, env)); }
        catch (e) {
          if (!/subrequest/i.test(e.message)) await env.DB.prepare("UPDATE social_competitors SET feed_url = NULL, feed_type = 'none', feed_checked_at = ? WHERE id = ?").bind(t, c.id).run();
          throw e;
        }
        await env.DB.prepare('UPDATE social_competitors SET feed_url = ?, feed_type = ?, feed_checked_at = ? WHERE id = ?').bind(feed.feed_url, feed.feed_type, t, c.id).run();
      }
      const r = await fetchText(feed.feed_url, feed.feed_type === 'wp' ? 'application/json' : 'application/rss+xml,application/xml,*/*');
      const list = feed.feed_type === 'wp' ? parseWp(JSON.parse(r.text)) : parseFeed(r.text);
      for (const it of list.filter((x) => !x.date || x.date >= since).slice(0, 20)) added += await upsertAuto(env, c, 'article', it, t);
    } catch (e) { errs.push(`Website: ${stripTags(e.message).slice(0, 160)}`); }
  }
  if (c.keywords) {
    try {
      const r = await fetchText(newsFeedUrl(env, `"${c.keywords}"`), 'application/rss+xml,application/xml,*/*');
      for (const it of parseNews(r.text).filter((x) => mentions(x, c)).slice(0, 10)) added += await upsertAuto(env, c, 'news', it, t);
    } catch (e) { errs.push(`Tin báo: ${stripTags(e.message).slice(0, 160)}`); }
  }
  await env.DB.prepare('UPDATE social_competitors SET last_fetch_at = ?, last_error = ? WHERE id = ?').bind(t, errs.join(' · ') || null, c.id).run();
  log.push(`${c.name}: ${added} mục mới${errs.length ? ` (${errs.join('; ')})` : ''}`);
  return added;
}

// Mỗi lần chạy Worker chỉ được gọi ra ngoài khoảng 50 lượt (gói miễn phí), nên chạy theo lượt:
// đối thủ lâu chưa cập nhật đi trước, ước tính số lượt gọi của từng đối thủ, đủ ngân sách thì dừng, phần còn lại để lần sau.
const FETCH_BUDGET = 40;
export function websiteRecheckDue(c, t) { return !c.feed_checked_at || t - c.feed_checked_at >= 7 * 86400; }
export function fetchCost(c, t) {
  let n = c.keywords ? 1 : 0;
  if (c.website) n += c.feed_url ? 1 : (c.feed_type === 'none' && !websiteRecheckDue(c, t)) ? 0 : 14;
  return n;
}
export async function runCompetitors(env, { ids = null, staleHours = 0 } = {}) {
  const t = now();
  const { results } = await env.DB.prepare('SELECT * FROM social_competitors WHERE active = 1 ORDER BY COALESCE(last_fetch_at, 0), id').all();
  const todo = results.filter((x) => (!ids || ids.includes(x.id)) && (!staleHours || !x.last_fetch_at || t - x.last_fetch_at >= staleHours * 3600));
  const log = []; let total = 0; let used = 0; let done = 0;
  for (const c of todo) {
    const cost = fetchCost(c, t);
    if (done && used + cost > FETCH_BUDGET) break;
    used += cost; done++;
    total += await fetchCompetitor(env, c, log);
  }
  const left = todo.length - done;
  if (left) log.push(`Còn ${left} đối thủ sẽ cập nhật ở lần chạy sau.`);
  return { total, log, left };
}

// POST /api/competitors/fetch { competitor_id? }
export async function fetchNow(request, env, user) {
  requireRole(user, 'owner', 'manager');
  const body = await readJson(request).catch(() => ({}));
  const ids = body.competitor_id ? [Number(body.competitor_id)] : null;
  const r = await runCompetitors(env, { ids });
  await audit(env, request, user.id, 'competitors_fetched', `${r.total} mục mới`);
  return json(r);
}

// ---------- AI tổng hợp tuần ----------
const REPORT_SYSTEM = `Bạn là chuyên viên chiến lược nội dung của FarmBase, giải pháp do BVI và Salefronts đồng phát triển (số hóa vùng trồng, nhật ký điện tử, truy xuất nguồn gốc, hỗ trợ hồ sơ mã số vùng trồng).
Từ danh sách quảng cáo, bài đăng, tin báo của đối thủ, viết bản tổng hợp tiếng Việt, khách quan, giọng doanh nghiệp.
Quy tắc khi gợi ý ý tưởng cho FarmBase: không chép câu chữ của đối thủ; không viết FarmBase hay BVI "cấp mã" (việc cấp mã số vùng trồng thuộc thẩm quyền cơ quan quản lý nhà nước; BVI hỗ trợ kỹ thuật, hồ sơ và vận hành hệ thống truy xuất); không tuyên bố "đáp ứng EUDR"; không bịa số liệu.
Chỉ trả về JSON: {"summary": "3 đến 5 câu: đối thủ đang nói gì, dồn lực vào đâu", "themes": ["chủ đề nổi bật"], "offers": ["ưu đãi, lời kêu gọi đáng chú ý"], "ideas": ["3 đến 5 ý tưởng bài cho FarmBase, mỗi ý 1 câu"]}`;

// POST /api/competitors/analyze { days }
export async function analyze(request, env, user) {
  requireRole(user, 'owner', 'manager');
  if (!aiProvider(env)) throw new HttpError(503, 'Chưa cài AI cho hệ thống', 'no_ai');
  const body = await readJson(request).catch(() => ({}));
  const days = [7, 14, 30].includes(Number(body.days)) ? Number(body.days) : 14;
  const t = now();
  const { results } = await env.DB.prepare(`SELECT i.kind, i.title, i.body, i.fmt, i.angle, i.cta, i.first_seen_at, c.name FROM social_competitor_items i JOIN social_competitors c ON c.id = i.competitor_id
    WHERE i.first_seen_at >= ? OR (i.kind = 'ad' AND i.active = 1 AND i.last_seen_at >= ?) ORDER BY i.first_seen_at DESC LIMIT 80`).bind(t - days * 86400, t - days * 86400).all();
  if (!results.length) throw new HttpError(400, `Chưa có mục nào trong ${days} ngày qua. Vui lòng dán link quảng cáo, bài của đối thủ trước.`, 'empty');
  const lines = results.map((r, i) => `${i + 1}. [${r.name}] ${KINDS[r.kind]}: ${r.title}${r.fmt ? ` | Định dạng: ${r.fmt}` : ''}${r.angle ? ` | Góc: ${r.angle}` : ''}${r.cta ? ` | Kêu gọi: ${r.cta}` : ''}${!r.angle && r.body ? ` | ${r.body.slice(0, 300)}` : ''}`).join('\n');
  const r = await generate(env, { tier: 'write', maxTokens: 3000, system: REPORT_SYSTEM, prompt: `[VIEC:cmp_report] Dữ liệu ${days} ngày qua (${results.length} mục):\n${lines}\n\nTrả về JSON như hướng dẫn.` });
  const j = parseJson(r.text);
  if (!j?.summary) throw new HttpError(502, 'AI chưa trả về bản tổng hợp, vui lòng thử lại', 'ai_bad');
  const arr = (x) => (Array.isArray(x) ? x.map((s) => clean(s, 300)).filter(Boolean).slice(0, 8) : []);
  const report = { at: t, days, count: results.length, summary: String(j.summary).trim().slice(0, 2000), themes: arr(j.themes), offers: arr(j.offers), ideas: arr(j.ideas) };
  await env.DB.prepare("INSERT INTO social_settings (key, value, updated_by, updated_at) VALUES ('competitor_report', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
    .bind(JSON.stringify(report), user.id, t).run();
  await audit(env, request, user.id, 'competitor_report', `${days} ngày, ${results.length} mục`);
  return json({ report });
}
