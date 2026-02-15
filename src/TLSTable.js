"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TLSDirectory = void 0;
var helpers_ts_1 = require("./helpers.ts");
var TLSDirectory = /** @class */ (function () {
    function TLSDirectory(data, fileImage, sections, isPE32Plus, imageBase) {
        this._callbacks = [];
        if (isPE32Plus) {
            if (data.length < 40)
                return;
            this._startAddressOfRawData = Number(data.readBigUInt64LE(0));
            this._endAddressOfRawData = Number(data.readBigUInt64LE(8));
            this._addressOfIndex = Number(data.readBigUInt64LE(16));
            this._addressOfCallBacks = Number(data.readBigUInt64LE(24));
            this._sizeOfZeroFill = data.readUInt32LE(32);
            this._characteristics = data.readUInt32LE(36);
        }
        else {
            if (data.length < 24)
                return;
            this._startAddressOfRawData = data.readUInt32LE(0);
            this._endAddressOfRawData = data.readUInt32LE(4);
            this._addressOfIndex = data.readUInt32LE(8);
            this._addressOfCallBacks = data.readUInt32LE(12);
            this._sizeOfZeroFill = data.readUInt32LE(16);
            this._characteristics = data.readUInt32LE(20);
        }
        // Resolve callbacks array (VAs, need to subtract imageBase to get RVAs)
        if (this._addressOfCallBacks !== 0) {
            var callbacksRva = this._addressOfCallBacks - imageBase;
            var callbacksOffset = (0, helpers_ts_1.rvaToOffset)(callbacksRva, sections);
            if (callbacksOffset !== -1) {
                var ptrSize = isPE32Plus ? 8 : 4;
                for (var i = 0;; i++) {
                    var off = callbacksOffset + i * ptrSize;
                    if (off + ptrSize > fileImage.length)
                        break;
                    var cb = isPE32Plus
                        ? Number(fileImage.readBigUInt64LE(off))
                        : fileImage.readUInt32LE(off);
                    if (cb === 0)
                        break;
                    this._callbacks.push(cb);
                }
            }
        }
    }
    Object.defineProperty(TLSDirectory.prototype, "startAddressOfRawData", {
        get: function () { return this._startAddressOfRawData; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TLSDirectory.prototype, "endAddressOfRawData", {
        get: function () { return this._endAddressOfRawData; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TLSDirectory.prototype, "addressOfIndex", {
        get: function () { return this._addressOfIndex; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TLSDirectory.prototype, "addressOfCallBacks", {
        get: function () { return this._addressOfCallBacks; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TLSDirectory.prototype, "sizeOfZeroFill", {
        get: function () { return this._sizeOfZeroFill; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TLSDirectory.prototype, "characteristics", {
        get: function () { return this._characteristics; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TLSDirectory.prototype, "callbacks", {
        get: function () { return this._callbacks; },
        enumerable: false,
        configurable: true
    });
    TLSDirectory.prototype.toString = function () {
        var lines = [
            "StartAddressOfRawData:  ".concat((0, helpers_ts_1.hex)(this._startAddressOfRawData)),
            "EndAddressOfRawData:    ".concat((0, helpers_ts_1.hex)(this._endAddressOfRawData)),
            "AddressOfIndex:         ".concat((0, helpers_ts_1.hex)(this._addressOfIndex)),
            "AddressOfCallBacks:     ".concat((0, helpers_ts_1.hex)(this._addressOfCallBacks)),
            "SizeOfZeroFill:         ".concat(this._sizeOfZeroFill),
            "Characteristics:        ".concat((0, helpers_ts_1.hex)(this._characteristics)),
        ];
        if (this._callbacks.length > 0) {
            lines.push("Callbacks (".concat(this._callbacks.length, "):"));
            this._callbacks.forEach(function (cb, i) { return lines.push("  [".concat(i, "] ").concat((0, helpers_ts_1.hex)(cb))); });
        }
        return lines.join('\n');
    };
    return TLSDirectory;
}());
exports.TLSDirectory = TLSDirectory;
