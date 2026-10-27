# Migração do PC (Windows) para o servidor (Linux + Docker)

Objetivo: o Zapdesk roda 24h no servidor e o PC deixa de ser necessário. Só pode existir **uma**
conexão ativa por sessão do WhatsApp (duas se derrubam com erro 440): o PC é desligado antes de o
servidor conectar.

## 1. Preparar o servidor (uma vez)
- Ubuntu 24.04, 2 vCPU / 4 GB de RAM / 40 GB ou mais (mini PC N100 em casa ou VPS).
- Docker + plugin compose: `curl -fsSL https://get.docker.com | sh`
- Acesso só por SSH com chave (ou Tailscale) e firewall fechado para entrada (`ufw default deny incoming`).
- Login no registro de imagens, se a imagem estiver privada:
  `echo <token com read:packages> | docker login ghcr.io -u davi9411 --password-stdin`

## 2. Subir o projeto
```
mkdir -p ~/zapdesk && cd ~/zapdesk
curl -fsSLO https://raw.githubusercontent.com/davi9411/zapdesk/main/docker-compose.yml
docker compose pull
```

## 3. Levar os dados do PC (banco, mídia e configurações)
No PC (PowerShell), **com o leitor e o agente parados**:
```
Stop-ScheduledTask wa-agente; taskkill /F /PID (Get-Content C:\wa-leitor\wa.pid)
tar -czf zapdesk-dados.tgz -C C:\wa-leitor wa.db midia agente.json ausencia.json
scp zapdesk-dados.tgz usuario@servidor:~/zapdesk/
```
No servidor:
```
docker compose run --rm -v ~/zapdesk:/import leitor sh -c "tar -xzf /import/zapdesk-dados.tgz -C /data"
```
A pasta `auth/` (sessão) **não** vai junto: o servidor faz um pareamento novo, o que é mais seguro.

## 4. Trocar o dispositivo vinculado
1. No PC, desative as tarefas para não voltarem sozinhas: `Disable-ScheduledTask wa-leitor; Disable-ScheduledTask wa-agente`.
2. No celular: WhatsApp > Dispositivos conectados > desconecte o "Chrome (Windows)".
3. No servidor: `docker compose run --rm leitor node src/parear.mjs 55DDDNUMERO` e digite o código
   no celular (Conectar com número de telefone).

## 5. Login do Claude Code (agente)
```
docker compose run --rm -it agente claude
```
Dentro dele, `/login` com a conta da **assinatura** (não a de API) e saia com `/exit`. O login fica no
volume `claude-home`. Confira: `docker compose run --rm agente claude auth status` deve mostrar
`authMethod: claude.ai`.

## 6. Ligar
```
docker compose up -d
docker compose logs -f agente        # "agente iniciado"
docker compose exec leitor node src/cli.mjs status
```
Mande `STATUS` do WhatsApp pessoal para o número da empresa: o agente deve responder.

## 7. Atualizar e voltar atrás
- Cada push na `main` gera a imagem `ghcr.io/davi9411/zapdesk:latest` (e uma com o hash do commit).
- Atualizar: `docker compose pull && docker compose up -d`.
- Voltar uma versão: troque `latest` pelo hash do commit anterior no `docker-compose.yml` e `up -d`.

## Diferenças em relação ao PC
| PC (Windows) | Servidor (Docker) |
|---|---|
| tarefas `wa-leitor` e `wa-agente` | serviços `leitor` e `agente` com `restart: unless-stopped` |
| agente vigia e religa o leitor | o Docker religa qualquer um que cair |
| dados em `C:\wa-leitor` | volume `dados` (`/data`) |
| limpeza de mídia manual (`wa limpar`) | automática: 7 dias e no máximo 8 GB |
| `py -3` e Claude Code do usuário | Python, ffmpeg, faster-whisper e Claude Code dentro da imagem |
