import { rvaToOffset, hex } from "./helpers.js";
import { SectionHeader } from "./SectionHeader.js";
import { ImportEntry } from "./ImportTable.js";

export class DelayImportDescriptor {
    private _attributes: number;
    private _dllName: string;
    private _moduleHandle: number;
    private _iat: number;
    private _int: number;
    private _boundIAT: number;
    private _unloadIAT: number;
    private _timeDateStamp: number;
    private _entries: ImportEntry[];

    constructor(dllName: string, attributes: number, moduleHandle: number, iat: number, int: number, boundIAT: number, unloadIAT: number, timeDateStamp: number, entries: ImportEntry[]) {
        this._dllName = dllName;
        this._attributes = attributes;
        this._moduleHandle = moduleHandle;
        this._iat = iat;
        this._int = int;
        this._boundIAT = boundIAT;
        this._unloadIAT = unloadIAT;
        this._timeDateStamp = timeDateStamp;
        this._entries = entries;
    }

    get attributes() { return this._attributes; }
    get dllName() { return this._dllName; }
    get entries() { return this._entries; }

    toString() {
        const header = `${this._dllName} (${this._entries.length} imports)`;
        const entries = this._entries.map((e, i) => `    [${i}] ${e}`).join('\n');
        return `${header}\n${entries}`;
    }
}

export class DelayImportTable {
    private _descriptors: DelayImportDescriptor[];

    constructor(data: Buffer, fileImage: Buffer, sections: SectionHeader[], isPE32Plus: boolean) {
        this._descriptors = [];
        if (data.length === 0) return;

        const descriptorSize = 32;

        for (let i = 0; ; i++) {
            const offset = i * descriptorSize;
            if (offset + descriptorSize > data.length) break;

            const attributes = data.readUInt32LE(offset);
            const dllNameRva = data.readUInt32LE(offset + 4);
            const moduleHandle = data.readUInt32LE(offset + 8);
            const iatRva = data.readUInt32LE(offset + 12);
            const intRva = data.readUInt32LE(offset + 16);
            const boundIATRva = data.readUInt32LE(offset + 20);
            const unloadIATRva = data.readUInt32LE(offset + 24);
            const timeDateStamp = data.readUInt32LE(offset + 28);

            // All-zero terminates
            if (dllNameRva === 0 && intRva === 0 && iatRva === 0) break;

            // Resolve DLL name
            const nameOffset = rvaToOffset(dllNameRva, sections);
            let dllName = '<unknown>';
            if (nameOffset !== -1) {
                const end = fileImage.indexOf(0, nameOffset);
                dllName = fileImage.subarray(nameOffset, end !== -1 ? end : nameOffset + 256).toString('utf8');
            }

            // Walk Import Name Table thunks
            const entries = this.parseThunks(fileImage, sections, intRva, iatRva, isPE32Plus);

            this._descriptors.push(new DelayImportDescriptor(dllName, attributes, moduleHandle, iatRva, intRva, boundIATRva, unloadIATRva, timeDateStamp, entries));
        }
    }

    private parseThunks(fileImage: Buffer, sections: SectionHeader[], intRva: number, firstThunkRva: number, isPE32Plus: boolean): ImportEntry[] {
        const entries: ImportEntry[] = [];
        const intOffset = rvaToOffset(intRva, sections);
        if (intOffset === -1) return entries;

        const iatBaseOffset = rvaToOffset(firstThunkRva, sections);
        const thunkSize = isPE32Plus ? 8 : 4;

        for (let i = 0; ; i++) {
            const offset = intOffset + i * thunkSize;
            if (offset + thunkSize > fileImage.length) break;
            const iatRva = firstThunkRva + i * thunkSize;
            const iatFileOffset = iatBaseOffset !== -1 ? iatBaseOffset + i * thunkSize : -1;

            if (isPE32Plus) {
                const thunk = fileImage.readBigUInt64LE(offset);
                if (thunk === 0n) break;
                const iatValue = iatFileOffset !== -1 ? Number(fileImage.readBigUInt64LE(iatFileOffset)) : 0;
                if (thunk & 0x8000000000000000n) {
                    const ordinal = Number(thunk & 0xFFFFn);
                    entries.push(new ImportEntry(ordinal, 0, `Ordinal #${ordinal}`, iatRva, iatFileOffset, iatValue));
                } else {
                    this.readHintName(fileImage, sections, Number(thunk), iatRva, iatFileOffset, iatValue, entries);
                }
            } else {
                const thunk = fileImage.readUInt32LE(offset);
                if (thunk === 0) break;
                const iatValue = iatFileOffset !== -1 ? fileImage.readUInt32LE(iatFileOffset) : 0;
                if (thunk & 0x80000000) {
                    const ordinal = thunk & 0xFFFF;
                    entries.push(new ImportEntry(ordinal, 0, `Ordinal #${ordinal}`, iatRva, iatFileOffset, iatValue));
                } else {
                    this.readHintName(fileImage, sections, thunk, iatRva, iatFileOffset, iatValue, entries);
                }
            }
        }
        return entries;
    }

    private readHintName(fileImage: Buffer, sections: SectionHeader[], rva: number, iatRva: number, iatFileOffset: number, iatValue: number, entries: ImportEntry[]) {
        const offset = rvaToOffset(rva, sections);
        if (offset === -1) return;
        const hint = fileImage.readUInt16LE(offset);
        const nameStart = offset + 2;
        const nameEnd = fileImage.indexOf(0, nameStart);
        const name = fileImage.subarray(nameStart, nameEnd !== -1 ? nameEnd : nameStart + 256).toString('utf8');
        entries.push(new ImportEntry(null, hint, name, iatRva, iatFileOffset, iatValue));
    }

    get descriptors() { return this._descriptors; }

    toString() {
        if (this._descriptors.length === 0) return 'Delay Import Table: empty';
        return `Delay Import Table (${this._descriptors.length} DLLs):\n` +
            this._descriptors.map((d, i) => `  [${i}] ${d}`).join('\n\n');
    }
}
