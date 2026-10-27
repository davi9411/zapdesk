// Caminhos e limites. Dados sensíveis (sessão, mídia, banco) ficam FORA do
// OneDrive e do git: %LOCALAPPDATA%\wa-leitor (ou WA_DATA).
import { join } from 'node:path';
import { mkdirSync, statSync, existsSync } from 'node:fs';
import { homedir, uptime } from 'node:os';

// C:\wa-leitor é a pasta do serviço que sobe com o Windows (a tarefa roda antes do login e não
// enxerga o perfil do usuário). Se ela existir com uma sessão pareada, todos usam ela.
const PASTA_SERVICO = 'C:\\wa-leitor';
export const DATA_DIR = process.env.WA_DATA
  || (process.platform === 'win32' && existsSync(join(PASTA_SERVICO, 'auth', 'creds.json')) ? PASTA_SERVICO : null)
  || (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'wa-leitor')
    : join(homedir(), '.local', 'share', 'zapdesk')); // Linux fora do Docker (no Docker: WA_DATA=/data)

export const PATHS = {
  data: DATA_DIR,
  auth: join(DATA_DIR, 'auth'),     // credenciais = chave da conta. NUNCA copiar/sincronizar
  midia: join(DATA_DIR, 'midia'),
  db: join(DATA_DIR, 'wa.db'),
  pid: join(DATA_DIR, 'wa.pid'),
  log: join(DATA_DIR, 'wa.log'),
};

// Mídia maior que isso não é baixada (só registrada). Padrão 60 MB.
export const MAX_MIDIA_MB = Number(process.env.WA_MAX_MIDIA_MB || 60);

// O wa.pid foi gravado antes do último boot? Então é lixo de uma sessão anterior do Windows
// (o PID pode ter sido reaproveitado por outro node que não é o leitor).
export function pidDeOutroBoot() {
  try { return statSync(PATHS.pid).mtimeMs < Date.now() - uptime() * 1000; } catch { return true; }
}

export function garantirPastas() {
  for (const p of [PATHS.data, PATHS.auth, PATHS.midia]) mkdirSync(p, { recursive: true });
}
