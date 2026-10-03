<#
  Rekisteröi ajastetun tehtävän "Lukas Rewards-apuri", joka ajaa rewards-apuri.ps1:n
  kun kirjaudut Windowsiin (1 min viiveellä). Skripti itse huolehtii,
  että hakuja tehdään vain kerran päivässä.
  Aja tavallisena käyttäjänä (ei järjestelmänvalvojana):
    powershell -ExecutionPolicy Bypass -File asenna.ps1
#>
[CmdletBinding()]
param([string]$Profiili = 'Default')

$ErrorActionPreference = 'Stop'
$TehtavanNimi = 'Lukas Rewards-apuri'
$Skripti = Join-Path $PSScriptRoot 'rewards-apuri.ps1'
if (-not (Test-Path $Skripti)) { throw "rewards-apuri.ps1 puuttuu: $Skripti" }

$kayttaja = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$argumentit = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Profiili "{1}"' -f $Skripti, $Profiili

$toiminto = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argumentit -WorkingDirectory $PSScriptRoot
$laukaisin = New-ScheduledTaskTrigger -AtLogOn -User $kayttaja
$laukaisin.Delay = 'PT1M'
$paasy = New-ScheduledTaskPrincipal -UserId $kayttaja -LogonType Interactive -RunLevel Limited
$asetukset = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $TehtavanNimi -Action $toiminto -Trigger $laukaisin `
    -Principal $paasy -Settings $asetukset `
    -Description 'Avaa Edgen kerran päivässä ensimmäisellä kirjautumisella ja tekee 3 Bing-hakua.' `
    -Force | Out-Null

Write-Host "Asennettu: '$TehtavanNimi' ($kayttaja). Loki: $env:LOCALAPPDATA\RewardsApuri\loki.txt"
