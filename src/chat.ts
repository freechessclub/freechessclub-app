// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Cookies from 'js-cookie';
import { autoLink } from 'autolink-js';
import { load as loadEmojis, parse as parseEmojis } from 'gh-emoji';

// list of channels
const channels = {
  0:      'Admins',
  1:      'Help',
  2:      'General',
  3:      'Programming',
  4:      'Guest Help',
  5:      'Service Representatives',
  6:      'Help (Interface & Timeseal)',
  7:      'Online Tours',
  20:     'Forming Team games',
  21:     'Playing Team games',
  22:     'Playing Team games',
  23:     'Forming Simuls',
  30:     'Books & Knowledge',
  31:     'Computer Games',
  32:     'Movies',
  33:     'Ducks',
  34:     'Sports',
  35:     'Music',
  36:     'Mathematics & Physics',
  37:     'Philosophy',
  38:     'Literature & Poetry',
  39:     'Politics',
  40:     'Religion',
  41:     'Current Affairs',
  48:     'Mamer Managers',
  49:     'Mamer Tournament',
  50:     'Chat',
  51:     'Youth',
  52:     'Old Timers',
  53:     'Guest Chat',
  55:     'Chess',
  56:     'Beginner Chess',
  57:     'Coaching',
  58:     'Chess Books',
  60:     'Chess Openings/Theory',
  61:     'Chess Endgames',
  62:     'Blindfold Chess',
  63:     'Chess Advisors',
  64:     'Computer Chess',
  65:     'Special Events',
  66:     'Examine',
  67:     'Lectures',
  68:     'Ex-Yugoslav',
  69:     'Latin',
  70:     'Finnish',
  71:     'Scandinavian',
  72:     'German',
  73:     'Spanish',
  74:     'Italian',
  75:     'Russian',
  76:     'Dutch',
  77:     'French',
  78:     'Greek',
  79:     'Icelandic',
  80:     'Chinese',
  81:     'Turkish',
  82:     'Portuguese',
  83:     'Computer',
  84:     'Macintosh/Apple',
  85:     'Unix/Linux',
  86:     'DOS/Windows 3.1/95/NT',
  87:     'VMS',
  88:     'Programming',
  90:     'The STC BUNCH',
  91:     'Suicide Chess',
  92:     'Wild Chess',
  93:     'Bughouse Chess',
  94:     'Gambit',
  95:     'Scholastic Chess',
  96:     'College Chess',
  97:     'Crazyhouse Chess',
  98:     'Losers Chess',
  99:     'Atomic Chess',
  100:    'Trivia',
};

export class Chat {
  private user: string;
  private userRE: RegExp;
  private tabs: object;
  private emojisLoaded: boolean;
  private maximized: boolean;
  private autoscrollToggle: boolean;
  private notificationsToggle: boolean;
  private timestampToggle: boolean;

  constructor(user: string) {
    this.autoscrollToggle = (Cookies.get('autoscroll') !== 'false');
    this.notificationsToggle = (Cookies.get('notifications') !== 'false');
    this.timestampToggle = (Cookies.get('timestamp') !== 'false');
    // load emojis
    this.emojisLoaded = false;
    loadEmojis().then(() => {
      this.emojisLoaded = true;
    });

    this.user = user;
    this.userRE = new RegExp('\\b' + user + '\\b', 'ig');
    this.maximized = false;

    // initialize tabs
    this.tabs = {
      console: $('#content-console'),
    };

    $(document).on('shown.bs.tab', 'a[data-bs-toggle="tab"]', (e) => {
      const tab = $(e.target);
      tab.css('color', '');
    });

    $(document.body).on('click', '#tabs .closeTab', (event) => {
      const name: string = $(event.target).parent().attr('id').toLowerCase();
      $(event.target).parent().remove();
      this.deleteTab(name);
      $('#tabs a:last').tab('show');
      $('#content-' + name).remove();
    });

    $('#chat-maximize-btn').on('click', () => {
      if (this.maximized) {
        if ($(window).width() > 767) {
          $('#right-col').width('33.33333333%');
        }
        $('#chat-maximize-icon').removeClass('fa-toggle-right').addClass('fa-toggle-left');
        $('#chat-maximize-btn').attr('data-bs-original-title', 'Maximize');
        this.maximized = false;
      } else {
        if ($(window).width() > 767) {
          $('#right-col').width('100%');
        }
        $('#chat-maximize-icon').removeClass('fa-toggle-left').addClass('fa-toggle-right');
        $('#chat-maximize-btn').attr('data-bs-original-title', 'Minimize');
        this.maximized = true;
      }
      $('#left-col').toggleClass('d-none');
      $('#mid-col').toggleClass('d-none');
    });

    $('#collapse-chat').on('hidden.bs.collapse', () => {
      $('#chat-toggle-icon').removeClass('fa-toggle-up').addClass('fa-toggle-down');
    });
    $('#collapse-chat').on('shown.bs.collapse', () => {
      $('#chat-toggle-icon').removeClass('fa-toggle-down').addClass('fa-toggle-up');
    });

    if (!this.autoscrollToggle) {
      const iconClass = 'dropdown-icon fa fa-toggle-off';
      $('#autoscroll-toggle').html('<span id="autoscroll-toggle-icon" class="' + iconClass +
        '" aria-hidden="false"></span>Auto-scroll OFF');
    }
    $('#autoscroll-toggle').on('click', (event) => {
      this.autoscrollToggle = !this.autoscrollToggle;
      const iconClass = 'dropdown-icon fa fa-toggle-' + (this.autoscrollToggle ? 'on' : 'off');
      $('#autoscroll-toggle').html('<span id="autoscroll-toggle-icon" class="' + iconClass +
        '" aria-hidden="false"></span>Auto-scroll ' + (this.autoscrollToggle ? 'ON' : 'OFF'));
      Cookies.set('autoscroll', String(this.autoscrollToggle), { expires: 365 })
    });

    if (!this.notificationsToggle) {
      const iconClass = 'dropdown-icon fa fa-bell-slash';
      $('#notifications-toggle').html('<span id="notifications-toggle-icon" class="' + iconClass +
        '" aria-hidden="false"></span>Notifications OFF');
    }
    $('#notifications-toggle').on('click', (event) => {
      this.notificationsToggle = !this.notificationsToggle;
      const iconClass = 'dropdown-icon fa fa-bell' + (this.notificationsToggle ? '' : '-slash');
      $('#notifications-toggle').html('<span id="notifications-toggle-icon" class="' + iconClass +
        '" aria-hidden="false"></span>Notifications ' + (this.notificationsToggle ? 'ON' : 'OFF'));
      Cookies.set('notifications', String(this.notificationsToggle), { expires: 365 })
    });

    const timestampIcon = '<span id="timestamp-toggle-icon" class="fa fa-clock-o dropdown-icon" aria-hidden="false"></span>';
    if (!this.timestampToggle) {
      $('#timestamp-toggle').html(timestampIcon + 'Timestamp OFF');
    }
    $('#timestamp-toggle').on('click', (event) => {
      this.timestampToggle = !this.timestampToggle;
      $('#timestamp-toggle').html(timestampIcon + 'Timestamp ' + (this.timestampToggle ? 'ON' : 'OFF'));
      Cookies.set('timestamp', String(this.timestampToggle), { expires: 365 })
    });

  }

  public setUser(user: string): void {
    this.user = user;
  }

  public createTab(name: string) {
    const from = name.toLowerCase().replace(/\s/g, '-');
    if (this.tabs.hasOwnProperty(from)) {
      return this.tabs[from];
    }

    let chName = name;
    if (channels[name] !== undefined) {
      chName = channels[name];
    }

    $('<li class="nav-item"><a class="text-sm-center nav-link" data-bs-toggle="tab" href="#content-' +
      from + '" id="' + from + '" role="tab">' + chName +
      '<span class="btn btn-default btn-sm closeTab">×</span></a></li>').appendTo('#tabs');
    $('<div class="tab-pane chat-text" id="content-' + from + '" role="tabpanel"></div>').appendTo('#chat-tabContent');
    const boardHeight = $('#board').height();
    if (boardHeight) {
      $('.chat-text').height(boardHeight - 90);
    } else {
      $('#content-' + from).height($('#chat-tabContent').height());
    }
    this.tabs[from] = $('#content-' + from);
    return this.tabs[from];
  }

  public deleteTab(name: string) {
    delete this.tabs[name];
  }

  public currentTab(): string {
    return $('ul#tabs a.active').attr('id');
  }

  public addChannels(chans: string[]) {
    $('#chan-dropdown-menu').empty();
    chans.forEach((ch) => {
      let chName = ch;
      if (channels[Number(ch)] !== undefined) {
        chName = channels[Number(ch)];
      }
      $('#chan-dropdown-menu').append(
        '<a class="dropdown-item noselect" id="ch-' + ch +
        '">' + chName + '</a>');
      $('#ch-' + ch).on('click', (event) => {
        event.preventDefault();
        this.createTab(ch);
      });
    });
  }

  public newMessage(from: string, data: any) {
    const tab = this.createTab(from);
    let who = '';
    if (data.user !== undefined) {
      let textclass = '';
      if (this.user === data.user) {
        textclass = ' class="mine"';
      }
      who = '<strong' + textclass + '>' + $('<span/>').text(data.user).html() + '</strong>: ';
    }

    let text = data.message;
    if (this.emojisLoaded) {
      text = parseEmojis(text);
    }

    text = text.replace(this.userRE, '<strong class="mention">' + this.user + '</strong>');

    text = autoLink(text, {
      target: '_blank',
      rel: 'nofollow',
      callback: (url) => {
        return /\.(gif|png|jpe?g)$/i.test(url) ?
          '<a href="' + url + '" target="_blank" rel="nofollow"><img width="60" src="' + url + '"></a>'
          : null;
      },
    }) + '</br>';

    let timestamp = '';
    if (this.timestampToggle) {
      timestamp = '<span class="timestamp">[' + new Date().toLocaleTimeString() + ']</span> ';
    }

    tab.append(timestamp + who + text);

    const tabheader = $('#' + from.toLowerCase().replace(/\s/g, '-'));
    if (tabheader.hasClass('active')) {
      if (this.autoscrollToggle) {
        tab.scrollTop(tab[0].scrollHeight);
      }
    } else {
      tabheader.css('color', 'tomato');
    }
  }

  public newNotification(msg: string) {
    if (this.notificationsToggle) {
      const currentTab = this.currentTab().toLowerCase().replace(/\s/g, '-');
      const tab = this.tabs[currentTab];
      msg = '<strong class="notification">' + msg + '</strong>';

      let timestamp = '';
      if (this.timestampToggle) {
        timestamp = '<span class="timestamp">[' + new Date().toLocaleTimeString() + ']</span> ';
      }
      tab.append(timestamp + msg + '</br>');
    } else {
      this.newMessage('console', {message: msg});
    }
  }
}

export default Chat;
