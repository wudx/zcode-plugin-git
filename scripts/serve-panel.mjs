// Tiny static server for the panel test harness:
//   /panel.html -> plugins/git/dist/ui/panel.html
//   /mock       -> scripts/mock-host.html
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const panel = path.join(root, "plugins", "git", "dist", "ui", "panel.html");
const mock = path.join(root, "scripts", "mock-host.html");

createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];
  try {
    if (url === "/panel.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(await readFile(panel));
    } else if (url === "/mock" || url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(await readFile(mock));
    } else {
      res.writeHead(404).end("not found");
    }
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(8137, "127.0.0.1", () => console.log("harness: http://127.0.0.1:8137/mock"));
