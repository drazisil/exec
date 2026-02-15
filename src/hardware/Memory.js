"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Memory = void 0;
var Memory = /** @class */ (function () {
    function Memory(sizeBytes) {
        if (sizeBytes === void 0) { sizeBytes = 0x100000; }
        this._buffer = new ArrayBuffer(sizeBytes);
        this._view = new DataView(this._buffer);
        this._bytes = new Uint8Array(this._buffer);
    }
    Object.defineProperty(Memory.prototype, "size", {
        get: function () {
            return this._buffer.byteLength;
        },
        enumerable: false,
        configurable: true
    });
    Memory.prototype.read8 = function (addr) {
        if (addr < 0 || addr >= this._buffer.byteLength) {
            throw new Error("read8: address 0x".concat((addr >>> 0).toString(16), " outside bounds [0, 0x").concat(this._buffer.byteLength.toString(16), ")"));
        }
        return this._view.getUint8(addr);
    };
    Memory.prototype.readSigned8 = function (addr) {
        return this._view.getInt8(addr);
    };
    Memory.prototype.read16 = function (addr) {
        return this._view.getUint16(addr, true);
    };
    Memory.prototype.read32 = function (addr) {
        if (addr < 0 || addr + 3 >= this._buffer.byteLength) {
            throw new Error("read32: address 0x".concat((addr >>> 0).toString(16), " outside bounds [0, 0x").concat(this._buffer.byteLength.toString(16), ")"));
        }
        return this._view.getUint32(addr, true);
    };
    Memory.prototype.readSigned32 = function (addr) {
        if (addr < 0 || addr + 3 >= this._buffer.byteLength) {
            throw new Error("readSigned32: address 0x".concat((addr >>> 0).toString(16), " outside bounds [0, 0x").concat(this._buffer.byteLength.toString(16), ")"));
        }
        return this._view.getInt32(addr, true);
    };
    Memory.prototype.write8 = function (addr, val) {
        this._view.setUint8(addr, val);
    };
    Memory.prototype.write16 = function (addr, val) {
        this._view.setUint16(addr, val, true);
    };
    Memory.prototype.write32 = function (addr, val) {
        if (addr < 0 || addr + 3 >= this._buffer.byteLength) {
            throw new Error("write32: address 0x".concat((addr >>> 0).toString(16), " outside bounds [0, 0x").concat(this._buffer.byteLength.toString(16), ")"));
        }
        this._view.setUint32(addr, val, true);
    };
    Memory.prototype.load = function (addr, data) {
        if (addr + data.length > this._buffer.byteLength) {
            throw new Error("load: cannot fit ".concat(data.length, " bytes at 0x").concat((addr >>> 0).toString(16), ", would exceed bounds 0x").concat(this._buffer.byteLength.toString(16)));
        }
        this._bytes.set(data, addr);
    };
    /**
     * Check if an address is within valid memory bounds
     */
    Memory.prototype.isValidAddress = function (addr) {
        return addr >= 0 && addr < this._buffer.byteLength;
    };
    /**
     * Check if a range of addresses is valid
     */
    Memory.prototype.isValidRange = function (addr, size) {
        return addr >= 0 && addr + size <= this._buffer.byteLength;
    };
    /**
     * Get memory bounds
     */
    Memory.prototype.getBounds = function () {
        return {
            start: 0,
            end: this._buffer.byteLength - 1,
            size: this._buffer.byteLength,
        };
    };
    return Memory;
}());
exports.Memory = Memory;
