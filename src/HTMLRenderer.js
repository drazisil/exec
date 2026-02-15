"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HTMLRenderer = void 0;
var helpers_ts_1 = require("./helpers.ts");
var MAX_HEX_BYTES = 4096;
var HTMLRenderer = /** @class */ (function () {
    function HTMLRenderer(exe) {
        this._exe = exe;
    }
    HTMLRenderer.prototype.render = function () {
        return [
            this.docHead(),
            '<body>',
            "<h1>PE File Analysis</h1>",
            "<p class=\"subtitle\">".concat(this.esc(this._exe.filePath), "</p>"),
            this.renderFileOverview(),
            this.renderCOFFHeader(),
            this.renderOptionalHeader(),
            this.renderDataDirectories(),
            this.renderSectionHeaders(),
            "<footer>Generated ".concat(new Date().toUTCString(), "</footer>"),
            '</body>',
            '</html>',
        ].join('\n');
    };
    HTMLRenderer.prototype.docHead = function () {
        return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>PE Analysis: ".concat(this.esc(this._exe.filePath), "</title>\n<style>\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:system-ui,-apple-system,sans-serif;line-height:1.6;max-width:1200px;margin:0 auto;padding:2rem;background:#1e1e2e;color:#cdd6f4}\nh1{margin-bottom:.25rem;color:#89b4fa}\n.subtitle{color:#a6adc8;margin-bottom:1.5rem;font-family:monospace}\ndetails{margin:.75rem 0;border:1px solid #45475a;border-radius:4px;background:#313244}\ndetails>summary{padding:.5rem 1rem;cursor:pointer;font-weight:600;background:#45475a;border-radius:4px 4px 0 0;user-select:none}\ndetails[open]>summary{border-radius:4px 4px 0 0}\ndetails>*:not(summary){padding:.75rem 1rem}\ndetails details{margin:.5rem 0;background:#1e1e2e}\ntable.fields{border-collapse:collapse;width:100%;font-family:monospace;font-size:.9rem}\ntable.fields td{padding:.15rem .75rem;vertical-align:top}\ntable.fields td:first-child{white-space:nowrap;color:#89b4fa;width:1%}\ntable.fields td:last-child{color:#f9e2af}\n.hexdump pre{font-family:'Courier New',Courier,monospace;font-size:.85rem;overflow-x:auto;line-height:1.4;white-space:pre}\n.offset{color:#6c7086}\n.hex{color:#cdd6f4}\n.ascii{color:#a6e3a1}\n.overview{margin:1rem 0;padding:1rem;background:#313244;border-radius:4px;border:1px solid #45475a}\n.empty{color:#6c7086;font-style:italic}\n.truncated{color:#fab387;font-style:italic;margin-top:.5rem}\ntable.imports{border-collapse:collapse;width:100%;font-family:monospace;font-size:.85rem}\ntable.imports th{text-align:left;padding:.25rem .75rem;border-bottom:1px solid #45475a;color:#89b4fa}\ntable.imports td{padding:.15rem .75rem}\ntable.imports td:first-child{color:#6c7086;width:1%}\ntable.imports td:nth-child(2){color:#a6e3a1}\ntable.imports td:nth-child(3){color:#fab387}\ntable.imports td:nth-child(4){color:#f9e2af}\ntable.imports td:nth-child(5){color:#cdd6f4}\ntable.imports td:nth-child(6){color:#6c7086}\n.dll-count{color:#a6adc8;font-weight:normal;font-size:.85rem}\nfooter{margin-top:2rem;padding-top:1rem;border-top:1px solid #45475a;color:#6c7086;font-size:.85rem}\n</style>\n</head>");
    };
    HTMLRenderer.prototype.renderFileOverview = function () {
        return "<div class=\"overview\">\n".concat(this.fieldTable([
            ['File Path', this.esc(this._exe.filePath)],
            ['File Size', "".concat(this._exe.sizeOnDisk, " bytes")],
            ['File Signature', this.esc(this._exe.fileSignature)],
            ['PE Start Offset', (0, helpers_ts_1.hex)(this._exe.peStartOffset)],
            ['Machine Type', this.esc(this._exe.machineType)],
        ]), "\n</div>");
    };
    HTMLRenderer.prototype.renderCOFFHeader = function () {
        var coff = this._exe.coffFileHeader;
        var date = new Date(coff.timeDateStamp * 1000).toUTCString();
        return "<details open>\n<summary>COFF File Header</summary>\n<div>\n".concat(this.fieldTable([
            ['Machine', this.esc(coff.machine)],
            ['NumberOfSections', String(coff.numberOfSections)],
            ['TimeDateStamp', "".concat((0, helpers_ts_1.hex)(coff.timeDateStamp), " (").concat(this.esc(date), ")")],
            ['PointerToSymbolTable', (0, helpers_ts_1.hex)(coff.pointerToSymbolTable)],
            ['NumberOfSymbols', String(coff.numberOfSymbols)],
            ['SizeOfOptionalHeader', (0, helpers_ts_1.hex)(coff.sizeOfOptionalHeader, 4)],
            ['Characteristics', (0, helpers_ts_1.hex)(coff.characteristics, 4)],
        ]), "\n</div>\n</details>");
    };
    HTMLRenderer.prototype.renderOptionalHeader = function () {
        var oh = this._exe.optionalHeader;
        var format = oh.isPE32Plus ? 'PE32+' : 'PE32';
        var rows = [
            ['Magic', "".concat((0, helpers_ts_1.hex)(oh.magic, 4), " (").concat(format, ")")],
            ['LinkerVersion', "".concat(oh.majorLinkerVersion, ".").concat(oh.minorLinkerVersion)],
            ['SizeOfCode', (0, helpers_ts_1.hex)(oh.sizeOfCode)],
            ['SizeOfInitializedData', (0, helpers_ts_1.hex)(oh.sizeOfInitializedData)],
            ['SizeOfUninitializedData', (0, helpers_ts_1.hex)(oh.sizeOfUninitializedData)],
            ['AddressOfEntryPoint', (0, helpers_ts_1.hex)(oh.addressOfEntryPoint)],
            ['BaseOfCode', (0, helpers_ts_1.hex)(oh.baseOfCode)],
        ];
        if (!oh.isPE32Plus) {
            rows.push(['BaseOfData', (0, helpers_ts_1.hex)(oh.baseOfData)]);
        }
        rows.push(['ImageBase', (0, helpers_ts_1.hex)(oh.imageBase)], ['SectionAlignment', (0, helpers_ts_1.hex)(oh.sectionAlignment)], ['FileAlignment', (0, helpers_ts_1.hex)(oh.fileAlignment)], ['OperatingSystemVersion', "".concat(oh.majorOperatingSystemVersion, ".").concat(oh.minorOperatingSystemVersion)], ['ImageVersion', "".concat(oh.majorImageVersion, ".").concat(oh.minorImageVersion)], ['SubsystemVersion', "".concat(oh.majorSubsystemVersion, ".").concat(oh.minorSubsystemVersion)], ['Win32VersionValue', String(oh.win32VersionValue)], ['SizeOfImage', (0, helpers_ts_1.hex)(oh.sizeOfImage)], ['SizeOfHeaders', (0, helpers_ts_1.hex)(oh.sizeOfHeaders)], ['CheckSum', (0, helpers_ts_1.hex)(oh.checkSum)], ['Subsystem', (0, helpers_ts_1.hex)(oh.subsystem, 4)], ['DllCharacteristics', (0, helpers_ts_1.hex)(oh.dllCharacteristics, 4)], ['SizeOfStackReserve', (0, helpers_ts_1.hex)(oh.sizeOfStackReserve)], ['SizeOfStackCommit', (0, helpers_ts_1.hex)(oh.sizeOfStackCommit)], ['SizeOfHeapReserve', (0, helpers_ts_1.hex)(oh.sizeOfHeapReserve)], ['SizeOfHeapCommit', (0, helpers_ts_1.hex)(oh.sizeOfHeapCommit)], ['LoaderFlags', (0, helpers_ts_1.hex)(oh.loaderFlags)], ['NumberOfRvaAndSizes', String(oh.numberOfRvaAndSizes)]);
        return "<details open>\n<summary>Optional Header</summary>\n<div>\n".concat(this.fieldTable(rows), "\n</div>\n</details>");
    };
    HTMLRenderer.prototype.renderDataDirectories = function () {
        var _this = this;
        var dirs = this._exe.optionalHeader.dataDirectories;
        var structuredRenderers = {
            0: function () { return _this._exe.exportTable ? _this.renderExportTable() : null; },
            1: function () { var _a; return ((_a = _this._exe.importTable) === null || _a === void 0 ? void 0 : _a.descriptors.length) ? _this.renderImportTable() : null; },
            3: function () { var _a; return ((_a = _this._exe.exceptionTable) === null || _a === void 0 ? void 0 : _a.entries.length) ? _this.renderExceptionTable() : null; },
            5: function () { var _a; return ((_a = _this._exe.baseRelocationTable) === null || _a === void 0 ? void 0 : _a.blocks.length) ? _this.renderRelocationTable() : null; },
            6: function () { var _a; return ((_a = _this._exe.debugDirectory) === null || _a === void 0 ? void 0 : _a.entries.length) ? _this.renderDebugDirectory() : null; },
            9: function () { return _this._exe.tlsDirectory ? _this.renderTLSDirectory() : null; },
            10: function () { return _this._exe.loadConfigDirectory ? _this.renderLoadConfig() : null; },
            11: function () { var _a; return ((_a = _this._exe.boundImportTable) === null || _a === void 0 ? void 0 : _a.descriptors.length) ? _this.renderBoundImportTable() : null; },
            13: function () { var _a; return ((_a = _this._exe.delayImportTable) === null || _a === void 0 ? void 0 : _a.descriptors.length) ? _this.renderDelayImportTable() : null; },
        };
        var inner = dirs.map(function (dd, i) {
            var _a;
            var header = "[".concat(String(i).padStart(2), "] ").concat(_this.esc(dd.name), " - ").concat((0, helpers_ts_1.hex)(dd.virtualAddress), " (").concat((0, helpers_ts_1.hex)(dd.size), " bytes)");
            if (dd.data.length === 0) {
                return "<details>\n<summary><span class=\"empty\">".concat(header, " - empty</span></summary>\n</details>");
            }
            var structured = (_a = structuredRenderers[i]) === null || _a === void 0 ? void 0 : _a.call(structuredRenderers);
            if (structured) {
                return "<details>\n<summary>".concat(header, "</summary>\n<div>\n").concat(structured, "\n</div>\n</details>");
            }
            return "<details>\n<summary>".concat(header, "</summary>\n<div class=\"hexdump\">\n").concat(_this.renderHexDump(dd.data), "\n</div>\n</details>");
        }).join('\n');
        return "<details open>\n<summary>Data Directories (".concat(dirs.length, ")</summary>\n<div>\n").concat(inner, "\n</div>\n</details>");
    };
    HTMLRenderer.prototype.renderExportTable = function () {
        var _this = this;
        var exp = this._exe.exportTable;
        var header = this.fieldTable([
            ['DLL Name', this.esc(exp.dllName)],
            ['Ordinal Base', String(exp.ordinalBase)],
            ['Exports', String(exp.entries.length)],
        ]);
        var rows = exp.entries.map(function (e) {
            var name = e.name ? _this.esc(e.name) : '<span class="empty">ordinal only</span>';
            var target = e.forwarder ? "-> ".concat(_this.esc(e.forwarder)) : (0, helpers_ts_1.hex)(e.rva);
            return "<tr><td>".concat(e.ordinal, "</td><td>").concat(name, "</td><td>").concat(target, "</td></tr>");
        }).join('\n');
        return "".concat(header, "\n<table class=\"imports\">\n<tr><th>Ordinal</th><th>Name</th><th>RVA / Forwarder</th></tr>\n").concat(rows, "\n</table>");
    };
    HTMLRenderer.prototype.renderImportTable = function () {
        var _this = this;
        var importTable = this._exe.importTable;
        return importTable.descriptors.map(function (desc) {
            var rows = desc.entries.map(function (entry, i) {
                var idx = String(i).padStart(3);
                var rva = (0, helpers_ts_1.hex)(entry.iatRva);
                var fileOff = entry.iatFileOffset !== -1 ? (0, helpers_ts_1.hex)(entry.iatFileOffset) : '—';
                var value = (0, helpers_ts_1.hex)(entry.iatValue);
                if (entry.ordinal !== null) {
                    return "<tr><td>".concat(idx, "</td><td>").concat(rva, "</td><td>").concat(fileOff, "</td><td>").concat(value, "</td><td>Ordinal #").concat(entry.ordinal, "</td><td></td></tr>");
                }
                return "<tr><td>".concat(idx, "</td><td>").concat(rva, "</td><td>").concat(fileOff, "</td><td>").concat(value, "</td><td>").concat(_this.esc(entry.name), "</td><td>").concat(entry.hint, "</td></tr>");
            }).join('\n');
            return "<details>\n<summary>".concat(_this.esc(desc.dllName), " <span class=\"dll-count\">(").concat(desc.entries.length, " functions)</span></summary>\n<div>\n<table class=\"imports\">\n<tr><th>#</th><th>IAT RVA</th><th>File Offset</th><th>Slot Value</th><th>Function</th><th>Hint</th></tr>\n").concat(rows, "\n</table>\n</div>\n</details>");
        }).join('\n');
    };
    HTMLRenderer.prototype.renderExceptionTable = function () {
        var exc = this._exe.exceptionTable;
        var rows = exc.entries.map(function (e, i) {
            return "<tr><td>".concat(i, "</td><td>").concat((0, helpers_ts_1.hex)(e.beginAddress), "</td><td>").concat((0, helpers_ts_1.hex)(e.endAddress), "</td><td>").concat(e.codeSize, "</td><td>").concat((0, helpers_ts_1.hex)(e.unwindInfoAddress), "</td></tr>");
        }).join('\n');
        return "<table class=\"imports\">\n<tr><th>#</th><th>Begin</th><th>End</th><th>Size</th><th>Unwind Info</th></tr>\n".concat(rows, "\n</table>");
    };
    HTMLRenderer.prototype.renderRelocationTable = function () {
        var reloc = this._exe.baseRelocationTable;
        var summary = this.fieldTable([
            ['Pages', String(reloc.blocks.length)],
            ['Total Relocations', String(reloc.totalEntries)],
        ]);
        var blocks = reloc.blocks.map(function (block) {
            var rows = block.entries.map(function (e, i) {
                return "<tr><td>".concat(i, "</td><td>").concat(e.typeName, "</td><td>").concat((0, helpers_ts_1.hex)(block.pageRva + e.offset), "</td><td>+").concat((0, helpers_ts_1.hex)(e.offset, 3), "</td></tr>");
            }).join('\n');
            return "<details>\n<summary>".concat((0, helpers_ts_1.hex)(block.pageRva), " <span class=\"dll-count\">(").concat(block.entries.length, " relocations)</span></summary>\n<div>\n<table class=\"imports\">\n<tr><th>#</th><th>Type</th><th>Address</th><th>Offset</th></tr>\n").concat(rows, "\n</table>\n</div>\n</details>");
        }).join('\n');
        return "".concat(summary, "\n").concat(blocks);
    };
    HTMLRenderer.prototype.renderDebugDirectory = function () {
        var _this = this;
        var dbg = this._exe.debugDirectory;
        return dbg.entries.map(function (e, i) {
            var date = new Date(e.timeDateStamp * 1000).toUTCString();
            var rows = [
                ['Type', "".concat(_this.esc(e.typeName), " (").concat(e.type, ")")],
                ['TimeDateStamp', "".concat((0, helpers_ts_1.hex)(e.timeDateStamp), " (").concat(_this.esc(date), ")")],
                ['Version', "".concat(e.majorVersion, ".").concat(e.minorVersion)],
                ['SizeOfData', (0, helpers_ts_1.hex)(e.sizeOfData)],
                ['AddressOfRawData', (0, helpers_ts_1.hex)(e.addressOfRawData)],
                ['PointerToRawData', (0, helpers_ts_1.hex)(e.pointerToRawData)],
            ];
            if (e.pdbPath) {
                rows.push(['PDB Path', _this.esc(e.pdbPath)]);
                if (e.pdbGuid)
                    rows.push(['PDB GUID', _this.esc(e.pdbGuid)]);
                if (e.pdbAge !== null)
                    rows.push(['PDB Age', String(e.pdbAge)]);
            }
            return "<details>\n<summary>Entry ".concat(i, ": ").concat(_this.esc(e.typeName), "</summary>\n<div>\n").concat(_this.fieldTable(rows), "\n</div>\n</details>");
        }).join('\n');
    };
    HTMLRenderer.prototype.renderTLSDirectory = function () {
        var tls = this._exe.tlsDirectory;
        var rows = [
            ['StartAddressOfRawData', (0, helpers_ts_1.hex)(tls.startAddressOfRawData)],
            ['EndAddressOfRawData', (0, helpers_ts_1.hex)(tls.endAddressOfRawData)],
            ['AddressOfIndex', (0, helpers_ts_1.hex)(tls.addressOfIndex)],
            ['AddressOfCallBacks', (0, helpers_ts_1.hex)(tls.addressOfCallBacks)],
            ['SizeOfZeroFill', String(tls.sizeOfZeroFill)],
            ['Characteristics', (0, helpers_ts_1.hex)(tls.characteristics)],
        ];
        if (tls.callbacks.length > 0) {
            rows.push(['Callbacks', String(tls.callbacks.length)]);
            tls.callbacks.forEach(function (cb, i) { return rows.push(["  [".concat(i, "]"), (0, helpers_ts_1.hex)(cb)]); });
        }
        return this.fieldTable(rows);
    };
    HTMLRenderer.prototype.renderLoadConfig = function () {
        var lc = this._exe.loadConfigDirectory;
        var rows = [
            ['Size', (0, helpers_ts_1.hex)(lc.size)],
            ['TimeDateStamp', (0, helpers_ts_1.hex)(lc.timeDateStamp)],
            ['Version', "".concat(lc.majorVersion, ".").concat(lc.minorVersion)],
            ['GlobalFlagsClear', (0, helpers_ts_1.hex)(lc.globalFlagsClear)],
            ['GlobalFlagsSet', (0, helpers_ts_1.hex)(lc.globalFlagsSet)],
            ['CriticalSectionTimeout', String(lc.criticalSectionDefaultTimeout)],
            ['SecurityCookie', (0, helpers_ts_1.hex)(lc.securityCookie)],
        ];
        if (lc.seHandlerTable !== 0) {
            rows.push(['SEHandlerTable', (0, helpers_ts_1.hex)(lc.seHandlerTable)]);
            rows.push(['SEHandlerCount', String(lc.seHandlerCount)]);
        }
        if (lc.guardCFCheckFunctionPointer !== 0) {
            rows.push(['GuardCFCheckFunction', (0, helpers_ts_1.hex)(lc.guardCFCheckFunctionPointer)]);
            rows.push(['GuardCFFunctionTable', (0, helpers_ts_1.hex)(lc.guardCFFunctionTable)]);
            rows.push(['GuardCFFunctionCount', String(lc.guardCFFunctionCount)]);
            rows.push(['GuardFlags', (0, helpers_ts_1.hex)(lc.guardFlags)]);
        }
        return this.fieldTable(rows);
    };
    HTMLRenderer.prototype.renderBoundImportTable = function () {
        var _this = this;
        var bound = this._exe.boundImportTable;
        return bound.descriptors.map(function (desc) {
            var date = new Date(desc.timeDateStamp * 1000).toUTCString();
            var html = "<details>\n<summary>".concat(_this.esc(desc.moduleName), " <span class=\"dll-count\">(").concat(_this.esc(date), ")</span></summary>\n<div>\n").concat(_this.fieldTable([['TimeDateStamp', "".concat((0, helpers_ts_1.hex)(desc.timeDateStamp), " (").concat(_this.esc(date), ")")]]));
            if (desc.forwarderRefs.length > 0) {
                var fwdRows = desc.forwarderRefs.map(function (f) {
                    var fDate = new Date(f.timeDateStamp * 1000).toUTCString();
                    return "<tr><td>".concat(_this.esc(f.moduleName), "</td><td>").concat((0, helpers_ts_1.hex)(f.timeDateStamp), " (").concat(_this.esc(fDate), ")</td></tr>");
                }).join('\n');
                html += "\n<table class=\"imports\">\n<tr><th>Forwarder</th><th>TimeDateStamp</th></tr>\n".concat(fwdRows, "\n</table>");
            }
            html += '\n</div>\n</details>';
            return html;
        }).join('\n');
    };
    HTMLRenderer.prototype.renderDelayImportTable = function () {
        var _this = this;
        var delay = this._exe.delayImportTable;
        return delay.descriptors.map(function (desc) {
            var rows = desc.entries.map(function (entry, i) {
                var idx = String(i).padStart(3);
                var rva = (0, helpers_ts_1.hex)(entry.iatRva);
                var fileOff = entry.iatFileOffset !== -1 ? (0, helpers_ts_1.hex)(entry.iatFileOffset) : '—';
                var value = (0, helpers_ts_1.hex)(entry.iatValue);
                if (entry.ordinal !== null) {
                    return "<tr><td>".concat(idx, "</td><td>").concat(rva, "</td><td>").concat(fileOff, "</td><td>").concat(value, "</td><td>Ordinal #").concat(entry.ordinal, "</td><td></td></tr>");
                }
                return "<tr><td>".concat(idx, "</td><td>").concat(rva, "</td><td>").concat(fileOff, "</td><td>").concat(value, "</td><td>").concat(_this.esc(entry.name), "</td><td>").concat(entry.hint, "</td></tr>");
            }).join('\n');
            return "<details>\n<summary>".concat(_this.esc(desc.dllName), " <span class=\"dll-count\">(").concat(desc.entries.length, " functions)</span></summary>\n<div>\n<table class=\"imports\">\n<tr><th>#</th><th>IAT RVA</th><th>File Offset</th><th>Slot Value</th><th>Function</th><th>Hint</th></tr>\n").concat(rows, "\n</table>\n</div>\n</details>");
        }).join('\n');
    };
    HTMLRenderer.prototype.renderSectionHeaders = function () {
        var _this = this;
        var sections = this._exe.sectionHeaders;
        var inner = sections.map(function (s, i) {
            var fields = _this.fieldTable([
                ['VirtualSize', (0, helpers_ts_1.hex)(s.virtualSize)],
                ['VirtualAddress', (0, helpers_ts_1.hex)(s.virtualAddress)],
                ['SizeOfRawData', (0, helpers_ts_1.hex)(s.sizeOfRawData)],
                ['PointerToRawData', (0, helpers_ts_1.hex)(s.pointerToRawData)],
                ['PointerToRelocations', (0, helpers_ts_1.hex)(s.pointerToRelocations)],
                ['PointerToLinenumbers', (0, helpers_ts_1.hex)(s.pointerToLinenumbers)],
                ['NumberOfRelocations', String(s.numberOfRelocations)],
                ['NumberOfLinenumbers', String(s.numberOfLinenumbers)],
                ['Characteristics', (0, helpers_ts_1.hex)(s.characteristics)],
            ]);
            var dump = s.data.length > 0
                ? "<details>\n<summary>Raw Data (".concat(s.data.length, " bytes)</summary>\n<div class=\"hexdump\">\n").concat(_this.renderHexDump(s.data), "\n</div>\n</details>")
                : '';
            return "<details>\n<summary>Section ".concat(i + 1, ": ").concat(_this.esc(s.name), "</summary>\n<div>\n").concat(fields, "\n").concat(dump, "\n</div>\n</details>");
        }).join('\n');
        return "<details open>\n<summary>Section Headers (".concat(sections.length, ")</summary>\n<div>\n").concat(inner, "\n</div>\n</details>");
    };
    HTMLRenderer.prototype.renderHexDump = function (data) {
        var truncated = data.length > MAX_HEX_BYTES;
        var limit = truncated ? MAX_HEX_BYTES : data.length;
        var rows = [];
        for (var i = 0; i < limit; i += 16) {
            var chunk = data.subarray(i, Math.min(i + 16, limit));
            var hexBytes = Array.from(chunk).map(function (b) { return b.toString(16).toUpperCase().padStart(2, '0'); }).join(' ');
            var ascii = Array.from(chunk).map(function (b) { return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'; }).join('');
            rows.push("<span class=\"offset\">".concat((0, helpers_ts_1.hex)(i, 8), "</span>  <span class=\"hex\">").concat(hexBytes.padEnd(47), "</span>  <span class=\"ascii\">").concat(this.esc(ascii), "</span>"));
        }
        var result = "<pre>".concat(rows.join('\n'), "</pre>");
        if (truncated) {
            result += "\n<p class=\"truncated\">Showing first ".concat(MAX_HEX_BYTES, " of ").concat(data.length, " bytes</p>");
        }
        return result;
    };
    HTMLRenderer.prototype.fieldTable = function (rows) {
        var trs = rows.map(function (_a) {
            var name = _a[0], value = _a[1];
            return "<tr><td>".concat(name, "</td><td>").concat(value, "</td></tr>");
        }).join('\n');
        return "<table class=\"fields\">\n".concat(trs, "\n</table>");
    };
    HTMLRenderer.prototype.esc = function (text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    };
    return HTMLRenderer;
}());
exports.HTMLRenderer = HTMLRenderer;
