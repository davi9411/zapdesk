import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propostaConfirmada } from '../src/agente/confirmacao.mjs';

const proposta = 'Gabriel, já entendemos a sua demanda. O valor fica R$ 300,00 e o prazo de entrega é amanhã à tarde. Pode confirmar?';

test('confirmação: "pode iniciar" e "confirma" depois da proposta não pedem resposta', () => {
  assert.equal(propostaConfirmada({ propostaTexto: proposta, mensagensCliente: ['Pode iniciar !!!', 'Confirma'] }), true);
  assert.equal(propostaConfirmada({ propostaTexto: proposta, mensagensCliente: ['Fechado'] }), true);
  assert.equal(propostaConfirmada({ propostaTexto: proposta, mensagensCliente: ['ok'] }), true);
});

test('confirmação: pergunta, texto longo ou proposta sem valor/prazo seguem o fluxo normal', () => {
  assert.equal(propostaConfirmada({ propostaTexto: proposta, mensagensCliente: ['Pode iniciar, mas dá pra entregar hoje?'] }), false);
  assert.equal(propostaConfirmada({ propostaTexto: proposta, mensagensCliente: ['Pode fazer, só que eu queria também trocar o nome do robô e as cores do painel e das linhas'] }), false);
  assert.equal(propostaConfirmada({ propostaTexto: 'Me conta o que você quer que a gente faça com o arquivo?', mensagensCliente: ['Isso mesmo'] }), false);
  assert.equal(propostaConfirmada({ propostaTexto: proposta, mensagensCliente: [] }), false);
  assert.equal(propostaConfirmada({ propostaTexto: null, mensagensCliente: ['ok'] }), false);
});
