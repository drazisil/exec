import type { Memory } from "../hardware/Memory.js";

/**
 * TEB (Thread Environment Block) - x86 32-bit layout
 * Stores per-thread kernel data and FS segment base
 */
export interface TEBStructure {
    baseAddress: number;
    stackBase: number;
    stackLimit: number;
    pebAddress: number;
}

/**
 * PEB (Process Environment Block)
 * Stores per-process data like loaded modules
 */
export interface PEBStructure {
    baseAddress: number;
    // Fields would be populated as needed
}

export class KernelStructures {
    private _memory: Memory;
    private _teb: TEBStructure | null = null;
    private _peb: PEBStructure | null = null;
    private _fsBase: number = 0; // FS segment base address

    constructor(memory: Memory) {
        this._memory = memory;
    }

    /**
     * Allocate and initialize TEB/PEB structures
     * Places them before the main executable (0x00400000)
     */
    initializeKernelStructures(stackBase: number, stackLimit: number): void {
        // Allocate PEB at 0x00300000 (1MB before main executable)
        const pebAddr = 0x00300000;
        this._peb = {
            baseAddress: pebAddr,
        };

        // Allocate TEB at 0x00320000 (right after PEB, 0x20000 bytes)
        const tebAddr = 0x00320000;
        this._teb = {
            baseAddress: tebAddr,
            stackBase,
            stackLimit,
            pebAddress: pebAddr,
        };

        // Set FS base to TEB address
        // In real x86, FS segment descriptor points to TEB
        this._fsBase = tebAddr;

        // Write TEB structure into memory
        this._writeTEBToMemory();
    }

    /**
     * Write TEB structure into memory at its allocated address
     */
    private _writeTEBToMemory(): void {
        if (!this._teb) return;

        const teb = this._teb;
        const addr = teb.baseAddress;

        // TEB Structure Layout (NT_TIB portion):
        // 0x0000: ExceptionList (initially 0xFFFFFFFF = no handler)
        this._memory.write32(addr + 0x0000, 0xFFFFFFFF);

        // 0x0004: StackBase (highest valid address)
        this._memory.write32(addr + 0x0004, teb.stackBase);

        // 0x0008: StackLimit (lowest valid address)
        this._memory.write32(addr + 0x0008, teb.stackLimit);

        // 0x000C: SubSystemTib
        this._memory.write32(addr + 0x000C, 0);

        // 0x0010: FiberData/Version (initially 0)
        this._memory.write32(addr + 0x0010, 0);

        // 0x0014: ArbitraryUserPointer
        this._memory.write32(addr + 0x0014, 0);

        // 0x0018: Self (pointer to this TEB)
        this._memory.write32(addr + 0x0018, addr);

        // 0x001C: EnvironmentPointer
        this._memory.write32(addr + 0x001C, 0);

        // 0x0020: ClientId.ProcessId
        this._memory.write32(addr + 0x0020, 0x00000004); // Process ID = 4 (arbitrary)

        // 0x0024: ClientId.ThreadId
        this._memory.write32(addr + 0x0024, 0x00000001); // Thread ID = 1 (main thread)

        // 0x0030: ProcessEnvironmentBlock (PEB pointer)
        this._memory.write32(addr + 0x0030, teb.pebAddress);

        // 0x0034: LastErrorValue
        this._memory.write32(addr + 0x0034, 0);
    }

    /**
     * Resolve a FS-relative address to a linear address
     * Used when CPU encounters FS: prefix
     */
    resolveFSRelativeAddress(offset: number): number {
        return (this._fsBase + offset) >>> 0;
    }

    /**
     * Resolve a GS-relative address to a linear address
     * Used when CPU encounters GS: prefix
     */
    resolveGSRelativeAddress(offset: number): number {
        // For x86-32, GS is less commonly used
        // Would typically point to kernel data in system processes
        // For user-mode, we can make it point to a different structure or the same TEB
        return (this._fsBase + offset) >>> 0;
    }

    /**
     * Get the FS segment base address
     */
    getFSBase(): number {
        return this._fsBase;
    }

    /**
     * Get the GS segment base address
     */
    getGSBase(): number {
        // Could be different, but for simplicity we'll use same as FS for now
        return this._fsBase;
    }

    /**
     * Get TEB structure info
     */
    getTEB(): TEBStructure | null {
        return this._teb;
    }

    /**
     * Get PEB structure info
     */
    getPEB(): PEBStructure | null {
        return this._peb;
    }
}
