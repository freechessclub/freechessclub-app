// Copyright 2024 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Cookies from 'js-cookie';

/**
 * Cross-platform secure, persistent credential (password) storage.
 * For supported browsers (only Chrome/Opera/Edge as of 2024), stores the user's login/password using
 * PasswordCredential API. For all other platforms the username is stored as a cookie and the password
 * is stored as follows -- In Electron the password is ecnrypted using safeStorage. For Capacitor apps the
 * password is stored using the community secure-storage-plugin. For Firefox we rely on the browser's
 * Password Manager to save and autofill the login form on page load. For all other browsers the password
 * is stored as a cookie (for lack of a better option).
 */
export class CredentialStorage {
  private _username: string;
  private _password: string;

  /**
   * Return the username. This should only be called after using retrieve() to get the username/password
   * out of secure storage
   */
  public get username(): string {
    return this._username;
  }

  /**
   * Return the password. This should only be called after using retrieve() to get the username/password
   * out of secure storage
   */
  public get password(): string {
    return this._password;
  }

  /**
   * Retrieve the username/password out of secure storage. This should be called when the app has loaded.
   * This function should only be called once. After which the username/password can be returned
   * using username and password getters
   */
  public async retrieve() {
    var username = undefined, password = undefined;
    var requirePassword = storage.get('require-password');
    var secureStorageMethod = false;

    if(requirePassword) {
      if(isElectron()) {
        secureStorageMethod = true;
        username = storage.get('user');
        var encryptedPassword = storage.get('pass');
        if(encryptedPassword) {
          try {
            password = await (window as any).electron.decrypt(encryptedPassword);
          } catch (error) {
            console.error('Error decrypting password:', error.name, error.message);
          }
        }
      }
      else if(isCapacitor()) {
        username = storage.get('user');
        if(username) {
          try {
            const { value } = await (window as any).Capacitor.Plugins.SecureStoragePlugin.get({ key: 'password' });
            password = value;
            secureStorageMethod = true;
          }
          catch(error) {
            console.error('Error retrieving stored password:', error.name, error.message);
          }
        }
      }
      else if('PasswordCredential' in window && storage.get('password-credential-api') === 'true') {
        try {
          // Note mediation: 'silent' stops the browser from prompting the user to enter their
          // login/password when they aren't stored already
          var credential = await navigator.credentials.get({ password: true } as CredentialRequestOptions);
          if(credential instanceof (window as any).PasswordCredential) {
            username = credential['id'];
            password = credential['password'];
          }
          secureStorageMethod = true;
        }
        catch (error) {
          console.error('Error retrieving stored password:', error.name, error.message);
        }
      }
      else if(isFirefox()) 
        secureStorageMethod = true; // We rely on Firefox's Password Manager to autofill the login/password form on page load
    }
    
    if(password == null) {
      username = storage.get('user');
      var loginFormUser = $('#login-user').val() as string; // get password from login form autofill (Firefox)
      if(loginFormUser && loginFormUser === username) 
        password = $('#login-pass').val() as string;
      else if(!requirePassword)
        password = '';
    }

    var unsecurePass = storage.get('pass');
    if(unsecurePass) {
      if(password == null) 
        password = atob(unsecurePass);    

      if(secureStorageMethod)
        await this.set(username, password); // Re-store the credential using a secure method 
    }

    $('#login-user').val('');
    $('#login-pass').val('');

    this._username = username;
    this._password = password;
  }

  /**
   * Store the username/password.
   */
  public async set(username: string, password: string) {
    await this.clear();
    this._username = username;
    this._password = password;

    storage.set('user', username);
    if(!password)
      return;

    storage.set('require-password', 'true');

    if(isElectron()) {
      try {
        var encryptedPassword = await (window as any).electron.encrypt(password);
        storage.set('pass', encryptedPassword);
        return;
      }
      catch (error) {
        console.error('Error encrypting password:', error.name, error.message);
      }
    }
    else if(isCapacitor()) {
      try {
        const plugins = (window as any).Capacitor.Plugins;
        const pluginNames = Object.keys(plugins).map(plugin => plugin);
        await (window as any).Capacitor.Plugins.SecureStoragePlugin.set({ key: 'password', value: password });
        return;
      }
      catch (error) {
        console.error('Error storing password:', error.name, error.message);
      }
    }
    else if('PasswordCredential' in window) {
      if(password) {
        try {
          const passwordCredential = new (window as any).PasswordCredential({ id: username, password: password });
          await navigator.credentials.store(passwordCredential);
          storage.set('password-credential-api', 'true');
          return;
        }
        catch (error) {
          console.error('Error storing password:', error.name, error.message);
        }
      }
    }
    else if(isFirefox()) // Firefox can autofill the login form on page load from its Password Manager
      return;

    // If we failed to store the password using a secure method, just store it as a cookie.
    if(password)
      password = btoa(password);
    storage.set('pass', password, { expires: 365 });
  }

  /**
   * Remove the username/password from all persistent storage
   */
  public async clear() {
    this._username = undefined;
    this._password = undefined;

    storage.remove('user');
    storage.remove('pass');
    storage.remove('require-password');
    storage.remove('password-credential-api');

    if(isCapacitor()) {
      try { await (window as any).Capacitor.Plugins.SecureStoragePlugin.remove({ key: 'password' }); }
      catch (error) {
        console.error('Error clearing password:', error.name, error.message);
      }
    }
  }
}

/**
 * Cross-platform persistent storage. For browsers and Electron apps, it uses localStorage.
 * For Capacitor (Android/iOS) apps it uses @capacitor/preferences plugin. This is because
 * localStorage is not persistent in WebView. If an options object is provided to the set()
 * function then it stores the key/value as a cookie instead using Cookies-js. Stored key/value pairs
 * are also cached. The async init() function should be called after creating a new instance.
 */
export class Storage {
  private cache: { [key: string]: string } = {};

  /** Should be called straight after creating a new Storage instance */
  async init() {
    if(isCapacitor()) {
      // Retrieve and cache all the Capacitor Preferences. This so we can make the get() function synchronous
      // even though Preferences is asynchronous.
      const { keys } = await (window as any).Capacitor.Plugins.Preferences.keys();
      for (const key of keys) {
        try {
          const { value } = await (window as any).Capacitor.Plugins.Preferences.get({ key });
          this.cache[key] = value;
        }
        catch(error) {
          console.error('Error getting Capacitor Preference:', error.name, error.message);
          break;
        }
      }
    }
  }

  /**
   *
   * Adds the name/value pair to persistent storage.
   * @param options If options object is specified then the name/value pair are stored as a cookie,
   * and the options such as 'expires' are passed to Cookies-js. Otherwise localStorage is used
   * or Preferences for Capacitor apps.
   */
  public async set(name: string, value: string, options?: any) {
    this.cache[name] = value;
    if(options) {
      Cookies.set(name, value, options);
      if(Cookies.get(name) !== undefined)
        return;
    }
    if(isCapacitor()) {
      try {
        await (window as any).Capacitor.Plugins.Preferences.set({key: name, value: value});
        return;
      }
      catch(error) {
        console.error('Error setting Capacitor Preference:', error.name, error.message);
      }
    }
    localStorage.setItem(name, value);
  }

  /**
   * Tries to lookup name from cache (always for Capacitor) otherwise gets it from localStorage.
   * If still not found checks if there is a matching cookie.
   */
  public get(name: string): string {
    var value = this.cache[name];
    if(value == null)
      value = localStorage.getItem(name);
    if(value == null)
      value = Cookies.get(name);
    if(value === undefined)
      value = null; // For consistency always return null when name not found

    return value;
  }

  /**
   * Removes the name/value pair from all persistent storage
   */
  public async remove(name: string) {
    delete this.cache[name];
    if(isCapacitor()) {
      try {
        await (window as any).Capacitor.Plugins.Preferences.remove({ key: name });
      }
      catch(error) {
        console.error('Error removing Capacitor Preference:', error.name, error.message);
      }
    }
    Cookies.remove(name);
    localStorage.removeItem(name);
  }
}

export var storage = new Storage(); // The main Storage instance, declared here so it can be imported the other modules

/**
 * Is this a Capacitor app?
 */
function isCapacitor() {
  return typeof window !== 'undefined' && (window as any).Capacitor !== undefined;
}

/**
 * Is this an Electron app?
 */
function isElectron() {
  return navigator.userAgent.toLowerCase().includes(' electron/');
}

/**
 * Is this a Firefox app 
 */
function isFirefox() {
  return navigator.userAgent.toLowerCase().includes('firefox');
}
