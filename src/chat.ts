// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Cookies from 'js-cookie';
import { autoLink } from 'autolink-js';
import { load as loadEmojis, parse as parseEmojis } from 'gh-emoji';
import { findGame, createTooltip, notificationsToggle, scrollToBoard, isSmallWindow, chattabsToggle } from './index';

// list of channels
const channels = {
  0:      'Admins',
  1:      'Help',
  2:      'FICS Discussion',
  3:      'FICS Programmers',
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

let maximized = false;
let windowResizing = false;

export class Chat {
  private user: string;
  private userRE: RegExp;
  private tabs: object;
  private scrolledToBottom: object;
  private emojisLoaded: boolean;
  private maximized: boolean;
  private timestampToggle: boolean;
  private unviewedNum: number;

  constructor(user: string) {
    this.unviewedNum = 0;
    this.timestampToggle = (Cookies.get('timestamp') !== 'false');
    // load emojis
    this.emojisLoaded = false;
    loadEmojis().then(() => {
      this.emojisLoaded = true;
    });

    this.user = user;
    this.userRE = new RegExp('\\b' + user + '\\b', 'ig');

    // initialize tabs
    this.tabs = {};
    this.scrolledToBottom = {};

    $(document).on('shown.bs.tab', '#tabs button[data-bs-toggle="tab"]', (e) => {
      const tab = $(e.target);
      this.updateViewedState(tab);
      var contentPane = $(tab.attr('href'));
      if(this.scrolledToBottom[contentPane.attr('id')]) 
        contentPane.scrollTop(contentPane[0].scrollHeight);
      contentPane.trigger('scroll');
    });

    $('#chat-scroll-button').on('click', (e) => {
      var tab = $('.chat-text.active');
      $('#chat-scroll-button').hide();
      tab.scrollTop(tab[0].scrollHeight);
    });

    $(window).on('resize', () => {
      $('.chat-text.active').trigger('scroll'); // Trigger scroll in case scrollbar appears/disappears
    });

    $('#collapse-chat').on('shown.bs.collapse', () => {
      var activeTab = $('#tabs button').filter('.active');
      activeTab.trigger('shown.bs.tab');
    });

    $(document.body).on('click', '#tabs .closeTab', (event) => {
      this.closeTab($(event.target).parent().siblings('.nav-link'));
    });

    $('#timestamp-toggle').prop('checked', this.timestampToggle);
    $('#timestamp-toggle').on('click', (event) => {
      this.timestampToggle = !this.timestampToggle;
      Cookies.set('timestamp', String(this.timestampToggle), { expires: 365 })
    });
  }

  private updateViewedState(tab: any, closingTab: boolean = false, incrementCounter: boolean = true) {
    if(!tab.hasClass('tab-unviewed') && !closingTab && (!tab.hasClass('active') || !$('#collapse-chat').hasClass('show')) && tab.attr('id') !== 'tab-console') {
      // Add unviewed number to chat-toggle-icon
      if(tab.attr('id') !== undefined && !this.ignoreUnviewed(tab.attr('id').split(/-(.*)/)[1]) && incrementCounter) { // only add if a kibitz or private message
        if(this.unviewedNum === 0)
          $('#chat-unviewed-bubble').show();
        this.unviewedNum++;
        $('#chat-unviewed-number').text(this.unviewedNum);
        tab.attr('data-unviewed-count', '');
      }
      tab.addClass('tab-unviewed');
    }
    else if(tab.hasClass('tab-unviewed') && (closingTab || (tab.hasClass('active') && $('#collapse-chat').hasClass('show')))) {
      if(tab.attr('data-unviewed-count') !== undefined) {
        this.unviewedNum--;
        if(this.unviewedNum === 0)
          $('#chat-unviewed-bubble').hide();
        else
          $('#chat-unviewed-number').text(this.unviewedNum);
        tab.removeAttr('data-unviewed-count');
      }
      tab.removeClass('tab-unviewed');
    }
  }

  public closeTab(tab: any) {
    this.updateViewedState(tab, true);
    if(tab.hasClass('active'))
      $('#tabs .nav-link:first').tab('show');

    const name: string = tab.attr('id').toLowerCase().split(/-(.*)/)[1];
    tab.parent().tooltip('dispose');
    tab.parent().remove();
    this.deleteTab(name);
    $('#content-' + name).remove();
  }

  public setUser(user: string): void {
    if(this.user !== user) {
      const that = this;
      $('#tabs .closeTab').each(function (index) {
        that.closeTab($(this).parent().siblings('.nav-link'));
      });
    }

    this.user = user;
    this.userRE = new RegExp('\\b' + user + '\\b', 'ig');
  }

  public createTab(name: string, showTab = false) {
    const from = name.toLowerCase().replace(/\s/g, '-');
    if (!this.tabs.hasOwnProperty(from)) {
      let chName = name;
      if (channels[name] !== undefined) {
        chName = channels[name];
      }

      if(!$('#tabs').find('#tab-' + from).length) {
        var match = chName.match(/Game (\d+)/);
        var tooltip = '';
        if(match && match.length > 1) {
          var game = findGame(+match[1]);
          if(game) {
            var gameDescription = game.wname + ' vs. ' + game.bname;
            tooltip = `data-bs-toggle="tooltip" data-tooltip-hover-only title="` + gameDescription + `" `;
          }
        }
        var tabElement = $(`<li ` + tooltip + `class="nav-item position-relative">
            <button class="text-sm-center nav-link" data-bs-toggle="tab" href="#content-` +
                from + `" id="tab-` + from + `" role="tab" style="padding-right: 30px">` + chName + `
            </button>   
            <container class="d-flex align-items-center h-100 position-absolute" style="top: 0; right: 12px; z-index: 10">       
              <span class="closeTab btn btn-default btn-sm">×</span>
            </container>
          </li>`).appendTo('#tabs');
        $('<div class="tab-pane chat-text" id="content-' + from + '" role="tabpanel"></div>').appendTo('#chat-tabContent');
        
        if(tooltip)
          createTooltip(tabElement);
      }

      this.tabs[from] = $('#content-' + from);
      this.scrolledToBottom['content-' + from] = true;

      var lastWidth, lastHeight;
      $('#content-' + from).on('scroll', (e) => {
        var tab = e.target;
        if($(tab).hasClass('active')) {
          var atBottom = tab.scrollHeight - tab.clientHeight < tab.scrollTop + 1.5;      
          if(atBottom) {
            $('#chat-scroll-button').hide();
            this.scrolledToBottom[$(tab).attr('id')] = true; 
          }
          else if(lastWidth === tab.clientWidth && lastHeight === tab.clientHeight) { // Only assume user rmoved scrollbar if window is not resizing
            this.scrolledToBottom[$(tab).attr('id')] = false; 
            $('#chat-scroll-button').show();
          }
          else if(this.scrolledToBottom[$(tab).attr('id')]) 
            $(tab).scrollTop(tab.scrollHeight); // Scrollbar moved due to resizing, move it back to the bottom

          lastWidth = tab.clientWidth;
          lastHeight = tab.clientHeight;
        }
      });
    }

    if(showTab) {
      const tabs = $('#tabs a').filter(function (index) {
        return $(this).attr('id') === 'tab-' + from;
      });
      tabs.first().tab('show');
    }

    return this.tabs[from];
  }

  public deleteTab(name: string) {
    delete this.tabs[name];
  }

  public currentTab(): string {
    return $('ul#tabs button.active').attr('id').split(/-(.*)/)[1];
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
        if (!chattabsToggle) {
          ch = 'console';
        }
        this.createTab(ch, true);
      });
    });
  }

  private escapeHTML(text: string) {
    return text.replace(/[<>"]/g, (tag) => {
      var charsToReplace = {
          '<': '&lt;',
          '>': '&gt;',
          '"': '&#34;'
      };
      return charsToReplace[tag] || tag;
    });
  }

  public newMessage(from: string, data: any, html: boolean = false) {
    let tabName = chattabsToggle ? from : 'console';

    if(!/^[\w- ]+$/.test(from)) 
      return;

    const tab = this.createTab(tabName);
    let who = '';
    if (data.user !== undefined) {
      let textclass = '';
      if (this.user === data.user) {
        textclass = ' class="mine"';
      }
      let prompt = data.user;
      if (!chattabsToggle && data.channel !== undefined) {
        prompt += '(' + data.channel + ')';
      }
      who = '<strong' + textclass + '>' + $('<span/>').text(prompt).html() + '</strong>: ';
    }

    let text = data.message;
    if(!html)
      text = this.escapeHTML(text);
    if (this.emojisLoaded) {
      text = parseEmojis(text);
    }

    text = text.replace(this.userRE, '<strong class="mention">' + this.user + '</strong>');

    // Suffix for whispers
    var suffixText = data.suffix;
    if(data.type === 'whisper' && !suffixText)
      suffixText = '(whispered)';
    var suffix = (suffixText ? ' <span class="chat-text-suffix">' + suffixText + '</span>': '');

    text = autoLink(text, {
      target: '_blank',
      rel: 'nofollow',
      callback: (url) => {
        return /\.(gif|png|jpe?g)$/i.test(url) ?
          '<a href="' + url + '" target="_blank" rel="nofollow"><img width="60" src="' + url + '"></a>'
          : null;
      },
    }) + suffix + '</br>';

    let timestamp = '';
    if (this.timestampToggle) {
      timestamp = '<span class="timestamp">[' + new Date().toLocaleTimeString() + ']</span> ';
    }

    tab.append(timestamp + who + text);

    const tabheader = $('#tab-' + from.toLowerCase().replace(/\s/g, '-'));

    if(this.user !== data.user)
      this.updateViewedState(tabheader, false, data.type !== 'whisper');
    
    if(tab.hasClass('active') && this.scrolledToBottom[tab.attr('id')]) 
      tab.scrollTop(tab[0].scrollHeight);
  }

  private ignoreUnviewed(from: string) {
    return /^\d+$/.test(from) || from === 'roboadmin' || from === 'adminbot'
  }

  public newNotification(msg: string) {
    if(!msg.startsWith('Notification:') || notificationsToggle) {
      var currentTab = this.currentTab().toLowerCase().replace(/\s/g, '-');
      msg = '<strong class="chat-notification">' + msg + '</strong>';
    }
    else 
      var currentTab = 'console';

    this.newMessage(currentTab, {message: msg}, true);
  }
}

function scrollToChat() {
  if(isSmallWindow()) {
    if($('#secondary-board-area').is(':visible'))
      $(document).scrollTop($('#chat-panel').offset().top);
    else
      $(document).scrollTop($('#right-panel-header').offset().top);
  }
}

$('#chat-maximize-btn').on('click', () => {
  if (maximized) {
    $('#chat-maximize-icon').removeClass('fa-toggle-right').addClass('fa-toggle-left');
    $('#chat-maximize-btn').attr('aria-label', 'Maximize Chat');
    $('#chat-maximize-btn .tooltip-overlay').attr('title', 'Maximize Chat');
    createTooltip($('#chat-maximize-btn .tooltip-overlay'));
    if($('#secondary-board-area > .game-card').length)
      $('#secondary-board-area').css('display', 'flex');
    maximized = false;
  } else {
    $('#chat-maximize-icon').removeClass('fa-toggle-left').addClass('fa-toggle-right');
    $('#chat-maximize-btn').attr('aria-label', 'Unmaximize Chat');
    $('#chat-maximize-btn .tooltip-overlay').attr('title', 'Unmaximize Chat');
    createTooltip($('#chat-maximize-btn .tooltip-overlay'));
    $('#collapse-chat').collapse('show');
    $('#secondary-board-area').hide();
    maximized = true;
  }
  $('#left-col').toggleClass('d-none');
  $('#mid-col').toggleClass('d-none');
  $(window).trigger('resize');
});

$('#collapse-chat').on('hidden.bs.collapse', () => {
  if(!$('#collapse-chat').hasClass('collapse-init'))
    scrollToBoard();
  $('#collapse-chat').removeClass('collapse-init');
});

$('#collapse-chat').on('shown.bs.collapse', () => {
  scrollToChat();
});

$('#collapse-chat').on('show.bs.collapse', () => {
  $('#chat-toggle-btn').addClass('toggle-btn-selected');
});

$('#collapse-chat').on('hide.bs.collapse', () => {
  $('#chat-toggle-btn').removeClass('toggle-btn-selected');
});

$('#collapse-chat-arrow').on('click', () => {
  $('#collapse-chat').collapse('hide');
});

export default Chat;
