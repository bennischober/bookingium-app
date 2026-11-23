// The promoter's side of a show contract, from the two ways contracts name it. All names,
// numbers and addresses are invented.
import { describe, expect, it } from 'vitest'
import { extractContractParty } from '../src/main/showfolder/contractParty'

const partyBlock = `GASTSPIELVERTRAG
zwischen
Muster Konzerte GmbH
Musterweg 11
12345 Musterstadt
vertreten durch den Geschäftsführer Max Beispiel
Tel.: +49 40 000 0001
E-Mail: info@muster-konzerte.example.test
USt-IdNr.: DE123456789
– nachfolgend „Veranstalter“ genannt –
und
Beispiel Booking Agentur
Beispielstraße 77
54321 Nebenort
– nachfolgend „Agentur“ genannt –
§ 1 Vertragsgegenstand
`

const labelled = `Konzertvertrag
Künstler: Beispielband
Veranstalter: Beispiel Open Air e.V.
Am Beispielsee 3
12345 Musterstadt
Ansprechpartner: Erika Muster
Mobil: 0151 0000003
erika@open-air.example.test
Spielort: Festivalgelände am See
Gage: 2.500,00 € netto
`

describe('contract party', () => {
  it('reads the party block up to the other party', () => {
    expect(extractContractParty(partyBlock)).toEqual({
      name: 'Muster Konzerte GmbH',
      street: 'Musterweg 11',
      zipCode: '12345',
      city: 'Musterstadt',
      email: 'info@muster-konzerte.example.test',
      phone: '+49 40 000 0001',
      vatId: 'DE123456789',
      contactName: 'Max Beispiel',
      contactRole: 'Geschäftsführung',
      kskNumber: '',
      taxNumber: ''
    })
  })

  it('reads a labelled promoter and stops at the next label of another kind', () => {
    expect(extractContractParty(labelled)).toMatchObject({
      name: 'Beispiel Open Air e.V.',
      street: 'Am Beispielsee 3',
      zipCode: '12345',
      city: 'Musterstadt',
      email: 'erika@open-air.example.test',
      phone: '0151 0000003',
      contactName: 'Erika Muster',
      contactRole: 'Ansprechpartner'
    })
  })

  it('never takes the act’s side and returns null without a promoter', () => {
    expect(extractContractParty('Künstler: Beispielband\nAgentur: Beispiel Booking')).toBeNull()
    expect(extractContractParty('Ein Brief ohne Vertragsparteien.')).toBeNull()
  })
})
