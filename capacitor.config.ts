import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'club.freechess.FreeChessClub',
  appName: 'Free Chess Club',
  webDir: 'app',
  plugins: {
    Keyboard: {
      resize: 'body'
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
