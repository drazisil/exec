# Setup Guide: Electron + Canvas Graphics

## What We've Created

A complete Electron application that:
- Runs the x86 emulator in the main process
- Displays real-time 3D graphics via HTML5 Canvas
- Shows live statistics and emulator state
- Provides controls (pause, step, reset, screenshot)

## File Structure

```
/data/Code/exe/
├── electron-main.ts           ← Main Electron process
├── electron-preload.ts        ← Safe IPC bridge
├── public/
│   └── index.html            ← Canvas + UI
├── src/
│   ├── emulator/
│   │   ├── GraphicsEmulator.ts    (enhanced with display)
│   │   └── ...
│   ├── hardware/
│   │   └── ...
│   └── loader/
│       └── ...
├── dist/                      ← Compiled JavaScript (after build)
├── package.json               ← Updated with Electron
└── tsconfig.json
```

## Installation

### Step 1: Install Dependencies

```bash
cd /data/Code/exe
npm install
```

This installs:
- TypeScript
- Electron
- Node.js types

### Step 2: Build TypeScript

```bash
npm run build
```

or watch mode:

```bash
npx tsc --watch
```

### Step 3: Run Electron

```bash
npm run dev-electron
```

This will:
1. Compile TypeScript to JavaScript
2. Launch Electron window
3. Show graphics as emulator runs
4. Open DevTools for debugging

## How It Works

### Flow Diagram

```
┌─────────────────────────────────────────┐
│  Electron Main Process (Node.js)         │
├─────────────────────────────────────────┤
│  1. Initialize emulator                  │
│  2. Load executable                      │
│  3. Execute CPU instructions             │
│  4. Intercept D3D8 calls                 │
│  5. Send draw commands via IPC           │
└─────────────────────────────────────────┘
                    ↓ IPC
┌─────────────────────────────────────────┐
│  Electron Renderer (Browser Process)     │
├─────────────────────────────────────────┤
│  1. Listen for draw commands             │
│  2. Project 3D → 2D (Canvas)             │
│  3. Render triangles/lines               │
│  4. Update statistics                    │
│  5. Display in real-time                 │
└─────────────────────────────────────────┘
```

### Data Flow

1. **Emulator sends command**:
```typescript
mainWindow.webContents.send('draw-command', {
    type: 'triangle',
    vertices: [[x1,y1,z1], [x2,y2,z2], [x3,y3,z3]],
    color: [255, 0, 0]
});
```

2. **Renderer receives command**:
```typescript
window.emulatorAPI.onDrawCommand((cmd) => {
    // Project 3D → 2D
    // Draw on canvas
});
```

3. **Canvas updates live**

## Key Files to Modify

### 1. Integrate Graphics in Emulator

In `src/emulator/GraphicsEmulator.ts`, add display support:

```typescript
import { sendDrawCommand } from '../../electron-main.ts';

export class GraphicsEmulatorWithDisplay extends GraphicsEmulator {
    drawPrimitive(primitiveType: number, ...) {
        // ... get vertex data ...

        // Send to renderer
        sendDrawCommand({
            type: 'triangle',
            vertices: [v1, v2, v3],
            color: [255, 0, 0]
        });
    }
}
```

### 2. Update Main Emulator Loop

In `run-exe.ts`, use the display version:

```typescript
import { GraphicsEmulatorWithDisplay } from './src/emulator/GraphicsEmulator.ts';

// Create with display
const graphics = new GraphicsEmulatorWithDisplay(mem);

// Run emulation
while (running) {
    cpu.step();
    // Graphics automatically sends commands
}
```

### 3. Send Statistics

```typescript
// In emulation loop:
if (frameCount % 30 === 0) {
    sendStats({
        fps: 60,
        drawCalls: drawCallCount,
        vertices: vertexCount,
        triangles: triangleCount,
        instructionsExecuted: cpu.stepCount,
        currentEIP: '0x' + cpu.eip.toString(16)
    });
}
```

## Building the Electron App

### Development Build

```bash
# Watch TypeScript changes
npx tsc --watch &

# Run Electron
npm run dev-electron
```

### Production Build

```bash
# Compile
npm run build

# Package for distribution
npx electron-builder
```

## Troubleshooting

### "Module not found: electron"
```bash
npm install electron --save-dev
```

### Canvas not rendering
- Check DevTools console (F12)
- Verify draw commands are being sent
- Check projection math in renderer

### Emulator too slow
- Reduce draw command frequency
- Use requestAnimationFrame instead of setInterval
- Consider moving emulator to Worker thread

### Black screen
- Press F12 to open DevTools
- Check console for errors
- Verify game is calling D3D functions

## Window Features

### UI Controls

- **Pause**: Pause/resume emulation
- **Step**: Single-step when paused
- **Reset**: Restart emulator
- **Screenshot**: Save canvas as PNG

### Statistics Panel

Shows in real-time:
- **FPS**: Frames per second (canvas updates)
- **Frame Time**: ms per frame
- **Draw Calls**: Graphics commands per frame
- **Triangles**: Total triangles rendered
- **Instructions**: Total x86 instructions executed
- **Current EIP**: Current instruction pointer
- **Memory Used**: Allocations

### Log Area

Captures:
- Emulator startup messages
- D3D8 function calls
- Draw commands
- Errors and warnings

## Next Steps

1. **Run the app**:
```bash
npm run dev-electron
```

2. **Watch for graphics**:
   - Game initializes
   - 3D geometry appears
   - Watch where it crashes

3. **Debug via DevTools**:
   - Press F12
   - Check console
   - See what D3D calls fail

4. **Extend as needed**:
   - Add more D3D8 functions
   - Improve rendering
   - Add input handling

## Performance Tips

- Canvas rendering is CPU-based (fast enough for debug)
- For GPU rendering later, switch to WebGL/Three.js
- Limit draw command frequency if needed
- Use offscreen canvas for complex shapes

## Recording Gameplay

To record what's being rendered:

```javascript
// In DevTools console:
const frames = [];
const origSend = window.emulatorAPI.onDrawCommand;
canvas.addEventListener('render', () => {
    const img = canvas.toDataURL('image/jpeg', 0.8);
    frames.push(img);
});
```

Then use FFmpeg to create video:
```bash
ffmpeg -framerate 30 -i frame_%05d.png -c:v libx264 output.mp4
```

## References

- [Electron Documentation](https://www.electronjs.org/docs)
- [Canvas API Reference](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
- [IPC Documentation](https://www.electronjs.org/docs/api/ipc-main)

---

You're now ready to run the emulator with real-time graphics! 🎮
