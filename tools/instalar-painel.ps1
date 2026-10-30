# Registra o painel local (http://127.0.0.1:4747) como tarefa agendada 'wa-painel': sobe no logon e é
# conferido a cada 5 min (se já estiver no ar, a segunda cópia sai quieta). Roda a cópia em <Dados>\app,
# a mesma do leitor e do agente: depois de mudar o código, rode instalar-servico.ps1 -SoAtualizar.
# Uso: .\tools\instalar-painel.ps1 -Dados C:\wa-leitor        (não precisa de administrador)
#      .\tools\instalar-painel.ps1 -Remover
param([switch]$Remover, [string]$Usuario = "$env:USERDOMAIN\$env:USERNAME", [string]$Dados = "$env:LOCALAPPDATA\wa-leitor")
if ($Remover) { Unregister-ScheduledTask -TaskName 'wa-painel' -Confirm:$false -ErrorAction SilentlyContinue; "Tarefa removida."; return }

$node = (Get-Command node -ErrorAction Stop).Source
$servidor = Join-Path $Dados 'app\src\painel\servidor.mjs'
if (-not (Test-Path $servidor)) { throw "Não achei $servidor. Rode antes: .\tools\instalar-servico.ps1 -SoAtualizar -Dados $Dados" }
$vbs = Join-Path $Dados 'painel.vbs'
@"
Set sh = CreateObject("WScript.Shell")
sh.Environment("PROCESS")("WA_DATA") = "$Dados"
sh.Run """$node"" --no-warnings ""$servidor""", 0, False
"@ | Set-Content -Path $vbs -Encoding ASCII
$acao = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$gLogon = New-ScheduledTaskTrigger -AtLogOn -User $Usuario
$gVigia = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$princ = New-ScheduledTaskPrincipal -UserId $Usuario -LogonType Interactive -RunLevel Limited
$cfg = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'wa-painel' -Action $acao -Trigger @($gLogon, $gVigia) -Principal $princ -Settings $cfg `
  -Description 'Painel local do Zapdesk (127.0.0.1:4747), conferido a cada 5 min.' -Force | Out-Null
"Tarefa 'wa-painel' registrada (logon + vigia a cada 5 min). Painel em http://127.0.0.1:4747"
