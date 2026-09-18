import { EXCHANGE_ACTION_FLOW, ExchangeStatus } from '@/constants/exchange';
import { ItemStatus } from '@/constants/item';
import { SETTLEMENT_MESSAGES } from '@/constants/messages';
import { DEFAULT_POINTS, DEPOSIT_POINTS, LedgerKind, SettlementStatus } from '@/constants/settlement';
import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import type { ExchangeSettlement, PointAccount, PointLedgerEntry } from '@/models/settlement';
import { storage, STORAGE_KEYS } from '@/utils/storage';

const seedAccounts: PointAccount[] = [
  {
    user_id: 'user_me',
    balance: DEFAULT_POINTS,
    frozen: 0,
    updated_at: new Date().toISOString(),
  },
  {
    user_id: 'user_lin',
    balance: DEFAULT_POINTS,
    frozen: 0,
    updated_at: new Date().toISOString(),
  },
  {
    // 演示「余额不足整次拒绝」：陈木木只有 10 点，无法凑齐 20 点诚信金
    user_id: 'user_chen',
    balance: 10,
    frozen: 0,
    updated_at: new Date().toISOString(),
  },
];

const withDefaults = (accounts: PointAccount[], userIds: string[]): PointAccount[] => {
  const next = [...accounts];
  for (const userId of userIds) {
    if (!next.some((account) => account.user_id === userId)) {
      next.push({ user_id: userId, balance: DEFAULT_POINTS, frozen: 0, updated_at: new Date().toISOString() });
    }
  }
  return next;
};

const accountOf = (accounts: PointAccount[], userId: string): PointAccount => {
  const account = accounts.find((item) => item.user_id === userId);
  if (!account) throw new Error('积分账户不存在');
  return account;
};

const loadExchanges = () => storage.get<Exchange[]>(STORAGE_KEYS.exchanges, []);

const requireExchange = (exchanges: Exchange[], exchangeId: string): Exchange => {
  const current = exchanges.find((item) => item.id === exchangeId);
  if (!current) throw new Error('交换请求不存在');
  return { ...current, confirmations: current.confirmations ?? [] };
};

const requireParty = (exchange: Exchange, userId: string) => {
  if (userId !== exchange.from_user_id && userId !== exchange.to_user_id) {
    throw new Error('只有交换双方可以操作该结算');
  }
};

const ledgerEntry = (
  settlement: ExchangeSettlement,
  userId: string,
  kind: LedgerKind,
  amount: number,
  account: PointAccount,
  createdAt: string,
): PointLedgerEntry => ({
  // 确定性 ID：同一结算同一用户同一类型只生成一条，重放时覆盖而非重复
  id: `${settlement.id}:${kind}:${userId}`,
  user_id: userId,
  exchange_id: settlement.exchange_id,
  settlement_id: settlement.id,
  kind,
  amount,
  balance_after: account.balance,
  frozen_after: account.frozen,
  created_at: createdAt,
});

export const settlementApi = {
  async listAccounts(): Promise<PointAccount[]> {
    const accounts = await storage.get<PointAccount[]>(STORAGE_KEYS.accounts, []);
    if (accounts.length) return accounts;
    await storage.set(STORAGE_KEYS.accounts, seedAccounts);
    return seedAccounts;
  },

  async listLedger(): Promise<PointLedgerEntry[]> {
    return storage.get<PointLedgerEntry[]>(STORAGE_KEYS.ledger, []);
  },

  async listSettlements(): Promise<ExchangeSettlement[]> {
    return storage.get<ExchangeSettlement[]>(STORAGE_KEYS.settlements, []);
  },

  // 同意交换：双方各冻结 DEPOSIT_POINTS 点，余额不足则整次拒绝，不产生任何写入
  async freezeOnAccept(exchangeId: string): Promise<Exchange> {
    const exchanges = await loadExchanges();
    const current = requireExchange(exchanges, exchangeId);
    if (!EXCHANGE_ACTION_FLOW[current.status].includes(ExchangeStatus.ACCEPTED)) {
      throw new Error('当前状态不允许该操作');
    }
    const settlements = await this.listSettlements();
    if (settlements.some((item) => item.exchange_id === exchangeId)) {
      throw new Error(SETTLEMENT_MESSAGES.duplicate);
    }
    const userIds = [current.from_user_id, current.to_user_id];
    const accounts = withDefaults(await this.listAccounts(), userIds);
    const fromAccount = accountOf(accounts, current.from_user_id);
    const toAccount = accountOf(accounts, current.to_user_id);
    if (fromAccount.balance < DEPOSIT_POINTS || toAccount.balance < DEPOSIT_POINTS) {
      throw new Error(SETTLEMENT_MESSAGES.insufficient);
    }

    const now = new Date().toISOString();
    const settlement: ExchangeSettlement = {
      id: storage.createId('settlement'),
      exchange_id: exchangeId,
      from_user_id: current.from_user_id,
      to_user_id: current.to_user_id,
      amount: DEPOSIT_POINTS,
      status: SettlementStatus.FROZEN,
      cancelled_by: null,
      created_at: now,
      updated_at: now,
    };
    const nextAccounts = accounts.map((account) =>
      userIds.includes(account.user_id)
        ? { ...account, balance: account.balance - DEPOSIT_POINTS, frozen: account.frozen + DEPOSIT_POINTS, updated_at: now }
        : account,
    );
    const ledgerEntries = userIds.map((userId) =>
      ledgerEntry(settlement, userId, LedgerKind.FREEZE, -DEPOSIT_POINTS, accountOf(nextAccounts, userId), now),
    );
    const nextExchange: Exchange = { ...current, status: ExchangeStatus.ACCEPTED, updated_at: now };

    await storage.runTransaction([
      { key: STORAGE_KEYS.accounts, value: nextAccounts },
      { key: STORAGE_KEYS.ledger, value: [...(await this.listLedger()), ...ledgerEntries] },
      { key: STORAGE_KEYS.settlements, value: [...settlements, settlement] },
      { key: STORAGE_KEYS.exchanges, value: exchanges.map((item) => (item.id === exchangeId ? nextExchange : item)) },
    ]);
    return nextExchange;
  },

  // 确认完成：双方都确认后，冻结份额原额解冻，交换与物品状态同事务落库
  async confirmCompletion(exchangeId: string, userId: string): Promise<Exchange> {
    const exchanges = await loadExchanges();
    const current = requireExchange(exchanges, exchangeId);
    if (!EXCHANGE_ACTION_FLOW[current.status].includes(ExchangeStatus.COMPLETED)) {
      throw new Error('当前状态不允许该操作');
    }
    requireParty(current, userId);
    if (current.confirmations.includes(userId)) {
      // 幂等：重复确认直接回读现状，不产生写入
      return current;
    }

    const now = new Date().toISOString();
    const confirmations = [...current.confirmations, userId];
    const bothConfirmed = [current.from_user_id, current.to_user_id].every((id) => confirmations.includes(id));
    if (!bothConfirmed) {
      const nextExchange: Exchange = { ...current, confirmations, updated_at: now };
      await storage.runTransaction([
        { key: STORAGE_KEYS.exchanges, value: exchanges.map((item) => (item.id === exchangeId ? nextExchange : item)) },
      ]);
      return nextExchange;
    }

    const settlements = await this.listSettlements();
    const settlement = settlements.find((item) => item.exchange_id === exchangeId);
    if (!settlement) throw new Error(SETTLEMENT_MESSAGES.missing);
    if (settlement.status !== SettlementStatus.FROZEN) {
      // 幂等：结算已终态，重放不再解冻
      return current;
    }

    const userIds = [settlement.from_user_id, settlement.to_user_id];
    const accounts = withDefaults(await this.listAccounts(), userIds);
    const nextAccounts = accounts.map((account) =>
      userIds.includes(account.user_id)
        ? { ...account, balance: account.balance + settlement.amount, frozen: account.frozen - settlement.amount, updated_at: now }
        : account,
    );
    const ledgerEntries = userIds.map((id) =>
      ledgerEntry(settlement, id, LedgerKind.UNFREEZE, settlement.amount, accountOf(nextAccounts, id), now),
    );
    const nextSettlement: ExchangeSettlement = { ...settlement, status: SettlementStatus.RELEASED, updated_at: now };
    const nextExchange: Exchange = { ...current, status: ExchangeStatus.COMPLETED, confirmations, updated_at: now };
    const items = await storage.get<Item[]>(STORAGE_KEYS.items, []);
    const nextItems = items.map((item) =>
      item.id === current.from_item_id || item.id === current.to_item_id
        ? { ...item, status: ItemStatus.EXCHANGED }
        : item,
    );

    await storage.runTransaction([
      { key: STORAGE_KEYS.accounts, value: nextAccounts },
      { key: STORAGE_KEYS.ledger, value: [...(await this.listLedger()), ...ledgerEntries] },
      { key: STORAGE_KEYS.settlements, value: settlements.map((item) => (item.id === settlement.id ? nextSettlement : item)) },
      { key: STORAGE_KEYS.exchanges, value: exchanges.map((item) => (item.id === exchangeId ? nextExchange : item)) },
      { key: STORAGE_KEYS.items, value: nextItems },
    ]);
    return nextExchange;
  },

  // 取消交换：仅取消方冻结份额划给对方，另一方自己的冻结份额原额退回（积分不变）
  async cancelWithCompensation(exchangeId: string, userId: string): Promise<Exchange> {
    const exchanges = await loadExchanges();
    const current = requireExchange(exchanges, exchangeId);
    if (!EXCHANGE_ACTION_FLOW[current.status].includes(ExchangeStatus.CANCELLED)) {
      throw new Error('当前状态不允许该操作');
    }
    requireParty(current, userId);

    const settlements = await this.listSettlements();
    const settlement = settlements.find((item) => item.exchange_id === exchangeId);
    if (!settlement || settlement.status !== SettlementStatus.FROZEN) {
      throw new Error(SETTLEMENT_MESSAGES.notFrozen);
    }

    const now = new Date().toISOString();
    const otherId = userId === settlement.from_user_id ? settlement.to_user_id : settlement.from_user_id;
    const accounts = withDefaults(await this.listAccounts(), [settlement.from_user_id, settlement.to_user_id]);
    const nextAccounts = accounts.map((account) => {
      if (account.user_id === userId) {
        // 取消方：冻结份额转出作为赔付
        return { ...account, frozen: account.frozen - settlement.amount, updated_at: now };
      }
      if (account.user_id === otherId) {
        // 另一方：自己的份额原额解冻，并收到取消方的赔付
        return { ...account, balance: account.balance + settlement.amount * 2, frozen: account.frozen - settlement.amount, updated_at: now };
      }
      return account;
    });

    const cancelerAfter = accountOf(nextAccounts, userId);
    const otherAfter = accountOf(nextAccounts, otherId);
    const ledgerEntries: PointLedgerEntry[] = [
      ledgerEntry(settlement, userId, LedgerKind.COMPENSATION_OUT, -settlement.amount, cancelerAfter, now),
      ledgerEntry(settlement, otherId, LedgerKind.UNFREEZE, settlement.amount, { ...otherAfter, balance: otherAfter.balance - settlement.amount }, now),
      ledgerEntry(settlement, otherId, LedgerKind.COMPENSATION_IN, settlement.amount, otherAfter, now),
    ];
    const nextSettlement: ExchangeSettlement = {
      ...settlement,
      status: SettlementStatus.COMPENSATED,
      cancelled_by: userId,
      updated_at: now,
    };
    const nextExchange: Exchange = { ...current, status: ExchangeStatus.CANCELLED, updated_at: now };

    await storage.runTransaction([
      { key: STORAGE_KEYS.accounts, value: nextAccounts },
      { key: STORAGE_KEYS.ledger, value: [...(await this.listLedger()), ...ledgerEntries] },
      { key: STORAGE_KEYS.settlements, value: settlements.map((item) => (item.id === settlement.id ? nextSettlement : item)) },
      { key: STORAGE_KEYS.exchanges, value: exchanges.map((item) => (item.id === exchangeId ? nextExchange : item)) },
    ]);
    return nextExchange;
  },
};
