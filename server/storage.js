import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';import crypto from 'node:crypto';
const configured=Boolean(process.env.S3_BUCKET&&process.env.S3_ENDPOINT&&process.env.S3_ACCESS_KEY_ID&&process.env.S3_SECRET_ACCESS_KEY);
const s3=configured?new S3Client({region:process.env.S3_REGION||'auto',endpoint:process.env.S3_ENDPOINT,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY},forcePathStyle:process.env.S3_FORCE_PATH_STYLE==='true'}):null;
export async function putUpload(contributionId,folder,file){const ext=path.extname(file.originalname).toLowerCase();const key=`contributions/${contributionId}/${folder}/${crypto.randomUUID()}${ext}`;if(s3)await s3.send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Body:file.buffer,ContentType:file.mimetype}));else{await mkdir(path.join('data','uploads',path.dirname(key)),{recursive:true});await writeFile(path.join('data','uploads',key),file.buffer)}return {storageKey:key,originalName:file.originalname.replace(/[^\w. -]/g,'_'),mimeType:file.mimetype,size:file.size}}
