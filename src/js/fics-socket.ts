import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';

// Only the transport changes on Android. Session and Parser use this same
// interface on the web, Electron, and Android.
export interface NativeSessionOptions {
  user: string;
  password: string;
  registered: boolean;
  commands: string[];
  backgroundRecovery: boolean;
}

export interface FicsSocket {
  readonly readyState: number;
  onopen: (event?: any) => void;
  onmessage: (event: { data: Blob; historical?: boolean }) => void | Promise<void>;
  onerror: (event?: any) => void;
  onclose: (event: { code: number; reason: string; wasClean: boolean }) => void;
  readonly managesReconnect?: boolean;
  onreconnecting?: (reason: string) => void;
  onreconnected?: (user: string, registered: boolean) => void;
  authenticated?(options: NativeSessionOptions): void;
  send(data: ArrayBuffer, command?: string): void;
  close(): void;
}

interface SocketEvent {
  type: 'open' | 'message' | 'error' | 'close' | 'reconnecting' | 'reconnected';
  generation?: number;
  user?: string;
  registered?: boolean;
  data?: string;
  historical?: boolean;
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

interface NativeSocketPlugin {
  addListener(name: 'available', listener: (event: { id: string }) => void): Promise<PluginListenerHandle>;
  connect(options: { id: string }): Promise<void>;
  authenticated(options: NativeSessionOptions & { id: string; generation: number }): Promise<void>;
  send(options: { id: string; generation: number; data: string; command?: string }): Promise<void>;
  close(options: { id: string }): Promise<void>;
  dispose(options: { id: string }): Promise<void>;
  drain(options: { id: string }): Promise<{ events: SocketEvent[]; more: boolean }>;
}

const nativeSocket = registerPlugin<NativeSocketPlugin>('FicsSocket');
let nextId = 0;

class AndroidFicsSocket implements FicsSocket {
  readyState = 0;
  readonly managesReconnect = true;
  private generation = 1;
  onreconnecting: FicsSocket['onreconnecting'];
  onreconnected: FicsSocket['onreconnected'];
  onopen: FicsSocket['onopen'];
  onmessage: FicsSocket['onmessage'];
  onerror: FicsSocket['onerror'];
  onclose: FicsSocket['onclose'];
  private readonly id = `${Date.now()}-${++nextId}`;
  private listener: PluginListenerHandle;
  private operations: Promise<void>;
  private draining = false;
  private needsDrain = false;

  constructor() {
    this.operations = this.start().catch(() => this.fail());
  }

  private async start() {
    this.listener = await nativeSocket.addListener('available', ({ id }) => {
      if(id === this.id) void this.drain();
    });
    await nativeSocket.connect({ id: this.id });
    // Also drain after connect so early native events cannot be lost.
    await this.drain();
  }

  authenticated(options: NativeSessionOptions) {
    if(this.readyState !== 1) return;
    const generation = this.generation;
    this.operations = this.operations.then(() => nativeSocket.authenticated({ ...options, id: this.id, generation }))
      .catch(() => this.fail());
  }

  send(data: ArrayBuffer, command?: string) {
    if(this.readyState === 0) throw new DOMException('Socket is connecting', 'InvalidStateError');
    if(this.readyState !== 1) return;
    const bytes = new Uint8Array(data);
    let binary = '';
    for(const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = btoa(binary);
    const generation = this.generation;
    this.operations = this.operations.then(() => nativeSocket.send({ id: this.id, generation, data: encoded, command }))
      .catch(() => this.fail());
  }

  close() {
    if(this.readyState >= 2) return;
    this.readyState = 2;
    this.operations = this.operations.then(() => nativeSocket.close({ id: this.id }))
      .catch(() => this.fail());
  }

  private async drain() {
    this.needsDrain = true;
    if(this.draining || this.readyState === 3) return;
    this.draining = true;
    try {
      while(this.needsDrain && this.readyState !== 3) {
        this.needsDrain = false;
        const batch = await nativeSocket.drain({ id: this.id });
        this.needsDrain ||= batch.more;
        for(const event of batch.events) {
          if(this.readyState === 3) break;
          if(event.generation != null && event.generation < this.generation) continue;
          if(event.generation != null) this.generation = event.generation;
          switch(event.type) {
            case 'reconnecting':
              if(this.readyState === 2) break;
              this.readyState = 0;
              this.onreconnecting?.(event.reason);
              break;
            case 'reconnected':
              if(this.readyState === 2) break;
              this.readyState = 1;
              this.onreconnected?.(event.user, event.registered);
              break;
            case 'open':
              if(this.readyState === 0) {
                this.readyState = 1;
                this.onopen?.();
              }
              break;
            case 'message': {
              const bytes = Uint8Array.from(atob(event.data), c => c.charCodeAt(0));
              // Await Blob decoding/parser work to preserve buffered message order.
              await this.onmessage?.({ data: new Blob([bytes]), historical: event.historical });
              break;
            }
            case 'error':
              this.onerror?.();
              break;
            case 'close':
              this.finish(event.code, event.reason, event.wasClean);
              break;
          }
        }
      }
    } catch {
      this.fail();
    } finally {
      this.draining = false;
    }
  }

  private fail() {
    if(this.readyState === 3) return;
    this.onerror?.();
    this.finish(1006, 'Native connection failed', false);
  }

  private finish(code: number, reason: string, wasClean: boolean) {
    this.readyState = 3;
    void this.listener?.remove().catch(() => { /* Already torn down. */ });
    void nativeSocket.dispose({ id: this.id }).catch(() => { /* Bridge may have been destroyed. */ });
    this.onclose?.({ code, reason, wasClean });
  }
}

export function createFicsSocket(): FicsSocket {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
    ? new AndroidFicsSocket()
    : new WebSocket('wss://www.freechess.org:5001');
}
