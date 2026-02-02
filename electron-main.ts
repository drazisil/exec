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

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let emulatorRunning = false;
let emulatorPaused = false;

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
    if (emulatorRunning) {
        // Execute one instruction
        console.log('[Emulator] Single step');
    }
});

ipcMain.on('reset-emulator', () => {
    console.log('[Emulator] Reset');
    // Reset emulator state
    if (mainWindow) {
        mainWindow.webContents.send('status', 'Reset');
    }
});

ipcMain.on('save-canvas', (_event, data) => {
    console.log('[Canvas] Save request:', data.filename);
    // Could save to file system if needed
});

/**
 * App event handlers
 */
app.on('ready', createWindow);

app.on('window-all-closed', () => {
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
