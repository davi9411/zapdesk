// Listener: recebe mensagens, grava no SQLite e baixa a mídia. Não marca "online" e não lê (sem visto azul).
// Só envia o que estiver na fila "outbox", que é preenchida exclusivamente por "wa enviar" (comando explícito do usuário).
import makeWASocket, * as B from '@whiskeysockets/baileys';
import pino from 'pino';
import { writeFileSync, mkdirSync, unlinkSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { PATHS, MAX_MIDIA_MB, garantirPastas, pidDeOutroBoot } from './config.mjs';
import { abrirDb } from './db.mjs';

const { useMultiFileAuthState, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, Browsers } = B;

garantirPastas();
const db = abrirDb();
const logger = pino({ level: 'warn' }, pino.destination({ dest: PATHS.log, sync: false }));
const log = (...a) => logger.warn(a.join(' '));

// ---------- liga/desliga ----------
// Instância única: duas conexões com a mesma sessão se derrubam (erro 440). Se já há um listener vivo, sai.
try {
  const outro = Number(readFileSync(PATHS.pid, 'utf8'));
  if (outro && outro !== process.pid && !pidDeOutroBoot() && /node\.exe/i.test(execFileSync('tasklist', ['/FI', `PID eq ${outro}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }))) {
    console.error(`Já existe um listener rodando (PID ${outro}); este foi encerrado.`);
    process.exit(0);
  }
} catch {}
writeFileSync(PATHS.pid, String(process.pid));
const sair = (cod = 0) => {
  try { if (readFileSync(PATHS.pid, 'utf8') === String(process.pid)) unlinkSync(PATHS.pid); } catch {}
  process.exit(cod);
};
process.on('SIGTERM', () => sair(0));
process.on('SIGINT', () => sair(0));
const autoOffMin = Number(process.env.WA_AUTO_OFF_MIN || 0);
const pendentesFila = db.prepare(`SELECT COUNT(*) n FROM outbox WHERE status IN ('pendente','enviando')`);
function agendarAutoOff(ms) {
  setTimeout(() => {
    // não desliga enquanto houver envio programado esperando a hora
    if (pendentesFila.get().n > 0) { log('auto-desligar adiado: há envio na fila'); agendarAutoOff(5 * 60_000); return; }
    log(`auto-desligar após ${autoOffMin} min`); sair(0);
  }, ms);
}
if (autoOffMin > 0) agendarAutoOff(autoOffMin * 60_000);

// ---------- helpers ----------
const EXT = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const num = (v) => (v == null ? 0 : typeof v === 'number' ? v : typeof v.toNumber === 'function' ? v.toNumber() : Number(v));
const seguro = (s) => String(s).replace(/[^\w.-]+/g, '_').slice(0, 60);

const upChat = db.prepare(`INSERT INTO chats (jid, nome, grupo, ultima_ts) VALUES (?, ?, ?, ?)
  ON CONFLICT(jid) DO UPDATE SET nome = COALESCE(excluded.nome, nome), ultima_ts = MAX(ultima_ts, excluded.ultima_ts)`);
const setNome = db.prepare(`UPDATE chats SET nome = ? WHERE jid = ?`);
const getChat = db.prepare(`SELECT nome FROM chats WHERE jid = ?`);
const insMsg = db.prepare(`INSERT OR IGNORE INTO msgs (chat, id, ts, meu, de, tipo, texto, arquivo, mime, dur) VALUES (?,?,?,?,?,?,?,?,?,?)`);
const jaTem = db.prepare(`SELECT 1 FROM msgs WHERE chat = ? AND id = ?`);

function desembrulhar(m) {
  if (!m) return null;
  return (B.normalizeMessageContent ? B.normalizeMessageContent(m) : m) || m;
}

function classificar(m) {
  if (m.conversation) return { tipo: 'texto', texto: m.conversation };
  if (m.extendedTextMessage) return { tipo: 'texto', texto: m.extendedTextMessage.text };
  if (m.audioMessage) return { tipo: 'audio', media: m.audioMessage, dur: m.audioMessage.seconds, texto: m.audioMessage.ptt ? 'voz' : 'áudio' };
  if (m.videoMessage) return { tipo: 'video', media: m.videoMessage, dur: m.videoMessage.seconds, texto: m.videoMessage.caption };
  if (m.imageMessage) return { tipo: 'imagem', media: m.imageMessage, texto: m.imageMessage.caption };
  if (m.documentMessage) return { tipo: 'documento', media: m.documentMessage, texto: [m.documentMessage.fileName, m.documentMessage.caption].filter(Boolean).join(' — ') };
  if (m.stickerMessage) return { tipo: 'figurinha' };
  if (m.locationMessage) return { tipo: 'outro', texto: `localização ${m.locationMessage.degreesLatitude},${m.locationMessage.degreesLongitude}` };
  if (m.contactMessage) return { tipo: 'outro', texto: `contato ${m.contactMessage.displayName}` };
  if (m.pollCreationMessage) return { tipo: 'outro', texto: `enquete: ${m.pollCreationMessage.name}` };
  return null; // reações, protocolo etc. são ignorados
}

// Prefere o número (@s.whatsapp.net) ao LID quando o protocolo informa os dois.
function jidChat(key) {
  const a = key.remoteJid || '';
  const alt = key.remoteJidAlt || '';
  return a.endsWith('@lid') && alt.endsWith('@s.whatsapp.net') ? alt : a;
}

let sock;
async function nomeGrupo(jid) {
  const r = getChat.get(jid);
  if (r?.nome) return r.nome;
  try { const g = await sock.groupMetadata(jid); setNome.run(g.subject, jid); return g.subject; } catch { return null; }
}

function guardarContato(ct) {
  const n = ct.name || ct.notify;
  if (n && ct.id && !ct.id.endsWith('@g.us')) { upChat.run(ct.id, n, 0, 0); setNome.run(n, ct.id); }
}

async function salvar(msg, { baixar }) {
  const key = msg.key;
  if (!key?.remoteJid || key.remoteJid === 'status@broadcast' || key.remoteJid.endsWith('@newsletter')) return;
  const jid = jidChat(key);
  const grupo = jid.endsWith('@g.us') ? 1 : 0;
  const ts = num(msg.messageTimestamp) || Math.floor(Date.now() / 1000);
  const conteudo = desembrulhar(msg.message);
  const c = conteudo && classificar(conteudo);
  if (!c) return;
  if (jaTem.get(jid, key.id)) return;

  const nome = grupo ? await nomeGrupo(jid) : (!key.fromMe && msg.pushName ? msg.pushName : null);
  upChat.run(jid, nome, grupo, ts);

  let arquivo = null;
  const mime = c.media?.mimetype || null;
  if (c.media && baixar) {
    const bytes = num(c.media.fileLength);
    if (bytes && bytes > MAX_MIDIA_MB * 1024 * 1024) {
      log(`mídia ${key.id} ignorada (${Math.round(bytes / 1048576)} MB > ${MAX_MIDIA_MB} MB)`);
    } else {
      try {
        const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
        const pasta = join(PATHS.midia, seguro(jid));
        mkdirSync(pasta, { recursive: true });
        const base = (mime || '').split(';')[0];
        const ext = EXT[base] || base.split('/')[1] || 'bin';
        arquivo = join(pasta, `${ts}_${seguro(key.id)}.${ext}`);
        writeFileSync(arquivo, buf);
      } catch (e) { log(`falha ao baixar mídia ${key.id}: ${e.message}`); }
    }
  }
  const de = key.fromMe ? 'eu' : (msg.pushName || key.participantAlt || key.participant || jid);
  insMsg.run(jid, key.id, ts, key.fromMe ? 1 : 0, de, c.tipo, c.texto ?? null, arquivo, mime, c.dur ? num(c.dur) : null);
}

// ---------- envio (fila "outbox", preenchida só por "wa enviar", comando explícito do usuário) ----------
const MIME = { pdf: 'application/pdf', zip: 'application/zip', ex5: 'application/octet-stream', mq5: 'text/plain', set: 'text/plain', txt: 'text/plain', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4', ogg: 'audio/ogg', mp3: 'audio/mpeg' };
const ATRASO_MAX_S = Number(process.env.WA_ATRASO_MAX_MIN || 30) * 60; // envio programado vencido há mais que isso NÃO sai
const venceu = db.prepare(`SELECT * FROM outbox WHERE status = 'pendente' AND enviar_em <= ? ORDER BY enviar_em, id LIMIT 5`);
const marcar = db.prepare(`UPDATE outbox SET status = ?, enviado_em = ?, erro = ? WHERE id = ?`);
const travar = db.prepare(`UPDATE outbox SET status = 'enviando' WHERE id = ? AND status = 'pendente'`);
let conectado = false;
let enviando = false;

async function enviarItem(it) {
  const jid = it.chat;
  const arquivos = it.arquivos ? JSON.parse(it.arquivos) : [];
  const texto = it.texto || '';
  if (arquivos.length === 1) {
    const f = arquivos[0];
    const ext = f.split('.').pop().toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const nome = f.split(/[\\/]/).pop();
    if (mime.startsWith('image/')) await sock.sendMessage(jid, { image: { url: f }, caption: texto || undefined });
    else if (mime.startsWith('video/')) await sock.sendMessage(jid, { video: { url: f }, caption: texto || undefined });
    else await sock.sendMessage(jid, { document: { url: f }, fileName: nome, mimetype: mime, caption: texto || undefined });
    return;
  }
  if (texto) await sock.sendMessage(jid, { text: texto });
  for (const f of arquivos) {
    const ext = f.split('.').pop().toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const nome = f.split(/[\\/]/).pop();
    if (mime.startsWith('image/')) await sock.sendMessage(jid, { image: { url: f } });
    else if (mime.startsWith('video/')) await sock.sendMessage(jid, { video: { url: f } });
    else await sock.sendMessage(jid, { document: { url: f }, fileName: nome, mimetype: mime });
  }
}

async function processarFila() {
  if (!conectado || enviando) return;
  enviando = true;
  try {
    const agora = Math.floor(Date.now() / 1000);
    for (const it of venceu.all(agora)) {
      if (agora - it.enviar_em > ATRASO_MAX_S) { marcar.run('atrasada', null, `venceu há ${Math.round((agora - it.enviar_em) / 60)} min com o leitor desligado`, it.id); continue; }
      if (travar.run(it.id).changes !== 1) continue;
      try { await enviarItem(it); marcar.run('enviada', Math.floor(Date.now() / 1000), null, it.id); log(`enviado #${it.id}`); }
      catch (e) { marcar.run('falhou', null, e.message, it.id); log(`falha ao enviar #${it.id}: ${e.message}`); }
    }
  } finally { enviando = false; }
}
setInterval(() => processarFila().catch((e) => log('erro na fila', e.message)), 5000);

// ---------- conexão ----------
let tentativas = 0;
async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState(PATHS.auth);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  sock = makeWASocket({
    version, auth: state, logger,
    browser: Browsers.windows('Chrome'),
    markOnlineOnConnect: false,   // o celular continua recebendo as notificações
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') { tentativas = 0; conectado = true; log('conectado'); }
    if (connection === 'close') {
      conectado = false;
      const cod = lastDisconnect?.error?.output?.statusCode;
      if (cod === DisconnectReason.loggedOut) { log('sessão desconectada pelo celular. Rode "wa parear" de novo.'); sair(1); return; }
      const espera = Math.min(60, 2 ** Math.min(tentativas++, 6));
      log(`conexão caiu (${cod}); tentando em ${espera}s`);
      setTimeout(() => conectar().catch((e) => log('erro ao reconectar', e.message)), espera * 1000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) { try { await salvar(m, { baixar: true }); } catch (e) { log('erro ao salvar', e.message); } }
  });

  // Histórico inicial (só texto e metadados; mídia antiga já não está disponível).
  // Histórico pedido de propósito ("pedir-historico.json", sync ON_DEMAND = 6) baixa a mídia também,
  // porque é de mensagens recentes que o leitor perdeu enquanto estava desligado.
  sock.ev.on('messaging-history.set', async ({ messages = [], contacts = [], syncType }) => {
    contacts.forEach(guardarContato);
    const baixar = syncType === 6;
    if (baixar) log(`histórico sob demanda recebido: ${messages.length} mensagem(ns)`);
    for (const m of messages) { try { await salvar(m, { baixar }); } catch {} }
  });
  sock.ev.on('contacts.upsert', (cs) => cs.forEach(guardarContato));
}

// ---------- pedido de histórico (recupera o que chegou com o leitor desligado) ----------
// Gatilho: arquivo "pedir-historico.json" na pasta de dados: {"jid":"55DDDNUMERO@s.whatsapp.net","count":50}.
// Pede ao celular as últimas N mensagens daquele chat (âncora = agora); a resposta cai em 'messaging-history.set'.
const ARQ_PEDIDO = join(PATHS.data, 'pedir-historico.json');
setInterval(async () => {
  if (!conectado || !existsSync(ARQ_PEDIDO)) return;
  try {
    const p = JSON.parse(readFileSync(ARQ_PEDIDO, 'utf8'));
    unlinkSync(ARQ_PEDIDO);
    const count = Math.min(Number(p.count) || 50, 50);
    await sock.fetchMessageHistory(count, { remoteJid: p.jid, id: p.ancoraId || 'ANCORA-AGORA', fromMe: false }, Date.now());
    log(`histórico pedido ao celular: ${p.jid} (${count})`);
  } catch (e) { log('falha ao pedir histórico', e.message); try { unlinkSync(ARQ_PEDIDO); } catch {} }
}, 5000);

conectar().catch((e) => { log('falha fatal', e.stack || e.message); sair(1); });
