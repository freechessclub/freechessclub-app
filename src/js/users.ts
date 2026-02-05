// Copyright 2024 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { awaiting, storage } from './storage';
import { createContextMenuTrigger, createContextMenu, getValue, removeWithTooltips, sortTable, scrollToTop, getTouchClickCoordinates } from './utils';
import { showTab, setRematchUser } from './index';

/** 
 * Users modal (friend list etc) and user context menu for clicking on a user's name and performing actions 
 */
export class Users {
  private session = null;           // The current session
  private chat = null;              
  public userList: any[];           // The list of online users, from the 'who' command
  public friendList: any[] = [];
  public topPlayersList: any[];     // The list of top players from for each category, from the 'hbest' command 
  private updateUsersTimer = null;  // 1 minute timer that sends 'who' and 'hbest' commands when users modal is showing

  constructor() {
    this.loadFriends(); // Load stored friend list

    /** Create events for triggering 'User actions' context menu when a user's name is clicked */
    createContextMenuTrigger((event) => {
      if(!this.session || !this.session.isConnected())
        return false;

      const target = $(event.target);
      const nameElem = target.closest('.clickable-user');
      return nameElem.length && nameElem.text() && nameElem.text() !== this.session.getUser()
          && (event.type !== 'click' || !nameElem.closest('li').length);
    }, (e) => this.createUserActionsMenu(e), true, true, true);

    $('#users-btn').on('click', () => {
      $('#users-modal').modal('show');
    });

    $('#users-modal').on('shown.bs.modal', () => {
      $('#add-friend-input').val('');
      $('#friends-table tr').removeClass('highlighted');

      const requestUsers = () => {
        if(this.session?.isConnected()) {
          awaiting.set('userlist');
          this.session.send('who');
          console.log('hello?');
          if($('#top-players-tab').hasClass('active')) {
            console.log('hello 2');
            awaiting.set('hbest');
            this.session.send('hbest lbsxBzLSw');
          }
        }
      };

      requestUsers();
      this.updateUsersTimer = setInterval(() => {
        requestUsers();
      }, 60000);  
    });

    $('#users-modal').on('hide.bs.modal', () => {
      clearInterval(this.updateUsersTimer);
      $('.info-dialog').remove();
    });

    $('#add-friend').on('submit', (event) => {
      event.preventDefault();
      let val = getValue('#add-friend-input');
      if(val === '')
        return;

      this.hideFriendSuggestions();

      let row = this.findUserTableItem($('#friends-table'), val);
      if(!row.length) {
        $('#add-friend-input').val('');
        this.addFriend(val);
      }

      row = this.findUserTableItem($('#friends-table'), val);
      if(row.length) {
        row.addClass('highlighted');
        row[0].scrollIntoView({ behavior: 'smooth', block: 'nearest'});   
      }
    });

    $('#add-friend-input').on('input focus', (event) => {
      const inputText = ($('#add-friend-input').val() as string).trim().toLowerCase();
      $('#add-friend-suggestions').html('');
      if(inputText.length && this.userList) {
        let matchingUsers = this.userList.filter(user => user.name.toLowerCase().startsWith(inputText) && user.name !== this.session.getUser());
        if(matchingUsers.length) {
          matchingUsers = matchingUsers.slice(0,6).sort((a, b) => a.name.localeCompare(b.name));
          matchingUsers.forEach(m => $('#add-friend-suggestions').append(
            `<li><a class="dropdown-item noselect">${m.name}</a></li>`));
        }
        this.showFriendSuggestions();
      }
      else 
        this.hideFriendSuggestions();
    });

    $('.users-table').on('click', '.more-user-actions', (e) => {
      if($(e.currentTarget).next().hasClass('user-actions-menu')) {
        return; // Menu already exists, let it hide instead
      }
      this.createUserActionsMenu(e);
    });
    $('.users-table').on('show.bs.dropdown', '.more-user-actions', (e) => {
      // Keep user's action buttons visible while the 'more actions' dropdown menu is showing
      $(e.currentTarget).parent().css('display', 'inline-flex'); 
    });
    $('.users-table').on('hidden.bs.dropdown', '.more-user-actions', (e) => {
      $(e.currentTarget).parent().css('display', ''); 
    });

    $('.users-table').on('click', '.delete-user', (e) => {
      const row = $(e.currentTarget).closest('tr');
      const name = row.attr('data-name');
      if($(e.currentTarget).closest('#friends-table').length) {
        this.friendList = this.friendList.filter(item => item.name !== name);
        this.saveFriends();
      }
      removeWithTooltips(row);
    });

    $('.users-table').on('click', '.sortable-column', (e) => {
      const col = $(e.currentTarget);
      sortTable(col.closest('.users-table'), col);
    });

    $('#add-friend-input').on('keydown', (event) => {
      $('#friends-table tr').removeClass('highlighted');

      const elem = $(event.target);
      let val = elem.val() as string;
      val = val.trim();
      if(event.key === 'Tab') { // Tab auto-complete
        if(val.length) { 
          const matchingUser = $('#add-friend-suggestions .dropdown-item').first();
          if(matchingUser.length) {
            const match = matchingUser.text();
            if(val !== match) {
              $(event.target).val(match);
              (event.target as HTMLInputElement).select();
            }
          }
        }
        event.preventDefault();
      }
    });

    $('#search-online-users').on('input', (event) => {
      const elem = $(event.target);
      let val = elem.val() as string;
      if(this.userList) {
        this.updateUsersTable($('#online-users-table'), this.userList.filter(user => !user.title.includes('(C)') && !user.title.includes('(TD)') && user.name.toLowerCase().startsWith(val.toLowerCase())));
        $('#online-users-table-container').scrollTop(0); 
      }
    });

    $('#top-players-tab').on('show.bs.tab', () => {
      if(this.session?.isConnected()) {
        awaiting.set('hbest');
        this.session.send('hbest lbsxBzLSw');
      }
    });

    $('#top-players-category-menu').on('click', '.dropdown-item', (e) => {
      const category = $(e.target).text();
      $('#top-players-category-btn').text(category);
      if(this.topPlayersList) {
        this.updateUsersTable($('#top-players-table'), this.topPlayersList.filter(player => player.category === category));
        $('#top-players-table-container').scrollTop(0); 
      }
    });
  }

  /**
   * Called after connecting to the server
   */
  public connected(session: any, chat: any) {
    this.session = session;
    this.chat = chat;

    if($('#users-modal').hasClass('show')) {
      awaiting.set('userlist');
      this.session.send('who');
      if($('#top-players-tab').hasClass('active')) {
        awaiting.set('hbest');
        this.session.send('hbest lbsxBzLSw');
      }
    }
  }

  /**
   * Update friendList and topPlayersList entries from the userList (result of 'who' command) 
   * Then update the tables in the Users modal with latest friendList, userList and topPlayersList
   */
  public updateUsers() {
    if(this.userList) {
      // Update friendList entries with the matching entry from userList (results of the 'who' command)
      this.friendList.forEach(friend => {
        const user = this.userList.find(u => u.name.toLowerCase() === friend.name.toLowerCase());
        if(user) 
          Object.assign(friend, user);
        else
          friend.status = 'x';
      });
      this.saveFriends();

      // Update the status property (online/offline etc) of topPayersList entries with the matching entry 
      // from userList (results of the 'who' command)
      if(this.topPlayersList) {
        this.topPlayersList.forEach(player => {
          const user = this.userList.find(u => u.name.toLowerCase() === player.name.toLowerCase());
          if(user) 
            Object.assign(player, user);
          else
            player.status = 'x';
        });
      }
    }

    this.updateUsersTable($('#friends-table'), this.friendList);
    if(this.userList) {
      const humans = this.userList.filter(user => !user.title.includes('(C)') && !user.title.includes('(TD)'));
      $('#online-users-count').text(`${humans.length} online users.`);
      $('#online-users-count').show();
      const filter = $('#search-online-users').val() as string;
      this.updateUsersTable($('#online-users-table'), humans.filter(user => user.name.toLowerCase().startsWith(filter.toLowerCase())));
    }
    if(this.topPlayersList) {
      const category = $('#top-players-category-btn').text();
      this.updateUsersTable($('#top-players-table'), this.topPlayersList.filter(player => player.category === category));
    }
  }

  /**
   * Update a table in the Users modal from the given user list
   * @param table The table JQuery element to update (friends, online-users or top-players)
   * @param users The list to update the table from 
   */
  private updateUsersTable(table: any, users: any) {
    if(!$('#users-modal').hasClass('show')) // Only update table if the Users modal is showing
      return;

    const deleteButton = table.attr('id') === 'friends-table'; // Allow user to delete friends

    users.forEach(user => {
      let item = this.findUserTableItem(table, user.name);
      if(!item.length) {
        // Entry doesn't exist so create it
        item = $(`
          <tr>
            <td></td>
            <td class="text-end"></td> 
            <td style="white-space: normal;">
              <div class="d-inline-flex w-100" style="align-items: baseline">
                <div class="user-status"></div>
                  <div class="user-buttons">
                    ${deleteButton ? 
                    `<button type="button" style="line-height: 1" class="border-0 me-2 py-0 delete-user btn btn-outline-secondary btn-sm btn-transparent" aria-label="Delete User" title="Delete user">
                      <span class="fa-solid fa-trash-can" aria-hidden="false"></span>
                    </button>` : ''}
                    <button type="button" style="line-height: 1" class="border-0 py-0 more-user-actions dropdown-toggle btn btn-outline-secondary btn-sm btn-transparent hide-caret position-relative" aria-expanded="false" title="More actions" aria-label="More actions">
                      <span class="fa-solid fa-ellipsis-vertical" aria-hidden="false"></span>
                    </button>
                  </div>
                </div>
              </div>
            </td>
          </tr>`);
        item.appendTo(table.find('tbody'));
      }
      const nameCell = item.find('td:eq(0)');
      nameCell.html(`<span class="clickable-user">${user.name}${user.title}</span>`);
      item.attr('data-name', user.name);
      item.find('td:eq(1)').text(user.rating);
      item.find('td:eq(2)').attr('data-sort-value', this.userStatusCodeToSortValue(user.status)); // Used to sort the status column by online vs offline
      const statusElem = item.find('.user-status');
      statusElem.text(this.userStatusCodeToName(user.status));
      statusElem.toggleClass('offline', user.status === 'x'); // Show offline status with a different color
    });

    // Remove entries that no longer have a matching user in the user list
    table.find('tbody tr').each((_, elem) => {
      if(!users.find(user => $(elem).attr('data-name') === user.name))
        removeWithTooltips($(elem));
    });

    sortTable(table);
  }

  /**
   * Return the table row that matches the given user name
   */
  private findUserTableItem(tableElem: any, name: string) {
    return tableElem.find('tbody tr').filter(function() {
      return $(this).attr('data-name').trim().toLowerCase() === name.trim().toLowerCase();
    });
  }

  /**
   * Convert 'who' status codes to names
   */
  private userStatusCodeToName(code: string) {
    const statusNames = {
      'x': 'Offline',
      ' ': 'Online',
      '.': 'Idle',
      '^': 'Playing',
      '~': 'Reffing',
      ':': 'Not open',
      '#': 'Examining',
      '&': 'Tournament' 
    };
    return statusNames[code] || '';
  }

  /**
   * Divide status codes into 3 categories, 'online', 'offline' and 'no status' 
   * This allows the the Status column in the tables to be sorted by online / offline
   */
  private userStatusCodeToSortValue(code: string) {
    if(!code)
      return 3;
    else if(code === 'x')
      return 2;
  
    return 1;
  }

  /**
   * Add a friend to the friend list
   * @param name The name plus titles of the friend, e.g. Kasparov(GM)(TD)
   * @param the friend's rating (if known)
   * @param updateTable If true update the friends table after adding. We might want to defer this 
   * if adding many friends at once
   */
  public addFriend(name: string, rating = '', updateTable = true, save = true) {
    name = name.trim();
    if(!name || name.length > 17 || !/^[A-Za-z()]+$/.test(name)) // Test name is a valid username
      return;

    // Split name into name and titles
    let title = '';
    const idx = name.indexOf('(');
    if(idx !== -1) {
      title = name.slice(idx);
      name = name.slice(0, idx);
    } 

    let friend = this.friendList.find(item => item.name.toLowerCase() === name.toLowerCase());
    if(friend) {
      // name already exists
      return;
    }

    const user = this.userList?.find(item => item.name.toLowerCase() === name.toLowerCase());
    if(user) {
      friend = { ...user }; // Update friend entry from userList (result of 'who' command)
      this.friendList.push(friend);
    }
    else {
      friend = {
        name,
        title,
        rating,
        status: this.userList ? 'x' : '' // If friend is not in the userList, then mark them as offline
      }
      this.friendList.push(friend);
    }
    if(save)
      this.saveFriends(); // save friend list to localstorage

    if(updateTable)
      this.updateUsersTable($('#friends-table'), this.friendList); // update the friends table
  }

  /**
   * Load the friend list from localstorage
   */
  public loadFriends() {
    const storedFriends = JSON.parse(storage.get('friends')) || [];
    storedFriends.forEach(friend => {
      this.addFriend(friend.name, friend.rating, false, false);
    });
    this.updateUsersTable($('#friends-table'), this.friendList);
  }

  /**
   * Save the friend list to localstorage
   */
  public saveFriends() {
    const storedFriends = this.friendList.map(fr => ({
      name: `${fr.name}${fr.title}`,
      rating: fr.rating
    }));
    storage.set('friends', JSON.stringify(storedFriends));
  }

  /**
   * Add users from a notify list to the friends list
   */
  public addFriendsFromNotify(names: string[]) {
    if(!names || !names.length)
      return;

    let added = false;
    names.forEach((name) => {
      const before = this.friendList.length;
      this.addFriend(name, '', false, false);
      if(this.friendList.length !== before)
        added = true;
    });

    if(added) {
      this.saveFriends();
      this.updateUsersTable($('#friends-table'), this.friendList);
    }
  }

  /**
   * Show auto-complete dropdown menu below 'add friend' input with suggestions taken from the list of online users
   * based on the text in the input
   */
  private showFriendSuggestions() {
    if(!$('#add-friend-suggestions').hasClass('show')) {
      $('#add-friend-suggestions').addClass('show'); 

      /** If user clicks, check if they clicked on a suggestion or elsewhere (to close the menu) */
      $(document).on('click.friend-suggestions', (e) => {
        const menuItem = $(e.target).closest('#add-friend-suggestions .dropdown-item');
        if(menuItem.length) {
          $('#add-friend-input').val(menuItem.text());
          const row = this.findUserTableItem($('#friends-table'), menuItem.text());
          if(row.length) {
            // if user clisks suggestion which is already in friend list then highlight it in the table
            row.addClass('highlighted');
            row[0].scrollIntoView({ behavior: 'smooth', block: 'nearest'});      
          }  
        }

        if(!$(e.target).closest('#add-friend-input').length) // If user clicks in the input, then don't close suggestions
          this.hideFriendSuggestions();
      });
    }
  }

  /** Hide 'add friend' suggestions dropdown menu */
  private hideFriendSuggestions() {
    $('#add-friend-suggestions').removeClass('show');
    $(document).off('click.friend-suggestions');
  }

  /**
   * Parse the result from the server 'hbest' command into a structured user list 
   */
  public parseBest(msg: string) {
    const users: object[] = [];
    const lines = msg.split('\n');
    const categories = lines[0].split(/\s+/);
    for(let line of lines.slice(2)) {
      const userStrings = line.match(/.{1,25}/g);
      userStrings.forEach((val, index) => {
        const match = val.match(/(?:\d+\.\s+)?([^(\s]+)(\S*?)\s+(\d+)/);
        if(match) {
          users.push({
            name: match[1],
            title: match[2],
            rating: match[3],
            category: categories[index]
          });
        }
      });
    }
    this.topPlayersList = users;
  }

  /**
   * Create the 'user actions' context menu when the user clicks on a user's name, any element with
   * the 'clickable-user' class in the app 
   * @param e the event (element and event type) that triggered the context menu,
   * i.e. left click, contextmenu, long touch
   */
  private createUserActionsMenu(e: any) {
    // If the triggering element has the [data-name] attribute then get the user's name from that
    // otherwise get it from the text() of the element
    const nameElement = $(e.target).closest('[data-name]');
    let name = nameElement.length ? nameElement.attr('data-name') : $(e.target).text();
    name = name.trim().split('(')[0]; // Remove titles from end of username

    const menu = $(`<ul class="dropdown-menu noselect user-actions-menu">
      ${!this.friendList.find(friend => friend.name.toLowerCase() === name.toLowerCase()) ? '<li><a class="dropdown-item" data-action="add-friend">Add Friend</a></li>' : ''}   
      <li><a class="dropdown-item" data-action="message">Message</a></li>
      <li><a class="dropdown-item" data-action="challenge">Challenge</a></li>
      <li><a class="dropdown-item" data-action="rematch">Rematch</a></li>
      <li><a class="dropdown-item" data-action="observe">Observe</a></li>
      <li><a class="dropdown-item" data-action="follow">Follow</a></li>
      <li><a class="dropdown-item" data-action="unfollow">Unfollow</a></li>
      <li><a class="dropdown-item" data-action="finger">Finger</a></li>
      <li><a class="dropdown-item" data-action="history">History</a></li>
      <li><a class="dropdown-item" data-action="h2h">Head to Head</a></li>
      <li><a class="dropdown-item" data-action="noplay">Add to 'No Play'</a></li>
      <li><a class="dropdown-item" data-action="censor">Censor</a></li>
    </ul>`);

    const userActionsItemSelected = (e2) => {
      const menuItem = $(e2.target).closest('.dropdown-item');
      const modal = $(e.target).closest('.modal');

      if(menuItem.length) {
        $('#start-chat-button').dropdown('hide'); // In case we are right clicking on a name in the 'start chat' menu
        const action = menuItem.data('action');
        switch(action) {
          case 'add-friend':
            this.addFriend(name);
            break;
          case 'rematch': 
            // Perform a 'history rematch' i.e. unlike the server's 'rematch' command which only rematches
            // the user of the previous game played. Our 'history rematch' checks the entire history (last 10
            // games) for the last match played against this user (if any) and sends a challenge with the same
            // game type
            if(modal.length)
              modal.modal('hide'); // If the context menu is in a modal, then hide it
            setRematchUser(name);
            awaiting.set('history-rematch');
            this.session.send('history');
            break;
          case 'challenge':
            // Navigates to the 'Play -> Pairing' pane and adds the user's name to the 'Play Against' input
            if(modal.length)
              modal.modal('hide');
            $('#opponent-player-name').val(name);
            showTab($('#pills-play-tab'));
            $('#pills-pairing-tab').tab('show');
            if($('#collapse-menus').hasClass('show'))
              scrollToTop();
            else
              $('#collapse-menus').collapse('show');
            break;
          case 'message':
            // Creates a chat tab for the user and navigates to it
            if(modal.length)
              modal.modal('hide');
            if($('#collapse-chat').hasClass('show'))
              this.chat.scrollToChat();
            else
              $('#collapse-chat').collapse('show');
            this.chat.createTab(name, true);
            break;
          case 'observe':
            if(modal.length)
              modal.modal('hide');
            this.session.send(`obs ${name}`);
            break;
          case 'follow':
            this.session.send(`follow ${name}`);
            break;
          case 'unfollow':
            this.session.send(`follow`);
            break;
          case 'finger':
            // Create an info dialog with the user's finger info
            awaiting.set('info-finger');
            this.session.send(`finger ${name}`);
            break;
          case 'history':
            // Navigates to the history pane and retrieves the user's history
            if(modal.length)
              modal.modal('hide');
            showTab($('#pills-history-tab'));
            if($('#collapse-menus').hasClass('show'))
              scrollToTop();
            else
              $('#collapse-menus').collapse('show');
            awaiting.set('history');
            this.session.send(`history ${name}`);
            break;
          case 'h2h':
            awaiting.set('info-pstat');
            this.session.send(`oldpstat ${name}`);
            break;
          case 'noplay':
            this.session.send(`+noplay ${name}`);
            break;
          case 'censor':
            this.session.send(`+censor ${name}`);
            break;
        }
      }
    };

    const elem = $(e.currentTarget);
    if(elem.hasClass('dropdown-toggle')) {
      // If the triggering element is a dropdown-toggle button, then attach the context menu to it 
      // e.g. the 'more actions' button in the Users tables
      elem.after(menu);
      elem.attr('data-bs-toggle', 'dropdown');
      elem.one('hidden.bs.dropdown', () => {
        setTimeout(() => {
          const menu = elem.next();
          const instance = bootstrap.Dropdown.getInstance(elem);
          if(instance) 
            instance.dispose();
          menu.remove();
          elem.removeAttr('data-bs-toggle');
        }, 0);
      });
      menu.one('click', '.dropdown-item', userActionsItemSelected);

      (bootstrap.Dropdown.getOrCreateInstance(elem)).show(); 
    }
    else {
      const coords = getTouchClickCoordinates(e);
      createContextMenu(menu, coords.x, coords.y, userActionsItemSelected, null);
    }
  }
}

export default Users;