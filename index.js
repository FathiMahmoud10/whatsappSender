const puppeteer = require("puppeteer");

async function startBrowser() {
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--single-process'
        ]
    });

    console.log("Browser started on Render");
    return browser;
}

startBrowser().catch(console.error);

require("./server.js");
