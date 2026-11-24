// Video tham khảo: mỗi sáng tìm video YouTube mới theo từ khóa (YouTube Data API chính thức, miễn phí),
// tách Clip và Shorts, lưu link, kênh, lượt xem, ngày đăng; AI rút ý tưởng học được cho FarmBase.
// TikTok và Reels chưa có API mở nên chưa tự lấy.
import { HttpError, json, readJson, now } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { safeUrl } from './sources.js';
import { mentions } from './competitors.js';

export const DEFAULT_KEYWORDS = ['FarmBase', 'truy xuất nguồn gốc', 'truy xuất nguồn gốc nông sản', 'GS1', 'mã vạch GS1', 'nông nghiệp', 'chuyển đổi số nông nghiệp', 'nông nghiệp số', 'mã số vùng trồng', 'nhật ký canh tác điện tử', '10.000 ha cây trồng chủ lực', 'HTX DaLa'];
export const SHORT_MAX_S = 180; // YouTube Shorts dài tối đa 3 phút
const MAX_KEYWORDS = 12;
const MAX_COMPETITOR_SEARCH = 20; // tìm thêm video nhắc tên đối thủ (giới hạn lượt gọi ra ngoài mỗi lần chạy)
const PER_KEYWORD = 12;
const DAYS_BACK = 14;

const staffOnly = (user) => { if (user.role === 'agent') throw new HttpError(403, 'Tài khoản Chăm sóc khách hàng không dùng mục này', 'forbidden'); };
const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// ISO 8601 (PT1H2M3S) sang giây.
export function isoSeconds(d) {
  const m = String(d || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0);
}
export const kindOf = (sec) => (sec !== null && sec !== undefined && sec <= SHORT_MAX_S ? 'short' : 'clip');

async function getSetting(env, key, fallback) {
  const r = await env.DB.prepare('SELECT value FROM social_settings WHERE key = ?').bind(key).first();
  try { return r ? JSON.parse(r.value) : fallback; } catch { return fallback; }
}
async function putSetting(env, key, value, userId) {
  await env.DB.prepare('INSERT INTO social_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
    .bind(key, JSON.stringify(value), userId, now()).run();
}
const keywordsOf = (env) => getSetting(env, 'video_keywords', DEFAULT_KEYWORDS);

async function yt(env, path, params) {
  const base = env.YOUTUBE_API_BASE || 'https://www.googleapis.com';
  const qs = new URLSearchParams({ ...params, key: env.YOUTUBE_API_KEY });
  const res = await fetch(`${base}/youtube/v3/${path}?${qs}`, { headers: { accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data.error?.errors?.[0]?.reason || '';
    if (reason === 'quotaExceeded') throw new HttpError(429, 'Đã dùng hết hạn mức YouTube hôm nay, ngày mai hệ thống tự lấy tiếp', 'yt_quota');
    if (res.status === 400 || res.status === 403) throw new HttpError(502, `YouTube từ chối khóa API (${reason || res.status}). Vui lòng kiểm tra YOUTUBE_API_KEY và bật YouTube Data API v3 trong Google Cloud.`, 'yt_key');
    throw new HttpError(502, `YouTube báo lỗi ${res.status}`, 'yt_error');
  }
  return data;
}

// Không dùng AI viết ý tưởng cho video (theo yêu cầu Chủ hệ thống: tránh phát sinh phí Claude API).

// Chỉ giữ video tiếng Việt: tiêu đề hoặc mô tả có chữ đặc trưng tiếng Việt (ă, â, đ, ê, ô, ơ, ư và dấu thanh),
// hoặc YouTube ghi ngôn ngữ âm thanh là tiếng Việt.
const VI_CHARS = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/gi;
export function isVietnamese(text, lang = '') {
  const t = String(text || '');
  if ((t.match(VI_CHARS) || []).length >= 3) return true;
  return /^vi\b/i.test(String(lang || ''));
}

// Lấy chi tiết (thời lượng, lượt xem) và lưu các video YouTube mới; chỉ lưu video tiếng Việt.
async function storeVideos(env, found, compOf, t, log) {
  const ids = [...found.keys()];
  const existing = new Set();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const { results } = await env.DB.prepare(`SELECT video_id FROM social_videos WHERE platform = 'youtube' AND video_id IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    results.forEach((r) => existing.add(r.video_id));
  }
  const newIds = ids.filter((id) => !existing.has(id));
  const added = []; let skippedLang = 0;
  for (let i = 0; i < newIds.length; i += 50) {
    let d;
    try { d = await yt(env, 'videos', { part: 'snippet,contentDetails,statistics', id: newIds.slice(i, i + 50).join(','), maxResults: '50' }); }
    catch (e) { log.push(`Chi tiết video: ${e.message}`); break; }
    for (const v of d.items || []) {
      const sn0 = v.snippet || {};
      if (!isVietnamese(`${sn0.title || ''} ${sn0.description || ''}`, sn0.defaultAudioLanguage || sn0.defaultLanguage)) { skippedLang++; continue; }
      const sec = isoSeconds(v.contentDetails?.duration);
      const kind = kindOf(sec);
      const sn = v.snippet || {}; const st = v.statistics || {};
      const row = {
        kind, video_id: v.id, url: kind === 'short' ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
        title: clean(sn.title, 300), channel: clean(sn.channelTitle, 120), channel_id: sn.channelId || null, description: String(sn.description || '').slice(0, 1500),
        thumb: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || null, published_at: sn.publishedAt ? Math.floor(Date.parse(sn.publishedAt) / 1000) : null,
        duration_s: sec, views: st.viewCount ? Number(st.viewCount) : null, likes: st.likeCount ? Number(st.likeCount) : null, comments: st.commentCount ? Number(st.commentCount) : null,
        keyword: found.get(v.id) || '', competitor_id: compOf.get(v.id) || null,
      };
      const r = await env.DB.prepare(`INSERT INTO social_videos (platform, kind, video_id, url, title, channel, channel_id, description, thumb, published_at, duration_s, views, likes, comments, keyword, competitor_id, first_seen_at, last_seen_at)
        VALUES ('youtube', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (platform, video_id) DO NOTHING RETURNING id`)
        .bind(row.kind, row.video_id, row.url, row.title, row.channel, row.channel_id, row.description, row.thumb, row.published_at, row.duration_s, row.views, row.likes, row.comments, row.keyword, row.competitor_id, t, t).first();
      if (r) added.push({ ...row, id: r.id });
    }
  }
  if (existing.size) {
    const seen = [...existing];
    for (let i = 0; i < seen.length; i += 50) {
      const part = seen.slice(i, i + 50);
      await env.DB.prepare(`UPDATE social_videos SET last_seen_at = ? WHERE platform = 'youtube' AND video_id IN (${part.map(() => '?').join(',')})`).bind(t, ...part).run();
    }
  }
  return { added, skippedLang, existing };
}

export async function runVideos(env, { userId = null } = {}) {
  if (!env.YOUTUBE_API_KEY) return { total: 0, log: ['Chưa có YOUTUBE_API_KEY'], skipped: true };
  const t = now();
  const keywords = (await keywordsOf(env)).slice(0, MAX_KEYWORDS);
  const after = new Date((t - DAYS_BACK * 86400) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const found = new Map(); const log = [];
  for (const kw of keywords) {
    try {
      const d = await yt(env, 'search', { part: 'snippet', type: 'video', q: kw, regionCode: 'VN', relevanceLanguage: 'vi', publishedAfter: after, order: 'relevance', maxResults: String(PER_KEYWORD) });
      let n = 0;
      for (const it of d.items || []) { const id = it.id?.videoId; if (id && !found.has(id)) { found.set(id, kw); n++; } }
      log.push(`${kw}: ${n} video`);
    } catch (e) { log.push(`${kw}: ${e.message}`); if (e.code === 'yt_quota' || e.code === 'yt_key') break; }
  }
  // Video nhắc tới đối thủ: tìm theo từ khóa của đối thủ, chỉ giữ video có tên đối thủ trong tiêu đề hoặc tên kênh.
  const compOf = new Map();
  const { results: comps } = await env.DB.prepare("SELECT id, name, keywords FROM social_competitors WHERE active = 1 AND keywords != '' ORDER BY id").all().catch(() => ({ results: [] }));
  for (const c of comps.slice(0, MAX_COMPETITOR_SEARCH)) {
    try {
      const d = await yt(env, 'search', { part: 'snippet', type: 'video', q: `"${c.keywords}"`, regionCode: 'VN', relevanceLanguage: 'vi', publishedAfter: after, order: 'date', maxResults: '8' });
      let n = 0;
      for (const it of d.items || []) {
        const id = it.id?.videoId;
        if (!id || !mentions({ title: `${it.snippet?.title || ''} ${it.snippet?.channelTitle || ''}`, summary: '' }, c)) continue;
        compOf.set(id, c.id); if (!found.has(id)) { found.set(id, c.keywords); n++; }
      }
      if (n) log.push(`Đối thủ ${c.name}: ${n} video`);
    } catch (e) { log.push(`Đối thủ ${c.name}: ${e.message}`); if (e.code === 'yt_quota' || e.code === 'yt_key') break; }
  }
  const { added, skippedLang } = await storeVideos(env, found, compOf, t, log);
  if (skippedLang) log.push(`Bỏ qua ${skippedLang} video không phải tiếng Việt`);
  // Ẩn video tự lấy trước đây mà không phải tiếng Việt (chỉ ẩn, không xóa).
  const { results: olds } = await env.DB.prepare("SELECT id, title, description FROM social_videos WHERE platform = 'youtube' AND source = 'auto' AND hidden = 0").all();
  const hideIds = olds.filter((r) => !isVietnamese(`${r.title} ${r.description}`)).map((r) => r.id);
  for (let i = 0; i < hideIds.length; i += 50) {
    const part = hideIds.slice(i, i + 50);
    await env.DB.prepare(`UPDATE social_videos SET hidden = 1 WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).run();
  }
  if (hideIds.length) log.push(`Ẩn ${hideIds.length} video cũ không phải tiếng Việt`);
  const ideas = 0;
  await putSetting(env, 'video_last_run', { at: t, added: added.length, ideas, log }, userId);
  return { total: added.length, ideas, log };
}

// GET /api/videos?kind=clip|short&keyword=&days=&sort=new|views&starred=1
export async function listVideos(request, env, user) {
  staffOnly(user);
  const q = new URL(request.url).searchParams;
  const days = Math.min(Math.max(Number(q.get('days')) || 14, 1), 365);
  const where = ['v.hidden = 0', 'COALESCE(v.published_at, v.first_seen_at) >= ?']; const args = [now() - days * 86400];
  if (['clip', 'short', 'reel'].includes(q.get('kind'))) { where.push('v.kind = ?'); args.push(q.get('kind')); }
  if (q.get('keyword')) { where.push('v.keyword = ?'); args.push(q.get('keyword')); }
  const text = (q.get('q') || '').trim().slice(0, 80);
  if (text) { where.push('(v.title LIKE ? OR v.channel LIKE ? OR v.note LIKE ? OR v.keyword LIKE ?)'); args.push(...Array(4).fill(`%${text}%`)); }
  if (q.get('competitor') === 'any') where.push('v.competitor_id IS NOT NULL');
  else if (q.get('competitor')) { where.push('v.competitor_id = ?'); args.push(Number(q.get('competitor'))); }
  if (q.get('starred') === '1') { where.push('v.starred = 1'); }
  const order = q.get('sort') === 'views' ? 'COALESCE(v.views, 0) DESC' : 'v.first_seen_at DESC, COALESCE(v.published_at, 0) DESC';
  const { results } = await env.DB.prepare(`SELECT v.id, v.platform, v.kind, v.video_id, v.url, v.title, v.channel, v.channel_id, v.thumb, v.published_at, v.duration_s, v.views, v.likes, v.comments, v.keyword, v.idea, v.note, v.source, v.starred, v.first_seen_at, v.competitor_id, c.name AS competitor_name
    FROM social_videos v LEFT JOIN social_competitors c ON c.id = v.competitor_id WHERE ${where.join(' AND ')} ORDER BY ${order}, v.id DESC LIMIT 200`).bind(...args).all();
  const { results: comps } = await env.DB.prepare('SELECT id, name FROM social_competitors WHERE active = 1 ORDER BY name').all();
  const { results: cnt } = await env.DB.prepare('SELECT kind, COUNT(*) AS n FROM social_videos WHERE hidden = 0 AND first_seen_at >= ? GROUP BY kind').bind(now() - 7 * 86400).all();
  return json({
    items: results.map((r) => ({ ...r, starred: !!r.starred })),
    keywords: await keywordsOf(env),
    competitors: comps,
    new7: Object.fromEntries(cnt.map((r) => [r.kind, r.n])),
    last_run: await getSetting(env, 'video_last_run', null),
    has_key: !!env.YOUTUBE_API_KEY,
    can_edit: user.role === 'owner' || user.role === 'manager',
  });
}

// PUT /api/videos/keywords { keywords: [] }
export async function saveKeywords(request, env, user) {
  requireRole(user, 'owner', 'manager');
  const body = await readJson(request);
  const list = [...new Set((Array.isArray(body.keywords) ? body.keywords : String(body.keywords || '').split(/[\n,]/)).map((k) => clean(k, 80)).filter((k) => k.length >= 2))].slice(0, MAX_KEYWORDS);
  if (!list.length) throw new HttpError(400, 'Vui lòng nhập ít nhất 1 từ khóa', 'bad_keywords');
  await putSetting(env, 'video_keywords', list, user.id);
  await audit(env, request, user.id, 'video_keywords_updated', list.join(', ').slice(0, 200));
  return json({ keywords: list });
}

// POST /api/videos/fetch
export async function fetchVideos(request, env, user) {
  requireRole(user, 'owner', 'manager');
  if (!env.YOUTUBE_API_KEY) throw new HttpError(409, 'Chưa có khóa YouTube. Vui lòng thêm biến bí mật YOUTUBE_API_KEY trong Cloudflare.', 'no_key');
  const r = await runVideos(env, { userId: user.id });
  await audit(env, request, user.id, 'videos_fetched', `${r.total} video mới`);
  return json(r);
}

const MAX_SEARCH_PER_DAY = 40; // mỗi lần tìm tốn 100 đơn vị trong hạn mức miễn phí 10.000 đơn vị/ngày của YouTube

// POST /api/videos/search { q }: tìm video YouTube tiếng Việt theo chữ người dùng gõ, lưu kết quả vào danh sách.
export async function searchVideos(request, env, user) {
  staffOnly(user);
  if (!env.YOUTUBE_API_KEY) throw new HttpError(409, 'Chưa có khóa YouTube. Vui lòng nhờ Chủ hệ thống thêm biến bí mật YOUTUBE_API_KEY trong Cloudflare.', 'no_key');
  const body = await readJson(request);
  const q = clean(body.q, 100);
  if (q.length < 2) throw new HttpError(400, 'Vui lòng nhập ít nhất 2 ký tự để tìm', 'bad_query');
  const t = now();
  const day = new Date((t + 7 * 3600) * 1000).toISOString().slice(0, 10);
  const used = Number(await getSetting(env, `video_search_count:${day}`, 0)) || 0;
  if (used >= MAX_SEARCH_PER_DAY) throw new HttpError(429, `Hôm nay đã tìm ${MAX_SEARCH_PER_DAY} lần, chạm giới hạn miễn phí. Vui lòng tìm lại vào ngày mai.`, 'search_limit');
  await putSetting(env, `video_search_count:${day}`, used + 1, user.id);
  const d = await yt(env, 'search', { part: 'snippet', type: 'video', q, regionCode: 'VN', relevanceLanguage: 'vi', order: 'relevance', maxResults: '25' });
  const found = new Map();
  for (const it of d.items || []) { const id = it.id?.videoId; if (id && !found.has(id)) found.set(id, q); }
  const log = [];
  const { added, skippedLang } = await storeVideos(env, found, new Map(), t, log);
  const ids = [...found.keys()];
  let items = [];
  if (ids.length) {
    const { results } = await env.DB.prepare(`SELECT v.id, v.platform, v.kind, v.video_id, v.url, v.title, v.channel, v.thumb, v.published_at, v.duration_s, v.views, v.keyword, v.idea, v.note, v.source, v.starred, v.first_seen_at, v.competitor_id, c.name AS competitor_name
      FROM social_videos v LEFT JOIN social_competitors c ON c.id = v.competitor_id WHERE v.platform = 'youtube' AND v.hidden = 0 AND v.video_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    const order = new Map(ids.map((id, i) => [id, i]));
    items = results.sort((x, y) => order.get(x.video_id) - order.get(y.video_id)).map((r) => ({ ...r, starred: !!r.starred }));
  }
  await audit(env, request, user.id, 'videos_searched', q, { added: added.length });
  return json({ q, items, added: added.length, skipped_lang: skippedLang, left: MAX_SEARCH_PER_DAY - used - 1 });
}

// PATCH /api/videos/:id { starred?, hidden? }
export async function updateVideo(request, env, user, id) {
  staffOnly(user);
  const v = await env.DB.prepare('SELECT id FROM social_videos WHERE id = ?').bind(Number(id)).first();
  if (!v) throw new HttpError(404, 'Không tìm thấy video', 'not_found');
  const body = await readJson(request);
  if (body.starred !== undefined) await env.DB.prepare('UPDATE social_videos SET starred = ? WHERE id = ?').bind(body.starred ? 1 : 0, v.id).run();
  if (body.hidden !== undefined) {
    if (!(user.role === 'owner' || user.role === 'manager')) throw new HttpError(403, 'Chỉ Quản lý ẩn được video', 'forbidden');
    await env.DB.prepare('UPDATE social_videos SET hidden = ? WHERE id = ?').bind(body.hidden ? 1 : 0, v.id).run();
  }
  return json({ ok: true });
}

// Nhận diện link video dán vào: YouTube (clip, Shorts), Reels Facebook, Instagram, TikTok.
export function parseVideoLink(raw) {
  const u = safeUrl(raw);
  const host = u.hostname.toLowerCase().replace(/^(www|m|web|vt|vm)\./, '');
  const path = u.pathname.replace(/\/+$/, '');
  if (host === 'youtube.com' || host === 'youtu.be') {
    const id = host === 'youtu.be' ? path.slice(1) : (path.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/) || [])[1] || u.searchParams.get('v');
    if (!/^[\w-]{6,20}$/.test(id || '')) throw new HttpError(400, 'Link YouTube chưa đúng (cần link một video cụ thể)', 'bad_video');
    const short = path.startsWith('/shorts/');
    return { platform: 'youtube', kind: short ? 'short' : 'clip', video_id: id, url: short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}` };
  }
  const plat = host === 'tiktok.com' ? 'tiktok' : host === 'instagram.com' ? 'instagram' : (host === 'facebook.com' || host === 'fb.watch' || host === 'fb.com') ? 'facebook' : null;
  if (!plat) throw new HttpError(400, 'Chỉ nhận link YouTube, Facebook Reels, Instagram Reels hoặc TikTok', 'bad_video');
  if (!path || path === '/') throw new HttpError(400, 'Vui lòng dán link của một video cụ thể', 'bad_video');
  const keep = plat === 'facebook' && u.searchParams.get('v') ? `?v=${u.searchParams.get('v')}` : '';
  const host2 = plat === 'tiktok' ? (u.hostname.startsWith('vt.') || u.hostname.startsWith('vm.') ? u.hostname : 'www.tiktok.com') : plat === 'instagram' ? 'www.instagram.com' : (host === 'fb.watch' ? 'fb.watch' : 'www.facebook.com');
  return { platform: plat, kind: 'reel', video_id: `${path}${keep}`.slice(0, 200), url: `https://${host2}${path}${keep}` };
}

// POST /api/videos { url, competitor_id?, note? }  (dán link Reels, TikTok hoặc YouTube)
export async function addVideo(request, env, user) {
  staffOnly(user);
  const body = await readJson(request);
  const link = parseVideoLink(body.url);
  const note = String(body.note ?? '').trim().slice(0, 3000);
  let compId = null;
  if (body.competitor_id) {
    const c = await env.DB.prepare('SELECT id FROM social_competitors WHERE id = ?').bind(Number(body.competitor_id)).first();
    if (!c) throw new HttpError(400, 'Đối thủ không hợp lệ', 'bad_competitor');
    compId = c.id;
  }
  const old = await env.DB.prepare('SELECT id FROM social_videos WHERE platform = ? AND video_id = ?').bind(link.platform, link.video_id).first();
  if (old) {
    await env.DB.prepare(`UPDATE social_videos SET hidden = 0${compId ? ', competitor_id = ?' : ''}${note ? ', note = ?' : ''} WHERE id = ?`).bind(...(compId ? [compId] : []), ...(note ? [note] : []), old.id).run();
    return json({ id: old.id, updated: true });
  }
  const t = now();
  const row = { ...link, title: clean(body.title, 300) || clean(note.split('\n')[0], 200) || `Video ${({ tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' })[link.platform]}`, channel: '', description: note, duration_s: null, views: null, thumb: null, published_at: null };
  if (link.platform === 'youtube' && env.YOUTUBE_API_KEY) {
    try {
      const d = await yt(env, 'videos', { part: 'snippet,contentDetails,statistics', id: link.video_id });
      const v = d.items?.[0];
      if (v) {
        row.duration_s = isoSeconds(v.contentDetails?.duration); row.kind = kindOf(row.duration_s);
        row.url = row.kind === 'short' ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`;
        row.title = clean(v.snippet?.title, 300) || row.title; row.channel = clean(v.snippet?.channelTitle, 120); row.description = note || String(v.snippet?.description || '').slice(0, 1500);
        row.thumb = v.snippet?.thumbnails?.medium?.url || null; row.views = v.statistics?.viewCount ? Number(v.statistics.viewCount) : null;
        row.published_at = v.snippet?.publishedAt ? Math.floor(Date.parse(v.snippet.publishedAt) / 1000) : null;
      }
    } catch { /* lưu link trước, thông tin để sau */ }
  }
  const r = await env.DB.prepare(`INSERT INTO social_videos (platform, kind, video_id, url, title, channel, description, thumb, published_at, duration_s, views, keyword, competitor_id, note, source, created_by, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, 'manual', ?, ?, ?) RETURNING id`)
    .bind(row.platform, row.kind, row.video_id, row.url, row.title, row.channel, row.description, row.thumb, row.published_at, row.duration_s, row.views, compId, note, user.id, t, t).first();
  const ideas = 0;
  await audit(env, request, user.id, 'video_added', row.url.slice(0, 200), { id: r.id });
  return json({ id: r.id, updated: false, kind: row.kind, ai: ideas > 0 }, 201);
}
