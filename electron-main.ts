/**
 * Electron Main Process
 *
 * - Creates the window
 * - Runs the emulator in main thread
 * - Sends draw commands to renderer via IPC
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { EXEFile } from './index.ts';
import { CPU, Memory, REG, registerAllOpcodes, setupExceptionDiagnostics, KernelStructures, VRAMVisualizer } from './src/emulator/index.ts';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let emulatorRunning = false;
let emulatorPaused = false;

// Emulator instances
let cpu: CPU | null = null;
let mem: Memory | null = null;
let emulatorLoopId: NodeJS.Timeout | null = null;
let stepCount = 0;
let vram: VRAMVisualizer | null = null;

/**
 * Create the Electron window
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            preload: path.join(__dirname, 'electron-preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    // Load the index.html
    const htmlPath = path.join(__dirname, "..", 'public', 'index.html');
    mainWindow.loadFile(htmlPath);

    // Open DevTools in development
    mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

/**
 * Try to allocate memory, falling back to smaller sizes if needed
 */
function allocateMemory(): Memory | null {
    const sizes = [
        256 * 1024 * 1024,  // 256MB
        128 * 1024 * 1024,  // 128MB
        64 * 1024 * 1024,   // 64MB
        32 * 1024 * 1024,   // 32MB
    ];

    for (const size of sizes) {
        try {
            console.log(`[Emulator] Trying to allocate ${size / 1024 / 1024}MB...`);
            const memory = new Memory(size);
            console.log(`[Emulator] Successfully allocated ${size / 1024 / 1024}MB`);
            return memory;
        } catch (err: any) {
            console.warn(`[Emulator] Failed to allocate ${size / 1024 / 1024}MB: ${err.message}`);
            continue;
        }
    }

    return null;
}

/**
 * Initialize the emulator
 */
function initializeEmulator() {
    try {
        console.log('[Emulator] Initializing...');

        const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
        const searchPaths = [
            "/home/drazisil/mco-source/MCity",
            "/data/Downloads/Motor City Online",
            "/data/Downloads",
            "/data/Downloads/msvcrt",
            "/data/Downloads/kernel32",
            "/data/Downloads/ntdll",
            "/data/Downloads/user32",
            "/data/Downloads/shell32",
            "/data/Downloads/gdi32",
            "/data/Downloads/comctl32",
            "/data/Downloads/comdlg32",
            "/data/Downloads/advapi32",
            "/data/Downloads/ole32",
            "/data/Downloads/oleaut32",
            "/data/Downloads/rpcrt4",
            "/data/Downloads/dsound",
            "/data/Downloads/dinput",
            "/data/Downloads/dinput8",
            "/data/Downloads/winmm",
            "/data/Downloads/wininet",
            "/data/Downloads/wsock32",
            "/data/Downloads/version",
            "/data/Downloads/ifc22",
            "/data/Downloads/d3d8",
            "/data/Downloads/kernelbase(1)",
            "/data/Downloads/api-ms-win-core-apiquery-l1-1-0",
            "/data/Downloads/api-ms-win-core-console-l1-1-0",
            "/data/Downloads/api-ms-win-core-datetime-l1-1-0",
            "/data/Downloads/api-ms-win-core-errorhandling-l1-1-1",
            "/data/Downloads/api-ms-win-core-namedpipe-l1-1-0",
            "/data/Downloads/api-ms-win-core-processthreads-l1-1-0",
            "/data/Downloads/api-ms-win-core-processthreads-l1-1-2",
            "/data/Downloads/api-ms-win-core-profile-l1-1-0",
            "/data/Downloads/api-ms-win-core-rtlsupport-l1-1-0",
            "/data/Downloads/api-ms-win-core-synch-ansi-l1-1-0",
            "/data/Downloads/api-ms-win-core-synch-l1-1-0",
            "/data/Downloads/api-ms-win-core-synch-l1-2-0",
            "/data/Downloads/api-ms-win-core-sysinfo-l1-2-1",
            "/data/Downloads/api-ms-win-core-util-l1-1-0",
        ];

        // Load PE file
        const exe = new EXEFile(exePath, searchPaths);
        console.log('[Emulator] PE file loaded');

        // Create memory and CPU with fallback allocation sizes
        mem = allocateMemory();
        if (!mem) {
            throw new Error('Could not allocate memory (tried 256MB, 128MB, 64MB, 32MB)');
        }
        cpu = new CPU(mem);
        console.log('[Emulator] Memory and CPU initialized');

        // Initialize kernel structures
        const kernelStructures = new KernelStructures(mem);
        cpu.kernelStructures = kernelStructures;

        // Set up memory for import resolver
        exe.importResolver.setMemory(mem);
        exe.importResolver.buildIATMap(exe.importTable, exe.optionalHeader.imageBase);

        // Register opcodes and diagnostics
        registerAllOpcodes(cpu);
        setupExceptionDiagnostics(cpu, exe.importResolver);

        // Set up interrupt handler
        cpu.onInterrupt((intNum, cpuRef) => {
            if (intNum === 0xCC || intNum === 0x03) {
                console.log(`[BREAKPOINT] INT3 at EIP=0x${(cpuRef.eip >>> 0).toString(16)}`);
                cpuRef.halted = true;
                emulatorRunning = false;
            } else if (intNum === 0x20) {
                console.log(`[EXIT] INT 0x20`);
                cpuRef.halted = true;
                emulatorRunning = false;
            }
        });

        // Load sections
        for (const section of exe.sectionHeaders) {
            const vaddr = exe.optionalHeader.imageBase + section.virtualAddress;
            mem.load(vaddr, section.data);
        }
        console.log('[Emulator] Sections loaded');

        // Write IAT stubs
        exe.importResolver.writeIATStubs(mem, exe.optionalHeader.imageBase, exe.importTable);

        // Set up CPU state
        const entryRVA = exe.optionalHeader.addressOfEntryPoint;
        const eip = exe.optionalHeader.imageBase + entryRVA;
        cpu.eip = (eip >>> 0);

        // Stack - adjust based on actual memory size
        // Stack should be near the top of available memory
        const memSize = mem.size;
        const stackBase = memSize - 16;  // Leave some headroom
        const stackLimit = memSize - (128 * 1024);  // 128KB stack
        cpu.regs[REG.ESP] = stackBase >>> 0;
        cpu.regs[REG.EBP] = stackBase >>> 0;

        console.log(`[Emulator] Stack: 0x${stackLimit.toString(16)} - 0x${stackBase.toString(16)}`);

        // Initialize kernel structures
        kernelStructures.initializeKernelStructures(stackBase, stackLimit);

        // Initialize VRAM visualizer
        // Map first 4MB of memory as VRAM (1024x1024 RGBA pixels)
        vram = new VRAMVisualizer({
            width: 1024,
            height: 1024,
            baseAddress: 0x04000000  // High address to avoid executable sections
        });
        console.log('[Emulator] VRAM visualizer initialized (1024x1024 RGBA)');

        console.log('[Emulator] Ready to run');
        emulatorRunning = true;
        return true;
    } catch (err: any) {
        console.error('[Emulator] Initialization failed:', err.message);
        console.error('[Emulator] Stack trace:', err.stack);
        if (mainWindow) {
            mainWindow.webContents.send('status', 'Error: ' + err.message);
        }
        return false;
    }
}

/**
 * Run emulator execution loop
 */
function startEmulatorLoop() {
    if (!cpu || !mem) return;

    let lastStatsUpdate = Date.now();
    const statsUpdateInterval = 100; // ms
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;

    emulatorLoopId = setInterval(() => {
        if (!cpu || !emulatorRunning || emulatorPaused) return;

        try {
            // Execute instructions per frame
            const instructionsPerFrame = 100;  // Reduced from 1000 for better error reporting
            for (let i = 0; i < instructionsPerFrame && emulatorRunning && cpu && !cpu.halted; i++) {
                cpu.step();
                stepCount++;
            }

            // Reset error counter on successful execution
            consecutiveErrors = 0;

            // Send stats and framebuffer periodically
            const now = Date.now();
            if (now - lastStatsUpdate >= statsUpdateInterval) {
                if (mainWindow && cpu && vram) {
                    const stats = {
                        fps: 60,
                        drawCalls: 0,
                        vertices: 0,
                        triangles: 0,
                        instructionsExecuted: stepCount,
                        currentEIP: '0x' + (cpu.eip >>> 0).toString(16).padStart(8, '0')
                    };
                    mainWindow.webContents.send('stats', stats);

                    // Send framebuffer if changed
                    if (vram.isDirty()) {
                        const framebuffer = vram.getFramebuffer();
                        const vramStats = vram.getStats();
                        mainWindow.webContents.send('draw-command', {
                            type: 'framebuffer',
                            width: 1024,
                            height: 1024,
                            data: Array.from(framebuffer),  // Convert to array for IPC
                            stats: vramStats
                        });
                        vram.markClean();
                    }
                }
                lastStatsUpdate = now;
            }

            // Stop if CPU halted
            if (cpu && cpu.halted) {
                emulatorRunning = false;
                if (mainWindow) {
                    mainWindow.webContents.send('status', 'Stopped');
                }
            }
        } catch (err: any) {
            consecutiveErrors++;
            console.error(`[Emulator] Execution error #${consecutiveErrors}: ${err.message}`);

            if (consecutiveErrors >= maxConsecutiveErrors) {
                console.error(`[Emulator] Too many consecutive errors, stopping emulation`);
                emulatorRunning = false;
                if (mainWindow) {
                    mainWindow.webContents.send('status', `Stopped after ${consecutiveErrors} errors`);
                }
            } else if (mainWindow) {
                mainWindow.webContents.send('status', `Error (${consecutiveErrors}/${maxConsecutiveErrors}): ${err.message}`);
            }
        }
    }, 16); // ~60 FPS
}

/**
 * IPC Handlers
 */
ipcMain.on('pause-emulator', () => {
    emulatorPaused = true;
    console.log('[Emulator] Paused');
    if (mainWindow) {
        mainWindow.webContents.send('status', 'Paused');
    }
});

ipcMain.on('resume-emulator', () => {
    emulatorPaused = false;
    console.log('[Emulator] Resumed');
    if (mainWindow) {
        mainWindow.webContents.send('status', 'Running');
    }
});

ipcMain.on('step-emulator', () => {
    if (cpu && emulatorPaused) {
        try {
            cpu.step();
            stepCount++;
            if (mainWindow) {
                const stats = {
                    fps: 60,
                    drawCalls: 0,
                    vertices: 0,
                    triangles: 0,
                    instructionsExecuted: stepCount,
                    currentEIP: '0x' + (cpu.eip >>> 0).toString(16).padStart(8, '0')
                };
                mainWindow.webContents.send('stats', stats);
            }
        } catch (err: any) {
            console.error('[Emulator] Step error:', err.message);
        }
    }
});

ipcMain.on('reset-emulator', () => {
    console.log('[Emulator] Reset');
    // Stop current loop
    if (emulatorLoopId) {
        clearInterval(emulatorLoopId);
        emulatorLoopId = null;
    }
    stepCount = 0;
    cpu = null;
    mem = null;
    vram = null;

    // Reinitialize
    if (initializeEmulator()) {
        startEmulatorLoop();
        if (mainWindow) {
            mainWindow.webContents.send('status', 'Running');
        }
    }
});

ipcMain.on('save-canvas', (_event, data) => {
    console.log('[Canvas] Save request:', data.filename);
    // Could save to file system if needed
});

/**
 * App event handlers
 */
app.on('ready', () => {
    createWindow();
    // Initialize and start emulator after window is created
    if (initializeEmulator()) {
        startEmulatorLoop();
    }
});

app.on('window-all-closed', () => {
    // Clean up emulator loop
    if (emulatorLoopId) {
        clearInterval(emulatorLoopId);
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

/**
 * Export main window for emulator access
 */
export function getMainWindow(): BrowserWindow | null {
    return mainWindow;
}

/**
 * Send draw command to renderer
 */
export function sendDrawCommand(cmd: any) {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('draw-command', cmd);
    }
}

/**
 * Send status message to renderer
 */
export function sendStatus(status: string) {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('status', status);
    }
}

/**
 * Send statistics to renderer
 */
export function sendStats(stats: any) {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('stats', stats);
    }
}
