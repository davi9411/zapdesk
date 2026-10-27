# wa-leitor

Leitor **local** de WhatsApp para uso pessoal: recebe mensagens e mídia, grava num SQLite e permite
ler, transcrever áudios, extrair frames de vídeos e (opcionalmente) enviar ou programar mensagens,
tudo por linha de comando. Foi desenhado para ser operado por um assistente de IA (Claude Code), mas
funciona sozinho. **Nenhuma mensagem é enviada sem um comando explícito**; não há resposta automática.

> Aviso: usa a biblioteca não oficial [Baileys](https://github.com/WhiskeySockets/Baileys), que
> conecta como "dispositivo vinculado". Isso vai contra os termos do WhatsApp e há risco de bloqueio
> do número. Use por sua conta e risco, de preferência só leitura.

## Stack
- Node.js ≥ 22.5 (usa `node:sqlite` nativo, sem dependência de compilação)
- [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) 7.x + pino
- Python 3 + [faster-whisper](https://github.com/SYSTRAN/faster-whisper) e ffmpeg (só para `preparar`)

## Arquitetura
```
 celular ⇄ WhatsApp ⇄ listener.mjs (processo em segundo plano, ligado sob demanda)
                         │  grava mensagens + baixa mídia        ▲ envia a fila "outbox"
                         ▼                                       │
                    wa.db (SQLite: chats, msgs, outbox)  ◄── cli.mjs ◄── usuário / assistente
                         ▲
                tools/preparar.py (Whisper + ffmpeg, só quando chamado)
```
- `src/listener.mjs`: conexão, gravação de mensagens/mídia e envio da fila. Não marca "online" e não
  envia confirmação de leitura.
- `src/cli.mjs`: liga/desliga (arquivo PID), consulta, leitura, fila de envio.
- `src/parear.mjs`: pareamento único por código de 8 dígitos.
- `tools/preparar.py`: transcrição e frames, sob demanda (nunca em segundo plano).

## Liga / desliga
Nada sobe sozinho; reiniciar o PC deixa tudo desligado.

| Ação | Comando |
|---|---|
| Ligar (desliga sozinho em N horas) | `wa ligar --horas 8` |
| Desligar | `wa desligar` |
| Estado | `wa status` |

Ligado usa ~100–150 MB de RAM e CPU quase zero. `ligar.cmd` / `desligar.cmd` são atalhos de duplo clique.

### Subir junto com o Windows (opcional)
```
.\tools\instalar-servico.ps1              # PowerShell como administrador, uma vez
.\tools\instalar-servico.ps1 -SoAtualizar # depois de mudar o código (sem admin)
.\tools\instalar-servico.ps1 -Remover
```
Cria a tarefa agendada `wa-leitor`: sobe ~1 min após o boot, **antes do login** (LogonType S4U,
sem guardar senha), fica até o PC desligar e reinicia sozinha se cair. Como esse tipo de tarefa não
enxerga o perfil do usuário nem o OneDrive, ela roda uma cópia do programa em `<dados>\app` e usa a
pasta de dados `C:\wa-leitor` (com permissão só do usuário, SYSTEM e administradores). Se essa
pasta tiver uma sessão pareada, a CLI passa a usá-la automaticamente.

## Primeiro uso
```
npm install
wa parear 55DDDNUMERO     # mostra um código de 8 dígitos
```
No celular: WhatsApp > Configurações > Dispositivos conectados > Conectar dispositivo >
**Conectar com número de telefone** e digite o código.

## Uso
```
wa chats [filtro]               # conversas recentes
wa ler <nome> --horas 24        # texto + transcrições + caminhos de fotos/vídeos/frames
wa preparar <nome> --horas 24   # transcreve áudios/vídeos e extrai frames
wa enviar <nome> --texto "Olá"  # envio imediato (exige o leitor ligado)
wa enviar <nome> --texto "Segue" --arquivo "C:\...\arquivo.zip" --em 16:30   # programado
wa fila                         # pendentes e enviados nas últimas 24 h
wa cancelar <id>
```
- Envio programado exige o leitor ligado no horário; o auto-desligamento é adiado enquanto houver
  envio pendente.
- Se o horário passar com o leitor desligado por mais de 30 min, o envio vira `atrasada` e **não sai**.
- Um arquivo vai com o texto como legenda; vários arquivos vão em mensagens separadas.

## Onde ficam os dados
`%LOCALAPPDATA%\wa-leitor`, fora do repositório: `auth/` (credenciais = chave da conta), `midia/`,
`wa.db`, `wa.log`. Ver `.env.example` para as variáveis opcionais.

## Segurança e privacidade
- Quem copiar `auth/` lê as conversas. Nunca versionar nem sincronizar essa pasta.
- Desconectar pelo celular (Dispositivos conectados) corta o acesso na hora.
- Tudo roda localmente; nenhum dado é enviado a serviços de terceiros além do próprio WhatsApp.
- O histórico antigo vem só em parte e a mídia só é baixada a partir do pareamento.

## Licença
MIT, ver [LICENSE](LICENSE).
