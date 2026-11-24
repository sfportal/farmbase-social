// Kho chủ đề theo Fanpage: chủ đề → chủ đề con (hook, thông điệp, CTA, dữ kiện, hình/video, prompt, storyboard, ads),
// kho kiến thức (tài liệu, tin tức, góp ý) và đề xuất cập nhật chủ đề do AI đưa ra.
import { HttpError, json, readJson, now } from '../lib/http.js';
import { allowedPageIds, requireRole } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { generate, parseJson, aiProvider, PROVIDER_LABELS } from '../lib/ai.js';
import { TEMPLATES, templateFor } from '../lib/topic-templates.js';

export const TOPIC_FIELDS = { title: 160, goal: 400, audience: 300, hook: 600, message: 800, cta: 300, facts: 3000, ideas: 1500, formats: 300, visual: 800, prompt_ids: 200, storyboard_id: 60, ads: 800, keywords: 300 };
const MAX_TOPICS = 200;
const MAX_KNOWLEDGE_BODY = 20000;
const canEdit = (u) => ['owner', 'manager', 'editor'].includes(u.role);

async function pageFor(env, user, pageId) {
  if (user.role === 'agent') throw new HttpError(403, 'Tài khoản Chăm sóc khách hàng không dùng mục này', 'forbidden');
  const id = String(pageId || '');
  if (!(await allowedPageIds(env, user)).includes(id)) throw new HttpError(404, 'Không tìm thấy Fanpage', 'not_found');
  return env.DB.prepare('SELECT id, name, picture_url FROM social_pages WHERE id = ?').bind(id).first();
}

function cleanTopic(body, partial = false) {
  const out = {};
  for (const [k, max] of Object.entries(TOPIC_FIELDS)) {
    if (body[k] === undefined) { if (!partial) out[k] = ''; continue; }
    out[k] = String(body[k] ?? '').trim().slice(0, max);
  }
  if (out.prompt_ids !== undefined) out.prompt_ids = out.prompt_ids.split(/[\s,;]+/).filter((x) => /^[a-z]{2}-\d{2}$/.test(x)).slice(0, 8).join(',');
  if (out.storyboard_id !== undefined) out.storyboard_id = /^[a-z0-9-]{0,60}$/.test(out.storyboard_id) ? out.storyboard_id : '';
  if (!partial && !out.title) throw new HttpError(400, 'Vui lòng nhập tên chủ đề', 'empty');
  if (partial && out.title === '') throw new HttpError(400, 'Vui lòng nhập tên chủ đề', 'empty');
  if (body.share !== undefined) out.share = Math.max(0, Math.min(100, Math.round(Number(body.share) || 0)));
  if (body.status !== undefined) out.status = body.status === 'paused' ? 'paused' : 'active';
  if (body.sort !== undefined) out.sort = Math.round(Number(body.sort) || 0);
  return out;
}

// Hồ sơ Fanpage: mô tả ngắn, đối tượng, giọng văn, điều bắt buộc. AI đọc trước mọi bài.
export async function getBrief(env, pageId) {
  const r = await env.DB.prepare('SELECT value FROM social_settings WHERE key = ?').bind(`page_brief:${pageId}`).first();
  return r?.value || '';
}
async function setBrief(env, pageId, value, userId) {
  await env.DB.prepare('INSERT INTO social_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
    .bind(`page_brief:${pageId}`, value, userId ?? null, now()).run();
}

// Nạp bộ mẫu cho một Trang (một lần câu lệnh gộp để tiết kiệm số truy vấn D1).
export async function seedTemplate(env, pageId, key, userId = null) {
  const tpl = TEMPLATES[key];
  if (!tpl) throw new HttpError(400, 'Không có bộ mẫu này', 'bad_template');
  const t = now();
  let sort = 0;
  for (const top of tpl.topics) {
    const parent = await env.DB.prepare(
      'INSERT INTO social_topics (page_id, parent_id, title, goal, audience, message, share, sort, created_by, created_at, updated_at) VALUES (?,NULL,?,?,?,?,?,?,?,?,?) RETURNING id'
    ).bind(pageId, top.title, top.goal || '', top.audience || '', top.message || '', top.share || 0, sort++, userId, t, t).first();
    const keys = Object.keys(TOPIC_FIELDS);
    const stmts = (top.children || []).map((c, i) => env.DB.prepare(
      `INSERT INTO social_topics (page_id, parent_id, ${keys.join(', ')}, sort, created_by, created_at, updated_at) VALUES (?,?,${keys.map(() => '?').join(',')},?,?,?,?)`
    ).bind(pageId, parent.id, ...keys.map((k) => String(c[k] || '').slice(0, TOPIC_FIELDS[k])), i, userId, t, t));
    if (stmts.length) await env.DB.batch(stmts);
  }
  if (!(await getBrief(env, pageId))) await setBrief(env, pageId, tpl.brief, userId);
  await env.DB.prepare("INSERT INTO social_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(`topic_seeded:${pageId}`, key, t).run();
}

export async function loadTopics(env, pageId) {
  const { results } = await env.DB.prepare('SELECT * FROM social_topics WHERE page_id = ? ORDER BY parent_id IS NOT NULL, sort, id').bind(pageId).all();
  const tops = results.filter((r) => !r.parent_id).map((r) => ({ ...r, children: [] }));
  const byId = Object.fromEntries(tops.map((r) => [r.id, r]));
  for (const r of results) if (r.parent_id && byId[r.parent_id]) byId[r.parent_id].children.push(r);
  return tops;
}

// GET /api/topics?page_id=  (Trang chưa có chủ đề và tên khớp bộ mẫu thì tự nạp bộ mẫu một lần)
export async function listTopics(request, env, user) {
  const page = await pageFor(env, user, new URL(request.url).searchParams.get('page_id'));
  const has = await env.DB.prepare('SELECT COUNT(*) AS n FROM social_topics WHERE page_id = ?').bind(page.id).first();
  let seeded = null;
  if (!has.n && canEdit(user)) {
    const done = await env.DB.prepare('SELECT value FROM social_settings WHERE key = ?').bind(`topic_seeded:${page.id}`).first();
    const key = templateFor(page.name);
    if (!done && key) { await seedTemplate(env, page.id, key, user.id); seeded = key; await audit(env, request, user.id, 'topics_seeded', page.name, { template: key }); }
  }
  const [topics, brief, sugg] = await Promise.all([
    loadTopics(env, page.id), getBrief(env, page.id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM social_topic_suggestions WHERE page_id = ? AND status = 'pending'").bind(page.id).first(),
  ]);
  return json({ page, topics, brief, seeded, templates: Object.entries(TEMPLATES).map(([k, v]) => ({ key: k, name: v.name })), suggested_template: templateFor(page.name), pending_suggestions: sugg.n, can_edit: canEdit(user), ai_provider: PROVIDER_LABELS[aiProvider(env)] || null });
}

// POST /api/topics { page_id, parent_id?, ...fields }
export async function createTopic(request, env, user) {
  if (!canEdit(user)) throw new HttpError(403, 'Không có quyền sửa chủ đề', 'forbidden');
  const body = await readJson(request);
  const page = await pageFor(env, user, body.page_id);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM social_topics WHERE page_id = ?').bind(page.id).first();
  if (n.n >= MAX_TOPICS) throw new HttpError(400, `Mỗi Trang tối đa ${MAX_TOPICS} chủ đề`, 'too_many');
  let parentId = null;
  if (body.parent_id) {
    const p = await env.DB.prepare('SELECT id, parent_id FROM social_topics WHERE id = ? AND page_id = ?').bind(Number(body.parent_id), page.id).first();
    if (!p || p.parent_id) throw new HttpError(400, 'Chủ đề cha không hợp lệ', 'bad_parent');
    parentId = p.id;
  }
  const f = cleanTopic(body);
  const t = now();
  const keys = Object.keys(TOPIC_FIELDS);
  const row = await env.DB.prepare(
    `INSERT INTO social_topics (page_id, parent_id, ${keys.join(', ')}, share, sort, created_by, created_at, updated_at) VALUES (?,?,${keys.map(() => '?').join(',')},?,?,?,?,?) RETURNING id`
  ).bind(page.id, parentId, ...keys.map((k) => f[k]), f.share || 0, f.sort ?? 999, user.id, t, t).first();
  await audit(env, request, user.id, 'topic_created', f.title.slice(0, 80), { id: row.id, page_id: page.id });
  return json({ id: row.id }, 201);
}

async function loadTopic(env, user, id) {
  const row = await env.DB.prepare('SELECT * FROM social_topics WHERE id = ?').bind(Number(id)).first();
  if (!row || !(await allowedPageIds(env, user)).includes(row.page_id)) throw new HttpError(404, 'Không tìm thấy chủ đề', 'not_found');
  return row;
}

// PATCH /api/topics/:id
export async function updateTopic(request, env, user, id) {
  if (!canEdit(user)) throw new HttpError(403, 'Không có quyền sửa chủ đề', 'forbidden');
  const row = await loadTopic(env, user, id);
  const f = cleanTopic(await readJson(request), true);
  const keys = Object.keys(f);
  if (!keys.length) return json({ ok: true });
  await env.DB.prepare(`UPDATE social_topics SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(...keys.map((k) => f[k]), now(), row.id).run();
  await audit(env, request, user.id, 'topic_updated', (f.title || row.title).slice(0, 80), { id: row.id });
  return json({ ok: true });
}

// DELETE /api/topics/:id (xóa cả chủ đề con; bài đã soạn vẫn giữ)
export async function deleteTopic(request, env, user, id) {
  requireRole(user, 'owner', 'manager');
  const row = await loadTopic(env, user, id);
  await env.DB.batch([
    env.DB.prepare('UPDATE social_content SET topic_id = NULL WHERE topic_id IN (SELECT id FROM social_topics WHERE id = ? OR parent_id = ?)').bind(row.id, row.id),
    env.DB.prepare('UPDATE social_media SET topic_id = NULL WHERE topic_id IN (SELECT id FROM social_topics WHERE id = ? OR parent_id = ?)').bind(row.id, row.id),
    env.DB.prepare('DELETE FROM social_topic_suggestions WHERE topic_id IN (SELECT id FROM social_topics WHERE id = ? OR parent_id = ?) OR parent_id = ?').bind(row.id, row.id, row.id),
    env.DB.prepare('DELETE FROM social_topics WHERE parent_id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM social_topics WHERE id = ?').bind(row.id),
  ]);
  await audit(env, request, user.id, 'topic_deleted', row.title.slice(0, 80), { id: row.id });
  return json({ ok: true });
}

// POST /api/topics/seed { page_id, template }
export async function seedTopics(request, env, user) {
  requireRole(user, 'owner', 'manager');
  const body = await readJson(request);
  const page = await pageFor(env, user, body.page_id);
  const key = String(body.template || '');
  if (!TEMPLATES[key]) throw new HttpError(400, 'Không có bộ mẫu này', 'bad_template');
  if (body.replace === true) {
    // Thay bộ mẫu: xóa chủ đề cũ của Trang (bài đã soạn giữ nguyên, chỉ bỏ liên kết chủ đề) và thay Hồ sơ Fanpage.
    await env.DB.prepare('UPDATE social_content SET topic_id = NULL WHERE page_id = ? AND topic_id IS NOT NULL').bind(page.id).run();
    await env.DB.prepare('UPDATE social_media SET topic_id = NULL WHERE page_id = ? AND topic_id IS NOT NULL').bind(page.id).run();
    await env.DB.prepare('DELETE FROM social_topics WHERE page_id = ? AND parent_id IS NOT NULL').bind(page.id).run();
    await env.DB.prepare('DELETE FROM social_topics WHERE page_id = ?').bind(page.id).run();
    await setBrief(env, page.id, TEMPLATES[key].brief, user.id);
  }
  await seedTemplate(env, page.id, key, user.id);
  await audit(env, request, user.id, body.replace === true ? 'topics_replaced' : 'topics_seeded', page.name, { template: key });
  return json({ ok: true });
}

// PUT /api/topics/brief { page_id, brief }
export async function saveBrief(request, env, user) {
  if (!canEdit(user)) throw new HttpError(403, 'Không có quyền sửa', 'forbidden');
  const body = await readJson(request);
  const page = await pageFor(env, user, body.page_id);
  const brief = String(body.brief || '').trim().slice(0, 4000);
  await setBrief(env, page.id, brief, user.id);
  await audit(env, request, user.id, 'page_brief_updated', page.name);
  return json({ ok: true });
}

// ---------- Kho kiến thức ----------
// GET /api/knowledge?page_id=&kind=
export async function listKnowledge(request, env, user) {
  const q = new URL(request.url).searchParams;
  const page = await pageFor(env, user, q.get('page_id'));
  const kind = ['doc', 'news', 'feedback'].includes(q.get('kind')) ? q.get('kind') : null;
  const { results } = await env.DB.prepare(
    `SELECT k.id, k.page_id, k.kind, k.title, k.digest, k.url, k.topic_id, k.created_at, substr(k.body, 1, 400) AS preview, length(k.body) AS size, u.name AS created_by_name
     FROM social_knowledge k LEFT JOIN social_users u ON u.id = k.created_by
     WHERE (k.page_id = ? OR k.page_id IS NULL) ${kind ? 'AND k.kind = ?' : ''} ORDER BY k.created_at DESC LIMIT 200`
  ).bind(...(kind ? [page.id, kind] : [page.id])).all();
  return json({ items: results, can_edit: canEdit(user) });
}

// Tóm tắt tài liệu thành bản ngắn cho AI đọc (Claude Haiku, rẻ). Không có AI thì cắt đoạn đầu.
async function digestOf(env, title, body) {
  const fallback = body.replace(/\s+/g, ' ').slice(0, 700);
  if (!aiProvider(env)) return fallback;
  try {
    const { text } = await generate(env, {
      tier: 'fast', maxTokens: 900,
      system: 'Bạn tóm tắt tài liệu nội bộ cho người viết nội dung Fanpage nông nghiệp. Chỉ giữ dữ kiện cụ thể dùng được khi viết bài (số liệu có ngày, tên chương trình, quy định, điều được và không được nói). Không thêm ý ngoài tài liệu. Tiếng Việt có dấu.',
      prompt: `[VIEC:summary] Tóm tắt tài liệu "${title}" trong tối đa 120 từ, dạng các gạch đầu dòng ngắn. Trả về JSON {"digest": "..."}.\n\n${body.slice(0, 12000)}`,
    });
    const d = parseJson(text)?.digest;
    return String(d || text || fallback).slice(0, 1200);
  } catch { return fallback; }
}

// POST /api/knowledge { page_id, all_pages?, title, body, url? }
export async function createKnowledge(request, env, user) {
  if (!canEdit(user)) throw new HttpError(403, 'Không có quyền thêm kiến thức', 'forbidden');
  const b = await readJson(request);
  const page = await pageFor(env, user, b.page_id);
  const title = String(b.title || '').trim().slice(0, 200);
  const body = String(b.body || '').trim().slice(0, MAX_KNOWLEDGE_BODY);
  if (!title || body.length < 20) throw new HttpError(400, 'Vui lòng nhập tên và nội dung tài liệu (ít nhất 20 ký tự)', 'empty');
  let url = null;
  if (b.url) { try { const u = new URL(String(b.url)); if (/^https?:$/.test(u.protocol)) url = u.toString().slice(0, 500); } catch { /* bỏ qua */ } }
  const digest = await digestOf(env, title, body);
  const row = await env.DB.prepare('INSERT INTO social_knowledge (page_id, kind, title, body, digest, url, created_by, created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id')
    .bind(b.all_pages ? null : page.id, 'doc', title, body, digest, url, user.id, now()).first();
  await audit(env, request, user.id, 'knowledge_added', title.slice(0, 80), { id: row.id });
  return json({ id: row.id, digest }, 201);
}

// PATCH /api/knowledge/:id { digest } : sửa bản tóm tắt AI đọc
export async function updateKnowledge(request, env, user, id) {
  if (!canEdit(user)) throw new HttpError(403, 'Không có quyền sửa', 'forbidden');
  const row = await env.DB.prepare('SELECT * FROM social_knowledge WHERE id = ?').bind(Number(id)).first();
  if (!row || (row.page_id && !(await allowedPageIds(env, user)).includes(row.page_id))) throw new HttpError(404, 'Không tìm thấy', 'not_found');
  const b = await readJson(request);
  const digest = String(b.digest || '').trim().slice(0, 1500);
  await env.DB.prepare('UPDATE social_knowledge SET digest = ? WHERE id = ?').bind(digest, row.id).run();
  await audit(env, request, user.id, 'knowledge_updated', row.title.slice(0, 80), { id: row.id });
  return json({ ok: true });
}

// DELETE /api/knowledge/:id
export async function deleteKnowledge(request, env, user, id) {
  requireRole(user, 'owner', 'manager');
  const row = await env.DB.prepare('SELECT * FROM social_knowledge WHERE id = ?').bind(Number(id)).first();
  if (!row || (row.page_id && !(await allowedPageIds(env, user)).includes(row.page_id))) throw new HttpError(404, 'Không tìm thấy', 'not_found');
  await env.DB.prepare('DELETE FROM social_knowledge WHERE id = ?').bind(row.id).run();
  await audit(env, request, user.id, 'knowledge_deleted', row.title.slice(0, 80), { id: row.id });
  return json({ ok: true });
}

// ---------- Đề xuất cập nhật chủ đề ----------
// GET /api/topics/suggestions?page_id=
export async function listSuggestions(request, env, user) {
  const page = await pageFor(env, user, new URL(request.url).searchParams.get('page_id'));
  const { results } = await env.DB.prepare(
    `SELECT s.*, t.title AS topic_title, p.title AS parent_title FROM social_topic_suggestions s
     LEFT JOIN social_topics t ON t.id = s.topic_id LEFT JOIN social_topics p ON p.id = s.parent_id
     WHERE s.page_id = ? AND s.status = 'pending' ORDER BY s.created_at DESC LIMIT 50`
  ).bind(page.id).all();
  return json({ items: results.map((r) => ({ ...r, payload: parseJson(r.payload) || {} })) });
}

// POST /api/topics/suggestions/:id/accept | dismiss
export async function decideSuggestion(request, env, user, id, decision) {
  if (!canEdit(user)) throw new HttpError(403, 'Không có quyền', 'forbidden');
  const s = await env.DB.prepare('SELECT * FROM social_topic_suggestions WHERE id = ?').bind(Number(id)).first();
  if (!s || !(await allowedPageIds(env, user)).includes(s.page_id)) throw new HttpError(404, 'Không tìm thấy đề xuất', 'not_found');
  if (s.status !== 'pending') throw new HttpError(409, 'Đề xuất đã được xử lý', 'done');
  const t = now();
  if (decision === 'accept') {
    const raw = parseJson(s.payload) || {};
    const f = cleanTopic(raw, true);
    delete f.share; delete f.status; delete f.sort;
    if (Array.isArray(raw.shares)) {
      // Cân chỉnh tỷ trọng các chủ đề cha
      const stmts = raw.shares.map((x) => env.DB.prepare('UPDATE social_topics SET share = ?, updated_at = ? WHERE id = ? AND page_id = ? AND parent_id IS NULL')
        .bind(Math.max(0, Math.min(100, Math.round(Number(x.share) || 0))), t, Number(x.topic_id), s.page_id));
      if (stmts.length) await env.DB.batch(stmts);
    } else if (s.action === 'update' && s.topic_id) {
      const keys = Object.keys(f).filter((k) => f[k]);
      if (keys.length) await env.DB.prepare(`UPDATE social_topics SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND page_id = ?`).bind(...keys.map((k) => f[k]), t, s.topic_id, s.page_id).run();
    } else {
      if (!f.title) throw new HttpError(400, 'Đề xuất thiếu tên chủ đề', 'empty');
      const keys = Object.keys(TOPIC_FIELDS);
      await env.DB.prepare(`INSERT INTO social_topics (page_id, parent_id, ${keys.join(', ')}, sort, created_by, created_at, updated_at) VALUES (?,?,${keys.map(() => '?').join(',')},999,?,?,?)`)
        .bind(s.page_id, s.parent_id, ...keys.map((k) => f[k] || ''), user.id, t, t).run();
    }
  }
  await env.DB.prepare('UPDATE social_topic_suggestions SET status = ? WHERE id = ?').bind(decision === 'accept' ? 'accepted' : 'dismissed', s.id).run();
  await audit(env, request, user.id, decision === 'accept' ? 'suggestion_accepted' : 'suggestion_dismissed', String(s.id));
  return json({ ok: true });
}
export const acceptSuggestion = (r, e, u, id) => decideSuggestion(r, e, u, id, 'accept');
export const dismissSuggestion = (r, e, u, id) => decideSuggestion(r, e, u, id, 'dismiss');
