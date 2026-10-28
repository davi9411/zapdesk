import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificar, jidChat, extensao, respondeStatus } from '../src/conector/mensagens.mjs';
import { avaliarItem, planoEnvio } from '../src/canais/fila.mjs';
import { parseQuando } from '../src/regras/quando.mjs';
import { cartao } from '../src/notificador/cartao.mjs';

test('classificar: texto, mídia, documento e ignorados', () => {
  assert.deepEqual(classificar({ conversation: 'oi' }), { tipo: 'texto', texto: 'oi' });
  assert.equal(classificar({ extendedTextMessage: { text: 'link' } }).texto, 'link');
  const voz = classificar({ audioMessage: { seconds: 12, ptt: true } });
  assert.equal(voz.tipo, 'audio'); assert.equal(voz.dur, 12); assert.equal(voz.texto, 'voz');
  assert.equal(classificar({ videoMessage: { seconds: 30, caption: 'olha' } }).texto, 'olha');
  assert.equal(classificar({ imageMessage: {} }).tipo, 'imagem');
  assert.equal(classificar({ documentMessage: { fileName: 'EA.ex5', caption: 'segue' } }).texto, 'EA.ex5 — segue');
  assert.equal(classificar({ stickerMessage: {} }).tipo, 'figurinha');
  assert.equal(classificar({ reactionMessage: { text: '👍' } }), null);
  assert.equal(classificar(null), null);
});

test('jidChat prefere o número ao LID', () => {
  assert.equal(jidChat({ remoteJid: '123@lid', remoteJidAlt: '5511999990000@s.whatsapp.net' }), '5511999990000@s.whatsapp.net');
  assert.equal(jidChat({ remoteJid: '123@lid' }), '123@lid');
  assert.equal(jidChat({ remoteJid: '5511999990000@s.whatsapp.net', remoteJidAlt: '123@lid' }), '5511999990000@s.whatsapp.net');
  assert.equal(jidChat({ remoteJid: '120363@g.us' }), '120363@g.us');
});

test('extensao pelo mimetype', () => {
  assert.equal(extensao('audio/ogg; codecs=opus'), 'ogg');
  assert.equal(extensao('image/jpeg'), 'jpg');
  assert.equal(extensao('application/zip'), 'zip');
  assert.equal(extensao(null), 'bin');
});

test('fila: envio programado vencido há mais que o limite não sai', () => {
  const agora = 1_000_000;
  assert.equal(avaliarItem({ enviar_em: agora - 60 }, agora, 1800).acao, 'enviar');
  const r = avaliarItem({ enviar_em: agora - 3600 }, agora, 1800);
  assert.equal(r.acao, 'atrasada'); assert.match(r.erro, /60 min/);
});

test('fila: plano de envio', () => {
  assert.deepEqual(planoEnvio({ texto: 'oi' }), [{ text: 'oi' }]);
  const um = planoEnvio({ texto: 'segue', arquivos: JSON.stringify(['C:\\x\\EA v1.zip']) });
  assert.equal(um.length, 1);
  assert.equal(um[0].fileName, 'EA v1.zip'); assert.equal(um[0].mimetype, 'application/zip'); assert.equal(um[0].caption, 'segue');
  const varios = planoEnvio({ texto: 'prints', arquivos: JSON.stringify(['a.png', 'b.mp4', 'c.ex5']) });
  assert.deepEqual(varios.map((c) => Object.keys(c)[0]), ['text', 'image', 'video', 'document']);
  assert.equal(varios[1].caption, undefined);
  assert.deepEqual(planoEnvio({ texto: '', arquivos: null }), []);
});

test('parseQuando: hora de hoje, data completa e inválidos', () => {
  const hoje = new Date(2026, 9, 27, 10, 0, 0);
  assert.equal(parseQuando('16:30', hoje), Math.floor(new Date(2026, 9, 27, 16, 30).getTime() / 1000));
  assert.equal(parseQuando('2026-10-30 9:05'), Math.floor(new Date(2026, 9, 30, 9, 5).getTime() / 1000));
  assert.equal(parseQuando('2026-10-30T16:30'), Math.floor(new Date(2026, 9, 30, 16, 30).getTime() / 1000));
  for (const t of ['25:00', '16h30', 'amanhã', '', null]) assert.equal(parseQuando(t, hoje), null, String(t));
});

test('cartão do caso: com e sem sugestão', () => {
  const com = cartao({ id: 7, icone: '📋', titulo: 'pedido', quem: 'Lu (+55)', resumo: 'quer um indicador', decidir: 'valor', sugestao: 'Oi Lu!' });
  assert.match(com, /\*#7 · Lu/); assert.match(com, /❓ valor/); assert.match(com, /1️⃣ \*#7 ok\*/); assert.match(com, /3️⃣ \*#7 depois\*/);
  const sem = cartao({ id: 8, icone: '⏰', quem: 'X', resumo: 'r' });
  assert.doesNotMatch(sem, /#8 ok/); assert.match(sem, /1️⃣ \*#8 sua orientação\*/); assert.match(sem, /2️⃣ \*#8 depois\*/);
});

test('resposta a status é reconhecida', () => {
  assert.equal(respondeStatus({ stickerMessage: { contextInfo: { remoteJid: 'status@broadcast' } } }), true);
  assert.equal(respondeStatus({ extendedTextMessage: { text: 'top', contextInfo: { remoteJid: 'status@broadcast' } } }), true);
  assert.equal(respondeStatus({ stickerMessage: {} }), false);
  assert.equal(respondeStatus({ conversation: 'oi' }), false);
  assert.equal(respondeStatus(null), false);
});
