# 🌿 Ocealgo Team Dashboard

A mobile-first team management app for Ocealgo — built with React + TypeScript + Firebase.

---

## 🗂️ Project Structure

```
ocealgo-app/
├── src/
│   ├── pages/
│   │   ├── RoleSelect.tsx        # Landing screen — pick who you are
│   │   ├── sales/SalesView.tsx   # Murali & Santhosh daily check-in
│   │   ├── marketing/MarketingView.tsx  # May content calendar tracker
│   │   └── admin/AdminDashboard.tsx     # Founders overview
│   ├── hooks/useFirebase.ts      # All Firestore read/write logic
│   ├── firebase.ts               # Firebase init
│   ├── data.ts                   # May content calendar data
│   ├── types.ts                  # TypeScript interfaces
│   ├── App.tsx
│   └── main.tsx
├── .env.example
├── index.html
├── package.json
└── vite.config.ts
```

---

## 🚀 Setup Guide (Step by Step)

### STEP 1 — Get the code on your machine

Open VS Code terminal and run:

```bash
# 1. Clone the repo (after you push it)
git clone https://github.com/YOUR_USERNAME/ocealgo-app.git
cd ocealgo-app

# 2. Install dependencies
npm install
```

---

### STEP 2 — Set up Firebase

1. Go to **https://console.firebase.google.com**
2. Click **"Add project"** → name it `ocealgo-app`
3. Disable Google Analytics (not needed) → **Create project**

**Enable Firestore:**
1. Left sidebar → **Firestore Database** → **Create database**
2. Choose **"Start in test mode"** → select region **asia-south1 (Mumbai)** → Enable

**Get your config:**
1. Left sidebar → ⚙️ **Project Settings** → **General**
2. Scroll to "Your apps" → click **`</>`** (Web app)
3. Register app as `ocealgo-web`
4. Copy the `firebaseConfig` object — you'll need these values

---

### STEP 3 — Set up environment variables

```bash
# In your project folder, create .env file
cp .env.example .env
```

Open `.env` and fill in your Firebase values:

```env
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=ocealgo-app.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=ocealgo-app
VITE_FIREBASE_STORAGE_BUCKET=ocealgo-app.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123:web:abc123
```

> ⚠️ NEVER commit your `.env` file — it's already in `.gitignore`

---

### STEP 4 — Run locally

```bash
npm run dev
```

Open **http://localhost:5173** in your browser. The app should load! 🎉

---

### STEP 5 — Push to GitHub

```bash
# 1. Create a new repo on github.com named "ocealgo-app"

# 2. In your project folder:
git init
git add .
git commit -m "🌿 Initial commit — Ocealgo Team Dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ocealgo-app.git
git push -u origin main
```

---

### STEP 6 — Deploy to Vercel

1. Go to **https://vercel.com** → Sign in with GitHub
2. Click **"Add New Project"**
3. Import your `ocealgo-app` repo
4. In **"Environment Variables"**, add all 6 variables from your `.env` file
5. Click **Deploy** 🚀

Your app will be live at: **https://ocealgo-app.vercel.app**

> Every time you `git push`, Vercel auto-deploys the latest version!

---

### STEP 7 — Set up Firestore Security Rules

In Firebase Console → Firestore → **Rules** tab, paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /checkins/{doc} {
      allow read, write: if true;
    }
    match /post_statuses/{doc} {
      allow read, write: if true;
    }
  }
}
```

> This is open access for now. You can add authentication later.

---

## 🌿 How to Share with Team

Once deployed, just share the Vercel URL on WhatsApp:

> "Open this link on your phone: https://ocealgo-app.vercel.app
> Tap your name to get started!"

No app install needed. Works on any phone browser. ✅

---

## 🛠️ Tech Stack

| Layer      | Technology                  |
|------------|-----------------------------|
| Frontend   | React 18 + TypeScript       |
| Build Tool | Vite 5                      |
| Backend    | Firebase Firestore          |
| Hosting    | Vercel                      |
| Styling    | Inline styles (no CSS deps) |

---

## 🔮 Coming Soon

- [ ] Inventory tracker module
- [ ] Founders notes board
- [ ] Monthly plan PDF/Excel upload
- [ ] Push notifications for missed check-ins
- [ ] Firebase Authentication (PIN-based)
