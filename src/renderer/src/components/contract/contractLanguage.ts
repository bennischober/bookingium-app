import type { ContractDocument } from '../../../../main/mail/contractEmail'
import type { DocumentLang } from '../print/DocumentLanguageSelect'

// ========================================
// Contract language (DE/EN, picked on the print page, never stored)
// ========================================

// Each contract renders its English text from its own component (ContractDocumentEn.tsx,
// ManagementContractDocumentEn.tsx) when the print page picks English.

/** The words of the contract PDF's file name, in the contract's language */
export const CONTRACT_FILE_NAMES: Record<ContractDocument, Record<DocumentLang, string>> = {
  concert: { de: 'Auftrittsvertrag', en: 'Guest appearance contract' },
  management: { de: 'Managementvertrag', en: 'Management agreement' }
}
