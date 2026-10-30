// Servidor MCP do Zapdesk (stdio, JSON-RPC por linha): dá ao Claude Code as mesmas ações do painel.
// Registro no Claude Code:  claude mcp add zapdesk -- node --no-warnings <repo>\src\mcp\servidor.mjs
// (a pasta de dados é achada sozinha; WA_DATA opcional)
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { abrirLeitura, abrirEscrita, lerConfig, leitorVivo } from '../painel/dados.mjs';
import { FERRAMENTAS, chamar } from './ferramentas.mjs';

const VERSAO = '0.1.0';
const CTX = { ler: abrirLeitura, escrever: abrirEscrita, config: lerConfig, leitorVivo };

// trata uma mensagem JSON-RPC; devolve a resposta (ou null para notificações)
export function tratar(msg, ctx = CTX) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const erro = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined) return null; // notifications/initialized etc.
  switch (method) {
    case 'initialize':
      return ok({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'zapdesk', version: VERSAO } });
    case 'ping': return ok({});
    case 'tools/list':
      return ok({ tools: FERRAMENTAS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call':
      try {
        const texto = chamar(params?.name, params?.arguments, ctx);
        return ok({ content: [{ type: 'text', text: String(texto) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true });
      }
    default: return erro(-32601, `Método não suportado: ${method}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createInterface({ input: process.stdin }).on('line', (linha) => {
    if (!linha.trim()) return;
    let resp;
    try { resp = tratar(JSON.parse(linha)); } catch (e) { resp = { jsonrpc: '2.0', id: null, error: { code: -32700, message: e.message } }; }
    if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
  });
}
