// Painel local do Zapdesk. Escuta APENAS em 127.0.0.1. Lê o banco em modo leitura; as únicas escritas são
// enviar e cancelar mensagem (fila outbox), protegidas por token que só a página servida por este processo recebe.
// Uso: node src/painel/servidor.mjs   (porta em PAINEL_PORTA, padrão 4747)
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { abrirLeitura, lerConfig, listarConversas, detalharConversa, resumoDante, leitorVivo as leitorNoAr } from './dados.mjs';
import { abrirDb } from '../armazenamento/db.mjs';
import { enfileirarEnvio, cancelarEnvio, ErroEnvio } from './envio.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const PORTA = Number(process.env.PAINEL_PORTA || 4747);

// o navegador local manda Host: 127.0.0.1:porta ou localhost:porta; qualquer outro nome é recusado
// (protege contra um site qualquer que aponte seu domínio para 127.0.0.1)
export const hostPermitido = (host) => /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host || '');

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

export function criarServidor({ abrir = abrirLeitura, abrirEscrita = abrirDb, config = lerConfig, token = randomBytes(24).toString('hex'), leitorVivo = leitorNoAr } = {}) {
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
        return json(res, 200, enfileirarEnvio(db, { jid: corpo.jid, texto: corpo.texto, em: corpo.em, leitorVivo: leitorVivo() }));
      }
      if (url.pathname === '/api/cancelar') {
        db = abrirEscrita();
        return json(res, 200, cancelarEnvio(db, corpo.id));
      }
      return json(res, 404, { erro: 'não encontrado' });
    } catch (e) {
      return json(res, e instanceof ErroEnvio ? e.codigo : 500, { erro: e.message });
    } finally { try { db?.close(); } catch {} }
  }
  return srv;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  criarServidor().listen(PORTA, HOST, () => console.log(`Painel Zapdesk em http://${HOST}:${PORTA}`));
}
