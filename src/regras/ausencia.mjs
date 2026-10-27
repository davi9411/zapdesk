// Mensagem de ausência: quando ativa, quem escrever no privado recebe UM aviso por período.
// Configuração em <dados>/ausencia.json (relido a cada mensagem, sem reiniciar o leitor):
// {
//   "ativo": true,
//   "inicio": "2026-10-28T00:00:00-03:00",
//   "fim":    "2026-10-29T23:59:59-03:00",
//   "texto":  "Olá! ...",
//   "excluir": ["5511999999999"],      // números que nunca recebem (opcional)
//   "somente": ["5511999999999"],      // se preenchido, SÓ esses recebem (use para testar)
//   "maxPorHora": 30                    // trava de segurança (opcional)
// }
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../config.mjs';

export const ARQ_AUSENCIA = join(PATHS.data, 'ausencia.json');
const RECENTE_MS = 10 * 60_000; // só responde mensagem recebida há menos de 10 min (nunca histórico)

export function lerAusencia(arq = ARQ_AUSENCIA) {
  if (!existsSync(arq)) return null;
  try {
    const a = JSON.parse(readFileSync(arq, 'utf8'));
    const ini = Date.parse(a.inicio);
    const fim = Date.parse(a.fim);
    if (a.ativo === false || !a.texto || Number.isNaN(ini) || Number.isNaN(fim)) return null;
    return { ...a, ini, fim, periodo: `${a.inicio}..${a.fim}` };
  } catch { return null; }
}

export function deveResponder(a, { jid, grupo, meu, ts, meuNumero, agora = Date.now() }) {
  if (!a || meu || grupo) return false;
  if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@lid')) return false;
  if (meuNumero && jid.startsWith(`${meuNumero}@`)) return false;
  if (agora < a.ini || agora > a.fim) return false;
  const tsMs = ts * 1000;
  if (tsMs < a.ini || agora - tsMs > RECENTE_MS) return false;
  const numeroChat = jid.split('@')[0];
  const lista = (l) => (l || []).map((x) => String(x).replace(/\D/g, ''));
  if (lista(a.excluir).includes(numeroChat)) return false;
  if (a.somente?.length && !lista(a.somente).includes(numeroChat)) return false;
  return true;
}

// Devolve registrar(a, jid, nome) -> 'enfileirada' | 'ja-enviada' | 'limite'
export function criarRegistro(db) {
  const marcar = db.prepare('INSERT OR IGNORE INTO ausencia_enviada (chat, periodo, ts) VALUES (?, ?, ?)');
  const naUltimaHora = db.prepare('SELECT COUNT(*) n FROM ausencia_enviada WHERE periodo = ? AND ts >= ?');
  const enfileirar = db.prepare('INSERT INTO outbox (chat, nome, texto, arquivos, enviar_em, criado) VALUES (?, ?, ?, NULL, ?, ?)');
  return (a, jid, nome) => {
    const agora = Math.floor(Date.now() / 1000);
    if (naUltimaHora.get(a.periodo, agora - 3600).n >= (a.maxPorHora || 30)) return 'limite';
    if (marcar.run(jid, a.periodo, agora).changes !== 1) return 'ja-enviada';
    enfileirar.run(jid, nome, a.texto, agora, agora);
    return 'enfileirada';
  };
}
