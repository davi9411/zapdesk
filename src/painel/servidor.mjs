// Painel local do Zapdesk. Escuta APENAS em 127.0.0.1. Lê o banco em modo leitura; as únicas escritas são
// enviar e cancelar mensagem (fila outbox), protegidas por token que só a página servida por este processo recebe.
// Uso: node src/painel/servidor.mjs   (porta em PAINEL_PORTA, padrão 4747)
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { abrirLeitura, lerConfig, listarConversas, detalharConversa, resumoDante, leitorVivo as leitorNoAr, abrirEscrita as abrirParaEscrever } from './dados.mjs';
import { enfileirarEnvio, cancelarEnvio, ErroEnvio } from './envio.mjs';
import { assumirDeVolta, silenciar, reativar, definirPausa, fecharCasos } from '../agente/controle.mjs';
import { criarRotina, alternarRotina, apagarRotina, listarRotinas } from '../regras/rotinas.mjs';
import { registrar } from './auditoria.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const PORTA = Number(process.env.PAINEL_PORTA || 4747);

// o navegador local manda Host: 127.0.0.1:porta, localhost:porta ou zap.localhost:porta; qualquer outro nome é recusado
// (protege contra um site qualquer que aponte seu domínio para 127.0.0.1).
// zap.localhost é o apelido fácil de digitar: o navegador resolve *.localhost sempre para a própria máquina.
export const hostPermitido = (host) => /^(127\.0\.0\.1|localhost|zap\.localhost)(:\d+)?$/i.test(host || '');

const json = (res, codigo, corpo) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(corpo));
};

const MAX_CORPO = 20_000;
const lerCorpo = (req) => new Promise((ok, erro) => {
  let n = 0; const partes = [];
  req.on('data', (c) => { n += c.length; if (n > MAX_CORPO) { erro(new ErroEnvio('Corpo grande demais.', 413)); req.destroy(); } else partes.push(c); });
  req.on('end', () => { try { ok(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}')); } catch { erro(new ErroEnvio('JSON inválido.')); } });
  req.on('error', erro);
});

export function criarServidor({ abrir = abrirLeitura, abrirEscrita = abrirParaEscrever, config = lerConfig, token = randomBytes(24).toString('hex'), leitorVivo = leitorNoAr } = {}) {
  const srv = createServer(async (req, res) => {
    if (!hostPermitido(req.headers.host)) return json(res, 403, { erro: 'host não permitido' });
    const url = new URL(req.url, `http://${HOST}`);
    if (req.method === 'POST') return postar(req, res, url);
    if (req.method !== 'GET') return json(res, 405, { erro: 'método não permitido' });
    let db;
    try {
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(readFileSync(join(AQUI, 'pagina.html'), 'utf8').replace('__TOKEN__', token));
      }
      db = abrir();
      if (url.pathname === '/api/conversas') return json(res, 200, listarConversas(db, { cfg: config() }));
      if (url.pathname.startsWith('/api/conversas/')) {
        const d = detalharConversa(db, decodeURIComponent(url.pathname.slice('/api/conversas/'.length)), { cfg: config() });
        return d ? json(res, 200, d) : json(res, 404, { erro: 'conversa não encontrada' });
      }
      if (url.pathname === '/api/dante') return json(res, 200, resumoDante(db));
      if (url.pathname === '/api/rotinas') return json(res, 200, listarRotinas(db));
      return json(res, 404, { erro: 'não encontrado' });
    } catch (e) {
      return json(res, 500, { erro: e.message });
    } finally { try { db?.close(); } catch {} }
  });

  async function postar(req, res, url) {
    // origem tem que ser a própria página e o token tem que bater: outro site aberto no navegador não consegue enviar
    const origem = req.headers.origin;
    let hostOrigem = null;
    try { hostOrigem = origem ? new URL(origem).host : undefined; } catch {}
    if (origem && !hostPermitido(hostOrigem)) return json(res, 403, { erro: 'origem não permitida' });
    if (req.headers['x-painel-token'] !== token) return json(res, 403, { erro: 'token inválido' });
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return json(res, 415, { erro: 'use application/json' });
    let db;
    try {
      const corpo = await lerCorpo(req);
      if (url.pathname === '/api/enviar') {
        db = abrirEscrita();
        return json(res, 200, enfileirarEnvio(db, { jid: corpo.jid, texto: corpo.texto, em: corpo.em, leitorVivo: leitorVivo(), danteContinua: corpo.danteContinua === true }));
      }
      if (url.pathname === '/api/cancelar') {
        db = abrirEscrita();
        registrar(db, { acao: 'cancelar', detalhe: `#${corpo.id}` });
        return json(res, 200, cancelarEnvio(db, corpo.id));
      }
      if (['/api/assumir', '/api/silenciar', '/api/reativar'].includes(url.pathname)) {
        db = abrirEscrita();
        const chat = db.prepare('SELECT jid FROM chats WHERE jid = ?').get(String(corpo.jid || ''));
        if (!chat) throw new ErroEnvio('Conversa não encontrada.', 404);
        const acao = url.pathname.slice(5);
        if (url.pathname === '/api/assumir') { registrar(db, { acao, chat: chat.jid }); return json(res, 200, assumirDeVolta(db, chat.jid)); }
        if (url.pathname === '/api/reativar') { registrar(db, { acao, chat: chat.jid }); reativar(db, chat.jid); return json(res, 200, { ok: true }); }
        const horas = Number(corpo.horas) || 0; // 0 = até reativar
        registrar(db, { acao, chat: chat.jid, detalhe: horas > 0 ? `${horas} h` : 'até reativar' });
        return json(res, 200, silenciar(db, chat.jid, horas > 0 ? Math.floor(Date.now() / 1000) + Math.round(horas * 3600) : 0));
      }
      if (url.pathname === '/api/fechar-caso') {
        db = abrirEscrita();
        if (corpo.id == null && !corpo.jid) throw new ErroEnvio('Informe o caso ou a conversa.', 400);
        const r = fecharCasos(db, { id: corpo.id, chat: corpo.jid });
        if (!r.fechados) throw new ErroEnvio('Nenhum caso aberto para fechar.', 404);
        registrar(db, { acao: 'fechar-caso', chat: corpo.jid || null, detalhe: corpo.id != null ? `#${corpo.id}` : `${r.fechados} caso(s)` });
        return json(res, 200, r);
      }
      if (url.pathname === '/api/rotinas') {
        db = abrirEscrita();
        const r = criarRotina(db, { jid: corpo.jid, texto: corpo.texto, dias: corpo.dias, hora: corpo.hora, ate: corpo.ate, danteContinua: corpo.danteContinua !== false });
        registrar(db, { acao: 'rotina-criar', chat: corpo.jid, detalhe: `#${r.id} ${corpo.hora} dias ${(corpo.dias || []).join?.(',') ?? corpo.dias}` });
        return json(res, 200, r);
      }
      if (url.pathname === '/api/rotinas/alternar' || url.pathname === '/api/rotinas/apagar') {
        db = abrirEscrita();
        const apagar = url.pathname.endsWith('apagar');
        registrar(db, { acao: apagar ? 'rotina-apagar' : 'rotina-alternar', detalhe: `#${corpo.id}` });
        return json(res, 200, apagar ? apagarRotina(db, corpo.id) : alternarRotina(db, corpo.id, corpo.ativa === true));
      }
      if (url.pathname === '/api/pausar') {
        db = abrirEscrita();
        registrar(db, { acao: corpo.pausado === true ? 'pausar' : 'retomar' });
        return json(res, 200, definirPausa(db, corpo.pausado === true));
      }
      return json(res, 404, { erro: 'não encontrado' });
    } catch (e) {
      return json(res, e instanceof ErroEnvio ? e.codigo : e.codigo || (/inválid|Escolha|Escreva|grande demais|privadas/.test(e.message) ? 400 : 500), { erro: e.message });
    } finally { try { db?.close(); } catch {} }
  }
  return srv;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const srv = criarServidor();
  // a tarefa agendada confere de tempos em tempos: se o painel já está rodando, a segunda cópia sai quieta
  srv.on('error', (e) => { if (e.code === 'EADDRINUSE') process.exit(0); console.error(e.message); process.exit(1); });
  srv.listen(PORTA, HOST, () => console.log(`Painel Zapdesk em http://${HOST}:${PORTA}`));
}
