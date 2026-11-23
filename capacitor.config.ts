import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.osot.mobilelab',
  appName: 'OSOT 声笺实验台',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    backgroundColor: '#0b0e14',
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
