# Lukasin digituotteet: tarjoajan ohje (v1, 22.10.2026)

Kenelle: sille, joka hoitaa Lukasin kaupan tilaukset, palautukset ja asiakastuen (nyt Niko, myöhemmin työntekijä tai kumppani). Ohje on kirjoitettu niin, että sen mukaan voi toimia ilman, että tuntee koodia. Tekninen asennus ja julkaisu ovat omistajan ohjeessa: `studio-api/README.md` ja `shop/README.md`. Standardi: `/mnt/project-files/sevenflow/tuote/ohjestandardi.md`.

## 1. Mitä myydään yhdellä sivulla

| Tuote | Hinta | Mitä ostaja saa |
|---|---|---|
| All-Access | 99 $ | Kaikki neljä sovellusta yhdellä ostolla |
| Money Plan Studio | 49 $ | Rahasuunnitelma yhdellä sivulla, sunnuntain 10 min tarkistus |
| The Systemized Year | 59 $ | Vuoden suunnitelma ja 12 kuukausitarkistusta |
| The Autopilot Workbook | 39 $ | Toistuvien töiden automatisointi ilman koodia; myös B2B-tiimilisenssi laskulla |
| The Enough Habit | 29 $ | 66 päivän säästötapa (piilotettu kaupasta, myydään All-Accessissa) |

Lähde: `shop/config.js` (hinnat 10.10.2026). Kertamaksu, sama ostaja voi avata kaikki ostamansa tuotteet enintään kolmella laitteella.

**Mitä tuotteet eivät ole:** ei sijoitusneuvontaa, ei henkilökohtaista valmennusta, ei tilausta (ei kuukausimaksua). Lukas on tekoälyhahmo; tuki vastaa yhtiön nimissä, ei Lukaksena.

**Kenelle:** englanninkieliset 25–40-vuotiaat, jotka haluavat rahan ja ajan järjestykseen yksinkertaisella työkalulla. Kauppa on vain täysi-ikäisille (18+).

**Myyjä:** Stripe Managed Payments, myyjänä "Sold through Link, LLC" (laskuttaa ALV:n ja tekee kuitin). Sevenflowlabs Oy vastaa tuotteesta, tuesta ja palautuslupauksesta. Ehdot: `shop/legal.html` (thesystemizedlife.com/shop/legal.html).

## 2. Tilauksesta pääsyyn (automaattinen)

1. Ostaja maksaa Stripen maksulinkissä ja hyväksyy välittömän pääsyn (14 päivän peruuttamisoikeus säilyy).
2. Stripe ilmoittaa Workerille, joka luo tilauskoodin `LK-XXXXXXXX`.
3. Kiitossivu näyttää koodin, ja ostaja saa sähköpostin: koodi, "Open the app", peruuttamislinkki.
4. Sovellus kysyy ostosähköpostin ja tilauskoodin ja lähettää kertakoodin. Laite on avattu.

Tarjoajan ei tarvitse tehdä mitään, kun tämä toimii. Tarkista päivittäin hallintasivu (luku 4), kunnes kauppa on ollut auki kuukauden.

## 3. Palautukset ja peruuttaminen

Säännöt (lähde `shop/legal.html`, kuluttajansuojalaki 6:14 a §):
- **Peruuttaminen 14 päivää:** ostaja tekee sen itse sivulla thesystemizedlife.com/shop/withdraw.html. Pääsy kyseiseen tuotteeseen päättyy heti, ostaja ja sales@sevenflowlabs.com saavat kuitin. Raha palautuu Stripen kautta automaattisesti, kun Workerilla on Stripe-avain Refunds-oikeudella.
- **Rahat takaisin -lupaus 14 päivää:** jos ostaja pyytää palautusta sähköpostilla, palauta kysymättä syytä.
- Yli 14 päivää: ei velvollisuutta. Jos tuote ei toimi, korjaa ensin (luku 5); tapauskohtainen palautus on sallittu.

Kun sales@ saa viestin **"Withdrawal LK-…: refund manual"**, automaattinen palautus ei onnistunut:
1. Stripe → Payments → hae tilauskoodilla tai sähköpostilla → Refund → koko summa.
2. Tee se viimeistään 14 päivän kuluessa peruuttamisesta (laki). Ei muuta tehtävää: pääsy on jo suljettu.

Kun ostaja pyytää palautusta sähköpostilla:
1. Stripe → Payments → ostajan maksu → Refund → koko summa.
2. Stripe ilmoittaa Workerille, joka sulkee tilauksen itse (`charge.refunded`). Muut ostetut tuotteet toimivat edelleen.
3. Vastaa pohjalla P2 (luku 7).

Takaisinveloitus (dispute) sulkee tilauksen automaattisesti. Vastaa Stripessä kiistaan: liitä ostosähköposti ja aktivointiloki hallintasivulta. Älä vastaa kiistaan, jos ostaja oli peruuttanut; silloin palauta.

## 4. Hallintasivu

Osoite: `https://lukas-studio-api.lukas-systemized.workers.dev/admin`. Kirjoita hallintatunnus, kun sivu kysyy (tunnus on Nikolla salasanavarastossa; sitä ei kirjoiteta tähän eikä viesteihin).

Mitä sivulla tehdään:
- **Hyväksy (approve):** ostaja, jonka aktivointi tuli ennen kuin osto synkronoitui. Tarkista, että sähköposti löytyy Stripestä, ja hyväksy oikea tuote.
- **Poista laite:** ostaja on vaihtanut puhelinta ja kolme laitetta on täynnä. Poista vanhin.
- **Revoke:** poistaa ostajan kokonaan (kaikki tuotteet ja laitteet). Käytä vain tietojen poistopyyntöön tai väärinkäyttöön (koodi jaettu laajasti), ei tavalliseen palautukseen, joka sulkee vain yhden tilauksen itsestään. Kirjaa syy.
- **Lisää tiimi:** B2B-lisenssi (luku 6).
- Tilauksen rivillä näkyy "withdrawal" ja palautuksen tila (refunded / manual / failed).

## 5. Tuki: tavalliset tilanteet

Tukiosoite on sales@sevenflowlabs.com; ostajat vastaavat myös ostosähköpostiin. Vastaa arkipäivänä 1 päivän sisällä [Arvio, tavoite].

| Ostaja kirjoittaa | Tee näin | Pohja |
|---|---|---|
| "En saanut koodia" | Katso roskaposti; hae hallintasivulta ostajan sähköposti. Jos tilaus on, lähetä tilauskoodi; kertakoodin hän pyytää sovelluksesta uudelleen. | P1 |
| "Kirjoitin väärän sähköpostin" | Pyydä tilauskoodi ja Stripen kuitti; vastaavuus Stripestä. Hyväksy oikea sähköposti hallintasivulla. | P1 |
| "Laitteita on liikaa" (3 täynnä) | Poista vanhin laite hallintasivulla. | P3 |
| "Sovellus ei aukea / tyhjä sivu" | Pyydä sulkemaan sovellus kokonaan ja avaamaan uudelleen (välimuisti). Jos ei auta: selain ja laite, kuvakaappaus; vie omistajalle (luku 8). | P4 |
| "Haluan rahat takaisin" | Luku 3, palauta. | P2 |
| "Haluan peruuttaa" | Ohjaa peruuttamissivulle tai tee palautus itse ja kirjaa peruuttaminen. | P2 |
| "Saanko laskun yritykselle?" | Kuitin tekee Link (Stripe). Yritysostaja: Autopilot-tiimilisenssi laskulla (luku 6). | – |
| "Poistakaa tietoni" | Hallintasivu → Revoke ostajan rivillä, ja vahvista. Kirjanpitoon liittyvät maksutiedot jäävät Stripeen lain mukaan. | P5 |
| Kysymys rahasta, sijoittamisesta tai verosta | Emme anna henkilökohtaista neuvontaa. Ohjaa tuotteen sisältöön. | P6 |

## 6. B2B-tiimilisenssi (Autopilot Workbook)

1. Tarjous sähköpostilla (hinta Nikon päätöksen mukaan; ei listahintaa vielä), 50 % ennakko B2B-käytännön mukaan.
2. Kun lasku on maksettu: hallintasivu → Add a team: yrityksen nimi, sopimus- tai laskunumero (vähintään 8 merkkiä), päättymispäivä, yksi sähköposti riville.
3. Lähetä yhteyshenkilölle ohje: työsähköposti + sopimusnumero + sähköpostin koodi, enintään 3 laitetta per henkilö.
4. Lisää tai vähennä paikkoja lisäämällä tiimi uudelleen. Lopetus: End team licence.

## 7. Vastauspohjat (englanniksi, ostajat ovat englanninkielisiä)

Allekirjoitus aina: "The Systemized Life support · Sevenflowlabs Oy". Ei katuosoitetta eikä puhelinnumeroa ennen kuin Niko on päättänyt kaupan avauksessa.

- **P1 koodi:** "Hi {name}, your order code is {LK-…}. Open the app, enter the email you bought with and this code, and we'll send a one-time code to that email. If it doesn't arrive in a few minutes, check spam."
- **P2 palautus:** "Hi {name}, done: we've refunded {product} in full. Depending on your bank it shows up in 5–10 days. Access to that product has ended; anything else you bought keeps working. Thanks for trying it."
- **P3 laitteet:** "Hi {name}, we removed your oldest device ({device}). You can now open the app on the new one with your email and order code."
- **P4 ei aukea:** "Hi {name}, sorry about that. Please close the app fully and open it again. If it's still blank, tell us your browser and device and send a screenshot, and we'll fix it."
- **P5 tietojen poisto:** "Hi {name}, we've deleted your account and devices. Payment records stay with our payment provider for as long as accounting law requires."
- **P6 neuvonta:** "Thanks for asking. We can't give personal financial advice, but the {section} in the app walks through exactly this step by step."

## 8. Kun et osaa vastata

1. Vastaa ostajalle saman päivän aikana: "Thanks, we're looking into it and will get back to you by {day}."
2. Vie asia omistajalle: ketju "Lukasin kauppa, blogi ja SEO" tai sales@-viestin välitys. Liitä tilauskoodi, ei salasanoja eikä korttitietoja.
3. Laki- tai ehtokysymys (esim. reklamaatio, viranomainen, takaisinveloitus, jossa ostaja vetoaa lakiin): lakitarkastaja-ketju.
4. Häiriö (moni ostaja ei pääse sisään): omistaja tarkistaa Workerin; poikkeamaohje `/mnt/project-files/sevenflow/laatu/`.

## 9. Rajat

- Ei luvata tulevia tuotteita, päivityksiä tiettyyn päivään eikä tuloksia ("säästät X €").
- Ei markkinointia ostajille ilman uutiskirjeen suostumusta (double opt-in). Ostosähköposti ei ole markkinointilupa.
- Asiakastiedot vain hallintasivulla ja Stripessä; ei kopioita taulukoihin.
- Esimerkeissä vain geneeristä dataa.

## 10. Ennen kuin tämä ohje on käytössä

Kauppa aukeaa vasta Stripe-tilin jälkeen. Tarkista avauspäivänä: maksulinkit `shop/config.js`:ssä, Workerin Stripe-avain Refunds-oikeudella, testiosto ja testipalautus (studio-api/README.md luku 3 kohta 5), katuosoite ja puhelinnumero ehtoihin (Nikon päätös). Korjaa ohje ensimmäisen oikean tukitapauksen jälkeen.
