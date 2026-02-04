/**
 * Memory tests using Node.js native test runner
 * Run with: node --experimental-strip-types --test tests/unit/hardware/memory.native.test.ts
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Memory } from '#hardware/Memory.ts';

describe('Memory', () => {
  let mem: Memory;

  beforeEach(() => {
    mem = new Memory(1024);
  });

  describe('constructor', () => {
    it('should create memory with specified size', () => {
      assert.equal(mem.size, 1024);
    });

    it('should initialize all memory to zero', () => {
      for (let i = 0; i < 100; i++) {
        assert.equal(mem.read8(i), 0);
      }
    });
  });

  describe('8-bit operations', () => {
    it('should write and read 8-bit values', () => {
      mem.write8(0, 0xFF);
      assert.equal(mem.read8(0), 0xFF);
    });

    it('should read signed 8-bit values correctly', () => {
      mem.write8(0, 0xFF); // -1 as signed
      assert.equal(mem.readSigned8(0), -1);

      mem.write8(1, 0x7F); // 127
      assert.equal(mem.readSigned8(1), 127);

      mem.write8(2, 0x80); // -128
      assert.equal(mem.readSigned8(2), -128);
    });
  });

  describe('16-bit operations', () => {
    it('should write and read 16-bit values in little-endian', () => {
      mem.write16(0, 0x1234);
      assert.equal(mem.read16(0), 0x1234);
      // Verify little-endian byte order
      assert.equal(mem.read8(0), 0x34); // low byte first
      assert.equal(mem.read8(1), 0x12); // high byte second
    });
  });

  describe('32-bit operations', () => {
    it('should write and read 32-bit values in little-endian', () => {
      mem.write32(0, 0x12345678);
      assert.equal(mem.read32(0), 0x12345678);
      // Verify little-endian byte order
      assert.equal(mem.read8(0), 0x78);
      assert.equal(mem.read8(1), 0x56);
      assert.equal(mem.read8(2), 0x34);
      assert.equal(mem.read8(3), 0x12);
    });

    it('should read signed 32-bit values correctly', () => {
      mem.write32(0, 0xFFFFFFFF); // -1 as signed
      assert.equal(mem.readSigned32(0), -1);

      mem.write32(4, 0x7FFFFFFF); // max positive
      assert.equal(mem.readSigned32(4), 2147483647);

      mem.write32(8, 0x80000000); // min negative
      assert.equal(mem.readSigned32(8), -2147483648);
    });
  });

  describe('load', () => {
    it('should load a buffer into memory at specified address', () => {
      const data = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
      mem.load(100, data);

      assert.equal(mem.read8(100), 0xDE);
      assert.equal(mem.read8(101), 0xAD);
      assert.equal(mem.read8(102), 0xBE);
      assert.equal(mem.read8(103), 0xEF);
    });
  });

  describe('bounds checking', () => {
    it('should throw on read8 out of bounds', () => {
      assert.throws(() => mem.read8(1024));
      assert.throws(() => mem.read8(-1));
    });

    it('should throw on read32 out of bounds', () => {
      assert.throws(() => mem.read32(1021)); // needs 4 bytes
      assert.throws(() => mem.read32(1024));
    });

    it('should throw on load exceeding bounds', () => {
      const data = Buffer.alloc(100);
      assert.throws(() => mem.load(1000, data)); // 1000 + 100 > 1024
    });
  });

  describe('isValidAddress', () => {
    it('should return true for valid addresses', () => {
      assert.equal(mem.isValidAddress(0), true);
      assert.equal(mem.isValidAddress(512), true);
      assert.equal(mem.isValidAddress(1023), true);
    });

    it('should return false for invalid addresses', () => {
      assert.equal(mem.isValidAddress(-1), false);
      assert.equal(mem.isValidAddress(1024), false);
      assert.equal(mem.isValidAddress(2000), false);
    });
  });

  describe('isValidRange', () => {
    it('should return true for valid ranges', () => {
      assert.equal(mem.isValidRange(0, 100), true);
      assert.equal(mem.isValidRange(900, 124), true);
    });

    it('should return false for invalid ranges', () => {
      assert.equal(mem.isValidRange(1000, 100), false);
      assert.equal(mem.isValidRange(0, 2000), false);
    });
  });
});
