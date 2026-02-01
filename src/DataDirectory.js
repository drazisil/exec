import { rvaToOffset, hex } from "./helpers.ts";
export class DataDirectory {
    static get sizeOf() {
        return 8;
    }
    constructor(data, index) {
        this._data = Buffer.alloc(0);
        this._virtualAddress = data.readUInt32LE(0);
        this._size = data.readUInt32LE(4);
        this._index = index;
        this._name = DataDirectoryNames[index] ?? `Unknown (${index})`;
    }
    resolve(fileImage, sections) {
        if (this._virtualAddress === 0 || this._size === 0)
            return;
        let fileOffset;
        if (this._index === 4) {
            // Certificate Table uses a file pointer, not an RVA
            fileOffset = this._virtualAddress;
        }
        else {
            fileOffset = rvaToOffset(this._virtualAddress, sections);
            if (fileOffset === -1)
                return;
        }
        this._data = fileImage.subarray(fileOffset, fileOffset + this._size);
    }
    get virtualAddress() {
        return this._virtualAddress;
    }
    get size() {
        return this._size;
    }
    get name() {
        return this._name;
    }
    get data() {
        return this._data;
    }
    toString() {
        let str = `${this._name}: ${hex(this._virtualAddress)} (${hex(this._size)} bytes)`;
        if (this._data.length > 0) {
            const rows = [];
            for (let i = 0; i < this._data.length; i += 16) {
                const chunk = this._data.subarray(i, Math.min(i + 16, this._data.length));
                const hexBytes = Array.from(chunk).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
                const ascii = Array.from(chunk).map(b => b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.').join('');
                rows.push(`    ${hex(i, 8)}  ${hexBytes.padEnd(47)}  ${ascii}`);
            }
            str += '\n' + rows.join('\n');
        }
        return str;
    }
}
export const DataDirectoryNames = [
    'Export Table',
    'Import Table',
    'Resource Table',
    'Exception Table',
    'Certificate Table',
    'Base Relocation Table',
    'Debug',
    'Architecture',
    'Global Ptr',
    'TLS Table',
    'Load Config Table',
    'Bound Import',
    'IAT',
    'Delay Import Descriptor',
    'CLR Runtime Header',
    'Reserved',
];
