import { hex } from "./helpers.ts";

const RelocTypeNames: Record<number, string> = {
    0: 'ABS',
    1: 'HIGH',
    2: 'LOW',
    3: 'HIGHLOW',
    4: 'HIGHADJ',
    5: 'MIPS_JMPADDR',
    9: 'MIPS_JMPADDR16',
    10: 'DIR64',
};

export class RelocationEntry {
    private _type: number;
    private _offset: number;

    constructor(type: number, offset: number) {
        this._type = type;
        this._offset = offset;
    }

    get type() { return this._type; }
    get offset() { return this._offset; }
    get typeName() { return RelocTypeNames[this._type] ?? `UNKNOWN(${this._type})`; }

    toString() {
        return `${this.typeName} +${hex(this._offset, 3)}`;
    }
}

export class RelocationBlock {
    private _pageRva: number;
    private _entries: RelocationEntry[];

    constructor(pageRva: number, entries: RelocationEntry[]) {
        this._pageRva = pageRva;
        this._entries = entries;
    }

    get pageRva() { return this._pageRva; }
    get entries() { return this._entries; }

    toString() {
        return `Page ${hex(this._pageRva)} (${this._entries.length} entries):\n` +
            this._entries.map(e => `  ${e}`).join('\n');
    }
}

export class BaseRelocationTable {
    private _blocks: RelocationBlock[];
    private _totalEntries: number;

    constructor(data: Buffer) {
        this._blocks = [];
        this._totalEntries = 0;
        if (data.length === 0) return;

        let offset = 0;
        while (offset + 8 <= data.length) {
            const pageRva = data.readUInt32LE(offset);
            const blockSize = data.readUInt32LE(offset + 4);

            if (blockSize === 0) break;
            if (blockSize < 8) break;

            const entryCount = (blockSize - 8) / 2;
            const entries: RelocationEntry[] = [];

            for (let i = 0; i < entryCount; i++) {
                const entryOffset = offset + 8 + i * 2;
                if (entryOffset + 2 > data.length) break;

                const value = data.readUInt16LE(entryOffset);
                const type = (value >> 12) & 0xF;
                const pageOffset = value & 0xFFF;

                // Type 0 (ABS) entries are padding, skip them
                if (type !== 0) {
                    entries.push(new RelocationEntry(type, pageOffset));
                }
            }

            this._blocks.push(new RelocationBlock(pageRva, entries));
            this._totalEntries += entries.length;
            offset += blockSize;
        }
    }

    get blocks() { return this._blocks; }
    get totalEntries() { return this._totalEntries; }

    toString() {
        if (this._blocks.length === 0) return 'Base Relocation Table: empty';
        return `Base Relocation Table (${this._blocks.length} pages, ${this._totalEntries} relocations):\n` +
            this._blocks.map(b => `  ${b}`).join('\n\n');
    }
}
