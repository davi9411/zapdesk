// "Responder em cima" de um aviso do agente: o WhatsApp manda junto o texto da mensagem citada.
// Se esse texto é um cartão de caso (*#25 · ...*) ou de tarefa (*T3 pronta*), o dono não precisa digitar o número:
//   citando o cartão, "ok" vira "#25 ok", "1" vira "#25 ok", "3" vira "#25 depois" e qualquer outro texto vira "#25 <texto>".
const COMANDOS_GERAIS = /^(pausar|retomar|status|regras)\b|^regra\s*[:\-–]|^regra\s*-\s*\d+$/i;

export function comCitacao(texto, citado) {
  const t = String(texto || '').trim();
  if (!t || !citado) return t;
  if (/^#\s*\d+/.test(t) || /^T\s*\d+\b/i.test(t) || COMANDOS_GERAIS.test(t)) return t; // já traz o número, ou é comando geral
  const c = String(citado);
  const caso = c.match(/\*#(\d+)\b/);
  if (caso) {
    const opcao = t.replace(/[.!\s]+$/, '');
    if (opcao === '1') return `#${caso[1]} ok`;
    if (opcao === '3') return `#${caso[1]} depois`;
    return `#${caso[1]} ${t}`;
  }
  const tarefa = c.match(/\*T(\d+)\b/);
  if (tarefa) return `T${tarefa[1]} ${t}`;
  return t;
}
