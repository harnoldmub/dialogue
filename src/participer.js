import './style.css';
import './identity.css';
import './participer.css';
import './countries.css';
import { COUNTRY_CODES } from './countries.js';

const form = document.querySelector('#formulaire');
const alertBox = document.querySelector('#form-error');
const submitButton = form.querySelector('[type="submit"]');
const text = form.elements.textContent;
const count = document.querySelector('#text-count');
const filesInput = document.querySelector('#files');
const fileList = document.querySelector('#file-list');
const dropzone = document.querySelector('.dropzone');

/* Pays : liste ISO embarquée ; aucun appel réseau ne doit bloquer le formulaire. */
function setupCountrySearch(){
  const input=form.elements.country;if(!input)return;
  const label=input.closest('label'),provinceField=document.querySelector('#province-field');const toggleProvince=()=>{const isRdc=input.dataset.countryCode==='CD'||/^(république démocratique du congo|rdc|drc|democratic republic of the congo)$/i.test(input.value.trim());provinceField.hidden=!isRdc;if(!isRdc)form.elements.province.value=''};const picker=document.createElement('div');picker.className='country-picker';label.insertBefore(picker,input);picker.append(input);
  const flag=document.createElement('span');flag.className='country-flag';flag.textContent='🇨🇩';picker.append(flag);
  const results=document.createElement('ul');results.className='country-results';results.hidden=true;picker.append(results);
  const normalise=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const flagFor=code=>String.fromCodePoint(...[...code].map(letter=>127397+letter.charCodeAt(0)));
  const labels=typeof Intl.DisplayNames==='function'?new Intl.DisplayNames(['fr'],{type:'region'}):null;
  const names={CD:'République démocratique du Congo',CG:'République du Congo',CI:"Côte d’Ivoire",CZ:'Tchéquie',PS:'Palestine',XK:'Kosovo'};
  const countries=COUNTRY_CODES.map(code=>({code,name:names[code]||labels?.of(code)||code,flag:flagFor(code),search:code==='CD'?'RDC DRC Democratic Republic of the Congo':code})).sort((a,b)=>a.name.localeCompare(b.name,'fr'));
  const choose=country=>{input.value=country.name;input.dataset.countryCode=country.code;flag.textContent=country.flag||'🌐';results.hidden=true;toggleProvince()};
  const render=(query=input.value)=>{const term=normalise(query);const matches=countries.filter(country=>normalise(`${country.name} ${country.search}`).includes(term));results.innerHTML='';matches.forEach(country=>{const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.innerHTML=`<span class="country-option-flag">${country.flag||'🌐'}</span><span class="country-option-name">${country.name}</span><small>${country.code}</small>`;button.onclick=()=>choose(country);li.append(button);results.append(li)});results.hidden=!matches.length};
  input.placeholder='Rechercher un pays';input.autocomplete='off';input.addEventListener('focus',()=>{input.select();render('')});input.addEventListener('input',()=>{input.dataset.countryCode='';flag.textContent='🌐';toggleProvince();render()});input.addEventListener('blur',()=>setTimeout(()=>results.hidden=true,150));choose(countries.find(country=>country.code==='CD'));
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
const audioFile = document.querySelector('#audio-file');
const audioFileName = document.querySelector('#audio-file-name');
const level = document.querySelector('#level');
const microphoneGuidance = document.querySelector('#microphone-guidance');
const microphoneTitle = document.querySelector('#microphone-title');
const microphoneMessage = document.querySelector('#microphone-message');
const retryMicrophone = document.querySelector('#retry-microphone');
const microphoneHelp = document.querySelector('#microphone-help');
const microphoneInstructions = document.querySelector('#microphone-instructions');
const bars = [...level.querySelectorAll('b i')];
let recorder = null, elapsed = 0, ticker = null, previewUrl = null, isFinalizing = false;
let audioContext = null, meter = null, peak = 0, startedAt = 0, silentWarned = false, micLabel = '';

const getUserMediaAvailable = Boolean(navigator.mediaDevices?.getUserMedia);
const mediaRecorderAvailable = Boolean(window.MediaRecorder);
const recorderMimeTypes = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

function logMicrophoneError(stage, error){
  console.error(`[Microphone] ${stage}`, {
    name: error?.name || 'UnknownError',
    message: error?.message || 'Aucun détail fourni',
    constraint: error?.constraint || null
  });
}
function hideMicrophoneGuidance(){
  microphoneGuidance.hidden = true;
  microphoneInstructions.hidden = true;
  microphoneHelp.setAttribute('aria-expanded', 'false');
}
function showMicrophoneGuidance({ title, message, retry = true, instructions = false }){
  microphoneTitle.textContent = title;
  microphoneMessage.textContent = message;
  retryMicrophone.hidden = !retry;
  microphoneGuidance.hidden = false;
  microphoneInstructions.hidden = !instructions;
  microphoneHelp.setAttribute('aria-expanded', String(instructions));
}
function showMicrophoneError(error){
  const name = error?.name || 'UnknownError';
  const messages = {
    NotAllowedError: ['Microphone non autorisé', "Le microphone n'est pas autorisé pour ce site. Autorisez-le dans les réglages Safari, puis réessayez."],
    NotFoundError: ['Microphone introuvable', "Aucun microphone n'a été détecté. Branchez ou activez un microphone, puis réessayez."],
    NotReadableError: ['Microphone indisponible', "Le microphone est peut-être utilisé par une autre application ou un autre appel. Fermez-la, puis réessayez."],
    AbortError: ['Enregistrement interrompu', "L'accès au microphone a été interrompu. Réessayez."],
    SecurityError: ['Accès sécurisé requis', "Safari a bloqué l'accès au microphone pour des raisons de sécurité. Ouvrez cette page directement en HTTPS, sans navigation privée ni iframe."],
    OverconstrainedError: ['Configuration audio incompatible', "Les réglages audio demandés ne sont pas disponibles sur cet appareil. Réessayez."],
    TypeError: ['Microphone indisponible', "Le navigateur n'autorise pas l'accès au microphone depuis cette page. Vérifiez que l'adresse commence par https://."],
  };
  const [title, message] = messages[name] || ['Microphone indisponible', "Une erreur technique a empêché l'accès au microphone. Réessayez ou importez un fichier audio."];
  showMicrophoneGuidance({ title, message, retry: true });
  audioStatus.classList.add('warn');
  audioStatus.textContent = name === 'NotAllowedError'
    ? "Autorisez le microphone pour ce site, puis choisissez « Réessayer »."
    : 'Le microphone ne peut pas être utilisé pour le moment. Consultez les indications ci-dessus puis réessayez.';
}
function chooseRecorderMimeType(){
  if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return recorderMimeTypes.find(type => MediaRecorder.isTypeSupported(type));
}
function logRecorderDiagnostic(activeRecorder, recordingChunks, stream, finalBlob = null){
  console.log('[Voice recorder] finalisation', {
    recorderState: activeRecorder.state,
    mimeType: activeRecorder.mimeType,
    chunks: recordingChunks.length,
    chunkSizes: recordingChunks.map(chunk => chunk.size),
    blobSize: finalBlob?.size ?? null,
    streamActive: stream.active,
    audioTracks: stream.getAudioTracks().map(track => ({ enabled: track.enabled, muted: track.muted, readyState: track.readyState }))
  });
}

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

const renderTime = () => {
  timer.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
};
const startTicker = () => {
  clearInterval(ticker);
  ticker = setInterval(() => { elapsed++; renderTime(); if (elapsed >= MAX_SECONDS) finishRecording(); }, 1000);
};
function clearPreview(){
  preview.pause();
  preview.onloadedmetadata = null;
  preview.onerror = null;
  preview.removeAttribute('src');
  preview.load();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  preview.hidden = true;
}
function showRecording(blob){
  clearPreview();
  previewUrl = URL.createObjectURL(blob);
  preview.onloadedmetadata = () => {
    // Certains navigateurs mettent à jour la durée après le premier chargement.
    if (Number.isFinite(preview.duration) && preview.duration > 0) audio.duration = Math.ceil(preview.duration);
  };
  preview.onerror = () => {
    preview.hidden = true;
    showMicrophoneGuidance({
      title: 'Lecture audio indisponible',
      message: "Cette note ne peut pas être lue sur cet appareil. Vous pouvez l'enregistrer autrement puis importer le fichier audio.",
      retry: false
    });
    audioStatus.classList.add('warn');
    audioStatus.textContent = 'La note enregistrée ne peut pas être lue sur cet appareil.';
  };
  preview.src = previewUrl;
  preview.hidden = false;
  // Charge explicitement les métadonnées : indispensable sur Safari après un Blob récent.
  preview.load();
}
function finishRecording(){
  if (!recorder || recorder.state === 'inactive' || isFinalizing) return;
  isFinalizing = true;
  clearInterval(ticker);
  // Safari/iOS finalise le dernier fragment à stop(). Ne pas appeler requestData() juste avant :
  // cette course pouvait laisser le tampon final vide sur certains appareils.
  try { recorder.stop(); }
  catch (error) {
    isFinalizing = false;
    logMicrophoneError('recorder-stop', error);
    audioStatus.classList.add('warn');
    audioStatus.textContent = "L'enregistrement n'a pas pu être finalisé. Réessayez.";
    return;
  }
  record.hidden = true;
  pause.hidden = true; stop.hidden = true; dot.hidden = true;
  pause.textContent = 'Mettre en pause';
  audioStatus.classList.remove('warn');
  audioStatus.textContent = 'Finalisation de votre note vocale…';
}

async function startRecording(){
  if (!window.isSecureContext) {
    const error = new DOMException('A secure context is required.', 'SecurityError');
    logMicrophoneError('secure-context', error);
    showMicrophoneError(error);
    return;
  }
  if (!getUserMediaAvailable) {
    showMicrophoneGuidance({
      title: 'Enregistrement non disponible',
      message: "Ce navigateur ne permet pas l'accès au microphone depuis cette page. Vous pouvez importer un fichier audio.",
      retry: false
    });
    return;
  }
  if (!mediaRecorderAvailable) {
    showMicrophoneGuidance({
      title: 'Enregistrement non compatible',
      message: "Le microphone est accessible, mais ce navigateur ne peut pas créer de fichier audio. Vous pouvez importer un fichier audio.",
      retry: false
    });
    return;
  }
  audioStatus.classList.remove('warn');
  audioStatus.textContent = 'Autorisation du microphone en cours…';
  hideMicrophoneGuidance();
  let stream;
  try {
    // Appelé exclusivement depuis le clic « Démarrer » ou « Réessayer ».
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mimeType = chooseRecorderMimeType();
    const activeRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder = activeRecorder;
    const recordingChunks = [];
    elapsed = 0; renderTime();
    activeRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) recordingChunks.push(event.data);
      console.log('[Voice recorder] dataavailable', { size: event.data?.size || 0, type: event.data?.type || activeRecorder.mimeType, chunks: recordingChunks.length });
    };
    activeRecorder.onstop = async () => {
      // Safari peut émettre le dernier dataavailable à la fin de la file d'événements de stop.
      await new Promise(resolve => setTimeout(resolve, 120));
      // Le type du fragment est la source fiable : recorder.mimeType peut être vide sur iOS.
      const recordedType = recordingChunks.find(chunk => chunk.type)?.type || activeRecorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(recordingChunks, { type: recordedType });
      logRecorderDiagnostic(activeRecorder, recordingChunks, stream, blob);
      // Les tracks restent vivantes jusqu'ici : elles ne doivent jamais être arrêtées avant le Blob final.
      stopMeter();
      stream.getTracks().forEach(track => track.stop());
      recorder = null;
      isFinalizing = false;
      record.hidden = false;
      record.textContent = 'Enregistrer une nouvelle version';
      if (!blob.size) {
        audioStatus.classList.add('warn');
        audioStatus.textContent = "Le navigateur n'a pas finalisé le fichier audio. Le microphone a bien été détecté ; recommencez l'enregistrement.";
        return;
      }
      audio = { blob, duration: elapsed };
      showRecording(blob);
      removeAudio.hidden = false;
      audioStatus.classList.remove('warn');
      audioStatus.textContent = `Votre note vocale — ${timer.textContent}. Écoutez-la avant l’envoi.`;
      checkBlobAudio(blob);
    };
    activeRecorder.start();
    startTicker();
    record.hidden = true; pause.hidden = false; stop.hidden = false; dot.hidden = false;
    const track = stream.getAudioTracks()[0];
    micLabel = track?.label || '';
    audioStatus.textContent = micLabel
      ? `Enregistrement en cours sur « ${micLabel} ». Parlez normalement, à environ vingt centimètres du micro.`
      : 'Enregistrement en cours. Parlez normalement, à environ vingt centimètres du micro.';
    // La jauge est facultative : son indisponibilité ne doit jamais interrompre l'enregistrement.
    startMeter(stream).catch(error => logMicrophoneError('audio-meter', error));
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    logMicrophoneError('get-user-media-or-recorder', error);
    showMicrophoneError(error);
    record.hidden = false;
  }
}

if (!getUserMediaAvailable || !mediaRecorderAvailable) {
  record.hidden = true;
  showMicrophoneGuidance({
    title: 'Enregistrement non disponible',
    message: !getUserMediaAvailable
      ? "Ce navigateur ne permet pas l'accès au microphone depuis cette page. Vous pouvez importer un fichier audio."
      : "Ce navigateur ne peut pas créer de fichier audio. Vous pouvez importer un fichier audio.",
    retry: false
  });
}
record?.addEventListener('click', startRecording);
retryMicrophone?.addEventListener('click', startRecording);
microphoneHelp?.addEventListener('click', () => {
  const expanded = microphoneHelp.getAttribute('aria-expanded') === 'true';
  microphoneHelp.setAttribute('aria-expanded', String(!expanded));
  microphoneInstructions.hidden = expanded;
});
pause?.addEventListener('click', () => {
  if (!recorder) return;
  try {
    if (recorder.state === 'recording') { recorder.pause(); clearInterval(ticker); pause.textContent = 'Reprendre'; dot.hidden = true; level.hidden = true; audioStatus.textContent = 'Enregistrement en pause.'; }
    else if (recorder.state === 'paused') { recorder.resume(); startTicker(); pause.textContent = 'Mettre en pause'; dot.hidden = false; level.hidden = false; audioStatus.textContent = 'Enregistrement en cours.'; }
  } catch (error) {
    logMicrophoneError('pause-resume', error);
    audioStatus.classList.add('warn');
    audioStatus.textContent = 'La mise en pause n’est pas disponible sur cet appareil. Vous pouvez terminer puis écouter la note.';
  }
});
stop?.addEventListener('click', finishRecording);
removeAudio?.addEventListener('click', () => {
  audio = { blob: null, duration: 0 };
  clearPreview(); removeAudio.hidden = true;
  elapsed = 0; renderTime();
  audioStatus.textContent = 'Enregistrement supprimé.';
});
audioFile?.addEventListener('change', () => {
  const file = audioFile.files[0];
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) { audioStatus.classList.add('warn'); audioStatus.textContent = `${file.name} dépasse la limite de 10 Mo.`; audioFile.value = ''; return; }
  audio = { blob: file, duration: 0 };
  audioStatus.classList.remove('warn');
  audioFileName.textContent = file.name;
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
    // La jauge et le recorder reçoivent le même MediaStream. Si la jauge a capté du son,
    // un décodage Safari incomplet ne doit pas faire passer la note pour silencieuse.
    if (max < 0.005 && peak < 0.008) {
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
