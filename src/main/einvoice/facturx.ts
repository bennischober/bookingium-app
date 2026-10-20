// Turns the printed invoice PDF into a Factur-X / ZUGFeRD PDF (PDF/A-3b):
// embeds the XML as "factur-x.xml" ("xrechnung.xml" for the XRechnung
// profile; associated file, relationship Alternative), writes the Factur-X
// XMP metadata, and adds what Chromium's printToPDF output lacks for PDF/A:
// an sRGB output intent (it paints in DeviceRGB) and a file identifier.
// The page content stays untouched. Checked with veraPDF (flavour 3b).
import {
  AFRelationship,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
  PDFHexString,
  decodePDFRawStream
} from 'pdf-lib'
import { randomBytes } from 'crypto'
import { SRGB_PROFILE_NAME, srgbIccProfile } from './srgbIcc'

export const FACTURX_FILE_NAME = 'factur-x.xml'
export const XRECHNUNG_FILE_NAME = 'xrechnung.xml'

/** Factur-X/ZUGFeRD profile of the embedded XML */
export type FacturXProfile = 'EN 16931' | 'XRECHNUNG'

const FILE_NAMES: Record<FacturXProfile, string> = {
  'EN 16931': FACTURX_FILE_NAME,
  XRECHNUNG: XRECHNUNG_FILE_NAME
}
const FACTURX_NAMESPACE = 'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#'
// XMP packets start with a byte order mark
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function xmpProperty(name: string, description: string): string {
  return `<rdf:li rdf:parseType="Resource">
            <pdfaProperty:name>${name}</pdfaProperty:name>
            <pdfaProperty:valueType>Text</pdfaProperty:valueType>
            <pdfaProperty:category>external</pdfaProperty:category>
            <pdfaProperty:description>${description}</pdfaProperty:description>
          </rdf:li>`
}

function facturXXmp(title: string, date: Date, profile: FacturXProfile): string {
  const timestamp = date.toISOString().replace(/\.\d{3}Z$/, 'Z')
  return `<?xpacket begin="${BYTE_ORDER_MARK}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(title)}</rdf:li></rdf:Alt></dc:title>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>Bookingium</xmp:CreatorTool>
      <xmp:CreateDate>${timestamp}</xmp:CreateDate>
      <xmp:ModifyDate>${timestamp}</xmp:ModifyDate>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>${FACTURX_NAMESPACE}</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>
          ${xmpProperty('DocumentFileName', 'The name of the embedded XML document')}
          ${xmpProperty('DocumentType', 'The type of the hybrid document in capital letters, e.g. INVOICE or ORDER')}
          ${xmpProperty('Version', 'The actual version of the standard applying to the embedded XML document')}
          ${xmpProperty('ConformanceLevel', 'The conformance level of the embedded XML document')}
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="${FACTURX_NAMESPACE}">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${FILE_NAMES[profile]}</fx:DocumentFileName>
      <fx:Version>${profile === 'XRECHNUNG' ? '3.0' : '1.0'}</fx:Version>
      <fx:ConformanceLevel>${profile}</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

/** The PDF with the e-invoice XML embedded as factur-x.xml */
export async function embedFacturX(
  pdf: Uint8Array,
  xml: string,
  options: { title: string; date?: Date; profile?: FacturXProfile }
): Promise<Uint8Array> {
  const date = options.date ?? new Date()
  const profile = options.profile ?? 'EN 16931'
  const doc = await PDFDocument.load(pdf, { updateMetadata: false })
  const { context } = doc

  await doc.attach(new TextEncoder().encode(xml), FILE_NAMES[profile], {
    mimeType: 'text/xml',
    description: 'Factur-X/ZUGFeRD-Rechnung',
    creationDate: date,
    modificationDate: date,
    afRelationship: AFRelationship.Alternative
  })

  const metadata = context.stream(facturXXmp(options.title, date, profile), {
    Type: 'Metadata',
    Subtype: 'XML'
  })
  doc.catalog.set(PDFName.of('Metadata'), context.register(metadata))
  doc.setTitle(options.title)
  doc.setCreator('Bookingium')
  doc.setModificationDate(date)

  // PDF/A: device-independent meaning of DeviceRGB (ISO 19005-3, 6.2.4.3)
  const profileStream = context.flateStream(srgbIccProfile(), { N: 3 })
  const outputIntent = context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of(SRGB_PROFILE_NAME),
    Info: PDFString.of(SRGB_PROFILE_NAME),
    RegistryName: PDFString.of('http://www.color.org'),
    DestOutputProfile: context.register(profileStream)
  })
  doc.catalog.set(PDFName.of('OutputIntents'), context.obj([context.register(outputIntent)]))
  // PDF/A: file identifier in the trailer (6.1.3)
  const id = PDFHexString.of(randomBytes(16).toString('hex'))
  context.trailerInfo.ID = context.obj([id, id])

  return doc.save()
}

/** The embedded e-invoice XML of a PDF, null if it has none (tests, checks) */
export async function readFacturX(pdf: Uint8Array): Promise<string | null> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false })
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
  const entries = embedded?.lookupMaybe(PDFName.of('Names'), PDFArray)
  if (!entries) return null

  for (let index = 0; index + 1 < entries.size(); index += 2) {
    const name = entries.lookup(index)
    const fileName =
      name instanceof PDFHexString || name instanceof PDFString ? name.decodeText() : ''
    if (fileName !== FACTURX_FILE_NAME && fileName !== XRECHNUNG_FILE_NAME) continue
    const spec = entries.lookup(index + 1, PDFDict)
    const stream = spec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F'))
    if (!(stream instanceof PDFRawStream)) return null
    return new TextDecoder().decode(decodePDFRawStream(stream).decode())
  }
  return null
}
