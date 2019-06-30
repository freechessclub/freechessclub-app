// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

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
  private user: string;
  private websocket: WebSocket;
  private onRecv: (msg: any) => void;

  constructor(onRecv: (msg: any) => void, user?: string, pass?: string) {
    this.connected = false;
    this.user = '';
    this.onRecv = onRecv;
    this.connect(user, pass);
  }

  public getUser(): string {
    return this.user;
  }

  public setUser(user: string): void {
    this.connected = true;
    this.user = user;
    $('#chat-status').html('<span class="badge badge-success">Connected</span><span class="h6 align-middle"> '
      + user + '</span>');
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public connect(user?: string, pass?: string) {
    $('#chat-status').html('<span class="badge badge-info">Connecting...</span>');
    const login = (user !== undefined && pass !== undefined);
    let loginOptions = '';
    if (login) {
      loginOptions += '?login=1';
    }

    let text = '[' + user;
    if (pass !== undefined && pass.length > 0) {
      text += ',' + btoa(pass);
    }
    text += ']';

    let host = location.host;
    if (host === '') {
      host = 'www.freechess.club';
    }

    let protocol = 'ws://';
    if (location.protocol === 'https:' || location.protocol === 'file:') {
      protocol = 'wss://';
    }

    this.websocket = new WebSocket(protocol + host + '/ws' + loginOptions);
    this.websocket.onmessage = (message: any) => {
      const data = JSON.parse(message.data);
      if (Array.isArray(data)) {
        data.map((m) => this.onRecv(m));
      } else {
        this.onRecv(data);
      }
    };
    this.websocket.onclose = this.reset;
    if (login) {
      this.websocket.onopen = () => {
        this.websocket.send(text);
      };
    }
  }

  public disconnect() {
    if (this.isConnected()) {
      $('#chat-status').html('<span class="badge badge-info">Disconnecting...</span>');
      this.websocket.close();
      this.connected = false;
      this.user = '';
    }
  }

  public reset(evt) {
    $('#chat-status').html('<span class="badge badge-danger">Disconnected</span>');
  }

  public send(command: string) {
    if (!this.isConnected()) {
      throw new Error('Session not connected.');
    }
    this.websocket.send(command);
  }
}

export default Session;
