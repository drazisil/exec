# Electron Startup Guide

## Step-by-Step

### Step 1: Install Dependencies
```bash
npm install
```

This should complete without errors and create `node_modules/`.

### Step 2: Build TypeScript
```bash
npm run build
```

This compiles all `.ts` files to `dist/` directory.

**Check**: Look for `dist/electron-main.js` and `dist/electron-preload.js`

### Step 3: Start Electron
```bash
npm start
```

Or manually:
```bash
electron .
```

**Expected**: Electron window opens with:
- Canvas on left (black initially)
- Statistics panel on right
- Control buttons at top
- DevTools console visible (F12)

---

## If It Doesn't Work

### "Cannot find module 'electron'"
```bash
npm install electron --save-dev
```

### "dist/electron-main.js not found"
```bash
npm run build
ls dist/
```

Should show `electron-main.js` and `electron-preload.js`

### "Cannot find public/index.html"
```bash
ls -la public/index.html
```

File must exist at that exact path.

### Window crashes on startup
1. Press `Ctrl+C` to stop
2. Check errors above
3. Run: `npm run build` again
4. Try: `npm start` again

### DevTools shows red errors
1. Check the error message
2. Fix the TypeScript issue (likely import path)
3. Run: `npm run build`
4. Restart: `npm start`

---

## Verify Everything Works

1. ✅ `npm install` completes
2. ✅ `npm run build` creates `dist/` files
3. ✅ `npm start` launches window
4. ✅ Window shows canvas + stats
5. ✅ DevTools opens (F12)
6. ✅ No red errors in console

---

## Quick Checklist

- [ ] Node.js 16+ installed? (`node --version`)
- [ ] npm installed? (`npm --version`)
- [ ] `node_modules/` exists? (`ls node_modules/ | head`)
- [ ] `dist/` exists? (`ls dist/`)
- [ ] `public/index.html` exists? (`ls public/`)
- [ ] Electron installed? (`npm list electron`)

---

## Common Issues

| Error | Fix |
|-------|-----|
| `Cannot find module` | `npm install` |
| `ENOENT: no such file` | Check file paths exist |
| `Port already in use` | Kill other Electron: `killall electron` |
| `blank window` | Press F12, check console for errors |
| TypeScript errors | `npm run build` again |

---

## Next Steps

Once it works:
1. Game loads and initializes
2. Graphics appear (or error shown)
3. Use F12 to debug any issues
4. Pause/step/reset as needed

---

Run this to verify setup:
```bash
npm install && npm run build && npm start
```

If that works, you're ready! 🎮
