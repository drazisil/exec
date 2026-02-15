"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseRelocationTable = exports.RelocationBlock = exports.RelocationEntry = void 0;
var helpers_ts_1 = require("./helpers.ts");
var RelocTypeNames = {
    0: 'ABS',
    1: 'HIGH',
    2: 'LOW',
    3: 'HIGHLOW',
    4: 'HIGHADJ',
    5: 'MIPS_JMPADDR',
    9: 'MIPS_JMPADDR16',
    10: 'DIR64',
};
var RelocationEntry = /** @class */ (function () {
    function RelocationEntry(type, offset) {
        this._type = type;
        this._offset = offset;
    }
    Object.defineProperty(RelocationEntry.prototype, "type", {
        get: function () { return this._type; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(RelocationEntry.prototype, "offset", {
        get: function () { return this._offset; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(RelocationEntry.prototype, "typeName", {
        get: function () { var _a; return (_a = RelocTypeNames[this._type]) !== null && _a !== void 0 ? _a : "UNKNOWN(".concat(this._type, ")"); },
        enumerable: false,
        configurable: true
    });
    RelocationEntry.prototype.toString = function () {
        return "".concat(this.typeName, " +").concat((0, helpers_ts_1.hex)(this._offset, 3));
    };
    return RelocationEntry;
}());
exports.RelocationEntry = RelocationEntry;
var RelocationBlock = /** @class */ (function () {
    function RelocationBlock(pageRva, entries) {
        this._pageRva = pageRva;
        this._entries = entries;
    }
    Object.defineProperty(RelocationBlock.prototype, "pageRva", {
        get: function () { return this._pageRva; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(RelocationBlock.prototype, "entries", {
        get: function () { return this._entries; },
        enumerable: false,
        configurable: true
    });
    RelocationBlock.prototype.toString = function () {
        return "Page ".concat((0, helpers_ts_1.hex)(this._pageRva), " (").concat(this._entries.length, " entries):\n") +
            this._entries.map(function (e) { return "  ".concat(e); }).join('\n');
    };
    return RelocationBlock;
}());
exports.RelocationBlock = RelocationBlock;
var BaseRelocationTable = /** @class */ (function () {
    function BaseRelocationTable(data) {
        this._blocks = [];
        this._totalEntries = 0;
        if (data.length === 0)
            return;
        var offset = 0;
        while (offset + 8 <= data.length) {
            var pageRva = data.readUInt32LE(offset);
            var blockSize = data.readUInt32LE(offset + 4);
            if (blockSize === 0)
                break;
            if (blockSize < 8)
                break;
            var entryCount = (blockSize - 8) / 2;
            var entries = [];
            for (var i = 0; i < entryCount; i++) {
                var entryOffset = offset + 8 + i * 2;
                if (entryOffset + 2 > data.length)
                    break;
                var value = data.readUInt16LE(entryOffset);
                var type = (value >> 12) & 0xF;
                var pageOffset = value & 0xFFF;
                // Type 0 (ABS) entries are padding, skip them
                if (type !== 0) {
                    entries.push(new RelocationEntry(type, pageOffset));
                }
            }
            this._blocks.push(new RelocationBlock(pageRva, entries));
            this._totalEntries += entries.length;
            offset += blockSize;
        }
    }
    Object.defineProperty(BaseRelocationTable.prototype, "blocks", {
        get: function () { return this._blocks; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(BaseRelocationTable.prototype, "totalEntries", {
        get: function () { return this._totalEntries; },
        enumerable: false,
        configurable: true
    });
    BaseRelocationTable.prototype.toString = function () {
        if (this._blocks.length === 0)
            return 'Base Relocation Table: empty';
        return "Base Relocation Table (".concat(this._blocks.length, " pages, ").concat(this._totalEntries, " relocations):\n") +
            this._blocks.map(function (b) { return "  ".concat(b); }).join('\n\n');
    };
    return BaseRelocationTable;
}());
exports.BaseRelocationTable = BaseRelocationTable;
