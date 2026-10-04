# Claude-kehityssäännöt (lukas-tools)

Sevenflow-yhtiön yhteiset käytännöt. Salasanoja tai salaisuuksia ei kirjoiteta koodiin, dokumentteihin eikä lokiin.

## Infra ja palvelimet (Niko 4.10.2026)

Koko perustelu: `/mnt/project-files/sevenflow/infra-suositus.md` (projektin jaettu kansio). Sevenflow on yhden hengen yhtiö, joten ylläpitoaika on niukin resurssi.

- **Oletus on serverless ja hallitut palvelut:** Cloudflare Workers (+ assets), D1, R2, KV; tarvittaessa hallittu Postgres EU:ssa (Neon/Supabase Frankfurt tai Tukholma, UpCloud Managed Helsinki). Uusi palvelinosa tehdään ensin näillä.
- **Ei omaa fyysistä palvelinta koskaan.** Ei myöskään omaa VPS:ää tai itse ylläpidettyä tietokantaa ilman Nikon erillistä päätöstä. Ainoa tunnistettu VPS-/konttiehdokas on Lukasin videoputken ajastettu pilviajo (ei asiakasdataa).
- **Asiakas- ja henkilödata EU:ssa:** D1 ja R2 luodaan EU-lainkäyttöalueelle, hallittu tietokanta EU-alueelle. Clauden EU-käsittely tarvittaessa Bedrockin tai Vertexin EU-alueilla (Anthropicin oma API ei takaa EU-sijaintia). Workers AI:n käsittelypaikkaa ei taata EU:hun; kirjaa se aliprosessoriksi tai vaihda EU-upotuksiin, jos asiakas vaatii.
- **Jokaisella palvelulla DPA** ja aliprosessorilista ajan tasalla ennen kuin siihen viedään asiakasdataa.
- **Varmuuskopio ja palautus:** D1 Time Travel + säännöllinen vienti R2:een; palautus testataan ennen julkaisua.
- **Siirrettävyys:** pidä tietokanta-, tiedosto-, upotus- ja mallikutsut omissa moduuleissaan, jotta toteutuksen voi vaihtaa (Docker-kuva asiakkaan omaan pilveen tehdään vasta kun asiakas sitä pyytää).
- **Kulut [Arvio] ja ylläpitotyö arvioidaan** jokaiselle uudelle palvelulle ennen käyttöönottoa; salaisuudet vain `wrangler secret`/palvelun salaisuusvarastoon.
- **Tässä repossa:** lukitus, kauppa ja Stripe-webhook pysyvät Cloudflare Workerissa + KV:ssa. Ostajien sähköpostit ovat henkilötietoa: KV/D1 EU-lainkäyttöalueelle kun mahdollista.
