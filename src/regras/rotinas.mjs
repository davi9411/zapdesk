// Rotinas recorrentes: "toda segunda e quinta às 09:00 mande X para o cliente Y". O agente (que roda 24h)
// confere a cada ciclo e, na hora, coloca a mensagem na fila (outbox); o leitor envia como qualquer outra.
// Mensagem perdida (agente parado além da janela) não sai atrasada: a ocorrência é pulada.
import { montarTexto } from '../painel/envio.mjs';
import { assumirDeVolta } from '../agente/controle.mjs';

export const JANELA_MIN = 30;

export function criarTabelaRotinas(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS rotinas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, chat TEXT NOT NULL, nome TEXT, texto TEXT NOT NULL,
    dias TEXT NOT NULL,            -- "1,4" = segunda e quinta (0 = domingo)
    hora TEXT NOT NULL,            -- "09:00" (hora local)
    ate TEXT,                      -- "AAAA-MM-DD": última data em que vale (opcional)
    dante_continua INTEGER DEFAULT 1,
    ativa INTEGER DEFAULT 1, ultima_data TEXT, criado INTEGER NOT NULL
  )`);
}

const dataLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const NOMES_DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function validarRotina({ texto, dias, hora, ate }) {
  const t = String(texto || '').trim();
  if (!t) throw new Error('Escreva a mensagem da rotina.');
  if (t.length > 4000) throw new Error('Mensagem grande demais (máximo 4000 caracteres).');
  const lista = [...new Set((Array.isArray(dias) ? dias : String(dias || '').split(',')).map((x) => Number(String(x).trim())))]
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort();
  if (!lista.length) throw new Error('Escolha pelo menos um dia da semana.');
  const h = String(hora || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!h || +h[1] > 23 || +h[2] > 59) throw new Error('Hora inválida. Use HH:MM.');
  if (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate)) throw new Error('Data final inválida. Use AAAA-MM-DD.');
  return { texto: t, dias: lista.join(','), hora: `${String(+h[1]).padStart(2, '0')}:${h[2]}`, ate: ate || null };
}

// timestamp (s) do horário de hoje da rotina, se hoje é dia dela e ela vale hoje; senão null
export function horarioDeHoje(r, agora = new Date()) {
  if (!r.ativa) return null;
  const hoje = dataLocal(agora);
  if (r.ate && hoje > r.ate) return null;
  if (!r.dias.split(',').map(Number).includes(agora.getDay())) return null;
  const [h, m] = r.hora.split(':').map(Number);
  const t = new Date(agora); t.setHours(h, m, 0, 0);
  return Math.floor(t.getTime() / 1000);
}

// a rotina deve disparar agora? (já passou da hora, dentro da janela, ainda não disparou hoje e foi criada antes da hora)
export function devida(r, agora = new Date()) {
  const t = horarioDeHoje(r, agora);
  if (t == null) return null;
  const agoraS = Math.floor(agora.getTime() / 1000);
  if (r.ultima_data === dataLocal(agora)) return null;
  if (agoraS < t || agoraS - t > JANELA_MIN * 60) return null;
  if (r.criado >= t) return null; // criada depois do horário de hoje: começa na próxima ocorrência
  return t;
}

// próxima ocorrência (s) a partir de agora, para mostrar na tela
export function proximaOcorrencia(r, agora = new Date()) {
  if (!r.ativa) return null;
  for (let i = 0; i < 8; i++) {
    const dia = new Date(agora); dia.setDate(dia.getDate() + i);
    const t = horarioDeHoje({ ...r, ativa: 1 }, dia);
    if (t == null) continue;
    const jaDisparou = r.ultima_data === dataLocal(dia);
    if (t * 1000 > agora.getTime() && !jaDisparou && !(r.criado >= t)) return t;
  }
  return null;
}

// chamada pelo agente a cada ciclo: devolve quantas mensagens colocou na fila
export function gerarRotinas(db, agora = new Date()) {
  criarTabelaRotinas(db);
  let n = 0;
  for (const r of db.prepare('SELECT * FROM rotinas WHERE ativa = 1').all()) {
    const t = devida(r, agora);
    if (t == null) continue;
    const agoraS = Math.floor(agora.getTime() / 1000);
    db.prepare('UPDATE rotinas SET ultima_data = ? WHERE id = ?').run(dataLocal(agora), r.id);
    db.prepare('INSERT INTO outbox (chat, nome, texto, arquivos, enviar_em, criado) VALUES (?, ?, ?, NULL, ?, ?)')
      .run(r.chat, r.nome, montarTexto(r.texto), agoraS, agoraS);
    if (r.dante_continua) assumirDeVolta(db, r.chat, agoraS + 120);
    n++;
  }
  return n;
}

export function criarRotina(db, { jid, texto, dias, hora, ate, danteContinua = true, agora = Math.floor(Date.now() / 1000) }) {
  criarTabelaRotinas(db);
  const v = validarRotina({ texto, dias, hora, ate });
  const chat = db.prepare('SELECT jid, nome FROM chats WHERE jid = ?').get(jid);
  if (!chat) throw Object.assign(new Error('Conversa não encontrada.'), { codigo: 404 });
  if (/@g\.us$|broadcast$|@newsletter$/.test(chat.jid)) throw new Error('Rotinas só valem para conversas privadas.');
  const r = db.prepare('INSERT INTO rotinas (chat, nome, texto, dias, hora, ate, dante_continua, criado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(chat.jid, chat.nome, v.texto, v.dias, v.hora, v.ate, danteContinua ? 1 : 0, agora);
  return { id: Number(r.lastInsertRowid) };
}

export function alternarRotina(db, id, ativa) {
  criarTabelaRotinas(db);
  const r = db.prepare('UPDATE rotinas SET ativa = ? WHERE id = ?').run(ativa ? 1 : 0, Number(id));
  if (!r.changes) throw Object.assign(new Error('Rotina não encontrada.'), { codigo: 404 });
  return { id: Number(id), ativa: !!ativa };
}

export function apagarRotina(db, id) {
  criarTabelaRotinas(db);
  const r = db.prepare('DELETE FROM rotinas WHERE id = ?').run(Number(id));
  if (!r.changes) throw Object.assign(new Error('Rotina não encontrada.'), { codigo: 404 });
  return { id: Number(id) };
}

export function listarRotinas(db, agora = new Date()) {
  const existe = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rotinas'").get();
  if (!existe) return [];
  return db.prepare('SELECT * FROM rotinas ORDER BY ativa DESC, id').all().map((r) => ({
    ...r, dias_nomes: r.dias.split(',').map((d) => NOMES_DIAS[Number(d)]).join(', '), proxima: proximaOcorrencia(r, agora),
  }));
}
