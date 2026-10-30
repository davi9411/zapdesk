// Painel local do Zapdesk (somente leitura nesta etapa). Escuta APENAS em 127.0.0.1.
// Uso: node src/painel/servidor.mjs   (porta em PAINEL_PORTA, padrão 4747)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { abrirLeitura, lerConfig, listarConversas, detalharConversa, resumoDante } from './dados.mjs';

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

export function criarServidor({ abrir = abrirLeitura, config = lerConfig } = {}) {
  return createServer((req, res) => {
    if (!hostPermitido(req.headers.host)) return json(res, 403, { erro: 'host não permitido' });
    if (req.method !== 'GET') return json(res, 405, { erro: 'somente leitura' });
    const url = new URL(req.url, `http://${HOST}`);
    let db;
    try {
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(readFileSync(join(AQUI, 'pagina.html')));
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
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  criarServidor().listen(PORTA, HOST, () => console.log(`Painel Zapdesk em http://${HOST}:${PORTA} (somente leitura)`));
}
