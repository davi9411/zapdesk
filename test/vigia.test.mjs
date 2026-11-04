import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarVigia, novoEstadoVigia, textoVigia } from '../src/regras/vigia.mjs';

const min = (n) => n * 60_000;
const T0 = 1_000_000_000_000;

test('vigia: não avisa com o sinal de vida em dia nem sem arquivo', () => {
  const e = novoEstadoVigia();
  assert.equal(avaliarVigia(e, { agoraMs: T0 + min(5), batidaMs: T0 }), null);
  assert.equal(avaliarVigia(e, { agoraMs: T0 + min(11), batidaMs: T0 }), null);
  assert.equal(avaliarVigia(e, { agoraMs: T0 + min(99), batidaMs: 0 }), null);
});

test('vigia: um aviso por queda, lembrete a cada hora e aviso de volta', () => {
  const e = novoEstadoVigia();
  assert.deepEqual(avaliarVigia(e, { agoraMs: T0 + min(12), batidaMs: T0 }), { acao: 'caiu', min: 12 });
  assert.equal(avaliarVigia(e, { agoraMs: T0 + min(13), batidaMs: T0 }), null);           // não repete
  assert.equal(avaliarVigia(e, { agoraMs: T0 + min(70), batidaMs: T0 }), null);           // ainda dentro da hora do aviso
  assert.deepEqual(avaliarVigia(e, { agoraMs: T0 + min(73), batidaMs: T0 }), { acao: 'lembrete', min: 73 });
  const volta = avaliarVigia(e, { agoraMs: T0 + min(80), batidaMs: T0 + min(79) });
  assert.deepEqual(volta, { acao: 'voltou', min: 80 });
  assert.equal(avaliarVigia(e, { agoraMs: T0 + min(81), batidaMs: T0 + min(80) }), null);  // volta só uma vez
  assert.equal(avaliarVigia(e, { agoraMs: T0 + min(85), batidaMs: T0 + min(80) }), null);
  assert.equal(avaliarVigia(e, { agoraMs: T0 + min(95), batidaMs: T0 + min(80) })?.acao, 'caiu'); // nova queda: novo aviso
});

test('vigia: textos', () => {
  assert.match(textoVigia('Dante', { acao: 'caiu', min: 15 }), /parado há ~15 min/);
  assert.match(textoVigia('Dante', { acao: 'voltou', min: 20 }), /voltou a responder/);
});
