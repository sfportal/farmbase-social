// Báo cáo hiệu quả Fanpage theo ngày: tin nhắn, bình luận, khách mới, trả lời, thời gian phản hồi (từ hộp thư),
// bài đăng và tương tác (từ bài viết), lượt xem, tương tác, người theo dõi mới (Page Insights, cần quyền read_insights).
// Chỉ đọc. Quyền: Fanpage được giao.
import { decryptSecret } from '../lib/crypto.js';
import { HttpError, json } from '../lib/http.js';
import { allowedPageIds } from '../lib/auth.js';
import { graph } from './facebook.js';

const TZ = 7 * 3600; // giờ Việt Nam
const DAY = 86400;
export const REPORT_DAYS = [7, 15, 30, 90];
// Chỉ số Page Insights thử lấy từng cái (Facebook đổi, bỏ chỉ số theo phiên bản; cái nào lỗi thì bỏ qua).
export const INSIGHT_METRICS = {
  page_post_engagements: 'Tương tác với nội dung',
  page_impressions_unique: 'Người tiếp cận',
  page_media_view: 'Lượt xem nội dung',
  page_views_total: 'Lượt xem Trang',
  page_total_actions: 'Lượt nhấp nút liên hệ trên Trang',
  page_daily_follows_unique: 'Người theo dõi mới',
  page_daily_unfollows_unique: 'Người bỏ theo dõi',
};

const dayKey = (ts) => new Date((ts + TZ) * 1000).toISOString().slice(0, 10);

function emptyDay(date) {
  return { date, messages_in: 0, comments_in: 0, new_chats: 0, new_commenters: 0, replies: 0, auto_replies: 0, posts: 0, reactions: 0, post_comments: 0, shares: 0, insights: {} };
}

// Thời gian phản hồi: từ tin đầu tiên của khách (chưa được trả lời) tới tin trả lời đầu tiên của Trang trong cùng cuộc trò chuyện.
function responseTimes(rows) {
  const waiting = new Map();
  const out = [];
  for (const m of rows) {
    if (m.direction === 'in') { if (!waiting.has(m.conversation_id)) waiting.set(m.conversation_id, m.created_at); }
    else if (waiting.has(m.conversation_id)) {
      const d = m.created_at - waiting.get(m.conversation_id);
      waiting.delete(m.conversation_id);
      if (d >= 0 && d <= DAY) out.push({ at: m.created_at, secs: d, auto: !!m.auto });
    }
  }
  return { times: out, unanswered: waiting.size };
}

async function inboxStats(env, pageId, from, to) {
  const { results: msgs } = await env.DB.prepare(
    `SELECT m.conversation_id, m.direction, m.channel, m.auto, m.created_at, c.kind FROM social_messages m
     JOIN social_conversations c ON c.id = m.conversation_id
     WHERE c.page_id = ? AND m.created_at >= ? AND m.created_at < ? ORDER BY m.created_at, m.id LIMIT 20000`
  ).bind(pageId, from, to).all();
  const { results: convs } = await env.DB.prepare(
    'SELECT kind, created_at FROM social_conversations WHERE page_id = ? AND created_at >= ? AND created_at < ?'
  ).bind(pageId, from, to).all();
  return { msgs, convs };
}

function summarizeInbox({ msgs, convs }) {
  const s = { messages_in: 0, comments_in: 0, new_chats: 0, new_commenters: 0, replies: 0, auto_replies: 0 };
  for (const m of msgs) {
    if (m.direction === 'in') { if (m.channel === 'comment') s.comments_in++; else s.messages_in++; }
    else { s.replies++; if (m.auto) s.auto_replies++; }
  }
  for (const c of convs) { if (c.kind === 'message') s.new_chats++; else s.new_commenters++; }
  const rt = responseTimes(msgs.filter((m) => m.kind === 'message'));
  const manual = rt.times.filter((x) => !x.auto).map((x) => x.secs).sort((a, b) => a - b);
  s.answered = rt.times.length;
  s.unanswered = rt.unanswered;
  s.median_response_secs = manual.length ? manual[Math.floor(manual.length / 2)] : null;
  return s;
}

async function postsSince(env, pageId, token, since) {
  const out = [];
  let params = {
    access_token: token, since: String(since), limit: '100',
    fields: 'id,created_time,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).filter(stream).limit(0)',
  };
  for (let i = 0; i < 3; i++) {
    const d = await graph(env, `${pageId}/posts`, params);
    out.push(...(d.data || []));
    const after = d.paging?.next ? d.paging?.cursors?.after : null;
    if (!after) break;
    params = { ...params, after };
  }
  return out;
}

async function insight(env, pageId, token, metric, since, until) {
  const d = await graph(env, `${pageId}/insights`, { access_token: token, metric, period: 'day', since: String(since), until: String(until) });
  const values = d.data?.[0]?.values || [];
  // end_time là cuối ngày theo giờ của Facebook: ngày của số liệu là ngày trước end_time.
  return values.map((v) => ({ date: dayKey(Math.floor(Date.parse(v.end_time) / 1000) - DAY), value: typeof v.value === 'number' ? v.value : Number(v.value) || 0 }));
}

// GET /api/report?page_id=&days=30
export async function pageReport(request, env, user) {
  const q = new URL(request.url).searchParams;
  const days = Number(q.get('days') || 30);
  if (!REPORT_DAYS.includes(days)) throw new HttpError(400, 'Khoảng thời gian không hợp lệ', 'bad_days');
  const pageId = q.get('page_id') || '';
  const allowed = await allowedPageIds(env, user);
  if (!allowed.includes(pageId)) throw new HttpError(404, 'Không tìm thấy Fanpage', 'not_found');
  const page = await env.DB.prepare('SELECT id, name, access_token_enc, status FROM social_pages WHERE id = ?').bind(pageId).first();
  if (!page) throw new HttpError(404, 'Không tìm thấy Fanpage', 'not_found');

  // Khoảng: từ 0 giờ (giờ Việt Nam) của ngày đầu tới hết hôm nay; kỳ trước dài bằng kỳ này, liền trước.
  const nowTs = Math.floor(Date.now() / 1000);
  const todayStart = Math.floor((nowTs + TZ) / DAY) * DAY - TZ;
  const from = todayStart - (days - 1) * DAY;
  const to = todayStart + DAY;
  const prevFrom = from - days * DAY;

  const list = [];
  const byDate = new Map();
  for (let t = from; t < to; t += DAY) { const d = emptyDay(dayKey(t)); list.push(d); byDate.set(d.date, d); }

  // 1. Hộp thư (lưu trong hệ thống từ khi bật webhook).
  const cur = await inboxStats(env, pageId, from, to);
  const prev = await inboxStats(env, pageId, prevFrom, from);
  for (const m of cur.msgs) {
    const d = byDate.get(dayKey(m.created_at)); if (!d) continue;
    if (m.direction === 'in') { if (m.channel === 'comment') d.comments_in++; else d.messages_in++; }
    else { d.replies++; if (m.auto) d.auto_replies++; }
  }
  for (const c of cur.convs) { const d = byDate.get(dayKey(c.created_at)); if (d) { if (c.kind === 'message') d.new_chats++; else d.new_commenters++; } }
  const first = await env.DB.prepare(
    'SELECT MIN(m.created_at) AS t FROM social_messages m JOIN social_conversations c ON c.id = m.conversation_id WHERE c.page_id = ?'
  ).bind(pageId).first();

  // 2. Bài đăng và 3. Page Insights (lỗi thì báo, không chặn báo cáo).
  const errors = [];
  const metrics = {};
  let postTotals = null;
  if (page.access_token_enc && page.status !== 'disconnected') {
    const token = await decryptSecret(page.access_token_enc, env.TOKEN_KEY);
    const span = days <= 30 ? prevFrom : from; // Facebook cho tối đa khoảng 90 ngày mỗi lần
    const [posts, ...ins] = await Promise.allSettled([
      postsSince(env, pageId, token, from),
      ...Object.keys(INSIGHT_METRICS).map((m) => insight(env, pageId, token, m, span, to)),
    ]);
    if (posts.status === 'fulfilled') {
      postTotals = { posts: 0, reactions: 0, post_comments: 0, shares: 0 };
      for (const p of posts.value) {
        const d = byDate.get(dayKey(Math.floor(Date.parse(p.created_time) / 1000))); if (!d) continue;
        const r = p.reactions?.summary?.total_count ?? 0; const c = p.comments?.summary?.total_count ?? 0; const s = p.shares?.count ?? 0;
        d.posts++; d.reactions += r; d.post_comments += c; d.shares += s;
        postTotals.posts++; postTotals.reactions += r; postTotals.post_comments += c; postTotals.shares += s;
      }
    } else errors.push({ source: 'posts', message: posts.reason?.message || 'Lỗi' });
    const fromKey = dayKey(from);
    Object.keys(INSIGHT_METRICS).forEach((m, i) => {
      const r = ins[i];
      if (r.status !== 'fulfilled') { errors.push({ source: m, message: r.reason?.message || 'Lỗi' }); return; }
      // Không có giá trị nào (chưa cấp quyền read_insights hoặc Trang chưa đủ điều kiện có thống kê): coi như chưa có, không hiện số 0.
      if (!r.value.length) { errors.push({ source: m, message: 'Facebook chưa trả số liệu' }); return; }
      let total = 0; let prevTotal = 0;
      for (const v of r.value) {
        if (v.date >= fromKey) { const d = byDate.get(v.date); if (d) { d.insights[m] = v.value; total += v.value; } }
        else prevTotal += v.value;
      }
      metrics[m] = { label: INSIGHT_METRICS[m], total, prev: days <= 30 ? prevTotal : null };
    });
  } else errors.push({ source: 'page', message: 'Fanpage chưa kết nối hoặc đã ngắt' });

  return json({
    page: { id: page.id, name: page.name },
    days,
    from: dayKey(from),
    to: dayKey(to - 1),
    inbox_since: first?.t || null,
    daily: list,
    inbox: summarizeInbox(cur),
    inbox_prev: summarizeInbox(prev),
    posts: postTotals,
    metrics,
    errors,
  });
}
