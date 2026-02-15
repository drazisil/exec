"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataDirectoryNames = exports.DataDirectory = void 0;
var helpers_ts_1 = require("./helpers.ts");
var DataDirectory = /** @class */ (function () {
    function DataDirectory(data, index) {
        var _a;
        this._data = Buffer.alloc(0);
        this._virtualAddress = data.readUInt32LE(0);
        this._size = data.readUInt32LE(4);
        this._index = index;
        this._name = (_a = exports.DataDirectoryNames[index]) !== null && _a !== void 0 ? _a : "Unknown (".concat(index, ")");
    }
    Object.defineProperty(DataDirectory, "sizeOf", {
        get: function () {
            return 8;
        },
        enumerable: false,
        configurable: true
    });
    DataDirectory.prototype.resolve = function (fileImage, sections) {
        if (this._virtualAddress === 0 || this._size === 0)
            return;
        var fileOffset;
        if (this._index === 4) {
            // Certificate Table uses a file pointer, not an RVA
            fileOffset = this._virtualAddress;
        }
        else {
            fileOffset = (0, helpers_ts_1.rvaToOffset)(this._virtualAddress, sections);
            if (fileOffset === -1)
                return;
        }
        this._data = fileImage.subarray(fileOffset, fileOffset + this._size);
    };
    Object.defineProperty(DataDirectory.prototype, "virtualAddress", {
        get: function () {
            return this._virtualAddress;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DataDirectory.prototype, "size", {
        get: function () {
            return this._size;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DataDirectory.prototype, "name", {
        get: function () {
            return this._name;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(DataDirectory.prototype, "data", {
        get: function () {
            return this._data;
        },
        enumerable: false,
        configurable: true
    });
    DataDirectory.prototype.toString = function () {
        var str = "".concat(this._name, ": ").concat((0, helpers_ts_1.hex)(this._virtualAddress), " (").concat((0, helpers_ts_1.hex)(this._size), " bytes)");
        if (this._data.length > 0) {
            var rows = [];
            for (var i = 0; i < this._data.length; i += 16) {
                var chunk = this._data.subarray(i, Math.min(i + 16, this._data.length));
                var hexBytes = Array.from(chunk).map(function (b) { return b.toString(16).toUpperCase().padStart(2, '0'); }).join(' ');
                var ascii = Array.from(chunk).map(function (b) { return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'; }).join('');
                rows.push("    ".concat((0, helpers_ts_1.hex)(i, 8), "  ").concat(hexBytes.padEnd(47), "  ").concat(ascii));
            }
            str += '\n' + rows.join('\n');
        }
        return str;
    };
    return DataDirectory;
}());
exports.DataDirectory = DataDirectory;
exports.DataDirectoryNames = [
    'Export Table',
    'Import Table',
    'Resource Table',
    'Exception Table',
    'Certificate Table',
    'Base Relocation Table',
    'Debug',
    'Architecture',
    'Global Ptr',
    'TLS Table',
    'Load Config Table',
    'Bound Import',
    'IAT',
    'Delay Import Descriptor',
    'CLR Runtime Header',
    'Reserved',
];
