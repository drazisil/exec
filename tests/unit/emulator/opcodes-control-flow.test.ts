import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CPU, REG, FLAG } from '#hardware/CPU';
import { Memory } from '#hardware/Memory';
import { registerAllOpcodes } from '#emulator/opcodes';

describe('Control flow opcodes', () => {
  let mem: Memory;
  let cpu: CPU;

  beforeEach(() => {
    mem = new Memory(0x10000);
    cpu = new CPU(mem);
    registerAllOpcodes(cpu);
    cpu.regs[REG.ESP] = 0x8000;
  });

  describe('JMP', () => {
    describe('JMP rel32 (0xE9)', () => {
      it('should jump forward', () => {
        // JMP +0x100 from address 0x1000
        mem.write8(0x1000, 0xE9);
        mem.write32(0x1001, 0x100);
        cpu.eip = 0x1000;

        cpu.step();

        // EIP after fetch = 0x1005, then + 0x100 = 0x1105
        assert.equal(cpu.eip, 0x1105);
      });

      it('should jump backward', () => {
        mem.write8(0x1000, 0xE9);
        mem.write32(0x1001, -0x100); // negative offset
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x0F05);
      });
    });

    describe('JMP rel8 (0xEB)', () => {
      it('should jump with short offset', () => {
        mem.write8(0x1000, 0xEB);
        mem.write8(0x1001, 0x10);
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x1012);
      });

      it('should handle negative short offset', () => {
        mem.write8(0x1000, 0xEB);
        mem.write8(0x1001, 0xFE); // -2
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x1000); // infinite loop
      });
    });
  });

  describe('CALL and RET', () => {
    describe('CALL rel32 (0xE8)', () => {
      it('should push return address and jump', () => {
        const initialESP = cpu.regs[REG.ESP];
        mem.write8(0x1000, 0xE8);
        mem.write32(0x1001, 0x200); // CALL to 0x1005 + 0x200 = 0x1205
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x1205);
        assert.equal(cpu.regs[REG.ESP], initialESP - 4);
        assert.equal(mem.read32(cpu.regs[REG.ESP]), 0x1005); // return address
      });
    });

    describe('RET (0xC3)', () => {
      it('should pop return address and jump to it', () => {
        mem.write32(cpu.regs[REG.ESP], 0x2000); // return address on stack
        mem.write8(0x1000, 0xC3);
        cpu.eip = 0x1000;
        const initialESP = cpu.regs[REG.ESP];

        cpu.step();

        assert.equal(cpu.eip, 0x2000);
        assert.equal(cpu.regs[REG.ESP], initialESP + 4);
      });
    });

    describe('CALL and RET roundtrip', () => {
      it('should return to instruction after CALL', () => {
        // Program:
        // 0x1000: CALL 0x2000
        // 0x1005: HLT (we won't reach this in test)
        // 0x2000: RET
        mem.write8(0x1000, 0xE8);
        mem.write32(0x1001, 0x2000 - 0x1005); // relative offset
        mem.write8(0x2000, 0xC3);

        cpu.eip = 0x1000;
        cpu.step(); // CALL
        assert.equal(cpu.eip, 0x2000);

        cpu.step(); // RET
        assert.equal(cpu.eip, 0x1005);
      });
    });

    describe('RET imm16 (0xC2)', () => {
      it('should pop return address and clean up stack', () => {
        // Simulate stdcall with 8 bytes of args
        cpu.push32(0xAAAAAAAA); // arg2
        cpu.push32(0xBBBBBBBB); // arg1
        cpu.push32(0x3000);     // return address
        
        mem.write8(0x1000, 0xC2);
        mem.write16(0x1001, 8); // RET 8
        cpu.eip = 0x1000;
        const espBeforeRet = cpu.regs[REG.ESP];

        cpu.step();

        assert.equal(cpu.eip, 0x3000);
        // ESP should be: original + 4 (ret addr) + 8 (cleanup) = +12
        assert.equal(cpu.regs[REG.ESP], espBeforeRet + 12);
      });
    });
  });

  describe('Conditional jumps (Jcc rel8)', () => {
    describe('JE/JZ (0x74)', () => {
      it('should jump when ZF is set', () => {
        cpu.setFlag(FLAG.ZF, true);
        mem.write8(0x1000, 0x74);
        mem.write8(0x1001, 0x20);
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x1022);
      });

      it('should not jump when ZF is clear', () => {
        cpu.setFlag(FLAG.ZF, false);
        mem.write8(0x1000, 0x74);
        mem.write8(0x1001, 0x20);
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x1002);
      });
    });

    describe('JNE/JNZ (0x75)', () => {
      it('should jump when ZF is clear', () => {
        cpu.setFlag(FLAG.ZF, false);
        mem.write8(0x1000, 0x75);
        mem.write8(0x1001, 0x10);
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x1012);
      });
    });

    describe('JB/JC (0x72)', () => {
      it('should jump when CF is set', () => {
        cpu.setFlag(FLAG.CF, true);
        mem.write8(0x1000, 0x72);
        mem.write8(0x1001, 0x30);
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x1032);
      });
    });

    describe('JAE/JNC (0x73)', () => {
      it('should jump when CF is clear', () => {
        cpu.setFlag(FLAG.CF, false);
        mem.write8(0x1000, 0x73);
        mem.write8(0x1001, 0x40);
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x1042);
      });
    });

    describe('JS (0x78)', () => {
      it('should jump when SF is set', () => {
        cpu.setFlag(FLAG.SF, true);
        mem.write8(0x1000, 0x78);
        mem.write8(0x1001, 0x50);
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x1052);
      });
    });

    describe('JL (0x7C) - signed less than', () => {
      it('should jump when SF != OF', () => {
        cpu.setFlag(FLAG.SF, true);
        cpu.setFlag(FLAG.OF, false);
        mem.write8(0x1000, 0x7C);
        mem.write8(0x1001, 0x10);
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x1012);
      });

      it('should not jump when SF == OF', () => {
        cpu.setFlag(FLAG.SF, true);
        cpu.setFlag(FLAG.OF, true);
        mem.write8(0x1000, 0x7C);
        mem.write8(0x1001, 0x10);
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x1002);
      });
    });

    describe('JGE (0x7D) - signed greater or equal', () => {
      it('should jump when SF == OF', () => {
        cpu.setFlag(FLAG.SF, false);
        cpu.setFlag(FLAG.OF, false);
        mem.write8(0x1000, 0x7D);
        mem.write8(0x1001, 0x10);
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x1012);
      });
    });
  });

  describe('Conditional jumps (Jcc rel32) - 0x0F 0x8x', () => {
    describe('JE rel32 (0x0F 0x84)', () => {
      it('should jump with 32-bit offset when ZF set', () => {
        cpu.setFlag(FLAG.ZF, true);
        mem.write8(0x1000, 0x0F);
        mem.write8(0x1001, 0x84);
        mem.write32(0x1002, 0x1000);
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x2006);
      });
    });

    describe('JNE rel32 (0x0F 0x85)', () => {
      it('should jump with 32-bit offset when ZF clear', () => {
        cpu.setFlag(FLAG.ZF, false);
        mem.write8(0x1000, 0x0F);
        mem.write8(0x1001, 0x85);
        mem.write32(0x1002, 0x2000);
        cpu.eip = 0x1000;

        cpu.step();

        assert.equal(cpu.eip, 0x3006);
      });
    });
  });

  // Note: LOOP (0xE2) is not yet implemented
  // Tests can be added here when it's supported
});
