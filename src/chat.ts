// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { autoLink } from 'autolink-js';
import { load as loadEmojis, parse as parseEmojis } from 'gh-emoji';
import { createTooltip, safeScrollTo, isSmallWindow } from './utils';
import { setGameWithFocus, maximizeGame, scrollToBoard } from './index';
import { settings } from './settings';
import { storage } from './storage';
import { games } from './game';

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

export class Chat {
  private user: string;
  private userRE: RegExp;
  private tabData: object;
  private emojisLoaded: boolean;
  private maximized: boolean;
  private unviewedNum: number;
  private virtualScrollerPromise: Promise<typeof import('virtual-scroller/dom')>;

  constructor() {
    this.unviewedNum = 0;
    settings.timestampToggle = (storage.get('timestamp') !== 'false');
    settings.chattabsToggle = (storage.get('chattabs') !== 'false');
    this.virtualScrollerPromise = import('virtual-scroller/dom');

    // load emojis
    this.emojisLoaded = false;
    const suppressUnhandledRejection = (event) => { 
      // This is to get around bug in gh-emoji where it throws an 'Uncaught (in promise) Type Error' when 
      // it fails to fetch the emojis due to being offline etc.
      event.preventDefault(); 
    };
    window.addEventListener('unhandledrejection', suppressUnhandledRejection, { once: true });
    loadEmojis().then(() => {
      this.emojisLoaded = true;
      window.removeEventListener('unhandledrejection', suppressUnhandledRejection);
    });

    // initialize tabs
    this.tabData = {};

    $(document).on('shown.bs.tab', '#tabs button[data-bs-toggle="tab"]', async (e) => {
      const tab = $(e.target);
      this.updateViewedState(tab);

      const contentPane = $(tab.attr('href'));
      const scrollContainer = contentPane.find('.chat-scroll-container');
      if(!scrollContainer.length)
        return;

      const tabData = this.getTabDataFromElement(tab);
      if(!tabData.scroller) {
        tabData.scroller = await this.createVirtualScroller(contentPane, tabData.messages);
        tabData.scrollerStarted = true;
      }

      if(!tabData.scrollerStarted) {
        // In case panel was resized while hidden, recalculate chat message heights so that 
        // virtual-scroller doesn't complain after restarting
        const state = tabData.scroller.virtualScroller.getState();
        for(let i = state.firstShownItemIndex; i <= state.lastShownItemIndex; i++) 
          tabData.scroller.onItemHeightDidChange(i);
        tabData.scroller.start();
        tabData.scroller.setItems(tabData.messages); // Render any new messages that arrived while tab was hidden
        tabData.scrollerStarted = true;
      }
      this.fixScrollPosition();
    });



    $(document).on('hide.bs.tab', '#tabs button[data-bs-toggle="tab"]', (e) => {
      const tab = $(e.target);
      const tabData = this.getTabDataFromElement(tab);
      if(tabData.scrollerStarted) {
        tabData.scroller.stop(); // Stop virtual-scroller before hiding tab so that it doesn't remove all its DO< elements
        tabData.scrollerStarted = false;
      } 
    });

    $('#chat-scroll-button').on('click', () => {
      const scrollContainer = $('.tab-pane.active .chat-scroll-container');
      $('#chat-scroll-button').hide();
      scrollContainer.scrollTop(scrollContainer[0].scrollHeight);
    });

    $('#collapse-chat').on('hide.bs.collapse', () => {
      const activeTab = $('#tabs button').filter('.active');
      activeTab.trigger('hide.bs.tab');
    });

    $('#collapse-chat').on('hidden.bs.collapse', () => {
      if(!$('#collapse-chat').hasClass('collapse-init'))
        scrollToBoard();
      $('#collapse-chat').removeClass('collapse-init');
    });

    $('#collapse-chat').on('shown.bs.collapse', () => {
      const activeTab = $('#tabs button').filter('.active');
      activeTab.trigger('shown.bs.tab');
      $(window).trigger('resize');
      this.scrollToChat();
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

    $(document.body).on('click', '#tabs .closeTab', (event) => {
      this.closeTab($(event.target).parent().siblings('.nav-link'));
    });

    $('#timestamp-toggle').prop('checked', settings.timestampToggle);
    $('#timestamp-toggle').on('click', () => {
      settings.timestampToggle = !settings.timestampToggle;
      storage.set('timestamp', String(settings.timestampToggle));
    });

    $('#chattabs-toggle').prop('checked', settings.chattabsToggle);
    $('#chattabs-toggle').on('click', () => {
      settings.chattabsToggle = !settings.chattabsToggle;
      storage.set('chattabs', String(settings.chattabsToggle));
    });

    $('#chat-maximize-btn').on('click', () => {
      if(maximized) {
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
  }

  public getWatchers(tab: any): string[] {
    const match = tab.attr('id').match(/tab-game-(\d+)(?:-and-(\d+))?/);
    if(match) {
      const game1 = games.findGame(+match[1]);
      if(game1) {
        let watchers = game1.watchers.map(str => str.replace('#', ''));
        if(match[2]) {
          const game2 = games.findGame(+match[2]);
          if(game2) {
            // For bughouse chat rooms, add watchers from the other game
            const watchers2 = game2.watchers.map(str => str.replace('#', ''));
            watchers = watchers.concat(watchers2).filter((item, index, self) => {
              return self.indexOf(item) === index;
            });
          }
        }
        return watchers;
      }
    }
    return null;
  }

  public updateNumWatchers(tab: any): boolean {
    const watchers = this.getWatchers(tab);
    if(watchers != null) {
      $(tab.attr('href')).find('.chat-watchers-text').text(`${watchers.length} Watchers`);
      return true;
    }
    return false;
  }

  public updateGameDescription(tab: any): boolean {
    const game = this.getGameFromTab(tab);
    if(game) {
      const tags = game.history.metatags;
      const wname = tags.White;
      const bname = tags.Black;
      let wrating = tags.WhiteElo || '?';
      let brating = tags.BlackElo || '?';
      let match = wname.match(/Guest[A-Z]{4}/);
      if(match)
        wrating = '++++';
      else if(wrating === '-')
        wrating = '----';

      match = bname.match(/Guest[A-Z]{4}/);
      if(match)
        brating = '++++';
      else if(brating === '-')
        brating = '----';
      const description = `${wname || game.wname} (${wrating}) ${bname || game.bname} (${brating})`;

      $(tab.attr('href')).find('.chat-game-description').text(description);
      return true;
    }
    return false;
  }

  public getTabFromGameID(id: number) {
    const tab = $('#tabs .nav-link').filter((index, element) => {
      const match = $(element).attr('id').match(/tab-game-(\d+)(?:-and-(\d+))?/);
      return match && (+match[1] === id || (match[2] && +match[2] === id));
    });
    if(tab.length)
      return tab;
    return null;
  }

  public getGameFromTab(tab: any): any {
    const match = tab.attr('id').match(/tab-game-(\d+)/);
    if(match)
      return games.findGame(+match[1]);
  }

  private updateViewedState(tab: any, closingTab = false, incrementCounter = true) {
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
    $(`#content-${name}`).remove();
  }

  public setUser(user: string): void {
    if(this.user !== user) {
      $('#tabs .closeTab').each((index, element) => {
        this.closeTab($(element).parent().siblings('.nav-link'));
      });
    }

    this.user = user;
    this.userRE = new RegExp(`\\b${user}\\b`, 'ig');
  }

  public async createTab(name: string, showTab = false) {
    let from: string;
    if(!settings.chattabsToggle)
      from = 'console';
    else
      from = name.toLowerCase().replace(/\s/g, '-');

    // Check whether this is a bughouse chat tab, e.g. 'Game 23 and 42'
    let match = from.match(/^game-(\d+)/);
    if(match && match.length > 1) {
      const gameId = match[1];
      for(const key in this.tabData) {
        if(this.tabData.hasOwnProperty(key)) {
          match = key.match(/^game-(\d+)-and-(\d+)/)
          if(match && match.length > 2 && (match[1] === gameId || match[2] === gameId)) {
            from = key;
            break;
          }
        }
      }
    }

    if(!this.tabData.hasOwnProperty(from)) {
      let chName = name;
      if(channels[name] !== undefined)
        chName = channels[name];
     
      match = chName.match(/^Game (\d+)/);
      let tooltip = '';
      let infoBar: JQuery<HTMLElement>;
      if(match && match.length > 1) {
        const game = games.findGame(+match[1]);
        if(game) {
          const tags = game.history.metatags;
          const gameDescription = `${tags.White || game.wname} vs. ${tags.Black || game.bname}`;
          tooltip = `data-bs-toggle="tooltip" data-tooltip-hover-only title="${gameDescription}" `;

          // Show Game chat room info bar
          infoBar = $(`
          <div class="d-flex flex-shrink-0 w-100 chat-info">
            <div class="d-flex align-items-center flex-grow-1 overflow-hidden me-2" style="min-width: 0">
              <button class="chat-game-description btn btn-outline-secondary btn-transparent p-0 chat-info-text"></button>
            </div>
            <button class="chat-watchers d-flex ms-auto align-items-center btn btn-outline-secondary btn-transparent p-0 chat-info-text" data-bs-placement="left">
              <span class="chat-watchers-text">0 Watchers</span>
              <span class="fa-solid fa-users"></span>
            </button>
          </div>`);
        }
      }

      let tabElement = $('#tabs').find(`#tab-${from}`);
      if(!tabElement.length) {
        tabElement = $(`<li ${tooltip}class="nav-item position-relative">
            <button class="text-sm-center nav-link" data-bs-toggle="tab" href="#content-${from}" `
              + `id="tab-${from}" role="tab" style="padding-right: 30px">${chName}</button>
            <container class="d-flex align-items-center h-100 position-absolute" style="top: 0; right: 12px; z-index: 10">
              <span class="closeTab btn btn-default btn-sm">×</span>
            </container>
          </li>`).appendTo('#tabs');

        if(tooltip)
          createTooltip(tabElement);
      }

      let tabContent = $('#chat-tabContent').find(`#content-${from}`);
      if(!tabContent.length) {
        tabContent = $(`<div class="tab-pane" id="content-${from}" role="tabpanel"></div>`);
        tabContent.appendTo('#chat-tabContent');
      }
          
      $(`<div class="d-flex flex-column chat-content-wrapper h-100">
          <div class="flex-grow-1 mt-3 chat-scroll-container" style="min-height: 0">
            <div class="chat-text"></div>
          </div>
        </div>
      </div>`).appendTo(tabContent);

      if(infoBar) {
        tabContent.find('.chat-content-wrapper').prepend(infoBar);
        this.updateGameDescription(tabElement.find('.nav-link'));
        this.updateNumWatchers(tabElement.find('.nav-link'));

        // Display watchers-list tooltip when hovering button in info bar
        tabContent.find('.chat-watchers').on('mouseenter', (e) => {
          const curr = $(e.currentTarget);
          const activeTab = $('#tabs button').filter('.active');
          const watchers = this.getWatchers(activeTab);
          if(watchers) {
            const description = watchers.join('<br>');
            const numWatchers = watchers.length;
            const title = `${numWatchers} Watchers`;
            const tooltipText = !watchers.length
              ? `<b>${title}</b>`
              : `<b>${title}</b><hr class="tooltip-separator"><div>${description}</div>`;

            curr.tooltip({
              title: tooltipText,
              html: true,
              ...watchers.length && {
                popperConfig: {
                  placement: 'left-start',
                },
                offset: [-10, 0]
              }
            }).tooltip('show');
          }

          curr.one('mouseleave', () => {
            curr.tooltip('dispose');
          });
        });

        $('.chat-game-description').on('click', () => {
          const game = this.getGameFromTab($('#tabs button.active'));
          if(game) {
            setGameWithFocus(game);
            maximizeGame(game);
          }
        });
      }

      // Scroll event listener for auto scroll to bottom etc
      tabContent.find('.chat-scroll-container').on('scroll', (e) => {
        const scrollContainer = e.target;
        const tabContent = $(scrollContainer).closest('.tab-pane');
        const tabData = this.getTabDataFromElement(tabContent);

        if(tabContent.hasClass('active')) {
          const atBottom = scrollContainer.scrollHeight - scrollContainer.clientHeight < scrollContainer.scrollTop + 1.5;
          if(atBottom) {
            $('#chat-scroll-button').hide();
            tabData.scrolledToBottom = true;
          }
          else {
            tabData.scrolledToBottom = false;
            $('#chat-scroll-button').show();
          }
        }
      });

      const messages = [];

      this.tabData[from] = {
        messages,
        scroller: null,
        scrollerStarted: false,
        scrolledToBottom: true
      };

      if(tabContent.hasClass('active')) {
        this.tabData[from].scroller = await this.createVirtualScroller(tabContent, messages);
        this.tabData[from].scrollerStarted = true;
      }
    }

    if(showTab) {
      const tabs = $('#tabs button').filter(function() {
        return $(this).attr('id') === `tab-${from}`;
      });
      tabs.first().tab('show');
    }
 
    return this.tabData[from];
  }

  public fixScrollPosition() {
    // If scrollbar moves due to resizing, move it back to the bottom
    const scrollContainer = $('.tab-pane.active .chat-scroll-container');
    if(!scrollContainer.length)
      return;
    const tabContent = scrollContainer.closest('.tab-pane');
    const tabData = this.getTabDataFromElement(tabContent);
    if(tabData.scrolledToBottom) 
      scrollContainer.scrollTop(scrollContainer[0].scrollHeight);
    scrollContainer.trigger('scroll');
  }

  /**
   * Create a virtual-scroller object for a tab's content
   * @param tabContent The chat tab-pane to use
   * @param messages The array of chat messages for the tab
   * @returns VirtualScroller object
   */
  public async createVirtualScroller(tabContent, messages) {
    const { default: VirtualScroller } = await this.virtualScrollerPromise;
    return new VirtualScroller(tabContent.find('.chat-text')[0], messages, (msg: string) => {
      const elem = document.createElement('div');
      elem.classList.add('chat-message');
      elem.innerHTML = msg;
      return elem;
    }, {
      scrollableContainer: tabContent.find('.chat-scroll-container')[0],
      onStateChange: () => {
        this.fixScrollPosition(); // For auto-scrolling to bottom
      }
    });
  }

  public getTabData(name: string) {
    return this.tabData[name];
  }

  public getTabDataFromElement(tabElement: any) {
    return this.getTabData(tabElement.attr('id').toLowerCase().split(/-(.*)/)[1]);
  }

  public deleteTab(name: string) {
    const tabData = this.tabData[name];
    if(tabData.scrollerStarted) 
      tabData.scroller.stop();
    delete this.tabData[name];
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
        `<a class="dropdown-item noselect" id="ch-${ch}">${chName}</a>`);
      $(`#ch-${ch}`).on('click', (event) => {
        event.preventDefault();
        if (!settings.chattabsToggle) {
          ch = 'console';
        }
        this.createTab(ch, true);
      });
    });
  }

  private escapeHTML(text: string) {
    return text.replace(/[<>"]/g, (tag) => {
      const charsToReplace = {
        '<': '&lt;',
        '>': '&gt;',
        '"': '&#34;'
      };
      return charsToReplace[tag] || tag;
    });
  }

  public async newMessage(from: string, data: any, html = false) {
    const tabName = settings.chattabsToggle ? from : 'console';

    if(!/^[\w- ]+$/.test(from))
      return;

    const tab = await this.createTab(tabName);
    let who = '';
    if (data.user !== undefined) {
      let textclass = '';
      if (this.user === data.user) {
        textclass = ' class="mine"';
      }
      let prompt = data.user;
      if (!settings.chattabsToggle && data.channel !== undefined) {
        prompt += `(${data.channel})`;
      }
      who = `<strong${textclass}>${$('<span/>').text(prompt).html()}</strong>: `;
    }

    let text = data.message;
    if(!html)
      text = this.escapeHTML(text);
    if(this.emojisLoaded)
      text = parseEmojis(text);

    text = text.replace(this.userRE, `<strong class="mention">${this.user}</strong>`);

    // Suffix for whispers
    const suffixText = data.type === 'whisper' && !data.suffix ? '(whispered)' : data.suffix;
    const suffix = (suffixText ? ` <span class="chat-text-suffix">${suffixText}</span>`: '');

    text = `${autoLink(text, {
      target: '_blank',
      rel: 'nofollow',
      callback: (url) => {
        return /\.(gif|png|jpe?g)$/i.test(url) ?
          `<a href="${url}" target="_blank" rel="nofollow"><img height="50" src="${url}"></a>`
          : null;
      },
    })}${suffix}</br>`;

    const timestamp = settings.timestampToggle
      ? `<span class="timestamp">[${new Date().toLocaleTimeString()}]</span> `
      : '';

    tab.messages = tab.messages.concat(`${timestamp}${who}${text}`);
    if(tab.scrollerStarted)
      tab.scroller.setItems(tab.messages);

    const tabheader = $(`#tab-${from.toLowerCase().replace(/\s/g, '-')}`);

    if(this.user !== data.user)
      this.updateViewedState(tabheader, false, data.type !== 'whisper');
  }

  private ignoreUnviewed(from: string) {
    return /^\d+$/.test(from) || from === 'roboadmin' || from === 'adminbot'
  }

  public newNotification(msg: string) {
    let currentTab: string;
    if(!msg.startsWith('Notification:') || settings.notificationsToggle) {
      currentTab = this.currentTab().toLowerCase().replace(/\s/g, '-');
      msg = `<strong class="chat-notification">${msg}</strong>`;
    }
    else
      currentTab = 'console';

    this.newMessage(currentTab, {message: msg}, true);
  }

  public closeUnusedPrivateTabs() {
    $('#tabs .nav-link').each((index, element) => {
      const id = $(element).attr('id');
      if(id !== 'tab-console' && !/^tab-(game-|\d+)/.test(id)) {
        const chatText = $($(element).attr('href')).find('.chat-text');
        if(chatText.html() === '')
          this.closeTab($(element))
      }
    });
  }

  public closeGameTab(gameId: number) {
    if(gameId == null || gameId === -1)
      return;

    $('#tabs .nav-link').each((index, element) => {
      const match = $(element).attr('id').match(/^tab-game-(\d+)(?:-|$)/);
      if(match && match.length > 1 && +match[1] === gameId) {
        $($(element).attr('href')).find('.chat-watchers').tooltip('dispose');
        this.closeTab($(element));
      }
    });
  }

  public scrollToChat() {
    if(isSmallWindow()) {
      if($('#secondary-board-area').is(':visible'))
        safeScrollTo($('#chat-panel').offset().top);
      else
        safeScrollTo($('#right-panel-header').offset().top);
    }
  }
}

export default Chat;
