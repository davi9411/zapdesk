// Aviso padrão de caso para o dono: resumo curto + sugestão + 3 opções.
export function cartao({ id, icone, titulo, quem, origem, resumo, decidir, sugestao, ficha }) {
  const f = ficha?.encontrado ? `\n🗂️ ${ficha.linha_curta || `${ficha.nome} · ${(ficha.servicos || []).length} serviço(s) na Works`}${ficha.alerta_equipe ? `\n⚠️ ${ficha.alerta_equipe}` : ''}` : '';
  return `${icone} *#${id} · ${quem}*${titulo ? ` — ${titulo}` : ''}\n${resumo || '-'}${origem ? `\n_Conheceu por: ${origem}_` : ''}${f}${decidir ? `\n❓ ${decidir}` : ''}`
    + `${sugestao ? `\n\n💡 *Sugestão:* "${sugestao}"` : ''}\n\n`
    + `${sugestao ? `1️⃣ *#${id} ok* → mando a sugestão\n2️⃣` : '1️⃣'} *#${id} sua orientação* → escrevo a partir do que você disser\n`
    + `${sugestao ? '3️⃣' : '2️⃣'} *#${id} depois* → aviso que os dados foram coletados e a equipe responde em breve`;
}
