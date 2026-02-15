import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CPU, REG, FLAG } from '#hardware/CPU';
import { Memory } from '#hardware/Memory';

describe('CPU', () => {
  let mem: Memory;
  let cpu: CPU;

  beforeEach(() => {
    mem = new Memory(0x10000); // 64KB
    cpu = new CPU(mem);
  });

  describe('initial state', () => {
    it('should initialize all registers to zero', () => {
      for (let i = 0; i < 8; i++) {
        assert.equal(cpu.regs[i], 0);
      }
    });

    it('should initialize EIP to zero', () => {
      assert.equal(cpu.eip, 0);
    });

    it('should initialize flags to zero', () => {
      assert.equal(cpu.eflags, 0);
    });

    it('should not be halted', () => {
      assert.equal(cpu.halted, false);
    });
  });

  describe('fetch operations', () => {
    beforeEach(() => {
      // Write test data at address 0
      mem.write8(0, 0x12);
      mem.write8(1, 0x34);
      mem.write8(2, 0x56);
      mem.write8(3, 0x78);
      cpu.eip = 0;
    });

    it('fetch8 should read byte and advance EIP by 1', () => {
      const val = cpu.fetch8();
      assert.equal(val, 0x12);
      assert.equal(cpu.eip, 1);
    });

    it('fetch16 should read word and advance EIP by 2', () => {
      const val = cpu.fetch16();
      assert.equal(val, 0x3412); // little-endian
      assert.equal(cpu.eip, 2);
    });

    it('fetch32 should read dword and advance EIP by 4', () => {
      const val = cpu.fetch32();
      assert.equal(val, 0x78563412); // little-endian
      assert.equal(cpu.eip, 4);
    });

    it('fetchSigned8 should sign-extend negative values', () => {
      mem.write8(0, 0xFF); // -1
      cpu.eip = 0;
      assert.equal(cpu.fetchSigned8(), -1);
    });
  });

  describe('flag operations', () => {
    it('should set and get individual flags', () => {
      cpu.setFlag(FLAG.ZF, true);
      assert.equal(cpu.getFlag(FLAG.ZF), true);
      assert.equal(cpu.getFlag(FLAG.CF), false);

      cpu.setFlag(FLAG.CF, true);
      assert.equal(cpu.getFlag(FLAG.CF), true);

      cpu.setFlag(FLAG.ZF, false);
      assert.equal(cpu.getFlag(FLAG.ZF), false);
      assert.equal(cpu.getFlag(FLAG.CF), true); // unchanged
    });
  });

  describe('updateFlagsArith', () => {
    it('should set ZF when result is zero', () => {
      cpu.updateFlagsArith(0, 5, 5, true); // 5 - 5 = 0
      assert.equal(cpu.getFlag(FLAG.ZF), true);
    });

    it('should clear ZF when result is non-zero', () => {
      cpu.updateFlagsArith(1, 5, 4, true); // 5 - 4 = 1
      assert.equal(cpu.getFlag(FLAG.ZF), false);
    });

    it('should set SF when result is negative (high bit set)', () => {
      cpu.updateFlagsArith(0x80000000, 0, 0x80000000, false);
      assert.equal(cpu.getFlag(FLAG.SF), true);
    });

    it('should set CF on unsigned borrow (subtraction)', () => {
      cpu.updateFlagsArith(-1, 0, 1, true); // 0 - 1 underflows
      assert.equal(cpu.getFlag(FLAG.CF), true);
    });

    it('should set CF on unsigned overflow (addition)', () => {
      cpu.updateFlagsArith(0, 0xFFFFFFFF, 1, false); // wraps to 0
      assert.equal(cpu.getFlag(FLAG.CF), true);
    });
  });

  describe('updateFlagsLogic', () => {
    it('should set ZF for zero result', () => {
      cpu.updateFlagsLogic(0);
      assert.equal(cpu.getFlag(FLAG.ZF), true);
    });

    it('should always clear CF and OF', () => {
      cpu.setFlag(FLAG.CF, true);
      cpu.setFlag(FLAG.OF, true);
      cpu.updateFlagsLogic(0x12345678);
      assert.equal(cpu.getFlag(FLAG.CF), false);
      assert.equal(cpu.getFlag(FLAG.OF), false);
    });
  });

  describe('stack operations', () => {
    beforeEach(() => {
      cpu.regs[REG.ESP] = 0x1000;
    });

    it('push32 should decrement ESP and write value', () => {
      cpu.push32(0xDEADBEEF);
      assert.equal(cpu.regs[REG.ESP], 0x0FFC);
      assert.equal(mem.read32(0x0FFC), 0xDEADBEEF);
    });

    it('pop32 should read value and increment ESP', () => {
      mem.write32(0x1000, 0xCAFEBABE);
      cpu.regs[REG.ESP] = 0x1000;
      const val = cpu.pop32();
      assert.equal(val, 0xCAFEBABE);
      assert.equal(cpu.regs[REG.ESP], 0x1004);
    });

    it('push then pop should restore original value', () => {
      const original = 0x12345678;
      cpu.push32(original);
      const popped = cpu.pop32();
      assert.equal(popped, original);
      assert.equal(cpu.regs[REG.ESP], 0x1000);
    });
  });

  describe('ModR/M decoding', () => {
    it('should decode mod, reg, rm fields correctly', () => {
      // ModR/M byte: 11 010 001 = mod=3, reg=2, rm=1
      mem.write8(0, 0b11010001);
      cpu.eip = 0;
      const { mod, reg, rm } = cpu.decodeModRM();
      assert.equal(mod, 0b11);
      assert.equal(reg, 0b010);
      assert.equal(rm, 0b001);
    });
  });

  describe('interrupt handling', () => {
    it('should call registered interrupt handler', () => {
      let called = false;
      let receivedInt = -1;

      cpu.onInterrupt((intNum) => {
        called = true;
        receivedInt = intNum;
      });

      cpu.triggerInterrupt(0x21);

      assert.equal(called, true);
      assert.equal(receivedInt, 0x21);
    });

    it('should throw if no handler registered', () => {
      assert.throws(() => cpu.triggerInterrupt(0x21));
    });
  });

  describe('opcode registration', () => {
    it('should register and execute opcodes', () => {
      let executed = false;

      cpu.register(0x90, () => {
        executed = true;
      });

      mem.write8(0, 0x90);
      cpu.eip = 0;
      cpu.step();

      assert.equal(executed, true);
    });

    it('should throw on unknown opcode', () => {
      mem.write8(0, 0xFF);
      cpu.eip = 0;
      assert.throws(() => cpu.step(), /Unknown opcode/);
    });
  });
});
