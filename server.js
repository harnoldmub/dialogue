import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ensureDatabase, saveContribution } from './server/db.js';
import { putUpload } from './server/storage.js';
import { bootstrapAdmin } from './server/admin-auth.js';
import { registerAdminApi } from './server/admin-api.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const app = express();
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
const DOCUMENT_MIME = new Set(['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','image/jpeg','image/png']);
const AUDIO_MIME = /^audio\/(webm|mp4|mpeg|mp3|ogg|wav|x-m4a|aac)/;

const contributionSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).optional(),
  country: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
  province: z.string().trim().max(100).optional(),
  profile: z.string().trim().max(80).optional(),
  theme: z.string().trim().min(1).max(100),
  title: z.string().trim().max(180).optional(),
  textContent: z.string().trim().max(20000).optional(),
  audioDuration: z.coerce.number().int().min(0).max(3600).optional(),
  consent: z.literal('on')
});

function accepts(file){
  return file.fieldname === 'audio' ? AUDIO_MIME.test(file.mimetype) : DOCUMENT_MIME.has(file.mimetype);
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 6 },
  fileFilter: (_req, file, cb) => {
    if (accepts(file)) return cb(null, true);
    // Un fichier refusé doit remonter en erreur, sinon il disparaît sans que le citoyen le sache.
    const error = new multer.MulterError('UNSUPPORTED_FILE_TYPE', file.fieldname);
    error.fileName = file.originalname;
    cb(error);
  }
}).fields([{ name: 'audio', maxCount: 1 }, { name: 'files', maxCount: 5 }]);

const fail = (res, status, error) => res.status(status).json({ error });

app.set('trust proxy', 1);
// Le microphone ne doit être disponible que pour cette origine, jamais pour une page qui embarquerait le site.
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'microphone=(self)');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '1mb' }));
const publicContributionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.PUBLIC_RATE_LIMIT_MAX || 10), standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives depuis cet appareil. Réessayez dans quelques minutes.' } });
const adminLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX || 5), standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives. Réessayez dans quelques minutes.' } });
registerAdminApi(app, adminLoginLimiter);

app.post('/api/contributions', publicContributionLimiter, (req, res) => {
  upload(req, res, async uploadError => {
    if (uploadError) {
      if (uploadError.code === 'LIMIT_FILE_SIZE') return fail(res, 413, `Chaque fichier doit rester sous ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} Mo.`);
      if (uploadError.code === 'LIMIT_FILE_COUNT' || uploadError.code === 'LIMIT_UNEXPECTED_FILE') return fail(res, 400, 'Cinq documents au maximum, et une seule note vocale.');
      if (uploadError.code === 'UNSUPPORTED_FILE_TYPE') return fail(res, 415, `Le format de ${uploadError.fileName || 'ce fichier'} n’est pas accepté.`);
      console.error('Upload failed', uploadError);
      return fail(res, 400, 'Les fichiers joints n’ont pas pu être lus. Réessayez.');
    }
    const parsed = contributionSchema.safeParse(req.body);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      return fail(res, 400, field === 'consent'
        ? 'Vous devez accepter le traitement de votre contribution.'
        : 'Certaines informations obligatoires sont manquantes ou incorrectes.');
    }
    const audio = req.files?.audio?.[0] || null;
    const files = req.files?.files || [];
    if (!parsed.data.textContent && !audio && !files.length) {
      return fail(res, 400, 'Ajoutez au moins un format : un texte, une note vocale ou un document.');
    }
    const id = crypto.randomUUID();
    try {
      const audioRecord = audio ? await putUpload(id, 'audio', audio) : null;
      const fileRecords = [];
      for (const file of files) fileRecords.push(await putUpload(id, 'documents', file));
      const contribution = await saveContribution({
        id, ...parsed.data,
        audioKey: audioRecord?.storageKey || null,
        audioDuration: parsed.data.audioDuration ?? null,
        audioMime: audioRecord?.mimeType || null,
        audioSize: audioRecord?.size || null,
        files: fileRecords
      });
      console.log(`Contribution ${contribution.reference} enregistrée (${parsed.data.theme})`);
      return res.status(201).json({ id: contribution.id, reference: contribution.reference });
    } catch (error) {
      console.error('Contribution submission failed', error);
      return fail(res, 500, 'Votre contribution n’a pas pu être enregistrée. Réessayez dans quelques instants.');
    }
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// Les pages HTML ne sont jamais mises en cache : elles pointent vers des assets hachés.
app.use(express.static(dist, {
  index: 'index.html',
  setHeaders: (res, filePath) => res.setHeader('Cache-Control', filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=3600')
}));
app.get('/participer', (_req, res) => res.sendFile(path.join(dist, 'participer.html')));
app.get('/mentions', (_req, res) => res.sendFile(path.join(dist, 'mentions.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(dist, 'admin.html')));
app.get('/{*splat}', (_req, res) => res.status(404).sendFile(path.join(dist, '404.html')));

const port = Number(process.env.PORT || 3000);
ensureDatabase()
  .then(bootstrapAdmin)
  .then(() => app.listen(port, () => console.log(`CONGO DIALOGUE listening on ${port}`)))
  .catch(error => { console.error('Database initialization failed', error); process.exit(1); });
