import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CPU, REG, FLAG } from '#hardware/CPU.ts';
import { Memory } from '#hardware/Memory.ts';
import { registerAllOpcodes } from '#emulator/opcodes.ts';

describe('Arithmetic opcodes', () => {
  let mem: Memory;
  let cpu: CPU;

  beforeEach(() => {
    mem = new Memory(0x10000);
    cpu = new CPU(mem);
    registerAllOpcodes(cpu);
    cpu.regs[REG.ESP] = 0x8000;
  });

  describe('ADD', () => {
    describe('ADD r/m32, r32 (0x01)', () => {
      it('should add register to register', () => {
        cpu.regs[REG.EAX] = 100;
        cpu.regs[REG.EBX] = 50;
        // ADD EAX, EBX => 01 D8 (mod=11, reg=3, rm=0)
        mem.write8(0, 0x01);
        mem.write8(1, 0xD8);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.EAX], 150);
      });

      it('should set ZF when result is zero', () => {
        cpu.regs[REG.EAX] = 0;
        cpu.regs[REG.EBX] = 0;
        mem.write8(0, 0x01);
        mem.write8(1, 0xD8);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.getFlag(FLAG.ZF), true);
      });

      it('should set CF on unsigned overflow', () => {
        cpu.regs[REG.EAX] = 0xFFFFFFFF;
        cpu.regs[REG.EBX] = 1;
        mem.write8(0, 0x01);
        mem.write8(1, 0xD8);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.EAX], 0);
        assert.equal(cpu.getFlag(FLAG.CF), true);
      });

      it('should set SF when result is negative', () => {
        cpu.regs[REG.EAX] = 0x7FFFFFFF;
        cpu.regs[REG.EBX] = 1;
        mem.write8(0, 0x01);
        mem.write8(1, 0xD8);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.EAX], 0x80000000);
        assert.equal(cpu.getFlag(FLAG.SF), true);
      });
    });

    describe('ADD EAX, imm32 (0x05)', () => {
      it('should add immediate to EAX', () => {
        cpu.regs[REG.EAX] = 1000;
        // ADD EAX, 234 => 05 EA 00 00 00
        mem.write8(0, 0x05);
        mem.write32(1, 234);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.EAX], 1234);
      });
    });
  });

  describe('SUB', () => {
    describe('SUB r/m32, r32 (0x29)', () => {
      it('should subtract register from register', () => {
        cpu.regs[REG.EAX] = 100;
        cpu.regs[REG.EBX] = 30;
        // SUB EAX, EBX => 29 D8
        mem.write8(0, 0x29);
        mem.write8(1, 0xD8);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.EAX], 70);
      });

      it('should set CF on unsigned borrow', () => {
        cpu.regs[REG.EAX] = 10;
        cpu.regs[REG.EBX] = 20;
        mem.write8(0, 0x29);
        mem.write8(1, 0xD8);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.EAX], 0xFFFFFFF6); // -10 as unsigned
        assert.equal(cpu.getFlag(FLAG.CF), true);
      });

      it('should set ZF when result is zero', () => {
        cpu.regs[REG.EAX] = 42;
        cpu.regs[REG.EBX] = 42;
        mem.write8(0, 0x29);
        mem.write8(1, 0xD8);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.EAX], 0);
        assert.equal(cpu.getFlag(FLAG.ZF), true);
      });
    });

    describe('SUB EAX, imm32 (0x2D)', () => {
      it('should subtract immediate from EAX', () => {
        cpu.regs[REG.EAX] = 1000;
        mem.write8(0, 0x2D);
        mem.write32(1, 300);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.EAX], 700);
      });
    });
  });

  describe('CMP', () => {
    describe('CMP r/m32, r32 (0x39)', () => {
      it('should set ZF when operands are equal', () => {
        cpu.regs[REG.EAX] = 100;
        cpu.regs[REG.EBX] = 100;
        // CMP EAX, EBX => 39 D8
        mem.write8(0, 0x39);
        mem.write8(1, 0xD8);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.getFlag(FLAG.ZF), true);
        assert.equal(cpu.regs[REG.EAX], 100); // unchanged
      });

      it('should set CF when first < second (unsigned)', () => {
        cpu.regs[REG.EAX] = 50;
        cpu.regs[REG.EBX] = 100;
        mem.write8(0, 0x39);
        mem.write8(1, 0xD8);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.getFlag(FLAG.CF), true);
        assert.equal(cpu.getFlag(FLAG.ZF), false);
      });

      it('should clear CF when first >= second (unsigned)', () => {
        cpu.regs[REG.EAX] = 100;
        cpu.regs[REG.EBX] = 50;
        mem.write8(0, 0x39);
        mem.write8(1, 0xD8);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.getFlag(FLAG.CF), false);
        assert.equal(cpu.getFlag(FLAG.ZF), false);
      });
    });

    describe('CMP EAX, imm32 (0x3D)', () => {
      it('should compare EAX with immediate', () => {
        cpu.regs[REG.EAX] = 500;
        mem.write8(0, 0x3D);
        mem.write32(1, 500);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.getFlag(FLAG.ZF), true);
      });
    });
  });

  describe('INC/DEC', () => {
    describe('INC r32 (0x40+r)', () => {
      it('should increment register', () => {
        cpu.regs[REG.EAX] = 41;
        mem.write8(0, 0x40); // INC EAX
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.EAX], 42);
      });

      it('should not affect CF', () => {
        cpu.regs[REG.EAX] = 0xFFFFFFFF;
        cpu.setFlag(FLAG.CF, false);
        mem.write8(0, 0x40);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.EAX], 0);
        assert.equal(cpu.getFlag(FLAG.CF), false); // INC doesn't touch CF
        assert.equal(cpu.getFlag(FLAG.ZF), true);
      });
    });

    describe('DEC r32 (0x48+r)', () => {
      it('should decrement register', () => {
        cpu.regs[REG.ECX] = 100;
        mem.write8(0, 0x49); // DEC ECX
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.ECX], 99);
      });

      it('should set ZF when result is zero', () => {
        cpu.regs[REG.EAX] = 1;
        mem.write8(0, 0x48); // DEC EAX
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.EAX], 0);
        assert.equal(cpu.getFlag(FLAG.ZF), true);
      });
    });
  });

  describe('NEG', () => {
    it('should negate register (two\'s complement)', () => {
      cpu.regs[REG.EAX] = 5;
      // NEG EAX => F7 D8 (0xF7 /3)
      mem.write8(0, 0xF7);
      mem.write8(1, 0xD8); // mod=11, reg=3, rm=0
      cpu.eip = 0;

      cpu.step();

      assert.equal(cpu.regs[REG.EAX], 0xFFFFFFFB); // -5
    });

    it('should set CF when original is non-zero', () => {
      cpu.regs[REG.EAX] = 1;
      mem.write8(0, 0xF7);
      mem.write8(1, 0xD8);
      cpu.eip = 0;

      cpu.step();

      assert.equal(cpu.getFlag(FLAG.CF), true);
    });

    it('should clear CF when original is zero', () => {
      cpu.regs[REG.EAX] = 0;
      mem.write8(0, 0xF7);
      mem.write8(1, 0xD8);
      cpu.eip = 0;

      cpu.step();

      assert.equal(cpu.regs[REG.EAX], 0);
      assert.equal(cpu.getFlag(FLAG.CF), false);
    });
  });

  describe('MUL/IMUL', () => {
    describe('MUL r/m32 (0xF7 /4)', () => {
      it('should multiply EAX by register, result in EDX:EAX', () => {
        cpu.regs[REG.EAX] = 0x10000;
        cpu.regs[REG.EBX] = 0x10000;
        // MUL EBX => F7 E3
        mem.write8(0, 0xF7);
        mem.write8(1, 0xE3); // mod=11, reg=4, rm=3
        cpu.eip = 0;

        cpu.step();

        // 0x10000 * 0x10000 = 0x100000000
        assert.equal(cpu.regs[REG.EAX], 0);
        assert.equal(cpu.regs[REG.EDX], 1);
      });
    });

    describe('IMUL r32, r/m32 (0x0F 0xAF)', () => {
      it('should multiply two registers', () => {
        cpu.regs[REG.EAX] = 7;
        cpu.regs[REG.EBX] = 6;
        // IMUL EAX, EBX => 0F AF C3
        mem.write8(0, 0x0F);
        mem.write8(1, 0xAF);
        mem.write8(2, 0xC3); // mod=11, reg=0, rm=3
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.EAX], 42);
      });

      it('should handle negative numbers', () => {
        cpu.regs[REG.EAX] = (-5 >>> 0);
        cpu.regs[REG.EBX] = 3;
        mem.write8(0, 0x0F);
        mem.write8(1, 0xAF);
        mem.write8(2, 0xC3);
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.EAX], (-15 >>> 0));
      });
    });
  });

  describe('DIV/IDIV', () => {
    describe('DIV r/m32 (0xF7 /6)', () => {
      it('should divide EDX:EAX by register', () => {
        cpu.regs[REG.EDX] = 0;
        cpu.regs[REG.EAX] = 100;
        cpu.regs[REG.EBX] = 7;
        // DIV EBX => F7 F3
        mem.write8(0, 0xF7);
        mem.write8(1, 0xF3); // mod=11, reg=6, rm=3
        cpu.eip = 0;

        cpu.step();

        assert.equal(cpu.regs[REG.EAX], 14); // quotient
        assert.equal(cpu.regs[REG.EDX], 2);  // remainder
      });

      it('should throw on division by zero', () => {
        cpu.regs[REG.EDX] = 0;
        cpu.regs[REG.EAX] = 100;
        cpu.regs[REG.EBX] = 0;
        mem.write8(0, 0xF7);
        mem.write8(1, 0xF3);
        cpu.eip = 0;

        assert.throws(() => cpu.step(), /Division by zero/);
      });
    });
  });
});
