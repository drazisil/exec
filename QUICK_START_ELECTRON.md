# Quick Start: Electron Graphics Display

## 30-Second Setup

### 1. Install Electron
```bash
cd /data/Code/exe
npm install
```

### 2. Build TypeScript
```bash
npm run build
```

### 3. Run Electron App
```bash
npm run dev-electron
```

**That's it!** An Electron window should open with:
- A black canvas on the left
- Statistics panel on the right
- Play/Pause/Reset controls

---

## What Happens Next

1. **Emulator starts** (you'll see in window title and status)
2. **Game initializes** (might take a few seconds)
3. **Graphics appear** (3D geometry renders in real-time)
4. **Game runs** (or crashes with helpful error message)

---

## Keyboard/Controls

| Button | Effect |
|--------|--------|
| ⏸ Pause | Pause/Resume emulation |
| ⏩ Step | Single-step (when paused) |
| 🔄 Reset | Restart emulator |
| 📸 Screenshot | Save canvas as PNG |

---

## File Changes Made

### New Files
- `electron-main.ts` - Main process
- `electron-preload.ts` - IPC bridge
- `public/index.html` - UI + Canvas
- `run-exe-with-graphics.ts` - Emulator with display
- `SETUP_ELECTRON.md` - Full setup guide
- `ELECTRON_GRAPHICS_PLAN.md` - Architecture guide

### Modified Files
- `package.json` - Added Electron + build scripts

---

## Debug Checklist

If things don't work:

- [ ] Node.js installed? (`node --version`)
- [ ] npm installed? (`npm --version`)
- [ ] Dependencies installed? (`npm install` succeeded)
- [ ] TypeScript compiled? (`npm run build` succeeded)
- [ ] Electron launches? (`npm run dev-electron` starts window)
- [ ] DevTools visible? (Press F12)
- [ ] Console shows errors? (Check DevTools)
- [ ] GPU drivers updated? (for performance)

---

## Performance Notes

- First run might be slow while loading DLLs
- 30-60 FPS expected (depends on complexity)
- Canvas rendering is CPU-based (fast enough for graphics debug)
- GPU rendering (WebGL) possible later if needed

---

## Next Steps

1. **Run it**: `npm run dev-electron`
2. **Watch graphics**: See what the game renders
3. **Debug**: F12 for DevTools
4. **Iterate**: Each crash tells us what's needed next

---

## Architecture Reminder

```
┌──────────────────────────┐
│  Electron Main Process   │  ← CPU Emulator
│  (x86 emulation)         │  → D3D8 stubs
└────────────┬─────────────┘
             │ IPC
┌────────────▼─────────────┐
│ Electron Renderer        │  ← Canvas
│ (Graphics Display)       │  ← Statistics
└──────────────────────────┘
```

---

## Troubleshooting

### "Cannot find module 'electron'"
```bash
npm install electron --save-dev
```

### "Cannot find module 'dist/electron-main.js'"
```bash
npm run build
```

### Window opens but stays black
- Press F12 to check console
- Look for TypeScript compilation errors
- Emulator might be initializing (wait 5 seconds)

### Crashes immediately
- Check that game EXE path exists in `run-exe-with-graphics.ts`
- Verify DLL search paths are correct
- Check console for error messages

---

## What We're Looking For

As you run this, you should see:
- [ ] Electron window opens
- [ ] Statistics updating (FPS, Draw Calls)
- [ ] Canvas displays something (or stays black if no graphics yet)
- [ ] Status shows "Running"
- [ ] Eventually: Game renders, or crashes with useful error

Any of these will tell us the next step to fix!

---

**Ready?** Run: `npm run dev-electron` 🚀
