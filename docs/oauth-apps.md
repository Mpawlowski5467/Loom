# Built-in OAuth apps (one-click connect)

By default, a Loom user who wants Google, Outlook, or GitHub has to register
their own developer app and paste its credentials into **Settings → Connections**.
If you ship Loom to other people, you can register **one app per provider** and
configure it once. Users then get a single **Sign in with …** button.

| Provider | What you register | Settings to set | Secret needed? |
|---|---|---|---|
| Google (Calendar + Gmail) | OAuth client, type **Desktop app** | `LOOM_GOOGLE_CLIENT_ID`, `LOOM_GOOGLE_CLIENT_SECRET` | Yes. Google documents Desktop-client secrets as non-confidential; PKCE protects the flow |
| Microsoft (Outlook Calendar) | Entra app, **Mobile and desktop** platform | `LOOM_MICROSOFT_CLIENT_ID` | No (public client, PKCE) |
| GitHub | OAuth App with **Device Flow** enabled | `LOOM_GITHUB_CLIENT_ID` | No (device flow) |

How it behaves:

- **Unset providers keep the old flow.** For any provider you leave unset, users
  still see the bring-your-own-app flow exactly as before.
- **A user's own app always wins.** If a user saves their own client ID and
  secret, it is used instead of yours. Every card has a **Use your own OAuth app
  instead** link.
- **Tokens stay with the app that issued them.** A connection made through your
  app keeps refreshing through your app, even if the user later adds their own.
- **PKCE on every flow.** Every Google and Microsoft sign-in uses PKCE (S256).
  GitHub uses the device flow, the same one `gh auth login` uses.

Client IDs are public by design. None of these settings is a secret you need to
protect, apart from the usual care with the Google Desktop secret. **Never** use a
Google *Web application* client secret here.

---

## Google (Calendar + Gmail)

1. **Create a project and enable the APIs.** In the
   [Google Cloud console](https://console.cloud.google.com/), create a project
   (e.g. "Loom"). Enable the **Google Calendar API** and the **Gmail API**.
2. **Configure the consent screen.** Go to **APIs & Services → OAuth consent
   screen** (in newer consoles, **Google Auth Platform → Branding / Audience /
   Data access**):
   - User type: **External**.
   - App name, support email, and developer email: your choice.
   - Scopes: `https://www.googleapis.com/auth/calendar.readonly` and
     `https://www.googleapis.com/auth/gmail.readonly`.
   - While the app is in **Testing**, add each person who will use it under
     **Test users** (up to 100).
3. **Create the client.** Go to **Credentials → Create credentials → OAuth
   client ID**, and set **Application type: Desktop app**. Desktop clients accept
   loopback redirects on any port, so you don't register a redirect URI.
4. **Configure Loom.** Copy the client ID and secret into `LOOM_GOOGLE_CLIENT_ID`
   and `LOOM_GOOGLE_CLIENT_SECRET`.

Loom sends the redirect to the address the user opened Loom at, e.g.
`http://localhost:8000/api/automations/google/callback`. If Google answers with
`redirect_uri_mismatch`, open Loom at `http://127.0.0.1:8000` instead, which is
the loopback form Google documents.

### Limits to know before a public release

- **Testing mode logs users out weekly.** While the consent screen is in
  **Testing**, Google expires refresh tokens after **7 days**. Loom then shows
  "Google sign-in was revoked — reconnect your account", and users must sign in
  again every week until you publish the app.
- **Gmail needs a security assessment.** `gmail.readonly` is a **restricted**
  scope. Moving to **In production** for anyone beyond your test users requires
  Google's app verification *and* an annual third-party security assessment
  (CASA).
- **Calendar alone is lighter.** `calendar.readonly` is a **sensitive** scope,
  which needs verification but no assessment.
- **Unverified apps show a warning.** Until verified, users see an "unverified
  app" warning screen and must click through it.

---

## Microsoft (Outlook Calendar)

1. **Register the app.** In the
   [Microsoft Entra admin center](https://entra.microsoft.com/), go to
   **App registrations → New registration**:
   - Name: e.g. "Loom".
   - Supported account types: **Accounts in any organizational directory and
     personal Microsoft accounts**.
   - Redirect URI: platform **Public client/native (mobile & desktop)**, value
     `http://localhost/api/automations/calendar/outlook/callback`.
2. **Handle other addresses (optional).** Microsoft ignores the port on
   `localhost` redirect URIs for this platform, so Loom works on any port. If
   users open Loom at `127.0.0.1`, add
   `http://127.0.0.1/api/automations/calendar/outlook/callback` as well.
3. **Add permissions.** Under **API permissions**, add Microsoft Graph
   **delegated** permissions: `Calendars.Read` and `offline_access`
   (`User.Read` is added by default).
4. **Skip the secret.** Don't create a client secret; the app is a public
   client.
5. **Configure Loom.** Copy the **Application (client) ID** into
   `LOOM_MICROSOFT_CLIENT_ID`.

Some work or school tenants block users from consenting to third-party apps.
Their admin has to approve Loom once. Completing
[publisher verification](https://learn.microsoft.com/entra/identity-platform/publisher-verification-overview)
removes the "unverified" label from the consent screen.

---

## GitHub

1. **Create the app.** Go to **GitHub → Settings → Developer settings → OAuth
   Apps → New OAuth App**:
   - Application name: "Loom".
   - Homepage URL: your repository or site.
   - Authorization callback URL: required by the form but unused by the device
     flow. `http://localhost:8000` is fine.
2. **Enable the device flow.** After creating the app, tick **Enable Device
   Flow** and save.
3. **Configure Loom.** Copy the **Client ID** into `LOOM_GITHUB_CLIENT_ID`. No
   client secret is needed.

Loom requests **no scope** by default, which reads public repositories at the
authenticated rate limit. When a user ticks **Include private repositories**,
Loom requests `repo`. GitHub has no read-only version of that scope, but Loom
only ever reads. Organizations with OAuth app access restrictions must approve
Loom before their private repositories become visible. Personal access tokens
keep working, under **Use a personal access token instead**.

---

## Setting the values

- **Docker Compose:** put the values in `.env` next to `docker-compose.yml`.
  Compose passes `.env` into the container.
- **Running from source:** `.env` is **not** loaded automatically. Export the
  variables in the shell that starts `uvicorn`.

```bash
LOOM_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
LOOM_GOOGLE_CLIENT_SECRET=GOCSPX-...
LOOM_MICROSOFT_CLIENT_ID=00000000-0000-0000-0000-000000000000
LOOM_GITHUB_CLIENT_ID=Ov23li...
```

Restart Loom after changing them. **Settings → Connections** then shows the
one-click buttons. The API reports each provider's `builtin_app` flag on its
`GET /api/automations/...` endpoint.
