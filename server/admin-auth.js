import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { getDatabase } from './db.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_HOURS = Number(process.env.ADMIN_SESSION_HOURS || 12);
const permissions = {
  SUPER_ADMIN: new Set(['*']),
  ADMIN: new Set(['contributions:read','contributions:write','analytics:read','exports:run','files:read','summaries:write','tags:write']),
  ANALYST: new Set(['contributions:read','contributions:write','files:read','summaries:write','tags:write']),
  VIEWER: new Set(['contributions:read'])
};
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
export const hasPermission = (user, permission) => Boolean(user && (permissions[user.role]?.has('*') || permissions[user.role]?.has(permission)));

export async function hashPassword(password){
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(digest).toString('hex')}`;
}
export async function verifyPassword(password, stored){
  const [algorithm, salt, expected] = String(stored).split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const digest = await scrypt(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return expectedBuffer.length === digest.length && crypto.timingSafeEqual(expectedBuffer, digest);
}
export function parseCookies(header = ''){
  return Object.fromEntries(header.split(';').map(item => item.trim().split(/=(.*)/s)).filter(([key]) => key).map(([key, value = '']) => [key, decodeURIComponent(value)]));
}
export async function bootstrapAdmin(){
  const db = getDatabase();
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!db || !email || !password) return;
  if (password.length < 16) throw new Error('ADMIN_BOOTSTRAP_PASSWORD doit contenir au moins 16 caractères.');
  const existing = await db.query('SELECT id FROM admin_users WHERE email=$1', [email]);
  if (!existing.rowCount) {
    await db.query('INSERT INTO admin_users(email,display_name,password_hash,role) VALUES($1,$2,$3,$4)', [email, 'Administrateur principal', await hashPassword(password), 'SUPER_ADMIN']);
    console.log(`Administrateur initial créé : ${email}`);
  }
}
export async function createSession(user, res){
  const db = getDatabase();
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await db.query('INSERT INTO admin_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,$4)', [hashToken(token), user.id, csrf, expires]);
  res.cookie('admin_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', expires });
  return csrf;
}
export async function sessionUser(req){
  const db = getDatabase();
  const token = parseCookies(req.headers.cookie).admin_session;
  if (!db || !token) return null;
  const result = await db.query(`SELECT u.id,u.email,u.display_name,u.role,s.csrf_token FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=true`, [hashToken(token)]);
  if (!result.rowCount) return null;
  await db.query('UPDATE admin_sessions SET last_seen_at=NOW() WHERE token_hash=$1', [hashToken(token)]);
  return result.rows[0];
}
export async function destroySession(req, res){
  const db = getDatabase(); const token = parseCookies(req.headers.cookie).admin_session;
  if (db && token) await db.query('DELETE FROM admin_sessions WHERE token_hash=$1', [hashToken(token)]);
  res.clearCookie('admin_session', { httpOnly:true, secure:process.env.NODE_ENV==='production', sameSite:'strict', path:'/' });
}
export async function audit(user, action, resourceType, resourceId, req, details = {}){
  const db = getDatabase(); if (!db) return;
  const forwarded = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const ipHash = forwarded ? hashToken(forwarded) : null;
  await db.query('INSERT INTO audit_logs(user_id,action,resource_type,resource_id,details,ip_hash) VALUES($1,$2,$3,$4,$5,$6)', [user?.id || null, action, resourceType, resourceId || null, JSON.stringify(details), ipHash]);
}
export function requireAdmin(permission){
  return async (req, res, next) => {
    const user = await sessionUser(req);
    if (!user) return res.status(401).json({ error: 'Authentification requise.' });
    if (!hasPermission(user, permission)) return res.status(403).json({ error: 'Permission insuffisante.' });
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers['x-csrf-token'] !== user.csrf_token) return res.status(403).json({ error: 'Jeton de sécurité invalide.' });
    req.adminUser = user;
    next();
  };
}
