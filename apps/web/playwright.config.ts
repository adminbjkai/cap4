import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./.playwright/test-results",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { outputFolder: ".playwright/report", open: "never" }]],
  use: {
    baseURL: "http://localhost:4173",
    screenshot: "on",
    video: "off",
    trace: process.env.CI ? "retain-on-failure" : "off"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  // Serve the pre-built Vite dist with serve CLI
  webServer: {
    command:
      'node -e "const http=require(\'http\'),fs=require(\'fs\'),path=require(\'path\');const PORT=4173;const DIST=path.join(__dirname,\'dist\');http.createServer((req,res)=>{let p=req.url.split(\'?\')[0];let f=path.join(DIST,p===\'/\'?\'index.html\':p);if(!fs.existsSync(f))f=path.join(DIST,\'index.html\');const ext=path.extname(f);const ct={html:\'text/html\',js:\'application/javascript\',css:\'text/css\',svg:\'image/svg+xml\',ico:\'image/x-icon\'}[ext.slice(1)]||\'application/octet-stream\';res.writeHead(200,{\'Content-Type\':ct});fs.createReadStream(f).pipe(res)}).listen(PORT,()=>console.log(\'Serving on \'+PORT))"',
    port: 4173,
    reuseExistingServer: !process.env.CI
  }
});
