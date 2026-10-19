// Turns the printed invoice PDF into a Factur-X / ZUGFeRD PDF: embeds the
// XML as "factur-x.xml" (associated file, relationship Alternative) and
// writes the Factur-X XMP metadata. The page content stays untouched.
//
// printToPDF output is not strict PDF/A-3 (no output intent, Chromium's
// structure); receiving software reads the XML regardless, a strict PDF/A
// checker flags the file. See docs/TODOS.md.
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

export const FACTURX_FILE_NAME = 'factur-x.xml'
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

function facturXXmp(title: string, date: Date): string {
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
      <fx:DocumentFileName>${FACTURX_FILE_NAME}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

/** The PDF with the e-invoice XML embedded as factur-x.xml */
export async function embedFacturX(
  pdf: Uint8Array,
  xml: string,
  options: { title: string; date?: Date }
): Promise<Uint8Array> {
  const date = options.date ?? new Date()
  const doc = await PDFDocument.load(pdf, { updateMetadata: false })

  await doc.attach(new TextEncoder().encode(xml), FACTURX_FILE_NAME, {
    mimeType: 'text/xml',
    description: 'Factur-X/ZUGFeRD-Rechnung',
    creationDate: date,
    modificationDate: date,
    afRelationship: AFRelationship.Alternative
  })

  const metadata = doc.context.stream(facturXXmp(options.title, date), {
    Type: 'Metadata',
    Subtype: 'XML'
  })
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(metadata))
  doc.setTitle(options.title)
  doc.setCreator('Bookingium')
  doc.setModificationDate(date)

  return doc.save()
}

/** The embedded factur-x.xml of a PDF, null if it has none (tests, checks) */
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
    if (fileName !== FACTURX_FILE_NAME) continue
    const spec = entries.lookup(index + 1, PDFDict)
    const stream = spec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F'))
    if (!(stream instanceof PDFRawStream)) return null
    return new TextDecoder().decode(decodePDFRawStream(stream).decode())
  }
  return null
}
