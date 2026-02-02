# 🎮 Motor City Online Emulator - START HERE

## TL;DR - Get It Running (3 Commands)

```bash
npm install
npm run build
npm start
```

That's it!

---

## What Each Command Does

### 1. `npm install`
Installs Electron and dependencies.
- Takes 2-5 minutes
- Creates `node_modules/` folder
- Only needs to run once

**If it fails**: Check internet connection, try again

### 2. `npm run build`
Compiles TypeScript to JavaScript.
- Takes 5-10 seconds
- Creates `dist/` folder with compiled files
- Need to run after any `.ts` file changes

**If it fails**: Check for TypeScript errors, fix them, try again

### 3. `npm start`
Launches the Electron app.
- Opens a window immediately
- Shows canvas on left, stats on right
- Emulator starts running

**If it fails**: See troubleshooting below

---

## What You Should See

✅ **Immediately after `npm start`:**
- Electron window opens
- Black canvas on left
- Statistics panel on right
- Buttons at top (Pause, Reset, Screenshot)
- DevTools open at bottom (F12)
- Status says "Running"

✅ **After 5-10 seconds:**
- Instructions counter increases
- EIP (instruction pointer) changes
- Game initializes

✅ **Eventually:**
- Graphics appear (colored geometry)
- Or error message in console

---

## Troubleshooting

### Problem: "Cannot find module 'electron'"

**Solution:**
```bash
npm install electron --save-dev
npm install
```

### Problem: "Cannot find dist/electron-main.js"

**Solution:**
```bash
npm run build
ls dist/  # Should show files
npm start
```

### Problem: Window opens but nothing happens

**Solution:**
1. Press F12 to open DevTools
2. Check console for error messages
3. Look for red text
4. Read the error, fix the issue
5. Try again

### Problem: Blank window / black screen

**Solution:**
- This is normal, game is initializing
- Wait 10 seconds
- Check DevTools for errors

### Problem: "ENOENT: no such file"

**Solution:**
Check these files exist:
```bash
ls public/index.html
ls electron-main.ts
ls electron-preload.ts
```

If missing, you need the complete file set from earlier setup.

---

## Verify Setup Works

Run this to check everything:

```bash
npm install && npm run build && npm start
```

If you see an Electron window with a canvas, you're good! 🎉

---

## What If It Still Doesn't Work?

1. **Delete everything and start fresh:**
```bash
rm -rf node_modules dist
npm install
npm run build
npm start
```

2. **Check Node.js version** (should be 16+):
```bash
node --version
```

3. **Check npm version**:
```bash
npm --version
```

4. **Nuclear option** (reset everything):
```bash
rm -rf node_modules
rm package-lock.json
npm install --force
npm run build
npm start
```

---

## Files Needed

Make sure these files exist:
- ✅ `package.json`
- ✅ `tsconfig.json`
- ✅ `public/index.html`
- ✅ `electron-main.ts`
- ✅ `electron-preload.ts`

If any are missing, let me know.

---

## Quick Fix Checklist

- [ ] Run `npm install`
- [ ] Run `npm run build`
- [ ] Run `npm start`
- [ ] Wait 10 seconds
- [ ] Press F12 to check console
- [ ] No red errors? Success! 🎉

---

## Next Steps

Once it's running:
1. Watch the canvas for graphics
2. Use F12 to debug
3. Click Pause/Reset/Screenshot buttons
4. Enjoy the emulator! 🎮

---

**Questions?** Check the console (F12) for error messages - they usually tell you what's wrong!
