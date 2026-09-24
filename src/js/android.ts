// Copyright 2026 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import * as Utils from './utils';

export type AndroidNotificationTarget = {
  kind: 'chat' | 'game' | 'offers';
  user?: string;
  gameId?: number;
  offerId?: number;
};

export type AndroidNotificationAction = {
  actionId: string;
  target: AndroidNotificationTarget;
};

type AndroidAppIntegrationCallbacks = {
  isSessionActive: () => boolean;
  onNetworkStatusChange: (connected: boolean) => void;
  onResume: (shouldReconnect: boolean) => void | Promise<void>;
  closeTopOverlay: () => boolean;
};

interface NativeNotificationPlugin {
  configureRecovery(options: {enabled: boolean}): Promise<void>;
  configureNotifications(options: {enabled: boolean}): Promise<void>;
  addListener(event: 'notificationAction', listener: (action: AndroidNotificationAction) => void): Promise<PluginListenerHandle>;
}

const NativeNotifications = registerPlugin<NativeNotificationPlugin>('FicsSocket');

let ForegroundService = null;
let foregroundServiceActive = false;
let foregroundServiceChannelReady = false;
let foregroundServiceTransition: Promise<void> = Promise.resolve();
let LocalNotifications = null;
let androidNotificationsInitialized = false;
let androidAppIntegrationInitialized = false;
async function loadForegroundService() {
  if(ForegroundService)
    return;

  const mod = await import('@capawesome-team/capacitor-android-foreground-service');
  ForegroundService = mod.ForegroundService;
}

async function startForegroundService(user?: string) {
  if(!Utils.isAndroidCapacitor() || foregroundServiceActive)
    return;

  try {
    await loadForegroundService();
    const mod = await import('@capawesome-team/capacitor-android-foreground-service');

    // Android does not require notification permission to run a foreground
    // service. If permission is denied, Android still exposes the service in
    // Task Manager, so keep the connection alive even without a drawer entry.
    try {
      const permissionStatus = await ForegroundService.checkPermissions();
      if(permissionStatus.display !== 'granted')
        await ForegroundService.requestPermissions();
    }
    catch(error) {
      Utils.logError('Error requesting foreground service notification permission:', error);
    }

    if(!foregroundServiceChannelReady) {
      await ForegroundService.createNotificationChannel({
        id: 'fcc-foreground',
        name: 'Foreground Service',
        description: 'Keeps the chess connection active',
        importance: mod.Importance.Low
      });
      foregroundServiceChannelReady = true;
    }

    await ForegroundService.startForegroundService({
      id: 1,
      title: user ? `Connected as ${user}` : 'Free Chess Club',
      body: 'Keeping your game connection active.',
      smallIcon: 'ic_fcc_notification',
      notificationChannelId: 'fcc-foreground',
      silent: true
    });
    foregroundServiceActive = true;
  }
  catch(error) {
    Utils.logError('Error starting foreground service:', error);
  }
}

async function stopForegroundService() {
  if(!Utils.isAndroidCapacitor())
    return;

  try {
    await loadForegroundService();
    await ForegroundService.stopForegroundService();
  }
  catch(error) {
    Utils.logError('Error stopping foreground service:', error);
  }
  finally {
    foregroundServiceActive = false;
  }
}

async function loadLocalNotifications() {
  if(LocalNotifications)
    return;

  const mod = await import('@capacitor/local-notifications');
  LocalNotifications = mod.LocalNotifications;
}

export async function requestAndroidNotificationPermission() {
  if(!Utils.isAndroidCapacitor())
    return;

  try {
    await loadLocalNotifications();
    const permission = await LocalNotifications.checkPermissions();
    if(permission.display !== 'granted')
      await LocalNotifications.requestPermissions();
  }
  catch(error) {
    Utils.logError('Error requesting Android notification permission:', error);
  }
}

export async function configureAndroidNotifications(enabled: boolean) {
  if(!Utils.isAndroidCapacitor())
    return;
  try {
    await NativeNotifications.configureNotifications({enabled});
    if(enabled)
      await requestAndroidNotificationPermission();
  }
  catch(error) {
    Utils.logError('Error configuring Android notifications:', error);
  }
}

export async function initAndroidNotifications(
  enabled: boolean,
  onNotificationAction: (action: AndroidNotificationAction) => void
) {
  if(!Utils.isAndroidCapacitor() || androidNotificationsInitialized)
    return;

  androidNotificationsInitialized = true;
  try {
    await NativeNotifications.addListener('notificationAction', onNotificationAction);
    await configureAndroidNotifications(enabled);
  }
  catch(error) {
    androidNotificationsInitialized = false;
    Utils.logError('Error initializing Android notifications:', error);
  }
}

export async function initAndroidAppIntegration(callbacks: AndroidAppIntegrationCallbacks) {
  if(!Utils.isAndroidCapacitor() || androidAppIntegrationInitialized)
    return;

  androidAppIntegrationInitialized = true;
  try {
    const [{ App }, { Network }] = await Promise.all([
      import('@capacitor/app'),
      import('@capacitor/network')
    ]);

    const networkStatus = await Network.getStatus();
    callbacks.onNetworkStatusChange(networkStatus.connected);
    await Network.addListener('networkStatusChange', status => {
      callbacks.onNetworkStatusChange(status.connected);
    });

    let reconnectSessionOnResume = false;
    await App.addListener('pause', () => {
      reconnectSessionOnResume = callbacks.isSessionActive();
    });

    await App.addListener('resume', async () => {
      const shouldReconnect = reconnectSessionOnResume;
      reconnectSessionOnResume = false;
      try {
        const status = await Network.getStatus();
        callbacks.onNetworkStatusChange(status.connected);
      }
      catch(error) {
        Utils.logError('Error checking network state after resume:', error);
      }
      await callbacks.onResume(shouldReconnect);
    });

    await App.addListener('backButton', ({canGoBack}) => {
      if(callbacks.closeTopOverlay())
        return;
      if(canGoBack)
        window.history.back();
      else
        App.minimizeApp();
    });
  }
  catch(error) {
    androidAppIntegrationInitialized = false;
    Utils.logError('Error initializing Android app integration:', error);
  }
}

export async function updateAndroidForegroundServiceNotification(user?: string) {
  if(!Utils.isAndroidCapacitor() || !foregroundServiceActive)
    return;

  try {
    await ForegroundService.updateForegroundService({
      id: 1,
      title: user ? `Connected as ${user}` : 'Free Chess Club',
      body: 'Keeping your game connection active.',
      smallIcon: 'ic_fcc_notification',
      notificationChannelId: 'fcc-foreground',
      silent: true
    });
  }
  catch(error) {
    Utils.logError('Error updating foreground service:', error);
  }
}

export function updateAndroidForegroundServiceState(enabled: boolean, connected: boolean, user?: string) {
  if(!Utils.isAndroidCapacitor())
    return;

  void NativeNotifications.configureRecovery({enabled})
    .catch(error => Utils.logError('Error configuring Android connection recovery:', error));
  const shouldRun = enabled && connected;
  foregroundServiceTransition = foregroundServiceTransition
    .catch(error => Utils.logError('Error changing foreground service state:', error))
    .then(async () => {
      if(shouldRun) {
        await startForegroundService(user);
        await updateAndroidForegroundServiceNotification(user);
      }
      else
        await stopForegroundService();
    });
}
