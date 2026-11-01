import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tirarDesculpaDemora, admiteNaoVer, copiaLegivel } from '../src/agente/higiene.mjs';
import { precisaChecar, textoEnqueteContinuidade, votoContinuidade, briefingSemVoto } from '../src/agente/continuidade.mjs';
import { resolverRobo, criarTabelaTarefas, criarTarefa, buscar, mudar, acharSessao, quandoEntregar, lerComando, promptCorrecao } from '../src/agente/tarefas.mjs';
import { promptCliente } from '../src/agente/prompts.mjs';
import { OPCOES_ESCOLHA, perguntaEnquete } from '../src/conector/enquete.mjs';

test('higiene: corta a desculpa pela demora e mantém o resto', () => {
  assert.equal(tirarDesculpaDemora('Marcelo, desculpe a demora em responder. Sou o Dante, agente de IA da DS Trade.'), 'Sou o Dante, agente de IA da DS Trade.');
  assert.equal(tirarDesculpaDemora('Peço desculpas pela demora. Recebi seu vídeo.'), 'Recebi seu vídeo.');
  assert.equal(tirarDesculpaDemora('Oi! Vi o print. Qual robô é?'), 'Oi! Vi o print. Qual robô é?');
  assert.equal(tirarDesculpaDemora('Desculpe o erro de digitação. Segue o passo 1.'), 'Desculpe o erro de digitação. Segue o passo 1.');
});

test('higiene: detecta quando o agente admite que não viu o que o cliente mandou', () => {
  assert.equal(admiteNaoVer('Recebi seu vídeo, mas não consegui ver o conteúdo dele.'), true);
  assert.equal(admiteNaoVer('Não consigo abrir o arquivo que você mandou.'), true);
  assert.equal(admiteNaoVer('Não tenho como ouvir áudios.'), true);
  assert.equal(admiteNaoVer('Vi o vídeo: o lote subiu para 0.04. É isso?'), false);
});

test('continuidade: só checa quando a equipe falou por último fora da janela e dentro de 7 dias', () => {
  const agora = 2_000_000_000, h = 3600, d = 86400;
  const base = { agora, humanoHoras: 12, dias: 7, assume: 0, decididoTs: 0 };
  assert.equal(precisaChecar({ ...base, equipeTs: agora - 4 * d }), true);
  assert.equal(precisaChecar({ ...base, equipeTs: agora - 2 * h }), false);          // dentro das 12 h: a equipe está atendendo
  assert.equal(precisaChecar({ ...base, equipeTs: agora - 8 * d }), false);          // passou de 7 dias: assunto novo
  assert.equal(precisaChecar({ ...base, equipeTs: 0 }), false);                       // a equipe nunca falou
  assert.equal(precisaChecar({ ...base, equipeTs: agora - 4 * d, assume: agora - 1 * d }), false); // painel: Dante assume
  assert.equal(precisaChecar({ ...base, equipeTs: agora - 4 * d, decididoTs: agora - 4 * d }), false); // já avaliado
});

test('continuidade: pergunta da enquete cabe no limite do WhatsApp e o voto vale', () => {
  const t = textoEnqueteContinuidade('o indicador DSTrend de tendência no Profit, e mais um texto bem comprido para forçar o corte');
  assert.match(t, /Vi que você estava tratando de .* com o Davi\. Como prefere seguir\?/);
  assert.ok(perguntaEnquete('Dante', 'DS Trade', t), 'a pergunta tem que caber em 255 caracteres com cabeçalho e aviso');
  assert.match(textoEnqueteContinuidade(''), /outro assunto/);
  assert.equal(votoContinuidade([{ tipo: 'texto', texto: 'oi' }, { tipo: 'voto', texto: OPCOES_ESCOLHA[0] }]), 'ia');
  assert.equal(votoContinuidade([{ tipo: 'voto', texto: OPCOES_ESCOLHA[1] }]), 'humano');
  assert.equal(votoContinuidade([{ tipo: 'texto', texto: 'quero falar do lote' }]), null);
  assert.match(briefingSemVoto({ quem: 'Marcelo (+5516)', minutos: 20, briefing: 'Você mandou o indicador.', ultima: 'vou estudar' }), /Marcelo.*20 min/s);
});

test('enquete da escolha: textos novos (pré-atendimento do Dante / retorno da equipe)', () => {
  assert.equal(OPCOES_ESCOLHA[0], '1 - Seguir com o pré-atendimento do Dante');
  assert.equal(OPCOES_ESCOLHA[1], '2 - Aguardar o retorno da equipe DS Trade');
});

test('prompt: desculpa só com 15 min ou mais de espera; vídeo com frames; nota do dono', () => {
  const base = { nome: 'Dante', empresa: 'DS Trade', conversa: 'x', agoraTxt: 'hoje' };
  assert.match(promptCliente({ ...base, esperaMin: 9 }), /NÃO peça desculpas pela demora/);
  assert.match(promptCliente({ ...base, esperaMin: 16 }), /comece pedindo desculpas pela demora/);
  const p = promptCliente({ ...base, notaDono: 'Tome a frente do vídeo.' });
  assert.match(p, /ORIENTAÇÃO DO DONO PARA ESTA CONVERSA/);
  assert.match(p, /frames: caminho1/);
  assert.match(p, /NUNCA diga ao cliente que você não conseguiu/);
  assert.match(p, /SUPORTE TÉCNICO/);
  assert.match(p, /"tecnico":null/);
});

test('tarefas: robô da ficha (exato, parcial, ambíguo) e comandos do dono', () => {
  const robos = [{ nome: 'EA MFP' }, { nome: 'EA MSN' }, { nome: 'EA Maria Forex' }, { nome: 'EA Robo ALPHA' }];
  assert.equal(resolverRobo(robos, 'EA MFP'), 'EA MFP');
  assert.equal(resolverRobo(robos, 'mfp'), 'EA MFP');
  assert.equal(resolverRobo(robos, 'ea'), null);                 // vários candidatos
  assert.equal(resolverRobo(robos, 'alpha'), 'EA Robo ALPHA');
  assert.equal(resolverRobo(robos, ''), null);
  assert.deepEqual(lerComando('T3 autorizo'), { id: 3, acao: 'autorizar', resto: '' });
  assert.deepEqual(lerComando('t12 robo EA MFP'), { id: 12, acao: 'robo', resto: 'EA MFP' });
  assert.deepEqual(lerComando('T4 sessão Maria'), { id: 4, acao: 'sessao', resto: 'Maria' });
  assert.deepEqual(lerComando('T4 entregar 2 dias'), { id: 4, acao: 'entregar', resto: '2 dias' });
  assert.equal(lerComando('#4 ok'), null);
  assert.equal(lerComando('Tarefa 4'), null);
});

test('tarefas: quando entregar (dias às 16h, data, agora)', () => {
  const agora = new Date(2026, 10, 2, 10, 0, 0); // seg 02/11/2026 10:00
  const em = (ts) => new Date(ts * 1000);
  assert.deepEqual([em(quandoEntregar('2 dias', agora)).getDate(), em(quandoEntregar('2 dias', agora)).getHours()], [4, 16]);
  assert.equal(em(quandoEntregar('03/11 16:30', agora)).getMinutes(), 30);
  assert.equal(em(quandoEntregar('03/11', agora)).getHours(), 16);
  assert.ok(quandoEntregar('agora', agora) - Math.floor(agora.getTime() / 1000) <= 60);
  assert.equal(quandoEntregar('quando der', agora), null);
});

test('tarefas: criar, mudar de estado e prompt de correção', () => {
  const db = new DatabaseSync(':memory:');
  criarTabelaTarefas(db);
  const a = criarTarefa(db, { chat: 'a@s.whatsapp.net', nome: 'Maria', robo: 'EA MFP', tipo: 'bug', resumo: 'lote não desce', pedido: 'passo a passo', evidencias: ['f1.jpg'] });
  const b = criarTarefa(db, { chat: 'a@s.whatsapp.net', nome: 'Maria', robo: null, resumo: 'x' });
  assert.equal(buscar(db, a).status, 'aguardando_autorizacao');
  assert.equal(buscar(db, b).status, 'aguardando_robo');
  mudar(db, a, { status: 'autorizada', pid: 123 });
  assert.equal(buscar(db, a).pid, 123);
  const p = promptCorrecao(buscar(db, a), { pastaRobo: 'C:\\x\\EA MFP' });
  assert.match(p, /T1/);
  assert.match(p, /NÃO faça commit/);
  assert.match(p, /f1\.jpg/);
});

test('tarefas: acha a sessão do cliente pelo nome (completo ou só o primeiro) e pede ajuda se não achar', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'sess-'));
  const cwd = mkdtempSync(join(tmpdir(), 'cwd-'));
  const nova = (pasta, id, seg) => {
    mkdirSync(join(raiz, pasta), { recursive: true });
    const f = join(raiz, pasta, `${id}.jsonl`);
    writeFileSync(f, `${JSON.stringify({ type: 'user', cwd })}\n`);
    const t = new Date(Date.now() - seg * 1000); utimesSync(f, t, t);
  };
  nova('C--Users-davis-AppData-Roaming-MetaQuotes-Terminal-X-MQL5-Shared-Projects-MetaTrader-MariaSouzaLima-MT5-EA-MSN', 'aaaa-1111', 100);
  nova('C--Users-davis-AppData-Roaming-MetaQuotes-Terminal-X-MQL5-Shared-Projects-MetaTrader-MarceloTosta', 'bbbb-2222', 50);
  const m = acharSessao({ raiz, nomes: ['Maria Souza Lima', 'MariaSouzaLima'] });
  assert.equal(m.ok, true);
  assert.equal(m.sessaoId, 'aaaa-1111');
  assert.equal(m.cwd, cwd);
  assert.equal(acharSessao({ raiz, nomes: [], dica: 'Maria' }).sessaoId, 'aaaa-1111');   // só "Maria" também acha
  const nada = acharSessao({ raiz, nomes: ['Fulano Desconhecido'] });
  assert.equal(nada.ok, false);
  assert.equal(nada.motivo, 'nenhuma');
  assert.equal(acharSessao({ raiz, nomes: [] }).motivo, 'sem-nome');
});

test('continuidade: assunto genérico fala da equipe da DS Trade; pessoal fala do Davi', () => {
  assert.match(textoEnqueteContinuidade('o aviso de horário', false), /com a equipe da DS Trade\. Como prefere seguir\?/);
  assert.match(textoEnqueteContinuidade('o indicador', true), /com o Davi\./);
  assert.ok(perguntaEnquete('Dante', 'DS Trade', textoEnqueteContinuidade('x'.repeat(200), false)), 'cabe nos 255 caracteres');
});

test('prompt: conversa recente, entendeu=false e janela ampliada', () => {
  const base = { nome: 'Dante', empresa: 'DS Trade', conversa: 'x', agoraTxt: 'hoje' };
  const normal = promptCliente(base);
  assert.match(normal, /só as mensagens RECENTES/);
  assert.match(normal, /marque "entendeu": false/);
  assert.match(normal, /"entendeu":true/);
  assert.match(promptCliente({ ...base, janelaAmpla: true }), /AMPLIADA com mensagens mais antigas/);
});

test('logs e .set do MT5 (UTF-16) ganham uma cópia legível e a regra "log, não print" está no prompt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'log-'));
  const arq = join(dir, 'x.plain');
  writeFileSync(arq, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Saldo virtual iniciado em 100.00\r\n', 'utf16le')]));
  const dest = copiaLegivel(arq, '20261025.log');
  assert.match(readFileSync(dest, 'utf8'), /^Saldo virtual iniciado em 100\.00/);
  assert.equal(copiaLegivel(arq, 'foto.jpg'), null);
  assert.equal(copiaLegivel(join(dir, 'nao-existe'), 'a.log'), null);
  const p = promptCliente({ nome: 'Dante', empresa: 'DS Trade', conversa: 'x', agoraTxt: 'hoje' });
  assert.match(p, /LOG, não print/);
  assert.match(p, /youtube\.com\/watch\?v=ZYLJ_rOGjZc/);
  assert.doesNotMatch(p, /pedindo prints das abas "Experts"/);
});

test('prompt: print vale para painel/gráfico, erro de robô é log, e ativo/timeframe saem do log', () => {
  const p = promptCliente({ nome: 'Dante', empresa: 'DS Trade', conversa: 'x', agoraTxt: 'hoje' });
  assert.match(p, /ver o PAINEL do robô/);
  assert.match(p, /ERROS e comportamento do robô.*sempre log/s);
  assert.match(p, /nome do robô \(ATIVO,TIMEFRAME\)/);
  assert.match(p, /"ativo":".*","timeframe":".*","set":".*","trecho_log":/);
});
