import type { ReactNode } from 'react'
import type {
  BandAgreementPrintData,
  PublishingTerms
} from '../../../../main/api/schemas/band_agreement.schema'
import { PagedDocument } from '../print/PagedDocument'
import type { DocumentLang } from '../print/DocumentLanguageSelect'
import {
  NumberedSections,
  PartyLines,
  SignatureBlocks,
  type AgreementParagraph,
  type AgreementSection
} from './agreementParts'
import { germanNumberWord } from '@/lib/germanNumbers'
import { englishNumberWord } from '@/lib/englishNumbers'

// ========================================
// Publishing contract (title contract, optional exclusive annex)
// ========================================

// Wording of the model publishing agreement (2016) the user provided, which comes as a German
// and an English version, both legally reviewed: every paragraph is given in both languages
// side by side, de first. Where the model offers alternatives ("ALT:") the record's terms pick
// one; its blanks ("……", "XX%") are the record's values. Annex B (exclusive term, loan payment,
// minimum delivery, refund) prints only when the record is exclusive, each part only with its
// values. Typing errors of the model are corrected; the changes beyond that are listed in
// docs/CONTRACT_TRANSLATIONS.md. Nothing names the model's author or place.

type Data = BandAgreementPrintData & { agreement: { kind: 'publishing'; terms: PublishingTerms } }

function formatDate(iso: string | null, lang: DocumentLang): string {
  if (!iso) return lang === 'de' ? '__.__.____' : '__________'
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return iso
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    day: lang === 'de' ? '2-digit' : 'numeric',
    month: lang === 'de' ? '2-digit' : 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function formatEuro(value: number | null, lang: DocumentLang): string {
  if (value === null) return 'EUR ________'
  const amount = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)
  return `EUR ${amount}`
}

function formatPercent(value: number, lang: DocumentLang): string {
  const n = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    maximumFractionDigits: 2
  }).format(value)
  return lang === 'de' ? `${n} %` : `${n}%`
}

/** "drei (3)" / "three (3)" */
function withWord(n: number, lang: DocumentLang): string {
  return `${lang === 'de' ? germanNumberWord(n) : englishNumberWord(n)} (${n})`
}

const blank = '……………'

export function PublishingAgreementDocument({
  data,
  lang,
  letterheadUrl
}: {
  data: Data
  lang: DocumentLang
  letterheadUrl?: string
}) {
  const { agreement, band, artist, company } = data
  const terms = agreement.terms
  const tx = (de: ReactNode, en: ReactNode) => (lang === 'de' ? de : en)
  const pct = (value: number) => formatPercent(value, lang)
  const p = (key: string, content: ReactNode, unnumbered = false): AgreementParagraph => ({
    key,
    content,
    unnumbered
  })
  const right = (label: string, body: ReactNode) => (
    <>
      <strong>[{label}]</strong> {body}
    </>
  )

  const sections: AgreementSection[] = [
    {
      key: 'subject',
      title: tx('Vertragsgegenstand', 'Subject Matter of the Contract') as string,
      paragraphs: [
        p(
          'cooperation',
          tx(
            'Gegenstand dieses Vertrages ist die Zusammenarbeit der Vertragsparteien im Bereich der Publikation und verlegerischen Auswertung von Werken der Tonkunst des AUTORS (Kompositionen mit/ohne Text sowie Texte allein und Bearbeitung freier Werke, sowie Anteile davon, nachstehend auch „Werk“ oder „Werke“). Zu diesem Zweck gibt AUTOR dem VERLAG die Gelegenheit, vertragsgegenständliche Werke des Autors in allen Bereichen verlegerisch auszuwerten.',
            'The subject matter of this contract is the cooperation of the Parties in the fields of publication and exploitation of musical works of the AUTHOR (compositions with/without lyrics, lyrics on their own, adaptations of works that are public domain, as well as parts of these, hereinafter referred to as “Work” or “Works”). For this purpose, the AUTHOR authorises the PUBLISHER to exploit all contractual Works of the AUTHOR in any manner and media.'
          )
        ),
        p(
          'annex',
          tx(
            'Vertragsgegenständliche Werke sind jedenfalls die Werke gem. Anlage A.',
            'Contractual Works are in any case the Works specified in Annex A.'
          )
        )
      ]
    },
    {
      key: 'membership',
      title: tx(
        'Mitgliedschaft einer Verwertungsgesellschaft',
        'Membership in Collecting Society'
      ) as string,
      paragraphs: [
        p(
          'publisher',
          tx('Der VERLAG ist Mitglied der GEMA.', 'The PUBLISHER is a member of GEMA.')
        ),
        p(
          'author',
          tx(
            <>
              AUTOR hat die GEMA-Mitgliedsnummer <strong>{terms.authorGemaNumber || blank}</strong>{' '}
              und garantiert, dass er unbeschränktes Mitglied der GEMA ist.
            </>,
            <>
              The AUTHOR has the following GEMA membership number:{' '}
              <strong>{terms.authorGemaNumber || blank}</strong> and hereby guarantees that he is a
              full GEMA member.
            </>
          )
        )
      ]
    },
    {
      key: 'rights',
      title: tx('Rechteeinräumung', 'Grant of Rights') as string,
      paragraphs: [
        // Alternative of the model: statutory protection period or years from first release
        p(
          'grant',
          tx(
            <>
              Der AUTOR räumt dem VERLAG exklusiv, räumlich und inhaltlich unbeschränkt sämtliche
              Nutzungsrechte an den vertragsgegenständlichen Werken für sämtliche Nutzungs- und
              Verwertungsarten für die{' '}
              {terms.rightsTerm === 'years'
                ? `Dauer von jeweils ${terms.rightsYears} Jahren seit Erstveröffentlichung des jeweiligen, vertragsgegenständlichen Werkes`
                : 'Dauer der jeweils gültigen gesetzlichen Schutzfristen (einschließlich eventueller Verlängerungen)'}{' '}
              ein, soweit und solange diese nicht sowohl für den AUTOR als auch für den VERLAG von
              einer Verwertungsgesellschaft treuhänderisch wahrgenommen werden. Endet die
              Wahrnehmung der nachfolgend genannten Rechte durch eine Verwertungsgesellschaft,
              fallen diese Rechte automatisch an den Verlag bzw. wieder an den Verlag zurück. Der
              VERLAG ist berechtigt, die ihm eingeräumten Rechte ganz oder teilweise weiter zu
              übertragen und Dritten einfache oder ausschließliche Nutzungsrechte einzuräumen.
            </>,
            <>
              The AUTHOR hereby grants the PUBLISHER the exclusive worldwide unlimited rights of use
              in the contractual Works for all types of exploitation and use{' '}
              {terms.rightsTerm === 'years'
                ? `for the duration of ${terms.rightsYears} years following the initial publication of the respective contractual Work`
                : 'for the duration of the applicable statutory period of protection (including any extensions thereof)'}{' '}
              to the extent as these rights are not being collectively managed by a collecting
              society on behalf of both the AUTHOR and the PUBLISHER. In case and to the extent the
              rights management by a collecting society ceases, the PUBLISHER shall acquire any
              respective rights automatically/the rights shall revert to the PUBLISHER. The
              PUBLISHER is entitled to transfer the rights granted to him in whole or in part and to
              grant non-exclusive or exclusive rights of use to third parties respectively.
            </>
          )
        ),
        p(
          'comprises',
          <>
            {tx(
              'Die Rechteeinräumung umfasst nach Maßgabe der Bestimmungen dieses Vertrages vornehmlich, aber hierauf nicht beschränkt:',
              'The contractual grant of exclusive rights comprises in particular, but is not limited to:'
            )}
            <ol className="mt-2 list-[lower-alpha] space-y-2 pl-6">
              <li>
                {right(
                  tx(
                    'Das Recht der Vervielfältigung und Verbreitung',
                    'The Right to reproduce and distribute'
                  ) as string,
                  tx(
                    'd.h., das Recht, Vervielfältigungsstücke der vertragsgegenständlichen Werke herzustellen, gleichviel in welchem Verfahren und in welcher Zahl, und das Original oder Vervielfältigungsstück der Werke der Öffentlichkeit anzubieten oder in Verkehr zu bringen. Hierzu gehört insbesondere:',
                    'i.e. the right to produce copies of the contractual Works, irrespective of which procedure is being applied or of how many copies are made, and to offer to the general public the original or the copy of the Works or to distribute these. This comprises in particular:'
                  )
                )}
                <p className="mt-1">
                  {tx(
                    'das Recht, die vertragsgegenständlichen Werke zur wiederholbaren Wiedergabe von Bild- und/oder Tonfolgen auf Bild- und/oder Tonträger jeder Art (z.B. Schallplatten, Musikkassetten, Tonbänder, Compact Discs, CD-I, CD-ROM, CD-ROM-XA, CD-Plus, DCC, MiniDisc, DAT, DVD, Disketten, Chips, Videocassetten, Laserdiscs, MultiOpticalCompactDisc/MO-CD und sonstige Tonträger), in jeder Konfiguration und unter Anwendung aller Techniken und Verfahren (digital und analog und sonst wie) aufzunehmen, auch auf Flüssigkristallträgern, gleichviel ob es sich um eine Aufnahme einer Wiedergabe des Werkes auf einen Bild- und/oder Tonträger oder um die Übertragung des Werkes von einem Bild- und/oder Tonträger auf einen anderen handelt, sowie die hergestellten Bild- und/oder Tonträger zu vervielfältigen und in beliebiger Art und Weise entgeltlich oder unentgeltlich zu verbreiten (z.B. durch Verkauf, Vermietung, Leasing, Miete, Leihe etc.).',
                    'the right to record the contractual Works on visual and/or audio(-visual) carriers of all kinds for purposes of repeated playback (e.g. vinyl records, music cassettes, audio tapes, CDs, CD-I, CD-ROM, CD-ROM-XA, CD-Plus, DCC, MiniDisc, DAT, DVD, floppy discs, chips, video tapes, laser discs, MultiOpticalCompactDisc/MO-CD and other audio carriers) in any configuration and using any available methods and procedures (digital, analogue and other) including on liquid crystal carriers; and irrespective of whether the reproduction constitutes a recording of a performance of the Works onto a visual and/or audio(-visual) carrier or the transfer of the Works from one visual and/or audio(-visual) carrier to another; and to reproduce the visual and/or audio(-visual) carriers so created and to distribute these for consideration or free of charge (e.g. by way of sale, renting out, leasing, lending, etc.).'
                  )}
                </p>
              </li>
              <li>
                {right(
                  tx('Aufführungsrechte', 'Right of Performance and Presentation') as string,
                  tx(
                    'd.h., das Recht, die vertragsgegenständlichen Werke mit oder ohne Verwendung von Ton- bzw. Bildtonträgern (z.B. als Playback) öffentlich durch persönliche Darbietung wiederzugeben, insbesondere das Recht der Aufführung, des Vortrags und der Vorführung. Mit umfasst ist das Recht, die Aufführung außerhalb des Raumes, in dem die Wiedergabe stattfindet, durch Bildschirm, Lautsprecher, Leinwände, Multivisionswände, Laserstrahl oder ähnliche technische Vorrichtungen öffentlich wahrnehmbar zu machen.',
                    'i.e. the right to perform the contractual Works with or without the help of audio or audiovisual recordings/carriers (e.g. playback) in public by way of an individual performance, this shall in particular include the right of recitation, performance and presentation. The above shall further include the right to make the performance available outside of the premises on which it is taking place with the help of monitors, speakers, screens, multi-vision screens, laser or similar technical devices.'
                  )
                )}
              </li>
              <li>
                {right(
                  tx('Senderechte', 'Right of Broadcasting') as string,
                  tx(
                    'd.h., das Recht, die vertragsgegenständlichen Werke durch analoge wie digitale Ausstrahlung von Funksendungen (Hörfunk oder Fernsehen) und Videotextsignalen zur Videotextuntertitelung der Öffentlichkeit zugänglich zu machen. Die Ausstrahlung kann mittels terrestrischer oder nichtterrestrischer Funkanlagen, über Satelliten- und Kabelfunk unter Einschluss von Kabelweitersendungen und ähnlicher technischer Einrichtungen oder mittels einer Kombination solcher Anlagen, über Speicherzentralen oder sonst wie, unabhängig davon, in welcher Rechtsform die jeweilige Sendeanstalt betrieben wird (öffentlich oder privat, kommerziell oder nichtkommerziell) und unabhängig davon, ob und wie ein Nutzungsentgelt (Gebühr oder Pay-TV, etc.) hierfür erhoben wird, erfolgen.',
                    'i.e. the right to make the contractual Works available to the public by way of analogue or digital broadcasting (radio and television transmission), and video text signals for purposes of video text subtitling. The means of broadcasting may include – but are not limited to – terrestrial or non-terrestrial radio equipment, satellite transmission, cable transmission including cable retransmission and similar technical means as well as a combination of such devices, central storage locations or other similar means, irrespective of the legal status of the respective broadcaster (public or private, commercial or not for profit) and irrespective of whether a user fee (fee or pay-tv, etc.) is being charged.'
                  )
                )}
              </li>
              <li>
                {right(
                  tx(
                    'Das Recht der öffentlichen Wiedergabe',
                    'The Right of Communication to the Public'
                  ) as string,
                  tx(
                    'd.h., das Recht die vertragsgegenständlichen Werke mittels Tonträgern oder Bildtonträgern sowie Funksendungen der vertragsgegenständlichen Werke unter Verwendung aller technischen Systeme (z.B. über Bildschirme, Lautsprecher, Videoleinwände, Multivisionswände, Laserstrahl oder ähnliche technische Vorrichtungen) öffentlich wahrnehmbar zu machen. Mit umfasst ist das Recht, die vertragsgegenständlichen Werke auch außerhalb des Raumes, in dem die Wiedergabe stattfindet, durch Bildschirm, Lautsprecher, Videoleinwände, Multivisionswände, Laserstrahl oder ähnliche technische Vorrichtungen öffentlich wahrnehmbar zu machen.',
                    'i.e. the right to communicate the contractual Works to the public by means of audio or audiovisual recordings/carriers or broadcasts using any available technical systems (e.g. monitors, speakers, screens, multi-vision screens, laser or similar technical devices). This shall comprise the right to communicate the contractual Works to the public outside of the premises on which they are being displayed/performed by monitors, speakers, screens, multi-vision screens, laser or similar technical devices.'
                  )
                )}
              </li>
              <li>
                {right(
                  tx(
                    'Filmherstellungsrechte',
                    'Right to make a Film/Synchronization Right'
                  ) as string,
                  tx(
                    'd.h., das Recht, mit vorheriger schriftlicher Zustimmung des AUTORS die vertragsgegenständlichen Werke zur Herstellung von Filmwerken oder Laufbildern jeder Art, auch nach Ablauf der Frist des § 88 Abs. 2 UrhG, zeitlich unbeschränkt zu verwenden und wiederzuverfilmen. Die Herstellung kann unter Anwendung sämtlicher technischer Verfahren (auch unter Einschluss der Computeranimation) auf Bildtonträgern jeder Art, für gewerbliche oder nicht gewerbliche Zwecke, als Kinofilm, Fernsehfilm, Videofilm, Multimediafilm, Computergame oder zu sonstigen Auswertungszwecken (z.B. als Industriefilm, Werbefilm etc.) erfolgen. Mit eingeschlossen ist das Recht, die unter Verwendung der vertragsgegenständlichen Werke hergestellte Filmmusik in gleichem Umfang auszuwerten wie die vertragsgegenständlichen Werke selbst.',
                    'i.e. the right – always subject to the AUTHOR’s prior written approval – to use the contractual Works for purposes of production of cinematographic works and motion pictures of any kind, even after the expiry of the term of Section 88 Para 2 UrhG (Urheberrechtsgesetz – German Copyright Act), and to produce remakes of the cinematographic works and motion pictures including contractual Works. Such production may involve the application of all available technical means (including computer animation) and the storage on any available audio-visual carriers and may include productions for commercial or non-commercial purposes, as big screen motion pictures, TV movies, video films, multimedia films, computer games or for other exploitation purposes (e.g. as corporate videos, promotional videos, etc.). The above shall include the right to exploit the soundtrack that has been created using the contractual Works to the same extent as the contractual Works themselves.'
                  )
                )}
              </li>
              <li>
                {right(
                  tx('Druckrechte', 'Print Rights') as string,
                  tx(
                    'Der AUTOR räumt dem Verlag das Recht zur graphischen Vervielfältigung und weltweiten Verbreitung der vertragsgegenständlichen Werke – auch auf maschinenlesbaren Datenträgern oder anderer digitaler Form, einschließlich sogenannter Midifiles oder ähnlicher Verfahren – in handelsüblicher Form ein. Dies gilt für alle Ausgaben und Auflagen, auch getrennt für Text und Musik, jeweils auch in Verbindung mit anderen Texten bzw. Musikwerken.',
                    'i.e. the right to make graphical copies of the contractual Works (sheet music) and to distribute these worldwide in accordance with customary commercial practice – including on machine-readable data carriers or in another digital format, including midi files or similar procedures. The above shall apply to all editions and issues, also separately to lyrics and music, also in conjunction with other (third party) lyrical or musical works.'
                  )
                )}
                <p className="mt-1">
                  {tx(
                    'Der VERLAG hat ferner das Recht, auf der ganzen Welt den Vor- und Nachdruck des Werkes u.a. in Einzelausgaben, Sammlungen, Anthologien, Programmheften, Zeitungen und Zeitschriften sowohl zu erlauben als auch selbst durchzuführen und zwar auch getrennt für Text und Musik und in gekürzter Form (z.B. in einem Potpourri).',
                    'Furthermore, the PUBLISHER shall have the right to permit or to carry out himself the preprint and reprint of the Works, inter alia in single editions, collections, anthologies, programme booklets, newspapers and magazines, namely also separately for lyrics and music and also in an abridged format (e.g. in a potpourri).'
                  )}
                </p>
                <p className="mt-1">
                  {tx(
                    'Zur Vorbereitung der Druckausgaben ist der VERLAG berechtigt, entsprechende Bearbeitungen zu erstellen, Auszüge und Einrichtungen für einzelne oder mehrere Instrumente und/oder Stimmen, unwesentliche Kürzungen und geringfügige Änderungen sowie Übertragungen in andere Tonarten vorzunehmen.',
                    'For purposes of preparing the print edition, the PUBLISHER is entitled to edit respectively, to prepare extracts and to arrange the Works for one or several music instruments and/or voices, to make minor amendments and abridgments and to change the key of the Works.'
                  )}
                </p>
                <p className="mt-1">
                  {/* The model's English says "which do affect"; the German "die nicht … beeinträchtigen" is followed */}
                  {tx(
                    'Der VERLAG ist berechtigt, mit vorheriger schriftlicher Zustimmung des AUTORS Übersetzungen vertragsgegenständlicher Werke in andere Sprachen oder Mundarten sowie sonstige Bearbeitungen, die nicht das Urheberpersönlichkeitsrecht beeinträchtigen, vorzunehmen bzw. vornehmen zu lassen.',
                    'The PUBLISHER is entitled to carry out or to commission translations of the contractual Works into other languages or dialects and to carry out or to commission other types of adaptations which do not affect the AUTHOR’s moral rights, having obtained the prior written consent of the AUTHOR.'
                  )}
                </p>
              </li>
              <li>
                {right(
                  tx(
                    'Multimedia-, Datenbank- und Telekommunikationsrechte, Recht der öffentlichen Zugänglichmachung',
                    'Multimedia Rights, Data Base Rights and Telecommunication Rights; Right of making Works available to the Public'
                  ) as string,
                  tx(
                    'd.h., das Recht, vertragsgegenständliche Werke in analoge und/oder digitale elektronische Datenbanken, Datennetze (z.B. Internet, Online-Dienste) und Telefondienste oder ähnliches in jeder Auswahl und Anordnung für alle im Rahmen einer Datenbank, einem Datennetz oder Telefondienst möglichen Nutzungen zu verwenden, insbesondere dort einzuspeisen, abzuspeichern und analog oder digital zu verbreiten (einschließlich des Rechts „communication to the public“ / das Recht zur öffentlichen Zugänglichmachung), insbesondere einem beschränkten oder unbeschränkten Nutzerkreis von Datenbanken, Datennetzen oder Telefondiensten derart zur Verfügung zu stellen, dass das vertragsgegenständliche Werk von den Nutzern auf jeweils individuellen Abruf mittels Fernseh-, Computer-, Kommunikations- oder sonstiger Geräte oder über andere Übertragungswege durch individuellen Abruf zum Zwecke der akustischen und/oder optischen Wahrnehmung (einschließlich des Rechts „making available“ / das Recht der öffentlichen Zugänglichmachung) und/oder Vervielfältigung und/oder Verbreitung empfangen bzw. wiedergegeben werden kann, gleichviel ob entgeltlich oder unentgeltlich (z.B. pay-radio, music on demand, streaming, downloads etc.), und unabhängig davon, ob es sich um Mediendienste mit oder ohne interaktive Nutzungsmöglichkeiten (z.B. pay per audio, pay per view, music on demand, video on demand, streaming, downloads) oder Sender mit Programminhalten (z.B. Internet-TV, Internet-Radio) handelt. Insbesondere schließt diese Rechteeinräumung das Recht ein, das vertragsgegenständliche Werk in Form von mobilen Applikationen auszuwerten und entsprechende Kürzungen/Bearbeitungen des Werkes auch im Namen des AUTORS zu gestatten oder zu versagen, z.B. im Rahmen sogenannter „Ruftonmelodien“ oder „Ringbacktones“, z.B. Handy-Klingeltöne, monophon und auch polyphon oder unter Verwendung von original Masteraufnahmen, Smartphone-Apps sowie das Recht, die aus der vorgenannten Nutzung resultierenden Einnahmen zu inkassieren.',
                    'i.e. the right to use the contractual Works within analogue and/or digital electronic data bases, data networks (e.g. on the internet or via online service providers) and telephony or similar services, in any selection and any arrangement for all types of use possible in connection with data bases, data networks and telephony services, in particular to upload, store and distribute them in analogue or digital format (including the right to make available to the public); the above shall in particular include the provision of the Works to a limited or unlimited number of users of data bases, data networks and telephony services in a fashion which allows said users to receive or play the contractual Works using television, computer, communication or other devices or via other channels upon individual request for purposes of acoustical and/or optical perception (including the right of communication/making available to the public) and/or reproduction and/or distribution, for a consideration or free of charge (e.g. pay-radio, music on demand, streaming, downloads, etc.) and irrespective of whether the media services in question feature interactive types of use (e.g. pay per audio, pay per view, music on demand, video on demand, streaming, downloads) or are broadcasting stations with set programme contents (e.g. internet TV, internet radio). The grant of rights in particular comprises the right to exploit the contractual Works by way of mobile (including smartphone) apps and to grant or deny permission for a respective abridging/adapting of the Works also in the name of the AUTHOR, e.g. in the context of the creation of “ringtone melodies” or “ring back tones”, e.g. mobile ringtones, monophonic or polyphonic including the use of original master recordings; as well as the right to collect any revenues deriving from the aforementioned types of exploitation.'
                  )
                )}
                <p className="mt-1">
                  {tx(
                    'Der VERLAG ist auch berechtigt (wenn und soweit die entsprechenden Rechte nicht von der GEMA wahrgenommen werden), das vertragsgegenständliche Werk nach vorheriger schriftlicher Zustimmung des AUTORS vollständig oder auszugsweise mit Bildtonträgern, Datenträgern, Standbildern, Homepages, Websites, Abdrucken von Texten, Tonaufnahmen oder anderen akustischen oder optischen Elementen zu verbinden oder in Midifiles umzuwandeln und mit einer Software in Verkehr zu bringen, die dem Anwender auch eine interaktive Veränderung ermöglicht, es zu vervielfältigen und zu verbreiten, durch Herstellung von interaktiven Datenträgern (z.B. CD-ROM, CD-I, DVD) öffentlich wiederzugeben, durch Funk der Öffentlichkeit zugänglich zu machen und aufzuführen (unter Einschluss des interaktiven Fernsehens), es in Informationsspeicheranlagen und Datennetze (z.B. Internet, Online-Dienste etc.) einzuspeisen, zugänglich zu machen und zu verbreiten, welche terrestrisch, non-terrestrisch via Satellit oder per Kabel vom jeweiligen Nutzer abgerufen, gespeichert und interaktiv verändert werden können.',
                    'Subject to the AUTHOR’s prior written approval (and insofar as and to the extent to which the respective rights are not being managed by a collecting society, as e.g. GEMA), the PUBLISHER is entitled to use the contractual Works in whole or in part in connection with audiovisual carriers, data carriers, still images, homepages, websites, print editions of texts, audio recording or other acoustical or optical elements or to convert them into midi files and to distribute them by a software which allows the user an interactive modification; to reproduce and distribute the Works, to make them available to the public by way of producing interactive data carriers (e.g. CD-ROM, CD-I, DVD), to communicate them to and to perform them in public by way of broadcasting (including interactive television), to make them available and distribute them by uploading them into information memory facilities and data networks (e.g. internet, online service providers, etc.) which can be retrieved, saved and interactively modified by the respective user using terrestrial, non-terrestrial/satellite or cable means.'
                  )}
                </p>
              </li>
              <li>
                {right(
                  tx('Recht der werblichen Nutzung', 'Right to advertise') as string,
                  tx(
                    'd.h., das Recht, mit vorheriger schriftlicher Zustimmung des AUTORS die vertragsgegenständlichen Werke (einschließlich deren Werktitel) für die Dauer der vertraglichen Auswertungszeit exklusiv für gewerbliche und nicht gewerbliche Werbezwecke aller Art (z.B. für Waren und Dienstleistungen jeglicher gewerblicher und nicht gewerblicher Art, Commercials etc.) zu nutzen bzw. eine solche Nutzung durch Dritte zu erlauben.',
                    'i.e. the right, subject to the AUTHOR’s prior written approval, to use the contractual Works (including their work titles) for commercial and non-commercial advertising and promotional purposes of all kinds (e.g. for goods and services of any commercial and non-commercial kind) and/or to allow third parties such use.'
                  )
                )}
              </li>
              <li>
                {right(
                  tx('Sonstige Rechte', 'Other Rights') as string,
                  tx(
                    'Der AUTOR räumt dem VERLAG ausschließlich und ohne zeitliche und räumliche Einschränkung des Weiteren folgende Rechte ein, wobei auch diese Aufzählung lediglich beispielhaften, jedoch keinen abschließenden Charakter hat:',
                    'Furthermore, the AUTHOR grants (assigns to) the PUBLISHER the following other exclusive and worldwide rights:'
                  )
                )}
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li>
                    {tx(
                      'Der AUTOR tritt an den VERLAG die Vergütungsansprüche für erlaubnisfreie, aber vergütungspflichtige Nutzungen der vertragsgegenständlichen Werke durch Dritte, insbesondere die Ansprüche aus §§ 27, 46 Abs. 4, 47 Abs. 2, 52 Abs. 1 und 2, 52a Abs. 4, 53a Abs. 2, 54 Abs. 1 und 54a, 54b, 54c, 54e Abs. 2, 54f, 54g UrhG ab. Soweit diese Vergütungsansprüche von einer Verwertungsgesellschaft wahrgenommen werden, gilt Ziffer 3.1 ergänzend. Dem Verlag vorbehalten ist auch die Erteilung der Einwilligung nach §§ 52 Abs. 3, 52a Abs. 2, 53 Abs. 4 UrhG.',
                      'the claims to remuneration arising from uses by third parties which are permitted by law (not subject to a license/approval by the AUTHOR), but nonetheless subject to remuneration, in particular claims arising by virtue of Sections 27, 46 Para 4, 47 Para 2, 52 Para 1 and 2, 52a Para 4, 53a Para 2, 54 Para 1 and 54a, 54b, 54c, 54e Para 2, 54f, 54g UrhG. Where these claims to remuneration are managed by a collecting society, section 3.1 hereof shall apply mutatis mutandis. The PUBLISHER reserves the right to grant consent pursuant to Sections 52 Para 3, 52a Para 2, 53 Para 4 UrhG.'
                    )}
                  </li>
                  <li>
                    {tx(
                      'Das Recht, die Benutzung des vertragsgegenständlichen Werkes als Bühnenstück zu erlauben und zu verwerten (Großes Recht). Der VERLAG ist ausdrücklich berechtigt, das vorgenannte Große Recht auch zur unbeschränkten verlegerischen Auswertung auf Dritte, z.B. einen Bühnenverlag, zu übertragen.',
                      'The right to use and exploit the contractual Works for stage plays/theatrical performances (“Grand Right”). The PUBLISHER is expressly entitled to transfer such rights to third parties, e.g. stage publishers.'
                    )}
                  </li>
                  <li>
                    {tx(
                      'Den Anspruch auf Löschung bzw. Vergütung in Bezug auf Bild- und/oder Tonträger aus Schulfunksendungen sowie für Vervielfältigungen zum persönlichen oder zum sonstigen Gebrauch, soweit und solange dieses Recht nicht sowohl für den AUTOR als auch für den VERLAG durch eine Verwertungsgesellschaft verwaltet wird.',
                      'The claim to deletion or to remuneration regarding audio and/or video carriers from school broadcasts as well as for copying for private or other use, to the extent to which these rights are not being managed by a collecting society on behalf of both the AUTHOR and the PUBLISHER.'
                    )}
                  </li>
                  <li>
                    {tx(
                      'Der VERLAG ist weiter berechtigt, die in § 46 Abs. 3 UrhG (Sammlungen für Kirchen-, Schul- oder Unterrichtsgebrauch) vorgeschriebenen Mitteilungen entgegenzunehmen, die in § 62 Abs. 4 UrhG (Änderungsverbot) vorgesehene Einwilligung zu erteilen sowie alle einschlägigen Ansprüche (einschließlich der Vergütung) geltend zu machen.',
                      'The PUBLISHER is further entitled to receive the notices prescribed by Section 46 Para 3 UrhG (Collections for religious, school or instructional Use), to grant the consent within the meaning of Section 62 Para 4 UrhG and to assert any relevant claims (including such for remuneration).'
                    )}
                  </li>
                </ul>
              </li>
              <li>
                {right(
                  tx('Bearbeitung', 'Adaptation') as string,
                  tx(
                    'Der AUTOR berechtigt den VERLAG, Änderungen und Bearbeitungen der vertragsgegenständlichen Werke vorbehaltlich der vorherigen schriftlichen Zustimmung des AUTORS vorzunehmen bzw. vornehmen zu lassen. Unwesentliche Änderungen der vertragsgegenständlichen Werke einschließlich der entsprechenden Titel darf der VERLAG auch ohne Zustimmung vornehmen, soweit der AUTOR seine Einwilligung nach Treu und Glauben nicht versagen kann.',
                    'The AUTHOR hereby grants the PUBLISHER the right to create modifications and adaptations of the contractual Works, having obtained the prior written consent of the AUTHOR, or to instruct third parties to do so. The PUBLISHER may carry out minor amendments to the contractual Works including the respective titles without the AUTHOR’s consent in case the AUTHOR cannot in good faith deny such consent.'
                  )
                )}
                <p className="mt-1">
                  {tx(
                    'Dies beinhaltet insoweit auch insbesondere das Recht, mit vorheriger schriftlicher Zustimmung des AUTORS, die vertragsgegenständlichen Werke und/oder die mit den vertragsgegenständlichen Werken verbundenen Werke mit anderen oder weiteren Texten und/oder anderen oder weiteren Musikwerken sowie anderen Werken im Sinne des § 2 UrhG (z.B. Werken der Literatur) zu verbinden bzw. durch Dritte verbinden zu lassen und diese Werkverbindungen – auch nebeneinander – selbst oder durch Dritte auszuwerten. Eingeschlossen ist auch das Recht, die vertragsgegenständlichen Werke und/oder die mit den vertragsgegenständlichen Werken verbundenen Werke voneinander zu trennen und in dieser Form selbst oder durch Dritte auswerten zu lassen. Das geänderte/bearbeitete Werk darf der VERLAG dabei ebenso auswerten wie das vertragsgegenständliche Werk selbst.',
                    'The above shall in particular also comprise the right to combine the contractual Works and/or any works which have been combined with the contractual Works with other lyrics and/or other or further musical works as well as any other works within the meaning of Section 2 UrhG (e.g. literary works) or to allow third parties to do so and to exploit these combined works as well or to allow third parties to do so. This shall in addition comprise the right to separate the contractual Works and/or any works which have been combined with the contractual Works from each other and to exploit them in this “stand alone” format or to allow third parties to do so. The PUBLISHER may exploit the adapted/edited work in the same way as the contractual Work itself.'
                  )}
                </p>
              </li>
            </ol>
          </>
        ),
        // Alternative of the model: remuneration in proportion, or terms agreed later
        p(
          'unknown',
          tx(
            <>
              Der AUTOR räumt dem VERLAG die ausschließlichen Auswertungsrechte im Hinblick auf die
              vertragsgegenständlichen Werke für im Zeitpunkt des Vertragsschlusses noch unbekannte
              Nutzungsarten ein.{' '}
              {terms.unknownUses === 'market'
                ? 'Die wirtschaftlichen Konditionen für die Nutzung dieser Rechte werden zwischen den Parteien zu gegebenem Zeitpunkt zu den dann üblichen Bedingungen des Marktes präzisiert.'
                : 'Vergütung erfolgt proportional zu Konditionen des vorliegenden Vertrages.'}
            </>,
            <>
              The AUTHOR hereby grants to the PUBLISHER any exclusive exploitation rights in the
              contractual Works in relation to methods of exploitation which have not yet been known
              at the time of conclusion of this contract.{' '}
              {terms.unknownUses === 'market'
                ? 'The Parties shall clarify the financial conditions for the exploitation of these rights in due time and in the light of the then prevalent market conditions.'
                : 'The respective remuneration shall mirror the terms and conditions of the present contract.'}
            </>
          )
        ),
        p(
          'reversion',
          tx(
            'Im Rahmen der bestehenden Berechtigungsverträge der Verwertungsgesellschaften ist diese im Einzelfall verpflichtet, auf Anforderung entsprechende Rechte zur Einzelverwertung zurück zu übertragen. Der AUTOR bevollmächtigt den VERLAG hiermit, im Einzelfall von diesem Rückfallrecht Gebrauch zu machen und diese Rechte auch für den AUTOR direkt mit dem jeweiligen Verwerter auszuwerten. Der VERLAG wird insoweit berechtigt, entsprechende Direktauswertungsverträge mit den jeweiligen Verwertern abzuschließen.',
            'Pursuant to the existing membership agreements including the respective deeds of assignment of the collecting societies, the latter may, upon request in individual cases, be obliged to return certain rights to the Authors and/or Publishers for purposes of individual clearance. The AUTHOR hereby authorises the PUBLISHER to assert this reversionary interest on a case-by-case basis. The PUBLISHER is entitled to enter into direct license agreements with the relevant licensees.'
          )
        )
      ]
    },
    {
      key: 'guarantee',
      title: tx('Garantie', 'Guarantee') as string,
      paragraphs: [
        p(
          'guarantee',
          tx(
            'Der AUTOR steht dafür ein, dass er zum Zeitpunkt dieses Vertragsabschlusses durch keine anderweitigen Bindungen daran gehindert ist, diesen Vertrag zu erfüllen. Er steht insbesondere dafür ein, dass wegen anderweitig bestehender Vertragsbindungen von dritter Seite keine Ansprüche an den unter diesen Vertrag fallenden Werken erhoben werden, er anderenfalls den VERLAG von solchen Ansprüchen unbeschränkt freistellen wird. Der VERLAG hat unabhängig davon selbst das Recht, nach vorheriger schriftlicher Genehmigung durch den AUTOR oder bei Vorliegen eines rechtskräftigen Urteils etwaig von dritter Seite geltend gemachte Ansprüche zu befriedigen und die geleisteten Schadensersatzzahlungen durch Belastung mit den Autorenanteilen des AUTORS zu verrechnen.',
            'The AUTHOR hereby guarantees that at the point in time in which he enters into this contract there are no legally binding arrangements in place which would prevent him from performing the present contract. He guarantees in particular that no claims will be raised by third parties on account of existing legally binding arrangements in relation to the contractual Works, or else he will fully indemnify the PUBLISHER against such claims. Notwithstanding the above, the PUBLISHER shall have the right to satisfy such third party claims and to set off any damages paid against the claims for remuneration of the AUTHOR hereunder, provided he has obtained the prior written consent of the AUTHOR or in the case of res judicata judgements.'
          )
        )
      ]
    },
    {
      key: 'dutiesAuthor',
      title: tx('Pflichten: AUTOR', 'Duties: AUTHOR') as string,
      paragraphs: [
        p(
          'deliver',
          tx(
            'AUTOR ist verpflichtet, VERLAG die vertragsgegenständlichen Werke in verkörperter Form (z.B. Noten, Demo, etc.) zur verlegerischen Auswertung zu übergeben.',
            'The AUTHOR is obliged to provide the PUBLISHER with the contractual Works in a tangible form (e.g. notes, demo, etc.) for purposes of the contractual exploitation.'
          )
        ),
        p(
          'documents',
          tx(
            'Der AUTOR verpflichtet sich, dem VERLAG sämtliche für die verlegerische Tätigkeit erforderlichen Unterlagen, Materialien und Informationen (insbesondere Copyrightangaben, Einschaltpläne, sonstige Informationen über Auswertungshandlungen etc.) in Bezug auf die vertragsgegenständlichen Werke zur Verfügung zu stellen.',
            'The AUTHOR hereby undertakes to provide the PUBLISHER with any documentation, materials and information (including copyright notices, cue sheets and other information about exploitation activities by third parties) relating to the contractual Works necessary for the PUBLISHER in order to perform his contractual activities.'
          )
        ),
        p(
          'statutory',
          tx(
            'Sollte der AUTOR in seiner Eigenschaft als ausübender Künstler und/oder Produzent während der Vertragszeit Leistungsschutzrechte (Masterrechte o.ä.) an vertragsgegenständlichen Werken für Länder erwerben, in welchen Urheberrechtsvergütungen verhandelbar sind, so wird er ohne vorherige schriftliche Zustimmung des VERLAGES keiner Lizenzrate für die mechanische Vervielfältigung der vertragsgegenständlichen Werke zustimmen, die unter der gültigen sogenannten „statutory royalty rate“ liegt, wie sie in den entsprechenden Ländern im Rahmen der lokalen Urheberrechtsbestimmungen gilt.',
            'Should the AUTHOR acquire any ancillary copyrights in his capacity as a performing artist and/or a producer of sound recordings (master rights and the like) in sound recordings embodying contractual Works during the Term hereof in regard of countries (territories) in which copyright royalties are negotiable, he will not agree to any licence/royalty rates for the mechanical reproduction of contractual Works which fall below the “statutory royalty rates” as applicable in the respective countries by virtue of local copyright legislation without having obtained the prior written consent of the PUBLISHER.'
          )
        ),
        p(
          'address',
          tx(
            'Der AUTOR ist verpflichtet, dem VERLAG schriftlich mitzuteilen, sofern sich sein Wohnsitz oder seine Adresse ändert. Unter der zuletzt von dem AUTOR gegenüber dem VERLAG mitgeteilten Anschrift ist der VERLAG berechtigt, alle unter diesem Vertrag vorgesehenen und/oder erforderlichen schriftlichen Mitteilungen schuldbefreiend vorzunehmen.',
            'The AUTHOR is obliged to notify the PUBLISHER in writing of any changes regarding his address or place of residence. The PUBLISHER may serve any notices provided for and/or required under this contract to the last address specified by the AUTHOR to the PUBLISHER, which service shall discharge the PUBLISHER from his respective obligations.'
          )
        ),
        p(
          'death',
          tx(
            'Im Falle des Todes des AUTORS kann der VERLAG von den Erben die Vorlage eines Erbscheins, eines Testamentsvollstreckerzeugnisses oder anderer Unterlagen verlangen, die zur Klärung der Verfügungsberechtigung notwendig sind.',
            'In the event of the death of the AUTHOR, the PUBLISHER may require his heirs to produce a certificate of inheritance, the executor’s certificate (grant of probate) or other documentation which are required and suitable in order to clarify the power of disposition.'
          )
        )
      ]
    },
    {
      key: 'dutiesPublisher',
      title: tx('Pflichten: VERLAG', 'Duties: PUBLISHER') as string,
      paragraphs: [
        p(
          'exploit',
          tx(
            'VERLAG wird sich bestmöglich bemühen, sich in branchenüblicher Form und nach besten Kräften für die Auswertung der vertragsgegenständlichen Werke einzusetzen und diese durch Öffentlichkeitsarbeit bekannt zu machen. Eine Verpflichtung zur Herstellung von Noten durch den VERLAG besteht nicht; jedoch werden nach vorheriger Absprache mit dem AUTOR, sofern es wirtschaftlich vertretbar ist, die vertragsgegenständlichen Werke in Notenform gedruckt. In diesem Fall ist der VERLAG alleine berechtigt, Ausstattung, Ladenpreis und Vertriebsart aller Druckausgaben und Auflagen zu bestimmen und gegebenenfalls zu ändern.',
            'The PUBLISHER shall use his best endeavours to exploit the contractual Works as customary in the industry and to popularize them by way of pursuing public relations activities. The PUBLISHER is not obliged to print/manufacture sheet music, however, following a prior consultation with the AUTHOR, the contractual Works shall be printed as notes if such is financially viable. In this case, the PUBLISHER shall have the sole right to determine the layout, retail price, type of distribution and number of editions and to amend these where appropriate.'
          )
        ),
        p(
          'formalities',
          tx(
            'Ferner verpflichtet sich der VERLAG, soweit zum Schutz des Urheberrechtes an dem/den vertragsgegenständlichen Werken besondere Formalitäten erforderlich sind, diese in handelsüblicher Weise zu erfüllen. Für den Fall, dass ein Staat den Schutz des Urheberrechtes oder seine Erneuerung oder Verlängerung von einer Anmeldung oder Eintragung abhängig macht, so bevollmächtigt der AUTOR hiermit den VERLAG, diese entsprechend durchzuführen bzw. durch Dritte durchführen zu lassen.',
            'The PUBLISHER further guarantees that where particular formalities are required for the copyright protection of the contractual Work(s), he shall comply with such as customary in the industry. In cases a country requires an application or registration for the copyright protection or its renewal or extension to take effect, the AUTHOR hereby authorises the PUBLISHER to arrange for such or to instruct a third party to do so.'
          )
        ),
        p(
          'credit',
          tx(
            'Der VERLAG wird den AUTOR stets an der branchenüblichen Stelle als solchen nennen. Der VERLAG wird alle Werkexemplare mit dem Copyright-Vermerk nach Art. II WUA versehen und diese Verpflichtung jedem Subverlag auferlegen.',
            'The PUBLISHER shall always mention the AUTHOR as such in a manner and in places customary in the industry. The PUBLISHER shall fit all copies of the Works with a copyright notice pursuant to Art. II Universal Copyright Convention (UCC) and shall impose this obligation on any sub-publisher.'
          )
        ),
        p(
          'imprint',
          <>
            {tx(
              'Die vertragsgegenständlichen Werke werden von dem VERLAG mit nachfolgender Verlagsbezeichnung bei der GEMA angemeldet:',
              'The contractual Works shall be registered with GEMA by the PUBLISHER under the following publisher name:'
            )}{' '}
            <strong>{terms.publisherImprint || company?.name || blank}</strong>
          </>
        )
      ]
    },
    {
      key: 'earnings',
      title: tx('Erlösverteilung', 'Distribution of Earnings') as string,
      paragraphs: [
        p(
          'plan',
          tx(
            'Für die vertragsgegenständlichen Werke gelten, soweit in diesem Vertrag nicht anders geregelt, die Regelungen des Verteilungsplanes der GEMA in der jeweils geltenden Fassung. Dies bedeutet insbesondere, dass die Gesamtheit der AUTOREN aktuell im Recht der mechanischen Vervielfältigung gem. Verteilungsplan B, § 3 Ziffer 5, mit 60 % und der VERLAG mit 40 % beteiligt ist bzw. im Rahmen des Verteilungsplans A für Aufführungs- und Senderechte, § 4 Ziffer 2 f, die Gesamtheit der AUTOREN mit 8/12 und der VERLAG mit 4/12 beteiligt ist.',
            'If not provided for otherwise in this contract, the provisions of the GEMA distribution plan, as amended, apply. Pursuant to the applicable stipulations regarding mechanical reproduction, (namely) pursuant to Distribution Plan B Section 3 Number 5, the entirety of the AUTHORS of a particular work shall currently receive 60% (AUTHOR’s share) and the PUBLISHER 40% (PUBLISHER’s share); and, pursuant to Distribution Plan A – regarding the right of performance and broadcasting – Section 4 Number 2 f, the entirety of the AUTHORS of a particular work shall receive 8/12 and the PUBLISHER 4/12 (PUBLISHER’s share).'
          )
        ),
        p(
          'deviation',
          tx(
            'Sollte – aus welchen Gründen auch immer – eine Verwertungsgesellschaft von der vorstehenden Verteilung der Autoren- und Verlagsanteile abweichen wollen und insbesondere aufgrund der im Zeitrang früheren Einräumung der Rechte durch den AUTOR an die GEMA eine Beteiligung des VERLAGES ablehnen, sind sich die Parteien dennoch einig, dass unabhängig von diesem Zeitrang im Verhältnis der Parteien untereinander VERLAG in Höhe des vorstehenden Verlagsanteils an den Erlösen der Auswertung der von einer Verwertungsgesellschaft wahrgenommenen Rechte beteiligt wird. AUTOR verpflichtet sich daher, VERLAG so zu stellen, als stünden VERLAG die Ansprüche auf Zahlung der vorstehenden Verlagsanteile direkt gegenüber der Verwertungsgesellschaft zu. AUTOR tritt zu diesem Zweck seine ihm gegenüber der Verwertungsgesellschaft zustehenden Ansprüche aus der Verwertung der vertragsgegenständlichen Werke in Höhe des sich nach dem gültigen Verteilungsplan der Verwertungsgesellschaft ergebenden Verlegeranteils an VERLAG ab. VERLAG nimmt die Abtretung an. Vorsorglich ermächtigt der AUTOR den VERLAG, seine Ansprüche aus der Verwertung der WERKE gegenüber der Verwertungsgesellschaft in Höhe des sich aus dem gültigen Verteilungsplan ergebenden Verlegeranteils im eigenen Namen geltend zu machen. Sollte trotz vorstehender Vereinbarung eine Auszahlung des Verlegeranteils durch die Verwertungsgesellschaft an den VERLAG nicht erfolgen, ist AUTOR verpflichtet, gegenüber dem VERLAG über seine GEMA-Erlöse aus der Verwertung der vertragsgegenständlichen Werke regelmäßig Auskunft zu erteilen und die von der Verwertungsgesellschaft übersandten Abrechnungen in Abschrift dem VERLAG innerhalb von zehn Werktagen nach Eingang bei AUTOR zur Verfügung zu stellen. VERLAG wird auf der Grundlage dieser Auskunft den VERLAG zustehenden Anteil berechnen und AUTOR in Rechnung stellen.',
            'If – for any reason – a collecting society wishes to deviate from the distribution plan set out above and – in particular on account of a prior grant of rights to GEMA by the AUTHOR – rejects a participation of the PUBLISHER, the Parties hereto nonetheless agree that it is understood that – irrespective of the aforementioned priority – the PUBLISHER shall inter partes participate in earnings collected by the collecting society according to the PUBLISHER’s shares specified above. The AUTHOR therefore undertakes to treat the PUBLISHER as if the PUBLISHER had a claim for payment of the aforementioned share against the collecting society. For this purpose, the AUTHOR hereby assigns any claims he may have against the collecting society arising from the exploitation of the contractual Works in the amount resulting from the application of the applicable distribution plan of the collecting society. The PUBLISHER hereby accepts this assignment. As a matter of precaution, the AUTHOR hereby authorises the PUBLISHER to assert his claims arising from the exploitation of the Works against the collecting society in the amount resulting from the application of the applicable distribution plan in the PUBLISHER’s name. If, contrary to the above agreement between the parties hereto, the collecting society does not disburse the PUBLISHER’s share to the PUBLISHER, the AUTHOR agrees to disclose his GEMA earnings deriving from the exploitation of the contractual Works on a regular basis and to provide the PUBLISHER with copies of the statements received from the collecting society within 10 business days following their receipt by the AUTHOR. The PUBLISHER shall calculate the PUBLISHER’s share on the basis of the information disclosed to the PUBLISHER and shall invoice the AUTHOR respectively.'
          )
        ),
        p(
          'print',
          <>
            {tx(
              'Der AUTOR ist an den Erlösen von Druckausgaben wie folgt beteiligt:',
              'The AUTHOR shall participate in earnings stemming from print editions (sheet music) as follows:'
            )}
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                {tx(
                  `${pct(terms.printSinglePercent)} von den verkauften Notendruckausgaben als Einzelausgabe und/oder Ensembleausgabe (Endpreis abzüglich Mehrwertsteuer);`,
                  `${pct(terms.printSinglePercent)} of any print edition sold as separate editions and/or ensemble editions (final price, exclusive of VAT);`
                )}
              </li>
              <li>
                {tx(
                  `${pct(terms.printAlbumPercent)} pro rata von den verkauften Albenausgaben (Endpreis abzüglich Mehrwertsteuer);`,
                  `${pct(terms.printAlbumPercent)} pro rata from print editions sold which include any (printed) third party works (final price, exclusive of VAT);`
                )}
              </li>
              <li>
                {tx(
                  `${pct(terms.otherLicensePercent)} vom jeweiligen Ertrag bei Lizenzvergabe für sonstige bzw. zusätzliche Auswertungshandlungen, einschließlich Vergabe von Rechten am Wort, wobei im Falle der Akquisition bzw. Vermittlung vorstehender Lizenzvergaben unter Mithilfe von Agenturen deren Kosten vor Aufteilung zum Abzug zu bringen sind.`,
                  `${pct(terms.otherLicensePercent)} in any case of licensing to third parties, including the grant of rights in the lyrical works; whereas in the case of an acquisition or brokerage of the aforementioned licences with the help of agencies, the costs of the latter shall be deducted from the total prior to the distribution of the earnings.`
                )}
              </li>
            </ul>
          </>
        ),
        p(
          'direct',
          tx(
            'Erlöse aus Verwertungsverträgen aus dem Bereich des Filmherstellungs-, Multimedia-, Datenbank-, Telekommunikations-, des Großen Rechts sowie aus dem Bereich der werblichen Nutzung und der Vergabe sonstiger Rechte werden titelbezogen im Verhältnis 50 % AUTOR und 50 % für den VERLAG aufgeteilt, wobei im Falle der Akquisition bzw. Vermittlung vorstehender Verwertungsverträge durch Agenturen deren Kosten vor Aufteilung zum Abzug zu bringen sind.',
            'Earnings deriving from license agreements which are directly concluded between the PUBLISHER and a third party licensee (rights and licenses not managed by a collecting society), which may include licenses regarding the right to make a film (synchronization), multimedia rights, data base rights, telecommunication rights, Grand Rights as well as rights to use Works for advertising purposes and the grant of other rights (not managed by a collecting society) shall be split 50/50 between the AUTHOR and the PUBLISHER for each title. In case of an acquisition or brokerage of any such license agreement by agencies, the costs of the latter shall be deducted from the total prior to the distribution of the earnings.'
          )
        )
      ]
    },
    {
      key: 'subPublishers',
      title: tx('Subverlagsvergabe', 'Grant of Rights to Sub-Publishers') as string,
      paragraphs: [
        p(
          'transfer',
          tx(
            'Der VERLAG ist berechtigt, die vertragsgegenständlichen Werke grundsätzlich an ausländische Vertragspartner des VERLAGES zu übertragen. Der VERLAG ist ferner berechtigt, den ausländischen Verleger, einschließlich etwaiger ausländischer Textdichter, Übersetzer und/oder Bearbeiter, zu den dort üblichen Bedingungen an den Erträgnissen aus dem jeweiligen Vertragsausland zu beteiligen. Die Beteiligung aller Subbezugsberechtigten (Suburheber und Subverlag) darf jedoch insgesamt 50 % der betreffenden Erlöse nicht überschreiten. Der VERLAG kann den Subverlagen auch erlauben, die Musik mit einem Text in einer anderen als der Originalsprache zur Verwertung innerhalb ihres Lizenzgebietes zu verbinden unter der Voraussetzung, dass die Rechte der Originalurheber durch die Beteiligung eines Subtextdichters nicht mehr als branchenüblich geschmälert werden. Als branchenüblich gilt, was in den Verteilungsplänen der zuständigen Verwertungsgesellschaft für solche Fälle festgelegt ist. Über den Abschluss, den wesentlichen Inhalt und den Vertragspartner eines jeden Subverlagsvertrages wird der VERLAG den AUTOR auf Anfrage unterrichten. Der AUTOR kann den Vertrag einsehen.',
            'The PUBLISHER is entitled to transfer the rights in the contractual Works to foreign business partners of the PUBLISHER (Sub-Publishers). The PUBLISHER is entitled to let the foreign publisher, including any lyricists, translators and/or arrangers/adapters, participate in earnings stemming from the respective foreign territory. The participation of all sub-participants (sub-authors and sub-publishers) may not exceed 50% of the respective earnings. The PUBLISHER may allow the Sub-Publishers to add lyrics in a language different from the original language to the compositions, always provided that the rights of the original authors are not being prejudiced on account of the participation of the sub-lyricist in excess of what is customary in the industry. The latter is determined by the regulations (if any) of the respective competent collecting society. The PUBLISHER shall, upon request, inform the AUTHOR about the conclusion and essential content as well as the parties to each sub-publisher contract. The AUTHOR may peruse such contracts.'
          )
        ),
        p(
          'half',
          tx(
            'Soweit der AUTOR seinen Anteil aus der Verwertung im Subverlagsgebiet nicht über die zuständige Verwertungsgesellschaft erhält, sondern über den VERLAG, werden dessen Erlöse hälftig verteilt.',
            'In case the AUTHOR does not receive his share in the earnings deriving from exploitation activities in the sub-publisher’s territories from the competent collecting society, but from the PUBLISHER, the AUTHOR shall be entitled to 50% of the PUBLISHER’s earnings.'
          )
        ),
        p(
          'novation',
          tx(
            'Enden die Rechte des VERLAGES – gleich aus welchem Grund – vorzeitig, so bleibt die zwischen dem VERLAG und dem jeweiligen Subverlag geschlossene Vereinbarung hiervon mit der Maßgabe unberührt, dass der AUTOR anstelle des VERLAGES in die Vereinbarung eintritt, ohne bereits entstandene Verbindlichkeiten des VERLAGES zu übernehmen.',
            'If – for any reason – the rights of the PUBLISHER expire prematurely, this shall not affect any agreements concluded between the PUBLISHER and any Sub-Publisher; such contract shall (automatically) be novated to the AUTHOR subject to the condition that the AUTHOR does not assume any liabilities of the PUBLISHER arising from said agreement which are already in existence.'
          )
        )
      ]
    },
    {
      key: 'accounting',
      title: tx('Abrechnungsmodalitäten', 'Accounting Procedure') as string,
      paragraphs: [
        p(
          'semiannual',
          <>
            {tx(
              'VERLAG rechnet an den AUTOR die ihm geschuldete Vergütung halbjährlich (Stichtage: 30.06. und 31.12.) jeweils innerhalb drei (3) Monaten ab. Dies gilt für sämtliche Beteiligungen aufgrund dieses Vertrages. Grundlage der Abrechnung sind sämtliche Netto-Erlöse zu den vorgenannten Stichtagen. Abrechnungen werden von dem VERLAG grundsätzlich per E-Mail an den AUTOR übermittelt, bis auf Weiteres an folgende E-Mail-Adresse:',
              'The PUBLISHER shall render accounts about the remuneration owed to the AUTHOR on a semi-annual basis (reference dates 30 June and 31 December) within three (3) months following the reference dates. This shall apply to any participations owed pursuant to this contract. The basis of the accounts are the net earnings available on aforementioned reference dates. Accounts shall be communicated via email, until further notice to the following email address:'
            )}{' '}
            <strong>{terms.statementEmail || artist?.email || blank}</strong>
          </>
        ),
        p(
          'approved',
          tx(
            'Abrechnungen gelten als genehmigt, wenn AUTOR nicht innerhalb von zwölf Monaten nach Zugang unter Angabe von Gründen widerspricht.',
            'Accounts shall be deemed to have been approved in case the AUTHOR does not object to them within twelve months following the receipt of the former and specifies reasons for doing so.'
          )
        ),
        p(
          'bank',
          <>
            {tx(
              'Die Zahlungen erfolgen mit befreiender Wirkung auf das folgende Konto:',
              'Payments shall discharge any debt owed if remitted to the following bank account:'
            )}
            <div className="mt-1 break-inside-avoid pl-5 font-semibold leading-snug">
              <div>
                {tx('Kontoinhaber', 'Account holder')}:{' '}
                {artist?.accountHolder || artist?.name || '________________'}
              </div>
              <div>BIC: {artist?.bic || '________________'}</div>
              <div>IBAN: {artist?.iban || '________________'}</div>
            </div>
          </>
        ),
        p(
          'payout',
          tx(
            'Die Auszahlung an den AUTOR erfolgt innerhalb von 14 Tagen nach Eingang einer ordnungsgemäßen Rechnung beim VERLAG.',
            'Disbursement to AUTHOR shall take place within 14 days after PUBLISHER receives an invoice in due form.'
          )
        ),
        p(
          'society',
          tx(
            'Der VERLAG übernimmt für die Richtigkeit und Vollständigkeit der Abrechnung der Verwertungsgesellschaften keine Haftung.',
            'The PUBLISHER does not assume any liability for the accuracy and completeness of the accounts rendered by the collecting society.'
          )
        ),
        p(
          'audit',
          tx(
            'Der AUTOR ist berechtigt, nach Vereinbarung eines Termins die der Abrechnung zugrundeliegenden Unterlagen für die vorausgegangenen zwei (2) Abrechnungsperioden einmal jährlich auf seine Kosten durch einen beauftragten vereidigten Wirtschaftsprüfer während der Geschäftszeiten des VERLAGS an dessen Sitz einsehen zu lassen. Der Termin der Prüfung ist dem VERLAG rechtzeitig (14 Tage vor Prüfung) mitzuteilen. Sofern eine Prüfung eine Differenz von mehr als 5 %, mindestens jedoch EUR 1.000,–, zuungunsten des AUTORS ergibt, trägt der VERLAG die branchenüblichen und angemessenen Kosten der Prüfung bis zu einem Betrag von maximal EUR 2.500,–. Etwaige Reisekosten des Buchprüfers werden nicht erstattet.',
            'AUTHOR is entitled to have the documentation for the last two (2) accounting periods on which the accounts are based reviewed by a chartered auditor at his own expense, on the premises of PUBLISHER and during regular business hours, following the arrangement of an appointment. The date for such an appointment shall timely (14 days prior to the review) be communicated to PUBLISHER. Where a review shows a difference of more than 5%, but at the least EUR 1,000, to the disadvantage of AUTHOR, PUBLISHER shall reimburse AUTHOR for such difference, which shall carry statutory interest, and PUBLISHER shall bear the customary and reasonable costs of such review up to an amount of EUR 2,500 gross. Travel expenses of the auditor will not be reimbursed.'
          )
        ),
        p(
          'euro',
          tx(
            'Die Zahlungen erfolgen in Euro. Umsatzbeteiligungen, die von Lizenznehmern des VERLAGES in anderen Währungen bei VERLAG eingehen, werden am Tag des Zahlungseingangs in Euro umgerechnet. Zu dem jeweiligen Abrechnungsbetrag zahlt der VERLAG die jeweils fällige Umsatzsteuer, soweit der AUTOR umsatzsteuerberechtigt ist. Der AUTOR erklärt hiermit, dass er dieser Steuerpflicht unterliegt.',
            'Payments are to be made in Euro. Revenues from licensees of PUBLISHER being received in other currencies shall be converted into Euro on the date of receipt. The PUBLISHER shall, in addition to the respective amount specified in the accounts, pay any VAT due, provided that the AUTHOR is liable to VAT. The AUTHOR hereby declares that he is liable to VAT.'
          )
        ),
        p(
          'minimum',
          tx(
            'Eine Pflicht zur Auszahlung besteht erst, wenn die kumulierten Vergütungsansprüche EUR 100,– überschreiten.',
            'No disbursement obligation shall exist unless and until the aggregate claims to remuneration/participation exceed EUR 100.00.'
          )
        )
      ]
    },
    {
      key: 'taxes',
      title: tx('Steuern', 'Taxes') as string,
      paragraphs: [
        p(
          'taxes',
          tx(
            'Der AUTOR versteuert die ihm aus diesem Vertrag zufließenden Vergütungen selbst. Sofern der AUTOR der Umsatzsteuer unterliegt, werden die vertraglich vereinbarten Vergütungen (inkl. etwaiger Vorschusszahlungen) gegen ordnungsgemäße Rechnung zuzüglich der jeweils geltenden Umsatzsteuer ausgezahlt.',
            'The AUTHOR is solely responsible for his tax liabilities arising from any remuneration paid according to this Agreement. If the AUTHOR is liable to VAT, VAT shall be paid in addition to the contractual remuneration (including advance payments, if any) against a valid invoice.'
          )
        )
      ]
    },
    {
      key: 'final',
      title: tx('Schlussbestimmungen', 'Final Provisions') as string,
      paragraphs: [
        p(
          'enforce',
          tx(
            'AUTOR ermächtigt VERLAG unwiderruflich, die vertragsgegenständlichen Rechte jederzeit im eigenen Namen geltend zu machen bzw. gegen deren Verletzung im eigenen Namen vorzugehen. Sich hieraus ergebende Einkünfte (z.B. Schadensersatz oder Vergleichszahlungen) gelten als Einkünfte aus der Auswertung der Werke. Etwaige Kosten (wie Anwaltskosten und sonstige Kosten), die VERLAG im Zuge der Verfolgung von Rechtsverletzungen trägt, sind von diesbezüglichen Erlösen vor der Beteiligung von AUTOR abzugsfähig, sofern und soweit keine vollständige Erstattung durch Dritte stattfindet.',
            'AUTHOR irrevocably empowers PUBLISHER to assert the rights that are the subject matter hereof, or to take action against the infringement thereof, in PUBLISHER’s own name at any time. Any and all income therefrom (e.g. damages or settlement payments) shall be considered income from the exploitation of the Contractual Works. Any expenditures (such as lawyers’ fees and other expenditures) that PUBLISHER pays in the course of prosecuting infringement of rights are deducted from the relevant revenue before calculation of the AUTHOR’s share, if and insofar as third parties do not reimburse the entire amount.'
          )
        ),
        p(
          'notices',
          tx(
            'An AUTOR gerichtete Mitteilungen sind an die in diesem Vertrag angegebene Adresse(n) von AUTOR zu richten. Adressenänderungen (einschließlich der E-Mail-Adresse) und Änderungen der Bankverbindung werden erst verbindlich, nachdem sie VERLAG schriftlich mitgeteilt wurden. Sollten nach diesem Vertrag Zustimmungen des AUTORS erforderlich sein, gelten diese als erteilt, wenn AUTOR nicht innerhalb von drei (3) Tagen nach Zugang der Anfrage die Zustimmung verweigert.',
            'Notices to AUTHOR must be sent to the address(es) of AUTHOR as stated herein. Address changes (including changes of the e-mail address) and changes in bank account information are not considered binding until they have been communicated to PUBLISHER in writing. If AUTHOR’s consent is required pursuant to this agreement, such consent is deemed to have been given if AUTHOR does not refuse it within three (3) days after receipt of the request for consent.'
          )
        ),
        p(
          'secrecy',
          tx(
            `Die Parteien verpflichten sich hinsichtlich des Inhaltes dieses Vertrages und aller damit in Zusammenhang stehenden Informationen zur Verschwiegenheit. VERLAG verpflichtet sich darüber hinaus, über die wirtschaftlichen und persönlichen Verhältnisse sowie Vorgänge den AUTOR betreffend, welche VERLAG im Rahmen dieses Vertrages erlangt, gegenüber Dritten Stillschweigen zu bewahren. Vorstehende Verpflichtung zur Verschwiegenheit bindet beide Partner bis ${withWord(terms.confidentialityYears, 'de')} Jahre nach Vertragsende.`,
            `The Parties commit to secrecy regarding the content hereof and any information connected to it. PUBLISHER further commits to keeping the economic and personal situation and processes of AUTHOR that PUBLISHER gains knowledge of in the course of this agreement secret from any third parties. The above obligation to confidentiality shall bind both Parties for a period of ${withWord(terms.confidentialityYears, 'en')} years after the expiration of this agreement.`
          )
        ),
        p(
          'writing',
          tx(
            'Mündliche Nebenabreden bestehen nicht. Änderungen und Ergänzungen dieses Vertrages bedürfen der Schriftform. Dies gilt auch für die Abbedingung des Schriftformerfordernisses. Soweit in diesem Vertrag im Einzelfall nichts Besonderes geregelt ist, verstehen die Parteien unter Schriftform in diesem Vertrag die Textform im Sinne des § 126b BGB (z.B. E-Mail, Fax).',
            'There are no oral side agreements. No modification and amendment of this agreement shall be binding unless confirmed in writing. This shall also apply to any waiver of the requirement of written form. If and insofar as this agreement does not stipulate differently in a specific case, the Parties consider written form in this agreement to mean text form in the sense of § 126b German Civil Code (e.g. e-mail, fax).'
          )
        ),
        p(
          'equitable',
          tx(
            'Sofern für die Übertragung bzw. Einräumung von Nutzungsrechten im Rahmen dieses Vertrages die Höhe der Vergütung nicht vertraglich festgelegt ist bzw. die Gegenleistung nicht den angemessenen Branchenüblichkeiten folgt, erfolgt die Auszahlung der angemessenen Vergütung nach § 32 UrhG erst nach vollständiger Verrechnung sämtlicher Vorschusszahlungen. Gleiches gilt für Ansprüche des AUTORS auf weitere angemessene Beteiligung nach § 32a UrhG.',
            'If and insofar as the amount of remuneration for the transfer or granting of exploitation rights within the scope of this agreement is not stipulated by contract or the consideration therefor is not congruent with the reasonable and customary industry practice, equitable remuneration pursuant to § 32 UrhG shall be disbursed, but not until all advance payments have been offset in full against the amount thereof. This shall as well apply to claims of AUTHOR to further equitable participation pursuant to § 32a UrhG.'
          )
        ),
        p(
          'law',
          tx(
            'Der Vertrag unterliegt dem Recht der Bundesrepublik Deutschland. Ausschließlicher Erfüllungsort sowie ausschließlicher Gerichtsstand ist der jeweilige Geschäftssitz von VERLAG.',
            'This agreement is subject to the laws of the Federal Republic of Germany. The sole place of performance and place of jurisdiction is the place of PUBLISHER’s registered office.'
          )
        ),
        p(
          'transfer',
          tx(
            'VERLAG ist berechtigt, diesen Vertrag insgesamt oder Teile dieses Vertrages zu übertragen.',
            'PUBLISHER is entitled to transfer this agreement as a whole or in parts.'
          )
        ),
        p(
          'severability',
          tx(
            'Sollte eine Bestimmung dieses Vertrages unwirksam sein oder werden, so berührt dies die Gültigkeit des Vertrages im Übrigen nicht.',
            'If any provision of this agreement is or becomes invalid, this shall not affect the validity of the remaining agreement.'
          )
        ),
        p(
          'annexes',
          tx(
            'Auf die Anlagen wird verwiesen, diese werden wesentlicher Bestandteil dieses Vertrages.',
            'Any Annexes hereto (if any) form an integral part of this Agreement.'
          )
        )
      ]
    }
  ]

  // Not in the model: the record's special agreements, as their own section before signing
  if (agreement.specialClauses.trim()) {
    sections.push({
      key: 'special',
      title: tx('Sondervereinbarungen', 'Special Agreements') as string,
      paragraphs: [
        p('text', <span className="whitespace-pre-wrap">{agreement.specialClauses}</span>, true)
      ]
    })
  }

  const annexB = terms.exclusive ? annexBSections(terms, lang, p, tx) : []
  const works = terms.works.filter((work) => work.title.trim())

  return (
    <PagedDocument>
      {letterheadUrl && (
        <img
          src={letterheadUrl}
          alt=""
          className="mb-4 ml-auto max-h-[20mm] max-w-[60mm] object-contain"
        />
      )}

      <h1 className="mb-6 text-center text-[16pt] font-bold tracking-wide">
        {tx('VERLAGSVERTRAG (Titelvertrag)', 'PUBLISHING CONTRACT (Title Contract)')}
      </h1>

      <div className="mb-8 space-y-3 text-center text-[10pt]">
        <p>{tx('zwischen', 'between')}</p>
        <PartyLines party={artist} fallback={band.name} />
        <p>{tx('– nachstehend „AUTOR“ genannt –', 'hereinafter referred to as the “AUTHOR”')}</p>
        <p>{tx('und', 'and')}</p>
        <PartyLines
          party={company}
          fallback={tx('(Verlag nicht gewählt)', '(no publisher chosen)') as string}
        />
        <p>
          {tx('– nachstehend „VERLAG“ genannt –', 'hereinafter referred to as the “PUBLISHER”')}
        </p>
      </div>

      <NumberedSections sections={sections} />

      <SignatureBlocks
        placeDate={tx('Ort, Datum', 'Place, Date') as string}
        left={{
          role: tx('AUTOR', 'AUTHOR') as string,
          name: artist?.name ?? band.name,
          city: artist?.city ?? ''
        }}
        right={{
          role: tx('VERLAG', 'PUBLISHER') as string,
          name: company?.name ?? '',
          city: company?.city ?? ''
        }}
      />

      {/* Annex A: the contractual works */}
      <div className="mt-10 break-before-page">
        <h2 className="mb-3 text-[12pt] font-bold">
          {tx('ANLAGE A – Vertragsgegenständliche Werke', 'ANNEX A – Contractual Works')}
        </h2>
        <table className="w-full border-collapse text-[9.5pt]">
          <thead>
            <tr>
              {(lang === 'de'
                ? ['WERKTITEL', 'KOMPONIST', 'TEXTER', 'VERLAGSANTEIL']
                : ['TITLE', 'COMPOSER', 'LYRICIST', 'PUBLISHER’S SHARE']
              ).map((head) => (
                <th key={head} className="border border-black px-2 py-1 text-left">
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(works.length > 0 ? works : [null, null, null]).map((work, index) => (
              <tr key={index} className="h-[7mm]">
                <td className="border border-black px-2 py-1">{work?.title}</td>
                <td className="border border-black px-2 py-1">{work?.composer}</td>
                <td className="border border-black px-2 py-1">{work?.lyricist}</td>
                <td className="border border-black px-2 py-1">{work?.publisherShare}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {annexB.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 text-[12pt] font-bold">
            {tx(
              'ANLAGE B – Zusätzliche Vereinbarungen zwischen den Parteien',
              'ANNEX B – Additional Agreement between the Parties'
            )}
          </h2>
          <NumberedSections sections={annexB} />
        </div>
      )}
    </PagedDocument>
  )
}

/** Annex B of an exclusive contract: each part only with its values */
function annexBSections(
  terms: PublishingTerms,
  lang: DocumentLang,
  p: (key: string, content: ReactNode, unnumbered?: boolean) => AgreementParagraph,
  tx: (de: ReactNode, en: ReactNode) => ReactNode
): AgreementSection[] {
  const euro = (value: number | null) => formatEuro(value, lang)
  const pct = (value: number) => formatPercent(value, lang)
  const options = withWord(terms.options, lang)
  const sections: AgreementSection[] = [
    {
      key: 'term',
      title: tx('Exklusive Vertragsdauer', 'Exclusive Term of the Contract') as string,
      paragraphs: [
        p(
          'works',
          tx(
            'Vertragsgegenständliche Werke sind, neben den in Anlage A aufgeführten Werken, sämtliche Werke der Tonkunst, die von dem AUTOR innerhalb der exklusiven Vertragsdauer (unten ANLAGE B – Ziff. 1.2) von AUTOR geschaffen bzw. fertig gestellt wurden, und/oder alle bereits von AUTOR geschaffenen, jedoch zum Vertragszeitpunkt noch unverlegten bzw. nicht mehr verlegten Werke. Hierbei ist es unerheblich, ob diese Werke allein, in Miturheberschaft oder in Werkverbindung geschaffen wurden. Der AUTOR verpflichtet sich insoweit, keine vertragsgegenständlichen Werke der Tonkunst bei dritten Verlagen einzubringen.',
            'The contractual Works comprise, apart from the Works specified in Annex A above, any musical works which have been created or completed by the AUTHOR during the exclusive contractual term (Annex B 1.2 below) and/or any works of the AUTHOR which have already been in existence but not yet been published or no longer been published prior to the conclusion of this Agreement; whereas it is irrelevant whether these works have been solely created by the AUTHOR, jointly with co-authors or as combined works. The AUTHOR undertakes not to assign any rights in any contractual Works to third party publishers.'
          )
        ),
        p(
          'dates',
          tx(
            `Die exklusive Vertragsdauer beginnt am ${formatDate(terms.exclusiveStart, 'de')} und endet am ${formatDate(terms.exclusiveEnd, 'de')} (Mindestdauer).`,
            `The exclusive term of the contract shall commence to run on ${formatDate(terms.exclusiveStart, 'en')} and expires on ${formatDate(terms.exclusiveEnd, 'en')} (minimum term).`
          )
        )
      ]
    }
  ]
  const term = sections[0]
  if (terms.options > 0) {
    term.paragraphs.push(
      p(
        'option',
        tx(
          `Der AUTOR gewährt dem VERLAG ${options} einseitige, exklusive Option${terms.options === 1 ? '' : 'en'} auf Verlängerung dieses Vertrages um jeweils ein weiteres Jahr (Optionsperiode). Die jeweilige Option ist spätestens 4 Wochen nach Ablauf der festen Mindestdauer bzw. nach Ablauf der vorangegangenen Optionsperiode schriftlich (wobei Fax/E-Mail genügt) gegenüber dem AUTOR auszusprechen.`,
          `The AUTHOR hereby grants to the PUBLISHER ${options} exclusive option${terms.options === 1 ? '' : 's'} to extend the term of this contract by another year respectively (option period). The respective exercise of the option shall be communicated to the AUTHOR in writing 4 weeks following the expiry of the stipulated minimum term at the latest or, as the case may be, following the expiry of the preceding option period (fax/email shall suffice).`
        )
      ),
      p(
        'warning',
        tx(
          'Für den Fall, dass der VERLAG die entsprechende Option nicht fristgemäß ausgeübt hat oder nicht gegenüber dem AUTOR angezeigt hat, dass die Option nicht ausgeübt werden wird, wird der AUTOR dem VERLAG unverzüglich schriftlich mitteilen, dass die Option bisher nicht ausgeübt wurde (Optionswarnung). Der VERLAG ist dann berechtigt, die Option jederzeit sowohl vor Erhalt einer solchen Optionswarnung oder zehn (10) Werktage nach deren Erhalt wirksam auszuüben.',
          'In the event that the PUBLISHER does not exercise the respective option in due time or fails to notify the AUTHOR of the fact that he will not exercise the option, the AUTHOR shall notify the PUBLISHER without delay in writing that the option has not yet been exercised (option warning). In such cases, the PUBLISHER can exercise the option at any time prior to the receipt of the option warning as well as ten (10) business days following its receipt.'
        )
      )
    )
  }
  term.paragraphs.push(
    p(
      'extension',
      tx(
        'Sollten etwaige von VERLAG unter diesem Vertrag geleistete Darlehenszahlungen zum Ende der festen Vertragsperiode und/oder einer Optionsperiode noch nicht an den VERLAG im Wege der Verrechnung mit Tantiemen des AUTORS zurückgeführt worden sein, so verlängert sich die Mindestdauer bzw. jeweilige Optionsperiode automatisch bis zum Ende der Abrechnungsperiode, in der die Einspielung sämtlicher Darlehenszahlungen festgestellt wird, höchstens allerdings um insgesamt 2,5 (zweieinhalb) weitere Jahre in Bezug auf die feste Vertragsperiode bzw. 1,5 (eineinhalb) weitere Jahre in Bezug auf jede Optionsperiode. Das Recht zur fristlosen Kündigung aus wichtigem Grund bleibt jedoch unberührt.',
        'Should any loan payments made by the PUBLISHER under this contract not have been repaid by way of a setting off against claims for royalties of the AUTHOR at the end of the stipulated minimum term and/or an option period, the minimum term or respective option period shall automatically be renewed/extended until the end of the accounting period in which all loan payments have been paid back, however, such extension of time shall not exceed 2.5 (two and a half) years in relation to the stipulated minimum term or, as the case may be, 1.5 (one and a half) years in relation to any option period. The above shall not prejudice the right to immediately terminate this contract for cause.'
      )
    ),
    p(
      'revocation',
      tx(
        'Das Recht des AUTORS zum Rückruf der mit diesem Vertrag übertragenen Nutzungsrechte nach § 41 UrhG wegen Nichtausübung ist gemäß § 41 Abs. 1 für die Dauer von 5 Jahren ausgeschlossen. Die vorgenannte Frist beginnt mit Abschluss dieses Vertrages bzw. mit Abschluss des jeweiligen Einzeltitelautorenvertrages, sofern es sich um Werke handelt, die der Autor während der Vertragszeit geschaffen hat. Als angemessene Nachfrist im Sinne von § 41 Abs. 3 UrhG vereinbaren die Vertragsparteien einen Zeitraum von zwölf (12) Monaten. Im Falle eines Rückrufs bzw. der Kündigung ist AUTOR verpflichtet, etwaig noch nicht abgedeckte Darlehenszahlungen umgehend an Verlag zurückzuzahlen.',
        'The right of the AUTHOR to revoke the exploitation rights granted by virtue of this contract for non-exercise pursuant to Section 41 Para 1 UrhG is hereby excluded for the duration of five years. The Parties hereby agree on a period of time of twelve (12) months as a reasonable extension within the meaning of Section 41 Para 3 UrhG. In the case of a revocation or termination, the AUTHOR is obliged to immediately repay to the PUBLISHER any loan amounts that have not yet been settled/recouped.'
      )
    )
  )

  const hasLoan =
    terms.advance !== null || terms.optionAdvancePercent !== null || terms.rollingAdvance !== null
  if (hasLoan) {
    const loan: AgreementParagraph[] = []
    if (terms.advance !== null) {
      loan.push(
        p(
          'advance',
          tx(
            <>
              Für die Einräumung der vertragsgegenständlichen Rechte erhält der AUTOR auf
              Darlehensbasis von dem VERLAG die folgende, voll gegen sämtliche Autorenanteile
              verrechenbare Zahlung in Höhe von <strong>{euro(terms.advance)}</strong>.
            </>,
            <>
              In consideration for the grant of the contractual rights, the AUTHOR shall receive a
              payment in the amount of <strong>{euro(terms.advance)}</strong> from the PUBLISHER on
              a loan basis, whereas the above amount can be set off in full against any
              participation to be paid to the AUTHOR.
            </>
          )
        )
      )
    }
    if (terms.optionAdvancePercent !== null && terms.options > 0) {
      loan.push(
        p(
          'optionAdvance',
          tx(
            `Sollte der Verlag von einer Option gem. ANLAGE B – Ziff. 1.3 Gebrauch machen, so zahlt der VERLAG an den AUTOR eine weitere nicht-rückzahlbare, aber (quer-)verrechenbare Zahlung im Wege eines Darlehens in Höhe von ${pct(terms.optionAdvancePercent)} der innerhalb der letzten zwölf (12) Monate auf den AUTOR entfallenden GEMA-Autoreneinnahmen bezogen auf die unter diesen Vertrag fallenden Werke, mindestens jedoch ${euro(terms.optionAdvanceMin)} – maximal jedoch ${euro(terms.optionAdvanceMax)}.`,
            `In case the PUBLISHER exercises the option pursuant to Annex B 1.3, the PUBLISHER shall grant to the AUTHOR a further, non-repayable, but fully recoupable loan in the amount of ${pct(terms.optionAdvancePercent)} of any earnings attributed by GEMA to the AUTHOR (AUTHOR’s share) within the last twelve (12) months prior to the exercise of the option on account of any contractual Works, but at the least ${euro(terms.optionAdvanceMin)} and no more than ${euro(terms.optionAdvanceMax)}.`
          )
        )
      )
    }
    if (terms.rollingAdvance !== null) {
      loan.push(
        p(
          'rolling',
          tx(
            `Der VERLAG verpflichtet sich während der Vertragslaufzeit zudem, nach vollständiger Verrechnung der o.g. Darlehenszahlung, an den AUTOR – nach dessen Aufforderung – eine weitere nicht-rückzahlbare, aber (quer-)verrechenbare Zahlung (sog. „Rolling Advance“) im Wege eines Darlehens in Höhe von ${euro(terms.rollingAdvance)}, letztmalig jedoch zwölf (12) Monate vor Ende der Mindestdauer gem. ANLAGE B Ziff. 1.2, zu zahlen.`,
            `Always provided any earlier loan paid under this Agreement has already been fully recouped, the PUBLISHER hereby undertakes to grant another non-repayable loan to the AUTHOR in the amount of ${euro(terms.rollingAdvance)} during the contractual term, which can be set off against any earnings of the AUTHOR as specified above (“Rolling Advance”), upon the request of the latter, however, such request may only occur until twelve (12) months prior to the expiry of the minimum term set out in Annex B 1.2.`
          )
        )
      )
    }
    loan.push(
      p(
        'due',
        tx(
          'Vorstehend genannte Beträge sind innerhalb von vierzehn (14) Tagen nach Unterzeichnung der vorliegenden Vereinbarung durch sämtliche Parteien bzw. nach Optionsziehung bzw. nach Anforderung durch den AUTOR sowie nach rechtsverbindlicher Unterzeichnung der entsprechenden GEMA-Zession, allerdings erst nach der erfolgten Rückbestätigung durch die GEMA zur Zahlung fällig.',
          'The amounts specified above shall become due for payment within fourteen (14) days following the signing of the present contract by all Parties, or, as the case may be, following the exercise of an option, or following a request of the AUTHOR as well as following the legally binding signing of the GEMA assignment and the respective confirmation regarding the assignment by GEMA.'
        )
      ),
      p(
        'claims',
        tx(
          'Der VERLAG erwirbt von dem AUTOR dafür gemäß den nachfolgenden Bestimmungen seine zukünftigen Forderungen gegen die GEMA in Höhe der zu erwartenden Autorenvergütung bis zu dem/den in dieser ANLAGE B aufgeführten Betrag/Beträgen einschließlich der jeweils geltenden gesetzlichen Umsatzsteuer.',
          'In consideration thereof, the PUBLISHER shall acquire from the AUTHOR future claims of the latter against GEMA including the respective applicable VAT (if any) in accordance with the provisions set out below in the amount of the expected remuneration of the AUTHOR (the AUTHOR’s share) up until the amount(s) of loans paid by the PUBLISHER according to this Annex B.'
        )
      ),
      p(
        'vat',
        tx(
          'Der AUTOR ist gemäß den steuerlichen Bestimmungen verpflichtet, bei Eingang der GEMA-Autorenvergütungen die in den GEMA-Abrechnungen ausgewiesene Umsatzsteuer an das für ihn zuständige Finanzamt abzuführen. Ansprüche gegen VERLAG bestehen diesbezüglich nicht.',
          'Pursuant to applicable tax legislation, the AUTHOR is obliged to pay the VAT (if any) specified in the GEMA accounts to the competent tax authority upon receipt by PUBLISHER of the relevant AUTHOR’s earnings from GEMA. The PUBLISHER does not assume any liability for the above.'
        )
      ),
      p(
        'assignment',
        tx(
          'Der AUTOR wird mit Unterzeichnung dieses Vertrages sowie bei Fälligkeit einer etwaigen weiteren Zahlung eine den Formerfordernissen der GEMA entsprechende Zessionserklärung zugunsten des VERLAGES unterschreiben. Der AUTOR versichert VERLAG gegenüber ausdrücklich, dass sein Konto bei der GEMA unbelastet, d.h. frei von Rechten Dritter ist, und dass insbesondere keine weiteren Abtretungen, Verpfändungen oder ähnliches gegenüber der GEMA im Hinblick auf seine Autorenerlöse vorliegen. Für den Fall, dass diese Zusicherung nicht zutrifft und vorrangige Forderungen bei der GEMA bestehen, ist der VERLAG berechtigt, den vorgenannten Betrag entweder ganz oder teilweise zurückzufordern bzw. von der nächsten an den AUTOR fällig werdenden Zahlung abzuziehen. Darüber hinausgehende Schadensersatzansprüche bleiben ausdrücklich vorbehalten.',
          'The AUTHOR shall sign a deed of assignment for the benefit of the PUBLISHER which corresponds with the formal requirements of GEMA upon signing the present contract as well as upon possible further claims for loan payments by the PUBLISHER becoming due for payment upon the PUBLISHER’s exercise of an option. The AUTHOR hereby expressly guarantees towards the PUBLISHER that his GEMA account is unencumbered, i.e. free from third party rights, and that his claims to remuneration against GEMA are not subject to any further assignment, pledge or similar encumbrances. In the event that this guarantee proves to be untrue and should other claims against GEMA enjoy a prior rank, the PUBLISHER is entitled to reclaim any loans disbursed in whole or in part or to deduct such amount from the next payment due to the AUTHOR. The PUBLISHER hereby expressly reserves the right to assert further claims for damages.'
        )
      ),
      p(
        'practice',
        tx(
          'Aus Gründen der GEMA-Zessionspraxis werden sämtliche GEMA-Autorenerlöse zur Verrechnung im Rahmen dieses Vertrages an den VERLAG ausgekehrt. Der VERLAG ist berechtigt, auch Erlöse des AUTORS, die nicht aus der Verwertung vertragsgegenständlicher Werke stammen, mit dem gezahlten Betrag zu verrechnen.',
          'Due to established GEMA assignment practices, the AUTHOR’s share shall be disbursed to the PUBLISHER for purposes of setting off pursuant to this contract. The AUTHOR’s share paid by GEMA to the PUBLISHER according to the GEMA assignment may also comprise any remunerations collected by GEMA in return for the exploitation of non-contractual Works of the AUTHOR.'
        )
      ),
      p(
        'direct',
        tx(
          'VERLAG ist außerdem berechtigt, auch Autorenerlöse, welche direkt an den VERLAG gezahlt werden, mit dem Darlehen zu verrechnen.',
          'The PUBLISHER is further entitled to set off earnings of the AUTHOR which are being paid to the PUBLISHER directly against the loan.'
        )
      ),
      p(
        'withdraw',
        tx(
          'Der VERLAG verpflichtet sich, die Zessionserklärung gegenüber der GEMA zurückzuziehen, sobald die geleistete Zahlung abgedeckt ist, und eventuell zu viel erhaltene Beträge mit der nachfolgenden Abrechnung an den AUTOR auszukehren.',
          'The PUBLISHER hereby undertakes to communicate the revocation of the assignment to GEMA as soon as the loan payment(s) made is/are settled and to disburse any excess amounts he may have received to the AUTHOR upon the rendering of the next accounts.'
        )
      ),
      p(
        'liability',
        tx(
          'Der AUTOR haftet für den Bestand der abgetretenen Forderung. Diese Haftung bezieht sich gemäß § 453 BGB auf die Verität der abgetretenen Forderung.',
          'The AUTHOR shall be liable for the existence of the assigned claims. Pursuant to Section 453 BGB, such liability relates to the viability (freedom from material or legal defects) of the assigned claim.'
        )
      ),
      p(
        'membership',
        tx(
          'Sofern der AUTOR, aus welchem Grunde auch immer, während der Vertragsdauer dieser Vereinbarung und vor vollständiger Rückführung sämtlicher Zahlungen von VERLAG an AUTOR unter diesem Vertrag seine Mitgliedschaft in der Verwertungsgesellschaft GEMA freiwillig oder unfreiwillig beendet, sichert der Autor schon jetzt gegenüber dem Verlag zu, dass er den VERLAG hierüber umgehend informieren wird und auf jeden Fall eine Mitgliedschaft in einer der europäischen Mitglieds-Verwertungsgesellschaften des BIEM besteht/bestehen wird. Für den Fall, dass der AUTOR diesen Mitteilungspflichten schuldhaft nicht nachkommt und/oder nicht länger einer Verwertungsgesellschaft des europäischen BIEM angehört, kann der VERLAG die Rückzahlung des dann jeweils noch ausstehenden Betrages fordern.',
          'Where the AUTHOR – for any reason – voluntarily or involuntarily terminates his membership with GEMA during the term hereof and prior to the full recoupment of all amounts disbursed by the PUBLISHER to the AUTHOR, the AUTHOR hereby guarantees to the PUBLISHER that he will notify the PUBLISHER thereof and that he is or will in any case become a member of one of the European BIEM’s (Bureau International des Sociétés Gérant les Droits d’Enregistrement et de Reproduction Mécanique) collecting societies which offer a membership. Should the AUTHOR culpably fail to perform these disclosure obligations and/or should he no longer be a member of a collecting society of the European BIEM, the PUBLISHER may claim the repayment of any outstanding amounts still due at that point in time.'
        )
      )
    )
    sections.push({
      key: 'loan',
      title: tx('Darlehenszahlung', 'Loan Payments') as string,
      paragraphs: loan
    })
  }

  if (terms.minWorksTerm !== null) {
    const option = terms.minWorksOption ?? terms.minWorksTerm
    sections.push({
      key: 'delivery',
      title: tx('Mindesteinbringungsverpflichtung', 'Minimum Delivery Commitment') as string,
      paragraphs: [
        p(
          'count',
          tx(
            `Der AUTOR garantiert, innerhalb der Mindestdauer gem. ANLAGE B – Ziff. 1.2 mindestens ${terms.minWorksTerm} neue, bislang unveröffentlichte Werke aus der Feder des AUTORS bzw. innerhalb der Optionsperiode(n) mindestens ${option} neue, bislang unveröffentlichte Werke aus der Feder des AUTORS – jeweils mit einem jeweiligen Mindestcopyrightanteil von 100 % für AUTOR – in diesen Vertrag einzubringen. Werke mit weniger als der vorgenannten prozentualen Copyrightbeteiligung müssen in der Addition rechnerisch zu der gleichen Gesamtzahl führen.`,
            `The AUTHOR guarantees that during the minimum term of this contract pursuant to Annex B 1.2, he will at the least deliver ${terms.minWorksTerm} new, unpublished works originating from the AUTHOR, or, as the case may be, that he will deliver at the least ${option} new, unpublished works originating from the AUTHOR during any Option Period (if any) – with a minimum copyright share of 100% of the AUTHOR – under this contract. Works which feature less than the copyright share set out above must mathematically result in the same total amount when added together.`
          )
        ),
        // Adapted: the model's list of named distribution companies is left out
        p(
          'release',
          tx(
            'Die vorgenannten Werke müssen handelsüblich und flächendeckend als Tonträger mit einem ordentlichen Vertrieb in Deutschland, Österreich und der Schweiz veröffentlicht werden.',
            'The above works shall be released in the form of sound recordings embodying these works in the form of physical product/phonograms (e.g. CD) in Germany, Austria and Switzerland, nationwide and in a commercially customary fashion, with the help of a recognised distribution company.'
          )
        )
      ]
    })
  }

  if (terms.refundPercent !== null) {
    sections.push({
      key: 'refund',
      title: tx('Refundierungsvereinbarung', 'Refund') as string,
      paragraphs: [
        p(
          'refund',
          tx(
            `Der VERLAG verpflichtet sich gegenüber dem AUTOR zur Abrechnung und Zahlung einer Refundierung in Höhe von ${pct(terms.refundPercent)} der titelbezogenen GEMA-Verlagserlöse bezogen auf die vertragsgegenständlichen Werke. Die Abrechnung und Zahlung erfolgt gem. Ziffer 9 des Vertrages.`,
            `Notwithstanding Section 7 of the publishing contract and the GEMA Distribution Plan, the PUBLISHER promises to the AUTHOR to pay to the AUTHOR ${pct(terms.refundPercent)} of his title-related GEMA PUBLISHER’s share regarding the Contractual Works (“Refund”). The accounting and the payment of the Refund shall correspond with Section 9 of the publishing contract.`
          )
        )
      ]
    })
  }
  return sections
}
