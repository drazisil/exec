import { readFileSync } from "node:fs";
import { BaseRelocationTable } from "./BaseRelocationTable.js";
import { BoundImportTable } from "./BoundImportTable.js";
import { COFFFileHeader } from "./COFFFileHeader.js";
import { DebugDirectory } from "./DebugDirectory.js";
import { DelayImportTable } from "./DelayImportTable.js";
import { ExceptionTable } from "./ExceptionTable.js";
import { ExportTable } from "./ExportTable.js";
import { get16, hex } from "./helpers.js";
import { ImportTable } from "./ImportTable.js";
import { LoadConfigDirectory } from "./LoadConfigDirectory.js";
import { OptionalHeader } from "./OptionalHeader.js";
import { SectionHeader } from "./SectionHeader.js";
import { TLSDirectory } from "./TLSTable.js";
import { ImportResolver } from "./loader/ImportResolver.js";


export class EXEFile {
    private _filePath = "";
    private _fileImage: Buffer = Buffer.alloc(0);
    private _imageSize = 0;
    private _peStartOffset = 0;
    private _coffFileHEader: COFFFileHeader;
    private _optionalHeader: OptionalHeader;
    private _sectionHeaders: SectionHeader[];
    private _exportTable: ExportTable | null = null;
    private _importTable: ImportTable | null = null;
    private _exceptionTable: ExceptionTable | null = null;
    private _baseRelocationTable: BaseRelocationTable | null = null;
    private _debugDirectory: DebugDirectory | null = null;
    private _tlsDirectory: TLSDirectory | null = null;
    private _loadConfigDirectory: LoadConfigDirectory | null = null;
    private _boundImportTable: BoundImportTable | null = null;
    private _delayImportTable: DelayImportTable | null = null;
    private _importResolver: ImportResolver;

    constructor(filePath: string, dllSearchPaths: string[] = []) {
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

        this.parseDataDirectories();

        // Initialize the import resolver
        this._importResolver = new ImportResolver({ dllSearchPaths });
    }

    private parseDataDirectories() {
        const dirs = this._optionalHeader.dataDirectories;
        const img = this._fileImage;
        const sects = this._sectionHeaders;
        const pe32plus = this._optionalHeader.isPE32Plus;

        const dir = (index: number) => dirs[index]?.data.length > 0 ? dirs[index] : null;

        // [0] Export Table
        const exportDir = dir(0);
        if (exportDir) {
            this._exportTable = new ExportTable(exportDir.data, img, sects, exportDir.virtualAddress, exportDir.size);
        }

        // [1] Import Table
        const importDir = dir(1);
        if (importDir) {
            this._importTable = new ImportTable(importDir.data, img, sects, pe32plus);
        }

        // [3] Exception Table
        const exceptionDir = dir(3);
        if (exceptionDir) {
            this._exceptionTable = new ExceptionTable(exceptionDir.data);
        }

        // [5] Base Relocation Table
        const relocDir = dir(5);
        if (relocDir) {
            this._baseRelocationTable = new BaseRelocationTable(relocDir.data);
        }

        // [6] Debug Directory
        const debugDir = dir(6);
        if (debugDir) {
            this._debugDirectory = new DebugDirectory(debugDir.data, img);
        }

        // [9] TLS Table
        const tlsDir = dir(9);
        if (tlsDir) {
            this._tlsDirectory = new TLSDirectory(tlsDir.data, img, sects, pe32plus, this._optionalHeader.imageBase);
        }

        // [10] Load Config Directory
        const loadConfigDir = dir(10);
        if (loadConfigDir) {
            this._loadConfigDirectory = new LoadConfigDirectory(loadConfigDir.data, pe32plus);
        }

        // [11] Bound Import
        const boundDir = dir(11);
        if (boundDir) {
            this._boundImportTable = new BoundImportTable(boundDir.data);
        }

        // [13] Delay Import Descriptor
        const delayDir = dir(13);
        if (delayDir) {
            this._delayImportTable = new DelayImportTable(delayDir.data, img, sects, pe32plus);
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

    get exportTable() {
        return this._exportTable;
    }

    get importTable() {
        return this._importTable;
    }

    get exceptionTable() {
        return this._exceptionTable;
    }

    get baseRelocationTable() {
        return this._baseRelocationTable;
    }

    get debugDirectory() {
        return this._debugDirectory;
    }

    get tlsDirectory() {
        return this._tlsDirectory;
    }

    get loadConfigDirectory() {
        return this._loadConfigDirectory;
    }

    get boundImportTable() {
        return this._boundImportTable;
    }

    get delayImportTable() {
        return this._delayImportTable;
    }

    get importResolver() {
        return this._importResolver;
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

