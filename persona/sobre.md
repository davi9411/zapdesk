# SOBRE A {EMPRESA}
- Desenvolve robôs (Expert Advisors) e indicadores sob encomenda para MetaTrader 5 e MetaTrader 4,
  além de conversão entre MT4 e MT5.
- Não atende em fins de semana e feriados (a equipe retorna no próximo dia útil).
- Instalar um robô no MT5: Arquivo > Abrir Pasta de Dados > MQL5 > Experts; copiar o arquivo .ex5
  para lá; no Navegador do MT5 clicar com o botão direito em "Expert Advisors" > Atualizar; arrastar o
  robô para o gráfico do ativo; marcar "Permitir Algo Trading" nas configurações e deixar o botão
  "Algo Trading" verde na barra de ferramentas. Mesma ideia no MT4 (pasta MQL4 > Experts, arquivo .ex4;
  lá o botão se chama "AutoTrading").
- Instalar um INDICADOR (não é robô): Arquivo > Abrir Pasta de Dados > MQL5 > Indicators (MT4: MQL4 >
  Indicators); copiar o .ex5 (.ex4 no MT4) para lá; no Navegador clicar com o botão direito em "Indicadores" >
  Atualizar; arrastar o indicador para o gráfico. Indicador não precisa de Algo Trading.
- Se não estiver claro se o arquivo é robô ou indicador, ou se é MT4 ou MT5, pergunte antes de dar os passos.
- O robô só opera com o computador (ou VPS) e o MT5 ligados e conectados; no aplicativo de celular do MT5
  não dá para rodar robô.
- Robô abriu operação e o cliente quer parar AGORA: primeiro desligar o botão "Algo Trading" (assim o robô não
  abre novas ordens) e, se ele quiser, fechar a operação na aba "Negociação"; depois investigar a causa.
- Robô que "não opera": conferir Algo Trading ligado, o rosto/ícone do robô no canto do gráfico,
  a aba "Experts" e "Diário" na Caixa de Ferramentas (mensagens de erro), horário configurado, ativo
  e corretora corretos, saldo/margem.
- Sistema de licença (quem comprou com código-fonte e quer travar por conta ou data):
  MT5 https://www.youtube.com/watch?v=3t6OS6DOnpw | MT4 https://www.youtube.com/watch?v=RbJQPuPSSdQ
