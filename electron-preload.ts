/**
 * Electron Preload Script
 *
 * Safely exposes IPC functionality to the renderer process
 * This runs with full Node.js access but can only access what we expose
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Expose a safe API to the renderer
 */
contextBridge.exposeInMainWorld('emulatorAPI', {
    /**
     * Listen for draw commands from emulator
     */
    onDrawCommand: (callback: (cmd: {
        type: 'triangle' | 'line' | 'clear' | 'sprite';
        vertices?: number[][];
        color?: [number, number, number];
        clear?: [number, number, number];
        x?: number;
        y?: number;
    }) => void) => {
        ipcRenderer.on('draw-command', (event, cmd) => {
            callback(cmd);
        });
        return () => ipcRenderer.removeAllListeners('draw-command');
    },

    /**
     * Listen for status updates
     */
    onStatus: (callback: (status: string) => void) => {
        ipcRenderer.on('status', (event, status) => {
            callback(status);
        });
        return () => ipcRenderer.removeAllListeners('status');
    },

    /**
     * Listen for statistics updates
     */
    onStats: (callback: (stats: {
        fps: number;
        drawCalls: number;
        vertices: number;
        triangles: number;
        instructionsExecuted: number;
        currentEIP: string;
    }) => void) => {
        ipcRenderer.on('stats', (event, stats) => {
            callback(stats);
        });
        return () => ipcRenderer.removeAllListeners('stats');
    },

    /**
     * Control emulator
     */
    pauseEmulator: () => {
        ipcRenderer.send('pause-emulator');
    },

    resumeEmulator: () => {
        ipcRenderer.send('resume-emulator');
    },

    stepEmulator: () => {
        ipcRenderer.send('step-emulator');
    },

    resetEmulator: () => {
        ipcRenderer.send('reset-emulator');
    },

    /**
     * Save canvas to file
     */
    saveCanvas: (canvasElement: HTMLCanvasElement, filename: string) => {
        const dataURL = canvasElement.toDataURL('image/png');
        ipcRenderer.send('save-canvas', { dataURL, filename });
    }
});
