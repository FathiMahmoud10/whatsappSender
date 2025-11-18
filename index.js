const puppeteer = require("puppeteer");

async function startBrowser() {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--single-process'
        ]
    });

    console.log("Browser started successfully on Render");

    // لو محتاج ترجع browser لكود تاني
    return browser;
}

// شغّل المتصفح
startBrowser().catch(console.error);

// شغّل السيرفر
require("./server.js");
