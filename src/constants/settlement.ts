export enum SettlementStatus {
  FROZEN = 'frozen',
  RELEASED = 'released',
  COMPENSATED = 'compensated',
}

export enum LedgerKind {
  FREEZE = 'freeze',
  UNFREEZE = 'unfreeze',
  COMPENSATION_IN = 'compensation_in',
  COMPENSATION_OUT = 'compensation_out',
}

export const DEPOSIT_POINTS = 20;

export const DEFAULT_POINTS = 100;

export const SETTLEMENT_STATUS_OPTIONS = [
  { label: '冻结中', value: SettlementStatus.FROZEN },
  { label: '已解冻', value: SettlementStatus.RELEASED },
  { label: '已赔付', value: SettlementStatus.COMPENSATED },
];

export const SETTLEMENT_STORAGE_HINTS = {
  statusKey: 'reswap:settlements',
  statusTouchedBy: ['models/settlement.ts', 'stores/settlementStore.ts', 'components/common/ExchangeCard.vue'],
};
