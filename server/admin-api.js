import crypto from 'node:crypto';
import { z } from 'zod';
import { getDatabase } from './db.js';
import { audit, createSession, destroySession, hashPassword, requireAdmin, sessionUser, verifyPassword } from './admin-auth.js';
import { getPrivateUpload } from './storage.js';

const ROLES = ['SUPER_ADMIN','ADMIN','ANALYST','VIEWER'];
const STATUSES = ['RECEIVED','IN_REVIEW','NEEDS_FOLLOW_UP','VALIDATED','DUPLICATE','OUT_OF_SCOPE','REJECTED','ARCHIVED'];
const safeOrder = { created_at:'c.created_at', updated_at:'c.updated_at', reference:'c.reference', priority:'c.priority', status:'c.status' };
const userView = row => ({ id:row.id, email:row.email, displayName:row.display_name, role:row.role, active:row.active, lastLoginAt:row.last_login_at, createdAt:row.created_at });
const csv = value => `"${String(value ?? '').replaceAll('"','""')}"`;

function queryFilters(query){
  const clauses=[]; const values=[]; const add=(sql,value)=>{values.push(value);clauses.push(sql.replace('?', `$${values.length}`));};
  if (query.status && STATUSES.includes(query.status)) add('c.status=?', query.status);
  if (query.theme) add('c.theme=?', query.theme);
  if (query.country) add('c.country=?', query.country);
  if (query.province) add('c.province=?', query.province);
  if (query.assignedTo) add('c.assigned_to=?', query.assignedTo);
  if (query.priority !== undefined && /^[0-3]$/.test(String(query.priority))) add('c.priority=?', Number(query.priority));
  if (query.diaspora === 'true') clauses.push("c.country <> 'République démocratique du Congo'");
  if (query.format === 'audio') clauses.push('c.audio_key IS NOT NULL');
  if (query.format === 'document') clauses.push('EXISTS (SELECT 1 FROM contribution_files f WHERE f.contribution_id=c.id)');
  if (query.format === 'text') clauses.push("COALESCE(c.text_content,'') <> ''");
  if (query.unread === 'true') clauses.push('c.read_at IS NULL');
  if (query.q) { const q=`%${String(query.q).slice(0,120)}%`; values.push(q); const i=values.length; clauses.push(`(c.reference ILIKE $${i} OR c.first_name ILIKE $${i} OR c.last_name ILIKE $${i} OR c.email ILIKE $${i} OR c.text_content ILIKE $${i})`); }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}
async function contributionDetail(id){
  const db=getDatabase();
  const item=await db.query(`SELECT c.*,u.display_name AS assigned_name FROM contributions c LEFT JOIN admin_users u ON u.id=c.assigned_to WHERE c.id=$1`,[id]);
  if(!item.rowCount)return null;
  const [files,tags,comments,history]=await Promise.all([
    db.query('SELECT id,original_name,mime_type,size,created_at FROM contribution_files WHERE contribution_id=$1 ORDER BY created_at',[id]),
    db.query('SELECT t.id,t.name,t.color FROM contribution_tags ct JOIN admin_tags t ON t.id=ct.tag_id WHERE ct.contribution_id=$1',[id]),
    db.query('SELECT ic.id,ic.body,ic.created_at,u.display_name FROM internal_comments ic LEFT JOIN admin_users u ON u.id=ic.author_id WHERE ic.contribution_id=$1 ORDER BY ic.created_at DESC',[id]),
    db.query('SELECT h.*,u.display_name FROM contribution_status_history h LEFT JOIN admin_users u ON u.id=h.changed_by WHERE h.contribution_id=$1 ORDER BY h.created_at DESC',[id])
  ]);
  return {...item.rows[0],files:files.rows,tags:tags.rows,comments:comments.rows,history:history.rows};
}

export function registerAdminApi(app, loginLimiter){
  app.post('/api/admin/auth/login', loginLimiter, async (req,res) => {
    const parsed=z.object({email:z.string().email().max(254),password:z.string().min(1).max(1024)}).safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:'Identifiants invalides.'});
    const db=getDatabase(); if(!db)return res.status(503).json({error:'Le backoffice requiert PostgreSQL.'});
    const result=await db.query('SELECT * FROM admin_users WHERE email=$1',[parsed.data.email.trim().toLowerCase()]);
    const user=result.rows[0];
    if(!user||!user.active||!await verifyPassword(parsed.data.password,user.password_hash)){await audit(null,'LOGIN_FAILED','auth',null,req,{email:parsed.data.email.trim().toLowerCase()});return res.status(401).json({error:'Adresse électronique ou mot de passe incorrect.'});}
    const csrfToken=await createSession(user,res); await db.query('UPDATE admin_users SET last_login_at=NOW() WHERE id=$1',[user.id]); await audit(user,'LOGIN','auth',user.id,req);
    res.json({user:userView(user),csrfToken});
  });
  app.post('/api/admin/auth/logout', requireAdmin('contributions:read'), async (req,res)=>{await audit(req.adminUser,'LOGOUT','auth',req.adminUser.id,req);await destroySession(req,res);res.status(204).end();});
  app.get('/api/admin/me', async (req,res)=>{const user=await sessionUser(req);if(!user)return res.status(401).json({error:'Authentification requise.'});res.json({user:{id:user.id,email:user.email,displayName:user.display_name,role:user.role},csrfToken:user.csrf_token});});

  app.get('/api/admin/dashboard', requireAdmin('analytics:read'), async (req,res)=>{
    const db=getDatabase(); const result=await db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='RECEIVED')::int new,COUNT(*) FILTER(WHERE status IN ('IN_REVIEW','NEEDS_FOLLOW_UP'))::int processing,COUNT(*) FILTER(WHERE status='VALIDATED')::int validated,COUNT(*) FILTER(WHERE status='REJECTED')::int rejected,COUNT(*) FILTER(WHERE audio_key IS NOT NULL)::int audio,COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM contribution_files f WHERE f.contribution_id=contributions.id))::int documents,COUNT(*) FILTER(WHERE country <> 'République démocratique du Congo')::int diaspora FROM contributions`);
    const [themes,timeline]=await Promise.all([db.query('SELECT theme,COUNT(*)::int count FROM contributions GROUP BY theme ORDER BY count DESC'),db.query("SELECT to_char(created_at,'YYYY-MM-DD') AS day,COUNT(*)::int count FROM contributions WHERE created_at>=NOW()-INTERVAL '30 days' GROUP BY 1 ORDER BY 1")]);
    res.json({kpi:result.rows[0],themes:themes.rows,timeline:timeline.rows});
  });
  app.get('/api/admin/contributions', requireAdmin('contributions:read'), async (req,res)=>{
    const db=getDatabase();const {where,values}=queryFilters(req.query);const page=Math.max(1,Number(req.query.page)||1),limit=Math.min(100,Math.max(10,Number(req.query.limit)||25)),order=safeOrder[req.query.sort]||safeOrder.created_at,dir=req.query.dir==='asc'?'ASC':'DESC';
    const count=await db.query(`SELECT COUNT(*)::int count FROM contributions c ${where}`,values); values.push(limit,(page-1)*limit);
    const rows=await db.query(`SELECT c.id,c.reference,c.created_at,c.updated_at,c.first_name,c.last_name,c.country,c.province,c.profile,c.theme,c.status,c.priority,c.audio_key IS NOT NULL AS has_audio,EXISTS(SELECT 1 FROM contribution_files f WHERE f.contribution_id=c.id) AS has_files,u.display_name AS assigned_name FROM contributions c LEFT JOIN admin_users u ON u.id=c.assigned_to ${where} ORDER BY ${order} ${dir} LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    res.json({items:rows.rows,page,limit,total:count.rows[0].count});
  });
  app.get('/api/admin/contributions/:id', requireAdmin('contributions:read'), async (req,res)=>{const item=await contributionDetail(req.params.id);if(!item)return res.status(404).json({error:'Contribution introuvable.'});const db=getDatabase();if(!item.read_at)await db.query('UPDATE contributions SET read_at=NOW() WHERE id=$1',[item.id]);res.json(item);});
  app.patch('/api/admin/contributions/:id', requireAdmin('contributions:write'), async (req,res)=>{
    const parsed=z.object({status:z.enum(STATUSES).optional(),priority:z.number().int().min(0).max(3).optional(),assignedTo:z.string().uuid().nullable().optional(),secondaryTheme:z.string().max(100).nullable().optional(),internalNote:z.string().max(10000).nullable().optional(),transcription:z.string().max(50000).nullable().optional(),detectedLanguage:z.string().max(32).nullable().optional(),audioSummary:z.string().max(10000).nullable().optional()}).safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:'Modification invalide.'});const db=getDatabase();const before=await db.query('SELECT status FROM contributions WHERE id=$1',[req.params.id]);if(!before.rowCount)return res.status(404).json({error:'Contribution introuvable.'});
    const data=parsed.data; const fields=[]; const values=[req.params.id]; const set=(column,value)=>{values.push(value);fields.push(`${column}=$${values.length}`);};
    if(data.status!==undefined)set('status',data.status);if(data.priority!==undefined)set('priority',data.priority);if(data.assignedTo!==undefined)set('assigned_to',data.assignedTo);if(data.secondaryTheme!==undefined)set('secondary_theme',data.secondaryTheme);if(data.internalNote!==undefined)set('internal_note',data.internalNote);if(data.transcription!==undefined)set('transcription',data.transcription);if(data.detectedLanguage!==undefined)set('detected_language',data.detectedLanguage);if(data.audioSummary!==undefined)set('audio_summary',data.audioSummary);
    if(fields.length)await db.query(`UPDATE contributions SET ${fields.join(',')},updated_at=NOW() WHERE id=$1`,values);
    if(data.status&&data.status!==before.rows[0].status)await db.query('INSERT INTO contribution_status_history(contribution_id,from_status,to_status,changed_by) VALUES($1,$2,$3,$4)',[req.params.id,before.rows[0].status,data.status,req.adminUser.id]);
    if(data.assignedTo!==undefined)await db.query('INSERT INTO contribution_assignments(contribution_id,assigned_to,assigned_by) VALUES($1,$2,$3)',[req.params.id,data.assignedTo,req.adminUser.id]);await audit(req.adminUser,'CONTRIBUTION_UPDATED','contribution',req.params.id,req,data);res.json(await contributionDetail(req.params.id));
  });
  app.post('/api/admin/contributions/:id/comments', requireAdmin('contributions:write'), async(req,res)=>{const body=String(req.body?.body||'').trim();if(!body||body.length>10000)return res.status(400).json({error:'Commentaire invalide.'});const db=getDatabase();const comment=await db.query('INSERT INTO internal_comments(contribution_id,author_id,body) VALUES($1,$2,$3) RETURNING *',[req.params.id,req.adminUser.id,body]);await audit(req.adminUser,'COMMENT_ADDED','contribution',req.params.id,req);res.status(201).json(comment.rows[0]);});
  app.put('/api/admin/contributions/:id/tags', requireAdmin('tags:write'), async(req,res)=>{const ids=z.array(z.string().uuid()).max(30).safeParse(req.body?.tagIds);if(!ids.success)return res.status(400).json({error:'Tags invalides.'});const db=getDatabase();await db.query('DELETE FROM contribution_tags WHERE contribution_id=$1',[req.params.id]);for(const id of ids.data)await db.query('INSERT INTO contribution_tags(contribution_id,tag_id,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[req.params.id,id,req.adminUser.id]);await audit(req.adminUser,'TAGS_UPDATED','contribution',req.params.id,req,{tagIds:ids.data});res.status(204).end();});
  app.get('/api/admin/contributions/:id/audio', requireAdmin('files:read'), async(req,res)=>{const db=getDatabase();const found=await db.query('SELECT audio_key,audio_mime FROM contributions WHERE id=$1',[req.params.id]);if(!found.rowCount||!found.rows[0].audio_key)return res.status(404).end();try{const file=await getPrivateUpload(found.rows[0].audio_key);res.setHeader('Content-Type',found.rows[0].audio_mime||file.mimeType||'audio/mp4');res.setHeader('Content-Disposition','inline');res.setHeader('Cache-Control','private, no-store');await audit(req.adminUser,'AUDIO_STREAMED','contribution',req.params.id,req);file.stream.pipe(res);}catch{res.status(404).end();}});
  app.get('/api/admin/contributions/:id/files/:fileId', requireAdmin('files:read'), async(req,res)=>{const db=getDatabase();const found=await db.query('SELECT f.* FROM contribution_files f WHERE f.id=$1 AND f.contribution_id=$2',[req.params.fileId,req.params.id]);if(!found.rowCount)return res.status(404).end();try{const file=await getPrivateUpload(found.rows[0].storage_key);res.setHeader('Content-Type',found.rows[0].mime_type||file.mimeType||'application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename="${found.rows[0].original_name.replaceAll('"','')}"`);res.setHeader('Cache-Control','private, no-store');await audit(req.adminUser,'FILE_DOWNLOADED','contribution',req.params.id,req,{fileId:req.params.fileId});file.stream.pipe(res);}catch{res.status(404).end();}});
  app.get('/api/admin/tags', requireAdmin('contributions:read'), async(_req,res)=>res.json((await getDatabase().query('SELECT * FROM admin_tags WHERE active=true ORDER BY name')).rows));
  app.post('/api/admin/tags', requireAdmin('tags:write'), async(req,res)=>{const name=String(req.body?.name||'').trim();if(!name||name.length>80)return res.status(400).json({error:'Nom de tag invalide.'});const tag=await getDatabase().query('INSERT INTO admin_tags(name,slug) VALUES($1,$2) RETURNING *',[name,name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')]);await audit(req.adminUser,'TAG_CREATED','tag',tag.rows[0].id,req);res.status(201).json(tag.rows[0]);});
  app.get('/api/admin/analysis', requireAdmin('analytics:read'), async(_req,res)=>{const db=getDatabase();const [diaspora,themes]=await Promise.all([db.query("SELECT country,COUNT(*)::int contributions,COUNT(DISTINCT email)::int contributors FROM contributions WHERE country <> 'République démocratique du Congo' GROUP BY country ORDER BY contributions DESC"),db.query('SELECT theme,COUNT(*)::int contributions FROM contributions GROUP BY theme ORDER BY contributions DESC')]);res.json({diaspora:diaspora.rows,themes:themes.rows});});
  app.get('/api/admin/summaries', requireAdmin('summaries:write'), async(_req,res)=>res.json((await getDatabase().query('SELECT s.*,u.display_name FROM summaries s LEFT JOIN admin_users u ON u.id=s.created_by ORDER BY s.updated_at DESC')).rows));
  app.post('/api/admin/summaries', requireAdmin('summaries:write'), async(req,res)=>{const parsed=z.object({title:z.string().min(3).max(240),body:z.string().max(50000),theme:z.string().max(100).optional(),contributionIds:z.array(z.string().uuid()).max(1000).default([])}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Synthèse invalide.'});const db=getDatabase();const summary=await db.query('INSERT INTO summaries(title,body,theme,created_by) VALUES($1,$2,$3,$4) RETURNING *',[parsed.data.title,parsed.data.body,parsed.data.theme||null,req.adminUser.id]);for(const id of parsed.data.contributionIds)await db.query('INSERT INTO summary_contributions(summary_id,contribution_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[summary.rows[0].id,id]);await audit(req.adminUser,'SUMMARY_CREATED','summary',summary.rows[0].id,req);res.status(201).json(summary.rows[0]);});
  app.get('/api/admin/users', requireAdmin('*'), async(_req,res)=>res.json((await getDatabase().query('SELECT id,email,display_name,role,active,last_login_at,created_at FROM admin_users ORDER BY created_at')).rows.map(userView)));
  app.post('/api/admin/users', requireAdmin('*'), async(req,res)=>{const parsed=z.object({email:z.string().email(),displayName:z.string().min(2).max(120),password:z.string().min(16).max(1024),role:z.enum(ROLES)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Utilisateur invalide (mot de passe : 16 caractères minimum).'});const user=await getDatabase().query('INSERT INTO admin_users(email,display_name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,email,display_name,role,active,last_login_at,created_at',[parsed.data.email.toLowerCase(),parsed.data.displayName,await hashPassword(parsed.data.password),parsed.data.role]);await audit(req.adminUser,'USER_CREATED','user',user.rows[0].id,req,{role:parsed.data.role});res.status(201).json(userView(user.rows[0]));});
  app.get('/api/admin/audit', requireAdmin('*'), async(req,res)=>{const rows=await getDatabase().query('SELECT a.*,u.display_name,u.email FROM audit_logs a LEFT JOIN admin_users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 200');res.json(rows.rows);});
  app.get('/api/admin/exports/contributions.csv', requireAdmin('exports:run'), async(req,res)=>{const db=getDatabase();const {where,values}=queryFilters(req.query);const rows=await db.query(`SELECT c.reference,c.created_at,c.first_name,c.last_name,c.email,c.country,c.province,c.profile,c.theme,c.status,c.priority FROM contributions c ${where} ORDER BY c.created_at DESC LIMIT 10000`,values);res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="contributions.csv"');res.write('\ufeffRéférence,Date,Prénom,Nom,Email,Pays,Province,Profil,Thématique,Statut,Priorité\n');for(const row of rows.rows)res.write([row.reference,row.created_at,row.first_name,row.last_name,row.email,row.country,row.province,row.profile,row.theme,row.status,row.priority].map(csv).join(',')+'\n');await audit(req.adminUser,'EXPORT_CSV','contribution',null,req,{count:rows.rows.length});res.end();});
}
