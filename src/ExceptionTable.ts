import { hex } from "./helpers.ts";

export class RuntimeFunction {
    private _beginAddress: number;
    private _endAddress: number;
    private _unwindInfoAddress: number;

    static get sizeOf() { return 12; }

    constructor(data: Buffer) {
        this._beginAddress = data.readUInt32LE(0);
        this._endAddress = data.readUInt32LE(4);
        this._unwindInfoAddress = data.readUInt32LE(8);
    }

    get beginAddress() { return this._beginAddress; }
    get endAddress() { return this._endAddress; }
    get unwindInfoAddress() { return this._unwindInfoAddress; }
    get codeSize() { return this._endAddress - this._beginAddress; }

    toString() {
        return `${hex(this._beginAddress)}-${hex(this._endAddress)} (${this.codeSize} bytes) Unwind: ${hex(this._unwindInfoAddress)}`;
    }
}

export class ExceptionTable {
    private _entries: RuntimeFunction[];

    constructor(data: Buffer) {
        this._entries = [];
        if (data.length === 0) return;

        const entrySize = RuntimeFunction.sizeOf;
        const count = Math.floor(data.length / entrySize);

        for (let i = 0; i < count; i++) {
            const offset = i * entrySize;
            this._entries.push(new RuntimeFunction(data.subarray(offset, offset + entrySize)));
        }
    }

    get entries() { return this._entries; }

    toString() {
        if (this._entries.length === 0) return 'Exception Table: empty';
        return `Exception Table (${this._entries.length} entries):\n` +
            this._entries.map((e, i) => `  [${i}] ${e}`).join('\n');
    }
}
