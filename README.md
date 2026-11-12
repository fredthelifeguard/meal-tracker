# Meal Tracker

A personal tracker for two numbers: **protein per meal** (goal 40 g at breakfast, lunch and supper) and
**fiber per day** (goal 35 g). Snacks are logged and count toward fiber, but not toward the meal targets.
Both goals can be changed in Settings.

It is built for one person on an iPhone: type what you ate, or tap a go-to or a recent food. There are no
calories on the main screen, no streaks and no warnings. A missed target is just a number.

## How it is put together

| Piece | Where it runs | What it holds |
|---|---|---|
| The app (`index.html`, `app.js`, `nutrition.js`, `styles.css`) | GitHub Pages, as an installable web app | No data, no keys |
| Your data | On each device, synced to a `Meal Tracker` folder in your Google Drive | Everything you log, plus every food ever looked up |
| Lookup service (`worker/worker.js`) | A Cloudflare Worker | The Claude and USDA keys, as encrypted secrets |

When you type a food, the app sends **only that text** to the lookup service. The service:

1. asks Claude to split the text into foods and amounts ("two Jimmy Dean snack size sausage biscuits" becomes
   2 × one biscuit),
2. searches [Open Food Facts](https://world.openfoodfacts.org) for packaged products and
   [USDA FoodData Central](https://fdc.nal.usda.gov) for generic foods,
3. has Claude pick the matching record and the weight of one unit, and
4. falls back to a Claude estimate when neither database has the food. Those entries are tagged **estimate**.

Every answer is saved with your data, so the same food is never looked up twice. Any number can be corrected
by hand; the correction is remembered for next time.

## Run it on this PC

```
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

Then open <http://localhost:8041/>. Drive sync only works from the published address, so locally the data
stays in that browser.

## Tests

The nutrition math lives in `nutrition.js` and is covered by `tests.js`. With the local server running, open
<http://localhost:8041/tests.html>. The page title and heading show the result ("All 32 tests passed").

## One-time setup

### 1. Lookup service (Cloudflare)

The Worker `meal-tracker-lookup` runs the code in `worker/worker.js`. To change it, open the Worker in the
Cloudflare dashboard, choose **Edit code**, paste the file and **Deploy**.

It needs three secrets under **Settings > Variables and Secrets** (type **Secret**):

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `USDA_API_KEY` | Your free key from <https://fdc.nal.usda.gov/api-key-signup> |
| `APP_KEY` | A passphrase you make up. The app must send it with every lookup. |

Then open the app, go to **Settings > Food lookup**, enter the same passphrase and tap **Check connection**.
The passphrase syncs to your other devices through Google Drive.

The keys are never in this repository or in the browser. It is also worth setting a monthly spend limit on
the Claude key in the Anthropic Console.

If the Worker's address changes, update `lookupUrl` in `config.js`. If the app's address changes, update
`ALLOWED_ORIGINS` at the top of `worker/worker.js`.

### 2. Publish the app (GitHub Pages)

Push this folder to a GitHub repository, then under **Settings > Pages** choose "Deploy from a branch",
branch `main`, folder `/ (root)`. The app appears at `https://YOUR-USERNAME.github.io/meal-tracker/`.

### 3. Google Drive sync

The app reuses the Google OAuth client from the 40K inventory app (`googleClientId` in `config.js`). In
[Google Cloud Console](https://console.cloud.google.com/) under **Google Auth Platform > Clients**, open that
client and add this **Authorised redirect URI**:

```
https://YOUR-USERNAME.github.io/meal-tracker/
```

Then tap **Settings > Connect Drive** in the app, once on each device. Changes save on the device straight
away and reach Drive a few seconds later. If two devices change things, the newest edit to each entry wins.

### 4. Install on the iPhone

Open the published address in Safari, tap **Share > Add to Home Screen**, then open it from the icon.

## Using it

- **Log**: pick the meal (it guesses from the time of day), then type a food or tap a go-to or recent food.
- **Adjust**: tap anything in the log to change the portion (half, full, double), leave out or swap an
  ingredient for that day only, move it to another meal, or correct the numbers.
- **Go-tos**: build one on the Go-tos tab by adding ingredients with amounts, or tap **Save as go-to** next to
  any meal you have logged. Editing a go-to never changes what you already logged.
- **Also track**: water, meal times, portion notes, weight, medication dose day and side effects are off by
  default. Turn them on in Settings and they appear on a separate Health tab.
- **Export**: Settings > Export for appointments gives a printable summary or CSV files for a date range.
  **Send to Claude** copies the same data as text, to paste into a Claude chat.

## Files

```
index.html, styles.css   the screens
app.js                   storage, lookups, Drive sync, and the interface
nutrition.js             the math: totals, goals, parsing, merge, export
tests.html, tests.js     tests for nutrition.js
config.js                lookup address and Google client ID (not secret)
sw.js, manifest.webmanifest, icon-*.png   install and offline support
worker/worker.js         the Cloudflare lookup service
tools/serve.ps1          local test server
```
