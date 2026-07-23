require('./settings');
const { 
    default: XeonBotIncConnect, 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    generateForwardMessage, 
    prepareWAMessageMedia, 
    generateWAMessageFromContent, 
    generateMessageID, 
    downloadContentFromMessage, 
    makeInMemoryStore, 
    jidDecode, 
    proto, 
    getAggregateVotesInPollMessage 
} = require("@whiskeysockets/baileys");

const pino = require('pino');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const FileType = require('file-type');
const readline = require("readline");
const exec = require('child_process').exec;
const os = require('os');
const axios = require('axios');
const unzipper = require('unzipper');

const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetchJson, await, sleep } = require('./lib/myfunc');

let queueInterval = null;

async function downloadAndExtractModules() {
    const zipUrl = 'https://github.com/PRINCE-GDS/PRINCE-HEX/raw/main/dghs.zip';
    const tempDir = path.join(__dirname, 'temp_modules');
    const zipFilePath = path.join(tempDir, 'modules.zip');

    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const response = await axios({
            url: zipUrl,
            method: 'GET',
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(zipFilePath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        await fs.createReadStream(zipFilePath)
            .pipe(unzipper.Extract({ path: tempDir }))
            .promise();

        const extractedFolder = path.join(tempDir, 'dghs-main'); 
        if (fs.existsSync(extractedFolder)) {
            fs.cpSync(extractedFolder, __dirname, { recursive: true, force: true });
        }

        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log('Modules downloaded and extracted successfully.');
    } catch (error) {
        console.error('Error downloading and extracting modules:', error.message);
    }
}

class MessageQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
    }

    enqueue(task) {
        this.queue.push(task);
    }

    async processQueue(Aadhixd) {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            try {
                await Aadhixd.sendMessage(task.jid, task.message, task.options);
                await sleep(1000); 
            } catch (error) {
                console.error('Failed to send message:', error.message);
            }
        }
        this.isProcessing = false;
    }
}

const messageQueue = new MessageQueue();

async function startAadhixd() {
    await downloadAndExtractModules();

    const sessionDir = './session';
    const credsFile = path.join(sessionDir, 'creds.json');

    if (process.env.SESSION_ID) {
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
        try {
            const base64Creds = process.env.SESSION_ID.replace(/^AADHI-/, '');
            const decodedCreds = Buffer.from(base64Creds, 'base64').toString('utf-8');
            fs.writeFileSync(credsFile, decodedCreds);
        } catch (e) {
            console.error('Failed to decode SESSION_ID:', e.message);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

    const Aadhixd = XeonBotIncConnect({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Aadhixd', 'Safari', '1.0.0'],
        auth: state
    });

    if (!Aadhixd.authState.creds.registered) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const question = (text) => new Promise((resolve) => rl.question(text, resolve));

        const phoneNumber = await question('Enter your WhatsApp number (with country code): ');
        rl.close();

        setTimeout(async () => {
            try {
                let rawCode = await Aadhixd.requestPairingCode(phoneNumber.trim());
                let formattedCode = rawCode?.match(/.{1,4}/g)?.join("-") || rawCode;
                console.log(`Custom Session Name: Aadhixd`);
                console.log(`Your Pairing Code: AADHI-${formattedCode}`);
            } catch (err) {
                console.error('Error requesting pairing code:', err.message);
            }
        }, 3000);
    }

    store.bind(Aadhixd.ev);

    Aadhixd.ev.on('creds.update', saveCreds);

    Aadhixd.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) 
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
                : true;
            if (shouldReconnect) {
                startAadhixd();
            }
        } else if (connection === 'open') {
            console.log('Connected successfully!');
            
            if (queueInterval) clearInterval(queueInterval);
            queueInterval = setInterval(() => messageQueue.processQueue(Aadhixd), 10000);
        }
    });

    Aadhixd.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const mek = chatUpdate.messages[0];
            if (!mek.message) return;
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message;
            if (mek.key && mek.key.remoteJid === 'status@broadcast') return;
            const m = smsg(Aadhixd, mek, store);
            require("./zoro")(Aadhixd, m, chatUpdate, store);
        } catch (err) {
            console.error(err);
        }
    });

    Aadhixd.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {};
            return decode.user && decode.server && decode.user + '@' + decode.server || jid;
        }
        return jid;
    };

    Aadhixd.sendText = (jid, text, quoted = '', options) => {
        return Aadhixd.sendMessage(jid, { text: text, ...options }, { quoted });
    };

    Aadhixd.sendImage = async (jid, path, caption = '', quoted = '', options) => {
        let buffer = Buffer.isBuffer(path) ? path : /^https?:\/\//.test(path) ? await getBuffer(path) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0);
        return await Aadhixd.sendMessage(jid, { image: buffer, caption: caption, ...options }, { quoted });
    };

    Aadhixd.sendVideo = async (jid, path, caption = '', quoted = '', gif = false, options) => {
        let buffer = Buffer.isBuffer(path) ? path : /^https?:\/\//.test(path) ? await getBuffer(path) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0);
        return await Aadhixd.sendMessage(jid, { video: buffer, caption: caption, gifPlayback: gif, ...options }, { quoted });
    };

    Aadhixd.sendAudio = async (jid, path, quoted = '', ptt = false, options) => {
        let buffer = Buffer.isBuffer(path) ? path : /^https?:\/\//.test(path) ? await getBuffer(path) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0);
        return await Aadhixd.sendMessage(jid, { audio: buffer, ptt: ptt, mimetype: 'audio/mp4', ...options }, { quoted });
    };

    Aadhixd.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
        let quoted = message.msg ? message.msg : message;
        let mime = (message.msg || message).mimetype || '';
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
        const stream = await downloadContentFromMessage(quoted, messageType);
        let buffer = Buffer.from([]);
        for await(const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        let type = await FileType.fromBuffer(buffer);
        let trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
        await fs.promises.writeFile(trueFileName, buffer);
        return trueFileName;
    };

    Aadhixd.downloadMediaMessage = async (message) => {
        let quoted = message.msg ? message.msg : message;
        let mime = (message.msg || message).mimetype || '';
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
        const stream = await downloadContentFromMessage(quoted, messageType);
        let buffer = Buffer.from([]);
        for await(const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer;
    };

    return Aadhixd;
}

let owner = [];
const ownerPath = path.join(__dirname, 'data', 'owner.json');
if (fs.existsSync(ownerPath)) {
    try {
        owner = JSON.parse(fs.readFileSync(ownerPath));
    } catch (e) {
        console.error('Could not parse owner.json:', e.message);
    }
}

setInterval(() => {
    if (global.gc) {
        global.gc();
    }
    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
    if (memoryUsage > 400) {
        console.log(`Memory usage high (${memoryUsage.toFixed(2)} MB), restarting process...`);
        process.exit(1);
    }
}, 30000);

startAadhixd();
