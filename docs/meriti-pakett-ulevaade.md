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
| Kapitalirent (ka käibemaksulaenuga) | kandemall „Kapitalirendi lühiajaline osa“ (pikaajalisest lühiajaliseks); ostuarve tasumine kohustise kontoga | 2 ✔ (mall), 4 (ostuarve) |
| Finantsinvesteeringud | kandemallid väärtuse tõusuks ja languseks (RTJ 3 õiglane väärtus); koguseline arvestus laos | 2 ✔ (mallid), 8 (ladu) |
| Proportsionaalne KM, sõiduauto | KM-kood „Sõiduauto 50%“ ja mahaarvatav osa; kandemall „Sisendkäibemaksu korrigeerimine“ (KMD rida 10) | 1 ✔, 2 ✔, 6 (KMD) |
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
