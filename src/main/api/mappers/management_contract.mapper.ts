import type { ManagementContractDto } from '../schemas/management_contract.schema'
import type { ManagementContractEntity } from '../../repositories/ManagementContractRepository'

export class ManagementContractMapper {
  static toDto(entity: ManagementContractEntity): ManagementContractDto {
    return {
      id: entity.id,
      bandId: entity.band_id,
      managementCompanyId: entity.management_company_id,
      startDate: entity.start_date,
      territory: entity.territory,
      termYears: entity.term_years,
      renewalYears: entity.renewal_years,
      noticeMonths: entity.notice_months,
      commissionPercent: entity.commission_percent,
      excludedIncome: entity.excluded_income,
      statementEmail: entity.statement_email,
      settlementDays: entity.settlement_days,
      paymentDays: entity.payment_days,
      postTermYear1Percent: entity.post_term_year1_percent,
      postTermYear2Percent: entity.post_term_year2_percent,
      postTermYear3Percent: entity.post_term_year3_percent,
      representativePersonId: entity.representative_person_id,
      specialClauses: entity.special_clauses,
      memberPersonIds: entity.memberPersonIds,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at
    }
  }

  static toDtoList(entities: ManagementContractEntity[]): ManagementContractDto[] {
    return entities.map((entity) => this.toDto(entity))
  }
}
