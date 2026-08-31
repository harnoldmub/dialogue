import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ensureDatabase, saveContribution } from './server/db.js';
import { putUpload } from './server/storage.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024), files: 6 }, fileFilter: (_req, file, cb) => cb(null, allowedFile(file)) });
const textSchema = z.object({ firstName:z.string().trim().min(1).max(80),lastName:z.string().trim().min(1).max(80),email:z.string().trim().email().max(254),phone:z.string().trim().max(40).optional(),country:z.string().trim().min(1).max(100),city:z.string().trim().min(1).max(100),province:z.string().trim().max(100).optional(),profile:z.string().trim().max(80).optional(),theme:z.string().trim().min(1).max(100),title:z.string().trim().max(180).optional(),textContent:z.string().trim().max(20000).optional(),consent:z.literal('on') });
const MIME = new Set(['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','image/jpeg','image/png']);
function allowedFile(file){return file.fieldname==='audio' ? /^audio\/(webm|mp4|mpeg|ogg)/.test(file.mimetype) : MIME.has(file.mimetype)}
function fail(res,status,error){return res.status(status).json({error})}
app.set('trust proxy',1);app.use('/api',rateLimit({windowMs:15*60*1000,max:10,standardHeaders:true,legacyHeaders:false,message:{error:'Trop de tentatives. Réessayez dans quelques minutes.'}}));
app.post('/api/contributions',upload.fields([{name:'audio',maxCount:1},{name:'files',maxCount:5}]),async(req,res)=>{try{const parsed=textSchema.safeParse(req.body);if(!parsed.success)return fail(res,400,'Veuillez vérifier les informations obligatoires.');const audio=req.files?.audio?.[0];const files=req.files?.files||[];if(!parsed.data.textContent&&!audio&&!files.length)return fail(res,400,'Ajoutez un texte, une note vocale ou un document.');if([...files,...(audio?[audio]:[])].some(file=>!allowedFile(file)))return fail(res,415,'Un fichier utilise un format non autorisé.');const id=crypto.randomUUID();const audioRecord=audio?await putUpload(id,'audio',audio):null;const fileRecords=await Promise.all(files.map(file=>putUpload(id,'documents',file)));const contribution=await saveContribution({id,...parsed.data,audioKey:audioRecord?.storageKey||null,audioDuration:null,files:fileRecords});res.status(201).json({id:contribution.id,reference:contribution.reference})}catch(error){console.error('Contribution submission failed',error);return fail(res,500,'Une erreur est survenue. Votre contribution n’a pas été enregistrée.')}});
app.get('/health',(_req,res)=>res.json({ok:true}));
app.use(express.static(path.join(root,'dist')));app.get('/participer',(_req,res)=>res.sendFile(path.join(root,'dist','participer.html')));app.get('/{*splat}',(_req,res)=>res.sendFile(path.join(root,'dist','index.html')));
const port=Number(process.env.PORT||3000);ensureDatabase().then(()=>app.listen(port,()=>console.log(`CONGO DIALOGUE listening on ${port}`))).catch(error=>{console.error('Database initialization failed',error);process.exit(1)});
