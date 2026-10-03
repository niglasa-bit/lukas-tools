<#
  Poistaa ajastetun tehtävän "Lukas Rewards-apuri". Loki ja päiväleima jäävät
  kansioon %LOCALAPPDATA%\RewardsApuri (voit poistaa sen käsin, jos haluat).
    powershell -ExecutionPolicy Bypass -File poista.ps1
#>
$ErrorActionPreference = 'Stop'
$TehtavanNimi = 'Lukas Rewards-apuri'
if (Get-ScheduledTask -TaskName $TehtavanNimi -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TehtavanNimi -Confirm:$false
    Write-Host "Poistettu: '$TehtavanNimi'."
} else {
    Write-Host "Tehtävää '$TehtavanNimi' ei ollut asennettu."
}
