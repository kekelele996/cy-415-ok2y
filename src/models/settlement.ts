import type { LedgerKind, SettlementStatus } from '@/constants/settlement';

export interface PointAccount {
  user_id: string;
  balance: number;
  frozen: number;
  updated_at: string;
}

export interface ExchangeSettlement {
  id: string;
  exchange_id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  status: SettlementStatus;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PointLedgerEntry {
  id: string;
  user_id: string;
  exchange_id: string;
  settlement_id: string;
  kind: LedgerKind;
  amount: number;
  balance_after: number;
  frozen_after: number;
  created_at: string;
}
