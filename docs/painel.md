# Painel local, MCP e rotinas

- **Painel:** `http://127.0.0.1:4747` (tarefa agendada `wa-painel`, instalada com `tools/instalar-painel.ps1`). Escuta só em 127.0.0.1.
- **MCP:** `claude mcp add --scope user zapdesk -- node --no-warnings <repo>\src\mcp\servidor.mjs`. Ferramentas `zapdesk_*`.
- **Rotinas:** criadas no painel (aba Rotinas) ou pelo MCP; o agente (`wa-agente`) dispara na hora e pula a ocorrência se ficou parado mais de 30 min.

## Segurança
- Só ouve em 127.0.0.1 e recusa nomes de host que não sejam locais (protege contra DNS rebinding).
- Leituras abrem o banco em modo somente leitura. As escritas (enviar, cancelar, controles do Dante, rotinas) exigem token que só a página servida pelo próprio processo recebe, origem local e JSON.
- Toda escrita fica registrada em `painel_auditoria` (origem painel ou mcp), visível na aba Dante.
- Trava de 20 envios em 10 minutos (painel e MCP somados).
- O painel só envia para conversas privadas, sempre com o cabeçalho do Davi.
- Nenhum dado de cliente fica no repositório (tudo em `C:\wa-leitor`).
