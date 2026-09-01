import './style.css';
import './identity.css';
import './participer.css';
import './countries.css';

const form = document.querySelector('#formulaire');
const alertBox = document.querySelector('#form-error');
const submitButton = form.querySelector('[type="submit"]');
const text = form.elements.textContent;
const count = document.querySelector('#text-count');
const filesInput = document.querySelector('#files');
const fileList = document.querySelector('#file-list');
const dropzone = document.querySelector('.dropzone');

/* Pays : REST Countries, mis en mémoire une fois pour une recherche instantanée. */
async function setupCountrySearch(){
  const input=form.elements.country;if(!input)return;
  const label=input.closest('label'),provinceField=document.querySelector('#province-field');const toggleProvince=()=>{const isRdc=input.dataset.countryCode==='CD'||/^(république démocratique du congo|rdc|drc|democratic republic of the congo)$/i.test(input.value.trim());provinceField.hidden=!isRdc;if(!isRdc)form.elements.province.value=''};const picker=document.createElement('div');picker.className='country-picker';label.insertBefore(picker,input);picker.append(input);
  const flag=document.createElement('span');flag.className='country-flag';flag.textContent='🇨🇩';picker.append(flag);
  const results=document.createElement('ul');results.className='country-results';results.hidden=true;picker.append(results);
  const note=document.createElement('p');note.className='country-loading';note.textContent='Chargement des pays…';label.append(note);let countries=[];
  const normalise=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const choose=country=>{input.value=country.name;input.dataset.countryCode=country.code;flag.textContent=country.flag||'🌐';results.hidden=true;toggleProvince()};
  const render=()=>{const term=normalise(input.value);const matches=countries.filter(country=>normalise(`${country.name} ${country.search}`).includes(term)).slice(0,80);results.innerHTML='';matches.forEach(country=>{const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.innerHTML=`<span>${country.flag||'🌐'}</span>${country.name}<small>${country.code}</small>`;button.onclick=()=>choose(country);li.append(button);results.append(li)});results.hidden=!matches.length};
  input.placeholder='Rechercher un pays';input.autocomplete='off';input.addEventListener('focus',render);input.addEventListener('input',()=>{input.dataset.countryCode='';flag.textContent='🌐';toggleProvince();render()});input.addEventListener('blur',()=>setTimeout(()=>results.hidden=true,150));toggleProvince();
  try{const response=await fetch('https://restcountries.com/v3.1/all?fields=name,translations,cca2,flag');if(!response.ok)throw new Error();const raw=await response.json();countries=raw.map(item=>({name:item.translations?.fra?.common||item.name?.common,search:[item.name?.common,item.translations?.fra?.official].filter(Boolean).join(' '),code:item.cca2,flag:item.flag})).filter(item=>item.name&&item.code).sort((a,b)=>a.name.localeCompare(b.name,'fr'));note.remove();choose(countries.find(country=>country.code==='CD')||countries[0])}catch{note.textContent='Recherche momentanément indisponible : saisissez votre pays.';flag.textContent='🌐'}
}
setupCountrySearch();

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;
const MAX_SECONDS = 600;
let selectedFiles = [];
let audio = { blob: null, duration: 0 };
let sending = false;

/* — Messages de validation en français, par champ. — */
const LABELS = {
  firstName: 'Indiquez votre prénom.', lastName: 'Indiquez votre nom.',
  email: 'Indiquez une adresse électronique valide, par exemple nom@exemple.cd.',
  country: 'Indiquez votre pays de résidence.', city: 'Indiquez votre ville ou votre territoire.',
  theme: 'Choisissez une thématique.', consent: 'Vous devez accepter le traitement de votre contribution pour l’envoyer.'
};
function showFieldError(field, message){
  field.setAttribute('aria-invalid', 'true');
  const holder = field.closest('label') || field.parentElement;
  let node = holder.querySelector('.field-error');
  if (!node) { node = document.createElement('span'); node.className = 'field-error'; holder.append(node); }
  node.textContent = message;
}
function clearFieldError(field){
  field.removeAttribute('aria-invalid');
  (field.closest('label') || field.parentElement).querySelector('.field-error')?.remove();
}
form.addEventListener('input', event => { if (event.target.getAttribute('aria-invalid')) clearFieldError(event.target); });

function validate(){
  const invalid = [];
  for (const [name, message] of Object.entries(LABELS)) {
    const field = form.elements[name];
    if (!field) continue;
    clearFieldError(field);
    const empty = field.type === 'checkbox' ? !field.checked : !field.value.trim();
    const badEmail = name === 'email' && field.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(field.value.trim());
    if (empty || badEmail) { showFieldError(field, message); invalid.push(field); }
  }
  return invalid;
}

/* — Format A : texte — */
text.addEventListener('input', () => {
  count.textContent = `${text.value.length.toLocaleString('fr-FR')} / 20 000 caractères`;
});

/* — Format B : note vocale — */
const record = document.querySelector('#record-button');
const pause = document.querySelector('#pause-button');
const stop = document.querySelector('#stop-button');
const timer = document.querySelector('#recording-time');
const dot = document.querySelector('#recording-dot');
const preview = document.querySelector('#audio-preview');
const removeAudio = document.querySelector('#remove-audio');
const audioStatus = document.querySelector('#audio-status');
const fallback = document.querySelector('#audio-fallback');
const audioFile = document.querySelector('#audio-file');
const level = document.querySelector('#level');
const bars = [...level.querySelectorAll('b i')];
let recorder = null, chunks = [], elapsed = 0, ticker = null;
let audioContext = null, meter = null, peak = 0, startedAt = 0, silentWarned = false, micLabel = '';

/* Un micro muet produit un fichier parfaitement valide mais inaudible : on montre le
   niveau capté en direct et on prévient si rien n'a été enregistré. */
async function startMeter(stream){
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  // Après l'attente de l'autorisation micro, le contexte démarre suspendu : sans reprise,
  // l'analyseur ne lit que des zéros et la jauge reste plate à tort.
  if (audioContext.state === 'suspended') await audioContext.resume();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  audioContext.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  peak = 0; startedAt = Date.now(); silentWarned = false;
  level.hidden = false;
  const draw = () => {
    if (!audioContext) return;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const rms = Math.sqrt(sum / samples.length);
    if (recorder?.state === 'recording') peak = Math.max(peak, rms);
    const active = Math.min(bars.length, Math.round(Math.sqrt(rms) * 2.4 * bars.length));
    bars.forEach((bar, index) => {
      const on = index < active;
      bar.classList.toggle('on', on);
      bar.style.height = `${4 + (on ? index + 1 : 0) * 1.5}px`;
    });
    // Prévenir pendant l'enregistrement plutôt qu'après six minutes perdues.
    if (recorder?.state === 'recording' && Date.now() - startedAt > 2500) {
      const muet = peak < 0.008;
      if (muet !== silentWarned) {
        silentWarned = muet;
        audioStatus.classList.toggle('warn', muet);
        audioStatus.textContent = muet
          ? `Aucun son n’est capté pour l’instant${micLabel ? ` sur « ${micLabel} »` : ''} : vérifiez l’entrée sélectionnée et son volume dans les réglages de votre appareil.`
          : 'Enregistrement en cours. Continuez, le son est capté.';
      }
    }
    meter = requestAnimationFrame(draw);
  };
  draw();
}
function stopMeter(){
  cancelAnimationFrame(meter);
  audioContext?.close();
  audioContext = null;
  level.hidden = true;
  bars.forEach(bar => { bar.classList.remove('on'); bar.style.height = ''; });
}

const canRecord = Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
if (!canRecord) { record.hidden = true; fallback.hidden = false; }

const renderTime = () => {
  timer.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
};
const startTicker = () => {
  ticker = setInterval(() => { elapsed++; renderTime(); if (elapsed >= MAX_SECONDS) finishRecording(); }, 1000);
};
function finishRecording(){
  clearInterval(ticker);
  stopMeter();
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  record.hidden = false; record.textContent = 'Reprendre un nouvel enregistrement';
  pause.hidden = true; stop.hidden = true; dot.hidden = true;
  pause.textContent = 'Mettre en pause';
}

record?.addEventListener('click', async () => {
  audioStatus.classList.remove('warn');
  audioStatus.textContent = 'Autorisation du microphone en cours…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    // isTypeSupported doit être appelée sur MediaRecorder, jamais détachée de son objet.
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = []; elapsed = 0; renderTime();
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (!blob.size) { audioStatus.classList.add('warn'); audioStatus.textContent = 'Aucun son n’a été capté. Vérifiez votre microphone puis recommencez.'; return; }
      audio = { blob, duration: elapsed };
      preview.src = URL.createObjectURL(blob);
      preview.hidden = false; removeAudio.hidden = false;
      audioStatus.classList.remove('warn');
      audioStatus.textContent = `Note vocale prête à être envoyée (${timer.textContent}). Écoutez-la ci-dessous avant l’envoi.`;
      checkBlobAudio(blob);
    };
    await startMeter(stream);
    recorder.start(1000);
    startTicker();
    record.hidden = true; pause.hidden = false; stop.hidden = false; dot.hidden = false;
    const track = stream.getAudioTracks()[0];
    micLabel = track?.label || '';
    audioStatus.textContent = micLabel
      ? `Enregistrement en cours sur « ${micLabel} ». Parlez normalement, à environ vingt centimètres du micro.`
      : 'Enregistrement en cours. Parlez normalement, à environ vingt centimètres du micro.';
  } catch (error) {
    audioStatus.classList.add('warn');
    audioStatus.textContent = error?.name === 'NotAllowedError'
      ? 'L’accès au microphone a été refusé. Autorisez-le dans votre navigateur ou envoyez un fichier audio ci-dessous.'
      : 'L’enregistrement n’est pas disponible sur cet appareil. Envoyez un fichier audio ci-dessous.';
    fallback.hidden = false;
    record.hidden = false;
  }
});
pause?.addEventListener('click', () => {
  if (!recorder) return;
  if (recorder.state === 'recording') { recorder.pause(); clearInterval(ticker); pause.textContent = 'Reprendre'; dot.hidden = true; level.hidden = true; audioStatus.textContent = 'Enregistrement en pause.'; }
  else { recorder.resume(); startTicker(); pause.textContent = 'Mettre en pause'; dot.hidden = false; level.hidden = false; audioStatus.textContent = 'Enregistrement en cours.'; }
});
stop?.addEventListener('click', finishRecording);
removeAudio?.addEventListener('click', () => {
  audio = { blob: null, duration: 0 };
  preview.hidden = true; preview.removeAttribute('src'); removeAudio.hidden = true;
  elapsed = 0; renderTime();
  audioStatus.textContent = 'Enregistrement supprimé.';
});
audioFile?.addEventListener('change', () => {
  const file = audioFile.files[0];
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) { audioStatus.classList.add('warn'); audioStatus.textContent = `${file.name} dépasse la limite de 10 Mo.`; audioFile.value = ''; return; }
  audio = { blob: file, duration: 0 };
  audioStatus.classList.remove('warn');
  audioStatus.textContent = `${file.name} sera envoyé comme note vocale.`;
});

/* Vérification sur le fichier lui-même : c'est la seule mesure qui fasse foi. */
async function checkBlobAudio(blob){
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    let max = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i += 64) max = Math.max(max, Math.abs(data[i]));
    }
    context.close();
    if (max < 0.005) {
      audioStatus.classList.add('warn');
      audioStatus.textContent = `La note enregistrée est silencieuse${micLabel ? ` : « ${micLabel} » n’a transmis aucun son` : ''}. Vérifiez l’entrée micro et son volume dans les réglages de votre appareil, puis recommencez.`;
    }
  } catch {
    // Décodage impossible : on laisse l'écoute manuelle trancher.
  }
}

/* — Format C : documents — */
function renderFiles(){
  fileList.innerHTML = '';
  selectedFiles.forEach((file, index) => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.innerHTML = `${file.name} <small>${(file.size / 1024 / 1024).toFixed(2)} Mo</small>`;
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'btn-sm quiet'; remove.textContent = 'Retirer';
    remove.addEventListener('click', () => { selectedFiles.splice(index, 1); renderFiles(); });
    item.append(name, remove);
    fileList.append(item);
  });
}
function addFiles(files){
  for (const file of files) {
    if (selectedFiles.length >= MAX_FILES) { alertBox.textContent = `Cinq fichiers au maximum. ${file.name} n’a pas été ajouté.`; break; }
    if (file.size > MAX_FILE_BYTES) { alertBox.textContent = `${file.name} dépasse la limite de 10 Mo par fichier.`; continue; }
    if (!/\.(pdf|docx?|txt|jpe?g|png)$/i.test(file.name)) { alertBox.textContent = `${file.name} n’est pas dans un format accepté.`; continue; }
    if (selectedFiles.some(existing => existing.name === file.name && existing.size === file.size)) continue;
    selectedFiles.push(file);
  }
  renderFiles();
  filesInput.value = '';
}
filesInput.addEventListener('change', () => addFiles(filesInput.files));
['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add('over'); }));
['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, () => dropzone.classList.remove('over')));
dropzone.addEventListener('drop', event => { event.preventDefault(); addFiles(event.dataTransfer.files); });

/* — Notice de traitement : modale, pour ne pas quitter un formulaire en cours de saisie. — */
const notice = document.querySelector('#notice');
document.querySelector('#open-notice')?.addEventListener('click', () => notice.showModal());
document.querySelectorAll('#close-notice, [data-close-notice]').forEach(button => button.addEventListener('click', () => notice.close()));
notice?.addEventListener('click', event => { if (event.target === notice) notice.close(); });

/* — Envoi — */
async function readError(response){
  try { const payload = await response.json(); if (payload?.error) return payload.error; } catch { /* réponse non JSON */ }
  if (response.status === 413) return 'Vos fichiers dépassent la taille autorisée. Réduisez-les puis réessayez.';
  if (response.status === 429) return 'Trop de tentatives depuis cet appareil. Réessayez dans quelques minutes.';
  return 'Votre contribution n’a pas pu être enregistrée. Réessayez dans quelques instants.';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending) return;
  alertBox.textContent = '';

  const invalid = validate();
  if (invalid.length) {
    alertBox.textContent = 'Certaines informations obligatoires sont manquantes ou incorrectes. Elles sont signalées ci-dessus.';
    invalid[0].focus({ preventScroll: true });
    invalid[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (!text.value.trim() && !audio.blob && !selectedFiles.length) {
    alertBox.textContent = 'Ajoutez au moins un format : un texte, une note vocale ou un document.';
    text.focus();
    return;
  }

  sending = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Envoi en cours…';
  try {
    const data = new FormData(form);
    data.delete('files');
    selectedFiles.forEach(file => data.append('files', file));
    if (audio.blob) {
      const extension = (audio.blob.type || '').includes('mp4') ? 'm4a' : (audio.blob.name?.split('.').pop() || 'webm');
      data.append('audio', audio.blob, `contribution.${extension}`);
      if (audio.duration) data.append('audioDuration', String(audio.duration));
    }
    const response = await fetch('/api/contributions', { method: 'POST', body: data });
    if (!response.ok) throw new Error(await readError(response));
    const payload = await response.json();
    document.querySelector('#reference').textContent = payload.reference;
    document.querySelector('.form-layout').hidden = true;
    document.querySelector('#intro').hidden = true;
    const confirmation = document.querySelector('#confirmation');
    confirmation.hidden = false;
    confirmation.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    alertBox.textContent = error.message || 'La connexion a échoué. Vérifiez votre réseau puis réessayez.';
    alertBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } finally {
    sending = false;
    submitButton.disabled = false;
    submitButton.innerHTML = 'Envoyer ma contribution <span class="arw" aria-hidden="true">→</span>';
  }
});
