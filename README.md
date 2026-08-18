# Organiser

A tiny personal weekly planner: three columns (To Do, Waiting On, Finished),
add/move/delete tasks, and it installs like a real app on your phone or laptop.

## How it works (the short version)

- `index.html` — the page structure (the columns, the add-task form)
- `styles.css` — all the colours and layout. Change the values at the top
  under `:root` to re-theme the whole app.
- `app.js` — the logic: adding, moving, deleting, and saving tasks
- `manifest.json` + `sw.js` — what make this installable as an app (PWA)
- `icons/` — the app icon shown on your home screen

Your tasks are saved with `localStorage`, which means they live **in this
browser, on this device only**. Nothing is sent anywhere. If you use it on
both your phone and your laptop, they'll have separate task lists until a
future version adds real syncing.

## Running it locally

You can just open `index.html` in a browser, but service workers need a
real server (not a `file://` link) to register. Easiest way, from this
folder:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000` in your browser.

## Deploying

See the deployment notes Claude walked you through for getting this onto
GitHub and live on Cloudflare Pages.
