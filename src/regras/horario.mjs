// Horário de atendimento: está aberto agora? Se não, quando a equipe volta?
// cfg: { dias: [1..5] (0 = domingo), inicio: "09:00", fim: "18:00", feriados: ["2026-11-02", ...] }

// Feriados nacionais (as datas fixas e as móveis de 2026/2027). Dá para somar mais em "feriados".
export const FERIADOS_BR = [
  '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26', '2027-04-21', '2027-05-01', '2027-05-27',
  '2027-09-07', '2027-10-12', '2027-11-02', '2027-11-15', '2027-11-20', '2027-12-25',
];

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const minutos = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const dataISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function normalizar(cfg = {}) {
  return { dias: cfg.dias || [1, 2, 3, 4, 5], inicio: minutos(cfg.inicio || '09:00'), fim: minutos(cfg.fim || '18:00'),
    feriados: new Set([...FERIADOS_BR, ...(cfg.feriados || [])]), textoInicio: cfg.inicio || '09:00' };
}
const diaUtil = (h, d) => h.dias.includes(d.getDay()) && !h.feriados.has(dataISO(d));

export function aberto(cfg, agora = new Date()) {
  const h = normalizar(cfg);
  const m = agora.getHours() * 60 + agora.getMinutes();
  return diaUtil(h, agora) && m >= h.inicio && m < h.fim;
}

// Próxima abertura (Date) a partir de agora (se já está aberto, devolve agora).
export function proximaAbertura(cfg, agora = new Date()) {
  const h = normalizar(cfg);
  if (aberto(cfg, agora)) return agora;
  const d = new Date(agora);
  if (!(diaUtil(h, d) && agora.getHours() * 60 + agora.getMinutes() < h.inicio)) d.setDate(d.getDate() + 1);
  for (let i = 0; i < 30 && !diaUtil(h, d); i++) d.setDate(d.getDate() + 1);
  d.setHours(Math.floor(h.inicio / 60), h.inicio % 60, 0, 0);
  return d;
}

// "amanhã (quarta-feira, 28/10) às 09:00" / "hoje às 09:00" / "segunda-feira (02/11) às 09:00"
export function textoRetorno(cfg, agora = new Date()) {
  const p = proximaAbertura(cfg, agora);
  const hora = `${String(p.getHours()).padStart(2, '0')}:${String(p.getMinutes()).padStart(2, '0')}`;
  const ddmm = `${String(p.getDate()).padStart(2, '0')}/${String(p.getMonth() + 1).padStart(2, '0')}`;
  const amanha = new Date(agora); amanha.setDate(amanha.getDate() + 1);
  if (dataISO(p) === dataISO(agora)) return `hoje às ${hora}`;
  if (dataISO(p) === dataISO(amanha)) return `amanhã (${DIAS[p.getDay()]}, ${ddmm}) às ${hora}`;
  return `${DIAS[p.getDay()]} (${ddmm}) às ${hora}`;
}
