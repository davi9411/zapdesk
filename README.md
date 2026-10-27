# Zapdesk

[![testes](https://github.com/davi9411/zapdesk/actions/workflows/testes.yml/badge.svg)](https://github.com/davi9411/zapdesk/actions/workflows/testes.yml)

Central de atendimento de WhatsApp que roda **no seu computador**: guarda as conversas num SQLite,
transcreve áudios e vídeos sob demanda, envia e programa mensagens, organiza contatos por etiqueta e
tem um **agente de IA de atendimento** que acolhe o cliente, coleta o caso e passa ao dono tudo que
for decisão humana, com uma sugestão de resposta pronta para aprovar.

Nasceu para o atendimento de uma pequena empresa de robôs para MetaTrader e é operado tanto pelo
dono (pelo WhatsApp pessoal) quanto por um assistente de IA (Claude Code) pela linha de comando.

> Aviso: usa a biblioteca não oficial [Baileys](https://github.com/WhiskeySockets/Baileys), que
> conecta como "dispositivo vinculado". Isso vai contra os termos do WhatsApp e há risco de bloqueio
> do número. Use por sua conta e risco.

## O que faz
- **Leitor 24h**: sobe com o Windows (antes do login), grava mensagens e mídia, reconecta sozinho.
- **Transcrição e frames sob demanda** (faster-whisper + ffmpeg), nunca em segundo plano.
- **Envio e envio programado** pela CLI ("manda o arquivo às 16:30"), sempre por comando explícito.
- **Aviso de ausência por período**: uma mensagem por contato, com lista de exclusão e limite por hora.
- **Etiquetas do WhatsApp Business**: sincroniza, lista, põe e tira; contatos "pessoais" ficam fora
  das automações e contatos novos fora da agenda viram lead automaticamente.
- **Agente de atendimento** (detalhes abaixo).

## Agente de atendimento
O agente responde no WhatsApp da empresa com um cabeçalho próprio (`*Nome | Agente IA Empresa:*`) e
segue regras rígidas:

| Pode | Não pode (vira caso para o dono) |
|---|---|
| Cumprimentar, perguntar nome e como conheceu | Preço, prazo, desconto, pagamento |
| Entender o pedido e coletar dados de bug (print, versão, corretora...) | Prometer entrega, correção ou data |
| Tirar dúvidas simples de instalação e uso | Enviar arquivos, código ou licenças |
| Pedir desculpas pela demora ao voltar de uma queda | Temas comerciais (parceria, revenda, "virar produto") |

Fluxo:
```
cliente escreve ──► agente responde (coleta) ──► caso claro ou decisão humana?
                                                   │
                     WhatsApp pessoal do dono ◄────┘  resumo curto + sugestão + 3 opções
                     #N ok        → envia a sugestão
                     #N orientação→ agente redige a partir da orientação
                     #N depois    → avisa que a equipe responde em breve
```
- **Um caso por cliente**: informação nova atualiza o mesmo número.
- **Dono na conversa**: se a equipe escreveu nas últimas horas, o agente não responde sozinho; se o
  cliente ficar sem resposta, avisa o dono com uma sugestão. O caso fecha sozinho quando a equipe responde.
- **Texto livre do dono**: "manda pro Fulano que..." ou "marca a Fulana como pessoal"; envios pedem
  confirmação (SIM/NÃO) antes de sair.
- **Lembretes** de casos parados, **resumo diário** às 20h, comandos `STATUS`, `PAUSAR`, `RETOMAR`.
- **Retomada**: se o PC ou o modelo ficarem fora do ar, ao voltar responde o que ficou pendente.
- **Trava final** ([`src/agente/travas.mjs`](src/agente/travas.mjs)): mesmo que o modelo erre, a
  mensagem não sai se citar preço, prazo, temas comerciais, bastidores de IA ou nomes internos.
- **Modo evento**: em datas configuradas, o aviso de ausência sai antes e o agente se apresenta
  dizendo quando a equipe volta.

O modelo é chamado pelo `claude -p` do Claude Code (assinatura, não API), uma chamada por resposta,
com o prompt em [`src/agente/prompts.mjs`](src/agente/prompts.mjs).

## Arquitetura
```
 celular ⇄ WhatsApp ⇄ listener.mjs  (tarefa agendada, sobe com o Windows)
                         │ grava mensagens, mídia, etiquetas   ▲ envia "outbox", aplica "acoes"
                         ▼                                      │
                  wa.db (SQLite) ◄──────── cli.mjs ◄── dono / assistente de IA
                         ▲   ▲
                         │   └──── agente.mjs (sessão logada) ⇄ claude -p
                         └──────── tools/preparar.py (Whisper + ffmpeg, sob demanda)
```
Os processos só conversam pelo banco: o agente nunca fala com o WhatsApp diretamente, ele escreve na
fila `outbox` (mensagens) ou `acoes` (etiquetas) e o listener executa.

| Arquivo | Papel |
|---|---|
| `src/listener.mjs` | conexão, gravação, fila de envio, etiquetas, aviso de ausência |
| `src/agente.mjs` | ciclo do agente: clientes, casos, comandos do dono, lembretes |
| `src/agente/prompts.mjs` | instruções do modelo (atendimento, sugestão, comando do dono) |
| `src/agente/travas.mjs` | bloqueio final de termos proibidos |
| `src/ausencia.mjs` | regras do aviso de ausência |
| `src/cli.mjs` | comandos `wa ...` |
| `tools/instalar-servico.ps1` | tarefas agendadas `wa-leitor` e `wa-agente` |

## Stack
- Node.js ≥ 22.5 (`node:sqlite` nativo, sem compilação) · Baileys 7 · pino
- Python 3 + faster-whisper e ffmpeg (só para `preparar`)
- Claude Code (`claude -p`) para o agente

## Instalação
```
npm install
wa parear 55DDDNUMERO          # código de 8 dígitos; no celular: Dispositivos conectados > Conectar com número
.\tools\instalar-servico.ps1    # PowerShell como administrador, uma vez
```
- `wa-leitor`: sobe ~1 min após o boot, **antes do login** (LogonType S4U, sem guardar senha) e
  reinicia sozinha se cair. Roda uma cópia do programa em `<dados>\app`; depois de mudar o código:
  `.\tools\instalar-servico.ps1 -SoAtualizar`.
- `wa-agente`: roda na sessão logada (precisa do login do Claude Code), conferida a cada 5 min.

Configuração do agente em `<dados>\agente.json` e do aviso em `<dados>\ausencia.json` (exemplos nos
comentários de [`src/agente.mjs`](src/agente.mjs) e [`src/ausencia.mjs`](src/ausencia.mjs)).
Variáveis opcionais em [`.env.example`](.env.example).

## Uso pela linha de comando
```
wa status                         # ligado/desligado + contagens
wa chats [filtro]                 # conversas recentes
wa ler <nome> --horas 24          # texto + transcrições + caminhos de fotos/vídeos/frames
wa preparar <nome> --horas 24     # transcreve áudios/vídeos e extrai frames
wa enviar <nome> --texto "Olá"    # envio imediato
wa enviar <nome> --texto "Segue" --arquivo "C:\...\arquivo.zip" --em 16:30   # programado
wa fila | wa cancelar <id>        # fila de envio
wa ausencia                       # período, texto e quem já recebeu o aviso
wa etiquetas                      # etiquetas e quem está em cada uma
wa etiqueta <nome> <etiqueta> [--tirar]
```

## Testes
```
npm test
```
Rodam a cada push no GitHub Actions (regras do aviso de ausência, travas do agente, prompts e etiquetas).

## Dados e privacidade
- Pasta de dados fora do repositório (`C:\wa-leitor` no modo serviço, senão `%LOCALAPPDATA%\wa-leitor`):
  `auth/` (credenciais = chave da conta), `midia/`, `wa.db`, logs.
- Quem copiar `auth/` lê as conversas: nunca versionar nem sincronizar essa pasta.
- Desconectar pelo celular (Dispositivos conectados) corta o acesso na hora.
- Conversas só saem da máquina para o próprio WhatsApp e, no caso do agente, para o modelo de IA.

## Roteiro
Acompanhe pelos [milestones](https://github.com/davi9411/zapdesk/milestones): base do projeto,
servidor próprio 24h (Linux + Docker), migração, acesso remoto, regras, chatbot e postagem multicanal.

## Licença
MIT, ver [LICENSE](LICENSE).
