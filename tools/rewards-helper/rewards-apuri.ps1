<#
  Rewards-apuri: kerran paivassa, ensimmaisella kirjautumisella, avaa Edgen
  omalla profiilillasi ja tekee 3 Bing-hakua, jotta paivittainen streak pysyy.
  Ajetaan ajastetusta tehtavasta (asenna.ps1), mutta toimii myos kasin:
    powershell -ExecutionPolicy Bypass -File rewards-apuri.ps1 -Pakota
#>
[CmdletBinding()]
param(
    [switch]$Pakota,                       # aja vaikka tanaan on jo ajettu
    [switch]$JataAuki,                     # ala sulje Edgea lopuksi
    [string]$Profiili = 'Default',         # Edgen profiilikansio (edge://version -> Profiilin polku)
    [int]$OdotusSekunteina = 8,            # tauko hakujen valilla
    [int]$VerkkoOdotusMinuutteina = 10     # kuinka kauan verkkoa odotetaan
)

$ErrorActionPreference = 'Stop'
$Kansio    = Join-Path $env:LOCALAPPDATA 'RewardsApuri'
$Leima     = Join-Path $Kansio 'viimeisin_ajo.txt'
$Loki      = Join-Path $Kansio 'loki.txt'
$Tanaan    = (Get-Date).ToString('yyyy-MM-dd')
New-Item -ItemType Directory -Force -Path $Kansio | Out-Null

function Kirjaa([string]$Viesti) {
    $rivi = '{0}  {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Viesti
    Add-Content -Path $Loki -Value $rivi -Encoding UTF8
    Write-Host $rivi
}

function Hae-Edge {
    $polut = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
    )
    foreach ($p in $polut) { if ($p -and (Test-Path $p)) { return $p } }
    throw 'msedge.exe ei loytynyt.'
}

function Odota-Verkkoa([int]$Minuutit) {
    $raja = (Get-Date).AddMinutes($Minuutit)
    while ((Get-Date) -lt $raja) {
        try {
            Invoke-WebRequest -Uri 'https://www.bing.com/' -Method Head -UseBasicParsing -TimeoutSec 10 | Out-Null
            return $true
        } catch {
            Start-Sleep -Seconds 20
        }
    }
    return $false
}

# Hakusanat: tavallisia, Lukaksen aihepiiriin sopivia. Kolme peräkkäistä
# valitaan vuodenpaivan mukaan, joten haut vaihtuvat paivittain.
$Hakusanat = @(
    'säästövinkit arkeen', 'indeksirahasto aloittelijalle', 'sää huomenna helsinki',
    'budjetointi 50 30 20', 'korkoa korolle laskuri', 'helppo kasvisruoka resepti',
    'kotivakuutus vertailu', 'sähkön hinta huomenna', 'juoksulenkki aloittelijalle',
    'kirjasuositukset talous', 'ruokakaupan tarjoukset', 'hätärahasto kuinka paljon',
    'pitkäaikainen sijoittaminen', 'kahvinkeitin kalkinpoisto', 'viikonloppu tekemistä helsinki',
    'automaattinen säästäminen', 'osakesäästötili', 'uni ja stressi vinkit',
    'kuukausibudjetti pohja', 'lounasidea töihin', 'warren buffett lainaukset'
)

try {
    if (-not $Pakota -and (Test-Path $Leima) -and ((Get-Content $Leima -Raw).Trim() -eq $Tanaan)) {
        Kirjaa "Ohitetaan: tanaan ($Tanaan) on jo ajettu."
        exit 0
    }

    Kirjaa 'Aloitetaan. Odotetaan verkkoyhteytta...'
    if (-not (Odota-Verkkoa $VerkkoOdotusMinuutteina)) {
        Kirjaa "VIRHE: ei verkkoa $VerkkoOdotusMinuutteina minuuttiin. Yritetaan seuraavalla kirjautumisella."
        exit 1
    }

    $edge = Hae-Edge
    $olikoAuki = [bool](Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })

    $alku = (Get-Date).DayOfYear % $Hakusanat.Count
    $valitut = 0..2 | ForEach-Object { $Hakusanat[($alku + $_) % $Hakusanat.Count] }

    $ensimmainen = $true
    foreach ($sana in $valitut) {
        $url = 'https://www.bing.com/search?q={0}&form=QBLH' -f [uri]::EscapeDataString($sana)
        $argumentit = @("--profile-directory=$Profiili")
        if ($ensimmainen) { $argumentit += '--new-window' }
        $argumentit += $url
        Start-Process -FilePath $edge -ArgumentList $argumentit
        Kirjaa "Haku: $sana"
        $ensimmainen = $false
        Start-Sleep -Seconds $OdotusSekunteina
    }

    Set-Content -Path $Leima -Value $Tanaan -Encoding ASCII
    Kirjaa 'Valmis: 3 hakua tehty.'

    if (-not $EiRewardsSivua) {
        # Rewards-sivu jaa auki, jotta paivan kortit voi klikata itse.
        Start-Process -FilePath $edge -ArgumentList @("--profile-directory=$Profiili", 'https://rewards.bing.com/')
        Kirjaa 'Rewards-sivu avattu, Edge jatetaan auki.'
    } elseif (-not $JataAuki -and -not $olikoAuki) {
        Start-Sleep -Seconds 3
        # Suljetaan siististi (kuin ruksista), ei pakotettuna.
        Get-Process msedge -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne 0 } |
            ForEach-Object { [void]$_.CloseMainWindow() }
        Kirjaa 'Edge suljettu.'
    } elseif ($olikoAuki) {
        Kirjaa 'Edge oli jo auki ennen ajoa, joten sita ei suljeta.'
    }
    exit 0
} catch {
    Kirjaa "VIRHE: $($_.Exception.Message)"
    exit 1
}
