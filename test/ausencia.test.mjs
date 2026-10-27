import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// banco e configuração numa pasta temporária (nunca na pasta real do leitor)
process.env.WA_DATA = mkdtempSync(join(tmpdir(), 'wa-teste-'));
const { abrirDb } = await import('../src/db.mjs');
const { lerAusencia, deveResponder, criarRegistro } = await import('../src/ausencia.mjs');

const agora = Date.now();
const cfg = (extra = {}) => {
  const arq = join(process.env.WA_DATA, 'ausencia.json');
  writeFileSync(arq, JSON.stringify({
    inicio: new Date(agora - 3600_000).toISOString(),
    fim: new Date(agora + 3600_000).toISOString(),
    texto: 'Estamos fora, voltamos sexta.',
    ...extra,
  }));
  return lerAusencia(arq);
};
const msg = (extra = {}) => ({ jid: '5511888887777@s.whatsapp.net', grupo: 0, meu: false, ts: Math.floor(agora / 1000) - 5, meuNumero: '5511999990000', agora, ...extra });

test('responde mensagem privada recente dentro do período', () => {
  assert.equal(deveResponder(cfg(), msg()), true);
});

test('ignora grupo, mensagem própria, o próprio número e números excluídos', () => {
  const a = cfg({ excluir: ['55 11 88888-7777'] });
  assert.equal(deveResponder(cfg(), msg({ grupo: 1, jid: '123@g.us' })), false);
  assert.equal(deveResponder(cfg(), msg({ meu: true })), false);
  assert.equal(deveResponder(cfg(), msg({ jid: '5511999990000@s.whatsapp.net' })), false);
  assert.equal(deveResponder(a, msg()), false);
});

test('com "somente", só os números da lista recebem', () => {
  const a = cfg({ somente: ['+55 (11) 88888-7777'] });
  assert.equal(deveResponder(a, msg()), true);
  assert.equal(deveResponder(a, msg({ jid: '5511777776666@s.whatsapp.net' })), false);
});

test('ignora fora do período, histórico antigo e configuração desligada', () => {
  assert.equal(deveResponder(cfg({ inicio: new Date(agora + 60_000).toISOString() }), msg()), false);
  assert.equal(deveResponder(cfg(), msg({ ts: Math.floor(agora / 1000) - 3600 })), false);
  assert.equal(cfg({ ativo: false }), null);
});

test('cada chat recebe o aviso uma única vez por período, com trava por hora', () => {
  const db = abrirDb();
  const registrar = criarRegistro(db);
  const a = cfg({ maxPorHora: 2 });
  assert.equal(registrar(a, 'a@s.whatsapp.net', 'A'), 'enfileirada');
  assert.equal(registrar(a, 'a@s.whatsapp.net', 'A'), 'ja-enviada');
  assert.equal(registrar(a, 'b@s.whatsapp.net', 'B'), 'enfileirada');
  assert.equal(registrar(a, 'c@s.whatsapp.net', 'C'), 'limite');
  const fila = db.prepare('SELECT chat, texto, status FROM outbox ORDER BY id').all();
  assert.deepEqual(fila.map((r) => r.chat), ['a@s.whatsapp.net', 'b@s.whatsapp.net']);
  assert.equal(fila[0].texto, 'Estamos fora, voltamos sexta.');
  assert.equal(fila[0].status, 'pendente');
});
