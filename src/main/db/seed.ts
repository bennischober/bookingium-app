import { db } from './index'
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
} from './schema'

export async function seedDatabase() {
  try {
    // Check if already seeded
    const existingBands = await db.select().from(band).limit(1)
    if (existingBands.length > 0) {
      console.log('Database already seeded, skipping...')
      return
    }

    console.log('Seeding database with sample data...')

    const [hotelAddress1] = await db
      .insert(address)
      .values({
        street: 'Kurfürstendamm',
        street_number: '27',
        zip_code: '10719',
        city: 'Berlin',
        state: 'Berlin',
        country: 'Germany',
        country_code: 'DE',
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
        country_code: 'US',
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
        country_code: 'DE',
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
        country_code: 'GB',
      })
      .returning()

    // ========================================
    // Create Contacts
    // ========================================
    console.log('Creating contacts...')

    const [hotelContact1] = await db
      .insert(contact)
      .values({
        email: 'reservations@hotel-adlon.de',
        phone: '+49-30-22610',
        mobile_phone: '',
        homepage: 'https://www.hotel-adlon.de',
      })
      .returning()

    const [companyContact1] = await db
      .insert(contact)
      .values({
        email: 'contact@soundwaverecords.com',
        phone: '+1-615-244-3900',
        mobile_phone: '+1-615-555-0300',
        homepage: 'https://www.soundwaverecords.com',
      })
      .returning()

    const [companyContact2] = await db
      .insert(contact)
      .values({
        email: 'info@livemusic-berlin.de',
        phone: '+49-30-555-1234',
        mobile_phone: '+49-172-555-0400',
        homepage: 'https://www.livemusic-berlin.de',
      })
      .returning()

    const [personContact1] = await db
      .insert(contact)
      .values({
        email: 'john.rockstar@music.com',
        phone: '+44-20-7946-0958',
        mobile_phone: '+44-7700-900123',
        homepage: '',
      })
      .returning()

    const [personContact2] = await db
      .insert(contact)
      .values({
        email: 'sarah.drums@music.com',
        phone: '',
        mobile_phone: '+44-7700-900456',
        homepage: '',
      })
      .returning()

    const [personContact3] = await db
      .insert(contact)
      .values({
        email: 'mike.bass@music.com',
        phone: '',
        mobile_phone: '+1-213-555-0789',
        homepage: '',
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
        bic: 'COBADEFFXXX',
      })
      .returning()

    const [bank2] = await db
      .insert(bank)
      .values({
        bank_name: 'Bank of America',
        account_holder: 'Soundwave Records LLC',
        iban: 'US89370400440532013000',
        bic: 'BOFAUS3N',
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
        role: 'Lead Vocalist',
        notes: 'Charismatic frontman with powerful vocals',
        contact_id: personContact1.id,
        address_id: personAddress1.id,
      })
      .returning()

    const [person2] = await db
      .insert(person)
      .values({
        first_name: 'Sarah',
        last_name: 'Drummer',
        birthday: '1988-07-22',
        role: 'Drummer',
        notes: 'Energetic drummer with perfect timing',
        contact_id: personContact2.id,
        address_id: personAddress1.id,
      })
      .returning()

    const [person3] = await db
      .insert(person)
      .values({
        first_name: 'Mike',
        last_name: 'Bassline',
        birthday: '1987-11-08',
        role: 'Bass Guitarist',
        notes: 'Groove master on bass',
        contact_id: personContact3.id,
        address_id: personAddress1.id,
      })
      .returning()

    const [person4] = await db
      .insert(person)
      .values({
        first_name: 'Lisa',
        last_name: 'Keys',
        birthday: '1990-02-14',
        role: 'Keyboardist',
        notes: 'Classical training meets modern sound',
        contact_id: personContact1.id,
        address_id: companyAddress1.id,
      })
      .returning()

    const [person5] = await db
      .insert(person)
      .values({
        first_name: 'Tom',
        last_name: 'Manager',
        birthday: '1975-05-10',
        role: 'Band Manager',
        notes: 'Experienced tour manager',
        contact_id: companyContact1.id,
        address_id: companyAddress1.id,
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
        address_id: companyAddress1.id,
        contact_id: companyContact1.id,
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
        address_id: companyAddress2.id,
        contact_id: companyContact2.id,
      })
      .returning()

    // Create company members
    await db.insert(company_member).values([
      { company_id: company1.id, person_id: person5.id },
      { company_id: company2.id, person_id: person5.id },
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
        company_id: company1.id,
      })
      .returning()

    const [band2] = await db
      .insert(band)
      .values({
        name: 'Midnight Symphony',
        genre: 'Electronic/Indie',
        founded: '2018-09-15',
        notes: 'Electronic fusion with indie sensibilities',
        company_id: company1.id,
      })
      .returning()

    // Create band members
    await db.insert(band_member).values([
      { band_id: band1.id, person_id: person1.id },
      { band_id: band1.id, person_id: person2.id },
      { band_id: band1.id, person_id: person3.id },
      { band_id: band2.id, person_id: person4.id },
    ])

    // ========================================
    // Create Venues
    // ========================================
    console.log('Creating venues...')
    const [venue1] = await db
      .insert(venue)
      .values({
        name: 'The Whisky a Go Go',
        capacity: 500,
        notes: 'Legendary rock venue on the Sunset Strip',
        company_id: company2.id,
      })
      .returning()

    const [venue2] = await db
      .insert(venue)
      .values({
        name: 'Berghain',
        capacity: 1500,
        notes: 'World-renowned techno club and concert venue',
        company_id: company2.id,
      })
      .returning()

    // Create venue members (technical staff)
    await db.insert(venue_member).values([
      {
        venue_id: venue1.id,
        person_id: person5.id,
        identifier: 'Stage Manager',
      },
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
        address_id: hotelAddress1.id,
      })
      .returning()

    // ========================================
    // Create Deal Memos
    // ========================================
    console.log('Creating deal memos...')
    const [dealMemo1] = await db
      .insert(deal_memo)
      .values({
        deal: 'The Electric Waves - Berlin Tour',
        date: '2026-06-15',
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
        band_id: band1.id,
        venue_id: venue2.id,
        hotel_id: hotel1.id,
      })
      .returning()

    const [dealMemo2] = await db
      .insert(deal_memo)
      .values({
        deal: 'Midnight Symphony - LA Showcase',
        date: '2026-08-22',
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
        band_id: band2.id,
        venue_id: venue1.id,
        hotel_id: null,
      })
      .returning()

    // ========================================
    // Create Itineraries
    // ========================================
    console.log('Creating itineraries...')
    await db.insert(itinerary).values([
      {
        notes: 'Standard setup for rock show',
        venue_id: venue2.id,
        hotel_id: hotel1.id,
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
        show_length: '90',
      },
      {
        notes: 'Electronic setup with DJ booth',
        venue_id: venue1.id,
        hotel_id: hotel1.id,
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
        show_length: '75',
      },
    ])

    console.log('Database seeded successfully!')
  } catch (error) {
    console.error('Error seeding database:', error)
    throw error
  }
}
