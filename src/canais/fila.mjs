// Regras puras da fila de envio ("outbox"): o que fazer com cada item e como montar as mensagens.

export const MIME = { pdf: 'application/pdf', zip: 'application/zip', ex5: 'application/octet-stream', mq5: 'text/plain', set: 'text/plain', txt: 'text/plain', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4', ogg: 'audio/ogg', mp3: 'audio/mpeg' };

// Envio programado vencido há mais que o limite NÃO sai (o leitor estava desligado no horário).
export function avaliarItem(it, agora, atrasoMaxS) {
  if (agora - it.enviar_em > atrasoMaxS) return { acao: 'atrasada', erro: `venceu há ${Math.round((agora - it.enviar_em) / 60)} min com o leitor desligado` };
  return { acao: 'enviar' };
}

function midia(f, legenda) {
  const ext = f.split('.').pop().toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const nome = f.split(/[\\/]/).pop();
  const caption = legenda || undefined;
  if (mime.startsWith('image/')) return { image: { url: f }, caption };
  if (mime.startsWith('video/')) return { video: { url: f }, caption };
  return { document: { url: f }, fileName: nome, mimetype: mime, caption };
}

// Lista de conteúdos para sock.sendMessage, na ordem.
// Um arquivo: vai com o texto como legenda. Vários: texto primeiro, depois um arquivo por mensagem.
export function planoEnvio(it) {
  const arquivos = it.arquivos ? JSON.parse(it.arquivos) : [];
  const texto = it.texto || '';
  if (arquivos.length === 1 && !it.enquete) return [midia(arquivos[0], texto)];
  const plano = texto ? [{ text: texto }] : [];
  for (const f of arquivos) plano.push(midia(f));
  // enquete (no lugar de botões): vai depois do texto, uma opção por voto
  if (it.enquete) { const q = JSON.parse(it.enquete); plano.push({ poll: { name: q.nome, values: q.opcoes, selectableCount: 1 } }); }
  return plano;
}
