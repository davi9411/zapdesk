# Registra o leitor como tarefa agendada que sobe quando o Windows liga (antes do login,
# sem precisar de PIN/senha: LogonType S4U = roda como o usuário, sem guardar senha).
# Fica rodando até o PC desligar e é reiniciada sozinha se cair.
#
# A tarefa roda uma CÓPIA do programa em <Dados>\app (fora do OneDrive: antes do login o
# OneDrive não está ativo). Depois de mudar o código, atualize a cópia com:
#   .\tools\instalar-servico.ps1 -SoAtualizar      (não precisa de administrador)
#
# Uso (PowerShell como administrador):  .\tools\instalar-servico.ps1           instala/atualiza
#                                       .\tools\instalar-servico.ps1 -Remover  remove a tarefa
param([switch]$Remover, [switch]$SoAtualizar, [string]$Usuario = "$env:USERDOMAIN\$env:USERNAME",
      [string]$Dados = "$env:LOCALAPPDATA\wa-leitor")

$Nome = 'wa-leitor'
if ($Remover) { Unregister-ScheduledTask -TaskName $Nome -Confirm:$false -ErrorAction SilentlyContinue; "Tarefa '$Nome' removida."; return }

$raiz = Split-Path -Parent $PSScriptRoot
$app = Join-Path $Dados 'app'
New-Item -ItemType Directory -Force $app | Out-Null
robocopy $raiz $app /MIR /XD .git /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar o programa para $app (robocopy $LASTEXITCODE)" }
"Programa copiado para $app."
if ($SoAtualizar) { "Reinicie o leitor para usar a versão nova (wa desligar; a tarefa sobe de novo em ~1 min)."; return }

$node = (Get-Command node -ErrorAction Stop).Source
$listener = Join-Path $app 'src\listener.mjs'
$logServico = Join-Path $Dados 'servico.log'

# servico.cmd fixa a pasta de dados (WA_DATA) e registra cada partida/erro num log próprio
$cmdServico = Join-Path $Dados 'servico.cmd'
@"
@echo off
set "WA_DATA=$Dados"
cd /d "$Dados"
echo [%date% %time%] partida (usuario %USERNAME%) >> "$logServico"
"$node" --no-warnings "$listener" >> "$logServico" 2>&1
echo [%date% %time%] saiu com codigo %errorlevel% >> "$logServico"
exit /b %errorlevel%
"@ | Set-Content -Path $cmdServico -Encoding ASCII
$acao = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$cmdServico`""
$gatilho = New-ScheduledTaskTrigger -AtStartup
$gatilho.Delay = 'PT1M'   # espera 1 min após o boot (rede no ar)
$principal = New-ScheduledTaskPrincipal -UserId $Usuario -LogonType S4U -RunLevel Limited
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $Nome -Action $acao -Trigger $gatilho -Principal $principal -Settings $config `
  -Description 'Leitor de WhatsApp (wa-leitor): sobe com o Windows e fica até desligar.' -Force | Out-Null
"Tarefa '$Nome' registrada para $Usuario (dados em $Dados)."
