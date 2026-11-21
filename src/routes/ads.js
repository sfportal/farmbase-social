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
    rows = await allPages(env, 'me/adaccounts', { access_token: token, fields: 'account_id,name,currency,account_status,timezone_name,amount_spent', limit: '100' });
  } catch (e) { throw adsError(e); }
  const accounts = rows.map((a) => ({
    id: String(a.account_id || a.id).replace(/^act_/, ''),
    name: a.name || `Tài khoản ${a.account_id}`,
    currency: a.currency || 'VND',
    status: ACCOUNT_STATUS[a.account_status] || 'other',
    timezone: a.timezone_name || null,
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

// Tên tiếng Việt cho các loại kết quả hay gặp (loại khác hiện mã gốc của Facebook).
const ACTION_LABELS = {
  'onsite_conversion.messaging_conversation_started_7d': 'Cuộc trò chuyện bắt đầu',
  'onsite_conversion.messaging_first_reply': 'Khách nhắn lần đầu',
  'onsite_conversion.total_messaging_connection': 'Kết nối nhắn tin',
  'onsite_conversion.messaging_block': 'Khách chặn tin nhắn',
  link_click: 'Lượt nhấp liên kết',
  post_engagement: 'Tương tác với bài viết',
  page_engagement: 'Tương tác với Trang',
  post_reaction: 'Cảm xúc',
  comment: 'Bình luận',
  post: 'Chia sẻ',
  'onsite_conversion.post_save': 'Lưu bài viết',
  like: 'Thích Trang',
  video_view: 'Lượt xem video (3 giây)',
  photo_view: 'Lượt xem ảnh',
  lead: 'Khách hàng tiềm năng',
  'onsite_conversion.lead_grouped': 'Khách hàng tiềm năng (biểu mẫu)',
  landing_page_view: 'Lượt xem trang đích',
  purchase: 'Mua hàng',
  omni_purchase: 'Mua hàng',
  add_to_cart: 'Thêm vào giỏ',
  complete_registration: 'Hoàn tất đăng ký',
  contact_total: 'Liên hệ',
};
const DETAIL_FIELDS = 'spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,inline_link_clicks,actions,cost_per_action_type';

function actionList(row) {
  const cost = new Map((row?.cost_per_action_type || []).map((x) => [x.action_type, Number(x.value)]));
  return (row?.actions || [])
    .map((a) => ({ type: a.action_type, label: ACTION_LABELS[a.action_type] || a.action_type, value: Number(a.value), cost: cost.get(a.action_type) ?? null }))
    .sort((a, b) => b.value - a.value);
}

const objId = (v) => {
  const s = String(v || '');
  if (!/^\d{1,25}$/.test(s)) throw new HttpError(400, 'Mã chiến dịch không hợp lệ', 'bad_campaign');
  return s;
};

// GET /api/ads/campaigns/:id?preset= : chi tiết một chiến dịch (tổng, theo ngày, nhóm quảng cáo, mẫu quảng cáo, độ tuổi, giới tính, vị trí).
export async function campaignDetail(request, env, user, rawId) {
  requireRole(user, 'owner', 'manager');
  const id = objId(rawId);
  const preset = new URL(request.url).searchParams.get('preset') || 'last_7d';
  if (!PRESETS.includes(preset)) throw new HttpError(400, 'Khoảng thời gian không hợp lệ', 'bad_preset');
  const { token } = await userToken(env);
  const t = { access_token: token };
  const ins = { ...t, date_preset: preset };
  try {
    const c = await graph(env, id, { ...t, fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time,account_id,bid_strategy' });
    const [acc, total, daily, adsets, adsetIns, ads, adIns, demo, place] = await Promise.all([
      graph(env, `act_${c.account_id}`, { ...t, fields: 'currency,name' }),
      graph(env, `${id}/insights`, { ...ins, fields: DETAIL_FIELDS }),
      allPages(env, `${id}/insights`, { ...ins, time_increment: '1', fields: 'spend,impressions,clicks,actions', limit: '100' }, 4),
      allPages(env, `${id}/adsets`, { ...t, fields: 'id,name,effective_status,daily_budget,lifetime_budget,optimization_goal,targeting{age_min,age_max,genders,geo_locations{countries,regions{name},cities{name}}}', limit: '100' }, 2),
      allPages(env, `${id}/insights`, { ...ins, level: 'adset', fields: `adset_id,${DETAIL_FIELDS}`, limit: '100' }, 2),
      allPages(env, `${id}/ads`, { ...t, fields: 'id,name,effective_status,adset_id,creative{thumbnail_url,image_url,title,body,effective_object_story_id}', limit: '100' }, 2),
      allPages(env, `${id}/insights`, { ...ins, level: 'ad', fields: `ad_id,${DETAIL_FIELDS}`, limit: '100' }, 2),
      allPages(env, `${id}/insights`, { ...ins, breakdowns: 'age,gender', fields: 'spend,impressions,reach,clicks,actions', limit: '100' }, 2),
      allPages(env, `${id}/insights`, { ...ins, breakdowns: 'publisher_platform', fields: 'spend,impressions,reach,clicks,actions', limit: '50' }, 1),
    ]);
    const cur = acc.currency || 'VND';
    const tRow = total.data?.[0];
    const shape = (r) => ({ ...shapeInsights(r), frequency: r?.frequency !== undefined ? Number(r.frequency) : null, cpc: r?.cpc !== undefined ? Number(r.cpc) : null, actions: actionList(r) });
    const asMap = new Map(adsetIns.map((r) => [String(r.adset_id), r]));
    const adMap = new Map(adIns.map((r) => [String(r.ad_id), r]));
    const adsetName = new Map(adsets.map((a) => [String(a.id), a.name]));
    const target = (tg) => {
      if (!tg) return null;
      const g = tg.genders?.length === 1 ? (tg.genders[0] === 1 ? 'Nam' : 'Nữ') : 'Nam và nữ';
      const geo = tg.geo_locations || {};
      const places = [...(geo.cities || []).map((x) => x.name), ...(geo.regions || []).map((x) => x.name), ...(geo.countries || [])].slice(0, 6);
      return `${g}, ${tg.age_min || 18}–${tg.age_max || 65}${tg.age_max >= 65 ? '+' : ''} tuổi${places.length ? `, ${places.join(', ')}` : ''}`;
    };
    const byRes = (a, b) => (b.insights.spend - a.insights.spend);
    return json({
      preset,
      currency: cur,
      account: { id: String(c.account_id), name: acc.name },
      campaign: {
        id, name: c.name, status: c.effective_status || c.status, objective: c.objective || null,
        daily_budget: toMoney(c.daily_budget, cur), lifetime_budget: toMoney(c.lifetime_budget, cur), budget_remaining: toMoney(c.budget_remaining, cur),
        start_time: c.start_time || null, stop_time: c.stop_time || null, created_time: c.created_time || null,
        link: `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${encodeURIComponent(c.account_id)}&selected_campaign_ids=${encodeURIComponent(id)}`,
      },
      has_data: !!tRow,
      totals: shape(tRow),
      daily: daily.map((r) => ({ date: r.date_start, spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks), messages: pickResults(r).messages })),
      adsets: adsets.map((a) => ({
        id: String(a.id), name: a.name, status: a.effective_status, optimization_goal: a.optimization_goal || null,
        daily_budget: toMoney(a.daily_budget, cur), lifetime_budget: toMoney(a.lifetime_budget, cur),
        targeting: target(a.targeting), has_data: asMap.has(String(a.id)), insights: shape(asMap.get(String(a.id))),
      })).sort(byRes),
      ads: ads.map((a) => ({
        id: String(a.id), name: a.name, status: a.effective_status, adset: adsetName.get(String(a.adset_id)) || null,
        thumbnail: a.creative?.thumbnail_url || a.creative?.image_url || null,
        text: a.creative?.body || a.creative?.title || null,
        post_link: a.creative?.effective_object_story_id ? `https://www.facebook.com/${a.creative.effective_object_story_id}` : null,
        has_data: adMap.has(String(a.id)), insights: shape(adMap.get(String(a.id))),
      })).sort(byRes),
      demographics: demo.map((r) => ({ age: r.age, gender: r.gender, spend: num(r.spend), impressions: num(r.impressions), reach: num(r.reach), clicks: num(r.clicks), messages: pickResults(r).messages })),
      platforms: place.map((r) => ({ platform: r.publisher_platform, spend: num(r.spend), impressions: num(r.impressions), reach: num(r.reach), clicks: num(r.clicks), messages: pickResults(r).messages })),
    });
  } catch (e) { throw adsError(e); }
}
