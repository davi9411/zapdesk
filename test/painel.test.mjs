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
    CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, chat TEXT NOT NULL, nome TEXT, texto TEXT, arquivos TEXT, enviar_em INTEGER NOT NULL, criado INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pendente', enviado_em INTEGER, erro TEXT, enquete TEXT);
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
  assert.equal(hostPermitido('zap.localhost:4747'), true);
  assert.equal(hostPermitido('zap.localhost.exemplo.com'), false);
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
    assert.equal((await fetch(url + '/api/conversas', { method: 'PUT' })).status, 405);
    assert.equal((await fetch(url + '/api/conversas/nada%40s.whatsapp.net')).status, 404);
    assert.equal((await fetch(url + '/')).status, 200);
    const status = await new Promise((ok, erro) => {
      const r = request({ host: '127.0.0.1', port: srv.address().port, path: '/api/conversas', headers: { host: 'mal.exemplo.com' } }, (res) => { res.resume(); ok(res.statusCode); });
      r.on('error', erro); r.end();
    });
    assert.equal(status, 403);
  } finally { srv.close(); db.close(); }
});

import { enfileirarEnvio, cancelarEnvio, montarTexto, CABECALHO_DAVI } from '../src/painel/envio.mjs';

const bancoComOutbox = bancoDeTeste;

test('envio: texto ganha o cabeçalho do Davi e não duplica', () => {
  assert.equal(montarTexto(' oi '), CABECALHO_DAVI + 'oi');
  assert.equal(montarTexto('> *Davi* | CEO e Desenvolvedor DS Trade\n\noi'), '> *Davi* | CEO e Desenvolvedor DS Trade\n\noi');
});

test('envio: enfileira, programa, recusa vazio, grupo, hora passada e leitor desligado', () => {
  const { db } = bancoComOutbox();
  chat(db, 'a@s.whatsapp.net', 'Ana'); chat(db, 'g@g.us', 'Grupo');
  const r = enfileirarEnvio(db, { jid: 'a@s.whatsapp.net', texto: 'oi', agora });
  assert.equal(r.programada, false);
  const linha = db.prepare('SELECT * FROM outbox WHERE id = ?').get(r.id);
  assert.equal(linha.texto, CABECALHO_DAVI + 'oi');
  assert.equal(linha.enviar_em, agora);
  assert.equal(linha.status, 'pendente');

  const p = enfileirarEnvio(db, { jid: 'a@s.whatsapp.net', texto: 'mais tarde', em: agora + 3600, agora, leitorVivo: false });
  assert.equal(p.programada, true);

  assert.throws(() => enfileirarEnvio(db, { jid: 'a@s.whatsapp.net', texto: '  ', agora }), /Escreva/);
  assert.throws(() => enfileirarEnvio(db, { jid: 'g@g.us', texto: 'oi', agora }), /privadas/);
  assert.throws(() => enfileirarEnvio(db, { jid: 'nada@s.whatsapp.net', texto: 'oi', agora }), /não encontrada/);
  assert.throws(() => enfileirarEnvio(db, { jid: 'a@s.whatsapp.net', texto: 'oi', em: agora - 5, agora }), /já passou/);
  assert.throws(() => enfileirarEnvio(db, { jid: 'a@s.whatsapp.net', texto: 'oi', agora, leitorVivo: false }), /leitor está desligado/);
});

test('envio: cancelar só vale para o que ainda está pendente', () => {
  const { db } = bancoComOutbox();
  chat(db, 'a@s.whatsapp.net', 'Ana');
  const a = enfileirarEnvio(db, { jid: 'a@s.whatsapp.net', texto: 'x', em: agora + 3600, agora });
  cancelarEnvio(db, a.id);
  assert.equal(db.prepare('SELECT status FROM outbox WHERE id = ?').get(a.id).status, 'cancelada');
  assert.throws(() => cancelarEnvio(db, a.id), /já saiu/);
});

test('painel: POST exige token, origem local e JSON; envia e cancela pela API', async () => {
  const { db, dados } = bancoComOutbox();
  chat(db, 'a@s.whatsapp.net', 'Ana');
  const srv = criarServidor({
    abrir: () => new DatabaseSync(join(dados, 'wa.db'), { readOnly: true }),
    abrirEscrita: () => new DatabaseSync(join(dados, 'wa.db')),
    config: () => lerConfig(dados), token: 'segredo', leitorVivo: () => true,
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const post = (rota, corpo, headers = {}) => fetch(url + rota, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(corpo) });
  try {
    assert.equal((await post('/api/enviar', { jid: 'a@s.whatsapp.net', texto: 'oi' })).status, 403);                              // sem token
    assert.equal((await post('/api/enviar', { jid: 'a@s.whatsapp.net', texto: 'oi' }, { 'x-painel-token': 'errado' })).status, 403);
    assert.equal((await post('/api/enviar', { jid: 'a@s.whatsapp.net', texto: 'oi' }, { 'x-painel-token': 'segredo', origin: 'https://mal.com' })).status, 403);
    const sem = await fetch(url + '/api/enviar', { method: 'POST', headers: { 'x-painel-token': 'segredo' }, body: 'x' });
    assert.equal(sem.status, 415);

    const ok = await post('/api/enviar', { jid: 'a@s.whatsapp.net', texto: 'oi' }, { 'x-painel-token': 'segredo', origin: url });
    assert.equal(ok.status, 200);
    const { id } = await ok.json();
    assert.equal((await post('/api/enviar', { jid: 'a@s.whatsapp.net', texto: '' }, { 'x-painel-token': 'segredo' })).status, 400);

    const det = await (await fetch(url + '/api/conversas/a%40s.whatsapp.net')).json();
    assert.equal(det.fila.length, 1);
    assert.equal(det.fila[0].id, id);
    assert.equal((await post('/api/cancelar', { id }, { 'x-painel-token': 'segredo' })).status, 200);
    assert.equal((await post('/api/cancelar', { id }, { 'x-painel-token': 'segredo' })).status, 409);
    assert.equal((await fetch(url + '/')).headers.get('content-type').startsWith('text/html'), true);
    assert.match(await (await fetch(url + '/')).text(), /const TOKEN = 'segredo'/);
  } finally { srv.close(); db.close(); }
});

import { assumirDeVolta, silenciar, reativar, definirPausa, silenciada, assumeTs } from '../src/agente/controle.mjs';

test('controle: assumir de volta ignora a equipe antes do instante; silêncio vence e pode expirar', () => {
  const { db, dados } = bancoDeTeste();
  const cfg = lerConfig(dados);
  chat(db, 'c@s.whatsapp.net', 'Caio'); msg(db, 'c@s.whatsapp.net', 1, agora - 900, 0, 'oi'); msg(db, 'c@s.whatsapp.net', 2, agora - 800, 1, 'Aqui é a equipe');
  db.prepare('INSERT INTO agente_chat (chat, ultimo_ts) VALUES (?, ?)').run('c@s.whatsapp.net', agora - 900);
  const st = () => listarConversas(db, { cfg, agora, dados })[0].status.codigo;
  assert.equal(st(), 'equipe');
  assumirDeVolta(db, 'c@s.whatsapp.net', agora - 100);
  assert.equal(assumeTs(db, 'c@s.whatsapp.net'), agora - 100);
  assert.notEqual(st(), 'equipe');                      // volta para o Dante
  msg(db, 'c@s.whatsapp.net', 3, agora - 50, 1, 'Mais uma da equipe'); // depois do "assume": conta de novo
  assert.equal(st(), 'equipe');

  silenciar(db, 'c@s.whatsapp.net', 0, agora);
  assert.equal(st(), 'silenciado');
  assert.deepEqual(silenciada(db, 'c@s.whatsapp.net', agora), { ate: 0 });
  silenciar(db, 'c@s.whatsapp.net', agora + 10, agora);
  assert.equal(silenciada(db, 'c@s.whatsapp.net', agora + 11), null); // venceu
  silenciar(db, 'c@s.whatsapp.net', 0, agora);
  reativar(db, 'c@s.whatsapp.net');
  assert.equal(silenciada(db, 'c@s.whatsapp.net', agora), null);

  definirPausa(db, true);
  assert.equal(st(), 'pausado');
  definirPausa(db, false);
  assert.notEqual(st(), 'pausado');
});

test('envio: "Dante continua" faz a mensagem do painel não contar como equipe', () => {
  const { db, dados } = bancoDeTeste();
  const cfg = lerConfig(dados);
  chat(db, 'a@s.whatsapp.net', 'Ana'); msg(db, 'a@s.whatsapp.net', 1, agora - 60, 0, 'oi');
  db.prepare('INSERT INTO agente_chat (chat, ultimo_ts) VALUES (?, ?)').run('a@s.whatsapp.net', agora - 60);
  enfileirarEnvio(db, { jid: 'a@s.whatsapp.net', texto: 'um instante', danteContinua: true, agora });
  msg(db, 'a@s.whatsapp.net', 2, agora + 5, 1, CABECALHO_DAVI + 'um instante'); // o leitor enviou
  assert.notEqual(listarConversas(db, { cfg, agora: agora + 10, dados })[0].status.codigo, 'equipe');
});

test('painel: rotas de controle exigem token e agem no banco', async () => {
  const { db, dados } = bancoDeTeste();
  chat(db, 'a@s.whatsapp.net', 'Ana');
  const srv = criarServidor({
    abrir: () => new DatabaseSync(join(dados, 'wa.db'), { readOnly: true }),
    abrirEscrita: () => new DatabaseSync(join(dados, 'wa.db')),
    config: () => lerConfig(dados), token: 't', leitorVivo: () => true,
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const post = (rota, corpo, token = 't') => fetch(url + rota, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-painel-token': token } : {}) }, body: JSON.stringify(corpo) });
  try {
    assert.equal((await post('/api/pausar', { pausado: true }, null)).status, 403);
    assert.equal((await post('/api/pausar', { pausado: true })).status, 200);
    assert.equal(db.prepare("SELECT v FROM agente_kv WHERE k = 'pausado'").get().v, '1');
    assert.equal((await post('/api/pausar', { pausado: false })).status, 200);
    assert.equal((await post('/api/silenciar', { jid: 'a@s.whatsapp.net', horas: 2 })).status, 200);
    const ate = db.prepare('SELECT ate FROM agente_silencio').get().ate;
    assert.ok(ate > Date.now() / 1000 + 7000 && ate < Date.now() / 1000 + 7300);
    assert.equal((await post('/api/reativar', { jid: 'a@s.whatsapp.net' })).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM agente_silencio').get().n, 0);
    assert.equal((await post('/api/assumir', { jid: 'a@s.whatsapp.net' })).status, 200);
    assert.ok(db.prepare('SELECT ts FROM agente_assume').get().ts > 0);
    assert.equal((await post('/api/silenciar', { jid: 'nada@s.whatsapp.net' })).status, 404);
  } finally { srv.close(); db.close(); }
});
