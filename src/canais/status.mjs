// Status do WhatsApp com a imagem do brief diário da DS Trade.
// O brief é gerado na nuvem (GitHub Actions), que publica a imagem e um manifesto em endereço público:
//   <base_url>/story/AAAA-MM-DD.json   {"data": "AAAA-MM-DD", "imagem": "https://.../story/AAAA-MM-DD.jpg"}
// O leitor confere esse endereço a cada minuto dentro da janela do dia e posta o status UMA vez por dia.
// Nada sai sem <dados>\status.json com "ativo": true. Sem a configuração, este módulo não faz nada.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../config.mjs';
import { normEtiqueta } from '../armazenamento/db.mjs';

export const ARQ_STATUS = join(PATHS.data, 'status.json');
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const MAX_BYTES = 8 * 1024 * 1024;
const TENTATIVAS_MAX = 3;

// {ativo, base_url, hora_ini, hora_fim, dias, excluir_etiquetas, so_etiquetas, legenda}
export function lerConfigStatus(arq = ARQ_STATUS) {
  let c;
  try { c = JSON.parse(readFileSync(arq, 'utf8')); } catch { return null; }
  if (!c || c.ativo !== true || !/^https:\/\/[^/\s]+/.test(c.base_url || '')) return null;
  return {
    base: c.base_url.replace(/\/+$/, ''),
    horaIni: Number(c.hora_ini ?? 7),
    horaFim: Number(c.hora_fim ?? 12),
    dias: Array.isArray(c.dias) ? c.dias.map(Number) : [0, 1, 2, 3, 4, 5], // domingo a sexta, como o brief
    excluir: (c.excluir_etiquetas ?? ['Pessoal', 'Tecassistiva']).map(normEtiqueta),
    so: (c.so_etiquetas ?? []).map(normEtiqueta),
    legenda: c.legenda || undefined,
  };
}

export const dataLocal = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function dentroDaJanela(cfg, d = new Date()) {
  return cfg.dias.includes(d.getDay()) && d.getHours() >= cfg.horaIni && d.getHours() < cfg.horaFim;
}

// Quem vê o status: conversas privadas, fora das etiquetas excluídas (e só nas etiquetas pedidas, se houver).
// etiquetasDoChat: Map jid -> [nomes de etiqueta]. O próprio número entra sempre (para ver o status no celular).
export function montarAudiencia(jids, etiquetasDoChat, cfg, meuJid) {
  const lista = new Set(meuJid ? [meuJid] : []);
  for (const jid of jids) {
    if (!jid.endsWith('@s.whatsapp.net')) continue;
    const ets = (etiquetasDoChat.get(jid) || []).map(normEtiqueta);
    if (ets.some((e) => cfg.excluir.includes(e))) continue;
    if (cfg.so.length && !ets.some((e) => cfg.so.includes(e))) continue;
    lista.add(jid);
  }
  return [...lista];
}

// Sem status.json o envio manual para "todos" usa as mesmas exclusões padrão do envio diário.
export const AUDIENCIA_PADRAO = { excluir: ['pessoal', 'tecassistiva'], so: [] };

export function audienciaDoBanco(db, cfg, meuJid) {
  const chats = db.prepare('SELECT jid FROM chats WHERE grupo = 0').all().map((r) => r.jid);
  const etiquetasDoChat = new Map();
  for (const r of db.prepare('SELECT ec.chat, e.nome FROM etiqueta_chat ec JOIN etiquetas e ON e.id = ec.etiqueta').all()) {
    etiquetasDoChat.set(r.chat, [...(etiquetasDoChat.get(r.chat) || []), r.nome]);
  }
  return montarAudiencia(chats, etiquetasDoChat, cfg, meuJid);
}

async function buscar(url, { fetchFn, timeoutMs = 20_000 }) {
  const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r;
}

// Confere o manifesto do dia e baixa a imagem. Retorna {buf} ou {espera} (ainda não publicado).
export async function baixarDoDia(cfg, data, fetchFn = fetch) {
  const rm = await buscar(`${cfg.base}/story/${data}.json`, { fetchFn });
  if (!rm) return { espera: 'manifesto ainda não publicado' };
  const man = await rm.json();
  if (man?.data !== data) throw new Error('manifesto de outra data');
  const url = String(man.imagem || '');
  if (new URL(url).origin !== new URL(cfg.base).origin) throw new Error('imagem fora do endereço configurado');
  const ri = await buscar(url, { fetchFn, timeoutMs: 60_000 });
  if (!ri) throw new Error('imagem do manifesto não encontrada');
  const buf = Buffer.from(await ri.arrayBuffer());
  if (buf.length < 10_000 || buf.length > MAX_BYTES || !buf.subarray(0, 3).equals(JPEG)) throw new Error(`imagem inválida (${buf.length} bytes)`);
  return { buf };
}

// Uma verificação. Retorna um texto curto com o que aconteceu (para o log e para os testes).
// deps: { db, cfg, agora, fetchFn, enviar(buf, legenda, jids), meuJid, log }
export async function verificarStatusDoDia({ db, cfg, agora = new Date(), fetchFn = fetch, enviar, meuJid, log = () => {} }) {
  if (!cfg) return 'inativo';
  if (!dentroDaJanela(cfg, agora)) return 'fora da janela';
  const data = dataLocal(agora);
  const lin = db.prepare('SELECT * FROM status_postado WHERE data = ?').get(data);
  if (lin && (lin.estado === 'enviado' || lin.estado === 'enviando' || lin.tentativas >= TENTATIVAS_MAX)) return `já tratado (${lin.estado})`;
  const tent = (lin?.tentativas || 0) + 1;
  const ts = Math.floor(agora.getTime() / 1000);
  let tentouEnviar = false;
  try {
    const dia = await baixarDoDia(cfg, data, fetchFn);
    if (dia.espera) return dia.espera;
    const jids = audienciaDoBanco(db, cfg, meuJid);
    // grava "enviando" ANTES: se algo cair no meio, não repete o status (melhor perder um dia que postar duas vezes)
    db.prepare("INSERT INTO status_postado (data, estado, tentativas, ts, n, erro) VALUES (?, 'enviando', ?, ?, ?, NULL) ON CONFLICT(data) DO UPDATE SET estado = 'enviando', tentativas = excluded.tentativas, ts = excluded.ts, n = excluded.n, erro = NULL").run(data, tent, ts, jids.length);
    tentouEnviar = true;
    await enviar(dia.buf, cfg.legenda, jids);
    db.prepare("UPDATE status_postado SET estado = 'enviado' WHERE data = ?").run(data);
    log(`status ${data} postado para ${jids.length} contato(s)`);
    return `enviado (${jids.length})`;
  } catch (e) {
    // erro no envio em si pode ter chegado a sair: no máximo mais UMA tentativa (evita status repetido)
    const gasto = tentouEnviar ? Math.max(tent, TENTATIVAS_MAX - 1) : tent;
    db.prepare("INSERT INTO status_postado (data, estado, tentativas, ts, n, erro) VALUES (?, 'falhou', ?, ?, 0, ?) ON CONFLICT(data) DO UPDATE SET estado = 'falhou', tentativas = excluded.tentativas, ts = excluded.ts, erro = excluded.erro").run(data, gasto, ts, String(e.message).slice(0, 200));
    log(`status ${data} falhou (tentativa ${tent}/${TENTATIVAS_MAX}): ${e.message}`);
    return `falhou: ${e.message}`;
  }
}
