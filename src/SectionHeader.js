"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SectionHeader = void 0;
var helpers_ts_1 = require("./helpers.ts");
var SectionHeader = /** @class */ (function () {
    function SectionHeader(data) {
        this._data = Buffer.alloc(0);
        this._name = data.subarray(0, 8).toString('utf8').replace(/\0+$/, '');
        this._virtualSize = data.readUInt32LE(8);
        this._virtualAddress = data.readUInt32LE(12);
        this._sizeOfRawData = data.readUInt32LE(16);
        this._pointerToRawData = data.readUInt32LE(20);
        this._pointerToRelocations = data.readUInt32LE(24);
        this._pointerToLinenumbers = data.readUInt32LE(28);
        this._numberOfRelocations = data.readUInt16LE(32);
        this._numberOfLinenumbers = data.readUInt16LE(34);
        this._characteristics = data.readUInt32LE(36);
    }
    Object.defineProperty(SectionHeader, "sizeOf", {
        get: function () {
            return 40;
        },
        enumerable: false,
        configurable: true
    });
    SectionHeader.prototype.resolve = function (fileImage) {
        if (this._pointerToRawData === 0 || this._sizeOfRawData === 0)
            return;
        this._data = fileImage.subarray(this._pointerToRawData, this._pointerToRawData + this._sizeOfRawData);
    };
    Object.defineProperty(SectionHeader.prototype, "name", {
        get: function () { return this._name; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(SectionHeader.prototype, "virtualSize", {
        get: function () { return this._virtualSize; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(SectionHeader.prototype, "virtualAddress", {
        get: function () { return this._virtualAddress; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(SectionHeader.prototype, "sizeOfRawData", {
        get: function () { return this._sizeOfRawData; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(SectionHeader.prototype, "pointerToRawData", {
        get: function () { return this._pointerToRawData; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(SectionHeader.prototype, "pointerToRelocations", {
        get: function () { return this._pointerToRelocations; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(SectionHeader.prototype, "pointerToLinenumbers", {
        get: function () { return this._pointerToLinenumbers; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(SectionHeader.prototype, "numberOfRelocations", {
        get: function () { return this._numberOfRelocations; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(SectionHeader.prototype, "numberOfLinenumbers", {
        get: function () { return this._numberOfLinenumbers; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(SectionHeader.prototype, "characteristics", {
        get: function () { return this._characteristics; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(SectionHeader.prototype, "data", {
        get: function () { return this._data; },
        enumerable: false,
        configurable: true
    });
    SectionHeader.prototype.toString = function () {
        var lines = [
            "Name:                 ".concat(this._name),
            "VirtualSize:          ".concat((0, helpers_ts_1.hex)(this._virtualSize)),
            "VirtualAddress:       ".concat((0, helpers_ts_1.hex)(this._virtualAddress)),
            "SizeOfRawData:        ".concat((0, helpers_ts_1.hex)(this._sizeOfRawData)),
            "PointerToRawData:     ".concat((0, helpers_ts_1.hex)(this._pointerToRawData)),
            "PointerToRelocations: ".concat((0, helpers_ts_1.hex)(this._pointerToRelocations)),
            "PointerToLinenumbers: ".concat((0, helpers_ts_1.hex)(this._pointerToLinenumbers)),
            "NumberOfRelocations:  ".concat(this._numberOfRelocations),
            "NumberOfLinenumbers:  ".concat(this._numberOfLinenumbers),
            "Characteristics:      ".concat((0, helpers_ts_1.hex)(this._characteristics)),
        ];
        if (this._data.length > 0) {
            lines.push('');
            for (var i = 0; i < this._data.length; i += 16) {
                var chunk = this._data.subarray(i, Math.min(i + 16, this._data.length));
                var hexBytes = Array.from(chunk).map(function (b) { return b.toString(16).toUpperCase().padStart(2, '0'); }).join(' ');
                var ascii = Array.from(chunk).map(function (b) { return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'; }).join('');
                lines.push("    ".concat((0, helpers_ts_1.hex)(i, 8), "  ").concat(hexBytes.padEnd(47), "  ").concat(ascii));
            }
        }
        return lines.join('\n');
    };
    return SectionHeader;
}());
exports.SectionHeader = SectionHeader;
