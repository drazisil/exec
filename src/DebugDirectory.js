"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DebugDirectory = exports.DebugDirectoryEntry = void 0;
var helpers_ts_1 = require("./helpers.ts");
var DebugTypeNames = {
    0: 'UNKNOWN',
    1: 'COFF',
    2: 'CODEVIEW',
    3: 'FPO',
    4: 'MISC',
    5: 'EXCEPTION',
    6: 'FIXUP',
    7: 'OMAP_TO_SRC',
    8: 'OMAP_FROM_SRC',
    9: 'BORLAND',
    10: 'RESERVED10',
    11: 'CLSID',
    12: 'VC_FEATURE',
    13: 'POGO',
    14: 'ILTCG',
    15: 'MPX',
    16: 'REPRO',
    20: 'EX_DLLCHARACTERISTICS',
};
var DebugDirectoryEntry = /** @class */ (function () {
    function DebugDirectoryEntry(data, fileImage) {
        this._characteristics = data.readUInt32LE(0);
        this._timeDateStamp = data.readUInt32LE(4);
        this._majorVersion = data.readUInt16LE(8);
        this._minorVersion = data.readUInt16LE(10);
        this._type = data.readUInt32LE(12);
        this._sizeOfData = data.readUInt32LE(16);
        this._addressOfRawData = data.readUInt32LE(20);
        this._pointerToRawData = data.readUInt32LE(24);
        this._pdbPath = null;
        this._pdbGuid = null;
        this._pdbAge = null;
        // Parse CodeView data if present
        if (this._type === 2 && this._pointerToRawData > 0 && this._sizeOfData >= 24) {
            var cvOffset = this._pointerToRawData;
            if (cvOffset + this._sizeOfData <= fileImage.length) {
                var sig = fileImage.readUInt32LE(cvOffset);
                // RSDS signature = PDB 7.0
                if (sig === 0x53445352) {
                    var guidBytes = fileImage.subarray(cvOffset + 4, cvOffset + 20);
                    this._pdbGuid = this.formatGuid(guidBytes);
                    this._pdbAge = fileImage.readUInt32LE(cvOffset + 20);
                    var pathStart = cvOffset + 24;
                    var pathEnd = fileImage.indexOf(0, pathStart);
                    this._pdbPath = fileImage.subarray(pathStart, pathEnd !== -1 ? pathEnd : pathStart + 256).toString('utf8');
                }
                // NB10 signature = PDB 2.0
                else if (sig === 0x3031424E) {
                    this._pdbAge = fileImage.readUInt32LE(cvOffset + 8);
                    var pathStart = cvOffset + 16;
                    var pathEnd = fileImage.indexOf(0, pathStart);
                    this._pdbPath = fileImage.subarray(pathStart, pathEnd !== -1 ? pathEnd : pathStart + 256).toString('utf8');
                }
            }
        }
    }
    Object.defineProperty(DebugDirectoryEntry, "sizeOf", {
        get: function () { return 28; },
        enumerable: false,
        configurable: true
    });
    DebugDirectoryEntry.prototype.formatGuid = function (bytes) {
        var d1 = bytes.readUInt32LE(0).toString(16).padStart(8, '0');
        var d2 = bytes.readUInt16LE(4).toString(16).padStart(4, '0');
        var d3 = bytes.readUInt16LE(6).toString(16).padStart(4, '0');
        var d4 = Array.from(bytes.subarray(8, 10)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        var d5 = Array.from(bytes.subarray(10, 16)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        return "{".concat(d1, "-").concat(d2, "-").concat(d3, "-").concat(d4, "-").concat(d5, "}").toUpperCase();
    };
    Object.defineProperty(DebugDirectoryEntry.prototype, "characteristics", {
        get: function () { return this._characteristics; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DebugDirectoryEntry.prototype, "timeDateStamp", {
        get: function () { return this._timeDateStamp; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DebugDirectoryEntry.prototype, "majorVersion", {
        get: function () { return this._majorVersion; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DebugDirectoryEntry.prototype, "minorVersion", {
        get: function () { return this._minorVersion; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DebugDirectoryEntry.prototype, "type", {
        get: function () { return this._type; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DebugDirectoryEntry.prototype, "typeName", {
        get: function () { var _a; return (_a = DebugTypeNames[this._type]) !== null && _a !== void 0 ? _a : "UNKNOWN(".concat(this._type, ")"); },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DebugDirectoryEntry.prototype, "sizeOfData", {
        get: function () { return this._sizeOfData; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DebugDirectoryEntry.prototype, "addressOfRawData", {
        get: function () { return this._addressOfRawData; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DebugDirectoryEntry.prototype, "pointerToRawData", {
        get: function () { return this._pointerToRawData; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DebugDirectoryEntry.prototype, "pdbPath", {
        get: function () { return this._pdbPath; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DebugDirectoryEntry.prototype, "pdbGuid", {
        get: function () { return this._pdbGuid; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DebugDirectoryEntry.prototype, "pdbAge", {
        get: function () { return this._pdbAge; },
        enumerable: false,
        configurable: true
    });
    DebugDirectoryEntry.prototype.toString = function () {
        var str = "".concat(this.typeName, ": RVA=").concat((0, helpers_ts_1.hex)(this._addressOfRawData), " FilePtr=").concat((0, helpers_ts_1.hex)(this._pointerToRawData), " Size=").concat((0, helpers_ts_1.hex)(this._sizeOfData));
        if (this._pdbPath) {
            str += "\n  PDB: ".concat(this._pdbPath);
            if (this._pdbGuid)
                str += "\n  GUID: ".concat(this._pdbGuid);
            if (this._pdbAge !== null)
                str += "  Age: ".concat(this._pdbAge);
        }
        return str;
    };
    return DebugDirectoryEntry;
}());
exports.DebugDirectoryEntry = DebugDirectoryEntry;
var DebugDirectory = /** @class */ (function () {
    function DebugDirectory(data, fileImage) {
        this._entries = [];
        if (data.length === 0)
            return;
        var entrySize = DebugDirectoryEntry.sizeOf;
        var count = Math.floor(data.length / entrySize);
        for (var i = 0; i < count; i++) {
            var offset = i * entrySize;
            this._entries.push(new DebugDirectoryEntry(data.subarray(offset, offset + entrySize), fileImage));
        }
    }
    Object.defineProperty(DebugDirectory.prototype, "entries", {
        get: function () { return this._entries; },
        enumerable: false,
        configurable: true
    });
    DebugDirectory.prototype.toString = function () {
        if (this._entries.length === 0)
            return 'Debug Directory: empty';
        return "Debug Directory (".concat(this._entries.length, " entries):\n") +
            this._entries.map(function (e, i) { return "  [".concat(i, "] ").concat(e); }).join('\n');
    };
    return DebugDirectory;
}());
exports.DebugDirectory = DebugDirectory;
