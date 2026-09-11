// Copyright 2026 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import type { LocalNotificationSchema } from '@capacitor/local-notifications';
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

type NotificationThread = {
  id: number;
  title: string;
  lines: string[];
  count: number;
  target: AndroidNotificationTarget;
};

const EVENT_NOTIFICATION_GROUP = 'fcc-events';
const EVENT_NOTIFICATION_SUMMARY_ID = 2;
const GAME_REQUEST_ACTION_TYPE = 'fcc-game-request';
const MAX_NOTIFICATION_LINES = 5;

let ForegroundService = null;
let foregroundServiceActive = false;
let foregroundServiceChannelReady = false;
let foregroundServiceTransition: Promise<void> = Promise.resolve();
let LocalNotifications = null;
let androidNotificationsInitialized = false;
let androidAppIntegrationInitialized = false;
let nativeNotificationId = 10000 + Math.floor(Date.now() % 2000000000);
const notificationThreads = new Map<string, NotificationThread>();
const turnNotificationPositions = new Map<number, string>();

function nextNotificationId() {
  nativeNotificationId++;
  if(nativeNotificationId > 2147483647)
    nativeNotificationId = 10000;
  return nativeNotificationId;
}

function notificationText(value: any) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function notificationThreadKey(target: AndroidNotificationTarget) {
  if(target.kind === 'chat')
    return `chat:${target.user?.trim().toLowerCase() ?? ''}`;
  if(target.kind === 'game')
    return `game:${target.gameId ?? ''}`;
  if(target.offerId != null)
    return `offer:${target.offerId}`;
  return 'offers';
}

function updateNotificationThread(
  title: string,
  body: string,
  target: AndroidNotificationTarget
): NotificationThread {
  const key = notificationThreadKey(target);
  const existing = notificationThreads.get(key);
  const thread = existing ?? {
    id: nextNotificationId(),
    title,
    lines: [],
    count: 0,
    target
  };
  thread.title = title;
  thread.target = target;
  thread.count++;
  thread.lines.push(body);
  thread.lines = thread.lines.slice(-MAX_NOTIFICATION_LINES);

  // Reinsert updated threads so the group summary is ordered by recency.
  notificationThreads.delete(key);
  notificationThreads.set(key, thread);
  return thread;
}

function notificationThreadTitle(thread: NotificationThread) {
  if(thread.target.kind === 'chat' && thread.target.user && thread.count > 1)
    return `Messages from ${thread.target.user}`;
  return thread.title;
}

function buildNotificationSummary(): LocalNotificationSchema | null {
  if(notificationThreads.size < 2)
    return null;

  const threads = Array.from(notificationThreads.values());
  const total = threads.reduce((count, thread) => count + thread.count, 0);
  const lines = threads.slice(-MAX_NOTIFICATION_LINES).map(thread => {
    const latest = thread.lines[thread.lines.length - 1];
    return `${notificationThreadTitle(thread)}: ${latest}`;
  });

  return {
    id: EVENT_NOTIFICATION_SUMMARY_ID,
    title: 'Free Chess Club',
    body: `${total} new updates`,
    summaryText: `${threads.length} conversations and games`,
    inboxList: lines,
    smallIcon: 'ic_fcc_notification',
    group: EVENT_NOTIFICATION_GROUP,
    groupSummary: true,
    autoCancel: true
  };
}

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

export async function showAndroidNotification(
  title: string,
  body: string,
  target: AndroidNotificationTarget,
  enabled: boolean
) {
  if(!Utils.isAndroidCapacitor() || !document.hidden || !enabled)
    return;

  try {
    await loadLocalNotifications();
    const permission = await LocalNotifications.checkPermissions();
    if(permission.display !== 'granted')
      return;

    const cleanTitle = notificationText(title);
    const cleanBody = notificationText(body);
    const thread = updateNotificationThread(cleanTitle, cleanBody, target);
    const notification: LocalNotificationSchema = {
      id: thread.id,
      title: notificationThreadTitle(thread),
      body: cleanBody,
      summaryText: thread.count > 1 ? `${thread.count} new updates` : undefined,
      inboxList: thread.count > 1 ? thread.lines : undefined,
      smallIcon: 'ic_fcc_notification',
      group: EVENT_NOTIFICATION_GROUP,
      autoCancel: true,
      actionTypeId: target.offerId != null ? GAME_REQUEST_ACTION_TYPE : undefined,
      extra: target
    };
    const summary = buildNotificationSummary();
    await LocalNotifications.schedule({
      notifications: summary ? [notification, summary] : [notification]
    });
  }
  catch(error) {
    Utils.logError('Error showing Android notification:', error);
  }
}

export async function removeAndroidOfferNotification(offerId: number) {
  if(!Utils.isAndroidCapacitor() || !Number.isInteger(offerId))
    return;

  const key = notificationThreadKey({kind: 'offers', offerId});
  const thread = notificationThreads.get(key);
  if(!thread)
    return;

  notificationThreads.delete(key);
  try {
    await loadLocalNotifications();
    const delivered = await LocalNotifications.getDeliveredNotifications();
    const notifications = delivered.notifications.filter(notification =>
      notification.id === thread.id || notification.id === EVENT_NOTIFICATION_SUMMARY_ID
    );
    if(notifications.length)
      await LocalNotifications.removeDeliveredNotifications({notifications});

    const summary = buildNotificationSummary();
    if(summary)
      await LocalNotifications.schedule({notifications: [summary]});
  }
  catch(error) {
    Utils.logError('Error removing Android offer notification:', error);
  }
}

export async function clearDeliveredAndroidNotifications() {
  if(!Utils.isAndroidCapacitor())
    return;

  try {
    await loadLocalNotifications();
    const delivered = await LocalNotifications.getDeliveredNotifications();
    const notifications = delivered.notifications.filter(notification => notification.group === EVENT_NOTIFICATION_GROUP);
    if(notifications.length)
      await LocalNotifications.removeDeliveredNotifications({notifications});
  }
  catch(error) {
    Utils.logError('Error clearing delivered Android notifications:', error);
  }
  finally {
    notificationThreads.clear();
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
    await loadLocalNotifications();
    await LocalNotifications.registerActionTypes({
      types: [{
        id: GAME_REQUEST_ACTION_TYPE,
        actions: [
          {id: 'accept', title: 'Accept'},
          {id: 'decline', title: 'Decline'}
        ]
      }]
    });
    await LocalNotifications.addListener('localNotificationActionPerformed', action => {
      const target = action.notification.extra as AndroidNotificationTarget;
      if(target?.kind)
        onNotificationAction({actionId: action.actionId, target});
    });
    await clearDeliveredAndroidNotifications();
    if(enabled)
      await requestAndroidNotificationPermission();
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
      await clearDeliveredAndroidNotifications();
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

export function shouldShowAndroidTurnNotification(gameId: number, position: string) {
  if(turnNotificationPositions.get(gameId) === position)
    return false;
  turnNotificationPositions.set(gameId, position);
  return true;
}

export function forgetAndroidTurnNotification(gameId: number) {
  turnNotificationPositions.delete(gameId);
}
