import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createCipheriv, createHash, randomBytes } from 'node:crypto';
import { proto } from '@whiskeysockets/baileys';
import { escolhaPorNumero, escolhaPorVoto, opcoesVotadas, decifrarVoto, OPCOES_ESCOLHA } from '../src/conector/enquete.mjs';
import { planoEnvio } from '../src/canais/fila.mjs';
import { classificar } from '../src/conector/mensagens.mjs';

test('escolha por número sozinho', () => {
  for (const t of ['1', ' 1 ', 'opção 1', 'Opcao 1', '1.', '1️⃣']) assert.equal(escolhaPorNumero(t), 'ia', t);
  for (const t of ['2', '2)', 'opção 2', '2⃣']) assert.equal(escolhaPorNumero(t), 'humano', t);
  for (const t of ['12', '1 robô', 'tenho 2 contas', 'oi', '']) assert.equal(escolhaPorNumero(t), null, t);
  assert.equal(escolhaPorVoto(OPCOES_ESCOLHA[0]), 'ia');
  assert.equal(escolhaPorVoto(OPCOES_ESCOLHA[1]), 'humano');
});

test('enquete vai depois do texto no envio e volta classificada como enquete', () => {
  const p = planoEnvio({ texto: 'oi', enquete: JSON.stringify({ nome: 'Como prefere seguir?', opcoes: OPCOES_ESCOLHA }) });
  assert.deepEqual(p[0], { text: 'oi' });
  assert.deepEqual(p[1].poll.values, OPCOES_ESCOLHA);
  assert.equal(p[1].poll.selectableCount, 1);
  assert.deepEqual(classificar({ pollCreationMessageV3: { name: 'Como prefere seguir?' } }), { tipo: 'enquete', texto: 'enquete: Como prefere seguir?' });
});

test('voto cifrado é decifrado (tentando número e LID) e vira a opção', () => {
  const segredo = randomBytes(32);
  const id = 'ABC123', criador = '5511999990000@s.whatsapp.net', eleitor = '123456789@lid';
  const opcao = createHash('sha256').update(OPCOES_ESCOLHA[1]).digest();
  const claro = proto.Message.PollVoteMessage.encode({ selectedOptions: [opcao] }).finish();
  const sign = Buffer.concat([Buffer.from(id), Buffer.from(criador), Buffer.from(eleitor), Buffer.from('Poll Vote'), Buffer.from([1])]);
  const k0 = createHmac('sha256', Buffer.alloc(32)).update(segredo).digest();
  const key = createHmac('sha256', k0).update(sign).digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(`${id}\u0000${eleitor}`));
  const encPayload = Buffer.concat([c.update(claro), c.final(), c.getAuthTag()]);
  const voto = decifrarVoto({ encPayload, encIv: iv }, { idEnquete: id, segredo: segredo.toString('base64'),
    criadores: ['123@lid', criador], eleitores: ['5511888880000@s.whatsapp.net', eleitor] });
  assert.ok(voto);
  assert.deepEqual(opcoesVotadas(voto.selectedOptions, OPCOES_ESCOLHA), [OPCOES_ESCOLHA[1]]);
});
