// Validates the e-invoice samples with the official KoSIT validator
// (https://github.com/itplr-kosit/validator, XRechnung configuration with
// its "EN16931 (CII)" scenario: CII schema + EN 16931 schematron). Needs
// Java and both downloads, so it only runs when pointed at them:
//   KOSIT_VALIDATOR=…/validator-1.6.3-standalone.jar
//   KOSIT_CONFIG=…/xrechnung-3.0.2-validator-configuration-…  (unzipped)
// The XML files and the validator reports stay in a temp folder
// (KOSIT_OUT to keep them somewhere else).
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { prepareEInvoice } from '../src/main/einvoice/prepare'
import { buildCiiXml } from '../src/main/einvoice/cii'
import { EINVOICE_SAMPLES } from './helpers/einvoiceFixtures'

const validator = process.env.KOSIT_VALIDATOR
const config = process.env.KOSIT_CONFIG

describe.skipIf(!validator || !config)('KoSIT validator', () => {
  it('accepts every sample as EN 16931', () => {
    const out = process.env.KOSIT_OUT ?? mkdtempSync(join(tmpdir(), 'bookingum-kosit-'))
    const files = Object.entries(EINVOICE_SAMPLES).map(([name, input]) => {
      const result = prepareEInvoice(input)
      expect(result.missing, name).toEqual([])
      const file = join(out, `${name}.xml`)
      writeFileSync(file, buildCiiXml(result.prepared!), 'utf-8')
      return file
    })
    // Negative control: a wrong total must be rejected, else the run proves nothing
    const tampered = join(out, 'tampered.xml')
    writeFileSync(
      tampered,
      readFileSync(files[0], 'utf-8').replace(
        /<ram:GrandTotalAmount>[^<]+</,
        '<ram:GrandTotalAmount>1.00<'
      ),
      'utf-8'
    )

    try {
      execFileSync(
        'java',
        [
          '-jar',
          validator!,
          '-s',
          join(config!, 'scenarios.xml'),
          '-r',
          config!,
          '-o',
          out,
          ...files,
          tampered
        ],
        { stdio: 'pipe' }
      )
    } catch {
      // Exit code != 0 when a file is rejected; the reports below say which
    }

    for (const file of files) {
      const name = file.replace(/\.xml$/, '-report.xml')
      const report = readFileSync(name, 'utf-8')
      // Every finding (error or warning) is a <rep:message code="BR-…">
      const findings = [...report.matchAll(/<rep:message[^>]*code="([^"]+)"/g)]
      expect(
        findings.map((match) => match[1]),
        file
      ).toEqual([])
      // Plain samples run the EN 16931 scenario, XRechnung ones the XRechnung one
      expect(report, file).toContain(
        file.includes('xrechnung') ? 'EN16931 XRechnung (CII)' : 'EN16931 (CII)'
      )
      expect(report, file).toMatch(/<rep:assessment>\s*<rep:accept>/)
    }
    const rejected = readFileSync(join(out, 'tampered-report.xml'), 'utf-8')
    expect(rejected).toMatch(/<rep:assessment>\s*<rep:reject>/)
    expect(rejected).toContain('code="BR-CO-15"')
    expect(readdirSync(out).filter((f) => f.endsWith('-report.xml'))).toHaveLength(files.length + 1)
  }, 120_000)
})
