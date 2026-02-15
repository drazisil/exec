"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OptionalHeader = void 0;
var DataDirectory_ts_1 = require("./DataDirectory.ts");
var helpers_ts_1 = require("./helpers.ts");
var OptionalHeader = /** @class */ (function () {
    function OptionalHeader(data) {
        // Standard fields (offsets 0-23 shared between PE32 and PE32+)
        this._magic = data.readUInt16LE(0);
        this._majorLinkerVersion = data.readUInt8(2);
        this._minorLinkerVersion = data.readUInt8(3);
        this._sizeOfCode = data.readUInt32LE(4);
        this._sizeOfInitializedData = data.readUInt32LE(8);
        this._sizeOfUninitializedData = data.readUInt32LE(12);
        this._addressOfEntryPoint = data.readUInt32LE(16);
        this._baseOfCode = data.readUInt32LE(20);
        if (this.isPE32Plus) {
            // PE32+: no BaseOfData, ImageBase is 8 bytes at offset 24
            this._baseOfData = 0;
            this._imageBase = Number(data.readBigUInt64LE(24));
        }
        else {
            // PE32: BaseOfData at offset 24, ImageBase at offset 28 (4 bytes each)
            this._baseOfData = data.readUInt32LE(24);
            this._imageBase = data.readUInt32LE(28);
        }
        // Offsets 32-70 are the same for both PE32 and PE32+
        this._sectionAlignment = data.readUInt32LE(32);
        this._fileAlignment = data.readUInt32LE(36);
        this._majorOperatingSystemVersion = data.readUInt16LE(40);
        this._minorOperatingSystemVersion = data.readUInt16LE(42);
        this._majorImageVersion = data.readUInt16LE(44);
        this._minorImageVersion = data.readUInt16LE(46);
        this._majorSubsystemVersion = data.readUInt16LE(48);
        this._minorSubsystemVersion = data.readUInt16LE(50);
        this._win32VersionValue = data.readUInt32LE(52);
        this._sizeOfImage = data.readUInt32LE(56);
        this._sizeOfHeaders = data.readUInt32LE(60);
        this._checkSum = data.readUInt32LE(64);
        this._subsystem = data.readUInt16LE(68);
        this._dllCharacteristics = data.readUInt16LE(70);
        if (this.isPE32Plus) {
            // PE32+: 8-byte stack/heap sizes
            this._sizeOfStackReserve = Number(data.readBigUInt64LE(72));
            this._sizeOfStackCommit = Number(data.readBigUInt64LE(80));
            this._sizeOfHeapReserve = Number(data.readBigUInt64LE(88));
            this._sizeOfHeapCommit = Number(data.readBigUInt64LE(96));
            this._loaderFlags = data.readUInt32LE(104);
            this._numberOfRvaAndSizes = data.readUInt32LE(108);
        }
        else {
            // PE32: 4-byte stack/heap sizes
            this._sizeOfStackReserve = data.readUInt32LE(72);
            this._sizeOfStackCommit = data.readUInt32LE(76);
            this._sizeOfHeapReserve = data.readUInt32LE(80);
            this._sizeOfHeapCommit = data.readUInt32LE(84);
            this._loaderFlags = data.readUInt32LE(88);
            this._numberOfRvaAndSizes = data.readUInt32LE(92);
        }
        // Parse data directories
        var ddOffset = this.isPE32Plus ? 112 : 96;
        this._dataDirectories = [];
        for (var i = 0; i < this._numberOfRvaAndSizes; i++) {
            var offset = ddOffset + i * DataDirectory_ts_1.DataDirectory.sizeOf;
            this._dataDirectories.push(new DataDirectory_ts_1.DataDirectory(data.subarray(offset, offset + DataDirectory_ts_1.DataDirectory.sizeOf), i));
        }
    }
    Object.defineProperty(OptionalHeader.prototype, "isPE32Plus", {
        get: function () {
            return this._magic === 0x20b;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "sizeOf", {
        get: function () {
            var base = this.isPE32Plus ? 112 : 96;
            return base + this._numberOfRvaAndSizes * DataDirectory_ts_1.DataDirectory.sizeOf;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "magic", {
        get: function () { return this._magic; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "majorLinkerVersion", {
        get: function () { return this._majorLinkerVersion; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "minorLinkerVersion", {
        get: function () { return this._minorLinkerVersion; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "sizeOfCode", {
        get: function () { return this._sizeOfCode; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "sizeOfInitializedData", {
        get: function () { return this._sizeOfInitializedData; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "sizeOfUninitializedData", {
        get: function () { return this._sizeOfUninitializedData; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "addressOfEntryPoint", {
        get: function () { return this._addressOfEntryPoint; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "baseOfCode", {
        get: function () { return this._baseOfCode; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "baseOfData", {
        get: function () { return this._baseOfData; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "imageBase", {
        get: function () { return this._imageBase; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "sectionAlignment", {
        get: function () { return this._sectionAlignment; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "fileAlignment", {
        get: function () { return this._fileAlignment; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "majorOperatingSystemVersion", {
        get: function () { return this._majorOperatingSystemVersion; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "minorOperatingSystemVersion", {
        get: function () { return this._minorOperatingSystemVersion; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "majorImageVersion", {
        get: function () { return this._majorImageVersion; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "minorImageVersion", {
        get: function () { return this._minorImageVersion; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "majorSubsystemVersion", {
        get: function () { return this._majorSubsystemVersion; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "minorSubsystemVersion", {
        get: function () { return this._minorSubsystemVersion; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "win32VersionValue", {
        get: function () { return this._win32VersionValue; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "sizeOfImage", {
        get: function () { return this._sizeOfImage; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "sizeOfHeaders", {
        get: function () { return this._sizeOfHeaders; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "checkSum", {
        get: function () { return this._checkSum; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "subsystem", {
        get: function () { return this._subsystem; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "dllCharacteristics", {
        get: function () { return this._dllCharacteristics; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "sizeOfStackReserve", {
        get: function () { return this._sizeOfStackReserve; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "sizeOfStackCommit", {
        get: function () { return this._sizeOfStackCommit; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "sizeOfHeapReserve", {
        get: function () { return this._sizeOfHeapReserve; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "sizeOfHeapCommit", {
        get: function () { return this._sizeOfHeapCommit; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "loaderFlags", {
        get: function () { return this._loaderFlags; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "numberOfRvaAndSizes", {
        get: function () { return this._numberOfRvaAndSizes; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(OptionalHeader.prototype, "dataDirectories", {
        get: function () { return this._dataDirectories; },
        enumerable: false,
        configurable: true
    });
    OptionalHeader.prototype.toString = function () {
        var format = this.isPE32Plus ? 'PE32+' : 'PE32';
        var lines = [
            "Magic:                        ".concat((0, helpers_ts_1.hex)(this._magic, 4), " (").concat(format, ")"),
            "LinkerVersion:                ".concat(this._majorLinkerVersion, ".").concat(this._minorLinkerVersion),
            "SizeOfCode:                   ".concat((0, helpers_ts_1.hex)(this._sizeOfCode)),
            "SizeOfInitializedData:        ".concat((0, helpers_ts_1.hex)(this._sizeOfInitializedData)),
            "SizeOfUninitializedData:      ".concat((0, helpers_ts_1.hex)(this._sizeOfUninitializedData)),
            "AddressOfEntryPoint:          ".concat((0, helpers_ts_1.hex)(this._addressOfEntryPoint)),
            "BaseOfCode:                   ".concat((0, helpers_ts_1.hex)(this._baseOfCode)),
        ];
        if (!this.isPE32Plus) {
            lines.push("BaseOfData:                   ".concat((0, helpers_ts_1.hex)(this._baseOfData)));
        }
        lines.push.apply(lines, __spreadArray(["ImageBase:                    ".concat((0, helpers_ts_1.hex)(this._imageBase)), "SectionAlignment:             ".concat((0, helpers_ts_1.hex)(this._sectionAlignment)), "FileAlignment:                ".concat((0, helpers_ts_1.hex)(this._fileAlignment)), "OperatingSystemVersion:       ".concat(this._majorOperatingSystemVersion, ".").concat(this._minorOperatingSystemVersion), "ImageVersion:                 ".concat(this._majorImageVersion, ".").concat(this._minorImageVersion), "SubsystemVersion:             ".concat(this._majorSubsystemVersion, ".").concat(this._minorSubsystemVersion), "Win32VersionValue:            ".concat(this._win32VersionValue), "SizeOfImage:                  ".concat((0, helpers_ts_1.hex)(this._sizeOfImage)), "SizeOfHeaders:                ".concat((0, helpers_ts_1.hex)(this._sizeOfHeaders)), "CheckSum:                     ".concat((0, helpers_ts_1.hex)(this._checkSum)), "Subsystem:                    ".concat((0, helpers_ts_1.hex)(this._subsystem, 4)), "DllCharacteristics:           ".concat((0, helpers_ts_1.hex)(this._dllCharacteristics, 4)), "SizeOfStackReserve:           ".concat((0, helpers_ts_1.hex)(this._sizeOfStackReserve)), "SizeOfStackCommit:            ".concat((0, helpers_ts_1.hex)(this._sizeOfStackCommit)), "SizeOfHeapReserve:            ".concat((0, helpers_ts_1.hex)(this._sizeOfHeapReserve)), "SizeOfHeapCommit:             ".concat((0, helpers_ts_1.hex)(this._sizeOfHeapCommit)), "LoaderFlags:                  ".concat((0, helpers_ts_1.hex)(this._loaderFlags)), "NumberOfRvaAndSizes:          ".concat(this._numberOfRvaAndSizes), "", "Data Directories:"], this._dataDirectories.map(function (dd, i) { return "  [".concat(i.toString().padStart(2), "] ").concat(dd); }), false));
        return lines.join('\n');
    };
    return OptionalHeader;
}());
exports.OptionalHeader = OptionalHeader;
