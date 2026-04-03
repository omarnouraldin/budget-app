# 学生バジェット

A minimal budgeting app for students in Japan.  
Hosted on GitHub Pages. Data saved to localStorage on your device.

## 🚀 Deploy to GitHub Pages (one-time setup)

### 1. Create a GitHub repo

Go to https://github.com/new and create a **public** repo called `budget-app` (or any name you like).

### 2. Push this code

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/budget-app.git
git push -u origin main
```

### 3. Enable GitHub Pages

1. Go to your repo on GitHub
2. Click **Settings** → **Pages** (left sidebar)
3. Under **Source**, select **GitHub Actions**
4. Save

The GitHub Action will now build and deploy automatically on every push.  
Your app will be live at: `https://YOUR_USERNAME.github.io/budget-app/`

---

## 📱 Add to iPhone home screen

1. Open the URL in Safari
2. Tap the **Share** button (box with arrow)
3. Tap **"ホーム画面に追加"** (Add to Home Screen)
4. It will behave like a native app

---

## 💾 Data persistence

All data is saved to **localStorage** in your browser.  
This means:
- ✅ Persists between sessions on the same browser
- ✅ Works offline
- ⚠️ Data stays on this device/browser only
- ⚠️ Clearing browser data will erase it

**To back up your data manually:**  
Open browser console and run:
```javascript
JSON.stringify(localStorage)
```
Copy and save the output somewhere safe.

---

## 🛠️ Run locally

```bash
npm install
npm start
```

## 🏗️ Build

```bash
npm run build
```
