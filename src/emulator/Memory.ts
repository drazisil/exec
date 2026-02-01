export class Memory {
    private _buffer: ArrayBuffer;
    private _view: DataView;
    private _bytes: Uint8Array;

    constructor(sizeBytes: number = 0x100000) {
        this._buffer = new ArrayBuffer(sizeBytes);
        this._view = new DataView(this._buffer);
        this._bytes = new Uint8Array(this._buffer);
    }

    get size() {
        return this._buffer.byteLength;
    }

    read8(addr: number): number {
        return this._view.getUint8(addr);
    }

    readSigned8(addr: number): number {
        return this._view.getInt8(addr);
    }

    read16(addr: number): number {
        return this._view.getUint16(addr, true);
    }

    read32(addr: number): number {
        return this._view.getUint32(addr, true);
    }

    readSigned32(addr: number): number {
        return this._view.getInt32(addr, true);
    }

    write8(addr: number, val: number): void {
        this._view.setUint8(addr, val);
    }

    write16(addr: number, val: number): void {
        this._view.setUint16(addr, val, true);
    }

    write32(addr: number, val: number): void {
        this._view.setUint32(addr, val, true);
    }

    load(addr: number, data: Buffer | Uint8Array): void {
        this._bytes.set(data, addr);
    }
}
