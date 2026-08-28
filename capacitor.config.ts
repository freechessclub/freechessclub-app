/// <reference types="@capacitor/local-notifications" />

import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'club.freechess.FreeChessClub',
  appName: 'Free Chess Club',
  webDir: 'app',
  android: {
    resolveServiceWorkerRequests: false
  },
  plugins: {
    Keyboard: {
      resize: 'body'
    },
    LocalNotifications: {
      smallIcon: 'ic_fcc_notification'
    },
    SystemBars: {
      insetsHandling: 'css'
    }
  },
  cordova: {
    preferences: {
      AppendUserAgent: 'Free Chess Club Mobile'
    }
  }
};

export default config;
