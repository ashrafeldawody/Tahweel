# Tahweel Listener (Android)

The listener is a small Kotlin app (`apps/listener`) that turns a spare Android phone into a durable SMS pipe. It knows nothing about wallets or matching: it forwards **every** incoming SMS to the server and lets the server decide.

## How it works

| Piece | Role |
|---|---|
| `SmsReceiver` | `SMS_RECEIVED` broadcast (priority 999). Joins multipart messages, computes `fingerprint = sha256(address\|body\|smsc_timestamp_ms)`, stores the message in a SQLite queue and starts the service. |
| `ForwarderService` | Foreground service (`specialUse` type, partial wake lock). Drains the queue in batches of 50 with exponential backoff (5 s → 5 min) and sends a heartbeat every 60 s. |
| `KeepAliveWorker` | WorkManager job every 15 minutes: uploads anything pending, restarts the service if it died. Also used as an expedited fallback when Android refuses a foreground start from the background. |
| `BootReceiver` | Restarts everything after boot / app update. |
| `Store` | SQLite: queue, sent fingerprints, 3000-line log ring buffer, stats. |
| `MainActivity` | Server URL, ingest token, device name; permission checklist with **Grant everything**; Start service; Test connection; live status. |
| `DebugActivity` | A free-text box to send a message and see the server's verdict (status, amount, sender). |
| `LogsActivity` | Persistent log with refresh / copy / share / clear. |

Protocol: `POST {server}/ingest/sms` and `POST {server}/ingest/heartbeat` with `Authorization: Bearer <INGEST_TOKEN>`; timestamps are ISO 8601 UTC. See [api.md](api.md#ingest-api-ingest).

## Building

Every tagged release ships a prebuilt `tahweel-listener-<version>-release.apk` on the [releases page](https://github.com/ashrafeldawody/tahweel/releases); building is only needed for local changes.

Requirements: a JDK 17+ (Android Studio's bundled JBR works, including JDK 25) and the Android SDK (platform 35, build-tools). Gradle 9.2.1 / AGP 8.13.2 / Kotlin 2.2.21 are pinned by the wrapper.

```powershell
scripts\build-listener.ps1            # release APK, signed with the debug key unless keystore.properties exists
scripts\build-listener.ps1 -Debug     # debug APK
scripts\build-listener.ps1 -Install   # also adb install -r on the connected phone
```

```bash
scripts/build-listener.sh [--debug] [--install]
```

Both scripts look for `JAVA_HOME`, then Android Studio's JBR; and for `ANDROID_HOME` / `ANDROID_SDK_ROOT`, then the default SDK folder. Output: `apps/listener/app/build/outputs/apk/release/tahweel-listener-<version>-release.apk`.

Release signing: create `apps/listener/keystore.properties` with `storeFile`, `storePassword`, `keyAlias`, `keyPassword` (all git-ignored). The release workflow writes the same file from the repository secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0 release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`; without them the published APK carries the debug signature, and phones cannot upgrade in place across a signature change, so set the secrets before the first release you hand to users.

The version comes from the `versionName` Gradle property (`./gradlew assembleRelease -PversionName=1.2.3`, which the release workflow derives from the tag) and defaults to `1.0.0`; `versionCode` is `major * 10000 + minor * 100 + patch` unless `-PversionCode` overrides it.

## Installing and configuring

1. Install the APK. It cannot come from the Play Store because of the `RECEIVE_SMS` permission, and for the same reason Google Play Protect blocks it when it is sideloaded from a browser, a chat app or a file manager ("App blocked to protect your device", often with no *Install anyway* button). Either of these gets past that:
   - **ADB** (recommended): enable Developer options → USB debugging on the phone, connect it, then `adb install -r tahweel-listener-<version>-release.apk` (`scripts/build-listener.ps1 -Install` does this for a local build). Play Protect does not intercept ADB installs.
   - **Pause Play Protect**: Play Store → profile icon → Play Protect → settings → turn off *Scan apps with Play Protect*, install the APK from the file manager (allow "unknown sources" when asked), turn scanning back on. If Play Protect later lists the app, choose *Keep*.

   A release-signed APK does not change this; the block is about the SMS permissions, not the signature.
2. Open the app, enter the server URL (`https://tahweel.example.com`), paste `INGEST_TOKEN`, set a device name, **Save**, **Test connection** (expects "Connected, server time …").
3. **Grant everything**: SMS (receive + read), notifications, ignore battery optimisation. The fourth row opens the vendor's background settings (Samsung: Battery → Background usage limits).
4. Samsung / One UI specifics: add the app to **Never sleeping apps**, turn **Adaptive battery** off, lock the app in Recents, disable **Auto restart** schedules.
5. **No screen lock**, **SIM PIN off**. After a reboot Android only delivers SMS to apps before the first unlock when the phone has no credential-encrypted lock.
6. Keep the phone on a charger with Wi-Fi and mobile data on. The notification "Tahweel listener · Listening" must stay visible.
7. Reboot once and check the Devices page: the heartbeat should resume within a minute.

## Operating

- **Debug: test message** answers "what does the server think of this message?" without waiting for a new SMS: paste the body, send, read the verdict.
- There is no inbox import. The app only holds `RECEIVE_SMS`, never `READ_SMS`, so it cannot read messages that arrived while it was not installed; after downtime, paste the missed receipts into the debug screen or match them by hand from the dashboard.
- **Logs → Share** is what to send when something looks wrong. The header contains app version, device id, server URL, queue size and the last error.
- When the dashboard shows the phone offline: charger, network, notification still present, then Logs.
- Rotating `INGEST_TOKEN`: change it on the server, then paste the new one in the app and Save. Queued messages are retried with the new token.

## Deliberate limits

No USSD, no reading of wallet-app notifications, no reading of the existing inbox (`READ_SMS`), no outgoing SMS, no root. One phone forwards one SIM's incoming SMS (dual-SIM phones report `sim_slot` but the server does not use it).
