# Meriti materjalide ülevaade ja edasine plaan

Allikas: kasutaja üles laaditud pakett (51 faili, 08.10.2026): 45 Merit Aktiva kasutusjuhendit,
API kaart (`Merit_Aktiva_API_kaart.md`, kõik 124 API lehte), impordifailide näidised (kliendid,
tarnijad, artiklid, põhivarad, algsaldod) ja mobiilirakenduste juhendid.

Materjale kasutame **funktsionaalse eeskujuna**: mida raamatupidaja vajab ja millised Eesti
erijuhud peavad olema kaetud. Disaini, tekste ega struktuuri üle ei võta (CLAUDE.md p 1 ja 4).

## Peamised järeldused

1. **Kõik käib kannete kaudu.** Iga dokument (arve, makse, laoliikumine, amortisatsioon, KMD)
   tekitab pearaamatu kande ja aruanded loetakse kannetest. Seepärast ehitasime faasis 1 kõigepealt
   kontoplaani, käibemaksud ja kandemootori (`postJournalEntry`) koos kõigi kontrollidega.
2. **Käibemaksumäärade muutus on Meritis käsitöö.** 2024. ja 2025. aasta määramuutuste juhendid
   kirjeldavad „Käibemaksu määra muutmise“ nuppu artiklitel, perioodilistel arvetel, kontoplaanis ja
   põhivara gruppidel. LILY SOKID-is on määr kehtivusperioodidega, nii et uue määra jaoks lisatakse
   üks periood ja kõik dokumendid valivad määra kuupäeva järgi. Dokument salvestab kasutatud määra
   (ettemaksu ja kreeditarve erijuhtudel jääb võimalus valida vana määr – faas 3).
3. **Süsteemsed kontod.** Programm vajab kindlaid kontosid (laekumata arved 1200, võlad tarnijatele
   2110, ettemaksud, aruandvad isikud, ümardused, kursivahed, KM arveldus, jaotamata kasum,
   aruandeaasta kasum). Need on meil `AccountRole` kaudu seotud ja kaitstud.
4. **Aruandeaasta kasumi kontole kandeid ei tehta**; algsaldode sisestamisel tuleb aasta keskel
   alustades sisestada ka tulu- ja kulukontode saldod. Rakendatud.
5. **Dimensioonid:** projekt ja kulukoht vaikimisi, lisaks piiramatult dimensioone, üldised ja
   detailsed, lõpukuupäevaga väärtused, „summa deebetis positiivne“, kohustuslikkus konto kaupa.
   Rakendatud andmemudelis ja kandemootoris.
6. **API** (faas 10): kõik päringud POST + HMAC-SHA256 allkiri, 100 päringut/min, kuni 500 rida
   dokumendis. Ühilduv liides võiks lihtsustada üleminekut olemasolevatelt Meriti integratsioonidelt
   (nt e-poe pluginad) – see on valikuline otsus, mille teeme faasis 10.
7. **Impordiformaadid** (kliendid, tarnijad, artiklid, põhivarad, algsaldod, müügi- ja ostuarvete
   algsaldod) annavad hea veergude loetelu meie impordile (faas 10). Pearaamatu algsaldode CSV
   import (veerud Konto, Deebet, Kreedit) on tehtud juba faasis 1.

## Mis on faasis 1 tehtud

| Valdkond | Tulemus |
|---|---|
| Ettevõtte andmed | aadress, kontaktid, dokumentide keel; liik, kasumiaruande skeem, arvestuse algus |
| Kontoplaan | Eesti äriühingu vaikekontoplaan (100 kontot), bilansi ja kasumiaruande (skeem 1) read, detail- ja koondkontod, makseviisid, kohustuslik osakond/dimensioon, süsteemsete kontode kaitse |
| Käibemaksud | 10 vaikimisi koodi (24/22/20% ajalooga, majutus 9→13%, 9%, 0% eksport, 0% EL kaup, EL teenus, maksuvaba, pöördmaksustamine, sõiduauto 50%, mittekäive), kehtivusperioodid, KM kontod, märge arvel |
| Majandusaastad | lisamine, muutmine (kuni 18 kuud, kattuvuse kontroll), sulgemine/avamine järjekorras, perioodi lukustamine kuupäevani |
| Numbriseeriad | 8 dokumendiliiki, eesliide, nullidega täitmine, aastapõhine numeratsioon, atomaarne järgmise numbri võtmine |
| Valuutad | ettevõtte valuutad, EKP 90 päeva kursside laadimine, käsitsi kurss |
| Dimensioonid | osakonnad, dimensioonid (üldine/detailne), väärtused lõpukuupäevaga |
| Algsaldod | tabel tasakaalu kontrolliga, CSV import, salvestamine ühe kandena arvestuse algusele eelneva päeva seisuga |
| Kandemootor | tasakaal, kontode/osakondade/dimensioonide kontroll, suletud ja lukustatud periood, numeratsioon, dimensioonid kanderidadel |

## Edasine plaan (täpsustatud Meriti materjalide põhjal)

| Faas | Sisu | Meriti juhenditest lisandunud detailid |
|---|---|---|
| 2 | Pearaamat: käsitsi kanded, storno, kandemallid, pearaamat, käibeandmik, päevaraamat | kande koodid allika järgi (müük, ost, pank, kassa, tasaarveldus …), kande numbrite ümberjärjestamine |
| 3 | Müük: kliendid, artiklid, müügiarved (PDF, e-post), kreeditarved, pakkumised | viitenumber 7-3-1 (valmis), ettemaksuarve ja selle tasaarvestus lõpparvel, kreeditarve algse arve määraga, arve kujundus, kliendi võlasaldo arvel, failide lisamine |
| 4 | Ost: tarnijad, ostuarved, kinnitamata ostuarved, kuluaruanded | kinnitusring, kulude periodiseerimine, ühendusesisene soetamine (pöördkäibemaks), proportsionaalne KM, sõiduauto 50% |
| 5 | Maksed: pangad, kassad, sidumine, camt.053, pain.001, kassaraamat | tasaarveldused (ka maksudega), väikesaldode mahakandmine, valuutasaldo ümberhindlus, panga teenustasude automaatkanne |
| 6 | Aruanded: bilanss, kasumiaruanne, KMD + KMD INF, võlgnevused, käibeandmikud, töölaud | KMD sulgemiskanne, KMD INF A/B (piir 1000 € partneri kohta), ühendusesisese käibe aruanne, OSS, kontrollaruanne rea kaupa, majandusaasta sulgemiskanne |
| 7 | Perioodilised arved, saldoteatised, meeldetuletused, viivised | näidupõhised perioodilised arved, massiline määramuutus pole vajalik (kehtivusperioodid), makselink e-kirjas |
| 8 | Ladu | mitu ladu, toodangu arvelevõtmine, kulude jagamine soetushinnale, omahinna ja koguse ümberarvestus |
| 9 | Põhivara | grupid (meetod, määr, kontod), asukohad ja vastutajad, import |
| 10 | Koondvaade, audit log, import, arhiveerimine, API, e-arved | e-arvete operaatorid, impordiformaadid, API allkirja skeem |

## Erijuhud (kasutaja otsus 08.10.2026: võtame sisse)

| Erijuht | Kus ja kuidas | Faas |
|---|---|---|
| Kapitalirent (ka käibemaksulaenuga) | kandemall „Kapitalirendi lühiajaline osa“ (pikaajalisest lühiajaliseks); ostuarve rida kohustise kontole (2020/2710) | 2 ✔, 4 ✔ |
| Finantsinvesteeringud | kandemallid väärtuse tõusuks ja languseks (RTJ 3 õiglane väärtus); koguseline arvestus laos | 2 ✔ (mallid), 8 (ladu) |
| Proportsionaalne KM, sõiduauto | KM-kood „Sõiduauto 50%“ ja mahaarvatav osa (ostuarvel ja kuluaruandes mitte mahaarvatav osa kulusse); kandemall „Sisendkäibemaksu korrigeerimine“ (KMD rida 10) | 1 ✔, 2 ✔, 4 ✔, 6 (KMD) |
| Kasutatud kauba ja reisiteenuste erikord (marginaalimaksustamine) | KM liik „kasuminormi erikord“ (koodid KAS ja REIS), arvel KM-i ei näidata, maks arvutatakse juurdehindlusest (soetushind real) | 3 ✔, 4 (ost) |
| Tax-free müük | kinnitatud arvest „Tax-free korrigeerimine“: kreeditarve tühistab maksustatava käibe ja lisab 0% ekspordi, KM tagastatakse | 3 ✔, 6 (KMD) |
| Faktooring | faktooringu ettemaksete konto, tasaarveldus kliendi ja faktooringuandja vahel | 5 |
| Korteriühistu | KÜ kontoplaan ja aruanded, näidupõhised perioodilised arved, laenud | 7 |
| FIE ja MTÜ | eraldi kontoplaanid ja aruannete skeemid (tulemiaruanne) | 6 |
| Avalik sektor | eraldi kontoplaan ja klassifikaatorid (tehingupartner, tegevusala, allikas, rahavoog), saldoandmike eksport | 11 (eraldi faas) |

## Faas 2 (pearaamat) – tehtud

- Käsitsi kanded: mustand → postitamine (kontroll ja number alles postitamisel), muutmine ainult mustandina,
  storno (uus kanne vahetatud pooltega, mõlemad seotud), kopeerimine, mustandi kustutamine.
- Sisestus klaviatuuriga: konto valik koodi või nime järgi, Enter liigub järgmisele reale, uus rida
  pakub tasakaalustavat summat, Ctrl+S salvestab, Ctrl+Enter postitab; osakond, dimensioonid ja KM
  lisaveergudes (kohustuslikud ilmuvad ise).
- Kandemallid: ettevõtte oma mallid (salvesta mallina) ja 12 valmis malli, sh erijuhud.
- Kannete nimekiri: otsing, filtrid, lehekülgedeks jagamine, eelvaade kõrval (split view), printimine.
- Aruanded: käibeandmik (alg- ja lõppsaldo, käive, vahesummad), pearaamat (jooksev saldo, link kandele),
  päevaraamat; filtrid perioodi, konto, osakonna ja dimensiooni järgi; CSV eksport (Exceli jaoks).
- Tulu- ja kulukontode saldo algab igal majandusaastal nullist, varasemate aastate tulem kajastub
  jaotamata kasumis (sulgemiskanne tehakse faasis 6).

Hiljem: korduvad kanded (faas 7), kande numbrite ümberjärjestamine ja manused (faas 4 koos failidega).

## Faas 3 (müük) – tehtud

- **Kliendid**: põhiandmed, eraisik, riik, kontaktid, koopia saajad, maksetähtaeg ja viivis kliendi kaupa,
  dokumentide keel ja valuuta, püsiviitenumber, vaikimisi käibemaks (nt EL teenuste klient), kliendigrupid.
- **Artiklid** (ühised ostuga): kaup/teenus, ühik, müügi- ja ostuhind, käibemaks, tulu- ja kulukonto, grupid.
  Kasutatud artiklit ei kustutata, vaid see muudetakse passiivseks.
- **Müügiarve**: mustand → kinnitamine. Kinnitamisel arvutatakse summad uuesti, antakse number
  numbriseeriast, viitenumber (7-3-1, arve numbrist või kliendi püsiviide) ja tehakse kanne
  (D 1200 / K tulu KM koodiga / K 2300). Kinnitatud arvet muuta ei saa.
- **Käibemaks**: määr kuupäeva järgi kehtivusperioodidest; arvutus määra kaupa dokumendi tasemel,
  jaotus ridadele täpselt (kanne ja KMD); hinnad KM-ga või ilma; allahindlus real.
- **Kreeditarve** kinnitatud arvest algse arve määraga; kreeditarve ei saa ületada krediteerimata osa.
- **Ettemaksuarve** (ettemaksete konto 2500 koos KM-ga) ja selle mahaarvamine lõpparvel
  („Arvesta ettemaks maha“ – ettemaksuarve määraga, avatud jääk jälgitakse).
- **Valuutaarve**: EKP kurss arve kuupäeval (või käsitsi), kanne eurodes.
- **Erijuhud**: kasuminormi erikord (kasutatud kaup, reisiteenus) ja tax-free korrigeerimine.
- **Pakkumised**: olekud (koostamisel, saadetud, vastu võetud, tagasi lükatud, arve tehtud), pakkumisest
  arve mustand ühe klikiga.
- **PDF** (@react-pdf/renderer, Noto Sans – ka kirillitsa) kliendi keeles; arve värv, pangarekvisiidid,
  märkus ja jalus arve seadistuses.
- **E-post** (Resend) PDF-manusega: muudetav saaja, koopia, teema ja tekst kliendi keeles; saatmise logi
  arve juures (EmailLog); piirang 60 kirja tunnis ettevõtte kohta.
- Käsupalett otsib arveid, pakkumisi, kliente ja artikleid; kiirtoimingud „Uus müügiarve“, „Uus klient“,
  „Uus pakkumine“. Pearaamatu kandest saab avada arve.

Hiljem: laekumised ja arve tasumise seis (faas 5), kliendi võlasaldo arvel ja müügiaruanded (faas 6),
perioodilised arved, meeldetuletused ja viivised (faas 7), manused (faas 4), e-arved (faas 10).
Kasuminormi erikorra KMD read (maksustatav väärtus = KM × 100 / määr) arvutatakse faasis 6.

## Faas 4 (ost) – tehtud

- **Tarnijad** (+ grupid): arvelduskonto (IBAN kontrollsummaga), püsiviitenumber, maksetähtaeg, vaikimisi
  kulukonto ja käibemaks (nt EL teenuse pakkuja), valuuta.
- **Ostuarve**: tarnija arve number (sama tarnija sama numbrit ei saa kaks korda kinnitada), sisemine
  registreerimisnumber (OA-1 …) kinnitamisel, kanne D kulu / D sisend-KM / K võlad tarnijatele.
  Konto valik: rea oma → artikli kulukonto → tarnija vaikimisi → ettevõtte vaikimisi.
- **Käibemaks ostul**: mahaarvatav osa koodi järgi (sõiduauto 50% – ülejäänu kulusse); pöördmaksustamine
  EL teenustele, EL kaubale ja siseriiklikule pöördmaksustamisele – ostja arvestab KM standardmääraga
  (D sisend-KM / K arvestatud KM), võlg tarnijale ilma KM-ita.
- **Tarnija kreeditarve** kinnitatud ostuarvest; valuutaarve kanne eurodes.
- **Kinnitamata ostuarved**: PDF/foto üleslaadimine (lohistades, failivalikust või mobiilis kaamerast), iga fail
  saab mustandi, mida täidetakse faili eelvaate kõrval ja kinnitatakse.
- **Manused** (Vercel Blob; kui `BLOB_READ_WRITE_TOKEN` puudub, andmebaasis): ostuarvetel, kuluaruannetel ja
  müügiarvetel; allalaadimine õigusi kontrolliva aadressi kaudu; kinnitatud dokumendi manust ei kustutata.
- **Ostutellimused**: olekud, tellimusest ostuarve mustand.
- **Kuluaruanded** ja aruandvad isikud: tšekid brutosummaga, KM eraldatakse tšeki kuupäeva määraga,
  kanne D kulud / D sisend-KM / K võlad aruandvatele isikutele (2410).
- Käsupalett otsib ostuarveid ja tarnijaid; kiirtoimingud „Uus ostuarve“, „Laadi üles ostuarve“, „Uus kuluaruanne“.

Hiljem: ostuarvete tasumine ja maksekorraldused (faas 5), ostuaruanded ja võlgnevused (faas 6),
kulude periodiseerimine (faas 7 korduvate kannetena), andmete automaatne tuvastamine dokumendilt (hilisem faas).

## Faas 5 (maksed) – tehtud

- **Pangakontod ja kassad**: mitu, eri valuutades; IBAN (kontrollsummaga) ja BIC; seos pearaamatu kontoga
  (vaikimisi 1020 Pangakonto ja 1000 Kassa); „näita arvetel“ prindib IBAN-i müügiarve jalusesse; saldo pearaamatust.
- **Laekumised ja väljamaksed**: ühe maksega mitu arvet, osaline tasumine, ülejääk ettemaksuks (klient 2350 /
  tarnija 1350), lisaread suvalisele kontole (pangatasu, maks, laen). Sidumiste summa peab klappima makse summaga.
  Arve tasutud summa (`paidTotal`) uueneb ja nimekirjades on märgid „Tasutud“ / „Osaliselt tasutud“.
  Eelvaates on arve maksed ja nupp „Lisa laekumine“ / „Tasu“ / „Hüvita“ (kuluaruanne).
- **Tasaarveldus** (kliendi ja tarnija arve vastastikku, ilma pangata) ja väikesaldo mahakandmine kontole.
- **Valuutamaksed**: makse kurss maksepäeval; vahe arve kursiga läheb kursivahe kontole (FX_GAIN_LOSS).
- **Makse tühistamine** kinnitatud maksest: vastupidine kanne valitud kuupäeval, arved avanevad uuesti,
  väljavõtte rida vabaneb.
- **Pangaväljavõtte import**: camt.053 XML (kõik Eesti pangad) ja CSV (Swedbank, SEB, LHV, Luminor, Coop
  päiseridade järgi). Topeltimport välditakse panga tehinguviite järgi, väljavõtte IBAN peab klappima.
  Automaatne sobitamine: laekumisel viitenumber → arve number selgituses → nimi + summa (ülejääk ettemaksuks);
  väljamaksel olemasolev makse (maksekorraldusest) → tarnija IBAN/nimi → aruandev isik → pangateenustasu.
  Kasutaja kinnitab soovituse reahaaval või kõik korraga, saab rea käsitsi siduda (arvetega või kontole) või vahele jätta.
- **Maksekorraldused pain.001.001.03**: tasumata ostuarvetest ja kuluaruannetest, struktureeritud viitenumber
  (SCOR) + selgitus; „märgi tasutuks“ loob kinnitatud väljamaksed (või sobitatakse hiljem väljavõttelt).
- **Kassaraamat** perioodi ja kassa kaupa (algsaldo, sissetulek, väljaminek, jääk), prinditav.
- **Faktooring** käib sidumistega: laekumine faktoorilt seotakse arvega ja vahe (tasu) kontole.
- Käsupalett otsib makseid; demoandmetes on laekumised, osamakse ja tarnija tasumine pangatasuga.

Hiljem: avatud valuutasaldode ümberhindamine perioodi lõpus (faas 6/7), e-arvete koondfail panka (faas 10),
pangaliidesed otse (API) – praegu failiga.

## Faas 6 (aruanded) – tehtud

- **Bilanss** seisuga (võrdlus eelmise majandusaasta lõpuga), **kasumiaruanne skeem 1 ja 2** (võrdlus eelmise
  aasta sama perioodiga, osakonna/dimensiooni filter), **rahavoogude aruanne kaudsel meetodil**. Read tulevad
  kontode aruanderidadest; detailvaates kontod, mis viivad pearaamatusse. Kulukontole saab kontoplaanis määrata
  funktsiooni skeemi 2 jaoks (müüdud toodangu kulu / turustus / üldhaldus). Varasemate aastate tulem liidetakse
  jaotamata kasumile, jooksva aasta tulem eraldi reale. Rahavood on tuletatud nii, et kokkuvõte võrdub alati raha
  saldo muutusega (vahe kuvatakse, kui konto on valele reale seotud). CSV eksport ja printimine.
- **KMD + KMD INF** kuu kaupa ainult kannetest (`src/lib/vat/kmd.ts`): määraread (alates 01.07.2025 vormi järgi
  1 = 24%, 1¹ = 20%, 1² = 22%, 2 = 9%, 2¹ = 5%, 2² = 13%; varasemad perioodid vana vormi järgi), 0% käive (EL kaup,
  EL teenused, eksport), maksuvaba käive, § 41¹ pöördmaksustatav käive (rida 9) ja soetus (7/7.1), EL soetused
  (6/6.1) koos arvestatud KM-iga real 1/4, kasuminormi erikord (maksustatav väärtus KM summast), sisendkäibemaks
  (rida 5) sisend-KM kontode käibest, põhivara (5.2) ja osaliselt mahaarvatav sõiduauto (5.4), korrigeerimised
  10/11. **KMD INF** A- ja B-osa: partnerid, kelle arvete summa ilma KM-ita on perioodis ≥ 1000 €, erisuse koodid
  01 (§ 41¹ käive), 11 (osaline mahaarvamine), 12 (§ 41¹ soetus). **XML eksport** e-MTA vatDeclaration kujul.
  **Sulgemiskanne** kannab arvestatud ja sisend-KM saldod käibemaksu arveldusse (2320); avatud perioodis saab
  tühistada.
  - NB! e-MTA lehed polnud arenduskeskkonnast ligipääsetavad – XML-i elementide nimed ja KMD INF erisuse koodid
    tuleb enne esimest päris esitamist kontrollida e-MTA XSD ja täitmisjuhendi vastu (kõik on ühes failis).
- **Müügi- ja ostuaruanne / analüüs**: rühmitus arve, partneri, artikli/kulukonto või kuu kaupa, otsing, CSV.
- **Klientide ja tarnijate võlad**: seisuga (vanuseline jaotus: tähtaeg ees, 1–30, 31–60, 61–90, üle 90 päeva;
  arved partneri all, ettemaksud) ja **käibeandmik** (algsaldo, arved, tasutud, lõppsaldo). Tarnijate poolel ka
  kuluaruanded (aruandvad isikud).
- **Töölaud**: laekumata müügiarved ja tasumata ostuarved (kokku, üle tähtaja, nädalagraafik vanemad / 4 möödunud
  nädalat / jooksev / 3 tulevast / hiljem), kinnitamata ostuarvete arv, pangad ja kassad saldoga ning kiirlingid,
  valitud kontode käive (jooksev kuu / aasta algusest; konto juures „Näita töölaual“), KMD ja majandusaasta
  aruande tähtajad (riigipühad arvestatud). Vidinaid saab ümber järjestada ja peita (kasutaja ja ettevõtte kaupa).

Hiljem: valuutasaldode ümberhindamine perioodi lõpus ja majandusaasta sulgemiskanne (faas 7/10), majandusaasta
aruande eksport e-äriregistrisse, dimensioonide ja kassapõhised aruanded (faas 10), OSS ja ühendusesisese käibe
aruanne (VD).

## Faas 7 (perioodilised arved, saldoteatised, meeldetuletused, viivised) – tehtud

- **Perioodilised arved**: mall (klient, read, kordus 1/2/3/6/12 kuud, algus- ja lõppkuupäev, maksetähtaeg) ja
  koostamise viis: mustand / kinnitamine / kinnitamine + e-post kliendile. Kuupäevad arvutatakse alati
  alguskuupäevast (31. jääb 31-ks pärast veebruari). Kohatäited kirjeldustes ja märkuses kliendi keeles:
  `[kuu]`, `[aasta]`, `[periood]`, `[järgmine kuu]` (ka inglise kujul). „Koosta järgmine arve kohe“ ja tehtud arvete
  ajalugu; mallist tehtud arve on mallist seotud.
- **Ajastatud töö** `/api/cron/daily` (Vercel Cron, `vercel.json`, kaitstud `CRON_SECRET`-iga): koostab tähtajaks
  jõudnud perioodilised arved (ka mahajäänud, kuni 12 malli kohta), saadab need SEND-režiimis ning loob teated
  KMD tähtajast (5 ja 1 päev enne) ja majandusaasta aruande tähtajast (30 päeva enne). Vead jäävad mallile
  (`lastError`) ega peata teisi.
- **Viivised**: arvutus iga hilinenud päeva eest osamakseid ja kreeditarveid arvestades (tasumise päev loeb
  veel hilinenuks), määr arvelt (kliendi või ettevõtte seadistus). Viivisearved kliendi kaupa (oma numbriseeria
  V-, KM-ita, tulukonto seadistatav), nõutud vahemik salvestatakse – järgmine arvestus jätkub sealt.
- **Maksemeeldetuletused ja saldoteatised**: kliendid seisuga (meeldetuletusel ainult tähtaja ületanud arved,
  päevade piir), PDF kliendi keeles (saldoteatisel kinnitusosa), masssaatmine e-postiga (ka koopia saajad),
  saatmise logi ja „viimati saadetud“. E-kirja teksti saab arve seadistuses muuta (kohatäited).
- **Koondarved**: sama kliendi mitu pakkumist/tellimust → üks arve mustand, pakkumised märgitakse arveks tehtuks.
- IBAN-i veateade eristab nüüd vale pikkuse (nt puuduv pangakood) ja vale kontrollsumma.

Hiljem: näidupõhised perioodilised arved, makselink e-kirjas, saldoteatised tarnijatele (faas 10 koos e-arvetega).

## Ostuarve manused ja andmete tuvastus (kasutaja soov 09.10.2026)

- **Uuel ostuarvel saab faili lisada kohe** (lohistades, failivalikust või mobiilis kaamerast). Eelvaade tekib
  samasse aknasse vormi kõrvale juba enne salvestamist; failid salvestatakse koos arvega (mustand või kinnitus).
- **Oma eelvaade** (pdf.js) PDF-ile ja piltidele: hiireratas suumib kursori kohalt, lohistamine liigutab,
  topeltklõps suumib, nupud suurenda/vähenda/mahuta/pööra, klahvid + / − / 0. Pärast suumimist joonistatakse
  lehed uuesti suurema eraldusvõimega. Kasutusel kõigis manuste paneelides (ostuarved, kuluaruanded jm).
- **Andmete tuvastus tekstiga PDF-ist** (`src/lib/purchases/extract.ts`, brauseris): tarnija (registrikood,
  KMKR või IBAN; meie enda andmed jäetakse välja), tarnija arve nr, kuupäev, maksetähtaeg, viitenumber, summa ilma
  KM-ita, KM ja kogusumma (sildid et/en/fi/ru), KM määr summade suhtest. Tühja vormi korral luuakse rida summaga
  tarnija vaikimisi kontole. Tundmatu tarnija korral nupp „Uus tarnija“ tuvastatud andmetega. Üleslaaditud
  (ootel) arve avamisel tuvastatakse kohe.
- Skaneeritud PDF-id ja fotod (tšekid) tekstikihti ei sisalda – nende ja arve ridade/artiklite tuvastus vajab
  OCR-i või tehisintellekti teenust (järgmine samm, kasutaja otsusel).
- **AI-tuvastus (valikuline, `ANTHROPIC_API_KEY`)**: skaneeritud PDF-id ja fotod (tšekid) ning arve read – kirjeldus,
  kogus, ühik, hind, KM määr ja vastavus ettevõtte artiklitele (koodi järgi). Mudel Claude Opus 5.5 struktureeritud
  väljundiga; keeldumise korral server-side fallback. Tekstiga PDF-i loeb esmalt brauseri tuvastus, AI-d kasutatakse
  skaneeritud failide ja piltide korral automaatselt ning nupuga „Tuvasta AI-ga“. Piir 200 tuvastust päevas ettevõtte
  kohta. Fail saadetakse Anthropicu API-le – ilma võtmeta funktsioon välja lülitatud.

## Faas 8 (ladu) – tehtud

- **Laokaup** on artikli märge (ainult kaubal): kogus ja omahind arvestatakse laos; artiklile saab määrata oma
  laokonto ja müüdud kauba kulu konto (vaikimisi kontoplaani rollid 1340 ja 4000). Liikumistega artiklilt märget
  maha võtta ei saa.
- **Laod** (kood, nimi, aadress, vaikimisi ladu). Esimene ladu „Põhiladu“ tekib ise. Kasutatud ladu ei kustutata,
  vaid märgitakse mittekasutatavaks. Müügi- ja ostuarvel saab valida lao, kui ladusid on rohkem kui üks.
- **Liikumised**: sissetulek (kindla ühikuhinnaga või jooksva omahinnaga), väljaminek, ümberpaigutus ladude vahel,
  inventuur (loendatud kogus; vahe arvestuslikuga, „Täida laoseisuga“) ning müügi- ja ostuarvetest automaatselt
  tekkivad liikumised. Mustand → kinnitatud, oma numbriseeria `L-`; arvete liikumised kannavad arve numbrit.
- **Kanded**: ostuarve laokauba rida kirjendatakse alati laokontole (ostu omahind = rea summa ilma mahaarvatava
  KM-ita eurodes). Müük: D müüdud kauba kulu / K laokonto omahinnaga. Kreeditarvega tagastatud kaup tuleb lattu
  algse müügi omahinnaga. Tarnijale tagastamisel (ostu kreeditarve) kirjendatakse arve summa ja omahinna vahe kulusse.
  Käsitsi liikumised kirjendatakse valitud vastaskontole; ümberpaigutus kannet ei tee.
- **Omahind**: FIFO või kaalutud keskmine (seadistus lao lehel), artikli kaupa üle kõigi ladude. Arvutus mängib
  liikumised kronoloogiliselt läbi (sama päeva sees enne sissetulekud), seega tagantjärele sisestatud ost arvutab
  hilisemate väljaminekute omahinna ja kanded kohe ümber. „Arvuta omahind ümber“ ja meetodi muutmine uuendavad
  avatud perioodide liikumisi; suletud või lukustatud perioodi liikumisi ei muudeta. Väärtused on sentides täpsed –
  laoseisu väärtus võrdub alati liikumiste väärtuste summaga.
- **Negatiivset laoseisu ei lubata**: kontroll käib lao kaupa kogu ajaloo ulatuses (ka tagantjärele sisestatud
  väljaminek ei tohi tekitada hilisemat puudujääki), päeva lõpu seisuga.
- **Aruanded**: laoseis kuupäeva seisuga (ladude kaupa, nullseisuga või ilma) koos **lao seisu kontrolliga**
  (laoseisu väärtus vs pearaamatu laokonto saldo), kauba liikumine (algseis, liikumised jooksva seisuga, lõppseis,
  lingid dokumentidele), kaupade käibeandmik (algseis, sisse, välja, lõppseis koguste ja väärtustega) ja
  laokaupade analüüs (müüdud kogus, müügitulu, omahind, müügikate ja kate %). CSV eksport.

Lihtsustused võrreldes Meritiga: omahind on ühine kõigile ladudele (lao väärtus on selle lao liikumiste summa);
seerianumbrid, partiid, komplektid ja tootmine ei ole veel toetatud.
