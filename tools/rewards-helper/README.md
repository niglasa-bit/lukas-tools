# Rewards-apuri (Edge + Bing)

Kerran päivässä, kun kirjaudut Windowsiin ensimmäisen kerran, apuri avaa Edgen
omalla profiilillasi, tekee **3 Bing-hakua** (8 s välein) ja sulkee Edgen.
Näin "Hae Bingillä" -streak ei katkea.

> **Huomio:** Microsoft Rewardsin ehdot kieltävät automatisoidut haut. Microsoft voi
> mitätöidä pisteitä tai sulkea Rewards-tilin. Käyttö on omalla vastuullasi.

## Mitä se tekee
- Odottaa verkkoa enintään 10 min (yrittää 20 s välein).
- Avaa Edgen profiililla `Default` uuteen ikkunaan ja tekee 3 hakua
  (hakusanat vaihtuvat päivän mukaan, lista skriptissä).
- Kirjoittaa päivämäärän tiedostoon `%LOCALAPPDATA%\RewardsApuri\viimeisin_ajo.txt`,
  joten saman päivän uudet kirjautumiset ohitetaan.
- Sulkee Edgen siististi. Jos Edge oli jo auki ennestään, sitä ei suljeta.
- Loki: `%LOCALAPPDATA%\RewardsApuri\loki.txt`.
- **Ei** tee "Päivittäin määritetty" -tehtäviä (3 korttia): ne klikataan itse.

## Asennus (PowerShell, tavallisena käyttäjänä)
```
cd $env:USERPROFILE\Desktop\lukas-tools\tools\rewards-helper
powershell -ExecutionPolicy Bypass -File .\asenna.ps1
```
Jos Rewards-tilisi on jossain muussa Edge-profiilissa, katso polku osoitteesta
`edge://version` (viimeinen kansio, esim. `Profile 1`) ja asenna näin:
```
powershell -ExecutionPolicy Bypass -File .\asenna.ps1 -Profiili "Profile 1"
```

## Kokeile heti
```
powershell -ExecutionPolicy Bypass -File .\rewards-apuri.ps1 -Pakota
```
`-JataAuki` jättää Edgen auki lopuksi.

## Poisto
```
powershell -ExecutionPolicy Bypass -File .\poista.ps1
```
