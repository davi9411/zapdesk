// Vigia do agente: o leitor (processo separado) confere o "sinal de vida" do agente (o arquivo agente.pid é regravado a cada ciclo)
// e avisa o dono no WhatsApp quando ele fica parado, e de novo quando volta. Um aviso por queda; lembrete a cada 60 min parado.
export const LIMITE_MIN = 12;       // ciclo longo (modelo + ficha) pode passar de 8 min sem ser queda
export const LEMBRETE_MIN = 60;

export const novoEstadoVigia = () => ({ avisadoEm: 0, caidoDesde: 0 });

// estado é alterado aqui; devolve {acao: 'caiu' | 'lembrete' | 'voltou', min} ou null
export function avaliarVigia(estado, { agoraMs, batidaMs, limiteMin = LIMITE_MIN }) {
  if (!batidaMs) return null;
  const min = Math.floor((agoraMs - batidaMs) / 60_000);
  if (min >= limiteMin) {
    if (!estado.avisadoEm) { estado.avisadoEm = agoraMs; estado.caidoDesde = batidaMs; return { acao: 'caiu', min }; }
    if (agoraMs - estado.avisadoEm >= LEMBRETE_MIN * 60_000) { estado.avisadoEm = agoraMs; return { acao: 'lembrete', min }; }
    return null;
  }
  if (estado.avisadoEm) {
    const fora = Math.floor((agoraMs - estado.caidoDesde) / 60_000);
    estado.avisadoEm = 0; estado.caidoDesde = 0;
    return { acao: 'voltou', min: fora };
  }
  return null;
}

export const textoVigia = (nome, { acao, min }) => acao === 'voltou'
  ? `✅ ${nome} voltou a responder (ficou ~${min} min sem dar sinal). Ele retoma o que ficou pendente.`
  : `🚨 ${nome} está parado há ~${min} min: não responde clientes nem manda avisos. ${acao === 'lembrete' ? 'Continua parado. ' : ''}A tarefa wa-agente tenta religar sozinha a cada 5 min; se não voltar, reinicie o agente no PC.`;
