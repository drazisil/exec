import { rvaToOffset, hex } from "./helpers.ts";
import { SectionHeader } from "./SectionHeader.ts";

export class ImportEntry {
    private _ordinal: number | null;
    private _hint: number;
    private _name: string;
    private _iatRva: number;
    private _iatFileOffset: number;
    private _iatValue: number;

    constructor(ordinal: number | null, hint: number, name: string, iatRva: number, iatFileOffset: number, iatValue: number) {
        this._ordinal = ordinal;
        this._hint = hint;
        this._name = name;
        this._iatRva = iatRva;
        this._iatFileOffset = iatFileOffset;
        this._iatValue = iatValue;
    }

    get ordinal() { return this._ordinal; }
    get hint() { return this._hint; }
    get name() { return this._name; }
    get iatRva() { return this._iatRva; }
    get iatFileOffset() { return this._iatFileOffset; }
    get iatValue() { return this._iatValue; }

    toString() {
        if (this._ordinal !== null) {
            return `${hex(this._iatRva)}  ${hex(this._iatValue)}  Ordinal #${this._ordinal}`;
        }
        return `${hex(this._iatRva)}  ${hex(this._iatValue)}  ${this._name} (hint: ${this._hint})`;
    }
}

export class ImportDescriptor {
    private _dllName: string;
    private _entries: ImportEntry[];
    private _originalFirstThunk: number;
    private _firstThunk: number;

    constructor(dllName: string, entries: ImportEntry[], originalFirstThunk: number, firstThunk: number) {
        this._dllName = dllName;
        this._entries = entries;
        this._originalFirstThunk = originalFirstThunk;
        this._firstThunk = firstThunk;
    }

    get dllName() { return this._dllName; }
    get entries() { return this._entries; }
    get originalFirstThunk() { return this._originalFirstThunk; }
    get firstThunk() { return this._firstThunk; }

    toString() {
        const header = `${this._dllName} (${this._entries.length} imports)`;
        const entries = this._entries.map((e, i) => `    [${i}] ${e}`).join('\n');
        return `${header}\n${entries}`;
    }
}

export class ImportTable {
    private _descriptors: ImportDescriptor[];

    constructor(data: Buffer, fileImage: Buffer, sections: SectionHeader[], isPE32Plus: boolean) {
        this._descriptors = [];
        if (data.length === 0) return;

        const descriptorSize = 20;

        for (let i = 0; ; i++) {
            const offset = i * descriptorSize;
            if (offset + descriptorSize > data.length) break;

            const originalFirstThunk = data.readUInt32LE(offset);
            const nameRva = data.readUInt32LE(offset + 12);
            const firstThunk = data.readUInt32LE(offset + 16);

            // All-zero entry terminates the list
            if (originalFirstThunk === 0 && nameRva === 0 && firstThunk === 0) break;

            // Resolve DLL name
            const nameFileOffset = rvaToOffset(nameRva, sections);
            let dllName = '<unknown>';
            if (nameFileOffset !== -1) {
                const nameEnd = fileImage.indexOf(0, nameFileOffset);
                dllName = fileImage.subarray(nameFileOffset, nameEnd !== -1 ? nameEnd : nameFileOffset + 256).toString('utf8');
            }

            // Walk thunk array — prefer OriginalFirstThunk, fall back to FirstThunk
            const thunkRva = originalFirstThunk !== 0 ? originalFirstThunk : firstThunk;
            const entries = this.parseThunks(fileImage, sections, thunkRva, firstThunk, isPE32Plus);

            this._descriptors.push(new ImportDescriptor(dllName, entries, originalFirstThunk, firstThunk));
        }
    }

    private parseThunks(fileImage: Buffer, sections: SectionHeader[], thunkRva: number, firstThunkRva: number, isPE32Plus: boolean): ImportEntry[] {
        const entries: ImportEntry[] = [];
        const thunkFileOffset = rvaToOffset(thunkRva, sections);
        if (thunkFileOffset === -1) return entries;

        const iatBaseFileOffset = rvaToOffset(firstThunkRva, sections);
        const thunkSize = isPE32Plus ? 8 : 4;

        for (let i = 0; ; i++) {
            const offset = thunkFileOffset + i * thunkSize;
            if (offset + thunkSize > fileImage.length) break;
            const iatRva = firstThunkRva + i * thunkSize;
            const iatFileOffset = iatBaseFileOffset !== -1 ? iatBaseFileOffset + i * thunkSize : -1;

            if (isPE32Plus) {
                const thunk = fileImage.readBigUInt64LE(offset);
                if (thunk === 0n) break;

                const iatValue = iatFileOffset !== -1 ? Number(fileImage.readBigUInt64LE(iatFileOffset)) : 0;

                if (thunk & 0x8000000000000000n) {
                    const ordinal = Number(thunk & 0xFFFFn);
                    entries.push(new ImportEntry(ordinal, 0, `Ordinal #${ordinal}`, iatRva, iatFileOffset, iatValue));
                } else {
                    const hintNameRva = Number(thunk);
                    this.readHintName(fileImage, sections, hintNameRva, iatRva, iatFileOffset, iatValue, entries);
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
        const hintNameOffset = rvaToOffset(rva, sections);
        if (hintNameOffset === -1) return;

        const hint = fileImage.readUInt16LE(hintNameOffset);
        const nameStart = hintNameOffset + 2;
        const nameEnd = fileImage.indexOf(0, nameStart);
        const name = fileImage.subarray(nameStart, nameEnd !== -1 ? nameEnd : nameStart + 256).toString('utf8');
        entries.push(new ImportEntry(null, hint, name, iatRva, iatFileOffset, iatValue));
    }

    get descriptors() { return this._descriptors; }

    toString() {
        if (this._descriptors.length === 0) return 'Import Table: empty';
        return `Import Table (${this._descriptors.length} DLLs):\n` +
            this._descriptors.map((d, i) => `  [${i}] ${d}`).join('\n\n');
    }
}
