// Copyright 2024 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import type { Placement } from '@popperjs/core';

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

export function monthShortNameToNumber(month: string) {
  const cleanedMonth = month.trim().charAt(0).toUpperCase() + month.slice(1, 3).toLowerCase();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const index = monthNames.indexOf(cleanedMonth);
  return index === -1 ? undefined : index + 1;
}

export function monthNumberToShortName(month: number) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return monthNames[month]; 
}

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

let defaultTimezone = 0;
export function setDefaultTimezone(timezone: string) {
  defaultTimezone = Number.isInteger(+timezone)
      ? +timezone
      : timezoneOffsets[timezone] || 0;
}

export async function convertToLocalDateTime(dateTime: any) {
  const offset = timezoneOffsets[dateTime.timezone] !== undefined
      ? timezoneOffsets[dateTime.timezone] 
      : defaultTimezone; 

  const timezone = timezoneOffsetToHHMM(offset);
  const month = Number.isInteger(Number(dateTime.month)) ? dateTime.month : monthShortNameToNumber(dateTime.month)?.toString().padStart(2, "0");
  const dateTimeStr = `${dateTime.year}-${month}-${dateTime.day}T${dateTime.hour}:${dateTime.minute}:${dateTime.second || '00'}${timezone}`;
  return new Date(dateTimeStr);
}

/**
 * Is this a Capacitor app?
 */
export function isCapacitor() {
  return typeof window !== 'undefined' && window.Capacitor !== undefined;
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
 * Removes an element from the DOM with any tooltips associated with it
 */
export function removeWithTooltips(element: JQuery<HTMLElement>) {
  element.find('[data-bs-toggle="tooltip"]').tooltip('dispose');
  element.remove();
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
export function showButton(button: any) {
  button.parent().find('visible:last').removeClass('me-0');
  button.addClass('me-0');
  button.show();
}

/**
 * Wrapper function for hiding a button in btn-toolbar
 * Hidden buttons were causing visible buttons to not center properly in toolbar
 * Set the margin of the last visible button to 0
 */
export function hideButton(button: any) {
  button.hide();
  button.removeClass('me-0');
  button.parent().find('visible:last').addClass('me-0');
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
export function createContextMenuTrigger(isTriggered: (event: any) => boolean, triggerHandler: (event: any) => void): any[] {
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
  document.addEventListener('touchstart', touchstartHandler, {passive: true});

  return [contextmenuHandler, touchstartHandler];
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

    removeWithTooltips(menu);

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
      removeWithTooltips(menu);
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

export function getTouchClickCoordinates(event: any, relativeToPage = false) {
  event = (event.originalEvent || event);
  let x: number;
  let y: number;

  if(event.type === 'touchstart' || event.type === 'touchmove' || event.type === 'touchend' || event.type === 'touchcancel') {
    const touch = event.touches[0] || event.changedTouches[0];
    x = relativeToPage ? touch.pageX : touch.clientX;
    y = relativeToPage ? touch.pageY : touch.clientY;
  }
  else if(event.type === 'mousedown' || event.type === 'mouseup' || event.type === 'mousemove' || event.type === 'mouseover' || event.type === 'mouseout' || event.type === 'mouseenter' || event.type === 'mouseleave' || event.type === 'contextmenu') {
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
 * (including the ancestor), as well as the siblings of each element.
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
    if(descendant !== currElem)
      remHeight += currElem.outerHeight(true) - currElem.height();
    if((!excludeSiblings || !currElem.is(excludeSiblings)) && !currElem.is('[class*="col-"]')) {
      const siblings = currElem.siblings();
      siblings.each(function() {
        if($(this).is(':visible') && $(this).css('position') !== 'absolute' && $(this).css('position') !== 'fixed')
          remHeight += $(this).outerHeight(true);
      });
    }
    currElem = currElem.parent();
  }
  remHeight += currElem.outerHeight(true) - currElem.height();

  return remHeight;
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