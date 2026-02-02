import { Memory } from "./Memory.js";
import type { KernelStructures } from "../kernel/KernelStructures.js";

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
    OF: 11,
} as const;

export class CPU {
    regs: Uint32Array;
    eip: number;
    eflags: number;
    memory: Memory;
    halted: boolean;
    kernelStructures: KernelStructures | null;
    private _opcodeTable: Map<number, OpcodeHandler>;
    private _intHandler: ((intNum: number, cpu: CPU) => void) | null;
    private _exceptionHandler: ((error: Error, cpu: CPU) => void) | null;
    private _stepCount: number;
    private _segmentOverride: "FS" | "GS" | null;

    constructor(memory: Memory) {
        this.regs = new Uint32Array(8);
        this.eip = 0;
        this.eflags = 0;
        this.memory = memory;
        this.halted = false;
        this.kernelStructures = null;
        this._opcodeTable = new Map();
        this._intHandler = null;
        this._exceptionHandler = null;
        this._stepCount = 0;
        this._segmentOverride = null;
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
                throw new Error("SIB byte not supported in MVP");
            } else {
                addr = this.regs[rm];
            }
        } else if (mod === 0b01) {
            if (rm === 4) throw new Error("SIB byte not supported in MVP");
            const base = this.regs[rm];
            const disp = this.fetchSigned8();
            addr = (base + disp) >>> 0;
        } else {
            // mod === 0b10
            if (rm === 4) throw new Error("SIB byte not supported in MVP");
            const base = this.regs[rm];
            const disp = this.fetchSigned32();
            addr = (base + disp) >>> 0;
        }

        return { isReg: false, addr };
    }

    /**
     * Apply segment override to an address if needed
     */
    private applySegmentOverride(addr: number): number {
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
     * Clear segment override after instruction execution
     */
    private clearSegmentOverride(): void {
        this._segmentOverride = null;
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

    // --- Execution ---

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
        }
    }

    step(): void {
        try {
            this.skipPrefix();
            const opcode = this.fetch8();
            const handler = this._opcodeTable.get(opcode);
            if (!handler) {
                throw new Error(`Unknown opcode: 0x${hex8(opcode)} at EIP=0x${hex32(this.eip - 1)}`);
            }
            handler(this);
            this.clearSegmentOverride(); // Reset after instruction
            this._stepCount++;
        } catch (error: any) {
            this.clearSegmentOverride(); // Reset even on error
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
