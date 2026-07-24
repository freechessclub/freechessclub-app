// Copyright 2024 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import type { Placement } from '@popperjs/core';
import type VirtualScroller from 'virtual-scroller/dom';

export const enum SizeCategory {
  Small = 0,
  Medium,
  Large
}

const timezoneOffsets = {
  UTC: 0,
  GMT: 0,
  BZLFST: -2,
  BZLFDT: -2,
  BZLEST: -3,
  BZLEDT: -2,
  BZLWST: -4,
  BZLWDT: -3,
  BZLAST: -5,
  BZLADT: -4,
  CHLEST: -4,    
  CHLEDT: -3,
  CHLEST_ISLAND: -6,
  CHLEDT_ISLAND: -5,
  NST: -3.5, 
  NDT: -2.5,
  AST: -4,
  ADT: -3,
  EST: -5,
  EDT: -4,
  CST: -6,
  CDT: -5,
  MST: -7,
  MDT: -6,
  PST: -8,
  PDT: -7,
  AKST: -9,
  AKDT: -8,
  YST: -9,
  YDT: -8,
  HST: -10,
  HAST: -10,
  HADT: -9,
  BERSST: -11,
  CUBCST: -5,
  CUBCDT: -4,
  NZST: 12,
  NZDT: 13,
  AUSEST: 10,
  AUSEDT: 11,
  AUSCST: 9.5,
  AUSWST: 8,
  CHNCST: 8,
  CHNCDT: 9,
  JST: 9,
  KST: 9,
  KDT: 10,
  SST: 8,    
  HKT: 8,    
  IRNIST: 3.5,
  IRNIDT: 4.5,
  IST: 2,   
  IDT: 3,
  EET: 2,
  EETDST: 3,
  BST: 1,    
  MET: 1,   
  METDST: 2,
  CET: 1,
  EURCST: 1,
  WET: 0,
  WETDST: 1
};

export function getBaseUrl(): string {
  const fallbackOrigin = 'https://fics-raj.duckdns.org';
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  let origin = window.location.origin;
  let pathname = window.location.pathname || '/play.html';

  const isLocalhost = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === '[::1]'
    || origin === 'null';
  const isUnsupportedProtocol = protocol !== 'http:' && protocol !== 'https:';

  if(isLocalhost || isUnsupportedProtocol) {
    origin = fallbackOrigin;
    if(!pathname || pathname === '/' || pathname.includes('android_asset'))
      pathname = '/play.html';
  }

  return `${origin}${pathname}`;
}

/** Convert a month from a 3 letter name to a number [1-12] */
export function monthShortNameToNumber(month: string) {
  const cleanedMonth = month.trim().charAt(0).toUpperCase() + month.slice(1, 3).toLowerCase();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const index = monthNames.indexOf(cleanedMonth);
  return index === -1 ? undefined : index + 1;
}

/**
 * Convert a month from a number [1-12] to a 3 letter name
 */
export function monthNumberToShortName(month: number) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return monthNames[month] + 1; 
}

/** 
 * Convert a numerical timezone offset, e.g. -10.5 to a string in the form
 * <sign>HH:MM, e.g. '-10:30'. This format is needed when creating an
 * ISO 8601 datetime string.
 */
function timezoneOffsetToHHMM(offset: number) {
  if(offset === 0)
    return 'Z';

  const sign = offset >= 0 ? "+" : "-";
  const absOffset = Math.abs(offset);
  const hours = Math.floor(absOffset);
  const minutes = Math.round((absOffset - hours) * 60);
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/** The user's timezone as returned by their tzone user variable on FICS */
let defaultTimezone = 0;
export function setDefaultTimezone(timezone: string) {
  defaultTimezone = Number.isInteger(+timezone)
      ? +timezone
      : timezoneOffsets[timezone] || 0;
}

/** 
 * Convert an object representing a date time in a specified timezone to a
 * Date object (representing a local date time).
 * @param dateTime The date time to be converted, represented as a basic object.
 * The object is in the following format --
 *  weekday: // e.g. "Tue"
 *  month: // e.g. "Jul"
 *  day: // e.g. "30"
 *  hour: // e.g. "22"
 *  minute: // e.g. "15"
 *  timezone: // e.g. "-10.5"
 *  year: // e.g. "2025"
 * @param serverTime If true, dateTime is treated as if it's in the FICS server's timezone,
 * if false, then timeZone must be specified as a property (as a numerical offset in hours)
 * @returns A Date object representing a local date time
 */
export function parseDate(dateTime: any, serverTime = false) {
  let offset = defaultTimezone;
  if(serverTime)
    offset = serverTimezone;
  else if(Number.isInteger(dateTime.timezone))
    offset = dateTime.timezone;
  else {
    offset = timezoneOffsets[dateTime.timezone] !== undefined
      ? timezoneOffsets[dateTime.timezone] 
      : defaultTimezone; 
  }

  const timezone = timezoneOffsetToHHMM(offset);
  const month = Number.isInteger(Number(dateTime.month)) ? dateTime.month : monthShortNameToNumber(dateTime.month)?.toString().padStart(2, "0");
  const day = dateTime.day.padStart(2, '0');
  const dateTimeStr = `${dateTime.year}-${month}-${day}T${dateTime.hour}:${dateTime.minute}:${dateTime.second || '00'}${timezone}`;
  return new Date(dateTimeStr);
}

/** The FICS server's timezone (obtained from the 'date' command) */
let serverTimezone = -5; // Default to EST
export function setServerTimezone(timezone: string) {
  serverTimezone = Number.isInteger(+timezone)
    ? +timezone
    : timezoneOffsets[timezone] || -5;
}

/**
 * Converts a date time given by a Date object to a date time in
 * FICS server's timezone.   
 * @param localDT the Date object to be converted
 * @returns The converted server date-time as a Date object.
 */
export function convertToServerDate(localDT: any) { 
  // Adjust current date/time to get server time
  const localOffset = -localDT.getTimezoneOffset() / 60;
  const tzDiff = serverTimezone - localOffset;   // Difference between server's timezone and local timezone
  const serverTime = new Date(localDT.getTime() + tzDiff * 60 * 60 * 1000);
  return serverTime;
}

/** 
 * Converts a Date object which is simulating a different timezone, back
 * to local time.
 * @param dateTime the Date object to convert
 * @param timezone The timezone offset in hours of the Date object, if null
 * the server's timezone is used
 */
export function convertToLocalDate(dateTime: any, timezone?: number) {
  if(timezone == null)
    timezone = serverTimezone;

  const localOffset = -new Date().getTimezoneOffset() / 60; // local offset in hours
  const tzDiff = localOffset - timezone; // difference between local timezone and server timezone

  const localTime = new Date(dateTime.getTime() + tzDiff * 60 * 60 * 1000);
  return localTime;
}

/**
 * Get the date of the next specified week day relative to the given date
 * @param date The starting date
 * @param nextWeekDay The next week day as a 3 letter name, e.g. 'Tue'
 * @returns The new date
 */
export function getNextWeekDayDate(date: Date, nextWeekDay: string) {
  const outDate = new Date(date);

  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const targetDay = weekdayMap[nextWeekDay];
  if(targetDay !== undefined) {
    const currentDay = date.getDay(); 
    let daysToAdd = (targetDay - date.getDay() + 7) % 7;
    outDate.setDate(date.getDate() + daysToAdd);
  }
  return outDate;
}

/**
 * Get the difference in days between the specified Date and now as an integer
 * e.g. 1 would mean that the Date is 1 day later than now,
 * whereas -1 would be 1 day earlier.
 * @param date The Date object to compare
 * @param now A Date object representing now
 * @returns date - now in days
 */
export function getDiffDays(date: Date, now = new Date()) {
  // Normalize times for comparison (midnight)
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const d1 = startOfDay(now);
  const d2 = startOfDay(date);

  const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Is this a Capacitor app?
 */
export function isCapacitor() {
  if(typeof window === 'undefined')
    return false;

  const capacitor = (window as any).Capacitor;
  if(!capacitor || typeof capacitor.getPlatform !== 'function')
    return false;

  const platform = capacitor.getPlatform();
  return platform && platform !== 'web';
}

export function isAndroidCapacitor() {
  return isCapacitor() && Capacitor.getPlatform && Capacitor.getPlatform() === 'android';
}

/**
 * Is this an Electron app?
 */
export function isElectron() {
  return navigator.userAgent.toLowerCase().includes(' electron/');
}

/**
 * Is this a Firefox app
 */
export function isFirefox() {
  return navigator.userAgent.toLowerCase().includes('firefox');
}

/** 
 * Is Mac 
 */
export function isMac() {
  return (navigator as any).userAgentData?.platform === "macOS" ||
      navigator.userAgent.includes("Mac");
}

/**
 * Is mobile
 */
export function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Is touch screen
 */
export function isTouchscreen() {
  return navigator.maxTouchPoints > 0;
}

/**
 * Server and browser support multi-threading
 */
export function hasMultiThreading() {
  return typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated;
}

// Used by createContextMenu()
let touchStarted = false; // Keeps track of whether a touch is in progress
// Keeps track of whether a touch is currently in progress. Used by createContextMenu.
document.addEventListener('touchstart', () => {
  touchStarted = true;
}, {capture: true, passive: true});
document.addEventListener('touchend', () => {
  touchStarted = false;
}, {capture: true});
document.addEventListener('touchcancel', () => {
  touchStarted = false;
}, {capture: true});

/** TOOLTIP HELPER FUNCTIONS **/

export function createTooltips() {
  setTimeout(() => { // Split this off since it's quite slow.
    $('[data-bs-toggle="tooltip"]').each((index, element) => {
      createTooltip($(element));
    });
  }, 0);
}

// Enable tooltips.
// Specify fallback placements for tooltips.
// Make tooltips stay after click/focus on mobile, but only when hovering on desktop.
// Allow the creation of "descriptive" tooltips
export function createTooltip(element: JQuery<HTMLElement>) {
  const fallbacksStr = element.attr('data-fallback-placements');
  const fallbackPlacements = fallbacksStr ? fallbacksStr.split(',').map(part => part.trim()) : undefined;
  let title = element.attr('title') || element.attr('data-bs-original-title');

  const description = element.attr('data-description');
  if(description)
    title = `<b>${title}</b><hr class="tooltip-separator"><div>${description}</div>`;

  element.tooltip('dispose').tooltip({
    trigger: (isSmallWindow() ? 'hover focus' : 'hover'), // Tooltips stay visible after element is clicked on mobile, but only when hovering on desktop
    title,
    ...fallbackPlacements && { fallbackPlacements },
    html: !!description,
  });
}

// tooltip overlays are used for elements such as dropdowns and collapsables where we usually
// want to hide the tooltip when the button is clicked
$(document).on('click', '.tooltip-overlay', (event) => {
  $(event.target).tooltip('hide');
});

// If a tooltip is marked as 'hover only' then only show it on mouseover not on touch
document.addEventListener('touchstart', (event) => {
  const tooltipTrigger = $(event.target).closest('[data-tooltip-hover-only]');
  tooltipTrigger.tooltip('disable');
  setTimeout(() => { tooltipTrigger.tooltip('enable'); }, 1000);
}, {passive: true});

/**
 * Removes an element from the DOM with any tooltips and popovers associated with it
 */
export function removeWithPoppers(element: JQuery<HTMLElement>) {
  element.find('[data-bs-toggle="tooltip"]').tooltip('dispose');
  element.find('[data-bs-toggle="popover"]').popover('dispose');
  element.remove();
}

/**
 * Hides an element from the DOM with any tooltips and popovers associated with it
 */
export function hideWithPoppers(element: JQuery<HTMLElement>) {
  element.find('[data-bs-toggle="tooltip"]').tooltip('hide');
  element.find('[data-bs-toggle="popover"]').popover('hide');
  element.hide();
}

/** MISC HELPER FUNCTIONS **/

/**
 * Initialize the event listeners used to create and destroy dropdown submenus
 */
export function initDropdownSubmenus() {
  const toggleSubmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if(e.type === 'click')
      return;

    const container = $(e.target).parent();
    let dropdown = window.bootstrap.Dropdown.getInstance(e.target);
    if(!dropdown) {
      dropdown = new window.bootstrap.Dropdown(e.target, {
        popperConfig: {
          modifiers: [
            {
              name: 'preventOverflow',
              options: {
                boundary: 'viewport', // Prevent overflow relative to the viewport
              },
            },
            {
              name: 'flip',
              options: {
                boundary: 'viewport',
              },
            },
          ]
        }
      });

      container.on('mouseleave.closeSubmenu', function() {
        setTimeout(() => {
          if(!container.is(':hover')) {
            dropdown.hide();
            dropdown.dispose();
            $(this).off('mouseleave.closeSubmenu');
          }
        }, 200);
      });

      dropdown.show();
    }
    else if(e.type === 'touchstart') {
      dropdown.hide();
      dropdown.dispose();
    }
  };

  $('.dropdown-submenu').each(function() {
    $(this).prev().on('mouseenter click', toggleSubmenu);
  });
}

/**
 * Return true if window size is 'sm'.
 */
export function isSmallWindow() {
  return !window.matchMedia('(min-width: 768px)').matches;
}

/**
 * Return true if window size is 'md'.
 */
export function isMediumWindow() {
  return !isSmallWindow() && !isLargeWindow();
}

/**
 * Return true if window size is 'lg' or 'xl'.
 */
export function isLargeWindow() {
  return window.matchMedia('(min-width: 992px)').matches;
}

/**
 * Return the current window's size category, which is related to bootstrap breakpoints
 * i.e. Small is 'sm', Medium is 'md' and Large is 'lg' or 'xl'.
 */
export function getSizeCategory() {
  if(isLargeWindow())
    return SizeCategory.Large;
  else if(isSmallWindow())
    return SizeCategory.Small;
  else
    return SizeCategory.Medium;
}

/**
 * Gets the value from an input element as a string
 */
export function getValue(elt: string): string {
  return $(elt).val() as string;
}

/**
 * Selects all text in an input element when it gains focus
 */
export function selectOnFocus(input: any) {
  $(input).on('focus', function() {
    $(this).one('mouseup', function() {
      setTimeout(() => { $(this).trigger('select'); }, 0);
    }).trigger('select');
  });
}

/**
 * Move caret to the end of an editable text element
 */
export function setCaretToEnd(element: JQuery<HTMLElement>) {
  // Set cursor to end of content
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(element[0]);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Creates helper event handlers for contenteditable elements. Allows features such as
 * automatically adding and removing an invisible character that allows the cursor to be shown
 * when the element is empty. Showing a placeholder string when the element is empty. 
 * Specifying a maximum number of characters. Bluring when enter is pressed and calling a 'done' callback
 * function. Stripping out html and converting newlines to spaces while retaining the correct cursor 
 * position.  
 * @param selector The selector specifying the elements to apply the handlers to for example '.classname' 
 * @param doneCallback Called when the user removes focus from the element or presses enter
 * @param invisibleChar If true, automatically adds/removes an invisible character when the contenteditable
 * is empty. This is necessary to show a cursor in an empty <span>
 * @param replaceNewlines If true, replace newlines with spaces
 * @param maxChars If specified, stop the user typing more than maxChars
 */
export function initContentEditable(selector: string, doneCallback: (elem: JQuery<HTMLElement>) => void, invisibleChar = false, replaceNewlines = false, maxChars?: number) {
  /** Triggered when the user clicks on a comment in the move-list to edit it in-place. */
  $(document).on('focus', selector, (focEvent) => {
    if(!$(focEvent.target).text().length) {
      // Adds an invisible character in order to make the cursor appear even
      // when the element is empty.
      if(invisibleChar)
        $(focEvent.target).text('\u200B');
      // Display the placeholder text.
      if($(focEvent.target).attr('placeholder'))
        $(focEvent.target).attr('data-before-content', $(focEvent.target).attr('placeholder'));
    }

    // Set the move's comment string after the user presses enter or clicks away from the comment element.
    $(focEvent.target).one('blur', (event) => {
      const elem = $(event.target);

      elem.off('paste keydown input');
           
      if(doneCallback)
        doneCallback(elem);

      // Unselect selected text
      if(window.getSelection)
        window.getSelection().removeAllRanges();
    });

    $(focEvent.target).on('keydown', (event) => {
      if(event.key === 'Enter') {
        event.preventDefault();
        $(event.target).trigger('blur');
      }
    });

    /**
     * Remove html tags and formatting from text pasted into the element. Remove
     * the zero-wdith space (placeholder) character if text was pasted into an empty element.
     */
    $(focEvent.target).on('paste', (event) => {
      event.preventDefault();

      // Insert the clipboard text into the element as plain text
      const clipboardEvent = event.originalEvent as ClipboardEvent;
      let text = clipboardEvent.clipboardData?.getData('text/plain') || '';
      if(replaceNewlines)
        text = text.replace(/[\r\n]+/g, ' ');

      const sel = window.getSelection();
      if(sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false); // Move the caret to the end of the pasted text
        sel.removeAllRanges();
        sel.addRange(range);
      }
      $(event.target).trigger('input'); // Remove the zero-width space placeholder character if it exists
    });

    /**
     * Remove the zero-width space (placeholder) character when text is entered.
     * Adds it back when all text is deleted.
     */
    $(focEvent.target).on('input', (event) => {
      const elem = $(event.target);

      if(!elem.text().length) {
        if(invisibleChar)
          elem.text('\u200B'); // insert a zero-width space in order to make cursor appear when span is empty
        if(elem.attr('placeholder'))
          elem.attr('data-before-content', elem.attr('placeholder'));
      }
      else if(elem.attr('data-before-content')) {
        if(invisibleChar) 
          elem.text(elem.text().replace(/\u200B/g, '')); // Remove zero-width space
        setCaretToEnd(elem);
        elem.removeAttr('data-before-content'); // Remove placeholder
      }
      else if(elem.text().length > maxChars) {
        const e = elem[0];

        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;

        const range = sel.getRangeAt(0);

        // Save cursor position relative to element text
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(e);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        const caretPos = preCaretRange.toString().length;

        // Truncate text
        const newText = splitText(elem.text(), maxChars)[0];
        elem.text(newText);

        // Restore caret (best effort)
        const textNode = e.firstChild;
        if(!textNode) return;

        const newRange = document.createRange();
        const pos = Math.min(caretPos, newText.length);

        newRange.setStart(textNode, pos);
        newRange.collapse(true);

        sel.removeAllRanges();
        sel.addRange(newRange);
      }
    });
  });
}

/**
 * Insert text into textarea element at cursor
 */
export function insertAtCursor(element: JQuery<HTMLElement>, text: string) {
  const el = element[0] as HTMLTextAreaElement;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  el.setSelectionRange(start + text.length, start + text.length);
  element.trigger('input');
}

/**
 * Wrapper function for showing hidden button in btn-toolbar
 * Hidden buttons were causing visible buttons to not center properly in toolbar
 * Set the margin of the last visible button to 0
 */
export function showButton(button: any): boolean {
  if(button.is(':visible'))
    return false;

  button.show();
  button.parent().children().removeClass('me-0');
  button.parent().find(':visible:last').addClass('me-0');
  return true;
}

/**
 * Wrapper function for hiding a button in btn-toolbar
 * Hidden buttons were causing visible buttons to not center properly in toolbar
 * Set the margin of the last visible button to 0
 */
export function hideButton(button: any): boolean {
  if(!button.is(':visible'))
    return false;

  button.hide();
  button.removeClass('me-0');
  button.parent().find(':visible:last').addClass('me-0');
  return true;
}

/**
 * Scroll to the given offset, adjusting for the top safe area.
 */
export function safeScrollTo(offset: number) {
  const topPadding = parseInt($('body').css('--safe-area-inset-top'), 10) || 0;
  $(document).scrollTop(offset - topPadding);
}

/*
 * Scroll to the top of the page
 */
export function scrollToTop() {
  if(isSmallWindow())
    $(document).scrollTop(0);
}

/**
 * Stop scrollbar appearing when an element (like a captured piece) is dragged below the bottom of the window,
 * unless the scrollbar is already visible
 */
export function lockOverflow() {
  if($('body')[0].scrollHeight <= $('body')[0].clientHeight) {
    $('body').css('overflow-y', 'hidden');
    $('html').css('overflow-y', 'hidden');
    $(document).one('mouseup touchend touchcancel', () => {
      $('body').css('overflow-y', '');
      $('html').css('overflow-y', '');
    });
  }
}

/**
 * Helper function which creates the right-click and long press (on touch devices) events used to trigger
 * a context menu.
 * @param isTriggered Callback function which returns true if this event (event.target) should trigger the context menu, otherwise false
 * @param triggerHandler Callback function that creates the context menu
 * @returns an array of function handlers which can be passed to removeContextMenuTrigger
 */
export function createContextMenuTrigger(isTriggered: (event: any) => boolean, triggerHandler: (event: any) => void, leftClick = false, rightClick = true, longPress = true): any[] {
  /**
   * Event handler to display context menu when right clicking on an element.
   * Note: We don't use 'contextmenu' for long press on touch devices. This is because for contextmenu
   * events the user has to touch exactly on the element, but for 'touchstart' the browsers are more tolerant
   * and allow the user to press _near_ the element. The browser guesses which element you are trying to press.
   */
  const contextmenuHandler = (event) => {
    if(!isTriggered(event))
      return;

    if((event.button === 2 && event.ctrlKey) || event.shiftKey || event.altKey || event.metaKey)
      return; // Still allow user to display native context menu if holding down a modifier key

    event.preventDefault();
    if(!touchStarted) // right click only, we handle long press seperately.
      triggerHandler(event);
  };
  if(rightClick)
    $(document).on('contextmenu', contextmenuHandler);

  /**
   * Event handler to display context menu when long-pressing an element (on touch devices).
   * We use 'touchstart' instead of 'contextmenu' because it still triggers even if the user
   * slightly misses the element with their finger.
   */
  const touchstartHandler = (tsEvent) => {
    if(!isTriggered(tsEvent))
      return;

    const longPressTimeout = setTimeout(() => {
      $(document).off('touchend.longPress touchcancel.longPress touchmove.longPress wheel.longPress');
      triggerHandler(tsEvent);
    }, 500);

    // Don't show the context menu if the user starts scrolling during the long press.
    // iOS is very sensitive to inadvertant finger movements, so we don't acknowledge a touchmove unless
    // the movement is greater than 15px.
    const startCoords = getTouchClickCoordinates(tsEvent);
    $(document).on('touchmove.longPress', (event) => {
      const coords = getTouchClickCoordinates(event);
      if(Math.abs(coords.x - startCoords.x) > 15 || Math.abs(coords.y - startCoords.y) > 15)
        clearTimeout(longPressTimeout);
    });

    $(document).one('touchend.longPress touchcancel.longPress wheel.longPress', () => {
      clearTimeout(longPressTimeout);
      $(document).off('touchmove.longPress');
    });
  }; 
  if(longPress)
    document.addEventListener('touchstart', touchstartHandler, {passive: true});


  /**
   * Event handler to display context menu when left clicking on an element.
   */
  const clickHandler = (event) => {
    if(!isTriggered(event))
      return;

    triggerHandler(event);
  };
  if(leftClick)
    $(document).on('click', clickHandler);

  return [contextmenuHandler, touchstartHandler, clickHandler];
}

/** Removes the events created by createContextMenuTrigger 
 * @handlers the array of handlers returned by createContextMenuTrigger
 */
export function removeContextMenuTrigger(handlers: any[]) {
  handlers.forEach((h) => { $(document).off(null, h); });
}

/**
 * Displays a custom context menu (right-click menu)
 * @param menu dropdown-menu element to display
 * @param x x-coordinate the menu appears at (often at the mouse pointer)
 * @param y y-coordinate the menu appears at
 * @param itemSelectedCallback Function called when a menu item is selected
 * @param menuClosedCallback Function called when the user hides the menu by clicking outside it etc
 * @param placement Popper placement of the menu relative to x, y ('top-left', 'bottom-left' etc)
 * @param fallbackPlacements Backup popper placements
 */
export function createContextMenu(menu: JQuery<HTMLElement>, x: number, y: number, itemSelectedCallback?: (event: any) => void, menuClosedCallback?: (event: any) => void, placement?: Placement, fallbackPlacements?: Placement[]) {
  // Use Popper.js to position the context menu dynamically
  menu.css({
    'position': 'fixed',
    'display': 'block',
    'z-index': '1071', // This z-index is above modals but below tooltips
  });
  $('body').append(menu);

  Popper.createPopper({
    getBoundingClientRect: () => ({ // Position the menu relative to a virtual element
      x,
      y,
      width: 0,
      height: 0,
      top: y,
      left: x,
      right: x,
      bottom: y,
      toJSON: () => ({})
    }),
    contextElement: document.documentElement
  }, menu[0], {
    placement: placement || 'top-start',
    modifiers: [
      {
        name: 'flip',
        options: {
          fallbackPlacements: fallbackPlacements || ['top-end', 'bottom-start', 'bottom-end'],
          boundary: 'viewport'
        }
      },
      {
        name: 'preventOverflow',
        options: {
          boundary: 'viewport'
        }
      }
    ]
  });

  /** Triggered when menu item is selected */
  menu.find('.dropdown-item').on('click contextmenu', (event) => {
    // Allow native context menu to be displayed when right clicking with modifier key
    if(event.type === 'contextmenu' && ((event.button === 2 && event.ctrlKey)
        || event.shiftKey || event.altKey || event.metaKey))
      return;

    removeWithPoppers(menu);

    $(document).off('wheel.closeMenu mousedown.closeMenu keydown.closeMenu touchend.closeMenu touchmove.closeMenu');
    if(itemSelectedCallback)
      itemSelectedCallback(event);
    event.stopPropagation();
    event.preventDefault();
  });

  // Handle event listeners for the user to close the context menu, either by pressing escape,
  // or clicking outside it, or scrolling the mouse wheel.
  const closeMenuEventHandler = (event) => {
    if(event.type === 'touchstart') // Allow simulated mousedown events again (these were blocked by the touchend handler)
      $(document).off('touchend.closeMenu');
    if(event.type === 'mousedown' && touchStarted) // If a touch is in progress then ignore simulated mousedown events
      return;

    if(((event.type === 'touchstart' || event.type === 'mousedown') && !$(event.target).closest('.dropdown-menu').length)
        || (event.type === 'keydown' && event.key === 'Escape')
        || event.type === 'wheel' || event.type === 'touchmove') {
      removeWithPoppers(menu);
      $(document).off('wheel.closeMenu mousedown.closeMenu keydown.closeMenu touchend.closeMenu touchmove.closeMenu');
      document.removeEventListener('touchstart', closeMenuEventHandler);
      if(menuClosedCallback)
        menuClosedCallback(event);
    }
  }

  $(document).on('touchmove.closeMenu', (event) => {
    // We close the context menu when the user scrolls. However browsers on iOS have very sensitive
    // touchmove events. So we define a movement threshold of 15px before acknowledging a touchmove.
    const coords = getTouchClickCoordinates(event);
    if(Math.abs(coords.x - x) > 15 || Math.abs(coords.y - y) > 15)
      closeMenuEventHandler(event);
  });

  // Browsers will often send a simulated 'mousedown' event when the user lifts their finger from a touch.
  // However we also use 'mousedown' to detect when the user closes the context menu by clicking outside it.
  // Therefore we need to prevent simulated mousedown events directly after menu creation so that it doesn't
  // close the menu right after opening it.
  $(document).one('touchend.closeMenu', (event) => {
    $(document).off('touchmove.closeMenu'); // No longer need to check for scrolling
    event.preventDefault(); // Stops 'mousedown' event being triggered
  });

  // Close the menu when clicking outside it, scrolling the mouse wheel or pressing escape key
  $(document).on('wheel.closeMenu mousedown.closeMenu keydown.closeMenu', closeMenuEventHandler);
  document.addEventListener('touchstart', closeMenuEventHandler, {passive: true});
}

/**
 * General purpose debounce function. E.g. If a function created by debounce() is called multiple times
 * in quick succession only the final call will be executed after the specified wait time (from the final call).
 */
export function debounce(func, wait) {
  let timeout: any;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

export function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getTouchClickCoordinates(event: any, relativeToPage = false) {
  event = (event.originalEvent || event);
  let x: number;
  let y: number;

  if(event.type === 'touchstart' || event.type === 'touchmove' || event.type === 'touchend' || event.type === 'touchcancel') {
    const touch = event.touches[0] || event.changedTouches[0];
    x = relativeToPage ? touch.pageX : touch.clientX;
    y = relativeToPage ? touch.pageY : touch.clientY;
  }
  else if(event.type === 'click' || event.type === 'mousedown' || event.type === 'mouseup' || event.type === 'mousemove' || event.type === 'mouseover' || event.type === 'mouseout' || event.type === 'mouseenter' || event.type === 'mouseleave' || event.type === 'contextmenu') {
    x = relativeToPage ? event.pageX : event.clientX;
    y = relativeToPage ? event.pageY : event.clientY;
  }
  return {x, y};
}

/**
 * Logs an error to console without lint complaining
 */
export function logError(...args) {
  // eslint-disable-next-line no-console
  console.error(...args);
}

/**
 * Breaks up a string at the specified maximum line lengths
 */
export function breakAtMaxLength(input: string, maxLength: number) {
  if(!input)
    return input;

  const regex = new RegExp(`(.{1,${maxLength}})(?:\\s|$)`, 'g');
  return input.match(regex).join('\n');
}

/**
 * Remove a line from text if it contains searchString
 */
export function removeLine(text: string, searchString: string): string {
  searchString = searchString.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(`^.*${searchString}.*$\\n?`, 'm');
  return text.replace(re, '');
}

/**
 * Splits a string into an array of strings each with the given maxLength.
 * Ensures that splits never occur in the middle of HTML entities or emoji shortcodes.
 */
export function splitText(text: string, maxLength: number): string[] {
  const result = [];
  let currentMessage = '';
  let currentLength = 0;
  const regex = /\:[^\:]+\:(?:\:skin-tone-\d\:)?|&#\d+;|./g; // Emoji shortcodes or HTML entities or any character

  text.replace(regex, (match) => {
    const matchLength = match.length;
    if(currentLength + matchLength > maxLength) {
      result.push(currentMessage);
      currentMessage = match;
      currentLength = matchLength;
    }
    else {
      currentMessage += match;
      currentLength += matchLength;
    }
    return match;
  });
  if(currentMessage)
    result.push(currentMessage);

  return result;
}

/**
 * Splits a string into 3 parts { before, matching, after }
 * matching: the line or lines represented by the specified match array (returned by match())
 * before, after: the text before and after the matching line(s)
 * @param text the text to split
 * @param match a match array returned by a previous match() call representing the matched line(s)
 * @returns the split object
 */
export function splitBeforeAfterMatch(text: string, match: any) {
  const start = match.index;
  const end = start + match[0].length;
  const before = text.slice(0, start).replace(/\n$/, '').trim();
  const matching = match[0];
  const after = text.slice(end).replace(/^\n/, '').trim();
  return {
    before,
    matching,
    after
  };
}

/**
 * Returns a string with non-ASCII unicode characters converted to HTML entities
 */
export function unicodeToHTMLEncoding(text) {
  return text.replace(/[\u0080-\uffff]/g, (match) => {
    return `&#${match.charCodeAt(0)};`;
  });
}

/**
 * Get the width of scrollbars in the app by creating an off-screen element with a scrollbar
 * and returning the scrollbar's width
 */
export function getScrollbarWidth(): number {
  if(!$('#scrollbar-measure').length) // For performance reasons only create once
    $('body').append('<div id="scrollbar-measure" style="position: absolute; top: -9999px; overflow: scroll"></div>');
  return $('#scrollbar-measure')[0].offsetWidth - $('#scrollbar-measure')[0].clientWidth;
}

/**
 * Calculates the height taken up by an ancestor element's contents after a specified descendant element's
 * height is subtracted.
 * Note 1: Contents includes the padding, margin and border of each element between the descendant and ancestor
 * (including the ancestor), as well as the vertical siblings of each element.
 * Note 2: All the ancestors of the descendant element are assumed to have height equal to their contents
 * @descendant Element whose outer height is subtracted
 * @ancestor Element to get remaining height for
 * @excludeSiblings A HTML selector string which specifies ancestors for which its siblings should be excluded
 * from the remaining height.
 */
export function getRemainingHeight(descendant: JQuery<HTMLElement>, ancestor: JQuery<HTMLElement> = $('body'), excludeSiblings?: string): number {
  let remHeight = 0;
  let currElem = descendant;
  while(!currElem.is(ancestor)) {
    const currRect = currElem[0].getBoundingClientRect();
    if(descendant !== currElem)
      remHeight += currElem.outerHeight(true) - currElem.height();
    if((!excludeSiblings || !currElem.is(excludeSiblings)) && !currElem.hasClass('main-col')) {
      const siblings = currElem.siblings();
      siblings.each(function() {
        const siblingRect = this.getBoundingClientRect(); 
        if($(this).is(':visible') && $(this).css('position') !== 'absolute' && $(this).css('position') !== 'fixed'
            && (currRect.bottom - siblingRect.top < 1 || currRect.top - siblingRect.bottom > -1)) // If 2 siblings overlap vertically by at most 1 pixel then we assume they are stacked vertically
          remHeight += $(this).outerHeight(true);
      });
    }
    currElem = currElem.parent();
  }
  remHeight += currElem.outerHeight(true) - currElem.height();

  return remHeight;
}

/**
 * Calculates the width taken up by an ancestor element's contents after a specified descendant element's
 * width is subtracted. See getRemainingHeight() for more details.
 */
export function getRemainingWidth(descendant: JQuery<HTMLElement>, ancestor: JQuery<HTMLElement> = $('body'), excludeSiblings?: string): number {
  let remWidth = 0;
  let currElem = descendant;
  while(!currElem.is(ancestor)) {
    const currRect = currElem[0].getBoundingClientRect();
    if(descendant !== currElem) 
      remWidth += currElem.outerWidth(true) - currElem.width();
    if(!excludeSiblings || !currElem.is(excludeSiblings)) {
      const siblings = currElem.siblings();
      siblings.each(function() {
        const siblingRect = this.getBoundingClientRect();
        if($(this).is(':visible') && $(this).css('position') !== 'absolute' && $(this).css('position') !== 'fixed'
            && (currRect.right - siblingRect.left < 1 || currRect.left - siblingRect.right > -1)) // If 2 siblings overlap horizontally by at most 1 pixel then we assume they are stacked horizontally
          remWidth += $(this).outerWidth(true);
      });
    }
    currElem = currElem.parent();
  }
  remWidth += currElem.outerWidth(true) - currElem.width();

  return remWidth;
}

/**
 * Copies the value from the given 'input' or 'textarea' element to the clipboard
 * @param textElem an 'input' or 'textarea' element
 * @param triggerElem If a triggerElement like a 'copy' button is provided, temporarily changes
 * its tooltip to 'Copied!'
 */
export function copyToClipboard(textElem: JQuery<HTMLInputElement>, triggerElem?: JQuery<HTMLElement>) {
  if(navigator.clipboard) // Try to use the new method first, only works over HTTPS.
    navigator.clipboard.writeText(textElem.val() as string);
  else {
    textElem[0].select();
    document.execCommand('copy'); // Obsolete fallback method
  }
  textElem[0].setSelectionRange(0, 0);

  // Change trigger element's tooltip to 'Copied!' for a couple of seconds
  if(triggerElem) {
    const origTitle = triggerElem.attr('data-bs-original-title');
    triggerElem.attr('title', 'Copied!');
    createTooltip(triggerElem);
    triggerElem.tooltip('show');
    setTimeout(() => {
      triggerElem.attr('title', origTitle);
      createTooltip(triggerElem);
    }, 2000);
  }
}

/**
 * Animation where the bounding rectangle of the 'from' element appears to move and resize until it
 * is positioned over the bounding rectangle of the 'to' element. Used to indicate to the user that a panel is
 * 'opening'.
 */
export function animateBoundingRects(fromElement: any, toElement: any, color = '#000000', width = '1px', numRects = 3) {
  const fromTop = fromElement.offset().top;
  const fromLeft = fromElement.offset().left;
  const fromWidth = fromElement.outerWidth();
  const fromHeight = fromElement.outerHeight();

  const toTop = toElement.offset().top;
  const toLeft = toElement.offset().left;
  const toWidth = toElement.outerWidth();
  const toHeight = toElement.outerHeight();

  const distance = Math.sqrt((toTop - fromTop) ** 2 + (toLeft - fromLeft) ** 2);
  const speed = 0.015 * Math.sqrt(distance);

  // Create bounding div
  const boundingDiv = $('<div></div>');
  boundingDiv.css({
    position: 'absolute',
    top: fromTop,
    left: fromLeft,
    width: fromWidth,
    height: fromHeight,
    zIndex: 3,
    'transition-property': 'width, height, top, left',
    'transition-duration': `${speed}s`,
    'transition-timing-function': 'ease'
  });
  boundingDiv.appendTo($('body'));

  // Create animated rects
  let rect = boundingDiv;
  for(let i = 0; i < numRects; i++) {
    const childRect = $('<div></div>');
    childRect.css({
      width: '100%',
      height: '100%',
      padding: `calc(50% / ${numRects - i})`,
      border: `${width} solid ${color}`
    });
    rect = childRect.appendTo(rect);
  }

  boundingDiv.one('transitionend', () => {
    boundingDiv.remove();
  });
  setTimeout(() => {
    boundingDiv.css({
      top: toTop,
      left: toLeft,
      width: toWidth,
      height: toHeight
    });
  }, 0);
}

/**
 * Perform a multi-column sort on a table based on its sorting data attributes.
 * For sortable columns, the <th> elements should have the 'sortable-column' class and the following data attributes
 * data-priority="<number>": Which column is the primary column to sort by, which is secondary etc.
 * 1 is highest priority 
 * The primary column should also have the 'sort-primary' class
 * data-default-sort="<asc|desc>": The initial order to use when a column becomes the primary sort column
 * data-sort="<asc|desc|[none]>": The current sort order, ascending, descending or none for tri-state tables
 * The columns will be sorted based on their <td> text, either lexicographically or numerically
 * if the text can be converted to a number. However if the <td> has a data-sort-value="<value>" attribute
 * then the column is sorted by this value instead.
 * If the thead > tr element has data-sort="<asc|desc>" set, then the table rows will instead be sorted by the
 * data-sort-value attr on each tbody > tr element. Otherwise it will be sorted as usual. 
 * @param table The table element (JQuery) to sort
 * @param column Optional <th> element, if specified, makes this column the primary sort column or
 * if it is already the primary column, reverses its sort order (asc or desc). 
 * (Basically what happens when you click on a sort header) 
 * @param triState if true, then the primary sort column alternates between 3 states: asc, desc and none. 
 * When a column is set to none, if thead > tr has a data-default-sort="<asc|desc>" then the table is 
 * sorted by the data-sort-value="<value>" on the <tr> elmeents using the sort order defined by 
 * data-default-sort. 
 */
export function sortTable(table: any, column?: any, triState = false, data?: any[]) {
  const headRow = table.find('> thead > tr');
  if(!headRow.attr('data-sort'))
    headRow.attr('data-sort', 'none');
  if(!headRow.attr('data-default-sort'))
    headRow.attr('data-default-sort', headRow.attr('data-sort'));    

  const cols = table.find('.sortable-column');
  cols.each((index, elem) => {  
    if(!$(elem).attr('data-sort'))
      $(elem).attr('data-sort', 'none');

    if(!$(elem).attr('data-default-sort') && $(elem).attr('data-sort') !== 'none')
      $(elem).attr('data-default-sort', $(elem).attr('data-sort'));    
  });

  if(column) {
    const priority = +column.attr('data-priority') || Infinity;
    const dataSort = column.attr('data-sort');
    if(priority !== 1 || headRow.attr('data-sort') !== 'none') {
      cols.each((index, elem) => {
        $(elem).removeClass('sort-primary');
        const otherPriority = +$(elem).attr('data-priority');
        if(otherPriority && otherPriority < priority)
          $(elem).attr('data-priority', otherPriority + 1);
      });
      column.attr('data-priority', 1);
      column.addClass('sort-primary');
      column.attr('data-sort', column.attr('data-default-sort') || 'asc');
      headRow.attr('data-sort', 'none');
    } 
    else {
      if(triState) {
        const defSort = column.attr('data-default-sort') || 'asc';
        if(defSort === 'desc') // order goes desc -> asc -> none
          column.attr('data-sort', column.attr('data-sort') === 'asc' ? 'none' : 'asc');  
        else // order goes asc -> desc -> none
          column.attr('data-sort', column.attr('data-sort') === 'asc' ? 'desc' : 'none');  
        
        if(column.attr('data-sort') === 'none') {
          column.removeClass('sort-primary');
          cols.each((index, elem) => {
            $(elem).attr('data-priority', +$(elem).attr('data-priority') - 1);
          });
          column.attr('data-priority', cols.length);
          headRow.attr('data-sort', headRow.attr('data-default-sort'));
        }
      }
      else
        column.attr('data-sort', column.attr('data-sort') === 'asc' ? 'desc' : 'asc');
    }
  }

  const compareVals = (textA: string, textB: string) => {
    // Try numeric comparison before alphabetical
    const numA = parseFloat(textA);
    const numB = parseFloat(textB);

    let cmp = 0;
    if(!isNaN(numA) && !isNaN(numB)) 
      cmp = numA - numB;
    else 
      cmp = String(textA).localeCompare(textB); // fallback string comparison
    return cmp;
  }; 

  // Get all sortable columns, sorted by priority (ascending)
  const colArray = cols.filter('[data-sort="asc"], [data-sort="desc"]')
    .toArray()
    .sort((a, b) => {
      return +$(a).attr('data-priority') - +$(b).attr('data-priority');
    });

  if(data) {
    data.sort((rowA: any, rowB: any) => {
      if(headRow.attr('data-sort') !== 'none') {
        const textA = rowA[cols.length] ?? '';
        const textB = rowB[cols.length] ?? '';   
        let sortOrder = headRow.attr('data-sort');
        const cmp = compareVals(textA, textB);
        if(cmp !== 0)
          return sortOrder === 'asc' ? cmp : -cmp;
      }
      else {
        for(const col of colArray) {
          const index = $(col).index(); 
          let sortOrder = $(col).attr('data-sort'); 

          const textA = rowA[index] ?? '';
          const textB = rowB[index] ?? ''; 

          const cmp = compareVals(textA, textB);
          if(cmp !== 0) 
            return sortOrder === 'asc' ? cmp : -cmp;
        }
      }
      return 0;    
    });
  }
  else {
    const tbody = table.find('tbody');
    const rows = tbody.find('tr').toArray();
    // Sort rows
    rows.sort((rowA: any, rowB: any) => {
      if(headRow.attr('data-sort') !== 'none') {
        const textA = $(rowA).attr('data-sort-value') || '';
        const textB = $(rowB).attr('data-sort-value') || '';   
        let sortOrder = headRow.attr('data-sort');
        const cmp = compareVals(textA, textB);
        if(cmp !== 0)
          return sortOrder === 'asc' ? cmp : -cmp;
      }
      else {
        for(const col of colArray) {
          const index = $(col).index(); 
          let sortOrder = $(col).attr('data-sort'); 

          const cellA = $(rowA).children().eq(index);
          const cellB = $(rowB).children().eq(index);
          const textA = cellA.attr('data-sort-value') || cellA.text();
          const textB = cellB.attr('data-sort-value') || cellB.text();      

          const cmp = compareVals(textA, textB);
          if(cmp !== 0) 
            return sortOrder === 'asc' ? cmp : -cmp;
        }
      }
      return 0;
    });
    tbody.append(rows);
  }
}

/**
 * Gets the play duration / length of an Audio object.
 * @param audio An Audio object
 * @returns the duration in seconds (floating point)
 */
export async function getAudioDuration(audio) {
  if(audio.readyState >= 1) // Metadata already loaded
    return audio.duration;

  await new Promise(resolve => { // Wait for metadata to load
    audio.addEventListener('loadedmetadata', resolve, { once: true });
  });

  return audio.duration;
}

/** Plays a sound. If there is a current instance playing, restarts it from the beginning */
export function replaySound(sound: HTMLAudioElement) {
  sound.pause();
  sound.currentTime = 0;

  sound.play().catch(() => {
    // Ignore interrupted playback
  });
}

/**
 * An object representing a sprite animation. Contains a sprite sheet as well as the
 * properties used to control the sprite. Used by SpritePlayer class.
 */
export interface Sprite {
  spriteSheet: HTMLImageElement, // A sprite sheet
  destRect: { // The rects where the animation is to be drawn on the canvas (relative to the canvas' origin). Note that multiple copies of the sprite can be drawn using the same animation.
    x: number,
    y: number,
    width: number,
    height: number 
  },
  frames?: number[], // Frames to draw (in order), if undefined, frames are drawn in row-major order stopping after totalFrames.
  totalFrames?: number, // Total number of frames. If frames array is defined then totalFrames is set to its length
  frameWidth: number, // The width of each frame
  frameHeight: number, // The height of each frame
  startTime?: number, // When to start animating, if null, will use the time the sprite is added
  duration: number, // Duration of the animation in ms
  removeAfter?: boolean, // If true, remove the sprite from the sprite list when it finishes playing,
                         // If false, the sprite will continue to be drawn using its final frame
  loop?: boolean // Loop the sprite
}

/**
 * A sprite renderer (rendering loop), which animates a list of sprites on a HTML canvas
 */
export class SpritePlayer {
  private sprites: Sprite[] = []; // The list of sprites to draw
  private canvas: HTMLCanvasElement; // The canvas element to render on

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /**
   * Add a Sprite to the sprites list.
   * Starts the rendering loop if not already started. 
   */
  public addSprite(sp: Sprite) {
    this.sprites.push(sp);
    if(this.sprites.length === 1) 
      requestAnimationFrame((time) => this.animate(time));
  }

  /** 
   * Remove a Sprite from the animations list.
   */
  public removeSprite(sprite: Sprite) {
    this.sprites = this.sprites.filter(sp => sprite !== sp);
  }

  /**
   * Remove all Sprites from the sprite list.
   */
  public removeAllSprites() {
    this.sprites = [];
  }

  /**
   * The rendering loop
   * @param time current timestamp (passed by requestAnimationFrame)
   */
  private animate(time: number) {  
    // Update the size of the rendering context in case the canvas has been resized
    const dpr = window.devicePixelRatio || 1;
    const canvasRect = this.canvas.getBoundingClientRect(); 

    let resized = false;
    if (this.canvas.width !== canvasRect.width * dpr || this.canvas.height !== canvasRect.height * dpr) {
      this.canvas.width = canvasRect.width * dpr; 
      this.canvas.height = canvasRect.height * dpr;
      resized = true; // canvas was cleared automatically
    }

    const ctx = this.canvas.getContext('2d'); 
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear the canvas
    if(!resized)
      ctx.clearRect(0, 0, canvasRect.width, canvasRect.height);

    // Draw sprite frames
    for(let i = this.sprites.length - 1; i >= 0; i--) {
      const sp = this.sprites[i];

      if(sp.frames)
        sp.totalFrames = sp.frames.length;

      const frameDuration = sp.duration / sp.totalFrames;

      if(sp.startTime == null) 
        sp.startTime = time;
      
      const elapsed = time - sp.startTime;

      if(elapsed >= sp.duration) { 
        if(sp.loop)
          sp.startTime = time;
        else if(sp.removeAfter) {
          this.removeSprite(sp); // Remove sprite that has finished playing
          continue;
        }
      }

      let frame = Math.min(sp.totalFrames - 1, Math.floor(elapsed / frameDuration));
      this.drawFrame(ctx, sp, frame);
    }

    if(this.sprites.length)
      requestAnimationFrame((time) => this.animate(time));
  }
  
  /**
   * Draw the current frame for a sprite
   * @param ctx Canvas rendering context
   * @param sp Sprite
   * @param frameIndex Current frame
   */
  private drawFrame(ctx: CanvasRenderingContext2D, sp: Sprite, frameIndex: number) {  
    if(sp.frames) // Use index array instead of row-major order
      frameIndex = sp.frames[frameIndex];
    
    const cols = Math.floor(sp.spriteSheet.width / sp.frameWidth);
    const row = Math.floor(frameIndex / cols);
    const col = frameIndex % cols;

    ctx.drawImage(
      sp.spriteSheet,
      col * sp.frameWidth,
      row * sp.frameHeight,
      sp.frameWidth,
      sp.frameHeight,
      sp.destRect.x, // Location on canvas
      sp.destRect.y,
      sp.destRect.width, // Scale the sprite
      sp.destRect.height
    );
  }
}

export function splitIntoColumns(items, cols = 3) {
  const sorted = [...items].sort((a, b) => a.localeCompare(b));

  const n = sorted.length;
  const base = Math.floor(n / cols);
  const remainder = n % cols;

  const result = [];
  let index = 0;

  for(let col = 0; col < cols; col++) {
    const size = base + (col < remainder ? 1 : 0);
    result.push(sorted.slice(index, index + size));
    index += size;
  }

  return result;
}

/** 
 * Class for writing bits to a bit stream.
 * The stream is single-use, i.e. once the final stream is read with finished() you can no longer write to it  
 */
export class BitWriter {
  private buffer = 0;
  private bitCount = 0;
  private output: number[] = [];

  /**
   * Write the value 
   * @param value the number to write
   * @param bits the number of bits the value occupies
   */
  public write(value: number, bits: number) {
    this.buffer = ((this.buffer << bits) | value) >>> 0;
    this.bitCount += bits;

    while (this.bitCount >= 8) {
      this.bitCount -= 8;

      const byte = (this.buffer >> this.bitCount) & 0xFF;
      this.output.push(byte);
    }

    this.buffer &= (1 << this.bitCount) - 1;
  }

  /**
   * Write the value, specifying a max value
   * @param value the number to write
   * @param maxValue The maximum possible value, translated to the number of bits the value occupies
   */
  public writeMax(value: number, maxValue: number) {
    const bits = Math.ceil(Math.log2(maxValue + 1));
    this.write(value, bits);
  }

  public finish(): Uint8Array {
    if (this.bitCount > 0) {
      this.output.push((this.buffer << (8 - this.bitCount)) & 0xFF);
    }
    return new Uint8Array(this.output);
  }

  /**
   * Write a standard varint
   */
  public writeVarint(value: number) {
    while(value >= 0x80) {
      // Write 7 bits + continuation flag (1)
      this.write((value & 0x7F) | 0x80, 8);
      value >>>= 7;
    }
    this.write(value, 8);
  }
}

/** 
 * Class for reading bits from a bit stream.
 */
export class BitReader {
  private buffer = 0;
  private bitCount = 0;
  private inputIndex = 0;

  constructor(private input: Uint8Array) {}

  /** Read the given number of bits, return as a number */
  public read(bits: number): number {
    while (this.bitCount < bits) {
      if (this.inputIndex >= this.input.length) {
        throw new Error("BitReader: unexpected end of stream");
      }

      this.buffer = ((this.buffer << 8) | this.input[this.inputIndex++]) >>> 0;
      this.bitCount += 8;
    }

    this.bitCount -= bits;

    return (this.buffer >> this.bitCount) &
      (bits === 32 ? 0xFFFFFFFF : (1 << bits) - 1);
  }

  /** Read a number, given its maximum possible value (translated into a number of bits) */
  public readMax(maxValue: number): number {
    const bits = Math.ceil(Math.log2(maxValue + 1));
    return this.read(bits);
  }

  /** Read a standard varint */
  public readVarint(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      const byte = this.read(8);
      result |= (byte & 0x7F) << shift;

      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result;
  }
}

/**
 * Zigzag encode an integer, used for compact encoding of negative integers. 
 * e.g. [0, 1, -1, 2, -2] comes [0, 1, 2, 3, 4] 
 */
export function zigzagEncode(n: number): number {
  return (n << 1) ^ (n >> 31);
}

/**
 * Zigzag decode an integer
 */
export function zigzagDecode(n: number): number {
  return (n >>> 1) ^ -(n & 1);
}

/**
 * Helper class for automatically keeping a scrollbar "stuck" at the bottom when new content is added
 * or the container is resized
 */
export class StickyBottomScroller {
  private container: HTMLElement;
  private stuck: boolean;
  private isStuckCallback?: (isStuck: boolean, container: HTMLElement) => void // Callback function for reporting whether the scrollbar is currently at the bottom or not

  constructor(container: HTMLElement, isStuckCallback?: (isStuck: boolean, container: HTMLElement) => void) {
    this.container = container;
    this.isStuckCallback = isStuckCallback;
    this.stuck = true;

    /** Check if scrollbar is at bottom after user scrolls */
    $(container).on('scroll.stickyBottom', () => {
      this.checkStuck();
    });
  }

  /** Cleanup scroll event handler */
  public destroy() {
    $(this.container).off('scroll.stickyBottom');
  }

  /**
   * Check if the scrollbar is currently stuck to the bottom or not
   * @returns true if at bottom, false otherwise
   */
  public checkStuck() {
    if(!$(this.container).is(':visible')) // Can't check scrollbar when container is not visible
      return;

    this.stuck = this.container.scrollHeight - this.container.clientHeight < this.container.scrollTop + 1.5;
       
    if(this.isStuckCallback)
      this.isStuckCallback(this.stuck, this.container); // Callback function to report scrollbar status
  }

  /**
   * Move scrollbar back to bottom when content is added or container is resized causing the scrollbar to
   * move erroneously.
   */
  public fixScroll() {
    if(!$(this.container).is(':visible'))
      return;

    if(this.stuck) 
      this.container.scrollTop = this.container.scrollHeight;
    this.checkStuck();
  }

  /** Move scrollbar to bottom and stick it (state = true), or temporarily stop it sticking (state = false) */
  public stick(state = true) {
    this.stuck = state;
    if(this.stuck)
      this.fixScroll();
  }
}

/** 
 * Wrapper class for virtualScroller/dom which adds helper functions for dynamically updating the 
 * content and for stopping and starting the scroller when the container is hidden/shown.
 * (virtualscroller normally behaves badly when you hide or show the item container while it's running, 
 * or if you add items too quickly)
 */
export class DynamicVirtualScroller<Item> {
  private static virtualScrollerPromise = import('virtual-scroller/dom');
  private scrollerInstancePromise: Promise<VirtualScroller<Item>> | null = null;
  private started: boolean = false;
  private scrollContainer: HTMLElement = null; // The element with the overflow scrollbar
  private contentElement: HTMLElement = null; // The element containing the items
  private updateCount: number = 0; // Used for throttling content updates so virtual scroller doesn't complain
  private items: Item[] = null; // The data items to render
  private renderItem: (item: any) => HTMLElement; // Callback function for creating DOM elements for items
  private onStateChange: () => void; // Callback function for after the rendered elements changes

  constructor(contentElement: HTMLElement, scrollContainer: HTMLElement, items: Item[], renderItem: (item: Item) => HTMLElement, onStateChange: () => void) {
    this.contentElement = contentElement;
    this.scrollContainer = scrollContainer;
    this.items = items;
    this.renderItem = renderItem;
    this.onStateChange = onStateChange;
  }

  // Create the virtualscroller instance
  private async create() {
    const { default: VirtualScroller } = await DynamicVirtualScroller.virtualScrollerPromise;
    return new VirtualScroller(this.contentElement, this.items, this.renderItem, {
      scrollableContainer: this.scrollContainer,
      onStateChange: this.onStateChange
    });
  }

  // Stop the virtual scroller (usually when the container is hidden)
  public async stop() {
    const scroller = await this.scrollerInstancePromise;
    if(this.started) {
      this.started = false;
      scroller.stop(); 
    } 
  }

  /**
   * Re-render items or restart the virtual scroller if it was stopped, e.g. after the container becomes
   * visible again.
   * @param items if items is specified, then updates the virtual scroller's items
   */
  public async update(items?: Item[]) {
    if(items)
      this.items = items;

    // Don't start or render if scroll container is invisible
    if(!$(this.scrollContainer).is(':visible'))
      return;

    // Throttle updates
    if(!this.updateCount) {
      this.updateCount = 1;
      setTimeout(() => {
        const count = this.updateCount;
        this.updateCount = 0;
        if(count > 1 && this.started) 
          this.update();
      }, 250);
    } 
    else {
      this.updateCount++;
      return;
    }

    if(!this.scrollerInstancePromise) {
      this.scrollerInstancePromise = this.create();
      this.started = true;
      return;
    }

    const scroller = await this.scrollerInstancePromise;
    if(!this.started) {
      // In case panel was resized while hidden, recalculate chat message heights so that 
      // virtual-scroller doesn't complain after restarting
      const state = (scroller as any).virtualScroller.getState();
      for(let i = state.firstShownItemIndex; i <= state.lastShownItemIndex; i++) 
        scroller.onItemHeightDidChange(i);
      (scroller as any).start();
      this.started = true;
    }

    scroller.setItems(this.items);
  }
}

/** 
 * Convert a color string in the form rgb(<r>, <g>, <b>) to #RRGGBB 
 */
export function rgbToHex(color?: string | null): string | null {
  if(!color)
    return null;

  // Already hex
  if (/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(color))
    return color.toLowerCase();

  // rgb(...) or rgba(...)
  const match = color.match(
    /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/
  );

  if (match) {
    const [, r, g, b] = match;

    return (
      '#' +
      [r, g, b]
        .map(n => Number(n).toString(16).padStart(2, '0'))
        .join('')
    );
  }

  return null;
}

/**
 * Return the perceived brightness of a color
 * @param color string in either rgb(r, g, b) or #RRGGBB format
 * @returns brightness value from 0-255
 */
export function getBrightness(color: string): number {
  let r: number, g: number, b: number;

  // hex
  if (color.startsWith('#')) {
    let hex = color.slice(1);

    if (hex.length === 3)
      hex = hex.split('').map(c => c + c).join('');

    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  }

  // rgb(...)
  else {
    const match = color.match(/\d+/g);

    if (!match || match.length < 3)
      return NaN;

    [r, g, b] = match.slice(0, 3).map(Number);
  }

  return (r * 299 + g * 587 + b * 114) / 1000;
}

const normalizeColorElem = document.createElement('div');
document.body.appendChild(normalizeColorElem);
/**
 * Converts a color string from any format to rgb(<r>, <g>, <b>)
 * Works by getting the computed style from a dummy element 
 * @param color string to convert
 * @returns normalized color string
 */
export function normalizeColor(color: string) {
  if(!color)
    return null;

  // reject paint servers + special keywords
  const v = color.trim().toLowerCase();
  if(v.startsWith('url(') || v === 'none' || v === 'inherit' || v === 'currentcolor') 
    return null;

  normalizeColorElem.style.color = color;
  return getComputedStyle(normalizeColorElem).color;
}

/**
 * Returns [R, G, B] values as number array from an 'rgb(<r>, <g>, <b>)' string
 */
export function parseRgb(str: string): [number, number, number] {
  const m = str.match(/\d+/g);
  if (!m || m.length < 3) return [0, 0, 0];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

/**
 * Converts [R, G, B] number array to 'rgb(<r>, <g>, <b>)' string
 */
export function toRgb([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Converts color components from [H, S, L] to [R, G, B] 
 */
export function hslToRgb(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;

  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ];
}

/**
 * Converts color components from [R, G, B] to [H, S, L] 
 */
export function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  let h = 0, s = 0;
  const l = (max + min) / 2;

  const d = max - min;

  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));

    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }

    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s, l };
}

export async function createColorPicker(container: HTMLElement, onChange: (btn: HTMLElement, color: string) => void) {
  const { default: iro } = await import('@jaames/iro');
  
  const $container = $(container);
  let controller = null;

  $container.on('click', '.color-picker-btn', (e) => {
    const popInstance = bootstrap.Popover.getInstance(e.currentTarget);
    if(popInstance)
      return;

    const popover = new bootstrap.Popover($(e.currentTarget), {
      html: true,
      sanitize: false,
      trigger: 'manual',
      placement: 'bottom',
      customClass: 'color-picker-popover',
      content: `<div class="color-picker-container"></div>`
    });
    popover.show();
  })

  $container.on('hidden.bs.popover', '.color-picker-btn', (e) => {
    const btn = $(e.currentTarget);
    btn.data('picker')?.off();
    btn.popover('dispose');
    controller?.abort();
  });

  $container.on('shown.bs.popover', '.color-picker-btn', (e) => {
    const btn = $(e.currentTarget);
    const popoverElem = $('.color-picker-popover.show .color-picker-container');
    btn.trigger('focus');

    controller = new AbortController();

    document.addEventListener('click', (e) => {
      if(!$(e.target).closest('.color-picker-popover').length) 
        btn.popover('hide');
    }, { signal: controller.signal });

    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape') {
        e.stopPropagation();
        btn.popover('hide');
      }
    }, { capture: true, signal: controller.signal });

    const picker = iro.ColorPicker(popoverElem[0], {
      width: 180,
      color: getComputedStyle(btn[0]).getPropertyValue('--swatch-color').trim()
    });
    btn.data('picker', picker);
    btn.popover('update');

    /** User changed the color in a color picker */
    
    let rafId: number | null = null;
    let latestColor: string | null = null;
    picker.on("color:change", (color) => {
      latestColor = color.rgbString;
      if(rafId !== null) 
        return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if(latestColor) {
          btn.css('--swatch-color', latestColor);
          onChange(btn[0], latestColor);
        }
      });
    });
  });
}

/**
 * Fetch an SVG as an element
 */
export async function loadSvg(url: string) {
  const text = await fetch(url).then(r => r.text());
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');

  const svg = doc.documentElement;

  if (!(svg instanceof SVGSVGElement)) {
    throw new Error('Invalid SVG');
  }

  return svg;
}

/**
 * Convert an SVG element to a serialized blob url
 */
export function svgToUrl(svg: SVGSVGElement) {
  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([serialized], {
    type: 'image/svg+xml'
  });
  return URL.createObjectURL(blob);
}

/** 
 * Convert an SVG element to an img element 
 */
export function svgToImg(svg: SVGSVGElement) {
  const url = svgToUrl(svg);
  const img = document.createElement('img');
  img.src = url;
  return img;
}

export class Deferred<T> {
  promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (reason?: any) => void;

  constructor() {
      this.promise = new Promise<T>((resolve, reject) => {
          this.resolve = resolve;
          this.reject = reject;
      });
  }
}
