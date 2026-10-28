// Funções puras sobre o formato das mensagens do WhatsApp (sem conexão, testáveis).

export const EXT = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

// extensão do arquivo salvo a partir do mimetype ("audio/ogg; codecs=opus" -> "ogg")
export function extensao(mime) {
  const base = String(mime || '').split(';')[0].trim();
  return EXT[base] || base.split('/')[1] || 'bin';
}

// tipo + texto de uma mensagem já "desembrulhada" (efêmera, ver uma vez etc.)
export function classificar(m) {
  if (!m) return null;
  if (m.conversation) return { tipo: 'texto', texto: m.conversation };
  if (m.extendedTextMessage) return { tipo: 'texto', texto: m.extendedTextMessage.text };
  if (m.audioMessage) return { tipo: 'audio', media: m.audioMessage, dur: m.audioMessage.seconds, texto: m.audioMessage.ptt ? 'voz' : 'áudio' };
  if (m.videoMessage) return { tipo: 'video', media: m.videoMessage, dur: m.videoMessage.seconds, texto: m.videoMessage.caption };
  if (m.imageMessage) return { tipo: 'imagem', media: m.imageMessage, texto: m.imageMessage.caption };
  if (m.documentMessage) return { tipo: 'documento', media: m.documentMessage, texto: [m.documentMessage.fileName, m.documentMessage.caption].filter(Boolean).join(' — ') };
  if (m.stickerMessage) return { tipo: 'figurinha' };
  if (m.locationMessage) return { tipo: 'outro', texto: `localização ${m.locationMessage.degreesLatitude},${m.locationMessage.degreesLongitude}` };
  if (m.contactMessage) return { tipo: 'outro', texto: `contato ${m.contactMessage.displayName}` };
  const enq = m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3;
  if (enq) return { tipo: 'enquete', texto: `enquete: ${enq.name}` };
  return null; // reações, protocolo etc. são ignorados
}

// mensagem que responde/reage a um status nosso (o WhatsApp cita o status com remoteJid "status@broadcast"):
// devolve o texto do status citado (ou "[imagem]" etc.), ou null se não for resposta a status
export function statusCitado(m) {
  const ci = Object.values(m || {}).find((v) => v && typeof v === 'object' && v.contextInfo?.remoteJid === 'status@broadcast')?.contextInfo;
  if (!ci) return null;
  const q = classificar(ci.quotedMessage);
  return String(q?.texto || `[${q?.tipo || 'status'}]`).slice(0, 300);
}
export const respondeStatus = (m) => statusCitado(m) !== null;

// Prefere o número (@s.whatsapp.net) ao LID quando o protocolo informa os dois.
export function jidChat(key) {
  const a = key?.remoteJid || '';
  const alt = key?.remoteJidAlt || '';
  return a.endsWith('@lid') && alt.endsWith('@s.whatsapp.net') ? alt : a;
}
