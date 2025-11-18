const express = require('express');
const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const XLSX = require('xlsx');

const app = express(); 
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/* -------------------------------------
   نظام الجلسات
-------------------------------------- */
const SESSION_LIMIT = 5;
const SESSION_FILE = "sessions.json";

// تحميل الملف أو إنشاءه
let sessions = { used: 0 };

if (fs.existsSync(SESSION_FILE)) {
    sessions = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
} else {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
}

// حفظ البيانات
function saveSessions() {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
}

// زيادة الجلسات
function increaseSession(reason) {
    sessions.used++;
    saveSessions();

    console.log(`🔥 جلسة رقم ${sessions.used} — سبب: ${reason}`);

    broadcast({
        type: "session_update",
        message: `جلسة مستخدمة: ${sessions.used} / ${SESSION_LIMIT}`
    });

    if (sessions.used >= SESSION_LIMIT) {
        endSystem();
    }
}

// إيقاف النظام ومسح الجلسات
function endSystem() {
    console.log("❌ تم الوصول للحد الأقصى من الجلسات");

    broadcast({
        type: "limit_reached",
        message: "❌ تم انتهاء الجلسات — يرجى شراء المزيد"
    });

    try {
        fs.rmSync("./.wwebjs_auth", { recursive: true, force: true });
        fs.rmSync("./.wwebjs_cache", { recursive: true, force: true });
    } catch {}

    try {
        client.destroy();
    } catch {}

    console.log("🚫 النظام تم إيقافه بالكامل");
}

/* -------------------------------------
   منع التشغيل لو الجلسات خلصت
-------------------------------------- */
if (sessions.used >= SESSION_LIMIT) {
    console.log("❌ لا يمكن تشغيل الواتساب — الجلسات انتهت");
}

/* -------------------------------------
   تخزين آخر QR Code
-------------------------------------- */
let lastQR = null;
let lastQRImage = null;

/* -------------------------------------
   قاعدة بيانات الأرقام
-------------------------------------- */
let contactsDB = [];
const CONTACTS_FILE = "contacts.json";

if (fs.existsSync(CONTACTS_FILE)) {
    contactsDB = JSON.parse(fs.readFileSync(CONTACTS_FILE, "utf8"));
}

/* -------------------------------------
   بث للمتصلين
-------------------------------------- */
function broadcast(data) {
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    });
}

/* -------------------------------------
   إنشاء واتساب
-------------------------------------- */
const client = new Client({
    authStrategy: new LocalAuth({ clientId: "main" }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

/* -------------------------------------
   QR — حساب جلسة جديدة
-------------------------------------- */
client.on('qr', async qr => {
    console.log('✅ QR Code جاهز');

    increaseSession("ظهور QR — جلسة اتصال جديدة");

    lastQR = qr;
    lastQRImage = await qrcode.toDataURL(qr);

    broadcast({ type: "qr_raw", qr: lastQR });
    broadcast({ type: "qr", qr: lastQRImage });
});

/* -------------------------------------
   ON READY
-------------------------------------- */
client.on('ready', async () => {
    console.log('✅ واتساب متصل');

    lastQR = null;
    lastQRImage = null;

    broadcast({ type: 'status', message: '📥 جاري تحميل الشاتات والمجموعات…' });

    const chats = await client.getChats();
    let newCount = 0;
    let processedNumbers = new Set(contactsDB.map(c => c.Phone));

    for (let chat of chats) {
        try {
            if (!chat.isGroup) {
                const contact = await client.getContactById(chat.id._serialized);
                const phone = contact.number.startsWith('+') ? contact.number : "+" + contact.number;
                const name = contact.pushname || contact.name || "غير متاح";

                if (!processedNumbers.has(phone)) {
                    contactsDB.push({ Name: name, Phone: phone });
                    processedNumbers.add(phone);
                    newCount++;
                }
            } else {
                broadcast({ type: 'status', message: `📥 جاري تحليل: ${chat.name}` });

                const participants = chat.participants || [];
                for (let participant of participants) {
                    try {
                        const contact = await client.getContactById(participant.id._serialized);
                        const phone = contact.number.startsWith('+') ? contact.number : "+" + contact.number;
                        const name = contact.pushname || contact.name || phone;

                        if (!processedNumbers.has(phone)) {
                            contactsDB.push({ Name: name, Phone: phone });
                            processedNumbers.add(phone);
                            newCount++;
                        }
                    } catch {}
                }
            }
        } catch {}
    }

    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contactsDB, null, 2));

    generateExcel();
    generateVCF();

    broadcast({
        type: "done",
        message: `✔️ تمت إضافة ${newCount} رقم`,
        contacts: contactsDB
    });
});

/* -------------------------------------
   إرسال رسائل — حساب جلسة جديدة
-------------------------------------- */
async function handleSendMessage(phone, message, media, cleanPhone) {
    let chatId = cleanPhone + "@c.us";

    if (media) {
        const mediaObj = new MessageMedia(media.mimetype, media.data, media.name);
        await client.sendMessage(chatId, mediaObj, { caption: message });
        increaseSession("إرسال رسالة + ميديا");
    } else {
        await client.sendMessage(chatId, message);
        increaseSession("إرسال رسالة");
    }
}

/* -------------------------------------
   WebSocket
-------------------------------------- */
wss.on('connection', socket => {
    console.log('🔗 متصل جديد');

    if (lastQR && lastQRImage) {
        socket.send(JSON.stringify({ type: "qr_raw", qr: lastQR }));
        socket.send(JSON.stringify({ type: "qr", qr: lastQRImage }));
    }

    socket.send(JSON.stringify({
        type: "contacts",
        list: contactsDB
    }));

    socket.on('message', async msg => {
        const data = JSON.parse(msg);

        if (data.type === "sendMessage") {
            const phones = data.phones;
            const message = data.message;
            const media = data.media;

            for (let phone of phones) {
                let cleanPhone = phone.replace(/[\+\s\-\(\)]/g, '');

                if (cleanPhone.startsWith("01")) cleanPhone = "20" + cleanPhone.slice(1);

                try {
                    await handleSendMessage(phone, message, media, cleanPhone);

                    broadcast({ type: "progress", phone, status: "✅" });

                    await new Promise(res => setTimeout(res, 3000));

                } catch {
                    broadcast({ type: "error", phone, message: "فشل الإرسال" });
                }
            }

            broadcast({ type: "sent", message: "✔️ تم الإرسال" });
        }
    });
});

/* -------------------------------------
   Static
-------------------------------------- */
app.use(express.static("public"));
app.use('/downloads', express.static("downloads"));

/* -------------------------------------
   تشغيل السيرفر والواتساب
-------------------------------------- */
server.listen(3000, () => {
    console.log("🚀 شغال على http://localhost:3000");

    if (sessions.used < SESSION_LIMIT) {
        client.initialize();
    }
});
