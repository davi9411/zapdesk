// Trava final do agente: mesmo que o modelo erre, a mensagem ao cliente não sai se citar preço,
// prazo, temas comerciais, bastidores de IA ou nomes internos da equipe. Vira "consultar".

const BASE = [
  'claude', 'anthropic', 'openai', 'chatgpt', '\\bgpt\\b',                    // bastidores de IA
  'R\\$\\s?\\d', '\\d+\\s?reais', '\\bpix\\b', '\\bdesconto',                    // preço e pagamento
  '\\bfica pronto em\\b', '\\b\\d+\\s?(dias?|semanas?|horas?)\\s?([úu]teis|para (ficar|entregar))', // prazo
  'produto d[ao]', 'parceri', '\\bs[óo]ci[oa]s?\\b', 'sociedade', 'royalt',  // temas comerciais
  'exclusividade', 'revend', 'direitos (autorais|de uso)', '\\bcomiss[ãa]o',
  'prompt', 'instru[çc][õo]es (do sistema|internas)', '[A-Za-z]:\\\\', 'wa-leitor', 'agente\\.json', // bastidores do agente
  'sk-[a-z]{2,}-', 'BEGIN [A-Z ]*PRIVATE KEY', '\\b[A-Za-z0-9_\\-+/]{40,}\\b',                  // chaves e tokens
];

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// nomesInternos: nomes da equipe que o cliente não deve ver (ex.: ["Davi"])
export function criarTrava(nomesInternos = []) {
  const extras = nomesInternos.filter(Boolean).map((n) => `\\b${escapar(n)}\\b`);
  return new RegExp(`(${[...BASE, ...extras].join('|')})`, 'i');
}
