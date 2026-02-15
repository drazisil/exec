"use strict";
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
exports.CPU = exports.FLAG = exports.REG_NAMES = exports.REG = void 0;
exports.REG = {
    EAX: 0, ECX: 1, EDX: 2, EBX: 3,
    ESP: 4, EBP: 5, ESI: 6, EDI: 7,
};
exports.REG_NAMES = ["EAX", "ECX", "EDX", "EBX", "ESP", "EBP", "ESI", "EDI"];
exports.FLAG = {
    CF: 0,
    ZF: 6,
    SF: 7,
    DF: 10,
    OF: 11,
};
var CPU = /** @class */ (function () {
    function CPU(memory) {
        // Circular trace buffer for debugging - stores last N instructions
        this._traceBuffer = [];
        this._traceEnabled = false;
        this._traceSize = 20;
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
        this._repPrefix = null;
        this._operandSizeOverride = false;
        // Initialize FPU
        this.fpuStack = new Float64Array(8);
        this.fpuTop = 0;
        this.fpuStatusWord = 0;
        this.fpuControlWord = 0x037F; // Default: all exceptions masked, double precision, round-nearest
        this.fpuTagWord = 0xFFFF; // All registers empty (11 for each)
    }
    // --- FPU helpers ---
    /** Get ST(i) register value. ST(0) = fpuStack[fpuTop], ST(1) = fpuStack[(fpuTop+1)%8], etc. */
    CPU.prototype.fpuGet = function (i) {
        return this.fpuStack[(this.fpuTop + i) & 7];
    };
    /** Set ST(i) register value */
    CPU.prototype.fpuSet = function (i, val) {
        var idx = (this.fpuTop + i) & 7;
        this.fpuStack[idx] = val;
        // Mark register as valid (tag = 00)
        this.fpuTagWord &= ~(3 << (idx * 2));
    };
    /** Push a value onto the FPU stack (decrement TOP, then write to new ST(0)) */
    CPU.prototype.fpuPush = function (val) {
        this.fpuTop = (this.fpuTop - 1) & 7;
        this.fpuStack[this.fpuTop] = val;
        // Mark new ST(0) as valid
        this.fpuTagWord &= ~(3 << (this.fpuTop * 2));
        // Update status word TOP field (bits 13-11)
        this.fpuStatusWord = (this.fpuStatusWord & ~0x3800) | (this.fpuTop << 11);
    };
    /** Pop the FPU stack (mark current ST(0) as empty, increment TOP) */
    CPU.prototype.fpuPop = function () {
        var val = this.fpuStack[this.fpuTop];
        // Mark register as empty (tag = 11)
        this.fpuTagWord |= (3 << (this.fpuTop * 2));
        this.fpuTop = (this.fpuTop + 1) & 7;
        // Update status word TOP field
        this.fpuStatusWord = (this.fpuStatusWord & ~0x3800) | (this.fpuTop << 11);
        return val;
    };
    /** Set FPU condition codes C0-C3 for comparison result */
    CPU.prototype.fpuSetCC = function (c3, c2, c0) {
        this.fpuStatusWord &= ~(0x4500); // Clear C3(bit14), C2(bit10), C0(bit8)
        if (c0)
            this.fpuStatusWord |= 0x0100; // C0 = bit 8
        if (c2)
            this.fpuStatusWord |= 0x0400; // C2 = bit 10
        if (c3)
            this.fpuStatusWord |= 0x4000; // C3 = bit 14
    };
    /** Compare two FPU values and set condition codes */
    CPU.prototype.fpuCompare = function (a, b) {
        if (isNaN(a) || isNaN(b)) {
            this.fpuSetCC(true, true, true); // Unordered: C3=1, C2=1, C0=1
        }
        else if (a > b) {
            this.fpuSetCC(false, false, false); // ST(0) > src: C3=0, C2=0, C0=0
        }
        else if (a < b) {
            this.fpuSetCC(false, false, true); // ST(0) < src: C3=0, C2=0, C0=1
        }
        else {
            this.fpuSetCC(true, false, false); // Equal: C3=1, C2=0, C0=0
        }
    };
    /** Read a 64-bit double from memory */
    CPU.prototype.readDouble = function (addr) {
        var lo = this.memory.read32(addr);
        var hi = this.memory.read32(addr + 4);
        var buf = new ArrayBuffer(8);
        var view = new DataView(buf);
        view.setUint32(0, lo, true);
        view.setUint32(4, hi, true);
        return view.getFloat64(0, true);
    };
    /** Write a 64-bit double to memory */
    CPU.prototype.writeDouble = function (addr, val) {
        var buf = new ArrayBuffer(8);
        var view = new DataView(buf);
        view.setFloat64(0, val, true);
        this.memory.write32(addr, view.getUint32(0, true));
        this.memory.write32(addr + 4, view.getUint32(4, true));
    };
    /** Read a 32-bit float from memory */
    CPU.prototype.readFloat = function (addr) {
        var raw = this.memory.read32(addr);
        var buf = new ArrayBuffer(4);
        var view = new DataView(buf);
        view.setUint32(0, raw, true);
        return view.getFloat32(0, true);
    };
    /** Write a 32-bit float to memory */
    CPU.prototype.writeFloat = function (addr, val) {
        var buf = new ArrayBuffer(4);
        var view = new DataView(buf);
        view.setFloat32(0, val, true);
        this.memory.write32(addr, view.getUint32(0, true));
    };
    /**
     * Read an 8-bit register value by ModR/M register index.
     * 0=AL, 1=CL, 2=DL, 3=BL, 4=AH, 5=CH, 6=DH, 7=BH
     */
    CPU.prototype.readReg8 = function (idx) {
        if (idx < 4) {
            return this.regs[idx] & 0xFF; // AL, CL, DL, BL
        }
        return (this.regs[idx - 4] >> 8) & 0xFF; // AH, CH, DH, BH
    };
    /**
     * Write an 8-bit register value by ModR/M register index.
     * 0=AL, 1=CL, 2=DL, 3=BL, 4=AH, 5=CH, 6=DH, 7=BH
     */
    CPU.prototype.writeReg8 = function (idx, val) {
        if (idx < 4) {
            this.regs[idx] = (this.regs[idx] & 0xFFFFFF00) | (val & 0xFF);
        }
        else {
            this.regs[idx - 4] = (this.regs[idx - 4] & 0xFFFF00FF) | ((val & 0xFF) << 8);
        }
    };
    /** Read 8-bit value from r/m8 (handles register encoding correctly) */
    CPU.prototype.readRM8 = function (mod, rm) {
        if (mod === 3) {
            return this.readReg8(rm);
        }
        var resolved = this.resolveRM(mod, rm);
        return this.memory.read8(this.applySegmentOverride(resolved.addr));
    };
    /** Write 8-bit value to r/m8 (handles register encoding correctly) */
    CPU.prototype.writeRM8 = function (mod, rm, val) {
        if (mod === 3) {
            this.writeReg8(rm, val);
        }
        else {
            var resolved = this.resolveRM(mod, rm);
            this.memory.write8(this.applySegmentOverride(resolved.addr), val & 0xFF);
        }
    };
    CPU.prototype.register = function (opcode, handler) {
        this._opcodeTable.set(opcode, handler);
    };
    CPU.prototype.onInterrupt = function (handler) {
        this._intHandler = handler;
    };
    CPU.prototype.onException = function (handler) {
        this._exceptionHandler = handler;
    };
    CPU.prototype.triggerInterrupt = function (intNum) {
        if (this._intHandler) {
            this._intHandler(intNum, this);
        }
        else {
            throw new Error("Unhandled interrupt: INT ".concat(hex8(intNum)));
        }
    };
    CPU.prototype.handleException = function (error) {
        if (this._exceptionHandler) {
            this._exceptionHandler(error, this);
        }
        else {
            throw error;
        }
    };
    // --- Fetch helpers (read at EIP and advance) ---
    CPU.prototype.fetch8 = function () {
        var val = this.memory.read8(this.eip);
        this.eip = (this.eip + 1) >>> 0;
        return val;
    };
    CPU.prototype.fetch16 = function () {
        var val = this.memory.read16(this.eip);
        this.eip = (this.eip + 2) >>> 0;
        return val;
    };
    CPU.prototype.fetch32 = function () {
        var val = this.memory.read32(this.eip);
        this.eip = (this.eip + 4) >>> 0;
        return val;
    };
    CPU.prototype.fetchSigned8 = function () {
        var val = this.memory.readSigned8(this.eip);
        this.eip = (this.eip + 1) >>> 0;
        return val;
    };
    CPU.prototype.fetchSigned32 = function () {
        var val = this.memory.readSigned32(this.eip);
        this.eip = (this.eip + 4) >>> 0;
        return val;
    };
    // --- Flag helpers ---
    CPU.prototype.getFlag = function (bit) {
        return ((this.eflags >>> bit) & 1) === 1;
    };
    CPU.prototype.setFlag = function (bit, val) {
        if (val) {
            this.eflags |= (1 << bit);
        }
        else {
            this.eflags &= ~(1 << bit);
        }
    };
    CPU.prototype.updateFlagsArith = function (result, op1, op2, isSub) {
        var r32 = result >>> 0;
        var masked = r32 & 0xFFFFFFFF;
        // ZF: result is zero
        this.setFlag(exports.FLAG.ZF, masked === 0);
        // SF: sign bit
        this.setFlag(exports.FLAG.SF, (masked & 0x80000000) !== 0);
        // CF: unsigned overflow
        if (isSub) {
            this.setFlag(exports.FLAG.CF, (op1 >>> 0) < (op2 >>> 0));
        }
        else {
            this.setFlag(exports.FLAG.CF, r32 < (op1 >>> 0) || r32 < (op2 >>> 0));
        }
        // OF: signed overflow
        var signOp1 = (op1 & 0x80000000) !== 0;
        var signOp2 = (op2 & 0x80000000) !== 0;
        var signRes = (masked & 0x80000000) !== 0;
        if (isSub) {
            this.setFlag(exports.FLAG.OF, signOp1 !== signOp2 && signRes !== signOp1);
        }
        else {
            this.setFlag(exports.FLAG.OF, signOp1 === signOp2 && signRes !== signOp1);
        }
    };
    CPU.prototype.updateFlagsLogic = function (result) {
        var masked = result >>> 0;
        this.setFlag(exports.FLAG.ZF, masked === 0);
        this.setFlag(exports.FLAG.SF, (masked & 0x80000000) !== 0);
        this.setFlag(exports.FLAG.CF, false);
        this.setFlag(exports.FLAG.OF, false);
    };
    // --- Stack helpers ---
    CPU.prototype.push32 = function (val) {
        this.regs[exports.REG.ESP] = (this.regs[exports.REG.ESP] - 4) >>> 0;
        this.memory.write32(this.regs[exports.REG.ESP], val);
    };
    CPU.prototype.pop32 = function () {
        var val = this.memory.read32(this.regs[exports.REG.ESP]);
        this.regs[exports.REG.ESP] = (this.regs[exports.REG.ESP] + 4) >>> 0;
        return val;
    };
    // --- ModR/M decoding ---
    CPU.prototype.decodeModRM = function () {
        var byte = this.fetch8();
        return {
            mod: (byte >> 6) & 0x3,
            reg: (byte >> 3) & 0x7,
            rm: byte & 0x7,
        };
    };
    CPU.prototype.resolveRM = function (mod, rm) {
        if (mod === 3) {
            return { isReg: true, addr: rm };
        }
        var addr;
        if (mod === 0) {
            if (rm === 5) {
                addr = this.fetch32();
            }
            else if (rm === 4) {
                addr = this.decodeSIB(mod);
            }
            else {
                addr = this.regs[rm];
            }
        }
        else if (mod === 1) {
            if (rm === 4) {
                var sibAddr = this.decodeSIB(mod);
                var disp = this.fetchSigned8();
                addr = (sibAddr + disp) >>> 0;
            }
            else {
                var base = this.regs[rm];
                var disp = this.fetchSigned8();
                addr = (base + disp) >>> 0;
            }
        }
        else {
            // mod === 0b10
            if (rm === 4) {
                var sibAddr = this.decodeSIB(mod);
                var disp = this.fetchSigned32();
                addr = (sibAddr + disp) >>> 0;
            }
            else {
                var base = this.regs[rm];
                var disp = this.fetchSigned32();
                addr = (base + disp) >>> 0;
            }
        }
        return { isReg: false, addr: addr };
    };
    /**
     * Decode SIB (Scale-Index-Base) byte for complex addressing modes.
     * Format: [base + index * scale], where scale = 1/2/4/8
     */
    CPU.prototype.decodeSIB = function (mod) {
        var sib = this.fetch8();
        var scale = 1 << ((sib >> 6) & 0x3); // 1, 2, 4, or 8
        var index = (sib >> 3) & 0x7;
        var base = sib & 0x7;
        var addr = 0;
        // Base register (ESP=4 special case: no index)
        if (base === 5 && mod === 0) {
            // [disp32 + index*scale] - no base register
            addr = this.fetch32();
        }
        else {
            addr = this.regs[base];
        }
        // Index register (ESP=4 means no index)
        if (index !== 4) {
            addr = (addr + this.regs[index] * scale) >>> 0;
        }
        return addr;
    };
    /**
     * Apply segment override to an address if needed
     */
    CPU.prototype.applySegmentOverride = function (addr) {
        if (!this._segmentOverride || !this.kernelStructures) {
            return addr;
        }
        if (this._segmentOverride === "FS") {
            return this.kernelStructures.resolveFSRelativeAddress(addr);
        }
        else if (this._segmentOverride === "GS") {
            return this.kernelStructures.resolveGSRelativeAddress(addr);
        }
        return addr;
    };
    /**
     * Clear prefixes after instruction execution
     */
    CPU.prototype.clearPrefixes = function () {
        this._segmentOverride = null;
        this._repPrefix = null;
        this._operandSizeOverride = false;
    };
    CPU.prototype.readRM32 = function (mod, rm) {
        var resolved = this.resolveRM(mod, rm);
        if (resolved.isReg) {
            return this.regs[resolved.addr];
        }
        var addr = this.applySegmentOverride(resolved.addr);
        return this.memory.read32(addr);
    };
    CPU.prototype.writeRM32 = function (mod, rm, val) {
        var resolved = this.resolveRM(mod, rm);
        if (resolved.isReg) {
            this.regs[resolved.addr] = val >>> 0;
        }
        else {
            var addr = this.applySegmentOverride(resolved.addr);
            this.memory.write32(addr, val >>> 0);
        }
    };
    /** Read 16- or 32-bit value from r/m depending on operand size prefix */
    CPU.prototype.readRMv = function (mod, rm) {
        var resolved = this.resolveRM(mod, rm);
        if (this._operandSizeOverride) {
            if (resolved.isReg)
                return this.regs[resolved.addr] & 0xFFFF;
            return this.memory.read16(this.applySegmentOverride(resolved.addr));
        }
        if (resolved.isReg)
            return this.regs[resolved.addr];
        return this.memory.read32(this.applySegmentOverride(resolved.addr));
    };
    /** Write 16- or 32-bit value to r/m depending on operand size prefix */
    CPU.prototype.writeRMv = function (mod, rm, val) {
        var resolved = this.resolveRM(mod, rm);
        if (this._operandSizeOverride) {
            if (resolved.isReg) {
                this.regs[resolved.addr] = (this.regs[resolved.addr] & 0xFFFF0000) | (val & 0xFFFF);
            }
            else {
                this.memory.write16(this.applySegmentOverride(resolved.addr), val & 0xFFFF);
            }
        }
        else {
            if (resolved.isReg) {
                this.regs[resolved.addr] = val >>> 0;
            }
            else {
                this.memory.write32(this.applySegmentOverride(resolved.addr), val >>> 0);
            }
        }
    };
    /** Fetch 16- or 32-bit immediate depending on operand size prefix */
    CPU.prototype.fetchImmediate = function () {
        return this._operandSizeOverride ? this.fetch16() : this.fetch32();
    };
    /** Fetch signed 16- or 32-bit immediate depending on operand size prefix */
    CPU.prototype.fetchSignedImmediate = function () {
        if (this._operandSizeOverride) {
            var val = this.fetch16();
            return (val & 0x8000) ? val - 0x10000 : val;
        }
        return this.fetchSigned32();
    };
    Object.defineProperty(CPU.prototype, "repPrefix", {
        // --- Execution ---
        get: function () {
            return this._repPrefix;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(CPU.prototype, "operandSizeOverride", {
        get: function () {
            return this._operandSizeOverride;
        },
        enumerable: false,
        configurable: true
    });
    CPU.prototype.skipPrefix = function () {
        // x86 prefix bytes
        // 0x26 = ES:, 0x2E = CS:, 0x36 = SS:, 0x3E = DS:, 0x64 = FS:, 0x65 = GS:
        // 0x66 = Operand size override, 0x67 = Address size override
        // 0xF0 = LOCK, 0xF2 = REPNE/REPNZ, 0xF3 = REP/REPE/REPZ
        var prefixBytes = new Set([0x26, 0x2E, 0x36, 0x3E, 0x64, 0x65, 0x66, 0x67, 0xF0, 0xF2, 0xF3]);
        while (prefixBytes.has(this.memory.read8(this.eip))) {
            var prefix = this.fetch8();
            // Track segment overrides for memory addressing
            if (prefix === 0x64)
                this._segmentOverride = "FS";
            else if (prefix === 0x65)
                this._segmentOverride = "GS";
            // Track REP/REPNE prefixes for string instructions
            else if (prefix === 0xF3)
                this._repPrefix = "REP";
            else if (prefix === 0xF2)
                this._repPrefix = "REPNE";
            // Track operand size override
            else if (prefix === 0x66)
                this._operandSizeOverride = true;
        }
    };
    CPU.prototype.enableTrace = function (size) {
        if (size === void 0) { size = 20; }
        this._traceEnabled = true;
        this._traceSize = size;
        this._traceBuffer = [];
    };
    CPU.prototype.dumpTrace = function () {
        return __spreadArray([], this._traceBuffer, true);
    };
    CPU.prototype.step = function () {
        try {
            this.skipPrefix();
            var instrAddr = this.eip;
            var opcode = this.fetch8();
            if (this._traceEnabled) {
                var entry = "[".concat(this._stepCount, "] EIP=0x").concat(hex32(instrAddr), " op=0x").concat(hex8(opcode), " ESP=0x").concat(hex32(this.regs[exports.REG.ESP]), " EBP=0x").concat(hex32(this.regs[exports.REG.EBP]), " EAX=0x").concat(hex32(this.regs[exports.REG.EAX]));
                this._traceBuffer.push(entry);
                if (this._traceBuffer.length > this._traceSize) {
                    this._traceBuffer.shift();
                }
            }
            var handler = this._opcodeTable.get(opcode);
            if (!handler) {
                throw new Error("Unknown opcode: 0x".concat(hex8(opcode), " at EIP=0x").concat(hex32(this.eip - 1)));
            }
            handler(this);
            this.clearPrefixes(); // Reset after instruction
            this._stepCount++;
        }
        catch (error) {
            this.clearPrefixes(); // Reset even on error
            this.handleException(error);
        }
    };
    CPU.prototype.run = function (maxSteps) {
        if (maxSteps === void 0) { maxSteps = 1000000; }
        this._stepCount = 0;
        while (!this.halted && this._stepCount < maxSteps) {
            this.step();
        }
        if (this._stepCount >= maxSteps) {
            console.log("Execution limit reached (".concat(maxSteps, " steps)"));
        }
    };
    Object.defineProperty(CPU.prototype, "stepCount", {
        get: function () {
            return this._stepCount;
        },
        enumerable: false,
        configurable: true
    });
    CPU.prototype.toString = function () {
        var _this = this;
        var regs = exports.REG_NAMES.map(function (name, i) {
            return "".concat(name, "=").concat(hex32(_this.regs[i]));
        }).join("  ");
        var flags = [
            this.getFlag(exports.FLAG.CF) ? "CF" : "cf",
            this.getFlag(exports.FLAG.ZF) ? "ZF" : "zf",
            this.getFlag(exports.FLAG.SF) ? "SF" : "sf",
            this.getFlag(exports.FLAG.OF) ? "OF" : "of",
        ].join(" ");
        return "EIP=".concat(hex32(this.eip), "  ").concat(regs, "  [").concat(flags, "]");
    };
    return CPU;
}());
exports.CPU = CPU;
function hex8(n) {
    return n.toString(16).padStart(2, "0");
}
function hex32(n) {
    return (n >>> 0).toString(16).padStart(8, "0");
}
