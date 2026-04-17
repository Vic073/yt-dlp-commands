const { spawn } = require("child_process");
const open = require("open");

const port = 3000;

// Start Next.js server
const server = spawn("npm", ["run", "start"], {
  shell: true,
  stdio: "inherit",
});

// Wait a bit, then open browser
setTimeout(() => {
  open(`http://localhost:${port}`);
}, 3000);