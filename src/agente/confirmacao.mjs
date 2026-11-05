// Cliente que só CONFIRMA uma proposta comercial que a equipe acabou de mandar ("pode iniciar", "confirma", "fechado"):
// não há o que responder (o combinado já está feito) e nada a sugerir ao dono. O agente só avisa o dono, sem texto ao cliente.
const PROPOSTA = /R\$\s*\d|\bvalor\b|\bprazo\b|\bentrega\b|\bor[cç]amento\b/i;
const CONFIRMA = /\b(pode (iniciar|fazer|come[cç]ar|seguir|mandar|tocar)|confirm\w*|fechado|combinado|fechou|aceito|topo|vamos (l[aá]|nessa|em frente)|beleza|blz|ok|sim|isso mesmo|perfeito|certo)\b/i;

export function propostaConfirmada({ propostaTexto, mensagensCliente }) {
  if (!propostaTexto || !PROPOSTA.test(propostaTexto)) return false;
  const msgs = (mensagensCliente || []).map((t) => String(t || '').trim()).filter(Boolean);
  if (!msgs.length) return false;
  if (msgs.some((t) => t.includes('?') || t.split(/\s+/).length > 10)) return false; // pergunta ou texto longo: tem o que tratar
  return msgs.some((t) => CONFIRMA.test(t));
}
