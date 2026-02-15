import { Memory } from "./Memory.ts";
import type { KernelStructures } from "../kernel/KernelStructures.ts";

export type OpcodeHandler = (cpu: CPU) => void;

export const REG = {
    EAX: 0, ECX: 1, EDX: 2, EBX: 3,
    ESP: 4, EBP: 5, ESI: 6, EDI: 7,
} as const;

export const REG_NAMES = ["EAX", "ECX", "EDX", "EBX", "ESP", "EBP", "ESI", "EDI"];

export const FLAG = {
    CF: 0,
    ZF: 6,
    SF: 7,
    DF: 10,
    OF: 11,
} as const;

export class CPU {
    regs: Uint32Array;
    eip: number;
    eflags: number;
    memory: Memory;
    halted: boolean;
    kernelStructures: KernelStructures | null;
    segments: { ES: number; DS: number; CS: number; SS: number; FS: number; GS: number };
    private _opcodeTable: Map<number, OpcodeHandler>;
    private _intHandler: ((intNum: number, cpu: CPU) => void) | null;
    private _exceptionHandler: ((error: Error, cpu: CPU) => void) | null;
    private _stepCount: number;
    private _segmentOverride: "FS" | "GS" | null;
    private _repPrefix: "REP" | "REPNE" | null;
    private _operandSizeOverride: boolean;

    // x87 FPU state
    fpuStack: Float64Array;   // 8 x87 registers (80-bit stored as 64-bit doubles)
    fpuTop: number;           // TOP pointer (0-7), points to current ST(0)
    fpuStatusWord: number;    // FPU status word (includes C0-C3 condition codes)
    fpuControlWord: number;   // FPU control word (rounding, precision, exception masks)
    fpuTagWord: number;       // Tag word: 2 bits per register (00=valid, 11=empty)

    constructor(memory: Memory) {
        this.regs = new Uint32Array(8);
        this.eip = 0;
        this.eflags = 0;
        this.memory = memory;
        this.halted = false;
        this.kernelStructures = null;
        this.segments = { ES: 0, DS: 0, CS: 0, SS: 0, FS: 0, GS: 0 };
        this._opcodeTable = new Map();
        this._intHandler = null;
        this._exceptionHandler = null;
        this._stepCount = 0;
        this._segmentOverride = null;
        this._repPrefix = null;
        this._operandSizeOverride = false;
        // Initialize FPU
        this.fpuStack = new Float64Array(8);
        this.fpuTop = 0;
        this.fpuStatusWord = 0;
        this.fpuControlWord = 0x037F; // Default: all exceptions masked, double precision, round-nearest
        this.fpuTagWord = 0xFFFF;     // All registers empty (11 for each)
    }

    // --- FPU helpers ---

    /** Get ST(i) register value. ST(0) = fpuStack[fpuTop], ST(1) = fpuStack[(fpuTop+1)%8], etc. */
    fpuGet(i: number): number {
        return this.fpuStack[(this.fpuTop + i) & 7];
    }

    /** Set ST(i) register value */
    fpuSet(i: number, val: number): void {
        const idx = (this.fpuTop + i) & 7;
        this.fpuStack[idx] = val;
        // Mark register as valid (tag = 00)
        this.fpuTagWord &= ~(3 << (idx * 2));
    }

    /** Push a value onto the FPU stack (decrement TOP, then write to new ST(0)) */
    fpuPush(val: number): void {
        this.fpuTop = (this.fpuTop - 1) & 7;
        this.fpuStack[this.fpuTop] = val;
        // Mark new ST(0) as valid
        this.fpuTagWord &= ~(3 << (this.fpuTop * 2));
        // Update status word TOP field (bits 13-11)
        this.fpuStatusWord = (this.fpuStatusWord & ~0x3800) | (this.fpuTop << 11);
    }

    /** Pop the FPU stack (mark current ST(0) as empty, increment TOP) */
    fpuPop(): number {
        const val = this.fpuStack[this.fpuTop];
        // Mark register as empty (tag = 11)
        this.fpuTagWord |= (3 << (this.fpuTop * 2));
        this.fpuTop = (this.fpuTop + 1) & 7;
        // Update status word TOP field
        this.fpuStatusWord = (this.fpuStatusWord & ~0x3800) | (this.fpuTop << 11);
        return val;
    }

    /** Set FPU condition codes C0-C3 for comparison result */
    fpuSetCC(c3: boolean, c2: boolean, c0: boolean): void {
        this.fpuStatusWord &= ~(0x4500); // Clear C3(bit14), C2(bit10), C0(bit8)
        if (c0) this.fpuStatusWord |= 0x0100; // C0 = bit 8
        if (c2) this.fpuStatusWord |= 0x0400; // C2 = bit 10
        if (c3) this.fpuStatusWord |= 0x4000; // C3 = bit 14
    }

    /** Compare two FPU values and set condition codes */
    fpuCompare(a: number, b: number): void {
        if (isNaN(a) || isNaN(b)) {
            this.fpuSetCC(true, true, true); // Unordered: C3=1, C2=1, C0=1
        } else if (a > b) {
            this.fpuSetCC(false, false, false); // ST(0) > src: C3=0, C2=0, C0=0
        } else if (a < b) {
            this.fpuSetCC(false, false, true);  // ST(0) < src: C3=0, C2=0, C0=1
        } else {
            this.fpuSetCC(true, false, false);  // Equal: C3=1, C2=0, C0=0
        }
    }

    /** Read a 64-bit double from memory */
    readDouble(addr: number): number {
        const lo = this.memory.read32(addr);
        const hi = this.memory.read32(addr + 4);
        const buf = new ArrayBuffer(8);
        const view = new DataView(buf);
        view.setUint32(0, lo, true);
        view.setUint32(4, hi, true);
        return view.getFloat64(0, true);
    }

    /** Write a 64-bit double to memory */
    writeDouble(addr: number, val: number): void {
        const buf = new ArrayBuffer(8);
        const view = new DataView(buf);
        view.setFloat64(0, val, true);
        this.memory.write32(addr, view.getUint32(0, true));
        this.memory.write32(addr + 4, view.getUint32(4, true));
    }

    /** Read a 32-bit float from memory */
    readFloat(addr: number): number {
        const raw = this.memory.read32(addr);
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        view.setUint32(0, raw, true);
        return view.getFloat32(0, true);
    }

    /** Write a 32-bit float to memory */
    writeFloat(addr: number, val: number): void {
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        view.setFloat32(0, val, true);
        this.memory.write32(addr, view.getUint32(0, true));
    }

    /**
     * Read an 8-bit register value by ModR/M register index.
     * 0=AL, 1=CL, 2=DL, 3=BL, 4=AH, 5=CH, 6=DH, 7=BH
     */
    readReg8(idx: number): number {
        if (idx < 4) {
            return this.regs[idx] & 0xFF;          // AL, CL, DL, BL
        }
        return (this.regs[idx - 4] >> 8) & 0xFF;   // AH, CH, DH, BH
    }

    /**
     * Write an 8-bit register value by ModR/M register index.
     * 0=AL, 1=CL, 2=DL, 3=BL, 4=AH, 5=CH, 6=DH, 7=BH
     */
    writeReg8(idx: number, val: number): void {
        if (idx < 4) {
            this.regs[idx] = (this.regs[idx] & 0xFFFFFF00) | (val & 0xFF);
        } else {
            this.regs[idx - 4] = (this.regs[idx - 4] & 0xFFFF00FF) | ((val & 0xFF) << 8);
        }
    }

    /** Read 8-bit value from r/m8 (handles register encoding correctly) */
    readRM8(mod: number, rm: number): number {
        if (mod === 3) {
            return this.readReg8(rm);
        }
        const resolved = this.resolveRM(mod, rm);
        return this.memory.read8(this.applySegmentOverride(resolved.addr));
    }

    /** Write 8-bit value to r/m8 (handles register encoding correctly) */
    writeRM8(mod: number, rm: number, val: number): void {
        if (mod === 3) {
            this.writeReg8(rm, val);
        } else {
            const resolved = this.resolveRM(mod, rm);
            this.memory.write8(this.applySegmentOverride(resolved.addr), val & 0xFF);
        }
    }

    register(opcode: number, handler: OpcodeHandler): void {
        this._opcodeTable.set(opcode, handler);
    }

    onInterrupt(handler: (intNum: number, cpu: CPU) => void): void {
        this._intHandler = handler;
    }

    onException(handler: (error: Error, cpu: CPU) => void): void {
        this._exceptionHandler = handler;
    }

    triggerInterrupt(intNum: number): void {
        if (this._intHandler) {
            this._intHandler(intNum, this);
        } else {
            throw new Error(`Unhandled interrupt: INT ${hex8(intNum)}`);
        }
    }

    handleException(error: Error): void {
        if (this._exceptionHandler) {
            this._exceptionHandler(error, this);
        } else {
            throw error;
        }
    }

    // --- Fetch helpers (read at EIP and advance) ---

    fetch8(): number {
        const val = this.memory.read8(this.eip);
        this.eip = (this.eip + 1) >>> 0;
        return val;
    }

    fetch16(): number {
        const val = this.memory.read16(this.eip);
        this.eip = (this.eip + 2) >>> 0;
        return val;
    }

    fetch32(): number {
        const val = this.memory.read32(this.eip);
        this.eip = (this.eip + 4) >>> 0;
        return val;
    }

    fetchSigned8(): number {
        const val = this.memory.readSigned8(this.eip);
        this.eip = (this.eip + 1) >>> 0;
        return val;
    }

    fetchSigned32(): number {
        const val = this.memory.readSigned32(this.eip);
        this.eip = (this.eip + 4) >>> 0;
        return val;
    }

    // --- Flag helpers ---

    getFlag(bit: number): boolean {
        return ((this.eflags >>> bit) & 1) === 1;
    }

    setFlag(bit: number, val: boolean): void {
        if (val) {
            this.eflags |= (1 << bit);
        } else {
            this.eflags &= ~(1 << bit);
        }
    }

    updateFlagsArith(result: number, op1: number, op2: number, isSub: boolean): void {
        const r32 = result >>> 0;
        const masked = r32 & 0xFFFFFFFF;

        // ZF: result is zero
        this.setFlag(FLAG.ZF, masked === 0);

        // SF: sign bit
        this.setFlag(FLAG.SF, (masked & 0x80000000) !== 0);

        // CF: unsigned overflow
        if (isSub) {
            this.setFlag(FLAG.CF, (op1 >>> 0) < (op2 >>> 0));
        } else {
            this.setFlag(FLAG.CF, r32 < (op1 >>> 0) || r32 < (op2 >>> 0));
        }

        // OF: signed overflow
        const signOp1 = (op1 & 0x80000000) !== 0;
        const signOp2 = (op2 & 0x80000000) !== 0;
        const signRes = (masked & 0x80000000) !== 0;
        if (isSub) {
            this.setFlag(FLAG.OF, signOp1 !== signOp2 && signRes !== signOp1);
        } else {
            this.setFlag(FLAG.OF, signOp1 === signOp2 && signRes !== signOp1);
        }
    }

    updateFlagsLogic(result: number): void {
        const masked = result >>> 0;
        this.setFlag(FLAG.ZF, masked === 0);
        this.setFlag(FLAG.SF, (masked & 0x80000000) !== 0);
        this.setFlag(FLAG.CF, false);
        this.setFlag(FLAG.OF, false);
    }

    // --- Stack helpers ---

    push32(val: number): void {
        this.regs[REG.ESP] = (this.regs[REG.ESP] - 4) >>> 0;
        this.memory.write32(this.regs[REG.ESP], val);
    }

    pop32(): number {
        const val = this.memory.read32(this.regs[REG.ESP]);
        this.regs[REG.ESP] = (this.regs[REG.ESP] + 4) >>> 0;
        return val;
    }

    // --- ModR/M decoding ---

    decodeModRM(): { mod: number; reg: number; rm: number } {
        const byte = this.fetch8();
        return {
            mod: (byte >> 6) & 0x3,
            reg: (byte >> 3) & 0x7,
            rm: byte & 0x7,
        };
    }

    resolveRM(mod: number, rm: number): { isReg: boolean; addr: number } {
        if (mod === 0b11) {
            return { isReg: true, addr: rm };
        }

        let addr: number;

        if (mod === 0b00) {
            if (rm === 5) {
                addr = this.fetch32();
            } else if (rm === 4) {
                addr = this.decodeSIB(mod);
            } else {
                addr = this.regs[rm];
            }
        } else if (mod === 0b01) {
            if (rm === 4) {
                const sibAddr = this.decodeSIB(mod);
                const disp = this.fetchSigned8();
                addr = (sibAddr + disp) >>> 0;
            } else {
                const base = this.regs[rm];
                const disp = this.fetchSigned8();
                addr = (base + disp) >>> 0;
            }
        } else {
            // mod === 0b10
            if (rm === 4) {
                const sibAddr = this.decodeSIB(mod);
                const disp = this.fetchSigned32();
                addr = (sibAddr + disp) >>> 0;
            } else {
                const base = this.regs[rm];
                const disp = this.fetchSigned32();
                addr = (base + disp) >>> 0;
            }
        }

        return { isReg: false, addr };
    }

    /**
     * Decode SIB (Scale-Index-Base) byte for complex addressing modes.
     * Format: [base + index * scale], where scale = 1/2/4/8
     */
    private decodeSIB(mod: number): number {
        const sib = this.fetch8();
        const scale = 1 << ((sib >> 6) & 0x3); // 1, 2, 4, or 8
        const index = (sib >> 3) & 0x7;
        const base = sib & 0x7;

        let addr = 0;

        // Base register (ESP=4 special case: no index)
        if (base === 5 && mod === 0b00) {
            // [disp32 + index*scale] - no base register
            addr = this.fetch32();
        } else {
            addr = this.regs[base];
        }

        // Index register (ESP=4 means no index)
        if (index !== 4) {
            addr = (addr + this.regs[index] * scale) >>> 0;
        }

        return addr;
    }

    /**
     * Apply segment override to an address if needed
     */
    applySegmentOverride(addr: number): number {
        if (!this._segmentOverride || !this.kernelStructures) {
            return addr;
        }

        if (this._segmentOverride === "FS") {
            return this.kernelStructures.resolveFSRelativeAddress(addr);
        } else if (this._segmentOverride === "GS") {
            return this.kernelStructures.resolveGSRelativeAddress(addr);
        }
        return addr;
    }

    /**
     * Clear prefixes after instruction execution
     */
    private clearPrefixes(): void {
        this._segmentOverride = null;
        this._repPrefix = null;
        this._operandSizeOverride = false;
    }

    readRM32(mod: number, rm: number): number {
        const resolved = this.resolveRM(mod, rm);
        if (resolved.isReg) {
            return this.regs[resolved.addr];
        }
        const addr = this.applySegmentOverride(resolved.addr);
        return this.memory.read32(addr);
    }

    writeRM32(mod: number, rm: number, val: number): void {
        const resolved = this.resolveRM(mod, rm);
        if (resolved.isReg) {
            this.regs[resolved.addr] = val >>> 0;
        } else {
            const addr = this.applySegmentOverride(resolved.addr);
            this.memory.write32(addr, val >>> 0);
        }
    }

    /** Read 16- or 32-bit value from r/m depending on operand size prefix */
    readRMv(mod: number, rm: number): number {
        const resolved = this.resolveRM(mod, rm);
        if (this._operandSizeOverride) {
            if (resolved.isReg) return this.regs[resolved.addr] & 0xFFFF;
            return this.memory.read16(this.applySegmentOverride(resolved.addr));
        }
        if (resolved.isReg) return this.regs[resolved.addr];
        return this.memory.read32(this.applySegmentOverride(resolved.addr));
    }

    /** Write 16- or 32-bit value to r/m depending on operand size prefix */
    writeRMv(mod: number, rm: number, val: number): void {
        const resolved = this.resolveRM(mod, rm);
        if (this._operandSizeOverride) {
            if (resolved.isReg) {
                this.regs[resolved.addr] = (this.regs[resolved.addr] & 0xFFFF0000) | (val & 0xFFFF);
            } else {
                this.memory.write16(this.applySegmentOverride(resolved.addr), val & 0xFFFF);
            }
        } else {
            if (resolved.isReg) {
                this.regs[resolved.addr] = val >>> 0;
            } else {
                this.memory.write32(this.applySegmentOverride(resolved.addr), val >>> 0);
            }
        }
    }

    /** Fetch 16- or 32-bit immediate depending on operand size prefix */
    fetchImmediate(): number {
        return this._operandSizeOverride ? this.fetch16() : this.fetch32();
    }

    /** Fetch signed 16- or 32-bit immediate depending on operand size prefix */
    fetchSignedImmediate(): number {
        if (this._operandSizeOverride) {
            const val = this.fetch16();
            return (val & 0x8000) ? val - 0x10000 : val;
        }
        return this.fetchSigned32();
    }

    // --- Execution ---

    get repPrefix(): "REP" | "REPNE" | null {
        return this._repPrefix;
    }

    get operandSizeOverride(): boolean {
        return this._operandSizeOverride;
    }

    private skipPrefix(): void {
        // x86 prefix bytes
        // 0x26 = ES:, 0x2E = CS:, 0x36 = SS:, 0x3E = DS:, 0x64 = FS:, 0x65 = GS:
        // 0x66 = Operand size override, 0x67 = Address size override
        // 0xF0 = LOCK, 0xF2 = REPNE/REPNZ, 0xF3 = REP/REPE/REPZ
        const prefixBytes = new Set([0x26, 0x2E, 0x36, 0x3E, 0x64, 0x65, 0x66, 0x67, 0xF0, 0xF2, 0xF3]);
        while (prefixBytes.has(this.memory.read8(this.eip))) {
            const prefix = this.fetch8();
            // Track segment overrides for memory addressing
            if (prefix === 0x64) this._segmentOverride = "FS";
            else if (prefix === 0x65) this._segmentOverride = "GS";
            // Track REP/REPNE prefixes for string instructions
            else if (prefix === 0xF3) this._repPrefix = "REP";
            else if (prefix === 0xF2) this._repPrefix = "REPNE";
            // Track operand size override
            else if (prefix === 0x66) this._operandSizeOverride = true;
        }
    }

    // Circular trace buffer for debugging - stores last N instructions
    private _traceBuffer: string[] = [];
    private _traceEnabled: boolean = false;
    private _traceSize: number = 20;

    enableTrace(size: number = 20): void {
        this._traceEnabled = true;
        this._traceSize = size;
        this._traceBuffer = [];
    }

    dumpTrace(): string[] {
        return [...this._traceBuffer];
    }

    step(): void {
        try {
            this.skipPrefix();
            const instrAddr = this.eip;
            const opcode = this.fetch8();
            if (this._traceEnabled) {
                const entry = `[${this._stepCount}] EIP=0x${hex32(instrAddr)} op=0x${hex8(opcode)} ESP=0x${hex32(this.regs[REG.ESP])} EBP=0x${hex32(this.regs[REG.EBP])} EAX=0x${hex32(this.regs[REG.EAX])}`;
                this._traceBuffer.push(entry);
                if (this._traceBuffer.length > this._traceSize) {
                    this._traceBuffer.shift();
                }
            }
            const handler = this._opcodeTable.get(opcode);
            if (!handler) {
                throw new Error(`Unknown opcode: 0x${hex8(opcode)} at EIP=0x${hex32(this.eip - 1)}`);
            }
            handler(this);
            this.clearPrefixes(); // Reset after instruction
            this._stepCount++;
        } catch (error: any) {
            this.clearPrefixes(); // Reset even on error
            this.handleException(error);
        }
    }

    run(maxSteps: number = 1_000_000): void {
        this._stepCount = 0;
        while (!this.halted && this._stepCount < maxSteps) {
            this.step();
        }
        if (this._stepCount >= maxSteps) {
            console.log(`Execution limit reached (${maxSteps} steps)`);
        }
    }

    get stepCount() {
        return this._stepCount;
    }

    toString(): string {
        const regs = REG_NAMES.map((name, i) =>
            `${name}=${hex32(this.regs[i])}`
        ).join("  ");
        const flags = [
            this.getFlag(FLAG.CF) ? "CF" : "cf",
            this.getFlag(FLAG.ZF) ? "ZF" : "zf",
            this.getFlag(FLAG.SF) ? "SF" : "sf",
            this.getFlag(FLAG.OF) ? "OF" : "of",
        ].join(" ");
        return `EIP=${hex32(this.eip)}  ${regs}  [${flags}]`;
    }
}

function hex8(n: number): string {
    return n.toString(16).padStart(2, "0");
}

function hex32(n: number): string {
    return (n >>> 0).toString(16).padStart(8, "0");
}
