import { hex } from "./helpers.ts";
const DebugTypeNames = {
    0: 'UNKNOWN',
    1: 'COFF',
    2: 'CODEVIEW',
    3: 'FPO',
    4: 'MISC',
    5: 'EXCEPTION',
    6: 'FIXUP',
    7: 'OMAP_TO_SRC',
    8: 'OMAP_FROM_SRC',
    9: 'BORLAND',
    10: 'RESERVED10',
    11: 'CLSID',
    12: 'VC_FEATURE',
    13: 'POGO',
    14: 'ILTCG',
    15: 'MPX',
    16: 'REPRO',
    20: 'EX_DLLCHARACTERISTICS',
};
export class DebugDirectoryEntry {
    static get sizeOf() { return 28; }
    constructor(data, fileImage) {
        this._characteristics = data.readUInt32LE(0);
        this._timeDateStamp = data.readUInt32LE(4);
        this._majorVersion = data.readUInt16LE(8);
        this._minorVersion = data.readUInt16LE(10);
        this._type = data.readUInt32LE(12);
        this._sizeOfData = data.readUInt32LE(16);
        this._addressOfRawData = data.readUInt32LE(20);
        this._pointerToRawData = data.readUInt32LE(24);
        this._pdbPath = null;
        this._pdbGuid = null;
        this._pdbAge = null;
        // Parse CodeView data if present
        if (this._type === 2 && this._pointerToRawData > 0 && this._sizeOfData >= 24) {
            const cvOffset = this._pointerToRawData;
            if (cvOffset + this._sizeOfData <= fileImage.length) {
                const sig = fileImage.readUInt32LE(cvOffset);
                // RSDS signature = PDB 7.0
                if (sig === 0x53445352) {
                    const guidBytes = fileImage.subarray(cvOffset + 4, cvOffset + 20);
                    this._pdbGuid = this.formatGuid(guidBytes);
                    this._pdbAge = fileImage.readUInt32LE(cvOffset + 20);
                    const pathStart = cvOffset + 24;
                    const pathEnd = fileImage.indexOf(0, pathStart);
                    this._pdbPath = fileImage.subarray(pathStart, pathEnd !== -1 ? pathEnd : pathStart + 256).toString('utf8');
                }
                // NB10 signature = PDB 2.0
                else if (sig === 0x3031424E) {
                    this._pdbAge = fileImage.readUInt32LE(cvOffset + 8);
                    const pathStart = cvOffset + 16;
                    const pathEnd = fileImage.indexOf(0, pathStart);
                    this._pdbPath = fileImage.subarray(pathStart, pathEnd !== -1 ? pathEnd : pathStart + 256).toString('utf8');
                }
            }
        }
    }
    formatGuid(bytes) {
        const d1 = bytes.readUInt32LE(0).toString(16).padStart(8, '0');
        const d2 = bytes.readUInt16LE(4).toString(16).padStart(4, '0');
        const d3 = bytes.readUInt16LE(6).toString(16).padStart(4, '0');
        const d4 = Array.from(bytes.subarray(8, 10)).map(b => b.toString(16).padStart(2, '0')).join('');
        const d5 = Array.from(bytes.subarray(10, 16)).map(b => b.toString(16).padStart(2, '0')).join('');
        return `{${d1}-${d2}-${d3}-${d4}-${d5}}`.toUpperCase();
    }
    get characteristics() { return this._characteristics; }
    get timeDateStamp() { return this._timeDateStamp; }
    get majorVersion() { return this._majorVersion; }
    get minorVersion() { return this._minorVersion; }
    get type() { return this._type; }
    get typeName() { return DebugTypeNames[this._type] ?? `UNKNOWN(${this._type})`; }
    get sizeOfData() { return this._sizeOfData; }
    get addressOfRawData() { return this._addressOfRawData; }
    get pointerToRawData() { return this._pointerToRawData; }
    get pdbPath() { return this._pdbPath; }
    get pdbGuid() { return this._pdbGuid; }
    get pdbAge() { return this._pdbAge; }
    toString() {
        let str = `${this.typeName}: RVA=${hex(this._addressOfRawData)} FilePtr=${hex(this._pointerToRawData)} Size=${hex(this._sizeOfData)}`;
        if (this._pdbPath) {
            str += `\n  PDB: ${this._pdbPath}`;
            if (this._pdbGuid)
                str += `\n  GUID: ${this._pdbGuid}`;
            if (this._pdbAge !== null)
                str += `  Age: ${this._pdbAge}`;
        }
        return str;
    }
}
export class DebugDirectory {
    constructor(data, fileImage) {
        this._entries = [];
        if (data.length === 0)
            return;
        const entrySize = DebugDirectoryEntry.sizeOf;
        const count = Math.floor(data.length / entrySize);
        for (let i = 0; i < count; i++) {
            const offset = i * entrySize;
            this._entries.push(new DebugDirectoryEntry(data.subarray(offset, offset + entrySize), fileImage));
        }
    }
    get entries() { return this._entries; }
    toString() {
        if (this._entries.length === 0)
            return 'Debug Directory: empty';
        return `Debug Directory (${this._entries.length} entries):\n` +
            this._entries.map((e, i) => `  [${i}] ${e}`).join('\n');
    }
}
