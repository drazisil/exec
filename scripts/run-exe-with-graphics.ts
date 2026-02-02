/**
 * Enhanced x86 Emulator with Electron Graphics Display
 *
 * This is an example of how to integrate the graphics renderer
 * with the existing emulator to display real-time 3D graphics.
 */

import { EXEFile } from "./index";
import { CPU, Memory, REG, registerAllOpcodes, KernelStructures } from "./src/emulator/index";
import { GraphicsEmulator } from "./src/emulator/GraphicsEmulator";

// Stub for Electron IPC (when running outside Electron, these are no-ops)
let getMainWindow: any = () => null;

/**
 * Enhanced Graphics Emulator that sends commands to Electron renderer
 */
export class GraphicsEmulatorWithDisplay extends GraphicsEmulator {
    private vertexBuffer: any[] = [];
    private stats = {
        drawCalls: 0,
        triangles: 0,
        instructionsExecuted: 0,
        currentEIP: '0x00000000'
    };

    constructor(memory: Memory) {
        super(memory);
    }

    /**
     * Set vertex buffer and send geometry info to display
     */
    setVertexBuffer(vertices: any[]) {
        this.vertexBuffer = vertices;
    }

    /**
     * Draw primitive and send to renderer
     */
    drawPrimitive(
        primitiveType: number,
        startVertex: number,
        primitiveCount: number,
        color: [number, number, number] = [255, 0, 0]
    ) {
        const mainWindow = getMainWindow();
        if (!mainWindow) return; // Not running in Electron

        if (primitiveType === 0) {
            // D3DPT_TRIANGLELIST
            for (let i = 0; i < primitiveCount; i++) {
                const idx1 = startVertex + i * 3;
                const idx2 = startVertex + i * 3 + 1;
                const idx3 = startVertex + i * 3 + 2;

                if (idx1 < this.vertexBuffer.length &&
                    idx2 < this.vertexBuffer.length &&
                    idx3 < this.vertexBuffer.length) {

                    // Send draw command
                    mainWindow.webContents.send('draw-command', {
                        type: 'triangle',
                        vertices: [
                            this.vertexBuffer[idx1],
                            this.vertexBuffer[idx2],
                            this.vertexBuffer[idx3]
                        ],
                        color
                    });

                    this.stats.drawCalls++;
                    this.stats.triangles++;
                }
            }
        }
    }

    /**
     * Clear framebuffer
     */
    clear(color: [number, number, number] = [0, 0, 0]) {
        const mainWindow = getMainWindow();
        if (!mainWindow) return;

        mainWindow.webContents.send('draw-command', {
            type: 'clear',
            clear: color
        });
    }

    /**
     * Update statistics display
     */
    updateStats(instructionsExecuted: number, currentEIP: number) {
        this.stats.instructionsExecuted = instructionsExecuted;
        this.stats.currentEIP = '0x' + (currentEIP >>> 0).toString(16);

        const mainWindow = getMainWindow();
        if (!mainWindow) return;

        mainWindow.webContents.send('stats', {
            fps: 60,
            drawCalls: this.stats.drawCalls,
            vertices: 0,
            triangles: this.stats.triangles,
            instructionsExecuted: this.stats.instructionsExecuted,
            currentEIP: this.stats.currentEIP
        });

        // Reset counters each frame
        this.stats.drawCalls = 0;
        this.stats.triangles = 0;
    }
}

/**
 * Main emulator with graphics
 */
export function startEmulatorWithGraphics(mainWindow: any) {
    // Override the IPC function
    getMainWindow = () => mainWindow;

    const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
    const exe = new EXEFile(exePath, [
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
    ]);

    const mem = new Memory(2 * 1024 * 1024 * 1024);
    const cpu = new CPU(mem);
    const graphics = new GraphicsEmulatorWithDisplay(mem);
    const kernelStructures = new KernelStructures(mem);

    cpu.kernelStructures = kernelStructures;
    exe.importResolver.setMemory(mem);
    exe.importResolver.buildIATMap(exe.importTable, exe.optionalHeader.imageBase);

    // Load sections
    console.log("[Emulator] Loading sections...");
    for (const section of exe.sectionHeaders) {
        const vaddr = exe.optionalHeader.imageBase + section.virtualAddress;
        mem.load(vaddr, section.data);
    }

    exe.importResolver.writeIATStubs(mem, exe.optionalHeader.imageBase, exe.importTable);
    registerAllOpcodes(cpu);

    // Setup state
    const entryRVA = exe.optionalHeader.addressOfEntryPoint;
    const eip = exe.optionalHeader.imageBase + entryRVA;
    cpu.eip = (eip >>> 0);

    const stackBase = 0x1FFFFFF0;
    const stackLimit = 0x1FF00000;
    cpu.regs[REG.ESP] = stackBase;
    cpu.regs[REG.EBP] = stackBase;

    kernelStructures.initializeKernelStructures(stackBase, stackLimit);

    console.log("[Emulator] Starting execution...");
    mainWindow.webContents.send('status', 'Running');

    // Emulation loop
    let running = true;
    let stepCount = 0;
    const statsInterval = 30; // Update stats every N frames

    const emulationLoop = () => {
        if (!running) {
            requestAnimationFrame(emulationLoop);
            return;
        }

        try {
            // Execute instructions
            for (let i = 0; i < 10000; i++) {
                cpu.step();
                stepCount++;

                if (stepCount % statsInterval === 0) {
                    graphics.updateStats(stepCount, cpu.eip);
                }
            }
        } catch (error: any) {
            console.error("[Emulator] Error:", error);
            mainWindow.webContents.send('status', `Error: ${error.message}`);
            running = false;
        }

        requestAnimationFrame(emulationLoop);
    };

    // Start emulation
    emulationLoop();

    // Return control interface
    return {
        pause: () => { running = false; mainWindow.webContents.send('status', 'Paused'); },
        resume: () => { running = true; mainWindow.webContents.send('status', 'Running'); },
        step: () => { if (!running) cpu.step(); },
        reset: () => {
            // Reinitialize
            cpu.eip = (eip >>> 0);
            cpu.regs[REG.ESP] = stackBase;
            cpu.regs[REG.EBP] = stackBase;
            graphics.clear([0, 0, 0]);
            mainWindow.webContents.send('status', 'Reset');
        }
    };
}

/**
 * Example: Standalone execution (without Electron)
 */
export async function runWithoutGraphics() {
    console.log("=== Running without graphics display ===\n");

    const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
    const exe = new EXEFile(exePath, [
        "/home/drazisil/mco-source/MCity",
        "/data/Downloads",
        "/data/Downloads/kernel32",
        "/data/Downloads/ntdll",
    ]);

    const mem = new Memory(2 * 1024 * 1024 * 1024);
    const cpu = new CPU(mem);
    const kernelStructures = new KernelStructures(mem);

    cpu.kernelStructures = kernelStructures;
    exe.importResolver.setMemory(mem);
    exe.importResolver.buildIATMap(exe.importTable, exe.optionalHeader.imageBase);

    // Load sections
    for (const section of exe.sectionHeaders) {
        const vaddr = exe.optionalHeader.imageBase + section.virtualAddress;
        mem.load(vaddr, section.data);
    }

    exe.importResolver.writeIATStubs(mem, exe.optionalHeader.imageBase, exe.importTable);
    registerAllOpcodes(cpu);

    // Setup
    cpu.eip = (exe.optionalHeader.imageBase + exe.optionalHeader.addressOfEntryPoint) >>> 0;
    const stackBase = 0x1FFFFFF0;
    cpu.regs[REG.ESP] = stackBase;
    cpu.regs[REG.EBP] = stackBase;
    kernelStructures.initializeKernelStructures(stackBase, 0x1FF00000);

    // Run
    console.log("Starting emulation...\n");
    try {
        cpu.run(100_000);
    } catch (e: any) {
        console.log(`\nStopped: ${e.message}`);
    }

    console.log(`\nFinal state:`);
    console.log(`EIP: 0x${cpu.eip.toString(16)}`);
    console.log(`Instructions executed: ${(cpu as any).stepCount}`);
}
