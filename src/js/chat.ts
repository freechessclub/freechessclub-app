// Copyright 2019 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { autoLink } from 'autolink-js';
import { createTooltip, safeScrollTo, isSmallWindow, removeWithTooltips, insertAtCursor } from './utils';
import { setGameWithFocus, maximizeGame, scrollToBoard } from './index';
import { settings } from './settings';
import { storage, awaiting } from './storage';
import { games } from './game';

// list of channels
const channels = {
  0:      'Admins',
  1:      'Help',
  2:      'FICS Discussion',
  3:      'FICS Programmers',
  4:      'Guest Help',
  5:      'Service Representatives',
  6:      'Interfaces Help',
  7:      'Online Tours',
  20:     'Forming Team games',
  21:     'Playing Team games 1',
  22:     'Playing Team games 2',
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
  101:    'Team League',
};

const emoticons = {
  ':)': '😊',
  ':-)': '😊',
  ':D': '😄',
  ':-D': '😄',
  ':(': '☹️',
  ':-(': '☹️',
  ';)': '😉',
  ';-)': '😉',
  ':P': '😛',
  ':-P': '😛',
  ':p': '😛',
  ':-p': '😛',
  ':/': '😕',
  ':-/': '😕',
  ':\\': '😕',
  ':-\\': '😕',
  ':O': '😲',
  ':-O': '😲',
  ':o': '😲',
  ':-o': '😲',
  'B)': '😎',
  'B-)': '😎',
  '>:(': '😠',
  '>:-(': '😠',
  ':|': '😐',
  ':-|': '😐',
  '<3': '❤️',
  '</3': '💔',
  'O:)': '😇',
  'O:-)': '😇',
  ':-*': '😘',
  ':*': '😘',
  ':-X': '🤐',
  ':-x': '🤐',
  'XD': '😆',
  'xD': '😆',
  '-_-': '😑',
  ':3': '😺',
  ':$': '😳',
  ':-$': '😳',
  ':\'(': '😭',
  ':\'-(': '😭'
};

export class Chat {
  private user: string;
  private userRE: RegExp;
  private timezone: string;
  private tabData: object;
  private isConnected: boolean;
  private unviewedNum: number;
  private virtualScrollerPromise: Promise<typeof import('virtual-scroller/dom')>;
  private subscribedChannels: string[];
  private userList: any[];
  private userListHasBeenRequested: boolean = false;
  private inChannelTimer: any = null;
  private emojiUnicodeToShortcodes = new Map(); // Mapping from emoji unicodes to ids (shortcodes)
  private emoji: typeof import('emoji-mart'); // Emoji picker and database
  
  constructor() {
    this.unviewedNum = 0;
    this.subscribedChannels = [];
    this.isConnected = false;
    settings.timestampToggle = (storage.get('timestamp') !== 'false');
    settings.chattabsToggle = (storage.get('chattabs') !== 'false');
    this.virtualScrollerPromise = import('virtual-scroller/dom');

    // initialize tabs
    this.tabData = {};

    $(document).on('show.bs.tab', '#tabs button[data-bs-toggle="tab"]', (e) => {
      if(this.isConnected)
        this.createInChannelTimer(this.getTabName($(e.target)));
    });

    $(document).on('shown.bs.tab', '#tabs button[data-bs-toggle="tab"]', (e) => {
      const tab = $(e.target);
      this.updateViewedState(tab);
      this.updateVirtualScroller(tab);
      this.fixScrollPosition();
    });

    $(document).on('hide.bs.tab', '#tabs button[data-bs-toggle="tab"]', (e) => {
      const tab = $(e.target);
      this.stopVirtualScroller(tab);
      clearInterval(this.inChannelTimer);
    });

    $('#chat-scroll-button').on('click', () => {
      const scrollContainer = $('.tab-pane.active .chat-scroll-container');
      $('#chat-scroll-button').hide();
      scrollContainer.scrollTop(scrollContainer[0].scrollHeight);
    });

    $('#collapse-chat').on('hide.bs.collapse', () => {
      $('#chat-toggle-btn').removeClass('toggle-btn-selected');

      const activeTab = $('#tabs button').filter('.active');
      if(activeTab.length)
        activeTab.trigger('hide.bs.tab');

      this.toggleMaximizeChat(false);
      const menuItem = $('#chat-toggle-menu [data-action="show-hide"]');
      menuItem.find('.menu-label').text('Show Chat');
      menuItem.find('.dropdown-icon').removeClass('fa-eye-slash');
      menuItem.find('.dropdown-icon').addClass('fa-eye');
    });

    $('#collapse-chat').on('hidden.bs.collapse', () => {
      if(!isSmallWindow() && $('#secondary-board-area').children().length === 0) {
        $('body').addClass('chat-hidden');
        $(window).trigger('resize');
      }
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
      if(!isSmallWindow()) {
        $('body').removeClass('chat-hidden');
        $(window).trigger('resize');
      }

      const menuItem = $('#chat-toggle-menu [data-action="show-hide"]');
      menuItem.find('.menu-label').text('Hide Chat');
      menuItem.find('.dropdown-icon').removeClass('fa-eye');
      menuItem.find('.dropdown-icon').addClass('fa-eye-slash');
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
      this.toggleMaximizeChat();
    });
    
    $('#chat-toggle-btn').on('click', () => {
      if(isSmallWindow())
        $('#collapse-chat').collapse('toggle');
    });

    $('#chat-toggle-menu').on('click', '.dropdown-item', (e) => {
      const action = $(e.currentTarget).attr('data-action');
      if(action === 'maximize') 
        this.toggleMaximizeChat();
      else if(action === 'show-hide') 
        $('#collapse-chat').collapse('toggle');
    });

    this.initStartChatMenu();
    this.initEmojis();
  }

  public toggleMaximizeChat(maximize?: boolean) {
    const menuItem = $('#chat-toggle-menu [data-action="maximize"]');

    if($('#mid-col').hasClass('d-none')) {
      if(maximize === true)
        return;

      if($('#secondary-board-area > .game-card').length)
        $('#secondary-board-area').css('display', 'flex');
      menuItem.find('.menu-label').text('Maximize Chat');
    } else {
      if(maximize === false)
        return;

      $('#collapse-chat').collapse('show');
      $('#secondary-board-area').hide();
      menuItem.find('.menu-label').text('Unmaximize Chat');
    }
    $('#left-col').toggleClass('d-none');
    $('#mid-col').toggleClass('d-none');
    menuItem.find('.dropdown-icon').toggleClass('fa-up-right-and-down-left-from-center');
    menuItem.find('.dropdown-icon').toggleClass('fa-down-left-and-up-right-to-center');
    $(window).trigger('resize');
  }

  public connected(user: string): void {
    this.isConnected = true;

    if(this.user !== user) {
      $('#tabs .closeTab').each((index, element) => {
        this.closeTab($(element).parent().siblings('.nav-link'));
      });
    }

    this.createInChannelTimer(this.currentTab());

    this.user = user;
    this.userRE = new RegExp(`\\b${user}\\b`, 'ig');
  }

  public cleanup() {
    this.isConnected = false;
    clearInterval(this.inChannelTimer);
    this.inChannelTimer = null;
  }

  public createInChannelTimer(tabName: string) {
    if(/^\d+$/.test(tabName)) {
      (window as any).sessionSend(`inchannel ${tabName}`);
      awaiting.set('inchannel');
      this.inChannelTimer = setInterval(() => {
        (window as any).sessionSend(`inchannel ${tabName}`);
        awaiting.set('inchannel');
      }, 60000);
    }
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

  public updateMembers(tabName: string, members: string[]) {
    const elem = $(`#content-${tabName} .chat-members-text`); 
    if(!elem.length)
      return;
    elem.text(`${members.length} ${tabName.startsWith('game-') ? 'Watchers' : 'Members'}`);
    this.getTabData(tabName).members = members;
  }

  public updateWatchers(tab: any): boolean {
    const watchers = this.getWatchers(tab);
    if(watchers != null) {
      this.updateMembers(tab.attr('id').replace(/^tab-/, ''), watchers);
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
      if(/^Guest[A-Z]{4}$/.test(wname))
        wrating = '++++';
      else if(wrating === '-')
        wrating = '----';

      if(/^Guest[A-Z]{4}$/.test(bname))
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
    if(tab.hasClass('active')) {
      clearInterval(this.inChannelTimer);
      $('#tabs .nav-link:first').tab('show');
    }

    const name: string = tab.attr('id').toLowerCase().split(/-(.*)/)[1];
    tab.parent().tooltip('dispose');
    tab.parent().remove();
    this.deleteTab(tab);
    removeWithTooltips($(`#content-${name}`));
  }

  public createTab(name: string, showTab = false) {
    let from: string;
    if(!settings.chattabsToggle)
      from = 'console';
    else 
      from = name.toLowerCase().trim().replace(/\s+/g, '-');

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
      this.tabData[from] = {
        messages: [],
        scrollerPromise: null,
        scrollerUpdateCount: 0,
        scrollerStarted: false,
        scrolledToBottom: true
      };

      let chName = name;
      let isGameTab = false, isChannel = false;
      if(Number.isInteger(+name) && +name <= 255) {
        if(channels[name] !== undefined)
          chName = channels[name];
        isChannel = true;
      }
     
      let tooltip = '';
      match = chName.match(/^Game (\d+)/);
      if(match && match.length > 1) {
        const game = games.findGame(+match[1]);
        if(game) {
          const tags = game.history.metatags;
          const gameDescription = `${tags.White || game.wname} vs. ${tags.Black || game.bname}`;
          tooltip = `data-bs-toggle="tooltip" data-tooltip-hover-only title="${gameDescription}" `;
          isGameTab = true;
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

        // Add right-click user actions menu to tab
        tabElement.find('button').toggleClass('clickable-user', !isGameTab && !isChannel && chName !== this.user);

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

      if(isGameTab || isChannel) {
        // Show Game chat room info bar
        const infoBar = $(`
        <div class="d-flex flex-shrink-0 w-100 chat-info">
          <button class="chat-members d-flex ms-auto align-items-center btn btn-outline-secondary btn-transparent p-0 chat-info-text" data-bs-placement="left">
            <span class="chat-members-text">0 ${isGameTab ? 'Watchers' : 'Members'}</span>
            <span class="fa-solid fa-users"></span>
          </button>
        </div>`);
        tabContent.find('.chat-content-wrapper').prepend(infoBar);

        if(isGameTab) {
          infoBar.addClass('game-chat-info');
          infoBar.prepend(`<div class="d-flex align-items-center flex-grow-1 overflow-hidden me-2" style="min-width: 0">
              <button class="chat-game-description btn btn-outline-secondary btn-transparent p-0 chat-info-text"></button>
            </div>`);
          this.updateGameDescription(tabElement.find('.nav-link'));
          this.updateWatchers(tabElement.find('.nav-link'));
        }

        // Display members-list tooltip when hovering button in info bar
        tabContent.find('.chat-members').on('mouseenter', (e) => {
          const curr = $(e.currentTarget);
          const activeTab = $('#tabs button').filter('.active');
          const members = this.getTabDataFromElement(activeTab).members;
          if(members) {
            // Divide members into equal length columns, max 30 in each column
            let description = '';
            const numColumns = Math.ceil(members.length / 30);
            const baseSize = Math.floor(members.length / numColumns); 
            const remainder = members.length % numColumns;             
            let index = 0;
            for (let i = 0; i < numColumns; i++) {
              const groupSize = i < remainder ? baseSize + 1 : baseSize;
              description += '<div>';
              for(let j = 0; j < groupSize; j++) {
                if(index >= members.length) 
                  break;
                description += members[index++] + '<br>';
              }
              description += '</div>';
            }

            const numMembers = members.length;
            const title = `${numMembers} ${isGameTab ? 'Watchers' : 'Members'}`;
            const tooltipText = !members.length
              ? `<b>${title}</b>`
              : `<b>${title}</b><hr class="tooltip-separator"><div class="chat-members-list">${description}</div>`;

            curr.tooltip({
              title: tooltipText,
              customClass: 'chat-members-tooltip',
              html: true,
              ...members.length && {
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

        if(isGameTab) {
          $('.chat-game-description').on('click', () => {
            const game = this.getGameFromTab($('#tabs button.active'));
            if(game) {
              setGameWithFocus(game);
              maximizeGame(game);
            }
          });
        }
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
    }

    const tabElement = $('#tabs').find(`#tab-${from}`);
    if(showTab) 
      tabElement.tab('show');
 
    return tabElement;
  }

  public showTab(name: string) {
    $(`#tab-${name.toLowerCase().replace(/\s/g, '-')}`).tab('show');
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
        this.fixScrollPosition(); 
      }
    });
  }

  public getTabData(name: string) {
    return this.tabData[name];
  }

  public getTabDataFromElement(tabElement: any) {
    return this.getTabData(tabElement.attr('id').toLowerCase().split(/-(.*)/)[1]);
  }

  public getTabName(tabElement: any) {
    return tabElement.attr('id').toLowerCase().split(/-(.*)/)[1];
  }

  public deleteTab(tab: any) {
    const name = this.getTabName(tab);
    this.stopVirtualScroller(tab)
    delete this.tabData[name];
  }

  public currentTab(): string {
    return $('#tabs button.active').attr('id').split(/-(.*)/)[1];
  }

  public addChannelList(chans: string[]) {
    $('#subscribed-channels .dropdown-item').closest('li').remove();
    this.subscribedChannels = [];
    $(`#channels-modal [type="checkbox"]`).prop('checked', false);

    chans.forEach(ch => this.addChannel(ch));
  }

  public addChannel(chan: string) {
    this.subscribedChannels.push(chan);

    let chName = chan;
    if(channels[Number(chan)] !== undefined) {
      chName = channels[Number(chan)];
    }

    // Insert new channel in alphabetical order
    let followingElement: JQuery<HTMLElement> | null = null;
    $('#subscribed-channels .dropdown-item').each(function() {
      const itemText = $(this).text();
      if(itemText.localeCompare(chName) > 0) {
        followingElement = $(this).closest('li'); 
        return false; 
      }
    });

    const menuItem = $(`<li><a class="dropdown-item noselect" data-tab-name="${chan}">${chName}</a></li>`);
    if(followingElement)
      followingElement.before(menuItem)
    else
      $('#subscribed-channels').append(menuItem);
      
    // Tick the channel's 'subscribed' checkbox in the channels modal
    $(`#channels-modal [data-channel="${chan}"]`).prop('checked', true);

    $('#subscribed-channels').toggle($('#add-remove-channels').is(':visible'));
  }

  public removeChannel(chan: string) {
    this.subscribedChannels = this.subscribedChannels.filter(item => item !== chan);
    $(`#subscribed-channels [data-tab-name="${chan}"]`).closest('li').remove();
    $('#subscribed-channels').toggle(!!$('#subscribed-channels .dropdown-item').length);

    // Untick the channel's 'subscribed' checkbox in the channels modal
    $(`#channels-modal [data-channel="${chan}"]`).prop('checked', false);
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

  public newMessage(from: string, data: any, html = false) {
    const tabName = settings.chattabsToggle ? from : 'console';

    if(!/^[\w- ]+$/.test(from))
      return;

    const tabElement = this.createTab(tabName);
    let who = '';
    if (data.user !== undefined) {
      let textclass = '';
      if (this.user === data.user) 
        textclass = ' class="mine"';
      else
        textclass = ' class="clickable-user"'
      let prompt = data.user;
      if (!settings.chattabsToggle && data.channel !== undefined) {
        prompt += `(${data.channel})`;
      }
      who = `<strong${textclass}>${$('<span/>').text(prompt).html()}</strong>: `;
    }

    let text = data.message;
    if(!html)
      text = this.escapeHTML(text);

    text = this.emojify(text, tabName === 'console');

    text = text.replace(this.userRE, `<strong class="mention">${this.user}</strong>`);

    let suffixText = data.suffix;
    if(data.type == 'whisper')
      suffixText = '(whispered)';
    else if(data.type === 'kibitz')
      suffixText = '(kibitzed)';

    text = autoLink(text, {
      target: '_blank',
      rel: 'nofollow',
      callback: (url) => {
        return /\.(gif|png|jpe?g)$/i.test(url) ?
          `<a href="${url}" target="_blank" rel="nofollow"><img height="50" src="${url}"></a>`
          : null;
      },
    });

    let timestamp = settings.timestampToggle 
        ? `<span class="timestamp">[${new Date().toLocaleTimeString()}]</span> `
        : '';

    // 'message' instead of tell
    if(data.datetime) {
      const dateTime = data.datetime;

      if(!settings.chattabsToggle)
        return;

      const now = new Date();

      const dateOptions: any = {
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric'
      };
      if(dateTime.getMonth() !== now.getMonth() || dateTime.getDate() !== now.getDate() || dateTime.getFullYear() !== now.getFullYear()) {
        dateOptions.day = 'numeric';
        dateOptions.month = 'short';
        if(dateTime.getFullYear() !== now.getFullYear())
          dateOptions.year = 'numeric';
      }
      timestamp = `<span class="timestamp">[${dateTime.toLocaleString('default', dateOptions)}]</span> `;
      suffixText = '(message)';
    }
    
    const suffix = (suffixText ? ` <span class="chat-text-suffix">${suffixText}</span>`: '');
    text += suffix;

    const tabData = this.getTabDataFromElement(tabElement); 
    tabData.messages = tabData.messages.concat(`${timestamp}${who}${text}`);
    if(tabElement.hasClass('active'))
      this.updateVirtualScroller(tabElement);

    if(this.user !== data.user || from.toLowerCase() === this.user.toLowerCase())
      this.updateViewedState(tabElement, false, data.type !== 'whisper');
  }

  private async updateVirtualScroller(tabElement: any) {
    const tabContentElement = $(tabElement.attr('href'));
    const scrollContainer = tabContentElement.find('.chat-scroll-container');
    if(!scrollContainer.length)
      return;

    const tabData = this.getTabDataFromElement(tabElement);

    // Throttle updates
    if(!tabData.scrollerUpdateCount) {
      tabData.scrollerUpdateCount = 1;
      setTimeout(() => {
        const count = tabData.scrollerUpdateCount;
        tabData.scrollerUpdateCount = 0;
        if(count > 1 && tabData.scrollerStarted) 
          this.updateVirtualScroller(tabElement);
      }, 250);
    } 
    else {
      tabData.scrollerUpdateCount++;
      return;
    }

    if(!tabData.scrollerPromise) {
      tabData.scrollerPromise = this.createVirtualScroller(tabContentElement, tabData.messages);
      tabData.scrollerStarted = true;
      return;
    }

    const scroller = await tabData.scrollerPromise;
    if(!tabData.scrollerStarted) {
      // In case panel was resized while hidden, recalculate chat message heights so that 
      // virtual-scroller doesn't complain after restarting
      const state = scroller.virtualScroller.getState();
      for(let i = state.firstShownItemIndex; i <= state.lastShownItemIndex; i++) 
        scroller.onItemHeightDidChange(i);
      scroller.start();
      tabData.scrollerStarted = true;
    }

    scroller.setItems(tabData.messages);
  }

  private async stopVirtualScroller(tabElement: any) {
    const tabData = this.getTabDataFromElement(tabElement);
    if(!tabData)
      return;
    const scroller = await tabData.scrollerPromise;
    if(tabData.scrollerStarted) {
      tabData.scrollerStarted = false;
      scroller.stop(); 
    } 
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
      if(match && match.length > 1 && +match[1] === gameId) 
        this.closeTab($(element));
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
 
  /**
   * Creates event listeners for the 'Start Chat' button and menu. This menu allows the user 
   * to open a new chat tab for a user or channel or add/remove channels from their subscribed list (i.e. +ch, -ch)
   */
  public initStartChatMenu() {
    // Triggered before the menu is shown
    $('#start-chat-button').on('show.bs.dropdown', () => {
      this.userList = null;
      this.userListHasBeenRequested = false;
      $('#start-chat-input').val('');
      $('#add-remove-channels').show();
      $('#subscribed-channels').toggle(!!$('#subscribed-channels .dropdown-item').length);
      $('#start-chat-matching-users').hide();
      $('#start-chat-matching-channels').hide();
    });

    // Triggered when a user or channel is clicked in the list in order to open a tab
    $('#start-chat-menu').on('click', '[data-tab-name]', (event) => {
      const chan = $(event.target).attr('data-tab-name') as string;

      if(settings.chattabsToggle) {
        this.createTab(chan, true);
        setTimeout(this.scrollToChat, 300);
      }

      // If user opens a channel tab, also subscribe to that channel (if not already)
      if(Number.isInteger(+chan) && +chan <= 255 && !this.subscribedChannels.includes(chan))
        (window as any).sessionSend(`+ch ${chan}`);
    });

    $('#start-chat-button').on('shown.bs.dropdown', () => {
      $('#start-chat-users-channels').scrollTop(0);
      if(!navigator.maxTouchPoints) 
        $('#start-chat-input').trigger('focus'); // Focus input when not on touch screen
    });

    // Listen for 'Enter' key and open tab, or listen for 'Tab' key for auto-completion
    $('#start-chat-input').on('keydown', (event) => {
      const elem = $(event.target);
      let val = elem.val() as string;
      val = val.trim();
      if(event.key === 'Enter' && val.length) {
        $('#start-chat-button').dropdown('hide');
        let channelFound = false;
        for(const [chNum, chName] of Object.entries(channels)) {
          if(val.toLowerCase() === chName.toLowerCase()) {
            val = chNum;
            channelFound = true;
            break;
          }
        }
        if(!channelFound && this.userList) {
          const matchingUser = this.userList.find(user => user.name.toLowerCase() === val.toLowerCase());
          if(matchingUser)
            val = matchingUser.name;
        }

        if(Number.isInteger(+val) && +val <= 255 && !this.subscribedChannels.includes(val))
          (window as any).sessionSend(`+ch ${val}`);

        if(settings.chattabsToggle) {
          this.createTab(val, true);
          setTimeout(this.scrollToChat, 300);
        }
        elem.val('');
      } 
      else if(event.key === 'Tab') { // Tab auto-complete
        if(val.length) { 
          let match = val;
          const matchingUser = $('#start-chat-matching-users [data-tab-name]').first();
          if(matchingUser.length)
            match = matchingUser.text();
          else {
            const matchingChannel = $('#start-chat-matching-channels [data-tab-name]').first();
            if(matchingChannel.length)
              match = matchingChannel.text();
          }
          if(val !== match) {
            $(event.target).val(match);
            (event.target as HTMLInputElement).select();
          }
        }
        event.preventDefault();
      }
    });

    // Filter results after new character typed in the input
    $('#start-chat-input').on('input', (event) => {
      const elem = $(event.target);
      let val = elem.val() as string;
      $('#start-chat-menu').css('min-width', `${$('#start-chat-menu').width()}px`); // keep menu width the same
      $('#add-remove-channels').toggle(!val.length);
      $('#subscribed-channels').toggle(!val.length && !!$('#subscribed-channels .dropdown-item').length);
      $('#start-chat-matching-users').hide();
      $('#start-chat-matching-users .dropdown-item').closest('li').remove();
      $('#start-chat-matching-channels').hide();
      $('#start-chat-matching-channels .dropdown-item').closest('li').remove();
      if(!this.userListHasBeenRequested) {
        this.userList = null;
        awaiting.set('userlist');
        (window as any).sessionSend('who');
        this.userListHasBeenRequested = true; // Only request the user list once for each time the menu is shown
      }      
      else if(this.userList)
        this.updateStartChatMenuFilter();
    });

    // Initialize subscribed channels
    const sortedChannels = Object.entries(channels).sort(([, valueA], [, valueB]) =>
      valueA.localeCompare(valueB)
    );
    sortedChannels.forEach(ch => {
      $('#channels-modal tbody').append(`<tr><td>${ch[1]}</td><td><input type="checkbox" data-channel="${ch[0]}"></td></tr>`);
    });

    // Triggered when 'Add or remove chat rooms' button is clicked
    $('#add-remove-channels button').on('click', (event) => {
      $('#channels-modal').modal('show');
    });

    // Prevent menu from hiding when 'Add or remove chat rooms' button is clicked 
    $('#channels-modal').on('hidden.bs.modal', (event) => {
      $('#start-chat-button').off('hide.bs.dropdown');
    });
    $('#channels-modal').on('show.bs.modal', () => {
      $('#start-chat-button').on('hide.bs.dropdown', (event) => {
        event.preventDefault();
      });
    });
    $('#channels-modal').on('hide.bs.modal', () => {
      $('#channels-modal-list').scrollTop(0);
    });

    // Update subscribed channels when checkbox is clicked
    $('#channels-modal').on('click', '[type="checkbox"]', (event) => {
      const elem = $(event.target);
      if(elem.prop('checked'))
        (window as any).sessionSend(`+ch ${elem.attr('data-channel')}`);
      else
        (window as any).sessionSend(`-ch ${elem.attr('data-channel')}`);
    });  
  }

  /**
   * Called externally when results from a 'who' comamnd are received 
   */
  public updateUserList(users: any[]) {
    this.userList = users;
    this.updateStartChatMenuFilter();
  }

  /** Shows users and channels matching the text typed in the 'Start chat with...' input within the 'Start Chat' menu */
  private updateStartChatMenuFilter() {
    if($('#start-chat-menu').hasClass('show')) {
      let inputText = $('#start-chat-input').val() as string;
      inputText = inputText.trim().toLowerCase();
      if(inputText.length) {
        // Only show first 6 results, sorted alphabetically and excluding user's own name
        let matchingUsers = this.userList.filter(user => user.name.toLowerCase().startsWith(inputText) && user.name !== this.user);
        if(matchingUsers.length) {
          matchingUsers = matchingUsers.slice(0,6).sort((a, b) => a.name.localeCompare(b.name));
          matchingUsers.forEach(m => $('#start-chat-matching-users').append(
            `<li><a class="dropdown-item noselect clickable-user" data-tab-name="${m.name}">${m.name}</a></li>`));
        }
        $('#start-chat-matching-users').toggle(!!matchingUsers.length);

        let matchingChannels = Object.entries(channels).filter(([key, value]) => value.toLowerCase().startsWith(inputText) || key.startsWith(inputText));
        if(matchingChannels.length) {
          matchingChannels = matchingChannels.sort((a, b) => a[1].localeCompare(b[1]));
          matchingChannels.forEach(m => $('#start-chat-matching-channels').append(
            `<li><a class="dropdown-item noselect" data-tab-name="${m[0]}">${m[1]}</a></li>`));
        }
        $('#start-chat-matching-channels').toggle(!!matchingChannels.length);
      }
    }
  }

  /**
   * Converts unicode emojis in the given text to shortcodes (and sometimes emoticons :-))
   */
  public unemojify(text: string): string {
    if(!this.emoji)
      return text;

    // Convert basic emojis to emoticons (only if they are a stand-alone word surrounded by whitespace)
    const unicodeToEmoticon = Object.entries(emoticons).reduce((acc, [k, v]) => {
      acc[v] = k;
      return acc;
    }, {});

    const regex = new RegExp(
      Object.keys(unicodeToEmoticon)
        .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .map(k => `(?<=[ \\t]|^)${k}(?!\\S)`) 
        .join('|'),
      'g'
    );
    text = text.replace(regex, match => unicodeToEmoticon[match] || match);

    // Convert other emojis to shortcodes
    const parts: string[] = [];
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const graphemes = Array.from(segmenter.segment(text), s => s.segment);

    for(const char of graphemes) 
      parts.push(this.emojiUnicodeToShortcodes.get(char) || char);  
    return parts.join('');
  }

  /**
  * Converts emoji shortcodes and ascii emoticons in the given text to unicode emojis
  */
  public emojify(text: string, console = false): string {
    if(!this.emoji)
      return text;

    // Convert shortcodes to emojis
    const parts: string[] = [];
    let lastIndex = 0;
    let regex = /(?:\:([^\:]+)\:)(?:\:skin-tone-(\d)\:)?/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const shortcode = match[1];
      const skinsIndex = match[2] ? +match[2] - 1 : 0;
      parts.push(text.slice(lastIndex, start));
      const emoji = (this.emoji.SearchIndex as any).get(shortcode);
      if(emoji) 
        parts.push(emoji.skins[skinsIndex].native);
      else {
        parts.push(match[0].slice(0, -1));
        regex.lastIndex--;
      }
      lastIndex = regex.lastIndex;
    }
    parts.push(text.slice(lastIndex));
    text = parts.join('');

    // Convert basic emoticons to emojis (only if they are stand-alone words surrounded by whitesppace)
    regex = new RegExp(
      Object.keys(emoticons)
        .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .map(k => `(?<=[ \\t]${!console ? '|^' : ''})${k}(?!\\S)`)
        .join('|'),
      'g'
    );
    return text.replace(regex, match => emoticons[match] || match);
  }

  /**
   * Show the emoji picker 
   */
  public showEmojiPicker() {
    if(!this.emoji)
      return;

    const picker = new this.emoji.Picker({
      theme: getComputedStyle(document.documentElement).getPropertyValue('--color-scheme').trim(),
      onClickOutside: () => this.hideEmojiPicker(),
      onEmojiSelect: (emoji) => {
        $('#input-text').trigger('focus');
        insertAtCursor($('#input-text'), emoji.native);
        $('#input-text').trigger('blur');
      }
    }) as any;
    $('#emoji-panel')[0].prepend(picker);
    $('#emoji-panel').css('visibility', 'visible');
  }

  /**
   * Hide the emoji picker
   */
  public hideEmojiPicker() {
    $('#emoji-panel').css('visibility', 'hidden');
    $('em-emoji-picker').remove();
  }

  /** 
   * Ininitalize the emoji database and emoji picker element) 
   */
  public async initEmojis() {
    let data = null;
    
    try {
      const response = await fetch('https://cdn.jsdelivr.net/npm/@emoji-mart/data');
      data = await response.json();
    }
    catch(e) { return; } 

    const emojiMart = await import('emoji-mart');
    await emojiMart.init({ data });
    this.emoji = emojiMart;

    // Build mapping from emoji unicodes to shortcodes for fast synchornous lookup
    for(const em of Object.values(data.emojis) as any[]) {
      for(const skin of em.skins) 
        this.emojiUnicodeToShortcodes.set(skin.native, skin.shortcodes);
    }

    $('#emoji-button').on('click', (e) => {
      if($('#emoji-panel').css('visibility') === 'hidden') {
        e.stopPropagation();
        this.showEmojiPicker();
      }
      $('#emoji-button').trigger('blur'); // So the "fake" text input loses focus styling
      $('#emoji-button').tooltip('hide');
    });
  }
}

export default Chat;
