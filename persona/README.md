# Persona do agente (Dante)

Esta pasta é o "pré-prompt" do agente de atendimento: **como ele pensa, as regras e as diretrizes**.
Edite aqui, em texto comum, sem mexer no código. Cada arquivo vira uma parte das instruções que o
agente recebe antes de responder a um cliente.

| Arquivo | O que define |
|---|---|
| [sobre.md](sobre.md) | O que a empresa faz e o conhecimento básico de suporte (instalação, robô que não opera, licença) |
| [regras.md](regras.md) | Regras absolutas: o que o agente **nunca** faz (preço, prazo, promessas, dados de acesso...) |
| [atendimento.md](atendimento.md) | Como conduzir cada tipo de conversa (pedido, bug, dúvida, propaganda, status, figurinha) |
| [acoes.md](acoes.md) | Quando responder, encaminhar, consultar ou ficar em silêncio, e como escrever para a equipe |
| [estilo.md](estilo.md) | Tom e tamanho das mensagens |
| [aprendidas.md](aprendidas.md) | Regras aprendidas no dia a dia (vindas de casos reais) |

## Como editar
- Escreva em português, em tópicos (`- ...`). Linha começando com `#` é o título da seção.
- `{nome}` vira o nome do agente e `{empresa}` o nome da empresa (definidos no `agente.json`).
- Texto entre `<!--` e `-->` é comentário para a equipe: o agente não vê.
- O agente relê os arquivos a cada atendimento: depois de publicar a mudança no computador do agente
  (`git pull` + `tools/instalar-servico.ps1 -SoAtualizar`), vale na próxima mensagem, sem reiniciar.

## Regras ensinadas pelo WhatsApp
O dono também ensina regras na hora, pelo WhatsApp pessoal (`REGRA: texto`, `REGRAS`, `REGRA- N`).
Elas ficam no computador do agente (`agente-regras.json`) e entram junto com [aprendidas.md](aprendidas.md).
As que se provarem boas devem ser copiadas para `aprendidas.md`, para ficarem registradas aqui.

## O que fica no código
Partes que dependem da situação (primeiro contato, cliente novo, evento, ficha do cliente, perfil,
pasta do robô, modo sugestão) continuam em [src/agente/prompts.mjs](../src/agente/prompts.mjs), assim como
a trava final de segurança ([src/agente/travas.mjs](../src/agente/travas.mjs)), que bloqueia preço e nomes
internos mesmo que o modelo erre.
