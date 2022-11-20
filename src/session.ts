// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Parser from './parser';
import { cleanup } from './index';

export const enum MessageType {
  Control = 0,
  ChannelTell,
  PrivateTell,
  GameMove,
  GameStart,
  GameEnd,
  Unknown,
}

export function GetMessageType(msg: any): MessageType {
  if (msg.fen !== undefined) {
    return MessageType.GameMove;
  } else if (msg.control !== undefined) {
    return MessageType.Control;
  } else if (msg.player_one !== undefined) {
    return MessageType.GameStart;
  } else if (msg.winner !== undefined) {
    return MessageType.GameEnd;
  } else if (msg.channel !== undefined) {
    return MessageType.ChannelTell;
  } else if (msg.user !== undefined && msg.message !== undefined) {
    return MessageType.PrivateTell;
  } else {
    return MessageType.Unknown;
  }
}

export class Session {
  private connected: boolean;
  private proxy: boolean;
  private user: string;
  private websocket: WebSocket;
  private onRecv: (msg: any) => void;
  private timesealHello = 'TIMESEAL2|freeseal|icsgo|';
  private tsKey = 'Timestamp (FICS) v1.0 - programmed by Henrik Gram.';

  constructor(onRecv: (msg: any) => void, proxy: boolean, user?: string, pass?: string) {
    this.connected = false;
    this.proxy = proxy;
    this.user = '';
    this.onRecv = onRecv;
    this.connect(proxy, user, pass);
  }

  public getUser(): string {
    return this.user;
  }

  public setUser(user: string): void {
    this.connected = true;
    this.user = user;
    $('#chat-status').html('<span class="fa fa-circle text-success" aria-hidden="false"></span> <span class="h6"> '
      + user + '</span>');
    $('#chat-status').popover({
      animation: true,
      content: 'Connected as ' + user + '. Click here to connect as a different user!',
      placement: 'top',
    });
    $('#chat-status').popover('show');
    setInterval(() => $('#chat-status').popover('dispose'), 3600);
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public connect(proxy: boolean, user?: string, pass?: string) {
    $('#game-requests').empty();
    $('#chat-status').html('<span class="spinner-grow spinner-grow-sm text-warning" role="status" aria-hidden="true"></span> Connecting...');
    const login = (user !== undefined && pass !== undefined);
    let loginOptions = '';
    let text = '';
    if (login) {
      loginOptions += '?login=1';
      text = '[' + user;
      if (pass !== undefined && pass.length > 0) {
        text += ',' + btoa(pass);
      }
      text += ']';
    }

    let host = location.host;
    if (host === '') {
      host = 'www.freechess.club';
    }

    let protocol = 'ws://';
    if (location.protocol === 'https:' || location.protocol === 'file:') {
      protocol = 'wss://';
    }

    const uri = proxy ? (protocol + host + '/ws' + loginOptions) : 'wss://www.freechess.org:5001';
    this.websocket = new WebSocket(uri);
    // this.websocket.binaryType = 'arraybuffer';
    const parser = new Parser(this, user, pass);
    this.websocket.onmessage = async (message: any) => {
      const data = proxy ? JSON.parse(message.data) : await parser.parse(message.data);
      if (Array.isArray(data)) {
        data.map((m) => this.onRecv(m));
      } else {
        this.onRecv(data);
      }
    };
    var that = this;
    this.websocket.onclose = function(e) { that.reset(e); };
    this.websocket.onopen = () => {
      $('#chat-status').html('<span class="spinner-grow spinner-grow-sm text-warning" role="status" aria-hidden="true"></span> Connecting...');
      if (proxy) {
        if (login) {
          this.send(text);
        }
      } else {
        this.send(this.timesealHello);
      }
    };
  }

  public disconnect() {
    $('#chat-status').html('<span class="spinner-grow spinner-grow-sm text-danger" role="status" aria-hidden="true"></span> Disconnecting...');
    if (this.isConnected()) {
      this.websocket.close();
    }
    this.reset(undefined);
  }

  public reset(_e: any) {
    $('#chat-status').html('<span class="fa fa-circle text-danger" aria-hidden="false"></span> Offline');
    this.connected = false;
    this.user = '';
    cleanup();
  }

  public send(command: string) {
    if (!this.proxy) {
      this.websocket.send(this.encode(command).buffer);
    } else {
      this.websocket.send(command);
    }
  }

  public encode(msg: string) {
    let l = msg.length;
    const s = new Uint8Array(l+30);
    for (let i = 0; i < msg.length; i++) {
      s[i] = msg.charCodeAt(i);
    }
    s[l] = 0x18;
    l++;
    const t = new Date().getTime();
    const sec = Math.floor(t/1000);
    const ts = (((sec%10000)*1000) + (t-sec*1000)).toString();
    for (let i = 0; i < ts.length; i++) {
      s[l+i] = ts.charCodeAt(i);
    }
    l = l + ts.length;
    s[l] = 0x19;
    l++;
    while (l % 12 !== 0) {
      s[l] = 0x31;
      l++;
    }
    for (let n = 0; n < l; n += 12) {
      s[n] ^= s[n+11];
      s[n+11] ^= s[n];
      s[n] ^= s[n+11];
      s[n+2] ^= s[n+9];
      s[n+9] ^= s[n+2];
      s[n+2] ^= s[n+9];
      s[n+4] ^= s[n+7];
      s[n+7] ^= s[n+4];
      s[n+4] ^= s[n+7];
    }

    for (let n = 0; n < l; n++) {
      const key = this.tsKey.charCodeAt(n%50);
      s[n] = (((s[n] | 0x80) ^ key) - 32);
    }

    s[l] = 0x80;
    l++;
    s[l] = 0x0a;
    l++;
    const ss = s.slice(0, l);
    return ss;
  }
}

export default Session;
