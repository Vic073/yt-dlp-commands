const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const waitOn = require("wait-on");

let mainWindow;
let nextProcess;

const PORT = 3000;
const URL = `http://localhost:${PORT}`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    webPreferences: {
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(URL);
}

app.whenReady().then(async () => {
  console.log("Starting Next.js...");

  // Start Next.js server
  nextProcess = spawn("npx", ["next", "start", "-p", PORT], {
    shell: true,
    stdio: "inherit",
  });

  // Wait until server is ready
  await waitOn({
    resources: [URL],
    timeout: 30000,
  });

  console.log("Next.js ready, launching window...");
  createWindow();
});

app.on("window-all-closed", () => {
  if (nextProcess) nextProcess.kill();
  if (process.platform !== "darwin") app.quit();
});