"use strict";
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Win32Stubs = void 0;
exports.registerCRTStartupStubs = registerCRTStartupStubs;
exports.patchCRTInternals = patchCRTInternals;
var CPU_ts_1 = require("../hardware/CPU.ts");
// Stub region: 0x00200000 - 0x002FFFFF (1MB reserved)
var STUB_BASE = 0x00200000;
var STUB_SIZE = 32; // bytes per stub (generous, most need ~7)
var MAX_STUBS = 4096;
// INT number used for complex stubs that need JS logic
var STUB_INT = 0xFE;
var Win32Stubs = /** @class */ (function () {
    function Win32Stubs(memory) {
        this._stubs = new Map(); // "dllName!funcName" => entry
        this._stubById = [];
        this._patchedAddrs = new Map(); // patched code addresses
        this._nextStubAddr = STUB_BASE;
        this._installed = false;
        this._callLog = [];
        this._callLogSize = 2000;
        this._memory = memory;
    }
    /**
     * Register a stub for a Win32 API function.
     * The handler receives the CPU and should set EAX (and optionally write to
     * memory via pointers in registers/stack) then return. The stub trampoline
     * handles the RET.
     */
    Win32Stubs.prototype.registerStub = function (dllName, funcName, handler) {
        var key = "".concat(dllName.toLowerCase(), "!").concat(funcName);
        if (this._stubs.has(key))
            return; // already registered
        var stubId = this._stubById.length;
        var address = this._nextStubAddr;
        this._nextStubAddr += STUB_SIZE;
        if (stubId >= MAX_STUBS) {
            throw new Error("Too many Win32 stubs (max ".concat(MAX_STUBS, ")"));
        }
        var entry = {
            name: key,
            dllName: dllName.toLowerCase(),
            funcName: funcName,
            address: address,
            stubId: stubId,
            handler: handler,
        };
        this._stubs.set(key, entry);
        this._stubById.push(entry);
        // Write the stub machine code into memory:
        // INT 0xFE       -> CD FE        (triggers JS handler)
        // RET             -> C3           (return to caller)
        // Padding with INT3 (CC) for safety
        var offset = address;
        this._memory.write8(offset++, 0xCD); // INT
        this._memory.write8(offset++, STUB_INT); // 0xFE
        this._memory.write8(offset++, 0xC3); // RET
        // Fill rest with INT3 breakpoints
        while (offset < address + STUB_SIZE) {
            this._memory.write8(offset++, 0xCC);
        }
    };
    /**
     * Patch a specific address in loaded code to redirect to a JS handler.
     * Overwrites the first 3 bytes at `addr` with INT 0xFE; RET.
     * Use this for internal functions that aren't called through the IAT
     * (e.g., CRT internal functions like _sbh_heap_init).
     * Must be called AFTER sections are loaded into memory.
     */
    Win32Stubs.prototype.patchAddress = function (addr, name, handler) {
        var stubId = this._stubById.length;
        var entry = {
            name: "patch:".concat(name),
            dllName: "patch",
            funcName: name,
            address: addr,
            stubId: stubId,
            handler: handler,
        };
        this._stubById.push(entry);
        this._patchedAddrs.set(addr, entry);
        // Overwrite code at addr with: INT 0xFE; RET
        this._memory.write8(addr, 0xCD); // INT
        this._memory.write8(addr + 1, STUB_INT); // 0xFE
        this._memory.write8(addr + 2, 0xC3); // RET
        console.log("[Win32Stubs] Patched 0x".concat(addr.toString(16), " => ").concat(name));
    };
    /**
     * Get the stub address for a function, or null if not stubbed.
     */
    Win32Stubs.prototype.getStubAddress = function (dllName, funcName) {
        var key = "".concat(dllName.toLowerCase(), "!").concat(funcName);
        var entry = this._stubs.get(key);
        return entry ? entry.address : null;
    };
    /**
     * Install the INT 0xFE handler on the CPU.
     * Must be called after all stubs are registered.
     */
    Win32Stubs.prototype.install = function (cpu) {
        if (this._installed)
            return;
        this._installed = true;
        var stubs = this;
        // Save any existing interrupt handler
        var existingHandler = cpu._intHandler;
        cpu.onInterrupt(function (intNum, cpu) {
            if (intNum === STUB_INT) {
                stubs.handleStubInt(cpu);
                return;
            }
            // Delegate to existing handler
            if (existingHandler) {
                existingHandler(intNum, cpu);
            }
            else {
                throw new Error("Unhandled interrupt INT 0x".concat(intNum.toString(16), " at EIP=0x").concat((cpu.eip >>> 0).toString(16)));
            }
        });
    };
    /**
     * Handle INT 0xFE - find which stub was called and execute its handler
     */
    Win32Stubs.prototype.handleStubInt = function (cpu) {
        var _a;
        // EIP is now pointing past the INT 0xFE instruction (at the RET).
        // The stub address is EIP - 2 (the INT 0xFE was 2 bytes).
        var stubAddr = (cpu.eip - 2) >>> 0;
        // Check patched addresses first (faster lookup), then stub list
        var entry = (_a = this._patchedAddrs.get(stubAddr)) !== null && _a !== void 0 ? _a : this._stubById.find(function (s) { return s.address === stubAddr; });
        if (!entry) {
            throw new Error("Unknown Win32 stub at 0x".concat(stubAddr.toString(16)));
        }
        // Log the stub call (deduplicate consecutive identical calls)
        var logEntry = "".concat(entry.name, " @ 0x").concat(stubAddr.toString(16));
        if (this._callLog.length > 0 && this._callLog[this._callLog.length - 1].startsWith(logEntry)) {
            // Increment count on existing entry
            var last = this._callLog[this._callLog.length - 1];
            var countMatch = last.match(/ x(\d+)$/);
            var count = countMatch ? parseInt(countMatch[1]) + 1 : 2;
            this._callLog[this._callLog.length - 1] = "".concat(logEntry, " x").concat(count);
        }
        else {
            this._callLog.push(logEntry);
            if (this._callLog.length > this._callLogSize) {
                this._callLog.shift();
            }
        }
        // Execute the JS handler
        entry.handler(cpu);
        // EIP is already pointing at RET, so the CPU will execute RET next
    };
    /**
     * Get the recent stub call log
     */
    Win32Stubs.prototype.getCallLog = function () {
        return __spreadArray([], this._callLog, true);
    };
    /**
     * Look up the stub address for a given DLL!function name.
     * Returns the trampoline address or 0 if not found.
     */
    Win32Stubs.prototype.lookupStubAddress = function (dllName, funcName) {
        var key = "".concat(dllName.toLowerCase(), "!").concat(funcName);
        var entry = this._stubs.get(key);
        return entry ? entry.address : 0;
    };
    /**
     * Get all registered stubs (for diagnostics)
     */
    Win32Stubs.prototype.getRegisteredStubs = function () {
        return this._stubById.map(function (s) { return ({
            dllName: s.dllName,
            funcName: s.funcName,
            address: s.address,
        }); });
    };
    /**
     * Check if a function is stubbed
     */
    Win32Stubs.prototype.isStubbed = function (dllName, funcName) {
        return this._stubs.has("".concat(dllName.toLowerCase(), "!").concat(funcName));
    };
    Object.defineProperty(Win32Stubs.prototype, "count", {
        /**
         * Get total number of registered stubs
         */
        get: function () {
            return this._stubById.length;
        },
        enumerable: false,
        configurable: true
    });
    return Win32Stubs;
}());
exports.Win32Stubs = Win32Stubs;
// ============================================================
// Default Win32 API stub implementations
// ============================================================
/**
 * Register all default Win32 API stubs needed for MSVC CRT startup.
 * These are the functions called by mainCRTStartup before WinMain.
 */
function registerCRTStartupStubs(stubs, memory) {
    // --- KERNEL32.dll stubs ---
    // GetVersion() -> DWORD
    // Returns Windows version. For Win XP SP2: 0x0A280105
    // Low byte = major, next byte = minor, high word = build
    // We return Windows XP (5.1, build 2600) since this is an era-appropriate game
    // Format: (build << 16) | (minor << 8) | major
    stubs.registerStub("kernel32.dll", "GetVersion", function (cpu) {
        // Windows XP: major=5, minor=1, build=2600=0x0A28
        cpu.regs[CPU_ts_1.REG.EAX] = (2600 << 16) | (1 << 8) | 5; // 0x0A280105
    });
    // GetVersionExA(LPOSVERSIONINFOA lpVersionInfo) -> BOOL
    // Fills in an OSVERSIONINFOA struct. Pointer is [ESP+4] (first arg after return addr)
    stubs.registerStub("kernel32.dll", "GetVersionExA", function (cpu) {
        var lpVersionInfo = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        // OSVERSIONINFOA: dwOSVersionInfoSize(4), dwMajorVersion(4), dwMinorVersion(4),
        //                 dwBuildNumber(4), dwPlatformId(4), szCSDVersion(128)
        memory.write32(lpVersionInfo + 4, 5); // dwMajorVersion = 5
        memory.write32(lpVersionInfo + 8, 1); // dwMinorVersion = 1
        memory.write32(lpVersionInfo + 12, 2600); // dwBuildNumber = 2600
        memory.write32(lpVersionInfo + 16, 2); // dwPlatformId = VER_PLATFORM_WIN32_NT
        // szCSDVersion = "Service Pack 2\0"
        var sp2 = "Service Pack 2";
        for (var i = 0; i < sp2.length; i++) {
            memory.write8(lpVersionInfo + 20 + i, sp2.charCodeAt(i));
        }
        memory.write8(lpVersionInfo + 20 + sp2.length, 0);
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE (success)
        // stdcall: callee cleans up 1 arg (4 bytes)
        cleanupStdcall(cpu, memory, 4);
    });
    // GetVersionExW(LPOSVERSIONINFOW lpVersionInfo) -> BOOL
    stubs.registerStub("kernel32.dll", "GetVersionExW", function (cpu) {
        var lpVersionInfo = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        memory.write32(lpVersionInfo + 4, 5); // dwMajorVersion = 5
        memory.write32(lpVersionInfo + 8, 1); // dwMinorVersion = 1
        memory.write32(lpVersionInfo + 12, 2600); // dwBuildNumber = 2600
        memory.write32(lpVersionInfo + 16, 2); // dwPlatformId = VER_PLATFORM_WIN32_NT
        // szCSDVersion (wide string) = "Service Pack 2\0"
        var sp2 = "Service Pack 2";
        for (var i = 0; i < sp2.length; i++) {
            memory.write16(lpVersionInfo + 20 + i * 2, sp2.charCodeAt(i));
        }
        memory.write16(lpVersionInfo + 20 + sp2.length * 2, 0);
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // GetCommandLineA() -> LPCSTR
    // Returns pointer to the command line string
    // We'll put it in a fixed memory location
    var cmdLineAddr = 0x00201000; // in our stub region
    var cmdLine = "MCity_d.exe\0";
    for (var i = 0; i < cmdLine.length; i++) {
        memory.write8(cmdLineAddr + i, cmdLine.charCodeAt(i));
    }
    stubs.registerStub("kernel32.dll", "GetCommandLineA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = cmdLineAddr;
    });
    // GetCommandLineW() -> LPCWSTR
    var cmdLineWAddr = 0x00201100;
    for (var i = 0; i < cmdLine.length; i++) {
        memory.write16(cmdLineWAddr + i * 2, cmdLine.charCodeAt(i));
    }
    stubs.registerStub("kernel32.dll", "GetCommandLineW", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = cmdLineWAddr;
    });
    // GetStartupInfoA(LPSTARTUPINFOA lpStartupInfo) -> void
    // Fills in STARTUPINFOA struct (68 bytes). Zero it out.
    stubs.registerStub("kernel32.dll", "GetStartupInfoA", function (cpu) {
        var lpStartupInfo = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        // Zero out the struct (68 bytes)
        for (var i = 0; i < 68; i += 4) {
            memory.write32(lpStartupInfo + i, 0);
        }
        memory.write32(lpStartupInfo, 68); // cb = sizeof(STARTUPINFOA)
        cleanupStdcall(cpu, memory, 4);
    });
    // GetStartupInfoW(LPSTARTUPINFOW lpStartupInfo) -> void
    stubs.registerStub("kernel32.dll", "GetStartupInfoW", function (cpu) {
        var lpStartupInfo = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        for (var i = 0; i < 104; i += 4) {
            memory.write32(lpStartupInfo + i, 0);
        }
        memory.write32(lpStartupInfo, 104); // cb = sizeof(STARTUPINFOW)
        cleanupStdcall(cpu, memory, 4);
    });
    // GetModuleHandleA(LPCSTR lpModuleName) -> HMODULE
    // NULL => returns base address of main executable
    stubs.registerStub("kernel32.dll", "GetModuleHandleA", function (cpu) {
        var lpModuleName = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        if (lpModuleName === 0) {
            cpu.regs[CPU_ts_1.REG.EAX] = 0x00400000; // main exe image base
        }
        else {
            cpu.regs[CPU_ts_1.REG.EAX] = 0x00400000; // TODO: look up by name
        }
        cleanupStdcall(cpu, memory, 4);
    });
    // GetModuleHandleW(LPCWSTR lpModuleName) -> HMODULE
    stubs.registerStub("kernel32.dll", "GetModuleHandleW", function (cpu) {
        var lpModuleName = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        if (lpModuleName === 0) {
            cpu.regs[CPU_ts_1.REG.EAX] = 0x00400000;
        }
        else {
            cpu.regs[CPU_ts_1.REG.EAX] = 0x00400000;
        }
        cleanupStdcall(cpu, memory, 4);
    });
    // GetCurrentProcess() -> HANDLE
    // Returns pseudo-handle -1 (0xFFFFFFFF)
    stubs.registerStub("kernel32.dll", "GetCurrentProcess", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0xFFFFFFFF;
    });
    // GetCurrentProcessId() -> DWORD
    stubs.registerStub("kernel32.dll", "GetCurrentProcessId", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1234; // fake PID
    });
    // GetCurrentThreadId() -> DWORD
    stubs.registerStub("kernel32.dll", "GetCurrentThreadId", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 5678; // fake TID
    });
    // GetCurrentThread() -> HANDLE
    stubs.registerStub("kernel32.dll", "GetCurrentThread", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0xFFFFFFFE; // pseudo-handle for current thread
    });
    // HeapCreate(DWORD flOptions, SIZE_T dwInitialSize, SIZE_T dwMaximumSize) -> HANDLE
    // The MSVC CRT's _sbh_heap_init reads from the heap struct:
    //   [heap+0x08] = region size (must be > 0 for the log2 loop to terminate)
    //   [heap+0x10] = some pointer/offset
    // We set up a minimal fake heap structure so CRT initialization works.
    var nextHeapHandle = 0x00280000;
    stubs.registerStub("kernel32.dll", "HeapCreate", function (cpu) {
        var heapAddr = nextHeapHandle;
        nextHeapHandle += 0x10000;
        // Initialize a minimal heap structure
        // Zero it out first
        for (var i = 0; i < 256; i += 4)
            memory.write32(heapAddr + i, 0);
        // Set fields that the CRT reads:
        memory.write32(heapAddr + 0x00, 0xEEFDEEFD); // heap signature
        memory.write32(heapAddr + 0x04, 0); // flags
        memory.write32(heapAddr + 0x08, 0x00100000); // region size = 1MB (must be > 0!)
        memory.write32(heapAddr + 0x0C, 0); // reserved
        memory.write32(heapAddr + 0x10, heapAddr + 0x100); // pointer to region data
        cpu.regs[CPU_ts_1.REG.EAX] = heapAddr;
        cleanupStdcall(cpu, memory, 12);
    });
    // GetProcessHeap() -> HANDLE
    // Initialize the default process heap at first call
    var defaultHeapAddr = 0x00270000;
    var defaultHeapInitialized = false;
    stubs.registerStub("kernel32.dll", "GetProcessHeap", function (cpu) {
        if (!defaultHeapInitialized) {
            defaultHeapInitialized = true;
            for (var i = 0; i < 256; i += 4)
                memory.write32(defaultHeapAddr + i, 0);
            memory.write32(defaultHeapAddr + 0x00, 0xEEFDEEFD);
            memory.write32(defaultHeapAddr + 0x08, 0x00100000);
            memory.write32(defaultHeapAddr + 0x10, defaultHeapAddr + 0x100);
        }
        cpu.regs[CPU_ts_1.REG.EAX] = defaultHeapAddr;
    });
    // Bump allocator for heap/local/global allocations
    var nextHeapAlloc = 0x04000000; // heap starts at 64MB
    function simpleAlloc(size) {
        var addr = nextHeapAlloc;
        nextHeapAlloc = ((nextHeapAlloc + size + 15) & ~15) >>> 0;
        return addr;
    }
    // HeapAlloc(HANDLE hHeap, DWORD dwFlags, SIZE_T dwBytes) -> LPVOID
    stubs.registerStub("kernel32.dll", "HeapAlloc", function (cpu) {
        var dwBytes = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 12) >>> 0);
        var dwFlags = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var addr = nextHeapAlloc;
        // Align to 16 bytes
        nextHeapAlloc = ((nextHeapAlloc + dwBytes + 15) & ~15) >>> 0;
        // HEAP_ZERO_MEMORY = 0x08
        if (dwFlags & 0x08) {
            for (var i = 0; i < dwBytes; i += 4) {
                memory.write32(addr + i, 0);
            }
        }
        cpu.regs[CPU_ts_1.REG.EAX] = addr;
        cleanupStdcall(cpu, memory, 12);
    });
    // HeapFree(HANDLE hHeap, DWORD dwFlags, LPVOID lpMem) -> BOOL
    stubs.registerStub("kernel32.dll", "HeapFree", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE (success, but we don't actually free)
        cleanupStdcall(cpu, memory, 12);
    });
    // HeapReAlloc(HANDLE hHeap, DWORD dwFlags, LPVOID lpMem, SIZE_T dwBytes) -> LPVOID
    stubs.registerStub("kernel32.dll", "HeapReAlloc", function (cpu) {
        var dwBytes = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 16) >>> 0);
        var addr = nextHeapAlloc;
        nextHeapAlloc = ((nextHeapAlloc + dwBytes + 15) & ~15) >>> 0;
        cpu.regs[CPU_ts_1.REG.EAX] = addr;
        cleanupStdcall(cpu, memory, 16);
    });
    // HeapSize(HANDLE hHeap, DWORD dwFlags, LPCVOID lpMem) -> SIZE_T
    stubs.registerStub("kernel32.dll", "HeapSize", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 4096; // fake: always say 4KB
        cleanupStdcall(cpu, memory, 12);
    });
    // VirtualAlloc(LPVOID lpAddress, SIZE_T dwSize, DWORD flAllocationType, DWORD flProtect) -> LPVOID
    var nextVirtualAlloc = 0x05000000; // virtual allocs start at 80MB
    stubs.registerStub("kernel32.dll", "VirtualAlloc", function (cpu) {
        var lpAddress = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var dwSize = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var addr;
        if (lpAddress !== 0) {
            addr = lpAddress; // honor requested address
        }
        else {
            addr = nextVirtualAlloc;
            // Align to 64KB (Windows VirtualAlloc granularity)
            nextVirtualAlloc = ((nextVirtualAlloc + dwSize + 0xFFFF) & ~0xFFFF) >>> 0;
        }
        cpu.regs[CPU_ts_1.REG.EAX] = addr;
        cleanupStdcall(cpu, memory, 16);
    });
    // VirtualFree(LPVOID lpAddress, SIZE_T dwSize, DWORD dwFreeType) -> BOOL
    stubs.registerStub("kernel32.dll", "VirtualFree", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 12);
    });
    // GetLastError() -> DWORD
    stubs.registerStub("kernel32.dll", "GetLastError", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // ERROR_SUCCESS
    });
    // SetLastError(DWORD dwErrCode) -> void
    stubs.registerStub("kernel32.dll", "SetLastError", function (cpu) {
        // Ignore - we don't track this
        cleanupStdcall(cpu, memory, 4);
    });
    // GetTickCount() -> DWORD
    stubs.registerStub("kernel32.dll", "GetTickCount", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 10000; // fake: 10 seconds uptime
    });
    // QueryPerformanceCounter(LARGE_INTEGER* lpPerformanceCount) -> BOOL
    stubs.registerStub("kernel32.dll", "QueryPerformanceCounter", function (cpu) {
        var ptr = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        memory.write32(ptr, 1000000); // low DWORD
        memory.write32(ptr + 4, 0); // high DWORD
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // QueryPerformanceFrequency(LARGE_INTEGER* lpFrequency) -> BOOL
    stubs.registerStub("kernel32.dll", "QueryPerformanceFrequency", function (cpu) {
        var ptr = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        memory.write32(ptr, 3579545); // ~3.58 MHz (typical)
        memory.write32(ptr + 4, 0);
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // GetSystemInfo(LPSYSTEM_INFO lpSystemInfo) -> void
    stubs.registerStub("kernel32.dll", "GetSystemInfo", function (cpu) {
        var ptr = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        // Zero it out first (36 bytes)
        for (var i = 0; i < 36; i += 4)
            memory.write32(ptr + i, 0);
        memory.write16(ptr + 0, 0); // wProcessorArchitecture = PROCESSOR_ARCHITECTURE_INTEL
        memory.write32(ptr + 4, 4096); // dwPageSize = 4096
        memory.write32(ptr + 8, 0x00010000); // lpMinimumApplicationAddress
        memory.write32(ptr + 12, 0x7FFEFFFF); // lpMaximumApplicationAddress
        memory.write32(ptr + 16, 1); // dwActiveProcessorMask
        memory.write32(ptr + 20, 1); // dwNumberOfProcessors
        memory.write32(ptr + 24, 586); // dwProcessorType = Pentium
        memory.write32(ptr + 28, 0x00010000); // dwAllocationGranularity = 64KB
        memory.write16(ptr + 32, 6); // wProcessorLevel
        memory.write16(ptr + 34, 0); // wProcessorRevision
        cleanupStdcall(cpu, memory, 4);
    });
    // InitializeCriticalSection(LPCRITICAL_SECTION lpCriticalSection) -> void
    stubs.registerStub("kernel32.dll", "InitializeCriticalSection", function (cpu) {
        // Just zero out the critical section struct (24 bytes)
        var ptr = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        for (var i = 0; i < 24; i += 4)
            memory.write32(ptr + i, 0);
        cleanupStdcall(cpu, memory, 4);
    });
    // InitializeCriticalSectionAndSpinCount -> BOOL
    stubs.registerStub("kernel32.dll", "InitializeCriticalSectionAndSpinCount", function (cpu) {
        var ptr = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        for (var i = 0; i < 24; i += 4)
            memory.write32(ptr + i, 0);
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });
    // EnterCriticalSection/LeaveCriticalSection/DeleteCriticalSection -> void
    stubs.registerStub("kernel32.dll", "EnterCriticalSection", function (cpu) {
        cleanupStdcall(cpu, memory, 4);
    });
    stubs.registerStub("kernel32.dll", "LeaveCriticalSection", function (cpu) {
        cleanupStdcall(cpu, memory, 4);
    });
    stubs.registerStub("kernel32.dll", "DeleteCriticalSection", function (cpu) {
        cleanupStdcall(cpu, memory, 4);
    });
    // TlsAlloc() -> DWORD (TLS index)
    var nextTlsIndex = 0;
    stubs.registerStub("kernel32.dll", "TlsAlloc", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = nextTlsIndex++;
    });
    // TlsSetValue(DWORD dwTlsIndex, LPVOID lpTlsValue) -> BOOL
    stubs.registerStub("kernel32.dll", "TlsSetValue", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });
    // TlsGetValue(DWORD dwTlsIndex) -> LPVOID
    stubs.registerStub("kernel32.dll", "TlsGetValue", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // NULL (no TLS value stored)
        cleanupStdcall(cpu, memory, 4);
    });
    // TlsFree(DWORD dwTlsIndex) -> BOOL
    stubs.registerStub("kernel32.dll", "TlsFree", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // GetProcAddress(HMODULE hModule, LPCSTR lpProcName) -> FARPROC
    stubs.registerStub("kernel32.dll", "GetProcAddress", function (cpu) {
        var hModule = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var namePtr = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var procName = "";
        // Check if it's an ordinal (high word is 0)
        if ((namePtr & 0xFFFF0000) === 0) {
            procName = "ordinal#".concat(namePtr);
        }
        else {
            for (var i = 0; i < 260; i++) {
                var ch = memory.read8(namePtr + i);
                if (ch === 0)
                    break;
                procName += String.fromCharCode(ch);
            }
        }
        // Try to find the function in our registered stubs
        // Search across common DLLs
        var dllsToSearch = [
            "kernel32.dll", "user32.dll", "msvcrt.dll", "ntdll.dll",
            "advapi32.dll", "gdi32.dll", "shell32.dll", "ole32.dll",
        ];
        var stubAddr = 0;
        for (var _i = 0, dllsToSearch_1 = dllsToSearch; _i < dllsToSearch_1.length; _i++) {
            var dll = dllsToSearch_1[_i];
            stubAddr = stubs.lookupStubAddress(dll, procName);
            if (stubAddr)
                break;
        }
        if (stubAddr) {
            console.log("  [Win32] GetProcAddress(0x".concat(hModule.toString(16), ", \"").concat(procName, "\") -> 0x").concat(stubAddr.toString(16)));
            cpu.regs[CPU_ts_1.REG.EAX] = stubAddr;
        }
        else {
            console.log("  [Win32] GetProcAddress(0x".concat(hModule.toString(16), ", \"").concat(procName, "\") -> NULL"));
            cpu.regs[CPU_ts_1.REG.EAX] = 0;
        }
        cleanupStdcall(cpu, memory, 8);
    });
    // LoadLibraryA(LPCSTR lpLibFileName) -> HMODULE
    stubs.registerStub("kernel32.dll", "LoadLibraryA", function (cpu) {
        var namePtr = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var name = "";
        for (var i = 0; i < 260; i++) {
            var ch = memory.read8(namePtr + i);
            if (ch === 0)
                break;
            name += String.fromCharCode(ch);
        }
        console.log("  [Win32] LoadLibraryA(\"".concat(name, "\")"));
        // Return fake module handle based on DLL name hash (non-zero = success)
        // The CRT uses LoadLibraryA to get handles for GetProcAddress calls
        var hash = name.toLowerCase().split("").reduce(function (h, c) { return ((h << 5) - h + c.charCodeAt(0)) | 0; }, 0) >>> 0;
        cpu.regs[CPU_ts_1.REG.EAX] = (hash & 0x7FFFFFFF) | 0x10000000; // Ensure non-zero and in valid range
        cleanupStdcall(cpu, memory, 4);
    });
    // FreeLibrary(HMODULE hLibModule) -> BOOL
    stubs.registerStub("kernel32.dll", "FreeLibrary", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // ExitProcess(UINT uExitCode) -> void (noreturn)
    stubs.registerStub("kernel32.dll", "ExitProcess", function (cpu) {
        var exitCode = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        console.log("\n[Win32] ExitProcess(".concat(exitCode, ")"));
        cpu.halted = true;
    });
    // IsDebuggerPresent() -> BOOL
    stubs.registerStub("kernel32.dll", "IsDebuggerPresent", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // FALSE - no debugger
    });
    // IsProcessorFeaturePresent(DWORD ProcessorFeature) -> BOOL
    stubs.registerStub("kernel32.dll", "IsProcessorFeaturePresent", function (cpu) {
        var feature = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        // PF_XMMI_INSTRUCTIONS_AVAILABLE (6) = SSE
        // PF_XMMI64_INSTRUCTIONS_AVAILABLE (10) = SSE2
        // PF_FLOATING_POINT_EMULATED (1) = soft FP
        // Return TRUE for common features to avoid CRT fallbacks
        var supported = feature === 6 || feature === 10; // SSE + SSE2
        cpu.regs[CPU_ts_1.REG.EAX] = supported ? 1 : 0;
        cleanupStdcall(cpu, memory, 4);
    });
    // SetUnhandledExceptionFilter(LPTOP_LEVEL_EXCEPTION_FILTER lpTopLevelExceptionFilter) -> LPTOP_LEVEL_EXCEPTION_FILTER
    stubs.registerStub("kernel32.dll", "SetUnhandledExceptionFilter", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // return previous filter (NULL)
        cleanupStdcall(cpu, memory, 4);
    });
    // UnhandledExceptionFilter(struct _EXCEPTION_POINTERS *ExceptionInfo) -> LONG
    stubs.registerStub("kernel32.dll", "UnhandledExceptionFilter", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // EXCEPTION_CONTINUE_SEARCH
        cleanupStdcall(cpu, memory, 4);
    });
    // GetEnvironmentStringsW() -> LPWCH
    // Return pointer to empty double-null-terminated string
    var envStrAddr = 0x00201200;
    memory.write16(envStrAddr, 0); // empty string
    memory.write16(envStrAddr + 2, 0); // double null terminator
    stubs.registerStub("kernel32.dll", "GetEnvironmentStringsW", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = envStrAddr;
    });
    // FreeEnvironmentStringsW(LPWCH penv) -> BOOL
    stubs.registerStub("kernel32.dll", "FreeEnvironmentStringsW", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // GetEnvironmentStrings() -> LPCH
    var envStrAAddr = 0x00201300;
    memory.write8(envStrAAddr, 0);
    memory.write8(envStrAAddr + 1, 0);
    stubs.registerStub("kernel32.dll", "GetEnvironmentStrings", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = envStrAAddr;
    });
    // FreeEnvironmentStringsA(LPCH penv) -> BOOL
    stubs.registerStub("kernel32.dll", "FreeEnvironmentStringsA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // GetStdHandle(DWORD nStdHandle) -> HANDLE
    stubs.registerStub("kernel32.dll", "GetStdHandle", function (cpu) {
        var nStdHandle = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        // STD_INPUT_HANDLE=-10, STD_OUTPUT_HANDLE=-11, STD_ERROR_HANDLE=-12
        // Return fake handles
        cpu.regs[CPU_ts_1.REG.EAX] = (0x00000100 + (nStdHandle & 0xFF)) >>> 0;
        cleanupStdcall(cpu, memory, 4);
    });
    // GetFileType(HANDLE hFile) -> DWORD
    stubs.registerStub("kernel32.dll", "GetFileType", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 2; // FILE_TYPE_CHAR (console)
        cleanupStdcall(cpu, memory, 4);
    });
    // GetACP() -> UINT (code page)
    stubs.registerStub("kernel32.dll", "GetACP", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1252; // Windows-1252 (Western European)
    });
    // GetCPInfo(UINT CodePage, LPCPINFO lpCPInfo) -> BOOL
    stubs.registerStub("kernel32.dll", "GetCPInfo", function (cpu) {
        var lpCPInfo = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        memory.write32(lpCPInfo, 1); // MaxCharSize = 1 (single byte)
        memory.write8(lpCPInfo + 4, 0x3F); // DefaultChar = '?'
        memory.write8(lpCPInfo + 5, 0);
        // LeadByte = all zeros (no lead bytes for single-byte codepage)
        for (var i = 0; i < 12; i++)
            memory.write8(lpCPInfo + 6 + i, 0);
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });
    // IsValidCodePage(UINT CodePage) -> BOOL
    stubs.registerStub("kernel32.dll", "IsValidCodePage", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // GetStringTypeW/GetStringTypeA - character classification
    stubs.registerStub("kernel32.dll", "GetStringTypeW", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 16);
    });
    // MultiByteToWideChar(UINT CodePage, DWORD dwFlags, LPCCH lpMultiByteStr,
    //   int cbMultiByte, LPWSTR lpWideCharStr, int cchWideChar) -> int
    stubs.registerStub("kernel32.dll", "MultiByteToWideChar", function (cpu) {
        var lpMultiByteStr = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 12) >>> 0);
        var cbMultiByte = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 16) >>> 0);
        var lpWideCharStr = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 20) >>> 0);
        var cchWideChar = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 24) >>> 0);
        // If output buffer size is 0, return required size
        if (cchWideChar === 0) {
            cpu.regs[CPU_ts_1.REG.EAX] = cbMultiByte;
        }
        else {
            // Simple: just zero-extend each byte to 16-bit
            var count = Math.min(cbMultiByte, cchWideChar);
            for (var i = 0; i < count; i++) {
                memory.write16(lpWideCharStr + i * 2, memory.read8(lpMultiByteStr + i));
            }
            cpu.regs[CPU_ts_1.REG.EAX] = count;
        }
        cleanupStdcall(cpu, memory, 24);
    });
    // WideCharToMultiByte(UINT CodePage, DWORD dwFlags, LPCWCH lpWideCharStr,
    //   int cchWideChar, LPSTR lpMultiByteStr, int cbMultiByte,
    //   LPCCH lpDefaultChar, LPBOOL lpUsedDefaultChar) -> int
    stubs.registerStub("kernel32.dll", "WideCharToMultiByte", function (cpu) {
        var lpWideCharStr = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 12) >>> 0);
        var cchWideChar = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 16) >>> 0);
        var lpMultiByteStr = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 20) >>> 0);
        var cbMultiByte = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 24) >>> 0);
        if (cbMultiByte === 0) {
            cpu.regs[CPU_ts_1.REG.EAX] = cchWideChar;
        }
        else {
            var count = Math.min(cchWideChar, cbMultiByte);
            for (var i = 0; i < count; i++) {
                var wc = memory.read16(lpWideCharStr + i * 2);
                memory.write8(lpMultiByteStr + i, wc > 255 ? 0x3F : wc); // '?' for non-ASCII
            }
            cpu.regs[CPU_ts_1.REG.EAX] = count;
        }
        cleanupStdcall(cpu, memory, 32);
    });
    // LCMapStringW(LCID Locale, DWORD dwMapFlags, LPCWSTR lpSrcStr,
    //   int cchSrc, LPWSTR lpDestStr, int cchDest) -> int
    stubs.registerStub("kernel32.dll", "LCMapStringW", function (cpu) {
        var cchSrc = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 16) >>> 0);
        cpu.regs[CPU_ts_1.REG.EAX] = cchSrc;
        cleanupStdcall(cpu, memory, 24);
    });
    // GetLocaleInfoA - locale information (stub)
    stubs.registerStub("kernel32.dll", "GetLocaleInfoA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // failure
        cleanupStdcall(cpu, memory, 16);
    });
    // FlsAlloc / FlsSetValue / FlsGetValue / FlsFree (Fiber Local Storage)
    var nextFlsIndex = 0;
    stubs.registerStub("kernel32.dll", "FlsAlloc", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = nextFlsIndex++;
        cleanupStdcall(cpu, memory, 4);
    });
    stubs.registerStub("kernel32.dll", "FlsSetValue", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1;
        cleanupStdcall(cpu, memory, 8);
    });
    stubs.registerStub("kernel32.dll", "FlsGetValue", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0;
        cleanupStdcall(cpu, memory, 4);
    });
    stubs.registerStub("kernel32.dll", "FlsFree", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1;
        cleanupStdcall(cpu, memory, 4);
    });
    // EncodePointer/DecodePointer - just return the pointer unchanged
    stubs.registerStub("kernel32.dll", "EncodePointer", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        cleanupStdcall(cpu, memory, 4);
    });
    stubs.registerStub("kernel32.dll", "DecodePointer", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        cleanupStdcall(cpu, memory, 4);
    });
    // InterlockedCompareExchange/InterlockedExchange/InterlockedIncrement/InterlockedDecrement
    stubs.registerStub("kernel32.dll", "InterlockedCompareExchange", function (cpu) {
        var dest = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var exchange = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var comparand = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 12) >>> 0);
        var current = memory.read32(dest);
        if (current === comparand) {
            memory.write32(dest, exchange);
        }
        cpu.regs[CPU_ts_1.REG.EAX] = current; // return original value
        cleanupStdcall(cpu, memory, 12);
    });
    var pendingThreads = [];
    var nextThreadId = 1001;
    var nextThreadHandle = 0x0000BEEF;
    // Thread stack region: allocate at 0x05000000, 256KB per thread
    var THREAD_STACK_BASE = 0x05000000;
    var THREAD_STACK_SIZE = 256 * 1024;
    var threadStackNext = THREAD_STACK_BASE;
    var sleepCount = 0;
    var isRunningThread = false; // true when we're executing a thread's code
    var currentThreadIdx = -1; // index of currently running thread (-1 = main)
    // Sentinel address for thread return detection
    var THREAD_SENTINEL = 0x001FE000;
    memory.write8(THREAD_SENTINEL, 0xCD); // INT
    memory.write8(THREAD_SENTINEL + 1, 0xFE); // 0xFE - triggers our stub handler
    memory.write8(THREAD_SENTINEL + 2, 0xC3); // RET (won't be reached)
    // Register the sentinel as a patched address for thread exit
    stubs.patchAddress(THREAD_SENTINEL, "_threadReturn", function (cpu) {
        // Thread function returned normally
        if (currentThreadIdx >= 0) {
            var thread = pendingThreads[currentThreadIdx];
            console.log("  [Thread] Thread ".concat(thread.threadId, " returned normally"));
            thread.completed = true;
        }
        // Signal that we need to switch back to main thread
        cpu.halted = true;
    });
    // Sleep(DWORD dwMilliseconds) -> void
    // Cooperative scheduler: when main thread sleeps, run pending threads
    stubs.registerStub("kernel32.dll", "Sleep", function (cpu) {
        sleepCount++;
        // Check for pending threads to run
        var runnableThread = pendingThreads.find(function (t) { return !t.suspended && !t.completed; });
        if (runnableThread) {
            var threadIdx = pendingThreads.indexOf(runnableThread);
            console.log("  [Scheduler] Main thread Sleep #".concat(sleepCount, " - switching to thread ").concat(runnableThread.threadId, " (startAddr=0x").concat(runnableThread.startAddress.toString(16), ")"));
            // Save main thread state
            var mainState = {
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
            }
            else {
                // First run: set up thread's initial state
                var stackTop = threadStackNext + THREAD_STACK_SIZE - 16;
                threadStackNext += THREAD_STACK_SIZE;
                // Thread function signature: DWORD WINAPI ThreadProc(LPVOID lpParameter)
                // Stack layout at entry (as if CALL pushed return addr on top of args):
                //   [ESP]   = return address (sentinel)
                //   [ESP+4] = lpParameter
                var threadESP = stackTop;
                threadESP -= 4;
                memory.write32(threadESP, runnableThread.parameter); // lpParameter at [ESP+4]
                threadESP -= 4;
                memory.write32(threadESP, THREAD_SENTINEL); // return address at [ESP]
                cpu.regs[CPU_ts_1.REG.ESP] = threadESP >>> 0;
                cpu.regs[CPU_ts_1.REG.EBP] = 0;
                cpu.regs[CPU_ts_1.REG.EAX] = 0;
                cpu.regs[CPU_ts_1.REG.ECX] = 0;
                cpu.regs[CPU_ts_1.REG.EDX] = 0;
                cpu.regs[CPU_ts_1.REG.EBX] = 0;
                cpu.regs[CPU_ts_1.REG.ESI] = 0;
                cpu.regs[CPU_ts_1.REG.EDI] = 0;
                cpu.eip = runnableThread.startAddress;
                cpu.eflags = 0x202; // IF set
            }
            // Run thread for a time slice (100K steps)
            var threadStepLimit = 100000;
            cpu.halted = false;
            var threadSteps = 0;
            var threadError = null;
            // Log first few steps of thread execution for debugging
            var logFirstSteps = !runnableThread.savedState;
            if (logFirstSteps) {
                console.log("  [Thread] Starting thread at EIP=0x".concat(cpu.eip.toString(16), ", ESP=0x").concat(cpu.regs[CPU_ts_1.REG.ESP].toString(16)));
                // Dump the parameter object to understand what the thread will access
                var paramAddr = runnableThread.parameter;
                console.log("  [Thread] Parameter object at 0x".concat(paramAddr.toString(16), ":"));
                for (var off = 0; off <= 0x50; off += 4) {
                    var val = memory.read32(paramAddr + off);
                    if (val !== 0) {
                        console.log("    [+0x".concat(off.toString(16), "] = 0x").concat(val.toString(16)));
                    }
                }
            }
            try {
                var lastValidThreadEIP = cpu.eip;
                while (!cpu.halted && threadSteps < threadStepLimit) {
                    if (logFirstSteps && threadSteps < 50) {
                        var op = memory.read8(cpu.eip);
                        console.log("  [Thread] step ".concat(threadSteps, ": EIP=0x").concat(cpu.eip.toString(16), " op=0x").concat(op.toString(16).padStart(2, '0'), " ESP=0x").concat((cpu.regs[CPU_ts_1.REG.ESP] >>> 0).toString(16), " EAX=0x").concat((cpu.regs[CPU_ts_1.REG.EAX] >>> 0).toString(16)));
                    }
                    var eipBefore = cpu.eip;
                    cpu.step();
                    threadSteps++;
                    // Check for thread runaway: EIP outside valid code regions
                    var eip = cpu.eip >>> 0;
                    var inStubs = eip >= 0x00200000 && eip < 0x00202000;
                    var inExe = eip >= 0x00400000 && eip < 0x02000000;
                    var inDlls = eip >= 0x10000000 && eip < 0x40000000;
                    var inThreadSentinel = eip >= 0x001FE000 && eip < 0x001FE004;
                    if (!inStubs && !inExe && !inDlls && !inThreadSentinel && threadSteps > 10) {
                        console.log("  [Thread] RUNAWAY at step ".concat(threadSteps, ": EIP=0x").concat(eip.toString(16), " (prev=0x").concat(eipBefore.toString(16), ", lastValid=0x").concat(lastValidThreadEIP.toString(16), ")"));
                        console.log("  [Thread] State: ".concat(cpu.toString()));
                        // Dump a few bytes at EIP
                        var bytes = [];
                        for (var i = 0; i < 16; i++)
                            bytes.push(memory.read8(eip + i).toString(16).padStart(2, '0'));
                        console.log("  [Thread] Bytes at EIP: ".concat(bytes.join(' ')));
                        runnableThread.completed = true; // prevent re-running
                        break;
                    }
                    if (inStubs || inExe || inDlls) {
                        lastValidThreadEIP = eip;
                    }
                }
            }
            catch (err) {
                threadError = err;
                console.log("  [Thread] Thread ".concat(runnableThread.threadId, " error after ").concat(threadSteps, " steps: ").concat(err.message));
                console.log("  [Thread] State: ".concat(cpu.toString()));
            }
            var threadCompleted = runnableThread.completed;
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
                console.log("  [Scheduler] Thread ".concat(runnableThread.threadId, " yielded after ").concat(threadSteps, " steps (EIP=0x").concat(cpu.eip.toString(16), ")"));
            }
            else if (threadCompleted) {
                console.log("  [Scheduler] Thread ".concat(runnableThread.threadId, " completed after ").concat(threadSteps, " steps"));
            }
            else if (threadError) {
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
            console.log("\n[Win32] Sleep() called ".concat(sleepCount, " times with no runnable threads - halting"));
            cpu.halted = true;
            return;
        }
        cleanupStdcall(cpu, memory, 4);
    });
    // CloseHandle(HANDLE hObject) -> BOOL
    stubs.registerStub("kernel32.dll", "CloseHandle", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // WriteFile(HANDLE hFile, LPCVOID lpBuffer, DWORD nNumberOfBytesToWrite, LPDWORD lpNumberOfBytesWritten, LPOVERLAPPED lpOverlapped) -> BOOL
    stubs.registerStub("kernel32.dll", "WriteFile", function (cpu) {
        var nBytes = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 12) >>> 0);
        var lpBytesWritten = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 16) >>> 0);
        if (lpBytesWritten !== 0) {
            memory.write32(lpBytesWritten, nBytes);
        }
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 20);
    });
    // SetHandleCount(UINT uNumber) -> UINT
    // Obsolete: just returns the argument unchanged
    stubs.registerStub("kernel32.dll", "SetHandleCount", function (cpu) {
        var uNumber = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        cpu.regs[CPU_ts_1.REG.EAX] = uNumber;
        cleanupStdcall(cpu, memory, 4);
    });
    // SetStdHandle(DWORD nStdHandle, HANDLE hHandle) -> BOOL
    stubs.registerStub("kernel32.dll", "SetStdHandle", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });
    // GetModuleFileNameA(HMODULE hModule, LPSTR lpFilename, DWORD nSize) -> DWORD
    stubs.registerStub("kernel32.dll", "GetModuleFileNameA", function (cpu) {
        var lpFilename = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var nSize = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 12) >>> 0);
        var name = "C:\\MCity\\MCity_d.exe";
        var len = Math.min(name.length, nSize - 1);
        for (var i = 0; i < len; i++) {
            memory.write8(lpFilename + i, name.charCodeAt(i));
        }
        memory.write8(lpFilename + len, 0);
        cpu.regs[CPU_ts_1.REG.EAX] = len;
        cleanupStdcall(cpu, memory, 12);
    });
    // GetModuleFileNameW(HMODULE hModule, LPWSTR lpFilename, DWORD nSize) -> DWORD
    stubs.registerStub("kernel32.dll", "GetModuleFileNameW", function (cpu) {
        var lpFilename = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var nSize = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 12) >>> 0);
        var name = "C:\\MCity\\MCity_d.exe";
        var len = Math.min(name.length, nSize - 1);
        for (var i = 0; i < len; i++) {
            memory.write16(lpFilename + i * 2, name.charCodeAt(i));
        }
        memory.write16(lpFilename + len * 2, 0);
        cpu.regs[CPU_ts_1.REG.EAX] = len;
        cleanupStdcall(cpu, memory, 12);
    });
    // IsBadReadPtr(LPCVOID lp, UINT_PTR ucb) -> BOOL
    // Returns 0 if memory is readable, non-zero if bad
    stubs.registerStub("kernel32.dll", "IsBadReadPtr", function (cpu) {
        var lp = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var ucb = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        // Check if the address range is within our memory bounds
        var memSize = memory.size;
        if (lp === 0 || lp + ucb > memSize) {
            cpu.regs[CPU_ts_1.REG.EAX] = 1; // bad pointer
        }
        else {
            cpu.regs[CPU_ts_1.REG.EAX] = 0; // pointer is OK
        }
        cleanupStdcall(cpu, memory, 8);
    });
    // IsBadWritePtr(LPVOID lp, UINT_PTR ucb) -> BOOL
    stubs.registerStub("kernel32.dll", "IsBadWritePtr", function (cpu) {
        var lp = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var ucb = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var memSize = memory.size;
        if (lp === 0 || lp + ucb > memSize) {
            cpu.regs[CPU_ts_1.REG.EAX] = 1; // bad pointer
        }
        else {
            cpu.regs[CPU_ts_1.REG.EAX] = 0; // pointer is OK
        }
        cleanupStdcall(cpu, memory, 8);
    });
    // IsBadCodePtr(FARPROC lpfn) -> BOOL
    stubs.registerStub("kernel32.dll", "IsBadCodePtr", function (cpu) {
        var lpfn = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var memSize = memory.size;
        if (lpfn === 0 || lpfn >= memSize) {
            cpu.regs[CPU_ts_1.REG.EAX] = 1; // bad pointer
        }
        else {
            cpu.regs[CPU_ts_1.REG.EAX] = 0; // pointer is OK
        }
        cleanupStdcall(cpu, memory, 4);
    });
    // TerminateProcess(HANDLE hProcess, UINT uExitCode) -> BOOL
    stubs.registerStub("kernel32.dll", "TerminateProcess", function (cpu) {
        var uExitCode = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        console.log("\n[Win32] TerminateProcess(exitCode=".concat(uExitCode, ")"));
        cpu.halted = true;
    });
    // FatalAppExitA(UINT uAction, LPCSTR lpMessageText) -> void
    stubs.registerStub("kernel32.dll", "FatalAppExitA", function (cpu) {
        console.log("\n[Win32] FatalAppExitA called");
        cpu.halted = true;
    });
    // RtlUnwind(PVOID TargetFrame, PVOID TargetIp, PEXCEPTION_RECORD ExceptionRecord, PVOID ReturnValue) -> void
    stubs.registerStub("kernel32.dll", "RtlUnwind", function (cpu) {
        // Complex SEH function - for now just return without doing anything
        cleanupStdcall(cpu, memory, 16);
    });
    // RaiseException(DWORD dwExceptionCode, DWORD dwExceptionFlags, DWORD nNumberOfArguments, const ULONG_PTR *lpArguments) -> void
    stubs.registerStub("kernel32.dll", "RaiseException", function (cpu) {
        var code = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        console.log("\n[Win32] RaiseException(code=0x".concat(code.toString(16), ")"));
        cleanupStdcall(cpu, memory, 16);
    });
    // =============== Threading ===============
    // CreateThread(LPSECURITY_ATTRIBUTES, SIZE_T dwStackSize, LPTHREAD_START_ROUTINE lpStartAddress,
    //              LPVOID lpParameter, DWORD dwCreationFlags, LPDWORD lpThreadId) -> HANDLE
    stubs.registerStub("kernel32.dll", "CreateThread", function (cpu) {
        var lpStartAddress = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 12) >>> 0);
        var lpParameter = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 16) >>> 0);
        var dwCreationFlags = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 20) >>> 0);
        var lpThreadId = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 24) >>> 0);
        var CREATE_SUSPENDED = 0x4;
        var isSuspended = (dwCreationFlags & CREATE_SUSPENDED) !== 0;
        var threadId = nextThreadId++;
        var handle = nextThreadHandle++;
        console.log("  [Win32] CreateThread(startAddr=0x".concat(lpStartAddress.toString(16), ", param=0x").concat(lpParameter.toString(16), ", flags=0x").concat(dwCreationFlags.toString(16), ") -> handle=0x").concat(handle.toString(16), ", tid=").concat(threadId));
        // Save thread info for cooperative execution
        pendingThreads.push({
            startAddress: lpStartAddress,
            parameter: lpParameter,
            handle: handle,
            threadId: threadId,
            suspended: isSuspended,
            completed: false,
        });
        // Write thread ID to output parameter
        if (lpThreadId !== 0) {
            memory.write32(lpThreadId, threadId);
        }
        cpu.regs[CPU_ts_1.REG.EAX] = handle;
        cleanupStdcall(cpu, memory, 24);
    });
    // ResumeThread(HANDLE hThread) -> DWORD (previous suspend count)
    stubs.registerStub("kernel32.dll", "ResumeThread", function (cpu) {
        var hThread = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var thread = pendingThreads.find(function (t) { return t.handle === hThread; });
        if (thread && thread.suspended) {
            console.log("  [Win32] ResumeThread(0x".concat(hThread.toString(16), ") - unsuspending thread ").concat(thread.threadId));
            thread.suspended = false;
        }
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // previous suspend count was 1
        cleanupStdcall(cpu, memory, 4);
    });
    // ExitThread(DWORD dwExitCode) -> void (noreturn)
    stubs.registerStub("kernel32.dll", "ExitThread", function (cpu) {
        var exitCode = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        console.log("  [Win32] ExitThread(".concat(exitCode, ")"));
        if (currentThreadIdx >= 0) {
            pendingThreads[currentThreadIdx].completed = true;
        }
        cpu.halted = true; // Signal scheduler to switch back to main
    });
    // GetExitCodeThread(HANDLE hThread, LPDWORD lpExitCode) -> BOOL
    stubs.registerStub("kernel32.dll", "GetExitCodeThread", function (cpu) {
        var lpExitCode = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        if (lpExitCode !== 0) {
            memory.write32(lpExitCode, 0); // STILL_ACTIVE = 259, or 0 for exited
        }
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });
    // SuspendThread(HANDLE hThread) -> DWORD
    stubs.registerStub("kernel32.dll", "SuspendThread", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // previous suspend count
        cleanupStdcall(cpu, memory, 4);
    });
    // WaitForSingleObject(HANDLE hHandle, DWORD dwMilliseconds) -> DWORD
    stubs.registerStub("kernel32.dll", "WaitForSingleObject", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // WAIT_OBJECT_0 (signaled immediately)
        cleanupStdcall(cpu, memory, 8);
    });
    // WaitForMultipleObjects(DWORD nCount, const HANDLE *lpHandles, BOOL bWaitAll, DWORD dwMilliseconds) -> DWORD
    stubs.registerStub("kernel32.dll", "WaitForMultipleObjects", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // WAIT_OBJECT_0
        cleanupStdcall(cpu, memory, 16);
    });
    // Sleep stub - duplicate removed, the cooperative version is registered above (line ~866)
    // =============== Synchronization ===============
    // CreateMutexA(LPSECURITY_ATTRIBUTES, BOOL bInitialOwner, LPCSTR lpName) -> HANDLE
    stubs.registerStub("kernel32.dll", "CreateMutexA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0x0000CAFE; // fake mutex handle
        cleanupStdcall(cpu, memory, 12);
    });
    // OpenMutexA(DWORD dwDesiredAccess, BOOL bInheritHandle, LPCSTR lpName) -> HANDLE
    stubs.registerStub("kernel32.dll", "OpenMutexA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // NULL = doesn't exist
        cleanupStdcall(cpu, memory, 12);
    });
    // ReleaseMutex(HANDLE hMutex) -> BOOL
    stubs.registerStub("kernel32.dll", "ReleaseMutex", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // CreateEventA(LPSECURITY_ATTRIBUTES, BOOL bManualReset, BOOL bInitialState, LPCSTR lpName) -> HANDLE
    stubs.registerStub("kernel32.dll", "CreateEventA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0x0000DEAD; // fake event handle
        cleanupStdcall(cpu, memory, 16);
    });
    // SetEvent(HANDLE hEvent) -> BOOL
    stubs.registerStub("kernel32.dll", "SetEvent", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // ResetEvent(HANDLE hEvent) -> BOOL
    stubs.registerStub("kernel32.dll", "ResetEvent", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // CloseHandle(HANDLE hObject) -> BOOL
    stubs.registerStub("kernel32.dll", "CloseHandle", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // =============== Error handling ===============
    // GetLastError() -> DWORD
    stubs.registerStub("kernel32.dll", "GetLastError", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // ERROR_SUCCESS
    });
    // SetLastError(DWORD dwErrCode) -> void
    stubs.registerStub("kernel32.dll", "SetLastError", function (cpu) {
        cleanupStdcall(cpu, memory, 4);
    });
    // =============== File I/O ===============
    // CreateFileA(LPCSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE) -> HANDLE
    stubs.registerStub("kernel32.dll", "CreateFileA", function (cpu) {
        var namePtr = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var name = "";
        for (var i = 0; i < 260; i++) {
            var ch = memory.read8(namePtr + i);
            if (ch === 0)
                break;
            name += String.fromCharCode(ch);
        }
        console.log("  [Win32] CreateFileA(\"".concat(name, "\")"));
        cpu.regs[CPU_ts_1.REG.EAX] = 0xFFFFFFFF; // INVALID_HANDLE_VALUE (file not found)
        cleanupStdcall(cpu, memory, 28);
    });
    // CreateFileW(LPCWSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE) -> HANDLE
    stubs.registerStub("kernel32.dll", "CreateFileW", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0xFFFFFFFF; // INVALID_HANDLE_VALUE
        cleanupStdcall(cpu, memory, 28);
    });
    // ReadFile(HANDLE, LPVOID, DWORD, LPDWORD, LPOVERLAPPED) -> BOOL
    stubs.registerStub("kernel32.dll", "ReadFile", function (cpu) {
        var lpBytesRead = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 16) >>> 0);
        if (lpBytesRead !== 0)
            memory.write32(lpBytesRead, 0);
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // FALSE (failed)
        cleanupStdcall(cpu, memory, 20);
    });
    // GetFileAttributesA(LPCSTR lpFileName) -> DWORD
    stubs.registerStub("kernel32.dll", "GetFileAttributesA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0xFFFFFFFF; // INVALID_FILE_ATTRIBUTES (not found)
        cleanupStdcall(cpu, memory, 4);
    });
    // GetFullPathNameA(LPCSTR, DWORD, LPSTR, LPSTR*) -> DWORD
    stubs.registerStub("kernel32.dll", "GetFullPathNameA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // 0 = failure
        cleanupStdcall(cpu, memory, 16);
    });
    // =============== Directory ===============
    // GetCurrentDirectoryA(DWORD nBufferLength, LPSTR lpBuffer) -> DWORD
    stubs.registerStub("kernel32.dll", "GetCurrentDirectoryA", function (cpu) {
        var nBufLen = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var lpBuf = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var dir = "C:\\MCity";
        if (lpBuf !== 0 && nBufLen > dir.length) {
            for (var i = 0; i < dir.length; i++)
                memory.write8(lpBuf + i, dir.charCodeAt(i));
            memory.write8(lpBuf + dir.length, 0);
        }
        cpu.regs[CPU_ts_1.REG.EAX] = dir.length;
        cleanupStdcall(cpu, memory, 8);
    });
    // SetCurrentDirectoryA(LPCSTR lpPathName) -> BOOL
    stubs.registerStub("kernel32.dll", "SetCurrentDirectoryA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // GetWindowsDirectoryA(LPSTR lpBuffer, UINT uSize) -> UINT
    stubs.registerStub("kernel32.dll", "GetWindowsDirectoryA", function (cpu) {
        var lpBuf = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var uSize = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var dir = "C:\\WINDOWS";
        if (lpBuf !== 0 && uSize > dir.length) {
            for (var i = 0; i < dir.length; i++)
                memory.write8(lpBuf + i, dir.charCodeAt(i));
            memory.write8(lpBuf + dir.length, 0);
        }
        cpu.regs[CPU_ts_1.REG.EAX] = dir.length;
        cleanupStdcall(cpu, memory, 8);
    });
    // GetDiskFreeSpaceA(LPCSTR, LPDWORD, LPDWORD, LPDWORD, LPDWORD) -> BOOL
    stubs.registerStub("kernel32.dll", "GetDiskFreeSpaceA", function (cpu) {
        var lpSectorsPerCluster = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var lpBytesPerSector = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 12) >>> 0);
        var lpFreeClusters = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 16) >>> 0);
        var lpTotalClusters = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 20) >>> 0);
        if (lpSectorsPerCluster)
            memory.write32(lpSectorsPerCluster, 8);
        if (lpBytesPerSector)
            memory.write32(lpBytesPerSector, 512);
        if (lpFreeClusters)
            memory.write32(lpFreeClusters, 1000000);
        if (lpTotalClusters)
            memory.write32(lpTotalClusters, 2000000);
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 20);
    });
    // GetDriveTypeA(LPCSTR lpRootPathName) -> UINT
    stubs.registerStub("kernel32.dll", "GetDriveTypeA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 3; // DRIVE_FIXED
        cleanupStdcall(cpu, memory, 4);
    });
    // =============== Time ===============
    // GetLocalTime(LPSYSTEMTIME lpSystemTime) -> void
    stubs.registerStub("kernel32.dll", "GetLocalTime", function (cpu) {
        var lp = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        // SYSTEMTIME: wYear(2), wMonth(2), wDayOfWeek(2), wDay(2), wHour(2), wMinute(2), wSecond(2), wMilliseconds(2)
        memory.write16(lp, 2003); // year
        memory.write16(lp + 2, 6); // month (June)
        memory.write16(lp + 4, 2); // day of week (Tuesday)
        memory.write16(lp + 6, 28); // day
        memory.write16(lp + 8, 12); // hour
        memory.write16(lp + 10, 0); // minute
        memory.write16(lp + 12, 0); // second
        memory.write16(lp + 14, 0); // ms
        cleanupStdcall(cpu, memory, 4);
    });
    // GetSystemTime(LPSYSTEMTIME lpSystemTime) -> void
    stubs.registerStub("kernel32.dll", "GetSystemTime", function (cpu) {
        var lp = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        memory.write16(lp, 2003);
        memory.write16(lp + 2, 6);
        memory.write16(lp + 4, 2);
        memory.write16(lp + 6, 28);
        memory.write16(lp + 8, 17); // UTC hour
        memory.write16(lp + 10, 0);
        memory.write16(lp + 12, 0);
        memory.write16(lp + 14, 0);
        cleanupStdcall(cpu, memory, 4);
    });
    // GetTickCount() -> DWORD
    stubs.registerStub("kernel32.dll", "GetTickCount", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 100000; // fake tick count
    });
    // QueryPerformanceCounter(LARGE_INTEGER *lpPerformanceCount) -> BOOL
    stubs.registerStub("kernel32.dll", "QueryPerformanceCounter", function (cpu) {
        var lp = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        if (lp !== 0) {
            memory.write32(lp, 1000000); // low dword
            memory.write32(lp + 4, 0); // high dword
        }
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // QueryPerformanceFrequency(LARGE_INTEGER *lpFrequency) -> BOOL
    stubs.registerStub("kernel32.dll", "QueryPerformanceFrequency", function (cpu) {
        var lp = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        if (lp !== 0) {
            memory.write32(lp, 3579545); // ~3.58 MHz (typical)
            memory.write32(lp + 4, 0);
        }
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // GetTimeZoneInformation(LPTIME_ZONE_INFORMATION) -> DWORD
    stubs.registerStub("kernel32.dll", "GetTimeZoneInformation", function (cpu) {
        var lp = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        // Zero out the structure (172 bytes)
        for (var i = 0; i < 172; i++)
            memory.write8(lp + i, 0);
        memory.write32(lp, 300); // Bias = 300 minutes (EST = UTC-5)
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TIME_ZONE_ID_STANDARD
        cleanupStdcall(cpu, memory, 4);
    });
    // FileTimeToLocalFileTime(const FILETIME*, LPFILETIME) -> BOOL
    stubs.registerStub("kernel32.dll", "FileTimeToLocalFileTime", function (cpu) {
        var lpIn = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var lpOut = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        // Just copy input to output (ignore timezone)
        memory.write32(lpOut, memory.read32(lpIn));
        memory.write32(lpOut + 4, memory.read32(lpIn + 4));
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });
    // FileTimeToSystemTime(const FILETIME*, LPSYSTEMTIME) -> BOOL
    stubs.registerStub("kernel32.dll", "FileTimeToSystemTime", function (cpu) {
        var lpST = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        // Write a reasonable date
        memory.write16(lpST, 2003);
        memory.write16(lpST + 2, 6);
        memory.write16(lpST + 4, 2);
        memory.write16(lpST + 6, 28);
        memory.write16(lpST + 8, 12);
        memory.write16(lpST + 10, 0);
        memory.write16(lpST + 12, 0);
        memory.write16(lpST + 14, 0);
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });
    // =============== Misc ===============
    // FormatMessageA(...) -> DWORD
    stubs.registerStub("kernel32.dll", "FormatMessageA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // 0 chars written (failure)
        cleanupStdcall(cpu, memory, 28);
    });
    // GetProcessHeap() -> HANDLE
    stubs.registerStub("kernel32.dll", "GetProcessHeap", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0x00010000; // fake heap handle (same as HeapCreate returns)
    });
    // GlobalGetAtomNameA(ATOM, LPSTR, int) -> UINT
    stubs.registerStub("kernel32.dll", "GlobalGetAtomNameA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // failure
        cleanupStdcall(cpu, memory, 12);
    });
    // GlobalDeleteAtom(ATOM) -> ATOM
    stubs.registerStub("kernel32.dll", "GlobalDeleteAtom", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // success
        cleanupStdcall(cpu, memory, 4);
    });
    // DeviceIoControl(...) -> BOOL
    stubs.registerStub("kernel32.dll", "DeviceIoControl", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // FALSE (failed)
        cleanupStdcall(cpu, memory, 32);
    });
    // WinExec(LPCSTR lpCmdLine, UINT uCmdShow) -> UINT
    stubs.registerStub("kernel32.dll", "WinExec", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 31; // ERROR_FILE_NOT_FOUND (> 31 = success)
        cleanupStdcall(cpu, memory, 8);
    });
    // _lopen(LPCSTR lpPathName, int iReadWrite) -> HFILE
    stubs.registerStub("kernel32.dll", "_lopen", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0xFFFFFFFF; // HFILE_ERROR
        cleanupStdcall(cpu, memory, 8);
    });
    // _lclose(HFILE hFile) -> HFILE
    stubs.registerStub("kernel32.dll", "_lclose", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // success
        cleanupStdcall(cpu, memory, 4);
    });
    // WritePrivateProfileSectionA(LPCSTR, LPCSTR, LPCSTR) -> BOOL
    stubs.registerStub("kernel32.dll", "WritePrivateProfileSectionA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 12);
    });
    // InterlockedIncrement(LONG volatile *Addend) -> LONG
    stubs.registerStub("kernel32.dll", "InterlockedIncrement", function (cpu) {
        var pAddend = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var val = (memory.read32(pAddend) + 1) >>> 0;
        memory.write32(pAddend, val);
        cpu.regs[CPU_ts_1.REG.EAX] = val;
        cleanupStdcall(cpu, memory, 4);
    });
    // InterlockedDecrement(LONG volatile *Addend) -> LONG
    stubs.registerStub("kernel32.dll", "InterlockedDecrement", function (cpu) {
        var pAddend = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var val = ((memory.read32(pAddend) - 1) & 0xFFFFFFFF) >>> 0;
        memory.write32(pAddend, val);
        cpu.regs[CPU_ts_1.REG.EAX] = val;
        cleanupStdcall(cpu, memory, 4);
    });
    // InterlockedExchange(LONG volatile *Target, LONG Value) -> LONG
    stubs.registerStub("kernel32.dll", "InterlockedExchange", function (cpu) {
        var pTarget = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var value = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var original = memory.read32(pTarget);
        memory.write32(pTarget, value);
        cpu.regs[CPU_ts_1.REG.EAX] = original;
        cleanupStdcall(cpu, memory, 8);
    });
    // OutputDebugStringA(LPCSTR lpOutputString) -> void
    stubs.registerStub("kernel32.dll", "OutputDebugStringA", function (cpu) {
        // Read and print the debug string
        var lpStr = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        if (lpStr !== 0) {
            var str = '';
            for (var i = 0; i < 256; i++) {
                var ch = memory.read8(lpStr + i);
                if (ch === 0)
                    break;
                str += String.fromCharCode(ch);
            }
            console.log("[OutputDebugString] ".concat(str));
        }
        cleanupStdcall(cpu, memory, 4);
    });
    // DebugBreak() -> void
    stubs.registerStub("kernel32.dll", "DebugBreak", function (_cpu) {
        console.log("[Win32] DebugBreak called");
    });
    // SetErrorMode(UINT uMode) -> UINT
    stubs.registerStub("kernel32.dll", "SetErrorMode", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // return previous mode (0)
        cleanupStdcall(cpu, memory, 4);
    });
    // LCMapStringA(LCID Locale, DWORD dwMapFlags, LPCSTR lpSrcStr, int cchSrc, LPSTR lpDestStr, int cchDest) -> int
    stubs.registerStub("kernel32.dll", "LCMapStringA", function (cpu) {
        var cchSrc = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 16) >>> 0);
        cpu.regs[CPU_ts_1.REG.EAX] = cchSrc;
        cleanupStdcall(cpu, memory, 24);
    });
    // CompareStringA(LCID Locale, DWORD dwCmpFlags, PCNZCH lpString1, int cchCount1, PCNZCH lpString2, int cchCount2) -> int
    stubs.registerStub("kernel32.dll", "CompareStringA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 2; // CSTR_EQUAL
        cleanupStdcall(cpu, memory, 24);
    });
    // CompareStringW(LCID Locale, DWORD dwCmpFlags, PCNZWCH lpString1, int cchCount1, PCNZWCH lpString2, int cchCount2) -> int
    stubs.registerStub("kernel32.dll", "CompareStringW", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 2; // CSTR_EQUAL
        cleanupStdcall(cpu, memory, 24);
    });
    // GetStringTypeA(LCID Locale, DWORD dwInfoType, LPCSTR lpSrcStr, int cchSrc, LPWORD lpCharType) -> BOOL
    stubs.registerStub("kernel32.dll", "GetStringTypeA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 20);
    });
    // GetOEMCP() -> UINT
    stubs.registerStub("kernel32.dll", "GetOEMCP", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 437; // US OEM code page
    });
    // GetUserDefaultLCID() -> LCID
    stubs.registerStub("kernel32.dll", "GetUserDefaultLCID", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0x0409; // English (US)
    });
    // IsValidLocale(LCID Locale, DWORD dwFlags) -> BOOL
    stubs.registerStub("kernel32.dll", "IsValidLocale", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });
    // EnumSystemLocalesA(LOCALE_ENUMPROCA lpLocaleEnumProc, DWORD dwFlags) -> BOOL
    stubs.registerStub("kernel32.dll", "EnumSystemLocalesA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE (just say we enumerated them)
        cleanupStdcall(cpu, memory, 8);
    });
    // GetLocaleInfoW(LCID Locale, LCTYPE LCType, LPWSTR lpLCData, int cchData) -> int
    stubs.registerStub("kernel32.dll", "GetLocaleInfoW", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // failure (no data available)
        cleanupStdcall(cpu, memory, 16);
    });
    // SetConsoleCtrlHandler(PHANDLER_ROUTINE HandlerRoutine, BOOL Add) -> BOOL
    stubs.registerStub("kernel32.dll", "SetConsoleCtrlHandler", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });
    // SetEnvironmentVariableA(LPCSTR lpName, LPCSTR lpValue) -> BOOL
    stubs.registerStub("kernel32.dll", "SetEnvironmentVariableA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });
    // SetEnvironmentVariableW(LPCWSTR lpName, LPCWSTR lpValue) -> BOOL
    stubs.registerStub("kernel32.dll", "SetEnvironmentVariableW", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 8);
    });
    // VirtualProtect(LPVOID lpAddress, SIZE_T dwSize, DWORD flNewProtect, PDWORD lpflOldProtect) -> BOOL
    stubs.registerStub("kernel32.dll", "VirtualProtect", function (cpu) {
        var lpflOldProtect = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 16) >>> 0);
        if (lpflOldProtect !== 0) {
            memory.write32(lpflOldProtect, 0x04); // PAGE_READWRITE
        }
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 16);
    });
    // lstrlenA(LPCSTR lpString) -> int
    stubs.registerStub("kernel32.dll", "lstrlenA", function (cpu) {
        var lpStr = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var len = 0;
        if (lpStr !== 0) {
            while (len < 65536) {
                if (memory.read8(lpStr + len) === 0)
                    break;
                len++;
            }
        }
        cpu.regs[CPU_ts_1.REG.EAX] = len;
        cleanupStdcall(cpu, memory, 4);
    });
    // lstrcpyA(LPSTR lpString1, LPCSTR lpString2) -> LPSTR
    stubs.registerStub("kernel32.dll", "lstrcpyA", function (cpu) {
        var lpDst = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var lpSrc = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var i = 0;
        while (i < 65536) {
            var ch = memory.read8(lpSrc + i);
            memory.write8(lpDst + i, ch);
            if (ch === 0)
                break;
            i++;
        }
        cpu.regs[CPU_ts_1.REG.EAX] = lpDst;
        cleanupStdcall(cpu, memory, 8);
    });
    // LocalAlloc(UINT uFlags, SIZE_T uBytes) -> HLOCAL
    stubs.registerStub("kernel32.dll", "LocalAlloc", function (cpu) {
        var uBytes = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        // Use our simple heap
        var addr = simpleAlloc(uBytes);
        cpu.regs[CPU_ts_1.REG.EAX] = addr;
        cleanupStdcall(cpu, memory, 8);
    });
    // LocalFree(HLOCAL hMem) -> HLOCAL
    stubs.registerStub("kernel32.dll", "LocalFree", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // NULL = success
        cleanupStdcall(cpu, memory, 4);
    });
    // GlobalAlloc(UINT uFlags, SIZE_T dwBytes) -> HGLOBAL
    stubs.registerStub("kernel32.dll", "GlobalAlloc", function (cpu) {
        var dwBytes = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var addr = simpleAlloc(dwBytes);
        cpu.regs[CPU_ts_1.REG.EAX] = addr;
        cleanupStdcall(cpu, memory, 8);
    });
    // GlobalFree(HGLOBAL hMem) -> HGLOBAL
    stubs.registerStub("kernel32.dll", "GlobalFree", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // NULL = success
        cleanupStdcall(cpu, memory, 4);
    });
    // HeapValidate(HANDLE hHeap, DWORD dwFlags, LPCVOID lpMem) -> BOOL
    stubs.registerStub("kernel32.dll", "HeapValidate", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE (heap is valid)
        cleanupStdcall(cpu, memory, 12);
    });
    // HeapDestroy(HANDLE hHeap) -> BOOL
    stubs.registerStub("kernel32.dll", "HeapDestroy", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // DuplicateHandle(HANDLE, HANDLE, HANDLE, LPHANDLE, DWORD, BOOL, DWORD) -> BOOL
    stubs.registerStub("kernel32.dll", "DuplicateHandle", function (cpu) {
        var lpTargetHandle = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 16) >>> 0);
        if (lpTargetHandle !== 0) {
            // Write a fake handle
            memory.write32(lpTargetHandle, 0x200);
        }
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 28);
    });
    // SetFilePointer(HANDLE, LONG, PLONG, DWORD) -> DWORD
    stubs.registerStub("kernel32.dll", "SetFilePointer", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // new position = 0
        cleanupStdcall(cpu, memory, 16);
    });
    // FlushFileBuffers(HANDLE hFile) -> BOOL
    stubs.registerStub("kernel32.dll", "FlushFileBuffers", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // SetEndOfFile(HANDLE hFile) -> BOOL
    stubs.registerStub("kernel32.dll", "SetEndOfFile", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // GetCurrentDirectoryA(DWORD nBufferLength, LPSTR lpBuffer) -> DWORD
    stubs.registerStub("kernel32.dll", "GetCurrentDirectoryA", function (cpu) {
        var nBufferLength = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var lpBuffer = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var dir = "C:\\MCity";
        if (nBufferLength > dir.length) {
            for (var i = 0; i < dir.length; i++) {
                memory.write8(lpBuffer + i, dir.charCodeAt(i));
            }
            memory.write8(lpBuffer + dir.length, 0);
            cpu.regs[CPU_ts_1.REG.EAX] = dir.length;
        }
        else {
            cpu.regs[CPU_ts_1.REG.EAX] = dir.length + 1; // required size
        }
        cleanupStdcall(cpu, memory, 8);
    });
    // SetCurrentDirectoryA(LPCSTR lpPathName) -> BOOL
    stubs.registerStub("kernel32.dll", "SetCurrentDirectoryA", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // TRUE
        cleanupStdcall(cpu, memory, 4);
    });
    // GetWindowsDirectoryA(LPSTR lpBuffer, UINT uSize) -> UINT
    stubs.registerStub("kernel32.dll", "GetWindowsDirectoryA", function (cpu) {
        var lpBuffer = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var uSize = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var dir = "C:\\WINDOWS";
        if (uSize > dir.length) {
            for (var i = 0; i < dir.length; i++) {
                memory.write8(lpBuffer + i, dir.charCodeAt(i));
            }
            memory.write8(lpBuffer + dir.length, 0);
        }
        cpu.regs[CPU_ts_1.REG.EAX] = dir.length;
        cleanupStdcall(cpu, memory, 8);
    });
    // --- MSVCRT stubs ---
    // _initterm(PVOID* pfbegin, PVOID* pfend) -> void
    // Calls each non-null function pointer in the array [pfbegin, pfend)
    // For now, just skip it - these are C++ static initializers
    stubs.registerStub("msvcrt.dll", "_initterm", function (_cpu) {
        // cdecl: caller cleans up args
    });
    // _initterm_e(PVOID* pfbegin, PVOID* pfend) -> int
    stubs.registerStub("msvcrt.dll", "_initterm_e", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // success
        // cdecl: caller cleans up args
    });
    // __set_app_type(int apptype) -> void
    stubs.registerStub("msvcrt.dll", "__set_app_type", function (_cpu) {
        // cdecl: caller cleans up args
    });
    // __p__fmode() -> int*
    var fmodeAddr = 0x00201400;
    memory.write32(fmodeAddr, 0); // _O_TEXT
    stubs.registerStub("msvcrt.dll", "__p__fmode", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = fmodeAddr;
    });
    // __p__commode() -> int*
    var commodeAddr = 0x00201404;
    memory.write32(commodeAddr, 0);
    stubs.registerStub("msvcrt.dll", "__p__commode", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = commodeAddr;
    });
    // _controlfp(unsigned int new, unsigned int mask) -> unsigned int
    stubs.registerStub("msvcrt.dll", "_controlfp", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0x0001001F; // default FP control word
        // cdecl: caller cleans up
    });
    // _except_handler3 - SEH handler (cdecl calling convention)
    stubs.registerStub("msvcrt.dll", "_except_handler3", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // ExceptionContinueSearch
        // cdecl: caller cleans up args
    });
    // __getmainargs(int* argc, char*** argv, char*** envp, int doWildCard, _startupinfo* startupInfo) -> int
    // Set up minimal argc/argv for the game
    var argcAddr = 0x00201500;
    var argvAddr = 0x00201504;
    var envpAddr = 0x00201508;
    var argvArrayAddr = 0x00201510;
    // argv[0] = pointer to exe name, argv[1] = NULL
    memory.write32(argvArrayAddr, cmdLineAddr); // points to "MCity_d.exe"
    memory.write32(argvArrayAddr + 4, 0); // NULL terminator
    memory.write32(argcAddr, 1);
    memory.write32(argvAddr, argvArrayAddr);
    memory.write32(envpAddr, envStrAAddr);
    stubs.registerStub("msvcrt.dll", "__getmainargs", function (cpu) {
        // Write to the pointers passed as arguments
        var pArgc = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        var pArgv = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var pEnvp = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 12) >>> 0);
        memory.write32(pArgc, 1);
        memory.write32(pArgv, argvArrayAddr);
        memory.write32(pEnvp, envStrAAddr);
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // success
        // cdecl: caller cleans up
    });
    // =============== USER32.DLL ===============
    // MessageBoxA(HWND hWnd, LPCSTR lpText, LPCSTR lpCaption, UINT uType) -> int
    stubs.registerStub("user32.dll", "MessageBoxA", function (cpu) {
        var lpText = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 8) >>> 0);
        var lpCaption = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 12) >>> 0);
        var uType = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 16) >>> 0);
        var text = "", caption = "";
        for (var i = 0; i < 1024; i++) {
            var ch = memory.read8(lpText + i);
            if (ch === 0)
                break;
            text += String.fromCharCode(ch);
        }
        for (var i = 0; i < 256; i++) {
            var ch = memory.read8(lpCaption + i);
            if (ch === 0)
                break;
            caption += String.fromCharCode(ch);
        }
        console.log("\n  [Win32] MessageBoxA(\"".concat(caption, "\", \"").concat(text.replace(/\n/g, "\\n"), "\")"));
        // MB_ABORTRETRYIGNORE has Abort=3, Retry=4, Ignore=5
        // MB_OK has OK=1
        // For debug assertions, return Ignore (5) to continue execution
        // uType & 0xF gives the button type: 2 = MB_ABORTRETRYIGNORE
        var btnType = uType & 0xF;
        if (btnType === 2) {
            cpu.regs[CPU_ts_1.REG.EAX] = 5; // IDIGNORE - continue past assertion
        }
        else {
            cpu.regs[CPU_ts_1.REG.EAX] = 1; // IDOK
        }
        cleanupStdcall(cpu, memory, 16);
    });
    // MessageBoxW(HWND hWnd, LPCWSTR lpText, LPCWSTR lpCaption, UINT uType) -> int
    stubs.registerStub("user32.dll", "MessageBoxW", function (cpu) {
        console.log("  [Win32] MessageBoxW() called");
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // IDOK
        cleanupStdcall(cpu, memory, 16);
    });
    // GetActiveWindow() -> HWND
    stubs.registerStub("user32.dll", "GetActiveWindow", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // NULL (no active window)
    });
    // GetLastActivePopup(HWND hWnd) -> HWND
    stubs.registerStub("user32.dll", "GetLastActivePopup", function (cpu) {
        // Return the same handle passed in (or NULL if NULL)
        var hWnd = memory.read32((cpu.regs[CPU_ts_1.REG.ESP] + 4) >>> 0);
        cpu.regs[CPU_ts_1.REG.EAX] = hWnd;
        cleanupStdcall(cpu, memory, 4);
    });
    console.log("[Win32Stubs] Registered ".concat(stubs.count, " API stubs in memory at 0x").concat(STUB_BASE.toString(16)));
}
/**
 * Patch internal CRT functions that can't be intercepted via IAT.
 * Must be called AFTER sections are loaded into memory.
 */
function patchCRTInternals(stubs) {
    // _sbh_heap_init at 0x00a06f60 - CRT small-block heap initialization
    // This function computes log2(heap_size) in a loop that hangs if the
    // heap struct isn't properly initialized. Since we fake the heap,
    // just return success (EAX=1).
    stubs.patchAddress(0x00a06f60, "_sbh_heap_init", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 1; // success
        // cdecl: caller cleans up the 1 arg
    });
    // __sbh_alloc_block at 0x00a06910 - CRT small-block heap allocator
    // Scans bitmap arrays to find free blocks. Since we don't populate SBH
    // metadata, this loops forever searching all-zero bitmaps.
    // Return 0 (NULL) to tell caller "SBH can't satisfy this allocation",
    // which makes it fall back to HeapAlloc (which we stub).
    stubs.patchAddress(0x00a06910, "__sbh_alloc_block", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // NULL = allocation failed, use HeapAlloc fallback
        // cdecl: caller cleans up the 1 arg
    });
    // _CrtDbgReport at 0x009f9300 - CRT debug assertion reporter
    // Called by _ASSERTE macros in the debug CRT. Our heap doesn't maintain
    // debug CRT linked list headers, so assertions fire on every free.
    // Return 0 = continue execution (don't break into debugger).
    stubs.patchAddress(0x009f9300, "_CrtDbgReport", function (cpu) {
        cpu.regs[CPU_ts_1.REG.EAX] = 0; // 0 = continue, 1 = debug break
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
function cleanupStdcall(cpu, memory, argBytes) {
    // Stack layout after stub returns: [return_addr] [arg1] [arg2] ...
    // For stdcall, we need to pop return_addr, skip args, then jump to return_addr
    // But since our stub ends with RET, we just move the return addr down
    var retAddr = memory.read32(cpu.regs[CPU_ts_1.REG.ESP]);
    cpu.regs[CPU_ts_1.REG.ESP] = (cpu.regs[CPU_ts_1.REG.ESP] + argBytes) >>> 0; // skip args only
    memory.write32(cpu.regs[CPU_ts_1.REG.ESP], retAddr); // write return addr at new stack top
}
