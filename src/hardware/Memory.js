export class Memory {
    constructor(sizeBytes = 0x100000) {
        this._buffer = new ArrayBuffer(sizeBytes);
        this._view = new DataView(this._buffer);
        this._bytes = new Uint8Array(this._buffer);
    }
    get size() {
        return this._buffer.byteLength;
    }
    read8(addr) {
        if (addr < 0 || addr >= this._buffer.byteLength) {
            throw new Error(`read8: address 0x${(addr >>> 0).toString(16)} outside bounds [0, 0x${this._buffer.byteLength.toString(16)})`);
        }
        return this._view.getUint8(addr);
    }
    readSigned8(addr) {
        return this._view.getInt8(addr);
    }
    read16(addr) {
        return this._view.getUint16(addr, true);
    }
    read32(addr) {
        if (addr < 0 || addr + 3 >= this._buffer.byteLength) {
            throw new Error(`read32: address 0x${(addr >>> 0).toString(16)} outside bounds [0, 0x${this._buffer.byteLength.toString(16)})`);
        }
        return this._view.getUint32(addr, true);
    }
    readSigned32(addr) {
        if (addr < 0 || addr + 3 >= this._buffer.byteLength) {
            throw new Error(`readSigned32: address 0x${(addr >>> 0).toString(16)} outside bounds [0, 0x${this._buffer.byteLength.toString(16)})`);
        }
        return this._view.getInt32(addr, true);
    }
    write8(addr, val) {
        this._view.setUint8(addr, val);
    }
    write16(addr, val) {
        this._view.setUint16(addr, val, true);
    }
    write32(addr, val) {
        if (addr < 0 || addr + 3 >= this._buffer.byteLength) {
            throw new Error(`write32: address 0x${(addr >>> 0).toString(16)} outside bounds [0, 0x${this._buffer.byteLength.toString(16)})`);
        }
        this._view.setUint32(addr, val, true);
    }
    load(addr, data) {
        if (addr + data.length > this._buffer.byteLength) {
            throw new Error(`load: cannot fit ${data.length} bytes at 0x${(addr >>> 0).toString(16)}, would exceed bounds 0x${this._buffer.byteLength.toString(16)}`);
        }
        this._bytes.set(data, addr);
    }
    /**
     * Check if an address is within valid memory bounds
     */
    isValidAddress(addr) {
        return addr >= 0 && addr < this._buffer.byteLength;
    }
    /**
     * Check if a range of addresses is valid
     */
    isValidRange(addr, size) {
        return addr >= 0 && addr + size <= this._buffer.byteLength;
    }
    /**
     * Get memory bounds
     */
    getBounds() {
        return {
            start: 0,
            end: this._buffer.byteLength - 1,
            size: this._buffer.byteLength,
        };
    }
}
