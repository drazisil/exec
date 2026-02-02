import { hex } from "./helpers.ts";

export class BoundForwarderRef {
    private _timeDateStamp: number;
    private _moduleName: string;

    constructor(timeDateStamp: number, moduleName: string) {
        this._timeDateStamp = timeDateStamp;
        this._moduleName = moduleName;
    }

    get timeDateStamp() { return this._timeDateStamp; }
    get moduleName() { return this._moduleName; }

    toString() {
        return `-> ${this._moduleName} (${hex(this._timeDateStamp)})`;
    }
}

export class BoundImportDescriptor {
    private _timeDateStamp: number;
    private _moduleName: string;
    private _forwarderRefs: BoundForwarderRef[];

    constructor(timeDateStamp: number, moduleName: string, forwarderRefs: BoundForwarderRef[]) {
        this._timeDateStamp = timeDateStamp;
        this._moduleName = moduleName;
        this._forwarderRefs = forwarderRefs;
    }

    get timeDateStamp() { return this._timeDateStamp; }
    get moduleName() { return this._moduleName; }
    get forwarderRefs() { return this._forwarderRefs; }

    toString() {
        const date = new Date(this._timeDateStamp * 1000).toUTCString();
        let str = `${this._moduleName} (${hex(this._timeDateStamp)} - ${date})`;
        if (this._forwarderRefs.length > 0) {
            str += '\n' + this._forwarderRefs.map(f => `    ${f}`).join('\n');
        }
        return str;
    }
}

export class BoundImportTable {
    private _descriptors: BoundImportDescriptor[];

    constructor(data: Buffer) {
        this._descriptors = [];
        if (data.length === 0) return;

        let offset = 0;
        while (offset + 8 <= data.length) {
            const timeDateStamp = data.readUInt32LE(offset);
            const offsetModuleName = data.readUInt16LE(offset + 4);
            const numberOfForwarderRefs = data.readUInt16LE(offset + 6);

            // All-zero terminates
            if (timeDateStamp === 0 && offsetModuleName === 0) break;

            // Read module name (offset from start of bound import data)
            const moduleName = this.readString(data, offsetModuleName);

            // Read forwarder refs
            const forwarderRefs: BoundForwarderRef[] = [];
            for (let i = 0; i < numberOfForwarderRefs; i++) {
                const fwdOffset = offset + 8 + i * 8;
                if (fwdOffset + 8 > data.length) break;
                const fwdTimeDateStamp = data.readUInt32LE(fwdOffset);
                const fwdNameOffset = data.readUInt16LE(fwdOffset + 4);
                const fwdName = this.readString(data, fwdNameOffset);
                forwarderRefs.push(new BoundForwarderRef(fwdTimeDateStamp, fwdName));
            }

            this._descriptors.push(new BoundImportDescriptor(timeDateStamp, moduleName, forwarderRefs));
            offset += 8 + numberOfForwarderRefs * 8;
        }
    }

    private readString(data: Buffer, offset: number): string {
        if (offset >= data.length) return '<unknown>';
        const end = data.indexOf(0, offset);
        return data.subarray(offset, end !== -1 ? end : Math.min(offset + 256, data.length)).toString('utf8');
    }

    get descriptors() { return this._descriptors; }

    toString() {
        if (this._descriptors.length === 0) return 'Bound Import Table: empty';
        return `Bound Import Table (${this._descriptors.length} entries):\n` +
            this._descriptors.map((d, i) => `  [${i}] ${d}`).join('\n');
    }
}
