import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { statusConversa, ehHumano, ehDoAgente } from '../src/painel/status.mjs';
import { listarConversas, detalharConversa, lerConfig } from '../src/painel/dados.mjs';
import { criarServidor, hostPermitido } from '../src/painel/servidor.mjs';

const H = 3600;
const base = { agora: 1_000_000, humanoHoras: 12 };
const cod = (f) => statusConversa({ ...base, ...f }).codigo;

test('status: ordem de prioridade', () => {
  assert.equal(cod({}), 'dante');
  assert.equal(cod({ semEstado: true }), 'sem-dante');
  assert.equal(cod({ ultimaDoAgente: true }), 'esperando-cliente');
  assert.equal(cod({ casoAberto: 5, ultimaDoAgente: true }), 'caso');
  assert.equal(cod({ pendente: true, casoAberto: 5 }), 'vai-responder');
  assert.equal(cod({ humanoTs: base.agora - 2 * H, pendente: true }), 'equipe');
  assert.equal(cod({ escolhaHumanoTs: base.agora - H, humanoTs: base.agora - H }), 'aguardando-equipe');
  assert.equal(cod({ pausado: true, humanoTs: base.agora - H }), 'pausado');
  assert.equal(cod({ fora: true, pausado: true }), 'fora');
});

test('status: equipe vale 12 h e aguardando equipe vale 3 dias', () => {
  const eq = statusConversa({ ...base, humanoTs: base.agora - 2 * H });
  assert.equal(eq.ate, base.agora - 2 * H + 12 * H);
  assert.equal(cod({ humanoTs: base.agora - 13 * H }), 'dante');
  assert.equal(cod({ escolhaHumanoTs: base.agora - 4 * 86400 }), 'dante');
});

test('status: mensagem do agente e aviso automático não contam como equipe', () => {
  const cfg = { nome: 'Dante', empresa: 'DS Trade' };
  assert.equal(ehDoAgente(cfg, '*Dante | Agente IA DS Trade:*\nOi!'), true);
  assert.equal(ehDoAgente(cfg, 'enquete: Dante | Agente IA DS Trade ...'), true);
  assert.equal(ehHumano(cfg, 'Oi, aqui é o Davi'), true);
  assert.equal(ehHumano(cfg, 'Olá! Estamos fora', ['Olá! Estamos fora']), false);
  assert.equal(ehHumano(cfg, null), true);
});

function bancoDeTeste() {
  const dados = mkdtempSync(join(tmpdir(), 'painel-'));
  const db = new DatabaseSync(join(dados, 'wa.db'));
  db.exec(`
    CREATE TABLE chats (jid TEXT PRIMARY KEY, nome TEXT, grupo INTEGER DEFAULT 0, ultima_ts INTEGER DEFAULT 0);
    CREATE TABLE msgs (chat TEXT, id TEXT, ts INTEGER, meu INTEGER DEFAULT 0, de TEXT, tipo TEXT, texto TEXT, transcricao TEXT);
    CREATE TABLE etiquetas (id TEXT PRIMARY KEY, nome TEXT, cor INTEGER);
    CREATE TABLE etiqueta_chat (chat TEXT, etiqueta TEXT);
    CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT);
    CREATE TABLE agente_chat (chat TEXT PRIMARY KEY, ultimo_ts INTEGER DEFAULT 0, humano INTEGER DEFAULT 0, escolha TEXT, prefere_humano_ts INTEGER DEFAULT 0, nome_cliente TEXT, perfil TEXT, origem TEXT);
    CREATE TABLE agente_caso (id INTEGER PRIMARY KEY AUTOINCREMENT, chat TEXT, nome TEXT, resumo TEXT, pergunta TEXT, status TEXT DEFAULT 'aberto', criado INTEGER, tipo TEXT);
    CREATE TABLE agente_kv (k TEXT PRIMARY KEY, v TEXT);
  `);
  writeFileSync(join(dados, 'agente.json'), JSON.stringify({ inicio: '2020-01-01T00:00:00Z', davi: '5511900000000', excluir: ['5511977770000'] }));
  return { db, dados };
}
const agora = 2_000_000_000;
const chat = (db, jid, nome) => db.prepare('INSERT INTO chats (jid, nome, ultima_ts) VALUES (?, ?, ?)').run(jid, nome, agora);
const msg = (db, jid, i, ts, meu, texto) => db.prepare("INSERT INTO msgs (chat, id, ts, meu, tipo, texto) VALUES (?, ?, ?, ?, 'texto', ?)").run(jid, String(i), ts, meu, texto);

test('painel: lista conversas com o status certo e esconde grupos', () => {
  const { db, dados } = bancoDeTeste();
  const cfg = lerConfig(dados);
  chat(db, 'a@s.whatsapp.net', 'Ana'); msg(db, 'a@s.whatsapp.net', 1, agora - 60, 0, 'oi');                       // pendente
  chat(db, 'b@s.whatsapp.net', 'Beto'); msg(db, 'b@s.whatsapp.net', 2, agora - 600, 0, 'oi'); msg(db, 'b@s.whatsapp.net', 3, agora - 500, 1, '*Dante | Agente IA DS Trade:*\nOlá');
  db.prepare('INSERT INTO agente_chat (chat, ultimo_ts) VALUES (?, ?)').run('b@s.whatsapp.net', agora - 600);      // esperando cliente
  chat(db, 'c@s.whatsapp.net', 'Caio'); msg(db, 'c@s.whatsapp.net', 4, agora - 900, 0, 'oi'); msg(db, 'c@s.whatsapp.net', 5, agora - 800, 1, 'Aqui é a equipe');
  db.prepare('INSERT INTO agente_chat (chat, ultimo_ts) VALUES (?, ?)').run('c@s.whatsapp.net', agora - 900);      // equipe
  chat(db, '5511977770000@s.whatsapp.net', 'Excluído'); msg(db, '5511977770000@s.whatsapp.net', 6, agora - 10, 0, 'oi'); // fora
  chat(db, 'g@g.us', 'Grupo'); msg(db, 'g@g.us', 7, agora - 10, 0, 'oi');
  db.prepare("INSERT INTO etiquetas VALUES ('1', 'Pessoal🏠', 0)").run();
  chat(db, 'd@s.whatsapp.net', 'Dani'); msg(db, 'd@s.whatsapp.net', 8, agora - 10, 0, 'oi');
  db.prepare("INSERT INTO etiqueta_chat VALUES ('d@s.whatsapp.net', '1')").run();                                   // fora por etiqueta

  const r = Object.fromEntries(listarConversas(db, { cfg, agora, dados }).map((c) => [c.nome, c.status.codigo]));
  assert.deepEqual(r, { Ana: 'vai-responder', Beto: 'esperando-cliente', Caio: 'equipe', 'Excluído': 'fora', Dani: 'fora' });
});

test('painel: pausado e caso aberto aparecem no status', () => {
  const { db, dados } = bancoDeTeste();
  const cfg = lerConfig(dados);
  chat(db, 'a@s.whatsapp.net', 'Ana'); msg(db, 'a@s.whatsapp.net', 1, agora - 60, 0, 'oi');
  db.prepare('INSERT INTO agente_chat (chat, ultimo_ts) VALUES (?, ?)').run('a@s.whatsapp.net', agora - 60);
  db.prepare("INSERT INTO agente_caso (chat, resumo, criado) VALUES ('a@s.whatsapp.net', 'preço', ?)").run(agora);
  assert.equal(listarConversas(db, { cfg, agora, dados })[0].status.codigo, 'caso');
  db.prepare("INSERT INTO agente_kv VALUES ('pausado', '1')").run();
  assert.equal(listarConversas(db, { cfg, agora, dados })[0].status.codigo, 'pausado');
});

test('painel: detalhe traz quem escreveu cada mensagem; conversa inexistente dá null', () => {
  const { db, dados } = bancoDeTeste();
  const cfg = lerConfig(dados);
  chat(db, 'a@s.whatsapp.net', 'Ana');
  msg(db, 'a@s.whatsapp.net', 1, agora - 30, 0, 'oi'); msg(db, 'a@s.whatsapp.net', 2, agora - 20, 1, '*Dante | Agente IA DS Trade:*\nOlá'); msg(db, 'a@s.whatsapp.net', 3, agora - 10, 1, 'Davi falando');
  const d = detalharConversa(db, 'a@s.whatsapp.net', { cfg, agora, dados });
  assert.deepEqual(d.msgs.map((m) => m.quem), ['CLIENTE', 'DANTE', 'EQUIPE']);
  assert.equal(detalharConversa(db, 'x@s.whatsapp.net', { cfg, agora, dados }), null);
});

test('painel: servidor só aceita host local e só GET', async () => {
  assert.equal(hostPermitido('127.0.0.1:4747'), true);
  assert.equal(hostPermitido('localhost:4747'), true);
  assert.equal(hostPermitido('exemplo.com'), false);
  assert.equal(hostPermitido(undefined), false);

  const { db, dados } = bancoDeTeste();
  chat(db, 'a@s.whatsapp.net', 'Ana'); msg(db, 'a@s.whatsapp.net', 1, agora - 60, 0, 'oi');
  const srv = criarServidor({ abrir: () => new DatabaseSync(join(dados, 'wa.db'), { readOnly: true }), config: () => lerConfig(dados) });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    const lista = await (await fetch(url + '/api/conversas')).json();
    assert.equal(lista[0].nome, 'Ana');
    assert.equal((await fetch(url + '/api/conversas', { method: 'POST' })).status, 405);
    assert.equal((await fetch(url + '/api/conversas/nada%40s.whatsapp.net')).status, 404);
    assert.equal((await fetch(url + '/')).status, 200);
    const status = await new Promise((ok, erro) => {
      const r = request({ host: '127.0.0.1', port: srv.address().port, path: '/api/conversas', headers: { host: 'mal.exemplo.com' } }, (res) => { res.resume(); ok(res.statusCode); });
      r.on('error', erro); r.end();
    });
    assert.equal(status, 403);
  } finally { srv.close(); db.close(); }
});
