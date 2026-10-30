// Leitura dos dados do painel. Abre o banco SÓ PARA LEITURA: o painel nunca escreve em wa.db.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../config.mjs';
import { normEtiqueta } from '../armazenamento/db.mjs';
import { processoVivo } from '../sistema.mjs';
import { assumeTs, silenciada } from '../agente/controle.mjs';
import { statusConversa, quemEscreveu, ehHumano, ehDoAgente } from './status.mjs';

const agoraS = () => Math.floor(Date.now() / 1000);
const SO_PRIVADO = "jid NOT LIKE '%@g.us' AND jid NOT LIKE '%broadcast' AND jid NOT LIKE '%@newsletter'";

export function abrirLeitura(arq = PATHS.db) {
  return new DatabaseSync(arq, { readOnly: true });
}

export function lerConfig(dados = PATHS.data) {
  let c = {};
  try { c = JSON.parse(readFileSync(join(dados, 'agente.json'), 'utf8')); } catch {}
  const dig = (l) => (l || []).map((x) => String(x).replace(/\D/g, ''));
  const davi = String(c.davi || '').replace(/\D/g, '');
  return {
    nome: 'Dante', empresa: 'DS Trade', humanoHoras: 12, etiquetaPessoal: 'Pessoal🏠', ...c,
    ini: Date.parse(c.inicio) || 0,
    excluir: dig(c.excluir),
    daviJids: [...(davi ? [`${davi}@s.whatsapp.net`] : []), ...(c.daviJids || [])],
  };
}

function avisosAutomaticos(dados = PATHS.data) {
  try {
    const a = JSON.parse(readFileSync(join(dados, 'ausencia.json'), 'utf8'));
    return [a.texto, ...(a.textosAnteriores || [])].filter(Boolean);
  } catch { return []; }
}

// tabela que o agente cria na primeira execução: sem ela o painel mostra tudo como "sem estado"
const temTabela = (db, nome) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome);
const kv = (db, k) => (temTabela(db, 'agente_kv') ? db.prepare('SELECT v FROM agente_kv WHERE k = ?').get(k)?.v : undefined);

function previa(m) {
  if (!m) return '';
  const t = (m.texto || m.transcricao || '').replace(/\s+/g, ' ').trim();
  if (t) return t.slice(0, 90);
  return m.tipo && m.tipo !== 'texto' ? `[${m.tipo}]` : '';
}

function fatos(db, cfg, avisos, chat, e, etiquetas, pausado, agora) {
  const ult = db.prepare('SELECT meu, texto, tipo, transcricao, ts FROM msgs WHERE chat = ? ORDER BY ts DESC LIMIT 1').get(chat);
  const ultCliente = db.prepare('SELECT ts FROM msgs WHERE chat = ? AND meu = 0 ORDER BY ts DESC LIMIT 1').get(chat)?.ts || 0;
  const numero = chat.split('@')[0];
  const ignorar = [cfg.etiquetaPessoal, ...(cfg.etiquetasIgnorar || [])].map(normEtiqueta);
  const fora = cfg.daviJids.includes(chat) || cfg.excluir.includes(numero) || etiquetas.some((n) => ignorar.includes(normEtiqueta(n)));
  const desde = Math.max(Math.floor(cfg.ini / 1000), agora - cfg.humanoHoras * 3600);
  const assume = assumeTs(db, chat); // "Dante assume de volta": a equipe antes disso é ignorada
  const humanoTs = db.prepare('SELECT texto, ts FROM msgs WHERE chat = ? AND meu = 1 AND ts >= ? AND ts > ? ORDER BY ts DESC').all(chat, desde, assume)
    .find((m) => ehHumano(cfg, m.texto, avisos))?.ts || 0;
  const casoAberto = temTabela(db, 'agente_caso')
    ? db.prepare("SELECT id FROM agente_caso WHERE chat = ? AND status = 'aberto' ORDER BY id DESC LIMIT 1").get(chat)?.id || null
    : null;
  const f = {
    agora, pausado, fora, semEstado: !e, silenciado: silenciada(db, chat, agora),
    escolhaHumanoTs: e?.escolha === 'humano' ? e.prefere_humano_ts : 0,
    humanoTs, humanoHoras: cfg.humanoHoras, casoAberto,
    pendente: ultCliente > (e?.ultimo_ts || 0) && ultCliente >= Math.floor(cfg.ini / 1000) && !!ult && !ult.meu,
    ultimaDoAgente: !!ult?.meu && ehDoAgente(cfg, ult.texto),
  };
  return { ult, f, casoAberto };
}

export function listarConversas(db, { cfg = lerConfig(), limite = 200, agora = agoraS(), dados = PATHS.data } = {}) {
  const avisos = avisosAutomaticos(dados);
  const pausado = kv(db, 'pausado') === '1';
  const comEstado = temTabela(db, 'agente_chat');
  const etiq = db.prepare('SELECT e.nome FROM etiqueta_chat ec JOIN etiquetas e ON e.id = ec.etiqueta WHERE ec.chat = ?');
  const chats = db.prepare(`SELECT jid, nome, ultima_ts FROM chats WHERE ${SO_PRIVADO} ORDER BY ultima_ts DESC LIMIT ?`).all(limite);
  return chats.map((c) => {
    const e = comEstado ? db.prepare('SELECT * FROM agente_chat WHERE chat = ?').get(c.jid) : null;
    const etiquetas = etiq.all(c.jid).map((r) => r.nome);
    const { ult, f, casoAberto } = fatos(db, cfg, avisos, c.jid, e, etiquetas, pausado, agora);
    return {
      jid: c.jid,
      numero: c.jid.split('@')[0],
      nome: c.nome || e?.nome_cliente || c.jid.split('@')[0],
      ultima_ts: c.ultima_ts,
      previa: previa(ult),
      ultimaMeu: !!ult?.meu,
      etiquetas,
      casoAberto,
      perfil: e?.perfil || null,
      status: statusConversa(f),
    };
  });
}

export function detalharConversa(db, jid, { cfg = lerConfig(), limite = 80, agora = agoraS(), dados = PATHS.data } = {}) {
  const c = db.prepare('SELECT jid, nome, ultima_ts FROM chats WHERE jid = ?').get(jid);
  if (!c) return null;
  const avisos = avisosAutomaticos(dados);
  const comEstado = temTabela(db, 'agente_chat');
  const e = comEstado ? db.prepare('SELECT * FROM agente_chat WHERE chat = ?').get(jid) : null;
  const etiquetas = db.prepare('SELECT e.nome FROM etiqueta_chat ec JOIN etiquetas e ON e.id = ec.etiqueta WHERE ec.chat = ?').all(jid).map((r) => r.nome);
  const { f } = fatos(db, cfg, avisos, jid, e, etiquetas, kv(db, 'pausado') === '1', agora);
  const msgs = db.prepare('SELECT id, ts, meu, tipo, texto, transcricao FROM msgs WHERE chat = ? ORDER BY ts DESC LIMIT ?').all(jid, limite).reverse()
    .map((m) => ({ id: m.id, ts: m.ts, tipo: m.tipo, texto: m.texto, transcricao: m.transcricao, quem: quemEscreveu(cfg, m, avisos) }));
  const casos = temTabela(db, 'agente_caso')
    ? db.prepare("SELECT id, resumo, pergunta, status, criado, tipo FROM agente_caso WHERE chat = ? ORDER BY id DESC LIMIT 10").all(jid)
    : [];
  // o que ainda não saiu (ou falhou) nesta conversa: programadas, em envio e erros dos últimos 3 dias
  const fila = db.prepare(`SELECT id, texto, enviar_em, status, erro, enquete IS NOT NULL AS enquete FROM outbox
    WHERE chat = ? AND status IN ('pendente','enviando','falhou','atrasada') AND criado >= ? ORDER BY enviar_em, id`).all(jid, agora - 3 * 86400)
    .map((o) => ({ ...o, enquete: !!o.enquete }));
  return {
    jid, numero: jid.split('@')[0], nome: c.nome || e?.nome_cliente || jid.split('@')[0],
    etiquetas, perfil: e?.perfil || null, origem: e?.origem || null, status: statusConversa(f), msgs, casos, fila,
  };
}

function cauda(arq, linhas) {
  try { return readFileSync(arq, 'utf8').trimEnd().split('\n').slice(-linhas); } catch { return []; }
}

const pidVivo = (arq) => {
  try { return processoVivo(Number(readFileSync(arq, 'utf8').trim())); } catch { return false; }
};

export const leitorVivo = () => (existsSync(PATHS.pid) ? pidVivo(PATHS.pid) : false);

export function resumoDante(db, { dados = PATHS.data, linhas = 40 } = {}) {
  const abertos = temTabela(db, 'agente_caso')
    ? db.prepare("SELECT id, chat, nome, resumo, pergunta, criado FROM agente_caso WHERE status = 'aberto' ORDER BY id DESC").all()
    : [];
  const fila = db.prepare("SELECT status, COUNT(*) n FROM outbox WHERE status IN ('pendente','enviando','falhou','atrasada') GROUP BY status").all();
  return {
    agenteVivo: pidVivo(join(dados, 'agente.pid')),
    leitorVivo: leitorVivo(),
    pausado: kv(db, 'pausado') === '1',
    casosAbertos: abertos,
    fila: Object.fromEntries(fila.map((r) => [r.status, r.n])),
    log: cauda(join(dados, 'agente.log'), linhas),
  };
}
