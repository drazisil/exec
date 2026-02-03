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

// Stub region: 0x00200000 - 0x002FFFFF (1MB reserved)
const STUB_BASE = 0x00200000;
const STUB_SIZE = 32; // bytes per stub (generous, most need ~7)
const MAX_STUBS = 4096;

// INT number used for complex stubs that need JS logic
const STUB_INT = 0xFE;

export type StubHandler = (cpu: CPU) => void;

interface StubEntry {
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

        // Execute the JS handler
        entry.handler(cpu);
        // EIP is already pointing at RET, so the CPU will execute RET next
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
    function simpleAlloc(size: number): number {
        const addr = nextHeapAlloc;
        nextHeapAlloc = ((nextHeapAlloc + size + 15) & ~15) >>> 0;
        return addr;
    }

    // HeapAlloc(HANDLE hHeap, DWORD dwFlags, SIZE_T dwBytes) -> LPVOID
    stubs.registerStub("kernel32.dll", "HeapAlloc", (cpu) => {
        const dwBytes = memory.read32((cpu.regs[REG.ESP] + 12) >>> 0);
        const dwFlags = memory.read32((cpu.regs[REG.ESP] + 8) >>> 0);
        const addr = nextHeapAlloc;
        // Align to 16 bytes
        nextHeapAlloc = ((nextHeapAlloc + dwBytes + 15) & ~15) >>> 0;
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
        const dwBytes = memory.read32((cpu.regs[REG.ESP] + 16) >>> 0);
        const addr = nextHeapAlloc;
        nextHeapAlloc = ((nextHeapAlloc + dwBytes + 15) & ~15) >>> 0;
        cpu.regs[REG.EAX] = addr;
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
        cpu.regs[REG.EAX] = 0; // NULL (not found - game should handle gracefully)
        cleanupStdcall(cpu, memory, 8);
    });

    // LoadLibraryA(LPCSTR lpLibFileName) -> HMODULE
    stubs.registerStub("kernel32.dll", "LoadLibraryA", (cpu) => {
        cpu.regs[REG.EAX] = 0; // NULL (failed to load)
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

    // Sleep(DWORD dwMilliseconds) -> void
    stubs.registerStub("kernel32.dll", "Sleep", (cpu) => {
        // Just skip it
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
