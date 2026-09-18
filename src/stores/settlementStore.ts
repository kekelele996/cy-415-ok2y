import { defineStore } from 'pinia';

import { settlementApi } from '@/api/settlementApi';
import type { ExchangeSettlement, PointAccount, PointLedgerEntry } from '@/models/settlement';

export const useSettlementStore = defineStore('settlements', {
  state: () => ({
    accounts: [] as PointAccount[],
    ledger: [] as PointLedgerEntry[],
    settlements: [] as ExchangeSettlement[],
    loading: false,
  }),
  getters: {
    accountOf: (state) => (userId: string) => state.accounts.find((item) => item.user_id === userId),
    settlementOf: (state) => (exchangeId: string) =>
      state.settlements.find((item) => item.exchange_id === exchangeId),
    ledgerOfUser: (state) => (userId: string) =>
      state.ledger.filter((item) => item.user_id === userId).slice().reverse(),
    ledgerOfExchange: (state) => (exchangeId: string) =>
      state.ledger.filter((item) => item.exchange_id === exchangeId),
  },
  actions: {
    async hydrate() {
      this.loading = true;
      try {
        const [accounts, ledger, settlements] = await Promise.all([
          settlementApi.listAccounts(),
          settlementApi.listLedger(),
          settlementApi.listSettlements(),
        ]);
        this.accounts = accounts;
        this.ledger = ledger;
        this.settlements = settlements;
      } finally {
        this.loading = false;
      }
    },
  },
});
