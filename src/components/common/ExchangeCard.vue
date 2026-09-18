<template>
  <article class="exchange-card">
    <header>
      <span class="status-pill" :class="statusToneClass(exchange.status)">
        {{ formatExchangeStatus(exchange.status) }}
      </span>
      <small>{{ formatDate(exchange.updated_at) }}</small>
    </header>
    <div class="exchange-card__items">
      <div>
        <span>拿出</span>
        <strong>{{ fromItem?.title ?? '未知物品' }}</strong>
      </div>
      <div>
        <span>换取</span>
        <strong>{{ toItem?.title ?? '未知物品' }}</strong>
      </div>
    </div>
    <p>{{ exchange.message || formatStatusMessage(exchange.status) }}</p>
    <p v-if="settlement" class="exchange-card__settlement">
      诚信金 {{ formatPoints(settlement.amount) }} / 人 · {{ formatSettlementStatus(settlement.status) }}
      <template v-if="settlement.status === SettlementStatus.COMPENSATED && settlement.cancelled_by">
        · {{ cancelerName }} 取消并赔付
      </template>
    </p>
    <footer>
      <span v-if="fromUser && toUser">{{ fromUser.nickname }} → {{ toUser.nickname }}</span>
      <div v-if="canOperate" class="exchange-card__actions">
        <template v-if="exchange.status === ExchangeStatus.PENDING && isToUser">
          <button type="button" :disabled="operating" @click="$emit('accept', exchange.id)">同意</button>
          <button type="button" :disabled="operating" @click="$emit('reject', exchange.id)">拒绝</button>
        </template>
        <template v-if="exchange.status === ExchangeStatus.ACCEPTED">
          <button type="button" :disabled="operating || confirmedByMe" @click="$emit('complete', exchange.id)">
            {{ confirmedByMe ? '等待对方确认' : '确认完成' }}
          </button>
          <button type="button" :disabled="operating" @click="$emit('cancel', exchange.id)">取消交换</button>
        </template>
      </div>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { ExchangeStatus } from '@/constants/exchange';
import { SettlementStatus } from '@/constants/settlement';
import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import type { ExchangeSettlement } from '@/models/settlement';
import type { User } from '@/models/user';
import { useAuthStore } from '@/stores/authStore';
import {
  formatDate,
  formatExchangeStatus,
  formatPoints,
  formatSettlementStatus,
  formatStatusMessage,
  statusToneClass,
} from '@/utils/formatters';

const props = withDefaults(
  defineProps<{
    exchange: Exchange;
    items: Item[];
    users: User[];
    settlement?: ExchangeSettlement | null;
    operating?: boolean;
  }>(),
  {
    settlement: null,
    operating: false,
  },
);

defineEmits<{
  accept: [id: string];
  reject: [id: string];
  complete: [id: string];
  cancel: [id: string];
}>();

const authStore = useAuthStore();
const fromItem = computed(() => props.items.find((item) => item.id === props.exchange.from_item_id));
const toItem = computed(() => props.items.find((item) => item.id === props.exchange.to_item_id));
const fromUser = computed(() => props.users.find((user) => user.id === props.exchange.from_user_id));
const toUser = computed(() => props.users.find((user) => user.id === props.exchange.to_user_id));
const isToUser = computed(() => authStore.currentUser?.id === props.exchange.to_user_id);
const isParty = computed(
  () =>
    authStore.currentUser?.id === props.exchange.to_user_id ||
    authStore.currentUser?.id === props.exchange.from_user_id,
);
const confirmedByMe = computed(() =>
  Boolean(authStore.currentUser && props.exchange.confirmations.includes(authStore.currentUser.id)),
);
const canOperate = computed(
  () =>
    isParty.value &&
    ((isToUser.value && props.exchange.status === ExchangeStatus.PENDING) ||
      props.exchange.status === ExchangeStatus.ACCEPTED),
);
const cancelerName = computed(
  () => props.users.find((user) => user.id === props.settlement?.cancelled_by)?.nickname ?? '对方',
);
</script>
