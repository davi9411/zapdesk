import { DatabaseSync } from 'node:sqlite';
import { PATHS, garantirPastas } from '../config.mjs';

// nome de etiqueta sem emoji/número/acento, para comparar ("Pessoal🏠" == "pessoal")
export const normEtiqueta = (s) => String(s || '').normalize('NFD').replace(/[^a-zA-Z ]+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

export function abrirDb() {
  garantirPastas();
  const db = new DatabaseSync(PATHS.db);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      nome TEXT,
      grupo INTEGER DEFAULT 0,
      ultima_ts INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS msgs (
      chat TEXT NOT NULL,
      id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      meu INTEGER DEFAULT 0,
      de TEXT,
      tipo TEXT,            -- texto | audio | video | imagem | documento | figurinha | outro
      texto TEXT,           -- texto ou legenda
      arquivo TEXT,         -- caminho da midia baixada
      mime TEXT,
      dur INTEGER,          -- segundos (audio/video)
      transcricao TEXT,     -- preenchida pelo "preparar"
      frames TEXT,          -- pasta com frames do video
      PRIMARY KEY (chat, id)
    );
    CREATE INDEX IF NOT EXISTS ix_msgs_chat_ts ON msgs (chat, ts);
    -- Mensagem de ausência: 1 aviso por chat por período (ver src/ausencia.mjs).
    CREATE TABLE IF NOT EXISTS ausencia_enviada (
      chat TEXT NOT NULL,
      periodo TEXT NOT NULL,
      ts INTEGER NOT NULL,
      PRIMARY KEY (chat, periodo)
    );
    -- Fila de envio. Preenchida por "wa enviar" (comando explícito) e pela ausência configurada.
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat TEXT NOT NULL,
      nome TEXT,
      texto TEXT,
      arquivos TEXT,        -- JSON: lista de caminhos
      enviar_em INTEGER NOT NULL,
      criado INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',  -- pendente | enviando | enviada | falhou | atrasada | cancelada
      enviado_em INTEGER,
      erro TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_outbox_status ON outbox (status, enviar_em);
    -- Etiquetas do WhatsApp Business (sincronizadas pelo listener) e quem está em cada uma.
    CREATE TABLE IF NOT EXISTS etiquetas (id TEXT PRIMARY KEY, nome TEXT, cor INTEGER);
    CREATE TABLE IF NOT EXISTS etiqueta_chat (chat TEXT NOT NULL, etiqueta TEXT NOT NULL, PRIMARY KEY (chat, etiqueta));
    -- Ações no WhatsApp que não são mensagem (por enquanto: pôr/tirar etiqueta). Executadas pelo listener.
    CREATE TABLE IF NOT EXISTS acoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,   -- etiqueta+ | etiqueta-
      chat TEXT NOT NULL,
      valor TEXT,           -- nome da etiqueta
      criado INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',  -- pendente | feita | falhou
      erro TEXT
    );
  `);
  // contato salvo na agenda do celular (nome vindo da agenda, não só o nome do perfil)
  try { db.exec('ALTER TABLE chats ADD COLUMN salvo INTEGER DEFAULT 0'); } catch {}
  // mensagem que é resposta/reação a um status nosso (não é um atendimento)
  try { db.exec('ALTER TABLE msgs ADD COLUMN status_resp INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE msgs ADD COLUMN status_texto TEXT'); } catch {}
  return db;
}
