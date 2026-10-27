import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { escolherApagar, limparMidia } from '../src/regras/limpeza.mjs';
import { processoVivo, python, claudeExe, WIN } from '../src/sistema.mjs';

const DIA = 86_400_000;
const agora = Date.UTC(2026, 9, 27);
const arq = (caminho, idadeDias, mb) => ({ caminho, mtimeMs: agora - idadeDias * DIA, tamanho: mb * 1048576 });

test('limpeza: apaga o que passou dos dias', () => {
  const lista = [arq('a', 10, 1), arq('b', 8, 1), arq('c', 2, 1)];
  assert.deepEqual(escolherApagar(lista, { dias: 7, agora }).sort(), ['a', 'b']);
  assert.deepEqual(escolherApagar(lista, { dias: 30, agora }), []);
});

test('limpeza: acima do limite apaga a mais antiga até o alvo', () => {
  const lista = [arq('novo', 0, 4), arq('medio', 1, 4), arq('velho', 2, 4)]; // 12 MB
  const r = escolherApagar(lista, { dias: 30, maxBytes: 10 * 1048576, alvoBytes: 5 * 1048576, agora });
  assert.deepEqual(r.sort(), ['medio', 'velho']); // sobra só o mais novo (4 MB <= 5 MB)
});

test('limpeza: apaga os arquivos e solta a referência no banco', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'wa-midia-'));
  mkdirSync(join(pasta, 'chat1'));
  const velho = join(pasta, 'chat1', 'velho.ogg');
  const novo = join(pasta, 'chat1', 'novo.ogg');
  writeFileSync(velho, 'x'); writeFileSync(novo, 'y');
  const dezDias = (Date.now() - 10 * DIA) / 1000;
  utimesSync(velho, dezDias, dezDias);
  const soltos = [];
  const db = { prepare: () => ({ run: (c) => soltos.push(c) }) };
  assert.equal(limparMidia(db, pasta, { dias: 7, simular: true }).apagados, 1);
  assert.equal(existsSync(velho), true); // simulação não apaga
  const r = limparMidia(db, pasta, { dias: 7 });
  assert.equal(r.apagados, 1); assert.equal(r.restantes, 1);
  assert.equal(existsSync(velho), false); assert.equal(existsSync(novo), true);
  assert.deepEqual(soltos, [velho]);
});

test('sistema: processo vivo, python e claude por plataforma', () => {
  assert.equal(processoVivo(process.pid), true);
  assert.equal(processoVivo(0), false);
  assert.equal(processoVivo(2 ** 22 + 12345), false);
  assert.deepEqual(python(), process.env.WA_PYTHON ? [process.env.WA_PYTHON] : (WIN ? ['py', '-3'] : ['python3']));
  if (!process.env.WA_CLAUDE) assert.match(claudeExe(), WIN ? /claude\.exe$/ : /^claude$/);
});
