// Limpeza de mídia: texto e transcrições ficam no banco; os arquivos de áudio, vídeo e foto vão embora.
// 1) apaga mídia com mais de "dias" dias;  2) se ainda passar de "maxBytes", apaga a mais antiga até
// voltar a "alvoBytes" (padrão: 75% do máximo).
import { readdirSync, statSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';

// arquivos: [{ caminho, mtimeMs, tamanho }] -> lista de caminhos a apagar (pura, testável)
export function escolherApagar(arquivos, { dias = 7, maxBytes = Infinity, alvoBytes, agora = Date.now() } = {}) {
  const limite = agora - dias * 86_400_000;
  const apagar = new Set(arquivos.filter((a) => a.mtimeMs < limite).map((a) => a.caminho));
  const restantes = arquivos.filter((a) => !apagar.has(a.caminho)).sort((a, b) => a.mtimeMs - b.mtimeMs);
  let total = restantes.reduce((s, a) => s + a.tamanho, 0);
  if (total > maxBytes) {
    const alvo = alvoBytes ?? maxBytes * 0.75;
    for (const a of restantes) {
      if (total <= alvo) break;
      apagar.add(a.caminho);
      total -= a.tamanho;
    }
  }
  return [...apagar];
}

export function listarMidia(pasta) {
  const out = [];
  const andar = (p) => {
    let itens = [];
    try { itens = readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const c = join(p, it.name);
      if (it.isDirectory()) andar(c);
      else { try { const st = statSync(c); out.push({ caminho: c, mtimeMs: st.mtimeMs, tamanho: st.size }); } catch {} }
    }
  };
  andar(pasta);
  return out;
}

// Executa a limpeza. simular=true só calcula. Retorna { apagados, bytes, restantes }.
export function limparMidia(db, pasta, opcoes = {}) {
  const arquivos = listarMidia(pasta);
  const alvo = new Set(escolherApagar(arquivos, opcoes));
  let bytes = 0;
  const limparRef = db.prepare('UPDATE msgs SET arquivo = NULL WHERE arquivo = ?');
  for (const a of arquivos) {
    if (!alvo.has(a.caminho)) continue;
    bytes += a.tamanho;
    if (opcoes.simular) continue;
    try { unlinkSync(a.caminho); limparRef.run(a.caminho); } catch {}
  }
  if (!opcoes.simular) {
    try { for (const d of readdirSync(pasta)) { try { rmdirSync(join(pasta, d)); } catch {} } } catch {} // pastas vazias
  }
  return { apagados: alvo.size, bytes, restantes: arquivos.length - alvo.size };
}
