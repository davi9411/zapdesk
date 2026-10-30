// Controles que o dono (painel) dá ao agente por conversa. Ficam no banco; o agente consulta a cada ciclo.
//  - assume: mensagens da equipe até esse instante são ignoradas ("Dante assume de volta" / "responder e deixar o Dante continuar")
//  - silencio: o agente não responde nem sugere nessa conversa (até o instante "ate", ou até reativar quando ate = 0)
//  - kv "pausado": o mesmo PAUSAR/RETOMAR do WhatsApp pessoal
export function criarTabelasControle(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agente_kv (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS agente_assume (chat TEXT PRIMARY KEY, ts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS agente_silencio (chat TEXT PRIMARY KEY, ate INTEGER NOT NULL DEFAULT 0, criado INTEGER NOT NULL);
  `);
}

const temTabela = (db, nome) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome);

// mensagens minhas com ts <= isto não contam como "equipe atendendo"
export function assumeTs(db, chat) {
  return temTabela(db, 'agente_assume') ? db.prepare('SELECT ts FROM agente_assume WHERE chat = ?').get(chat)?.ts || 0 : 0;
}

export function silenciada(db, chat, agora = Math.floor(Date.now() / 1000)) {
  if (!temTabela(db, 'agente_silencio')) return null;
  const s = db.prepare('SELECT ate FROM agente_silencio WHERE chat = ?').get(chat);
  if (!s) return null;
  if (s.ate && s.ate <= agora) return null; // venceu
  return { ate: s.ate || 0 };
}

export function assumirDeVolta(db, chat, ts = Math.floor(Date.now() / 1000)) {
  criarTabelasControle(db);
  db.prepare('INSERT INTO agente_assume (chat, ts) VALUES (?, ?) ON CONFLICT(chat) DO UPDATE SET ts = MAX(ts, excluded.ts)').run(chat, ts);
  return { ts };
}

export function silenciar(db, chat, ate = 0, agora = Math.floor(Date.now() / 1000)) {
  criarTabelasControle(db);
  db.prepare('INSERT INTO agente_silencio (chat, ate, criado) VALUES (?, ?, ?) ON CONFLICT(chat) DO UPDATE SET ate = excluded.ate, criado = excluded.criado').run(chat, ate, agora);
  return { ate };
}

export function reativar(db, chat) {
  criarTabelasControle(db);
  db.prepare('DELETE FROM agente_silencio WHERE chat = ?').run(chat);
}

// fecha à mão os casos abertos: um id, ou todos os de uma conversa. Não manda nada ao cliente.
export function fecharCasos(db, { id, chat }, agora = Math.floor(Date.now() / 1000)) {
  if (!temTabela(db, 'agente_caso')) return { fechados: 0 };
  const r = id != null
    ? db.prepare("UPDATE agente_caso SET status = 'descartado', fechado = ? WHERE id = ? AND status = 'aberto'").run(agora, Number(id))
    : db.prepare("UPDATE agente_caso SET status = 'descartado', fechado = ? WHERE chat = ? AND status = 'aberto'").run(agora, String(chat || ''));
  return { fechados: Number(r.changes) };
}

export function definirPausa(db, pausado) {
  criarTabelasControle(db);
  db.prepare('INSERT OR REPLACE INTO agente_kv VALUES (?, ?)').run('pausado', pausado ? '1' : '0');
  return { pausado: !!pausado };
}
