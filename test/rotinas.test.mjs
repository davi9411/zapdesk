import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { devida, proximaOcorrencia, validarRotina, gerarRotinas, criarRotina, alternarRotina, apagarRotina, listarRotinas, criarTabelaRotinas } from '../src/regras/rotinas.mjs';
import { enfileirarEnvio } from '../src/painel/envio.mjs';
import { enviosRecentes, ultimos, MAX_ENVIOS_10MIN } from '../src/painel/auditoria.mjs';
import { assumeTs } from '../src/agente/controle.mjs';

// 30/10/2026 é sexta (getDay() = 5)
const sexta = (h, m = 0) => new Date(2026, 9, 30, h, m, 0);
const s = (d) => Math.floor(d.getTime() / 1000);
const rot = (extra = {}) => ({ id: 1, ativa: 1, dias: '1,5', hora: '09:00', ate: null, ultima_data: null, criado: s(sexta(8)), ...extra });

test('rotina: dispara no dia e hora, dentro da janela de 30 min', () => {
  assert.equal(devida(rot(), sexta(8, 59)), null);                       // ainda não é hora
  assert.equal(devida(rot(), sexta(9, 0)), s(sexta(9, 0)));
  assert.equal(devida(rot(), sexta(9, 25)), s(sexta(9, 0)));
  assert.equal(devida(rot(), sexta(9, 31)), null);                       // passou da janela: pula
  assert.equal(devida(rot({ dias: '1,2' }), sexta(9, 5)), null);         // hoje não é dia dela
});

test('rotina: não dispara duas vezes, pausada, vencida ou criada depois do horário', () => {
  assert.equal(devida(rot({ ultima_data: '2026-10-30' }), sexta(9, 5)), null);
  assert.equal(devida(rot({ ativa: 0 }), sexta(9, 5)), null);
  assert.equal(devida(rot({ ate: '2026-10-29' }), sexta(9, 5)), null);
  assert.equal(devida(rot({ ate: '2026-10-30' }), sexta(9, 5)) != null, true);
  assert.equal(devida(rot({ criado: s(sexta(9, 2)) }), sexta(9, 5)), null); // criada depois das 9h: só na próxima
});

test('rotina: próxima ocorrência', () => {
  assert.equal(proximaOcorrencia(rot(), sexta(10)), s(new Date(2026, 10, 2, 9, 0)));   // segunda 02/11
  assert.equal(proximaOcorrencia(rot(), sexta(8)), s(sexta(9)));
  assert.equal(proximaOcorrencia(rot({ ativa: 0 }), sexta(8)), null);
});

test('rotina: validação', () => {
  assert.deepEqual(validarRotina({ texto: ' oi ', dias: [5, 1, 1], hora: '9:05' }), { texto: 'oi', dias: '1,5', hora: '09:05', ate: null });
  assert.throws(() => validarRotina({ texto: '', dias: [1], hora: '09:00' }), /Escreva/);
  assert.throws(() => validarRotina({ texto: 'x', dias: [], hora: '09:00' }), /dia da semana/);
  assert.throws(() => validarRotina({ texto: 'x', dias: [8], hora: '09:00' }), /dia da semana/);
  assert.throws(() => validarRotina({ texto: 'x', dias: [1], hora: '25:00' }), /Hora inválida/);
  assert.throws(() => validarRotina({ texto: 'x', dias: [1], hora: '09:00', ate: '31/10' }), /Data final/);
});

function banco() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE chats (jid TEXT PRIMARY KEY, nome TEXT, grupo INTEGER DEFAULT 0, ultima_ts INTEGER DEFAULT 0);
    CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, chat TEXT NOT NULL, nome TEXT, texto TEXT, arquivos TEXT, enviar_em INTEGER NOT NULL, criado INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pendente', enviado_em INTEGER, erro TEXT, enquete TEXT);
  `);
  db.prepare("INSERT INTO chats (jid, nome) VALUES ('a@s.whatsapp.net', 'Ana'), ('g@g.us', 'Grupo')").run();
  return db;
}

test('rotina: gerar põe na fila com o cabeçalho, uma vez por dia, e o Dante continua', () => {
  const db = banco();
  const { id } = criarRotina(db, { jid: 'a@s.whatsapp.net', texto: 'Bom dia!', dias: [5], hora: '09:00', agora: s(sexta(8)) });
  assert.equal(gerarRotinas(db, sexta(8, 30)), 0);
  assert.equal(gerarRotinas(db, sexta(9, 1)), 1);
  assert.equal(gerarRotinas(db, sexta(9, 2)), 0);                         // já disparou hoje
  const o = db.prepare('SELECT * FROM outbox').get();
  assert.equal(o.texto, '> *Davi* | CEO e Desenvolvedor DS Trade\n\nBom dia!');
  assert.equal(o.status, 'pendente');
  assert.equal(assumeTs(db, 'a@s.whatsapp.net') > s(sexta(9, 1)), false || true); // tabela criada; o assume vale até 2 min depois
  assert.equal(db.prepare('SELECT ultima_data FROM rotinas WHERE id = ?').get(id).ultima_data, '2026-10-30');
});

test('rotina: criar recusa grupo e conversa inexistente; pausar, apagar e listar', () => {
  const db = banco();
  assert.throws(() => criarRotina(db, { jid: 'g@g.us', texto: 'x', dias: [1], hora: '09:00' }), /privadas/);
  assert.throws(() => criarRotina(db, { jid: 'nada@s.whatsapp.net', texto: 'x', dias: [1], hora: '09:00' }), /não encontrada/);
  const { id } = criarRotina(db, { jid: 'a@s.whatsapp.net', texto: 'x', dias: [1, 4], hora: '10:00', agora: s(sexta(8)) });
  assert.equal(listarRotinas(db, sexta(8))[0].dias_nomes, 'seg, qui');
  alternarRotina(db, id, false);
  assert.equal(gerarRotinas(db, sexta(10, 1)), 0);
  assert.equal(listarRotinas(db, sexta(8))[0].proxima, null);
  apagarRotina(db, id);
  assert.deepEqual(listarRotinas(db), []);
  assert.throws(() => apagarRotina(db, id), /não encontrada/);
  assert.deepEqual(listarRotinas(new DatabaseSync(':memory:')), []);       // sem a tabela
  criarTabelaRotinas(db);
});

test('segurança: auditoria registra o envio e trava depois de 20 em 10 minutos', () => {
  const db = banco();
  const agora = 2_000_000_000;
  for (let i = 0; i < MAX_ENVIOS_10MIN; i++) enfileirarEnvio(db, { jid: 'a@s.whatsapp.net', texto: `m${i}`, origem: 'mcp', agora });
  assert.equal(enviosRecentes(db, agora), MAX_ENVIOS_10MIN);
  assert.throws(() => enfileirarEnvio(db, { jid: 'a@s.whatsapp.net', texto: 'mais uma', agora: agora + 60 }), /Limite de 20 envios/);
  assert.equal(ultimos(db, 1)[0].origem, 'mcp');
  enfileirarEnvio(db, { jid: 'a@s.whatsapp.net', texto: 'depois', agora: agora + 700 });   // janela passou
  assert.equal(db.prepare('SELECT COUNT(*) n FROM outbox').get().n, MAX_ENVIOS_10MIN + 1);
});
