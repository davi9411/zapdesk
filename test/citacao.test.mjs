import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comCitacao } from '../src/agente/citacao.mjs';
import { citadoTexto } from '../src/conector/mensagens.mjs';

const cartao = '⏰ *#25 · César (+34674002165)* — sem resposta há 15 min\nÚltima msg: "..."\n\n1️⃣ *#25 ok* → mando a sugestão\n2️⃣ *#25 sua orientação*';

test('citação: responder em cima do cartão dispensa o número', () => {
  assert.equal(comCitacao('ok', cartao), '#25 ok');
  assert.equal(comCitacao('1', cartao), '#25 ok');
  assert.equal(comCitacao('3.', cartao), '#25 depois');
  assert.equal(comCitacao('pode falar que o set vai ser ajustado', cartao), '#25 pode falar que o set vai ser ajustado');
});

test('citação: tarefa, número já digitado e comandos gerais não mudam', () => {
  assert.equal(comCitacao('autorizo', '✅ *T3 pronta* (EA X) — ajuste'), 'T3 autorizo');
  assert.equal(comCitacao('entregar 2 dias', '✅ *T3 pronta* (EA X)'), 'T3 entregar 2 dias');
  assert.equal(comCitacao('#26 ok', cartao), '#26 ok');
  assert.equal(comCitacao('T4 cancelar', cartao), 'T4 cancelar');
  assert.equal(comCitacao('PAUSAR', cartao), 'PAUSAR');
  assert.equal(comCitacao('REGRA: não falar de preço', cartao), 'REGRA: não falar de preço');
  assert.equal(comCitacao('ok', null), 'ok');
  assert.equal(comCitacao('ok', 'um aviso sem número'), 'ok');
});

test('citação: lê o texto da mensagem citada', () => {
  const m = { extendedTextMessage: { text: 'ok', contextInfo: { quotedMessage: { conversation: cartao } } } };
  assert.equal(citadoTexto(m), cartao);
  assert.equal(citadoTexto({ conversation: 'oi' }), null);
});
