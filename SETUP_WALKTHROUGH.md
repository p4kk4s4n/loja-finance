# GitHub & Firebase Setup Walkthrough

This guide covers every action you need to complete in **Firebase**, **Google Cloud** (optional AI/Sheets integrations), and **GitHub** to take **Loja Finance** live on GitHub Pages with real-time cross-user data continuity, automated payroll, and in-app auto-updates.

---

## Part 1 — Firebase Actions (Free Spark Tier)

> All features in Loja Finance are designed to fit within Firebase's **Spark (Free)** tier — no credit card required.

### 1.1 Create the Firebase Project
1. Sign in to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Create a project** (or **Add project**) and name it (e.g., `loja-finance`).
3. You may disable **Google Analytics** (not needed), then click **Create project**.

### 1.2 Enable Anonymous Authentication
Loja Finance keeps your simple **4-digit PIN** login screen while verifying your browser against Firebase Authentication via Anonymous Auth + SHA-256 hashed PINs.
1. In the left sidebar, open **Build → Authentication** and click **Get started**.
2. Under **Sign-in providers**, click **Anonymous**.
3. Toggle **Enable** on and click **Save**.
4. Later, after you know your GitHub Pages hostname (e.g., `your-username.github.io`), open **Authentication → Settings → Authorized domains → Add domain** and add `<your-username>.github.io`. *(Note: `localhost` and `127.0.0.1` are already authorized for local testing.)*

### 1.3 Create Cloud Firestore & Publish Rules
1. In the left sidebar, open **Build → Firestore Database** and click **Create database**.
2. Select a nearby location (e.g., `southamerica-east1` in São Paulo or `us-east1`), choose **Start in production mode**, and click **Create**.
3. Open the **Rules** tab at the top of the Firestore view.
4. Copy the entire contents of [`firestore.rules`](./firestore.rules) from this repository and paste it into the rules editor, replacing the default rules:
   - Requires `request.auth != null` on `config`, `teamMembers`, `dailySubmissions`, `expenses`, `receipts`, and `payrollRuns`.
5. Click **Publish**.

### 1.4 Register the Web App & Add Config to the Repo
1. Click the gear icon next to **Project Overview** → **Project settings**.
2. Under **General → Your apps**, click the **Web (`</>`)** icon.
3. Give the app a nickname (e.g., `Loja Finance Web`), leave **Firebase Hosting** unchecked, and click **Register app**.
4. Copy the `firebaseConfig` fields (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`).
5. Open [`js/firebase-config.js`](./js/firebase-config.js) in your repository and fill in `DEFAULT_FIREBASE_CONFIG`:
   ```js
   export const DEFAULT_FIREBASE_CONFIG = {
     apiKey: '...',
     authDomain: '...',
     projectId: '...',
     storageBucket: '...',
     messagingSenderId: '...',
     appId: '...'
   };
   ```
   *(Firebase Web App keys are public client identifiers — restricting Firestore with `firestore.rules` + Authorized Domains protects your database. NEVER commit Service Account private keys.)*

### 1.5 Generate a Firebase Service Account Key (For Automation & Migration)
Required if you want **GitHub Actions daily automated payroll / Google Sheets backup** or want to run the **one-time migration from your existing Google Sheet**.
1. In **Project settings**, open the **Service accounts** tab.
2. Click **Generate new private key** → **Generate key**.
3. Save the downloaded JSON file somewhere safe outside Git (if you place a copy temporarily in the repo folder for migration, name it `firebase-service-account.json` — `.gitignore` already excludes it, and delete the local copy afterward).

---

## Part 2 — Optional Legacy Google Sheets & Gemini AI Setup

### 2.1 Keep Your Google Sheet Connected (Migration + Daily Backup — No Apps Script)
1. Open [Google Cloud Console](https://console.cloud.google.com/) and make sure your Firebase project (`loja-finance`) is selected in the top project switcher.
2. Go to **APIs & Services → Library**, search for **Google Sheets API**, and click **Enable**.
3. Open your Google Sheet (for example `1G-TFhcsMCb6v4g19IjGIV6wMccDVXUyjgYJvwi3fO9Q`), click **Share**, and share it with **Editor** access to the `client_email` address found inside your Firebase Service Account JSON (e.g., `firebase-adminsdk-xxxxx@loja-finance.iam.gserviceaccount.com`).
   - Because this Service Account already has Google Cloud access once Google Sheets API is enabled, you do **not** need a second credentials file for GitHub Actions or migration unless you prefer separate accounts.

### 2.2 Run the One-Time Migration from Google Sheets to Firestore *(Optional)*
Requires **Node.js 20+** installed on your computer. From the repository folder:
```powershell
# 1. Install script dependencies locally
npm install --omit=dev

# 2. Preview row counts without writing to Firestore (--dry-run)
$env:SPREADSHEET_ID="1G-TFhcsMCb6v4g19IjGIV6wMccDVXUyjgYJvwi3fO9Q"
$env:FIREBASE_SERVICE_ACCOUNT="C:\path\to\firebase-service-account.json"
npm run migrate:dry

# 3. Commit migration into Firestore (Businesses, TeamMembers with SHA-256 PINs, DailySubmissions, Expenses)
npm run migrate
```
*(If you have no legacy data to import, skip this section! On first app launch with an empty `teamMembers` collection, Loja Finance automatically prompts you to create your first Admin user and 4-digit PIN.)*

### 2.3 Optional In-App "Sync to Google Sheets Now" & Gemini AI Receipt Scanner
1. **Manual browser Sheets Sync (Admin-only button in Settings)**:
   - In Google Cloud Console → **APIs & Services → Credentials → Create Credentials → OAuth client ID** → **Web application**.
   - Under **Authorized JavaScript origins**, add `https://<your-github-username>.github.io`.
   - Copy the **OAuth Client ID**. Inside the deployed Loja Finance app, log in as Admin → **Settings → Cloud, AI & Backup Integrations**, paste your **Google Spreadsheet ID** and **Google OAuth Client ID**, and click **Save Cloud & AI Keys**.
2. **Gemini 1.5 Flash AI Receipt & Z-Report Scanner**:
   - Generate an API key in [Google AI Studio](https://aistudio.google.com/).
   - In Google Cloud Console → **APIs & Services → Credentials**, restrict that key by **HTTP referrers** to `https://<your-github-username>.github.io/*`.
   - Paste it into **Settings → Cloud, AI & Backup Integrations → Gemini AI Key** inside Loja Finance and save.

---

## Part 3 — GitHub Actions, Hosting & Release Actions

### 3.1 Create the Repository & Push the Code
1. Create a new repository on [GitHub](https://github.com/new) named e.g. `Loja_Finance`.
   - **Tip**: Public repositories get unlimited GitHub Actions minutes and free GitHub Pages on all plans. Private repositories require a paid GitHub plan for GitHub Pages. Additionally, the in-app **Check for Updates** button calls GitHub's unauthenticated public Releases API (`api.github.com/repos/<owner>/<repo>/releases/latest`), so making the repo **Public** is recommended (your business financial data lives privately in Firestore, never in Git).
2. From `c:\Users\1214771\Documents\antigravity\Loja_Finance`, initialize Git and push `main` (make sure `js/firebase-config.js` already has your `DEFAULT_FIREBASE_CONFIG` filled in):
   ```powershell
   git init -b main
   git add .
   git commit -m "feat: reimagine Loja Finance as GitHub Pages PWA with Firebase"
   git remote add origin https://github.com/<your-username>/Loja_Finance.git
   git push -u origin main
   ```

### 3.2 Enable GitHub Pages (GitHub Actions Source)
1. Open your GitHub repository → **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions** *(do not choose "Deploy from a branch")*.
3. Check the **Actions** tab — `Deploy Loja Finance to GitHub Pages` will run the `tests/core.test.mjs` test suite and deploy your site to `https://<your-username>.github.io/Loja_Finance/`.
4. Remember to add `<your-username>.github.io` in **Firebase Console → Authentication → Settings → Authorized domains**!

### 3.3 Configure GitHub Repository Secrets (For Automated Daily Payroll & Sheets Backup)
1. In your GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret**.
2. Add these secrets used by [`.github/workflows/daily-cron.yml`](./.github/workflows/daily-cron.yml):
   | Secret Name | Required? | Value |
   | :--- | :--- | :--- |
   | `FIREBASE_SERVICE_ACCOUNT` | **Required** for daily payroll & Sheets cron | Entire raw JSON contents of the Firebase Service Account private key downloaded in Step 1.5 |
   | `SPREADSHEET_ID` | Optional (needed for automated Sheets backup) | Your Google Sheet ID (e.g. `1G-TFhcsMCb6v4g19IjGIV6wMccDVXUyjgYJvwi3fO9Q`) |
   | `GOOGLE_SHEETS_CREDENTIALS` | Optional (only if Sheets uses a different Service Account than Firebase) | Raw JSON of a separate GCP Service Account with Editor access to the Sheet. If omitted, `daily-cron.yml` reuses `FIREBASE_SERVICE_ACCOUNT` |
3. *(Optional first test)* Open **Actions → Daily Automated Payroll & Google Sheets Sync → Run workflow** to verify the cron script succeeds without waiting for `06:00 UTC` (`03:00 BRT`).

### 3.4 Publish Tagged Releases to Trigger In-App Auto-Updates
The in-app updater in **Settings → App Updates & Version** compares the installed version in `version.json` against your latest GitHub Release tag:
1. Make your code changes and push to `main`.
2. In GitHub, go to **Releases → Draft a new release**.
3. Click **Choose a tag** and type a semantic version tag matching `v*.*.*` (for your initial release, `v2.0.0`; for your next release, `v2.0.1` or `v2.1.0`).
4. Enter a release title and release notes, then click **Publish release**.
5. Publishing the release triggers [`.github/workflows/deploy-release.yml`](./.github/workflows/deploy-release.yml), which stamps `version.json` and the Service Worker cache version (`sw.js`) and redeploys GitHub Pages.
6. Within minutes (or immediately when clicking **Check for Updates** in Settings), installed users see the new version and either update automatically on safe idle screens or click **Update Now**.
