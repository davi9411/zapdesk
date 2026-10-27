// Diferenças entre Windows (PC atual) e Linux (servidor/Docker) num lugar só.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const WIN = process.platform === 'win32';

// O processo do PID ainda existe? (no Windows confere que é um node; no Linux, sinal 0)
export function processoVivo(pid) {
  if (!pid) return false;
  if (WIN) {
    try { return /node\.exe/i.test(execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })); } catch { return false; }
  }
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Python que roda tools/preparar.py: WA_PYTHON, senão "py -3" no Windows e "python3" no Linux
export function python() {
  if (process.env.WA_PYTHON) return [process.env.WA_PYTHON];
  return WIN ? ['py', '-3'] : ['python3'];
}

// Executável do Claude Code usado pelo agente
export function claudeExe() {
  if (process.env.WA_CLAUDE) return process.env.WA_CLAUDE;
  return WIN ? join(homedir(), '.local', 'bin', 'claude.exe') : 'claude';
}
