import 'vant/lib/index.css';
import './styles.css';

import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import router from './router';
import { storage } from './utils/storage';

void storage.cleanExpired();

const bootstrap = async () => {
  // 启动时先回滚未完成的结算事务，保证刷新/崩溃后回到结算前状态
  await storage.recoverTransaction();
  createApp(App).use(createPinia()).use(router).mount('#app');
};

void bootstrap();
