"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BoundImportTable = exports.BoundImportDescriptor = exports.BoundForwarderRef = void 0;
var helpers_ts_1 = require("./helpers.ts");
var BoundForwarderRef = /** @class */ (function () {
    function BoundForwarderRef(timeDateStamp, moduleName) {
        this._timeDateStamp = timeDateStamp;
        this._moduleName = moduleName;
    }
    Object.defineProperty(BoundForwarderRef.prototype, "timeDateStamp", {
        get: function () { return this._timeDateStamp; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(BoundForwarderRef.prototype, "moduleName", {
        get: function () { return this._moduleName; },
        enumerable: false,
        configurable: true
    });
    BoundForwarderRef.prototype.toString = function () {
        return "-> ".concat(this._moduleName, " (").concat((0, helpers_ts_1.hex)(this._timeDateStamp), ")");
    };
    return BoundForwarderRef;
}());
exports.BoundForwarderRef = BoundForwarderRef;
var BoundImportDescriptor = /** @class */ (function () {
    function BoundImportDescriptor(timeDateStamp, moduleName, forwarderRefs) {
        this._timeDateStamp = timeDateStamp;
        this._moduleName = moduleName;
        this._forwarderRefs = forwarderRefs;
    }
    Object.defineProperty(BoundImportDescriptor.prototype, "timeDateStamp", {
        get: function () { return this._timeDateStamp; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(BoundImportDescriptor.prototype, "moduleName", {
        get: function () { return this._moduleName; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(BoundImportDescriptor.prototype, "forwarderRefs", {
        get: function () { return this._forwarderRefs; },
        enumerable: false,
        configurable: true
    });
    BoundImportDescriptor.prototype.toString = function () {
        var date = new Date(this._timeDateStamp * 1000).toUTCString();
        var str = "".concat(this._moduleName, " (").concat((0, helpers_ts_1.hex)(this._timeDateStamp), " - ").concat(date, ")");
        if (this._forwarderRefs.length > 0) {
            str += '\n' + this._forwarderRefs.map(function (f) { return "    ".concat(f); }).join('\n');
        }
        return str;
    };
    return BoundImportDescriptor;
}());
exports.BoundImportDescriptor = BoundImportDescriptor;
var BoundImportTable = /** @class */ (function () {
    function BoundImportTable(data) {
        this._descriptors = [];
        if (data.length === 0)
            return;
        var offset = 0;
        while (offset + 8 <= data.length) {
            var timeDateStamp = data.readUInt32LE(offset);
            var offsetModuleName = data.readUInt16LE(offset + 4);
            var numberOfForwarderRefs = data.readUInt16LE(offset + 6);
            // All-zero terminates
            if (timeDateStamp === 0 && offsetModuleName === 0)
                break;
            // Read module name (offset from start of bound import data)
            var moduleName = this.readString(data, offsetModuleName);
            // Read forwarder refs
            var forwarderRefs = [];
            for (var i = 0; i < numberOfForwarderRefs; i++) {
                var fwdOffset = offset + 8 + i * 8;
                if (fwdOffset + 8 > data.length)
                    break;
                var fwdTimeDateStamp = data.readUInt32LE(fwdOffset);
                var fwdNameOffset = data.readUInt16LE(fwdOffset + 4);
                var fwdName = this.readString(data, fwdNameOffset);
                forwarderRefs.push(new BoundForwarderRef(fwdTimeDateStamp, fwdName));
            }
            this._descriptors.push(new BoundImportDescriptor(timeDateStamp, moduleName, forwarderRefs));
            offset += 8 + numberOfForwarderRefs * 8;
        }
    }
    BoundImportTable.prototype.readString = function (data, offset) {
        if (offset >= data.length)
            return '<unknown>';
        var end = data.indexOf(0, offset);
        return data.subarray(offset, end !== -1 ? end : Math.min(offset + 256, data.length)).toString('utf8');
    };
    Object.defineProperty(BoundImportTable.prototype, "descriptors", {
        get: function () { return this._descriptors; },
        enumerable: false,
        configurable: true
    });
    BoundImportTable.prototype.toString = function () {
        if (this._descriptors.length === 0)
            return 'Bound Import Table: empty';
        return "Bound Import Table (".concat(this._descriptors.length, " entries):\n") +
            this._descriptors.map(function (d, i) { return "  [".concat(i, "] ").concat(d); }).join('\n');
    };
    return BoundImportTable;
}());
exports.BoundImportTable = BoundImportTable;
