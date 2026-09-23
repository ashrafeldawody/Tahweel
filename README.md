# Tahweel (تحويل)

**Turn a spare Android phone into a payment gateway for your mobile wallet.**

Personal wallets such as Vodafone Cash, e& money or Orange Cash have no merchant API, but every transfer you receive arrives as an SMS from the operator. Tahweel makes that SMS usable by software: an Android phone holding the wallet SIM forwards every SMS to a server you run, the server checks that the receipt really came from the operator, matches it against a **payment intent** your system registered, and sends your backend a **signed webhook**.

- **Self-hosted.** One container, no cloud, no account, no telemetry. Your data never leaves your server.
- **Gateway-style API.** `POST /api/v1/intents`, receive `payment.matched`. Swagger UI and a Postman collection included.
- **Dashboard.** Devices, every SMS with its verdict, intents, webhook deliveries, settings, manual matching.
- **New wallets are one file.** A parser plus sample messages.

```
customer pays 200 EGP ──▶ operator SMS ──▶ Listener phone ──▶ Tahweel server ──▶ webhook ──▶ your system
```

## Quickstart

**1. Run the server**

```bash
export INGEST_TOKEN=$(openssl rand -hex 32) API_KEY=$(openssl rand -hex 32) ADMIN_PASSWORD='choose-a-long-password'
docker run -d --name tahweel --restart unless-stopped \
  -p 3000:3000 -v tahweel-data:/app/data \
  -e INGEST_TOKEN -e API_KEY -e ADMIN_PASSWORD \
  ghcr.io/ashrafeldawody/tahweel:latest
echo "phone token: $INGEST_TOKEN"
```

Open `http://localhost:3000/` and log in with `ADMIN_PASSWORD`. Swagger is at `/docs`. Compose, PostgreSQL, HTTPS and every setting: [docs/deploy.md](docs/deploy.md).

**2. Install the app on the phone**

Download `tahweel-listener-<version>-release.apk` from the [latest release](https://github.com/ashrafeldawody/Tahweel/releases/latest), open it, enter your server URL and `INGEST_TOKEN`, tap **Grant everything** and **Test connection**. The phone appears under **Devices**.

**3. Create a payment intent from your backend**

```bash
curl -X POST http://localhost:3000/api/v1/intents \
  -H "X-Api-Key: $API_KEY" -H "content-type: application/json" \
  -d '{"reference":"order-1001","amount":200,"sender_phone":"01061916846","expires_in_minutes":120}'
```

When the customer's transfer arrives, Tahweel POSTs `payment.matched` to your webhook (set it on the dashboard's Settings page). See [docs/webhooks.md](docs/webhooks.md) to verify the signature.

## Play Protect blocked the install?

The app needs the `RECEIVE_SMS` permission, so Google Play Protect often blocks the APK with **"App blocked to protect your device"**. Install it over USB with ADB instead; Play Protect does not scan ADB installs.

1. **Enable Developer options:** Settings → About phone (→ Software information on Samsung) → tap **Build number** 7 times.
2. **Enable USB debugging:** Settings → Developer options → **USB debugging** on. On Samsung (One UI 6+) also turn off Settings → Security and privacy → **Auto Blocker**.
3. **Install ADB on your computer:** `winget install Google.PlatformTools` (Windows), `brew install android-platform-tools` (macOS) or `sudo apt install adb` (Linux).
4. **Connect the phone by USB**, run `adb devices`, and tap **Allow** on the phone's *Allow USB debugging?* prompt.
5. **Install:**
   ```bash
   adb install -r tahweel-listener-<version>-release.apk
   ```

Wireless debugging, troubleshooting and the alternative (pausing Play Protect for a minute) are in [docs/listener.md](docs/listener.md#installing-with-adb). Afterwards, go through the phone checklist there (battery settings, no screen lock, charger) so the phone never stops forwarding SMS.

## Documentation

| Guide | What's inside |
|---|---|
| [How it works](docs/how-it-works.md) | Architecture, matching rules, limits, roadmap |
| [API](docs/api.md) | Intents, polling, ingest protocol, admin API |
| [Webhooks](docs/webhooks.md) | Events, headers, retries, signature verification (Node, PHP) |
| [Listener app](docs/listener.md) | Building, installing with ADB, phone setup checklist, operating |
| [Deployment](docs/deploy.md) | Environment variables, Docker, PostgreSQL, reverse proxy, backups, releases |
| [Security](docs/security.md) | Where your data goes, credentials, trust gates |
| [Parsers](docs/parsers.md) | Adding a new wallet's SMS format |
| [Development](docs/development.md) | Repository layout, tests, CI |
| [Postman](postman/README.md) | Ready-made collection for the API |

## License

MIT, © Ashraf Eldawody. See [LICENSE](LICENSE).
