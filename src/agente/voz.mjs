// Comando falado (áudio transcrito) do dono -> o mesmo texto que ele digitaria.
// "Hashtag seis, pede o print do Diário." -> "#6 pede o print do Diário."
// "Regra, nunca falar de prazo." -> "REGRA: nunca falar de prazo."   "Pausar." -> "PAUSAR"

const UNIDADES = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 };
const DEZENAS = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };

// "vinte e três" -> 23; "12" -> 12; null se não for número
export function numeroFalado(s) {
  const t = String(s || '').trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  const p = t.split(/\s+e\s+|\s+/);
  if (p.length === 1) return UNIDADES[p[0]] ?? DEZENAS[p[0]] ?? null;
  if (p.length === 2 && DEZENAS[p[0]] != null && UNIDADES[p[1]] != null && UNIDADES[p[1]] < 10) return DEZENAS[p[0]] + UNIDADES[p[1]];
  return null;
}

const PALAVRA_NUM = '(\\d+|(?:vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa)(?:\\s+e\\s+\\p{L}+)?|\\p{L}+)';
const CASO = new RegExp(`^\\s*(?:#|hashtag|hash tag|jogo da velha|cerquilha|caso|número|numero)\\s*${PALAVRA_NUM}[\\s,.:;!-]*`, 'iu');

export function comandoFalado(transcricao) {
  let t = String(transcricao || '').trim();
  const sem = t.replace(/[.!?,;:\s]+$/g, '');
  if (/^(pausar|pausa|retomar|retoma|status|regras|sim|não|nao|ok)$/i.test(sem)) {
    const w = sem.toUpperCase();
    return { PAUSA: 'PAUSAR', RETOMA: 'RETOMAR', NAO: 'NÃO' }[w] || w;
  }
  const mc = t.match(CASO);
  if (mc) {
    const n = numeroFalado(mc[1]);
    if (n != null) return `#${n} ${t.slice(mc[0].length).trim()}`.trim();
  }
  const mr = t.match(/^\s*regra\s*[,.:;\-–]\s*([\s\S]+)$/i) || t.match(/^\s*nova regra\s*[,.:;\-–]?\s*([\s\S]+)$/i);
  if (mr) return `REGRA: ${mr[1].trim()}`;
  return t;
}
