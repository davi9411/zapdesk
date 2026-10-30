// Registro de tudo que o painel e o MCP fazem de escrita (quem, quando, o quê) e trava contra envio em massa.
export const MAX_ENVIOS_10MIN = 20;

export function criarTabelaAuditoria(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS painel_auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, origem TEXT NOT NULL, acao TEXT NOT NULL, chat TEXT, detalhe TEXT
  )`);
}

export function registrar(db, { origem = 'painel', acao, chat = null, detalhe = null, agora = Math.floor(Date.now() / 1000) }) {
  criarTabelaAuditoria(db);
  db.prepare('INSERT INTO painel_auditoria (ts, origem, acao, chat, detalhe) VALUES (?, ?, ?, ?, ?)').run(agora, origem, acao, chat, detalhe && String(detalhe).slice(0, 200));
}

// quantos envios foram pedidos nos últimos 10 min (painel + MCP somados)
export function enviosRecentes(db, agora = Math.floor(Date.now() / 1000)) {
  criarTabelaAuditoria(db);
  return db.prepare("SELECT COUNT(*) n FROM painel_auditoria WHERE acao = 'enviar' AND ts > ?").get(agora - 600).n;
}

export function ultimos(db, limite = 15) {
  const existe = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'painel_auditoria'").get();
  if (!existe) return [];
  return db.prepare('SELECT ts, origem, acao, chat, detalhe FROM painel_auditoria ORDER BY id DESC LIMIT ?').all(limite);
}
