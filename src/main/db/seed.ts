import { db } from './index'
import { eq } from 'drizzle-orm'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { copyLogoToStorage } from '../utils/fileStorage'
import {
  address,
  contact,
  bank,
  person,
  company,
  company_member,
  band,
  band_member,
  venue,
  venue_member,
  hotel,
  deal_memo,
  itinerary,
  company_invoice_settings,
  invoice,
  invoice_line_item,
  invoice_party_snapshot
} from './schema'

export async function seedDatabase() {
  try {
    // Date helper: ISO date string relative to today (keeps seeded demo data
    // in a sensible window around "now" so dashboard/calendar show content)
    const isoInDays = (offset: number): string => {
      const d = new Date()
      d.setDate(d.getDate() + offset)
      return d.toISOString().slice(0, 10)
    }

    // Check if already seeded
    const existingBands = await db.select().from(band).limit(1)
    if (existingBands.length > 0) {
      console.log('Database already seeded, skipping...')
      return
    }

    console.log('Seeding database with sample data...')

    // ========================================
    // Create Addresses
    // ========================================
    const [hotelAddress1] = await db
      .insert(address)
      .values({
        street: 'Kurfürstendamm',
        street_number: '27',
        zip_code: '10719',
        city: 'Berlin',
        state: 'Berlin',
        country: 'Germany',
        country_code: 'DE'
      })
      .returning()

    const [companyAddress1] = await db
      .insert(address)
      .values({
        street: 'Music Row',
        street_number: '1234',
        zip_code: '37203',
        city: 'Nashville',
        state: 'Tennessee',
        country: 'United States',
        country_code: 'US'
      })
      .returning()

    const [companyAddress2] = await db
      .insert(address)
      .values({
        street: 'Friedrichstraße',
        street_number: '123',
        zip_code: '10117',
        city: 'Berlin',
        state: 'Berlin',
        country: 'Germany',
        country_code: 'DE'
      })
      .returning()

    const [personAddress1] = await db
      .insert(address)
      .values({
        street: 'Abbey Road',
        street_number: '3',
        zip_code: 'NW8 9AY',
        city: 'London',
        state: 'England',
        country: 'United Kingdom',
        country_code: 'GB'
      })
      .returning()

    const [personAddress2] = await db
      .insert(address)
      .values({
        street: 'Sunset Boulevard',
        street_number: '8901',
        zip_code: '90069',
        city: 'Los Angeles',
        state: 'California',
        country: 'United States',
        country_code: 'US'
      })
      .returning()

    // ========================================
    // Create Contacts
    // ========================================
    console.log('Creating contacts...')

    const [hotelContact1] = await db
      .insert(contact)
      .values({
        email: 'reservations@hotel-adlon.example.test',
        phone: '+49-30-22610',
        mobile_phone: '',
        homepage: 'https://www.hotel-adlon.de'
      })
      .returning()

    const [companyContact1] = await db
      .insert(contact)
      .values({
        email: 'contact@soundwaverecords.example.test',
        phone: '+1-615-244-3900',
        mobile_phone: '+1-615-555-0300',
        homepage: 'https://www.soundwaverecords.com'
      })
      .returning()

    const [companyContact2] = await db
      .insert(contact)
      .values({
        email: 'info@livemusic-berlin.example.test',
        phone: '+49-30-555-1234',
        mobile_phone: '+49-172-555-0400',
        homepage: 'https://www.livemusic-berlin.de'
      })
      .returning()

    const [personContact1] = await db
      .insert(contact)
      .values({
        email: 'john.rockstar@music.example.test',
        phone: '+44-20-7946-0958',
        mobile_phone: '+44-7700-900123',
        homepage: ''
      })
      .returning()

    const [personContact2] = await db
      .insert(contact)
      .values({
        email: 'sarah.drums@music.example.test',
        phone: '',
        mobile_phone: '+44-7700-900456',
        homepage: ''
      })
      .returning()

    const [personContact3] = await db
      .insert(contact)
      .values({
        email: 'mike.bass@music.example.test',
        phone: '',
        mobile_phone: '+1-213-555-0789',
        homepage: ''
      })
      .returning()

    const [personContact4] = await db
      .insert(contact)
      .values({
        email: 'lisa.keys@music.example.test',
        phone: '',
        mobile_phone: '+1-213-555-0456',
        homepage: ''
      })
      .returning()

    const [personContact5] = await db
      .insert(contact)
      .values({
        email: 'tom.manager@soundwave.example.test',
        phone: '+1-615-555-0100',
        mobile_phone: '+1-615-555-0200',
        homepage: ''
      })
      .returning()

    // ========================================
    // Create Banks
    // ========================================
    console.log('Creating bank accounts...')
    const [bank1] = await db
      .insert(bank)
      .values({
        bank_name: 'Deutsche Bank',
        account_holder: 'Live Music Berlin GmbH',
        iban: 'DE89370400440532013000',
        bic: 'COBADEFFXXX'
      })
      .returning()

    const [bank2] = await db
      .insert(bank)
      .values({
        bank_name: 'Bank of America',
        account_holder: 'Soundwave Records LLC',
        iban: 'DE02120300000000202051',
        bic: 'BOFAUS3N'
      })
      .returning()

    // ========================================
    // Create Persons
    // ========================================
    console.log('Creating persons...')
    const [person1] = await db
      .insert(person)
      .values({
        first_name: 'John',
        last_name: 'Rockstar',
        birthday: '1985-03-15',
        notes: 'Charismatic frontman with powerful vocals',
        contact_id: personContact1.id,
        address_id: personAddress1.id
      })
      .returning()

    const [person2] = await db
      .insert(person)
      .values({
        first_name: 'Sarah',
        last_name: 'Drummer',
        birthday: '1988-07-22',
        notes: 'Energetic drummer with perfect timing',
        contact_id: personContact2.id,
        address_id: personAddress1.id
      })
      .returning()

    const [person3] = await db
      .insert(person)
      .values({
        first_name: 'Mike',
        last_name: 'Bassline',
        birthday: '1987-11-08',
        notes: 'Groove master on bass',
        contact_id: personContact3.id,
        address_id: personAddress2.id
      })
      .returning()

    const [person4] = await db
      .insert(person)
      .values({
        first_name: 'Lisa',
        last_name: 'Keys',
        birthday: '1990-02-14',
        notes: 'Classical training meets modern sound',
        contact_id: personContact4.id,
        address_id: personAddress2.id
      })
      .returning()

    const [person5] = await db
      .insert(person)
      .values({
        first_name: 'Tom',
        last_name: 'Manager',
        birthday: '1975-05-10',
        notes: 'Experienced tour manager with 20+ years in the industry',
        contact_id: personContact5.id,
        address_id: companyAddress1.id
      })
      .returning()

    // ========================================
    // Create Companies
    // ========================================
    console.log('Creating companies...')
    const [company1] = await db
      .insert(company)
      .values({
        name: 'Soundwave Records',
        notes: 'Independent record label specializing in rock and alternative music',
        bank_id: bank2.id,
        vat_number: 'US123456789',
        ust_number: 'UST-98765',
        is_default_for_invoicing: false,
        address_id: companyAddress1.id,
        contact_id: companyContact1.id
      })
      .returning()

    const [company2] = await db
      .insert(company)
      .values({
        name: 'Live Music Berlin GmbH',
        notes: 'Concert promoter and venue operator in Berlin',
        bank_id: bank1.id,
        vat_number: 'DE987654321',
        ust_number: 'DE123456789',
        is_default_for_invoicing: true,
        address_id: companyAddress2.id,
        contact_id: companyContact2.id
      })
      .returning()

    // ========================================
    // Internal seed: real issuer companies with real master data.
    // Loaded from sample_data/internal-seed.json (gitignored). When the file
    // is absent (fresh clones, packaged app), these companies are skipped and
    // the database contains only the fictional demo companies above.
    // See sample_data/internal-seed.example.json for the format.
    // ========================================
    const internalSeedPath = join(process.cwd(), 'sample_data', 'internal-seed.json')
    if (existsSync(internalSeedPath)) {
      console.log('Creating internal issuer companies...')
      try {
        const internalSeed = JSON.parse(readFileSync(internalSeedPath, 'utf-8')) as {
          companies?: Array<{
            key: string
            name: string
            notes?: string
            address?: {
              street?: string
              streetNumber?: string
              zipCode?: string
              city?: string
              state?: string
              country?: string
              countryCode?: string
            }
            contact?: { email?: string; phone?: string; homepage?: string }
            bank?: {
              bankName?: string
              accountHolder?: string
              iban?: string
              bic?: string
            }
            vatNumber?: string
            ustNumber?: string
            taxNumber?: string
            commercialRegisterNo?: string
            registerCourt?: string
            nextInvoiceNumber?: number
            logoFile?: string
            signatureFile?: string
          }>
        }

        for (const entry of internalSeed.companies ?? []) {
          if (!entry.name) {
            console.warn(`Internal seed entry "${entry.key ?? '?'}" has no name, skipping`)
            continue
          }

          let addressId: number | null = null
          if (entry.address) {
            const [row] = await db
              .insert(address)
              .values({
                street: entry.address.street ?? '',
                street_number: entry.address.streetNumber ?? '',
                zip_code: entry.address.zipCode ?? '',
                city: entry.address.city ?? '',
                state: entry.address.state ?? '',
                country: entry.address.country ?? '',
                country_code: entry.address.countryCode ?? ''
              })
              .returning()
            addressId = row.id
          }

          let contactId: number | null = null
          if (entry.contact) {
            const [row] = await db
              .insert(contact)
              .values({
                email: entry.contact.email ?? '',
                phone: entry.contact.phone ?? '',
                mobile_phone: '',
                homepage: entry.contact.homepage ?? ''
              })
              .returning()
            contactId = row.id
          }

          let bankId: number | null = null
          if (entry.bank) {
            const [row] = await db
              .insert(bank)
              .values({
                bank_name: entry.bank.bankName ?? '',
                account_holder: entry.bank.accountHolder ?? '',
                iban: entry.bank.iban ?? '',
                bic: entry.bank.bic ?? ''
              })
              .returning()
            bankId = row.id
          }

          const [created] = await db
            .insert(company)
            .values({
              name: entry.name,
              notes: entry.notes ?? '',
              bank_id: bankId,
              vat_number: entry.vatNumber ?? '',
              ust_number: entry.ustNumber ?? '',
              tax_number: entry.taxNumber ?? '',
              commercial_register_no: entry.commercialRegisterNo ?? '',
              register_court: entry.registerCourt ?? '',
              is_default_for_invoicing: false,
              address_id: addressId,
              contact_id: contactId
            })
            .returning()

          await db.insert(company_invoice_settings).values({
            company_id: created.id,
            next_invoice_number: entry.nextInvoiceNumber ?? 1
          })

          if (entry.logoFile) {
            const logoSource = join(process.cwd(), 'sample_data', entry.logoFile)
            if (existsSync(logoSource)) {
              try {
                const logoPath = await copyLogoToStorage(logoSource, created.id, entry.logoFile)
                await db
                  .update(company)
                  .set({ logo_path: logoPath })
                  .where(eq(company.id, created.id))
              } catch (error) {
                console.warn(
                  `Logo for "${entry.name}" could not be copied:`,
                  error instanceof Error ? error.message : error
                )
              }
            } else {
              console.warn(`Logo file "${entry.logoFile}" not found in sample_data, skipping`)
            }
          }

          if (entry.signatureFile) {
            const signatureSource = join(process.cwd(), 'sample_data', entry.signatureFile)
            if (existsSync(signatureSource)) {
              try {
                const signaturePath = await copyLogoToStorage(
                  signatureSource,
                  created.id,
                  entry.signatureFile
                )
                await db
                  .update(company)
                  .set({ signature_path: signaturePath })
                  .where(eq(company.id, created.id))
              } catch (error) {
                console.warn(
                  `Signature for "${entry.name}" could not be copied:`,
                  error instanceof Error ? error.message : error
                )
              }
            } else {
              console.warn(
                `Signature file "${entry.signatureFile}" not found in sample_data, skipping`
              )
            }
          }

          console.log(`  ${created.name} (next invoice #${entry.nextInvoiceNumber ?? 1})`)
        }
      } catch (error) {
        console.warn(
          'Internal seed file could not be parsed, skipping internal companies:',
          error instanceof Error ? error.message : error
        )
      }
    }

    await db.insert(company_invoice_settings).values([
      {
        company_id: company1.id,
        next_invoice_number: 509
      },
      {
        company_id: company2.id,
        next_invoice_number: 1042
      }
    ])

    // Create company members with roles
    await db.insert(company_member).values([
      {
        company_id: company1.id,
        person_id: person5.id,
        role: 'Tour Manager',
        notes: 'Manages all touring operations and logistics'
      },
      {
        company_id: company2.id,
        person_id: person5.id,
        role: 'Booking Agent',
        notes: 'Handles venue bookings and contracts'
      }
    ])

    // ========================================
    // Create Bands
    // ========================================
    console.log('Creating bands...')
    const [band1] = await db
      .insert(band)
      .values({
        name: 'The Electric Waves',
        genre: 'Alternative Rock',
        founded: '2015-06-20',
        notes: 'High-energy rock band with three studio albums',
        company_id: company1.id
      })
      .returning()

    const [band2] = await db
      .insert(band)
      .values({
        name: 'Midnight Symphony',
        genre: 'Electronic/Indie',
        founded: '2018-09-15',
        notes: 'Electronic fusion with indie sensibilities',
        company_id: company1.id
      })
      .returning()

    // Create band members with specific roles for each band
    await db.insert(band_member).values([
      {
        band_id: band1.id,
        person_id: person1.id,
        role: 'Lead Vocalist',
        notes: 'Founding member and primary songwriter'
      },
      {
        band_id: band1.id,
        person_id: person2.id,
        role: 'Drummer',
        notes: 'Joined in 2016, brings technical precision'
      },
      {
        band_id: band1.id,
        person_id: person3.id,
        role: 'Bass Guitarist',
        notes: 'Original member, handles backing vocals'
      },
      {
        band_id: band2.id,
        person_id: person4.id,
        role: 'Keyboardist / Producer',
        notes: 'Band founder, handles electronic production'
      },
      {
        band_id: band2.id,
        person_id: person1.id,
        role: 'Vocalist / Synthesizer',
        notes: 'Collaborates on electronic arrangements'
      }
    ])

    // ========================================
    // Create Venues
    // ========================================
    console.log('Creating venues...')

    // create contact and address for venues
    const [venueContact1] = await db
      .insert(contact)
      .values({
        email: 'venue-email@email.example.test',
        phone: '+49-30-555-6789',
        mobile_phone: '+49-172-555-0900',
        homepage: 'https://www.venue1.com'
      })
      .returning()

    const [venueAddress1] = await db
      .insert(address)
      .values({
        street: 'Main Street',
        street_number: '100',
        zip_code: '12345',
        city: 'Berlin',
        state: 'Berlin',
        country: 'Germany',
        country_code: 'DE'
      })
      .returning()

    const [venueContact2] = await db
      .insert(contact)
      .values({
        email: 'venue-2@email.example.test',
        phone: '+49-30-555-6780',
        mobile_phone: '+49-172-555-0901',
        homepage: 'https://www.venue2.com'
      })
      .returning()

    const [venueAddress2] = await db
      .insert(address)
      .values({
        street: 'Second Avenue',
        street_number: '200',
        zip_code: '54321',
        city: 'Berlin',
        state: 'Berlin',
        country: 'Germany',
        country_code: 'DE'
      })
      .returning()

    const [venue1] = await db
      .insert(venue)
      .values({
        name: 'The Whisky a Go Go',
        capacity: 500,
        notes: 'Legendary rock venue on the Sunset Strip',
        company_id: company2.id,
        contact_id: venueContact1.id,
        address_id: venueAddress1.id
      })
      .returning()

    const [venue2] = await db
      .insert(venue)
      .values({
        name: 'Berghain',
        capacity: 1500,
        notes: 'World-renowned techno club and concert venue',
        company_id: company2.id,
        contact_id: venueContact2.id,
        address_id: venueAddress2.id
      })
      .returning()

    // Create venue members with roles
    await db.insert(venue_member).values([
      {
        venue_id: venue1.id,
        person_id: person5.id,
        role: 'Production Manager',
        notes: 'Oversees all technical aspects and stage management'
      },
      {
        venue_id: venue2.id,
        person_id: person5.id,
        role: 'Stage Manager',
        notes: 'Coordinates load-in and performance schedules'
      }
    ])

    // ========================================
    // Create Hotels
    // ========================================
    console.log('Creating hotels...')
    const [hotel1] = await db
      .insert(hotel)
      .values({
        name: 'Hotel Adlon Kempinski',
        notes: 'Luxury 5-star hotel near Brandenburg Gate',
        contact_id: hotelContact1.id,
        address_id: hotelAddress1.id
      })
      .returning()

    // ========================================
    // Create Deal Memos
    // ========================================
    console.log('Creating deal memos...')
    const [dealMemo1] = await db
      .insert(deal_memo)
      .values({
        name: 'The Electric Waves - Berlin Tour',
        deal: '70/30',
        date: isoInDays(21),
        ticket_price_vvk: 35.0,
        ticket_price_ak: 40.0,
        posters: '500 A1 posters, 1000 flyers',
        status: 'confirmed',
        notes: 'Summer tour kick-off show',
        amount_of_people: 4,
        room_information: '2 double rooms, non-smoking',
        performance_duration: '90 minutes',
        performance_time: '21:00',
        performance_information: 'Full backline provided, band brings own instruments',
        lopro_person_id: person5.id,
        lopro_company_id: company2.id,
        invoice_company_id: company2.id,
        band_id: band1.id,
        venue_id: venue2.id,
        hotel_id: hotel1.id
      })
      .returning()

    const [dealMemo2] = await db
      .insert(deal_memo)
      .values({
        name: 'Midnight Symphony - LA Showcase',
        deal: '60/40 with $5,000 guarantee',
        date: isoInDays(3),
        ticket_price_vvk: 25.0,
        ticket_price_ak: 30.0,
        posters: '300 A2 posters',
        status: 'pending',
        notes: 'Album release party',
        amount_of_people: 3,
        room_information: '1 suite, 1 double room',
        performance_duration: '75 minutes',
        performance_time: '20:30',
        performance_information: 'Special lighting setup required',
        lopro_person_id: person5.id,
        lopro_company_id: company1.id,
        invoice_company_id: company1.id,
        band_id: band2.id,
        venue_id: venue1.id,
        hotel_id: null
      })
      .returning()

    // ========================================
    // Internal contract demo: when the internal seed companies exist, create
    // a deal memo exercising the full contract path (BMM as issuing agency,
    // PWW as local promoter, guarantee + signature + TL)
    // ========================================
    let internalDealMemoId: number | null = null
    try {
      const internalCompanies = await db.select().from(company)
      const bmm = internalCompanies.find((c) => c.name === 'Brainstorm Music Marketing AG')
      const pww = internalCompanies.find((c) => c.name === 'Pretty Wild Water')

      if (bmm && pww) {
        // A band owned by PWW (the artist company), managed by BMM (vertreten
        // durch, letterhead + signature in contracts), PWW also as local
        // promoter
        const [internalBand] = await db
          .insert(band)
          .values({
            name: 'Pretty Wild',
            genre: 'Rock',
            founded: '2019-04-01',
            notes: 'Internal contract demo band',
            company_id: pww.id,
            responsible_person_id: person5.id,
            management_company_id: bmm.id
          })
          .returning()

        // TL band membership
        await db.insert(band_member).values({
          band_id: internalBand.id,
          person_id: person5.id,
          role: 'Guitar, TL',
          notes: 'Technischer Leiter for contract demos'
        })

        const [internalMemo] = await db
          .insert(deal_memo)
          .values({
            name: 'Pretty Wild - Bad Hindelang Open Air',
            deal: 'Garantie 4.000,00 € zzgl. 7% MwSt.',
            date: isoInDays(10),
            ticket_price_vvk: 25.0,
            ticket_price_ak: 30.0,
            posters: '200 A1 posters',
            status: 'confirmed',
            notes: 'Internal contract demo event',
            amount_of_people: 7,
            room_information: '7 EZ (single rooms)',
            performance_duration: '90 Minuten',
            performance_time: '20:30',
            performance_information: 'Open Air Buehne, Support ab 19:00',
            lopro_person_id: person5.id,
            lopro_company_id: pww.id,
            invoice_company_id: bmm.id,
            band_id: internalBand.id,
            venue_id: venue2.id,
            hotel_id: hotel1.id,
            guarantee_amount: 4000,
            guarantee_vat_rate: 7,
            contract_notes: 'Sondervereinbarung: Vorband stellt Backline. Auf- und Abbau am Vortag.'
          })
          .returning()

        internalDealMemoId = internalMemo.id
        console.log(`Internal contract demo: deal memo #${internalMemo.id} (BMM <-> PWW)`)
      }
    } catch (error) {
      console.warn(
        'Internal contract demo could not be created:',
        error instanceof Error ? error.message : error
      )
    }

    // Full snapshots of both demo companies: invoice 1040 is a complete
    // e-invoice (ZUGFeRD), the others lack recipient data
    const snapshotOf = (
      source: typeof company2,
      sourceAddress: typeof companyAddress2,
      sourceContact: typeof companyContact2,
      sourceBank: typeof bank1
    ) => ({
      kind: 'company',
      source_company_id: source.id,
      legal_name: source.name,
      street: sourceAddress.street,
      street_number: sourceAddress.street_number,
      zip_code: sourceAddress.zip_code,
      city: sourceAddress.city,
      country: sourceAddress.country,
      country_code: sourceAddress.country_code,
      vat_number: source.vat_number,
      ust_number: source.ust_number,
      website: sourceContact.homepage ?? '',
      email: sourceContact.email,
      phone: sourceContact.phone ?? '',
      account_holder: sourceBank.account_holder,
      bank_name: sourceBank.bank_name,
      iban: sourceBank.iban,
      bic: sourceBank.bic
    })

    const [issuerSnapshot1] = await db
      .insert(invoice_party_snapshot)
      .values(snapshotOf(company2, companyAddress2, companyContact2, bank1))
      .returning()

    const [issuerSnapshot2] = await db
      .insert(invoice_party_snapshot)
      .values({
        kind: 'company',
        source_company_id: company1.id,
        legal_name: company1.name,
        vat_number: company1.vat_number,
        ust_number: company1.ust_number
      })
      .returning()

    const [recipientSnapshotCompany] = await db
      .insert(invoice_party_snapshot)
      .values(snapshotOf(company1, companyAddress1, companyContact1, bank2))
      .returning()

    const [recipientSnapshotBand] = await db
      .insert(invoice_party_snapshot)
      .values({
        kind: 'band',
        source_band_id: band2.id,
        legal_name: band2.name
      })
      .returning()

    const [recipientSnapshotPerson] = await db
      .insert(invoice_party_snapshot)
      .values({
        kind: 'person',
        source_person_id: person5.id,
        legal_name: `${person5.first_name} ${person5.last_name}`
      })
      .returning()

    const [invoice1] = await db
      .insert(invoice)
      .values({
        invoice_number: 1040,
        company_id: company2.id,
        issuer_snapshot_id: issuerSnapshot1.id,
        recipient_snapshot_id: recipientSnapshotCompany.id,
        deal_memo_id: dealMemo1.id,
        period_start_date: isoInDays(-14),
        period_end_date: isoInDays(7),
        period_label: 'Current period',
        issue_date: isoInDays(-3),
        due_date: isoInDays(11),
        status: 'issued',
        currency: 'EUR',
        subtotal_net_amount: 3529.41,
        subtotal_tax_amount: 670.59,
        total_gross_amount: 4200,
        total_amount: 4200,
        notes: 'Berlin show settlement invoice'
      })
      .returning()

    const [invoice2] = await db
      .insert(invoice)
      .values({
        invoice_number: 1041,
        company_id: company2.id,
        issuer_snapshot_id: issuerSnapshot1.id,
        recipient_snapshot_id: recipientSnapshotPerson.id,
        deal_memo_id: null,
        period_start_date: isoInDays(-45),
        period_end_date: isoInDays(-15),
        period_label: 'Previous period',
        issue_date: isoInDays(-40),
        due_date: isoInDays(-26),
        status: 'paid',
        currency: 'EUR',
        subtotal_net_amount: 1250,
        subtotal_tax_amount: 0,
        total_gross_amount: 1250,
        total_amount: 1250,
        reverse_charge_note: 'Reverse charge applies',
        notes: 'General promoter service invoice'
      })
      .returning()

    const [invoice3] = await db
      .insert(invoice)
      .values({
        // Draft: no number until it is issued
        invoice_number: null,
        company_id: company1.id,
        issuer_snapshot_id: issuerSnapshot2.id,
        recipient_snapshot_id: recipientSnapshotBand.id,
        deal_memo_id: dealMemo2.id,
        period_start_date: isoInDays(-7),
        period_end_date: isoInDays(23),
        period_label: 'Next 30 days',
        issue_date: isoInDays(-1),
        due_date: isoInDays(13),
        status: 'draft',
        currency: 'USD',
        subtotal_net_amount: 5000,
        subtotal_tax_amount: 0,
        total_gross_amount: 5000,
        total_amount: 5000,
        notes: 'LA showcase guarantee invoice draft'
      })
      .returning()

    await db.insert(invoice_line_item).values([
      {
        invoice_id: invoice1.id,
        position: 1,
        description: 'Performance fee',
        quantity: 1,
        unit: 'service',
        unit_price_net: 3000,
        line_net_amount: 3000,
        tax_rate: 19,
        tax_code: 'standard',
        line_tax_amount: 570,
        line_gross_amount: 3570
      },
      {
        invoice_id: invoice1.id,
        position: 2,
        description: 'Travel cost reimbursement',
        quantity: 1,
        unit: 'service',
        unit_price_net: 529.41,
        line_net_amount: 529.41,
        tax_rate: 19,
        tax_code: 'standard',
        line_tax_amount: 100.59,
        line_gross_amount: 630
      },
      {
        invoice_id: invoice2.id,
        position: 1,
        description: 'Quarterly commission settlement',
        quantity: 1,
        unit: 'service',
        unit_price_net: 1250,
        line_net_amount: 1250,
        tax_rate: 0,
        tax_code: 'reverse_charge',
        line_tax_amount: 0,
        line_gross_amount: 1250
      },
      {
        invoice_id: invoice3.id,
        position: 1,
        description: 'Show guarantee',
        quantity: 1,
        unit: 'service',
        unit_price_net: 5000,
        line_net_amount: 5000,
        tax_rate: 0,
        tax_code: 'other',
        line_tax_amount: 0,
        line_gross_amount: 5000
      }
    ])

    // ========================================
    // Create Itineraries
    // ========================================
    console.log('Creating itineraries...')
    await db.insert(itinerary).values([
      {
        notes: 'Standard setup for rock show',
        deal_memo_id: dealMemo1.id,
        get_in: '14:00',
        load_in: '15:00',
        sound_check_main_act: '18:00',
        sound_check_support: '17:00',
        dinner: '19:00',
        doors: '20:00',
        show_time_main_act: '21:00',
        show_time_support: '20:15',
        curfew_stage: '23:00',
        curfew_venue: '23:30',
        show_length: '90'
      },
      {
        notes: 'Electronic setup with DJ booth',
        deal_memo_id: dealMemo2.id,
        get_in: '13:00',
        load_in: '14:00',
        sound_check_main_act: '17:30',
        sound_check_support: '',
        dinner: '18:30',
        doors: '19:30',
        show_time_main_act: '20:30',
        show_time_support: '',
        curfew_stage: '22:30',
        curfew_venue: '23:00',
        show_length: '75'
      },
      ...(internalDealMemoId
        ? [
            {
              notes: 'Open Air setup with support act',
              deal_memo_id: internalDealMemoId,
              get_in: '12:00',
              load_in: '13:00',
              sound_check_main_act: '16:00',
              sound_check_support: '15:00',
              dinner: '18:00',
              doors: '19:00',
              show_time_main_act: '20:30',
              show_time_support: '19:30',
              curfew_stage: '22:30',
              curfew_venue: '23:00',
              show_length: '90'
            }
          ]
        : [])
    ])

    console.log('Database seeded successfully!')
  } catch (error) {
    console.error('Error seeding database:', error)
    throw error
  }
}
