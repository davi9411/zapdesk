// Proteção contra prompt injection: o que vem do cliente é DADO, nunca instrução.
// 1) o texto do cliente não consegue imitar linhas da conversa (EQUIPE:, DANTE:) nem marcas nossas ([foto: ...]);
// 2) o modelo não lê arquivos sensíveis do PC, mesmo que alguém peça na conversa (regras de negação do claude -p).
import { join } from 'node:path';
import { homedir } from 'node:os';

// quebra de linha vira " ⏎ " (não dá para começar uma linha "[10:00] EQUIPE: ...") e marcas nossas viram parênteses
export function limparTextoCliente(s) {
  return String(s ?? '')
    .replace(/\r?\n+/g, ' ⏎ ')
    .replace(/\[(?=\s*(foto|arquivo|[áa]udio|v[íi]deo|figurinha|resposta ao nosso status)\b)/gi, '(')
    .replace(/<{3,}|>{3,}/g, '');
}

// caminho do Windows/Linux no formato das regras de permissão do claude: C:\x\y -> //c/x/y ; /srv/x -> //srv/x
export function permCaminho(p) {
  const s = p.replace(/\\/g, '/');
  const m = s.match(/^([A-Za-z]):(\/.*)$/);
  return m ? `//${m[1].toLowerCase()}${m[2]}` : `/${s}`;
}

// pastas e arquivos que o modelo nunca lê: sessão do WhatsApp, banco, configs e logs do Zapdesk,
// chaves e logins do usuário, dados dos navegadores e o Windows
export function caminhosNegados(dados) {
  const h = homedir();
  return [
    join(dados, 'auth', '**'), join(dados, '*.json'), join(dados, '*.json.*'), join(dados, 'wa.db*'), join(dados, '*.log'),
    join(dados, 'app', '**'), join(dados, 'agente', '**'),
    join(h, '.ssh', '**'), join(h, '.claude', '**'), join(h, '.claude.json'), join(h, '.aws', '**'), join(h, '.config', '**'),
    join(h, '.gitconfig'), join(h, '.git-credentials'), join(h, 'AppData', 'Local', 'Google', '**'),
    join(h, 'AppData', 'Local', 'Microsoft', '**'), join(h, 'AppData', 'Roaming', 'Microsoft', '**'),
    join(h, 'AppData', 'Roaming', 'Mozilla', '**'), join(h, 'AppData', 'Local', 'BraveSoftware', '**'),
    'C:\\Windows\\**',
  ].map((p) => `Read(${permCaminho(p)})`);
}
