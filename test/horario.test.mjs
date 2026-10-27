import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aberto, proximaAbertura, textoRetorno } from '../src/regras/horario.mjs';

const cfg = { dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00' };
const em = (a, mes, d, h, m = 0) => new Date(a, mes - 1, d, h, m);

test('aberto só em dia útil, dentro do horário, fora de feriado', () => {
  assert.equal(aberto(cfg, em(2026, 10, 27, 10)), true);   // terça 10h
  assert.equal(aberto(cfg, em(2026, 10, 27, 8, 59)), false);
  assert.equal(aberto(cfg, em(2026, 10, 27, 18)), false);
  assert.equal(aberto(cfg, em(2026, 10, 31, 10)), false);  // sábado
  assert.equal(aberto(cfg, em(2026, 11, 2, 10)), false);   // Finados (segunda)
  assert.equal(aberto({ ...cfg, feriados: ['2026-10-28'] }, em(2026, 10, 28, 10)), false);
});

test('próxima abertura: noite, madrugada, fim de semana e feriado', () => {
  assert.deepEqual(proximaAbertura(cfg, em(2026, 10, 27, 21)), em(2026, 10, 28, 9));  // terça noite -> quarta 9h
  assert.deepEqual(proximaAbertura(cfg, em(2026, 10, 28, 6)), em(2026, 10, 28, 9));   // madrugada -> mesmo dia
  assert.deepEqual(proximaAbertura(cfg, em(2026, 10, 30, 19)), em(2026, 11, 3, 9));   // sexta noite -> terça (segunda é Finados)
  const agora = em(2026, 10, 27, 10);
  assert.equal(proximaAbertura(cfg, agora), agora);
});

test('texto do retorno', () => {
  assert.equal(textoRetorno(cfg, em(2026, 10, 27, 21)), 'amanhã (quarta-feira, 28/10) às 09:00');
  assert.equal(textoRetorno(cfg, em(2026, 10, 28, 6)), 'hoje às 09:00');
  assert.equal(textoRetorno(cfg, em(2026, 10, 30, 19)), 'terça-feira (03/11) às 09:00');
});
