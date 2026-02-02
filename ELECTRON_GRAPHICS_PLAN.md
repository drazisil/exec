# Electron + HTML Canvas for Graphics Emulation

## Why This Is Perfect

✅ **Full control over rendering**: Canvas API is mature and well-documented
✅ **Real-time display**: See graphics update live as game runs
✅ **Easy to debug**: Browser DevTools built-in
✅ **Interactive**: Can pause, inspect, etc.
✅ **Cross-platform**: Windows, Mac, Linux
✅ **No GPU dependencies**: Works anywhere
✅ **Can record/screenshot**: Built-in or add recording library

---

## Architecture

```
┌─────────────────────────────────────────┐
│         Electron Main Process            │
├─────────────────────────────────────────┤
│  - Hosts the window                      │
│  - Can run emulator if we want           │
└─────────────────────────────────────────┘
                    ↓ IPC
┌─────────────────────────────────────────┐
│     Electron Renderer (HTML/Canvas)      │
├─────────────────────────────────────────┤
│  - Canvas element for graphics           │
│  - WebGL context for rendering           │
│  - UI for controls                       │
└─────────────────────────────────────────┘
                    ↓ IPC
┌─────────────────────────────────────────┐
│    x86 Emulator (Node.js Worker)        │
├─────────────────────────────────────────┤
│  - CPU emulation                         │
│  - Memory management                     │
│  - D3D8 command capture                  │
│  - Sends draw commands to renderer       │
└─────────────────────────────────────────┘
```

---

## Setup Options

### Option A: Emulator in Main Process (Simpler)
**Architecture**:
- Main: Runs emulator, sends draw commands to renderer
- Renderer: Displays graphics
- Communication: IPC messages for each draw call

**Pros**:
- Straightforward
- Single code path
- Easier debugging

**Cons**:
- Blocks main thread (slow)
- Need to yield to renderer occasionally

### Option B: Emulator in Worker Thread (Better)
**Architecture**:
- Main: Manages window
- Renderer: Displays graphics, receives commands from worker
- Worker: Runs emulator in background thread
- Communication: Worker posts draw commands to renderer

**Pros**:
- Non-blocking rendering
- Smooth graphics updates
- Can pause/step emulator

**Cons**:
- More complex setup
- Need worker pool or thread coordination

### Option C: Emulator as Separate Process (Best)
**Architecture**:
- Main: Manages window
- Renderer: Displays graphics via canvas
- Subprocess: Runs emulator, sends commands via stdout/JSON

**Pros**:
- Clean separation
- Easy to debug separately
- Can run emulator independently

**Cons**:
- IPC overhead
- More complex communication

---

## Recommended: Option A (Simplest to Start)

Run emulator in main, send draw commands to renderer via IPC.

---

## Implementation Steps

### Step 1: Set Up Electron Project

```bash
npm install electron --save-dev
```

### Step 2: Create Main Process (main.ts)

```typescript
import { app, BrowserWindow } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow;

app.on('ready', () => {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.ts'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.openDevTools(); // Debug console
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
```

### Step 3: Create Renderer (index.html)

```html
<!DOCTYPE html>
<html>
<head>
    <title>Motor City Online - Emulator</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            background: #1a1a1a;
            color: #fff;
            font-family: monospace;
        }
        #canvas {
            flex: 1;
            background: #000;
            display: block;
        }
        #stats {
            padding: 10px;
            background: #2a2a2a;
            border-top: 1px solid #444;
            font-size: 12px;
        }
        .stat {
            display: inline-block;
            margin-right: 20px;
        }
    </style>
</head>
<body>
    <canvas id="canvas"></canvas>
    <div id="stats">
        <div class="stat">FPS: <span id="fps">0</span></div>
        <div class="stat">Draw Calls: <span id="drawCalls">0</span></div>
        <div class="stat">Vertices: <span id="vertices">0</span></div>
        <div class="stat">Status: <span id="status">Initializing...</span></div>
    </div>

    <script src="renderer.js"></script>
</body>
</html>
```

### Step 4: Create Renderer Script (renderer.ts)

```typescript
/**
 * Renderer process - handles canvas graphics
 * Receives draw commands from main emulator process
 */

interface DrawCommand {
    type: 'triangle' | 'line' | 'clear';
    vertices?: number[][];
    color?: [number, number, number];
    clear?: [number, number, number];
}

class CanvasRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private width: number;
    private height: number;
    private stats = {
        fps: 0,
        drawCalls: 0,
        vertices: 0
    };
    private frameCount = 0;
    private lastFrameTime = Date.now();

    constructor() {
        this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
        this.ctx = this.canvas.getContext('2d')!;

        // Set canvas to window size
        this.width = window.innerWidth;
        this.height = window.innerHeight - 50; // Account for stats bar

        this.canvas.width = this.width;
        this.canvas.height = this.height;

        // Listen for draw commands from main process
        window.emulatorAPI.onDrawCommand((cmd: DrawCommand) => {
            this.handleDrawCommand(cmd);
        });

        // Update FPS
        setInterval(() => this.updateStats(), 1000);
    }

    /**
     * Handle draw commands from emulator
     */
    handleDrawCommand(cmd: DrawCommand) {
        switch (cmd.type) {
            case 'clear':
                this.clear(cmd.clear || [0, 0, 0]);
                break;
            case 'triangle':
                if (cmd.vertices && cmd.vertices.length >= 3) {
                    this.drawTriangle(
                        cmd.vertices[0],
                        cmd.vertices[1],
                        cmd.vertices[2],
                        cmd.color || [255, 0, 0]
                    );
                    this.stats.drawCalls++;
                    this.stats.vertices += 3;
                }
                break;
            case 'line':
                if (cmd.vertices && cmd.vertices.length >= 2) {
                    this.drawLine(
                        cmd.vertices[0],
                        cmd.vertices[1],
                        cmd.color || [255, 255, 255]
                    );
                }
                break;
        }

        this.frameCount++;
    }

    /**
     * Project 3D point to 2D canvas
     */
    project3D(point: number[]): [number, number] {
        if (point.length < 3) return [0, 0];

        const [x, y, z] = point;
        const fov = 75;
        const aspect = this.width / this.height;
        const scale = 1 / Math.tan((fov / 2) * (Math.PI / 180));

        // Perspective projection
        const projX = (x * scale / z) * (this.width / 2) + this.width / 2;
        const projY = this.height / 2 - (y * scale / aspect / z) * (this.height / 2);

        return [projX, projY];
    }

    /**
     * Draw a 3D triangle
     */
    drawTriangle(p1: number[], p2: number[], p3: number[], color: [number, number, number]) {
        const [x1, y1] = this.project3D(p1);
        const [x2, y2] = this.project3D(p2);
        const [x3, y3] = this.project3D(p3);

        this.ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.lineTo(x3, y3);
        this.ctx.closePath();
        this.ctx.fill();

        // Draw outline
        this.ctx.strokeStyle = `rgb(${Math.min(255, color[0] + 50)}, ${Math.min(255, color[1] + 50)}, ${Math.min(255, color[2] + 50)})`;
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
    }

    /**
     * Draw a 3D line
     */
    drawLine(p1: number[], p2: number[], color: [number, number, number]) {
        const [x1, y1] = this.project3D(p1);
        const [x2, y2] = this.project3D(p2);

        this.ctx.strokeStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.stroke();
    }

    /**
     * Clear canvas
     */
    clear(color: [number, number, number]) {
        this.ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    /**
     * Update statistics display
     */
    updateStats() {
        document.getElementById('fps')!.textContent = this.frameCount.toString();
        document.getElementById('drawCalls')!.textContent = this.stats.drawCalls.toString();
        document.getElementById('vertices')!.textContent = this.stats.vertices.toString();

        this.frameCount = 0;
    }
}

// Create renderer when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new CanvasRenderer();
    document.getElementById('status')!.textContent = 'Ready';
});
```

### Step 5: Create Preload Script (preload.ts)

```typescript
/**
 * Preload script - provides safe API to renderer
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('emulatorAPI', {
    onDrawCommand: (callback: (cmd: any) => void) => {
        ipcRenderer.on('draw-command', (event, cmd) => {
            callback(cmd);
        });
    },

    onStatus: (callback: (status: string) => void) => {
        ipcRenderer.on('status', (event, status) => {
            callback(status);
        });
    },

    pauseEmulator: () => {
        ipcRenderer.send('pause-emulator');
    },

    resumeEmulator: () => {
        ipcRenderer.send('resume-emulator');
    }
});
```

### Step 6: Integrate Emulator (main-emulator.ts)

```typescript
/**
 * Main process - runs emulator and sends draw commands to renderer
 */

import { ipcMain, BrowserWindow } from 'electron';
import { EXEFile } from './index.ts';
import { CPU, Memory, registerAllOpcodes } from './src/emulator/index.ts';

let mainWindow: BrowserWindow;
let emulatorRunning = false;

ipcMain.on('pause-emulator', () => {
    emulatorRunning = false;
});

ipcMain.on('resume-emulator', () => {
    emulatorRunning = true;
});

/**
 * Enhanced Graphics Emulator that sends commands to renderer
 */
class GraphicsEmulatorWithDisplay extends GraphicsEmulator {
    private mainWindow: BrowserWindow;

    constructor(memory: Memory, mainWindow: BrowserWindow) {
        super(memory);
        this.mainWindow = mainWindow;
    }

    /**
     * Override drawPrimitive to send to renderer
     */
    drawPrimitive(
        primitiveType: number,
        startVertex: number,
        primitiveCount: number,
        color: [number, number, number] = [255, 0, 0]
    ) {
        // Get vertex data
        const vertices = this.getVertexBuffer();

        if (primitiveType === 0) {
            // D3DPT_TRIANGLELIST
            for (let i = 0; i < primitiveCount; i++) {
                const idx1 = startVertex + i * 3;
                const idx2 = startVertex + i * 3 + 1;
                const idx3 = startVertex + i * 3 + 2;

                if (idx1 < vertices.length && idx2 < vertices.length && idx3 < vertices.length) {
                    // Send to renderer
                    this.mainWindow.webContents.send('draw-command', {
                        type: 'triangle',
                        vertices: [
                            vertices[idx1],
                            vertices[idx2],
                            vertices[idx3]
                        ],
                        color
                    });
                }
            }
        }
    }

    clear(color: [number, number, number] = [0, 0, 0]) {
        this.mainWindow.webContents.send('draw-command', {
            type: 'clear',
            clear: color
        });
    }
}

export function startEmulator(mainWindow: BrowserWindow) {
    const exePath = '/home/drazisil/mco-source/MCity/MCity_d.exe';
    const exe = new EXEFile(exePath, [
        // ... search paths ...
    ]);

    const mem = new Memory(2 * 1024 * 1024 * 1024);
    const graphics = new GraphicsEmulatorWithDisplay(mem, mainWindow);

    // Setup emulator...
    // cpu.eip = ...
    // etc.

    // Run emulation loop
    setInterval(() => {
        if (emulatorRunning) {
            try {
                cpu.step(); // Execute one instruction
            } catch (e) {
                console.error('Emulation error:', e);
                mainWindow.webContents.send('status', `Error: ${e.message}`);
            }
        }
    }, 0); // Run as fast as possible
}
```

---

## Key Advantages of Electron + Canvas

| Feature | Benefit |
|---------|---------|
| **Canvas 2D Context** | Simple, fast, well-documented |
| **WebGL support** | Can switch to GPU rendering later |
| **DevTools** | Debug graphics commands in real-time |
| **Recording** | Can save canvas to video easily |
| **Cross-platform** | Runs on Windows, Mac, Linux |
| **Real-time** | See graphics update as game runs |
| **Interactive** | Add controls, pause/resume, etc. |

---

## File Structure

```
/data/Code/exe/
├── main.ts                    (Electron main process + emulator)
├── preload.ts                 (Safe IPC bridge)
├── src/
│   └── renderer/
│       ├── index.html         (Canvas + UI)
│       └── renderer.ts        (Canvas rendering logic)
├── src/emulator/
│   ├── GraphicsEmulator.ts    (D3D8 stubs with display)
│   └── ...
└── package.json
```

---

## Next Steps

1. **Install Electron**:
```bash
npm install electron --save-dev
```

2. **Create the files above**

3. **Add start script to package.json**:
```json
{
  "scripts": {
    "start": "electron .",
    "dev": "tsc && electron ."
  }
}
```

4. **Run**:
```bash
npm run dev
```

**Result**: Real-time graphics display of what the game is rendering!

---

## What We'd See

As emulator runs:
- Window opens with black canvas
- Game initializes Direct3D
- 3D geometry starts appearing
- Live frame counter updating
- Real-time statistics

We'd be able to **visually debug** exactly what the game is drawing and where it breaks.

---

## Future Enhancements

- **WebGL renderer** (GPU rendering)
- **Pause/step controls**
- **Record video** of execution
- **Debug display** showing:
  - Current instruction
  - Register values
  - Memory at cursor
  - Call stack
- **Shader support** for advanced graphics
- **Input handling** (keyboard/mouse)
