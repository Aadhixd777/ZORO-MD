require('./settings');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    jidDecode
} = require("@whiskeysockets/baileys");

const pino = require('pino');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const express = require('express');

// 🔥 AUTO-FIX lib/myfunc.js if missing
const myfuncPath = path.join(__dirname, 'lib', 'myfunc.js');
if (!fs.existsSync(myfuncPath)) {
    console.log('⚠️ lib/myfunc.js missing, creating fallback...');
    const libDir = path.join(__dirname, 'lib');
    if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(myfuncPath, `
const axios = require('axios');
const smsg = (conn, m) => {
    if (!m) return m;
    let M = {};
    if (m.key) {
        M.key = m.key;
        M.chat = m.key.remoteJid;
        M.fromMe = m.key.fromMe;
        M.id = m.key.id;
        M.isGroup = M.chat?.endsWith('@g.us');
        M.sender = M.fromMe ? (conn.user?.id || '') : (M.isGroup ? (m.key.participant || '') : M.chat);
    }
    if (m.message) {
        M.mtype = Object.keys(m.message)[0];
        M.msg = m.message[M.mtype];
        M.body = M.msg?.text || M.msg?.caption || m.message?.conversation || M.msg?.contentText || '';
        M.text = M.body;
        try { M.mentionedJid = M.msg?.contextInfo?.mentionedJid || []; } catch { M.mentionedJid = []; }
    }
    M.reply = (text, options = {}) => conn.sendMessage(M.chat, { text, ...options }, { quoted: m });
    return M;
};
const getBuffer = async (url, options = {}) => {
    try { const res = await axios({ method: "get", url, responseType: 'arraybuffer', ...options }); return res.data; } catch { return null; }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = { smsg, getBuffer, sleep };
`);
}
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
    if (!settings.updateZipUrl) {
        console.log('⚠️ No updateZipUrl in settings.js');
        return false;
    }
    const TEMP_DIR = path.join(__dirname, 'temp_update');
    const ZIP_FILE = path.join(TEMP_DIR, 'modules.zip');
    const EXTRACT_DIR = path.join(TEMP_DIR, 'extracted');
    console.log('📥 Checking modules... URL:', settings.updateZipUrl.substring(0,50)+'...');
    try {
        const flag = path.join(__dirname, '.modules_installed');
        const mainExists = fs.existsSync(path.join(__dirname, 'main.js'));
        const libExists = fs.existsSync(path.join(__dirname, 'lib', 'myfunc.js')) && fs.existsSync(path.join(__dirname, 'plugins'));
        
        if (fs.existsSync(flag) && mainExists && libExists) {
            console.log('✅ Modules already installed');
            return true;
        }
        if (fs.existsSync(flag) && (!mainExists || !libExists)) {
            console.log('⚠️ Flag exists but files missing, re-downloading...');
            try { fs.unlinkSync(flag); } catch {}
        }
        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
        console.log('⬇️ Downloading ZIP...');
        const response = await axios({
            method: 'get',
            url: settings.updateZipUrl,
            responseType: 'arraybuffer',
            timeout: 120000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        fs.writeFileSync(ZIP_FILE, response.data);
        console.log('✅ ZIP downloaded', (response.data.length/1024/1024).toFixed(2)+'MB');
        const { execSync } = require('child_process');
        if (fs.existsSync(EXTRACT_DIR)) fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
        fs.mkdirSync(EXTRACT_DIR, { recursive: true });
        try {
            execSync(`unzip -o "${ZIP_FILE}" -d "${EXTRACT_DIR}"`, { stdio: 'pipe' });
        } catch (e) {
            console.log('unzip failed, trying with node...');
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(ZIP_FILE);
            zip.extractAllTo(EXTRACT_DIR, true);
        }
        const extractedFolders = fs.readdirSync(EXTRACT_DIR);
        console.log('Extracted:', extractedFolders);
        let moduleFolder = extractedFolders.find(f => fs.statSync(path.join(EXTRACT_DIR, f)).isDirectory());
        if (!moduleFolder) moduleFolder = '';
        const sourcePath = moduleFolder ? path.join(EXTRACT_DIR, moduleFolder) : EXTRACT_DIR;
        console.log('Source path:', sourcePath);
        ['lib', 'plugins', 'data', 'media'].forEach(folder => {
            const src = path.join(sourcePath, folder);
            const dest = path.join(__dirname, folder);
            if (fs.existsSync(src)) {
                if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
                fs.cpSync(src, dest, { recursive: true, force: true });
                console.log(`✅ Copied ${folder}`);
            }
        });
        
        // 🔥 FIXED: config.js, configuration.js ഉൾപ്പെടെ എല്ലാ പ്രധാന ഫയലുകളും എക്‌സ്‌ട്രാക്ട് ചെയ്യുന്നു
        ['main.js', 'main.json', 'config.js', 'configuration.js', 'settings.js'].forEach(file => {
            const src = path.join(sourcePath, file);
            const dest = path.join(__dirname, file);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, dest);
                console.log(`✅ Copied ${file}`);
            }
        });
        if (fs.existsSync(path.join(__dirname, 'main.js'))) {
            console.log('✅ main.js exists now');
        } else {
            console.log('❌ main.js STILL missing after extract!');
        }
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        fs.writeFileSync(flag, new Date().toISOString());
        console.log('🎉 Modules synced');
        return true;
    } catch (e) {
        console.log('Module update failed:', e.message);
        console.log(e.stack?.substring(0,500));
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

    // 🔥 CRITICAL FIX: Check main.js exists before requiring
    if (!fs.existsSync(path.join(__dirname, 'main.js'))) {
        console.log('\n❌ CRITICAL: main.js missing! Modules ZIP failed to extract!');
        console.log('Check your settings.js updateZipUrl - maybe GitHub URL wrong or private repo');
        console.log('Retrying download in 10 seconds...\n');
        setTimeout(() => startAadhixd(), 10000);
        return;
    }

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
        auth: { creds: state.creds, keys: state.keys },
        getMessage: async (key) => {
            try {
                if (store.loadMessage) {
                    let msg = await store.loadMessage(key.remoteJid, key.id);
                    return msg?.message || "";
                }
                return "";
            } catch { return ""; }
        }
    });

    store.bind(sock.ev);
    
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

    // 🔥 SAFE REQUIRE main.js
    let handleMessages, handleGroupParticipantUpdate, handleStatus;
    try {
        const mainHandlers = require('./main');
        handleMessages = mainHandlers.handleMessages;
        handleGroupParticipantUpdate = mainHandlers.handleGroupParticipantUpdate;
        handleStatus = mainHandlers.handleStatus;
        console.log('✅ main.js loaded');
    } catch (e) {
        console.error('Failed to load main.js:', e.message);
        setTimeout(() => startAadhixd(), 5000);
        return;
    }

    // 📱 FIXED PAIRING CODE LOGIC: കൺസോളിൽ നമ്പറുകൾ ചോദിക്കുന്ന ഭാഗം
    if (!sock.authState.creds.registered) {
        const readline = require("readline");
        const rl = readline.createInterface({ 
            input: process.stdin, 
            output: process.stdout 
        });

        const question = (text) => new Promise((resolve) => rl.question(text, resolve));

        console.log('\n==================================================');
        let phoneNumber = await question('📱 Enter your WhatsApp number with country code (e.g. 919876543210): ');
        console.log('==================================================\n');

        phoneNumber = phoneNumber.replace(/[^0-9]/g, '').trim();

        if (phoneNumber) {
            setTimeout(async () => {
                try {
                    let rawCode = await sock.requestPairingCode(phoneNumber);
                    let formattedCode = rawCode?.match(/.{1,4}/g)?.join("-") || rawCode;
                    console.log(`\n======================================`);
                    console.log(`🔑 YOUR PAIRING CODE: ${formattedCode}`);
                    console.log(`======================================\n`);
                    rl.close();
                } catch (err) {
                    console.error('❌ Pairing failed:', err.message);
                    rl.close();
                }
            }, 3000);
        } else {
            console.log('❌ Invalid phone number entered!');
            rl.close();
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('✅ Connected successfully! - ZORO MD');
            messageQueue.setConnected(true);
            setInterval(() => messageQueue.processQueue(sock), 10000);
            try {
                const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                await sock.sendMessageDirect(botNumber, { text: `✅ *ZORO MD CONNECTED*\nTime: ${new Date().toLocaleString()}` });
            } catch {}
        }
        if (connection === 'close') {
            messageQueue.setConnected(false);
            const shouldReconnect = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
            console.log('Connection closed, reconnecting in 5s...');
            if (shouldReconnect) setTimeout(() => startAadhixd(), 5000);
            else { try { fs.rmSync('./session', { recursive: true, force: true }); } catch {} }
        }
    });

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

            // 🔥 FIXED: Direct Mention Detection Call (main.js-ൽ പോവാതെ നേരിട്ട് Mention നോക്കുന്നു)
            try {
                const mentionPlugin = require('./plugins/mention');
                if (mentionPlugin && typeof mentionPlugin.handleMentionDetection === 'function') {
                    await mentionPlugin.handleMentionDetection(sock, mek.key.remoteJid, mek);
                }
            } catch (e) {
                // Mention പ്ലഗിൻ ഫയൽ ഇല്ലെങ്കിൽ ബോട്ട് ക്രാഷ് ആകാതെ ഇരിക്കാൻ എറർ പിടിക്കുന്നു
            }

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