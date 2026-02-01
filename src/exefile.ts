import { readFileSync } from "node:fs";
import { COFFFileHeader } from "./COFFFileHeader.ts";
import { get16, hex } from "./helpers.ts";
import { ImportTable } from "./ImportTable.ts";
import { OptionalHeader } from "./OptionalHeader.ts";
import { SectionHeader } from "./SectionHeader.ts";


export class EXEFile {
    private _filePath = "";
    private _fileImage: Buffer = Buffer.alloc(0);
    private _imageSize = 0;
    private _peStartOffset = 0;
    private _coffFileHEader: COFFFileHeader;
    private _optionalHeader: OptionalHeader;
    private _sectionHeaders: SectionHeader[];
    private _importTable: ImportTable | null = null;

    constructor(filePath: string) {
        this._filePath = filePath;
        console.log(`loading ${this._filePath}`);
        this._fileImage = (readFileSync(this._filePath)) as unknown as Buffer;
        this._imageSize = this._fileImage.byteLength;
        this._peStartOffset = get16(this._fileImage, 0x3c) + 4;
        this._coffFileHEader = new COFFFileHeader(this._fileImage.subarray(this._peStartOffset, this._peStartOffset + COFFFileHeader.sizeOf));

        const optHeaderOffset = this._peStartOffset + COFFFileHeader.sizeOf;
        this._optionalHeader = new OptionalHeader(this._fileImage.subarray(optHeaderOffset, optHeaderOffset + this._coffFileHEader.sizeOfOptionalHeader));

        const sectionTableOffset = optHeaderOffset + this._coffFileHEader.sizeOfOptionalHeader;
        this._sectionHeaders = [];
        for (let i = 0; i < this._coffFileHEader.numberOfSections; i++) {
            const offset = sectionTableOffset + i * SectionHeader.sizeOf;
            this._sectionHeaders.push(
                new SectionHeader(this._fileImage.subarray(offset, offset + SectionHeader.sizeOf))
            );
        }

        for (const section of this._sectionHeaders) {
            section.resolve(this._fileImage);
        }

        for (const dd of this._optionalHeader.dataDirectories) {
            dd.resolve(this._fileImage, this._sectionHeaders);
        }

        // Parse structured import table (data directory index 1)
        const importDir = this._optionalHeader.dataDirectories[1];
        if (importDir && importDir.data.length > 0) {
            this._importTable = new ImportTable(
                importDir.data,
                this._fileImage,
                this._sectionHeaders,
                this._optionalHeader.isPE32Plus,
            );
        }
    }


    get filePath() {
        return this._filePath;
    }


    get sizeOnDisk() {
        return this._imageSize;
    }

    get fileSignature() {
        return this._fileImage.subarray(0, 2).toString();
    }

    get peStartOffset() {
        return this._peStartOffset;
    }

    get machineType() {
        return this._coffFileHEader.machine;
    }

    get optionalHeader() {
        return this._optionalHeader;
    }

    get sectionHeaders() {
        return this._sectionHeaders;
    }

    get coffFileHeader() {
        return this._coffFileHEader;
    }

    get importTable() {
        return this._importTable;
    }

    toString() {
        const sections = this._sectionHeaders.map((s, i) => `--- Section ${i + 1} ---\n${s}`
        ).join('\n\n');

        return [
            `=== ${this._filePath} ===`,
            `File Size: ${this._imageSize} bytes`,
            `File Signature: ${this.fileSignature}`,
            `PE Start Offset: ${hex(this._peStartOffset)}`,
            ``,
            `--- COFF File Header ---`,
            `${this._coffFileHEader}`,
            ``,
            `--- Optional Header ---`,
            `${this._optionalHeader}`,
            ``,
            sections,
        ].join('\n');
    }
}

