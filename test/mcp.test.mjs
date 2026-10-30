import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tratar } from '../src/mcp/servidor.mjs';
import { lerConfig, acharConversa } from '../src/painel/dados.mjs';

const agora = Math.floor(Date.now() / 1000);

function ambiente() {
  const dados = mkdtempSync(join(tmpdir(), 'mcp-'));
  const arq = join(dados, 'wa.db');
  const db = new DatabaseSync(arq);
  db.exec(`
    CREATE TABLE chats (jid TEXT PRIMARY KEY, nome TEXT, grupo INTEGER DEFAULT 0, ultima_ts INTEGER DEFAULT 0);
    CREATE TABLE msgs (chat TEXT, id TEXT, ts INTEGER, meu INTEGER DEFAULT 0, de TEXT, tipo TEXT, texto TEXT, transcricao TEXT);
    CREATE TABLE etiquetas (id TEXT PRIMARY KEY, nome TEXT, cor INTEGER);
    CREATE TABLE etiqueta_chat (chat TEXT, etiqueta TEXT);
    CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, chat TEXT NOT NULL, nome TEXT, texto TEXT, arquivos TEXT, enviar_em INTEGER NOT NULL, criado INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pendente', enviado_em INTEGER, erro TEXT, enquete TEXT);
  `);
  writeFileSync(join(dados, 'agente.json'), JSON.stringify({ inicio: '2020-01-01T00:00:00Z', davi: '5511900000000' }));
  const put = (jid, nome) => db.prepare('INSERT INTO chats (jid, nome, ultima_ts) VALUES (?, ?, ?)').run(jid, nome, agora);
  put('5511911110000@s.whatsapp.net', 'Ana Souza'); put('5511922220000@s.whatsapp.net', 'Ana Lima'); put('g@g.us', 'Grupo');
  db.prepare("INSERT INTO msgs (chat, id, ts, meu, tipo, texto) VALUES ('5511911110000@s.whatsapp.net', '1', ?, 0, 'texto', 'oi, preciso de ajuda')").run(agora - 30);
  const ctx = {
    ler: () => new DatabaseSync(arq, { readOnly: true }),
    escrever: () => { const d = new DatabaseSync(arq); d.exec('PRAGMA busy_timeout = 2000'); return d; },
    config: () => lerConfig(dados), leitorVivo: () => true,
  };
  return { db, ctx, dados };
}
const chamar = (ctx, name, args) => tratar({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx).result;
const texto = (r) => r.content[0].text;

test('mcp: initialize, ping, lista de ferramentas e método desconhecido', () => {
  const ini = tratar({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(ini.result.serverInfo.name, 'zapdesk');
  assert.equal(ini.result.protocolVersion, '2025-03-26');
  assert.deepEqual(tratar({ jsonrpc: '2.0', id: 2, method: 'ping' }).result, {});
  const nomes = tratar({ jsonrpc: '2.0', id: 3, method: 'tools/list' }).result.tools.map((t) => t.name);
  for (const n of ['zapdesk_conversas', 'zapdesk_ler', 'zapdesk_status', 'zapdesk_enviar', 'zapdesk_fila', 'zapdesk_cancelar', 'zapdesk_dante', 'zapdesk_rotinas']) assert.ok(nomes.includes(n), n);
  assert.equal(tratar({ jsonrpc: '2.0', id: 4, method: 'nada' }).error.code, -32601);
  assert.equal(tratar({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('mcp: conversas e ler mostram status e mensagens', () => {
  const { ctx } = ambiente();
  const lista = texto(chamar(ctx, 'zapdesk_conversas', {}));
  assert.match(lista, /Ana Souza \(\+5511911110000\) \| Dante vai responder/);
  assert.doesNotMatch(lista, /Grupo/);
  assert.match(texto(chamar(ctx, 'zapdesk_conversas', { status: 'vai-responder' })), /Ana Souza/);
  assert.equal(texto(chamar(ctx, 'zapdesk_conversas', { busca: 'zzz' })), 'Nenhuma conversa.');
  const ler = texto(chamar(ctx, 'zapdesk_ler', { chat: 'souza' }));
  assert.match(ler, /CLIENTE: oi, preciso de ajuda/);
});

test('mcp: conversa ambígua pede o número e inexistente dá erro', () => {
  const { ctx } = ambiente();
  const r = chamar(ctx, 'zapdesk_ler', { chat: 'Ana' });
  assert.equal(r.isError, true);
  assert.match(texto(r), /Mais de uma conversa/);
  assert.equal(chamar(ctx, 'zapdesk_ler', { chat: '5511922220000' }).isError, undefined);
  assert.equal(chamar(ctx, 'zapdesk_ler', { chat: 'ninguem' }).isError, true);
  const { db } = ambiente();
  assert.equal(acharConversa(db, 'Ana Souza').jid, '5511911110000@s.whatsapp.net');
});

test('mcp: enviar usa o cabeçalho do Davi, programa, lista a fila e cancela', () => {
  const { ctx, db } = ambiente();
  const e = texto(chamar(ctx, 'zapdesk_enviar', { chat: '5511911110000', texto: 'Já vi aqui, te respondo já.' }));
  assert.match(e, /Na fila para envio agora: #1/);
  assert.equal(db.prepare('SELECT texto FROM outbox WHERE id = 1').get().texto, '> *Davi* | CEO e Desenvolvedor DS Trade\n\nJá vi aqui, te respondo já.');

  const amanha = new Date(Date.now() + 86_400_000);
  const quando = `${amanha.getFullYear()}-${String(amanha.getMonth() + 1).padStart(2, '0')}-${String(amanha.getDate()).padStart(2, '0')} 09:00`;
  assert.match(texto(chamar(ctx, 'zapdesk_enviar', { chat: 'Ana Souza', texto: 'depois', em: quando })), /Programada para/);
  assert.match(texto(chamar(ctx, 'zapdesk_fila', {})), /#2 \[pendente\]/);
  assert.match(texto(chamar(ctx, 'zapdesk_cancelar', { id: 2 })), /cancelada/);
  assert.equal(chamar(ctx, 'zapdesk_cancelar', { id: 2 }).isError, true);
  assert.equal(chamar(ctx, 'zapdesk_enviar', { chat: 'Ana Souza', texto: 'x', em: 'amanhã cedo' }).isError, true);
  assert.equal(chamar(ctx, 'zapdesk_enviar', { chat: 'Ana Souza', texto: '   ' }).isError, true);
});

test('mcp: controles do Dante (silenciar, reativar, assumir, pausar)', () => {
  const { ctx } = ambiente();
  assert.match(texto(chamar(ctx, 'zapdesk_dante', { acao: 'silenciar', chat: 'Ana Souza', horas: 2 })), /por 2 h/);
  assert.match(texto(chamar(ctx, 'zapdesk_conversas', { busca: 'souza' })), /Dante silenciado/);
  assert.match(texto(chamar(ctx, 'zapdesk_dante', { acao: 'reativar', chat: 'Ana Souza' })), /reativado/);
  assert.match(texto(chamar(ctx, 'zapdesk_dante', { acao: 'assumir', chat: 'Ana Souza' })), /assume de volta/);
  assert.match(texto(chamar(ctx, 'zapdesk_dante', { acao: 'pausar' })), /PAUSADO/);
  assert.match(texto(chamar(ctx, 'zapdesk_conversas', { busca: 'souza' })), /Pausado/);
  assert.match(texto(chamar(ctx, 'zapdesk_dante', { acao: 'retomar' })), /retomado/);
  assert.equal(chamar(ctx, 'zapdesk_dante', { acao: 'silenciar' }).isError, true); // sem conversa
});

test('mcp: processo real responde no stdio', async () => {
  const dados = mkdtempSync(join(tmpdir(), 'mcp-stdio-'));
  const p = spawn(process.execPath, ['--no-warnings', 'src/mcp/servidor.mjs'], { env: { ...process.env, WA_DATA: dados }, stdio: ['pipe', 'pipe', 'inherit'] });
  const linhas = [];
  p.stdout.on('data', (d) => linhas.push(...String(d).split('\n').filter(Boolean)));
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  await new Promise((ok) => { const t = setInterval(() => { if (linhas.length >= 2) { clearInterval(t); ok(); } }, 50); setTimeout(ok, 8000); });
  p.kill();
  assert.equal(linhas.length, 2);
  assert.equal(JSON.parse(linhas[1]).result.tools.length, 8);
});
