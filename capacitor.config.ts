import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wavve.arstest',
  appName: 'ARS 메뉴 테스트',
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;
