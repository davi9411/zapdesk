// Envio pelo painel: só coloca na fila (outbox); quem manda de fato é o leitor, igual ao "wa enviar".
export const CABECALHO_DAVI = '> *Davi* | CEO e Desenvolvedor DS Trade\n\n';
export const MAX_TEXTO = 4000;

export class ErroEnvio extends Error {
  constructor(msg, codigo = 400) { super(msg); this.codigo = codigo; }
}

// cabeçalho do Davi na frente, sem repetir se o texto já começar com ele
export const montarTexto = (texto) => {
  const t = String(texto || '').trim();
  return t.startsWith('> *Davi*') ? t : CABECALHO_DAVI + t;
};

// em: timestamp unix (s) de um envio programado, ou vazio para enviar já
export function enfileirarEnvio(db, { jid, texto, em, agora = Math.floor(Date.now() / 1000), leitorVivo = true }) {
  const t = String(texto || '').trim();
  if (!t) throw new ErroEnvio('Escreva a mensagem.');
  if (t.length > MAX_TEXTO) throw new ErroEnvio(`Mensagem grande demais (máximo ${MAX_TEXTO} caracteres).`);
  const chat = db.prepare('SELECT jid, nome FROM chats WHERE jid = ?').get(jid);
  if (!chat) throw new ErroEnvio('Conversa não encontrada.', 404);
  if (/@g\.us$|broadcast$|@newsletter$/.test(chat.jid)) throw new ErroEnvio('O painel só envia para conversas privadas.');
  let quando = agora;
  if (em != null && em !== '') {
    quando = Number(em);
    if (!Number.isFinite(quando)) throw new ErroEnvio('Hora inválida.');
    if (quando <= agora + 10) throw new ErroEnvio('Essa hora já passou.');
  } else if (!leitorVivo) {
    throw new ErroEnvio('O leitor está desligado: ligue o leitor ou programe um horário.', 409);
  }
  const r = db.prepare('INSERT INTO outbox (chat, nome, texto, arquivos, enviar_em, criado) VALUES (?, ?, ?, NULL, ?, ?)')
    .run(chat.jid, chat.nome, montarTexto(t), quando, agora);
  return { id: Number(r.lastInsertRowid), enviar_em: quando, programada: quando > agora };
}

// cancela só o que ainda não saiu
export function cancelarEnvio(db, id) {
  const r = db.prepare("UPDATE outbox SET status = 'cancelada' WHERE id = ? AND status = 'pendente'").run(Number(id));
  if (!r.changes) throw new ErroEnvio('Essa mensagem já saiu ou não está na fila.', 409);
  return { id: Number(id) };
}
