import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// banco e configuração numa pasta temporária (nunca na pasta real do leitor)
process.env.WA_DATA = mkdtempSync(join(tmpdir(), 'wa-teste-'));
const { abrirDb } = await import('../src/armazenamento/db.mjs');
const { lerConfigStatus, dentroDaJanela, montarAudiencia, verificarStatusDoDia, dataLocal } = await import('../src/canais/status.mjs');

const BASE = 'https://loja.public.blob.vercel-storage.com';
const cfgArq = (extra = {}) => {
  const arq = join(process.env.WA_DATA, 'status.json');
  writeFileSync(arq, JSON.stringify({ ativo: true, base_url: `${BASE}/`, ...extra }));
  return lerConfigStatus(arq);
};
// quinta-feira, 29/10/2026, 08:10 (horário local do teste)
const quinta8h = new Date(2026, 9, 29, 8, 10);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20_000, 1)]);
const resp = (status, corpo) => ({ status, ok: status >= 200 && status < 300, json: async () => corpo, arrayBuffer: async () => corpo });
const fetchDoDia = (data, { manifesto = { data, imagem: `${BASE}/story/${data}.jpg` }, imagem = jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.length) } = {}) => async (url) => {
  if (url === `${BASE}/story/${data}.json`) return manifesto ? resp(200, manifesto) : resp(404);
  if (url.endsWith('.jpg')) return resp(200, imagem);
  return resp(404);
};

function bancoComContatos() {
  const db = abrirDb();
  const ins = db.prepare('INSERT OR REPLACE INTO chats (jid, nome, grupo) VALUES (?, ?, ?)');
  ins.run('5511111110001@s.whatsapp.net', 'Cliente A', 0);
  ins.run('5511111110002@s.whatsapp.net', 'Pessoal B', 0);
  ins.run('5511111110003@s.whatsapp.net', 'Tecassistiva C', 0);
  ins.run('120363000000000001@g.us', 'Grupo', 1);
  ins.run('123456@lid', 'Sem número', 0);
  db.exec("INSERT OR REPLACE INTO etiquetas (id, nome) VALUES ('1', 'Pessoal🏠'), ('2', 'Tecassistiva🤖')");
  db.exec("INSERT OR REPLACE INTO etiqueta_chat (chat, etiqueta) VALUES ('5511111110002@s.whatsapp.net', '1'), ('5511111110003@s.whatsapp.net', '2')");
  return db;
}

test('sem status.json ativo o recurso fica desligado', () => {
  assert.equal(lerConfigStatus(join(process.env.WA_DATA, 'nao-existe.json')), null);
  writeFileSync(join(process.env.WA_DATA, 'status.json'), JSON.stringify({ ativo: false, base_url: BASE }));
  assert.equal(lerConfigStatus(join(process.env.WA_DATA, 'status.json')), null);
  writeFileSync(join(process.env.WA_DATA, 'status.json'), JSON.stringify({ ativo: true, base_url: 'http://sem-https.com' }));
  assert.equal(lerConfigStatus(join(process.env.WA_DATA, 'status.json')), null);
});

test('janela: domingo a sexta, entre a hora inicial e a final', () => {
  const cfg = cfgArq({ hora_ini: 7, hora_fim: 12 });
  assert.equal(dentroDaJanela(cfg, quinta8h), true);
  assert.equal(dentroDaJanela(cfg, new Date(2026, 9, 29, 6, 59)), false);
  assert.equal(dentroDaJanela(cfg, new Date(2026, 9, 29, 12, 0)), false);
  assert.equal(dentroDaJanela(cfg, new Date(2026, 9, 31, 8, 10)), false, 'sábado não tem brief');
});

test('audiência: só conversas privadas, sem etiquetas excluídas, e sempre o próprio número', () => {
  const cfg = cfgArq();
  const ets = new Map([['5511111110002@s.whatsapp.net', ['Pessoal🏠']], ['5511111110003@s.whatsapp.net', ['Tecassistiva🤖']]]);
  const jids = ['5511111110001@s.whatsapp.net', '5511111110002@s.whatsapp.net', '5511111110003@s.whatsapp.net', '120363000000000001@g.us', '123456@lid'];
  assert.deepEqual(montarAudiencia(jids, ets, cfg, '5511000000000@s.whatsapp.net').sort(), ['5511000000000@s.whatsapp.net', '5511111110001@s.whatsapp.net']);
  const so = cfgArq({ so_etiquetas: ['Cliente'] });
  assert.deepEqual(montarAudiencia(jids, ets, so, '5511000000000@s.whatsapp.net'), ['5511000000000@s.whatsapp.net'], 'só_etiquetas sem ninguém etiquetado: só o próprio número');
});

test('posta uma vez por dia, com a audiência certa, e não repete', async () => {
  const db = bancoComContatos();
  const cfg = cfgArq();
  const data = dataLocal(quinta8h);
  const enviados = [];
  const deps = { db, cfg, agora: quinta8h, meuJid: '5511000000000@s.whatsapp.net', fetchFn: fetchDoDia(data), enviar: async (buf, legenda, jids) => enviados.push({ n: buf.length, jids }) };
  assert.match(await verificarStatusDoDia(deps), /^enviado \(2\)/);
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].jids.sort(), ['5511000000000@s.whatsapp.net', '5511111110001@s.whatsapp.net']);
  assert.match(await verificarStatusDoDia(deps), /já tratado \(enviado\)/);
  assert.equal(enviados.length, 1, 'segunda verificação não posta de novo');
});

test('manifesto ainda não publicado: espera sem gastar tentativa', async () => {
  const db = bancoComContatos();
  db.exec('DELETE FROM status_postado');
  const data = dataLocal(quinta8h);
  const deps = { db, cfg: cfgArq(), agora: quinta8h, meuJid: 'eu@s.whatsapp.net', fetchFn: fetchDoDia(data, { manifesto: null }), enviar: async () => { throw new Error('não deveria enviar'); } };
  assert.match(await verificarStatusDoDia(deps), /ainda não publicado/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM status_postado').get().n, 0);
});

test('rejeita manifesto de outra data, imagem de outro endereço e arquivo que não é JPEG', async () => {
  const db = bancoComContatos();
  const data = dataLocal(quinta8h);
  const base = { db, cfg: cfgArq(), agora: quinta8h, meuJid: 'eu@s.whatsapp.net', enviar: async () => { throw new Error('não deveria enviar'); } };
  const casos = [
    [{ manifesto: { data: '2020-01-01', imagem: `${BASE}/story/x.jpg` } }, /outra data/],
    [{ manifesto: { data, imagem: 'https://outro.exemplo.com/story/x.jpg' } }, /fora do endereço/],
    [{ imagem: Buffer.alloc(20_000, 7).buffer }, /imagem inválida/],
  ];
  for (const [extra, esperado] of casos) {
    db.exec('DELETE FROM status_postado');
    assert.match(await verificarStatusDoDia({ ...base, fetchFn: fetchDoDia(data, extra) }), esperado);
  }
});

test('falha de download tenta de novo; depois de 3 tentativas para; erro no envio dá no máximo mais uma tentativa', async () => {
  const db = bancoComContatos();
  db.exec('DELETE FROM status_postado');
  const data = dataLocal(quinta8h);
  const baixaFalha = { db, cfg: cfgArq(), agora: quinta8h, meuJid: 'eu@s.whatsapp.net', enviar: async () => {}, fetchFn: async () => resp(500) };
  for (let i = 0; i < 3; i++) assert.match(await verificarStatusDoDia(baixaFalha), /^falhou/);
  assert.match(await verificarStatusDoDia(baixaFalha), /já tratado \(falhou\)/);

  db.exec('DELETE FROM status_postado');
  let chamadas = 0;
  const envioFalha = { db, cfg: cfgArq(), agora: quinta8h, meuJid: 'eu@s.whatsapp.net', fetchFn: fetchDoDia(data), enviar: async () => { chamadas++; throw new Error('Connection Closed'); } };
  await verificarStatusDoDia(envioFalha);
  await verificarStatusDoDia(envioFalha);
  assert.match(await verificarStatusDoDia(envioFalha), /já tratado/);
  assert.equal(chamadas, 2);
});
