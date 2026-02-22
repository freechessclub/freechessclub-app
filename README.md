# Free Chess Club: A modern web client for FICS.

Free Chess Club is a modern interface for the [Free Internet Chess Server (FICS)](https://freechess.org/) — one of the oldest internet chess servers with over 800,000 registered accounts.

You can try out the interface here: [Free Chess Club](http://www.freechess.club/play).

In addition to the hosted web interface, there are cross-platform [Electron](https://www.electronjs.org/)-based desktop apps (under [Releases](https://github.com/freechessclub/freechessclub-app/releases)) and [Capacitor](https://capacitorjs.com/)-based mobile apps that you can access from the mobile app stores.

To get started locally, just type:
```bash
$ yarn start
```
and point your browser to http://localhost:8080

## Release automation (maintainers)

This repository uses GitHub Actions for desktop and Android releases.

### Electron releases

- Workflow: `.github/workflows/release-electron.yml`
- Trigger: push to `master` with changes to `package.json` where version changed, or manual run.
- Behavior: builds per runner OS (macOS/Windows/Linux) and publishes assets to GitHub Releases via the built-in `GITHUB_TOKEN`.

### Android releases (Google Play)

- Workflow: `.github/workflows/release-android.yml`
- Trigger:
	- Push to `master` with `package.json` version bump: builds Android AAB and routes to `production` publish job.
	- Manual run (`workflow_dispatch`): choose `internal`, `alpha`, `beta`, or `production` track.
- Safety gate: production publishing uses GitHub Environment `production`.
	- Configure required reviewers under: repo Settings → Environments → `production`.
	- Result: production deploy requires explicit approval before publishing.

### Required GitHub Secrets (Actions)

Add these in repo Settings → Secrets and variables → Actions:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `PLAY_SERVICE_ACCOUNT_JSON`

### Notes

- Android CI reuses the existing Capacitor flow via scripts:
	- `yarn android:sync`
	- `yarn android:bundle`
	- `yarn android:ci`
- Manual non-production publishes are useful for staged testing before approving production.
