/**
 * Win32 API Stubs
 *
 * Instead of executing real DLL code (which needs real Windows NT kernel
 * structures, KUSER_SHARED_DATA, etc.), we intercept IAT calls and execute
 * small x86 stub routines that return fake but plausible values.
 *
 * Architecture:
 *   1. Reserve memory at STUB_BASE (0x00200000) for stub trampolines
 *   2. For simple stubs: write `MOV EAX, <value>; RET` machine code
 *   3. For complex stubs: write `INT 0xFE` + stub ID, handled by JS callback
 *   4. ImportResolver writes stub addresses into the IAT
 *
 * When the game does `CALL [IAT_entry]`, it jumps to our stub code instead
 * of real KERNEL32/USER32/etc. code. The stub sets EAX (return value) and
 * returns. The game never knows the difference.
 */

import type { CPU } from "../hardware/CPU.ts";
import { REG } from "../hardware/CPU.ts";
import type { Memory } from "../hardware/Memory.ts";
import { readFileSync } from "fs";
import { join } from "path";

// Registry value type used by stub handlers
type RegistryEntry = { type: number; value: string | number };
type RegistryMap = Record<string, Record<string, RegistryEntry>>;

/**
 * Load fake registry values from registry.json in the project root.
 * Keys and value names are normalized to lowercase. Returns an empty map on error.
 */
function loadRegistryJson(): RegistryMap {
    try {
        const filePath = join(process.cwd(), "registry.json");
        const raw = readFileSync(filePath, "utf8");
        const data = JSON.parse(raw) as Record<string, unknown>;
        const result: RegistryMap = {};
        for (const [key, values] of Object.entries(data)) {
            if (key.startsWith("_")) continue; // skip comment/meta keys
            if (typeof values !== "object" || values === null) continue;
            const normalizedKey = key.toLowerCase().replace(/\//g, "\\");
            result[normalizedKey] = {};
            for (const [vname, entry] of Object.entries(values as Record<string, unknown>)) {
                if (typeof entry === "object" && entry !== null && "type" in entry && "value" in entry) {
                    result[normalizedKey][vname.toLowerCase()] = entry as RegistryEntry;
                }
            }
        }
        console.log(`[Registry] Loaded ${Object.keys(result).length} keys from registry.json`);
        return result;
    } catch (e: any) {
        console.warn(`[Registry] Could not load registry.json: ${e.message}`);
        return {};
    }
}

// Stub region: 0x00200000 - 0x002FFFFF (1MB reserved)
const STUB_BASE = 0x00200000;
const STUB_SIZE = 32; // bytes per stub (generous, most need ~7)
const MAX_STUBS = 4096;

// INT number used for complex stubs that need JS logic
const STUB_INT = 0xFE;

export type StubHandler = (cpu: CPU) => void;

export interface StubEntry {
    name: string;       // e.g. "kernel32.dll!GetVersion"
    dllName: string;    // e.g. "kernel32.dll"
    funcName: string;   // e.g. "GetVersion"
    address: number;    // address of the stub trampoline in memory
    stubId: number;     // index for INT 0xFE dispatch
    handler: StubHandler;
}

export class Win32Stubs {
    private _stubs: Map<string, StubEntry> = new Map(); // "dllName!funcName" => entry
    private _stubById: StubEntry[] = [];
    private _patchedAddrs: Map<number, StubEntry> = new Map(); // patched code addresses
    private _nextStubAddr: number = STUB_BASE;
    private _memory: Memory;
    private _installed = false;
    private _callLog: string[] = [];
    private _callLogSize = 2000;

    constructor(memory: Memory) {
        this._memory = memory;
    }

    /**
     * Register a stub for a Win32 API function.
     * The handler receives the CPU and should set EAX (and optionally write to
     * memory via pointers in registers/stack) then return. The stub trampoline
     * handles the RET.
     */
    registerStub(dllName: string, funcName: string, handler: StubHandler): void {
        const key = `${dllName.toLowerCase()}!${funcName}`;
        if (this._stubs.has(key)) return; // already registered

        const stubId = this._stubById.length;
        const address = this._nextStubAddr;
        this._nextStubAddr += STUB_SIZE;

        if (stubId >= MAX_STUBS) {
            throw new Error(`Too many Win32 stubs (max ${MAX_STUBS})`);
        }

        const entry: StubEntry = {
            name: key,
            dllName: dllName.toLowerCase(),
            funcName,
            address,
            stubId,
            handler,
        };

        this._stubs.set(key, entry);
        this._stubById.push(entry);

        // Write the stub machine code into memory:
        // INT 0xFE       -> CD FE        (triggers JS handler)
        // RET             -> C3           (return to caller)
        // Padding with INT3 (CC) for safety
        let offset = address;
        this._memory.write8(offset++, 0xCD); // INT
        this._memory.write8(offset++, STUB_INT); // 0xFE
        this._memory.write8(offset++, 0xC3); // RET
        // Fill rest with INT3 breakpoints
        while (offset < address + STUB_SIZE) {
            this._memory.write8(offset++, 0xCC);
        }
    }

    /**
     * Patch a specific address in loaded code to redirect to a JS handler.
     * Overwrites the first 3 bytes at `addr` with INT 0xFE; RET.
     * Use this for internal functions that aren't called through the IAT
     * (e.g., CRT internal functions like _sbh_heap_init).
     * Must be called AFTER sections are loaded into memory.
     */
    patchAddress(addr: number, name: string, handler: StubHandler): void {
        const stubId = this._stubById.length;
        const entry: StubEntry = {
            name: `patch:${name}`,
            dllName: "patch",
            funcName: name,
            address: addr,
            stubId,
            handler,
        };

        this._stubById.push(entry);
        this._patchedAddrs.set(addr, entry);

        // Overwrite code at addr with: INT 0xFE; RET
        this._memory.write8(addr, 0xCD);       // INT
        this._memory.write8(addr + 1, STUB_INT); // 0xFE
        this._memory.write8(addr + 2, 0xC3);   // RET
        console.log(`[Win32Stubs] Patched 0x${addr.toString(16)} => ${name}`);
    }

    /**
     * Get the stub address for a function, or null if not stubbed.
     */
    getStubAddress(dllName: string, funcName: string): number | null {
        const key = `${dllName.toLowerCase()}!${funcName}`;
        const entry = this._stubs.get(key);
        return entry ? entry.address : null;
    }

    /**
     * Install the INT 0xFE handler on the CPU.
     * Must be called after all stubs are registered.
     */
    install(cpu: CPU): void {
        if (this._installed) return;
        this._installed = true;

        const stubs = this;

        // Save any existing interrupt handler
        const existingHandler = (cpu as any)._intHandler;

        cpu.onInterrupt((intNum: number, cpu: CPU) => {
            if (intNum === STUB_INT) {
                stubs.handleStubInt(cpu);
                return;
            }
            // Delegate to existing handler
            if (existingHandler) {
                existingHandler(intNum, cpu);
            } else {
                throw new Error(`Unhandled interrupt INT 0x${intNum.toString(16)} at EIP=0x${(cpu.eip >>> 0).toString(16)}`);
            }
        });
    }

    /**
     * Handle INT 0xFE - find which stub was called and execute its handler
     */
    private handleStubInt(cpu: CPU): void {
        // EIP is now pointing past the INT 0xFE instruction (at the RET).
        // The stub address is EIP - 2 (the INT 0xFE was 2 bytes).
        const stubAddr = (cpu.eip - 2) >>> 0;

        // Check patched addresses first (faster lookup), then stub list
        const entry = this._patchedAddrs.get(stubAddr)
            ?? this._stubById.find(s => s.address === stubAddr);
        if (!entry) {
            throw new Error(`Unknown Win32 stub at 0x${stubAddr.toString(16)}`);
        }

        // Log the stub call (deduplicate consecutive identical calls)
        const logEntry = `${entry.name} @ 0x${stubAddr.toString(16)}`;
        if (this._callLog.length > 0 && this._callLog[this._callLog.length - 1].startsWith(logEntry)) {
            // Increment count on existing entry
            const last = this._callLog[this._callLog.length - 1];
            const countMatch = last.match(/ x(\d+)$/);
            const count = countMatch ? parseInt(countMatch[1]) + 1 : 2;
            this._callLog[this._callLog.length - 1] = `${logEntry} x${count}`;
        } else {
            this._callLog.push(logEntry);
            if (this._callLog.length > this._callLogSize) {
                this._callLog.shift();
            }
        }

        // Execute the JS handler
        entry.handler(cpu);
        // EIP is already pointing at RET, so the CPU will execute RET next
    }

    /**
     * Get the recent stub call log
     */
    getCallLog(): string[] {
        return [...this._callLog];
    }

    /**
     * Look up the stub address for a given DLL!function name.
     * Returns the trampoline address or 0 if not found.
     */
    lookupStubAddress(dllName: string, funcName: string): number {
        const key = `${dllName.toLowerCase()}!${funcName}`;
        const entry = this._stubs.get(key);
        return entry ? entry.address : 0;
    }

    /**
     * Get all registered stubs (for diagnostics)
     */
    getRegisteredStubs(): { dllName: string; funcName: string; address: number }[] {
        return this._stubById.map(s => ({
            dllName: s.dllName,
            funcName: s.funcName,
            address: s.address,
        }));
    }

    /**
     * Check if a function is stubbed
     */
    isStubbed(dllName: string, funcName: string): boolean {
        return this._stubs.has(`${dllName.toLowerCase()}!${funcName}`);
    }

    /**
     * Find a stub entry by function name (searching across all DLL registrations).
     * Returns the entry if found, or null.
     */
    findStubByFuncName(funcName: string): StubEntry | null {
        for (const entry of this._stubById) {
            if (entry.funcName === funcName) return entry;
        }
        return null;
    }

    /**
     * Get total number of registered stubs
     */
    get count(): number {
        return this._stubById.length;
    }
}

// ============================================================
// Default Win32 API stub implementations
// ============================================================

/**
 * Register all default Win32 API stubs needed for MSVC CRT startup.
 * These are the functions called by mainCRTStartup before WinMain.
 */
export function registerCRTStartupStubs(stubs: Win32Stubs, memory: Memory): void {
    // --- KERNEL32.dll stubs ---

    // GetVersion() -> DWORD
    // Returns Windows version. For Win XP SP2: 0x0A280105
    // Low byte = major, next byte = minor, high word = build
    // We return Windows XP (5.1, build 2600) since this is an era-appropriate game
    // Format: (build << 16) | (minor << 8) | major
    stubs.registerStub("kernel32.dll", "GetVersion", (cpu) => {
        // Windows XP: major=5, minor=1, build=2600=0x0A28
        cpu.regs[REG.EAX] = (2600 << 16) | (1 << 8) | 5; // 0x0A280105
    });

    // GetVersionExA(LPOSVERSIONINFOA lpVersionInfo) -> BOOL
    // Fills in an OSVERSIONINFOA struct. Pointer is [ESP+4] (first arg after return addr)
    stubs.registerStub("kernel32.dll", "GetVersionExA", (cpu) => {
        const lpVersionInfo = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        // OSVERSIONINFOA: dwOSVersionInfoSize(4), dwMajorVersion(4), dwMinorVersion(4),
        //                 dwBuildNumber(4), dwPlatformId(4), szCSDVersion(128)
        memory.write32(lpVersionInfo + 4, 5);      // dwMajorVersion = 5
        memory.write32(lpVersionInfo + 8, 1);      // dwMinorVersion = 1
        memory.write32(lpVersionInfo + 12, 2600);   // dwBuildNumber = 2600
        memory.write32(lpVersionInfo + 16, 2);      // dwPlatformId = VER_PLATFORM_WIN32_NT
        // szCSDVersion = "Service Pack 2\0"
        const sp2 = "Service Pack 2";
        for (let i = 0; i < sp2.length; i++) {
            memory.write8(lpVersionInfo + 20 + i, sp2.charCodeAt(i));
        }
        memory.write8(lpVersionInfo + 20 + sp2.length, 0);
        cpu.regs[REG.EAX] = 1; // TRUE (success)
        // stdcall: callee cleans up 1 arg (4 bytes)
        cleanupStdcall(cpu, memory, 4);
    });

    // GetVersionExW(LPOSVERSIONINFOW lpVersionInfo) -> BOOL
    stubs.registerStub("kernel32.dll", "GetVersionExW", (cpu) => {
        const lpVersionInfo = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        memory.write32(lpVersionInfo + 4, 5);      // dwMajorVersion = 5
        memory.write32(lpVersionInfo + 8, 1);      // dwMinorVersion = 1
        memory.write32(lpVersionInfo + 12, 2600);   // dwBuildNumber = 2600
        memory.write32(lpVersionInfo + 16, 2);      // dwPlatformId = VER_PLATFORM_WIN32_NT
        // szCSDVersion (wide string) = "Service Pack 2\0"
        const sp2 = "Service Pack 2";
        for (let i = 0; i < sp2.length; i++) {
            memory.write16(lpVersionInfo + 20 + i * 2, sp2.charCodeAt(i));
        }
        memory.write16(lpVersionInfo + 20 + sp2.length * 2, 0);
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // GetCommandLineA() -> LPCSTR
    // Returns pointer to the command line string
    // We'll put it in a fixed memory location
    const cmdLineAddr = 0x00201000; // in our stub region
    const cmdLine = "MCity_d.exe\0";
    for (let i = 0; i < cmdLine.length; i++) {
        memory.write8(cmdLineAddr + i, cmdLine.charCodeAt(i));
    }
    stubs.registerStub("kernel32.dll", "GetCommandLineA", (cpu) => {
        cpu.regs[REG.EAX] = cmdLineAddr;
    });

    // GetCommandLineW() -> LPCWSTR
    const cmdLineWAddr = 0x00201100;
    for (let i = 0; i < cmdLine.length; i++) {
        memory.write16(cmdLineWAddr + i * 2, cmdLine.charCodeAt(i));
    }
    stubs.registerStub("kernel32.dll", "GetCommandLineW", (cpu) => {
        cpu.regs[REG.EAX] = cmdLineWAddr;
    });

    // GetStartupInfoA(LPSTARTUPINFOA lpStartupInfo) -> void
    // Fills in STARTUPINFOA struct (68 bytes). Zero it out.
    stubs.registerStub("kernel32.dll", "GetStartupInfoA", (cpu) => {
        const lpStartupInfo = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        // Zero out the struct (68 bytes)
        for (let i = 0; i < 68; i += 4) {
            memory.write32(lpStartupInfo + i, 0);
        }
        memory.write32(lpStartupInfo, 68); // cb = sizeof(STARTUPINFOA)
        cleanupStdcall(cpu, memory, 4);
    });

    // GetStartupInfoW(LPSTARTUPINFOW lpStartupInfo) -> void
    stubs.registerStub("kernel32.dll", "GetStartupInfoW", (cpu) => {
        const lpStartupInfo = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        for (let i = 0; i < 104; i += 4) {
            memory.write32(lpStartupInfo + i, 0);
        }
        memory.write32(lpStartupInfo, 104); // cb = sizeof(STARTUPINFOW)
        cleanupStdcall(cpu, memory, 4);
    });

    // GetModuleHandleA(LPCSTR lpModuleName) -> HMODULE
    // NULL => returns base address of main executable
    stubs.registerStub("kernel32.dll", "GetModuleHandleA", (cpu) => {
        const lpModuleName = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        if (lpModuleName === 0) {
            cpu.regs[REG.EAX] = 0x00400000; // main exe image base
        } else {
            cpu.regs[REG.EAX] = 0x00400000; // TODO: look up by name
        }
        cleanupStdcall(cpu, memory, 4);
    });

    // GetModuleHandleW(LPCWSTR lpModuleName) -> HMODULE
    stubs.registerStub("kernel32.dll", "GetModuleHandleW", (cpu) => {
        const lpModuleName = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        if (lpModuleName === 0) {
            cpu.regs[REG.EAX] = 0x00400000;
        } else {
            cpu.regs[REG.EAX] = 0x00400000;
        }
        cleanupStdcall(cpu, memory, 4);
    });

    // GetCurrentProcess() -> HANDLE
    // Returns pseudo-handle -1 (0xFFFFFFFF)
    stubs.registerStub("kernel32.dll", "GetCurrentProcess", (cpu) => {
        cpu.regs[REG.EAX] = 0xFFFFFFFF;
    });

    // GetCurrentProcessId() -> DWORD
    stubs.registerStub("kernel32.dll", "GetCurrentProcessId", (cpu) => {
        cpu.regs[REG.EAX] = 1234; // fake PID
    });

    // GetCurrentThreadId() -> DWORD
    stubs.registerStub("kernel32.dll", "GetCurrentThreadId", (cpu) => {
        cpu.regs[REG.EAX] = 5678; // fake TID
    });

    // GetCurrentThread() -> HANDLE
    stubs.registerStub("kernel32.dll", "GetCurrentThread", (cpu) => {
        cpu.regs[REG.EAX] = 0xFFFFFFFE; // pseudo-handle for current thread
    });

    // HeapCreate(DWORD flOptions, SIZE_T dwInitialSize, SIZE_T dwMaximumSize) -> HANDLE
    // The MSVC CRT's _sbh_heap_init reads from the heap struct:
    //   [heap+0x08] = region size (must be > 0 for the log2 loop to terminate)
    //   [heap+0x10] = some pointer/offset
    // We set up a minimal fake heap structure so CRT initialization works.
    let nextHeapHandle = 0x00280000;
    stubs.registerStub("kernel32.dll", "HeapCreate", (cpu) => {
        const heapAddr = nextHeapHandle;
        nextHeapHandle += 0x10000;
        // Initialize a minimal heap structure
        // Zero it out first
        for (let i = 0; i < 256; i += 4) memory.write32(heapAddr + i, 0);
        // Set fields that the CRT reads:
        memory.write32(heapAddr + 0x00, 0xEEFDEEFD); // heap signature
        memory.write32(heapAddr + 0x04, 0);            // flags
        memory.write32(heapAddr + 0x08, 0x00100000);   // region size = 1MB (must be > 0!)
        memory.write32(heapAddr + 0x0C, 0);            // reserved
        memory.write32(heapAddr + 0x10, heapAddr + 0x100); // pointer to region data
        cpu.regs[REG.EAX] = heapAddr;
        cleanupStdcall(cpu, memory, 12);
    });

    // GetProcessHeap() -> HANDLE
    // Initialize the default process heap at first call
    const defaultHeapAddr = 0x00270000;
    let defaultHeapInitialized = false;
    stubs.registerStub("kernel32.dll", "GetProcessHeap", (cpu) => {
        if (!defaultHeapInitialized) {
            defaultHeapInitialized = true;
            for (let i = 0; i < 256; i += 4) memory.write32(defaultHeapAddr + i, 0);
            memory.write32(defaultHeapAddr + 0x00, 0xEEFDEEFD);
            memory.write32(defaultHeapAddr + 0x08, 0x00100000);
            memory.write32(defaultHeapAddr + 0x10, defaultHeapAddr + 0x100);
        }
        cpu.regs[REG.EAX] = defaultHeapAddr;
    });

    // Bump allocator for heap/local/global allocations
    let nextHeapAlloc = 0x04000000; // heap starts at 64MB
    // Track allocation sizes for HeapReAlloc data copy
    const heapAllocSizes = new Map<number, number>();
    function simpleAlloc(size: number): number {
        const addr = nextHeapAlloc;
        nextHeapAlloc = ((nextHeapAlloc + size + 15) & ~15) >>> 0;
        heapAllocSizes.set(addr, size);
        return addr;
    }

    // HeapAlloc(HANDLE hHeap, DWORD dwFlags, SIZE_T dwBytes) -> LPVOID
    stubs.registerStub("kernel32.dll", "HeapAlloc", (cpu) => {
        const dwBytes = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const dwFlags = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const addr = nextHeapAlloc;
        // Align to 16 bytes
        nextHeapAlloc = ((nextHeapAlloc + dwBytes + 15) & ~15) >>> 0;
        heapAllocSizes.set(addr, dwBytes);
        // HEAP_ZERO_MEMORY = 0x08
        if (dwFlags & 0x08) {
            for (let i = 0; i < dwBytes; i += 4) {
                memory.write32(addr + i, 0);
            }
        }
        cpu.regs[REG.EAX] = addr;
        cleanupStdcall(cpu, memory, 12);
    });

    // HeapFree(HANDLE hHeap, DWORD dwFlags, LPVOID lpMem) -> BOOL
    stubs.registerStub("kernel32.dll", "HeapFree", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE (success, but we don't actually free)
        cleanupStdcall(cpu, memory, 12);
    });

    // HeapReAlloc(HANDLE hHeap, DWORD dwFlags, LPVOID lpMem, SIZE_T dwBytes) -> LPVOID
    stubs.registerStub("kernel32.dll", "HeapReAlloc", (cpu) => {
        const lpMem = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const dwBytes = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        const newAddr = nextHeapAlloc;
        nextHeapAlloc = ((nextHeapAlloc + dwBytes + 15) & ~15) >>> 0;
        heapAllocSizes.set(newAddr, dwBytes);
        // Copy old data to new location (critical for correctness!)
        if (lpMem !== 0) {
            const oldSize = heapAllocSizes.get(lpMem) ?? 0;
            const copySize = Math.min(oldSize, dwBytes);
            for (let i = 0; i < copySize; i++) {
                memory.write8(newAddr + i, memory.read8(lpMem + i));
            }
        }
        cpu.regs[REG.EAX] = newAddr;
        cleanupStdcall(cpu, memory, 16);
    });

    // HeapSize(HANDLE hHeap, DWORD dwFlags, LPCVOID lpMem) -> SIZE_T
    stubs.registerStub("kernel32.dll", "HeapSize", (cpu) => {
        cpu.regs[REG.EAX] = 4096; // fake: always say 4KB
        cleanupStdcall(cpu, memory, 12);
    });

    // VirtualAlloc(LPVOID lpAddress, SIZE_T dwSize, DWORD flAllocationType, DWORD flProtect) -> LPVOID
    let nextVirtualAlloc = 0x05000000; // virtual allocs start at 80MB
    stubs.registerStub("kernel32.dll", "VirtualAlloc", (cpu) => {
        const lpAddress = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const dwSize = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        let addr: number;
        if (lpAddress !== 0) {
            addr = lpAddress; // honor requested address
        } else {
            addr = nextVirtualAlloc;
            // Align to 64KB (Windows VirtualAlloc granularity)
            nextVirtualAlloc = ((nextVirtualAlloc + dwSize + 0xFFFF) & ~0xFFFF) >>> 0;
        }
        cpu.regs[REG.EAX] = addr;
        cleanupStdcall(cpu, memory, 16);
    });

    // VirtualFree(LPVOID lpAddress, SIZE_T dwSize, DWORD dwFreeType) -> BOOL
    stubs.registerStub("kernel32.dll", "VirtualFree", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 12);
    });

    // GetLastError() -> DWORD
    stubs.registerStub("kernel32.dll", "GetLastError", (cpu) => {
        cpu.regs[REG.EAX] = 0; // ERROR_SUCCESS
    });

    // SetLastError(DWORD dwErrCode) -> void
    stubs.registerStub("kernel32.dll", "SetLastError", (cpu) => {
        // Ignore - we don't track this
        cleanupStdcall(cpu, memory, 4);
    });

    // GetTickCount() -> DWORD
    stubs.registerStub("kernel32.dll", "GetTickCount", (cpu) => {
        cpu.regs[REG.EAX] = 10000; // fake: 10 seconds uptime
    });

    // QueryPerformanceCounter(LARGE_INTEGER* lpPerformanceCount) -> BOOL
    stubs.registerStub("kernel32.dll", "QueryPerformanceCounter", (cpu) => {
        const ptr = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        memory.write32(ptr, 1000000);     // low DWORD
        memory.write32(ptr + 4, 0);       // high DWORD
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // QueryPerformanceFrequency(LARGE_INTEGER* lpFrequency) -> BOOL
    stubs.registerStub("kernel32.dll", "QueryPerformanceFrequency", (cpu) => {
        const ptr = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        memory.write32(ptr, 3579545);     // ~3.58 MHz (typical)
        memory.write32(ptr + 4, 0);
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // GetSystemInfo(LPSYSTEM_INFO lpSystemInfo) -> void
    stubs.registerStub("kernel32.dll", "GetSystemInfo", (cpu) => {
        const ptr = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        // Zero it out first (36 bytes)
        for (let i = 0; i < 36; i += 4) memory.write32(ptr + i, 0);
        memory.write16(ptr + 0, 0);            // wProcessorArchitecture = PROCESSOR_ARCHITECTURE_INTEL
        memory.write32(ptr + 4, 4096);          // dwPageSize = 4096
        memory.write32(ptr + 8, 0x00010000);    // lpMinimumApplicationAddress
        memory.write32(ptr + 12, 0x7FFEFFFF);   // lpMaximumApplicationAddress
        memory.write32(ptr + 16, 1);            // dwActiveProcessorMask
        memory.write32(ptr + 20, 1);            // dwNumberOfProcessors
        memory.write32(ptr + 24, 586);          // dwProcessorType = Pentium
        memory.write32(ptr + 28, 0x00010000);   // dwAllocationGranularity = 64KB
        memory.write16(ptr + 32, 6);            // wProcessorLevel
        memory.write16(ptr + 34, 0);            // wProcessorRevision
        cleanupStdcall(cpu, memory, 4);
    });

    // InitializeCriticalSection(LPCRITICAL_SECTION lpCriticalSection) -> void
    stubs.registerStub("kernel32.dll", "InitializeCriticalSection", (cpu) => {
        // Just zero out the critical section struct (24 bytes)
        const ptr = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        for (let i = 0; i < 24; i += 4) memory.write32(ptr + i, 0);
        cleanupStdcall(cpu, memory, 4);
    });

    // InitializeCriticalSectionAndSpinCount -> BOOL
    stubs.registerStub("kernel32.dll", "InitializeCriticalSectionAndSpinCount", (cpu) => {
        const ptr = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        for (let i = 0; i < 24; i += 4) memory.write32(ptr + i, 0);
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });

    // EnterCriticalSection/LeaveCriticalSection/DeleteCriticalSection -> void
    stubs.registerStub("kernel32.dll", "EnterCriticalSection", (cpu) => {
        cleanupStdcall(cpu, memory, 4);
    });
    stubs.registerStub("kernel32.dll", "LeaveCriticalSection", (cpu) => {
        cleanupStdcall(cpu, memory, 4);
    });
    stubs.registerStub("kernel32.dll", "DeleteCriticalSection", (cpu) => {
        cleanupStdcall(cpu, memory, 4);
    });

    // TlsAlloc() -> DWORD (TLS index)
    let nextTlsIndex = 0;
    stubs.registerStub("kernel32.dll", "TlsAlloc", (cpu) => {
        cpu.regs[REG.EAX] = nextTlsIndex++;
    });

    // TlsSetValue(DWORD dwTlsIndex, LPVOID lpTlsValue) -> BOOL
    stubs.registerStub("kernel32.dll", "TlsSetValue", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });

    // TlsGetValue(DWORD dwTlsIndex) -> LPVOID
    stubs.registerStub("kernel32.dll", "TlsGetValue", (cpu) => {
        cpu.regs[REG.EAX] = 0; // NULL (no TLS value stored)
        cleanupStdcall(cpu, memory, 4);
    });

    // TlsFree(DWORD dwTlsIndex) -> BOOL
    stubs.registerStub("kernel32.dll", "TlsFree", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // GetProcAddress(HMODULE hModule, LPCSTR lpProcName) -> FARPROC
    stubs.registerStub("kernel32.dll", "GetProcAddress", (cpu) => {
        const hModule = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const namePtr = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        let procName = "";
        // Check if it's an ordinal (high word is 0)
        if ((namePtr & 0xFFFF0000) === 0) {
            procName = `ordinal#${namePtr}`;
        } else {
            for (let i = 0; i < 260; i++) {
                const ch = memory.read8(namePtr + i);
                if (ch === 0) break;
                procName += String.fromCharCode(ch);
            }
        }

        // Try to find the function in our registered stubs
        // Search across common DLLs
        const dllsToSearch = [
            "kernel32.dll", "user32.dll", "msvcrt.dll", "ntdll.dll",
            "advapi32.dll", "gdi32.dll", "shell32.dll", "ole32.dll",
        ];
        let stubAddr = 0;
        for (const dll of dllsToSearch) {
            stubAddr = stubs.lookupStubAddress(dll, procName);
            if (stubAddr) break;
        }

        if (stubAddr) {
            console.log(`  [Win32] GetProcAddress(0x${hModule.toString(16)}, "${procName}") -> 0x${stubAddr.toString(16)}`);
            cpu.regs[REG.EAX] = stubAddr;
        } else {
            console.log(`  [Win32] GetProcAddress(0x${hModule.toString(16)}, "${procName}") -> NULL`);
            cpu.regs[REG.EAX] = 0;
        }
        cleanupStdcall(cpu, memory, 8);
    });

    // LoadLibraryA(LPCSTR lpLibFileName) -> HMODULE
    stubs.registerStub("kernel32.dll", "LoadLibraryA", (cpu) => {
        const namePtr = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        let name = "";
        for (let i = 0; i < 260; i++) {
            const ch = memory.read8(namePtr + i);
            if (ch === 0) break;
            name += String.fromCharCode(ch);
        }
        console.log(`  [Win32] LoadLibraryA("${name}")`);
        // Return fake module handle based on DLL name hash (non-zero = success)
        // The CRT uses LoadLibraryA to get handles for GetProcAddress calls
        const hash = name.toLowerCase().split("").reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0) >>> 0;
        cpu.regs[REG.EAX] = (hash & 0x7FFFFFFF) | 0x10000000; // Ensure non-zero and in valid range
        cleanupStdcall(cpu, memory, 4);
    });

    // FreeLibrary(HMODULE hLibModule) -> BOOL
    stubs.registerStub("kernel32.dll", "FreeLibrary", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // ExitProcess(UINT uExitCode) -> void (noreturn)
    stubs.registerStub("kernel32.dll", "ExitProcess", (cpu) => {
        const exitCode = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        console.log(`\n[Win32] ExitProcess(${exitCode})`);
        cpu.halted = true;
    });

    // IsDebuggerPresent() -> BOOL
    stubs.registerStub("kernel32.dll", "IsDebuggerPresent", (cpu) => {
        cpu.regs[REG.EAX] = 0; // FALSE - no debugger
    });

    // IsProcessorFeaturePresent(DWORD ProcessorFeature) -> BOOL
    stubs.registerStub("kernel32.dll", "IsProcessorFeaturePresent", (cpu) => {
        const feature = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        // PF_XMMI_INSTRUCTIONS_AVAILABLE (6) = SSE
        // PF_XMMI64_INSTRUCTIONS_AVAILABLE (10) = SSE2
        // PF_FLOATING_POINT_EMULATED (1) = soft FP
        // Return TRUE for common features to avoid CRT fallbacks
        const supported = feature === 6 || feature === 10; // SSE + SSE2
        cpu.regs[REG.EAX] = supported ? 1 : 0;
        cleanupStdcall(cpu, memory, 4);
    });

    // SetUnhandledExceptionFilter(LPTOP_LEVEL_EXCEPTION_FILTER lpTopLevelExceptionFilter) -> LPTOP_LEVEL_EXCEPTION_FILTER
    stubs.registerStub("kernel32.dll", "SetUnhandledExceptionFilter", (cpu) => {
        cpu.regs[REG.EAX] = 0; // return previous filter (NULL)
        cleanupStdcall(cpu, memory, 4);
    });

    // UnhandledExceptionFilter(struct _EXCEPTION_POINTERS *ExceptionInfo) -> LONG
    stubs.registerStub("kernel32.dll", "UnhandledExceptionFilter", (cpu) => {
        cpu.regs[REG.EAX] = 0; // EXCEPTION_CONTINUE_SEARCH
        cleanupStdcall(cpu, memory, 4);
    });

    // GetEnvironmentStringsW() -> LPWCH
    // Return pointer to empty double-null-terminated string
    const envStrAddr = 0x00201200;
    memory.write16(envStrAddr, 0); // empty string
    memory.write16(envStrAddr + 2, 0); // double null terminator
    stubs.registerStub("kernel32.dll", "GetEnvironmentStringsW", (cpu) => {
        cpu.regs[REG.EAX] = envStrAddr;
    });

    // FreeEnvironmentStringsW(LPWCH penv) -> BOOL
    stubs.registerStub("kernel32.dll", "FreeEnvironmentStringsW", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // GetEnvironmentStrings() -> LPCH
    const envStrAAddr = 0x00201300;
    memory.write8(envStrAAddr, 0);
    memory.write8(envStrAAddr + 1, 0);
    stubs.registerStub("kernel32.dll", "GetEnvironmentStrings", (cpu) => {
        cpu.regs[REG.EAX] = envStrAAddr;
    });

    // FreeEnvironmentStringsA(LPCH penv) -> BOOL
    stubs.registerStub("kernel32.dll", "FreeEnvironmentStringsA", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // GetStdHandle(DWORD nStdHandle) -> HANDLE
    stubs.registerStub("kernel32.dll", "GetStdHandle", (cpu) => {
        const nStdHandle = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        // STD_INPUT_HANDLE=-10, STD_OUTPUT_HANDLE=-11, STD_ERROR_HANDLE=-12
        // Return fake handles
        cpu.regs[REG.EAX] = (0x00000100 + (nStdHandle & 0xFF)) >>> 0;
        cleanupStdcall(cpu, memory, 4);
    });

    // GetFileType(HANDLE hFile) -> DWORD
    stubs.registerStub("kernel32.dll", "GetFileType", (cpu) => {
        cpu.regs[REG.EAX] = 2; // FILE_TYPE_CHAR (console)
        cleanupStdcall(cpu, memory, 4);
    });

    // GetACP() -> UINT (code page)
    stubs.registerStub("kernel32.dll", "GetACP", (cpu) => {
        cpu.regs[REG.EAX] = 1252; // Windows-1252 (Western European)
    });

    // GetCPInfo(UINT CodePage, LPCPINFO lpCPInfo) -> BOOL
    stubs.registerStub("kernel32.dll", "GetCPInfo", (cpu) => {
        const lpCPInfo = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        memory.write32(lpCPInfo, 1);     // MaxCharSize = 1 (single byte)
        memory.write8(lpCPInfo + 4, 0x3F); // DefaultChar = '?'
        memory.write8(lpCPInfo + 5, 0);
        // LeadByte = all zeros (no lead bytes for single-byte codepage)
        for (let i = 0; i < 12; i++) memory.write8(lpCPInfo + 6 + i, 0);
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });

    // IsValidCodePage(UINT CodePage) -> BOOL
    stubs.registerStub("kernel32.dll", "IsValidCodePage", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // GetStringTypeW/GetStringTypeA - character classification
    stubs.registerStub("kernel32.dll", "GetStringTypeW", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 16);
    });

    // MultiByteToWideChar(UINT CodePage, DWORD dwFlags, LPCCH lpMultiByteStr,
    //   int cbMultiByte, LPWSTR lpWideCharStr, int cchWideChar) -> int
    stubs.registerStub("kernel32.dll", "MultiByteToWideChar", (cpu) => {
        const lpMultiByteStr = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const cbMultiByte = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        const lpWideCharStr = memory.read32((cpu.regs[REG.ESP] + 20) >>> 0);
        const cchWideChar = memory.read32((cpu.regs[REG.ESP] + 24) >>> 0);
        // If output buffer size is 0, return required size
        if (cchWideChar === 0) {
            cpu.regs[REG.EAX] = cbMultiByte;
        } else {
            // Simple: just zero-extend each byte to 16-bit
            const count = Math.min(cbMultiByte, cchWideChar);
            for (let i = 0; i < count; i++) {
                memory.write16(lpWideCharStr + i * 2, memory.read8(lpMultiByteStr + i));
            }
            cpu.regs[REG.EAX] = count;
        }
        cleanupStdcall(cpu, memory, 24);
    });

    // WideCharToMultiByte(UINT CodePage, DWORD dwFlags, LPCWCH lpWideCharStr,
    //   int cchWideChar, LPSTR lpMultiByteStr, int cbMultiByte,
    //   LPCCH lpDefaultChar, LPBOOL lpUsedDefaultChar) -> int
    stubs.registerStub("kernel32.dll", "WideCharToMultiByte", (cpu) => {
        const lpWideCharStr = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const cchWideChar = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        const lpMultiByteStr = memory.read32((cpu.regs[REG.ESP] + 20) >>> 0);
        const cbMultiByte = memory.read32((cpu.regs[REG.ESP] + 24) >>> 0);
        if (cbMultiByte === 0) {
            cpu.regs[REG.EAX] = cchWideChar;
        } else {
            const count = Math.min(cchWideChar, cbMultiByte);
            for (let i = 0; i < count; i++) {
                const wc = memory.read16(lpWideCharStr + i * 2);
                memory.write8(lpMultiByteStr + i, wc > 255 ? 0x3F : wc); // '?' for non-ASCII
            }
            cpu.regs[REG.EAX] = count;
        }
        cleanupStdcall(cpu, memory, 32);
    });

    // LCMapStringW(LCID Locale, DWORD dwMapFlags, LPCWSTR lpSrcStr,
    //   int cchSrc, LPWSTR lpDestStr, int cchDest) -> int
    stubs.registerStub("kernel32.dll", "LCMapStringW", (cpu) => {
        const cchSrc = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        cpu.regs[REG.EAX] = cchSrc;
        cleanupStdcall(cpu, memory, 24);
    });

    // GetLocaleInfoA - locale information (stub)
    stubs.registerStub("kernel32.dll", "GetLocaleInfoA", (cpu) => {
        cpu.regs[REG.EAX] = 0; // failure
        cleanupStdcall(cpu, memory, 16);
    });

    // FlsAlloc / FlsSetValue / FlsGetValue / FlsFree (Fiber Local Storage)
    let nextFlsIndex = 0;
    stubs.registerStub("kernel32.dll", "FlsAlloc", (cpu) => {
        cpu.regs[REG.EAX] = nextFlsIndex++;
        cleanupStdcall(cpu, memory, 4);
    });
    stubs.registerStub("kernel32.dll", "FlsSetValue", (cpu) => {
        cpu.regs[REG.EAX] = 1;
        cleanupStdcall(cpu, memory, 8);
    });
    stubs.registerStub("kernel32.dll", "FlsGetValue", (cpu) => {
        cpu.regs[REG.EAX] = 0;
        cleanupStdcall(cpu, memory, 4);
    });
    stubs.registerStub("kernel32.dll", "FlsFree", (cpu) => {
        cpu.regs[REG.EAX] = 1;
        cleanupStdcall(cpu, memory, 4);
    });

    // EncodePointer/DecodePointer - just return the pointer unchanged
    stubs.registerStub("kernel32.dll", "EncodePointer", (cpu) => {
        cpu.regs[REG.EAX] = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        cleanupStdcall(cpu, memory, 4);
    });
    stubs.registerStub("kernel32.dll", "DecodePointer", (cpu) => {
        cpu.regs[REG.EAX] = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        cleanupStdcall(cpu, memory, 4);
    });

    // InterlockedCompareExchange/InterlockedExchange/InterlockedIncrement/InterlockedDecrement
    stubs.registerStub("kernel32.dll", "InterlockedCompareExchange", (cpu) => {
        const dest = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const exchange = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const comparand = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const current = memory.read32(dest);
        if (current === comparand) {
            memory.write32(dest, exchange);
        }
        cpu.regs[REG.EAX] = current; // return original value
        cleanupStdcall(cpu, memory, 12);
    });

    // ---- Cooperative threading state ----
    // We track threads created by CreateThread and execute them cooperatively
    // when the main thread calls Sleep (indicating a wait loop).
    interface PendingThread {
        startAddress: number;
        parameter: number;
        handle: number;
        threadId: number;
        suspended: boolean;
        completed: boolean;
        // Saved CPU state when thread is paused (only set after first run)
        savedState?: {
            regs: Uint32Array;
            eip: number;
            eflags: number;
            fpuStack: Float64Array;
            fpuTop: number;
            fpuStatusWord: number;
            fpuControlWord: number;
            fpuTagWord: number;
        };
    }
    const pendingThreads: PendingThread[] = [];
    let nextThreadId = 1001;
    let nextThreadHandle = 0x0000BEEF;
    // Thread stack region: allocate at 0x05000000, 256KB per thread
    const THREAD_STACK_BASE = 0x05000000;
    const THREAD_STACK_SIZE = 256 * 1024;
    let threadStackNext = THREAD_STACK_BASE;
    let sleepCount = 0;
    let isRunningThread = false;  // true when we're executing a thread's code
    let currentThreadIdx = -1;    // index of currently running thread (-1 = main)
    // Sentinel address for thread return detection
    const THREAD_SENTINEL = 0x001FE000;
    memory.write8(THREAD_SENTINEL, 0xCD);   // INT
    memory.write8(THREAD_SENTINEL + 1, 0xFE); // 0xFE - triggers our stub handler
    memory.write8(THREAD_SENTINEL + 2, 0xC3); // RET (won't be reached)
    // Register the sentinel as a patched address for thread exit
    stubs.patchAddress(THREAD_SENTINEL, "_threadReturn", (cpu) => {
        // Thread function returned normally
        if (currentThreadIdx >= 0) {
            const thread = pendingThreads[currentThreadIdx];
            console.log(`  [Thread] Thread ${thread.threadId} returned normally`);
            thread.completed = true;
        }
        // Signal that we need to switch back to main thread
        cpu.halted = true;
    });

    // Sleep(DWORD dwMilliseconds) -> void
    // Cooperative scheduler: when main thread sleeps, run pending threads
    stubs.registerStub("kernel32.dll", "Sleep", (cpu) => {
        sleepCount++;

        // Check for pending threads to run
        const runnableThread = pendingThreads.find(t => !t.suspended && !t.completed);
        if (runnableThread) {
            const threadIdx = pendingThreads.indexOf(runnableThread);
            console.log(`  [Scheduler] Main thread Sleep #${sleepCount} - switching to thread ${runnableThread.threadId} (startAddr=0x${runnableThread.startAddress.toString(16)})`);

            // Save main thread state
            const mainState = {
                regs: new Uint32Array(cpu.regs),
                eip: cpu.eip,
                eflags: cpu.eflags,
                fpuStack: new Float64Array(cpu.fpuStack),
                fpuTop: cpu.fpuTop,
                fpuStatusWord: cpu.fpuStatusWord,
                fpuControlWord: cpu.fpuControlWord,
                fpuTagWord: cpu.fpuTagWord,
            };

            // Set up thread state
            isRunningThread = true;
            currentThreadIdx = threadIdx;

            if (runnableThread.savedState) {
                // Resume thread from where it left off
                cpu.regs.set(runnableThread.savedState.regs);
                cpu.eip = runnableThread.savedState.eip;
                cpu.eflags = runnableThread.savedState.eflags;
                cpu.fpuStack.set(runnableThread.savedState.fpuStack);
                cpu.fpuTop = runnableThread.savedState.fpuTop;
                cpu.fpuStatusWord = runnableThread.savedState.fpuStatusWord;
                cpu.fpuControlWord = runnableThread.savedState.fpuControlWord;
                cpu.fpuTagWord = runnableThread.savedState.fpuTagWord;
            } else {
                // First run: set up thread's initial state
                const stackTop = threadStackNext + THREAD_STACK_SIZE - 16;
                threadStackNext += THREAD_STACK_SIZE;

                // Thread function signature: DWORD WINAPI ThreadProc(LPVOID lpParameter)
                // Stack layout at entry (as if CALL pushed return addr on top of args):
                //   [ESP]   = return address (sentinel)
                //   [ESP+4] = lpParameter
                let threadESP = stackTop;
                threadESP -= 4;
                memory.write32(threadESP, runnableThread.parameter); // lpParameter at [ESP+4]
                threadESP -= 4;
                memory.write32(threadESP, THREAD_SENTINEL); // return address at [ESP]

                cpu.regs[REG.ESP] = threadESP >>> 0;
                cpu.regs[REG.EBP] = 0;
                cpu.regs[REG.EAX] = 0;
                cpu.regs[REG.ECX] = 0;
                cpu.regs[REG.EDX] = 0;
                cpu.regs[REG.EBX] = 0;
                cpu.regs[REG.ESI] = 0;
                cpu.regs[REG.EDI] = 0;
                cpu.eip = runnableThread.startAddress;
                cpu.eflags = 0x202; // IF set
            }

            // Run thread for a time slice (1M steps)
            const threadStepLimit = 1_000_000;
            cpu.halted = false;
            let threadSteps = 0;
            let threadError: Error | null = null;

            // Log first few steps of thread execution for debugging
            const logFirstSteps = !runnableThread.savedState;
            if (logFirstSteps) {
                console.log(`  [Thread] Starting thread at EIP=0x${cpu.eip.toString(16)}, ESP=0x${cpu.regs[REG.ESP].toString(16)}`);
                // Dump the parameter object to understand what the thread will access
                const paramAddr = runnableThread.parameter;
                console.log(`  [Thread] Parameter object at 0x${paramAddr.toString(16)}:`);
                for (let off = 0; off <= 0x50; off += 4) {
                    const val = memory.read32(paramAddr + off);
                    if (val !== 0) {
                        console.log(`    [+0x${off.toString(16)}] = 0x${val.toString(16)}`);
                    }
                }
            }

            try {
                let lastValidThreadEIP = cpu.eip;
                while (!cpu.halted && threadSteps < threadStepLimit) {
                    if (logFirstSteps && threadSteps < 50) {
                        const op = memory.read8(cpu.eip);
                        console.log(`  [Thread] step ${threadSteps}: EIP=0x${cpu.eip.toString(16)} op=0x${op.toString(16).padStart(2, '0')} ESP=0x${(cpu.regs[REG.ESP] >>> 0).toString(16)} EAX=0x${(cpu.regs[REG.EAX] >>> 0).toString(16)}`);
                    }
                    const eipBefore = cpu.eip;
                    cpu.step();
                    threadSteps++;

                    // Check for thread runaway: EIP outside valid code regions
                    const eip = cpu.eip >>> 0;
                    const inStubs = eip >= 0x00200000 && eip < 0x00202000;
                    const inExe = eip >= 0x00400000 && eip < 0x02000000;
                    const inDlls = eip >= 0x10000000 && eip < 0x40000000;
                    const inThreadSentinel = eip >= 0x001FE000 && eip < 0x001FE004;
                    if (!inStubs && !inExe && !inDlls && !inThreadSentinel && threadSteps > 10) {
                        console.log(`  [Thread] RUNAWAY at step ${threadSteps}: EIP=0x${eip.toString(16)} (prev=0x${eipBefore.toString(16)}, lastValid=0x${lastValidThreadEIP.toString(16)})`);
                        console.log(`  [Thread] State: ${cpu.toString()}`);
                        // Dump a few bytes at EIP
                        const bytes: string[] = [];
                        for (let i = 0; i < 16; i++) bytes.push(memory.read8(eip + i).toString(16).padStart(2, '0'));
                        console.log(`  [Thread] Bytes at EIP: ${bytes.join(' ')}`);
                        runnableThread.completed = true; // prevent re-running
                        break;
                    }
                    if (inStubs || inExe || inDlls) {
                        lastValidThreadEIP = eip;
                    }
                }
            } catch (err: any) {
                threadError = err;
                console.log(`  [Thread] Thread ${runnableThread.threadId} error after ${threadSteps} steps: ${err.message}`);
                console.log(`  [Thread] State: ${cpu.toString()}`);
            }

            const threadCompleted = runnableThread.completed;

            if (!threadCompleted && !threadError) {
                // Thread yielded (ran out of time slice) - save its state
                runnableThread.savedState = {
                    regs: new Uint32Array(cpu.regs),
                    eip: cpu.eip,
                    eflags: cpu.eflags,
                    fpuStack: new Float64Array(cpu.fpuStack),
                    fpuTop: cpu.fpuTop,
                    fpuStatusWord: cpu.fpuStatusWord,
                    fpuControlWord: cpu.fpuControlWord,
                    fpuTagWord: cpu.fpuTagWord,
                };
                console.log(`  [Scheduler] Thread ${runnableThread.threadId} yielded after ${threadSteps} steps (EIP=0x${cpu.eip.toString(16)})`);
            } else if (threadCompleted) {
                console.log(`  [Scheduler] Thread ${runnableThread.threadId} completed after ${threadSteps} steps`);
            } else if (threadError) {
                // Mark as completed to avoid re-running
                runnableThread.completed = true;
            }

            // Restore main thread state
            cpu.regs.set(mainState.regs);
            cpu.eip = mainState.eip;
            cpu.eflags = mainState.eflags;
            cpu.fpuStack.set(mainState.fpuStack);
            cpu.fpuTop = mainState.fpuTop;
            cpu.fpuStatusWord = mainState.fpuStatusWord;
            cpu.fpuControlWord = mainState.fpuControlWord;
            cpu.fpuTagWord = mainState.fpuTagWord;
            cpu.halted = false;
            isRunningThread = false;
            currentThreadIdx = -1;

            // Do normal Sleep cleanup for main thread
            cleanupStdcall(cpu, memory, 4);
            return;
        }

        // No threads to run - normal sleep behavior
        if (sleepCount >= 50) {
            console.log(`\n[Win32] Sleep() called ${sleepCount} times with no runnable threads - halting`);
            cpu.halted = true;
            return;
        }
        cleanupStdcall(cpu, memory, 4);
    });

    // CloseHandle(HANDLE hObject) -> BOOL
    stubs.registerStub("kernel32.dll", "CloseHandle", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // WriteFile(HANDLE hFile, LPCVOID lpBuffer, DWORD nNumberOfBytesToWrite, LPDWORD lpNumberOfBytesWritten, LPOVERLAPPED lpOverlapped) -> BOOL
    stubs.registerStub("kernel32.dll", "WriteFile", (cpu) => {
        const nBytes = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const lpBytesWritten = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        if (lpBytesWritten !== 0) {
            memory.write32(lpBytesWritten, nBytes);
        }
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 20);
    });

    // SetHandleCount(UINT uNumber) -> UINT
    // Obsolete: just returns the argument unchanged
    stubs.registerStub("kernel32.dll", "SetHandleCount", (cpu) => {
        const uNumber = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        cpu.regs[REG.EAX] = uNumber;
        cleanupStdcall(cpu, memory, 4);
    });

    // SetStdHandle(DWORD nStdHandle, HANDLE hHandle) -> BOOL
    stubs.registerStub("kernel32.dll", "SetStdHandle", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });

    // GetModuleFileNameA(HMODULE hModule, LPSTR lpFilename, DWORD nSize) -> DWORD
    stubs.registerStub("kernel32.dll", "GetModuleFileNameA", (cpu) => {
        const lpFilename = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const nSize = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const name = "C:\\MCity\\MCity_d.exe";
        const len = Math.min(name.length, nSize - 1);
        for (let i = 0; i < len; i++) {
            memory.write8(lpFilename + i, name.charCodeAt(i));
        }
        memory.write8(lpFilename + len, 0);
        cpu.regs[REG.EAX] = len;
        cleanupStdcall(cpu, memory, 12);
    });

    // GetModuleFileNameW(HMODULE hModule, LPWSTR lpFilename, DWORD nSize) -> DWORD
    stubs.registerStub("kernel32.dll", "GetModuleFileNameW", (cpu) => {
        const lpFilename = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const nSize = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const name = "C:\\MCity\\MCity_d.exe";
        const len = Math.min(name.length, nSize - 1);
        for (let i = 0; i < len; i++) {
            memory.write16(lpFilename + i * 2, name.charCodeAt(i));
        }
        memory.write16(lpFilename + len * 2, 0);
        cpu.regs[REG.EAX] = len;
        cleanupStdcall(cpu, memory, 12);
    });

    // IsBadReadPtr(LPCVOID lp, UINT_PTR ucb) -> BOOL
    // Returns 0 if memory is readable, non-zero if bad
    stubs.registerStub("kernel32.dll", "IsBadReadPtr", (cpu) => {
        const lp = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const ucb = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        // Check if the address range is within our memory bounds
        const memSize = memory.size;
        if (lp === 0 || lp + ucb > memSize) {
            cpu.regs[REG.EAX] = 1; // bad pointer
        } else {
            cpu.regs[REG.EAX] = 0; // pointer is OK
        }
        cleanupStdcall(cpu, memory, 8);
    });

    // IsBadWritePtr(LPVOID lp, UINT_PTR ucb) -> BOOL
    stubs.registerStub("kernel32.dll", "IsBadWritePtr", (cpu) => {
        const lp = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const ucb = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const memSize = memory.size;
        if (lp === 0 || lp + ucb > memSize) {
            cpu.regs[REG.EAX] = 1; // bad pointer
        } else {
            cpu.regs[REG.EAX] = 0; // pointer is OK
        }
        cleanupStdcall(cpu, memory, 8);
    });

    // IsBadCodePtr(FARPROC lpfn) -> BOOL
    stubs.registerStub("kernel32.dll", "IsBadCodePtr", (cpu) => {
        const lpfn = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const memSize = memory.size;
        if (lpfn === 0 || lpfn >= memSize) {
            cpu.regs[REG.EAX] = 1; // bad pointer
        } else {
            cpu.regs[REG.EAX] = 0; // pointer is OK
        }
        cleanupStdcall(cpu, memory, 4);
    });

    // TerminateProcess(HANDLE hProcess, UINT uExitCode) -> BOOL
    stubs.registerStub("kernel32.dll", "TerminateProcess", (cpu) => {
        const uExitCode = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        console.log(`\n[Win32] TerminateProcess(exitCode=${uExitCode})`);
        cpu.halted = true;
    });

    // FatalAppExitA(UINT uAction, LPCSTR lpMessageText) -> void
    stubs.registerStub("kernel32.dll", "FatalAppExitA", (cpu) => {
        console.log(`\n[Win32] FatalAppExitA called`);
        cpu.halted = true;
    });

    // RtlUnwind(PVOID TargetFrame, PVOID TargetIp, PEXCEPTION_RECORD ExceptionRecord, PVOID ReturnValue) -> void
    stubs.registerStub("kernel32.dll", "RtlUnwind", (cpu) => {
        // Complex SEH function - for now just return without doing anything
        cleanupStdcall(cpu, memory, 16);
    });

    // RaiseException(DWORD dwExceptionCode, DWORD dwExceptionFlags, DWORD nNumberOfArguments, const ULONG_PTR *lpArguments) -> void
    stubs.registerStub("kernel32.dll", "RaiseException", (cpu) => {
        const code = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        console.log(`\n[Win32] RaiseException(code=0x${code.toString(16)})`);
        cleanupStdcall(cpu, memory, 16);
    });

    // =============== Threading ===============

    // CreateThread(LPSECURITY_ATTRIBUTES, SIZE_T dwStackSize, LPTHREAD_START_ROUTINE lpStartAddress,
    //              LPVOID lpParameter, DWORD dwCreationFlags, LPDWORD lpThreadId) -> HANDLE
    stubs.registerStub("kernel32.dll", "CreateThread", (cpu) => {
        const lpStartAddress = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const lpParameter = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        const dwCreationFlags = memory.read32((cpu.regs[REG.ESP] + 20) >>> 0);
        const lpThreadId = memory.read32((cpu.regs[REG.ESP] + 24) >>> 0);
        const CREATE_SUSPENDED = 0x4;
        const isSuspended = (dwCreationFlags & CREATE_SUSPENDED) !== 0;
        const threadId = nextThreadId++;
        const handle = nextThreadHandle++;

        console.log(`  [Win32] CreateThread(startAddr=0x${lpStartAddress.toString(16)}, param=0x${lpParameter.toString(16)}, flags=0x${dwCreationFlags.toString(16)}) -> handle=0x${handle.toString(16)}, tid=${threadId}`);

        // Save thread info for cooperative execution
        pendingThreads.push({
            startAddress: lpStartAddress,
            parameter: lpParameter,
            handle,
            threadId,
            suspended: isSuspended,
            completed: false,
        });

        // Write thread ID to output parameter
        if (lpThreadId !== 0) {
            memory.write32(lpThreadId, threadId);
        }
        cpu.regs[REG.EAX] = handle;
        cleanupStdcall(cpu, memory, 24);
    });

    // ResumeThread(HANDLE hThread) -> DWORD (previous suspend count)
    stubs.registerStub("kernel32.dll", "ResumeThread", (cpu) => {
        const hThread = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const thread = pendingThreads.find(t => t.handle === hThread);
        if (thread && thread.suspended) {
            console.log(`  [Win32] ResumeThread(0x${hThread.toString(16)}) - unsuspending thread ${thread.threadId}`);
            thread.suspended = false;
        }
        cpu.regs[REG.EAX] = 1; // previous suspend count was 1
        cleanupStdcall(cpu, memory, 4);
    });

    // ExitThread(DWORD dwExitCode) -> void (noreturn)
    stubs.registerStub("kernel32.dll", "ExitThread", (cpu) => {
        const exitCode = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        console.log(`  [Win32] ExitThread(${exitCode})`);
        if (currentThreadIdx >= 0) {
            pendingThreads[currentThreadIdx].completed = true;
        }
        cpu.halted = true; // Signal scheduler to switch back to main
    });

    // GetExitCodeThread(HANDLE hThread, LPDWORD lpExitCode) -> BOOL
    stubs.registerStub("kernel32.dll", "GetExitCodeThread", (cpu) => {
        const lpExitCode = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        if (lpExitCode !== 0) {
            memory.write32(lpExitCode, 0); // STILL_ACTIVE = 259, or 0 for exited
        }
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });

    // SuspendThread(HANDLE hThread) -> DWORD
    stubs.registerStub("kernel32.dll", "SuspendThread", (cpu) => {
        cpu.regs[REG.EAX] = 0; // previous suspend count
        cleanupStdcall(cpu, memory, 4);
    });

    // WaitForSingleObject(HANDLE hHandle, DWORD dwMilliseconds) -> DWORD
    stubs.registerStub("kernel32.dll", "WaitForSingleObject", (cpu) => {
        cpu.regs[REG.EAX] = 0; // WAIT_OBJECT_0 (signaled immediately)
        cleanupStdcall(cpu, memory, 8);
    });

    // WaitForMultipleObjects(DWORD nCount, const HANDLE *lpHandles, BOOL bWaitAll, DWORD dwMilliseconds) -> DWORD
    stubs.registerStub("kernel32.dll", "WaitForMultipleObjects", (cpu) => {
        cpu.regs[REG.EAX] = 0; // WAIT_OBJECT_0
        cleanupStdcall(cpu, memory, 16);
    });

    // Sleep stub - duplicate removed, the cooperative version is registered above (line ~866)

    // =============== Synchronization ===============

    // CreateMutexA(LPSECURITY_ATTRIBUTES, BOOL bInitialOwner, LPCSTR lpName) -> HANDLE
    stubs.registerStub("kernel32.dll", "CreateMutexA", (cpu) => {
        cpu.regs[REG.EAX] = 0x0000CAFE; // fake mutex handle
        cleanupStdcall(cpu, memory, 12);
    });

    // OpenMutexA(DWORD dwDesiredAccess, BOOL bInheritHandle, LPCSTR lpName) -> HANDLE
    stubs.registerStub("kernel32.dll", "OpenMutexA", (cpu) => {
        cpu.regs[REG.EAX] = 0; // NULL = doesn't exist
        cleanupStdcall(cpu, memory, 12);
    });

    // ReleaseMutex(HANDLE hMutex) -> BOOL
    stubs.registerStub("kernel32.dll", "ReleaseMutex", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // CreateEventA(LPSECURITY_ATTRIBUTES, BOOL bManualReset, BOOL bInitialState, LPCSTR lpName) -> HANDLE
    stubs.registerStub("kernel32.dll", "CreateEventA", (cpu) => {
        cpu.regs[REG.EAX] = 0x0000DEAD; // fake event handle
        cleanupStdcall(cpu, memory, 16);
    });

    // SetEvent(HANDLE hEvent) -> BOOL
    stubs.registerStub("kernel32.dll", "SetEvent", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // ResetEvent(HANDLE hEvent) -> BOOL
    stubs.registerStub("kernel32.dll", "ResetEvent", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // CloseHandle(HANDLE hObject) -> BOOL
    stubs.registerStub("kernel32.dll", "CloseHandle", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // =============== Error handling ===============

    // GetLastError() -> DWORD
    stubs.registerStub("kernel32.dll", "GetLastError", (cpu) => {
        cpu.regs[REG.EAX] = 0; // ERROR_SUCCESS
    });

    // SetLastError(DWORD dwErrCode) -> void
    stubs.registerStub("kernel32.dll", "SetLastError", (cpu) => {
        cleanupStdcall(cpu, memory, 4);
    });

    // =============== File I/O ===============

    // File handle counter for fake handles (starts at 0x5000)
    let nextFileHandle = 0x5000;

    // CreateFileA(LPCSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE) -> HANDLE
    stubs.registerStub("kernel32.dll", "CreateFileA", (cpu) => {
        const namePtr = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const dwDesiredAccess = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        let name = "";
        for (let i = 0; i < 260; i++) { const ch = memory.read8(namePtr + i); if (ch === 0) break; name += String.fromCharCode(ch); }
        const GENERIC_WRITE = 0x40000000;
        const GENERIC_READ_WRITE = 0xC0000000;
        if (dwDesiredAccess & GENERIC_WRITE || dwDesiredAccess === GENERIC_READ_WRITE) {
            const handle = nextFileHandle++;
            console.log(`  [Win32] CreateFileA("${name}") -> handle 0x${handle.toString(16)}`);
            cpu.regs[REG.EAX] = handle;
        } else {
            console.log(`  [Win32] CreateFileA("${name}") -> INVALID_HANDLE_VALUE (read-only not supported)`);
            cpu.regs[REG.EAX] = 0xFFFFFFFF; // INVALID_HANDLE_VALUE
        }
        cleanupStdcall(cpu, memory, 28);
    });

    // CreateFileW(LPCWSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE) -> HANDLE
    stubs.registerStub("kernel32.dll", "CreateFileW", (cpu) => {
        const dwDesiredAccess = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const GENERIC_WRITE = 0x40000000;
        if (dwDesiredAccess & GENERIC_WRITE) {
            cpu.regs[REG.EAX] = nextFileHandle++;
        } else {
            cpu.regs[REG.EAX] = 0xFFFFFFFF; // INVALID_HANDLE_VALUE
        }
        cleanupStdcall(cpu, memory, 28);
    });

    // ReadFile(HANDLE, LPVOID, DWORD, LPDWORD, LPOVERLAPPED) -> BOOL
    stubs.registerStub("kernel32.dll", "ReadFile", (cpu) => {
        const lpBytesRead = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        if (lpBytesRead !== 0) memory.write32(lpBytesRead, 0);
        cpu.regs[REG.EAX] = 0; // FALSE (failed)
        cleanupStdcall(cpu, memory, 20);
    });

    // DeleteFileA(LPCSTR lpFileName) -> BOOL
    stubs.registerStub("kernel32.dll", "DeleteFileA", (cpu) => {
        const namePtr = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        let name = "";
        for (let i = 0; i < 260; i++) { const ch = memory.read8(namePtr + i); if (ch === 0) break; name += String.fromCharCode(ch); }
        console.log(`  [Win32] DeleteFileA("${name}")`);
        cpu.regs[REG.EAX] = 1; // TRUE (success)
        cleanupStdcall(cpu, memory, 4);
    });

    // DeleteFileW(LPCWSTR lpFileName) -> BOOL
    stubs.registerStub("kernel32.dll", "DeleteFileW", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE (success)
        cleanupStdcall(cpu, memory, 4);
    });

    // FindFirstFileA(LPCSTR, WIN32_FIND_DATAA*) -> HANDLE
    stubs.registerStub("kernel32.dll", "FindFirstFileA", (cpu) => {
        cpu.regs[REG.EAX] = 0xFFFFFFFF; // INVALID_HANDLE_VALUE (no files found)
        cleanupStdcall(cpu, memory, 8);
    });

    // FindFirstFileW(LPCWSTR, WIN32_FIND_DATAW*) -> HANDLE
    stubs.registerStub("kernel32.dll", "FindFirstFileW", (cpu) => {
        cpu.regs[REG.EAX] = 0xFFFFFFFF; // INVALID_HANDLE_VALUE
        cleanupStdcall(cpu, memory, 8);
    });

    // FindNextFileA(HANDLE, WIN32_FIND_DATAA*) -> BOOL
    stubs.registerStub("kernel32.dll", "FindNextFileA", (cpu) => {
        cpu.regs[REG.EAX] = 0; // FALSE (no more files)
        cleanupStdcall(cpu, memory, 8);
    });

    // FindNextFileW(HANDLE, WIN32_FIND_DATAW*) -> BOOL
    stubs.registerStub("kernel32.dll", "FindNextFileW", (cpu) => {
        cpu.regs[REG.EAX] = 0; // FALSE (no more files)
        cleanupStdcall(cpu, memory, 8);
    });

    // FindClose(HANDLE hFindFile) -> BOOL
    stubs.registerStub("kernel32.dll", "FindClose", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE (success)
        cleanupStdcall(cpu, memory, 4);
    });

    // CompareFileTime(const FILETIME*, const FILETIME*) -> LONG
    stubs.registerStub("kernel32.dll", "CompareFileTime", (cpu) => {
        cpu.regs[REG.EAX] = 0; // Equal
        cleanupStdcall(cpu, memory, 8);
    });

    // GetFileAttributesA(LPCSTR lpFileName) -> DWORD
    stubs.registerStub("kernel32.dll", "GetFileAttributesA", (cpu) => {
        cpu.regs[REG.EAX] = 0xFFFFFFFF; // INVALID_FILE_ATTRIBUTES (not found)
        cleanupStdcall(cpu, memory, 4);
    });

    // GetFullPathNameA(LPCSTR, DWORD, LPSTR, LPSTR*) -> DWORD
    stubs.registerStub("kernel32.dll", "GetFullPathNameA", (cpu) => {
        cpu.regs[REG.EAX] = 0; // 0 = failure
        cleanupStdcall(cpu, memory, 16);
    });

    // =============== Directory ===============

    // GetCurrentDirectoryA(DWORD nBufferLength, LPSTR lpBuffer) -> DWORD
    stubs.registerStub("kernel32.dll", "GetCurrentDirectoryA", (cpu) => {
        const nBufLen = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const lpBuf = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const dir = "C:\\MCity";
        if (lpBuf !== 0 && nBufLen > dir.length) {
            for (let i = 0; i < dir.length; i++) memory.write8(lpBuf + i, dir.charCodeAt(i));
            memory.write8(lpBuf + dir.length, 0);
        }
        cpu.regs[REG.EAX] = dir.length;
        cleanupStdcall(cpu, memory, 8);
    });

    // SetCurrentDirectoryA(LPCSTR lpPathName) -> BOOL
    stubs.registerStub("kernel32.dll", "SetCurrentDirectoryA", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // GetWindowsDirectoryA(LPSTR lpBuffer, UINT uSize) -> UINT
    stubs.registerStub("kernel32.dll", "GetWindowsDirectoryA", (cpu) => {
        const lpBuf = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const uSize = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const dir = "C:\\WINDOWS";
        if (lpBuf !== 0 && uSize > dir.length) {
            for (let i = 0; i < dir.length; i++) memory.write8(lpBuf + i, dir.charCodeAt(i));
            memory.write8(lpBuf + dir.length, 0);
        }
        cpu.regs[REG.EAX] = dir.length;
        cleanupStdcall(cpu, memory, 8);
    });

    // GetDiskFreeSpaceA(LPCSTR, LPDWORD, LPDWORD, LPDWORD, LPDWORD) -> BOOL
    stubs.registerStub("kernel32.dll", "GetDiskFreeSpaceA", (cpu) => {
        const lpSectorsPerCluster = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const lpBytesPerSector = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const lpFreeClusters = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        const lpTotalClusters = memory.read32((cpu.regs[REG.ESP] + 20) >>> 0);
        if (lpSectorsPerCluster) memory.write32(lpSectorsPerCluster, 8);
        if (lpBytesPerSector) memory.write32(lpBytesPerSector, 512);
        if (lpFreeClusters) memory.write32(lpFreeClusters, 1000000);
        if (lpTotalClusters) memory.write32(lpTotalClusters, 2000000);
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 20);
    });

    // GetDriveTypeA(LPCSTR lpRootPathName) -> UINT
    stubs.registerStub("kernel32.dll", "GetDriveTypeA", (cpu) => {
        cpu.regs[REG.EAX] = 3; // DRIVE_FIXED
        cleanupStdcall(cpu, memory, 4);
    });

    // =============== Time ===============

    // GetLocalTime(LPSYSTEMTIME lpSystemTime) -> void
    stubs.registerStub("kernel32.dll", "GetLocalTime", (cpu) => {
        const lp = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        // SYSTEMTIME: wYear(2), wMonth(2), wDayOfWeek(2), wDay(2), wHour(2), wMinute(2), wSecond(2), wMilliseconds(2)
        memory.write16(lp, 2003);     // year
        memory.write16(lp + 2, 6);    // month (June)
        memory.write16(lp + 4, 2);    // day of week (Tuesday)
        memory.write16(lp + 6, 28);   // day
        memory.write16(lp + 8, 12);   // hour
        memory.write16(lp + 10, 0);   // minute
        memory.write16(lp + 12, 0);   // second
        memory.write16(lp + 14, 0);   // ms
        cleanupStdcall(cpu, memory, 4);
    });

    // GetSystemTime(LPSYSTEMTIME lpSystemTime) -> void
    stubs.registerStub("kernel32.dll", "GetSystemTime", (cpu) => {
        const lp = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        memory.write16(lp, 2003);
        memory.write16(lp + 2, 6);
        memory.write16(lp + 4, 2);
        memory.write16(lp + 6, 28);
        memory.write16(lp + 8, 17);   // UTC hour
        memory.write16(lp + 10, 0);
        memory.write16(lp + 12, 0);
        memory.write16(lp + 14, 0);
        cleanupStdcall(cpu, memory, 4);
    });

    // GetTickCount() -> DWORD
    stubs.registerStub("kernel32.dll", "GetTickCount", (cpu) => {
        cpu.regs[REG.EAX] = 100000; // fake tick count
    });

    // QueryPerformanceCounter(LARGE_INTEGER *lpPerformanceCount) -> BOOL
    stubs.registerStub("kernel32.dll", "QueryPerformanceCounter", (cpu) => {
        const lp = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        if (lp !== 0) {
            memory.write32(lp, 1000000);     // low dword
            memory.write32(lp + 4, 0);       // high dword
        }
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // QueryPerformanceFrequency(LARGE_INTEGER *lpFrequency) -> BOOL
    stubs.registerStub("kernel32.dll", "QueryPerformanceFrequency", (cpu) => {
        const lp = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        if (lp !== 0) {
            memory.write32(lp, 3579545);     // ~3.58 MHz (typical)
            memory.write32(lp + 4, 0);
        }
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // GetTimeZoneInformation(LPTIME_ZONE_INFORMATION) -> DWORD
    stubs.registerStub("kernel32.dll", "GetTimeZoneInformation", (cpu) => {
        const lp = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        // Zero out the structure (172 bytes)
        for (let i = 0; i < 172; i++) memory.write8(lp + i, 0);
        memory.write32(lp, 300); // Bias = 300 minutes (EST = UTC-5)
        cpu.regs[REG.EAX] = 1; // TIME_ZONE_ID_STANDARD
        cleanupStdcall(cpu, memory, 4);
    });

    // FileTimeToLocalFileTime(const FILETIME*, LPFILETIME) -> BOOL
    stubs.registerStub("kernel32.dll", "FileTimeToLocalFileTime", (cpu) => {
        const lpIn = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const lpOut = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        // Just copy input to output (ignore timezone)
        memory.write32(lpOut, memory.read32(lpIn));
        memory.write32(lpOut + 4, memory.read32(lpIn + 4));
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });

    // FileTimeToSystemTime(const FILETIME*, LPSYSTEMTIME) -> BOOL
    stubs.registerStub("kernel32.dll", "FileTimeToSystemTime", (cpu) => {
        const lpST = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        // Write a reasonable date
        memory.write16(lpST, 2003);
        memory.write16(lpST + 2, 6);
        memory.write16(lpST + 4, 2);
        memory.write16(lpST + 6, 28);
        memory.write16(lpST + 8, 12);
        memory.write16(lpST + 10, 0);
        memory.write16(lpST + 12, 0);
        memory.write16(lpST + 14, 0);
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });

    // =============== Misc ===============

    // FormatMessageA(...) -> DWORD
    stubs.registerStub("kernel32.dll", "FormatMessageA", (cpu) => {
        cpu.regs[REG.EAX] = 0; // 0 chars written (failure)
        cleanupStdcall(cpu, memory, 28);
    });

    // GetProcessHeap() -> HANDLE
    stubs.registerStub("kernel32.dll", "GetProcessHeap", (cpu) => {
        cpu.regs[REG.EAX] = 0x00010000; // fake heap handle (same as HeapCreate returns)
    });

    // GlobalGetAtomNameA(ATOM, LPSTR, int) -> UINT
    stubs.registerStub("kernel32.dll", "GlobalGetAtomNameA", (cpu) => {
        cpu.regs[REG.EAX] = 0; // failure
        cleanupStdcall(cpu, memory, 12);
    });

    // GlobalDeleteAtom(ATOM) -> ATOM
    stubs.registerStub("kernel32.dll", "GlobalDeleteAtom", (cpu) => {
        cpu.regs[REG.EAX] = 0; // success
        cleanupStdcall(cpu, memory, 4);
    });

    // DeviceIoControl(...) -> BOOL
    stubs.registerStub("kernel32.dll", "DeviceIoControl", (cpu) => {
        cpu.regs[REG.EAX] = 0; // FALSE (failed)
        cleanupStdcall(cpu, memory, 32);
    });

    // WinExec(LPCSTR lpCmdLine, UINT uCmdShow) -> UINT
    stubs.registerStub("kernel32.dll", "WinExec", (cpu) => {
        cpu.regs[REG.EAX] = 31; // ERROR_FILE_NOT_FOUND (> 31 = success)
        cleanupStdcall(cpu, memory, 8);
    });

    // _lopen(LPCSTR lpPathName, int iReadWrite) -> HFILE
    stubs.registerStub("kernel32.dll", "_lopen", (cpu) => {
        cpu.regs[REG.EAX] = 0xFFFFFFFF; // HFILE_ERROR
        cleanupStdcall(cpu, memory, 8);
    });

    // _lclose(HFILE hFile) -> HFILE
    stubs.registerStub("kernel32.dll", "_lclose", (cpu) => {
        cpu.regs[REG.EAX] = 0; // success
        cleanupStdcall(cpu, memory, 4);
    });

    // GetPrivateProfileStringA(lpAppName, lpKeyName, lpDefault, lpReturnedString, nSize, lpFileName) -> DWORD
    stubs.registerStub("kernel32.dll", "GetPrivateProfileStringA", (cpu) => {
        const lpAppName = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const lpKeyName = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const lpDefault = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const lpReturnedString = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        const nSize = memory.read32((cpu.regs[REG.ESP] + 20) >>> 0);
        const lpFileName = memory.read32((cpu.regs[REG.ESP] + 24) >>> 0);
        const app = lpAppName ? readAnsiStr(lpAppName) : "(null)";
        const key = lpKeyName ? readAnsiStr(lpKeyName) : "(null)";
        const file = lpFileName ? readAnsiStr(lpFileName) : "(null)";
        // Return the default value (indicates key not found)
        let defStr = "";
        if (lpDefault) defStr = readAnsiStr(lpDefault);
        console.log(`  [Win32] GetPrivateProfileStringA("[${app}]", "${key}", default="${defStr}", file="${file}")`);
        if (lpReturnedString && nSize > 0) {
            const copyLen = Math.min(defStr.length, nSize - 1);
            for (let i = 0; i < copyLen; i++) memory.write8(lpReturnedString + i, defStr.charCodeAt(i));
            memory.write8(lpReturnedString + copyLen, 0);
            cpu.regs[REG.EAX] = copyLen;
        } else {
            cpu.regs[REG.EAX] = 0;
        }
        cleanupStdcall(cpu, memory, 24);
    });

    // GetPrivateProfileIntA(lpAppName, lpKeyName, nDefault, lpFileName) -> UINT
    stubs.registerStub("kernel32.dll", "GetPrivateProfileIntA", (cpu) => {
        const lpAppName = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const lpKeyName = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const nDefault = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const app = lpAppName ? readAnsiStr(lpAppName) : "(null)";
        const key = lpKeyName ? readAnsiStr(lpKeyName) : "(null)";
        console.log(`  [Win32] GetPrivateProfileIntA("[${app}]", "${key}") -> default ${nDefault}`);
        cpu.regs[REG.EAX] = nDefault; // return the default value
        cleanupStdcall(cpu, memory, 16);
    });

    // WritePrivateProfileStringA(lpAppName, lpKeyName, lpString, lpFileName) -> BOOL
    stubs.registerStub("kernel32.dll", "WritePrivateProfileStringA", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE (pretend write succeeded)
        cleanupStdcall(cpu, memory, 16);
    });

    // WritePrivateProfileSectionA(LPCSTR, LPCSTR, LPCSTR) -> BOOL
    stubs.registerStub("kernel32.dll", "WritePrivateProfileSectionA", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 12);
    });

    // InterlockedIncrement(LONG volatile *Addend) -> LONG
    stubs.registerStub("kernel32.dll", "InterlockedIncrement", (cpu) => {
        const pAddend = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const val = (memory.read32(pAddend) + 1) >>> 0;
        memory.write32(pAddend, val);
        cpu.regs[REG.EAX] = val;
        cleanupStdcall(cpu, memory, 4);
    });

    // InterlockedDecrement(LONG volatile *Addend) -> LONG
    stubs.registerStub("kernel32.dll", "InterlockedDecrement", (cpu) => {
        const pAddend = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const val = ((memory.read32(pAddend) - 1) & 0xFFFFFFFF) >>> 0;
        memory.write32(pAddend, val);
        cpu.regs[REG.EAX] = val;
        cleanupStdcall(cpu, memory, 4);
    });

    // InterlockedExchange(LONG volatile *Target, LONG Value) -> LONG
    stubs.registerStub("kernel32.dll", "InterlockedExchange", (cpu) => {
        const pTarget = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const value = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const original = memory.read32(pTarget);
        memory.write32(pTarget, value);
        cpu.regs[REG.EAX] = original;
        cleanupStdcall(cpu, memory, 8);
    });

    // OutputDebugStringA(LPCSTR lpOutputString) -> void
    stubs.registerStub("kernel32.dll", "OutputDebugStringA", (cpu) => {
        // Read and print the debug string
        const lpStr = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        if (lpStr !== 0) {
            let str = '';
            for (let i = 0; i < 256; i++) {
                const ch = memory.read8(lpStr + i);
                if (ch === 0) break;
                str += String.fromCharCode(ch);
            }
            console.log(`[OutputDebugString] ${str}`);
        }
        cleanupStdcall(cpu, memory, 4);
    });

    // DebugBreak() -> void
    stubs.registerStub("kernel32.dll", "DebugBreak", (_cpu) => {
        console.log(`[Win32] DebugBreak called`);
    });

    // SetErrorMode(UINT uMode) -> UINT
    stubs.registerStub("kernel32.dll", "SetErrorMode", (cpu) => {
        cpu.regs[REG.EAX] = 0; // return previous mode (0)
        cleanupStdcall(cpu, memory, 4);
    });

    // LCMapStringA(LCID Locale, DWORD dwMapFlags, LPCSTR lpSrcStr, int cchSrc, LPSTR lpDestStr, int cchDest) -> int
    stubs.registerStub("kernel32.dll", "LCMapStringA", (cpu) => {
        const cchSrc = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        cpu.regs[REG.EAX] = cchSrc;
        cleanupStdcall(cpu, memory, 24);
    });

    // CompareStringA(LCID Locale, DWORD dwCmpFlags, PCNZCH lpString1, int cchCount1, PCNZCH lpString2, int cchCount2) -> int
    stubs.registerStub("kernel32.dll", "CompareStringA", (cpu) => {
        cpu.regs[REG.EAX] = 2; // CSTR_EQUAL
        cleanupStdcall(cpu, memory, 24);
    });

    // CompareStringW(LCID Locale, DWORD dwCmpFlags, PCNZWCH lpString1, int cchCount1, PCNZWCH lpString2, int cchCount2) -> int
    stubs.registerStub("kernel32.dll", "CompareStringW", (cpu) => {
        cpu.regs[REG.EAX] = 2; // CSTR_EQUAL
        cleanupStdcall(cpu, memory, 24);
    });

    // GetStringTypeA(LCID Locale, DWORD dwInfoType, LPCSTR lpSrcStr, int cchSrc, LPWORD lpCharType) -> BOOL
    stubs.registerStub("kernel32.dll", "GetStringTypeA", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 20);
    });

    // GetOEMCP() -> UINT
    stubs.registerStub("kernel32.dll", "GetOEMCP", (cpu) => {
        cpu.regs[REG.EAX] = 437; // US OEM code page
    });

    // GetUserDefaultLCID() -> LCID
    stubs.registerStub("kernel32.dll", "GetUserDefaultLCID", (cpu) => {
        cpu.regs[REG.EAX] = 0x0409; // English (US)
    });

    // IsValidLocale(LCID Locale, DWORD dwFlags) -> BOOL
    stubs.registerStub("kernel32.dll", "IsValidLocale", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });

    // EnumSystemLocalesA(LOCALE_ENUMPROCA lpLocaleEnumProc, DWORD dwFlags) -> BOOL
    stubs.registerStub("kernel32.dll", "EnumSystemLocalesA", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE (just say we enumerated them)
        cleanupStdcall(cpu, memory, 8);
    });

    // GetLocaleInfoW(LCID Locale, LCTYPE LCType, LPWSTR lpLCData, int cchData) -> int
    stubs.registerStub("kernel32.dll", "GetLocaleInfoW", (cpu) => {
        cpu.regs[REG.EAX] = 0; // failure (no data available)
        cleanupStdcall(cpu, memory, 16);
    });

    // SetConsoleCtrlHandler(PHANDLER_ROUTINE HandlerRoutine, BOOL Add) -> BOOL
    stubs.registerStub("kernel32.dll", "SetConsoleCtrlHandler", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });

    // SetEnvironmentVariableA(LPCSTR lpName, LPCSTR lpValue) -> BOOL
    stubs.registerStub("kernel32.dll", "SetEnvironmentVariableA", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });

    // SetEnvironmentVariableW(LPCWSTR lpName, LPCWSTR lpValue) -> BOOL
    stubs.registerStub("kernel32.dll", "SetEnvironmentVariableW", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });

    // VirtualProtect(LPVOID lpAddress, SIZE_T dwSize, DWORD flNewProtect, PDWORD lpflOldProtect) -> BOOL
    stubs.registerStub("kernel32.dll", "VirtualProtect", (cpu) => {
        const lpflOldProtect = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        if (lpflOldProtect !== 0) {
            memory.write32(lpflOldProtect, 0x04); // PAGE_READWRITE
        }
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 16);
    });

    // lstrlenA(LPCSTR lpString) -> int
    stubs.registerStub("kernel32.dll", "lstrlenA", (cpu) => {
        const lpStr = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        let len = 0;
        if (lpStr !== 0) {
            while (len < 65536) {
                if (memory.read8(lpStr + len) === 0) break;
                len++;
            }
        }
        cpu.regs[REG.EAX] = len;
        cleanupStdcall(cpu, memory, 4);
    });

    // lstrcpyA(LPSTR lpString1, LPCSTR lpString2) -> LPSTR
    stubs.registerStub("kernel32.dll", "lstrcpyA", (cpu) => {
        const lpDst = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const lpSrc = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        let i = 0;
        while (i < 65536) {
            const ch = memory.read8(lpSrc + i);
            memory.write8(lpDst + i, ch);
            if (ch === 0) break;
            i++;
        }
        cpu.regs[REG.EAX] = lpDst;
        cleanupStdcall(cpu, memory, 8);
    });

    // LocalAlloc(UINT uFlags, SIZE_T uBytes) -> HLOCAL
    stubs.registerStub("kernel32.dll", "LocalAlloc", (cpu) => {
        const uBytes = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        // Use our simple heap
        const addr = simpleAlloc(uBytes);
        cpu.regs[REG.EAX] = addr;
        cleanupStdcall(cpu, memory, 8);
    });

    // LocalFree(HLOCAL hMem) -> HLOCAL
    stubs.registerStub("kernel32.dll", "LocalFree", (cpu) => {
        cpu.regs[REG.EAX] = 0; // NULL = success
        cleanupStdcall(cpu, memory, 4);
    });

    // GlobalAlloc(UINT uFlags, SIZE_T dwBytes) -> HGLOBAL
    stubs.registerStub("kernel32.dll", "GlobalAlloc", (cpu) => {
        const dwBytes = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const addr = simpleAlloc(dwBytes);
        cpu.regs[REG.EAX] = addr;
        cleanupStdcall(cpu, memory, 8);
    });

    // GlobalFree(HGLOBAL hMem) -> HGLOBAL
    stubs.registerStub("kernel32.dll", "GlobalFree", (cpu) => {
        cpu.regs[REG.EAX] = 0; // NULL = success
        cleanupStdcall(cpu, memory, 4);
    });

    // HeapValidate(HANDLE hHeap, DWORD dwFlags, LPCVOID lpMem) -> BOOL
    stubs.registerStub("kernel32.dll", "HeapValidate", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE (heap is valid)
        cleanupStdcall(cpu, memory, 12);
    });

    // HeapDestroy(HANDLE hHeap) -> BOOL
    stubs.registerStub("kernel32.dll", "HeapDestroy", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // DuplicateHandle(HANDLE, HANDLE, HANDLE, LPHANDLE, DWORD, BOOL, DWORD) -> BOOL
    stubs.registerStub("kernel32.dll", "DuplicateHandle", (cpu) => {
        const lpTargetHandle = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        if (lpTargetHandle !== 0) {
            // Write a fake handle
            memory.write32(lpTargetHandle, 0x200);
        }
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 28);
    });

    // SetFilePointer(HANDLE, LONG, PLONG, DWORD) -> DWORD
    stubs.registerStub("kernel32.dll", "SetFilePointer", (cpu) => {
        cpu.regs[REG.EAX] = 0; // new position = 0
        cleanupStdcall(cpu, memory, 16);
    });

    // FlushFileBuffers(HANDLE hFile) -> BOOL
    stubs.registerStub("kernel32.dll", "FlushFileBuffers", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // SetEndOfFile(HANDLE hFile) -> BOOL
    stubs.registerStub("kernel32.dll", "SetEndOfFile", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // GetCurrentDirectoryA(DWORD nBufferLength, LPSTR lpBuffer) -> DWORD
    stubs.registerStub("kernel32.dll", "GetCurrentDirectoryA", (cpu) => {
        const nBufferLength = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const lpBuffer = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const dir = "C:\\MCity";
        if (nBufferLength > dir.length) {
            for (let i = 0; i < dir.length; i++) {
                memory.write8(lpBuffer + i, dir.charCodeAt(i));
            }
            memory.write8(lpBuffer + dir.length, 0);
            cpu.regs[REG.EAX] = dir.length;
        } else {
            cpu.regs[REG.EAX] = dir.length + 1; // required size
        }
        cleanupStdcall(cpu, memory, 8);
    });

    // SetCurrentDirectoryA(LPCSTR lpPathName) -> BOOL
    stubs.registerStub("kernel32.dll", "SetCurrentDirectoryA", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // GetWindowsDirectoryA(LPSTR lpBuffer, UINT uSize) -> UINT
    stubs.registerStub("kernel32.dll", "GetWindowsDirectoryA", (cpu) => {
        const lpBuffer = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const uSize = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const dir = "C:\\WINDOWS";
        if (uSize > dir.length) {
            for (let i = 0; i < dir.length; i++) {
                memory.write8(lpBuffer + i, dir.charCodeAt(i));
            }
            memory.write8(lpBuffer + dir.length, 0);
        }
        cpu.regs[REG.EAX] = dir.length;
        cleanupStdcall(cpu, memory, 8);
    });

    // --- MSVCRT stubs ---

    // _initterm(PVOID* pfbegin, PVOID* pfend) -> void
    // Calls each non-null function pointer in the array [pfbegin, pfend)
    // For now, just skip it - these are C++ static initializers
    stubs.registerStub("msvcrt.dll", "_initterm", (_cpu) => {
        // cdecl: caller cleans up args
    });

    // _initterm_e(PVOID* pfbegin, PVOID* pfend) -> int
    stubs.registerStub("msvcrt.dll", "_initterm_e", (cpu) => {
        cpu.regs[REG.EAX] = 0; // success
        // cdecl: caller cleans up args
    });

    // __set_app_type(int apptype) -> void
    stubs.registerStub("msvcrt.dll", "__set_app_type", (_cpu) => {
        // cdecl: caller cleans up args
    });

    // __p__fmode() -> int*
    const fmodeAddr = 0x00201400;
    memory.write32(fmodeAddr, 0); // _O_TEXT
    stubs.registerStub("msvcrt.dll", "__p__fmode", (cpu) => {
        cpu.regs[REG.EAX] = fmodeAddr;
    });

    // __p__commode() -> int*
    const commodeAddr = 0x00201404;
    memory.write32(commodeAddr, 0);
    stubs.registerStub("msvcrt.dll", "__p__commode", (cpu) => {
        cpu.regs[REG.EAX] = commodeAddr;
    });

    // _controlfp(unsigned int new, unsigned int mask) -> unsigned int
    stubs.registerStub("msvcrt.dll", "_controlfp", (cpu) => {
        cpu.regs[REG.EAX] = 0x0001001F; // default FP control word
        // cdecl: caller cleans up
    });

    // _except_handler3 - SEH handler (cdecl calling convention)
    stubs.registerStub("msvcrt.dll", "_except_handler3", (cpu) => {
        cpu.regs[REG.EAX] = 1; // ExceptionContinueSearch
        // cdecl: caller cleans up args
    });

    // __getmainargs(int* argc, char*** argv, char*** envp, int doWildCard, _startupinfo* startupInfo) -> int
    // Set up minimal argc/argv for the game
    const argcAddr = 0x00201500;
    const argvAddr = 0x00201504;
    const envpAddr = 0x00201508;
    const argvArrayAddr = 0x00201510;
    // argv[0] = pointer to exe name, argv[1] = NULL
    memory.write32(argvArrayAddr, cmdLineAddr); // points to "MCity_d.exe"
    memory.write32(argvArrayAddr + 4, 0);       // NULL terminator
    memory.write32(argcAddr, 1);
    memory.write32(argvAddr, argvArrayAddr);
    memory.write32(envpAddr, envStrAAddr);

    stubs.registerStub("msvcrt.dll", "__getmainargs", (cpu) => {
        // Write to the pointers passed as arguments
        const pArgc = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const pArgv = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const pEnvp = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        memory.write32(pArgc, 1);
        memory.write32(pArgv, argvArrayAddr);
        memory.write32(pEnvp, envStrAAddr);
        cpu.regs[REG.EAX] = 0; // success
        // cdecl: caller cleans up
    });

    // =============== USER32.DLL ===============

    // MessageBoxA(HWND hWnd, LPCSTR lpText, LPCSTR lpCaption, UINT uType) -> int
    stubs.registerStub("user32.dll", "MessageBoxA", (cpu) => {
        const lpText = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const lpCaption = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const uType = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        let text = "", caption = "";
        for (let i = 0; i < 1024; i++) { const ch = memory.read8(lpText + i); if (ch === 0) break; text += String.fromCharCode(ch); }
        for (let i = 0; i < 256; i++) { const ch = memory.read8(lpCaption + i); if (ch === 0) break; caption += String.fromCharCode(ch); }
        console.log(`\n  [Win32] MessageBoxA("${caption}", "${text.replace(/\n/g, "\\n")}")`);
        // MB_ABORTRETRYIGNORE has Abort=3, Retry=4, Ignore=5
        // MB_OK has OK=1
        // For debug assertions, return Ignore (5) to continue execution
        // uType & 0xF gives the button type: 2 = MB_ABORTRETRYIGNORE
        const btnType = uType & 0xF;
        if (btnType === 2) {
            cpu.regs[REG.EAX] = 5; // IDIGNORE - continue past assertion
        } else {
            cpu.regs[REG.EAX] = 1; // IDOK
        }
        cleanupStdcall(cpu, memory, 16);
    });

    // MessageBoxW(HWND hWnd, LPCWSTR lpText, LPCWSTR lpCaption, UINT uType) -> int
    stubs.registerStub("user32.dll", "MessageBoxW", (cpu) => {
        console.log(`  [Win32] MessageBoxW() called`);
        cpu.regs[REG.EAX] = 1; // IDOK
        cleanupStdcall(cpu, memory, 16);
    });

    // GetActiveWindow() -> HWND
    stubs.registerStub("user32.dll", "GetActiveWindow", (cpu) => {
        cpu.regs[REG.EAX] = 0; // NULL (no active window)
    });

    // GetLastActivePopup(HWND hWnd) -> HWND
    stubs.registerStub("user32.dll", "GetLastActivePopup", (cpu) => {
        // Return the same handle passed in (or NULL if NULL)
        const hWnd = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        cpu.regs[REG.EAX] = hWnd;
        cleanupStdcall(cpu, memory, 4);
    });

    // DialogBoxParamA(hInstance, lpTemplateName, hWndParent, lpDialogFunc, dwInitParam) -> INT_PTR
    stubs.registerStub("user32.dll", "DialogBoxParamA", (cpu) => {
        const lpTemplateName = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        let name = lpTemplateName > 0xFFFF ? "" : `#${lpTemplateName}`;
        if (lpTemplateName > 0xFFFF) {
            for (let i = 0; i < 64; i++) { const c = memory.read8(lpTemplateName + i); if (!c) break; name += String.fromCharCode(c); }
        }
        console.log(`  [Win32] DialogBoxParamA("${name}") -> IDOK`);
        cpu.regs[REG.EAX] = 1; // IDOK=1
        cleanupStdcall(cpu, memory, 20);
    });

    // DialogBoxParamW(hInstance, lpTemplateName, hWndParent, lpDialogFunc, dwInitParam) -> INT_PTR
    stubs.registerStub("user32.dll", "DialogBoxParamW", (cpu) => {
        console.log(`  [Win32] DialogBoxParamW() -> 0`);
        cpu.regs[REG.EAX] = 0;
        cleanupStdcall(cpu, memory, 20);
    });

    // DialogBoxIndirectParamA(hInstance, hDialogTemplate, hWndParent, lpDialogFunc, dwInitParam) -> INT_PTR
    stubs.registerStub("user32.dll", "DialogBoxIndirectParamA", (cpu) => {
        console.log(`  [Win32] DialogBoxIndirectParamA() -> 0`);
        cpu.regs[REG.EAX] = 0;
        cleanupStdcall(cpu, memory, 20);
    });

    // CreateDialogParamA(hInstance, lpTemplateName, hWndParent, lpDialogFunc, dwInitParam) -> HWND
    stubs.registerStub("user32.dll", "CreateDialogParamA", (cpu) => {
        console.log(`  [Win32] CreateDialogParamA() -> 0`);
        cpu.regs[REG.EAX] = 0; // NULL (failure)
        cleanupStdcall(cpu, memory, 20);
    });

    // EndDialog(HWND hDlg, INT_PTR nResult) -> BOOL
    stubs.registerStub("user32.dll", "EndDialog", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });

    // RegisterClassA(WNDCLASSA*) -> ATOM
    stubs.registerStub("user32.dll", "RegisterClassA", (cpu) => {
        cpu.regs[REG.EAX] = 0xC001; // fake ATOM
        cleanupStdcall(cpu, memory, 4);
    });

    // RegisterClassExA(WNDCLASSEXA*) -> ATOM
    stubs.registerStub("user32.dll", "RegisterClassExA", (cpu) => {
        cpu.regs[REG.EAX] = 0xC001; // fake ATOM
        cleanupStdcall(cpu, memory, 4);
    });

    // RegisterClassW(WNDCLASSW*) -> ATOM
    stubs.registerStub("user32.dll", "RegisterClassW", (cpu) => {
        cpu.regs[REG.EAX] = 0xC002; // fake ATOM
        cleanupStdcall(cpu, memory, 4);
    });

    // RegisterClassExW(WNDCLASSEXW*) -> ATOM
    stubs.registerStub("user32.dll", "RegisterClassExW", (cpu) => {
        cpu.regs[REG.EAX] = 0xC002; // fake ATOM
        cleanupStdcall(cpu, memory, 4);
    });

    // UnregisterClassA(LPCSTR lpClassName, HINSTANCE hInstance) -> BOOL
    stubs.registerStub("user32.dll", "UnregisterClassA", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });

    // CreateWindowExA(dwExStyle, lpClassName, lpWindowName, dwStyle, X, Y, nWidth, nHeight, hWndParent, hMenu, hInstance, lpParam) -> HWND
    stubs.registerStub("user32.dll", "CreateWindowExA", (cpu) => {
        const lpClassName = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        let name = "";
        if (lpClassName > 0xFFFF) { for (let i = 0; i < 64; i++) { const c = memory.read8(lpClassName + i); if (!c) break; name += String.fromCharCode(c); } }
        else name = `#${lpClassName}`;
        console.log(`  [Win32] CreateWindowExA("${name}") -> 0xABCD`);
        cpu.regs[REG.EAX] = 0xABCD; // fake HWND
        cleanupStdcall(cpu, memory, 48);
    });

    // CreateWindowExW(dwExStyle, lpClassName, lpWindowName, dwStyle, X, Y, nWidth, nHeight, hWndParent, hMenu, hInstance, lpParam) -> HWND
    stubs.registerStub("user32.dll", "CreateWindowExW", (cpu) => {
        console.log(`  [Win32] CreateWindowExW() -> 0xABCD`);
        cpu.regs[REG.EAX] = 0xABCD; // fake HWND
        cleanupStdcall(cpu, memory, 48);
    });

    // DestroyWindow(HWND hWnd) -> BOOL
    stubs.registerStub("user32.dll", "DestroyWindow", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // ShowWindow(HWND hWnd, int nCmdShow) -> BOOL
    stubs.registerStub("user32.dll", "ShowWindow", (cpu) => {
        cpu.regs[REG.EAX] = 0; // previously hidden
        cleanupStdcall(cpu, memory, 8);
    });

    // UpdateWindow(HWND hWnd) -> BOOL
    stubs.registerStub("user32.dll", "UpdateWindow", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // SetWindowPos(HWND, HWND, x, y, cx, cy, uFlags) -> BOOL
    stubs.registerStub("user32.dll", "SetWindowPos", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 28);
    });

    // GetWindowRect(HWND hWnd, LPRECT lpRect) -> BOOL
    stubs.registerStub("user32.dll", "GetWindowRect", (cpu) => {
        cpu.regs[REG.EAX] = 0; // FALSE (no real window)
        cleanupStdcall(cpu, memory, 8);
    });

    // GetClientRect(HWND hWnd, LPRECT lpRect) -> BOOL
    stubs.registerStub("user32.dll", "GetClientRect", (cpu) => {
        const lpRect = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        if (lpRect) { memory.write32(lpRect, 0); memory.write32(lpRect + 4, 0); memory.write32(lpRect + 8, 800); memory.write32(lpRect + 12, 600); }
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });

    // GetSystemMetrics(int nIndex) -> int
    stubs.registerStub("user32.dll", "GetSystemMetrics", (cpu) => {
        const nIndex = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        // SM_CXSCREEN=0, SM_CYSCREEN=1
        if (nIndex === 0) cpu.regs[REG.EAX] = 800;
        else if (nIndex === 1) cpu.regs[REG.EAX] = 600;
        else cpu.regs[REG.EAX] = 0;
        cleanupStdcall(cpu, memory, 4);
    });

    // GetForegroundWindow() -> HWND
    stubs.registerStub("user32.dll", "GetForegroundWindow", (cpu) => {
        cpu.regs[REG.EAX] = 0xABCD; // fake HWND
    });

    // SetForegroundWindow(HWND hWnd) -> BOOL
    stubs.registerStub("user32.dll", "SetForegroundWindow", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });

    // GetDC(HWND hWnd) -> HDC
    stubs.registerStub("user32.dll", "GetDC", (cpu) => {
        cpu.regs[REG.EAX] = 0x1DC; // fake HDC
        cleanupStdcall(cpu, memory, 4);
    });

    // ReleaseDC(HWND hWnd, HDC hDC) -> int
    stubs.registerStub("user32.dll", "ReleaseDC", (cpu) => {
        cpu.regs[REG.EAX] = 1; // released
        cleanupStdcall(cpu, memory, 8);
    });

    // PeekMessageA(LPMSG lpMsg, HWND hWnd, UINT wMsgFilterMin, UINT wMsgFilterMax, UINT wRemoveMsg) -> BOOL
    stubs.registerStub("user32.dll", "PeekMessageA", (cpu) => {
        cpu.regs[REG.EAX] = 0; // FALSE (no messages)
        cleanupStdcall(cpu, memory, 20);
    });

    // GetMessageA(LPMSG lpMsg, HWND hWnd, UINT wMsgFilterMin, UINT wMsgFilterMax) -> BOOL
    stubs.registerStub("user32.dll", "GetMessageA", (cpu) => {
        // Return WM_QUIT (0x12) to exit message loops
        const lpMsg = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        if (lpMsg) { memory.write32(lpMsg, 0xABCD); memory.write32(lpMsg + 4, 0x12); } // HWND, WM_QUIT
        cpu.regs[REG.EAX] = 0; // FALSE = WM_QUIT
        cleanupStdcall(cpu, memory, 16);
    });

    // TranslateMessage(MSG*) -> BOOL
    stubs.registerStub("user32.dll", "TranslateMessage", (cpu) => {
        cpu.regs[REG.EAX] = 0;
        cleanupStdcall(cpu, memory, 4);
    });

    // DispatchMessageA(MSG*) -> LRESULT
    stubs.registerStub("user32.dll", "DispatchMessageA", (cpu) => {
        cpu.regs[REG.EAX] = 0;
        cleanupStdcall(cpu, memory, 4);
    });

    // PostQuitMessage(int nExitCode) -> void
    stubs.registerStub("user32.dll", "PostQuitMessage", (cpu) => {
        console.log(`  [Win32] PostQuitMessage()`);
        cleanupStdcall(cpu, memory, 4);
    });

    // LoadCursorA(hInstance, lpCursorName) -> HCURSOR
    stubs.registerStub("user32.dll", "LoadCursorA", (cpu) => {
        cpu.regs[REG.EAX] = 0x1001; // fake HCURSOR
        cleanupStdcall(cpu, memory, 8);
    });

    // LoadIconA(hInstance, lpIconName) -> HICON
    stubs.registerStub("user32.dll", "LoadIconA", (cpu) => {
        cpu.regs[REG.EAX] = 0x1002; // fake HICON
        cleanupStdcall(cpu, memory, 8);
    });

    // SetCursor(HCURSOR hCursor) -> HCURSOR
    stubs.registerStub("user32.dll", "SetCursor", (cpu) => {
        const prev = cpu.regs[REG.EAX];
        cpu.regs[REG.EAX] = 0x1001;
        cleanupStdcall(cpu, memory, 4);
    });

    // =============== OLEAUT32: BSTR / VARIANT / SafeArray ===============
    // BSTR layout in memory: [4-byte byte-length] [wide-char data...] [null terminator]
    // The pointer returned points to the character data, length prefix is at ptr-4.

    // SysAllocString(LPCOLESTR psz) -> BSTR
    stubs.registerStub("oleaut32.dll", "SysAllocString", (cpu) => {
        const psz = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        if (psz === 0) {
            cpu.regs[REG.EAX] = 0;
            cleanupStdcall(cpu, memory, 4);
            return;
        }
        let len = 0;
        while (memory.read16(psz + len * 2) !== 0) len++;
        const byteLen = len * 2;
        const block = simpleAlloc(4 + byteLen + 2);
        memory.write32(block, byteLen);
        for (let i = 0; i < byteLen + 2; i++) {
            memory.write8(block + 4 + i, memory.read8(psz + i));
        }
        cpu.regs[REG.EAX] = (block + 4) >>> 0;
        cleanupStdcall(cpu, memory, 4);
    });

    // SysAllocStringLen(LPCOLESTR psz, UINT len) -> BSTR
    stubs.registerStub("oleaut32.dll", "SysAllocStringLen", (cpu) => {
        const psz = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const len = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const byteLen = len * 2;
        const block = simpleAlloc(4 + byteLen + 2);
        memory.write32(block, byteLen);
        if (psz !== 0) {
            for (let i = 0; i < byteLen; i++) {
                memory.write8(block + 4 + i, memory.read8(psz + i));
            }
        }
        memory.write16(block + 4 + byteLen, 0);
        cpu.regs[REG.EAX] = (block + 4) >>> 0;
        cleanupStdcall(cpu, memory, 8);
    });

    // SysAllocStringByteLen(LPCSTR psz, UINT len) -> BSTR
    stubs.registerStub("oleaut32.dll", "SysAllocStringByteLen", (cpu) => {
        const psz = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const len = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const block = simpleAlloc(4 + len + 2);
        memory.write32(block, len);
        if (psz !== 0) {
            for (let i = 0; i < len; i++) {
                memory.write8(block + 4 + i, memory.read8(psz + i));
            }
        }
        memory.write16(block + 4 + len, 0);
        cpu.regs[REG.EAX] = (block + 4) >>> 0;
        cleanupStdcall(cpu, memory, 8);
    });

    // SysReAllocString(BSTR* pbstr, LPCOLESTR psz) -> INT
    stubs.registerStub("oleaut32.dll", "SysReAllocString", (cpu) => {
        const pbstr = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const psz = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        let len = 0;
        if (psz !== 0) {
            while (memory.read16(psz + len * 2) !== 0) len++;
        }
        const byteLen = len * 2;
        const block = simpleAlloc(4 + byteLen + 2);
        memory.write32(block, byteLen);
        if (psz !== 0) {
            for (let i = 0; i < byteLen + 2; i++) {
                memory.write8(block + 4 + i, memory.read8(psz + i));
            }
        }
        memory.write16(block + 4 + byteLen, 0);
        memory.write32(pbstr, (block + 4) >>> 0);
        cpu.regs[REG.EAX] = 1;
        cleanupStdcall(cpu, memory, 8);
    });

    // SysReAllocStringLen(BSTR* pbstr, LPCOLESTR psz, UINT len) -> INT
    stubs.registerStub("oleaut32.dll", "SysReAllocStringLen", (cpu) => {
        const pbstr = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const psz = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const len = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const byteLen = len * 2;
        const block = simpleAlloc(4 + byteLen + 2);
        memory.write32(block, byteLen);
        if (psz !== 0) {
            for (let i = 0; i < byteLen; i++) {
                memory.write8(block + 4 + i, memory.read8(psz + i));
            }
        }
        memory.write16(block + 4 + byteLen, 0);
        memory.write32(pbstr, (block + 4) >>> 0);
        cpu.regs[REG.EAX] = 1;
        cleanupStdcall(cpu, memory, 12);
    });

    // SysFreeString(BSTR bstr) -> void
    stubs.registerStub("oleaut32.dll", "SysFreeString", (cpu) => {
        cleanupStdcall(cpu, memory, 4);
    });

    // SysStringLen(BSTR bstr) -> UINT (character count)
    stubs.registerStub("oleaut32.dll", "SysStringLen", (cpu) => {
        const bstr = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        if (bstr === 0) {
            cpu.regs[REG.EAX] = 0;
        } else {
            const byteLen = memory.read32((bstr - 4) >>> 0);
            cpu.regs[REG.EAX] = (byteLen / 2) >>> 0;
        }
        cleanupStdcall(cpu, memory, 4);
    });

    // SysStringByteLen(BSTR bstr) -> UINT (byte count)
    stubs.registerStub("oleaut32.dll", "SysStringByteLen", (cpu) => {
        const bstr = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        if (bstr === 0) {
            cpu.regs[REG.EAX] = 0;
        } else {
            cpu.regs[REG.EAX] = memory.read32((bstr - 4) >>> 0);
        }
        cleanupStdcall(cpu, memory, 4);
    });

    // VariantInit(VARIANTARG *pvarg) -> void
    stubs.registerStub("oleaut32.dll", "VariantInit", (cpu) => {
        const pv = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        if (pv !== 0) {
            for (let i = 0; i < 16; i++) memory.write8(pv + i, 0);
        }
        cleanupStdcall(cpu, memory, 4);
    });

    // VariantClear(VARIANTARG *pvarg) -> HRESULT
    stubs.registerStub("oleaut32.dll", "VariantClear", (cpu) => {
        const pv = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        if (pv !== 0) {
            for (let i = 0; i < 16; i++) memory.write8(pv + i, 0);
        }
        cpu.regs[REG.EAX] = 0; // S_OK
        cleanupStdcall(cpu, memory, 4);
    });

    // VariantChangeType -> HRESULT
    stubs.registerStub("oleaut32.dll", "VariantChangeType", (cpu) => {
        cpu.regs[REG.EAX] = 0; // S_OK
        cleanupStdcall(cpu, memory, 16);
    });

    // SafeArrayCreate -> SAFEARRAY*
    stubs.registerStub("oleaut32.dll", "SafeArrayCreate", (cpu) => {
        const vt = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const cDims = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const rgsabound = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const headerSize = 16 + cDims * 8;
        let totalElements = 1;
        const elemSize = (vt === 8) ? 4 : 4; // VT_BSTR=4-byte ptrs, default 4
        for (let d = 0; d < cDims; d++) {
            totalElements *= memory.read32(rgsabound + d * 8);
        }
        const dataSize = totalElements * elemSize;
        const saBlock = simpleAlloc(headerSize + dataSize);
        memory.write16(saBlock, cDims);
        memory.write16(saBlock + 2, 0);
        memory.write32(saBlock + 4, elemSize);
        memory.write32(saBlock + 8, 0);
        memory.write32(saBlock + 12, (saBlock + headerSize) >>> 0);
        for (let d = 0; d < cDims; d++) {
            memory.write32(saBlock + 16 + d * 8, memory.read32(rgsabound + d * 8));
            memory.write32(saBlock + 16 + d * 8 + 4, memory.read32(rgsabound + d * 8 + 4));
        }
        for (let i = 0; i < dataSize; i++) memory.write8(saBlock + headerSize + i, 0);
        cpu.regs[REG.EAX] = saBlock >>> 0;
        cleanupStdcall(cpu, memory, 12);
    });

    // SafeArrayGetDim(SAFEARRAY *psa) -> UINT
    stubs.registerStub("oleaut32.dll", "SafeArrayGetDim", (cpu) => {
        const psa = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        cpu.regs[REG.EAX] = psa ? memory.read16(psa) : 0;
        cleanupStdcall(cpu, memory, 4);
    });

    // SafeArrayGetElemsize(SAFEARRAY *psa) -> UINT
    stubs.registerStub("oleaut32.dll", "SafeArrayGetElemsize", (cpu) => {
        const psa = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        cpu.regs[REG.EAX] = psa ? memory.read32(psa + 4) : 0;
        cleanupStdcall(cpu, memory, 4);
    });

    // SafeArrayGetUBound(SAFEARRAY *psa, UINT nDim, LONG *plUbound) -> HRESULT
    stubs.registerStub("oleaut32.dll", "SafeArrayGetUBound", (cpu) => {
        const psa = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const nDim = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const plUbound = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        if (psa && plUbound) {
            const off = 16 + (nDim - 1) * 8;
            memory.write32(plUbound, (memory.read32(psa + off + 4) + memory.read32(psa + off) - 1) >>> 0);
        }
        cpu.regs[REG.EAX] = 0;
        cleanupStdcall(cpu, memory, 12);
    });

    // SafeArrayGetLBound(SAFEARRAY *psa, UINT nDim, LONG *plLbound) -> HRESULT
    stubs.registerStub("oleaut32.dll", "SafeArrayGetLBound", (cpu) => {
        const psa = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const nDim = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const plLbound = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        if (psa && plLbound) {
            memory.write32(plLbound, memory.read32(psa + 16 + (nDim - 1) * 8 + 4));
        }
        cpu.regs[REG.EAX] = 0;
        cleanupStdcall(cpu, memory, 12);
    });

    // SafeArrayAccessData(SAFEARRAY *psa, void **ppvData) -> HRESULT
    stubs.registerStub("oleaut32.dll", "SafeArrayAccessData", (cpu) => {
        const psa = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const ppvData = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        if (psa && ppvData) memory.write32(ppvData, memory.read32(psa + 12));
        cpu.regs[REG.EAX] = 0;
        cleanupStdcall(cpu, memory, 8);
    });

    stubs.registerStub("oleaut32.dll", "SafeArrayUnaccessData", (cpu) => {
        cpu.regs[REG.EAX] = 0;
        cleanupStdcall(cpu, memory, 4);
    });

    stubs.registerStub("oleaut32.dll", "SafeArrayRedim", (cpu) => {
        cpu.regs[REG.EAX] = 0;
        cleanupStdcall(cpu, memory, 8);
    });

    stubs.registerStub("oleaut32.dll", "SafeArrayPutElement", (cpu) => {
        cpu.regs[REG.EAX] = 0;
        cleanupStdcall(cpu, memory, 12);
    });

    stubs.registerStub("oleaut32.dll", "SafeArrayDestroy", (cpu) => {
        cpu.regs[REG.EAX] = 0;
        cleanupStdcall(cpu, memory, 4);
    });

    // =============== OLE32: COM ===============

    stubs.registerStub("ole32.dll", "CoInitialize", (cpu) => {
        cpu.regs[REG.EAX] = 0; // S_OK
        cleanupStdcall(cpu, memory, 4);
    });

    stubs.registerStub("ole32.dll", "CoInitializeEx", (cpu) => {
        cpu.regs[REG.EAX] = 0; // S_OK
        cleanupStdcall(cpu, memory, 8);
    });

    stubs.registerStub("ole32.dll", "CoUninitialize", (cpu) => {
        cleanupStdcall(cpu, memory, 0);
    });

    stubs.registerStub("ole32.dll", "CoCreateInstance", (cpu) => {
        cpu.regs[REG.EAX] = 0x80040154; // REGDB_E_CLASSNOTREG
        cleanupStdcall(cpu, memory, 20);
    });

    // ==================== advapi32.dll: Registry API ====================
    // Game reads/writes registry keys for settings. We return ERROR_FILE_NOT_FOUND
    // for reads and ERROR_SUCCESS for writes, simulating an empty registry.

    const ERROR_SUCCESS = 0;
    const ERROR_FILE_NOT_FOUND = 2;
    const ERROR_MORE_DATA = 234;
    const ERROR_NO_MORE_ITEMS = 259;

    // Fake registry key handle counter and name tracking
    let nextRegKey = 0xBEEF0200;
    const regKeyNames = new Map<number, string>(); // handle → key name
    function readAnsiStr(ptr: number, max = 256): string {
        let s = "";
        for (let i = 0; i < max; i++) { const c = memory.read8(ptr + i); if (!c) break; s += String.fromCharCode(c); }
        return s;
    }
    function writeAnsiStr(ptr: number, s: string): void {
        for (let i = 0; i < s.length; i++) memory.write8(ptr + i, s.charCodeAt(i));
        memory.write8(ptr + s.length, 0);
    }

    // Registry values loaded from registry.json in the project root for easy editing
    const registryValues: RegistryMap = loadRegistryJson();

    function regQueryValue(keyHandle: number, valueName: string): { type: number; value: string | number } | null {
        const keyName = (regKeyNames.get(keyHandle) ?? "").toLowerCase();
        const lowerValue = valueName.toLowerCase();
        // Search by matching suffix of the key name
        for (const [pattern, values] of Object.entries(registryValues)) {
            if (keyName.endsWith(pattern) || keyName === pattern) {
                const v = values[lowerValue];
                if (v !== undefined) return v;
            }
        }
        return null;
    }

    // RegOpenKeyA(hKey, lpSubKey, phkResult) - stdcall, 3 args (12 bytes)
    stubs.registerStub("advapi32.dll", "RegOpenKeyA", (cpu) => {
        const lpSubKey = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const phkResult = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const keyName = lpSubKey ? readAnsiStr(lpSubKey) : "";
        console.log(`  [Win32] RegOpenKeyA("${keyName}")`);
        const handle = nextRegKey++;
        regKeyNames.set(handle, keyName);
        if (phkResult) memory.write32(phkResult, handle);
        cpu.regs[REG.EAX] = ERROR_SUCCESS;
        cleanupStdcall(cpu, memory, 12);
    });

    // RegOpenKeyExA(hKey, lpSubKey, ulOptions, samDesired, phkResult) - stdcall, 5 args (20 bytes)
    stubs.registerStub("advapi32.dll", "RegOpenKeyExA", (cpu) => {
        const hKeyIn = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const lpSubKey = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const phkResult = memory.read32((cpu.regs[REG.ESP] + 20) >>> 0);
        const keyName = lpSubKey ? readAnsiStr(lpSubKey) : "";
        // Build full key name by combining parent with subkey
        const parentName = regKeyNames.get(hKeyIn) ?? `HKEY:${hKeyIn.toString(16)}`;
        const fullName = keyName ? `${parentName}\\${keyName}` : parentName;
        console.log(`  [Win32] RegOpenKeyExA(parent=0x${hKeyIn.toString(16)}, "${keyName}") phkResult@0x${phkResult.toString(16)}`);
        const handle = nextRegKey++;
        regKeyNames.set(handle, fullName);
        if (phkResult) memory.write32(phkResult, handle);
        cpu.regs[REG.EAX] = ERROR_SUCCESS;
        cleanupStdcall(cpu, memory, 20);
    });

    // RegOpenKeyExW(hKey, lpSubKey, ulOptions, samDesired, phkResult) - stdcall, 5 args (20 bytes)
    stubs.registerStub("advapi32.dll", "RegOpenKeyExW", (cpu) => {
        cpu.regs[REG.EAX] = ERROR_FILE_NOT_FOUND;
        cleanupStdcall(cpu, memory, 20);
    });

    // RegCreateKeyA(hKey, lpSubKey, phkResult) - stdcall, 3 args (12 bytes)
    stubs.registerStub("advapi32.dll", "RegCreateKeyA", (cpu) => {
        // Return a fake handle and success
        const phkResult = memory.read32(cpu.regs[REG.ESP] + 12); // [ESP+4]=hKey, [ESP+8]=lpSubKey, [ESP+12]=phkResult
        if (phkResult) memory.write32(phkResult, 0xBEEF0100); // fake registry key handle
        cpu.regs[REG.EAX] = ERROR_SUCCESS;
        cleanupStdcall(cpu, memory, 12);
    });

    // RegCreateKeyExA(hKey, lpSubKey, Reserved, lpClass, dwOptions, samDesired, lpSecurityAttributes, phkResult, lpdwDisposition) - 9 args (36 bytes)
    stubs.registerStub("advapi32.dll", "RegCreateKeyExA", (cpu) => {
        const phkResult = memory.read32(cpu.regs[REG.ESP] + 32); // 8th arg
        if (phkResult) memory.write32(phkResult, 0xBEEF0101);
        const lpdwDisposition = memory.read32(cpu.regs[REG.ESP] + 36); // 9th arg
        if (lpdwDisposition) memory.write32(lpdwDisposition, 2); // REG_CREATED_NEW_KEY
        cpu.regs[REG.EAX] = ERROR_SUCCESS;
        cleanupStdcall(cpu, memory, 36);
    });

    // RegQueryValueA(hKey, lpSubKey, lpData, lpcbData) - stdcall, 4 args (16 bytes)
    stubs.registerStub("advapi32.dll", "RegQueryValueA", (cpu) => {
        cpu.regs[REG.EAX] = ERROR_FILE_NOT_FOUND;
        cleanupStdcall(cpu, memory, 16);
    });

    // RegQueryValueExA(hKey, lpValueName, lpReserved, lpType, lpData, lpcbData) - stdcall, 6 args (24 bytes)
    stubs.registerStub("advapi32.dll", "RegQueryValueExA", (cpu) => {
        const hKey = memory.read32((cpu.regs[REG.ESP] + 4) >>> 0);
        const lpValueName = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const lpType = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        const lpData = memory.read32((cpu.regs[REG.ESP] + 20) >>> 0);
        const lpcbData = memory.read32((cpu.regs[REG.ESP] + 24) >>> 0);
        const valueName = lpValueName ? readAnsiStr(lpValueName) : "";
        const entry = regQueryValue(hKey, valueName);
        console.log(`  [Win32] RegQueryValueExA(key=0x${hKey.toString(16)}, "${valueName}") -> ${entry ? JSON.stringify(entry.value) : "NOT FOUND"}`);
        if (!entry) {
            cpu.regs[REG.EAX] = ERROR_FILE_NOT_FOUND;
        } else {
            if (entry.type === 4) { // REG_DWORD
                const needed = 4;
                if (lpcbData) {
                    const cbData = memory.read32(lpcbData);
                    memory.write32(lpcbData, needed);
                    if (lpData && cbData >= needed) {
                        memory.write32(lpData, entry.value as number);
                    }
                }
                if (lpType) memory.write32(lpType, 4);
            } else { // REG_SZ (type 1)
                const s = entry.value as string;
                const needed = s.length + 1;
                if (lpcbData) {
                    const cbData = memory.read32(lpcbData);
                    memory.write32(lpcbData, needed);
                    if (lpData && cbData >= needed) {
                        writeAnsiStr(lpData, s);
                    }
                }
                if (lpType) memory.write32(lpType, 1);
            }
            cpu.regs[REG.EAX] = ERROR_SUCCESS;
        }
        cleanupStdcall(cpu, memory, 24);
    });

    // RegQueryValueExW(hKey, lpValueName, lpReserved, lpType, lpData, lpcbData) - stdcall, 6 args (24 bytes)
    stubs.registerStub("advapi32.dll", "RegQueryValueExW", (cpu) => {
        cpu.regs[REG.EAX] = ERROR_FILE_NOT_FOUND;
        cleanupStdcall(cpu, memory, 24);
    });

    // RegSetValueExA(hKey, lpValueName, Reserved, dwType, lpData, cbData) - stdcall, 6 args (24 bytes)
    stubs.registerStub("advapi32.dll", "RegSetValueExA", (cpu) => {
        cpu.regs[REG.EAX] = ERROR_SUCCESS; // pretend write succeeded
        cleanupStdcall(cpu, memory, 24);
    });

    // RegDeleteValueA(hKey, lpValueName) - stdcall, 2 args (8 bytes)
    stubs.registerStub("advapi32.dll", "RegDeleteValueA", (cpu) => {
        cpu.regs[REG.EAX] = ERROR_FILE_NOT_FOUND;
        cleanupStdcall(cpu, memory, 8);
    });

    // RegCloseKey(hKey) - stdcall, 1 arg (4 bytes)
    stubs.registerStub("advapi32.dll", "RegCloseKey", (cpu) => {
        cpu.regs[REG.EAX] = ERROR_SUCCESS;
        cleanupStdcall(cpu, memory, 4);
    });

    // RegFlushKey(hKey) - stdcall, 1 arg (4 bytes)
    stubs.registerStub("advapi32.dll", "RegFlushKey", (cpu) => {
        cpu.regs[REG.EAX] = ERROR_SUCCESS;
        cleanupStdcall(cpu, memory, 4);
    });

    // RegEnumKeyExA(hKey, dwIndex, lpName, lpcchName, lpReserved, lpClass, lpcchClass, lpftLastWriteTime) - 8 args (32 bytes)
    stubs.registerStub("advapi32.dll", "RegEnumKeyExA", (cpu) => {
        cpu.regs[REG.EAX] = ERROR_NO_MORE_ITEMS;
        cleanupStdcall(cpu, memory, 32);
    });

    // RegEnumValueA(hKey, dwIndex, lpValueName, lpcchValueName, lpReserved, lpType, lpData, lpcbData) - 8 args (32 bytes)
    stubs.registerStub("advapi32.dll", "RegEnumValueA", (cpu) => {
        cpu.regs[REG.EAX] = ERROR_NO_MORE_ITEMS;
        cleanupStdcall(cpu, memory, 32);
    });

    // ==================== advapi32.dll: Event Log API ====================
    // OpenEventLogA(lpUNCServerName, lpSourceName) - stdcall, 2 args (8 bytes)
    stubs.registerStub("advapi32.dll", "OpenEventLogA", (cpu) => {
        cpu.regs[REG.EAX] = 0xBEEF0200; // fake event log handle
        cleanupStdcall(cpu, memory, 8);
    });

    // ReportEventA(hEventLog, wType, wCategory, dwEventID, lpUserSid, wNumStrings, dwDataSize, lpStrings, lpRawData) - 9 args (36 bytes)
    stubs.registerStub("advapi32.dll", "ReportEventA", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE = success
        cleanupStdcall(cpu, memory, 36);
    });

    // CloseEventLog(hEventLog) - stdcall, 1 arg (4 bytes)
    stubs.registerStub("advapi32.dll", "CloseEventLog", (cpu) => {
        cpu.regs[REG.EAX] = 1; // TRUE = success
        cleanupStdcall(cpu, memory, 4);
    });

    // ==================== advapi32.dll: Security/User API ====================
    // GetUserNameA(lpBuffer, pcbBuffer) - stdcall, 2 args (8 bytes)
    stubs.registerStub("advapi32.dll", "GetUserNameA", (cpu) => {
        const lpBuffer = memory.read32(cpu.regs[REG.ESP] + 4);
        const pcbBuffer = memory.read32(cpu.regs[REG.ESP] + 8);
        const username = "Player\0";
        if (lpBuffer && pcbBuffer) {
            const maxLen = memory.read32(pcbBuffer);
            for (let i = 0; i < Math.min(username.length, maxLen); i++) {
                memory.write8(lpBuffer + i, username.charCodeAt(i));
            }
            memory.write32(pcbBuffer, username.length);
        }
        cpu.regs[REG.EAX] = 1; // TRUE = success
        cleanupStdcall(cpu, memory, 8);
    });

    console.log(`[Win32Stubs] Registered ${stubs.count} API stubs in memory at 0x${STUB_BASE.toString(16)}`);
}

/**
 * Patch internal CRT functions that can't be intercepted via IAT.
 * Must be called AFTER sections are loaded into memory.
 */
export function patchCRTInternals(stubs: Win32Stubs): void {
    // _sbh_heap_init at 0x00a06f60 - CRT small-block heap initialization
    // This function computes log2(heap_size) in a loop that hangs if the
    // heap struct isn't properly initialized. Since we fake the heap,
    // just return success (EAX=1).
    stubs.patchAddress(0x00a06f60, "_sbh_heap_init", (cpu) => {
        cpu.regs[REG.EAX] = 1; // success
        // cdecl: caller cleans up the 1 arg
    });

    // __sbh_alloc_block at 0x00a06910 - CRT small-block heap allocator
    // Scans bitmap arrays to find free blocks. Since we don't populate SBH
    // metadata, this loops forever searching all-zero bitmaps.
    // Return 0 (NULL) to tell caller "SBH can't satisfy this allocation",
    // which makes it fall back to HeapAlloc (which we stub).
    stubs.patchAddress(0x00a06910, "__sbh_alloc_block", (cpu) => {
        cpu.regs[REG.EAX] = 0; // NULL = allocation failed, use HeapAlloc fallback
        // cdecl: caller cleans up the 1 arg
    });

    // _CrtDbgReport at 0x009f9300 - CRT debug assertion reporter
    // Called by _ASSERTE macros in the debug CRT. Our heap doesn't maintain
    // debug CRT linked list headers, so assertions fire on every free.
    // Return 0 = continue execution (don't break into debugger).
    stubs.patchAddress(0x009f9300, "_CrtDbgReport", (cpu) => {
        cpu.regs[REG.EAX] = 0; // 0 = continue, 1 = debug break
        // cdecl: caller cleans up (variable args)
    });
}

/**
 * Helper: clean up stdcall stack (callee pops args).
 * After INT 0xFE, EIP points at RET. We need to adjust so RET pops
 * the return address, then we remove the args.
 *
 * Since INT 0xFE doesn't push anything (our CPU just calls the handler),
 * and the stub ends with RET (which pops the caller's return address),
 * we just need to adjust ESP to skip the args AFTER the return address.
 *
 * We rewrite the RET to RET imm16 by patching the stub, but that's complex.
 * Instead: we pop the return address, adjust ESP, push it back.
 */
function cleanupStdcall(cpu: CPU, memory: Memory, argBytes: number): void {
    // Stack layout after stub returns: [return_addr] [arg1] [arg2] ...
    // For stdcall, we need to pop return_addr, skip args, then jump to return_addr
    // But since our stub ends with RET, we just move the return addr down
    const retAddr = memory.read32(cpu.regs[REG.ESP]);
    cpu.regs[REG.ESP] = (cpu.regs[REG.ESP] + argBytes) >>> 0; // skip args only
    memory.write32(cpu.regs[REG.ESP], retAddr); // write return addr at new stack top
}
