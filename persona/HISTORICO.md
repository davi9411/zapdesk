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
