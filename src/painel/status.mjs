// Status de cada conversa no painel: espelha as regras do agente (src/agente.mjs) sem importar o agente,
// que sobe um laço ao ser carregado. Função pura: recebe os fatos já lidos do banco e devolve o selo.

export const STATUS = {
  fora: { rotulo: 'Fora do Dante', detalhe: 'Etiqueta pessoal/outro robô, número excluído ou conta do dono' },
  pausado: { rotulo: 'Pausado', detalhe: 'O Dante está pausado (PAUSAR no WhatsApp pessoal)' },
  'aguardando-equipe': { rotulo: 'Aguardando equipe', detalhe: 'O cliente escolheu falar com uma pessoa; o Dante fica quieto por 3 dias' },
  equipe: { rotulo: 'Equipe atendendo', detalhe: 'Alguém da equipe escreveu; o Dante só sugere se o cliente ficar sem resposta' },
  'vai-responder': { rotulo: 'Dante vai responder', detalhe: 'Mensagem do cliente ainda não processada' },
  caso: { rotulo: 'Caso aberto', detalhe: 'O Dante coletou o caso e espera decisão da equipe' },
  'esperando-cliente': { rotulo: 'Esperando o cliente', detalhe: 'A última mensagem foi do Dante' },
  dante: { rotulo: 'Dante atendendo', detalhe: 'Conversa ativa com o Dante' },
  'sem-dante': { rotulo: 'Sem atendimento do Dante', detalhe: 'O Dante nunca atendeu esta conversa' },
};

const DIA = 86_400;

// cabeçalho que o agente põe em toda mensagem ao cliente
export const cabecalhoAgente = (cfg) => `*${cfg.nome} | Agente IA ${cfg.empresa}:*\n`;

// mensagem do agente (inclui a enquete da escolha, que o WhatsApp devolve como "enquete: ...")
export function ehDoAgente(cfg, texto) {
  const t = texto || '';
  const cab = cabecalhoAgente(cfg);
  return t.startsWith(cab) || t.includes(` — ${cab}`) || t.startsWith(`enquete: ${cfg.nome} | Agente IA`);
}

// mensagem minha que não é do agente nem o aviso automático = alguém da equipe escrevendo
export const ehHumano = (cfg, texto, avisos = []) => !ehDoAgente(cfg, texto) && !avisos.includes(texto);

// quem escreveu, para pintar a conversa
export function quemEscreveu(cfg, m, avisos = []) {
  if (!m.meu) return 'CLIENTE';
  if (ehDoAgente(cfg, m.texto)) return cfg.nome.toUpperCase();
  if (avisos.includes(m.texto)) return 'AVISO';
  return 'EQUIPE';
}

// f: { agora (s), pausado, fora, semEstado (o agente nunca tocou na conversa), escolhaHumanoTs, humanoTs, humanoHoras, casoAberto, pendente, ultimaDoAgente }
export function statusConversa(f) {
  const r = (codigo, ate) => ({ codigo, ...STATUS[codigo], ...(ate ? { ate } : {}) });
  if (f.fora) return r('fora');
  if (f.pausado) return r('pausado');
  if (f.escolhaHumanoTs && f.agora - f.escolhaHumanoTs < 3 * DIA) return r('aguardando-equipe', f.escolhaHumanoTs + 3 * DIA);
  const humanoAte = f.humanoTs ? f.humanoTs + (f.humanoHoras ?? 12) * 3600 : 0;
  if (humanoAte > f.agora) return r('equipe', humanoAte);
  if (f.pendente) return r('vai-responder');
  if (f.casoAberto) return r('caso');
  if (f.ultimaDoAgente) return r('esperando-cliente');
  return r(f.semEstado ? 'sem-dante' : 'dante');
}
