const puppeteer = require("puppeteer");

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-zygote",
            "--single-process"
        ]
    });

    console.log("Puppeteer started on Render");

    require("./server.js");
})();
