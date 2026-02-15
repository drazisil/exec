import { CPU, REG, FLAG } from "../hardware/CPU.ts";

export function registerAllOpcodes(cpu: CPU): void {
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

function registerDataMovement(cpu: CPU): void {
    // MOV r/m32, r32 (or r/m16, r16 with 0x66 prefix)
    cpu.register(0x89, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        if (cpu.operandSizeOverride) {
            cpu.writeRMv(mod, rm, cpu.regs[reg] & 0xFFFF);
        } else {
            cpu.writeRM32(mod, rm, cpu.regs[reg]);
        }
    });

    // MOV r32, r/m32 (or r16, r/m16 with 0x66 prefix)
    cpu.register(0x8B, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        if (cpu.operandSizeOverride) {
            const val = cpu.readRMv(mod, rm);
            cpu.regs[reg] = (cpu.regs[reg] & 0xFFFF0000) | (val & 0xFFFF);
        } else {
            cpu.regs[reg] = cpu.readRM32(mod, rm);
        }
    });

    // MOV r32, imm32 (0xB8 + rd)
    for (let r = 0; r < 8; r++) {
        cpu.register(0xB8 + r, (cpu) => {
            cpu.regs[r] = cpu.fetch32();
        });
    }

    // MOV r/m32, imm32 (or MOV r/m16, imm16 with 0x66 prefix)
    cpu.register(0xC7, (cpu) => {
        const { mod, rm } = cpu.decodeModRM();
        // Must resolve the address FIRST (consuming disp8/disp32 from the instruction
        // stream) before reading the immediate value that follows.
        const resolved = cpu.resolveRM(mod, rm);
        if (cpu.operandSizeOverride) {
            const imm = cpu.fetch16();
            if (resolved.isReg) {
                cpu.regs[resolved.addr] = (cpu.regs[resolved.addr] & 0xFFFF0000) | imm;
            } else {
                cpu.memory.write16(cpu.applySegmentOverride(resolved.addr), imm);
            }
        } else {
            const imm = cpu.fetch32();
            if (resolved.isReg) {
                cpu.regs[resolved.addr] = imm >>> 0;
            } else {
                const addr = cpu.applySegmentOverride(resolved.addr);
                cpu.memory.write32(addr, imm >>> 0);
            }
        }
    });

    // MOV AL, [disp32] (also handles FS:/GS: segment override)
    cpu.register(0xA0, (cpu) => {
        const addr = cpu.applySegmentOverride(cpu.fetch32());
        cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFFFF00) | cpu.memory.read8(addr);
    });

    // MOV EAX, [disp32] (also handles FS:/GS: segment override)
    cpu.register(0xA1, (cpu) => {
        const addr = cpu.applySegmentOverride(cpu.fetch32());
        cpu.regs[REG.EAX] = cpu.memory.read32(addr);
    });

    // MOV [disp32], AL (also handles FS:/GS: segment override)
    cpu.register(0xA2, (cpu) => {
        const addr = cpu.applySegmentOverride(cpu.fetch32());
        cpu.memory.write8(addr, cpu.regs[REG.EAX] & 0xFF);
    });

    // MOV [disp32], EAX (also handles FS:/GS: segment override)
    cpu.register(0xA3, (cpu) => {
        const addr = cpu.applySegmentOverride(cpu.fetch32());
        cpu.memory.write32(addr, cpu.regs[REG.EAX]);
    });

    // LEA r32, [r/m32]
    cpu.register(0x8D, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const resolved = cpu.resolveRM(mod, rm);
        cpu.regs[reg] = resolved.addr;
    });
}

// ============================================================
// Arithmetic
// ============================================================

function registerArithmetic(cpu: CPU): void {
    // ADD r/m8, r8
    cpu.register(0x00, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM8(mod, rm);
        const op2 = cpu.readReg8(reg);
        const result = (op1 + op2) & 0xFF;
        cpu.writeRM8(mod, rm, result);
        cpu.updateFlagsArith(op1 + op2, op1, op2, false);
    });

    // ADD r/m32, r32
    cpu.register(0x01, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM32(mod, rm);
        const op2 = cpu.regs[reg];
        const result = (op1 + op2) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsArith(op1 + op2, op1, op2, false);
    });

    // ADD r8, r/m8
    cpu.register(0x02, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readReg8(reg);
        const op2 = cpu.readRM8(mod, rm);
        const result = (op1 + op2) & 0xFF;
        cpu.writeReg8(reg, result);
        cpu.updateFlagsArith(op1 + op2, op1, op2, false);
    });

    // ADD r32, r/m32
    cpu.register(0x03, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.regs[reg];
        const op2 = cpu.readRM32(mod, rm);
        const result = (op1 + op2) >>> 0;
        cpu.regs[reg] = result;
        cpu.updateFlagsArith(op1 + op2, op1, op2, false);
    });

    // ADD AL, imm8
    cpu.register(0x04, (cpu) => {
        const imm = cpu.fetch8();
        const al = cpu.regs[REG.EAX] & 0xFF;
        const result = (al + imm) & 0xFF;
        cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFFFF00) | result;
        cpu.updateFlagsArith(al + imm, al, imm, false);
    });

    // ADC r/m8, r8
    cpu.register(0x10, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM8(mod, rm);
        const op2 = cpu.readReg8(reg);
        const carry = cpu.getFlag(FLAG.CF) ? 1 : 0;
        const result = (op1 + op2 + carry) & 0xFF;
        cpu.writeRM8(mod, rm, result);
        cpu.updateFlagsArith(op1 + op2 + carry, op1, op2 + carry, false);
    });

    // ADC r8, r/m8
    cpu.register(0x12, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readReg8(reg);
        const op2 = cpu.readRM8(mod, rm);
        const carry = cpu.getFlag(FLAG.CF) ? 1 : 0;
        const result = (op1 + op2 + carry) & 0xFF;
        cpu.writeReg8(reg, result);
        cpu.updateFlagsArith(op1 + op2 + carry, op1, op2 + carry, false);
    });

    // SBB r/m8, r8
    cpu.register(0x18, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM8(mod, rm);
        const op2 = cpu.readReg8(reg);
        const borrow = cpu.getFlag(FLAG.CF) ? 1 : 0;
        const result = (op1 - op2 - borrow) & 0xFF;
        cpu.writeRM8(mod, rm, result);
        cpu.updateFlagsArith(op1 - op2 - borrow, op1, op2 + borrow, true);
    });

    // AND r8, r/m8
    cpu.register(0x22, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const result = (cpu.readReg8(reg) & cpu.readRM8(mod, rm)) & 0xFF;
        cpu.writeReg8(reg, result);
        cpu.updateFlagsLogic(result);
    });

    // SUB r/m8, r8
    cpu.register(0x28, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM8(mod, rm);
        const op2 = cpu.readReg8(reg);
        const result = (op1 - op2) & 0xFF;
        cpu.writeRM8(mod, rm, result);
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });

    // SUB r8, r/m8
    cpu.register(0x2A, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readReg8(reg);
        const op2 = cpu.readRM8(mod, rm);
        const result = (op1 - op2) & 0xFF;
        cpu.writeReg8(reg, result);
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });

    // SUB r/m32, r32
    cpu.register(0x29, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM32(mod, rm);
        const op2 = cpu.regs[reg];
        const result = (op1 - op2) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });

    // SUB r32, r/m32
    cpu.register(0x2B, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.regs[reg];
        const op2 = cpu.readRM32(mod, rm);
        const result = (op1 - op2) >>> 0;
        cpu.regs[reg] = result;
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });

    // SBB r8, r/m8 (subtract with borrow, byte)
    cpu.register(0x1A, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readReg8(reg);
        const op2 = cpu.readRM8(mod, rm);
        const borrow = cpu.getFlag(FLAG.CF) ? 1 : 0;
        const result = (op1 - op2 - borrow) & 0xFF;
        cpu.writeReg8(reg, result);
        cpu.updateFlagsArith(op1 - op2 - borrow, op1, op2 + borrow, true);
    });

    // SBB r/m32, r32 (subtract with borrow)
    cpu.register(0x19, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM32(mod, rm);
        const op2 = cpu.regs[reg];
        const borrow = cpu.getFlag(FLAG.CF) ? 1 : 0;
        const result = (op1 - op2 - borrow) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsArith(op1 - op2 - borrow, op1, op2 + borrow, true);
    });

    // SBB r32, r/m32 (subtract with borrow)
    cpu.register(0x1B, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.regs[reg];
        const op2 = cpu.readRM32(mod, rm);
        const borrow = cpu.getFlag(FLAG.CF) ? 1 : 0;
        const result = (op1 - op2 - borrow) >>> 0;
        cpu.regs[reg] = result;
        cpu.updateFlagsArith(op1 - op2 - borrow, op1, op2 + borrow, true);
    });

    // ADC r/m32, r32 (add with carry)
    cpu.register(0x11, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM32(mod, rm);
        const op2 = cpu.regs[reg];
        const carry = cpu.getFlag(FLAG.CF) ? 1 : 0;
        const result = (op1 + op2 + carry) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsArith(op1 + op2 + carry, op1, op2 + carry, false);
    });

    // ADC r32, r/m32 (add with carry)
    cpu.register(0x13, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.regs[reg];
        const op2 = cpu.readRM32(mod, rm);
        const carry = cpu.getFlag(FLAG.CF) ? 1 : 0;
        const result = (op1 + op2 + carry) >>> 0;
        cpu.regs[reg] = result;
        cpu.updateFlagsArith(op1 + op2 + carry, op1, op2 + carry, false);
    });

    // CMP r/m32, r32
    cpu.register(0x39, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM32(mod, rm);
        const op2 = cpu.regs[reg];
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });

    // CMP r32, r/m32
    cpu.register(0x3B, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.regs[reg];
        const op2 = cpu.readRM32(mod, rm);
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });

    // Group 1: 0x81 — op r/m32, imm32
    cpu.register(0x81, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM32(mod, rm);
        const imm = cpu.fetch32();
        doGroup1(cpu, mod, rm, reg, op1, imm);
    });

    // Group 1: 0x83 — op r/m32, imm8 (sign-extended)
    cpu.register(0x83, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM32(mod, rm);
        const imm = (cpu.fetchSigned8() & 0xFFFFFFFF) >>> 0;
        doGroup1(cpu, mod, rm, reg, op1, imm);
    });

    // INC r32 (0x40 + rd)
    for (let r = 0; r < 8; r++) {
        cpu.register(0x40 + r, (cpu) => {
            const op1 = cpu.regs[r];
            const result = (op1 + 1) >>> 0;
            cpu.regs[r] = result;
            // INC does not affect CF
            const savedCF = cpu.getFlag(FLAG.CF);
            cpu.updateFlagsArith(op1 + 1, op1, 1, false);
            cpu.setFlag(FLAG.CF, savedCF);
        });
    }

    // DEC r32 (0x48 + rd)
    for (let r = 0; r < 8; r++) {
        cpu.register(0x48 + r, (cpu) => {
            const op1 = cpu.regs[r];
            const result = (op1 - 1) >>> 0;
            cpu.regs[r] = result;
            // DEC does not affect CF
            const savedCF = cpu.getFlag(FLAG.CF);
            cpu.updateFlagsArith(op1 - 1, op1, 1, true);
            cpu.setFlag(FLAG.CF, savedCF);
        });
    }

    // Group 2: 0xC1 — op r/m32, imm8 (shift/rotate)
    cpu.register(0xC1, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const val = cpu.readRM32(mod, rm);
        const count = cpu.fetch8() & 0x1F; // Only lower 5 bits used for 32-bit
        doGroup2(cpu, mod, rm, reg, val, count);
    });

    // Group 2: 0xD1 — op r/m32, 1 (shift/rotate by 1)
    cpu.register(0xD1, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const val = cpu.readRM32(mod, rm);
        doGroup2(cpu, mod, rm, reg, val, 1);
    });

    // Group 2: 0xD3 — op r/m32, CL (shift/rotate by CL)
    cpu.register(0xD3, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const val = cpu.readRM32(mod, rm);
        const count = cpu.regs[REG.ECX] & 0x1F;
        doGroup2(cpu, mod, rm, reg, val, count);
    });

    // IMUL r32, r/m32, imm8 (three-operand signed multiply)
    cpu.register(0x6B, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM32(mod, rm) | 0;
        const imm = cpu.fetchSigned8();
        const result = Math.imul(op1, imm);
        cpu.regs[reg] = result >>> 0;
        const full = BigInt(op1) * BigInt(imm);
        const overflow = full !== BigInt(result);
        cpu.setFlag(FLAG.CF, overflow);
        cpu.setFlag(FLAG.OF, overflow);
    });

    // IMUL r32, r/m32, imm32 (three-operand signed multiply)
    cpu.register(0x69, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM32(mod, rm) | 0;
        const imm = cpu.fetchSigned32();
        const result = Math.imul(op1, imm);
        cpu.regs[reg] = result >>> 0;
        const full = BigInt(op1) * BigInt(imm);
        const overflow = full !== BigInt(result);
        cpu.setFlag(FLAG.CF, overflow);
        cpu.setFlag(FLAG.OF, overflow);
    });

    // NEG r/m32 (Group 3, 0xF7 /3) - handled in Group 3 below
    // Group 3: 0xF7 — op r/m32
    cpu.register(0xF7, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        switch (reg) {
            case 0: { // TEST r/m32, imm32
                const op1 = cpu.readRM32(mod, rm);
                const imm = cpu.fetch32();
                cpu.updateFlagsLogic((op1 & imm) >>> 0);
                break;
            }
            case 2: { // NOT r/m32
                const val = cpu.readRM32(mod, rm);
                cpu.writeRM32(mod, rm, (~val) >>> 0);
                break;
            }
            case 3: { // NEG r/m32
                const val = cpu.readRM32(mod, rm);
                const result = (0 - val) >>> 0;
                cpu.writeRM32(mod, rm, result);
                cpu.setFlag(FLAG.CF, val !== 0);
                cpu.updateFlagsArith(0 - val, 0, val, true);
                break;
            }
            case 4: { // MUL r/m32 (unsigned EAX * r/m32 -> EDX:EAX)
                const op1 = cpu.regs[REG.EAX] >>> 0;
                const op2 = cpu.readRM32(mod, rm) >>> 0;
                const result = BigInt(op1) * BigInt(op2);
                cpu.regs[REG.EAX] = Number(result & 0xFFFFFFFFn) >>> 0;
                cpu.regs[REG.EDX] = Number((result >> 32n) & 0xFFFFFFFFn) >>> 0;
                const overflow = cpu.regs[REG.EDX] !== 0;
                cpu.setFlag(FLAG.CF, overflow);
                cpu.setFlag(FLAG.OF, overflow);
                break;
            }
            case 5: { // IMUL r/m32 (signed EAX * r/m32 -> EDX:EAX)
                const op1 = cpu.regs[REG.EAX] | 0;
                const op2 = cpu.readRM32(mod, rm) | 0;
                const result = BigInt(op1) * BigInt(op2);
                cpu.regs[REG.EAX] = Number(result & 0xFFFFFFFFn) >>> 0;
                cpu.regs[REG.EDX] = Number((result >> 32n) & 0xFFFFFFFFn) >>> 0;
                // OF/CF set if EDX is not sign extension of EAX
                const signExt = (cpu.regs[REG.EAX] & 0x80000000) ? 0xFFFFFFFF : 0;
                cpu.setFlag(FLAG.CF, cpu.regs[REG.EDX] !== signExt);
                cpu.setFlag(FLAG.OF, cpu.regs[REG.EDX] !== signExt);
                break;
            }
            case 6: { // DIV r/m32 (unsigned EDX:EAX / r/m32 -> EAX=quot, EDX=rem)
                const divisor = cpu.readRM32(mod, rm) >>> 0;
                if (divisor === 0) throw new Error("Division by zero");
                const dividend = (BigInt(cpu.regs[REG.EDX] >>> 0) << 32n) | BigInt(cpu.regs[REG.EAX] >>> 0);
                const quotient = dividend / BigInt(divisor);
                const remainder = dividend % BigInt(divisor);
                if (quotient > 0xFFFFFFFFn) throw new Error("Division overflow");
                cpu.regs[REG.EAX] = Number(quotient) >>> 0;
                cpu.regs[REG.EDX] = Number(remainder) >>> 0;
                break;
            }
            case 7: { // IDIV r/m32 (signed EDX:EAX / r/m32)
                const divisor = cpu.readRM32(mod, rm) | 0;
                if (divisor === 0) throw new Error("Division by zero");
                const dividend = (BigInt(cpu.regs[REG.EDX] | 0) << 32n) | BigInt(cpu.regs[REG.EAX] >>> 0);
                const quotient = dividend / BigInt(divisor);
                const remainder = dividend % BigInt(divisor);
                cpu.regs[REG.EAX] = Number(quotient & 0xFFFFFFFFn) >>> 0;
                cpu.regs[REG.EDX] = Number(remainder & 0xFFFFFFFFn) >>> 0;
                break;
            }
            default:
                throw new Error(`Unsupported Group 3 extension: /${reg}`);
        }
    });

    // Group 3 byte: 0xF6 — op r/m8
    cpu.register(0xF6, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const val = cpu.readRM8(mod, rm);

        switch (reg) {
            case 0: { // TEST r/m8, imm8
                const imm = cpu.fetch8();
                cpu.updateFlagsLogic((val & imm) & 0xFF);
                break;
            }
            case 2: { // NOT r/m8
                cpu.writeRM8(mod, rm, (~val) & 0xFF);
                break;
            }
            case 3: { // NEG r/m8
                const result = (0 - val) & 0xFF;
                cpu.writeRM8(mod, rm, result);
                cpu.setFlag(FLAG.CF, val !== 0);
                cpu.updateFlagsArith(0 - val, 0, val, true);
                break;
            }
            case 4: { // MUL AL, r/m8 (AX = AL * r/m8)
                const al = cpu.regs[REG.EAX] & 0xFF;
                const result = al * val;
                cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFF0000) | (result & 0xFFFF);
                cpu.setFlag(FLAG.CF, (result & 0xFF00) !== 0);
                cpu.setFlag(FLAG.OF, (result & 0xFF00) !== 0);
                break;
            }
            case 5: { // IMUL AL, r/m8 (signed: AX = AL * r/m8)
                const al = (cpu.regs[REG.EAX] << 24) >> 24; // sign-extend AL
                const sval = (val << 24) >> 24; // sign-extend operand
                const result = al * sval;
                cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFF0000) | (result & 0xFFFF);
                const signExt = ((result & 0xFF) << 24) >> 24;
                cpu.setFlag(FLAG.CF, result !== signExt);
                cpu.setFlag(FLAG.OF, result !== signExt);
                break;
            }
            case 6: { // DIV AL, r/m8 (AX / r/m8 -> AL=quot, AH=rem)
                if (val === 0) throw new Error("Division by zero (byte)");
                const ax = cpu.regs[REG.EAX] & 0xFFFF;
                const quot = Math.trunc(ax / val) & 0xFF;
                const rem = (ax % val) & 0xFF;
                cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFF0000) | (rem << 8) | quot;
                break;
            }
            case 7: { // IDIV AL, r/m8 (signed)
                const sval8 = (val << 24) >> 24;
                if (sval8 === 0) throw new Error("Division by zero (signed byte)");
                const ax = (cpu.regs[REG.EAX] << 16) >> 16; // sign-extend AX
                const quot = Math.trunc(ax / sval8) & 0xFF;
                const rem = (ax % sval8) & 0xFF;
                cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFF0000) | (rem << 8) | quot;
                break;
            }
            default:
                throw new Error(`Unsupported Group 3 byte extension: /${reg}`);
        }
    });

    // CDQ (sign-extend EAX into EDX:EAX)
    cpu.register(0x99, (cpu) => {
        cpu.regs[REG.EDX] = (cpu.regs[REG.EAX] & 0x80000000) ? 0xFFFFFFFF : 0;
    });

    // XCHG r8, r/m8
    cpu.register(0x86, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const val1 = cpu.readReg8(reg);
        const val2 = cpu.readRM8(mod, rm);
        cpu.writeReg8(reg, val2);
        cpu.writeRM8(mod, rm, val1);
    });

    // XCHG r32, r/m32
    cpu.register(0x87, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const val1 = cpu.regs[reg];
        const val2 = cpu.readRM32(mod, rm);
        cpu.regs[reg] = val2;
        cpu.writeRM32(mod, rm, val1);
    });

    // XCHG EAX, r32 (0x90+r, but 0x90 is NOP which is XCHG EAX, EAX)
    // Already have NOP at 0x90, add 0x91-0x97
    for (let r = 1; r < 8; r++) {
        cpu.register(0x90 + r, (cpu) => {
            const tmp = cpu.regs[REG.EAX];
            cpu.regs[REG.EAX] = cpu.regs[r];
            cpu.regs[r] = tmp;
        });
    }

    // MOV r/m8, r8
    cpu.register(0x88, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const val = cpu.readReg8(reg);
        cpu.writeRM8(mod, rm, val);
    });

    // MOV r8, r/m8
    cpu.register(0x8A, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const val = cpu.readRM8(mod, rm);
        cpu.writeReg8(reg, val);
    });

    // MOV r8, imm8 (0xB0 + rb)
    for (let r = 0; r < 8; r++) {
        cpu.register(0xB0 + r, (cpu) => {
            const imm = cpu.fetch8();
            // Low registers: AL=0, CL=1, DL=2, BL=3; High: AH=4, CH=5, DH=6, BH=7
            if (r < 4) {
                cpu.regs[r] = (cpu.regs[r] & 0xFFFFFF00) | imm;
            } else {
                cpu.regs[r - 4] = (cpu.regs[r - 4] & 0xFFFF00FF) | (imm << 8);
            }
        });
    }

    // MOV r/m8, imm8 (0xC6 /0)
    cpu.register(0xC6, (cpu) => {
        const { mod, rm } = cpu.decodeModRM();
        // Must resolve address FIRST (consuming disp8/disp32) before reading immediate
        const resolved = cpu.resolveRM(mod, rm);
        const imm = cpu.fetch8();
        if (resolved.isReg) {
            cpu.regs[resolved.addr] = (cpu.regs[resolved.addr] & 0xFFFFFF00) | imm;
        } else {
            cpu.memory.write8(cpu.applySegmentOverride(resolved.addr), imm);
        }
    });

    // Group 1 byte: 0x80 — op r/m8, imm8
    cpu.register(0x80, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM8(mod, rm);
        const imm = cpu.fetch8();
        let result: number;
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
                const carry = cpu.getFlag(FLAG.CF) ? 1 : 0;
                result = (op1 + imm + carry) & 0xFF;
                cpu.writeRM8(mod, rm, result);
                cpu.updateFlagsArith(op1 + imm + carry, op1, imm + carry, false);
                break;
            }
            case 3: { // SBB
                const borrow = cpu.getFlag(FLAG.CF) ? 1 : 0;
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

    // LES r32, m16:32 - Load ES and register from far pointer (in flat model: load 32-bit value, ignore ES)
    cpu.register(0xC4, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const resolved = cpu.resolveRM(mod, rm);
        if (!resolved.isReg) {
            const addr = cpu.applySegmentOverride(resolved.addr);
            cpu.regs[reg] = cpu.memory.read32(addr);
            // ES segment selector at addr+4 ignored (flat model)
        }
    });

    // LDS r32, m16:32 - Load DS and register from far pointer (in flat model: load 32-bit value, ignore DS)
    cpu.register(0xC5, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const resolved = cpu.resolveRM(mod, rm);
        if (!resolved.isReg) {
            const addr = cpu.applySegmentOverride(resolved.addr);
            cpu.regs[reg] = cpu.memory.read32(addr);
            // DS segment selector at addr+4 ignored (flat model)
        }
    });

    // RET imm16 (return and pop imm16 bytes from stack)
    cpu.register(0xC2, (cpu) => {
        const retAddr = cpu.pop32();
        const imm = cpu.fetch16();
        cpu.regs[REG.ESP] = (cpu.regs[REG.ESP] + imm) >>> 0;
        cpu.eip = retAddr;
    });

    // LEAVE (equivalent to MOV ESP, EBP; POP EBP)
    cpu.register(0xC9, (cpu) => {
        cpu.regs[REG.ESP] = cpu.regs[REG.EBP];
        cpu.regs[REG.EBP] = cpu.pop32();
    });

    // CALL rel32 is already registered
    // CALL r/m32 is in Group 5

    // TEST EAX, imm32
    cpu.register(0xA9, (cpu) => {
        const imm = cpu.fetch32();
        cpu.updateFlagsLogic((cpu.regs[REG.EAX] & imm) >>> 0);
    });

    // TEST AL, imm8
    cpu.register(0xA8, (cpu) => {
        const imm = cpu.fetch8();
        cpu.updateFlagsLogic((cpu.regs[REG.EAX] & imm) & 0xFF);
    });

    // CMP r/m8, r8
    cpu.register(0x38, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM8(mod, rm);
        const op2 = cpu.readReg8(reg);
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });

    // CMP r8, r/m8
    cpu.register(0x3A, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readReg8(reg);
        const op2 = cpu.readRM8(mod, rm);
        cpu.updateFlagsArith(op1 - op2, op1, op2, true);
    });
}

function doGroup1(cpu: CPU, mod: number, rm: number, opExt: number, op1: number, op2: number): void {
    switch (opExt) {
        case 0: { // ADD
            const result = (op1 + op2) >>> 0;
            cpu.writeRM32(mod, rm, result);
            cpu.updateFlagsArith(op1 + op2, op1, op2, false);
            break;
        }
        case 1: { // OR
            const result = (op1 | op2) >>> 0;
            cpu.writeRM32(mod, rm, result);
            cpu.updateFlagsLogic(result);
            break;
        }
        case 2: { // ADC (add with carry)
            const carry = cpu.getFlag(FLAG.CF) ? 1 : 0;
            const result = (op1 + op2 + carry) >>> 0;
            cpu.writeRM32(mod, rm, result);
            cpu.updateFlagsArith(op1 + op2 + carry, op1, op2 + carry, false);
            break;
        }
        case 3: { // SBB (subtract with borrow)
            const borrow = cpu.getFlag(FLAG.CF) ? 1 : 0;
            const result = (op1 - op2 - borrow) >>> 0;
            cpu.writeRM32(mod, rm, result);
            cpu.updateFlagsArith(op1 - op2 - borrow, op1, op2 + borrow, true);
            break;
        }
        case 4: { // AND
            const result = (op1 & op2) >>> 0;
            cpu.writeRM32(mod, rm, result);
            cpu.updateFlagsLogic(result);
            break;
        }
        case 5: { // SUB
            const result = (op1 - op2) >>> 0;
            cpu.writeRM32(mod, rm, result);
            cpu.updateFlagsArith(op1 - op2, op1, op2, true);
            break;
        }
        case 6: { // XOR
            const result = (op1 ^ op2) >>> 0;
            cpu.writeRM32(mod, rm, result);
            cpu.updateFlagsLogic(result);
            break;
        }
        case 7: { // CMP
            cpu.updateFlagsArith(op1 - op2, op1, op2, true);
            break;
        }
        default:
            throw new Error(`Unsupported Group 1 extension: /${opExt}`);
    }
}

function doGroup2(cpu: CPU, mod: number, rm: number, opExt: number, val: number, count: number): void {
    if (count === 0) {
        // No shift, but still write back the value and return early
        cpu.writeRM32(mod, rm, val);
        return;
    }

    let result: number;
    let newCF: boolean = false;

    switch (opExt) {
        case 0: { // ROL (rotate left)
            result = ((val << count) | (val >>> (32 - count))) >>> 0;
            newCF = (result & 1) !== 0;
            cpu.writeRM32(mod, rm, result);
            cpu.setFlag(FLAG.CF, newCF);
            // OF set if bit 31 changed
            if (count === 1) {
                const msb = (result & 0x80000000) !== 0;
                const ofVal = msb !== (((result >>> 1) & 0x40000000) !== 0);
                cpu.setFlag(FLAG.OF, ofVal);
            }
            break;
        }
        case 1: { // ROR (rotate right)
            result = ((val >>> count) | (val << (32 - count))) >>> 0;
            newCF = (result & 0x80000000) !== 0;
            cpu.writeRM32(mod, rm, result);
            cpu.setFlag(FLAG.CF, newCF);
            // OF set if bit 31 changed
            if (count === 1) {
                const msb = (result & 0x80000000) !== 0;
                const ofVal = msb !== (((val >>> 31) & 1) !== 0);
                cpu.setFlag(FLAG.OF, ofVal);
            }
            break;
        }
        case 2: { // RCL (rotate through carry left)
            // Complex: carry is part of rotation
            let temp = ((val << count) >>> 0);
            if (cpu.getFlag(FLAG.CF)) {
                temp |= (1 << (count - 1));
            }
            newCF = (val >>> (32 - count)) & 1 ? true : false;
            result = temp;
            cpu.writeRM32(mod, rm, result);
            cpu.setFlag(FLAG.CF, newCF);
            break;
        }
        case 3: { // RCR (rotate through carry right)
            // Complex: carry is part of rotation
            let temp = (val >>> count);
            if (cpu.getFlag(FLAG.CF)) {
                temp |= (1 << (32 - count));
            }
            newCF = (val >>> (count - 1)) & 1 ? true : false;
            result = (temp >>> 0);
            cpu.writeRM32(mod, rm, result);
            cpu.setFlag(FLAG.CF, newCF);
            break;
        }
        case 4: { // SHL/SAL (shift left)
            result = ((val << count) >>> 0);
            newCF = (val >>> (32 - count)) & 1 ? true : false;
            cpu.writeRM32(mod, rm, result);
            cpu.setFlag(FLAG.CF, newCF);
            cpu.updateFlagsLogic(result); // Sets ZF, SF, OF for logical operations
            break;
        }
        case 5: { // SHR (shift right logical)
            result = (val >>> count);
            newCF = (val >>> (count - 1)) & 1 ? true : false;
            cpu.writeRM32(mod, rm, result);
            cpu.setFlag(FLAG.CF, newCF);
            cpu.updateFlagsLogic(result);
            break;
        }
        case 7: { // SAR (shift right arithmetic / sign-extend)
            const sign = (val & 0x80000000) ? -1 : 0;
            result = (sign << (32 - count)) | (val >> count);
            newCF = (val >>> (count - 1)) & 1 ? true : false;
            cpu.writeRM32(mod, rm, result >>> 0);
            cpu.setFlag(FLAG.CF, newCF);
            cpu.updateFlagsLogic(result >>> 0);
            break;
        }
        default:
            throw new Error(`Unsupported Group 2 extension: /${opExt}`);
    }
}

// ============================================================
// Logic
// ============================================================

function registerLogic(cpu: CPU): void {
    // OR r/m8, r8
    cpu.register(0x08, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const val1 = cpu.readRM8(mod, rm);
        const val2 = cpu.readReg8(reg);
        const result = (val1 | val2) & 0xFF;
        cpu.writeRM8(mod, rm, result);
        cpu.updateFlagsLogic(result);
    });

    // OR r8, r/m8
    cpu.register(0x0A, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const val1 = cpu.readReg8(reg);
        const val2 = cpu.readRM8(mod, rm);
        const result = (val1 | val2) & 0xFF;
        cpu.writeReg8(reg, result);
        cpu.updateFlagsLogic(result);
    });

    // AND r/m8, r8
    cpu.register(0x20, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const val1 = cpu.readRM8(mod, rm);
        const val2 = cpu.readReg8(reg);
        const result = (val1 & val2) & 0xFF;
        cpu.writeRM8(mod, rm, result);
        cpu.updateFlagsLogic(result);
    });

    // AND r32, r/m32
    cpu.register(0x21, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const result = (cpu.readRM32(mod, rm) & cpu.regs[reg]) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsLogic(result);
    });

    // AND r32, r/m32
    cpu.register(0x23, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const result = (cpu.regs[reg] & cpu.readRM32(mod, rm)) >>> 0;
        cpu.regs[reg] = result;
        cpu.updateFlagsLogic(result);
    });

    // OR r/m32, r32
    cpu.register(0x09, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const result = (cpu.readRM32(mod, rm) | cpu.regs[reg]) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsLogic(result);
    });

    // OR r32, r/m32
    cpu.register(0x0B, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const result = (cpu.regs[reg] | cpu.readRM32(mod, rm)) >>> 0;
        cpu.regs[reg] = result;
        cpu.updateFlagsLogic(result);
    });

    // XOR r/m8, r8
    cpu.register(0x30, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const result = (cpu.readRM8(mod, rm) ^ cpu.readReg8(reg)) & 0xFF;
        cpu.writeRM8(mod, rm, result);
        cpu.updateFlagsLogic(result);
    });

    // XOR r/m32, r32
    cpu.register(0x31, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const result = (cpu.readRM32(mod, rm) ^ cpu.regs[reg]) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsLogic(result);
    });

    // XOR r8, r/m8
    cpu.register(0x32, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const result = (cpu.readReg8(reg) ^ cpu.readRM8(mod, rm)) & 0xFF;
        cpu.writeReg8(reg, result);
        cpu.updateFlagsLogic(result);
    });

    // XOR r32, r/m32
    cpu.register(0x33, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const result = (cpu.regs[reg] ^ cpu.readRM32(mod, rm)) >>> 0;
        cpu.regs[reg] = result;
        cpu.updateFlagsLogic(result);
    });

    // TEST r/m8, r8
    cpu.register(0x84, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const result = (cpu.readRM8(mod, rm) & cpu.readReg8(reg)) & 0xFF;
        cpu.updateFlagsLogic(result);
    });

    // TEST r/m32, r32
    cpu.register(0x85, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const result = (cpu.readRM32(mod, rm) & cpu.regs[reg]) >>> 0;
        cpu.updateFlagsLogic(result);
    });

    // Accumulator immediate operations (no ModR/M)
    // 0x05: ADD EAX, imm32
    cpu.register(0x05, (cpu) => {
        const imm = cpu.fetch32();
        const result = (cpu.regs[REG.EAX] + imm) >>> 0;
        cpu.updateFlagsArith(cpu.regs[REG.EAX] + imm, cpu.regs[REG.EAX], imm, false);
        cpu.regs[REG.EAX] = result;
    });

    // 0x0C: OR AL, imm8
    cpu.register(0x0C, (cpu) => {
        const imm = cpu.fetch8();
        const al = cpu.regs[REG.EAX] & 0xFF;
        const result = al | imm;
        cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFFFF00) | result;
        cpu.updateFlagsLogic(result);
    });

    // 0x24: AND AL, imm8
    cpu.register(0x24, (cpu) => {
        const imm = cpu.fetch8();
        const al = cpu.regs[REG.EAX] & 0xFF;
        const result = al & imm;
        cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFFFF00) | result;
        cpu.updateFlagsLogic(result);
    });

    // 0x0D: OR EAX, imm32
    cpu.register(0x0D, (cpu) => {
        const imm = cpu.fetch32();
        const result = (cpu.regs[REG.EAX] | imm) >>> 0;
        cpu.updateFlagsLogic(result);
        cpu.regs[REG.EAX] = result;
    });

    // 0x15: ADC EAX, imm32 (add with carry)
    cpu.register(0x15, (cpu) => {
        const imm = cpu.fetch32();
        const carry = cpu.getFlag(FLAG.CF) ? 1 : 0;
        const result = (cpu.regs[REG.EAX] + imm + carry) >>> 0;
        cpu.updateFlagsArith(cpu.regs[REG.EAX] + imm + carry, cpu.regs[REG.EAX], imm + carry, false);
        cpu.regs[REG.EAX] = result;
    });

    // 0x14: ADC AL, imm8
    cpu.register(0x14, (cpu) => {
        const imm = cpu.fetch8();
        const al = cpu.regs[REG.EAX] & 0xFF;
        const carry = cpu.getFlag(FLAG.CF) ? 1 : 0;
        const result = (al + imm + carry) & 0xFF;
        cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFFFF00) | result;
        cpu.updateFlagsArith(al + imm + carry, al, imm + carry, false);
    });

    // 0x1C: SBB AL, imm8
    cpu.register(0x1C, (cpu) => {
        const imm = cpu.fetch8();
        const al = cpu.regs[REG.EAX] & 0xFF;
        const borrow = cpu.getFlag(FLAG.CF) ? 1 : 0;
        const result = (al - imm - borrow) & 0xFF;
        cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFFFF00) | result;
        cpu.updateFlagsArith(al - imm - borrow, al, imm + borrow, true);
    });

    // 0x1D: SBB EAX, imm32 (subtract with borrow)
    cpu.register(0x1D, (cpu) => {
        const imm = cpu.fetch32();
        const borrow = cpu.getFlag(FLAG.CF) ? 1 : 0;
        const result = (cpu.regs[REG.EAX] - imm - borrow) >>> 0;
        cpu.updateFlagsArith(cpu.regs[REG.EAX] - imm - borrow, cpu.regs[REG.EAX], imm + borrow, true);
        cpu.regs[REG.EAX] = result;
    });

    // 0x25: AND EAX, imm32
    cpu.register(0x25, (cpu) => {
        const imm = cpu.fetch32();
        const result = (cpu.regs[REG.EAX] & imm) >>> 0;
        cpu.updateFlagsLogic(result);
        cpu.regs[REG.EAX] = result;
    });

    // 0x2C: SUB AL, imm8
    cpu.register(0x2C, (cpu) => {
        const imm = cpu.fetch8();
        const al = cpu.regs[REG.EAX] & 0xFF;
        const result = (al - imm) & 0xFF;
        cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFFFF00) | result;
        cpu.updateFlagsArith(al - imm, al, imm, true);
    });

    // 0x2D: SUB EAX, imm32
    cpu.register(0x2D, (cpu) => {
        const imm = cpu.fetch32();
        const result = (cpu.regs[REG.EAX] - imm) >>> 0;
        cpu.updateFlagsArith(cpu.regs[REG.EAX] - imm, cpu.regs[REG.EAX], imm, true);
        cpu.regs[REG.EAX] = result;
    });

    // 0x35: XOR EAX, imm32
    cpu.register(0x35, (cpu) => {
        const imm = cpu.fetch32();
        const result = (cpu.regs[REG.EAX] ^ imm) >>> 0;
        cpu.updateFlagsLogic(result);
        cpu.regs[REG.EAX] = result;
    });

    // 0x3C: CMP AL, imm8
    cpu.register(0x3C, (cpu) => {
        const imm = cpu.fetch8();
        const al = cpu.regs[REG.EAX] & 0xFF;
        cpu.updateFlagsArith(al - imm, al, imm, true);
    });

    // 0x3D: CMP EAX, imm32
    cpu.register(0x3D, (cpu) => {
        const imm = cpu.fetch32();
        cpu.updateFlagsArith(cpu.regs[REG.EAX] - imm, cpu.regs[REG.EAX], imm, true);
    });
}

// ============================================================
// Stack
// ============================================================

function registerStack(cpu: CPU): void {
    // PUSH r32 (0x50 + rd)
    for (let r = 0; r < 8; r++) {
        cpu.register(0x50 + r, (cpu) => {
            cpu.push32(cpu.regs[r]);
        });
    }

    // POP r32 (0x58 + rd)
    for (let r = 0; r < 8; r++) {
        cpu.register(0x58 + r, (cpu) => {
            cpu.regs[r] = cpu.pop32();
        });
    }

    // PUSHAD (0x60) - Push all 32-bit general-purpose registers
    cpu.register(0x60, (cpu) => {
        const temp = cpu.regs[REG.ESP];
        cpu.push32(cpu.regs[REG.EAX]);
        cpu.push32(cpu.regs[REG.ECX]);
        cpu.push32(cpu.regs[REG.EDX]);
        cpu.push32(cpu.regs[REG.EBX]);
        cpu.push32(temp); // original ESP value
        cpu.push32(cpu.regs[REG.EBP]);
        cpu.push32(cpu.regs[REG.ESI]);
        cpu.push32(cpu.regs[REG.EDI]);
    });

    // POPAD (0x61) - Pop all 32-bit general-purpose registers
    cpu.register(0x61, (cpu) => {
        cpu.regs[REG.EDI] = cpu.pop32();
        cpu.regs[REG.ESI] = cpu.pop32();
        cpu.regs[REG.EBP] = cpu.pop32();
        cpu.pop32(); // skip ESP (discarded)
        cpu.regs[REG.EBX] = cpu.pop32();
        cpu.regs[REG.EDX] = cpu.pop32();
        cpu.regs[REG.ECX] = cpu.pop32();
        cpu.regs[REG.EAX] = cpu.pop32();
    });

    // PUSH imm32
    cpu.register(0x68, (cpu) => {
        cpu.push32(cpu.fetch32());
    });

    // PUSH imm8 (sign-extended)
    cpu.register(0x6A, (cpu) => {
        const imm = cpu.fetchSigned8();
        cpu.push32(imm >>> 0);
    });
}

// ============================================================
// Control Flow
// ============================================================

function registerControlFlow(cpu: CPU): void {
    // CALL rel32
    cpu.register(0xE8, (cpu) => {
        const rel = cpu.fetchSigned32();
        const target = (cpu.eip + rel) >>> 0;
        cpu.push32(cpu.eip);
        cpu.eip = target;
    });

    // RET
    cpu.register(0xC3, (cpu) => {
        cpu.eip = cpu.pop32();
    });

    // JMP rel32
    cpu.register(0xE9, (cpu) => {
        const rel = cpu.fetchSigned32();
        cpu.eip = (cpu.eip + rel) >>> 0;
    });

    // JMP rel8
    cpu.register(0xEB, (cpu) => {
        const rel = cpu.fetchSigned8();
        cpu.eip = (cpu.eip + rel) >>> 0;
    });

    // Jcc rel8 — conditional jumps
    const conditions: [number, string, (cpu: CPU) => boolean][] = [
        [0x70, "JO",  (cpu) => cpu.getFlag(FLAG.OF)],
        [0x71, "JNO", (cpu) => !cpu.getFlag(FLAG.OF)],
        [0x72, "JB",  (cpu) => cpu.getFlag(FLAG.CF)],
        [0x73, "JAE", (cpu) => !cpu.getFlag(FLAG.CF)],
        [0x74, "JE",  (cpu) => cpu.getFlag(FLAG.ZF)],
        [0x75, "JNE", (cpu) => !cpu.getFlag(FLAG.ZF)],
        [0x76, "JBE", (cpu) => cpu.getFlag(FLAG.CF) || cpu.getFlag(FLAG.ZF)],
        [0x77, "JA",  (cpu) => !cpu.getFlag(FLAG.CF) && !cpu.getFlag(FLAG.ZF)],
        [0x78, "JS",  (cpu) => cpu.getFlag(FLAG.SF)],
        [0x79, "JNS", (cpu) => !cpu.getFlag(FLAG.SF)],
        [0x7C, "JL",  (cpu) => cpu.getFlag(FLAG.SF) !== cpu.getFlag(FLAG.OF)],
        [0x7D, "JGE", (cpu) => cpu.getFlag(FLAG.SF) === cpu.getFlag(FLAG.OF)],
        [0x7E, "JLE", (cpu) => cpu.getFlag(FLAG.ZF) || cpu.getFlag(FLAG.SF) !== cpu.getFlag(FLAG.OF)],
        [0x7F, "JG",  (cpu) => !cpu.getFlag(FLAG.ZF) && cpu.getFlag(FLAG.SF) === cpu.getFlag(FLAG.OF)],
    ];

    for (const [opcode, , condFn] of conditions) {
        cpu.register(opcode, (cpu) => {
            const rel = cpu.fetchSigned8();
            if (condFn(cpu)) {
                cpu.eip = (cpu.eip + rel) >>> 0;
            }
        });
    }
}

// ============================================================
// Group 5 (0xFF)
// ============================================================

function registerGroup5(cpu: CPU): void {
    // Group 5: 0xFF — op r/m32
    cpu.register(0xFF, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const operand = cpu.readRM32(mod, rm);

        switch (reg) {
            case 0: { // INC r/m32
                const result = (operand + 1) >>> 0;
                cpu.writeRM32(mod, rm, result);
                const savedCF = cpu.getFlag(FLAG.CF);
                cpu.updateFlagsArith(operand + 1, operand, 1, false);
                cpu.setFlag(FLAG.CF, savedCF); // Restore CF (INC doesn't affect it)
                break;
            }
            case 1: { // DEC r/m32
                const result = (operand - 1) >>> 0;
                cpu.writeRM32(mod, rm, result);
                const savedCF = cpu.getFlag(FLAG.CF);
                cpu.updateFlagsArith(operand - 1, operand, 1, true);
                cpu.setFlag(FLAG.CF, savedCF); // Restore CF (DEC doesn't affect it)
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
                throw new Error(`Unsupported Group 5 extension: /${reg} (0xFF /${reg})`);
        }
    });
}

// ============================================================
// Two-byte opcodes (0x0F prefix)
// ============================================================

function registerTwoByteOpcodes(cpu: CPU): void {
    cpu.register(0x0F, (cpu) => {
        const op2 = cpu.fetch8();

        switch (op2) {
            // MOVZX r32, r/m8
            case 0xB6: {
                const { mod, reg, rm } = cpu.decodeModRM();
                const resolved = cpu.resolveRM(mod, rm);
                let val: number;
                if (resolved.isReg) {
                    val = cpu.regs[resolved.addr] & 0xFF;
                } else {
                    val = cpu.memory.read8(cpu.applySegmentOverride(resolved.addr));
                }
                cpu.regs[reg] = val;
                break;
            }

            // MOVZX r32, r/m16
            case 0xB7: {
                const { mod, reg, rm } = cpu.decodeModRM();
                const resolved = cpu.resolveRM(mod, rm);
                let val: number;
                if (resolved.isReg) {
                    val = cpu.regs[resolved.addr] & 0xFFFF;
                } else {
                    val = cpu.memory.read16(cpu.applySegmentOverride(resolved.addr));
                }
                cpu.regs[reg] = val;
                break;
            }

            // MOVSX r32, r/m8
            case 0xBE: {
                const { mod, reg, rm } = cpu.decodeModRM();
                const resolved = cpu.resolveRM(mod, rm);
                let val: number;
                if (resolved.isReg) {
                    val = cpu.regs[resolved.addr] & 0xFF;
                } else {
                    val = cpu.memory.read8(cpu.applySegmentOverride(resolved.addr));
                }
                // Sign-extend from 8 to 32 bits
                cpu.regs[reg] = ((val << 24) >> 24) >>> 0;
                break;
            }

            // MOVSX r32, r/m16
            case 0xBF: {
                const { mod, reg, rm } = cpu.decodeModRM();
                const resolved = cpu.resolveRM(mod, rm);
                let val: number;
                if (resolved.isReg) {
                    val = cpu.regs[resolved.addr] & 0xFFFF;
                } else {
                    val = cpu.memory.read16(cpu.applySegmentOverride(resolved.addr));
                }
                // Sign-extend from 16 to 32 bits
                cpu.regs[reg] = ((val << 16) >> 16) >>> 0;
                break;
            }

            // IMUL r32, r/m32
            case 0xAF: {
                const { mod, reg, rm } = cpu.decodeModRM();
                const op1 = cpu.regs[reg] | 0; // signed
                const op2 = cpu.readRM32(mod, rm) | 0; // signed
                const result = Math.imul(op1, op2);
                cpu.regs[reg] = result >>> 0;
                // Set CF and OF if result doesn't fit in 32 bits
                const full = BigInt(op1) * BigInt(op2);
                const overflow = full !== BigInt(result);
                cpu.setFlag(FLAG.CF, overflow);
                cpu.setFlag(FLAG.OF, overflow);
                break;
            }

            // SETcc r/m8 (0x90-0x9F)
            case 0x90: case 0x91: case 0x92: case 0x93:
            case 0x94: case 0x95: case 0x96: case 0x97:
            case 0x98: case 0x99: case 0x9A: case 0x9B:
            case 0x9C: case 0x9D: case 0x9E: case 0x9F: {
                const { mod, rm } = cpu.decodeModRM();
                const resolved = cpu.resolveRM(mod, rm);
                const condMet = evaluateCondition(cpu, op2 & 0x0F);
                const val = condMet ? 1 : 0;
                if (resolved.isReg) {
                    // Set low byte of register
                    cpu.regs[resolved.addr] = (cpu.regs[resolved.addr] & 0xFFFFFF00) | val;
                } else {
                    cpu.memory.write8(cpu.applySegmentOverride(resolved.addr), val);
                }
                break;
            }

            // Jcc rel32 (near conditional jumps, 0x80-0x8F)
            case 0x80: case 0x81: case 0x82: case 0x83:
            case 0x84: case 0x85: case 0x86: case 0x87:
            case 0x88: case 0x89: case 0x8A: case 0x8B:
            case 0x8C: case 0x8D: case 0x8E: case 0x8F: {
                const rel = cpu.fetchSigned32();
                const condMet = evaluateCondition(cpu, op2 & 0x0F);
                if (condMet) {
                    cpu.eip = (cpu.eip + rel) >>> 0;
                }
                break;
            }

            // XADD r/m32, r32
            case 0xC1: {
                const { mod, reg, rm } = cpu.decodeModRM();
                const dest = cpu.readRM32(mod, rm);
                const src = cpu.regs[reg];
                const result = (dest + src) >>> 0;
                cpu.regs[reg] = dest; // old dest goes to src register
                cpu.writeRM32(mod, rm, result);
                cpu.updateFlagsArith(dest + src, dest, src, false);
                break;
            }

            // BSR r32, r/m32 (bit scan reverse)
            case 0xBD: {
                const { mod, reg, rm } = cpu.decodeModRM();
                const val = cpu.readRM32(mod, rm);
                if (val === 0) {
                    cpu.setFlag(FLAG.ZF, true);
                } else {
                    cpu.setFlag(FLAG.ZF, false);
                    cpu.regs[reg] = 31 - Math.clz32(val);
                }
                break;
            }

            // BSF r32, r/m32 (bit scan forward)
            case 0xBC: {
                const { mod, reg, rm } = cpu.decodeModRM();
                const val = cpu.readRM32(mod, rm);
                if (val === 0) {
                    cpu.setFlag(FLAG.ZF, true);
                } else {
                    cpu.setFlag(FLAG.ZF, false);
                    // Find lowest set bit
                    cpu.regs[reg] = 31 - Math.clz32(val & (-val >>> 0));
                }
                break;
            }

            // CMOV variants (0x40-0x4F)
            case 0x40: case 0x41: case 0x42: case 0x43:
            case 0x44: case 0x45: case 0x46: case 0x47:
            case 0x48: case 0x49: case 0x4A: case 0x4B:
            case 0x4C: case 0x4D: case 0x4E: case 0x4F: {
                const { mod, reg, rm } = cpu.decodeModRM();
                const val = cpu.readRM32(mod, rm);
                const condMet = evaluateCondition(cpu, op2 & 0x0F);
                if (condMet) {
                    cpu.regs[reg] = val;
                }
                break;
            }

            default:
                throw new Error(`Unknown two-byte opcode: 0x0F 0x${op2.toString(16).padStart(2, "0")} at EIP=0x${(cpu.eip >>> 0).toString(16)}`);
        }
    });
}

/**
 * Evaluate x86 condition codes (used by Jcc, SETcc, CMOVcc)
 * Condition number maps to: 0=O, 1=NO, 2=B, 3=AE, 4=E, 5=NE, 6=BE, 7=A,
 *                           8=S, 9=NS, A=P, B=NP, C=L, D=GE, E=LE, F=G
 */
function evaluateCondition(cpu: CPU, cond: number): boolean {
    switch (cond) {
        case 0x0: return cpu.getFlag(FLAG.OF);                                          // O
        case 0x1: return !cpu.getFlag(FLAG.OF);                                         // NO
        case 0x2: return cpu.getFlag(FLAG.CF);                                          // B/C/NAE
        case 0x3: return !cpu.getFlag(FLAG.CF);                                         // AE/NB/NC
        case 0x4: return cpu.getFlag(FLAG.ZF);                                          // E/Z
        case 0x5: return !cpu.getFlag(FLAG.ZF);                                         // NE/NZ
        case 0x6: return cpu.getFlag(FLAG.CF) || cpu.getFlag(FLAG.ZF);                  // BE/NA
        case 0x7: return !cpu.getFlag(FLAG.CF) && !cpu.getFlag(FLAG.ZF);                // A/NBE
        case 0x8: return cpu.getFlag(FLAG.SF);                                          // S
        case 0x9: return !cpu.getFlag(FLAG.SF);                                         // NS
        case 0xA: return false; // PF not tracked yet                                   // P/PE
        case 0xB: return true;  // PF not tracked yet                                   // NP/PO
        case 0xC: return cpu.getFlag(FLAG.SF) !== cpu.getFlag(FLAG.OF);                 // L/NGE
        case 0xD: return cpu.getFlag(FLAG.SF) === cpu.getFlag(FLAG.OF);                 // GE/NL
        case 0xE: return cpu.getFlag(FLAG.ZF) || (cpu.getFlag(FLAG.SF) !== cpu.getFlag(FLAG.OF)); // LE/NG
        case 0xF: return !cpu.getFlag(FLAG.ZF) && (cpu.getFlag(FLAG.SF) === cpu.getFlag(FLAG.OF)); // G/NLE
        default: return false;
    }
}

// ============================================================
// String Operations (STOS, MOVS, LODS, SCAS, CMPS)
// ============================================================

function registerStringOps(cpu: CPU): void {
    // Direction flag helper: returns +1 (DF=0, forward) or -1 (DF=1, backward)
    const direction = (cpu: CPU): number => cpu.getFlag(FLAG.DF) ? -1 : 1;

    // STOSB — store AL to [EDI], advance EDI by 1
    cpu.register(0xAA, (cpu) => {
        const rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                cpu.memory.write8(cpu.regs[REG.EDI], cpu.regs[REG.EAX] & 0xFF);
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + direction(cpu)) >>> 0;
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
            }
        } else {
            cpu.memory.write8(cpu.regs[REG.EDI], cpu.regs[REG.EAX] & 0xFF);
            cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + direction(cpu)) >>> 0;
        }
    });

    // STOSD — store EAX to [EDI], advance EDI by 4
    cpu.register(0xAB, (cpu) => {
        const dir4 = direction(cpu) * 4;
        const rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                cpu.memory.write32(cpu.regs[REG.EDI], cpu.regs[REG.EAX]);
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + dir4) >>> 0;
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
            }
        } else {
            cpu.memory.write32(cpu.regs[REG.EDI], cpu.regs[REG.EAX]);
            cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + dir4) >>> 0;
        }
    });

    // MOVSB — copy byte [ESI] to [EDI], advance both by 1
    cpu.register(0xA4, (cpu) => {
        const rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                cpu.memory.write8(cpu.regs[REG.EDI], cpu.memory.read8(cpu.regs[REG.ESI]));
                cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + direction(cpu)) >>> 0;
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + direction(cpu)) >>> 0;
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
            }
        } else {
            cpu.memory.write8(cpu.regs[REG.EDI], cpu.memory.read8(cpu.regs[REG.ESI]));
            cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + direction(cpu)) >>> 0;
            cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + direction(cpu)) >>> 0;
        }
    });

    // MOVSD — copy dword [ESI] to [EDI], advance both by 4
    cpu.register(0xA5, (cpu) => {
        const dir4 = direction(cpu) * 4;
        const rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                cpu.memory.write32(cpu.regs[REG.EDI], cpu.memory.read32(cpu.regs[REG.ESI]));
                cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + dir4) >>> 0;
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + dir4) >>> 0;
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
            }
        } else {
            cpu.memory.write32(cpu.regs[REG.EDI], cpu.memory.read32(cpu.regs[REG.ESI]));
            cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + dir4) >>> 0;
            cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + dir4) >>> 0;
        }
    });

    // LODSB — load byte [ESI] into AL, advance ESI by 1
    cpu.register(0xAC, (cpu) => {
        const rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFFFF00) | cpu.memory.read8(cpu.regs[REG.ESI]);
                cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + direction(cpu)) >>> 0;
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
            }
        } else {
            cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFFFF00) | cpu.memory.read8(cpu.regs[REG.ESI]);
            cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + direction(cpu)) >>> 0;
        }
    });

    // LODSD — load dword [ESI] into EAX, advance ESI by 4
    cpu.register(0xAD, (cpu) => {
        const dir4 = direction(cpu) * 4;
        const rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                cpu.regs[REG.EAX] = cpu.memory.read32(cpu.regs[REG.ESI]);
                cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + dir4) >>> 0;
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
            }
        } else {
            cpu.regs[REG.EAX] = cpu.memory.read32(cpu.regs[REG.ESI]);
            cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + dir4) >>> 0;
        }
    });

    // SCASB — compare AL with [EDI], advance EDI by 1
    cpu.register(0xAE, (cpu) => {
        const rep = cpu.repPrefix;
        if (rep === "REP") {
            // REPE SCASB: scan while equal (ZF=1), stop on mismatch or ECX=0
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                const val = cpu.memory.read8(cpu.regs[REG.EDI]);
                const al = cpu.regs[REG.EAX] & 0xFF;
                cpu.updateFlagsArith(al - val, al, val, true);
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + direction(cpu)) >>> 0;
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
                if (!cpu.getFlag(FLAG.ZF)) break;
            }
        } else if (rep === "REPNE") {
            // REPNE SCASB: scan while not equal (ZF=0), stop on match or ECX=0
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                const val = cpu.memory.read8(cpu.regs[REG.EDI]);
                const al = cpu.regs[REG.EAX] & 0xFF;
                cpu.updateFlagsArith(al - val, al, val, true);
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + direction(cpu)) >>> 0;
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
                if (cpu.getFlag(FLAG.ZF)) break;
            }
        } else {
            const val = cpu.memory.read8(cpu.regs[REG.EDI]);
            const al = cpu.regs[REG.EAX] & 0xFF;
            cpu.updateFlagsArith(al - val, al, val, true);
            cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + direction(cpu)) >>> 0;
        }
    });

    // SCASD — compare EAX with [EDI], advance EDI by 4
    cpu.register(0xAF, (cpu) => {
        const dir4 = direction(cpu) * 4;
        const rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                const val = cpu.memory.read32(cpu.regs[REG.EDI]);
                cpu.updateFlagsArith((cpu.regs[REG.EAX] | 0) - (val | 0), cpu.regs[REG.EAX], val, true);
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + dir4) >>> 0;
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
                if (!cpu.getFlag(FLAG.ZF)) break;
            }
        } else if (rep === "REPNE") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                const val = cpu.memory.read32(cpu.regs[REG.EDI]);
                cpu.updateFlagsArith((cpu.regs[REG.EAX] | 0) - (val | 0), cpu.regs[REG.EAX], val, true);
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + dir4) >>> 0;
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
                if (cpu.getFlag(FLAG.ZF)) break;
            }
        } else {
            const val = cpu.memory.read32(cpu.regs[REG.EDI]);
            cpu.updateFlagsArith((cpu.regs[REG.EAX] | 0) - (val | 0), cpu.regs[REG.EAX], val, true);
            cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + dir4) >>> 0;
        }
    });

    // CMPSB — compare [ESI] with [EDI], advance both by 1
    cpu.register(0xA6, (cpu) => {
        const rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                const src = cpu.memory.read8(cpu.regs[REG.ESI]);
                const dst = cpu.memory.read8(cpu.regs[REG.EDI]);
                cpu.updateFlagsArith(src - dst, src, dst, true);
                cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + direction(cpu)) >>> 0;
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + direction(cpu)) >>> 0;
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
                if (!cpu.getFlag(FLAG.ZF)) break;
            }
        } else if (rep === "REPNE") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                const src = cpu.memory.read8(cpu.regs[REG.ESI]);
                const dst = cpu.memory.read8(cpu.regs[REG.EDI]);
                cpu.updateFlagsArith(src - dst, src, dst, true);
                cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + direction(cpu)) >>> 0;
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + direction(cpu)) >>> 0;
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
                if (cpu.getFlag(FLAG.ZF)) break;
            }
        } else {
            const src = cpu.memory.read8(cpu.regs[REG.ESI]);
            const dst = cpu.memory.read8(cpu.regs[REG.EDI]);
            cpu.updateFlagsArith(src - dst, src, dst, true);
            cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + direction(cpu)) >>> 0;
            cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + direction(cpu)) >>> 0;
        }
    });

    // CMPSD — compare [ESI] dword with [EDI] dword, advance both by 4
    cpu.register(0xA7, (cpu) => {
        const dir4 = direction(cpu) * 4;
        const rep = cpu.repPrefix;
        if (rep === "REP") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                const src = cpu.memory.read32(cpu.regs[REG.ESI]);
                const dst = cpu.memory.read32(cpu.regs[REG.EDI]);
                cpu.updateFlagsArith((src | 0) - (dst | 0), src, dst, true);
                cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + dir4) >>> 0;
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + dir4) >>> 0;
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
                if (!cpu.getFlag(FLAG.ZF)) break;
            }
        } else if (rep === "REPNE") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                const src = cpu.memory.read32(cpu.regs[REG.ESI]);
                const dst = cpu.memory.read32(cpu.regs[REG.EDI]);
                cpu.updateFlagsArith((src | 0) - (dst | 0), src, dst, true);
                cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + dir4) >>> 0;
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + dir4) >>> 0;
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
                if (cpu.getFlag(FLAG.ZF)) break;
            }
        } else {
            const src = cpu.memory.read32(cpu.regs[REG.ESI]);
            const dst = cpu.memory.read32(cpu.regs[REG.EDI]);
            cpu.updateFlagsArith((src | 0) - (dst | 0), src, dst, true);
            cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + dir4) >>> 0;
            cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + dir4) >>> 0;
        }
    });
}

// ============================================================
// I/O Instructions
// ============================================================

function registerIOPorts(cpu: CPU): void {
    // I/O port access helpers - return 8, 16, or 32-bit port value
    const readPort = (port: number, size: number): number => {
        // Stub: always return zero for I/O port reads
        console.log(`[I/O] IN from port 0x${port.toString(16)}, size ${size}`);
        return 0;
    };

    const writePort = (port: number, val: number, size: number): void => {
        // Stub: I/O port writes
        console.log(`[I/O] OUT to port 0x${port.toString(16)}, value 0x${val.toString(16)}, size ${size}`);
    };

    // IN AL, DX - read byte from port DX into AL
    cpu.register(0xEC, (cpu) => {
        cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFFFF00) | readPort(cpu.regs[REG.EDX] & 0xFFFF, 1);
    });

    // IN AX, DX - read word from port DX into AX
    cpu.register(0xED, (cpu) => {
        const port = cpu.regs[REG.EDX] & 0xFFFF;
        cpu.regs[REG.EAX] = readPort(port, 2) | (readPort(port + 1, 2) << 16);
    });

    // OUT DX, AL - write AL to port DX
    cpu.register(0xEE, (cpu) => {
        writePort(cpu.regs[REG.EDX] & 0xFFFF, cpu.regs[REG.EAX] & 0xFF, 1);
    });

    // OUT DX, AX - write AX to port DX
    cpu.register(0xEF, (cpu) => {
        const port = cpu.regs[REG.EDX] & 0xFFFF;
        writePort(port, cpu.regs[REG.EAX] & 0xFFFF, 2);
    });

    // INSB / INS / INSB - Input String (byte)
    cpu.register(0x6C, (cpu) => {
        const rep = cpu.repPrefix;
        const size = cpu.operandSizeOverride ? 2 : 1;
        const inc = cpu.getFlag(FLAG.DF) ? -size : size;
        const es = cpu.segments.ES;

        if (rep === "REP") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                const port = cpu.regs[REG.EDX] & 0xFFFF;
                const val = readPort(port, size);
                if (size === 1) {
                    cpu.memory.write8(es + cpu.regs[REG.EDI], val);
                    cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + inc) >>> 0;
                } else {
                    cpu.memory.write16(es + cpu.regs[REG.EDI], val);
                    cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + inc) >>> 0;
                }
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
            }
        } else {
            const port = cpu.regs[REG.EDX] & 0xFFFF;
            const val = readPort(port, size);
            if (size === 1) {
                cpu.memory.write8(es + cpu.regs[REG.EDI], val);
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + inc) >>> 0;
            } else {
                cpu.memory.write16(es + cpu.regs[REG.EDI], val);
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + inc) >>> 0;
            }
        }
    });

    // INS (byte) - Input String (byte, implicit DX port)
    cpu.register(0x6D, (cpu) => {
        const rep = cpu.repPrefix;
        const size = cpu.operandSizeOverride ? 2 : 1;
        const inc = cpu.getFlag(FLAG.DF) ? -size : size;
        const es = cpu.segments.ES;

        if (rep === "REP") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                const port = cpu.regs[REG.EDX] & 0xFFFF;
                const val = readPort(port, size);
                if (size === 1) {
                    cpu.memory.write8(es + cpu.regs[REG.EDI], val);
                    cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + inc) >>> 0;
                } else {
                    cpu.memory.write16(es + cpu.regs[REG.EDI], val);
                    cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + inc) >>> 0;
                }
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
            }
        } else {
            const port = cpu.regs[REG.EDX] & 0xFFFF;
            const val = readPort(port, size);
            if (size === 1) {
                cpu.memory.write8(es + cpu.regs[REG.EDI], val);
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + inc) >>> 0;
            } else {
                cpu.memory.write16(es + cpu.regs[REG.EDI], val);
                cpu.regs[REG.EDI] = (cpu.regs[REG.EDI] + inc) >>> 0;
            }
        }
    });

    // OUTSB / OUTS / OUTSB - Output String (byte)
    cpu.register(0x6E, (cpu) => {
        const rep = cpu.repPrefix;
        const size = cpu.operandSizeOverride ? 2 : 1;
        const inc = cpu.getFlag(FLAG.DF) ? -size : size;

        if (rep === "REP") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                if (size === 1) {
                    const val = cpu.memory.read8(cpu.regs[REG.ESI]);
                    cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + inc) >>> 0;
                    writePort(cpu.regs[REG.EDX] & 0xFFFF, val, 1);
                } else {
                    const val = cpu.memory.read16(cpu.regs[REG.ESI]);
                    cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + inc) >>> 0;
                    writePort(cpu.regs[REG.EDX] & 0xFFFF, val, 2);
                }
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
            }
        } else {
            if (size === 1) {
                const val = cpu.memory.read8(cpu.regs[REG.ESI]);
                cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + inc) >>> 0;
                writePort(cpu.regs[REG.EDX] & 0xFFFF, val, 1);
            } else {
                const val = cpu.memory.read16(cpu.regs[REG.ESI]);
                cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + inc) >>> 0;
                writePort(cpu.regs[REG.EDX] & 0xFFFF, val, 2);
            }
        }
    });

    // OUTS (byte) - Output String (byte, implicit DX port)
    cpu.register(0x6F, (cpu) => {
        const rep = cpu.repPrefix;
        const size = cpu.operandSizeOverride ? 2 : 1;
        const inc = cpu.getFlag(FLAG.DF) ? -size : size;

        if (rep === "REP") {
            while ((cpu.regs[REG.ECX] >>> 0) !== 0) {
                if (size === 1) {
                    const val = cpu.memory.read8(cpu.regs[REG.ESI]);
                    cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + inc) >>> 0;
                    writePort(cpu.regs[REG.EDX] & 0xFFFF, val, 1);
                } else {
                    const val = cpu.memory.read16(cpu.regs[REG.ESI]);
                    cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + inc) >>> 0;
                    writePort(cpu.regs[REG.EDX] & 0xFFFF, val, 2);
                }
                cpu.regs[REG.ECX] = (cpu.regs[REG.ECX] - 1) >>> 0;
            }
        } else {
            if (size === 1) {
                const val = cpu.memory.read8(cpu.regs[REG.ESI]);
                cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + inc) >>> 0;
                writePort(cpu.regs[REG.EDX] & 0xFFFF, val, 1);
            } else {
                const val = cpu.memory.read16(cpu.regs[REG.ESI]);
                cpu.regs[REG.ESI] = (cpu.regs[REG.ESI] + inc) >>> 0;
                writePort(cpu.regs[REG.EDX] & 0xFFFF, val, 2);
            }
        }
    });
}

// ============================================================
// Misc
// ============================================================

function registerMisc(cpu: CPU): void {
    // NOP
    cpu.register(0x90, () => {});

    // HLT
    cpu.register(0xF4, (cpu) => {
        cpu.halted = true;
    });

    // CLD — clear direction flag (DF=0, string ops go forward)
    cpu.register(0xFC, (cpu) => {
        cpu.setFlag(FLAG.DF, false);
    });

    // STD — set direction flag (DF=1, string ops go backward)
    cpu.register(0xFD, (cpu) => {
        cpu.setFlag(FLAG.DF, true);
    });

    // WAIT / FWAIT — wait for pending FPU exceptions (no-op in our emulator)
    cpu.register(0x9B, () => {});

    // INT imm8
    cpu.register(0xCD, (cpu) => {
        const intNum = cpu.fetch8();
        cpu.triggerInterrupt(intNum);
    });

    // SAHF — Store AH into lower 8 bits of EFLAGS (SF, ZF, AF, PF, CF)
    cpu.register(0x9E, (cpu) => {
        const ah = (cpu.regs[REG.EAX] >> 8) & 0xFF;
        // EFLAGS bits: SF(7), ZF(6), AF(4), PF(2), CF(0)
        cpu.eflags = (cpu.eflags & ~0xD5) | (ah & 0xD5);
    });
}

// ============================================================
// x87 FPU Instructions (0xD8 - 0xDF)
// ============================================================

function registerFPU(cpu: CPU): void {
    // 0xD8: float32 memory ops / register-register ops
    cpu.register(0xD8, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        if (mod === 3) {
            // Register-register: ST(0) op ST(i)
            const st0 = cpu.fpuGet(0);
            const sti = cpu.fpuGet(rm);
            switch (reg) {
                case 0: cpu.fpuSet(0, st0 + sti); break;   // FADD ST(0), ST(i)
                case 1: cpu.fpuSet(0, st0 * sti); break;   // FMUL ST(0), ST(i)
                case 2: cpu.fpuCompare(st0, sti); break;    // FCOM ST(i)
                case 3:                                      // FCOMP ST(i)
                    cpu.fpuCompare(st0, sti);
                    cpu.fpuPop();
                    break;
                case 4: cpu.fpuSet(0, st0 - sti); break;   // FSUB ST(0), ST(i)
                case 5: cpu.fpuSet(0, sti - st0); break;   // FSUBR ST(0), ST(i)
                case 6:                                      // FDIV ST(0), ST(i)
                    cpu.fpuSet(0, st0 / sti);
                    break;
                case 7:                                      // FDIVR ST(0), ST(i)
                    cpu.fpuSet(0, sti / st0);
                    break;
            }
        } else {
            // Memory operand: float32
            const resolved = cpu.resolveRM(mod, rm);
            const addr = cpu.applySegmentOverride(resolved.addr);
            const val = cpu.readFloat(addr);
            const st0 = cpu.fpuGet(0);
            switch (reg) {
                case 0: cpu.fpuSet(0, st0 + val); break;   // FADD m32
                case 1: cpu.fpuSet(0, st0 * val); break;   // FMUL m32
                case 2: cpu.fpuCompare(st0, val); break;    // FCOM m32
                case 3:                                      // FCOMP m32
                    cpu.fpuCompare(st0, val);
                    cpu.fpuPop();
                    break;
                case 4: cpu.fpuSet(0, st0 - val); break;   // FSUB m32
                case 5: cpu.fpuSet(0, val - st0); break;   // FSUBR m32
                case 6: cpu.fpuSet(0, st0 / val); break;   // FDIV m32
                case 7: cpu.fpuSet(0, val / st0); break;   // FDIVR m32
            }
        }
    });

    // 0xD9: FLD float32, FXCH, FST/FSTP, FLDCW, FSTCW, misc
    cpu.register(0xD9, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        if (mod === 3) {
            // Register forms
            switch (reg) {
                case 0: // FLD ST(i) — push copy of ST(i)
                    cpu.fpuPush(cpu.fpuGet(rm));
                    break;
                case 1: { // FXCH ST(i)
                    const tmp = cpu.fpuGet(0);
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
                            if (cpu.fpuGet(0) < 0) cpu.fpuStatusWord |= 0x0200; // C1=sign
                            break;
                        default:
                            break; // Other D9 E2-E7 forms: ignore for now
                    }
                    break;
                case 5: // FLD constants
                    switch (rm) {
                        case 0: cpu.fpuPush(1.0); break;            // FLD1
                        case 1: cpu.fpuPush(Math.log2(10)); break;  // FLDL2T
                        case 2: cpu.fpuPush(Math.LOG2E); break;     // FLDL2E
                        case 3: cpu.fpuPush(Math.PI); break;        // FLDPI
                        case 4: cpu.fpuPush(Math.log10(2)); break;  // FLDLG2
                        case 5: cpu.fpuPush(Math.LN2); break;       // FLDLN2
                        case 6: cpu.fpuPush(0.0); break;            // FLDZ
                        default: break;
                    }
                    break;
                case 6: // Misc: F2XM1, FYL2X, FPTAN, FPATAN, FXTRACT, FPREM1, FDECSTP, FINCSTP
                    switch (rm) {
                        case 0: // F2XM1: ST(0) = 2^ST(0) - 1
                            cpu.fpuSet(0, Math.pow(2, cpu.fpuGet(0)) - 1);
                            break;
                        case 1: { // FYL2X: ST(1) = ST(1) * log2(ST(0)), pop
                            const x = cpu.fpuGet(0);
                            const y = cpu.fpuGet(1);
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
                            { const v = cpu.fpuGet(0);
                              cpu.fpuSet(0, Math.sin(v));
                              cpu.fpuPush(Math.cos(v)); }
                            break;
                        case 4: // FRNDINT
                            cpu.fpuSet(0, Math.round(cpu.fpuGet(0)));
                            break;
                        case 5: { // FSCALE: ST(0) = ST(0) * 2^trunc(ST(1))
                            const scale = Math.trunc(cpu.fpuGet(1));
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
        } else {
            // Memory forms
            const resolved = cpu.resolveRM(mod, rm);
            const addr = cpu.applySegmentOverride(resolved.addr);
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
    cpu.register(0xDA, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        if (mod === 3) {
            // Register forms: FCMOV variants
            const condMet = evaluateCondition(cpu, reg & 3);
            const invert = (reg & 4) !== 0;
            // DA C0-C7: FCMOVB, DA C8-CF: FCMOVE, DA D0-D7: FCMOVBE, DA D8-DF: FCMOVU
            if (reg === 0 && !invert) { // FCMOVB
                if (cpu.getFlag(FLAG.CF)) cpu.fpuSet(0, cpu.fpuGet(rm));
            } else if (reg === 1) { // FCMOVE
                if (cpu.getFlag(FLAG.ZF)) cpu.fpuSet(0, cpu.fpuGet(rm));
            } else if (reg === 2) { // FCMOVBE
                if (cpu.getFlag(FLAG.CF) || cpu.getFlag(FLAG.ZF)) cpu.fpuSet(0, cpu.fpuGet(rm));
            } else if (reg === 3) { // FCMOVU
                // Unordered — check PF (we don't track PF, so skip)
                cpu.fpuSet(0, cpu.fpuGet(rm));
            } else if (reg === 5 && rm === 1) {
                // FUCOMPP — compare ST(0) with ST(1), pop both
                cpu.fpuCompare(cpu.fpuGet(0), cpu.fpuGet(1));
                cpu.fpuPop();
                cpu.fpuPop();
            }
        } else {
            // Memory: int32 ops
            const resolved = cpu.resolveRM(mod, rm);
            const addr = cpu.applySegmentOverride(resolved.addr);
            const val = cpu.memory.readSigned32(addr);
            const st0 = cpu.fpuGet(0);
            switch (reg) {
                case 0: cpu.fpuSet(0, st0 + val); break;   // FIADD m32int
                case 1: cpu.fpuSet(0, st0 * val); break;   // FIMUL m32int
                case 2: cpu.fpuCompare(st0, val); break;    // FICOM m32int
                case 3:                                      // FICOMP m32int
                    cpu.fpuCompare(st0, val);
                    cpu.fpuPop();
                    break;
                case 4: cpu.fpuSet(0, st0 - val); break;   // FISUB m32int
                case 5: cpu.fpuSet(0, val - st0); break;   // FISUBR m32int
                case 6: cpu.fpuSet(0, st0 / val); break;   // FIDIV m32int
                case 7: cpu.fpuSet(0, val / st0); break;   // FIDIVR m32int
            }
        }
    });

    // 0xDB: FILD int32, FISTP int32, FCLEX, FINIT, FUCOMI
    cpu.register(0xDB, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        if (mod === 3) {
            switch (reg) {
                case 4: // DB E0-E7: special
                    if (rm === 2) {
                        // FCLEX / FNCLEX — clear exceptions
                        cpu.fpuStatusWord &= 0x7F00; // Clear exception flags
                    } else if (rm === 3) {
                        // FINIT / FNINIT — initialize FPU
                        cpu.fpuControlWord = 0x037F;
                        cpu.fpuStatusWord = 0;
                        cpu.fpuTagWord = 0xFFFF;
                        cpu.fpuTop = 0;
                    }
                    break;
                case 5: // FUCOMI ST, ST(i) — unordered compare, set EFLAGS
                    {
                        const a = cpu.fpuGet(0);
                        const b = cpu.fpuGet(rm);
                        if (isNaN(a) || isNaN(b)) {
                            cpu.setFlag(FLAG.ZF, true);
                            cpu.setFlag(FLAG.CF, true);
                            // PF would be set too
                        } else if (a > b) {
                            cpu.setFlag(FLAG.ZF, false);
                            cpu.setFlag(FLAG.CF, false);
                        } else if (a < b) {
                            cpu.setFlag(FLAG.ZF, false);
                            cpu.setFlag(FLAG.CF, true);
                        } else {
                            cpu.setFlag(FLAG.ZF, true);
                            cpu.setFlag(FLAG.CF, false);
                        }
                        cpu.setFlag(FLAG.OF, false);
                    }
                    break;
                case 6: // FCOMI ST, ST(i) — ordered compare, set EFLAGS
                    {
                        const a = cpu.fpuGet(0);
                        const b = cpu.fpuGet(rm);
                        if (isNaN(a) || isNaN(b)) {
                            cpu.setFlag(FLAG.ZF, true);
                            cpu.setFlag(FLAG.CF, true);
                        } else if (a > b) {
                            cpu.setFlag(FLAG.ZF, false);
                            cpu.setFlag(FLAG.CF, false);
                        } else if (a < b) {
                            cpu.setFlag(FLAG.ZF, false);
                            cpu.setFlag(FLAG.CF, true);
                        } else {
                            cpu.setFlag(FLAG.ZF, true);
                            cpu.setFlag(FLAG.CF, false);
                        }
                        cpu.setFlag(FLAG.OF, false);
                    }
                    break;
                default:
                    break;
            }
        } else {
            const resolved = cpu.resolveRM(mod, rm);
            const addr = cpu.applySegmentOverride(resolved.addr);
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
                        const lo = cpu.memory.read32(addr);
                        const hi = cpu.memory.read32(addr + 4);
                        const exp = cpu.memory.read16(addr + 8);
                        // Simplified 80-bit to double conversion
                        const sign = (exp & 0x8000) ? -1 : 1;
                        const e = (exp & 0x7FFF) - 16383;
                        const mantissa = (hi * 0x100000000 + lo) / 0x8000000000000000;
                        if (e === -16383 && lo === 0 && hi === 0) {
                            cpu.fpuPush(0.0 * sign);
                        } else {
                            cpu.fpuPush(sign * Math.pow(2, e) * mantissa);
                        }
                    }
                    break;
                case 7: // FSTP m80real — store as 80-bit, pop
                    {
                        // Simplified: store as 64-bit double in first 8 bytes, zero extend
                        const val = cpu.fpuGet(0);
                        cpu.writeDouble(addr, val);
                        cpu.memory.write16(addr + 8, 0);
                        cpu.fpuPop();
                    }
                    break;
            }
        }
    });

    // 0xDC: float64 memory ops / register-register (reverse)
    cpu.register(0xDC, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        if (mod === 3) {
            // Register forms: ST(i) op ST(0) (reverse direction)
            const st0 = cpu.fpuGet(0);
            const sti = cpu.fpuGet(rm);
            switch (reg) {
                case 0: cpu.fpuSet(rm, sti + st0); break;   // FADD ST(i), ST(0)
                case 1: cpu.fpuSet(rm, sti * st0); break;   // FMUL ST(i), ST(0)
                case 2: cpu.fpuCompare(st0, sti); break;    // FCOM ST(i)
                case 3:                                      // FCOMP ST(i)
                    cpu.fpuCompare(st0, sti);
                    cpu.fpuPop();
                    break;
                case 4: cpu.fpuSet(rm, sti - st0); break;   // FSUBR ST(i), ST(0)
                case 5: cpu.fpuSet(rm, st0 - sti); break;   // FSUB ST(i), ST(0)
                case 6: cpu.fpuSet(rm, sti / st0); break;   // FDIVR ST(i), ST(0)
                case 7: cpu.fpuSet(rm, st0 / sti); break;   // FDIV ST(i), ST(0)
            }
        } else {
            // Memory: float64 ops
            const resolved = cpu.resolveRM(mod, rm);
            const addr = cpu.applySegmentOverride(resolved.addr);
            const val = cpu.readDouble(addr);
            const st0 = cpu.fpuGet(0);
            switch (reg) {
                case 0: cpu.fpuSet(0, st0 + val); break;   // FADD m64
                case 1: cpu.fpuSet(0, st0 * val); break;   // FMUL m64
                case 2: cpu.fpuCompare(st0, val); break;    // FCOM m64
                case 3:                                      // FCOMP m64
                    cpu.fpuCompare(st0, val);
                    cpu.fpuPop();
                    break;
                case 4: cpu.fpuSet(0, st0 - val); break;   // FSUB m64
                case 5: cpu.fpuSet(0, val - st0); break;   // FSUBR m64
                case 6: cpu.fpuSet(0, st0 / val); break;   // FDIV m64
                case 7: cpu.fpuSet(0, val / st0); break;   // FDIVR m64
            }
        }
    });

    // 0xDD: FLD/FST/FSTP float64, FRSTOR, FSAVE, FUCOM, FUCOMP, FFREE
    cpu.register(0xDD, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
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
        } else {
            const resolved = cpu.resolveRM(mod, rm);
            const addr = cpu.applySegmentOverride(resolved.addr);
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
    cpu.register(0xDE, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        if (mod === 3) {
            const st0 = cpu.fpuGet(0);
            const sti = cpu.fpuGet(rm);
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
        } else {
            // Memory: int16 ops
            const resolved = cpu.resolveRM(mod, rm);
            const addr = cpu.applySegmentOverride(resolved.addr);
            // Read signed 16-bit integer
            const raw = cpu.memory.read16(addr);
            const val = (raw & 0x8000) ? raw - 0x10000 : raw;
            const st0 = cpu.fpuGet(0);
            switch (reg) {
                case 0: cpu.fpuSet(0, st0 + val); break;   // FIADD m16int
                case 1: cpu.fpuSet(0, st0 * val); break;   // FIMUL m16int
                case 2: cpu.fpuCompare(st0, val); break;    // FICOM m16int
                case 3:                                      // FICOMP m16int
                    cpu.fpuCompare(st0, val);
                    cpu.fpuPop();
                    break;
                case 4: cpu.fpuSet(0, st0 - val); break;   // FISUB m16int
                case 5: cpu.fpuSet(0, val - st0); break;   // FISUBR m16int
                case 6: cpu.fpuSet(0, st0 / val); break;   // FIDIV m16int
                case 7: cpu.fpuSet(0, val / st0); break;   // FIDIVR m16int
            }
        }
    });

    // 0xDF: FILD int16, FISTP int16, FBLD, FILD int64, FBSTP, FISTP int64, FNSTSW AX
    cpu.register(0xDF, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        if (mod === 3) {
            if (reg === 4 && rm === 0) {
                // FNSTSW AX (DF E0) — store FPU status word into AX
                cpu.regs[REG.EAX] = (cpu.regs[REG.EAX] & 0xFFFF0000) | (cpu.fpuStatusWord & 0xFFFF);
            } else if (reg === 5) {
                // FUCOMIP ST, ST(i) — unordered compare, set EFLAGS, pop
                const a = cpu.fpuGet(0);
                const b = cpu.fpuGet(rm);
                if (isNaN(a) || isNaN(b)) {
                    cpu.setFlag(FLAG.ZF, true);
                    cpu.setFlag(FLAG.CF, true);
                } else if (a > b) {
                    cpu.setFlag(FLAG.ZF, false);
                    cpu.setFlag(FLAG.CF, false);
                } else if (a < b) {
                    cpu.setFlag(FLAG.ZF, false);
                    cpu.setFlag(FLAG.CF, true);
                } else {
                    cpu.setFlag(FLAG.ZF, true);
                    cpu.setFlag(FLAG.CF, false);
                }
                cpu.setFlag(FLAG.OF, false);
                cpu.fpuPop();
            } else if (reg === 6) {
                // FCOMIP ST, ST(i) — ordered compare, set EFLAGS, pop
                const a = cpu.fpuGet(0);
                const b = cpu.fpuGet(rm);
                if (isNaN(a) || isNaN(b)) {
                    cpu.setFlag(FLAG.ZF, true);
                    cpu.setFlag(FLAG.CF, true);
                } else if (a > b) {
                    cpu.setFlag(FLAG.ZF, false);
                    cpu.setFlag(FLAG.CF, false);
                } else if (a < b) {
                    cpu.setFlag(FLAG.ZF, false);
                    cpu.setFlag(FLAG.CF, true);
                } else {
                    cpu.setFlag(FLAG.ZF, true);
                    cpu.setFlag(FLAG.CF, false);
                }
                cpu.setFlag(FLAG.OF, false);
                cpu.fpuPop();
            }
        } else {
            const resolved = cpu.resolveRM(mod, rm);
            const addr = cpu.applySegmentOverride(resolved.addr);
            switch (reg) {
                case 0: { // FILD m16int
                    const raw = cpu.memory.read16(addr);
                    const val = (raw & 0x8000) ? raw - 0x10000 : raw;
                    cpu.fpuPush(val);
                    break;
                }
                case 1: { // FISTTP m16int — store truncated int16, pop
                    const val = Math.trunc(cpu.fpuGet(0));
                    cpu.memory.write16(addr, val & 0xFFFF);
                    cpu.fpuPop();
                    break;
                }
                case 2: { // FIST m16int
                    const val = Math.round(cpu.fpuGet(0));
                    cpu.memory.write16(addr, val & 0xFFFF);
                    break;
                }
                case 3: { // FISTP m16int
                    const val = Math.round(cpu.fpuGet(0));
                    cpu.memory.write16(addr, val & 0xFFFF);
                    cpu.fpuPop();
                    break;
                }
                case 5: { // FILD m64int — load 64-bit integer
                    const lo = cpu.memory.read32(addr);
                    const hi = cpu.memory.readSigned32(addr + 4);
                    const val = hi * 0x100000000 + lo;
                    cpu.fpuPush(val);
                    break;
                }
                case 7: { // FISTP m64int — store as 64-bit integer, pop
                    const val = cpu.fpuGet(0);
                    const lo = val & 0xFFFFFFFF;
                    const hi = Math.trunc(val / 0x100000000);
                    cpu.memory.write32(addr, lo >>> 0);
                    cpu.memory.write32(addr + 4, hi | 0);
                    cpu.fpuPop();
                    break;
                }
            }
        }
    });
}
