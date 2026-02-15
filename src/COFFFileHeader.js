"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MachineType = exports.COFFFileHeader = void 0;
var helpers_ts_1 = require("./helpers.ts");
var COFFFileHeader = /** @class */ (function () {
    function COFFFileHeader(data) {
        var _a;
        this._machine = (_a = exports.MachineType.get(data.readUInt16LE(0))) !== null && _a !== void 0 ? _a : "";
        this._numberOfSections = data.readUInt16LE(2);
        this._timeDateStamp = data.readUInt32LE(4);
        this._pointerToSymbolTable = data.readUInt32LE(8);
        this._numberOfSymbols = data.readUInt32LE(12);
        this._sizeOfOptionalHeader = data.readUInt16LE(16);
        this._characteristics = data.readUInt16LE(18);
    }
    Object.defineProperty(COFFFileHeader, "sizeOf", {
        get: function () {
            return 20;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(COFFFileHeader.prototype, "machine", {
        get: function () {
            return this._machine;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(COFFFileHeader.prototype, "numberOfSections", {
        get: function () {
            return this._numberOfSections;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(COFFFileHeader.prototype, "timeDateStamp", {
        get: function () {
            return this._timeDateStamp;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(COFFFileHeader.prototype, "pointerToSymbolTable", {
        get: function () {
            return this._pointerToSymbolTable;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(COFFFileHeader.prototype, "numberOfSymbols", {
        get: function () {
            return this._numberOfSymbols;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(COFFFileHeader.prototype, "sizeOfOptionalHeader", {
        get: function () {
            return this._sizeOfOptionalHeader;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(COFFFileHeader.prototype, "characteristics", {
        get: function () {
            return this._characteristics;
        },
        enumerable: false,
        configurable: true
    });
    COFFFileHeader.prototype.toString = function () {
        var date = new Date(this._timeDateStamp * 1000).toUTCString();
        return [
            "Machine:              ".concat(this._machine),
            "NumberOfSections:     ".concat(this._numberOfSections),
            "TimeDateStamp:        ".concat((0, helpers_ts_1.hex)(this._timeDateStamp), " (").concat(date, ")"),
            "PointerToSymbolTable: ".concat((0, helpers_ts_1.hex)(this._pointerToSymbolTable)),
            "NumberOfSymbols:      ".concat(this._numberOfSymbols),
            "SizeOfOptionalHeader: ".concat((0, helpers_ts_1.hex)(this._sizeOfOptionalHeader, 4)),
            "Characteristics:      ".concat((0, helpers_ts_1.hex)(this._characteristics, 4)),
        ].join('\n');
    };
    return COFFFileHeader;
}());
exports.COFFFileHeader = COFFFileHeader;
exports.MachineType = new Map();
exports.MachineType.set(0x14c, "IMAGE_FILE_MACHINE_I386");
