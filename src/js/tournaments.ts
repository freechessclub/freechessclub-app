// Copyright 2024 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { awaiting, storage } from './storage';
import { createNotification, removeNotification, showFixedDialog } from './dialogs';
import { convertToServerDate, convertToLocalDate, parseDate, getDiffDays, getNextWeekDayDate } from './utils';

/**
 * Controls the Play->Tournaments pane.
 * Adds panels for tournaments, king of the hill and team league
 */
export class Tournaments {
  // Currently there is only one scheduled tournament on FICS, so we might as well
  // just hard code it in.
  private scheduledTournaments = [{
    title: 'The Nightly 5 0 at 22:00', // title should exactly match title on FICS
    type: '5 0 r SS\\5',
    recurring: 'daily',
  }];

  private tdMessage = '';                       // Stores long responses from td (tournament bot) so we can join them together before parsing them
  private tdVariables: any = {};                // Stores user's td variables 
  private session = null;                       // The current session
  private alerts: any = {};                     // Keeps track of whether a tournament or KoTH should alert the user (by making the Tournaments tab red)
  private kothShowNotifications = false;        // If true, will show slide-down notifications when the King changes in KoTH
  private kothReceiveInfo = null;               // If true, will show KOTHInfo messages in the Console (this is required in order to show slide-down notifications)
  private kothFollowKing = null;                // Tracks whether the user is currently following the King in KoTH (observing all their games)
  private tournamentsShowNotifications = false; // If true, will show slide-down notifications when a tournament opens
  private tournamentsReceiveInfo = null;        // If true, will show TourneyInfo messages in the Console (this is required in order to show slide-down notifications)
  private notifyList = {};                      // Whether to show slide-down notifications when a specific tournaments start, i.e. if the user click the 'Notify Me' button on a tournament
  private pendingTournaments = [];              // Stores the tournament data from 'td listtourneys' temporarily until the title and other data is retrieved from 'td players' or 'td standardgrid'

  constructor() {
    /** Tournament pane shown */
    $(document).on('shown.bs.tab', 'button[data-bs-target="#pills-tournaments"]', (e) => {
      $('button[data-bs-target="#pills-tournaments"]').removeClass('tournaments-unviewed');
      this.initTournamentsPane(this.session);
    });
    $(document).on('shown.bs.tab', 'button[data-bs-target="#pills-play"]', () => {
      if($('#pills-tournaments').hasClass('active')) {
        $('button[data-bs-target="#pills-tournaments"]').removeClass('tournaments-unviewed');
        this.initTournamentsPane(this.session);
      }
    });

    /** Tournaments pane hidden */
    $(document).on('hidden.bs.tab', 'button[data-bs-target="#pills-tournaments"]', () => {
      this.leaveTournamentsPane();
    });
    $(document).on('hidden.bs.tab', 'button[data-bs-target="#pills-play"]', () => {
      this.leaveTournamentsPane();
    });

    // Show slide-down notifications when the King changes in KoTH? 
    this.kothShowNotifications = (storage.get('koth-show-notifications') === 'true');

    // Temporarily store the user's KOTHInfo td variable, because we must set it to true
    // when the Tournaments panel is showing. This allows us to restore their variable afterwards
    let val = storage.get('koth-receive-info');
    if(val === 'true')
      this.kothReceiveInfo = true;
    else if(val === 'false')
      this.kothReceiveInfo = false;

    // Will we show slide-down notifications whenever ANY tournament is opened? 
    this.tournamentsShowNotifications = (storage.get('tournaments-show-notifications') === 'true');
    
    // Temporarily store the user's TourneyInfo and TourneyUpdates td variables, 
    // because we must set it to true when the Tournaments panel is showing. 
    // This allows us to restore their variables afterwards
    val = storage.get('tournaments-receive-info');
    if(val === 'true')
      this.tournamentsReceiveInfo = true;
    else if(val === 'false')
      this.tournamentsReceiveInfo = false;
   
    // The notifyList keeps track of whether the user has pressed 'Notify Me' on 
    // individual tournaments and wants slide down notifications just for those tournaments
    this.notifyList = JSON.parse(storage.get('tournaments-notify-list')) || {};
  }

  /**
   * Called after connecting to the server
   */
  public connected(session: any) {
    this.session = session;
    
    // Restore the user's original KOTHInfo, TourneyInfo and TourneyUpdates 
    // td variables in case they were over-written 

    if(typeof this.kothReceiveInfo === 'boolean') {
      awaiting.set('td-set');
      this.session.send(`td set KOTHInfo ${this.kothReceiveInfo ? 1 : 0}`);
    }

    if(typeof this.tournamentsReceiveInfo === 'boolean') {
      awaiting.set('td-set'); 
      this.session.send(`td set TourneyInfo ${this.tournamentsReceiveInfo ? 1 : 0}`);
    }
    
    if($('#pills-tournaments').hasClass('active'))
      this.initTournamentsPane(session);
  }

  // Called when disconnected from the server
  public cleanup() {
    $('#tournaments-pane-status').hide(); 
    $('#pills-tournaments .tournament-group').remove();
  }

  /**
   * Build the tournaments pane
   * Add the Tournament, KoTH and Team League cards 
   */
  public initTournamentsPane(session: any) {
    if(!session || !session.isConnected())
      return;
    
    this.tdVariables = {};

    $('#tournaments-pane-status').hide(); // Hide any displayed errors
    
    // Set td line height to 999 so we don't have to issue 'td next' commands
    // We restore it to the default height 24 after retrieving all the tournament data
    awaiting.set('td-set');
    this.session.send('td set height 999'); 
    
    awaiting.set('td-variables');
    this.session.send('td variables'); // Retrieve the user's td variables, so we can store and restore their KOTHInfo, TourneyInfo and TourneyUpdates settings

    // Add the scheduled tournaments (e.g. the Nightly 5 0)
    this.scheduledTournaments.forEach(tourney => {
      this.addTournament(tourney);
    });

    // Add an ad for Team League, which lets the user press a button in order to 
    // 'tell teamleague set interested 1'
    this.addTeamLeague({
      title: 'Team League',
      date: 'Weekly &ndash; Ongoing',
      description: 'Four to six players band together as a team, and compete weekly in slow time control games.',
      link: 'http://teamleague.org/interested.php'
    });

    this.addOther({
      title: 'Snailbucket',
      date: 'Every few months',
      description: 'Slow and rapid online chess tournaments. Participants play 1 match per week at an agreed upon time.',
      link: 'https://snailbucket.org/wiki/Main_page'
    })

    // Set TourneyInfo and TourneyUpdates td variables to On while Tournaments panel 
    // is showing so that we can update the tournament cards in real time
    awaiting.set('td-set');
    this.session.send('td set tourneyinfo 1');
    awaiting.set('td-set');
    this.session.send('td set tourneyupdates 1');

    // Retrieve the list of running/completed tournaments
    awaiting.set('td-listtourneys');
    this.session.send('td listtourneys');

    // Set KOTHInfo td variable to On while Tournaments panel 
    // is showing so that we can update the KoTH cards in real time
    awaiting.set('td-set');
    this.session.send('td set kothinfo 1');

    // Retrieve the list of available KoTHs
    awaiting.set('td-listkoths');
    this.session.send('td listkoths');
  }

  public leaveTournamentsPane() {
    if(this.session && this.session.isConnected()) {
      // Restore user's original td variables
      if(typeof this.kothReceiveInfo === 'boolean') {
        awaiting.set('td-set');
        this.session.send(`td set kothinfo ${this.kothReceiveInfo ? 'On' : 'Off'}`);
      }
      if(typeof this.tournamentsReceiveInfo === 'boolean') {
        awaiting.set('td-set');
        this.session.send(`td set tourneyinfo ${this.tournamentsReceiveInfo ? 'On' : 'Off'}`);
      }
      // We no longer need to store these, since we've restored the user's variables
      storage.remove('tournaments-receive-info');
      storage.remove('koth-receive-info');
    }
  }

  /**
   * Handle response messages from TD and teamleague
   * @returns true to suppress the console output, false to display it
   */
  public handleMessage(msg: string): boolean {
    let match, pattern;
  
    // Ignore any messages which aren't tournament related
    if(!msg.startsWith(':') && !awaiting.has('get-koth-game') && !awaiting.has('get-private-variable'))
      return false;

    // Update our local copy of the td variables when they get changed
    match = msg.match(/^:Your (\S+) variable has been set to (\S+)./m);
    if(match) {
      this.tdVariables[match[1]] = match[2]; 
      if(awaiting.resolve('td-set'))
        return true;
    }  

    // User has changed the KOTHInfo variable
    match = msg.match(/^:Your KOTHInfo variable has been set to (On|Off)./m);
    if(match) {
      this.kothReceiveInfo = (match[1] === 'On' ? true : false);
      if(!this.kothReceiveInfo) 
        this.kothShowNotifications = false; // Disable notifications, since they require KOTHInfo
      this.updateGroup('koth');
      return false;
    }

    // User has changed their KoTH Female variable
    match = msg.match(/^:Your Female variable has been set to (Yes|No)./m);
    if(match) {
      this.updateGroup('koth');
      return false;
    }

    // Stop this spammy, unnecessary message from displaying
    if(/^:mamer KOTH INFO: The throne of KOTH #\d+, a [^,]+, is still empty./m.test(msg))
      return true;

    // Retrieve and parse user's TD variables
    pattern = ':Variable settings of';
    if((msg.startsWith(pattern) || this.tdMessage.startsWith(pattern)) && awaiting.has('td-variables')) {    
      this.tdMessage += msg + '\n'; // Store partial responses in tdMessage, until we have the whole thing
      if(/^:Language:/m.test(msg)) { // This is the last line in the response, indicating we have it all
        awaiting.resolve('td-variables');
        this.parseTDVariables(this.tdMessage);
        // Update 'Receive Info' checkmarks in the '...' menus 
        this.kothReceiveInfo = (this.tdVariables.KOTHInfo === 'On' ? true : false); 
        this.updateGroup('koth');
        this.tournamentsReceiveInfo = (this.tdVariables.TourneyInfo === 'On' ? true : false); 
        this.updateGroup('tournament');
        this.tdMessage = ''; 
      }
      return true;
    }

    // Detect when a KoTH game ends
    match = msg.match(/^:mamer KOTH INFO: \{KOTH #(\d+) \(\w+ vs. \w+\)/m);
    if(match) {
      const id = +match[1];
      this.updateKoTH(+match[1], {
        game: '-',
        opponent: undefined,
      });
    }

    // Update the King and king stats for KoTH
    match = msg.match(/^:mamer KOTH INFO: ((\S+) is the new (king|queen) of KOTH #(\d+), a [^!]+!)/m);
    if(!match)
      match = msg.match(/^:((\S+), the current (king|queen) of KOTH #(\d+), a [^,]+, defended the title against \S+ and is still the (?:king|queen)!)/m);
    if(match) {
      const king = match[2];
      const id = +match[4];
      removeNotification($(`.notification[data-koth-id="${id}"`));
      if(this.kothShowNotifications && king !== this.session.getUser()) {
        const kingQueenStr = match[3].charAt(0).toUpperCase() + match[3].slice(1);
        const nElement = createNotification({
          type: `Long live the ${kingQueenStr}!`, 
          msg: match[1], 
          btnSuccess: [`td matchking ${id}`, 'Challenge'],
          btnFailure: [`td followking ${id}`, `Follow ${kingQueenStr}`],
          useSessionSend: true,
          icons: false
        });
        nElement.attr('data-koth-id', id);
      }
      this.updateKoTH(id, {
        king,
        kingStats: undefined,
      }, true);
      awaiting.set('td-kingstats');
      this.session.send(`td kingstats ${id}`);
      return false;
    }

    match = msg.match(/^:mamer KOTH INFO: \S+ (?:abdicated|left) as (?:king|queen) of KOTH #(\d+)!/m);
    if(match) {
      const id = +match[1];
      this.updateKoTH(id, {
        king: '-',
        kingStats: undefined,
      }, false);
      return false;
    }

    match = msg.match(/^:mamer KOTH INFO: (\S+), the (?:king|queen) of KOTH #(\d+), has started a game with (\S+)./m);
    if(match) {
      const king = match[1];
      const id = +match[2];
      const opponent = match[3];
      this.updateKoTH(id, {
        king: match[1],
        opponent: match[3],
      });
      return false;
    }

    // Detect when a KoTH game has started and update the panel with the 
    // oppponent and game so it can be Observed.
    if(awaiting.has('get-koth-game')) {
      match = msg.match(/(?:^|\n)\s*(\d+)\s+(?:\(Exam\.\s+)?[0-9\+\-]+\s(\w+)\s+[0-9\+\-]+\s(\w+)\s*(?:\)\s+)?\[[\w\s]+\]\s+[\d:]+\s*\-\s*[\d:]+\s\(\s*\d+\-\s*\d+\)\s+[BW]:\s+\d+\s*\d+ games? displayed/);
      if(match && awaiting.resolve('get-koth-game')) {
        const id = +match[1];
        const player1 = match[2];
        const player2 = match[3];
        const koths = $('[data-tournament-type="koth"]');
        koths.each((index, element) => {
          // Work out which KoTH the game belongs to
          const kothData = $(element).data('tournament-data');
          if((kothData.king === player1 || kothData.king === player2)
            && (kothData.opponent || kothData.game !== '-')) {
            const opponent = kothData.king === player1 ? player2 : player1;
            this.updateKoTH(kothData.id, {
              opponent,
              game: id,
            });
            return false;
          } 
        });
        return true;
      }
    }

    match = msg.match(/^:You (?:will now be|are already) following KOTH #(\d+)./m);
    if(match) {
      const followID = +match[1];
      this.kothFollowKing = followID;
      const koths = $('[data-tournament-type="koth"]');
      koths.each((index, element) => {
        const id = +$(element).attr('data-koth-id');
        this.updateKoTH(id, {
          following: followID === id,
        });        
      });
      return false;
    }

    match = msg.match(/^:You will not follow any KOTH./m);
    if(match) {     
      this.kothFollowKing = null;
      this.updateAllKoTHs({
        following: false,        
      });
      return false;
    }

    // Retrieve and parse the list of KoTHs
    pattern = ':mamer\'s KOTH list:';
    if((msg.startsWith(pattern) || this.tdMessage.startsWith(pattern)) && awaiting.has('td-listkoths')) {
      this.tdMessage += msg + '\n';
      if(/:Total: \d+ KOTHs?/m.test(msg)) { // The last line in the response, indicates we've receive the entire thing
        awaiting.resolve('td-listkoths');
        const koths = this.parseTDListKoTHs(msg);
        koths.forEach(koth => { 
          if(koth.game === '-')
            koth.opponent = null;
          const card = this.addKoTH(koth);
          if(koth.king !== '-') {
            const data = card.data('tournament-data');
            data.kingStats = null;
            awaiting.set('td-kingstats'); // Retrieve the kingstats for the current king
            this.session.send(`td kingstats ${koth.id}`);
          }
          if(koth.game !== '-') {
            awaiting.set('get-koth-game'); // Retrieve the name of the opponent
            this.session.send(`games ${koth.game}`);
          }
        });

        // Remove obsolete cards
        $('.tournament-card[data-tournament-type="koth"').each((index, element) => {
          const data = $(element).data('tournament-data');
          if(!koths.some(k => k.id === data.id))
            $(element).remove();
        });

        this.tdMessage = '';
      }
      return true;
    }

    // Display the KoTH King's winning streak
    match = msg.match(/^:\S+, the king of KOTH #(\d+), has a record of (\d+) (?:victories|victory), (\d+) (?:loss|losses) and (\d+) draws?./m);
    if(match && awaiting.resolve('td-kingstats')) {
      this.updateKoTH(+match[1], {
        kingStats: {
          wins: match[2], 
          losses: match[3], 
          draws: match[4]
        }
      });
      return true;
    }

    // Display our stats when we are the king
    match = msg.match(/^:You have a record of (\d+) (?:victories|victory), (\d+) (?:loss|losses) and (\d+) draws?./);
    if(match && awaiting.resolve('td-kingstats')) {
      const koths = $('[data-tournament-type="koth"]');
      koths.each((index, element) => {
        // First we have to figure out which KoTH we are king of
        const kothData = $(element).data('tournament-data');
        if(kothData.king === this.session.getUser() && !kothData.kingStats) {
          this.updateKoTH(kothData.id, {
            kingStats: {
              wins: match[1], 
              losses: match[2], 
              draws: match[3]
            }
          });
          return false;
        }
      });
      return true;
    }

    match = msg.match(/^:Unable to comply. KOTH #\d+ does not have a king./);
    if(match && awaiting.resolve('td-kingstats')) {
      return true;
    }

    // Display error message if a Guest tries to participate in KoTH or tournaments,
    // or perhaps if the user is banned.
    match = msg.match(/^:Unable to comply. (Access to command (\w+) denied.)/);
    if(match) {
      if(this.session.isRegistered())
        $('#tournaments-pane-status').text(match[1]);
      else {
        const isKoTH = match[2] === 'ClaimThrone' || match[2] === 'MatchKing';
        $('#tournaments-pane-status').html(`<span>You must be registered to participate in ${isKoTH ? 'King of the Hill' : 'Tournaments'}. <a href="https://www.freechess.org/cgi-bin/Register/FICS_register.cgi?Language=English" target="_blank">Register now</a></span>`);  
      }
      $('#tournaments-pane-status').show();
      return false;
    }

    // If we are the King and 'Seek Game', a manual seek is sent. When an offer comes in, we get the variables
    // of the challenger and decline if they have private=1, and auto-accept if they have private=0. This is 
    // because mamer does not allow private KoTH games. 
    pattern = 'Variable settings of';
    if((msg.startsWith(pattern) || this.tdMessage.startsWith(pattern)) && awaiting.has('get-private-variable')) {           
      match = msg.match(/(?:^|\s)private=(\d)/m);
      if(match) {
        // Wait for 'Interface:' portion of response to arrive if it exists
        setTimeout(() => {
          this.tdMessage = '';
          awaiting.resolve('get-private-variable');
        }, 0);

        const priv = match[1];

        const koths = $('[data-tournament-type="koth"]');
        koths.each((index, element) => {
          const kothData = $(element).data('tournament-data');
          if(kothData.offer) {
            if(priv === '1') {
              this.session.send(`decline ${kothData.offer}`);
              kothData.offer = null;
            }
            else if(kothData.seek) 
              this.session.send(`accept ${kothData.offer}`);
            return false;
          }
        });
        this.tdMessage += msg + '\n';
      }
      return true;
    }

    // User has changed their TourneyInfo td variable
    match = msg.match(/^:Your TourneyInfo variable has been set to (On|Off)./m);
    if(match) {
      this.tournamentsReceiveInfo = (match[1] === 'On' ? true : false);
      this.notifyList = {}; // Clear the notify list, since it applies to individual tournaments, but we are overriding it with a global setting change
      if(!this.tournamentsReceiveInfo) 
        this.tournamentsShowNotifications = false; // Disable slide-down notifications, since they depend on TourneyInfo
      this.updateGroup('tournament');
      return false;
    }

    // td ObserveTourney must be set in order to receive Tourney Info or Updates  
    match = msg.match(/^:You are now observing tourney #(\d+)./m);
    if(match && awaiting.resolve('td-observetourney'))
      return true;
    match = msg.match(/^:You are no longer observing tourney #(\d+)./m);
    if(match && awaiting.has('td-observetourney')) {
      this.session.send(`td observetourney ${match[1]}`);
      return true;
    }

    // A tournament has been opened
    match = msg.match(/^:mamer TOURNEY INFO: (\*\*\* (.*?) \*\*\*\n:Tourney #(\d+), a ([^,]+), has been opened!)/m);
    if(match) {
      const title = match[2];
      const id = +match[3];
      const type = match[4];
      const card = this.addTournament({
        id,
        title,
        type,
        running: true,
        joinable: true,
        joined: false,
        status: 'open',
        numPlayers: 0,
        date: null,
      }, true);

      if($('#pills-tournaments').hasClass('active')) {
        awaiting.set('td-observetourney');
        this.session.send(`td observetourney ${id}`); // ObserveTourney must be set in order to receive real time tourney updates
      }

      const data = card.data('tournament-data');
      if(this.tournamentsShowNotifications || data.notify) { // User has asked to receive notifications for all tournaments or this specific tournament
        const nElement = createNotification({
          type: 'Tournament Open', 
          msg: match[1], 
          btnSuccess: [`td jointourney ${id}`, 'Join'],
          btnFailure: ['', 'Not Now'],
          useSessionSend: true,
          icons: false
        });
        nElement.attr('data-tournament-id', id);
      }
      return false;
    }

    // Tournament has started; display 'Standings' and 'Games' buttons
    match = msg.match(/^:mamer TOURNEY (?:INFO|#\d+ UPDATE): Tourney #(\d+) has started!/m);
    if(match) {
      const id = +match[1];
      this.updateTournament(id, {
        status: 'started',
      }, true);
      return false;
    }

    // Tournament has ended
    match = msg.match(/^:mamer TOURNEY (?:INFO|#\d+ UPDATE): (.*?) (?:is|are) the winners? of tourney #(\d+)!/m);
    if(match) {
      const id = +match[2];
      this.updateTournament(id, {
        running: false,
        status: 'done',
        winners: match[1].replace(' and ', ', '),
      }, false);
      this.updateAllTournaments({}); // Update other tournaments to allow the player to join them
      removeNotification($(`.notification[data-tournament-id="${id}"]`));
      return false;
    }

    match = msg.match(/^:mamer TOURNEY (?:INFO|#\d+ UPDATE): Tourney #(\d+) has been aborted!/m);
    if(match) {
      const id = +match[1];
      this.updateTournament(id, {
        running: false,
        status: 'done',
        date: null, // Clear the date to indicate this tournament never happened
      }, false);

      // Retrieve the tournament list in order to display the last time this tournament was held, winner and standings etc
      awaiting.set('td-set');
      this.session.send('td set height 999');
      awaiting.set('td-listtourneys');
      this.session.send('td listtourneys');

      removeNotification($(`.notification[data-tournament-id="${id}"]`));
      return false;
    }

    match = msg.match(/^:You have (?:late-)?joined tourney #(\d+)./m);
    if(match) {
      const id = +match[1];
      this.updateTournament(id, {
        joined: true,
      });
      this.updateAllTournaments({}); // Stop user joining other running tournaments
      removeNotification($(`.notification[data-tournament-id]`));
      return false;
    }
    
    match = msg.match(/^:You withdrew from tourney #(\d+)./m);
    if(match) {
      const id = +match[1];
      this.updateTournament(id, {
        joined: false,
      });
      this.updateAllTournaments({}); // Update other tournaments to allow the player to join them
      return false;
    }

    // Update number of players in the tournament
    match = msg.match(/:mamer TOURNEY (?:INFO|#\d+ UPDATE): \S+ has (?:late-)?joined tourney #(\d+) \(seed: \d+, score: [\d\.]+\); (\d+) players? now!/m);
    if(match) {
      const id = +match[1];
      const numPlayers = +match[2];
      this.updateTournament(id, {
        numPlayers: numPlayers
      });
      return false;
    }

    match = msg.match(/:mamer TOURNEY (?:INFO|#\d+ UPDATE): \S+ withdrew from tourney #(\d+); (\d+) players? now./m);
    if(match) {
      const id = +match[1];
      const numPlayers = +match[2];
      this.updateTournament(id, {
        numPlayers: numPlayers
      });    
      return false;
    }

    // Check when user's game starts
    match = msg.match(/:mamer TOURNEY (?:INFO|#\d+ UPDATE): The game on board #\d+ \((\S+) vs. (\S+?)\) just started/m);
    if(match) {
      const user = this.session.getUser();
      if(match[1] === user || match[2] === user) {
        this.updateAllTournaments({ paired: false });
        removeNotification($('.notification[data-tournament-id]'));
      }
      return false;
    }

    // Retrieve and parse the tournament list (from 'td listtourneys')
    pattern = ':mamer\'s tourney list:';
    if((msg.startsWith(pattern) || this.tdMessage.startsWith(pattern)) && awaiting.has('td-listtourneys')) {
      this.tdMessage += msg + '\n';
      if(/^:Listed: \d+ tourneys?/m.test(msg)) { // The last line in the response, indicates we have received the entire response
        awaiting.resolve('td-listtourneys');
        
        $('.tournament-card[data-tournament-type="tournament"]').each((index, element) => {
          const data = $(element).data('tournament-data');
          data.date = null;
          data.running = false;
        });

        let tourneys = this.parseTDListTourneys(this.tdMessage);
        tourneys = tourneys.filter(tourney => tourney.running || tourney.date); // Remove aborted tourneys

        // Sort the list of tournaments, so that only the latest (or currently running) 
        // iteration of each event is displayed
        tourneys.sort((a, b) => {
          // First: sort running before finished tournaments
          if(a.running !== b.running) 
            return a.running ? -1 : 1;
          
          // Then: sort by date (latest first)
          return b.date.getTime() - a.date.getTime(); 
        });
        tourneys.forEach(tourney => { 
          // First we need the tournament's title in order to match it up with any
          // scheduled tournaments or existing tournament cards. So temporarily store
          // the tournament data until after we call 'td players' or 'standard grid' 
          // which returns the title.
          this.pendingTournaments.push(tourney);
          if(tourney.running) {
            // Tournament is open but not started yet, so there is no standard grid yet, 
            // get players list instead
            awaiting.set('td-players');
            this.session.send(`td players ${tourney.id}`);
            if(tourney.joined && tourney.status === 'started') {
              awaiting.set('td-games');
              this.session.send(`td games ${tourney.id}`);
            }
          }
          else {
            // Tournament has started or has ended, get the standard grid, 
            // so we can display the winner (if there is one)
            awaiting.set('td-standardgrid');
            this.session.send(`td standardgrid ${tourney.id}`);
          }

          if(tourney.running) {
            // Start observing this tourney in order to receive Tourney Updates
            awaiting.set('td-observetourney');
            this.session.send(`td observetourney ${tourney.id}`);
          }
        });

        this.tdMessage = '';
        // We're done, so restore default td line height
        awaiting.set('td-set');
        this.session.send('td set height 24');
      }
      return true;
    }

    // Parse the tournament player list
    // This is also used to match tournament data with current tournament cards 
    // (by matching titles)
    pattern = /^:Tourney #(\d+)'s player list:/m;
    if((pattern.test(msg) || pattern.test(this.tdMessage)) && awaiting.has('td-players')) {
      this.tdMessage += msg + '\n';
      const matchLastLine = msg.match(/:Listed:\s+(\d+) players?./m);
      if(matchLastLine) {
        const numPlayers = +matchLastLine[1];
        awaiting.resolve('td-players');
        const matchIDLine = this.tdMessage.match(pattern);
        const id = +matchIDLine[1];
        const title = this.tdMessage.split(/[\r\n]+/)[0].trim().slice(1); // The title is the first line in the response
        // Check if we have pending tournaments that need to be 
        // matched with existing cards
        for(let i = this.pendingTournaments.length - 1; i >= 0; i--) {
          const pt = this.pendingTournaments[i];
          if(pt.id === id) {
            pt.title = title;
            pt.numPlayers = numPlayers;
            this.addTournament(pt); // Add or update a tournament card
            this.pendingTournaments.splice(i, 1);
          }
        }
        this.updateAllTournaments({}); // This will remove old completed tournaments that are no longer stored or recurring
        // User has clicked the 'Player List' link on a card
        if(awaiting.resolve('tourney-players-dialog')) { 
          const players = this.parseTDPlayers(this.tdMessage);
          const playersModal = $(`<div class="modal fade tournament-players-modal tournament-table-modal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
              <div class="modal-content">
                <div class="modal-header">
                  <h5 class="modal-title">Player List</h5>
                  <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                  <div class="tournament-players tournament-table-container" class="mb-1">
                    <table class="table table-sm table-borderless table-striped modal-table">
                      <thead>
                        <tr>
                          <th scope="col" class="text-end">Seed</th>
                          <th scope="col">Player</th>
                          <th scope="col">Status</th>
                          <th scope="col" class="text-center">Online</th>
                        </tr>
                      </thead>
                      <tbody>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>`);        
          const tbody = playersModal.find('tbody')[0];
          players.forEach(player => {          
            let row = tbody.insertRow();
            let cell = row.insertCell();
            cell.classList.add('text-end');
            cell.innerHTML = `<span class="tournament-table-pos">${player.seed}</span>`;            
          
            cell = row.insertCell();
            cell.innerHTML = `<span class="tournament-table-name clickable-user">${player.name}</span> <span class="tournament-table-rating">(${player.rating})</span>`; 
          
            let statusStr = '';
            if(player.statusSymbol === '%')
              statusStr = 'Requested half-point bye';
            else if(player.statusSymbol === '#')
              statusStr = 'Match request issued';
            else {
              statusStr = player.status;
              if(player.statusSymbol === '.')
                statusStr += ' (Idle)';
            }
            cell = row.insertCell();
            cell.innerHTML = `<span class="tournament-table-status">${statusStr}</span>`;
          
            cell = row.insertCell();
            cell.classList.add('text-center');
            const checkCrossIcon = player.onlineStatus === '-' 
                ? '<i class="fa-solid fa-xmark"></i>'
                : '<i class="fa-solid fa-check"></i>';
            cell.innerHTML = checkCrossIcon;
          });
          
          playersModal.on('hidden.bs.modal', () => playersModal.remove());
          playersModal.appendTo('body').modal('show');        
        }
        this.tdMessage = '';
      }
      return true;
    }

    // Parse the tournament standard grid (standings)
    // This is also used to match tournament data with current tournament cards 
    // (by matching titles)
    pattern = /^:Tourney #(\d+)'s standard grid:/m;
    if((pattern.test(msg) || pattern.test(this.tdMessage)) && awaiting.has('td-standardgrid')) {
      this.tdMessage += msg + '\n';
      const matchLastLine = msg.match(/^:\+-+\+(?![\r\n])/m);
      if(matchLastLine) {
        awaiting.resolve('td-standardgrid');
        const grid = this.parseTDStandardGrid(this.tdMessage);
        const numPlayers = grid.length;
        const matchIDLine = this.tdMessage.match(pattern);
        const id = +matchIDLine[1];
        const title = this.tdMessage.split(/[\r\n]+/)[0].trim().slice(1);
        for(let i = this.pendingTournaments.length - 1; i >= 0; i--) {
          const pt = this.pendingTournaments[i];
          if(pt.id === id) {
            pt.title = title;
            pt.numPlayers = numPlayers;
            if(!pt.running) {
              // Determine and display the winners of the tournament
              const highestScore = Math.max(...grid.map(p => p.score));
              const winners = grid.filter(p => p.score === highestScore);
              const winnerNames = winners.map(p => p.name);
              pt.winners = winnerNames.join(', ');
            }
            this.addTournament(pt);
            this.pendingTournaments.splice(i, 1);
          }
        }
        this.tdMessage = '';
        this.updateAllTournaments({}); // This will remove old completed tournaments that are no longer stored or recurring
        // User has clicked the 'Standings' button or link
        if(awaiting.resolve('tourney-standings-dialog')) {
          // Get date of tournament to display in the title
          let dateStr = '';
          const card = $(`.tournament-card[data-tournament-id="${id}"]`);
          if(card.length) {
            const data = card.data('tournament-data');
            if(data.date) {
              const formatted = data.date.toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'long'
              });
              dateStr = ` (${formatted})`;
            }
          }
          const standingsModal = $(`<div class="modal fade tournament-standings-modal tournament-table-modal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
              <div class="modal-content">
                <div class="modal-header">
                  <h5 class="modal-title">Standings${dateStr}</h5>
                  <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                  <div class="tournament-standings tournament-table-container" class="mb-1">
                    <table class="table table-sm table-borderless table-striped modal-table">
                      <thead>
                        <tr>
                          <th scope="col" class="text-end">Pos</th>
                          <th scope="col">Player</th>
                          <th scope="col" class="text-end">Score</th>
                        </tr>
                      </thead>
                      <tbody>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>`);
          const numRounds = grid[0] ? grid[0].rounds.length : 0;
          const header = standingsModal.find('thead tr');
          for(let i = 1; i <= numRounds; i++) 
            header.append(`<th scope="col">Round ${i}</th>`);
          
          const tbody = standingsModal.find('tbody')[0];

          // Display the position of each player by score
          let lastScore = 0;
          let position = 1;
          grid.forEach(player => {
            let posStr = '';
            if(player.score !== lastScore) { // If score is the same as previous player don't display their position
              posStr = position.toString();
              lastScore = player.score;
            }
            position++;
            
            let row = tbody.insertRow();
            let cell = row.insertCell();
            cell.classList.add('text-end');
            cell.innerHTML = `<span class="tournament-table-pos">${posStr}</span>`;            
          
            cell = row.insertCell();
            cell.innerHTML = `<span class="tournament-table-name clickable-user">${player.name}</span> <span class="tournament-table-rating">(${player.rating})</span>  <span class="tournament-table-seed">[${player.seed}]</span>`; 
            cell = row.insertCell();
            cell.classList.add('text-end');
            cell.innerHTML = `<span class="tournament-table-score">${player.score}</span>`;
            player.rounds.forEach(round => {
              // Use different class for win, loss or draw, so they can be displayed in different colors
              let resultClass = '';              
              if(round.result === '+')
                resultClass = 'win';
              else if(round.result === '-')
                resultClass = 'loss';
              else if(round.result === '=')
                resultClass = 'draw';
              else
                resultClass = 'other-result';
                
              let roundStr = '';  
              if(Number.isInteger(+round.opponent)) {
                // If opponent string is a seed number, find and display the opponent by name
                const opponent = grid.find(p => p.seed === +round.opponent);
                roundStr = `<span class="tournament-table-result tournament-table-${resultClass}">${round.result}</span>  <span class="tournament-table-name">${opponent.name}</span> <span class="tournament-table-rating">(${opponent.rating})</span>  <span class="tournament-table-color">${round.color}</span>`;
              }
              else
                roundStr = `<span class="tournament-table-${resultClass}">${round.result}</span>  <span class="tournament-table-name">${round.opponent}</span>`;

              const cell = row.insertCell();
              cell.innerHTML = roundStr;
            }); 
          });
          
          standingsModal.on('hidden.bs.modal', () => standingsModal.remove());
          standingsModal.appendTo('body').modal('show');        
        }
      }
      return true;
    }

    // Parse the game list for the current round
    pattern = /^:Tourney #(\d+)'s round (\S+) games:/m;
    if((pattern.test(msg) || pattern.test(this.tdMessage))) {
      const wasAwaiting = awaiting.has('td-games');
      this.tdMessage += msg + '\n';
      const matchLastLine = msg.match(/:Listed:\s+\d+ games?./m);
      if(matchLastLine) {
        awaiting.resolve('td-games');
        let matchLine = this.tdMessage.match(pattern);
        const id = +matchLine[1];
        const round = matchLine[2];
        const title = this.tdMessage.split(/[\r\n]+/)[0].trim().slice(1);
        matchLine = this.tdMessage.match(/:Byes: (.*)/m);
        const byes = matchLine ? matchLine[1] : '';
        const games = this.parseTDGames(this.tdMessage);
        const pairing = games.find(game => 
          // User has been paired for their next match but hasn't yet started their game
          game.result?.startsWith('-') && (game.whiteName === this.session.getUser() 
              || game.blackName === this.session.getUser())
        );
        this.updateTournament(id, { paired: !!pairing });
        if(awaiting.resolve('tourney-games-dialog')) {
          const gamesModal = $(`<div class="modal fade tournament-games-modal tournament-table-modal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
              <div class="modal-content">
                <div class="modal-header">
                  <h5 class="modal-title">Games for round ${round}</h5>
                  <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                  <div class="tournament-games tournament-table-container" class="mb-1">
                    <table class="table table-sm table-borderless table-striped modal-table">
                      <thead>
                        <tr>
                          <th scope="col" class="text-end">Board</th>
                          <th scope="col">White</th>
                          <th scope="col">Black</th>
                          <th scope="col" class="text-center">Game / Result</th>
                        </tr>
                      </thead>
                      <tbody>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>`);        
          const tbody = gamesModal.find('tbody')[0];
          games.forEach(game => {          
            let row = tbody.insertRow();
            let cell = row.insertCell();
            cell.classList.add('text-end');
            cell.innerHTML = `<span class="tournament-table-pos">${game.board}</span>`;            
          
            cell = row.insertCell();
            cell.innerHTML = `<span class="tournament-table-name">${game.whiteName}</span>  <span class="tournament-table-seed">[${game.whiteSeed}]</span>`;
            cell = row.insertCell();
            cell.innerHTML = `<span class="tournament-table-name">${game.blackName}</span>  <span class="tournament-table-seed">[${game.blackSeed}]</span>`;

            // Display the game # and an 'Observe' for games in progress
            const obsGameStr = game.gameID && game.whiteName !== this.session.getUser() && game.blackName !== this.session.getUser()
                ? `  <a href="javascript:void(0)" onClick="sessionSend('obs ${game.gameID.slice(1)}')">Observe</a>` 
                : ''; 
            cell = row.insertCell();
            cell.classList.add('text-center');
            cell.innerHTML = `<span class="tournament-table-result">${game.gameID || game.result}${obsGameStr}</span>`;       
          });

          if(byes) 
            gamesModal.find('.modal-body').append(`<div class="mt-1" style="white-space: pre-wrap"><span class="tournament-card-label">Byes:</span>  ${byes}</div>`);
          
          gamesModal.on('hidden.bs.modal', () => gamesModal.remove());
          gamesModal.appendTo('body').modal('show');        
        }
        else if(pairing && !wasAwaiting && !$(`.notification[data-tournament-id="${id}"]`).length) {
          const color = (pairing.whiteName === this.session.getUser() ? 'white' : 'black');
          const opponent = (pairing.whiteName === this.session.getUser() ? pairing.blackName : pairing.whiteName);
          const nElement = createNotification({
            type: 'Play Next Game',
            msg: `You play ${color} against ${opponent} in this round of tourney #${id}.`,
            btnSuccess: [`td play ${id}`, 'Play Game'],
            btnFailure: ['', 'Not Now'],
            useSessionSend: true,
            icons: false
          });
          nElement.attr('data-tournament-id', id);
        }
        this.tdMessage = '';
      }
      return wasAwaiting;
    }

    // Update the Team League panel's 'I'm Interested!' button when
    // 'tell teamleague set interested 0|1' is sent
    match = msg.match(/^:You are now (not )?listed on the interested players list./m);
    if(match) {
      const interested = !match[1];
      storage.set('teamleague-interested', String(interested));
      this.addTeamLeague({ interested });
      return false;
    }
  }
  
  /**
   * Parse and store 'td variables'. Mainly used to store the user's
   * TourneyInfo, TourneyUpdates and KOTHInfo variables. We set these variables
   * to 'On' when the Tournaments tab is showing and set them back to the user's 
   * preference when they leave the Tournaments tab
   */
  public parseTDVariables(msg: string) {
    const lines = msg.split(/[\r\n]+/);
    lines.forEach((line) => {
      const match = line.match(/^:(\w+):\s+(\S+)/);
      if(match)
        this.tdVariables[match[1]] = match[2];
    });
  }

  /** 
   * Parse 'td listkoths' 
   */
  public parseTDListKoTHs(msg: string): any[] {
    const lines = msg.split(/[\r\n]+/);
    const koths: any = [];
    lines.forEach((line) => {
      const match = line.match(/^:\|\s+(\d+)\s+\|\s+(\S+)\s+\|\s+(.*?)\s+\|\s+(\S+)\s+\|\s+(\S+)\s+\|/);
      if(match) {
        const koth = {
          id: +match[1],
          open: match[2] === 'Yes',
          type: match[3],
          king: match[4],
          game: match[5],
        }
        koths.push(koth);
      }
    });
    return koths;
  }

  /**
   * Parse 'td listtourneys'
   */
  public parseTDListTourneys(msg: string): any[] {
    const lines = msg.split(/[\r\n]+/);
    const tourneys: any = [];
    lines.forEach((line) => {
      const match = line.match(/^:\|\s+(\d+)\s+\|\s+([>+]*)(\w+)([<*]*)\s+\|\s+(\w+)\s+\|\s+(.*?)\s+\|\s+(-+|(\d{4})\.(\d{2})(\d{2})\.(\d{2})(\d{2}))\s+\|/);
      if(match) {
        const dateTime = match[7].startsWith('-') ? null : {
          year: match[8],
          month: match[9],
          day: match[10],
          hour: match[11],
          minute: match[12],
        };

        const tourney = {
          id: +match[1],
          joined: match[2] === '>',
          joinable: match[2] === '+',
          status: match[3],
          running: match[4] === '<',
          manager: match[5],
          type: match[6],
          date: dateTime ? parseDate(dateTime, true) : null,
        }
        tourneys.push(tourney);
      }
    });
    return tourneys;
  }  

  /**
   * Parse 'td players <tourney id>' 
   */
  public parseTDPlayers(msg: string) {
    const lines = msg.split(/[\r\n]+/);
    const players: any = [];
    lines.forEach((line) => {
      const match = line.match(/^:\|\s+(\d+)\s+\|\s+([^\w\s])(\w+(?:\(\w+\))?)\(\s*([\d\-\+]+)\)\s+\|\s+([^\w\s])?(\w+)\s+\|/);
      if(match) {
        players.push({
          seed: match[1],
          onlineStatus: match[2],
          name: match[3],
          rating: match[4],
          statusSymbol: match[5],
          status: match[6],
        });
      }
    });
    return players;
  }

  /**
   * Parse 'td standardgrid <tourney #>'
   */
  public parseTDStandardGrid(msg: string) {
    const lines = msg.split(/[\r\n]+/);
    const players: any = [];
    lines.forEach((line) => {
      const match = line.match(/^:\|\s+(\d+)\s+\|\s+([^\w\s])(\w+(?:\(\w+\))?)\(\s*([\d\-\+]+)\)\s+\|\s+(.*?)\s+\|/);
      if(match) {
        const roundStrings = match[5].split(/\s+/);
        const rounds = roundStrings.map(str => {
          const match = str.match(/^(\S)([\d\w\-]+?)([wb])?$/);
          if(match) {
            return {
              result: match[1],
              opponent: match[2],
              color: match[3]
            }
          }
        });

        // Calculate the score for each player
        const score = rounds.reduce((acc, round) => {
          if(round.result === '+')
            return acc + 1;
          else if(round.result === '=')
            return acc + 0.5;
          else
            return acc;
        }, 0);

        players.push({
          seed: +match[1],
          onlineStatus: match[2],
          name: match[3],
          rating: match[4],
          rounds,
          score,
        });
      }
    });
    players.sort((a, b) => {
      if (b.score !== a.score) 
        return b.score - a.score; // Descending by score
      else 
        return a.seed - b.seed; // Ascending by seed if scores tie
    });
    return players;
  }

  /**
   * Parse 'td games <tourney #>'
   */
  public parseTDGames(msg: string) {
    const lines = msg.split(/[\r\n]+/);
    const games: any = [];
    lines.forEach((line) => {
      const match = line.match(/^:\|\s+(\d+)\s+\|\s+([^\w\s])(\w+)\[(\d+)\](\(\w+\))?\s+\|\s+([^\w\s])(\w+)\[(\d+)\](\(\w+\))?\s+\|\s+(\S+)\s+\|/);
      if(match) {
        games.push({
          board: match[1],
          whiteStatus: match[2],
          whiteName: `${match[3]}${match[5] || ''}`,
          whiteSeed: match[4],
          blackStatus: match[6],
          blackName: `${match[7]}${match[9] || ''}`,
          blackSeed: match[8],
          ...(match[10].startsWith('#') && { gameID: match[10] }),
          ...(!match[10].startsWith('#') && { result: match[10] }),
        });
      }
    });
    return games;
  }

  /**
   * Adds a new tournament card or updates the state of a tournament card
   * @param data The properties to add/update
   * @param alert Whether to alert or stop alerting the user to a state change
   * @returns The tournament card
   */
  public addTournament(data: any, alert?: boolean) {
    this.updateAlerts(data.id, alert); // Add or remove this tournament from the alert list

    let card = null;
    if(data.title) // Find the tournament card based on the title
      card = $(`.tournament-card[data-tournament-title="${data.title}"]`);
    else if(data.id) // Find the tournament card based on id
      card = $(`.tournament-card[data-tournament-id="${data.id}"]`);
    if(!card || !card.length) { // No match so create new card
      card = $(`
        <div class="card tournament-card" data-tournament-type="tournament">
          <div class="card-body">
            <div class="d-flex">
              <div class="flex-grow-1 pe-2" style="min-width: 0;">
                <div class="tournament-title" style="font-weight: bold;"></div>
                <div class="tournament-type" style="white-space: pre-wrap;"></div>
                <div class="tournament-date" style="white-space: pre-wrap;"></div>
                <div class="tournament-num-players" style="white-space: pre-wrap;"></div>
              </div>
              <div class="d-flex" style="justify-content: end; align-items: center">
                <div class="btn-group-vertical" style="gap: 10px">
                  <button type="button" class="btn btn-outline-secondary btn-md tournament-notify" title="Notify Me" style="display: none; white-space: nowrap;">Notify Me</button>
                  <button type="button" class="btn btn-outline-secondary btn-md tournament-unnotify" title="Stop Notifying" style="display: none; white-space: nowrap;">Stop Notifying</button>
                  <button type="button" class="btn btn-outline-secondary btn-md tournament-join" title="Join" style="display: none; white-space: nowrap;">Join</button>
                  <button type="button" class="btn btn-outline-secondary btn-md tournament-play-game" title="Play Game" style="display: none; white-space: nowrap;">Play Game</button>
                  <button type="button" class="btn btn-outline-secondary btn-md tournament-games" title="Games" style="display: none; white-space: nowrap;">Games</button>
                  <button type="button" class="btn btn-outline-secondary btn-md tournament-standings-button" title="Standings" style="display: none; white-space: nowrap;">Standings</button>
                  <button type="button" class="btn btn-outline-secondary btn-md tournament-withdraw" title="Withdraw" style="display: none; white-space: nowrap;">Withdraw</button>
                  </div>
              </div>
            </div>
            <div class="tournament-winners" style="white-space: pre-wrap;"></div>
          </div>
        </div>
      `);
      card.data('tournament-data', {}); // Stores the tournament state

      /** 'Notify Me' or 'Stop Notifying' button */
      card.find('.tournament-notify, .tournament-unnotify').on('click', (e) => {
        const tourney = card.data('tournament-data');
        const notify = $(e.target).hasClass('tournament-notify');
        if(notify) 
          this.tournamentsReceiveInfo = true; // Notifications require 'td TourneyInfo On'

        this.notifyList[tourney.title] = notify;
        this.updateGroup('tournament');
      });

      /** 'Player List' link */
      card.on('click', '.tournament-players-link', () => {
        if(awaiting.has('tourney-players-dialog')) // Players modal already displaying
          return;

        const tourney = card.data('tournament-data');
        awaiting.set('td-players');
        awaiting.set('tourney-players-dialog');
        this.session.send(`td players ${tourney.id}`);
      });

      /** 'Standings' button or link */
      card.on('click', '.tournament-standings-button, .tournament-standings-link', () => {
        if(awaiting.has('tourney-standings-dialog'))
          return;

        const tourney = card.data('tournament-data');
        awaiting.set('td-standardgrid');
        awaiting.set('tourney-standings-dialog');
        this.session.send(`td standardgrid ${tourney.id}`);
      });

      /** 'Games' button */
      card.find('.tournament-games').on('click', () => {
        if(awaiting.has('td-games'))
          return;

        const tourney = card.data('tournament-data');
        awaiting.set('td-games');
        awaiting.set('tourney-games-dialog');
        this.session.send(`td games ${tourney.id}`);
      });

      /** 'Join' button */
      card.find('.tournament-join').on('click', () => {
        const tourney = card.data('tournament-data');
        this.session.send(`td join ${tourney.id}`);
        this.session.send('+ch 49'); // Subscribe user to Mamer Tournament channel
      });

      /** 'Withdraw' button */
      card.find('.tournament-withdraw').on('click', () => {
        const tourney = card.data('tournament-data');
        const headerTitle = 'Withdraw from Tournament';
        const bodyText = 'Really withdraw?';
        const button1 = [`td withdraw ${tourney.id}`, 'OK'];
        const button2 = ['', 'Cancel'];
        const showIcons = true;
        showFixedDialog({type: headerTitle, msg: bodyText, btnFailure: button2, btnSuccess: button1, icons: showIcons, useSessionSend: true});
      });

      /** 'Play Game' button */
      card.find('.tournament-play-game').on('click', () => {
        const tourney = card.data('tournament-data');
        this.session.send(`td play ${tourney.id}`);
        removeNotification($('.notification[data-tournament-id]'));
      });
    }

    const tourney = card.data('tournament-data');

    // If this edition of the tournament is older than the one already 
    // stored/displayed then ignore it, Exception: if we are explicitely requesting 
    // an update.
    if(data.date) {
      const tourneyDate = tourney.date 
          ? (new Date(tourney.date)).setHours(0, 0, 0, 0)
          : 0;
      const dataDate = (new Date(data.date)).setHours(0, 0, 0, 0);
      if(!data.running && (tourney.running || dataDate - tourneyDate < 0))
        return; 
    }
    
    // Update the tourney state with the new data
    Object.assign(tourney, data);

    // Update the tournament id if it changes
    if(tourney.id != null)
      card.attr('data-tournament-id', tourney.id);

    if(!tourney.running) {
      tourney.joinable = false;
      tourney.joined = false;
    }

    // If the user has joined another tournament, stop them joining this one
    // (user can only be in one tournament at a time)
    const inTournament = $('[data-tournament-type="tournament"]').toArray().some(card => {
      const data = $(card).data('tournament-data');
      return data.joined === true;
    });

    // Change the styling of the tournament card if it's running (active)
    card.toggleClass('tournament-card-active', tourney.running); 

    if(tourney.title) {
      tourney.notify = this.notifyList[tourney.title]; // update this touranemnt's notify property from the settings stored in localstorage

      card.attr('data-tournament-title', tourney.title);
      const [title, time] = tourney.title.split(/ at ([:\d]+)$/).filter(Boolean); // Remove the time from the tournament title (we display it under when: instead)
      tourney.scheduledTime = time;
      card.find('.tournament-title').text(`${title}`);
    }

    let type = tourney.type; // e.g. 5 0 r SS/5
    const typeMatch = tourney.type.split(/(.*)?\s+(\w+)\\(\d+)/);
    if(typeMatch) {
      const timeRating = typeMatch[1];
      let style = typeMatch[2];
      const rounds = typeMatch[3];
      if(style === 'SS')
        style = 'Swiss System';
      else if(style === 'RR')
        style = 'Round Robin';
      else if(style === 'Din')
        style = 'Dinamo';
      type = `${timeRating}  &ndash;  ${style}, ${rounds} Rounds`;
    }
    const typeStr = `<span class="tournament-card-label">Type:</span>  ${type}`; 
    card.find('.tournament-type').html(typeStr);
    
    /** Date/Time conversions **/

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let dateStr = '';
    let serverDT: any, nextDT: Date, lastDT: Date;
    const now = new Date();

    // For completed tournaments, we get the date in server time from 'listtourneys'
    // and convert it to local time. For running, non-recurring tournaments, we 
    // just use the time the tournament card was created.
    if(!tourney.date && tourney.running) 
      tourney.date = new Date();
    lastDT = tourney.date;

    // For recurring tournaments, e.g. daily / every tuesday etc, we first determine
    // the date the tournament will next be held in FICS server time, then we add
    // the scheduled time HH:MM and convert the whole thing back to the user's
    // local time. 
    if(tourney.recurring === 'daily' || weekdays.includes(tourney.recurring)) {
      serverDT = convertToServerDate(now);
      if(weekdays.includes(tourney.recurring))
        serverDT = getNextWeekDayDate(serverDT, tourney.recurring);
      if(tourney.scheduledTime) {
        serverDT.setHours(tourney.scheduledTime.split(':')[0]);
        serverDT.setMinutes(tourney.scheduledTime.split(':')[1]);
      }
      nextDT = convertToLocalDate(serverDT);
    }
    else if(tourney.running || (lastDT && lastDT.getTime() - Date.now() > 0)) 
      nextDT = lastDT; // A running or future tournament (non-recurring)

    /** 
     * Note: Recurring tournaments have both a nextDT and lastDT.
     * nextDT is the date of the next scheduled tournament.
     * lastDT is the date the last edition was held. 
     */

    const currentDT = nextDT || lastDT;

    // Remove tournament if it has no date, i.e. it was aborted or wasn't stored
    // after finishing.
    if(!currentDT) {
      card.remove();
      return;
    } 

    tourney.timestamp = currentDT.getTime(); // timestamp is used for ordering cards in the Tournaments panel

    // Display the date time in a 'relative' way, e.g. if the date is tomorrow display
    // 'Tomorrow', or if the date is next Tuesday display 'Tue' etc.
    if(tourney.recurring === 'daily')
      dateStr = 'Every day';
    else if(weekdays.includes(tourney.recurring))
      dateStr = weekdays[currentDT.getDay()];
    else
      dateStr = this.formatDateRelative(currentDT);
    const timeStr = currentDT.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    
    let whenStr = '';
    if(!tourney.recurring && tourney.running) 
      whenStr = '<span class="tournament-card-label">When:</span>  Now';
    else
      whenStr = `<span class="tournament-card-label">${nextDT ? 'When:' : 'Last Held:'}</span>  ${dateStr}, ${timeStr} <i class="chat-text-suffix">(local time)</i>`;
        
    card.find('.tournament-date').html(whenStr);
    
    // Display the number of players and a 'Player List' link which opens the Player List modal
    const numPlayersStr = tourney.numPlayers != null && tourney.running
        ? `<span class="tournament-card-label">Num of Players:</span>  ${tourney.numPlayers}${tourney.numPlayers > 0 ? '  <a class="tournament-players-link" href="javascript:void(0)">(Player List)</a>' : ''}`
        : '';
    card.find('.tournament-num-players').html(numPlayersStr);
    
    // Get the time in hours since the last edition of the tournament finished
    // This is just for minor differences in how the tournament is displayed, based on
    // whether it is still considered 'current', i.e. just finished or 'previous'
    // older than a few hours. 
    const ageInHours = lastDT ? (Date.now() - lastDT.getTime()) / (60 * 60 * 1000) : undefined;
    if(tourney.running)
      tourney.winners = '';
    // Display the winners of the last held edition
    const wrappedWinners = tourney.winners 
      ? tourney.winners
        .split(/\s*,\s*/)            
        .map(name => `<span class="clickable-user">${name}</span>`) 
        .join(', ')
      : '';
    const winnersStr = wrappedWinners
        ? `<span class="tournament-card-label">${ageInHours < 3 ? 'Winner' : 'Last Winner'}${wrappedWinners.includes(',') ? 's' : ''}:</span>  ${wrappedWinners}  <a class="tournament-standings-link" href="javascript:void(0)">(Standings)</a>`
        : '';
    card.find('.tournament-winners').html(winnersStr);

    // Show or hide buttons on the tournament card based on the current tournament 
    // state or user settings
    const notify = tourney.notify === true || (tourney.notify !== false && this.tournamentsShowNotifications);
    card.find('.tournament-notify').toggle(!tourney.running && !!nextDT && !notify);
    card.find('.tournament-unnotify').toggle(!tourney.running && !!nextDT && notify);
    card.find('.tournament-join').toggle(!!tourney.joinable && !inTournament);
    card.find('.tournament-play-game').toggle(!!tourney.paired && !!tourney.running && tourney.status === 'started');
    card.find('.tournament-games').toggle(!!tourney.running && tourney.status === 'started');
    card.find('.tournament-standings-button').toggle(!!tourney.running && tourney.status === 'started');
    card.find('.tournament-withdraw').toggle(!!tourney.joined);
    
    // Add the tournament card to the panel (if not there already)
    this.addTournamentCard(card, 'tournament');

    return card;
  }

  /**
   * Update the state of an existing tournament card. If 'id' is null,
   * then the card is identified by data.title.
   * @param id The id # of the tournament 
   * @param data New state properties 
   * @param alert If true, the user will be alerted to the change, 
   * if false, any prior alerts associated with the card will be removed.
   */
  public updateTournament(id: number, data: any, alert?: boolean) {
    let card;
    if(id != null) {
      data.id = id;
      card = $(`.tournament-card[data-tournament-id="${id}"]`);
    }
    else if(data.title) 
      card = $(`.tournament-card[data-tournament-title="${data.title}"]`);
    
    if(card && card.length) 
      this.addTournament(data, alert);
  }

  /**
   * Update all tournament cards with the given state.
   * @param data New state properties
   * @param alert If true, the user will be alerted to the change, 
   * if false, any prior alerts associated with the card will be removed.
   */
  public updateAllTournaments(data: any, alert?: boolean) {
    const tourneys = $('[data-tournament-type="tournament"]');
    tourneys.each((index, element) => {
      const tourneyData = $(element).data('tournament-data');
      data.title = tourneyData.title; // Cards will be matched based on title
      this.updateTournament(null, data, alert);
    });  
  }

  /**
   * Adds a new King of the Hill card or updates the state of an existing card
   * @param data The properties to add/update
   * @param alert Whether to alert or stop alerting the user to a state change
   * @returns The KoTH card
   */
  public addKoTH(data: any, alert?: boolean) {
    this.updateAlerts(data.id, alert); // Add or remove this KoTH from the alert list

    let card = $(`.tournament-card[data-koth-id="${data.id}"]`);
    if(!card.length) {
      card = $(`
        <div class="card tournament-card koth-card" data-tournament-type="koth" data-koth-id="${data.id}">
          <div class="card-body d-flex">
            <div class="flex-grow-1 pe-2" style="min-width: 0;">
              <div class="koth-title" style="font-weight: bold;"></div>
              <div class="koth-king" style="white-space: pre;"></div>
              <div class="koth-king-stats" style="white-space: pre;"></div>
              <div class="koth-challenger" style="white-space: pre;"></div>
            </div>
            <div class="d-flex" style="justify-content: end; align-items: center">
              <div class="btn-group-vertical" style="gap: 10px">
                <button type="button" class="btn btn-outline-secondary btn-md koth-claim-throne" title="Claim Throne" style="display: none" onclick="sessionSend('td claimthrone ${data.id}')">Claim Throne</button>
                <button type="button" class="btn btn-outline-secondary btn-md koth-seek" title="Seek Game" style="display: none" onclick="sessionSend('seek ${data.type} m')">Seek Game</button>
                <button type="button" class="btn btn-outline-secondary btn-md koth-unseek" title="Stop Seeking" style="display: none">Stop Seeking</button>
                <button type="button" class="btn btn-outline-secondary btn-md koth-abdicate" title="Abdicate" style="display: none">Abdicate</button>
                <button type="button" class="btn btn-outline-secondary btn-md koth-challenge" title="Challenge" style="display: none" onclick="sessionSend('td matchking ${data.id}')">Challenge</button>
                <button type="button" class="btn btn-outline-secondary btn-md koth-withdraw" title="Withdraw" style="display: none"">Withdraw</button>
                <button type="button" class="btn btn-outline-secondary btn-md koth-watch" title="Watch" style="display: none" onclick="sessionSend('td observekoth ${data.id}')">Observe</button>
                <button type="button" class="btn btn-outline-secondary btn-md koth-follow" title="Follow" style="display: none" onclick="sessionSend('td followking ${data.id}')">Follow King</button>
                <button type="button" class="btn btn-outline-secondary btn-md koth-unfollow" title="Unfollow" style="display: none" onclick="sessionSend('td followking')">Unfollow King</button>
              </div>
            </div>
          </div>
        </div>
      `);
      card.data('tournament-data', {});
      this.addTournamentCard(card, 'koth');

      card.on('click', '.koth-abdicate', () => {
        const data = card.data('tournament-data');
        this.session.send(`td abdicate ${data.id}`);
        if(data.seek != null) 
          this.session.send(`unseek ${data.seek}`);
      });
    }

    const koth = card.data('tournament-data');
    Object.assign(koth, data);
   
    if(koth.game !== '-' || koth.king === '-') 
      koth.challenge = koth.seek = undefined;
   
    const gameInProgress = !!koth.opponent || koth.game !== '-';
    const user = this.session.getUser();

    // Change styling of card to show it's active when there is currently a king
    card.toggleClass('tournament-card-active', koth.king !== '-'); 

    koth.title = `KoTH ${koth.type}`;
    card.find('.koth-title').text(koth.title);
    const isFemale = this.tdVariables.Female === 'Yes';
    const kingStr = `<span class="tournament-card-label">The ${isFemale ? 'Queen' : 'King'}:</span>  ${koth.king !== '-' ? `<i class="fa-solid fa-crown"></i> <span class="clickable-user">${koth.king}</span>` : '-'}`; 
    card.find('.koth-king').html(kingStr);
    
    if(koth.king === '-')
      koth.kingStats = null;

    const kingStats = koth.kingStats;
    const kingStatsStr = kingStats 
        ? `<span class="tournament-card-label">Streak:</span>  ${kingStats.wins} wins, ${kingStats.draws} draws`
        : '';
    card.find('.koth-king-stats').html(kingStatsStr);
    const challengerStr = koth.opponent 
        ? `<span class="tournament-card-label">Challenger:</span>  ${koth.opponent}`
        : ''; 
    card.find('.koth-challenger').html(challengerStr);
    card.find('.koth-claim-throne').toggle(koth.open && koth.king === '-');
    card.find('.koth-seek').toggle(koth.king === user && !gameInProgress && !koth.seek);
    if(koth.seek)
      card.find('.koth-unseek').attr('onclick', `sessionSend('unseek ${koth.seek}')`);
    card.find('.koth-unseek').toggle(koth.king === user && !gameInProgress && !!koth.seek);
    card.find('.koth-abdicate').toggle(koth.king === user && !gameInProgress);
    card.find('.koth-challenge').toggle(koth.open && koth.king !== '-' && !gameInProgress && koth.king !== user && koth.challenge === undefined);
    card.find('.koth-withdraw').attr('onclick', `sessionSend('withdraw ${koth.challenge}')`);
    card.find('.koth-withdraw').toggle(koth.open && koth.king !== '-' && !gameInProgress && koth.king !== user && koth.challenge !== undefined);
    card.find('.koth-watch').toggle(gameInProgress && koth.king !== user && koth.opponent !== user);
    card.find('.koth-follow').toggle(koth.king !== '-' && koth.king !== user && !koth.following);
    card.find('.koth-unfollow').toggle(koth.king !== '-' && koth.king !== user && !!koth.following);
  
    return card;
  }

  /**
   * Update the state of an existing KoTH card. 
   * @param id The id # of the KoTH
   * @param data New state properties 
   * @param alert If true, the user will be alerted to the change, 
   * if false, any prior alerts associated with the card will be removed.
   */
  public updateKoTH(id: number, data: any, alert?: boolean) {
    const card = $(`.koth-card[data-koth-id="${id}"]`);
    if(card.length) {
      data.id = id;
      this.addKoTH(data, alert);
    }

    this.updateKoTHNotification(id, data); // Add or remove buttons to open slide-down notifications
  }

  /**
   * Update any open slide-down notifications to reflect the KoTH state.
   * E.g. remove 'Challenge' button if the King is currently in a match.
   */
  public updateKoTHNotification(id: number, data: any) {
    const nElement = $(`.notification[data-koth-id="${id}"`);
    if(!nElement.length)
      return;

    const challengeBtn = nElement.find('.button-success');
    const followBtn = nElement.find('.button-failure');

    if(data.king === '-' || data.opponent === this.session.getUser()
        || data.following || data.challenge) {
      removeNotification(nElement);
      return;
    }

    if(data.hasOwnProperty('opponent'))
      challengeBtn.toggle(!data.opponent && this.session.isRegistered());
    followBtn.toggle(this.kothFollowKing !== id);
  }

  /**
   * Update all KoTH cards with the given state.
   * @param data New state properties
   * @param alert If true, the user will be alerted to the change, 
   * if false, any prior alerts associated with the card will be removed.
   */
  public updateAllKoTHs(data: any, alert?: boolean) {
    const koths = $('[data-tournament-type="koth"]');
    koths.each((index, element) => {
      const kothData = $(element).data('tournament-data');
      this.updateKoTH(kothData.id, data, alert);
    });
  }

  /** 
   * Add an ad for Team League, with an 'I'm Interested!' which sends
   * 'tell teamleague set interested 1' and also sends an auto message expressing
   * interest to ch 101.
   */
  addTeamLeague(data: any) {
    let card = $(`[data-tournament-type="teamleague"]`);
    if(!card.length) {
      card = $(`
        <div class="card tournament-card" data-tournament-type="teamleague">
          <div class="card-body d-flex">
            <div class="flex-grow-1 pe-3" style="min-width: 0;">
              <div class="tournament-title" style="font-weight: bold;"></div>
              <div class="mt-1 tournament-date" style="white-space: pre-wrap;"></div>
              <div class="mt-1 tournament-description" style="white-space: pre-wrap;"></div>
            </div>
            <div class="d-flex" style="justify-content: end; align-items: center">
              <div class="btn-group-vertical" style="gap: 10px">
                <button type="button" class="btn btn-outline-secondary btn-md tournament-interested" title="I'm Interested!" style="display: none; white-space: nowrap;">I'm Interested!</button>
                <button type="button" class="btn btn-outline-secondary btn-md tournament-uninterested" title="Stop Interest" style="display: none; white-space: nowrap;">Remove Interest</button>
              </div>
            </div>
          </div>
        </div>
      `);

      /** 'I'm Interested!' / 'Stop Interest' buttons */
      card.find('.tournament-interested, .tournament-uninterested').on('click', (e) => {
        const data = card.data('tournament-data');
        const interested = !data.interested;
        if(interested) {
          this.session.send('t teamleague join');
          this.session.send('t teamleague set interested 1');
          // Send auto-message
          this.session.send('+ch 101');
          this.session.send('t 101 (Auto Message) I\'m interested in joining Team League. Please tell me how to get invovlved.');
        }
        else
          this.session.send('t teamleague set interested 0');
      });

      card.data('tournament-data', {});
      this.addTournamentCard(card, 'other');
    }

    const tl = card.data('tournament-data');

    // Save the interested / not interested state for future logins
    tl.interested = storage.get('teamleague-interested') === 'true';

    Object.assign(tl, data);

    card.find('.tournament-title').text(tl.title);
    const linkStr = tl.link ? `  <a href="${tl.link}" target="_blank" style="white-space: nowrap;">More Info</a>` : '';
    card.find('.tournament-description').html(`${tl.description}${linkStr}`);  
    const whenStr = `<span class="tournament-card-label">When:</span>  ${tl.date}`;
    card.find('.tournament-date').html(whenStr);  
    
    card.find('.tournament-interested').toggle(!tl.interested);
    card.find('.tournament-uninterested').toggle(!!tl.interested);
  }

  /** 
   * Add other advertisement cards
   */
  addOther(data: any) {
    let card = $(`[data-tournament-type="other"]`);
    if(!card.length) {
      card = $(`
        <div class="card tournament-card" data-tournament-type="other">
          <div class="card-body">
            <div class="tournament-title" style="font-weight: bold;"></div>
            <div class="mt-1 tournament-date" style="white-space: pre-wrap;"></div>
            <div class="mt-1 tournament-description me-3" style="white-space: pre-wrap;"></div>
          </div>
        </div>
      `);
      card.data('tournament-data', {});
      this.addTournamentCard(card, 'other');
    }

    const cardData = card.data('tournament-data');
    Object.assign(cardData, data);

    card.find('.tournament-title').text(cardData.title);
    
    const linkStr = cardData.link ? `  <a href="${cardData.link}" target="_blank" style="white-space: nowrap;">More Info</a>` : '';
    card.find('.tournament-description').html(`${cardData.description}${linkStr}`);  
    
    const whenStr = `<span class="tournament-card-label">When:</span>  ${cardData.date}`;
    card.find('.tournament-date').html(whenStr);  
  }

  /**
   * Adds a new card to the Tournament panel. Creates the group for that type of
   * card if it doesn't already exist.
   * @param card The card to add
   * @param groupName e.g. 'tournament', 'koth' or 'other'.
   */
  public addTournamentCard(card: JQuery<HTMLElement>, groupName: string) {  
    let group = $(`#pills-tournaments .tournament-group[data-group-name="${groupName}"]`);
    if(!group.length) {
      group = $(`
        <div class="tournament-group" data-group-name="${groupName}">
          <div class="tournament-group-header d-flex align-items-center">
            <span class="tournament-group-title">Tournaments</span>
            ${groupName === 'tournament' || groupName === 'koth' ?
            `<button type="button" class="tournament-more-options ms-auto btn btn-outline-secondary btn-sm btn-transparent dropdown-toggle hide-caret position-relative" data-bs-toggle="dropdown" aria-expanded="false" aria-label="More options">
              <div class="tooltip-overlay" data-tooltip-hover-only data-bs-toggle="tooltip" title="More options"></div>
              <span class="fa-solid fa-ellipsis-vertical" aria-hidden="false"></span>
            </button>
            <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="tournament-more-options">
              <li><a class="dropdown-item noselect show-notifications"><span class="me-2 checkmark invisible">&#10003;</span>Show All Notifications</a></li>
              <li><a class="dropdown-item noselect receive-info"><span class="me-2 checkmark invisible">&#10003;</span>Receive Info</a></li>
              ${groupName === 'koth' ? '<li><a class="dropdown-item noselect set-female"><span class="me-2 checkmark invisible">&#10003;</span>Set me as Female</a></li>' : ''}
            </ul>`
            : ''}
          </div>
          <div class="tournament-group-cards"></div>
        </div>
      `);

      /** Initialize a group when first created */
      if(groupName === 'tournament') {
        $('#tournaments-pane-status').after(group); // Insert at the top of the panel (after the error status)
        this.updateGroup('tournament'); // Updates menus and cards based on the current group settings
        /** Show slide-down notifications for all tournaments? */
        group.find('.show-notifications').on('click', (e) => {
          let checkMark = $(e.currentTarget).find('.checkmark');
          checkMark.toggleClass('invisible');
          e.stopPropagation();

          this.tournamentsShowNotifications = !checkMark.hasClass('invisible');
          if(this.tournamentsShowNotifications) 
            this.tournamentsReceiveInfo = true; // Slide-down notifications require TourneyInfo On

          this.notifyList = {}; // Clear the notify list for individual touranments, since we are overriding it with a global setting
          this.updateGroup('tournament');
        });

        /** 
         * Show Tourney Info in the Console. Note: Tourney Info will always be shown
         * if the Tournament panel is currently visible.
         */
        group.find('.receive-info').on('click', (e) => {
          const checkMark = $(e.currentTarget).find('.checkmark');
          checkMark.toggleClass('invisible');
          e.stopPropagation();

          this.tournamentsReceiveInfo = !checkMark.hasClass('invisible');
          if(!this.tournamentsReceiveInfo) 
            this.tournamentsShowNotifications = false;

          this.notifyList = {};
          this.updateGroup('tournament');
        });
      }
      else if(groupName === 'koth') {
        // Insert KoTH group after the Tournaments group
        const tourneyGroup = $('[data-group-name="tournament"]');
        if(tourneyGroup.length)
          tourneyGroup.after(group);
        else
          $('#tournaments-pane-status').after(group);
        
        this.updateGroup('koth');

        /** Show slide-down notifications for all KoTHs? */
        group.find('.show-notifications').on('click', (e) => {
          const checkMark = $(e.currentTarget).find('.checkmark');
          checkMark.toggleClass('invisible');
          e.stopPropagation();

          this.kothShowNotifications = !checkMark.hasClass('invisible');
          if(this.kothShowNotifications) 
            this.kothReceiveInfo = true; // Slide-down notifications depend on KOTHInfo On

          this.updateGroup('koth');
        });

        /** 
         * Show KOTH Info in the Console. Note: KOTH Info will always be shown
         * if the Tournament panel is currently visible.
         */
        group.find('.receive-info').on('click', (e) => {
          const checkMark = $(e.currentTarget).find('.checkmark');
          checkMark.toggleClass('invisible');
          e.stopPropagation();

          this.kothReceiveInfo = !checkMark.hasClass('invisible');
          if(!this.kothReceiveInfo) 
            this.kothShowNotifications = false;
          
          this.updateGroup('koth');
        });

        /** 
         * Menu option 'Set me as female'. Changes KOTH Info announcements for
         * this user to Queen instead of King.
         */
        group.find('.set-female').on('click', (e) => {
          const checkMark = $(e.currentTarget).find('.checkmark');
          checkMark.toggleClass('invisible');
          e.stopPropagation();

          const isFemale = !checkMark.hasClass('invisible');
          this.session.send(`td set female ${isFemale ? '1' : '0'}`);
        });
      }
      else if(groupName === 'other') {
        group.appendTo('#pills-tournaments'); // Append as the last group
        group.find('.tournament-group-title').text('Other');
      }
    }

    // For tournaments inserts them ordered based on their date
    this.insertChronological(card, group.find('.tournament-group-cards'));
  }

  /**
   * Inserts Tournament cards into the tournaments group based on their 
   * date, as specified by timestamp. Running tournaments are at the top, followed 
   * by future tournaments from most recent to furthest away, followed by past 
   * tournaments from most recent to furthest away. Cards from other groups such as 
   * KoTH or Other are just appended to the end of the group.
   * @param card The card to insert
   * @param container The card container for the group 
   */
  public insertChronological(card, container) {
    const newData = card.data('tournament-data');
    const newTimestamp = newData.timestamp;
    
    // Cards with no timestamp are simply appended to the end of the group
    if(newData.timestamp == null) {
      container.append(card);
      return;
    }

    // Running tournaments at the top
    if(newData.running) {
      container.prepend(card);
      return;
    }
    
    const now = Date.now();

    let inserted = false;
    container.children().each(function () {
      const existingData = $(this).data('tournament-data');

      if(existingData.running)
        return true;

      const existingTimestamp = existingData.timestamp;

      const isNewFuture = newTimestamp >= now;
      const isExistingFuture = existingTimestamp >= now;

      let shouldInsertBefore = false;

      if(isNewFuture && !isExistingFuture) 
        shouldInsertBefore = true;
      else if(isNewFuture && isExistingFuture) 
        shouldInsertBefore = newTimestamp < existingTimestamp;
      else if(!isNewFuture && !isExistingFuture) 
        shouldInsertBefore = newTimestamp > existingTimestamp;

      if(shouldInsertBefore) {
        card.insertBefore(this);
        inserted = true;
        return false; 
      }
    });

    if(!inserted) 
      container.append(card);
  }

  /**
   * Updates group menus and cards based on the current group settings
   * @param groupName e.g. 'tournament', 'koth' or 'other'
   */
  updateGroup(groupName: string) {
    if(groupName === 'tournament') {
      const group = $('[data-group-name="tournament"]');   
      if(group.length) {
        // Update '...' menu UI
        let checkMark = group.find('.show-notifications .checkmark');
        checkMark.toggleClass('invisible', !this.tournamentsShowNotifications);
        storage.set('tournaments-show-notifications', String(this.tournamentsShowNotifications));

        checkMark = group.find('.receive-info .checkmark');
        checkMark.toggleClass('invisible', !this.tournamentsReceiveInfo);

        // Temporarily save the user's settings, since we can't change them 
        // straight away if the Tournaments panel is showing. TourneyInfo
        // and TourneyUpdates are always set to On when the panel is showing.
        if($('#pills-tournaments').hasClass('active') && typeof this.tournamentsReceiveInfo === 'boolean') 
          storage.set('tournaments-receive-info', String(this.tournamentsReceiveInfo));       

        // Save the notify list
        storage.set('tournaments-notify-list', JSON.stringify(this.notifyList));
        this.updateAllTournaments({}); // Update the 'Notify Me' button on tournaments cards
      }
    }
    else if(groupName === 'koth') {
      const group = $('[data-group-name="koth"]');   
      if(group.length) {
        let checkMark = group.find('.show-notifications .checkmark');
        checkMark.toggleClass('invisible', !this.kothShowNotifications);
        storage.set('koth-show-notifications', String(this.kothShowNotifications));

        checkMark = group.find('.receive-info .checkmark');
        checkMark.toggleClass('invisible', !this.kothReceiveInfo);

        if($('#pills-tournaments').hasClass('active') && typeof this.kothReceiveInfo === 'boolean') 
          storage.set('koth-receive-info', String(this.kothReceiveInfo));

        group.find('.tournament-group-title').text(`${this.tdVariables.Female === 'Yes' ? 'Queen' : 'King'} of the Hill`);
        checkMark = group.find('.set-female .checkmark');
        checkMark.toggleClass('invisible', this.tdVariables.Female !== 'Yes');

        this.updateAllKoTHs({}); // Update text on cards based on the settings above
      }
    }
  }

  /**
   * Adds/removes the tournament or KoTH cards specified by id to the alert list.
   * This alerts the user, i.e. by making the Tournaments tab text red when the 
   * tournaments panel is not currently visible.
   * @param id The card to add/remove from the alert list
   * @param alert if true, adds to the alert list, if false removes from alert list.
   */
  public updateAlerts(id: number, alert: boolean) {
    if(id == null || alert == null)
      return;

    if(alert === true) {
      // If tournaments panel is currently unviewed set the tab text to red
      const tab = $('button[data-bs-target="#pills-tournaments"]');
      if(!tab.hasClass('active') || !$('#pills-play').hasClass('active')) 
        tab.addClass('tournaments-unviewed');
      this.alerts[id] = true;
    }
    else if(alert === false) {
      // If there are no longer any alerts, set the tab text back to normal
      delete this.alerts[id];
      if(!Object.keys(this.alerts).length) {
        const tab = $('button[data-bs-target="#pills-tournaments"]');
        tab.removeClass('tournaments-unviewed');
      }
    }
  }

  /**
   * Based on the date specified, returns a date string in a format relative to 
   * 'now'. For example, if date is tomorrow, returns 'Tomorrow', if the date is 
   * within 7 days returns the day of the week 'Tue' etc. If nothing else applies
   * returns the date itself as a string. The year is ommited if it's
   * the same year as now.  
   * @param date The date to format 
   * @param now The current date time
   * @returns A relative date string
   */
  public formatDateRelative(date: Date, now = new Date()) {
    const options: any = { month: 'short', day: 'numeric' };

    const diffDays = getDiffDays(date, now);
    if(diffDays === 0)
      return 'Today';
    else if(diffDays === 1)
      return 'Tomorrow';
    else if(diffDays === -1)
      return 'Yesterday';
    else if (diffDays > 1 && diffDays < 7)
      return date.toLocaleDateString(undefined, { weekday: 'short' }); // e.g., "Wed"
    else {
      if(date.getFullYear() !== now.getFullYear()) 
        options.year = 'numeric';
      return date.toLocaleDateString(undefined, options); // e.g., "Sep 13" or "Sep 13, 2025"
    }
  }

  /**
   * Keeps track of seek and match offers made to/from the King in KoTH in 
   * order to update the buttons on KoTH cards. For example, showing/hiding the 
   * 'Challenge' and 'Seek Game' buttons. This is called by handleOffers in index.ts.
   * @param offers seek, match and remove offers 
   */
  public handleOffers(offers: any) {
    const koths = $('[data-tournament-type="koth"]');

    // Our sent offers
    const matchOffers = offers.filter((item) => (item.type === 'sn'
      || ((item.type === 'pt' || item.type === 'pf') && item.subtype === 'match'))
      && !$(`.sent-offer[data-offer-id="${item.id}"]`).length);
    
    // Remove tournament notifications if the user attempts to start their next tournament game
    const inTournament = $('[data-tournament-type="tournament"]').toArray().some(card => {
      const data = $(card).data('tournament-data');
      return data.joined === true;
    });
    if(inTournament && matchOffers.length > 0)
      removeNotification($(`.notification[data-tournament-id]`));

    matchOffers.forEach((offer) => {
      const ratedUnrated = offer.ratedUnrated === 'unrated' ? 'u' : 'r';
      const type = `${offer.initialTime} ${offer.increment} ${ratedUnrated}`;

      koths.each((index, element) => {
        const kothData = $(element).data('tournament-data');
        if(offer.type === 'pt' && type === kothData.type && offer.opponent === kothData.king) {
          // User sent a match request to the king, with time and rated parameters 
          // matching this KoTH.
          this.updateKoTH(kothData.id, {
            challenge: offer.id,
          });
        }
        else if(offer.type === 'pf' && type === kothData.type && kothData.king === this.session.getUser()) {
          // If we are the King and 'Seek Game', a manual seek is sent. When an offer comes in, we get the variables
          // of the challenger and decline if they have private=1, and auto-accept if they have private=0. This is 
          // because mamer does not allow private KoTH games. 
          if(kothData.seek) 
            offers.splice(offers.indexOf(offer), 1);
          
          awaiting.set('get-private-variable');
          this.session.send(`variables ${offer.opponent}`);
          kothData.offer = offer.id;
        }
        else if(offer.type === 'sn' && type === kothData.type) {
          // User (who may be the king) sent a seek matching the time and rated parameters
          // of this KoTH.
          this.updateKoTH(kothData.id, {
            seek: offer.id,
          });
          if(kothData.offer) 
            this.session.send(`accept ${kothData.offer}`);
        }
      });
    });
   
    // Removals
    const removals = offers.filter(item => item.type === 'pr' || item.type === 'sr');
    removals.forEach((offer) => {
      koths.each((index, element) => {
        const kothData = $(element).data('tournament-data');
        offer.ids.forEach((id) => {
          if(offer.type === 'pr' && kothData.challenge === id) { // match request removal          
            // The user withdrew their match request to the king, or the king started a game
            // (with this user or a different user)
            this.updateKoTH(kothData.id, {
              challenge: undefined,
            });
          }
          else if(offer.type === 'pr' && kothData.offer === id) {
            awaiting.remove('get-private-variable');
            kothData.offer = null;
          }
          else if(offer.type === 'sr' && kothData.seek === id) {
            // User (who may be the king) withdrew his seek request or started a game
            this.updateKoTH(kothData.id, {
              seek: undefined,
            });
          }
        });
        if(offer.type === 'sr' && !offer.ids.length) {
          // User (who may be the king) withdrew all his seek requests
          this.updateKoTH(kothData.id, {
            seek: undefined,
          });
        }
      });
    });
  }
}

export default Tournaments;