import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerLembretes, contasDoDia, lembretesDevidos, gerarLembretes, textoLembrete } from '../src/regras/lembretes.mjs';
import { avaliarItem } from '../src/canais/fila.mjs';

const cfg = { chat: '1@g.us', hora: 9 * 60, avisos: [
  { dia: 6, nome: 'IPTU da praia' }, { dia: 10, nome: 'Internet' }, { dia: 10, nome: 'Condomínio' }, { dia: 31, nome: 'Fim do mês' }] };
const dia = (m, d, h = 9, min = 0) => new Date(2026, m - 1, d, h, min, 0);
const bd = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, chat TEXT, nome TEXT, texto TEXT, arquivos TEXT, enviar_em INTEGER, criado INTEGER, status TEXT DEFAULT \'pendente\', tolera_min INTEGER)');
  db.exec('CREATE TABLE chats (jid TEXT PRIMARY KEY, nome TEXT)');
  return db;
};

test('lembretes: lê a configuração e recusa a inválida', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'lemb-')), 'lembretes.json');
  writeFileSync(p, JSON.stringify({ ativo: true, chat: '1@g.us', hora: '08:30', avisos: [{ dia: 6, nome: ' IPTU ' }, { dia: 40, nome: 'x' }, { dia: 5, nome: '' }] }));
  assert.deepEqual(lerLembretes(p), { chat: '1@g.us', hora: 510, avisos: [{ dia: 6, nome: 'IPTU' }] });
  writeFileSync(p, JSON.stringify({ ativo: false, chat: '1@g.us', avisos: [{ dia: 6, nome: 'a' }] }));
  assert.equal(lerLembretes(p), null);
  writeFileSync(p, JSON.stringify({ ativo: true, chat: 'sem-jid', avisos: [{ dia: 6, nome: 'a' }] }));
  assert.equal(lerLembretes(p), null);
  assert.equal(lerLembretes(join(tmpdir(), 'nao-existe-lembretes.json')), null);
});

test('lembretes: véspera e dia, só depois da hora, agrupando contas do mesmo dia', () => {
  assert.deepEqual(lembretesDevidos(cfg, dia(11, 5, 8, 59)), []);                       // ainda não é hora
  const vespera = lembretesDevidos(cfg, dia(11, 5));
  assert.equal(vespera.length, 1);
  assert.equal(vespera[0].chave, '2026-11-05|amanha');
  assert.equal(vespera[0].texto, '⏰ Lembrete: amanhã (06/11) vence a conta *IPTU da praia*');
  const noDia = lembretesDevidos(cfg, dia(11, 6, 14));
  assert.equal(noDia.length, 1);
  assert.equal(noDia[0].texto, '📌 Hoje (06/11) vence a conta *IPTU da praia*');
  const dez = lembretesDevidos(cfg, dia(11, 10));
  assert.equal(dez.length, 1);
  assert.equal(dez[0].texto, '📌 Hoje (10/11) vencem as contas:\n• Internet\n• Condomínio');
  assert.deepEqual(lembretesDevidos(cfg, dia(11, 7)), []);                                // nada vence dia 7 nem dia 8
});

test('lembretes: dia 31 em mês curto vence no último dia', () => {
  assert.deepEqual(contasDoDia(cfg, dia(2, 28)), ['Fim do mês']);                         // fev/2026 tem 28 dias
  assert.deepEqual(contasDoDia(cfg, dia(2, 27)), []);
  assert.equal(lembretesDevidos(cfg, dia(2, 27))[0].texto, '⏰ Lembrete: amanhã (28/02) vence a conta *Fim do mês*');
  assert.equal(textoLembrete('hoje', dia(11, 6), ['a', 'b']).includes('vencem'), true);
});

test('lembretes: vai para a fila uma vez só e vale até o fim do dia', () => {
  const db = bd();
  assert.equal(gerarLembretes(db, cfg, dia(11, 5, 8)), 0);
  assert.equal(gerarLembretes(db, cfg, dia(11, 5, 14, 0)), 1);                            // PC ligou às 14h: sai na hora
  assert.equal(gerarLembretes(db, cfg, dia(11, 5, 14, 1)), 0);                            // não repete
  assert.equal(gerarLembretes(db, cfg, dia(11, 6, 9, 0)), 1);                             // dia seguinte: o aviso "hoje"
  const itens = db.prepare('SELECT * FROM outbox ORDER BY id').all();
  assert.equal(itens.length, 2);
  assert.equal(itens[0].chat, '1@g.us');
  // a tolerância cobre o resto do dia e nada além disso
  const it = itens[0];
  assert.equal(avaliarItem(it, it.enviar_em + 8 * 3600, 1800).acao, 'enviar');            // 14h + 8h = 22h
  assert.equal(avaliarItem(it, it.enviar_em + 10 * 3600 + 120, 1800).acao, 'atrasada');   // passou da meia-noite
});

test('lembretes: sem configuração não faz nada', () => {
  assert.equal(gerarLembretes(bd(), null, dia(11, 5)), 0);
});

// ---------- datas novas ditas no grupo ----------
import { readFileSync } from 'node:fs';
import { aplicarAcoes, textoConfirmacao, textoLista, promptContas } from '../src/regras/lembretes.mjs';

const arqTmp = (avisos) => {
  const p = join(mkdtempSync(join(tmpdir(), 'lemb-')), 'lembretes.json');
  writeFileSync(p, JSON.stringify({ ativo: true, chat: '1@g.us', hora: '09:00', avisos }));
  return p;
};
const lerAvisos = (p) => JSON.parse(readFileSync(p, 'utf8')).avisos;

test('lembretes do grupo: anota conta nova, ignora repetida e valida o dia', () => {
  const p = arqTmp([{ dia: 10, nome: 'Internet' }]);
  const f = aplicarAcoes([
    { tipo: 'adicionar', dia: 15, nome: ' *Luz*\n' },
    { tipo: 'adicionar', dia: 10, nome: 'internet' },   // já existe (sem diferença de maiúscula)
    { tipo: 'adicionar', dia: 40, nome: 'Absurdo' },     // dia inválido
    { tipo: 'adicionar', dia: 3, mes: 13, nome: 'Seguro' }, // mês inválido
    { tipo: 'adicionar', dia: 12, mes: 12, nome: 'Seguro do carro' },
  ], p);
  assert.deepEqual(f.adicionados, [{ dia: 15, nome: 'Luz' }, { dia: 12, mes: 12, nome: 'Seguro do carro' }]);
  assert.equal(lerAvisos(p).length, 3);
  assert.equal(textoConfirmacao(f), '✅ Anotado: *Luz*, dia 15 (todo mês). Vou avisar na véspera e no dia.\n✅ Anotado: *Seguro do carro*, dia 12/12 (todo ano). Vou avisar na véspera e no dia.');
});

test('lembretes do grupo: remove só quando acha uma conta, nunca no chute', () => {
  const p = arqTmp([{ dia: 10, nome: 'Internet da praia' }, { dia: 25, nome: 'Convênio da Cida' }, { dia: 8, nome: 'Convênio do José' }]);
  assert.deepEqual(aplicarAcoes([{ tipo: 'remover', nome: 'convênio' }], p).removidos, []);          // ambíguo
  assert.deepEqual(aplicarAcoes([{ tipo: 'remover', nome: 'convenio', dia: 25 }], p).removidos, [{ dia: 25, nome: 'Convênio da Cida' }]);
  assert.deepEqual(aplicarAcoes([{ tipo: 'remover', nome: 'Gás' }], p).removidos, []);               // não existe
  assert.equal(lerAvisos(p).length, 2);
});

test('lembretes do grupo: conta anual só vence no mês dela e a lista sai agrupada', () => {
  const c = { chat: '1@g.us', hora: 540, avisos: [{ dia: 12, mes: 12, nome: 'Seguro' }, { dia: 10, nome: 'A' }, { dia: 10, nome: 'B' }, { dia: 10, nome: 'C' }] };
  assert.deepEqual(contasDoDia(c, dia(12, 12)), ['Seguro']);
  assert.deepEqual(contasDoDia(c, dia(11, 12)), []);
  assert.equal(textoLista(c.avisos), '• Dia 10: A, B e C\n• Dia 12/12: Seguro');
});

test('lembretes do grupo: o prompt trata a conversa como dado', () => {
  const t = promptContas({ mensagens: [{ de: 'Cida', texto: 'a luz vence dia 15' }], avisos: [], hoje: '04/11/2026' });
  assert.match(t, /\[Cida\] a luz vence dia 15/);
  assert.match(t, /só dados/);
});
