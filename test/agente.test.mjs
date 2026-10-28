import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarTrava } from '../src/agente/travas.mjs';
import { promptCliente, promptComandoDavi } from '../src/agente/prompts.mjs';
import { normEtiqueta } from '../src/armazenamento/db.mjs';

const trava = criarTrava(['Davi']);

test('trava bloqueia preço, prazo, temas comerciais, IA e nomes internos', () => {
  for (const t of [
    'O valor fica R$ 500', 'sai por 300 reais', 'pode pagar no pix', 'te dou um desconto',
    'fica pronto em uma semana', 'entrego em 5 dias úteis',
    'com potencial para virar um produto da DS Trade', 'podemos fazer uma parceria', 'royalties de 10%',
    'sou um assistente do Claude', 'vou ver com o Davi',
  ]) assert.equal(trava.test(t), true, t);
});

test('trava deixa passar atendimento normal', () => {
  for (const t of [
    'Me manda um print da aba Experts, por favor.',
    'Pode me explicar do seu jeito que a equipe entende.',
    'O robô parou há 2 dias? Me conta o que aparece no Diário.',
    'Deixei tudo registrado no sistema e a equipe dá sequência por aqui.',
  ]) assert.equal(trava.test(t), false, t);
});

test('nome de etiqueta ignora emoji, número e acento', () => {
  assert.equal(normEtiqueta('Pessoal🏠'), 'pessoal');
  assert.equal(normEtiqueta('Orçamentos👨‍💻'), 'orcamentos');
  assert.equal(normEtiqueta('Iniciante2⃣'), 'iniciante');
  assert.equal(normEtiqueta('  Novo   cliente🆕 '), 'novo cliente');
});

test('prompt do cliente muda com evento, sugestão e espera longa', () => {
  const base = { nome: 'Dante', empresa: 'Empresa X', conversa: '[x] CLIENTE: oi', casosAbertos: '', agoraTxt: 'agora' };
  const evento = promptCliente({ ...base, primeiroContato: true, evento: { descricao: 'um evento', retorno: 'sexta' } });
  assert.match(evento, /aviso automático do evento/);
  assert.match(evento, /equipe, que retorna na sexta/);
  const normal = promptCliente({ ...base, primeiroContato: true, clienteNovo: true, retornoEquipe: 'amanhã às 09:00' });
  assert.match(normal, /como\s+conheceu/);
  assert.doesNotMatch(normal, /aviso automático do evento/);
  // primeiro contato: oferece pré-atendimento com a IA ou aguardar a equipe
  assert.match(normal, /pré-atendimento/);
  assert.match(normal, /retorna amanhã às 09:00/);
  assert.match(normal, /escolha="humano"/);
  // depois da escolha, não pergunta de novo
  assert.doesNotMatch(promptCliente({ ...base, primeiroContato: false, escolhaFeita: true }), /ESCOLHA DO CLIENTE/);
  // mensagens curtas
  assert.match(normal, /no máximo 3 passos por mensagem/);
  assert.match(promptCliente({ ...base, sugestao: true }), /SUGESTÃO/);
  assert.match(promptCliente({ ...base, esperaMin: 180 }), /3 horas/);
  assert.doesNotMatch(promptCliente({ ...base, esperaMin: 5 }), /desculpas pela demora/);
});

test('prompt de comando do dono lista etiquetas e ações', () => {
  const p = promptComandoDavi({ nome: 'Dante', empresa: 'X', texto: 'marca a Lu como pessoal', lista: '[0] Lu +55', casos: '', etiquetas: 'Pessoal🏠' });
  assert.match(p, /Pessoal🏠/);
  assert.match(p, /"acao":"enviar\|caso\|etiqueta\|duvida"/);
});

test('prompt do cliente: propaganda, pasta do robô e perfil', () => {
  const base = { nome: 'Dante', empresa: 'Empresa X', conversa: '[x] CLIENTE: oi', casosAbertos: '', agoraTxt: 'agora' };
  const p = promptCliente(base);
  assert.match(p, /categoria="propaganda"/);
  assert.match(p, /Estou obtendo essa informação/);
  assert.doesNotMatch(p, /verificando essas informações no sistema/);
  assert.doesNotMatch(p, /PERFIL DO CLIENTE/);
  assert.match(promptCliente({ ...base, pastaRobo: 'C:/repo/Fulano' }), /C:\/repo\/Fulano[\s\S]*nome EXATO do campo/);
  assert.match(promptCliente({ ...base, perfil: 'iniciante', estilo: 'mensagens curtas' }), /PERFIL DO CLIENTE[\s\S]*um passo de cada vez[\s\S]*mensagens curtas/);
});
