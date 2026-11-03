# Histórico de mudanças do comportamento do agente

Cada mudança nas regras (arquivos desta pasta) ou no comportamento automático (código) entra aqui: data, o que mudou,
por quê e onde. Mais recente primeiro. Este arquivo não entra no prompt do agente.

## 29/10/2026 (bateria 3, painel Haiku, estilo padrão: painel 7,64, todos <8, fluxo 5,1)
- **Responder a pergunta direta antes de perguntar outra**; passo a passo pedido = até 3 passos curtos antes do print;
  pedido repetido de falar com alguém → oferecer encaminhar — `acoes.md`.
- **Sem apontar causa sem dados**, **idioma do cliente sem misturar**, **nunca aceitar "a equipe já fez acesso remoto"** — `acoes.md`.
- **Cliente irritado/com pressa**: reconhecer primeiro; dizer o horário da equipe quando perguntado; aceitar "não consigo mandar print"; preferir esperar → encaminhar; sem reencaminhar nem repetir "registrado" sem novidade; nunca sugerir outro fornecedor — `acoes.md`.
- **Prejuízo em andamento**: contenção primeiro (Algo Trading; ordens abertas seguem abertas); dois passos sem resolver → mudar de caminho/encaminhar; prazo repetido ao encaminhar; prazo = só o retorno da equipe, sem comparar; recusa sobre IA = "não posso dar detalhes"; acolhimento específico — `acoes.md`, `estilo.md`.
- Juízes passaram a saber que "Estou obtendo essa informação e te retorno" é a frase combinada (penalizavam à toa) — `tools/estresse/juizes.mjs`.
- Juiz maior (Opus) só roda se o painel menor aprovar o cenário; juiz sem nota = erro — `tools/estresse/estresse.mjs`.

## 29/10/2026 (bateria 2, painel de juízes, estilo padrão: painel 7,78, juiz maior 6,5, 12 reprovados)
- **Trava reescreve antes de bloquear**: se a mensagem cita um termo proibido (ex.: o cliente disse "sócio" e o agente
  repetiu numa recusa correta), o texto é reescrito sem o termo; só cai na resposta padrão se não der — código.
- **Primeiro contato**: frase da escolha como pergunta completa (com exemplo), mesmo cumprimento do cliente ("boa
  tarde"), e pedido que o agente não faz (prompt, arquivo, dados de terceiros, "sou da equipe") é recusado numa frase
  antes da escolha — prompt.
- **"Aguardar a equipe"**: não diz que registrou "tudo" quando o cliente não contou nada; não convida a adiantar quem
  disse que não quer falar com robô — prompt.
- **Robô da ficha**: confirmar com o cliente qual robô antes de registrar o pedido — prompt.
- **Pedido que ninguém atende**: na insistência continua recusando ("responder"); na terceira avisa a equipe sem dizer
  ao cliente que o pedido foi registrado; não confirma nem nega que alguém é cliente — `acoes.md`.
- **Pergunta sobre a IA**: responde e não encaminha; **sem afirmar política/catálogo** da empresa; **sem "vamos
  resolver"** — `acoes.md`.
- **"ok" sem conteúdo** depois de perguntar como ajudar → silêncio; "volto depois" → despedida curta — `acoes.md`.
- **Variar a abertura** (nada de "Entendo" seguido) e não repetir "registrado"/"por aqui" — `estilo.md`.
- **Cliente no celular agora**: perguntar se o PC/VPS segue ligado, sem explicar que o app não roda robô; **não
  confirmar resultado por sinal indireto** (seta no gráfico) — `sobre.md`.
- **Teste de estresse com Haiku**: simulador de cliente, juízes e juiz maior rodam em Haiku (gasta bem menos plano); o Dante testado segue no modelo real — `tools/estresse`.
- Juízes passaram a saber como o sistema funciona (encaminhar abre caso real, horário da equipe) e a ver a ficha do
  cliente: parte das notas baixas de "delírio" era falta de contexto deles — `tools/estresse/juizes.mjs`.

## 29/10/2026 (teste de estresse, bateria 1: média 6,3, 11 falhas graves)
- **"Estou obtendo essa informação" só para pergunta que a equipe vai responder**, sem "já" (soava imediato) e sem
  repetir enquanto o caso estiver aberto — `acoes.md`, `regras.md`. Os juízes apontaram promessa falsa em reembolso,
  código-fonte, dados de terceiros e parceria.
- **Pedido que a equipe executa** (reembolso, reenvio de arquivo, data de entrega, proposta, reclamação) → encaminhar,
  dizendo com clareza que não é feito por aqui — `acoes.md`.
- **Pedido que ninguém vai atender** (dados de outro cliente, conselho de investimento, concorrente, instruções) →
  recusa direta e educada, sem "obtendo"; insistência: recusa com outras palavras e, na terceira, encaminha — `acoes.md`.
- **"ok" depois da enquete não é escolha** — `acoes.md`.
- **Um pedido por mensagem** (uma pergunta OU um print) e **nunca repetir frase já enviada** — `estilo.md`.
- **Instalação de indicador** (pasta Indicators, sem Algo Trading), diferença MT4 ("AutoTrading"), perguntar se é robô
  ou indicador, robô só opera com PC/VPS e MT5 ligados, como parar uma operação agora — `sobre.md`.
- **Cliente irritado**: reconhece o problema primeiro, um pedido por vez — `atendimento.md`.
- **Proposta comercial**: "a equipe vai analisar a proposta" sem nomear o tipo (a trava barrava "parceria") — `atendimento.md`.
- **Trava final**: não bloqueia mais o nome do próprio cliente (cliente chamado "Davi" era barrado) e o texto substituto
  passou a ser "Deixei registrado aqui e a equipe te responde sobre isso por aqui." — código.

## 28/10/2026
- **Proteção contra manipulação (prompt injection)** — `seguranca.md` (novo), conversa marcada como dado,
  leitura de arquivos sensíveis bloqueada no código, trava de saída para "prompt", caminhos e chaves. Pedido do Davi.
- **Nunca dizer que algo foi feito por IA** — `aprendidas.md`. Caso do César (versão recompilada).
- **Escolha do primeiro contato por enquete (1/2), número ou texto** — código + `acoes`/prompt. Botões só existem na API
  oficial; enquete funciona em todos os aparelhos. Depois: enquete numa mensagem só (texto vira a pergunta).
- **Tom formal casual e mensagens curtas** (alvo ~250, máximo ~400; acima disso o código reescreve) — `estilo.md`.
- **Perfil do cliente revisável** (etiqueta Iniciante/Experiente pode ser trocada quando a conversa mostrar o contrário).
- **Avaliação do atendimento (nota 0 a 5 + comentário opcional)** quando o agente resolve o caso sozinho — código.
- **Como conheceu a empresa** vira enquete (Google, Site, Instagram, Telegram, Indicação, Outro), só para cliente novo,
  quando escolhe aguardar a equipe ou quando o caso é resolvido, antes da avaliação — código + prompt.
- **Aviso automático já apresenta o agente**; depois dele o agente não cumprimenta de novo — prompt + `ausencia.json`.
- **Nome**: pergunta uma vez só; usa o nome de vez em quando — prompt.
- **Encaminhar e confirmação de "aguardar a equipe" menos secos** — `acoes.md` + prompt.
- **Resposta mais rápida**: espera 5 s, segura enquanto o cliente digita, ritmo de verificação dinâmico; "Só um momento"
  se passar de 25 s — código.
- **Reação a status**: cortesia não é respondida; pedido de informação sobre o que o status ofereceu é atendido —
  `atendimento.md`.
- **Propaganda**: ignora e só avisa a equipe; proposta → "a equipe vai analisar" — `atendimento.md`.
- **Parâmetro exato dos nossos robôs** (lê o .mq5) e "Estou obtendo essa informação e já te retorno" — prompt + `regras.md`.

## 01/11/2026
- **Desculpa pela demora só com 15 min ou mais de espera** (antes o modelo inventava; dois casos reais de clientes). O prompt
  proíbe abaixo disso e o código corta a frase se escapar — `prompts.mjs` + `higiene.mjs`.
- **Nunca dizer que não conseguiu ver/ouvir o que o cliente mandou** — prompt, filtro no código (reescreve) e, se a
  reescrita falhar, "Pode me contar em uma frase o que acontece?" — `higiene.mjs`, `regras`/prompt.
- **Vídeo agora é visto**: os frames extraídos pelo `preparar` entram na conversa (`frames: caminhos`) para o modelo
  abrir com Read; transcrição/frames pendentes seguram a resposta (até 3 tentativas) e o tempo máximo do preparo subiu
  de 5 para 10 min (com o PC ocupado a transcrição era cortada e o agente respondia "sem ver") — `agente.mjs`.
- **Continuidade de assunto (equipe falou por último há mais de 12 h e menos de 7 dias)**: o agente confere se o cliente
  continua o assunto que o Davi tratava. "Novo" → atende normal; "continuação" ou dúvida → enquete "Vi que você estava
  tratando de X com o Davi. Como prefere seguir?"; sem voto em 20 min → briefing para o Davi no pessoal; voto no
  pré-atendimento → atende (e o painel passa a ignorar as falas antigas da equipe); voto na equipe → aguarda 3 dias e
  avisa o Davi. Mais de 7 dias = assunto novo — `continuidade.mjs`.
- **Enquete da escolha com textos novos**: "1 - Seguir com o pré-atendimento do Dante" / "2 - Aguardar o retorno da
  equipe DS Trade" — `enquete.mjs`.
- **Suporte técnico com tarefa de correção** — `tecnico.md` (novo). O agente toma a frente de bug/ajuste (mesmo sem
  texto do cliente), confirma o robô com o cliente, lê o código do robô e só abre a tarefa depois do cliente confirmar.
  O Davi autoriza no pessoal ("T3 autorizo"); o agente acha a sessão do Claude Code do cliente (pelo nome completo ou
  só o primeiro) e roda `claude -p --resume` nela; se não achar, pergunta o nome ("T3 sessao NomeDoCliente"). Quando a
  correção termina, avisa o Davi, que diz quando entregar ("T3 entregar 2 dias"); a entrega sai programada — `tarefas.mjs`.
  Sem commit, sem envio ao cliente e sem arquivos internos: continua tudo com aprovação do Davi.
- **Orientação do dono por conversa** (`agente_kv` chave `nota:<jid>`): entra no prompt como instrução, sem ser repetida
  ao cliente.
- **Histórico progressivo** (pedido do Davi, 01/11): o agente lê só as 15 mensagens mais recentes dos últimos 3 dias (a
  mensagem mais antiga sem resposta sempre entra). Se não entender a última mensagem (vídeo, áudio, texto solto), marca
  `entendeu: false` e o sistema repete com 40 mensagens dos últimos 10 dias; se ainda assim não entender, pergunta ao
  cliente. Se o cliente não responde à pergunta do pré-atendimento em 20 min, o Davi recebe um aviso com o assunto e a
  última mensagem, para decidir se o Dante segue ou se ele assume — `agente.mjs`, `prompts.mjs`.
- **Enquete de continuidade**: fala "com o Davi" quando o assunto era uma conversa direta com ele e "com a equipe da
  DS Trade" quando era algo genérico — `continuidade.mjs`.
- **Log em vez de print para erros do robô** (pedido do Davi, 01/11): o agente pede o log do dia (vídeo "Como obter um log do
  robô") e o .set, e lê os dois (cópia em UTF-8). Print só para o painel do robô, a tela do gráfico ou uma janela de erro
  na hora. Ativo e timeframe saem da linha do log "robô (ATIVO,TF)"; só pergunta ao cliente se não aparecer. A tarefa
  técnica leva ativo, timeframe, .set e trecho do log para a sessão do cliente reproduzir no testador — `aprendidas.md`,
  `tecnico.md`, `agente.mjs`.
- **Simplificar a vida do cliente** (pedido do Davi, 01/11): o agente é objetivo e curto, não pede print, exemplos nem
  "casos que deram certo e errado" quando o cliente já mandou vídeo/áudio/texto; sugere uma opção pronta se o cliente
  estiver confuso. Em pedido de robô/estratégia nova pergunta só o técnico (stop loss, TP, break even, ativo e tempo
  gráfico) e encaminha — `estilo.md`, `atendimento.md`, `tecnico.md`.

## 03/11/2026
- **Correção: o agente perguntava "pré-atendimento" para casos já encerrados** (três casos reais de clientes). Causa:
  a janela de 12 h da equipe terminou de madrugada e as mensagens antigas (já respondidas por sugestão aprovada pelo dono) foram
  tratadas como novas; a checagem de continuidade então mandou a enquete. Agora: (1) se o agente já respondeu depois da última
  mensagem do cliente, nada é reprocessado; (2) cliente que só agradece ou se despede ("vou testar", "obrigado") = silêncio;
  (3) a equipe falou há menos de 3 dias e o cliente continua o assunto = o agente NÃO fala com o cliente e manda ao dono uma sugestão
  ou a decisão a tomar; (4) a enquete só sai para assunto antigo (3 a 7 dias) ou em dúvida; (5) pagamento, valor a mais, desconto
  e reembolso viram uma pergunta ao dono ("o cliente pagou e mandou valor a mais, como tratamos?"), nunca um texto ao cliente;
  comprovantes em PDF são abertos para conferir o valor — `continuidade.mjs`, `agente.mjs`, `prompts.mjs`.
