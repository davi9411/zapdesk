#!/usr/bin/env node
// CLI do leitor: ligar / desligar / status / parear / chats / ler / preparar
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync, openSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PATHS, pidDeOutroBoot } from './config.mjs';
import { parseQuando } from './regras/quando.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const [cmd, ...resto] = process.argv.slice(2);

// ---------- util ----------
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmt = (ts) => new Date(ts * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const mmss = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '?');

function opcoes(args) {
  const o = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      if (k === 'arquivo') (o.arquivos ||= []).push(v); else o[k] = v; // --arquivo pode repetir
    }
    else o._.push(a);
  }
  return o;
}

function pidVivo() {
  if (!existsSync(PATHS.pid)) return null;
  const pid = Number(readFileSync(PATHS.pid, 'utf8'));
  if (!pid || pidDeOutroBoot()) return null;
  try {
    // confere que o PID é mesmo um node (evita PID reaproveitado após reiniciar o Windows)
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    return /node\.exe/i.test(out) ? pid : null;
  } catch { return null; }
}

function desdeTs(o) {
  if (o.desde) return Math.floor(new Date(`${o.desde}T00:00:00`).getTime() / 1000);
  const horas = o.horas ? Number(o.horas) : (o.dias ? Number(o.dias) * 24 : 24);
  return Math.floor(Date.now() / 1000 - horas * 3600);
}

async function abrir() {
  const { abrirDb } = await import('./armazenamento/db.mjs');
  return abrirDb();
}

function acharChat(db, filtro) {
  const f = semAcento(filtro);
  const todos = db.prepare('SELECT jid, nome, grupo, ultima_ts FROM chats ORDER BY ultima_ts DESC').all();
  const achados = todos.filter((c) => semAcento(c.nome).includes(f) || c.jid.includes(filtro));
  if (achados.length === 1) return achados[0];
  if (!achados.length && /^\d{10,15}$/.test(filtro)) return { jid: `${filtro}@s.whatsapp.net`, nome: filtro, grupo: 0 }; // número completo (DDI+DDD)
  if (!achados.length) { console.error(`Nenhuma conversa com "${filtro}". Use: wa chats`); process.exit(1); }
  console.error(`Mais de uma conversa com "${filtro}". Seja mais específico:`);
  achados.slice(0, 10).forEach((c) => console.error(`  ${c.nome || '(sem nome)'}  [${c.jid}]`));
  process.exit(1);
}

// ---------- comandos ----------
async function ligar() {
  const o = opcoes(resto);
  if (!existsSync(join(PATHS.auth, 'creds.json'))) { console.error('Ainda não pareado. Rode primeiro: wa parear 55DDDNUMERO'); process.exit(1); }
  const pid = pidVivo();
  if (pid) { console.log(`Já está ligado (PID ${pid}).`); return; }
  // trava de partida: duas chamadas quase simultâneas (ex.: duas sessões do Claude) não sobem dois listeners
  const trava = join(PATHS.data, 'wa.starting');
  try { if (Date.now() - statSync(trava).mtimeMs > 40_000) unlinkSync(trava); } catch {}
  try { writeFileSync(trava, String(process.pid), { flag: 'wx' }); }
  catch { console.log('Já está subindo (outra chamada acabou de ligar). Aguarde ~20 s e rode: wa status'); return; }
  try { await subir(o); } finally { try { unlinkSync(trava); } catch {} }
}

async function subir(o) {
  const env = { ...process.env };
  if (o.horas) env.WA_AUTO_OFF_MIN = String(Math.round(Number(o.horas) * 60));
  const log = openSync(PATHS.log, 'a');
  const filho = spawn(process.execPath, ['--no-warnings', join(AQUI, 'listener.mjs')], { detached: true, stdio: ['ignore', log, log], windowsHide: true, env });
  filho.unref();
  // o listener grava o PID só depois de carregar as bibliotecas; espera até 20 s
  for (let i = 0; i < 40 && !pidVivo(); i++) await new Promise((r) => setTimeout(r, 500));
  if (pidVivo()) console.log(`Ligado${o.horas ? ` (desliga sozinho em ${o.horas} h)` : ''}. Para desligar: wa desligar`);
  else { console.error(`Não subiu. Veja o log: ${PATHS.log}`); process.exit(1); }
}

function desligar() {
  const pid = pidVivo();
  if (!pid) { try { unlinkSync(PATHS.pid); } catch {} console.log('Já estava desligado.'); return; }
  try { process.kill(pid); } catch (e) { console.error('Falha ao desligar:', e.message); process.exit(1); }
  try { unlinkSync(PATHS.pid); } catch {}
  console.log('Desligado.');
}

async function status() {
  const pid = pidVivo();
  console.log(pid ? `LIGADO (PID ${pid}, desde ${fmt(statSync(PATHS.pid).mtimeMs / 1000)})` : 'DESLIGADO');
  console.log(`Pareado: ${existsSync(join(PATHS.auth, 'creds.json')) ? 'sim' : 'não'}`);
  if (!existsSync(PATHS.db)) return;
  const db = await abrir();
  const r = db.prepare('SELECT COUNT(*) n, MAX(ts) ult FROM msgs').get();
  const c = db.prepare('SELECT COUNT(*) n FROM chats').get();
  console.log(`Conversas: ${c.n} | Mensagens: ${r.n} | Última: ${r.ult ? fmt(r.ult) : '-'}`);
  console.log(`Dados em: ${PATHS.data}`);
}

async function chats() {
  const o = opcoes(resto);
  const db = await abrir();
  const f = semAcento(o._[0] || '');
  const desde = Math.floor(Date.now() / 1000 - 86400);
  const linhas = db.prepare(`SELECT c.jid, c.nome, c.grupo, c.ultima_ts,
      (SELECT COUNT(*) FROM msgs m WHERE m.chat = c.jid AND m.ts >= ?) AS hoje
    FROM chats c ORDER BY c.ultima_ts DESC`).all(desde)
    .filter((c) => !f || semAcento(c.nome).includes(f) || c.jid.includes(f))
    .slice(0, Number(o.limite || 30));
  for (const c of linhas) console.log(`${c.ultima_ts ? fmt(c.ultima_ts) : '--/-- --:--'}  ${c.grupo ? '[grupo] ' : ''}${c.nome || '(sem nome)'}  (${c.hoje} em 24h)  ${c.jid}`);
  if (!linhas.length) console.log('Nenhuma conversa ainda.');
}

async function ler() {
  const o = opcoes(resto);
  if (!o._[0]) { console.error('Uso: wa ler <nome> [--horas N | --dias N | --desde AAAA-MM-DD] [--limite N]'); process.exit(1); }
  const db = await abrir();
  const chat = acharChat(db, o._.join(' '));
  const msgs = db.prepare('SELECT * FROM (SELECT * FROM msgs WHERE chat = ? AND ts >= ? ORDER BY ts DESC LIMIT ?) ORDER BY ts').all(chat.jid, desdeTs(o), Number(o.limite || 200));
  console.log(`=== ${chat.nome || chat.jid} (${chat.jid}) — ${msgs.length} mensagem(ns) ===`);
  let pendentes = 0;
  for (const m of msgs) {
    const quem = m.meu ? 'EU' : (m.de || 'cliente');
    const pre = `[${fmt(m.ts)}] ${quem}:`;
    if (m.tipo === 'texto') console.log(`${pre} ${m.texto}`);
    else if (m.tipo === 'audio') {
      console.log(`${pre} 🎤 áudio ${mmss(m.dur)}${m.arquivo ? '' : ' (arquivo indisponível)'}`);
      if (m.transcricao != null) console.log(`    transcrição: "${m.transcricao}"`);
      else if (m.arquivo) { console.log('    (não transcrito — rode: wa preparar)'); pendentes++; }
    } else if (m.tipo === 'video') {
      console.log(`${pre} 🎬 vídeo ${mmss(m.dur)}${m.texto ? ` — "${m.texto}"` : ''}${m.arquivo ? `\n    arquivo: ${m.arquivo}` : ' (arquivo indisponível)'}`);
      if (m.transcricao != null) console.log(`    transcrição: "${m.transcricao}"`);
      if (m.frames) console.log(`    frames: ${readdirSync(m.frames).map((f) => join(m.frames, f)).join('\n            ')}`);
      else if (m.arquivo) { console.log('    (sem frames/transcrição — rode: wa preparar)'); pendentes++; }
    } else if (m.tipo === 'imagem') console.log(`${pre} 🖼️ foto${m.texto ? ` — "${m.texto}"` : ''}${m.arquivo ? `\n    arquivo: ${m.arquivo}` : ' (arquivo indisponível)'}`);
    else if (m.tipo === 'documento') console.log(`${pre} 📎 documento: ${m.texto || ''}${m.arquivo ? `\n    arquivo: ${m.arquivo}` : ''}`);
    else if (m.tipo === 'figurinha') console.log(`${pre} (figurinha)`);
    else console.log(`${pre} ${m.texto || `(${m.tipo})`}`);
  }
  if (pendentes) console.log(`\n${pendentes} mídia(s) sem processar: wa preparar "${o._.join(' ')}"`);
}

async function preparar() {
  const o = opcoes(resto);
  if (!o._[0]) { console.error('Uso: wa preparar <nome> [--horas N | --dias N | --desde AAAA-MM-DD] [--modelo small|medium] [--frames 6]'); process.exit(1); }
  const db = await abrir();
  const chat = acharChat(db, o._.join(' '));
  const args = [join(AQUI, '..', 'tools', 'preparar.py'), '--db', PATHS.db, '--chat', chat.jid, '--desde', String(desdeTs(o))];
  if (o.modelo) args.push('--modelo', o.modelo);
  if (o.frames) args.push('--frames', o.frames);
  const r = spawnSync('py', ['-3', ...args], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

async function enviar() {
  const o = opcoes(resto);
  const alvo = o._.join(' ');
  if (!alvo || (!o.texto && !o.arquivos)) {
    console.error('Uso: wa enviar <nome> --texto "msg" [--arquivo caminho]... [--em "16:30" | "AAAA-MM-DD HH:MM"]');
    process.exit(1);
  }
  const arquivos = (o.arquivos || []).map((f) => (existsSync(f) ? f : null));
  if (arquivos.includes(null)) { console.error('Arquivo não encontrado:', (o.arquivos || []).filter((f) => !existsSync(f)).join(', ')); process.exit(1); }
  const db = await abrir();
  const chat = acharChat(db, alvo);
  const agora = Math.floor(Date.now() / 1000);
  const quando = o.em ? parseQuando(o.em) : agora;
  if (quando == null) { console.error('Hora inválida. Use "16:30" (hoje) ou "AAAA-MM-DD HH:MM".'); process.exit(1); }
  if (o.em && quando <= agora) { console.error('Essa hora já passou.'); process.exit(1); }
  if (!o.em && !pidVivo()) { console.error('Leitor desligado: ligue primeiro (wa ligar) ou use --em para programar.'); process.exit(1); }

  const r = db.prepare('INSERT INTO outbox (chat, nome, texto, arquivos, enviar_em, criado) VALUES (?,?,?,?,?,?)')
    .run(chat.jid, chat.nome, o.texto === true ? null : (o.texto ?? null), arquivos.length ? JSON.stringify(arquivos) : null, quando, agora);
  const id = Number(r.lastInsertRowid);
  const resumo = `${chat.nome || chat.jid}${o.texto ? ` — "${String(o.texto).slice(0, 60)}"` : ''}${arquivos.length ? ` + ${arquivos.length} arquivo(s)` : ''}`;
  if (o.em) {
    console.log(`Programado #${id} para ${fmt(quando)}: ${resumo}`);
    if (!pidVivo()) console.log('ATENÇÃO: o leitor está desligado. Ele precisa estar ligado nessa hora (wa ligar).');
    return;
  }
  for (let i = 0; i < 60; i++) { // espera confirmação até 30 s
    await new Promise((res) => setTimeout(res, 500));
    const s = db.prepare('SELECT status, erro FROM outbox WHERE id = ?').get(id);
    if (s.status === 'enviada') { console.log(`Enviado #${id}: ${resumo}`); return; }
    if (s.status === 'falhou' || s.status === 'atrasada') { console.error(`Falhou #${id}: ${s.erro}`); process.exit(1); }
  }
  console.error(`Sem confirmação em 30 s (#${id} segue na fila). Veja: wa fila`);
  process.exit(1);
}

async function fila() {
  const db = await abrir();
  const rows = db.prepare(`SELECT * FROM outbox WHERE status IN ('pendente','enviando') OR criado >= ? ORDER BY enviar_em, id`).all(Math.floor(Date.now() / 1000) - 86400);
  if (!rows.length) { console.log('Fila vazia.'); return; }
  for (const r of rows) {
    const n = r.arquivos ? JSON.parse(r.arquivos).length : 0;
    console.log(`#${r.id} [${r.status}] ${fmt(r.enviar_em)} → ${r.nome || r.chat}${r.texto ? ` — "${r.texto.slice(0, 50)}"` : ''}${n ? ` + ${n} arquivo(s)` : ''}${r.erro ? `  (${r.erro})` : ''}`);
  }
}

async function cancelar() {
  const id = Number(resto[0]);
  if (!id) { console.error('Uso: wa cancelar <id>'); process.exit(1); }
  const db = await abrir();
  const r = db.prepare(`UPDATE outbox SET status = 'cancelada' WHERE id = ? AND status = 'pendente'`).run(id);
  console.log(r.changes ? `Cancelado #${id}.` : `#${id} não está pendente (já enviado, em envio ou inexistente).`);
}

async function ausencia() {
  const { lerAusencia, ARQ_AUSENCIA } = await import('./regras/ausencia.mjs');
  const a = lerAusencia();
  if (!a) { console.log(`Ausência desligada (sem configuração válida em ${ARQ_AUSENCIA}).`); return; }
  const agora = Date.now();
  const estado = agora < a.ini ? 'AGENDADA' : agora > a.fim ? 'ENCERRADA' : 'ATIVA AGORA';
  console.log(`${estado}: ${new Date(a.ini).toLocaleString('pt-BR')} até ${new Date(a.fim).toLocaleString('pt-BR')}`);
  console.log(`Texto: ${a.texto}`);
  const db = await abrir();
  const env = db.prepare('SELECT e.chat, e.ts, c.nome FROM ausencia_enviada e LEFT JOIN chats c ON c.jid = e.chat WHERE e.periodo = ? ORDER BY e.ts').all(a.periodo);
  console.log(`Avisos enviados neste período: ${env.length}`);
  for (const r of env) console.log(`  ${fmt(r.ts)}  ${r.nome || r.chat}`);
}

// wa etiquetas                 lista as etiquetas e quem está em cada uma
// wa etiqueta <nome> <etiqueta> [--tirar]   põe (ou tira) a etiqueta; o listener aplica no WhatsApp
async function etiquetas() {
  const db = await abrir();
  const ets = db.prepare('SELECT e.id, e.nome, COUNT(ec.chat) n FROM etiquetas e LEFT JOIN etiqueta_chat ec ON ec.etiqueta = e.id GROUP BY e.id ORDER BY e.nome').all();
  if (!ets.length) { console.log('Nenhuma etiqueta sincronizada ainda (elas chegam pelo listener).'); return; }
  for (const e of ets) {
    console.log(`${e.nome} (${e.n})`);
    for (const c of db.prepare('SELECT ec.chat, c.nome FROM etiqueta_chat ec LEFT JOIN chats c ON c.jid = ec.chat WHERE ec.etiqueta = ?').all(e.id)) console.log(`   ${c.nome || c.chat}`);
  }
}
async function etiqueta() {
  const o = opcoes(resto);
  const [filtro, ...nome] = o._;
  if (!filtro || !nome.length) { console.error('Uso: wa etiqueta <nome do chat> <etiqueta> [--tirar]'); process.exit(1); }
  const db = await abrir();
  const c = acharChat(db, filtro);
  db.prepare("INSERT INTO acoes (tipo, chat, valor, criado) VALUES (?, ?, ?, strftime('%s','now'))").run(o.tirar ? 'etiqueta-' : 'etiqueta+', c.jid, nome.join(' '));
  console.log(`${o.tirar ? 'Tirar' : 'Pôr'} etiqueta "${nome.join(' ')}" em ${c.nome || c.jid}: na fila (o listener aplica em até 5 s).`);
}

function parear() {
  const r = spawnSync(process.execPath, ['--no-warnings', join(AQUI, 'parear.mjs'), resto[0] || ''], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const CMDS = { ligar, desligar, status, chats, ler, preparar, parear, enviar, fila, cancelar, ausencia, etiquetas, etiqueta };
if (!CMDS[cmd]) {
  console.log(`wa — leitor local de WhatsApp (somente leitura)

  wa parear 55DDDNUMERO      pareia uma vez (código de 8 dígitos)
  wa ligar [--horas N]       liga em segundo plano (opcional: desliga sozinho em N horas)
  wa desligar                desliga
  wa status                  ligado/desligado + contagens
  wa chats [filtro]          conversas recentes
  wa ler <nome> [--horas N]  mostra a conversa (texto, transcrições, caminhos de mídia)
  wa preparar <nome>         transcreve áudios/vídeos e extrai frames (sob demanda)
  wa enviar <nome> --texto "..." [--arquivo f]... [--em "16:30"]   envia (ou programa), sempre por comando explícito
  wa fila                    envios pendentes/recentes
  wa cancelar <id>           cancela envio programado
  wa ausencia                mensagem de ausência: período, texto e quem já recebeu
  wa etiquetas               etiquetas do WhatsApp Business e quem está em cada uma
  wa etiqueta <nome> <etiqueta> [--tirar]   põe ou tira uma etiqueta`);
  process.exit(cmd ? 1 : 0);
}
await CMDS[cmd]();
