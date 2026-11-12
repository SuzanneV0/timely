# Timely

Time tracking and hourly reporting for freelancers. It runs as an installable web app (PWA) with no
dependencies and no build step, works offline, and keeps all data on your own device.

## Features

- **Timer** with Start, Pause/Resume, Stop & save, and Reset. A running timer survives closing the window.
- **Eastern Time** everywhere: every timestamp is recorded, displayed, and exported in US Eastern Time
  (`America/New_York`, so EST in winter and EDT in summer), whatever the computer's own time zone is.
- **Companies**: switch between the companies you work for from the top bar; each has its own time log.
- **Categories**: create, rename, colour, and delete categories, and assign one to each task.
- **Manual entries**: add a completed task by hand (date, start time, duration), and edit or delete any entry.
- **Notes / comments** on every entry.
- **Excel export** (`.xlsx`) for the selected period, for one company or all companies (one sheet each), with
  Date, Time Started (ET), Duration, decimal Hours, Company, Category, Task Details, Notes / Comments, and a
  totals row.
- **Backup / restore** of all data as a JSON file.

## Install on a Mac

The app has to be served from a web address once; after that it installs like a normal app and works offline.

1. Host it. This repository includes a GitHub Pages workflow: merge to `main`, then in the repository's
   **Settings → Pages** set **Source** to **GitHub Actions**. The app is published at
   `https://<user>.github.io/timely/`. Any other static host works too, since the app is just these files.
2. Install it:
   - **Safari** (macOS Sonoma or later): open the address, then **File → Add to Dock**.
   - **Chrome / Edge**: open the address, then click the install icon in the address bar.

Timely then has its own Dock icon and window.

### Run it locally instead

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. The app only works while that command is running.

## Your data

Entries are stored in the browser storage of the installed app on that one Mac. Nothing is uploaded.
Clearing website data removes them, so use **Back up data** at the bottom of the page from time to time.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The app |
| `xlsx.js` | Small self-contained Excel writer |
| `sw.js`, `manifest.webmanifest`, `icons/` | Install and offline support |
