import { rvaToOffset, hex } from "./helpers.ts";
export class ExportEntry {
    constructor(ordinal, rva, name, forwarder) {
        this._ordinal = ordinal;
        this._rva = rva;
        this._name = name;
        this._forwarder = forwarder;
    }
    get ordinal() { return this._ordinal; }
    get rva() { return this._rva; }
    get name() { return this._name; }
    get forwarder() { return this._forwarder; }
    toString() {
        const name = this._name ?? `(ordinal only)`;
        const target = this._forwarder ? `-> ${this._forwarder}` : hex(this._rva);
        return `[${this._ordinal}] ${name} ${target}`;
    }
}
export class ExportTable {
    constructor(data, fileImage, sections, exportDirRva, exportDirSize) {
        this._entries = [];
        this._dllName = '';
        this._ordinalBase = 0;
        this._timeDateStamp = 0;
        if (data.length < 40)
            return;
        this._timeDateStamp = data.readUInt32LE(4);
        const nameRva = data.readUInt32LE(12);
        this._ordinalBase = data.readUInt32LE(16);
        const numberOfFunctions = data.readUInt32LE(20);
        const numberOfNames = data.readUInt32LE(24);
        const addressOfFunctions = data.readUInt32LE(28);
        const addressOfNames = data.readUInt32LE(32);
        const addressOfNameOrdinals = data.readUInt32LE(36);
        // Resolve DLL name
        const nameOffset = rvaToOffset(nameRva, sections);
        if (nameOffset !== -1) {
            const end = fileImage.indexOf(0, nameOffset);
            this._dllName = fileImage.subarray(nameOffset, end !== -1 ? end : nameOffset + 256).toString('utf8');
        }
        // Read Export Address Table
        const eatOffset = rvaToOffset(addressOfFunctions, sections);
        if (eatOffset === -1)
            return;
        // Read Name Pointer Table and Ordinal Table
        const nptOffset = numberOfNames > 0 ? rvaToOffset(addressOfNames, sections) : -1;
        const otOffset = numberOfNames > 0 ? rvaToOffset(addressOfNameOrdinals, sections) : -1;
        // Build ordinal-to-name map
        const ordinalToName = new Map();
        if (nptOffset !== -1 && otOffset !== -1) {
            for (let i = 0; i < numberOfNames; i++) {
                const funcNameRva = fileImage.readUInt32LE(nptOffset + i * 4);
                const ordinalIndex = fileImage.readUInt16LE(otOffset + i * 2);
                const funcNameOffset = rvaToOffset(funcNameRva, sections);
                if (funcNameOffset !== -1) {
                    const end = fileImage.indexOf(0, funcNameOffset);
                    const funcName = fileImage.subarray(funcNameOffset, end !== -1 ? end : funcNameOffset + 256).toString('utf8');
                    ordinalToName.set(ordinalIndex, funcName);
                }
            }
        }
        // Build export entries
        for (let i = 0; i < numberOfFunctions; i++) {
            const funcRva = fileImage.readUInt32LE(eatOffset + i * 4);
            if (funcRva === 0)
                continue;
            const ordinal = this._ordinalBase + i;
            const name = ordinalToName.get(i) ?? null;
            // Check if this is a forwarder (RVA points within the export directory)
            let forwarder = null;
            if (funcRva >= exportDirRva && funcRva < exportDirRva + exportDirSize) {
                const fwdOffset = rvaToOffset(funcRva, sections);
                if (fwdOffset !== -1) {
                    const end = fileImage.indexOf(0, fwdOffset);
                    forwarder = fileImage.subarray(fwdOffset, end !== -1 ? end : fwdOffset + 256).toString('utf8');
                }
            }
            this._entries.push(new ExportEntry(ordinal, funcRva, name, forwarder));
        }
    }
    get dllName() { return this._dllName; }
    get ordinalBase() { return this._ordinalBase; }
    get timeDateStamp() { return this._timeDateStamp; }
    get entries() { return this._entries; }
    toString() {
        if (this._entries.length === 0)
            return 'Export Table: empty';
        return `Export Table: ${this._dllName} (${this._entries.length} exports, base ${this._ordinalBase}):\n` +
            this._entries.map(e => `  ${e}`).join('\n');
    }
}
