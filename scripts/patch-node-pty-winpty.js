const fs = require("node:fs");
const path = require("node:path");

const targetPath = path.join(__dirname, "..", "node_modules", "node-pty", "lib", "windowsPtyAgent.js");

if (!fs.existsSync(targetPath)) {
  process.exit(0);
}

let source = fs.readFileSync(targetPath, "utf8");

const originalBlock = `        // The conout socket must be ready out on another thread to avoid deadlocks
        this._conoutSocketWorker = new windowsConoutConnection_1.ConoutConnection(term.conout, this._useConptyDll);
        this._conoutSocketWorker.onReady(function () {
            _this._conoutSocketWorker.connectSocket(_this._outSocket);
        });
        this._outSocket.on('connect', function () {
            _this._outSocket.emit('ready_datapipe');
        });`;

const replacementBlock = `        if (this._useConpty) {
            // The conout socket must be drained on another thread for ConPTY to avoid deadlocks.
            this._conoutSocketWorker = new windowsConoutConnection_1.ConoutConnection(term.conout, this._useConptyDll);
            this._conoutSocketWorker.onReady(function () {
                _this._conoutSocketWorker.connectSocket(_this._outSocket);
            });
        }
        else {
            this._outSocket.connect(term.conout);
        }
        this._outSocket.on('connect', function () {
            _this._outSocket.emit('ready_datapipe');
        });`;

if (source.includes(originalBlock)) {
  source = source.replace(originalBlock, replacementBlock);
}

source = source.replace("                this._conoutSocketWorker.dispose();", "                if (this._conoutSocketWorker) {\n                    this._conoutSocketWorker.dispose();\n                }");
source = source.replace("                    _this._conoutSocketWorker.dispose();", "                    if (_this._conoutSocketWorker) {\n                        _this._conoutSocketWorker.dispose();\n                    }");

fs.writeFileSync(targetPath, source, "utf8");
