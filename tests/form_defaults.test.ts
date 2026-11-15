import { describe, expect, it } from 'vitest'
import {
  addressDefaults,
  basicContactDefaults,
  contactDefaults,
  optionalAddress,
  optionalContact
} from '../src/renderer/src/components/forms/formDefaults'
import { required } from '../src/renderer/src/components/forms/appForm'

// #171: the shared start values and "send only when filled in" rules of the forms.

describe('addressDefaults', () => {
  it('starts empty without an address', () => {
    expect(addressDefaults()).toEqual({
      street: '',
      streetNumber: '',
      addressSuffix: '',
      zipCode: '',
      city: '',
      state: '',
      country: '',
      countryCode: ''
    })
    expect(addressDefaults(null).city).toBe('')
  })

  it('takes the stored values and drops the id', () => {
    const values = addressDefaults({
      id: 7,
      street: 'Teststraße',
      streetNumber: '1',
      addressSuffix: null,
      zipCode: '12345',
      city: 'Musterstadt',
      state: null,
      country: 'Deutschland',
      countryCode: 'DE'
    } as never)
    expect(values).not.toHaveProperty('id')
    expect(values.street).toBe('Teststraße')
    expect(values.addressSuffix).toBe('')
    expect(values.countryCode).toBe('DE')
  })
})

describe('contact defaults', () => {
  it('basic contact has only phone, mail and homepage', () => {
    expect(basicContactDefaults()).toEqual({ email: '', phone: '', mobilePhone: '', homepage: '' })
  })

  it('full contact adds further mails and the advertising flag', () => {
    expect(contactDefaults()).toEqual({
      email: '',
      otherEmails: [],
      phone: '',
      mobilePhone: '',
      homepage: '',
      noAdvertising: false
    })
    const values = contactDefaults({
      id: 3,
      email: 'info@example.test',
      otherEmails: ['b@example.test'],
      phone: null,
      mobilePhone: null,
      homepage: null,
      noAdvertising: true
    } as never)
    expect(values).not.toHaveProperty('id')
    expect(values.email).toBe('info@example.test')
    expect(values.otherEmails).toHaveLength(1)
    expect(values.phone).toBe('')
    expect(values.noAdvertising).toBe(true)
  })
})

describe('optionalAddress', () => {
  it('leaves out an address of blanks', () => {
    expect(optionalAddress({ ...addressDefaults(), city: '   ' })).toEqual({})
  })

  it('sends an address with any part filled in', () => {
    const address = { ...addressDefaults(), city: 'Musterstadt' }
    expect(optionalAddress(address)).toEqual({ address })
  })
})

describe('optionalContact', () => {
  it('leaves out an empty contact', () => {
    expect(optionalContact(basicContactDefaults())).toEqual({})
  })

  it('sends a contact with a value', () => {
    const contact = { ...basicContactDefaults(), phone: '0123' }
    expect(optionalContact(contact)).toEqual({ contact })
  })
})

describe('required', () => {
  const validate = required('Name')

  it('rejects blank values', () => {
    expect(validate({ value: '' })).toBe('Name ist erforderlich')
    expect(validate({ value: '  ' })).toBe('Name ist erforderlich')
    expect(validate({ value: null })).toBe('Name ist erforderlich')
    expect(validate({ value: undefined })).toBe('Name ist erforderlich')
  })

  it('accepts text', () => {
    expect(validate({ value: 'Band' })).toBeUndefined()
  })
})
