// Enquete do WhatsApp (substitui os botões, que só existem na API oficial).
// O voto chega cifrado em "pollUpdateMessage"; o Baileys 7 não decifra mais sozinho, então decifra aqui
// com o segredo guardado no envio da enquete.
import { createHash } from 'node:crypto';
import { decryptPollVote } from '@whiskeysockets/baileys';

// opções da escolha do primeiro contato (o número na frente permite responder só "1" ou "2")
export const OPCOES_ESCOLHA = ['1 - Seguir com o atendimento agora', '2 - Aguardar a equipe'];
export const PERGUNTA_ESCOLHA = 'Como prefere seguir?';
// avaliação no fim de um pré-atendimento que o agente resolveu sozinho (fase de testes)
export const OPCOES_NOTA = ['Nota 0', 'Nota 1', 'Nota 2', 'Nota 3', 'Nota 4', 'Nota 5'];
export const PEDIDO_NOTA = 'Pode avaliar este atendimento de 0 a 5? Se quiser, deixe também um comentário (opcional).';
export const notaDoVoto = (opcao) => { const m = String(opcao || '').match(/^Nota ([0-5])$/); return m ? Number(m[1]) : null; };

// Enquete numa mensagem só: cabeçalho, texto e aviso de IA vão na própria pergunta.
// O WhatsApp corta a pergunta da enquete por volta de 255 caracteres: se não couber, devolve null.
export const MAX_PERGUNTA = 255;
export const AVISO_CURTO = '(Agente de IA em desenvolvimento, pode cometer erros.)';
export function perguntaEnquete(nome, empresa, texto) {
  const p = `${nome} | Agente IA ${empresa}:\n${String(texto || '').trim()}\n\n${AVISO_CURTO}`;
  return p.length <= MAX_PERGUNTA ? p : null;
}
// texto da enquete do agente sem cabeçalho e aviso (para mostrar na conversa)
export function corpoEnquete(nome, empresa, pergunta) {
  return String(pergunta || '').replace(`${nome} | Agente IA ${empresa}:\n`, '').replace(`\n\n${AVISO_CURTO}`, '').trim();
}

const hash = (s) => createHash('sha256').update(Buffer.from(s)).digest().toString('hex');

// "1", "2", "opção 2", "1️⃣", "2." -> 'ia' | 'humano'; qualquer outra coisa -> null (o modelo interpreta)
export function escolhaPorNumero(texto) {
  const m = String(texto || '').trim().match(/^(?:op[çc][ãa]o\s*|n[ºo°]?\s*)?([12])(?:️?⃣)?\s*[.!)\-]?\s*$/i);
  return m ? (m[1] === '1' ? 'ia' : 'humano') : null;
}

// texto da opção votada ("1 - ...") -> 'ia' | 'humano'
export const escolhaPorVoto = (opcao) => escolhaPorNumero(String(opcao || '').split(' - ')[0]);

// hashes das opções votadas -> textos das opções
export function opcoesVotadas(hashes, opcoes) {
  const mapa = Object.fromEntries(opcoes.map((o) => [hash(o), o]));
  return (hashes || []).map((h) => mapa[Buffer.from(h).toString('hex')]).filter(Boolean);
}

// Decifra o voto. Os JIDs usados na cifra podem ser o número ou o LID (depende do aparelho): tenta as combinações.
export function decifrarVoto(voto, { idEnquete, segredo, criadores, eleitores }) {
  const pollEncKey = Buffer.from(segredo, 'base64');
  for (const pollCreatorJid of criadores.filter(Boolean)) {
    for (const voterJid of eleitores.filter(Boolean)) {
      try { return decryptPollVote(voto, { pollEncKey, pollCreatorJid, pollMsgId: idEnquete, voterJid }); } catch {}
    }
  }
  return null;
}
