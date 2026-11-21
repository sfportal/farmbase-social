// Nguồn nội dung: thêm website (RSS, Atom, WordPress) và Fanpage đã kết nối, xem bài viết, bài đăng, video,
// rồi chọn để chia sẻ về Fanpage hoặc cho AI viết bài mới (luôn kèm dòng "Nguồn:"). Chỉ đọc nguồn, không ghi gì lên đó.
import { decryptSecret } from '../lib/crypto.js';
import { HttpError, json, readJson, now } from '../lib/http.js';
import { allowedPageIds } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { generate, aiProvider, PROVIDER_LABELS } from '../lib/ai.js';
import { graph } from './facebook.js';
import { getRules, systemPrompt, tidy, enforceStyle, LENGTHS } from './writing.js';

const UA = 'Mozilla/5.0 (compatible; FarmBaseSocial/1.0; +https://farmbase.vn)';
const MAX_SOURCES = 50;

function noAgent(user) {
  if (user.role === 'agent') throw new HttpError(403, 'Tài khoản Chăm sóc khách hàng không dùng mục này', 'forbidden');
}

// Chỉ cho địa chỉ web công khai (chặn localhost, IP nội bộ).
export function safeUrl(v, env) {
  let u;
  try { u = new URL(String(v || '').trim()); } catch { throw new HttpError(400, 'Địa chỉ website không hợp lệ', 'bad_url'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, 'Địa chỉ phải bắt đầu bằng https://', 'bad_url');
  const h = u.hostname.toLowerCase();
  if (env?.SOURCES_ALLOW_LOCAL === '1' && h === 'localhost') return u; // chỉ dùng khi chạy thử trên máy
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.includes(':') || !h.includes('.')) {
    throw new HttpError(400, 'Chỉ thêm được website công khai', 'bad_url');
  }
  return u;
}

async function fetchText(url, accept = 'text/html,application/xhtml+xml,application/xml,*/*') {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept }, redirect: 'follow', cf: { cacheTtl: 300 } });
  if (!res.ok) throw new HttpError(502, `Website trả lỗi ${res.status}`, 'fetch_failed');
  const text = await res.text();
  return { text: text.slice(0, 2_000_000), type: res.headers.get('content-type') || '', url: res.url || String(url) };
}

// ---------- Tin tức theo từ khóa (Bing News RSS: có liên kết gốc và ảnh, cập nhật liên tục) ----------
export const NEWS_DAYS = 15;
export function newsFeedUrl(env, keyword, site) {
  const q = site ? `${keyword} site:${site}` : keyword;
  return `${env.NEWS_SEARCH_BASE || 'https://www.bing.com'}/news/search?q=${encodeURIComponent(q)}&format=rss&cc=VN&setlang=vi`;
}
export function parseNews(xml, nowTs = Math.floor(Date.now() / 1000)) {
  const out = [];
  for (const b of xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []) {
    const link = decode(stripTags(tag(b, 'link')));
    let url = link;
    try { url = new URL(link).searchParams.get('url') || link; } catch { continue; }
    if (!/^https?:\/\//.test(url)) continue;
    const date = toTs(tag(b, 'pubDate'));
    if (date && date < nowTs - NEWS_DAYS * 86400) continue;
    const source = stripTags(decode(tag(b, 'News:Source')));
    out.push({
      title: stripTags(decode(tag(b, 'title'))), url, date,
      image: decode(stripTags(tag(b, 'News:Image'))) || null,
      summary: short(stripTags(decode(tag(b, 'description')))), type: 'article', publisher: source || null,
    });
  }
  return out.sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 40);
}

// ---------- Đọc RSS / Atom / WordPress ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
export const stripTags = (s) => decode(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i')); return m ? m[1] : ''; };
const attr = (block, re) => { const m = block.match(re); return m ? decode(m[1]) : ''; };
const firstImg = (html) => attr(decode(html), /<img[^>]+src=["']([^"']+)["']/i);
const toTs = (s) => { const t = Date.parse(decode(s).trim()); return Number.isFinite(t) ? Math.floor(t / 1000) : null; };
function short(s, n = 280) { return s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s; }

export function parseFeed(xml) {
  const items = [];
  const rss = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of rss) {
    const desc = tag(b, 'description'); const content = tag(b, 'content:encoded');
    items.push({
      title: stripTags(tag(b, 'title')), url: decode(stripTags(tag(b, 'link')) || attr(b, /<guid[^>]*>([^<]+)<\/guid>/i)).trim(),
      date: toTs(tag(b, 'pubDate') || tag(b, 'dc:date')),
      image: attr(b, /<media:(?:content|thumbnail)[^>]+url=["']([^"']+)["']/i) || attr(b, /<enclosure[^>]+url=["']([^"']+\.(?:jpe?g|png|webp|gif)[^"']*)["']/i) || firstImg(content || desc),
      summary: short(stripTags(desc || content)), type: 'article',
    });
  }
  const atom = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of atom) {
    const href = attr(b, /<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || attr(b, /<link[^>]+href=["']([^"']+)["']/i);
    const content = tag(b, 'content') || tag(b, 'summary');
    items.push({
      title: stripTags(tag(b, 'title')), url: href, date: toTs(tag(b, 'published') || tag(b, 'updated')),
      image: attr(b, /<media:thumbnail[^>]+url=["']([^"']+)["']/i) || firstImg(content), summary: short(stripTags(content)), type: 'article',
    });
  }
  return items.filter((i) => i.url && /^https?:\/\//.test(i.url)).slice(0, 30);
}

export function parseWp(list) {
  return (Array.isArray(list) ? list : []).map((p) => ({
    title: stripTags(p.title?.rendered), url: p.link, date: toTs(p.date_gmt ? `${p.date_gmt}Z` : p.date),
    image: p._embedded?.['wp:featuredmedia']?.[0]?.source_url || p.jetpack_featured_media_url || firstImg(p.content?.rendered || ''),
    summary: short(stripTags(p.excerpt?.rendered || p.content?.rendered)), type: 'article',
  })).filter((i) => i.url).slice(0, 30);
}

// Tìm nguồn đọc được của một website: thẻ RSS/Atom trong trang, đường dẫn feed phổ biến, hoặc WordPress REST.
async function discover(u) {
  const tried = [];
  const tryFeed = async (url) => {
    tried.push(url);
    try {
      const r = await fetchText(url, 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*');
      if (/<(rss|feed|rdf:RDF)[\s>]/i.test(r.text.slice(0, 2000)) && parseFeed(r.text).length) return { feed_url: r.url, feed_type: 'rss', title: stripTags(tag(r.text, 'title')) };
    } catch { /* thử cách khác */ }
    return null;
  };
  let page = null;
  try { page = await fetchText(u.toString()); } catch (e) { throw new HttpError(400, `Không mở được website: ${e.message}`, 'fetch_failed'); }
  if (/<(rss|feed)[\s>]/i.test(page.text.slice(0, 2000)) && parseFeed(page.text).length) return { feed_url: page.url, feed_type: 'rss', title: stripTags(tag(page.text, 'title')) };
  const siteTitle = stripTags(tag(page.text, 'title'));
  const links = [...page.text.matchAll(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)].map((m) => attr(m[0], /href=["']([^"']+)["']/i)).filter(Boolean);
  for (const l of links.slice(0, 3)) { const f = await tryFeed(new URL(l, page.url).toString()); if (f) return { ...f, title: siteTitle || f.title }; }
  try {
    const wp = new URL('/wp-json/wp/v2/posts?per_page=5', u.origin).toString();
    tried.push(wp);
    const r = await fetchText(wp, 'application/json');
    const list = JSON.parse(r.text);
    if (parseWp(list).length) return { feed_url: new URL('/wp-json/wp/v2/posts?per_page=20&_embed=1', u.origin).toString(), feed_type: 'wp', title: siteTitle };
  } catch { /* không phải WordPress */ }
  for (const p of ['/feed', '/rss', '/rss.xml', '/feed.xml', '/feed.rss', '/home.rss', '/atom.xml', '/index.xml']) { const f = await tryFeed(new URL(p, u.origin).toString()); if (f) return { ...f, title: siteTitle || f.title }; }
  throw new HttpError(400, 'Website này chưa có RSS hoặc dữ liệu bài viết công khai để đọc. Quý khách thử dán địa chỉ trang RSS (thường là /feed hoặc /rss) của website.', 'no_feed');
}

async function loadSource(env, user, id) {
  const s = await env.DB.prepare('SELECT * FROM social_sources WHERE id = ?').bind(Number(id)).first();
  if (!s) throw new HttpError(404, 'Không tìm thấy nguồn', 'not_found');
  if (s.kind === 'fanpage' && !(await allowedPageIds(env, user)).includes(s.page_id)) throw new HttpError(404, 'Không tìm thấy nguồn', 'not_found');
  return s;
}

// GET /api/sources
export async function listSources(request, env, user) {
  noAgent(user);
  const allowed = await allowedPageIds(env, user);
  const { results } = await env.DB.prepare('SELECT s.*, p.name AS page_name, p.picture_url FROM social_sources s LEFT JOIN social_pages p ON p.id = s.page_id ORDER BY s.created_at DESC').all();
  const sources = results.filter((s) => s.kind === 'website' || allowed.includes(s.page_id))
    .map((s) => ({ id: s.id, kind: s.feed_type === 'news' ? 'news' : s.kind, name: s.name, url: s.url, page_id: s.page_id, picture: s.picture_url || null, created_at: s.created_at }));
  return json({ sources, ai_provider: PROVIDER_LABELS[aiProvider(env)] || null });
}

// POST /api/sources { kind: website, url } | { kind: fanpage, page_id }
export async function createSource(request, env, user) {
  noAgent(user);
  const body = await readJson(request);
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM social_sources').first();
  if (count.n >= MAX_SOURCES) throw new HttpError(400, `Tối đa ${MAX_SOURCES} nguồn`, 'too_many');
  const t = now();
  let row;
  if (body.kind === 'fanpage') {
    const pageId = String(body.page_id || '');
    if (!(await allowedPageIds(env, user)).includes(pageId)) throw new HttpError(400, 'Chỉ thêm được Fanpage đã kết nối và được giao cho Quý khách', 'bad_page');
    const page = await env.DB.prepare('SELECT name FROM social_pages WHERE id = ?').bind(pageId).first();
    const dup = await env.DB.prepare("SELECT id FROM social_sources WHERE kind = 'fanpage' AND page_id = ?").bind(pageId).first();
    if (dup) throw new HttpError(409, 'Fanpage này đã có trong danh sách nguồn', 'duplicate');
    row = await env.DB.prepare("INSERT INTO social_sources (kind, name, page_id, created_by, created_at) VALUES ('fanpage', ?, ?, ?, ?) RETURNING id")
      .bind(page.name, pageId, user.id, t).first();
  } else if (body.kind === 'website') {
    const u = safeUrl(body.url, env);
    if (/(^|\.)facebook\.com$|(^|\.)fb\.com$/.test(u.hostname)) throw new HttpError(400, 'Facebook chỉ cho đọc bài của Fanpage Quý khách quản lý. Vui lòng kết nối Fanpage đó ở mục Fanpage rồi chọn loại nguồn "Fanpage".', 'facebook_url');
    const dup = await env.DB.prepare("SELECT id FROM social_sources WHERE kind = 'website' AND url = ?").bind(u.toString()).first();
    if (dup) throw new HttpError(409, 'Website này đã có trong danh sách nguồn', 'duplicate');
    const f = await discover(u);
    const name = (typeof body.name === 'string' && body.name.trim()) || f.title || u.hostname;
    row = await env.DB.prepare("INSERT INTO social_sources (kind, name, url, feed_url, feed_type, created_by, created_at) VALUES ('website', ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(name.slice(0, 120), u.toString(), f.feed_url, f.feed_type, user.id, t).first();
  } else if (body.kind === 'news') {
    const keyword = String(body.keyword || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (keyword.length < 2) throw new HttpError(400, 'Vui lòng nhập từ khóa', 'bad_keyword');
    let site = String(body.site || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (site && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(site)) throw new HttpError(400, 'Tên báo, website không hợp lệ (ví dụ nongnghiepmoitruong.vn)', 'bad_site');
    const feed = newsFeedUrl(env, keyword, site);
    const dup = await env.DB.prepare("SELECT id FROM social_sources WHERE feed_type = 'news' AND feed_url = ?").bind(feed).first();
    if (dup) throw new HttpError(409, 'Từ khóa này đã có trong danh sách nguồn', 'duplicate');
    const name = `${keyword}${site ? ` (${site})` : ''}`;
    row = await env.DB.prepare("INSERT INTO social_sources (kind, name, url, feed_url, feed_type, created_by, created_at) VALUES ('website', ?, ?, ?, 'news', ?, ?) RETURNING id")
      .bind(name, site ? `https://${site}` : null, feed, user.id, t).first();
  } else throw new HttpError(400, 'Loại nguồn không hợp lệ', 'bad_kind');
  await audit(env, request, user.id, 'source_added', body.kind === 'website' ? String(body.url).slice(0, 120) : body.kind === 'news' ? `Từ khóa: ${String(body.keyword).slice(0, 100)}` : String(body.page_id), { id: row.id });
  return json({ id: row.id }, 201);
}

// DELETE /api/sources/:id (chỉ xóa khỏi danh sách nguồn của hệ thống)
export async function deleteSource(request, env, user, id) {
  noAgent(user);
  const s = await loadSource(env, user, id);
  await env.DB.prepare('DELETE FROM social_sources WHERE id = ?').bind(s.id).run();
  await audit(env, request, user.id, 'source_removed', s.name, { id: s.id });
  return json({ ok: true });
}

// GET /api/sources/:id/items : bài viết (website), bài đăng và video (Fanpage)
export async function sourceItems(request, env, user, id) {
  noAgent(user);
  const s = await loadSource(env, user, id);
  let items = [];
  if (s.kind === 'website') {
    const r = await fetchText(s.feed_url, s.feed_type === 'wp' ? 'application/json' : 'application/rss+xml,application/xml,*/*');
    items = s.feed_type === 'wp' ? parseWp(JSON.parse(r.text)) : s.feed_type === 'news' ? parseNews(r.text) : parseFeed(r.text);
  } else {
    const page = await env.DB.prepare('SELECT access_token_enc, status FROM social_pages WHERE id = ?').bind(s.page_id).first();
    if (!page?.access_token_enc || page.status === 'disconnected') throw new HttpError(409, 'Fanpage chưa kết nối, vui lòng kết nối lại', 'no_token');
    const token = await decryptSecret(page.access_token_enc, env.TOKEN_KEY);
    const [posts, videos] = await Promise.allSettled([
      graph(env, `${s.page_id}/posts`, { access_token: token, limit: '25', fields: 'id,message,created_time,permalink_url,full_picture,status_type' }),
      graph(env, `${s.page_id}/videos`, { access_token: token, limit: '15', fields: 'id,title,description,created_time,permalink_url,picture' }),
    ]);
    if (posts.status === 'rejected' && videos.status === 'rejected') throw posts.reason;
    const vids = videos.status === 'fulfilled' ? (videos.value.data || []) : [];
    const vidLinks = new Set();
    for (const v of vids) {
      const url = v.permalink_url ? (v.permalink_url.startsWith('http') ? v.permalink_url : `https://www.facebook.com${v.permalink_url}`) : `https://www.facebook.com/${v.id}`;
      vidLinks.add(url);
      const text = v.description || v.title || '';
      items.push({ title: short(v.title || text.split('\n')[0] || 'Video', 120), url, date: toTs(v.created_time), image: v.picture || null, summary: short(text), type: 'video' });
    }
    for (const p of posts.status === 'fulfilled' ? (posts.value.data || []) : []) {
      if (vidLinks.has(p.permalink_url)) continue;
      const text = p.message || '';
      items.push({ title: short(text.split('\n')[0] || 'Bài đăng', 120), url: p.permalink_url || `https://www.facebook.com/${p.id}`, date: toTs(p.created_time), image: p.full_picture || null, summary: short(text), type: /video/.test(p.status_type || '') ? 'video' : 'post' });
    }
    items.sort((a, b) => (b.date || 0) - (a.date || 0));
  }
  return json({ source: { id: s.id, kind: s.feed_type === 'news' ? 'news' : s.kind, name: s.name, url: s.url }, items });
}

// POST /api/sources/write { url, title, summary, mode: share|rewrite, length, page_ids }
// share: viết lời giới thiệu ngắn kèm liên kết; rewrite: đọc bài gốc rồi viết bài mới, cuối bài luôn có "Nguồn: <link>".
export async function writeFromSource(request, env, user) {
  noAgent(user);
  const body = await readJson(request);
  const u = safeUrl(body.url, env);
  const mode = body.mode === 'rewrite' ? 'rewrite' : 'share';
  const title = String(body.title || '').slice(0, 300);
  let source = String(body.summary || '').slice(0, 1500);
  const isFacebook = /(^|\.)facebook\.com$/.test(u.hostname);
  if (mode === 'rewrite' && !isFacebook) {
    try {
      const page = await fetchText(u.toString());
      const main = tag(page.text, 'article') || tag(page.text, 'main') || page.text;
      const text = stripTags(main);
      if (text.length > 200) source = text.slice(0, 6000);
    } catch { /* dùng tóm tắt sẵn có */ }
  }
  let pageNames = [];
  if (Array.isArray(body.page_ids) && body.page_ids.length) {
    const allowed = await allowedPageIds(env, user);
    const ids = body.page_ids.map(String).filter((p) => allowed.includes(p)).slice(0, 20);
    if (ids.length) pageNames = (await env.DB.prepare(`SELECT name FROM social_pages WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results.map((r) => r.name);
  }
  const length = LENGTHS[body.length] || LENGTHS.vua;
  const st = await getRules(env);
  const rules = st.value;
  const prompt = mode === 'share'
    ? `Viết lời giới thiệu ngắn (2 đến 4 câu) để chia sẻ bài dưới đây lên Fanpage, khơi gợi người đọc bấm vào xem. Không chép nguyên văn, không thêm thông tin ngoài nội dung.\n\nTiêu đề: ${title}\nNội dung tóm tắt: ${source}`
    : `Dựa trên bài gốc dưới đây, viết một bài đăng Facebook mới, độ dài ${length}, bằng lời văn của doanh nghiệp. Diễn đạt lại, không chép nguyên câu dài của bài gốc, chỉ dùng thông tin có trong bài gốc.\n\nTiêu đề bài gốc: ${title}\nNội dung bài gốc:\n${source}`;
  const { text, provider } = await generate(env, { system: systemPrompt(rules, pageNames, st), prompt, maxTokens: 1200 });
  // Bài viết lại từ nguồn ngoài luôn ghi nguồn (quy định nội dung); liên hệ và hashtag theo quy định đăng bài.
  const srcLine = mode === 'rewrite' ? u.toString() : '';
  let out = enforceStyle(tidy(text), { rules, contact: st.contact, hashtags: st.hashtags, source: srcLine }).slice(0, 4800);
  const bodyText = enforceStyle(tidy(text), { rules, strip: true, source: srcLine }).slice(0, 4800);
  if (!out) throw new HttpError(502, 'AI chưa trả về nội dung, vui lòng thử lại', 'ai_empty');
  await audit(env, request, user.id, 'ai_written', `${mode === 'share' ? 'Chia sẻ' : 'Viết lại'}: ${title.slice(0, 70)}`, { url: u.toString() });
  return json({ text: out, body: bodyText, link: mode === 'share' ? u.toString() : null, provider: PROVIDER_LABELS[provider] });
}
