"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExceptionTable = exports.RuntimeFunction = void 0;
var helpers_ts_1 = require("./helpers.ts");
var RuntimeFunction = /** @class */ (function () {
    function RuntimeFunction(data) {
        this._beginAddress = data.readUInt32LE(0);
        this._endAddress = data.readUInt32LE(4);
        this._unwindInfoAddress = data.readUInt32LE(8);
    }
    Object.defineProperty(RuntimeFunction, "sizeOf", {
        get: function () { return 12; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(RuntimeFunction.prototype, "beginAddress", {
        get: function () { return this._beginAddress; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(RuntimeFunction.prototype, "endAddress", {
        get: function () { return this._endAddress; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(RuntimeFunction.prototype, "unwindInfoAddress", {
        get: function () { return this._unwindInfoAddress; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(RuntimeFunction.prototype, "codeSize", {
        get: function () { return this._endAddress - this._beginAddress; },
        enumerable: false,
        configurable: true
    });
    RuntimeFunction.prototype.toString = function () {
        return "".concat((0, helpers_ts_1.hex)(this._beginAddress), "-").concat((0, helpers_ts_1.hex)(this._endAddress), " (").concat(this.codeSize, " bytes) Unwind: ").concat((0, helpers_ts_1.hex)(this._unwindInfoAddress));
    };
    return RuntimeFunction;
}());
exports.RuntimeFunction = RuntimeFunction;
var ExceptionTable = /** @class */ (function () {
    function ExceptionTable(data) {
        this._entries = [];
        if (data.length === 0)
            return;
        var entrySize = RuntimeFunction.sizeOf;
        var count = Math.floor(data.length / entrySize);
        for (var i = 0; i < count; i++) {
            var offset = i * entrySize;
            this._entries.push(new RuntimeFunction(data.subarray(offset, offset + entrySize)));
        }
    }
    Object.defineProperty(ExceptionTable.prototype, "entries", {
        get: function () { return this._entries; },
        enumerable: false,
        configurable: true
    });
    ExceptionTable.prototype.toString = function () {
        if (this._entries.length === 0)
            return 'Exception Table: empty';
        return "Exception Table (".concat(this._entries.length, " entries):\n") +
            this._entries.map(function (e, i) { return "  [".concat(i, "] ").concat(e); }).join('\n');
    };
    return ExceptionTable;
}());
exports.ExceptionTable = ExceptionTable;
