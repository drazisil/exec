"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXEFile = void 0;
var node_fs_1 = require("node:fs");
var BaseRelocationTable_ts_1 = require("./BaseRelocationTable.ts");
var BoundImportTable_ts_1 = require("./BoundImportTable.ts");
var COFFFileHeader_ts_1 = require("./COFFFileHeader.ts");
var DebugDirectory_ts_1 = require("./DebugDirectory.ts");
var DelayImportTable_ts_1 = require("./DelayImportTable.ts");
var ExceptionTable_ts_1 = require("./ExceptionTable.ts");
var ExportTable_ts_1 = require("./ExportTable.ts");
var helpers_ts_1 = require("./helpers.ts");
var ImportTable_ts_1 = require("./ImportTable.ts");
var LoadConfigDirectory_ts_1 = require("./LoadConfigDirectory.ts");
var OptionalHeader_ts_1 = require("./OptionalHeader.ts");
var SectionHeader_ts_1 = require("./SectionHeader.ts");
var TLSTable_ts_1 = require("./TLSTable.ts");
var ImportResolver_ts_1 = require("./loader/ImportResolver.ts");
var EXEFile = /** @class */ (function () {
    function EXEFile(filePath, dllSearchPaths) {
        if (dllSearchPaths === void 0) { dllSearchPaths = []; }
        this._filePath = "";
        this._fileImage = Buffer.alloc(0);
        this._imageSize = 0;
        this._peStartOffset = 0;
        this._exportTable = null;
        this._importTable = null;
        this._exceptionTable = null;
        this._baseRelocationTable = null;
        this._debugDirectory = null;
        this._tlsDirectory = null;
        this._loadConfigDirectory = null;
        this._boundImportTable = null;
        this._delayImportTable = null;
        this._filePath = filePath;
        console.log("loading ".concat(this._filePath));
        this._fileImage = ((0, node_fs_1.readFileSync)(this._filePath));
        this._imageSize = this._fileImage.byteLength;
        this._peStartOffset = (0, helpers_ts_1.get16)(this._fileImage, 0x3c) + 4;
        this._coffFileHEader = new COFFFileHeader_ts_1.COFFFileHeader(this._fileImage.subarray(this._peStartOffset, this._peStartOffset + COFFFileHeader_ts_1.COFFFileHeader.sizeOf));
        var optHeaderOffset = this._peStartOffset + COFFFileHeader_ts_1.COFFFileHeader.sizeOf;
        this._optionalHeader = new OptionalHeader_ts_1.OptionalHeader(this._fileImage.subarray(optHeaderOffset, optHeaderOffset + this._coffFileHEader.sizeOfOptionalHeader));
        var sectionTableOffset = optHeaderOffset + this._coffFileHEader.sizeOfOptionalHeader;
        this._sectionHeaders = [];
        for (var i = 0; i < this._coffFileHEader.numberOfSections; i++) {
            var offset = sectionTableOffset + i * SectionHeader_ts_1.SectionHeader.sizeOf;
            this._sectionHeaders.push(new SectionHeader_ts_1.SectionHeader(this._fileImage.subarray(offset, offset + SectionHeader_ts_1.SectionHeader.sizeOf)));
        }
        for (var _i = 0, _a = this._sectionHeaders; _i < _a.length; _i++) {
            var section = _a[_i];
            section.resolve(this._fileImage);
        }
        for (var _b = 0, _c = this._optionalHeader.dataDirectories; _b < _c.length; _b++) {
            var dd = _c[_b];
            dd.resolve(this._fileImage, this._sectionHeaders);
        }
        this.parseDataDirectories();
        // Initialize the import resolver
        this._importResolver = new ImportResolver_ts_1.ImportResolver({ dllSearchPaths: dllSearchPaths });
    }
    EXEFile.prototype.parseDataDirectories = function () {
        var dirs = this._optionalHeader.dataDirectories;
        var img = this._fileImage;
        var sects = this._sectionHeaders;
        var pe32plus = this._optionalHeader.isPE32Plus;
        var dir = function (index) { var _a; return ((_a = dirs[index]) === null || _a === void 0 ? void 0 : _a.data.length) > 0 ? dirs[index] : null; };
        // [0] Export Table
        var exportDir = dir(0);
        if (exportDir) {
            this._exportTable = new ExportTable_ts_1.ExportTable(exportDir.data, img, sects, exportDir.virtualAddress, exportDir.size);
        }
        // [1] Import Table
        var importDir = dir(1);
        if (importDir) {
            this._importTable = new ImportTable_ts_1.ImportTable(importDir.data, img, sects, pe32plus);
        }
        // [3] Exception Table
        var exceptionDir = dir(3);
        if (exceptionDir) {
            this._exceptionTable = new ExceptionTable_ts_1.ExceptionTable(exceptionDir.data);
        }
        // [5] Base Relocation Table
        var relocDir = dir(5);
        if (relocDir) {
            this._baseRelocationTable = new BaseRelocationTable_ts_1.BaseRelocationTable(relocDir.data);
        }
        // [6] Debug Directory
        var debugDir = dir(6);
        if (debugDir) {
            this._debugDirectory = new DebugDirectory_ts_1.DebugDirectory(debugDir.data, img);
        }
        // [9] TLS Table
        var tlsDir = dir(9);
        if (tlsDir) {
            this._tlsDirectory = new TLSTable_ts_1.TLSDirectory(tlsDir.data, img, sects, pe32plus, this._optionalHeader.imageBase);
        }
        // [10] Load Config Directory
        var loadConfigDir = dir(10);
        if (loadConfigDir) {
            this._loadConfigDirectory = new LoadConfigDirectory_ts_1.LoadConfigDirectory(loadConfigDir.data, pe32plus);
        }
        // [11] Bound Import
        var boundDir = dir(11);
        if (boundDir) {
            this._boundImportTable = new BoundImportTable_ts_1.BoundImportTable(boundDir.data);
        }
        // [13] Delay Import Descriptor
        var delayDir = dir(13);
        if (delayDir) {
            this._delayImportTable = new DelayImportTable_ts_1.DelayImportTable(delayDir.data, img, sects, pe32plus);
        }
    };
    Object.defineProperty(EXEFile.prototype, "filePath", {
        get: function () {
            return this._filePath;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "sizeOnDisk", {
        get: function () {
            return this._imageSize;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "fileSignature", {
        get: function () {
            return this._fileImage.subarray(0, 2).toString();
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "peStartOffset", {
        get: function () {
            return this._peStartOffset;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "machineType", {
        get: function () {
            return this._coffFileHEader.machine;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "optionalHeader", {
        get: function () {
            return this._optionalHeader;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "sectionHeaders", {
        get: function () {
            return this._sectionHeaders;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "coffFileHeader", {
        get: function () {
            return this._coffFileHEader;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "exportTable", {
        get: function () {
            return this._exportTable;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "importTable", {
        get: function () {
            return this._importTable;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "exceptionTable", {
        get: function () {
            return this._exceptionTable;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "baseRelocationTable", {
        get: function () {
            return this._baseRelocationTable;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "debugDirectory", {
        get: function () {
            return this._debugDirectory;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "tlsDirectory", {
        get: function () {
            return this._tlsDirectory;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "loadConfigDirectory", {
        get: function () {
            return this._loadConfigDirectory;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "boundImportTable", {
        get: function () {
            return this._boundImportTable;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "delayImportTable", {
        get: function () {
            return this._delayImportTable;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(EXEFile.prototype, "importResolver", {
        get: function () {
            return this._importResolver;
        },
        enumerable: false,
        configurable: true
    });
    EXEFile.prototype.toString = function () {
        var sections = this._sectionHeaders.map(function (s, i) { return "--- Section ".concat(i + 1, " ---\n").concat(s); }).join('\n\n');
        return [
            "=== ".concat(this._filePath, " ==="),
            "File Size: ".concat(this._imageSize, " bytes"),
            "File Signature: ".concat(this.fileSignature),
            "PE Start Offset: ".concat((0, helpers_ts_1.hex)(this._peStartOffset)),
            "",
            "--- COFF File Header ---",
            "".concat(this._coffFileHEader),
            "",
            "--- Optional Header ---",
            "".concat(this._optionalHeader),
            "",
            sections,
        ].join('\n');
    };
    return EXEFile;
}());
exports.EXEFile = EXEFile;
