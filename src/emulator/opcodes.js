"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAllOpcodes = registerAllOpcodes;
var CPU_ts_1 = require("../hardware/CPU.ts");
function registerAllOpcodes(cpu) {
    registerDataMovement(cpu);
    registerArithmetic(cpu);
    registerLogic(cpu);
    registerStack(cpu);
    registerControlFlow(cpu);
    registerGroup5(cpu);
    registerTwoByteOpcodes(cpu);
    registerStringOps(cpu);
    registerMisc(cpu);
    registerFPU(cpu);
}
// ============================================================
// Data Movement
// ============================================================
function registerDataMovement(cpu) {
    // MOV r/m32, r32 (or r/m16, r16 with 0x66 prefix)
    cpu.register(0x89, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        if (cpu.operandSizeOverride) {
            cpu.writeRMv(mod, rm, cpu.regs[reg] & 0xFFFF);
        }
        else {
            cpu.writeRM32(mod, rm, cpu.regs[reg]);
        }
    });
    // MOV r32, r/m32 (or r16, r/m16 with 0x66 prefix)
    cpu.register(0x8B, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        if (cpu.operandSizeOverride) {
            var val = cpu.readRMv(mod, rm);
            cpu.regs[reg] = (cpu.regs[reg] & 0xFFFF0000) | (val & 0xFFFF);
        }
        else {
            cpu.regs[reg] = cpu.readRM32(mod, rm);
        }
    });
    var _loop_1 = function (r) {
        cpu.register(0xB8 + r, function (cpu) {
            cpu.regs[r] = cpu.fetch32();
        });
    };
    // MOV r32, imm32 (0xB8 + rd)
    for (var r = 0; r < 8; r++) {
        _loop_1(r);
    }
    // MOV r/m32, imm32 (or MOV r/m16, imm16 with 0x66 prefix)
    cpu.register(0xC7, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, rm = _a.rm;
        // Must resolve the address FIRST (consuming disp8/disp32 from the instruction
        // stream) before reading the immediate value that follows.
        var resolved = cpu.resolveRM(mod, rm);
        if (cpu.operandSizeOverride) {
            var imm = cpu.fetch16();
            if (resolved.isReg) {
                cpu.regs[resolved.addr] = (cpu.regs[resolved.addr] & 0xFFFF0000) | imm;
            }
            else {
                cpu.memory.write16(cpu.applySegmentOverride(resolved.addr), imm);
            }
        }
        else {
            var imm = cpu.fetch32();
            if (resolved.isReg) {
                cpu.regs[resolved.addr] = imm >>> 0;
            }
            else {
                var addr = cpu.applySegmentOverride(resolved.addr);
                cpu.memory.write32(addr, imm >>> 0);
            }
        }
    });
    // MOV AL, [disp32] (also handles FS:/GS: segment override)
    cpu.register(0xA0, function (cpu) {
        var addr = cpu.applySegmentOverride(cpu.fetch32());
        cpu.regs[CPU_ts_1.REG.EAX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFFFF00) | cpu.memory.read8(addr);
    });
    // MOV EAX, [disp32] (also handles FS:/GS: segment override)
    cpu.register(0xA1, function (cpu) {
        var addr = cpu.applySegmentOverride(cpu.fetch32());
        cpu.regs[CPU_ts_1.REG.EAX] = cpu.memory.read32(addr);
    });
    // MOV [disp32], AL (also handles FS:/GS: segment override)
    cpu.register(0xA2, function (cpu) {
        var addr = cpu.applySegmentOverride(cpu.fetch32());
        cpu.memory.write8(addr, cpu.regs[CPU_ts_1.REG.EAX] & 0xFF);
    });
    // MOV [disp32], EAX (also handles FS:/GS: segment override)
    cpu.register(0xA3, function (cpu) {
        var addr = cpu.applySegmentOverride(cpu.fetch32());
        cpu.memory.write32(addr, cpu.regs[CPU_ts_1.REG.EAX]);
    });
    // LEA r32, [r/m32]
    cpu.register(0x8D, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var resolved = cpu.resolveRM(mod, rm);
        cpu.regs[reg] = resolved.addr;
    });
}
// ============================================================
// Arithmetic
// ============================================================
function registerArithmetic(cpu) {
    // ADD r/m8, r8
    cpu.register(0x00, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM8(mod, rm);
        var op2 = cpu.readReg8(reg);
        var result = (op1 + op2) & 0xFF;
        cpu.writeRM8(mod, rm, result);
        cpu.updateFlagsArith(op1 + op2, op1, op2, false);
    });
    // ADD r/m32, r32
    cpu.register(0x01, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM32(mod, rm);
        var op2 = cpu.regs[reg];
        var result = (op1 + op2) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsArith(op1 + op2, op1, op2, false);
    });
    // ADD r8, r/m8
    cpu.register(0x02, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readReg8(reg);
        var op2 = cpu.readRM8(mod, rm);
        var result = (op1 + op2) & 0xFF;
        cpu.writeReg8(reg, result);
        cpu.updateFlagsArith(op1 + op2, op1, op2, false);
    });
    // ADD r32, r/m32
    cpu.register(0x03, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.regs[reg];
        var op2 = cpu.readRM32(mod, rm);
        var result = (op1 + op2) >>> 0;
        cpu.regs[reg] = result;
        cpu.updateFlagsArith(op1 + op2, op1, op2, false);
    });
    // ADD AL, imm8
    cpu.register(0x04, function (cpu) {
        var imm = cpu.fetch8();
        var al = cpu.regs[CPU_ts_1.REG.EAX] & 0xFF;
        var result = (al + imm) & 0xFF;
        cpu.regs[CPU_ts_1.REG.EAX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFFFF00) | result;
        cpu.updateFlagsArith(al + imm, al, imm, false);
    });
    // ADC r/m8, r8
    cpu.register(0x10, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM8(mod, rm);
        var op2 = cpu.readReg8(reg);
        var carry = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
        var result = (op1 + op2 + carry) & 0xFF;
        cpu.writeRM8(mod, rm, result);
        cpu.updateFlagsArith(op1 + op2 + carry, op1, op2 + carry, false);
    });
    // ADC r8, r/m8
    cpu.register(0x12, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readReg8(reg);
        var op2 = cpu.readRM8(mod, rm);
        var carry = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
        var result = (op1 + op2 + carry) & 0xFF;
        cpu.writeReg8(reg, result);
        cpu.updateFlagsArith(op1 + op2 + carry, op1, op2 + carry, false);
    });
    // SBB r/m8, r8
    cpu.register(0x18, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM8(mod, rm);
        var op2 = cpu.readReg8(reg);
        var borrow = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
        var result = (op1 - op2 - borrow) & 0xFF;
        cpu.writeRM8(mod, rm, result);
        cpu.updateFlagsArith(op1 - op2 - borrow, op1, op2 + borrow, true);
    });
    // AND r8, r/m8
    cpu.register(0x22, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var result = (cpu.readReg8(reg) & cpu.readRM8(mod, rm)) & 0xFF;
        cpu.writeReg8(reg, result);
        cpu.updateFlagsLogic(result);
    });
    // SUB r/m8, r8
    cpu.register(0x28, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM8(mod, rm);
        var op2 = cpu.readReg8(reg);
        var result = (op1 - op2) & 0xFF;
        cpu.writeRM8(mod, rm, result);
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });
    // SUB r8, r/m8
    cpu.register(0x2A, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readReg8(reg);
        var op2 = cpu.readRM8(mod, rm);
        var result = (op1 - op2) & 0xFF;
        cpu.writeReg8(reg, result);
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });
    // SUB r/m32, r32
    cpu.register(0x29, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM32(mod, rm);
        var op2 = cpu.regs[reg];
        var result = (op1 - op2) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });
    // SUB r32, r/m32
    cpu.register(0x2B, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.regs[reg];
        var op2 = cpu.readRM32(mod, rm);
        var result = (op1 - op2) >>> 0;
        cpu.regs[reg] = result;
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });
    // SBB r8, r/m8 (subtract with borrow, byte)
    cpu.register(0x1A, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readReg8(reg);
        var op2 = cpu.readRM8(mod, rm);
        var borrow = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
        var result = (op1 - op2 - borrow) & 0xFF;
        cpu.writeReg8(reg, result);
        cpu.updateFlagsArith(op1 - op2 - borrow, op1, op2 + borrow, true);
    });
    // SBB r/m32, r32 (subtract with borrow)
    cpu.register(0x19, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM32(mod, rm);
        var op2 = cpu.regs[reg];
        var borrow = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
        var result = (op1 - op2 - borrow) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsArith(op1 - op2 - borrow, op1, op2 + borrow, true);
    });
    // SBB r32, r/m32 (subtract with borrow)
    cpu.register(0x1B, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.regs[reg];
        var op2 = cpu.readRM32(mod, rm);
        var borrow = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
        var result = (op1 - op2 - borrow) >>> 0;
        cpu.regs[reg] = result;
        cpu.updateFlagsArith(op1 - op2 - borrow, op1, op2 + borrow, true);
    });
    // ADC r/m32, r32 (add with carry)
    cpu.register(0x11, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM32(mod, rm);
        var op2 = cpu.regs[reg];
        var carry = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
        var result = (op1 + op2 + carry) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsArith(op1 + op2 + carry, op1, op2 + carry, false);
    });
    // ADC r32, r/m32 (add with carry)
    cpu.register(0x13, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.regs[reg];
        var op2 = cpu.readRM32(mod, rm);
        var carry = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
        var result = (op1 + op2 + carry) >>> 0;
        cpu.regs[reg] = result;
        cpu.updateFlagsArith(op1 + op2 + carry, op1, op2 + carry, false);
    });
    // CMP r/m32, r32
    cpu.register(0x39, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM32(mod, rm);
        var op2 = cpu.regs[reg];
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });
    // CMP r32, r/m32
    cpu.register(0x3B, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.regs[reg];
        var op2 = cpu.readRM32(mod, rm);
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });
    // Group 1: 0x81 — op r/m32, imm32
    cpu.register(0x81, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM32(mod, rm);
        var imm = cpu.fetch32();
        doGroup1(cpu, mod, rm, reg, op1, imm);
    });
    // Group 1: 0x83 — op r/m32, imm8 (sign-extended)
    cpu.register(0x83, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM32(mod, rm);
        var imm = (cpu.fetchSigned8() & 0xFFFFFFFF) >>> 0;
        doGroup1(cpu, mod, rm, reg, op1, imm);
    });
    var _loop_2 = function (r) {
        cpu.register(0x40 + r, function (cpu) {
            var op1 = cpu.regs[r];
            var result = (op1 + 1) >>> 0;
            cpu.regs[r] = result;
            // INC does not affect CF
            var savedCF = cpu.getFlag(CPU_ts_1.FLAG.CF);
            cpu.updateFlagsArith(op1 + 1, op1, 1, false);
            cpu.setFlag(CPU_ts_1.FLAG.CF, savedCF);
        });
    };
    // INC r32 (0x40 + rd)
    for (var r = 0; r < 8; r++) {
        _loop_2(r);
    }
    var _loop_3 = function (r) {
        cpu.register(0x48 + r, function (cpu) {
            var op1 = cpu.regs[r];
            var result = (op1 - 1) >>> 0;
            cpu.regs[r] = result;
            // DEC does not affect CF
            var savedCF = cpu.getFlag(CPU_ts_1.FLAG.CF);
            cpu.updateFlagsArith(op1 - 1, op1, 1, true);
            cpu.setFlag(CPU_ts_1.FLAG.CF, savedCF);
        });
    };
    // DEC r32 (0x48 + rd)
    for (var r = 0; r < 8; r++) {
        _loop_3(r);
    }
    // Group 2: 0xC1 — op r/m32, imm8 (shift/rotate)
    cpu.register(0xC1, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var val = cpu.readRM32(mod, rm);
        var count = cpu.fetch8() & 0x1F; // Only lower 5 bits used for 32-bit
        doGroup2(cpu, mod, rm, reg, val, count);
    });
    // Group 2: 0xD1 — op r/m32, 1 (shift/rotate by 1)
    cpu.register(0xD1, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var val = cpu.readRM32(mod, rm);
        doGroup2(cpu, mod, rm, reg, val, 1);
    });
    // Group 2: 0xD3 — op r/m32, CL (shift/rotate by CL)
    cpu.register(0xD3, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var val = cpu.readRM32(mod, rm);
        var count = cpu.regs[CPU_ts_1.REG.ECX] & 0x1F;
        doGroup2(cpu, mod, rm, reg, val, count);
    });
    // IMUL r32, r/m32, imm8 (three-operand signed multiply)
    cpu.register(0x6B, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM32(mod, rm) | 0;
        var imm = cpu.fetchSigned8();
        var result = Math.imul(op1, imm);
        cpu.regs[reg] = result >>> 0;
        var full = BigInt(op1) * BigInt(imm);
        var overflow = full !== BigInt(result);
        cpu.setFlag(CPU_ts_1.FLAG.CF, overflow);
        cpu.setFlag(CPU_ts_1.FLAG.OF, overflow);
    });
    // IMUL r32, r/m32, imm32 (three-operand signed multiply)
    cpu.register(0x69, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM32(mod, rm) | 0;
        var imm = cpu.fetchSigned32();
        var result = Math.imul(op1, imm);
        cpu.regs[reg] = result >>> 0;
        var full = BigInt(op1) * BigInt(imm);
        var overflow = full !== BigInt(result);
        cpu.setFlag(CPU_ts_1.FLAG.CF, overflow);
        cpu.setFlag(CPU_ts_1.FLAG.OF, overflow);
    });
    // NEG r/m32 (Group 3, 0xF7 /3) - handled in Group 3 below
    // Group 3: 0xF7 — op r/m32
    cpu.register(0xF7, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        switch (reg) {
            case 0: { // TEST r/m32, imm32
                var op1 = cpu.readRM32(mod, rm);
                var imm = cpu.fetch32();
                cpu.updateFlagsLogic((op1 & imm) >>> 0);
                break;
            }
            case 2: { // NOT r/m32
                var val = cpu.readRM32(mod, rm);
                cpu.writeRM32(mod, rm, (~val) >>> 0);
                break;
            }
            case 3: { // NEG r/m32
                var val = cpu.readRM32(mod, rm);
                var result = (0 - val) >>> 0;
                cpu.writeRM32(mod, rm, result);
                cpu.setFlag(CPU_ts_1.FLAG.CF, val !== 0);
                cpu.updateFlagsArith(0 - val, 0, val, true);
                break;
            }
            case 4: { // MUL r/m32 (unsigned EAX * r/m32 -> EDX:EAX)
                var op1 = cpu.regs[CPU_ts_1.REG.EAX] >>> 0;
                var op2 = cpu.readRM32(mod, rm) >>> 0;
                var result = BigInt(op1) * BigInt(op2);
                cpu.regs[CPU_ts_1.REG.EAX] = Number(result & 0xffffffffn) >>> 0;
                cpu.regs[CPU_ts_1.REG.EDX] = Number((result >> 32n) & 0xffffffffn) >>> 0;
                var overflow = cpu.regs[CPU_ts_1.REG.EDX] !== 0;
                cpu.setFlag(CPU_ts_1.FLAG.CF, overflow);
                cpu.setFlag(CPU_ts_1.FLAG.OF, overflow);
                break;
            }
            case 5: { // IMUL r/m32 (signed EAX * r/m32 -> EDX:EAX)
                var op1 = cpu.regs[CPU_ts_1.REG.EAX] | 0;
                var op2 = cpu.readRM32(mod, rm) | 0;
                var result = BigInt(op1) * BigInt(op2);
                cpu.regs[CPU_ts_1.REG.EAX] = Number(result & 0xffffffffn) >>> 0;
                cpu.regs[CPU_ts_1.REG.EDX] = Number((result >> 32n) & 0xffffffffn) >>> 0;
                // OF/CF set if EDX is not sign extension of EAX
                var signExt = (cpu.regs[CPU_ts_1.REG.EAX] & 0x80000000) ? 0xFFFFFFFF : 0;
                cpu.setFlag(CPU_ts_1.FLAG.CF, cpu.regs[CPU_ts_1.REG.EDX] !== signExt);
                cpu.setFlag(CPU_ts_1.FLAG.OF, cpu.regs[CPU_ts_1.REG.EDX] !== signExt);
                break;
            }
            case 6: { // DIV r/m32 (unsigned EDX:EAX / r/m32 -> EAX=quot, EDX=rem)
                var divisor = cpu.readRM32(mod, rm) >>> 0;
                if (divisor === 0)
                    throw new Error("Division by zero");
                var dividend = (BigInt(cpu.regs[CPU_ts_1.REG.EDX] >>> 0) << 32n) | BigInt(cpu.regs[CPU_ts_1.REG.EAX] >>> 0);
                var quotient = dividend / BigInt(divisor);
                var remainder = dividend % BigInt(divisor);
                if (quotient > 0xffffffffn)
                    throw new Error("Division overflow");
                cpu.regs[CPU_ts_1.REG.EAX] = Number(quotient) >>> 0;
                cpu.regs[CPU_ts_1.REG.EDX] = Number(remainder) >>> 0;
                break;
            }
            case 7: { // IDIV r/m32 (signed EDX:EAX / r/m32)
                var divisor = cpu.readRM32(mod, rm) | 0;
                if (divisor === 0)
                    throw new Error("Division by zero");
                var dividend = (BigInt(cpu.regs[CPU_ts_1.REG.EDX] | 0) << 32n) | BigInt(cpu.regs[CPU_ts_1.REG.EAX] >>> 0);
                var quotient = dividend / BigInt(divisor);
                var remainder = dividend % BigInt(divisor);
                cpu.regs[CPU_ts_1.REG.EAX] = Number(quotient & 0xffffffffn) >>> 0;
                cpu.regs[CPU_ts_1.REG.EDX] = Number(remainder & 0xffffffffn) >>> 0;
                break;
            }
            default:
                throw new Error("Unsupported Group 3 extension: /".concat(reg));
        }
    });
    // Group 3 byte: 0xF6 — op r/m8
    cpu.register(0xF6, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var val = cpu.readRM8(mod, rm);
        switch (reg) {
            case 0: { // TEST r/m8, imm8
                var imm = cpu.fetch8();
                cpu.updateFlagsLogic((val & imm) & 0xFF);
                break;
            }
            case 2: { // NOT r/m8
                cpu.writeRM8(mod, rm, (~val) & 0xFF);
                break;
            }
            case 3: { // NEG r/m8
                var result = (0 - val) & 0xFF;
                cpu.writeRM8(mod, rm, result);
                cpu.setFlag(CPU_ts_1.FLAG.CF, val !== 0);
                cpu.updateFlagsArith(0 - val, 0, val, true);
                break;
            }
            case 4: { // MUL AL, r/m8 (AX = AL * r/m8)
                var al = cpu.regs[CPU_ts_1.REG.EAX] & 0xFF;
                var result = al * val;
                cpu.regs[CPU_ts_1.REG.EAX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFF0000) | (result & 0xFFFF);
                cpu.setFlag(CPU_ts_1.FLAG.CF, (result & 0xFF00) !== 0);
                cpu.setFlag(CPU_ts_1.FLAG.OF, (result & 0xFF00) !== 0);
                break;
            }
            case 5: { // IMUL AL, r/m8 (signed: AX = AL * r/m8)
                var al = (cpu.regs[CPU_ts_1.REG.EAX] << 24) >> 24; // sign-extend AL
                var sval = (val << 24) >> 24; // sign-extend operand
                var result = al * sval;
                cpu.regs[CPU_ts_1.REG.EAX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFF0000) | (result & 0xFFFF);
                var signExt = ((result & 0xFF) << 24) >> 24;
                cpu.setFlag(CPU_ts_1.FLAG.CF, result !== signExt);
                cpu.setFlag(CPU_ts_1.FLAG.OF, result !== signExt);
                break;
            }
            case 6: { // DIV AL, r/m8 (AX / r/m8 -> AL=quot, AH=rem)
                if (val === 0)
                    throw new Error("Division by zero (byte)");
                var ax = cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFF;
                var quot = Math.trunc(ax / val) & 0xFF;
                var rem = (ax % val) & 0xFF;
                cpu.regs[CPU_ts_1.REG.EAX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFF0000) | (rem << 8) | quot;
                break;
            }
            case 7: { // IDIV AL, r/m8 (signed)
                var sval8 = (val << 24) >> 24;
                if (sval8 === 0)
                    throw new Error("Division by zero (signed byte)");
                var ax = (cpu.regs[CPU_ts_1.REG.EAX] << 16) >> 16; // sign-extend AX
                var quot = Math.trunc(ax / sval8) & 0xFF;
                var rem = (ax % sval8) & 0xFF;
                cpu.regs[CPU_ts_1.REG.EAX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFF0000) | (rem << 8) | quot;
                break;
            }
            default:
                throw new Error("Unsupported Group 3 byte extension: /".concat(reg));
        }
    });
    // CDQ (sign-extend EAX into EDX:EAX)
    cpu.register(0x99, function (cpu) {
        cpu.regs[CPU_ts_1.REG.EDX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0x80000000) ? 0xFFFFFFFF : 0;
    });
    // XCHG r8, r/m8
    cpu.register(0x86, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var val1 = cpu.readReg8(reg);
        var val2 = cpu.readRM8(mod, rm);
        cpu.writeReg8(reg, val2);
        cpu.writeRM8(mod, rm, val1);
    });
    // XCHG r32, r/m32
    cpu.register(0x87, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var val1 = cpu.regs[reg];
        var val2 = cpu.readRM32(mod, rm);
        cpu.regs[reg] = val2;
        cpu.writeRM32(mod, rm, val1);
    });
    var _loop_4 = function (r) {
        cpu.register(0x90 + r, function (cpu) {
            var tmp = cpu.regs[CPU_ts_1.REG.EAX];
            cpu.regs[CPU_ts_1.REG.EAX] = cpu.regs[r];
            cpu.regs[r] = tmp;
        });
    };
    // XCHG EAX, r32 (0x90+r, but 0x90 is NOP which is XCHG EAX, EAX)
    // Already have NOP at 0x90, add 0x91-0x97
    for (var r = 1; r < 8; r++) {
        _loop_4(r);
    }
    // MOV r/m8, r8
    cpu.register(0x88, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var val = cpu.readReg8(reg);
        cpu.writeRM8(mod, rm, val);
    });
    // MOV r8, r/m8
    cpu.register(0x8A, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var val = cpu.readRM8(mod, rm);
        cpu.writeReg8(reg, val);
    });
    var _loop_5 = function (r) {
        cpu.register(0xB0 + r, function (cpu) {
            var imm = cpu.fetch8();
            // Low registers: AL=0, CL=1, DL=2, BL=3; High: AH=4, CH=5, DH=6, BH=7
            if (r < 4) {
                cpu.regs[r] = (cpu.regs[r] & 0xFFFFFF00) | imm;
            }
            else {
                cpu.regs[r - 4] = (cpu.regs[r - 4] & 0xFFFF00FF) | (imm << 8);
            }
        });
    };
    // MOV r8, imm8 (0xB0 + rb)
    for (var r = 0; r < 8; r++) {
        _loop_5(r);
    }
    // MOV r/m8, imm8 (0xC6 /0)
    cpu.register(0xC6, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, rm = _a.rm;
        // Must resolve address FIRST (consuming disp8/disp32) before reading immediate
        var resolved = cpu.resolveRM(mod, rm);
        var imm = cpu.fetch8();
        if (resolved.isReg) {
            cpu.regs[resolved.addr] = (cpu.regs[resolved.addr] & 0xFFFFFF00) | imm;
        }
        else {
            cpu.memory.write8(cpu.applySegmentOverride(resolved.addr), imm);
        }
    });
    // Group 1 byte: 0x80 — op r/m8, imm8
    cpu.register(0x80, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM8(mod, rm);
        var imm = cpu.fetch8();
        var result;
        switch (reg) {
            case 0: // ADD
                result = (op1 + imm) & 0xFF;
                cpu.writeRM8(mod, rm, result);
                cpu.updateFlagsArith(op1 + imm, op1, imm, false);
                break;
            case 1: // OR
                result = (op1 | imm) & 0xFF;
                cpu.writeRM8(mod, rm, result);
                cpu.updateFlagsLogic(result);
                break;
            case 2: { // ADC
                var carry = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
                result = (op1 + imm + carry) & 0xFF;
                cpu.writeRM8(mod, rm, result);
                cpu.updateFlagsArith(op1 + imm + carry, op1, imm + carry, false);
                break;
            }
            case 3: { // SBB
                var borrow = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
                result = (op1 - imm - borrow) & 0xFF;
                cpu.writeRM8(mod, rm, result);
                cpu.updateFlagsArith(op1 - imm - borrow, op1, imm + borrow, true);
                break;
            }
            case 4: // AND
                result = (op1 & imm) & 0xFF;
                cpu.writeRM8(mod, rm, result);
                cpu.updateFlagsLogic(result);
                break;
            case 5: // SUB
                result = (op1 - imm) & 0xFF;
                cpu.writeRM8(mod, rm, result);
                cpu.updateFlagsArith(op1 - imm, op1, imm, true);
                break;
            case 6: // XOR
                result = (op1 ^ imm) & 0xFF;
                cpu.writeRM8(mod, rm, result);
                cpu.updateFlagsLogic(result);
                break;
            case 7: // CMP
                cpu.updateFlagsArith(op1 - imm, op1, imm, true);
                break;
        }
    });
    // RET imm16 (return and pop imm16 bytes from stack)
    cpu.register(0xC2, function (cpu) {
        var retAddr = cpu.pop32();
        var imm = cpu.fetch16();
        cpu.regs[CPU_ts_1.REG.ESP] = (cpu.regs[CPU_ts_1.REG.ESP] + imm) >>> 0;
        cpu.eip = retAddr;
    });
    // LEAVE (equivalent to MOV ESP, EBP; POP EBP)
    cpu.register(0xC9, function (cpu) {
        cpu.regs[CPU_ts_1.REG.ESP] = cpu.regs[CPU_ts_1.REG.EBP];
        cpu.regs[CPU_ts_1.REG.EBP] = cpu.pop32();
    });
    // CALL rel32 is already registered
    // CALL r/m32 is in Group 5
    // TEST EAX, imm32
    cpu.register(0xA9, function (cpu) {
        var imm = cpu.fetch32();
        cpu.updateFlagsLogic((cpu.regs[CPU_ts_1.REG.EAX] & imm) >>> 0);
    });
    // TEST AL, imm8
    cpu.register(0xA8, function (cpu) {
        var imm = cpu.fetch8();
        cpu.updateFlagsLogic((cpu.regs[CPU_ts_1.REG.EAX] & imm) & 0xFF);
    });
    // CMP r/m8, r8
    cpu.register(0x38, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readRM8(mod, rm);
        var op2 = cpu.readReg8(reg);
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });
    // CMP r8, r/m8
    cpu.register(0x3A, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var op1 = cpu.readReg8(reg);
        var op2 = cpu.readRM8(mod, rm);
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });
}
function doGroup1(cpu, mod, rm, opExt, op1, op2) {
    switch (opExt) {
        case 0: { // ADD
            var result = (op1 + op2) >>> 0;
            cpu.writeRM32(mod, rm, result);
            cpu.updateFlagsArith(op1 + op2, op1, op2, false);
            break;
        }
        case 1: { // OR
            var result = (op1 | op2) >>> 0;
            cpu.writeRM32(mod, rm, result);
            cpu.updateFlagsLogic(result);
            break;
        }
        case 2: { // ADC (add with carry)
            var carry = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
            var result = (op1 + op2 + carry) >>> 0;
            cpu.writeRM32(mod, rm, result);
            cpu.updateFlagsArith(op1 + op2 + carry, op1, op2 + carry, false);
            break;
        }
        case 3: { // SBB (subtract with borrow)
            var borrow = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
            var result = (op1 - op2 - borrow) >>> 0;
            cpu.writeRM32(mod, rm, result);
            cpu.updateFlagsArith(op1 - op2 - borrow, op1, op2 + borrow, true);
            break;
        }
        case 4: { // AND
            var result = (op1 & op2) >>> 0;
            cpu.writeRM32(mod, rm, result);
            cpu.updateFlagsLogic(result);
            break;
        }
        case 5: { // SUB
            var result = (op1 - op2) >>> 0;
            cpu.writeRM32(mod, rm, result);
            cpu.updateFlagsArith(op1 - op2, op1, op2, true);
            break;
        }
        case 6: { // XOR
            var result = (op1 ^ op2) >>> 0;
            cpu.writeRM32(mod, rm, result);
            cpu.updateFlagsLogic(result);
            break;
        }
        case 7: { // CMP
            cpu.updateFlagsArith(op1 - op2, op1, op2, true);
            break;
        }
        default:
            throw new Error("Unsupported Group 1 extension: /".concat(opExt));
    }
}
function doGroup2(cpu, mod, rm, opExt, val, count) {
    if (count === 0) {
        // No shift, but still write back the value and return early
        cpu.writeRM32(mod, rm, val);
        return;
    }
    var result;
    var newCF = false;
    switch (opExt) {
        case 0: { // ROL (rotate left)
            result = ((val << count) | (val >>> (32 - count))) >>> 0;
            newCF = (result & 1) !== 0;
            cpu.writeRM32(mod, rm, result);
            cpu.setFlag(CPU_ts_1.FLAG.CF, newCF);
            // OF set if bit 31 changed
            if (count === 1) {
                var msb = (result & 0x80000000) !== 0;
                var ofVal = msb !== (((result >>> 1) & 0x40000000) !== 0);
                cpu.setFlag(CPU_ts_1.FLAG.OF, ofVal);
            }
            break;
        }
        case 1: { // ROR (rotate right)
            result = ((val >>> count) | (val << (32 - count))) >>> 0;
            newCF = (result & 0x80000000) !== 0;
            cpu.writeRM32(mod, rm, result);
            cpu.setFlag(CPU_ts_1.FLAG.CF, newCF);
            // OF set if bit 31 changed
            if (count === 1) {
                var msb = (result & 0x80000000) !== 0;
                var ofVal = msb !== (((val >>> 31) & 1) !== 0);
                cpu.setFlag(CPU_ts_1.FLAG.OF, ofVal);
            }
            break;
        }
        case 2: { // RCL (rotate through carry left)
            // Complex: carry is part of rotation
            var temp = ((val << count) >>> 0);
            if (cpu.getFlag(CPU_ts_1.FLAG.CF)) {
                temp |= (1 << (count - 1));
            }
            newCF = (val >>> (32 - count)) & 1 ? true : false;
            result = temp;
            cpu.writeRM32(mod, rm, result);
            cpu.setFlag(CPU_ts_1.FLAG.CF, newCF);
            break;
        }
        case 3: { // RCR (rotate through carry right)
            // Complex: carry is part of rotation
            var temp = (val >>> count);
            if (cpu.getFlag(CPU_ts_1.FLAG.CF)) {
                temp |= (1 << (32 - count));
            }
            newCF = (val >>> (count - 1)) & 1 ? true : false;
            result = (temp >>> 0);
            cpu.writeRM32(mod, rm, result);
            cpu.setFlag(CPU_ts_1.FLAG.CF, newCF);
            break;
        }
        case 4: { // SHL/SAL (shift left)
            result = ((val << count) >>> 0);
            newCF = (val >>> (32 - count)) & 1 ? true : false;
            cpu.writeRM32(mod, rm, result);
            cpu.setFlag(CPU_ts_1.FLAG.CF, newCF);
            cpu.updateFlagsLogic(result); // Sets ZF, SF, OF for logical operations
            break;
        }
        case 5: { // SHR (shift right logical)
            result = (val >>> count);
            newCF = (val >>> (count - 1)) & 1 ? true : false;
            cpu.writeRM32(mod, rm, result);
            cpu.setFlag(CPU_ts_1.FLAG.CF, newCF);
            cpu.updateFlagsLogic(result);
            break;
        }
        case 7: { // SAR (shift right arithmetic / sign-extend)
            var sign = (val & 0x80000000) ? -1 : 0;
            result = (sign << (32 - count)) | (val >> count);
            newCF = (val >>> (count - 1)) & 1 ? true : false;
            cpu.writeRM32(mod, rm, result >>> 0);
            cpu.setFlag(CPU_ts_1.FLAG.CF, newCF);
            cpu.updateFlagsLogic(result >>> 0);
            break;
        }
        default:
            throw new Error("Unsupported Group 2 extension: /".concat(opExt));
    }
}
// ============================================================
// Logic
// ============================================================
function registerLogic(cpu) {
    // OR r/m8, r8
    cpu.register(0x08, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var val1 = cpu.readRM8(mod, rm);
        var val2 = cpu.readReg8(reg);
        var result = (val1 | val2) & 0xFF;
        cpu.writeRM8(mod, rm, result);
        cpu.updateFlagsLogic(result);
    });
    // OR r8, r/m8
    cpu.register(0x0A, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var val1 = cpu.readReg8(reg);
        var val2 = cpu.readRM8(mod, rm);
        var result = (val1 | val2) & 0xFF;
        cpu.writeReg8(reg, result);
        cpu.updateFlagsLogic(result);
    });
    // AND r/m8, r8
    cpu.register(0x20, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var val1 = cpu.readRM8(mod, rm);
        var val2 = cpu.readReg8(reg);
        var result = (val1 & val2) & 0xFF;
        cpu.writeRM8(mod, rm, result);
        cpu.updateFlagsLogic(result);
    });
    // AND r32, r/m32
    cpu.register(0x21, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var result = (cpu.readRM32(mod, rm) & cpu.regs[reg]) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsLogic(result);
    });
    // AND r32, r/m32
    cpu.register(0x23, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var result = (cpu.regs[reg] & cpu.readRM32(mod, rm)) >>> 0;
        cpu.regs[reg] = result;
        cpu.updateFlagsLogic(result);
    });
    // OR r/m32, r32
    cpu.register(0x09, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var result = (cpu.readRM32(mod, rm) | cpu.regs[reg]) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsLogic(result);
    });
    // OR r32, r/m32
    cpu.register(0x0B, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var result = (cpu.regs[reg] | cpu.readRM32(mod, rm)) >>> 0;
        cpu.regs[reg] = result;
        cpu.updateFlagsLogic(result);
    });
    // XOR r/m8, r8
    cpu.register(0x30, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var result = (cpu.readRM8(mod, rm) ^ cpu.readReg8(reg)) & 0xFF;
        cpu.writeRM8(mod, rm, result);
        cpu.updateFlagsLogic(result);
    });
    // XOR r/m32, r32
    cpu.register(0x31, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var result = (cpu.readRM32(mod, rm) ^ cpu.regs[reg]) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsLogic(result);
    });
    // XOR r8, r/m8
    cpu.register(0x32, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var result = (cpu.readReg8(reg) ^ cpu.readRM8(mod, rm)) & 0xFF;
        cpu.writeReg8(reg, result);
        cpu.updateFlagsLogic(result);
    });
    // XOR r32, r/m32
    cpu.register(0x33, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var result = (cpu.regs[reg] ^ cpu.readRM32(mod, rm)) >>> 0;
        cpu.regs[reg] = result;
        cpu.updateFlagsLogic(result);
    });
    // TEST r/m8, r8
    cpu.register(0x84, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var result = (cpu.readRM8(mod, rm) & cpu.readReg8(reg)) & 0xFF;
        cpu.updateFlagsLogic(result);
    });
    // TEST r/m32, r32
    cpu.register(0x85, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var result = (cpu.readRM32(mod, rm) & cpu.regs[reg]) >>> 0;
        cpu.updateFlagsLogic(result);
    });
    // Accumulator immediate operations (no ModR/M)
    // 0x05: ADD EAX, imm32
    cpu.register(0x05, function (cpu) {
        var imm = cpu.fetch32();
        var result = (cpu.regs[CPU_ts_1.REG.EAX] + imm) >>> 0;
        cpu.updateFlagsArith(cpu.regs[CPU_ts_1.REG.EAX] + imm, cpu.regs[CPU_ts_1.REG.EAX], imm, false);
        cpu.regs[CPU_ts_1.REG.EAX] = result;
    });
    // 0x0C: OR AL, imm8
    cpu.register(0x0C, function (cpu) {
        var imm = cpu.fetch8();
        var al = cpu.regs[CPU_ts_1.REG.EAX] & 0xFF;
        var result = al | imm;
        cpu.regs[CPU_ts_1.REG.EAX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFFFF00) | result;
        cpu.updateFlagsLogic(result);
    });
    // 0x24: AND AL, imm8
    cpu.register(0x24, function (cpu) {
        var imm = cpu.fetch8();
        var al = cpu.regs[CPU_ts_1.REG.EAX] & 0xFF;
        var result = al & imm;
        cpu.regs[CPU_ts_1.REG.EAX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFFFF00) | result;
        cpu.updateFlagsLogic(result);
    });
    // 0x0D: OR EAX, imm32
    cpu.register(0x0D, function (cpu) {
        var imm = cpu.fetch32();
        var result = (cpu.regs[CPU_ts_1.REG.EAX] | imm) >>> 0;
        cpu.updateFlagsLogic(result);
        cpu.regs[CPU_ts_1.REG.EAX] = result;
    });
    // 0x15: ADC EAX, imm32 (add with carry)
    cpu.register(0x15, function (cpu) {
        var imm = cpu.fetch32();
        var carry = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
        var result = (cpu.regs[CPU_ts_1.REG.EAX] + imm + carry) >>> 0;
        cpu.updateFlagsArith(cpu.regs[CPU_ts_1.REG.EAX] + imm + carry, cpu.regs[CPU_ts_1.REG.EAX], imm + carry, false);
        cpu.regs[CPU_ts_1.REG.EAX] = result;
    });
    // 0x14: ADC AL, imm8
    cpu.register(0x14, function (cpu) {
        var imm = cpu.fetch8();
        var al = cpu.regs[CPU_ts_1.REG.EAX] & 0xFF;
        var carry = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
        var result = (al + imm + carry) & 0xFF;
        cpu.regs[CPU_ts_1.REG.EAX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFFFF00) | result;
        cpu.updateFlagsArith(al + imm + carry, al, imm + carry, false);
    });
    // 0x1C: SBB AL, imm8
    cpu.register(0x1C, function (cpu) {
        var imm = cpu.fetch8();
        var al = cpu.regs[CPU_ts_1.REG.EAX] & 0xFF;
        var borrow = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
        var result = (al - imm - borrow) & 0xFF;
        cpu.regs[CPU_ts_1.REG.EAX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFFFF00) | result;
        cpu.updateFlagsArith(al - imm - borrow, al, imm + borrow, true);
    });
    // 0x1D: SBB EAX, imm32 (subtract with borrow)
    cpu.register(0x1D, function (cpu) {
        var imm = cpu.fetch32();
        var borrow = cpu.getFlag(CPU_ts_1.FLAG.CF) ? 1 : 0;
        var result = (cpu.regs[CPU_ts_1.REG.EAX] - imm - borrow) >>> 0;
        cpu.updateFlagsArith(cpu.regs[CPU_ts_1.REG.EAX] - imm - borrow, cpu.regs[CPU_ts_1.REG.EAX], imm + borrow, true);
        cpu.regs[CPU_ts_1.REG.EAX] = result;
    });
    // 0x25: AND EAX, imm32
    cpu.register(0x25, function (cpu) {
        var imm = cpu.fetch32();
        var result = (cpu.regs[CPU_ts_1.REG.EAX] & imm) >>> 0;
        cpu.updateFlagsLogic(result);
        cpu.regs[CPU_ts_1.REG.EAX] = result;
    });
    // 0x2C: SUB AL, imm8
    cpu.register(0x2C, function (cpu) {
        var imm = cpu.fetch8();
        var al = cpu.regs[CPU_ts_1.REG.EAX] & 0xFF;
        var result = (al - imm) & 0xFF;
        cpu.regs[CPU_ts_1.REG.EAX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFFFF00) | result;
        cpu.updateFlagsArith(al - imm, al, imm, true);
    });
    // 0x2D: SUB EAX, imm32
    cpu.register(0x2D, function (cpu) {
        var imm = cpu.fetch32();
        var result = (cpu.regs[CPU_ts_1.REG.EAX] - imm) >>> 0;
        cpu.updateFlagsArith(cpu.regs[CPU_ts_1.REG.EAX] - imm, cpu.regs[CPU_ts_1.REG.EAX], imm, true);
        cpu.regs[CPU_ts_1.REG.EAX] = result;
    });
    // 0x35: XOR EAX, imm32
    cpu.register(0x35, function (cpu) {
        var imm = cpu.fetch32();
        var result = (cpu.regs[CPU_ts_1.REG.EAX] ^ imm) >>> 0;
        cpu.updateFlagsLogic(result);
        cpu.regs[CPU_ts_1.REG.EAX] = result;
    });
    // 0x3C: CMP AL, imm8
    cpu.register(0x3C, function (cpu) {
        var imm = cpu.fetch8();
        var al = cpu.regs[CPU_ts_1.REG.EAX] & 0xFF;
        cpu.updateFlagsArith(al - imm, al, imm, true);
    });
    // 0x3D: CMP EAX, imm32
    cpu.register(0x3D, function (cpu) {
        var imm = cpu.fetch32();
        cpu.updateFlagsArith(cpu.regs[CPU_ts_1.REG.EAX] - imm, cpu.regs[CPU_ts_1.REG.EAX], imm, true);
    });
}
// ============================================================
// Stack
// ============================================================
function registerStack(cpu) {
    var _loop_6 = function (r) {
        cpu.register(0x50 + r, function (cpu) {
            cpu.push32(cpu.regs[r]);
        });
    };
    // PUSH r32 (0x50 + rd)
    for (var r = 0; r < 8; r++) {
        _loop_6(r);
    }
    var _loop_7 = function (r) {
        cpu.register(0x58 + r, function (cpu) {
            cpu.regs[r] = cpu.pop32();
        });
    };
    // POP r32 (0x58 + rd)
    for (var r = 0; r < 8; r++) {
        _loop_7(r);
    }
    // PUSH imm32
    cpu.register(0x68, function (cpu) {
        cpu.push32(cpu.fetch32());
    });
    // PUSH imm8 (sign-extended)
    cpu.register(0x6A, function (cpu) {
        var imm = cpu.fetchSigned8();
        cpu.push32(imm >>> 0);
    });
}
// ============================================================
// Control Flow
// ============================================================
function registerControlFlow(cpu) {
    // CALL rel32
    cpu.register(0xE8, function (cpu) {
        var rel = cpu.fetchSigned32();
        var target = (cpu.eip + rel) >>> 0;
        cpu.push32(cpu.eip);
        cpu.eip = target;
    });
    // RET
    cpu.register(0xC3, function (cpu) {
        cpu.eip = cpu.pop32();
    });
    // JMP rel32
    cpu.register(0xE9, function (cpu) {
        var rel = cpu.fetchSigned32();
        cpu.eip = (cpu.eip + rel) >>> 0;
    });
    // JMP rel8
    cpu.register(0xEB, function (cpu) {
        var rel = cpu.fetchSigned8();
        cpu.eip = (cpu.eip + rel) >>> 0;
    });
    // Jcc rel8 — conditional jumps
    var conditions = [
        [0x70, "JO", function (cpu) { return cpu.getFlag(CPU_ts_1.FLAG.OF); }],
        [0x71, "JNO", function (cpu) { return !cpu.getFlag(CPU_ts_1.FLAG.OF); }],
        [0x72, "JB", function (cpu) { return cpu.getFlag(CPU_ts_1.FLAG.CF); }],
        [0x73, "JAE", function (cpu) { return !cpu.getFlag(CPU_ts_1.FLAG.CF); }],
        [0x74, "JE", function (cpu) { return cpu.getFlag(CPU_ts_1.FLAG.ZF); }],
        [0x75, "JNE", function (cpu) { return !cpu.getFlag(CPU_ts_1.FLAG.ZF); }],
        [0x76, "JBE", function (cpu) { return cpu.getFlag(CPU_ts_1.FLAG.CF) || cpu.getFlag(CPU_ts_1.FLAG.ZF); }],
        [0x77, "JA", function (cpu) { return !cpu.getFlag(CPU_ts_1.FLAG.CF) && !cpu.getFlag(CPU_ts_1.FLAG.ZF); }],
        [0x78, "JS", function (cpu) { return cpu.getFlag(CPU_ts_1.FLAG.SF); }],
        [0x79, "JNS", function (cpu) { return !cpu.getFlag(CPU_ts_1.FLAG.SF); }],
        [0x7C, "JL", function (cpu) { return cpu.getFlag(CPU_ts_1.FLAG.SF) !== cpu.getFlag(CPU_ts_1.FLAG.OF); }],
        [0x7D, "JGE", function (cpu) { return cpu.getFlag(CPU_ts_1.FLAG.SF) === cpu.getFlag(CPU_ts_1.FLAG.OF); }],
        [0x7E, "JLE", function (cpu) { return cpu.getFlag(CPU_ts_1.FLAG.ZF) || cpu.getFlag(CPU_ts_1.FLAG.SF) !== cpu.getFlag(CPU_ts_1.FLAG.OF); }],
        [0x7F, "JG", function (cpu) { return !cpu.getFlag(CPU_ts_1.FLAG.ZF) && cpu.getFlag(CPU_ts_1.FLAG.SF) === cpu.getFlag(CPU_ts_1.FLAG.OF); }],
    ];
    var _loop_8 = function (opcode, condFn) {
        cpu.register(opcode, function (cpu) {
            var rel = cpu.fetchSigned8();
            if (condFn(cpu)) {
                cpu.eip = (cpu.eip + rel) >>> 0;
            }
        });
    };
    for (var _i = 0, conditions_1 = conditions; _i < conditions_1.length; _i++) {
        var _a = conditions_1[_i], opcode = _a[0], condFn = _a[2];
        _loop_8(opcode, condFn);
    }
}
// ============================================================
// Group 5 (0xFF)
// ============================================================
function registerGroup5(cpu) {
    // Group 5: 0xFF — op r/m32
    cpu.register(0xFF, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        var operand = cpu.readRM32(mod, rm);
        switch (reg) {
            case 0: { // INC r/m32
                var result = (operand + 1) >>> 0;
                cpu.writeRM32(mod, rm, result);
                var savedCF = cpu.getFlag(CPU_ts_1.FLAG.CF);
                cpu.updateFlagsArith(operand + 1, operand, 1, false);
                cpu.setFlag(CPU_ts_1.FLAG.CF, savedCF); // Restore CF (INC doesn't affect it)
                break;
            }
            case 1: { // DEC r/m32
                var result = (operand - 1) >>> 0;
                cpu.writeRM32(mod, rm, result);
                var savedCF = cpu.getFlag(CPU_ts_1.FLAG.CF);
                cpu.updateFlagsArith(operand - 1, operand, 1, true);
                cpu.setFlag(CPU_ts_1.FLAG.CF, savedCF); // Restore CF (DEC doesn't affect it)
                break;
            }
            case 2: { // CALL r/m32
                cpu.push32(cpu.eip);
                cpu.eip = operand;
                break;
            }
            case 4: { // JMP r/m32
                cpu.eip = operand;
                break;
            }
            case 6: { // PUSH r/m32
                cpu.push32(operand);
                break;
            }
            default:
                throw new Error("Unsupported Group 5 extension: /".concat(reg, " (0xFF /").concat(reg, ")"));
        }
    });
}
// ============================================================
// Two-byte opcodes (0x0F prefix)
// ============================================================
function registerTwoByteOpcodes(cpu) {
    cpu.register(0x0F, function (cpu) {
        var op2 = cpu.fetch8();
        switch (op2) {
            // MOVZX r32, r/m8
            case 0xB6: {
                var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
                var resolved = cpu.resolveRM(mod, rm);
                var val = void 0;
                if (resolved.isReg) {
                    val = cpu.regs[resolved.addr] & 0xFF;
                }
                else {
                    val = cpu.memory.read8(cpu.applySegmentOverride(resolved.addr));
                }
                cpu.regs[reg] = val;
                break;
            }
            // MOVZX r32, r/m16
            case 0xB7: {
                var _b = cpu.decodeModRM(), mod = _b.mod, reg = _b.reg, rm = _b.rm;
                var resolved = cpu.resolveRM(mod, rm);
                var val = void 0;
                if (resolved.isReg) {
                    val = cpu.regs[resolved.addr] & 0xFFFF;
                }
                else {
                    val = cpu.memory.read16(cpu.applySegmentOverride(resolved.addr));
                }
                cpu.regs[reg] = val;
                break;
            }
            // MOVSX r32, r/m8
            case 0xBE: {
                var _c = cpu.decodeModRM(), mod = _c.mod, reg = _c.reg, rm = _c.rm;
                var resolved = cpu.resolveRM(mod, rm);
                var val = void 0;
                if (resolved.isReg) {
                    val = cpu.regs[resolved.addr] & 0xFF;
                }
                else {
                    val = cpu.memory.read8(cpu.applySegmentOverride(resolved.addr));
                }
                // Sign-extend from 8 to 32 bits
                cpu.regs[reg] = ((val << 24) >> 24) >>> 0;
                break;
            }
            // MOVSX r32, r/m16
            case 0xBF: {
                var _d = cpu.decodeModRM(), mod = _d.mod, reg = _d.reg, rm = _d.rm;
                var resolved = cpu.resolveRM(mod, rm);
                var val = void 0;
                if (resolved.isReg) {
                    val = cpu.regs[resolved.addr] & 0xFFFF;
                }
                else {
                    val = cpu.memory.read16(cpu.applySegmentOverride(resolved.addr));
                }
                // Sign-extend from 16 to 32 bits
                cpu.regs[reg] = ((val << 16) >> 16) >>> 0;
                break;
            }
            // IMUL r32, r/m32
            case 0xAF: {
                var _e = cpu.decodeModRM(), mod = _e.mod, reg = _e.reg, rm = _e.rm;
                var op1 = cpu.regs[reg] | 0; // signed
                var op2_1 = cpu.readRM32(mod, rm) | 0; // signed
                var result = Math.imul(op1, op2_1);
                cpu.regs[reg] = result >>> 0;
                // Set CF and OF if result doesn't fit in 32 bits
                var full = BigInt(op1) * BigInt(op2_1);
                var overflow = full !== BigInt(result);
                cpu.setFlag(CPU_ts_1.FLAG.CF, overflow);
                cpu.setFlag(CPU_ts_1.FLAG.OF, overflow);
                break;
            }
            // SETcc r/m8 (0x90-0x9F)
            case 0x90:
            case 0x91:
            case 0x92:
            case 0x93:
            case 0x94:
            case 0x95:
            case 0x96:
            case 0x97:
            case 0x98:
            case 0x99:
            case 0x9A:
            case 0x9B:
            case 0x9C:
            case 0x9D:
            case 0x9E:
            case 0x9F: {
                var _f = cpu.decodeModRM(), mod = _f.mod, rm = _f.rm;
                var resolved = cpu.resolveRM(mod, rm);
                var condMet = evaluateCondition(cpu, op2 & 0x0F);
                var val = condMet ? 1 : 0;
                if (resolved.isReg) {
                    // Set low byte of register
                    cpu.regs[resolved.addr] = (cpu.regs[resolved.addr] & 0xFFFFFF00) | val;
                }
                else {
                    cpu.memory.write8(cpu.applySegmentOverride(resolved.addr), val);
                }
                break;
            }
            // Jcc rel32 (near conditional jumps, 0x80-0x8F)
            case 0x80:
            case 0x81:
            case 0x82:
            case 0x83:
            case 0x84:
            case 0x85:
            case 0x86:
            case 0x87:
            case 0x88:
            case 0x89:
            case 0x8A:
            case 0x8B:
            case 0x8C:
            case 0x8D:
            case 0x8E:
            case 0x8F: {
                var rel = cpu.fetchSigned32();
                var condMet = evaluateCondition(cpu, op2 & 0x0F);
                if (condMet) {
                    cpu.eip = (cpu.eip + rel) >>> 0;
                }
                break;
            }
            // XADD r/m32, r32
            case 0xC1: {
                var _g = cpu.decodeModRM(), mod = _g.mod, reg = _g.reg, rm = _g.rm;
                var dest = cpu.readRM32(mod, rm);
                var src = cpu.regs[reg];
                var result = (dest + src) >>> 0;
                cpu.regs[reg] = dest; // old dest goes to src register
                cpu.writeRM32(mod, rm, result);
                cpu.updateFlagsArith(dest + src, dest, src, false);
                break;
            }
            // BSR r32, r/m32 (bit scan reverse)
            case 0xBD: {
                var _h = cpu.decodeModRM(), mod = _h.mod, reg = _h.reg, rm = _h.rm;
                var val = cpu.readRM32(mod, rm);
                if (val === 0) {
                    cpu.setFlag(CPU_ts_1.FLAG.ZF, true);
                }
                else {
                    cpu.setFlag(CPU_ts_1.FLAG.ZF, false);
                    cpu.regs[reg] = 31 - Math.clz32(val);
                }
                break;
            }
            // BSF r32, r/m32 (bit scan forward)
            case 0xBC: {
                var _j = cpu.decodeModRM(), mod = _j.mod, reg = _j.reg, rm = _j.rm;
                var val = cpu.readRM32(mod, rm);
                if (val === 0) {
                    cpu.setFlag(CPU_ts_1.FLAG.ZF, true);
                }
                else {
                    cpu.setFlag(CPU_ts_1.FLAG.ZF, false);
                    // Find lowest set bit
                    cpu.regs[reg] = 31 - Math.clz32(val & (-val >>> 0));
                }
                break;
            }
            // CMOV variants (0x40-0x4F)
            case 0x40:
            case 0x41:
            case 0x42:
            case 0x43:
            case 0x44:
            case 0x45:
            case 0x46:
            case 0x47:
            case 0x48:
            case 0x49:
            case 0x4A:
            case 0x4B:
            case 0x4C:
            case 0x4D:
            case 0x4E:
            case 0x4F: {
                var _k = cpu.decodeModRM(), mod = _k.mod, reg = _k.reg, rm = _k.rm;
                var val = cpu.readRM32(mod, rm);
                var condMet = evaluateCondition(cpu, op2 & 0x0F);
                if (condMet) {
                    cpu.regs[reg] = val;
                }
                break;
            }
            default:
                throw new Error("Unknown two-byte opcode: 0x0F 0x".concat(op2.toString(16).padStart(2, "0"), " at EIP=0x").concat((cpu.eip >>> 0).toString(16)));
        }
    });
}
/**
 * Evaluate x86 condition codes (used by Jcc, SETcc, CMOVcc)
 * Condition number maps to: 0=O, 1=NO, 2=B, 3=AE, 4=E, 5=NE, 6=BE, 7=A,
 *                           8=S, 9=NS, A=P, B=NP, C=L, D=GE, E=LE, F=G
 */
function evaluateCondition(cpu, cond) {
    switch (cond) {
        case 0x0: return cpu.getFlag(CPU_ts_1.FLAG.OF); // O
        case 0x1: return !cpu.getFlag(CPU_ts_1.FLAG.OF); // NO
        case 0x2: return cpu.getFlag(CPU_ts_1.FLAG.CF); // B/C/NAE
        case 0x3: return !cpu.getFlag(CPU_ts_1.FLAG.CF); // AE/NB/NC
        case 0x4: return cpu.getFlag(CPU_ts_1.FLAG.ZF); // E/Z
        case 0x5: return !cpu.getFlag(CPU_ts_1.FLAG.ZF); // NE/NZ
        case 0x6: return cpu.getFlag(CPU_ts_1.FLAG.CF) || cpu.getFlag(CPU_ts_1.FLAG.ZF); // BE/NA
        case 0x7: return !cpu.getFlag(CPU_ts_1.FLAG.CF) && !cpu.getFlag(CPU_ts_1.FLAG.ZF); // A/NBE
        case 0x8: return cpu.getFlag(CPU_ts_1.FLAG.SF); // S
        case 0x9: return !cpu.getFlag(CPU_ts_1.FLAG.SF); // NS
        case 0xA: return false; // PF not tracked yet                                   // P/PE
        case 0xB: return true; // PF not tracked yet                                   // NP/PO
        case 0xC: return cpu.getFlag(CPU_ts_1.FLAG.SF) !== cpu.getFlag(CPU_ts_1.FLAG.OF); // L/NGE
        case 0xD: return cpu.getFlag(CPU_ts_1.FLAG.SF) === cpu.getFlag(CPU_ts_1.FLAG.OF); // GE/NL
        case 0xE: return cpu.getFlag(CPU_ts_1.FLAG.ZF) || (cpu.getFlag(CPU_ts_1.FLAG.SF) !== cpu.getFlag(CPU_ts_1.FLAG.OF)); // LE/NG
        case 0xF: return !cpu.getFlag(CPU_ts_1.FLAG.ZF) && (cpu.getFlag(CPU_ts_1.FLAG.SF) === cpu.getFlag(CPU_ts_1.FLAG.OF)); // G/NLE
        default: return false;
    }
}
// ============================================================
// String Operations (STOS, MOVS, LODS, SCAS, CMPS)
// ============================================================
function registerStringOps(cpu) {
    // Direction flag helper: returns +1 (DF=0, forward) or -1 (DF=1, backward)
    var direction = function (cpu) { return cpu.getFlag(CPU_ts_1.FLAG.DF) ? -1 : 1; };
    // STOSB — store AL to [EDI], advance EDI by 1
    cpu.register(0xAA, function (cpu) {
        var rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[CPU_ts_1.REG.ECX] >>> 0) !== 0) {
                cpu.memory.write8(cpu.regs[CPU_ts_1.REG.EDI], cpu.regs[CPU_ts_1.REG.EAX] & 0xFF);
                cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + direction(cpu)) >>> 0;
                cpu.regs[CPU_ts_1.REG.ECX] = (cpu.regs[CPU_ts_1.REG.ECX] - 1) >>> 0;
            }
        }
        else {
            cpu.memory.write8(cpu.regs[CPU_ts_1.REG.EDI], cpu.regs[CPU_ts_1.REG.EAX] & 0xFF);
            cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + direction(cpu)) >>> 0;
        }
    });
    // STOSD — store EAX to [EDI], advance EDI by 4
    cpu.register(0xAB, function (cpu) {
        var dir4 = direction(cpu) * 4;
        var rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[CPU_ts_1.REG.ECX] >>> 0) !== 0) {
                cpu.memory.write32(cpu.regs[CPU_ts_1.REG.EDI], cpu.regs[CPU_ts_1.REG.EAX]);
                cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + dir4) >>> 0;
                cpu.regs[CPU_ts_1.REG.ECX] = (cpu.regs[CPU_ts_1.REG.ECX] - 1) >>> 0;
            }
        }
        else {
            cpu.memory.write32(cpu.regs[CPU_ts_1.REG.EDI], cpu.regs[CPU_ts_1.REG.EAX]);
            cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + dir4) >>> 0;
        }
    });
    // MOVSB — copy byte [ESI] to [EDI], advance both by 1
    cpu.register(0xA4, function (cpu) {
        var rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[CPU_ts_1.REG.ECX] >>> 0) !== 0) {
                cpu.memory.write8(cpu.regs[CPU_ts_1.REG.EDI], cpu.memory.read8(cpu.regs[CPU_ts_1.REG.ESI]));
                cpu.regs[CPU_ts_1.REG.ESI] = (cpu.regs[CPU_ts_1.REG.ESI] + direction(cpu)) >>> 0;
                cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + direction(cpu)) >>> 0;
                cpu.regs[CPU_ts_1.REG.ECX] = (cpu.regs[CPU_ts_1.REG.ECX] - 1) >>> 0;
            }
        }
        else {
            cpu.memory.write8(cpu.regs[CPU_ts_1.REG.EDI], cpu.memory.read8(cpu.regs[CPU_ts_1.REG.ESI]));
            cpu.regs[CPU_ts_1.REG.ESI] = (cpu.regs[CPU_ts_1.REG.ESI] + direction(cpu)) >>> 0;
            cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + direction(cpu)) >>> 0;
        }
    });
    // MOVSD — copy dword [ESI] to [EDI], advance both by 4
    cpu.register(0xA5, function (cpu) {
        var dir4 = direction(cpu) * 4;
        var rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[CPU_ts_1.REG.ECX] >>> 0) !== 0) {
                cpu.memory.write32(cpu.regs[CPU_ts_1.REG.EDI], cpu.memory.read32(cpu.regs[CPU_ts_1.REG.ESI]));
                cpu.regs[CPU_ts_1.REG.ESI] = (cpu.regs[CPU_ts_1.REG.ESI] + dir4) >>> 0;
                cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + dir4) >>> 0;
                cpu.regs[CPU_ts_1.REG.ECX] = (cpu.regs[CPU_ts_1.REG.ECX] - 1) >>> 0;
            }
        }
        else {
            cpu.memory.write32(cpu.regs[CPU_ts_1.REG.EDI], cpu.memory.read32(cpu.regs[CPU_ts_1.REG.ESI]));
            cpu.regs[CPU_ts_1.REG.ESI] = (cpu.regs[CPU_ts_1.REG.ESI] + dir4) >>> 0;
            cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + dir4) >>> 0;
        }
    });
    // LODSB — load byte [ESI] into AL, advance ESI by 1
    cpu.register(0xAC, function (cpu) {
        var rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[CPU_ts_1.REG.ECX] >>> 0) !== 0) {
                cpu.regs[CPU_ts_1.REG.EAX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFFFF00) | cpu.memory.read8(cpu.regs[CPU_ts_1.REG.ESI]);
                cpu.regs[CPU_ts_1.REG.ESI] = (cpu.regs[CPU_ts_1.REG.ESI] + direction(cpu)) >>> 0;
                cpu.regs[CPU_ts_1.REG.ECX] = (cpu.regs[CPU_ts_1.REG.ECX] - 1) >>> 0;
            }
        }
        else {
            cpu.regs[CPU_ts_1.REG.EAX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFFFF00) | cpu.memory.read8(cpu.regs[CPU_ts_1.REG.ESI]);
            cpu.regs[CPU_ts_1.REG.ESI] = (cpu.regs[CPU_ts_1.REG.ESI] + direction(cpu)) >>> 0;
        }
    });
    // LODSD — load dword [ESI] into EAX, advance ESI by 4
    cpu.register(0xAD, function (cpu) {
        var dir4 = direction(cpu) * 4;
        var rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[CPU_ts_1.REG.ECX] >>> 0) !== 0) {
                cpu.regs[CPU_ts_1.REG.EAX] = cpu.memory.read32(cpu.regs[CPU_ts_1.REG.ESI]);
                cpu.regs[CPU_ts_1.REG.ESI] = (cpu.regs[CPU_ts_1.REG.ESI] + dir4) >>> 0;
                cpu.regs[CPU_ts_1.REG.ECX] = (cpu.regs[CPU_ts_1.REG.ECX] - 1) >>> 0;
            }
        }
        else {
            cpu.regs[CPU_ts_1.REG.EAX] = cpu.memory.read32(cpu.regs[CPU_ts_1.REG.ESI]);
            cpu.regs[CPU_ts_1.REG.ESI] = (cpu.regs[CPU_ts_1.REG.ESI] + dir4) >>> 0;
        }
    });
    // SCASB — compare AL with [EDI], advance EDI by 1
    cpu.register(0xAE, function (cpu) {
        var rep = cpu.repPrefix;
        if (rep === "REP") {
            // REPE SCASB: scan while equal (ZF=1), stop on mismatch or ECX=0
            while ((cpu.regs[CPU_ts_1.REG.ECX] >>> 0) !== 0) {
                var val = cpu.memory.read8(cpu.regs[CPU_ts_1.REG.EDI]);
                var al = cpu.regs[CPU_ts_1.REG.EAX] & 0xFF;
                cpu.updateFlagsArith(al - val, al, val, true);
                cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + direction(cpu)) >>> 0;
                cpu.regs[CPU_ts_1.REG.ECX] = (cpu.regs[CPU_ts_1.REG.ECX] - 1) >>> 0;
                if (!cpu.getFlag(CPU_ts_1.FLAG.ZF))
                    break;
            }
        }
        else if (rep === "REPNE") {
            // REPNE SCASB: scan while not equal (ZF=0), stop on match or ECX=0
            while ((cpu.regs[CPU_ts_1.REG.ECX] >>> 0) !== 0) {
                var val = cpu.memory.read8(cpu.regs[CPU_ts_1.REG.EDI]);
                var al = cpu.regs[CPU_ts_1.REG.EAX] & 0xFF;
                cpu.updateFlagsArith(al - val, al, val, true);
                cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + direction(cpu)) >>> 0;
                cpu.regs[CPU_ts_1.REG.ECX] = (cpu.regs[CPU_ts_1.REG.ECX] - 1) >>> 0;
                if (cpu.getFlag(CPU_ts_1.FLAG.ZF))
                    break;
            }
        }
        else {
            var val = cpu.memory.read8(cpu.regs[CPU_ts_1.REG.EDI]);
            var al = cpu.regs[CPU_ts_1.REG.EAX] & 0xFF;
            cpu.updateFlagsArith(al - val, al, val, true);
            cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + direction(cpu)) >>> 0;
        }
    });
    // SCASD — compare EAX with [EDI], advance EDI by 4
    cpu.register(0xAF, function (cpu) {
        var dir4 = direction(cpu) * 4;
        var rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[CPU_ts_1.REG.ECX] >>> 0) !== 0) {
                var val = cpu.memory.read32(cpu.regs[CPU_ts_1.REG.EDI]);
                cpu.updateFlagsArith((cpu.regs[CPU_ts_1.REG.EAX] | 0) - (val | 0), cpu.regs[CPU_ts_1.REG.EAX], val, true);
                cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + dir4) >>> 0;
                cpu.regs[CPU_ts_1.REG.ECX] = (cpu.regs[CPU_ts_1.REG.ECX] - 1) >>> 0;
                if (!cpu.getFlag(CPU_ts_1.FLAG.ZF))
                    break;
            }
        }
        else if (rep === "REPNE") {
            while ((cpu.regs[CPU_ts_1.REG.ECX] >>> 0) !== 0) {
                var val = cpu.memory.read32(cpu.regs[CPU_ts_1.REG.EDI]);
                cpu.updateFlagsArith((cpu.regs[CPU_ts_1.REG.EAX] | 0) - (val | 0), cpu.regs[CPU_ts_1.REG.EAX], val, true);
                cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + dir4) >>> 0;
                cpu.regs[CPU_ts_1.REG.ECX] = (cpu.regs[CPU_ts_1.REG.ECX] - 1) >>> 0;
                if (cpu.getFlag(CPU_ts_1.FLAG.ZF))
                    break;
            }
        }
        else {
            var val = cpu.memory.read32(cpu.regs[CPU_ts_1.REG.EDI]);
            cpu.updateFlagsArith((cpu.regs[CPU_ts_1.REG.EAX] | 0) - (val | 0), cpu.regs[CPU_ts_1.REG.EAX], val, true);
            cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + dir4) >>> 0;
        }
    });
    // CMPSB — compare [ESI] with [EDI], advance both by 1
    cpu.register(0xA6, function (cpu) {
        var rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[CPU_ts_1.REG.ECX] >>> 0) !== 0) {
                var src = cpu.memory.read8(cpu.regs[CPU_ts_1.REG.ESI]);
                var dst = cpu.memory.read8(cpu.regs[CPU_ts_1.REG.EDI]);
                cpu.updateFlagsArith(src - dst, src, dst, true);
                cpu.regs[CPU_ts_1.REG.ESI] = (cpu.regs[CPU_ts_1.REG.ESI] + direction(cpu)) >>> 0;
                cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + direction(cpu)) >>> 0;
                cpu.regs[CPU_ts_1.REG.ECX] = (cpu.regs[CPU_ts_1.REG.ECX] - 1) >>> 0;
                if (!cpu.getFlag(CPU_ts_1.FLAG.ZF))
                    break;
            }
        }
        else if (rep === "REPNE") {
            while ((cpu.regs[CPU_ts_1.REG.ECX] >>> 0) !== 0) {
                var src = cpu.memory.read8(cpu.regs[CPU_ts_1.REG.ESI]);
                var dst = cpu.memory.read8(cpu.regs[CPU_ts_1.REG.EDI]);
                cpu.updateFlagsArith(src - dst, src, dst, true);
                cpu.regs[CPU_ts_1.REG.ESI] = (cpu.regs[CPU_ts_1.REG.ESI] + direction(cpu)) >>> 0;
                cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + direction(cpu)) >>> 0;
                cpu.regs[CPU_ts_1.REG.ECX] = (cpu.regs[CPU_ts_1.REG.ECX] - 1) >>> 0;
                if (cpu.getFlag(CPU_ts_1.FLAG.ZF))
                    break;
            }
        }
        else {
            var src = cpu.memory.read8(cpu.regs[CPU_ts_1.REG.ESI]);
            var dst = cpu.memory.read8(cpu.regs[CPU_ts_1.REG.EDI]);
            cpu.updateFlagsArith(src - dst, src, dst, true);
            cpu.regs[CPU_ts_1.REG.ESI] = (cpu.regs[CPU_ts_1.REG.ESI] + direction(cpu)) >>> 0;
            cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + direction(cpu)) >>> 0;
        }
    });
    // CMPSD — compare [ESI] dword with [EDI] dword, advance both by 4
    cpu.register(0xA7, function (cpu) {
        var dir4 = direction(cpu) * 4;
        var rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[CPU_ts_1.REG.ECX] >>> 0) !== 0) {
                var src = cpu.memory.read32(cpu.regs[CPU_ts_1.REG.ESI]);
                var dst = cpu.memory.read32(cpu.regs[CPU_ts_1.REG.EDI]);
                cpu.updateFlagsArith((src | 0) - (dst | 0), src, dst, true);
                cpu.regs[CPU_ts_1.REG.ESI] = (cpu.regs[CPU_ts_1.REG.ESI] + dir4) >>> 0;
                cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + dir4) >>> 0;
                cpu.regs[CPU_ts_1.REG.ECX] = (cpu.regs[CPU_ts_1.REG.ECX] - 1) >>> 0;
                if (!cpu.getFlag(CPU_ts_1.FLAG.ZF))
                    break;
            }
        }
        else if (rep === "REPNE") {
            while ((cpu.regs[CPU_ts_1.REG.ECX] >>> 0) !== 0) {
                var src = cpu.memory.read32(cpu.regs[CPU_ts_1.REG.ESI]);
                var dst = cpu.memory.read32(cpu.regs[CPU_ts_1.REG.EDI]);
                cpu.updateFlagsArith((src | 0) - (dst | 0), src, dst, true);
                cpu.regs[CPU_ts_1.REG.ESI] = (cpu.regs[CPU_ts_1.REG.ESI] + dir4) >>> 0;
                cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + dir4) >>> 0;
                cpu.regs[CPU_ts_1.REG.ECX] = (cpu.regs[CPU_ts_1.REG.ECX] - 1) >>> 0;
                if (cpu.getFlag(CPU_ts_1.FLAG.ZF))
                    break;
            }
        }
        else {
            var src = cpu.memory.read32(cpu.regs[CPU_ts_1.REG.ESI]);
            var dst = cpu.memory.read32(cpu.regs[CPU_ts_1.REG.EDI]);
            cpu.updateFlagsArith((src | 0) - (dst | 0), src, dst, true);
            cpu.regs[CPU_ts_1.REG.ESI] = (cpu.regs[CPU_ts_1.REG.ESI] + dir4) >>> 0;
            cpu.regs[CPU_ts_1.REG.EDI] = (cpu.regs[CPU_ts_1.REG.EDI] + dir4) >>> 0;
        }
    });
}
// ============================================================
// Misc
// ============================================================
function registerMisc(cpu) {
    // NOP
    cpu.register(0x90, function () { });
    // HLT
    cpu.register(0xF4, function (cpu) {
        cpu.halted = true;
    });
    // CLD — clear direction flag (DF=0, string ops go forward)
    cpu.register(0xFC, function (cpu) {
        cpu.setFlag(CPU_ts_1.FLAG.DF, false);
    });
    // STD — set direction flag (DF=1, string ops go backward)
    cpu.register(0xFD, function (cpu) {
        cpu.setFlag(CPU_ts_1.FLAG.DF, true);
    });
    // WAIT / FWAIT — wait for pending FPU exceptions (no-op in our emulator)
    cpu.register(0x9B, function () { });
    // INT imm8
    cpu.register(0xCD, function (cpu) {
        var intNum = cpu.fetch8();
        cpu.triggerInterrupt(intNum);
    });
    // SAHF — Store AH into lower 8 bits of EFLAGS (SF, ZF, AF, PF, CF)
    cpu.register(0x9E, function (cpu) {
        var ah = (cpu.regs[CPU_ts_1.REG.EAX] >> 8) & 0xFF;
        // EFLAGS bits: SF(7), ZF(6), AF(4), PF(2), CF(0)
        cpu.eflags = (cpu.eflags & ~0xD5) | (ah & 0xD5);
    });
}
// ============================================================
// x87 FPU Instructions (0xD8 - 0xDF)
// ============================================================
function registerFPU(cpu) {
    // 0xD8: float32 memory ops / register-register ops
    cpu.register(0xD8, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        if (mod === 3) {
            // Register-register: ST(0) op ST(i)
            var st0 = cpu.fpuGet(0);
            var sti = cpu.fpuGet(rm);
            switch (reg) {
                case 0:
                    cpu.fpuSet(0, st0 + sti);
                    break; // FADD ST(0), ST(i)
                case 1:
                    cpu.fpuSet(0, st0 * sti);
                    break; // FMUL ST(0), ST(i)
                case 2:
                    cpu.fpuCompare(st0, sti);
                    break; // FCOM ST(i)
                case 3: // FCOMP ST(i)
                    cpu.fpuCompare(st0, sti);
                    cpu.fpuPop();
                    break;
                case 4:
                    cpu.fpuSet(0, st0 - sti);
                    break; // FSUB ST(0), ST(i)
                case 5:
                    cpu.fpuSet(0, sti - st0);
                    break; // FSUBR ST(0), ST(i)
                case 6: // FDIV ST(0), ST(i)
                    cpu.fpuSet(0, st0 / sti);
                    break;
                case 7: // FDIVR ST(0), ST(i)
                    cpu.fpuSet(0, sti / st0);
                    break;
            }
        }
        else {
            // Memory operand: float32
            var resolved = cpu.resolveRM(mod, rm);
            var addr = cpu.applySegmentOverride(resolved.addr);
            var val = cpu.readFloat(addr);
            var st0 = cpu.fpuGet(0);
            switch (reg) {
                case 0:
                    cpu.fpuSet(0, st0 + val);
                    break; // FADD m32
                case 1:
                    cpu.fpuSet(0, st0 * val);
                    break; // FMUL m32
                case 2:
                    cpu.fpuCompare(st0, val);
                    break; // FCOM m32
                case 3: // FCOMP m32
                    cpu.fpuCompare(st0, val);
                    cpu.fpuPop();
                    break;
                case 4:
                    cpu.fpuSet(0, st0 - val);
                    break; // FSUB m32
                case 5:
                    cpu.fpuSet(0, val - st0);
                    break; // FSUBR m32
                case 6:
                    cpu.fpuSet(0, st0 / val);
                    break; // FDIV m32
                case 7:
                    cpu.fpuSet(0, val / st0);
                    break; // FDIVR m32
            }
        }
    });
    // 0xD9: FLD float32, FXCH, FST/FSTP, FLDCW, FSTCW, misc
    cpu.register(0xD9, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        if (mod === 3) {
            // Register forms
            switch (reg) {
                case 0: // FLD ST(i) — push copy of ST(i)
                    cpu.fpuPush(cpu.fpuGet(rm));
                    break;
                case 1: { // FXCH ST(i)
                    var tmp = cpu.fpuGet(0);
                    cpu.fpuSet(0, cpu.fpuGet(rm));
                    cpu.fpuSet(rm, tmp);
                    break;
                }
                case 2: // FNOP (only rm=0)
                    break;
                case 3: // FSTP ST(i) — copy ST(0) to ST(i) then pop
                    cpu.fpuSet(rm, cpu.fpuGet(0));
                    cpu.fpuPop();
                    break;
                case 4: // Misc group: FCHS, FABS, FTST, FXAM
                    switch (rm) {
                        case 0: // FCHS
                            cpu.fpuSet(0, -cpu.fpuGet(0));
                            break;
                        case 1: // FABS
                            cpu.fpuSet(0, Math.abs(cpu.fpuGet(0)));
                            break;
                        case 4: // FTST — compare ST(0) with 0.0
                            cpu.fpuCompare(cpu.fpuGet(0), 0.0);
                            break;
                        case 5: // FXAM — classify ST(0)
                            // Simplified: just set C1 for sign
                            cpu.fpuStatusWord &= ~0x4700;
                            if (cpu.fpuGet(0) < 0)
                                cpu.fpuStatusWord |= 0x0200; // C1=sign
                            break;
                        default:
                            break; // Other D9 E2-E7 forms: ignore for now
                    }
                    break;
                case 5: // FLD constants
                    switch (rm) {
                        case 0:
                            cpu.fpuPush(1.0);
                            break; // FLD1
                        case 1:
                            cpu.fpuPush(Math.log2(10));
                            break; // FLDL2T
                        case 2:
                            cpu.fpuPush(Math.LOG2E);
                            break; // FLDL2E
                        case 3:
                            cpu.fpuPush(Math.PI);
                            break; // FLDPI
                        case 4:
                            cpu.fpuPush(Math.log10(2));
                            break; // FLDLG2
                        case 5:
                            cpu.fpuPush(Math.LN2);
                            break; // FLDLN2
                        case 6:
                            cpu.fpuPush(0.0);
                            break; // FLDZ
                        default: break;
                    }
                    break;
                case 6: // Misc: F2XM1, FYL2X, FPTAN, FPATAN, FXTRACT, FPREM1, FDECSTP, FINCSTP
                    switch (rm) {
                        case 0: // F2XM1: ST(0) = 2^ST(0) - 1
                            cpu.fpuSet(0, Math.pow(2, cpu.fpuGet(0)) - 1);
                            break;
                        case 1: { // FYL2X: ST(1) = ST(1) * log2(ST(0)), pop
                            var x = cpu.fpuGet(0);
                            var y = cpu.fpuGet(1);
                            cpu.fpuPop();
                            cpu.fpuSet(0, y * Math.log2(x));
                            break;
                        }
                        case 5: // FPREM1 (IEEE remainder)
                            cpu.fpuSet(0, cpu.fpuGet(0) % cpu.fpuGet(1));
                            cpu.fpuStatusWord &= ~0x0400; // Clear C2 (reduction complete)
                            break;
                        case 6: // FDECSTP
                            cpu.fpuTop = (cpu.fpuTop - 1) & 7;
                            cpu.fpuStatusWord = (cpu.fpuStatusWord & ~0x3800) | (cpu.fpuTop << 11);
                            break;
                        case 7: // FINCSTP
                            cpu.fpuTop = (cpu.fpuTop + 1) & 7;
                            cpu.fpuStatusWord = (cpu.fpuStatusWord & ~0x3800) | (cpu.fpuTop << 11);
                            break;
                        default: break;
                    }
                    break;
                case 7: // Misc: FPREM, FYL2XP1, FSQRT, FSINCOS, FRNDINT, FSCALE, FSIN, FCOS
                    switch (rm) {
                        case 0: // FPREM
                            cpu.fpuSet(0, cpu.fpuGet(0) % cpu.fpuGet(1));
                            cpu.fpuStatusWord &= ~0x0400; // Clear C2
                            break;
                        case 2: // FSQRT
                            cpu.fpuSet(0, Math.sqrt(cpu.fpuGet(0)));
                            break;
                        case 3: // FSINCOS — push cos, ST(1)=sin
                            {
                                var v = cpu.fpuGet(0);
                                cpu.fpuSet(0, Math.sin(v));
                                cpu.fpuPush(Math.cos(v));
                            }
                            break;
                        case 4: // FRNDINT
                            cpu.fpuSet(0, Math.round(cpu.fpuGet(0)));
                            break;
                        case 5: { // FSCALE: ST(0) = ST(0) * 2^trunc(ST(1))
                            var scale = Math.trunc(cpu.fpuGet(1));
                            cpu.fpuSet(0, cpu.fpuGet(0) * Math.pow(2, scale));
                            break;
                        }
                        case 6: // FSIN
                            cpu.fpuSet(0, Math.sin(cpu.fpuGet(0)));
                            break;
                        case 7: // FCOS
                            cpu.fpuSet(0, Math.cos(cpu.fpuGet(0)));
                            break;
                        default: break;
                    }
                    break;
                default:
                    break;
            }
        }
        else {
            // Memory forms
            var resolved = cpu.resolveRM(mod, rm);
            var addr = cpu.applySegmentOverride(resolved.addr);
            switch (reg) {
                case 0: // FLD m32real — push float32
                    cpu.fpuPush(cpu.readFloat(addr));
                    break;
                case 2: // FST m32real — store ST(0) as float32
                    cpu.writeFloat(addr, cpu.fpuGet(0));
                    break;
                case 3: // FSTP m32real — store ST(0) as float32, pop
                    cpu.writeFloat(addr, cpu.fpuGet(0));
                    cpu.fpuPop();
                    break;
                case 4: // FLDENV
                    break; // NOP for now
                case 5: // FLDCW m16 — load FPU control word
                    cpu.fpuControlWord = cpu.memory.read16(addr);
                    break;
                case 6: // FNSTENV / FSTENV
                    break; // NOP for now
                case 7: // FNSTCW m16 — store FPU control word
                    cpu.memory.write16(addr, cpu.fpuControlWord);
                    break;
            }
        }
    });
    // 0xDA: integer32 memory ops / FCMOV register ops
    cpu.register(0xDA, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        if (mod === 3) {
            // Register forms: FCMOV variants
            var condMet = evaluateCondition(cpu, reg & 3);
            var invert = (reg & 4) !== 0;
            // DA C0-C7: FCMOVB, DA C8-CF: FCMOVE, DA D0-D7: FCMOVBE, DA D8-DF: FCMOVU
            if (reg === 0 && !invert) { // FCMOVB
                if (cpu.getFlag(CPU_ts_1.FLAG.CF))
                    cpu.fpuSet(0, cpu.fpuGet(rm));
            }
            else if (reg === 1) { // FCMOVE
                if (cpu.getFlag(CPU_ts_1.FLAG.ZF))
                    cpu.fpuSet(0, cpu.fpuGet(rm));
            }
            else if (reg === 2) { // FCMOVBE
                if (cpu.getFlag(CPU_ts_1.FLAG.CF) || cpu.getFlag(CPU_ts_1.FLAG.ZF))
                    cpu.fpuSet(0, cpu.fpuGet(rm));
            }
            else if (reg === 3) { // FCMOVU
                // Unordered — check PF (we don't track PF, so skip)
                cpu.fpuSet(0, cpu.fpuGet(rm));
            }
            else if (reg === 5 && rm === 1) {
                // FUCOMPP — compare ST(0) with ST(1), pop both
                cpu.fpuCompare(cpu.fpuGet(0), cpu.fpuGet(1));
                cpu.fpuPop();
                cpu.fpuPop();
            }
        }
        else {
            // Memory: int32 ops
            var resolved = cpu.resolveRM(mod, rm);
            var addr = cpu.applySegmentOverride(resolved.addr);
            var val = cpu.memory.readSigned32(addr);
            var st0 = cpu.fpuGet(0);
            switch (reg) {
                case 0:
                    cpu.fpuSet(0, st0 + val);
                    break; // FIADD m32int
                case 1:
                    cpu.fpuSet(0, st0 * val);
                    break; // FIMUL m32int
                case 2:
                    cpu.fpuCompare(st0, val);
                    break; // FICOM m32int
                case 3: // FICOMP m32int
                    cpu.fpuCompare(st0, val);
                    cpu.fpuPop();
                    break;
                case 4:
                    cpu.fpuSet(0, st0 - val);
                    break; // FISUB m32int
                case 5:
                    cpu.fpuSet(0, val - st0);
                    break; // FISUBR m32int
                case 6:
                    cpu.fpuSet(0, st0 / val);
                    break; // FIDIV m32int
                case 7:
                    cpu.fpuSet(0, val / st0);
                    break; // FIDIVR m32int
            }
        }
    });
    // 0xDB: FILD int32, FISTP int32, FCLEX, FINIT, FUCOMI
    cpu.register(0xDB, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        if (mod === 3) {
            switch (reg) {
                case 4: // DB E0-E7: special
                    if (rm === 2) {
                        // FCLEX / FNCLEX — clear exceptions
                        cpu.fpuStatusWord &= 0x7F00; // Clear exception flags
                    }
                    else if (rm === 3) {
                        // FINIT / FNINIT — initialize FPU
                        cpu.fpuControlWord = 0x037F;
                        cpu.fpuStatusWord = 0;
                        cpu.fpuTagWord = 0xFFFF;
                        cpu.fpuTop = 0;
                    }
                    break;
                case 5: // FUCOMI ST, ST(i) — unordered compare, set EFLAGS
                    {
                        var a = cpu.fpuGet(0);
                        var b = cpu.fpuGet(rm);
                        if (isNaN(a) || isNaN(b)) {
                            cpu.setFlag(CPU_ts_1.FLAG.ZF, true);
                            cpu.setFlag(CPU_ts_1.FLAG.CF, true);
                            // PF would be set too
                        }
                        else if (a > b) {
                            cpu.setFlag(CPU_ts_1.FLAG.ZF, false);
                            cpu.setFlag(CPU_ts_1.FLAG.CF, false);
                        }
                        else if (a < b) {
                            cpu.setFlag(CPU_ts_1.FLAG.ZF, false);
                            cpu.setFlag(CPU_ts_1.FLAG.CF, true);
                        }
                        else {
                            cpu.setFlag(CPU_ts_1.FLAG.ZF, true);
                            cpu.setFlag(CPU_ts_1.FLAG.CF, false);
                        }
                        cpu.setFlag(CPU_ts_1.FLAG.OF, false);
                    }
                    break;
                case 6: // FCOMI ST, ST(i) — ordered compare, set EFLAGS
                    {
                        var a = cpu.fpuGet(0);
                        var b = cpu.fpuGet(rm);
                        if (isNaN(a) || isNaN(b)) {
                            cpu.setFlag(CPU_ts_1.FLAG.ZF, true);
                            cpu.setFlag(CPU_ts_1.FLAG.CF, true);
                        }
                        else if (a > b) {
                            cpu.setFlag(CPU_ts_1.FLAG.ZF, false);
                            cpu.setFlag(CPU_ts_1.FLAG.CF, false);
                        }
                        else if (a < b) {
                            cpu.setFlag(CPU_ts_1.FLAG.ZF, false);
                            cpu.setFlag(CPU_ts_1.FLAG.CF, true);
                        }
                        else {
                            cpu.setFlag(CPU_ts_1.FLAG.ZF, true);
                            cpu.setFlag(CPU_ts_1.FLAG.CF, false);
                        }
                        cpu.setFlag(CPU_ts_1.FLAG.OF, false);
                    }
                    break;
                default:
                    break;
            }
        }
        else {
            var resolved = cpu.resolveRM(mod, rm);
            var addr = cpu.applySegmentOverride(resolved.addr);
            switch (reg) {
                case 0: // FILD m32int — push int32 as float
                    cpu.fpuPush(cpu.memory.readSigned32(addr));
                    break;
                case 1: // FISTTP m32int — store ST(0) as truncated int32, pop
                    cpu.memory.write32(addr, (Math.trunc(cpu.fpuGet(0)) | 0) >>> 0);
                    cpu.fpuPop();
                    break;
                case 2: // FIST m32int — store ST(0) as int32
                    cpu.memory.write32(addr, (Math.round(cpu.fpuGet(0)) | 0) >>> 0);
                    break;
                case 3: // FISTP m32int — store ST(0) as int32, pop
                    cpu.memory.write32(addr, (Math.round(cpu.fpuGet(0)) | 0) >>> 0);
                    cpu.fpuPop();
                    break;
                case 5: // FLD m80real — load 80-bit extended precision
                    {
                        // Approximate: read as 64-bit double from bytes 0-7, ignore bytes 8-9
                        var lo = cpu.memory.read32(addr);
                        var hi = cpu.memory.read32(addr + 4);
                        var exp = cpu.memory.read16(addr + 8);
                        // Simplified 80-bit to double conversion
                        var sign = (exp & 0x8000) ? -1 : 1;
                        var e = (exp & 0x7FFF) - 16383;
                        var mantissa = (hi * 0x100000000 + lo) / 0x8000000000000000;
                        if (e === -16383 && lo === 0 && hi === 0) {
                            cpu.fpuPush(0.0 * sign);
                        }
                        else {
                            cpu.fpuPush(sign * Math.pow(2, e) * mantissa);
                        }
                    }
                    break;
                case 7: // FSTP m80real — store as 80-bit, pop
                    {
                        // Simplified: store as 64-bit double in first 8 bytes, zero extend
                        var val = cpu.fpuGet(0);
                        cpu.writeDouble(addr, val);
                        cpu.memory.write16(addr + 8, 0);
                        cpu.fpuPop();
                    }
                    break;
            }
        }
    });
    // 0xDC: float64 memory ops / register-register (reverse)
    cpu.register(0xDC, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        if (mod === 3) {
            // Register forms: ST(i) op ST(0) (reverse direction)
            var st0 = cpu.fpuGet(0);
            var sti = cpu.fpuGet(rm);
            switch (reg) {
                case 0:
                    cpu.fpuSet(rm, sti + st0);
                    break; // FADD ST(i), ST(0)
                case 1:
                    cpu.fpuSet(rm, sti * st0);
                    break; // FMUL ST(i), ST(0)
                case 2:
                    cpu.fpuCompare(st0, sti);
                    break; // FCOM ST(i)
                case 3: // FCOMP ST(i)
                    cpu.fpuCompare(st0, sti);
                    cpu.fpuPop();
                    break;
                case 4:
                    cpu.fpuSet(rm, sti - st0);
                    break; // FSUBR ST(i), ST(0)
                case 5:
                    cpu.fpuSet(rm, st0 - sti);
                    break; // FSUB ST(i), ST(0)
                case 6:
                    cpu.fpuSet(rm, sti / st0);
                    break; // FDIVR ST(i), ST(0)
                case 7:
                    cpu.fpuSet(rm, st0 / sti);
                    break; // FDIV ST(i), ST(0)
            }
        }
        else {
            // Memory: float64 ops
            var resolved = cpu.resolveRM(mod, rm);
            var addr = cpu.applySegmentOverride(resolved.addr);
            var val = cpu.readDouble(addr);
            var st0 = cpu.fpuGet(0);
            switch (reg) {
                case 0:
                    cpu.fpuSet(0, st0 + val);
                    break; // FADD m64
                case 1:
                    cpu.fpuSet(0, st0 * val);
                    break; // FMUL m64
                case 2:
                    cpu.fpuCompare(st0, val);
                    break; // FCOM m64
                case 3: // FCOMP m64
                    cpu.fpuCompare(st0, val);
                    cpu.fpuPop();
                    break;
                case 4:
                    cpu.fpuSet(0, st0 - val);
                    break; // FSUB m64
                case 5:
                    cpu.fpuSet(0, val - st0);
                    break; // FSUBR m64
                case 6:
                    cpu.fpuSet(0, st0 / val);
                    break; // FDIV m64
                case 7:
                    cpu.fpuSet(0, val / st0);
                    break; // FDIVR m64
            }
        }
    });
    // 0xDD: FLD/FST/FSTP float64, FRSTOR, FSAVE, FUCOM, FUCOMP, FFREE
    cpu.register(0xDD, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        if (mod === 3) {
            switch (reg) {
                case 0: // FFREE ST(i)
                    cpu.fpuTagWord |= (3 << (((cpu.fpuTop + rm) & 7) * 2));
                    break;
                case 2: // FST ST(i)
                    cpu.fpuSet(rm, cpu.fpuGet(0));
                    break;
                case 3: // FSTP ST(i)
                    cpu.fpuSet(rm, cpu.fpuGet(0));
                    cpu.fpuPop();
                    break;
                case 4: // FUCOM ST(i) — unordered compare
                    cpu.fpuCompare(cpu.fpuGet(0), cpu.fpuGet(rm));
                    break;
                case 5: // FUCOMP ST(i) — unordered compare, pop
                    cpu.fpuCompare(cpu.fpuGet(0), cpu.fpuGet(rm));
                    cpu.fpuPop();
                    break;
                default:
                    break;
            }
        }
        else {
            var resolved = cpu.resolveRM(mod, rm);
            var addr = cpu.applySegmentOverride(resolved.addr);
            switch (reg) {
                case 0: // FLD m64real — push double
                    cpu.fpuPush(cpu.readDouble(addr));
                    break;
                case 1: // FISTTP m64int — store truncated int64, pop (SSE3)
                    cpu.writeDouble(addr, Math.trunc(cpu.fpuGet(0)));
                    cpu.fpuPop();
                    break;
                case 2: // FST m64real — store ST(0)
                    cpu.writeDouble(addr, cpu.fpuGet(0));
                    break;
                case 3: // FSTP m64real — store ST(0), pop
                    cpu.writeDouble(addr, cpu.fpuGet(0));
                    cpu.fpuPop();
                    break;
                case 4: // FRSTOR
                    break; // NOP for now
                case 6: // FNSAVE / FSAVE
                    break; // NOP for now
                case 7: // FNSTSW m16 — store status word
                    cpu.memory.write16(addr, cpu.fpuStatusWord);
                    break;
            }
        }
    });
    // 0xDE: FADDP, FMULP, FCOMPP, FSUBP, FSUBRP, FDIVP, FDIVRP / int16 memory ops
    cpu.register(0xDE, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        if (mod === 3) {
            var st0 = cpu.fpuGet(0);
            var sti = cpu.fpuGet(rm);
            switch (reg) {
                case 0: // FADDP ST(i), ST(0)
                    cpu.fpuSet(rm, sti + st0);
                    cpu.fpuPop();
                    break;
                case 1: // FMULP ST(i), ST(0)
                    cpu.fpuSet(rm, sti * st0);
                    cpu.fpuPop();
                    break;
                case 2: // FCOMP5 (undocumented alias)
                    cpu.fpuCompare(st0, sti);
                    cpu.fpuPop();
                    break;
                case 3: // FCOMPP (only DE D9 = reg=3, rm=1)
                    if (rm === 1) {
                        cpu.fpuCompare(st0, cpu.fpuGet(1));
                        cpu.fpuPop();
                        cpu.fpuPop();
                    }
                    break;
                case 4: // FSUBRP ST(i), ST(0)
                    cpu.fpuSet(rm, st0 - sti);
                    cpu.fpuPop();
                    break;
                case 5: // FSUBP ST(i), ST(0)
                    cpu.fpuSet(rm, sti - st0);
                    cpu.fpuPop();
                    break;
                case 6: // FDIVRP ST(i), ST(0)
                    cpu.fpuSet(rm, st0 / sti);
                    cpu.fpuPop();
                    break;
                case 7: // FDIVP ST(i), ST(0)
                    cpu.fpuSet(rm, sti / st0);
                    cpu.fpuPop();
                    break;
            }
        }
        else {
            // Memory: int16 ops
            var resolved = cpu.resolveRM(mod, rm);
            var addr = cpu.applySegmentOverride(resolved.addr);
            // Read signed 16-bit integer
            var raw = cpu.memory.read16(addr);
            var val = (raw & 0x8000) ? raw - 0x10000 : raw;
            var st0 = cpu.fpuGet(0);
            switch (reg) {
                case 0:
                    cpu.fpuSet(0, st0 + val);
                    break; // FIADD m16int
                case 1:
                    cpu.fpuSet(0, st0 * val);
                    break; // FIMUL m16int
                case 2:
                    cpu.fpuCompare(st0, val);
                    break; // FICOM m16int
                case 3: // FICOMP m16int
                    cpu.fpuCompare(st0, val);
                    cpu.fpuPop();
                    break;
                case 4:
                    cpu.fpuSet(0, st0 - val);
                    break; // FISUB m16int
                case 5:
                    cpu.fpuSet(0, val - st0);
                    break; // FISUBR m16int
                case 6:
                    cpu.fpuSet(0, st0 / val);
                    break; // FIDIV m16int
                case 7:
                    cpu.fpuSet(0, val / st0);
                    break; // FIDIVR m16int
            }
        }
    });
    // 0xDF: FILD int16, FISTP int16, FBLD, FILD int64, FBSTP, FISTP int64, FNSTSW AX
    cpu.register(0xDF, function (cpu) {
        var _a = cpu.decodeModRM(), mod = _a.mod, reg = _a.reg, rm = _a.rm;
        if (mod === 3) {
            if (reg === 4 && rm === 0) {
                // FNSTSW AX (DF E0) — store FPU status word into AX
                cpu.regs[CPU_ts_1.REG.EAX] = (cpu.regs[CPU_ts_1.REG.EAX] & 0xFFFF0000) | (cpu.fpuStatusWord & 0xFFFF);
            }
            else if (reg === 5) {
                // FUCOMIP ST, ST(i) — unordered compare, set EFLAGS, pop
                var a = cpu.fpuGet(0);
                var b = cpu.fpuGet(rm);
                if (isNaN(a) || isNaN(b)) {
                    cpu.setFlag(CPU_ts_1.FLAG.ZF, true);
                    cpu.setFlag(CPU_ts_1.FLAG.CF, true);
                }
                else if (a > b) {
                    cpu.setFlag(CPU_ts_1.FLAG.ZF, false);
                    cpu.setFlag(CPU_ts_1.FLAG.CF, false);
                }
                else if (a < b) {
                    cpu.setFlag(CPU_ts_1.FLAG.ZF, false);
                    cpu.setFlag(CPU_ts_1.FLAG.CF, true);
                }
                else {
                    cpu.setFlag(CPU_ts_1.FLAG.ZF, true);
                    cpu.setFlag(CPU_ts_1.FLAG.CF, false);
                }
                cpu.setFlag(CPU_ts_1.FLAG.OF, false);
                cpu.fpuPop();
            }
            else if (reg === 6) {
                // FCOMIP ST, ST(i) — ordered compare, set EFLAGS, pop
                var a = cpu.fpuGet(0);
                var b = cpu.fpuGet(rm);
                if (isNaN(a) || isNaN(b)) {
                    cpu.setFlag(CPU_ts_1.FLAG.ZF, true);
                    cpu.setFlag(CPU_ts_1.FLAG.CF, true);
                }
                else if (a > b) {
                    cpu.setFlag(CPU_ts_1.FLAG.ZF, false);
                    cpu.setFlag(CPU_ts_1.FLAG.CF, false);
                }
                else if (a < b) {
                    cpu.setFlag(CPU_ts_1.FLAG.ZF, false);
                    cpu.setFlag(CPU_ts_1.FLAG.CF, true);
                }
                else {
                    cpu.setFlag(CPU_ts_1.FLAG.ZF, true);
                    cpu.setFlag(CPU_ts_1.FLAG.CF, false);
                }
                cpu.setFlag(CPU_ts_1.FLAG.OF, false);
                cpu.fpuPop();
            }
        }
        else {
            var resolved = cpu.resolveRM(mod, rm);
            var addr = cpu.applySegmentOverride(resolved.addr);
            switch (reg) {
                case 0: { // FILD m16int
                    var raw = cpu.memory.read16(addr);
                    var val = (raw & 0x8000) ? raw - 0x10000 : raw;
                    cpu.fpuPush(val);
                    break;
                }
                case 1: { // FISTTP m16int — store truncated int16, pop
                    var val = Math.trunc(cpu.fpuGet(0));
                    cpu.memory.write16(addr, val & 0xFFFF);
                    cpu.fpuPop();
                    break;
                }
                case 2: { // FIST m16int
                    var val = Math.round(cpu.fpuGet(0));
                    cpu.memory.write16(addr, val & 0xFFFF);
                    break;
                }
                case 3: { // FISTP m16int
                    var val = Math.round(cpu.fpuGet(0));
                    cpu.memory.write16(addr, val & 0xFFFF);
                    cpu.fpuPop();
                    break;
                }
                case 5: { // FILD m64int — load 64-bit integer
                    var lo = cpu.memory.read32(addr);
                    var hi = cpu.memory.readSigned32(addr + 4);
                    var val = hi * 0x100000000 + lo;
                    cpu.fpuPush(val);
                    break;
                }
                case 7: { // FISTP m64int — store as 64-bit integer, pop
                    var val = cpu.fpuGet(0);
                    var lo = val & 0xFFFFFFFF;
                    var hi = Math.trunc(val / 0x100000000);
                    cpu.memory.write32(addr, lo >>> 0);
                    cpu.memory.write32(addr + 4, hi | 0);
                    cpu.fpuPop();
                    break;
                }
            }
        }
    });
}
