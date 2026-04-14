"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const routes_1 = __importDefault(require("./routes"));
const PORT = process.env.SIM_PORT ? parseInt(process.env.SIM_PORT, 10) : 3002;
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: '2mb' }));
app.use(routes_1.default);
app.listen(PORT, '127.0.0.1', () => {
    console.log(`game-sim listening on http://127.0.0.1:${PORT}`);
});
//# sourceMappingURL=index.js.map