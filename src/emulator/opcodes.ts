import { CPU, REG, FLAG } from "../hardware/CPU.ts";

export function registerAllOpcodes(cpu: CPU): void {
    registerDataMovement(cpu);
    registerArithmetic(cpu);
    registerLogic(cpu);
    registerStack(cpu);
    registerControlFlow(cpu);
    registerGroup5(cpu);
    registerMisc(cpu);
}

// ============================================================
// Data Movement
// ============================================================

function registerDataMovement(cpu: CPU): void {
    // MOV r/m32, r32
    cpu.register(0x89, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        cpu.writeRM32(mod, rm, cpu.regs[reg]);
    });

    // MOV r32, r/m32
    cpu.register(0x8B, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        cpu.regs[reg] = cpu.readRM32(mod, rm);
    });

    // MOV r32, imm32 (0xB8 + rd)
    for (let r = 0; r < 8; r++) {
        cpu.register(0xB8 + r, (cpu) => {
            cpu.regs[r] = cpu.fetch32();
        });
    }

    // MOV r/m32, imm32
    cpu.register(0xC7, (cpu) => {
        const { mod, rm } = cpu.decodeModRM();
        const imm = cpu.fetch32();
        cpu.writeRM32(mod, rm, imm);
    });

    // MOV EAX, [disp32]
    cpu.register(0xA1, (cpu) => {
        const addr = cpu.fetch32();
        cpu.regs[REG.EAX] = cpu.memory.read32(addr);
    });

    // MOV [disp32], EAX
    cpu.register(0xA3, (cpu) => {
        const addr = cpu.fetch32();
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
    // ADD r/m32, r32
    cpu.register(0x01, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const op1 = cpu.readRM32(mod, rm);
        const op2 = cpu.regs[reg];
        const result = (op1 + op2) >>> 0;
        cpu.writeRM32(mod, rm, result);
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
                const ofVal = msb !== ((result >>> 1) & 0x40000000);
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
                const ofVal = msb !== ((val >>> 31) & 1);
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
        const addr = cpu.resolveRM(mod, rm).addr;
        const val1 = cpu.memory.read8(addr);
        const val2 = cpu.regs[reg] & 0xFF;
        const result = (val1 | val2) & 0xFF;
        cpu.memory.write8(addr, result);
        cpu.updateFlagsLogic(result);
    });

    // AND r/m32, r32
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

    // XOR r/m32, r32
    cpu.register(0x31, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const result = (cpu.readRM32(mod, rm) ^ cpu.regs[reg]) >>> 0;
        cpu.writeRM32(mod, rm, result);
        cpu.updateFlagsLogic(result);
    });

    // XOR r32, r/m32
    cpu.register(0x33, (cpu) => {
        const { mod, reg, rm } = cpu.decodeModRM();
        const result = (cpu.regs[reg] ^ cpu.readRM32(mod, rm)) >>> 0;
        cpu.regs[reg] = result;
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
// Misc
// ============================================================

function registerMisc(cpu: CPU): void {
    // NOP
    cpu.register(0x90, () => {});

    // HLT
    cpu.register(0xF4, (cpu) => {
        cpu.halted = true;
    });

    // INT imm8
    cpu.register(0xCD, (cpu) => {
        const intNum = cpu.fetch8();
        cpu.triggerInterrupt(intNum);
    });
}
