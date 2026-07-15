// Copyright 2024 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import Cookies from 'js-cookie';
import { logError, isFirefox, isCapacitor, isElectron } from './utils';

const { SecureStorage } =
  isCapacitor()
    ? await import('@aparajita/capacitor-secure-storage')
    : { SecureStorage: null };

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
    let username: string;
    let password: string;
    const requirePassword = storage.get('require-password');
    let secureStorageMethod = false;

    if(requirePassword) {
      if(isElectron()) {
        secureStorageMethod = true;
        username = storage.get('user');
        const encryptedPassword = storage.get('pass');
        if(encryptedPassword) {
          try {
            password = await electron.decrypt(encryptedPassword);
          } catch (error) {
            logError('Error decrypting password:', error.name, error.message);
          }
        }
      }
      else if(isCapacitor()) {
        username = storage.get('user');
        if(username) {
          try {
            const value = await SecureStorage.get('password');
            password = value as string;
            secureStorageMethod = true;
          }
          catch(error) {
            logError('Error retrieving stored password:', error.name, error.message);
          }
        }
      }
      else if('PasswordCredential' in window && storage.get('password-credential-api') === 'true') {
        try {
          // login/password when they aren't stored already
          const credential = await navigator.credentials.get({ password: true } as CredentialRequestOptions) as any;
          if(credential instanceof (window as any).PasswordCredential) {
            username = credential.id;
            password = credential.password;
          }
          secureStorageMethod = true;
        }
        catch (error) {
          logError('Error retrieving stored password:', error.name, error.message);
        }
      }
      else if(isFirefox())
        secureStorageMethod = true; // We rely on Firefox's Password Manager to autofill the login/password form on page load
    }

    if(password == null) {
      username = storage.get('user');
      const loginFormUser = $('#login-user').val() as string; // get password from login form autofill (Firefox)
      if(loginFormUser && loginFormUser === username)
        password = $('#login-pass').val() as string;
      else if(!requirePassword)
        password = '';
    }

    const unsecurePass = storage.get('pass');
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
        const encryptedPassword = await electron.encrypt(password);
        storage.set('pass', encryptedPassword);
        return;
      }
      catch (error) {
        logError('Error encrypting password:', error.name, error.message);
      }
    }
    else if(isCapacitor()) {
      try {
        await SecureStorage.set('password', password);
        return;
      }
      catch (error) {
        logError('Error storing password:', error.name, error.message);
      }
    }
    else if('PasswordCredential' in window) {
      if(password) {
        try {
          const passwordCredential = new (window as any).PasswordCredential({ id: username, password });
          await navigator.credentials.store(passwordCredential);
          storage.set('password-credential-api', 'true');
          return;
        }
        catch (error) {
          logError('Error storing password:', error.name, error.message);
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
      try { await SecureStorage.remove('password'); }
      catch (error) {
        logError('Error clearing password:', error.name, error.message);
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
      const { keys } = await Capacitor.Plugins.Preferences.keys();
      for(const key of keys) {
        try {
          const { value } = await Capacitor.Plugins.Preferences.get({ key });
          this.cache[key] = value;
        }
        catch(error) {
          logError('Error getting Capacitor Preference:', error.name, error.message);
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
        await Capacitor.Plugins.Preferences.set({key: name, value});
        return;
      }
      catch(error) {
        logError('Error setting Capacitor Preference:', error.name, error.message);
      }
    }
    localStorage.setItem(name, value);
  }

  /**
   * Tries to lookup name from cache (always for Capacitor) otherwise gets it from localStorage.
   * If still not found checks if there is a matching cookie.
   */
  public get(name: string): string {
    let value = this.cache[name];
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
        await Capacitor.Plugins.Preferences.remove({ key: name });
      }
      catch(error) {
        logError('Error removing Capacitor Preference:', error.name, error.message);
      }
    }
    Cookies.remove(name);
    localStorage.removeItem(name);
  }
}

export class IDBStorage {
  private readonly dbName = "FreeChessClub";
  private readonly version = 1;

  private db?: IDBDatabase;
  private opening?: Promise<IDBDatabase>;

  private async open(): Promise<IDBDatabase> {
    if(this.db) 
      return this.db;

    if(this.opening) 
      return this.opening;
   
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = () => {
        const db = request.result;

        // Create object stores here as the schema evolves
        if(!db.objectStoreNames.contains("explorer")) 
          db.createObjectStore("explorer");
      };

      request.onsuccess = () => {
        const db = request.result;

        db.onversionchange = () => {
          db.close();
          this.db = undefined;
        };

        this.db = db;
        this.opening = undefined;

        resolve(db);
      };

      request.onerror = () => {
        this.opening = undefined;
        reject(request.error);
      };
    });

    return this.opening;
  }

  async get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    const [result] = await this.getMany<[T]>(storeName, [key]);
    return result;
  }

  async getMany<T extends unknown[]>(storeName: string, keys: IDBValidKey[]): Promise<T> {
    const db = await this.open();

    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);

      const results = new Array(keys.length) as T;

      let remaining = keys.length;

      if(remaining === 0) {
        resolve(results);
        return;
      }

      keys.forEach((key, index) => {
        const request = store.get(key);

        request.onsuccess = () => {
          results[index] = request.result;

          remaining--;
          if(remaining === 0) 
            resolve(results);
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    });
  }

  async put(storeName: string, key: IDBValidKey, value: unknown): Promise<void> {
    return this.putMany(storeName, [
      [key, value]
    ]);
  }

  async putMany(storeName: string, entries: [IDBValidKey, unknown][]): Promise<void> {
    const db = await this.open();

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      for (const [key, value] of entries) 
        store.put(value, key);

      tx.oncomplete = () => { resolve(); };
      tx.onerror = () => { reject(tx.error); };
      tx.onabort = () => { reject(tx.error); };
    });
  }

  async delete(storeName: string, key: IDBValidKey): Promise<void> {
    return this.deleteMany(storeName, [key]);
  }

  async deleteMany(storeName: string, keys: IDBValidKey[]): Promise<void> {
    const db = await this.open();

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      for(const key of keys)
        store.delete(key);
      
      tx.oncomplete = () => { resolve(); };
      tx.onerror = () => { reject(tx.error); };
      tx.onabort = () => { reject(tx.error); };
    });
  }

  close(): void {
    if(this.db) {
      this.db.close();
      this.db = undefined;
    }
  }
}

/** ******************************************* 
 * Awaiting states class. 
 * Used to keep track of commands sent to the server and their corresponeding responses from the server
 **********************************************/

export class Awaiting {
  private states: Map<string, number> = new Map(); 

  /** 
   * Return the counter for the specified state 
   */
  public count(state: string) {
    return this.states.get(state) || 0;
  }

  /**
   * Increments the counter for the specified state 
   */
  public set(state: string) {
    const count = this.states.get(state);
    if(count === undefined)
      this.states.set(state, 1);
    else
      this.states.set(state, count + 1);
  }

  /** 
   * Check if we are waiting for a state to be resolved and decrements its counter
   * @return true if we are awaiting resolution of the specified state
   */
  public resolve(state: string): boolean {
    const count = this.states.get(state);
    if(count === undefined)
      return false;

    if(count - 1 === 0)
      this.states.delete(state);
    else
      this.states.set(state, count - 1);

    return true;
  }

  /**
   * Check if we are waiting for a state to be resolved (without resolving it)
   */
  public has(state: string): boolean {
    return this.states.has(state);
  }

  /**
   * Stop awaiting the specified state. Effectively sets its counter to 0.
   */
  public remove(state: string) {
    this.states.delete(state);
  }

  /**
   * Stop awaiting all states
   */
  public clearAll() {
    this.states = new Map();
  }
}

export const storage = new Storage(); // The main Storage instance, declared here so it can be imported the other modules
export const idbStorage = new IDBStorage();
export const awaiting = new Awaiting();
