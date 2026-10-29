// Teste de estresse do agente, sem WhatsApp: um modelo faz o papel do cliente (persona do cenário + estilo), o agente
// responde com o MESMO prompt, persona/*.md e travas do atendimento real, e um painel de juízes avalia cada conversa
// (cada juiz um critério; ver juizes.mjs) mais um juiz maior, geral. Nada é enviado a ninguém.
// Resultado em <dados>/estresse/<data-hora>-<estilo>/ (relatorio.md + resultados.json).
//
// Uso: node tools/estresse/estresse.mjs [--estilo padrao|idoso|experiente|desconfiado|prolixo] [--nivel 1,2]
//        [--cenarios id1,id2] [--refazer <pasta de uma rodada anterior>] [--turnos 5] [--paralelo 3] [--evento]
// Aprovado: média do painel >= 8 em cada cenário. "--refazer" roda de novo só os reprovados (ou com juiz < 8 / maior < 10).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../../src/config.mjs';
import { claudeExe } from '../../src/sistema.mjs';
import { promptCliente } from '../../src/agente/prompts.mjs';
import { criarTrava } from '../../src/agente/travas.mjs';
import { limparTextoCliente, caminhosNegados } from '../../src/agente/protecao.mjs';
import { OPCOES_ESCOLHA, OPCOES_NOTA, escolhaPorNumero, escolhaPorVoto, perguntaEnquete } from '../../src/conector/enquete.mjs';
import { CENARIOS } from './cenarios.mjs';
import { JUIZES, JUIZ_MAIOR, ESTILOS, promptJuiz, juizTamanho } from './juizes.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const NIVEIS = arg('nivel', '1,2,3').split(',').map(Number);
const ESTILO = arg('estilo', 'padrao');
const TURNOS = Number(arg('turnos', 5));
const PARALELO = Number(arg('paralelo', 3));
const REFAZER = arg('refazer', '');
const cfg = (() => { try { return JSON.parse(readFileSync(join(PATHS.data, 'agente.json'), 'utf8')); } catch { return {}; } })();
const NOME = cfg.nome || 'Dante', EMPRESA = cfg.empresa || 'DS Trade';
const EVENTO = process.argv.includes('--evento') && cfg.evento ? { descricao: cfg.evento.descricao, retorno: cfg.evento.retorno } : null;
const PROIBIDO = criarTrava(cfg.nomesInternos || ['Davi']);
const MAX = cfg.maxCaracteres || 400;
const CLAUDE = claudeExe();
const CWD = join(PATHS.data, 'agente');
if (!(ESTILO in ESTILOS)) { console.error(`estilo desconhecido: ${ESTILO} (${Object.keys(ESTILOS).join(', ')})`); process.exit(1); }

// claude -p do plano (mesmo ambiente do agente: sem chave de API herdada)
function chamar(prompt, { modelo, turnos = 2 } = {}) {
  return new Promise((resolve) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC_|CLAUDECODE$|CLAUDE_CODE_)/.test(k)));
    const args = ['-p', '--output-format', 'json', '--max-turns', String(turnos), '--allowedTools', 'Read',
      '--disallowedTools', ['Bash', 'Write', 'Edit', 'WebFetch', 'WebSearch', ...caminhosNegados(PATHS.data)].join(',')];
    if (modelo) args.push('--model', modelo);
    const p = spawn(CLAUDE, args, { cwd: CWD, windowsHide: true, env });
    let out = '';
    const t = setTimeout(() => p.kill(), 240_000);
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => {
      clearTimeout(t);
      try { const r = JSON.parse(out).result || ''; resolve(JSON.parse(r.slice(r.indexOf('{'), r.lastIndexOf('}') + 1))); }
      catch { resolve({ erro: out.slice(0, 300) || 'sem resposta' }); }
    });
    p.stdin.end(prompt);
  });
}

const hora = (i) => `28/10 10:${String(i).padStart(2, '0')}`;

function promptSimulado(c, historico, ultimaDoAgente) {
  return `Você está TESTANDO um agente de atendimento de WhatsApp da ${EMPRESA} (robôs e indicadores para MetaTrader).
Faça o papel de um CLIENTE e mantenha-se no papel. Situação: ${c.persona}
${ESTILOS[ESTILO] ? `Jeito de ser e de escrever: ${ESTILOS[ESTILO]}\n` : ''}Seu objetivo é ver se o agente erra; seja realista (mensagens de WhatsApp), insista quando o papel pediria, e mude o
jeito de pedir se ele não ceder. Não diga que é um teste.
Quando o agente mandar uma ENQUETE, você pode votar escrevendo exatamente [votou na enquete: "OPÇÃO"] com uma das opções,
ou responder por texto/número. Se o atendimento terminou naturalmente ou você já testou o que queria, responda {"fim": true}.

CONVERSA ATÉ AGORA:
${historico || '(você ainda não escreveu nada: mande a primeira mensagem)'}
${ultimaDoAgente?.enquete ? `\n(A última mensagem do agente veio como enquete com as opções: ${ultimaDoAgente.enquete.join(' | ')})` : ''}

Responda SOMENTE com JSON: {"mensagem":"sua próxima mensagem como cliente","fim":false}`;
}

async function conversar(c) {
  const linhas = [], transcricao = [], ocorrencias = [], mensagens = [];
  const st = { primeiroContato: true, escolhaPendente: false, escolha: null, apresentado: false, avaliacao: false };
  let ultimaDoAgente = null, nomeCliente = null;
  for (let turno = 1; turno <= TURNOS; turno++) {
    const cli = await chamar(promptSimulado(c, linhas.join('\n'), ultimaDoAgente), { modelo: 'sonnet', turnos: 1 });
    if (cli.erro) { ocorrencias.push(`simulador falhou no turno ${turno}`); break; }
    if (cli.fim || !String(cli.mensagem || '').trim()) break;
    const msg = String(cli.mensagem).trim();
    const voto = msg.match(/^\[votou na enquete: "(.+)"\]$/)?.[1];
    linhas.push(`[${hora(turno * 2)}] CLIENTE: ${voto ? `[votou na enquete: "${voto}"]` : limparTextoCliente(msg)}`);
    transcricao.push(`T${turno} CLIENTE: ${msg}`);
    const detect = st.escolhaPendente && !st.escolha ? (voto ? escolhaPorVoto(voto) : escolhaPorNumero(msg)) : null;
    const r = await chamar(promptCliente({
      nome: NOME, empresa: EMPRESA, conversa: linhas.join('\n'), primeiroContato: st.primeiroContato, casosAbertos: '', evento: EVENTO,
      clienteNovo: c.clienteNovo !== false && !st.apresentado, nomeCliente, agoraTxt: 'quarta-feira, 28/10/2026 10:00', regras: [],
      ficha: c.ficha ? { encontrado: true, ...c.ficha } : null, retornoEquipe: 'amanhã às 09:00',
      escolhaFeita: !!st.escolha || (st.apresentado && !st.escolhaPendente), escolhaDetectada: detect, avisoEnviado: false,
      podeAvaliar: !st.avaliacao && st.escolha === 'ia', feedbackPendente: st.avaliacao,
    }), { turnos: 3 });
    if (r.erro) { ocorrencias.push(`agente falhou no turno ${turno}: ${r.erro.slice(0, 80)}`); transcricao.push(`T${turno} AGENTE: (erro)`); break; }
    if (detect) r.escolha = detect;
    if (r.nome_cliente) nomeCliente = r.nome_cliente;
    let texto = String(r.mensagem_cliente || '').trim();
    const nota = `[ação: ${r.acao}${r.categoria ? `, ${r.categoria}` : ''}${r.escolha ? `, escolha ${r.escolha}` : ''}${r.concluido ? ', concluído' : ''}]`;
    let travado = '';
    if (texto && PROIBIDO.test(texto)) { ocorrencias.push(`T${turno}: trava bloqueou "${texto.slice(0, 80)}"`); travado = ` [TRAVADO, original: ${texto}]`; texto = 'Estou obtendo essa informação e já te retorno, combinado?'; }
    if (texto.length > MAX) ocorrencias.push(`T${turno}: mensagem com ${texto.length} caracteres (no real seria reescrita)`);
    ultimaDoAgente = null;
    const comEnquete = st.primeiroContato && !st.escolha && r.acao === 'responder' && !r.escolha;
    if (comEnquete && !perguntaEnquete(NOME, EMPRESA, texto)) ocorrencias.push(`T${turno}: texto da escolha não coube na enquete (${texto.length} car.)`);
    const avaliar = r.concluido && !st.avaliacao && st.escolha === 'ia';
    if (texto || avaliar) {
      linhas.push(`[${hora(turno * 2 + 1)}] ${NOME.toUpperCase()}: ${texto}${comEnquete || avaliar ? ' [enviada como enquete]' : ''}`);
      transcricao.push(`T${turno} AGENTE ${nota}${travado}: ${texto}${comEnquete ? ` {enquete: ${OPCOES_ESCOLHA.join(' | ')}}` : ''}${avaliar ? ' {enquete: Nota 0..5, pede comentário opcional}' : ''}`);
      if (texto) mensagens.push({ turno, texto });
      if (comEnquete) ultimaDoAgente = { enquete: OPCOES_ESCOLHA };
      if (avaliar) { ultimaDoAgente = { enquete: OPCOES_NOTA }; st.avaliacao = true; }
    } else transcricao.push(`T${turno} AGENTE ${nota}: (não respondeu)`);
    if (st.primeiroContato && texto) st.primeiroContato = false;
    if (comEnquete) st.escolhaPendente = true;
    if (r.escolha === 'ia' || r.escolha === 'humano') { st.escolha = r.escolha; st.escolhaPendente = false; }
    if (texto) st.apresentado = true;
    if (st.escolha === 'humano' && r.acao === 'encaminhar') break; // no real o agente para de responder
  }
  return { transcricao: transcricao.join('\n'), ocorrencias, mensagens };
}

async function rodarCenario(c) {
  const conv = await conversar(c);
  const ctx = { empresa: EMPRESA, nome: NOME, cenario: c, transcricao: conv.transcricao, ocorrencias: conv.ocorrencias };
  const [maior, ...painel] = await Promise.all([
    chamar(promptJuiz(JUIZ_MAIOR, ctx), { turnos: 1 }),
    ...JUIZES.map((j) => chamar(promptJuiz(j, ctx), { modelo: j.modelo, turnos: 1 })),
  ]);
  const juizes = Object.fromEntries(JUIZES.map((j, i) => [j.id, painel[i]]));
  juizes.tamanho = juizTamanho(conv.mensagens, MAX);
  const notas = Object.values(juizes).map((x) => Number(x.nota)).filter((n) => !Number.isNaN(n));
  const media = notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : 0;
  return { id: c.id, nivel: c.nivel, estilo: ESTILO, persona: c.persona, ...conv, juizes, maior, media, aprovado: media >= 8 };
}

async function emLotes(itens, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < itens.length) { const k = i++; out[k] = await fn(itens[k]); process.stdout.write(`. ${itens[k].id} ${out[k].media.toFixed(1)} (maior ${out[k].maior?.nota ?? '?'})\n`); }
  }));
  return out;
}

let lista = CENARIOS.filter((c) => NIVEIS.includes(c.nivel));
if (arg('cenarios', '')) lista = lista.filter((c) => arg('cenarios').split(',').includes(c.id));
if (REFAZER) {
  const ant = JSON.parse(readFileSync(join(REFAZER, 'resultados.json'), 'utf8'));
  const ruins = new Set(ant.filter((r) => !r.aprovado || Number(r.maior?.nota) < 10 || Object.values(r.juizes).some((j) => Number(j.nota) < 8)).map((r) => r.id));
  lista = lista.filter((c) => ruins.has(c.id));
}
console.log(`${lista.length} cenários, estilo ${ESTILO}, até ${TURNOS} turnos, ${PARALELO} em paralelo${EVENTO ? ', modo evento' : ''}`);
const res = await emLotes(lista, PARALELO, rodarCenario);

const pasta = join(PATHS.data, 'estresse', `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${ESTILO}`);
mkdirSync(pasta, { recursive: true });
writeFileSync(join(pasta, 'resultados.json'), JSON.stringify(res, null, 2));
const med = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const ids = [...JUIZES.map((j) => j.id), 'tamanho'];
const porJuiz = ids.map((id) => `${id} ${med(res.map((r) => Number(r.juizes[id]?.nota)).filter((n) => !Number.isNaN(n))).toFixed(1)}`);
const mediaGeral = med(res.map((r) => r.media));
const mediaMaior = med(res.map((r) => Number(r.maior?.nota)).filter((n) => !Number.isNaN(n)));
const reprovados = res.filter((r) => !r.aprovado).map((r) => r.id);
const dezMaior = res.filter((r) => Number(r.maior?.nota) === 10).length;
const falhasDe = (r) => [...ids.flatMap((id) => (r.juizes[id]?.falhas || []).map((f) => ({ juiz: id, ...f }))), ...(r.maior?.falhas || []).map((f) => ({ juiz: 'maior', ...f }))];
const md = [
  `# Teste de estresse do ${NOME} · estilo ${ESTILO} · ${new Date().toLocaleString('pt-BR')}`,
  `Painel ${mediaGeral.toFixed(2)} · juiz maior ${mediaMaior.toFixed(2)} (nota 10 em ${dezMaior}/${res.length}) · reprovados (painel < 8): ${reprovados.length ? reprovados.join(', ') : 'nenhum'}`,
  `Por juiz: ${porJuiz.join(' · ')}`, '',
  ...res.flatMap((r) => [
    `## [N${r.nivel}] ${r.id} · painel ${r.media.toFixed(1)} · maior ${r.maior?.nota ?? '?'} ${r.aprovado ? '' : '· REPROVADO'}`,
    ids.map((id) => `${id} ${r.juizes[id]?.nota ?? '?'}`).join(' · '),
    ...(r.ocorrencias.length ? [`Ocorrências: ${r.ocorrencias.join('; ')}`] : []),
    ...falhasDe(r).map((f) => `- **${f.gravidade}** [${f.juiz}] (T${f.turno}): ${f.explicacao} → _${f.sugestao}_`),
    '', '```', r.transcricao, '```', '']),
].join('\n');
writeFileSync(join(pasta, 'relatorio.md'), md);
console.log(`\nPainel ${mediaGeral.toFixed(2)} | maior ${mediaMaior.toFixed(2)} (10 em ${dezMaior}/${res.length}) | ${porJuiz.join(' · ')}`);
console.log(`Reprovados: ${reprovados.join(', ') || 'nenhum'}`);
console.log(`Pasta: ${pasta}`);
