// Agente de atendimento (Dante). Roda NA SESSÃO DO USUÁRIO (precisa do login do Claude Code),
// separado do listener. Conversa com ele só pelo banco: lê msgs novas e põe respostas na fila
// "outbox", que o listener envia. Nunca envia arquivos.
//
// Configuração: <dados>/agente.json (relida a cada ciclo)
// { "ativo": true, "inicio": "...", "fim": "..." (opcional: sem fim = sempre), "nome": "Dante",
//   "empresa": "DS Trade", "davi": "5511999999999" (WhatsApp pessoal do dono), "daviJids": [], "somente": [], "somenteAte": "..." (fim do teste), "excluir": [],
//   "etiquetaPessoal": "Pessoal🏠", "etiquetasIgnorar": ["Outro robô"] (conversas que o agente não toca),
//   "maxPorChatDia": 12, "humanoHoras": 12, "semRespostaMin": 15, "lembrarCasoMin": 60, "alertaHoras": [8, 22],
//   "evento": { "inicio": "...", "fim": "...", "descricao": "um evento de ...", "retorno": "sexta-feira (30/10)" },
//   "horario": { "dias": [1,2,3,4,5], "inicio": "09:00", "fim": "18:00", "feriados": [], "descricao": "seg a sex, 9h às 18h" },
//   "contexto": "aviso do momento", "contextoAte": "...", "rodape": "_..._", "pingUrl": "https://hc-ping.com/<uuid>" }
// Se a equipe (humano) escreveu na conversa nas últimas "humanoHoras", o agente não responde o cliente
// sozinho: se o cliente ficar "semRespostaMin" sem resposta, avisa o Davi com uma sugestão (#N ok envia).
// Casos parados há "lembrarCasoMin" ganham um lembrete. Avisos só dentro de "alertaHoras".
// O Davi também pode mandar texto livre ("manda pro Fulano que...") e o agente confirma antes de enviar.
//
// Comandos do Davi (do WhatsApp pessoal para este número): PAUSAR, RETOMAR, STATUS,
// "#N resposta" (responde o caso N) e "#N sexta" (deixa para sexta).
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uptime } from 'node:os';
import { PATHS } from './config.mjs';
import { abrirDb, normEtiqueta } from './armazenamento/db.mjs';
import { promptCliente, promptRespostaDavi, promptComandoDavi } from './agente/prompts.mjs';
import { criarTrava } from './agente/travas.mjs';
import { cartao } from './notificador/cartao.mjs';
import { WIN, processoVivo, python, claudeExe } from './sistema.mjs';
import { aberto, textoRetorno } from './regras/horario.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARQ_CFG = join(PATHS.data, 'agente.json');
const ARQ_PID = join(PATHS.data, 'agente.pid');
const ARQ_LOG = join(PATHS.data, 'agente.log');
const PASTA_CLAUDE = join(PATHS.data, 'agente'); // cwd vazio p/ o claude -p (sem memória de projeto)
const CLAUDE = claudeExe();
const DEBOUNCE_S = 20;     // espera o cliente terminar de mandar várias mensagens
const CICLO_MS = 10_000;

const log = (...a) => { const l = `[${new Date().toLocaleString('pt-BR')}] ${a.join(' ')}\n`; try { appendFileSync(ARQ_LOG, l); } catch {} };

// ---------- instância única ----------
function outroVivo() {
  try {
    const pid = Number(readFileSync(ARQ_PID, 'utf8'));
    if (!pid || pid === process.pid || statSync(ARQ_PID).mtimeMs < Date.now() - uptime() * 1000) return false;
    return processoVivo(pid);
  } catch { return false; }
}
if (outroVivo()) { process.exit(0); }
mkdirSync(PASTA_CLAUDE, { recursive: true });
writeFileSync(ARQ_PID, String(process.pid));
const sair = () => { try { if (readFileSync(ARQ_PID, 'utf8') === String(process.pid)) unlinkSync(ARQ_PID); } catch {} process.exit(0); };
process.on('SIGINT', sair); process.on('SIGTERM', sair);

// ---------- banco ----------
const db = abrirDb();
db.exec(`
  CREATE TABLE IF NOT EXISTS agente_chat (chat TEXT PRIMARY KEY, ultimo_ts INTEGER DEFAULT 0, apresentado INTEGER DEFAULT 0,
    humano INTEGER DEFAULT 0, dia TEXT, msgs_dia INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS agente_caso (id INTEGER PRIMARY KEY AUTOINCREMENT, chat TEXT, nome TEXT, resumo TEXT,
    pergunta TEXT, status TEXT DEFAULT 'aberto', criado INTEGER, fechado INTEGER, resposta TEXT);
  CREATE TABLE IF NOT EXISTS agente_kv (k TEXT PRIMARY KEY, v TEXT);
`);
for (const col of ['nome_cliente TEXT', 'origem TEXT', 'alertado_ts INTEGER DEFAULT 0', 'etiquetado INTEGER DEFAULT 0']) { try { db.exec(`ALTER TABLE agente_chat ADD COLUMN ${col}`); } catch {} }
// tipo: consultar | encaminhar | sugestao; sugestao = texto pronto que o Davi aprova com "#N ok"
for (const col of ["tipo TEXT DEFAULT 'consultar'", 'sugestao TEXT', 'lembrado INTEGER DEFAULT 0']) { try { db.exec(`ALTER TABLE agente_caso ADD COLUMN ${col}`); } catch {} }
const kv = { get: (k) => db.prepare('SELECT v FROM agente_kv WHERE k = ?').get(k)?.v, set: (k, v) => db.prepare('INSERT OR REPLACE INTO agente_kv VALUES (?, ?)').run(k, String(v)) };
const agora = () => Math.floor(Date.now() / 1000);
const hoje = () => new Date().toLocaleDateString('pt-BR');

function lerCfg() {
  try {
    const c = JSON.parse(readFileSync(ARQ_CFG, 'utf8'));
    const ini = Date.parse(c.inicio);
    const fim = c.fim ? Date.parse(c.fim) : Infinity;
    if (c.ativo === false || Number.isNaN(ini) || Number.isNaN(fim) || !c.davi) return null;
    const dig = (l) => (l || []).map((x) => String(x).replace(/\D/g, ''));
    // fim do período de teste: libera todos os clientes, mas só para mensagens novas (desde o fim do teste)
    let desdeLiberado = ini;
    if (c.somenteAte && Date.now() > Date.parse(c.somenteAte)) { c.somente = []; desdeLiberado = Math.max(ini, Date.parse(c.somenteAte)); }
    return { nome: 'Dante', empresa: 'DS Trade', maxPorChatDia: 12, humanoHoras: 12, semRespostaMin: 15, lembrarCasoMin: 60, alertaHoras: [8, 22],
      etiquetaPessoal: 'Pessoal🏠', etiquetaLead: 'Novo cliente🆕', ...c, ini, fim, desdeLiberado, davi: String(c.davi).replace(/\D/g, ''),
      daviJids: [`${String(c.davi).replace(/\D/g, '')}@s.whatsapp.net`, ...(c.daviJids || [])], somente: dig(c.somente), excluir: dig(c.excluir) };
  } catch { return null; }
}
// evento em andamento agora? (muda a apresentação e a resposta "#N depois")
function eventoAtivo(cfg) {
  const e = cfg.evento;
  if (!e) return null;
  const i = Date.parse(e.inicio), f = Date.parse(e.fim);
  return Date.now() >= i && Date.now() <= f ? { descricao: e.descricao || 'um evento', retorno: e.retorno || 'próximo dia útil' } : null;
}
// etiquetas do WhatsApp Business (sincronizadas pelo listener)
const etiquetasDo = (chat) => db.prepare('SELECT e.nome FROM etiqueta_chat ec JOIN etiquetas e ON e.id = ec.etiqueta WHERE ec.chat = ?').all(chat).map((r) => r.nome);
// conversa que o agente não toca: etiqueta pessoal ou alguma de "etiquetasIgnorar" (ex.: outro robô cuida dela)
const ehPessoal = (cfg, chat) => { const fora = [cfg.etiquetaPessoal, ...(cfg.etiquetasIgnorar || [])].map(normEtiqueta); return etiquetasDo(chat).some((n) => fora.includes(normEtiqueta(n))); };
const pedirEtiqueta = (chat, nome, remover = false) => db.prepare("INSERT INTO acoes (tipo, chat, valor, criado) VALUES (?, ?, ?, strftime('%s','now'))").run(remover ? 'etiqueta-' : 'etiqueta+', chat, nome);
const cabecalho = (cfg) => `*${cfg.nome} | Agente IA ${cfg.empresa}:*\n`;
// aviso no fim de toda mensagem ao cliente (configurável em "rodape"; "" desliga)
const RODAPE = '_Este é um agente de IA em fase de desenvolvimento e pode cometer erros._';
const rodape = (cfg) => { const r = cfg.rodape ?? RODAPE; return r ? `\n\n${r}` : ''; };
const paraCliente = (cfg, texto) => cabecalho(cfg) + texto + rodape(cfg);

function enfileirar(chat, nome, texto) {
  db.prepare('INSERT INTO outbox (chat, nome, texto, arquivos, enviar_em, criado) VALUES (?, ?, ?, NULL, ?, ?)').run(chat, nome, texto, agora(), agora());
}
function avisarDavi(cfg, texto) { enfileirar(cfg.daviJids[0], 'Davi (pessoal)', `🤖 *${cfg.nome} (agente)*\n${texto}`); }

function estadoChat(chat) {
  let e = db.prepare('SELECT * FROM agente_chat WHERE chat = ?').get(chat);
  if (!e) { db.prepare('INSERT INTO agente_chat (chat, dia) VALUES (?, ?)').run(chat, hoje()); e = db.prepare('SELECT * FROM agente_chat WHERE chat = ?').get(chat); }
  if (e.dia !== hoje()) { db.prepare('UPDATE agente_chat SET dia = ?, msgs_dia = 0 WHERE chat = ?').run(hoje(), chat); e.msgs_dia = 0; }
  return e;
}

// ---------- conversa em texto para o modelo ----------
function textoConversa(cfg, chat, limite = 25) {
  const aus = (() => { try { return JSON.parse(readFileSync(join(PATHS.data, 'ausencia.json'), 'utf8')).texto; } catch { return null; } })();
  const rows = db.prepare('SELECT * FROM (SELECT * FROM msgs WHERE chat = ? ORDER BY ts DESC LIMIT ?) ORDER BY ts').all(chat, limite);
  const cab = cabecalho(cfg);
  return rows.map((m) => {
    const quando = new Date(m.ts * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    let quem = 'CLIENTE';
    let t = m.texto || '';
    if (m.meu) { if (t.startsWith(cab)) { quem = cfg.nome.toUpperCase(); t = t.slice(cab.length); const rod = rodape(cfg); if (rod && t.endsWith(rod)) t = t.slice(0, -rod.length); } else if (aus && t === aus) quem = 'AVISO'; else quem = 'EQUIPE'; }
    if (m.tipo === 'audio') t = `[áudio ${m.dur || '?'}s] ${m.transcricao ? `transcrição: "${m.transcricao}"` : '(sem transcrição)'}`;
    else if (m.tipo === 'video') t = `[vídeo ${m.dur || '?'}s${m.texto ? `, legenda "${m.texto}"` : ''}] ${m.transcricao ? `fala: "${m.transcricao}"` : ''}`;
    else if (m.tipo === 'imagem') t = `[foto${m.arquivo ? `: ${m.arquivo}` : ''}]${m.texto ? ` legenda: ${m.texto}` : ''}`;
    else if (m.tipo === 'documento') t = `[arquivo: ${m.texto || 'documento'}]`;
    else if (m.tipo === 'figurinha') t = '[figurinha]';
    return `[${quando}] ${quem}: ${t}`;
  }).join('\n');
}

// ---------- modelo (claude -p do plano) ----------
function chamarClaude(prompt, timeoutMs = 240_000) {
  return new Promise((resolve, reject) => {
    // sem chave de API/rotas herdadas: usa o login da assinatura (uma ANTHROPIC_API_KEY no ambiente teria prioridade e cobraria crédito)
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC_|CLAUDECODE$|CLAUDE_CODE_)/.test(k)));
    const p = spawn(CLAUDE, ['-p', '--output-format', 'json', '--allowedTools', 'Read', '--max-turns', '6'], { cwd: PASTA_CLAUDE, windowsHide: true, env });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill(); reject(new Error('timeout do claude')); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (cod) => {
      clearTimeout(t);
      try {
        const res = JSON.parse(out).result || '';
        const j = res.slice(res.indexOf('{'), res.lastIndexOf('}') + 1);
        resolve(JSON.parse(j));
      } catch (e) { reject(new Error(`resposta inválida (código ${cod}): ${(err || out).slice(0, 300)}`)); }
    });
    p.stdin.end(prompt);
  });
}

// Trava final: nada de preço, nomes internos ou bastidores, mesmo que o modelo erre.
// (a lista fica em agente/travas.mjs; "nomesInternos" do agente.json acrescenta os nomes da equipe)
const PROIBIDO = criarTrava((() => { try { return JSON.parse(readFileSync(ARQ_CFG, 'utf8')).nomesInternos; } catch { return null; } })() || ['Davi']);
const textoAusencia = () => { try { return JSON.parse(readFileSync(join(PATHS.data, 'ausencia.json'), 'utf8')).texto; } catch { return null; } };
// mensagem minha que não é do agente nem o aviso automático = alguém da equipe escrevendo
const ehHumano = (cfg, texto, aus) => !(texto || '').startsWith(cabecalho(cfg)) && texto !== aus;

// ---------- preparar mídia (transcrição) ----------
function prepararMidia(chat, desde) {
  const pend = db.prepare("SELECT COUNT(*) n FROM msgs WHERE chat = ? AND ts >= ? AND tipo IN ('audio','video') AND arquivo IS NOT NULL AND transcricao IS NULL").get(chat, desde).n;
  if (!pend) return;
  const [py, ...pyArgs] = python();
  const r = spawnSync(py, [...pyArgs, join(AQUI, '..', 'tools', 'preparar.py'), '--db', PATHS.db, '--chat', chat, '--desde', String(desde)], { timeout: 300_000, windowsHide: true, encoding: 'utf8' });
  log(`preparar ${chat}: ${r.status} ${(r.stdout || '').trim().split('\n').pop()}`);
}

const numeroDe = (chat) => (chat.endsWith('@s.whatsapp.net') ? `+${chat.split('@')[0]}` : chat);
const quemE = (chat, e, nome) => `${e?.nome_cliente || nome || 'cliente'} (${numeroDe(chat)})`;
const dentroAlerta = (cfg) => { const h = new Date().getHours(); return h >= cfg.alertaHoras[0] && h < cfg.alertaHoras[1]; };
function novoCaso(chat, nome, tipo, resumo, pergunta, sugestao = null) {
  return Number(db.prepare('INSERT INTO agente_caso (chat, nome, resumo, pergunta, criado, tipo, sugestao) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(chat, nome, resumo || '', pergunta || '', agora(), tipo, sugestao).lastInsertRowid);
}

// contexto comum do prompt do cliente
function argsPrompt(cfg, chat, e, sugestao = false) {
  prepararMidia(chat, Math.floor(cfg.ini / 1000) - 3600);
  const abertos = db.prepare("SELECT id, resumo, pergunta FROM agente_caso WHERE chat = ? AND status = 'aberto'").all(chat);
  // cliente novo = o agente nunca atendeu essa conversa e a equipe não falou com ela nos últimos 3 dias
  // (histórico antigo, até pessoal, não impede; o modelo vê a conversa e não repete perguntas já respondidas)
  const aus = textoAusencia();
  const teveHumano = db.prepare('SELECT texto FROM msgs WHERE chat = ? AND meu = 1 AND ts > ?').all(chat, agora() - 3 * 86400).some((m) => ehHumano(cfg, m.texto, aus));
  // há quanto tempo a mensagem mais antiga ainda não respondida espera (retomada depois de ficar fora do ar)
  const pendente = db.prepare('SELECT MIN(ts) t FROM msgs WHERE chat = ? AND meu = 0 AND ts > ?').get(chat, e.ultimo_ts || 0).t;
  return { nome: cfg.nome, empresa: cfg.empresa, conversa: textoConversa(cfg, chat), primeiroContato: !sugestao && !e.apresentado,
    esperaMin: pendente ? Math.round((agora() - pendente) / 60) : 0,
    casosAbertos: abertos.map((c) => `#${c.id}: ${c.pergunta}`).join('\n'), evento: eventoAtivo(cfg), sugestao,
    clienteNovo: !e.apresentado && !teveHumano, nomeCliente: e.nome_cliente, origem: e.origem,
    contexto: contextoAgora(cfg),
    agoraTxt: new Date().toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) };
}

// ---------- conversa que a equipe está atendendo: cliente sem resposta → aviso com sugestão ----------
async function talvezAlertar(cfg, c, e) {
  if (agora() - c.ult < cfg.semRespostaMin * 60 || (e.alertado_ts || 0) >= c.ult || !dentroAlerta(cfg)) return;
  db.prepare('UPDATE agente_chat SET alertado_ts = ? WHERE chat = ?').run(c.ult, c.chat);
  let r = null;
  try { r = await chamarClaude(promptCliente(argsPrompt(cfg, c.chat, e, true))); } catch (err) { log(`ERRO sugestão ${c.chat}: ${err.message}`); }
  if (r?.acao === 'silencio') { log(`sem resposta ${c.chat}, mas não pede resposta`); return; }
  let sug = String(r?.mensagem_cliente || '').trim().slice(0, 1500);
  if (PROIBIDO.test(sug)) sug = '';
  const ultima = db.prepare('SELECT tipo, texto, transcricao FROM msgs WHERE chat = ? AND meu = 0 ORDER BY ts DESC LIMIT 1').get(c.chat);
  const ultTxt = (ultima?.texto || ultima?.transcricao || `[${ultima?.tipo}]`).slice(0, 300);
  const min = Math.round((agora() - c.ult) / 60);
  const id = novoCaso(c.chat, c.nome, 'sugestao', r?.resumo, `cliente sem resposta há ${min} min`, sug || null);
  avisarDavi(cfg, cartao({ id, icone: '⏰', titulo: `sem resposta há ${min} min`, quem: quemE(c.chat, e, c.nome), resumo: `Última msg: "${ultTxt}"`, sugestao: sug })
    + '\n\nOu responda você mesmo na conversa.');
  log(`alerta sem resposta #${id} ${c.chat}`);
}

// casos parados: lembra uma vez
function lembrarCasos(cfg) {
  if (!dentroAlerta(cfg)) return;
  for (const k of db.prepare("SELECT * FROM agente_caso WHERE status = 'aberto' AND lembrado = 0 AND criado < ?").all(agora() - cfg.lembrarCasoMin * 60)) {
    db.prepare('UPDATE agente_caso SET lembrado = 1 WHERE id = ?').run(k.id);
    const e = db.prepare('SELECT * FROM agente_chat WHERE chat = ?').get(k.chat);
    avisarDavi(cfg, cartao({ id: k.id, icone: '⏰', titulo: `lembrete · aguardando há ${Math.round((agora() - k.criado) / 60)} min`, quem: quemE(k.chat, e, k.nome), resumo: k.resumo || k.pergunta, sugestao: k.sugestao }));
  }
}

// a equipe respondeu direto na conversa depois que o caso foi aberto: caso encerrado
function fecharAssumidos(cfg) {
  const aus = textoAusencia();
  for (const k of db.prepare("SELECT id, chat, criado FROM agente_caso WHERE status = 'aberto'").all()) {
    if (db.prepare('SELECT texto FROM msgs WHERE chat = ? AND meu = 1 AND ts > ?').all(k.chat, k.criado).some((m) => ehHumano(cfg, m.texto, aus))) {
      db.prepare("UPDATE agente_caso SET status = 'assumido', fechado = ? WHERE id = ?").run(agora(), k.id);
      log(`caso #${k.id} assumido pela equipe`);
    }
  }
}

// ---------- atendimento de um cliente ----------
async function atenderCliente(cfg, chat, nome, ateTs) {
  const e = estadoChat(chat);
  if (e.msgs_dia >= cfg.maxPorChatDia) {
    db.prepare('UPDATE agente_chat SET ultimo_ts = ? WHERE chat = ?').run(ateTs, chat);
    if (e.msgs_dia === cfg.maxPorChatDia) { avisarDavi(cfg, `Limite de ${cfg.maxPorChatDia} respostas hoje atingido com ${nome || chat}. Parei de responder essa conversa até amanhã.`); db.prepare('UPDATE agente_chat SET msgs_dia = msgs_dia + 1 WHERE chat = ?').run(chat); }
    return;
  }
  const prompt = promptCliente(argsPrompt(cfg, chat, e));
  let r;
  try { r = await chamarClaude(prompt); }
  catch (err) { log(`ERRO claude ${chat}: ${err.message}`); falhou(cfg, err.message); return; } // não marca como lido: tenta de novo no próximo ciclo
  db.prepare('UPDATE agente_chat SET ultimo_ts = ? WHERE chat = ?').run(ateTs, chat);
  log(`cliente ${nome || chat}: ${r.acao} | ${r.resumo || ''}`);
  if (r.nome_cliente) db.prepare('UPDATE agente_chat SET nome_cliente = ? WHERE chat = ?').run(String(r.nome_cliente).slice(0, 60), chat);
  if (r.origem) db.prepare('UPDATE agente_chat SET origem = ? WHERE chat = ?').run(String(r.origem).slice(0, 80), chat);

  if (r.acao === 'silencio' || !r.mensagem_cliente) return;
  let texto = String(r.mensagem_cliente).trim().slice(0, 1500);
  let acao = r.acao;
  if (PROIBIDO.test(texto)) { log(`bloqueado (proibido) ${chat}: ${texto}`); acao = 'consultar'; texto = 'Estou verificando essas informações aqui no sistema e já te retorno, combinado?'; r.pergunta_davi = `${r.pergunta_davi || ''} (resposta automática bloqueada por citar preço/nomes internos)`.trim(); }
  enfileirar(chat, nome, paraCliente(cfg, texto));
  db.prepare('UPDATE agente_chat SET apresentado = 1, msgs_dia = msgs_dia + 1 WHERE chat = ?').run(chat);
  if (!e.etiquetado && cfg.etiquetaLead) {
    db.prepare('UPDATE agente_chat SET etiquetado = 1 WHERE chat = ?').run(chat);
    const salvo = db.prepare('SELECT salvo FROM chats WHERE jid = ?').get(chat)?.salvo;
    const primeira = db.prepare('SELECT MIN(ts) t FROM msgs WHERE chat = ?').get(chat).t || agora();
    if (!salvo && !etiquetasDo(chat).length && primeira > agora() - 3 * 86400) { pedirEtiqueta(chat, cfg.etiquetaLead); log(`lead: etiqueta "${cfg.etiquetaLead}" em ${chat}`); }
  }

  if (acao === 'consultar' || acao === 'encaminhar') {
    // já existe caso aberto desse cliente? atualiza o mesmo número em vez de abrir outro
    const aberto = db.prepare("SELECT id FROM agente_caso WHERE chat = ? AND status = 'aberto' AND tipo != 'sugestao' ORDER BY id DESC LIMIT 1").get(chat);
    const sug = String(r.sugestao_davi || '').trim().slice(0, 1500) || null;
    const id = aberto ? aberto.id : novoCaso(chat, nome, acao, r.resumo, r.pergunta_davi, sug);
    if (aberto) db.prepare('UPDATE agente_caso SET resumo = ?, pergunta = ?, tipo = ?, sugestao = ?, lembrado = 0 WHERE id = ?').run(r.resumo || '', r.pergunta_davi || '', acao, sug, id);
    const quem = `${r.nome_cliente || e.nome_cliente || nome || 'cliente'} (${numeroDe(chat)})`;
    const enc = acao === 'encaminhar';
    avisarDavi(cfg, cartao({ id, icone: aberto ? '🔄' : enc ? '📨' : '📋', titulo: `${aberto ? 'atualização · ' : ''}${r.categoria || 'atendimento'}`, quem,
      origem: aberto ? null : r.origem || e.origem, resumo: r.resumo_davi || r.resumo, decidir: enc ? null : r.pergunta_davi, sugestao: sug })
      + (enc ? '\n\nOu siga direto na conversa (eu paro de responder quando você escrever).' : ''));
  }
}

let ultimaFalha = 0;
let esperarAte = 0; // após falha do modelo, espera 2 min antes de tentar de novo
function falhou(cfg, msg) {
  esperarAte = Date.now() + 120_000;
  if (Date.now() - ultimaFalha < 3600_000) return;
  ultimaFalha = Date.now();
  avisarDavi(cfg, `⚠️ Estou com falha para gerar respostas (${msg.slice(0, 150)}). Vou tentar de novo sozinho.`);
}

// ---------- texto livre do Davi ("manda pro Fulano que ...") ----------
async function interpretarDavi(cfg, texto) {
  const recentes = db.prepare(`SELECT m.chat, MAX(m.ts) ult, c.nome, a.nome_cliente FROM msgs m LEFT JOIN chats c ON c.jid = m.chat
    LEFT JOIN agente_chat a ON a.chat = m.chat WHERE m.ts >= ? AND m.chat NOT LIKE '%@g.us' AND m.chat NOT LIKE '%broadcast' AND m.chat NOT LIKE '%@newsletter'
    GROUP BY m.chat ORDER BY ult DESC LIMIT 20`).all(agora() - 7 * 86400).filter((r) => !cfg.daviJids.includes(r.chat));
  const lista = recentes.map((r, i) => {
    const ult = db.prepare('SELECT meu, texto FROM msgs WHERE chat = ? AND texto IS NOT NULL ORDER BY ts DESC LIMIT 3').all(r.chat).reverse()
      .map((m) => `${m.meu ? 'nós' : 'cliente'}: ${(m.texto || '').replace(/\s+/g, ' ').slice(0, 120)}`).join(' | ');
    const et = etiquetasDo(r.chat);
    return `[${i}] ${r.nome_cliente || r.nome || '(sem nome)'} ${numeroDe(r.chat)}${et.length ? ` [etiquetas: ${et.join(', ')}]` : ''} — ${ult}`;
  }).join('\n');
  const casos = db.prepare("SELECT id, nome, resumo FROM agente_caso WHERE status = 'aberto' ORDER BY id").all().map((k) => `#${k.id} ${k.nome || ''}: ${k.resumo}`).join('\n');
  let r;
  const etiquetas = db.prepare('SELECT nome FROM etiquetas ORDER BY nome').all().map((e) => e.nome).join(', ');
  try { r = await chamarClaude(promptComandoDavi({ nome: cfg.nome, empresa: cfg.empresa, texto, lista, casos, etiquetas })); }
  catch (err) { avisarDavi(cfg, `Não consegui entender agora (${err.message.slice(0, 100)}). Mande de novo, ou use *#N orientação*.`); return; }
  if (r.acao === 'caso' && r.id) return tratarDavi(cfg, { texto: `#${r.id} ${r.instrucao || ''}` });
  if (r.acao === 'etiqueta' && recentes[r.chat_idx] && r.etiqueta) {
    const alvo = recentes[r.chat_idx];
    pedirEtiqueta(alvo.chat, String(r.etiqueta).trim(), !!r.remover);
    avisarDavi(cfg, `🏷️ ${r.remover ? 'Tirei' : 'Coloquei'} a etiqueta *${r.etiqueta}* ${r.remover ? 'de' : 'em'} ${alvo.nome_cliente || alvo.nome || numeroDe(alvo.chat)}.`);
    return;
  }
  if (r.acao === 'enviar' && recentes[r.chat_idx] && r.mensagem) {
    const alvo = recentes[r.chat_idx];
    const nome = alvo.nome_cliente || alvo.nome || numeroDe(alvo.chat);
    const msg = String(r.mensagem).trim().slice(0, 1500);
    kv.set('pendente', JSON.stringify({ chat: alvo.chat, nome, texto: msg, criado: agora() }));
    avisarDavi(cfg, `📤 Vou mandar para *${nome}* (${numeroDe(alvo.chat)}):\n\n"${msg}"\n\nConfirma? Responda *SIM* ou *NÃO*.`);
    return;
  }
  avisarDavi(cfg, r.resposta || 'Não entendi. Diga para qual cliente e o que mandar, ou use *#N orientação*. Comandos: STATUS, PAUSAR, RETOMAR.');
}

// ---------- mensagens do Davi (comandos e orientações) ----------
async function tratarDavi(cfg, m) {
  const t = (m.texto || '').trim();
  const T = t.toUpperCase();
  if (T === 'PAUSAR') { kv.set('pausado', 1); avisarDavi(cfg, '⏸️ Pausado. Não respondo mais nenhum cliente até você mandar RETOMAR.'); return; }
  if (T === 'RETOMAR') { kv.set('pausado', 0); avisarDavi(cfg, '▶️ Retomado.'); return; }
  if (T === 'STATUS') {
    const abertos = db.prepare("SELECT id, nome, resumo FROM agente_caso WHERE status = 'aberto' ORDER BY id").all();
    const hojeN = db.prepare('SELECT COUNT(*) n FROM agente_chat WHERE dia = ? AND msgs_dia > 0').get(hoje()).n;
    avisarDavi(cfg, `${kv.get('pausado') === '1' ? '⏸️ PAUSADO' : '▶️ Ativo'} | conversas atendidas hoje: ${hojeN}\nCasos abertos: ${abertos.length ? abertos.map((c) => `\n#${c.id} ${c.nome || ''}: ${c.resumo}`).join('') : 'nenhum'}`);
    return;
  }
  // envio pedido em texto livre aguardando confirmação
  const pend = (() => { try { const p = JSON.parse(kv.get('pendente') || 'null'); return p && agora() - p.criado < 1800 ? p : null; } catch { return null; } })();
  if (pend && /^(SIM|S|OK|PODE|CONFIRMO|CONFIRMA|MANDA)[.!]?$/.test(T)) {
    kv.set('pendente', 'null');
    enfileirar(pend.chat, pend.nome, paraCliente(cfg, pend.texto));
    avisarDavi(cfg, `✅ Enviado para ${pend.nome}.`);
    log(`envio livre confirmado ${pend.chat}`);
    return;
  }
  if (pend && /^(N[ÃA]O|N|CANCELA|CANCELAR)[.!]?$/.test(T)) { kv.set('pendente', 'null'); avisarDavi(cfg, '❌ Cancelado, não enviei nada.'); return; }

  const mt = t.match(/^#\s*(\d+)\s*[:\-–]?\s*([\s\S]*)$/);
  if (!mt) return interpretarDavi(cfg, t);
  const caso = db.prepare('SELECT * FROM agente_caso WHERE id = ?').get(Number(mt[1]));
  const instrucao = mt[2].trim();
  if (!caso || !['aberto', 'assumido'].includes(caso.status)) { avisarDavi(cfg, `Caso #${mt[1]} não está aberto.`); return; }
  if (!instrucao) { avisarDavi(cfg, `Faltou a orientação do caso #${caso.id}.`); return; }

  let texto;
  const depois = /^(sexta|depois)\.?$/i.test(instrucao);
  const ev = eventoAtivo(cfg);
  if (/^(ok|sim|pode|manda)[.!]?$/i.test(instrucao)) {
    if (!caso.sugestao) { avisarDavi(cfg, `O caso #${caso.id} não tem sugestão pronta. Mande *#${caso.id} sua orientação*.`); return; }
    texto = caso.sugestao;
  } else if (depois) {
    const quando = ev ? `retorna com você na ${ev.retorno}` : cfg.horario && !aberto(cfg.horario) ? `retorna com você ${textoRetorno(cfg.horario)}` : 'em breve vai te responder por aqui';
    texto = `Por agora não consigo seguir com o atendimento, mas já coletei todas as informações e enviei para a equipe, que ${quando}. Obrigado pela paciência! 🙏`;
  }
  else {
    let r;
    try { r = await chamarClaude(promptRespostaDavi({ nome: cfg.nome, empresa: cfg.empresa, caso, conversa: textoConversa(cfg, caso.chat, 12), instrucao })); }
    catch (err) { avisarDavi(cfg, `Falha ao redigir a resposta do caso #${caso.id} (${err.message.slice(0, 100)}). Mande de novo em instantes.`); return; }
    // era uma pergunta para o agente sobre o caso: responde só ao dono e o caso continua aberto
    if (r.para === 'equipe') { avisarDavi(cfg, `💬 *#${caso.id}* ${String(r.resposta_davi || 'Não sei responder com base na conversa.').trim()}`); return; }
    texto = String(r.mensagem_cliente || '').trim();
    if (!texto || /(claude|anthropic|openai|chatgpt|\bdavi\b)/i.test(texto)) { avisarDavi(cfg, `Não consegui redigir uma resposta segura para o caso #${caso.id}. Mande a orientação de outro jeito ou *#${caso.id} sexta*.`); return; }
  }
  enfileirar(caso.chat, caso.nome, paraCliente(cfg, texto.slice(0, 1500)));
  db.prepare("UPDATE agente_caso SET status = ?, fechado = ?, resposta = ? WHERE id = ?").run(depois ? 'depois' : 'respondido', agora(), texto, caso.id);
  avisarDavi(cfg, `✅ Caso #${caso.id} respondido ao cliente:\n"${texto.slice(0, 400)}"`);
  log(`caso #${caso.id} respondido`);
}

// ---------- resumo diário às 20h ----------
function resumoDiario(cfg) {
  const d = new Date();
  if (d.getHours() !== 20 || kv.get('resumo_dia') === hoje()) return;
  kv.set('resumo_dia', hoje());
  const inicioDia = Math.floor(new Date(d.setHours(0, 0, 0, 0)).getTime() / 1000);
  const casos = db.prepare('SELECT id, nome, resumo, status FROM agente_caso WHERE criado >= ? ORDER BY id').all(inicioDia);
  const atendidos = db.prepare('SELECT a.chat, c.nome FROM agente_chat a LEFT JOIN chats c ON c.jid = a.chat WHERE a.dia = ? AND a.msgs_dia > 0').all(hoje());
  avisarDavi(cfg, `🗒️ *Resumo de hoje*\nConversas atendidas: ${atendidos.length}${atendidos.map((a) => `\n• ${a.nome || a.chat}`).join('')}\nCasos: ${casos.length ? casos.map((c) => `\n#${c.id} [${c.status}] ${c.nome || ''}: ${c.resumo}`).join('') : 'nenhum'}`);
}

// ---------- vigia do leitor ----------
// A tarefa wa-leitor nem sempre se religa quando o processo morre; o agente (sessão logada) confere a
// cada minuto e, se o leitor não estiver vivo nem subindo, inicia a tarefa (não precisa de administrador).
let ultimaVigia = 0;
let leitorCaidoDesde = 0;
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', windowsHide: true }).trim();
function vigiarLeitor(cfg) {
  if (!WIN) return; // no Linux/Docker quem religa é o próprio orquestrador (restart: unless-stopped)
  if (Date.now() - ultimaVigia < 60_000) return;
  ultimaVigia = Date.now();
  let vivo = false;
  try {
    const pid = Number(readFileSync(PATHS.pid, 'utf8'));
    vivo = processoVivo(pid);
  } catch {}
  if (vivo) {
    if (leitorCaidoDesde) {
      const min = Math.round((Date.now() - leitorCaidoDesde) / 60_000);
      log(`leitor voltou (${min} min fora)`);
      if (cfg && min >= 5) avisarDavi(cfg, `⚠️ O leitor do WhatsApp ficou fora do ar por ~${min} min e foi religado sozinho. Respondo o que ficou pendente.`);
    }
    leitorCaidoDesde = 0;
    return;
  }
  if (!leitorCaidoDesde) leitorCaidoDesde = Date.now();
  try {
    if (ps('(Get-ScheduledTask -TaskName wa-leitor).State') !== 'Running') { ps('Start-ScheduledTask -TaskName wa-leitor'); log('leitor fora do ar: tarefa wa-leitor iniciada'); }
  } catch (e) { log(`vigia do leitor: ${e.message}`); }
}

// ---------- aviso do momento para o prompt ----------
// 1) "contexto" manual do agente.json (até "contextoAte"); 2) fora do "horario" de atendimento (sem evento).
function contextoAgora(cfg) {
  if (cfg.contexto && (!cfg.contextoAte || Date.now() < Date.parse(cfg.contextoAte))) return cfg.contexto;
  if (cfg.horario && !eventoAtivo(cfg) && !aberto(cfg.horario)) {
    return `Agora é fora do horário de atendimento da equipe (${cfg.horario.descricao || 'dias úteis em horário comercial'}). `
      + `A equipe volta ${textoRetorno(cfg.horario)}. Você continua ajudando no que puder e deixa o resto registrado para a equipe.`;
  }
  return null;
}

// ---------- sinal de vida (Healthchecks.io ou similar) ----------
// A cada 5 min pinga "pingUrl" (agente vivo e, no Windows, leitor vivo) ou "<pingUrl>/fail" (leitor fora).
// Se os pings param (PC desligado, sem internet), o serviço manda e-mail.
let ultimoPing = 0;
function pingar(cfg) {
  if (!cfg?.pingUrl || Date.now() - ultimoPing < 300_000) return;
  ultimoPing = Date.now();
  let leitorOk = true;
  if (WIN) { try { leitorOk = processoVivo(Number(readFileSync(PATHS.pid, 'utf8'))); } catch { leitorOk = false; } }
  fetch(leitorOk ? cfg.pingUrl : `${cfg.pingUrl.replace(/\/$/, '')}/fail`, { signal: AbortSignal.timeout(15_000) }).catch((e) => log(`ping falhou: ${e.message}`));
}

// ---------- ciclo ----------
let ocupado = false;
async function ciclo() {
  if (ocupado) return;
  ocupado = true;
  try {
    writeFileSync(ARQ_PID, String(process.pid)); // mantém o pid "fresco" (mtime) para o status
    const cfg = lerCfg();
    vigiarLeitor(cfg);
    pingar(cfg);
    if (!cfg || Date.now() < cfg.ini || Date.now() > cfg.fim) return;
    const iniS = Math.floor(cfg.ini / 1000);

    // 1) mensagens do Davi
    const ultDavi = Number(kv.get('ult_davi') || iniS);
    const marcadas = cfg.daviJids.map(() => '?').join(',');
    for (const m of db.prepare(`SELECT * FROM msgs WHERE chat IN (${marcadas}) AND meu = 0 AND ts > ? ORDER BY ts`).all(...cfg.daviJids, ultDavi)) {
      kv.set('ult_davi', m.ts);
      await tratarDavi(cfg, m);
    }
    fecharAssumidos(cfg);
    if (kv.get('pausado') === '1' || Date.now() < esperarAte) return;
    lembrarCasos(cfg);

    // 2) clientes com mensagem nova (privado, dentro do período, fora das listas)
    const lim = agora() - DEBOUNCE_S;
    const cands = db.prepare(`SELECT m.chat, MAX(m.ts) ult, c.nome FROM msgs m LEFT JOIN chats c ON c.jid = m.chat
      WHERE m.meu = 0 AND m.ts >= ? AND m.chat NOT LIKE '%@g.us' AND m.chat NOT LIKE '%broadcast' AND m.chat NOT LIKE '%@newsletter'
      GROUP BY m.chat`).all(Math.floor(cfg.desdeLiberado / 1000));
    for (const c of cands) {
      if (cfg.daviJids.includes(c.chat)) continue;
      const numero = c.chat.split('@')[0];
      if (cfg.excluir.includes(numero) || (cfg.somente.length && !cfg.somente.includes(numero))) continue;
      if (ehPessoal(cfg, c.chat)) continue; // contato pessoal ou de outro robô: o agente não entra
      const e = estadoChat(c.chat);
      if (c.ult <= e.ultimo_ts || c.ult > lim) continue; // nada novo, ou cliente ainda digitando
      const aus = textoAusencia();
      // a última mensagem da conversa já é uma resposta da equipe: nada a fazer
      const ultima = db.prepare('SELECT meu, texto FROM msgs WHERE chat = ? ORDER BY ts DESC LIMIT 1').get(c.chat);
      if (ultima?.meu && ehHumano(cfg, ultima.texto, aus)) { db.prepare('UPDATE agente_chat SET ultimo_ts = ? WHERE chat = ?').run(c.ult, c.chat); continue; }
      // a equipe escreveu nessa conversa nas últimas horas? então ela está atendendo: o agente não responde
      // sozinho, só avisa o Davi (com sugestão) se o cliente ficar muito tempo sem resposta
      const desdeHumano = Math.max(iniS, agora() - cfg.humanoHoras * 3600);
      const humano = db.prepare('SELECT texto FROM msgs WHERE chat = ? AND meu = 1 AND ts >= ?').all(c.chat, desdeHumano)
        .some((m) => ehHumano(cfg, m.texto, aus));
      if (humano) {
        if (!e.humano) { db.prepare('UPDATE agente_chat SET humano = 1 WHERE chat = ?').run(c.chat); log(`equipe atendendo ${c.chat}: agente só sugere`); }
        await talvezAlertar(cfg, c, e);
        continue;
      }
      if (e.humano) db.prepare('UPDATE agente_chat SET humano = 0 WHERE chat = ?').run(c.chat);
      await atenderCliente(cfg, c.chat, c.nome, c.ult);
    }
    resumoDiario(cfg);
  } catch (e) { log('erro no ciclo', e.stack || e.message); }
  finally { ocupado = false; }
}

log(`agente iniciado (PID ${process.pid})`);
setInterval(ciclo, CICLO_MS);
ciclo();
