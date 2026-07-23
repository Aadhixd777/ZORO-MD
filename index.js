require('./settings');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    downloadContentFromMessage, 
    jidDecode
} = require("@whiskeysockets/baileys");

const pino = require('pino');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const FileType = require('file-type');
const readline = require("readline");
const axios = require('axios');
const express = require('express');

const { smsg, getBuffer, sleep } = require('./lib/myfunc');

// Keep-alive server
const app = express();
const port = process.env.PORT || 8000;
if (!global.expressServerRunning) {
    app.get('/', (req, res) => res.send('ZORO MD Alive! - Aadhi Xd'));
    app.listen(port, () => console.log(`🚀 Keep-alive on ${port}`));
    global.expressServerRunning = true;
}

async function downloadAndExtractModules() {
    const settings = require('./settings');
    if (!settings.updateZipUrl) return false;
    const TEMP_DIR = path.join(__dirname, 'temp_update');
    const ZIP_FILE = path.join(TEMP_DIR, 'modules.zip');
    const EXTRACT_DIR = path.join(TEMP_DIR, 'extracted');
    console.log('📥 Checking modules...');
    try {
        const flag = path.join(__dirname, '.modules_installed');
        if (fs.existsSync(flag)) {
            console.log('✅ Modules already installed');
            return true;
        }
        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
        const response = await axios({
            method: 'get',
            url: settings.updateZipUrl,
            responseType: 'arraybuffer',
            timeout: 120000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        fs.writeFileSync(ZIP_FILE, response.data);
        console.log('✅ Modules downloaded');
        const { execSync } = require('child_process');
        if (fs.existsSync(EXTRACT_DIR)) fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
        fs.mkdirSync(EXTRACT_DIR, { recursive: true });
        execSync(`unzip -o "${ZIP_FILE}" -d "${EXTRACT_DIR}"`, { stdio: 'pipe' });
        const extractedFolders = fs.readdirSync(EXTRACT_DIR);
        const moduleFolder = extractedFolders.find(f => f.includes('ZORO-MD-MODULES-main') || f.includes('dghs-main') || f.includes('main'));
        if (moduleFolder) {
            const sourcePath = path.join(EXTRACT_DIR, moduleFolder);
            ['lib', 'plugins', 'data', 'media'].forEach(folder => {
                const src = path.join(sourcePath, folder);
                const dest = path.join(__dirname, folder);
                if (fs.existsSync(src)) {
                    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
                    fs.cpSync(src, dest, { recursive: true, force: true });
                }
            });
        }
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        fs.writeFileSync(flag, new Date().toISOString());
        console.log('🎉 Modules synced');
        return true;
    } catch (e) {
        console.log('Module update skipped:', e.message);
        return false;
    }
}

class MessageQueue {
    constructor() { this.queue = []; this.isProcessing = false; }
    addMessage(jid, content, options = {}) { this.queue.push({ jid, message: content, options }); }
    setConnected(s) { this.connected = s; }
    async processQueue(sock) {
        if (this.isProcessing || this.queue.length === 0 || !this.connected) return;
        this.isProcessing = true;
        while (this.queue.length > 0) {
            const task = this.queue.shift();
            try { await sock.sendMessage(task.jid, task.message, task.options); await sleep(1000); } catch (e) { console.log('Queue retry:', e.message); }
        }
        this.isProcessing = false;
    }
}
const messageQueue = new MessageQueue();

async function startAadhixd() {
    await downloadAndExtractModules();

    const sessionDir = './session';
    const credsFile = path.join(sessionDir, 'creds.json');
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    if (process.env.SESSION_ID) {
        try {
            let sid = process.env.SESSION_ID.replace(/^["']|["']$/g, '');
            if (sid.includes(':~')) sid = sid.split(':~')[1];
            sid = sid.replace(/^AADHI-/, '');
            if (sid.length > 50) {
                fs.writeFileSync(credsFile, Buffer.from(sid, 'base64').toString('utf-8'));
                console.log('✅ Session loaded from ENV');
            }
        } catch (e) { console.log('SESSION_ID decode failed:', e.message); }
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    // Load store - compatible with main.js lightweight_store
    let store;
    try {
        store = require('./lib/lightweight_store');
        store.readFromFile();
        setInterval(() => store.writeToFile(), 10000);
    } catch {
        const { makeInMemoryStore } = require("@whiskeysockets/baileys");
        store = makeInMemoryStore({ logger: pino().child({ level: 'silent' }) });
    }

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        auth: {
            creds: state.creds,
            keys: state.keys,
        },
        getMessage: async (key) => {
            try {
                const jid = key.remoteJid;
                const id = key.id;
                if (store.loadMessage) {
                    let msg = await store.loadMessage(jid, id);
                    return msg?.message || "";
                }
                return "";
            } catch { return ""; }
        }
    });

    store.bind(sock.ev);
    
    // Font transformer if exists
    try {
        const { wrapSendMessage } = require('./lib/fontTransformer');
        wrapSendMessage(sock);
    } catch {}

    const originalSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessageDirect = originalSendMessage;
    sock.sendMessage = async (jid, content, options = {}) => {
        try { return await originalSendMessage(jid, content, options); }
        catch (e) { messageQueue.addMessage(jid, content, options); throw e; }
    };

    // Import handlers from main.js - FIXED COMPATIBILITY
    const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');

    // AUTO NUMBER PROMPT - FIXED
    if (!sock.authState.creds.registered) {
        const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
        const question = (text) => new Promise((resolve) => {
            if (rl) rl.question(text, resolve);
            else {
                const settings = require('./settings');
                resolve(settings.ownerNumber || "918136880986");
            }
        });

        let phoneNumber = await question('\n📱 Enter your WhatsApp number with country code (e.g. 91813880986): ');
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '').trim();

        if (phoneNumber) {
            console.log(`\n🔢 Requesting pairing code for ${phoneNumber}...`);
            setTimeout(async () => {
                try {
                    let rawCode = await sock.requestPairingCode(phoneNumber);
                    let formattedCode = rawCode?.match(/.{1,4}/g)?.join("-") || rawCode;
                    console.log(`\n\n====================`);
                    console.log(` YOUR CODE: ${formattedCode} `);
                    console.log(`====================\n`);
                    console.log(`1. Open WhatsApp > Settings > Linked Devices`);
                    console.log(`2. Link a Device > Link with phone number`);
                    console.log(`3. Enter code: ${formattedCode}\n`);
                    if (rl) rl.close();
                } catch (err) {
                    console.error('Pairing failed:', err.message);
                    if (rl) rl.close();
                }
            }, 3000);
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('✅ Connected successfully! - ZORO MD');
            messageQueue.setConnected(true);
            setInterval(() => messageQueue.processQueue(sock), 10000);
            
            // Send connection message
            try {
                const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                await sock.sendMessageDirect(botNumber, { text: `✅ *ZORO MD CONNECTED*\nTime: ${new Date().toLocaleString()}\nStatus: Active 🔥` });
            } catch {}
        }
        if (connection === 'close') {
            messageQueue.setConnected(false);
            const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
                : true;
            console.log('Connection closed, reconnecting in 5s...');
            if (shouldReconnect) {
                setTimeout(() => startAadhixd(), 5000);
            } else {
                console.log('Logged out, delete session folder!');
                try { fs.rmSync('./session', { recursive: true, force: true }); } catch {}
            }
        }
    });

    // FIXED: Now correctly calls main.js handlers
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const mek = chatUpdate.messages[0];
            if (!mek?.message) return;
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message;
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                if (handleStatus) await handleStatus(sock, chatUpdate);
                return;
            }
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;
            await handleMessages(sock, chatUpdate, true);
        } catch (err) { console.error('messages.upsert error:', err.message); }
    });

    sock.ev.on('group-participants.update', async (update) => {
        try { await handleGroupParticipantUpdate(sock, update); } catch (e) { console.error(e.message); }
    });

    sock.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {};
            return decode.user && decode.server && decode.user + '@' + decode.server || jid;
        }
        return jid;
    };

    return sock;
}

let owner = [];
const ownerPath = path.join(__dirname, 'data', 'owner.json');
if (fs.existsSync(ownerPath)) {
    try { owner = JSON.parse(fs.readFileSync(ownerPath)); } catch {}
}

setInterval(() => {
    if (global.gc) global.gc();
    const mem = process.memoryUsage().rss / 1024 / 1024;
    if (mem > 450) { console.log(`High memory ${mem.toFixed(0)}MB, restarting...`); process.exit(1); }
}, 30000);

startAadhixd();
