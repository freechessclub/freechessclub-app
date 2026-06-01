// Copyright 2024 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { awaiting } from './storage';
import { initContentEditable } from './utils';
import { showDialog } from './dialogs';
import { session } from './session';

/**
 * Class for displaying a Profile modal for the user, containing information derived mostly from 
 * 'finger' output. Currently tabs for Stats and Notes. The Notes tab allows the user to update
 * their finger notes.
 */
export class Profile {
  private fingerNotes: string[] = null; 
  private modalCloseState: 'check' | 'deny' | 'allow' = 'check'; // Prevents the modal being closed when the 'Save changes' dialog is showing

  constructor() {
    /** When the 'Profile & Stats' menu option is clicked in the profile menu */
    $('#show-profile').on('click', (e) => {
      if(session.isRegistered()) {
        awaiting.set('profile-finger'); 
        session.send('finger');
      }
      else {
        $('#show-profile').popover({
          animation: true,
          content: 'You must be registered to view your profile and stats. <a href="https://www.freechess.org/cgi-bin/Register/FICS_register.cgi?Language=English" target="_blank">Register now</a>.',
          html: true,
          placement: 'bottom',
        });
        $('#show-profile').popover('show');
        $('body').one('click', (e) => {
          $('#show-profile').popover('dispose');
        });
        e.stopPropagation();
      }
    });

    $('#profile-modal').on('shown.bs.modal', () => {
      if($('#profile-notes-tab').hasClass('active'))
        this.initNotesTab();
    });

    $('#profile-modal').on('hide.bs.modal', () => {
      if(this.modalCloseState === 'deny')
        return; // 'Save changes' dialog is currently showing

      if(this.canCloseModal()) 
        return true; // User has finished selecting option from 'Save changes' dialog

      if(this.canCloseModal(this.saveFingerNotesDialog()))
        return true; // No changes to save, allow the user to close the modal straight away

      return false; // Show 'Save changes' dialog instead of closing modal
    });

    $('#profile-modal').on('show.bs.tab', '[data-bs-toggle="tab"]', (e) => {
      if(this.modalCloseState === 'deny')
        return false;

      if(this.canCloseModal())
        return true;

      this.modalCloseState = 'allow';
      const leavingTab = (e as any).relatedTarget; 
      const enteringTab = $(e.target);    

      if(leavingTab?.id === 'profile-notes-tab') 
        this.modalCloseState = this.saveFingerNotesDialog(enteringTab); // Show 'Save changes' dialog when leaving the Notes tab
      else if(enteringTab.attr('id') === 'profile-notes-tab') 
        this.initNotesTab();

      if(this.canCloseModal()) 
        return true;

      return false;
    });

    initContentEditable('#finger-notes-table td', null, false, true, 1017);
  }

  /**
   * Called after conncting to FICS 
   */
  public connected() {
    $('#show-profile').show();
  }

  /**
   * Called after disconnecting from FICS
   */
  public disconnected() {
    $('#show-profile').hide();
  }

  /**
   * Checks if we are clear to close the modal, and resets the guard flag
   * @param close Update the guard flag with the value specified before checking it
   * @returns true if allowed to close modal, false otherwise
   */
  private canCloseModal(close?: 'check' | 'allow' | 'deny') {
    if(close)
      this.modalCloseState = close;
    
    if(this.modalCloseState === 'allow') {
      this.modalCloseState = 'check';
      return true;
    }
    return false;
  }

  private initNotesTab() {
    // Populate Notes table from finger information
    const rows = $('#finger-notes-table tbody tr');
    rows.each((i, row) => {
      const value = this.fingerNotes[i] ?? '';
      $(row).children('td').eq(0).text(value); 
    });
  }

  /**
   * Show 'Save changes' dialog when the user tries to hide the modal or leaves the Notes tab after
   * making changes
   * @param enteringTab The tab to move to after the user has confirmed save/discard
   * @returns whether modal can be closed immediately or must wait for 'Save changes' dialog
   */
  private saveFingerNotesDialog(enteringTab?: JQuery<HTMLElement>): 'check' | 'allow' | 'deny' {
    // Extract finger notes from table
    const newFingerNotes = $('#finger-notes-table tbody tr').map(function () {
      return $(this).children('td').eq(0).text().trimEnd();
    }).get();
    
    const changed = newFingerNotes.some((val, i) => val !== this.fingerNotes[i]);
    if(changed) {
      // Finger notes have changed, show 'Save changs' dialog

      const saveFingerNotes = () => {
        // Finger notes have changed, send 'set' commands to FICS update them        
        let newLast = -1;

        // Get index of last non-empty entry in the updated finger notes
        for (let i = newFingerNotes.length - 1; i >= 0; i--) {
          if(newFingerNotes[i] !== '') {
            newLast = i;
            break;
          }
        }

        // Get index of last non-empty entry in the old finger notes
        let oldLast = -1;
        for(let i = this.fingerNotes.length - 1; i >= 0; i--) {
          if(this.fingerNotes[i] !== '') {
            oldLast = i;
            break;
          }
        }
        
        // For any notes that have changed, first set the non-empty ones.
        newFingerNotes.forEach((val, i) => {
          if(val && val !== this.fingerNotes[i])
            session.send(`set ${i + 1} ${val}`);
          else if(!val && i < newLast && i > oldLast)
            session.send(`set ${i + 1} .`); // placeholder, will remove at the end
        });

        // Clear empty notes in reverse order
        for(let i = Math.max(newLast, oldLast); i >= 0; i--) {
          if(!newFingerNotes[i] && (i > oldLast || newFingerNotes[i] !== this.fingerNotes[i]))
            session.send(`set ${i + 1}`);
        }

        this.modalCloseState = 'allow'; // Changes are saved, allow tab/modal to be hidden
        this.fingerNotes = newFingerNotes;
        if(enteringTab) 
          enteringTab.tab('show');
        else
          $('#profile-modal').modal('hide');
      };

      /** User selected 'discard changes' */
      const discardFingerNotes = () => {
        this.modalCloseState = 'allow';
        if(enteringTab) 
          enteringTab.tab('show');
        else
          $('#profile-modal').modal('hide');
      }

      /** User selected the Close btn, so allow them to keep editing notes */
      const closeDialog = () => {
        this.modalCloseState = 'check';
      }
      
      showDialog({
        type: 'Save changes', 
        msg: 'Save changes to finger notes?', 
        btnFailure: [discardFingerNotes, 'Discard'], 
        btnSuccess: [saveFingerNotes, 'Save'], 
        btnClose: closeDialog,        
        icons: true}, 'modal');
      return 'deny';
    }
    return 'allow';
  }

  /**
   * Parse 'finger' command output into individual properties 
   */
  public parseFinger(msg: string): any {
    const finger = {
      user: '',
      gameStats: '',
      timeOnline: '',
      totalTimeOnline: '',
      percentOfLifeOnline: '',
      email: '',
      timeseal: '',
      notes: '',
      sanctions: '',
      status: '',
      adminLevel: '',
      silenceMode: '',
      noGamesPlayed: '',
    }

    let match = msg.match(/^Finger of (\S+?):/m);
    finger.user = match?.[1];

    match = msg.match(/\n([ \t]*rating[\s\S]+?)(?:$|\n\s*\n)/);
    finger.gameStats = match?.[1];

    match = msg.match(/\n([ \t]*\d+:[\s\S]*?)(?:$|\n\s*\n)/);
    finger.notes = match?.[1];

    match = msg.match(/^(On for|Last disconnected).*/m);
    finger.timeOnline = match?.[0];

    match = msg.match(/^\(.*/m);
    finger.status = match?.[0];

    match = msg.match(/^Email.*/m);
    finger.email = match?.[0];

    match = msg.match(/^Total time online.*/m);
    finger.totalTimeOnline = match?.[0];

    match = msg.match(/^% of life online.*/m);
    finger.percentOfLifeOnline = match?.[0];

    match = msg.match(/^Timeseal.*/m);
    finger.timeseal = match?.[0];

    match = msg.match(/^Sanctions.*/m);
    finger.sanctions = match?.[0];

    match = msg.match(/^\S+ is in silence mode.*/m);
    finger.silenceMode = match?.[0];

    match = msg.match(/^\S+ has not played.*/m);
    finger.noGamesPlayed = match?.[0];

    match = msg.match(/^Admin Level.*/m);
    finger.adminLevel = match?.[0];

    return finger;
  }

  /**
   * Initialize and show the Profile model
   * @param finger a finger object returned by parseFinger()
   */
  public showProfileModal(finger: any) {
    const timeStatsText = 
      `${finger.timeOnline}<br>${finger.totalTimeOnline}<br>${finger.percentOfLifeOnline}<br><br>`;

    const stats = $(`<div class="font-monospace" style="font-size: 0.8rem;">
      <div style="white-space: pre-wrap;">${timeStatsText}</div>
      <div class="overflow-auto pb-2" style="white-space: pre;">${finger.gameStats || finger.noGamePlayed}</div>
    </div>`);

    $('#profile-stats').html('');
    $('#profile-stats').append(stats);

    this.fingerNotes = finger.notes?.split(/\r?\n/).map(line => line.replace(/^\s*\d+:\s?/, '')) ?? [];
    this.fingerNotes = this.fingerNotes
      .concat(Array(10).fill(''))
      .slice(0, 10);

    $('#profile-title-text').text(finger.user);
    $('#profile-modal').modal('show');
  }
}

export let profile: Profile;
export function createProfile() {
  profile = new Profile();
}

export default Profile;