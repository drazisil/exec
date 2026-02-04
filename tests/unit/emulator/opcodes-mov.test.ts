import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CPU, REG } from '#hardware/CPU.ts';
import { Memory } from '#hardware/Memory.ts';
import { registerAllOpcodes } from '#emulator/opcodes.ts';

describe('MOV opcodes', () => {
  let mem: Memory;
  let cpu: CPU;

  beforeEach(() => {
    mem = new Memory(0x10000);
    cpu = new CPU(mem);
    registerAllOpcodes(cpu);
    cpu.regs[REG.ESP] = 0x8000; // Set up stack
  });

  describe('MOV r32, imm32 (0xB8+r)', () => {
    it('should load immediate into EAX', () => {
      // MOV EAX, 0x12345678 => B8 78 56 34 12
      mem.write8(0, 0xB8);
      mem.write32(1, 0x12345678);
      cpu.eip = 0;

      cpu.step();

      assert.equal(cpu.regs[REG.EAX], 0x12345678);
      assert.equal(cpu.eip, 5);
    });

    it('should load immediate into ECX', () => {
      // MOV ECX, 0xDEADBEEF => B9 EF BE AD DE
      mem.write8(0, 0xB9);
      mem.write32(1, 0xDEADBEEF);
      cpu.eip = 0;

      cpu.step();

      assert.equal(cpu.regs[REG.ECX], 0xDEADBEEF);
    });

    it('should load immediate into all registers', () => {
      const values = [0x11111111, 0x22222222, 0x33333333, 0x44444444,
                      0x55555555, 0x66666666, 0x77777777, 0x88888888];
      
      let offset = 0;
      for (let r = 0; r < 8; r++) {
        mem.write8(offset, 0xB8 + r);
        mem.write32(offset + 1, values[r]);
        offset += 5;
      }

      cpu.eip = 0;
      for (let r = 0; r < 8; r++) {
        cpu.step();
      }

      for (let r = 0; r < 8; r++) {
        assert.equal(cpu.regs[r], values[r]);
      }
    });
  });

  describe('MOV r/m32, r32 (0x89)', () => {
    it('should move register to register', () => {
      cpu.regs[REG.EAX] = 0x12345678;
      // MOV ECX, EAX => 89 C1 (mod=11, reg=0, rm=1)
      mem.write8(0, 0x89);
      mem.write8(1, 0xC1); // 11 000 001
      cpu.eip = 0;

      cpu.step();

      assert.equal(cpu.regs[REG.ECX], 0x12345678);
    });

    it('should move register to memory', () => {
      cpu.regs[REG.EAX] = 0xCAFEBABE;
      // MOV [0x1000], EAX => 89 05 00 10 00 00 (mod=00, reg=0, rm=5)
      mem.write8(0, 0x89);
      mem.write8(1, 0x05); // 00 000 101 (disp32)
      mem.write32(2, 0x1000);
      cpu.eip = 0;

      cpu.step();

      assert.equal(mem.read32(0x1000), 0xCAFEBABE);
    });
  });

  describe('MOV r32, r/m32 (0x8B)', () => {
    it('should move register to register', () => {
      cpu.regs[REG.EBX] = 0x87654321;
      // MOV EAX, EBX => 8B C3 (mod=11, reg=0, rm=3)
      mem.write8(0, 0x8B);
      mem.write8(1, 0xC3);
      cpu.eip = 0;

      cpu.step();

      assert.equal(cpu.regs[REG.EAX], 0x87654321);
    });

    it('should move memory to register', () => {
      mem.write32(0x2000, 0xFEEDFACE);
      // MOV EAX, [0x2000] => 8B 05 00 20 00 00
      mem.write8(0, 0x8B);
      mem.write8(1, 0x05);
      mem.write32(2, 0x2000);
      cpu.eip = 0;

      cpu.step();

      assert.equal(cpu.regs[REG.EAX], 0xFEEDFACE);
    });

    it('should move memory with displacement to register', () => {
      cpu.regs[REG.EBX] = 0x1000;
      mem.write32(0x1010, 0xABCDEF01);
      // MOV EAX, [EBX+0x10] => 8B 43 10 (mod=01, reg=0, rm=3, disp8=0x10)
      mem.write8(0, 0x8B);
      mem.write8(1, 0x43); // 01 000 011
      mem.write8(2, 0x10);
      cpu.eip = 0;

      cpu.step();

      assert.equal(cpu.regs[REG.EAX], 0xABCDEF01);
    });
  });

  describe('MOV r/m32, imm32 (0xC7)', () => {
    it('should move immediate to register', () => {
      // MOV EAX, 0x11223344 => C7 C0 44 33 22 11
      mem.write8(0, 0xC7);
      mem.write8(1, 0xC0); // mod=11, rm=0 (EAX)
      mem.write32(2, 0x11223344);
      cpu.eip = 0;

      cpu.step();

      assert.equal(cpu.regs[REG.EAX], 0x11223344);
    });

    it('should move immediate to memory', () => {
      // MOV [0x3000], 0x99887766 => C7 05 00 30 00 00 66 77 88 99
      mem.write8(0, 0xC7);
      mem.write8(1, 0x05); // mod=00, rm=5 (disp32)
      mem.write32(2, 0x3000);
      mem.write32(6, 0x99887766);
      cpu.eip = 0;

      cpu.step();

      assert.equal(mem.read32(0x3000), 0x99887766);
    });
  });

  describe('LEA r32, [r/m32] (0x8D)', () => {
    it('should load effective address with displacement', () => {
      cpu.regs[REG.EBX] = 0x1000;
      // LEA EAX, [EBX+0x50] => 8D 43 50
      mem.write8(0, 0x8D);
      mem.write8(1, 0x43); // mod=01, reg=0, rm=3
      mem.write8(2, 0x50);
      cpu.eip = 0;

      cpu.step();

      assert.equal(cpu.regs[REG.EAX], 0x1050);
    });

    it('should load direct address', () => {
      // LEA EAX, [0x4000] => 8D 05 00 40 00 00
      mem.write8(0, 0x8D);
      mem.write8(1, 0x05);
      mem.write32(2, 0x4000);
      cpu.eip = 0;

      cpu.step();

      assert.equal(cpu.regs[REG.EAX], 0x4000);
    });
  });
});
