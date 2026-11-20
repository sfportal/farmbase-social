// Quảng cáo: xem tài khoản quảng cáo, chiến dịch, chi tiêu và kết quả (chỉ đọc, quyền ads_read).
// Dùng mã người dùng dài hạn lưu khi Chủ hệ thống kết nối Facebook (social_settings, khóa fb_user_token, đã mã hóa).
import { encryptSecret, decryptSecret } from '../lib/crypto.js';
import { HttpError, json, now } from '../lib/http.js';
import { requireRole } from '../lib/auth.js';
import { graph } from './facebook.js';

const TOKEN_KEY_NAME = 'fb_user_token';
export const PRESETS = ['today', 'yesterday', 'last_7d', 'last_30d', 'this_month', 'last_month', 'maximum'];
// Tiền tệ không có đơn vị lẻ: Facebook trả ngân sách đúng bằng số tiền (các loại khác trả theo đơn vị nhỏ nhất, ví dụ cent).
const NO_DECIMAL = new Set(['VND', 'JPY', 'KRW', 'CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'PYG', 'TWD']);
const ACCOUNT_STATUS = { 1: 'active', 2: 'disabled', 3: 'unsettled', 7: 'pending_review', 8: 'pending_settlement', 9: 'grace_period', 100: 'pending_closure', 101: 'closed' };
// Kết quả hay dùng, lấy từ danh sách actions của Facebook.
const RESULT_TYPES = {
  messages: 'onsite_conversion.messaging_conversation_started_7d',
  link_clicks: 'link_click',
  engagement: 'post_engagement',
  leads: 'lead',
};

export async function saveUserToken(env, userId, token, expiresIn) {
  const enc = await encryptSecret(token, env.TOKEN_KEY);
  const value = JSON.stringify({ enc, user_id: userId, at: now(), expires_at: expiresIn ? now() + Number(expiresIn) : null });
  await env.DB.prepare(
    `INSERT INTO social_settings (key, value, updated_by, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).bind(TOKEN_KEY_NAME, value, userId, now()).run();
}

async function userToken(env) {
  const row = await env.DB.prepare('SELECT value FROM social_settings WHERE key = ?').bind(TOKEN_KEY_NAME).first();
  let v = null;
  try { v = row ? JSON.parse(row.value) : null; } catch { v = null; }
  if (!v?.enc) throw new HttpError(409, 'Chưa có quyền xem quảng cáo. Chủ hệ thống vào mục Fanpage, bấm "Kết nối Fanpage" để đăng nhập Facebook lại và cấp quyền quảng cáo.', 'no_ads_token');
  if (v.expires_at && v.expires_at < now()) throw new HttpError(409, 'Quyền xem quảng cáo đã hết hạn. Chủ hệ thống vào mục Fanpage, bấm "Kết nối Fanpage" để gia hạn.', 'ads_token_expired');
  return { token: await decryptSecret(v.enc, env.TOKEN_KEY), expires_at: v.expires_at || null };
}

function adsError(e) {
  const code = e.fb?.code;
  if (code === 190) return new HttpError(409, 'Quyền xem quảng cáo đã hết hạn hoặc bị thu hồi. Chủ hệ thống vào mục Fanpage, bấm "Kết nối Fanpage" để cấp lại.', 'ads_token_expired');
  if (code === 10 || code === 200 || code === 294) return new HttpError(403, 'Facebook chưa cho phép đọc quảng cáo của tài khoản này. Vui lòng kết nối lại Facebook và đồng ý quyền quảng cáo, hoặc kiểm tra vai trò của Quý khách trong tài khoản quảng cáo.', 'ads_permission');
  if (code === 17 || code === 80004) return new HttpError(429, 'Facebook đang giới hạn số lần đọc quảng cáo. Vui lòng thử lại sau vài phút.', 'ads_rate_limit');
  return e;
}

const toMoney = (v, currency) => (v === undefined || v === null || v === '' ? null : NO_DECIMAL.has(currency) ? Number(v) : Number(v) / 100);
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));

function pickResults(row) {
  const out = {};
  const acts = row?.actions || [];
  for (const [k, type] of Object.entries(RESULT_TYPES)) {
    const a = acts.find((x) => x.action_type === type);
    out[k] = a ? Number(a.value) : 0;
  }
  return out;
}

function shapeInsights(row) {
  const spend = num(row?.spend);
  const r = pickResults(row);
  return {
    spend,
    impressions: num(row?.impressions),
    reach: num(row?.reach),
    clicks: num(row?.clicks),
    ctr: row?.ctr !== undefined ? Number(row.ctr) : null,
    cpm: row?.cpm !== undefined ? Number(row.cpm) : null,
    ...r,
    cost_per_message: r.messages ? spend / r.messages : null,
    cost_per_link_click: r.link_clicks ? spend / r.link_clicks : null,
  };
}

const accountId = (id) => {
  const s = String(id || '').replace(/^act_/, '');
  if (!/^\d{1,25}$/.test(s)) throw new HttpError(400, 'Tài khoản quảng cáo không hợp lệ', 'bad_account');
  return s;
};

async function allPages(env, path, params, max = 5) {
  const out = [];
  let after = null;
  for (let i = 0; i < max; i++) {
    const d = await graph(env, path, after ? { ...params, after } : params);
    out.push(...(d.data || []));
    after = d.paging?.next ? d.paging?.cursors?.after : null;
    if (!after) break;
  }
  return out;
}

// GET /api/ads/accounts: tài khoản quảng cáo mà người kết nối có vai trò.
export async function listAdAccounts(request, env, user) {
  requireRole(user, 'owner', 'manager');
  const { token, expires_at } = await userToken(env);
  let rows;
  try {
    rows = await allPages(env, 'me/adaccounts', { access_token: token, fields: 'account_id,name,currency,account_status,timezone_name,amount_spent,business{name}', limit: '100' });
  } catch (e) { throw adsError(e); }
  const accounts = rows.map((a) => ({
    id: String(a.account_id || a.id).replace(/^act_/, ''),
    name: a.name || `Tài khoản ${a.account_id}`,
    currency: a.currency || 'VND',
    status: ACCOUNT_STATUS[a.account_status] || 'other',
    timezone: a.timezone_name || null,
    business: a.business?.name || null,
    amount_spent: toMoney(a.amount_spent, a.currency),
    link: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(String(a.account_id || a.id).replace(/^act_/, ''))}`,
  }));
  return json({ accounts, token_expires_at: expires_at });
}

// GET /api/ads/accounts/:id/campaigns?preset=last_7d : chiến dịch, ngân sách, chi tiêu và kết quả trong khoảng thời gian.
export async function accountCampaigns(request, env, user, rawId) {
  requireRole(user, 'owner', 'manager');
  const id = accountId(rawId);
  const preset = new URL(request.url).searchParams.get('preset') || 'last_7d';
  if (!PRESETS.includes(preset)) throw new HttpError(400, 'Khoảng thời gian không hợp lệ', 'bad_preset');
  const { token } = await userToken(env);
  const fields = 'campaign_id,spend,impressions,reach,clicks,ctr,cpm,actions';
  let acc, campaigns, insights, total;
  try {
    [acc, campaigns, insights, total] = await Promise.all([
      graph(env, `act_${id}`, { access_token: token, fields: 'account_id,name,currency,account_status' }),
      allPages(env, `act_${id}/campaigns`, { access_token: token, fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,updated_time', limit: '100' }),
      allPages(env, `act_${id}/insights`, { access_token: token, level: 'campaign', date_preset: preset, fields, limit: '200' }),
      graph(env, `act_${id}/insights`, { access_token: token, date_preset: preset, fields: 'spend,impressions,reach,clicks,ctr,cpm,actions' }),
    ]);
  } catch (e) { throw adsError(e); }
  const cur = acc.currency || 'VND';
  const byId = new Map(insights.map((r) => [String(r.campaign_id), r]));
  const list = campaigns.map((c) => {
    const ins = byId.get(String(c.id));
    return {
      id: String(c.id),
      name: c.name,
      status: c.effective_status || c.status,
      objective: c.objective || null,
      daily_budget: toMoney(c.daily_budget, cur),
      lifetime_budget: toMoney(c.lifetime_budget, cur),
      budget_remaining: toMoney(c.budget_remaining, cur),
      start_time: c.start_time || null,
      stop_time: c.stop_time || null,
      has_data: !!ins,
      insights: shapeInsights(ins),
      link: `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${id}&selected_campaign_ids=${encodeURIComponent(c.id)}`,
    };
  });
  // Chiến dịch đang chạy hoặc có chi tiêu lên trước, rồi theo chi tiêu giảm dần.
  list.sort((a, b) => (Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE')) || (b.insights.spend - a.insights.spend));
  return json({
    account: { id, name: acc.name, currency: cur, status: ACCOUNT_STATUS[acc.account_status] || 'other' },
    preset,
    totals: shapeInsights(total.data?.[0]),
    campaigns: list,
  });
}
