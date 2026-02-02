import { rvaToOffset, hex } from "./helpers.js";
import { SectionHeader } from "./SectionHeader.js";

export class TLSDirectory {
    private _startAddressOfRawData: number;
    private _endAddressOfRawData: number;
    private _addressOfIndex: number;
    private _addressOfCallBacks: number;
    private _sizeOfZeroFill: number;
    private _characteristics: number;
    private _callbacks: number[];

    constructor(data: Buffer, fileImage: Buffer, sections: SectionHeader[], isPE32Plus: boolean, imageBase: number) {
        this._callbacks = [];

        if (isPE32Plus) {
            if (data.length < 40) return;
            this._startAddressOfRawData = Number(data.readBigUInt64LE(0));
            this._endAddressOfRawData = Number(data.readBigUInt64LE(8));
            this._addressOfIndex = Number(data.readBigUInt64LE(16));
            this._addressOfCallBacks = Number(data.readBigUInt64LE(24));
            this._sizeOfZeroFill = data.readUInt32LE(32);
            this._characteristics = data.readUInt32LE(36);
        } else {
            if (data.length < 24) return;
            this._startAddressOfRawData = data.readUInt32LE(0);
            this._endAddressOfRawData = data.readUInt32LE(4);
            this._addressOfIndex = data.readUInt32LE(8);
            this._addressOfCallBacks = data.readUInt32LE(12);
            this._sizeOfZeroFill = data.readUInt32LE(16);
            this._characteristics = data.readUInt32LE(20);
        }

        // Resolve callbacks array (VAs, need to subtract imageBase to get RVAs)
        if (this._addressOfCallBacks !== 0) {
            const callbacksRva = this._addressOfCallBacks - imageBase;
            const callbacksOffset = rvaToOffset(callbacksRva, sections);
            if (callbacksOffset !== -1) {
                const ptrSize = isPE32Plus ? 8 : 4;
                for (let i = 0; ; i++) {
                    const off = callbacksOffset + i * ptrSize;
                    if (off + ptrSize > fileImage.length) break;
                    const cb = isPE32Plus
                        ? Number(fileImage.readBigUInt64LE(off))
                        : fileImage.readUInt32LE(off);
                    if (cb === 0) break;
                    this._callbacks.push(cb);
                }
            }
        }
    }

    get startAddressOfRawData() { return this._startAddressOfRawData; }
    get endAddressOfRawData() { return this._endAddressOfRawData; }
    get addressOfIndex() { return this._addressOfIndex; }
    get addressOfCallBacks() { return this._addressOfCallBacks; }
    get sizeOfZeroFill() { return this._sizeOfZeroFill; }
    get characteristics() { return this._characteristics; }
    get callbacks() { return this._callbacks; }

    toString() {
        const lines = [
            `StartAddressOfRawData:  ${hex(this._startAddressOfRawData)}`,
            `EndAddressOfRawData:    ${hex(this._endAddressOfRawData)}`,
            `AddressOfIndex:         ${hex(this._addressOfIndex)}`,
            `AddressOfCallBacks:     ${hex(this._addressOfCallBacks)}`,
            `SizeOfZeroFill:         ${this._sizeOfZeroFill}`,
            `Characteristics:        ${hex(this._characteristics)}`,
        ];
        if (this._callbacks.length > 0) {
            lines.push(`Callbacks (${this._callbacks.length}):`);
            this._callbacks.forEach((cb, i) => lines.push(`  [${i}] ${hex(cb)}`));
        }
        return lines.join('\n');
    }
}
