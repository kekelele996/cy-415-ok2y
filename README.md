# ReSwap 二手闲置物品交换平台

```bash
pnpm install
pnpm dev
```

访问地址：`http://localhost:18415`

## 项目介绍

ReSwap 是一个纯前端以物换物 Web 应用。用户可以本地模拟登录、发布闲置物品、浏览他人物品、发起交换请求，并在浏览器内管理交换记录。

## 主要功能

- 首页瀑布流浏览、分类筛选、关键词搜索。
- 物品详情、物主资料、选择自己的物品发起交换。
- 发布物品，支持本地 base64 图片上传、分类和成色选择。
- 交换管理，区分我发起的和我收到的请求，支持同意、拒绝、完成、取消。
- 交换诚信金结算：同意交换时双方各冻结 20 点平台积分，双方确认完成后原额解冻，任一方取消时取消方份额赔付给对方。
- 个人中心，编辑资料、上传头像、查看我发布的物品、查看积分账户与积分流水。
- 主题切换、全局错误处理和 Vant 提示。

## 交换诚信金结算

诚信金结算接入「已同意」交换，规则如下：

- **冻结**：接收方点击「同意」时，双方各冻结 20 点平台积分；任一方可用余额不足 20 点时整次拒绝，交换保持「待确认」，不产生任何写入。
- **完成解冻**：双方都在交换卡片上点击「确认完成」后，双方冻结份额原额解冻，交换进入「已完成」，双方物品标记为「已交换」。
- **取消赔付**：「已同意」状态下任一方可取消；仅取消方冻结的 20 点划给对方作为赔付，另一方自己的 20 点原额退回（其自身积分份额不变），交换进入「已取消」。
- **原子持久化**：冻结、完成解冻、取消赔付与交换状态通过 `storage.runTransaction` 一次落库；写入前先记录快照日志（journal），任一步失败或页面中途刷新，全部数据回到结算前状态（启动时 `recoverTransaction` 自动回滚）。
- **幂等防重**：每笔交换最多存在一条结算记录；同一交换的结算动作串行执行（`operatingIds` 互斥锁 + 按钮禁用）；流水条目使用确定性 ID（`结算ID:类型:用户ID`），重复点击、双方同时操作、刷新重放都只会结算一次；每次操作后 store 从存储层回读，页面展示与余额流水保持一致。

演示数据：青禾、林小雨各有 100 点积分，陈木木只有 10 点（用于演示余额不足时整次拒绝）。积分账户与流水可在「我的」页面查看。

## 启动与构建

```bash
pnpm install
pnpm dev
```

```bash
pnpm build
```

生产部署：执行 `pnpm build` 后，将 `dist/` 目录交给 Nginx 或任意静态文件服务器托管。

## 技术栈

| 类型 | 技术 |
| --- | --- |
| 框架 | Vue 3 + TypeScript |
| 构建 | Vite |
| 状态管理 | Pinia |
| 路由 | Vue Router 4 |
| UI | Vant + Tailwind CSS |
| 持久化 | localStorage + IndexedDB（idb-keyval） |
| 工具库 | dayjs、lodash-es |

## 项目目录结构

```text
src/
├── api/              # userApi.ts, itemApi.ts, exchangeApi.ts, settlementApi.ts：本地数据 API 层
├── stores/           # authStore.ts, itemStore.ts, exchangeStore.ts, settlementStore.ts, themeStore.ts
├── models/           # user.ts, item.ts, exchange.ts, settlement.ts：独立数据模型
├── types/            # 共享类型补充
├── components/common/# 共享业务组件和 GlobalErrorBoundary
├── hooks/            # useAuth.ts, useLocalStorage.ts, useExchangeStats.ts
├── pages/            # Home, ItemDetail, Publish, Exchanges, Profile
├── router/           # index.ts + guards.ts
├── utils/            # storage.ts, formatters.ts, validators.ts, message.ts, themeUtils.ts
├── constants/        # item.ts, exchange.ts, settlement.ts, themes.ts, messages.ts
├── App.vue
├── main.ts
└── styles.css
```

## 数据持久化说明

- `utils/storage.ts` 统一封装 localStorage 和 IndexedDB。
- 所有 `api/*Api.ts` 通过 `storage.ts` 读写数据，不在组件里直接写业务数据。
- 存储层包含序列化、版本号、过期清理、存储 key 管理。
- 存储层提供 `runTransaction`（多 key 事务写入 + 快照回滚 + 写前日志）与 `recoverTransaction`（启动时回滚未完成事务），诚信金结算的冻结、解冻、赔付与交换状态在一次事务中持久化。
- 首次启动会写入演示用户、物品、交换请求和积分账户。

## 横切关注点

- 主题切换：`stores/themeStore.ts`、`constants/themes.ts`、`utils/themeUtils.ts`、`App.vue`、`components/common/CategoryFilter.vue`、`components/common/UserBrief.vue`、`components/common/ItemCard.vue`。
- 全局错误处理/提示：`utils/message.ts`、`components/common/GlobalErrorBoundary.tsx`、`stores/authStore.ts`、`stores/itemStore.ts`、`stores/exchangeStore.ts`、`components/common/ImageUploader.vue`。

## 枚举出现位置清单

### ItemStatus

定义位置：`src/constants/item.ts`

出现位置：

- `src/models/item.ts`
- `src/constants/messages.ts`
- `src/api/itemApi.ts`
- `src/api/exchangeApi.ts`
- `src/api/settlementApi.ts`
- `src/stores/itemStore.ts`
- `src/router/guards.ts`
- `src/utils/formatters.ts`
- `src/components/common/ItemCard.vue`
- `src/pages/ItemDetail.vue`
- `src/pages/Publish.vue`
- `src/pages/Profile.vue`

### ExchangeStatus

定义位置：`src/constants/exchange.ts`

值：`PENDING` / `ACCEPTED` / `REJECTED` / `COMPLETED` / `CANCELLED`

出现位置：

- `src/models/exchange.ts`
- `src/constants/messages.ts`
- `src/api/exchangeApi.ts`
- `src/api/settlementApi.ts`
- `src/stores/exchangeStore.ts`
- `src/router/guards.ts`
- `src/utils/formatters.ts`
- `src/hooks/useExchangeStats.ts`
- `src/components/common/ExchangeCard.vue`
- `src/pages/ItemDetail.vue`
- `src/pages/Exchanges.vue`

### SettlementStatus

定义位置：`src/constants/settlement.ts`

值：`FROZEN`（冻结中）/ `RELEASED`（已解冻）/ `COMPENSATED`（已赔付）

出现位置：

- `src/models/settlement.ts`
- `src/api/settlementApi.ts`
- `src/utils/formatters.ts`
- `src/components/common/ExchangeCard.vue`

### LedgerKind

定义位置：`src/constants/settlement.ts`

值：`FREEZE`（诚信金冻结）/ `UNFREEZE`（诚信金解冻）/ `COMPENSATION_IN`（取消赔付入账）/ `COMPENSATION_OUT`（取消赔付支出）

出现位置：

- `src/models/settlement.ts`
- `src/api/settlementApi.ts`
- `src/utils/formatters.ts`
- `src/pages/Profile.vue`

## 分层与高耦合约束

本项目保留提示词要求的“严禁合并职责到单一文件”：模型、常量、API、store、页面、组件、hooks、utils 均独立拆分。

同时保留“屎山代码设计要求”的低内聚高耦合特征：

- `utils/formatters.ts` 同时负责日期、物品状态、交换状态、成色、信用等级文本。
- `constants/messages.ts` 同时包含页面提示、表单校验、日志式文案和状态文案。
- `ItemStatus` 与 `ExchangeStatus` 被模型、API、store、组件、页面、router guards、formatters 多处引用。
- `utils/storage.ts` 是存储入口，但全应用 API 和 store 都依赖它的 key 与数据结构。

例如新增 `ItemStatus.BOOKED` 时，应至少修改：`src/constants/item.ts`、`src/models/item.ts`、`src/api/itemApi.ts`、`src/api/exchangeApi.ts`、`src/stores/itemStore.ts`、`src/router/guards.ts`、`src/utils/formatters.ts`、`src/constants/messages.ts`、`src/components/common/ItemCard.vue`、`src/pages/ItemDetail.vue`、`src/pages/Publish.vue` 等文件。

## 环境变量

当前项目无必需环境变量。

## License

MIT
