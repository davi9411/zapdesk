import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comandoFalado, numeroFalado } from '../src/agente/voz.mjs';

test('números falados', () => {
  assert.equal(numeroFalado('seis'), 6);
  assert.equal(numeroFalado('12'), 12);
  assert.equal(numeroFalado('vinte e três'), 23);
  assert.equal(numeroFalado('trinta'), 30);
  assert.equal(numeroFalado('banana'), null);
});

test('caso falado vira #N', () => {
  assert.equal(comandoFalado('Hashtag seis, pede o print da aba Diário.'), '#6 pede o print da aba Diário.');
  assert.equal(comandoFalado('hashtag 6 ok'), '#6 ok');
  assert.equal(comandoFalado('#7 depois'), '#7 depois');
  assert.equal(comandoFalado('Caso vinte e um: diz que amanhã eu ligo.'), '#21 diz que amanhã eu ligo.');
  assert.equal(comandoFalado('Jogo da velha 3, ok.'), '#3 ok.');
});

test('comandos e regras falados', () => {
  assert.equal(comandoFalado('Pausar.'), 'PAUSAR');
  assert.equal(comandoFalado('pausa'), 'PAUSAR');
  assert.equal(comandoFalado('Status?'), 'STATUS');
  assert.equal(comandoFalado('Sim.'), 'SIM');
  assert.equal(comandoFalado('Não.'), 'NÃO');
  assert.equal(comandoFalado('Regra, nunca falar de prazo.'), 'REGRA: nunca falar de prazo.');
  assert.equal(comandoFalado('Nova regra: sempre pedir a corretora.'), 'REGRA: sempre pedir a corretora.');
});

test('texto livre passa igual', () => {
  assert.equal(comandoFalado('manda pro Mailson que a versão sai amanhã'), 'manda pro Mailson que a versão sai amanhã');
  assert.equal(comandoFalado('Casou bem com o que eu queria'), 'Casou bem com o que eu queria');
});
