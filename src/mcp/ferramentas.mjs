// Ferramentas do servidor MCP do Zapdesk. Cada uma recebe os argumentos e um "ctx" com as portas do banco,
// para testar sem WhatsApp: { ler(): db só leitura, escrever(): db de escrita, config(), leitorVivo() }.
import { listarConversas, detalharConversa, resumoDante, acharConversa } from '../painel/dados.mjs';
import { enfileirarEnvio, cancelarEnvio } from '../painel/envio.mjs';
import { assumirDeVolta, silenciar, reativar, definirPausa } from '../agente/controle.mjs';
import { criarRotina, alternarRotina, apagarRotina, listarRotinas } from '../regras/rotinas.mjs';
import { registrar } from '../painel/auditoria.mjs';

const hora = (ts) => (ts ? new Date(ts * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const usando = (abrir, f) => { const db = abrir(); try { return f(db); } finally { try { db.close(); } catch {} } };
const chatArg = { chat: { type: 'string', description: 'Nome (ou parte), número com DDI ou jid da conversa' } };

export const FERRAMENTAS = [
  {
    name: 'zapdesk_conversas',
    description: 'Lista as conversas privadas do WhatsApp com o status do Dante em cada uma (atendendo, vai responder, esperando cliente, equipe atendendo, aguardando equipe, caso aberto, silenciado, pausado, fora do Dante, sem Dante). Só leitura.',
    inputSchema: { type: 'object', properties: {
      busca: { type: 'string', description: 'Filtra por nome ou número' },
      status: { type: 'string', description: 'Filtra por código de status: dante, vai-responder, esperando-cliente, equipe, aguardando-equipe, caso, silenciado, pausado, fora, sem-dante' },
      limite: { type: 'number', description: 'Máximo de conversas (padrão 30)' },
    } },
    rodar(a, ctx) {
      const q = String(a.busca || '').toLowerCase();
      const lista = usando(ctx.ler, (db) => listarConversas(db, { cfg: ctx.config() }))
        .filter((c) => (!a.status || c.status.codigo === a.status) && (!q || c.nome.toLowerCase().includes(q) || c.numero.includes(q)))
        .slice(0, Number(a.limite) || 30);
      if (!lista.length) return 'Nenhuma conversa.';
      return lista.map((c) => `${c.nome} (+${c.numero}) | ${c.status.rotulo}${c.casoAberto ? ` | caso #${c.casoAberto}` : ''} | ${hora(c.ultima_ts)} | ${c.ultimaMeu ? 'nós: ' : ''}${c.previa}`).join('\n');
    },
  },
  {
    name: 'zapdesk_ler',
    description: 'Lê as últimas mensagens de uma conversa, dizendo quem escreveu cada uma (cliente, Dante, equipe, aviso) e o status do Dante. Só leitura.',
    inputSchema: { type: 'object', properties: { ...chatArg, limite: { type: 'number', description: 'Quantas mensagens (padrão 30)' } }, required: ['chat'] },
    rodar(a, ctx) {
      return usando(ctx.ler, (db) => {
        const c = acharConversa(db, a.chat);
        const d = detalharConversa(db, c.jid, { cfg: ctx.config(), limite: Number(a.limite) || 30 });
        const cab = `${d.nome} (+${d.numero}) | ${d.status.rotulo}${d.perfil ? ` | perfil ${d.perfil}` : ''}${d.origem ? ` | origem ${d.origem}` : ''}`;
        const msgs = d.msgs.map((m) => `[${hora(m.ts)}] ${m.quem}: ${m.texto || (m.transcricao ? `(áudio) ${m.transcricao}` : `[${m.tipo || 'mídia'}]`)}`);
        const fila = d.fila.filter((o) => !o.enquete).map((o) => `[${o.status}${o.enviar_em ? ` ${hora(o.enviar_em)}` : ''}] #${o.id} ${(o.texto || '').slice(0, 80)}`);
        return [cab, ...msgs, ...(fila.length ? ['-- na fila --', ...fila] : [])].join('\n');
      });
    },
  },
  {
    name: 'zapdesk_status',
    description: 'Saúde do Zapdesk: Dante e leitor no ar, pausa, fila de envio, casos abertos e as últimas linhas do log do agente. Só leitura.',
    inputSchema: { type: 'object', properties: { linhas_log: { type: 'number', description: 'Linhas do log (padrão 10)' } } },
    rodar(a, ctx) {
      const r = usando(ctx.ler, (db) => resumoDante(db, { linhas: Number(a.linhas_log) || 10 }));
      const fila = Object.entries(r.fila).map(([k, v]) => `${v} ${k}`).join(', ') || 'vazia';
      return [`Dante: ${r.agenteVivo ? 'no ar' : 'PARADO'} | Leitor: ${r.leitorVivo ? 'no ar' : 'PARADO'} | Atendimento: ${r.pausado ? 'PAUSADO' : 'ativo'}`,
        `Fila: ${fila}`,
        `Casos abertos (${r.casosAbertos.length}): ${r.casosAbertos.map((k) => `#${k.id} ${k.nome || ''}: ${k.resumo}`).join(' | ') || 'nenhum'}`,
        '-- log --', ...r.log].join('\n');
    },
  },
  {
    name: 'zapdesk_enviar',
    description: 'Envia (ou programa) uma mensagem de WhatsApp COMO O DAVI, com o cabeçalho "Davi | CEO e Desenvolvedor DS Trade" aplicado sozinho (não escreva cabeçalho no texto). USE SÓ QUANDO O DAVI PEDIR EXPLICITAMENTE, depois de confirmar destinatário e texto. Nunca cite Claude/IA ao cliente. Por padrão o Dante para de responder esse cliente por 12 h; com dante_continua=true ele segue atendendo.',
    inputSchema: { type: 'object', properties: {
      ...chatArg,
      texto: { type: 'string', description: 'Texto da mensagem, sem o cabeçalho' },
      em: { type: 'string', description: 'Programar: "AAAA-MM-DD HH:MM" (hora local). Vazio = envia agora' },
      dante_continua: { type: 'boolean', description: 'true = a mensagem não faz o Dante parar de atender esse cliente' },
    }, required: ['chat', 'texto'] },
    rodar(a, ctx) {
      let em;
      if (a.em) {
        const m = String(a.em).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
        if (!m) throw new Error('Formato de "em" inválido. Use "AAAA-MM-DD HH:MM".');
        em = Math.floor(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() / 1000);
      }
      return usando(ctx.escrever, (db) => {
        const c = acharConversa(db, a.chat);
        const r = enfileirarEnvio(db, { jid: c.jid, texto: a.texto, em, danteContinua: a.dante_continua === true, origem: 'mcp', leitorVivo: ctx.leitorVivo() });
        return `${r.programada ? `Programada para ${hora(r.enviar_em)}` : 'Na fila para envio agora'}: #${r.id} → ${c.nome || c.jid}${r.danteContinua ? ' (o Dante continua atendendo)' : ' (o Dante para por 12 h nesta conversa)'}`;
      });
    },
  },
  {
    name: 'zapdesk_fila',
    description: 'Lista o que está na fila de envio (pendente, programado, enviando, falhou). Só leitura.',
    inputSchema: { type: 'object', properties: {} },
    rodar(a, ctx) {
      return usando(ctx.ler, (db) => {
        const l = db.prepare("SELECT id, nome, chat, texto, enviar_em, status, erro FROM outbox WHERE status IN ('pendente','enviando','falhou','atrasada') ORDER BY enviar_em, id").all();
        if (!l.length) return 'Fila vazia.';
        return l.map((o) => `#${o.id} [${o.status}] ${hora(o.enviar_em)} → ${o.nome || o.chat} | ${(o.texto || '(enquete)').replace(/\s+/g, ' ').slice(0, 70)}${o.erro ? ` (${o.erro})` : ''}`).join('\n');
      });
    },
  },
  {
    name: 'zapdesk_cancelar',
    description: 'Cancela uma mensagem da fila que ainda não saiu (pelo número #id).',
    inputSchema: { type: 'object', properties: { id: { type: 'number', description: 'Número da mensagem na fila' } }, required: ['id'] },
    rodar(a, ctx) { return usando(ctx.escrever, (db) => { cancelarEnvio(db, a.id); registrar(db, { origem: 'mcp', acao: 'cancelar', detalhe: `#${a.id}` }); return `Mensagem #${a.id} cancelada.`; }); },
  },
  {
    name: 'zapdesk_dante',
    description: 'Controla o Dante: "assumir" (ele volta a atender a conversa, ignorando o que a equipe escreveu até agora), "silenciar" (não responde nem sugere nessa conversa; horas opcional), "reativar" (tira o silêncio), "pausar"/"retomar" (liga ou desliga o atendimento de TODOS os clientes: peça confirmação ao Davi antes de pausar).',
    inputSchema: { type: 'object', properties: {
      acao: { type: 'string', enum: ['assumir', 'silenciar', 'reativar', 'pausar', 'retomar'] },
      ...chatArg,
      horas: { type: 'number', description: 'Só para silenciar: por quantas horas (vazio = até reativar)' },
    }, required: ['acao'] },
    rodar(a, ctx) {
      return usando(ctx.escrever, (db) => {
        if (a.acao === 'pausar' || a.acao === 'retomar') { registrar(db, { origem: 'mcp', acao: a.acao }); definirPausa(db, a.acao === 'pausar'); return a.acao === 'pausar' ? 'Dante PAUSADO para todos os clientes.' : 'Dante retomado.'; }
        if (!['assumir', 'silenciar', 'reativar'].includes(a.acao)) throw new Error('Ação inválida.');
        const c = acharConversa(db, a.chat);
        registrar(db, { origem: 'mcp', acao: a.acao, chat: c.jid, detalhe: a.horas ? `${a.horas} h` : null });
        if (a.acao === 'assumir') { assumirDeVolta(db, c.jid); return `Dante assume de volta: ${c.nome}.`; }
        if (a.acao === 'reativar') { reativar(db, c.jid); return `Dante reativado em ${c.nome}.`; }
        const h = Number(a.horas) || 0;
        silenciar(db, c.jid, h > 0 ? Math.floor(Date.now() / 1000) + Math.round(h * 3600) : 0);
        return `Dante silenciado em ${c.nome}${h > 0 ? ` por ${h} h` : ' até reativar'}.`;
      });
    },
  },
  {
    name: 'zapdesk_rotinas',
    description: 'Rotinas recorrentes de mensagem (ex.: toda segunda e quinta às 09:00 para um cliente). Ações: "listar", "criar" (chat, texto, dias, hora; ate e dante_continua opcionais), "pausar", "retomar" e "apagar" (id). A mensagem sai como o Davi, com o cabeçalho padrão. CRIE SÓ QUANDO O DAVI PEDIR e confirme destinatário, texto, dias e hora antes. O agente Dante dispara na hora; se estiver parado por mais de 30 min a ocorrência é pulada.',
    inputSchema: { type: 'object', properties: {
      acao: { type: 'string', enum: ['listar', 'criar', 'pausar', 'retomar', 'apagar'] },
      ...chatArg,
      texto: { type: 'string', description: 'Texto da mensagem, sem o cabeçalho' },
      dias: { type: 'array', items: { type: 'number' }, description: 'Dias da semana: 0=domingo, 1=segunda ... 6=sábado' },
      hora: { type: 'string', description: 'HH:MM, hora local' },
      ate: { type: 'string', description: 'Opcional: AAAA-MM-DD, última data em que a rotina vale' },
      dante_continua: { type: 'boolean', description: 'Padrão true: a mensagem automática não faz o Dante parar de atender o cliente' },
      id: { type: 'number', description: 'Número da rotina (pausar, retomar, apagar)' },
    }, required: ['acao'] },
    rodar(a, ctx) {
      const fmt = (ts) => (ts ? new Date(ts * 1000).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-');
      if (a.acao === 'listar') {
        const l = usando(ctx.ler, (db) => listarRotinas(db));
        return l.length ? l.map((r) => `#${r.id} [${r.ativa ? 'ativa' : 'pausada'}] ${r.nome || r.chat} | ${r.dias_nomes} ${r.hora}${r.ate ? ` até ${r.ate}` : ''} | próxima: ${fmt(r.proxima)} | ${r.texto.replace(/\s+/g, ' ').slice(0, 60)}`).join('\n') : 'Nenhuma rotina.';
      }
      return usando(ctx.escrever, (db) => {
        if (a.acao === 'criar') {
          const c = acharConversa(db, a.chat);
          const r = criarRotina(db, { jid: c.jid, texto: a.texto, dias: a.dias, hora: a.hora, ate: a.ate, danteContinua: a.dante_continua !== false });
          registrar(db, { origem: 'mcp', acao: 'rotina-criar', chat: c.jid, detalhe: `#${r.id} ${a.hora}` });
          return `Rotina #${r.id} criada para ${c.nome}.`;
        }
        if (!['pausar', 'retomar', 'apagar'].includes(a.acao)) throw new Error('Ação inválida.');
        registrar(db, { origem: 'mcp', acao: `rotina-${a.acao}`, detalhe: `#${a.id}` });
        if (a.acao === 'apagar') { apagarRotina(db, a.id); return `Rotina #${a.id} apagada.`; }
        alternarRotina(db, a.id, a.acao === 'retomar');
        return `Rotina #${a.id} ${a.acao === 'retomar' ? 'retomada' : 'pausada'}.`;
      });
    },
  },
];

export function chamar(nome, args, ctx) {
  const f = FERRAMENTAS.find((x) => x.name === nome);
  if (!f) throw new Error(`Ferramenta desconhecida: ${nome}`);
  return f.rodar(args || {}, ctx);
}
