// Copyright 2026 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

import { getBaseUrl } from './utils';
import { OAuth2AuthCodePKCE, RECOMMENDED_STATE_LENGTH } from "@bity/oauth2-auth-code-pkce";

/**
 * Handles Lichess OAuth and API requests
 */
export class LichessClient {
  private token: string | null; // OAuth token
  private tokenPromise: Promise<string> | null = null;

  constructor() {
    this.token = localStorage.getItem("lichess_access_token");
  }

  /**
   * Gets the current OAuth token if there is one
   */
  private getToken(): Promise<string> {
    if(this.token)
      return Promise.resolve(this.token);

    if(!this.tokenPromise)
      return Promise.reject(new LichessAuthError());

    return this.tokenPromise;
  }

  /**
   * Fetch the API endpoint specified by url
   */
  public async get(url: string): Promise<Response> {
    const token = await this.getToken();

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if(response.status === 401) { // token expired
      this.invalidateToken();
      throw new LichessAuthError();
    }

    if(!response.ok) {
      throw new Error(`Lichess API error: ${response.status}`);
    }

    return response;
  }

  /**
   * Make an authorization request. Shows the OAuth consent page / login page in a popoup. 
   * @returns OAuth token
   */
  public auth(): Promise<string> {
    if(this.tokenPromise)
      return this.tokenPromise;

    this.tokenPromise = new Promise<string>(async (resolve, reject) => {
      const { codeChallenge, codeVerifier } =
        await OAuth2AuthCodePKCE.generatePKCECodes();

      const OAuthState =
        OAuth2AuthCodePKCE.generateRandomState(RECOMMENDED_STATE_LENGTH);

      // The popup redirects back to our callback page when OAuth is successful. That page then 
      // closes the popup and uses a BroadcastChannel to send the authorisation code to our app.
      const redirectUri = new URL(
        "lichess-oauth-callback.html", 
        getBaseUrl()
      ).href;

      // Create autherization request
      const authUrl =
        "https://lichess.org/oauth?" +
        new URLSearchParams({
          response_type: "code",
          client_id: "FreeChessClub",
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          state: OAuthState
        });

      // Popup size
      const width = 600;
      const height = 700;

      // Popup position
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const OAuthChannel = new BroadcastChannel("lichess-oauth");

      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        OAuthChannel.close();
      };

      // Message handler to receive authorisation code from our callback page
      OAuthChannel.addEventListener("message", async (event) => {
        if(event.data.type !== "lichess-auth-result")
          return;
       
        cleanup();

        if(event.data.state !== OAuthState) {
          reject(new Error("Invalid state"));
          return;
        }

        try {
          const token = await this.exchangeCodeForToken(event.data.code, codeVerifier);

          localStorage.setItem("lichess_access_token", token);
          this.token = token;

          resolve(token);
        }
        catch (e) {
          reject(e);
        }
      });

      const popup = window.open(
        authUrl,
        "lichess-login",
        `width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`
      );

      if(!popup) {
        cleanup();
        reject(new Error("Unable to open OAuth popup"));
        return;
      }

      // If the user closes the popup without authenticating, we have no way of knowing.
      // (COOP header prevents us inspecting popup). So just give up after a few minutes.
      timer = setTimeout(() => {
        cleanup();
        reject(new LichessAuthTimeoutError());
      }, 15 * 60 * 1000);
    }).finally(() => {
      this.tokenPromise = null;
    });

    return this.tokenPromise;
  }

  /**
   * If the token no longer works, invalidate it so we can request authorisation again. 
   */
  private invalidateToken() {
    this.token = null;
    localStorage.removeItem("lichess_access_token");
  }

  /**
   * Exchange authorisation code for token
   * @param code authorisation code
   * @param codeVerifier PKCE code verifier 
   * @returns token
   */
  private async exchangeCodeForToken(code: string, codeVerifier: string): Promise<string> {
    const redirectUri = new URL(
      "lichess-oauth-callback.html",
      getBaseUrl()
    ).href;

    const response = await fetch("https://lichess.org/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "FreeChessClub",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
      })
    });

    if(!response.ok) {
      throw new Error(
        `Token exchange failed: ${response.status} ${await response.text()}`
      );
    }

    const data = await response.json();
    return data.access_token;
  }
}

// If you try to make an API request before authorization
export class LichessAuthError extends Error {
  constructor() {
    super("Lichess authentication required");
    this.name = "LichessAuthError";
  }
}

// If the authorization popup is closed or expires 
export class LichessAuthTimeoutError extends Error {
  constructor() {
    super("Lichess authentication timed out");
    this.name = "LichessAuthTimeoutError";
  }
}