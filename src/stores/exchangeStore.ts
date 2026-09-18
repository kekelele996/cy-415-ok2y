import { defineStore } from 'pinia';

import { exchangeApi } from '@/api/exchangeApi';
import { settlementApi } from '@/api/settlementApi';
import { ExchangeStatus } from '@/constants/exchange';
import { SETTLEMENT_MESSAGES } from '@/constants/messages';
import type { Exchange, ExchangeDraft } from '@/models/exchange';
import { useAuthStore } from '@/stores/authStore';
import { useItemStore } from '@/stores/itemStore';
import { useSettlementStore } from '@/stores/settlementStore';
import { message } from '@/utils/message';

export const useExchangeStore = defineStore('exchanges', {
  state: () => ({
    exchanges: [] as Exchange[],
    statusFilter: 'all' as ExchangeStatus | 'all',
    operatingIds: [] as string[],
    loading: false,
  }),
  getters: {
    sent: (state) => (userId: string) => state.exchanges.filter((item) => item.from_user_id === userId),
    received: (state) => (userId: string) => state.exchanges.filter((item) => item.to_user_id === userId),
    filtered: (state) => {
      if (state.statusFilter === 'all') return state.exchanges;
      return state.exchanges.filter((item) => item.status === state.statusFilter);
    },
    isOperating: (state) => (id: string) => state.operatingIds.includes(id),
  },
  actions: {
    async hydrate() {
      this.loading = true;
      try {
        this.exchanges = await exchangeApi.list();
      } finally {
        this.loading = false;
      }
    },
    // 每次结算操作后从存储层回读，保证页面、余额与流水一致
    async reloadAfterSettlement() {
      const settlementStore = useSettlementStore();
      const itemStore = useItemStore();
      const [exchanges] = await Promise.all([exchangeApi.list(), settlementStore.hydrate(), itemStore.hydrate()]);
      this.exchanges = exchanges;
    },
    async runExclusive(id: string, task: () => Promise<void>) {
      // 防重复点击 / 双方同时操作：同一交换同一时刻只允许一个结算动作
      if (this.operatingIds.includes(id)) return;
      this.operatingIds.push(id);
      try {
        await task();
      } catch (error) {
        await this.reloadAfterSettlement();
        message(error instanceof Error ? error.message : '操作失败', 'error');
      } finally {
        this.operatingIds = this.operatingIds.filter((item) => item !== id);
      }
    },
    async create(draft: ExchangeDraft) {
      const exchange = await exchangeApi.create({ ...draft, status: ExchangeStatus.PENDING });
      this.exchanges = await exchangeApi.list();
      message('交换请求已发出', 'success');
      return exchange;
    },
    async accept(id: string) {
      await this.runExclusive(id, async () => {
        await settlementApi.freezeOnAccept(id);
        await this.reloadAfterSettlement();
        message(SETTLEMENT_MESSAGES.accepted, 'success');
      });
    },
    async reject(id: string) {
      await this.runExclusive(id, async () => {
        await exchangeApi.transition(id, ExchangeStatus.REJECTED);
        this.exchanges = await exchangeApi.list();
        message('已拒绝交换', 'success');
      });
    },
    async complete(id: string) {
      const userId = useAuthStore().currentUser?.id;
      if (!userId) return;
      await this.runExclusive(id, async () => {
        const exchange = await settlementApi.confirmCompletion(id, userId);
        await this.reloadAfterSettlement();
        if (exchange.status === ExchangeStatus.COMPLETED) {
          message(SETTLEMENT_MESSAGES.completed, 'success');
        } else {
          message(SETTLEMENT_MESSAGES.confirmWait, 'info');
        }
      });
    },
    async cancel(id: string) {
      const userId = useAuthStore().currentUser?.id;
      if (!userId) return;
      await this.runExclusive(id, async () => {
        await settlementApi.cancelWithCompensation(id, userId);
        await this.reloadAfterSettlement();
        message(SETTLEMENT_MESSAGES.cancelled, 'success');
      });
    },
  },
});
