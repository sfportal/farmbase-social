import { now, clientIp } from './http.js';

// Ghi nhật ký thao tác: ai làm gì, với đối tượng nào, lúc nào.
export async function audit(env, request, userId, action, target = null, detail = null) {
  await env.DB.prepare('INSERT INTO social_audit_log (user_id, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?)')
    .bind(userId ?? null, action, target, detail ? JSON.stringify(detail) : null, clientIp(request), now())
    .run();
}
