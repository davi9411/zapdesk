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
- **Horário de atendimento**: fora dele (fim de semana e feriados nacionais incluídos) o agente avisa
  quando a equipe volta, com data e hora ("terça-feira (03/11) às 09:00").
- **Colega, não repetidor**: antes de mandar a orientação do dono ao cliente, o agente avalia; se ela
  estiver ambígua, contradizer a conversa ou parecer errada, ele responde com a ressalva e uma proposta
  de texto, e os dois chegam a um consenso. Perguntas do dono sobre o caso são respondidas só a ele.
- **Responde por áudio**: o dono pode mandar áudio ("hashtag seis, pede o print do Diário"); o agente
  transcreve, mostra o que entendeu e executa.
- **Regras ensinadas**: `REGRA: ...` no WhatsApp do dono vira regra permanente do atendimento.
- **Aviso em todas as mensagens** de que é um agente de IA em desenvolvimento e pode errar.
- **Vigia e sinal de vida**: religa o leitor se ele cair e pinga um serviço de monitoramento
  (Healthchecks.io) para avisar por e-mail se a máquina parar.

O modelo é chamado pelo `claude -p` do Claude Code (assinatura, não API), uma chamada por resposta,
com o prompt montado em [`src/agente/prompts.mjs`](src/agente/prompts.mjs).

**Como o agente pensa fica na pasta [`persona/`](persona/)**: regras absolutas, diretrizes de atendimento,
ações, estilo e regras aprendidas, em Markdown editável (sem mexer no código). O agente relê os arquivos
a cada atendimento.

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

| Caminho | Papel |
|---|---|
| `src/listener.mjs` | processo do leitor: conexão, gravação, fila de envio, etiquetas, aviso de ausência |
| `src/agente.mjs` | processo do agente: clientes, casos, comandos do dono, lembretes |
| `src/cli.mjs` | comandos `wa ...` |
| `src/conector/` | formato das mensagens do WhatsApp (tipo, texto, LID → número, extensão) |
| `src/armazenamento/` | banco SQLite (tabelas e migrações) |
| `src/regras/` | aviso de ausência, horário de atendimento, limpeza de mídia e horários ("16:30") |
| `src/canais/` | regras da fila de envio (atraso máximo, montagem das mensagens) |
| `src/notificador/` | aviso de caso para o dono (resumo, sugestão, 3 opções) |
| `src/agente/` | prompts do modelo, trava final de termos proibidos e comandos falados |
| `src/sistema.mjs` | diferenças entre Windows e Linux (processo vivo, Python, Claude Code) |
| `tools/instalar-servico.ps1` | tarefas agendadas `wa-leitor` e `wa-agente` |

Os três processos ficam na raiz de `src/` e só orquestram; a lógica testável fica nas pastas.

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

### Em servidor (Linux + Docker)
`docker compose up -d` com a imagem `ghcr.io/davi9411/zapdesk` (publicada pelo CI a cada push na
`main`), leitor e agente no mesmo volume e limpeza automática de mídia. Passo a passo da migração do
PC em [`docs/migracao.md`](docs/migracao.md).

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
wa limpar --dias 7 [--max-gb 8] [--simular]   # apaga mídia antiga (texto e transcrições ficam)
```

## Testes
```
npm test
```
Rodam a cada push no GitHub Actions: aviso de ausência, travas e prompts do agente, etiquetas, formato das mensagens, fila de envio, horários e aviso de caso.

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

## Teste de estresse do agente

`node tools/estresse/estresse.mjs` simula clientes (22 cenários em 3 níveis, 5 estilos de persona) conversando com o
agente, sem WhatsApp, e um painel de juízes (regras, veracidade de MT5, português e tom, tamanho, delírio, fluxo) mais um
juiz maior avalia cada conversa. Use `--estilo`, `--nivel`, `--cenarios` e `--refazer <pasta>` (só os reprovados).
Resultado em `<dados>/estresse/`.
