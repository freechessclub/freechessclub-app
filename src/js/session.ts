// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Parser from './parser';
import { isMobile } from './utils';
import { settings } from './settings';

export const enum MessageType {
  Control = 0,
  ChannelTell,
  PrivateTell,
  Messages,
  GameMove,
  GameStart,
  GameEnd,
  GameHoldings,
  Offers,
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
  } else if (msg.holdings !== undefined) {
    return MessageType.GameHoldings;
  } else if (msg.channel !== undefined) {
    return MessageType.ChannelTell;
  } else if (msg.user !== undefined && msg.message !== undefined) {
    return MessageType.PrivateTell;
  } else if (msg.messages !== undefined) {
    return MessageType.Messages;
  } else if (msg.offers !== undefined) {
    return MessageType.Offers;
  } else {
    return MessageType.Unknown;
  }
}

export class Session {
  private connected: boolean;
  private connecting: boolean;
  private user: string;
  private pass: string;
  private websocket: WebSocket;
  private onRecv: (msg: any) => void;
  private timesealHello = 'TIMESEAL2|freeseal|icsgo|';
  private tsKey = 'Timestamp (FICS) v1.0 - programmed by Henrik Gram.';
  private parser: Parser;
  private registered: boolean;
  private sessionStatusPopoverTimer; // Hide session status popover after duration
  private bodyClickHandler; // Used to detect when user clicks outside of session status popover
  private postConnectCommands;

  constructor(onRecv: (msg: any) => void, user?: string, pass?: string) {
    this.connected = false;
    this.connecting = false;
    this.user = user;
    this.pass = pass;
    this.onRecv = onRecv;
    this.registered = false;
    this.connect(user, pass);
    this.postConnectCommands = [];

    // Hide popover if user clicks anywhere outside
    this.bodyClickHandler = (e) => {
      if(!$('#session-status').is(e.target)
          && $('#session-status').has(e.target).length === 0
          && $('.popover').has(e.target).length === 0) {
        $('#session-status').popover('dispose');
        clearTimeout(this.sessionStatusPopoverTimer);
      }
    };
    $('body').on('click', this.bodyClickHandler);
  }

  destroy() {
    $('body').off('click', this.bodyClickHandler);
  }

  public isRegistered(): boolean {
    return this.registered;
  }

  public setRegistered(registered: boolean) {
    this.registered = registered;
  }

  public getUser(): string {
    return this.user;
  }

  public getPassword(): string {
    return this.pass;
  }

  public getParser(): Parser {
    return this.parser;
  }

  public setUser(user: string): void {
    $('#session-status').html(`<span style="overflow: hidden; text-overflow: ellipsis"><span class="fa fa-circle" aria-hidden="false"></span>&nbsp;<span class="h6">${user}</span></span>`);
    if(!this.user && !settings.visited) { // Only display popover if this is a new user or guest
      $('#session-status').popover({
        animation: true,
        content: `Connected as ${user}. Click here to connect as a different user!`,
        placement: 'bottom',
      });
      $('#session-status').popover('show');
      this.sessionStatusPopoverTimer = setTimeout(() => $('#session-status').popover('dispose'), 3600);
    }
    this.user = user;

    this.connected = true;
    this.connecting = false;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public isConnecting(): boolean {
    return this.connecting;
  }

  public connect(user?: string, pass?: string) {
    this.registered = false;
    this.connecting = true;
    $('#session-status').html('<span class="text-warning"><span class="spinner-grow spinner-grow-sm" role="status" aria-hidden="true"></span>&nbsp;Connecting...</span>');
    this.onRecv({command: 4, control: 'Connecting'});

    this.websocket = new WebSocket('wss://www.freechess.org:5001');
    this.parser = new Parser(this, user, pass);
    this.websocket.onmessage = async (message: any) => {
      const data = this.parser.parse(await message.data.text());
      if (Array.isArray(data)) {
        data.map((m) => this.onRecv(m));
      } else {
        this.onRecv(data);
      }
    };

    this.websocket.onclose = (e) => {
      const wasConnected = this.isConnected();

      if(this.isConnecting() || wasConnected) {
        this.reset();     
        this.onRecv({
          command: 3,
          control: 'Disconnected'
        }); // Send disconnected command to message handler
      }

      // Reconnect automatically if the connection was dropped unexpectedly, i.e. by mobile power management
      if(wasConnected && !e.wasClean) {
        if(!isMobile() || document.visibilityState === 'visible')
          this.connect(this.user, this.pass);
        else {
          $(document).one('visibilitychange', () => {
            this.connect(this.user, this.pass);
          });
        }
      }
    };

    this.websocket.onopen = () => {
      this.send(this.timesealHello, false);
    };   

    this.websocket.onerror = () => {
      this.reset();
      this.onRecv({
        command: 3,
        control: 'Failed to connect'
      }); 
    };
  }

  public disconnect() {
    this.reset();
    this.websocket.close();
    this.onRecv({
      command: 3,
      control: 'Disconnected'
    }); // Send disconnected command to message handler
  }

  public reset() {
    $('#session-status').html('<span class="text-danger"><span class="fa fa-circle" aria-hidden="false"></span>&nbsp;Offline</span>');
    this.connected = false;
    this.connecting = false;
    this.postConnectCommands = [];
  }

  /**
   * Send command to the server 
   * @param autoConnect auto-connect to the server if command sent when offline/connecting. 
   * use false if issuing a connection command (i.e. after the socket opens but before fully logged in)
   */
  public send(command: string, autoConnect = true) {
    // If user has tried to send a command while offline or connecting (for example by clicking a button
    // in the pairing pane) then auto-connect to the server and send the command once connected
    if(!this.isConnected() && autoConnect) {
      this.reconnect();
      this.postConnectCommands.push(command); 
      return;
    }
 
    this.websocket.send(this.encode(command).buffer);
  }

  public reconnect() {
    if(!this.isConnecting()) {
      const user = /^Guest[A-Z]{4}$/.test(this.getUser()) ? undefined : this.getUser(); 
      this.connect(user, this.getPassword());
      $('#sign-in-alert').addClass('show');
    }
  }

  /** Call this function after logging in to send queued commands */
  public sendPostConnectCommands() {
    this.postConnectCommands.forEach((cmd) => this.send(cmd));
    this.postConnectCommands = [];
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
