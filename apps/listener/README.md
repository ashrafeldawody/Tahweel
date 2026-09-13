# Tahweel Listener

A small Android app that runs on a spare phone holding the SIM card that receives mobile-wallet SMS receipts. Every incoming SMS is queued in a local SQLite database and forwarded to your own Tahweel server (`POST /ingest/sms`), which parses it and confirms the matching payment. A heartbeat (`POST /ingest/heartbeat`) every 60 seconds lets the server show the phone's battery, network and queue depth.

Nothing leaves the phone except to the server URL you configure. There is no third-party service.

## Build

Requirements: JDK 17 or newer (the Android Studio JBR works) and an Android SDK with platform 35.

```
# Windows
powershell -ExecutionPolicy Bypass -File scripts/build-listener.ps1
powershell -ExecutionPolicy Bypass -File scripts/build-listener.ps1 -Debug
powershell -ExecutionPolicy Bypass -File scripts/build-listener.ps1 -Install

# Linux / macOS
scripts/build-listener.sh
scripts/build-listener.sh --debug
scripts/build-listener.sh --install
```

The APK lands in `apps/listener/app/build/outputs/apk/release/tahweel-listener-<version>-release.apk`. Release builds are signed with the debug key unless `apps/listener/keystore.properties` exists with `storeFile`, `storePassword`, `keyAlias` and `keyPassword`.

## Install

Copy the APK to the phone (or use `--install` / `-Install` with the phone connected over adb) and open it. Enter the server URL, the ingest token (`INGEST_TOKEN` on the server), an optional device name, then tap **Save** and **Test connection**.

## Setup checklist

The phone must never stop delivering SMS. Go through every item once:

- Grant every permission on the main screen until all rows are green (SMS, notifications, battery optimisation).
- Samsung: Settings → Battery → Background usage limits → **Never sleeping apps** → add Tahweel Listener.
- Samsung: turn off **Adaptive battery** and **Put unused apps to sleep**.
- Open Recents, tap the app icon and choose **Lock this app** so it survives "clear all".
- Remove the SIM PIN so the modem comes back on its own after a reboot.
- Use no screen lock (or a plain swipe) so the app can restart after an unattended reboot.
- Turn off any scheduled auto-restart or "optimise device" features.
- Keep the phone plugged in on a charger with a stable Wi-Fi or mobile-data connection.
- Tap **Start / restart service** and confirm the status shows *Running* and a recent heartbeat.

## Screens

- **Main**: server settings, permission checklist with a "Grant everything" shortcut, service control, inbox import (last 200 messages, with confirmation) and live status.
- **Debug: inbox**: the last 100 inbox messages with their upload state; send any one of them, or a custom message, and see how the server parsed it.
- **Logs**: a persistent ring buffer of the last 3000 log lines with refresh, copy, share and clear.
