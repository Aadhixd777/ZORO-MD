const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');
require('dotenv').config();

// ============================================
// MODULE UPDATER - RUNS ONLY ON FIRST START
// ============================================
async function downloadAndExtractModules() {
    const settingsPath = path.join(__dirname, 'settings.js');
    const modulesInstalledFlag = path.join(__dirname, '.modules_installed');
    
    // Check if modules are already installed
    if (fs.existsSync(modulesInstalledFlag)) {
        console.log('✅ Modules already installed, skipping download');
        return true;
    }
    
    if (!fs.existsSync(settingsPath)) {
        console.log('⚠️ settings.js not found, skipping module update');
        return false;
    }
    
    const settings = require('./settings');
    const zipUrl = settings.updateZipUrl;
    
    if (!zipUrl) {
        console.log('⚠️ No updateZipUrl configured in settings.js');
        return false;
    }

    const TEMP_DIR = path.join(__dirname, 'temp_update');
    const ZIP_FILE = path.join(TEMP_DIR, 'modules.zip');
    const EXTRACT_DIR = path.join(TEMP_DIR, 'extracted');

    console.log('📥 DOWNLAODING MODULES FROM REPOSITORY...');
    console.log(`📍 URL: ${zipUrl}`);

    try {
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }

        const response = await axios({
            method: 'get',
            url: zipUrl,
            responseType: 'arraybuffer',
            timeout: 120000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        fs.writeFileSync(ZIP_FILE, response.data);
        console.log('✅ DONLOAD COMPLETE!');

        if (fs.existsSync(EXTRACT_DIR)) {
            fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
        }
        fs.mkdirSync(EXTRACT_DIR, { recursive: true });

        console.log('📦 EXTRACTING FILES...');
        execSync(`unzip -o "${ZIP_FILE}" -d "${EXTRACT_DIR}"`, { stdio: 'pipe' });

        const extractedFolders = fs.readdirSync(EXTRACT_DIR);
        const moduleFolder = extractedFolders.find(f => f.includes('NAGIIP-STAR-MD-MODULES'));
        
        if (!moduleFolder) {
            console.log('❌ Could not find modules folder in extracted files');
            return false;
        }

        const sourcePath = path.join(EXTRACT_DIR, moduleFolder);
        const basePath = __dirname;

        const foldersToSync = ['lib', 'plugins', 'data', 'media'];
        const filesToSync = ['main.js', 'config.js'];

        for (const folder of foldersToSync) {
            const sourceFolder = path.join(sourcePath, folder);
            const destFolder = path.join(basePath, folder);
            
            if (fs.existsSync(sourceFolder)) {
                if (!fs.existsSync(destFolder)) {
                    fs.mkdirSync(destFolder, { recursive: true });
                }
                
                fs.cpSync(sourceFolder, destFolder, { recursive: true, force: true });
                console.log(`✅ SYNED FOLDER: ${folder}`);
            }
        }

        for (const file of filesToSync) {
            const sourceFile = path.join(sourcePath, file);
            const destFile = path.join(basePath, file);
            
            if (fs.existsSync(sourceFile)) {
                fs.copyFileSync(sourceFile, destFile);
                console.log(`✅ SYNED FILE: ${file}`);
            }
        }

        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        
        // Create flag file to mark modules as installed
        fs.writeFileSync(modulesInstalledFlag, new Date().toISOString());
        
        console.log('🎉 MODULES UPDATED SUCCESSFULY!');
        return true;

    } catch (error) {
        console.error('❌ Error updating modules:', error.message);
        
        if (fs.existsSync(TEMP_DIR)) {
            fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        }
        return false;
    }
}

// ============================================
// FFMPEG CHECK AND AUTO-INSTALL
// ============================================
async function checkAndInstallFFmpeg() {
    console.log('🎬 CHECKING FFMPEG INSTALLATION...');
    
    const ffmpegDir = path.join(__dirname, 'ffmpeg_bin');
    const ffmpegPath = path.join(ffmpegDir, 'ffmpeg');
    const ffprobePath = path.join(ffmpegDir, 'ffprobe');
    
    // Check if FFmpeg is in system PATH
    try {
        const result = execSync('ffmpeg -version', { stdio: 'pipe', encoding: 'utf8' });
        const version = result.split('\n')[0];
        console.log(`✅ FFMPEG FOUND IN SYSTEM: ${version.substring(0, 50)}...`);
        return true;
    } catch (error) {
        console.log('⚠️ FFmpeg not found in system PATH');
    }
    
    // Check if FFmpeg is in local folder
    if (fs.existsSync(ffmpegPath)) {
        try {
            const result = execSync(`"${ffmpegPath}" -version`, { stdio: 'pipe', encoding: 'utf8' });
            const version = result.split('\n')[0];
            console.log(`✅ FFMPEG FOUND LOCALLY: ${version.substring(0, 50)}...`);
            
            // Add to PATH
            process.env.PATH = `${ffmpegDir}:${process.env.PATH}`;
            console.log('✅ ADDED FFMPEG TO PATH');
            return true;
        } catch (error) {
            console.log('⚠️ Local FFmpeg exists but not working, will re-download');
        }
    }
    
    // Download FFmpeg
    console.log('📥 DOWNLOADING FFMPEG AUTOMATICALLY...');
    
    try {
        if (!fs.existsSync(ffmpegDir)) {
            fs.mkdirSync(ffmpegDir, { recursive: true });
        }
        
        const FFMPEG_URL = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
        const tempFile = path.join(__dirname, 'ffmpeg_temp.tar.xz');
        const extractDir = path.join(__dirname, 'ffmpeg_extract');
        
        console.log('📍 DOWNLOADING FROM johnvansickle.com...');
        
        const response = await axios({
            method: 'get',
            url: FFMPEG_URL,
            responseType: 'arraybuffer',
            timeout: 300000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        fs.writeFileSync(tempFile, response.data);
        console.log('✅ DOWNLOAD COMPLETE!');
        
        // Extract the tar.xz file
        console.log('📦 EXTRACTING FFMPEG...');
        
        if (fs.existsSync(extractDir)) {
            fs.rmSync(extractDir, { recursive: true, force: true });
        }
        fs.mkdirSync(extractDir, { recursive: true });
        
        execSync(`tar -xf "${tempFile}" -C "${extractDir}"`, { stdio: 'pipe' });
        
        // Find the extracted folder
        const extractedFolders = fs.readdirSync(extractDir);
        const ffmpegFolder = extractedFolders.find(f => f.includes('ffmpeg'));
        
        if (ffmpegFolder) {
            const srcFFmpeg = path.join(extractDir, ffmpegFolder, 'ffmpeg');
            const srcFFprobe = path.join(extractDir, ffmpegFolder, 'ffprobe');
            
            if (fs.existsSync(srcFFmpeg)) {
                fs.copyFileSync(srcFFmpeg, ffmpegPath);
                fs.chmodSync(ffmpegPath, '755');
                console.log('✅ FFmpeg INSTALLED');
            }
            
            if (fs.existsSync(srcFFprobe)) {
                fs.copyFileSync(srcFFprobe, ffprobePath);
                fs.chmodSync(ffprobePath, '755');
                console.log('✅ FFprobe INSTALLED');
            }
        }
        
        // Cleanup
        fs.unlinkSync(tempFile);
        fs.rmSync(extractDir, { recursive: true, force: true });
        
        // Add to PATH
        process.env.PATH = `${ffmpegDir}:${process.env.PATH}`;
        console.log('✅ ADDED FFMPEG TO PATH');
        
        // Verify installation
        try {
            const result = execSync(`"${ffmpegPath}" -version`, { stdio: 'pipe', encoding: 'utf8' });
            const version = result.split('\n')[0];
            console.log(`🎉 FFMPEG INSTALLED SUCCESSFULLY: ${version.substring(0, 50)}...`);
            return true;
        } catch (e) {
            console.log('❌ FFMPEG INSTALLATION VERIFICATION FAILED');
            return false;
        }
        
    } catch (error) {
        console.error('❌ Failed to download FFmpeg:', error.message);
        console.log('⚠️ Some features like stickers and audio effects may not work');
        console.log('💡 Please install FFmpeg manually on your hosting panel');
        return false;
    }
}

// ============================================
// MAIN BOT STARTUP
// ============================================
async function startBot() {
    // Keep alive server
    const express = require('express');
    const app = express();
    const port = process.env.PORT || 8000;
    app.get('/', (req, res) => res.send('Bot is Alive!'));
    app.listen(port, () => console.log(`🚀 Keep-alive server running on port ${port}`));

    console.log('\n╔════════════════════════════════════╗');
    console.log('║  🚀 NAGIIP STAR MD BOT STARTING... ║');
    console.log('╚════════════════════════════════════╝\n');
    
    console.log('📥 CHECKING FOR MODULE UPDATES...');
    try {
        await downloadAndExtractModules();
    } catch (err) {
        console.log('⚠️ Module update check failed, continuing with existing files...');
    }
    
    // Check and install FFmpeg if needed
    await checkAndInstallFFmpeg();
    
    console.log('\n🤖 LOADING BOT MODULES...\n');

    // Now require the modules after they've been downloaded
    require('./settings');
    const { Boom } = require('@hapi/boom');
    const chalk = require('chalk');
    const FileType = require('file-type');
    const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
    const PhoneNumber = require('awesome-phonenumber');
    const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif');
    const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await: awaitFunc, sleep, reSize } = require('./lib/myfunc');
    const {
        default: makeWASocket,
        useMultiFileAuthState,
        DisconnectReason,
        fetchLatestBaileysVersion,
        generateForwardMessageContent,
        prepareWAMessageMedia,
        generateWAMessageFromContent,
        generateMessageID,
        downloadContentFromMessage,
        jidDecode,
        proto,
        jidNormalizedUser,
        makeCacheableSignalKeyStore,
        delay
    } = require("@whiskeysockets/baileys");
    const NodeCache = require("node-cache");
    const pino = require("pino");
    const readline = require("readline");
    const { parsePhoneNumber } = require("libphonenumber-js");
    const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics');
    const { rmSync, existsSync } = require('fs');
    const { join } = require('path');

    // Import lightweight store
    const store = require('./lib/lightweight_store');

    // Initialize store
    store.readFromFile();
    const settings = require('./settings');
    setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000);

    // Import message queue for offline handling
    const MessageQueue = require('./lib/messageQueue');
    const messageQueue = new MessageQueue();

    // Memory optimization - Force garbage collection if available
    setInterval(() => {
        if (global.gc) {
            global.gc();
            console.log('🧹 Garbage collection completed');
        }
    }, 60_000); // every 1 minute

    // Memory monitoring - Restart if RAM gets too high
    setInterval(() => {
        const used = process.memoryUsage().rss / 1024 / 1024;
        if (used > 400) {
            console.log('⚠️ RAM too high (>400MB), restarting bot...');
            process.exit(1); // Panel will auto-restart
        }
    }, 30_000); // check every 30 seconds

    let phoneNumber = "911234567890";
    let owner = JSON.parse(fs.readFileSync('./data/owner.json'));

    global.botname = "NAGIIP BOT";
    global.themeemoji = "•";
    const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code");
    const useMobile = process.argv.includes("--mobile");

    // Only create readline interface if we're in an interactive environment
    const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
    const question = (text) => {
        if (rl) {
            return new Promise((resolve) => rl.question(text, resolve));
        } else {
            // In non-interactive environment, use ownerNumber from settings
            return Promise.resolve(settings.ownerNumber || phoneNumber);
        }
    };


    async function startXeonBotInc() {
        let { version, isLatest } = await fetchLatestBaileysVersion();
        
        // Read session from .env file (SESSION_ID) instead of ./session/creds.json
        const sessionDir = './session';
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
        
        // If SESSION_ID is provided in .env, decode and write to session folder
        if (process.env.SESSION_ID) {
            try {
                let sessionId = process.env.SESSION_ID;
                // Remove quotes if present
                sessionId = sessionId.replace(/^["']|["']$/g, '');
                // Handle format "NAGIIPSTAR:~base64data" or just "base64data"
                if (sessionId.includes(':~')) {
                    sessionId = sessionId.split(':~')[1];
                }
                const sessionData = Buffer.from(sessionId, 'base64').toString('utf-8');
                const credsPath = path.join(sessionDir, 'creds.json');
                fs.writeFileSync(credsPath, sessionData);
                console.log('✅ Session loaded from .env SESSION_ID');
            } catch (err) {
                console.log('⚠️ Could not decode SESSION_ID from .env:', err.message);
            }
        }
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const msgRetryCounterCache = new NodeCache();

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: !pairingCode,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: true,
            getMessage: async (key) => {
                let jid = jidNormalizedUser(key.remoteJid);
                let msg = await store.loadMessage(jid, key.id);
                return msg?.message || "";
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: undefined,
        });

        store.bind(XeonBotInc.ev);

        // Apply font transformer to all bot responses
        const { wrapSendMessage } = require('./lib/fontTransformer');
        wrapSendMessage(XeonBotInc);

        // Store original sendMessage before wrapping
        const originalSendMessage = XeonBotInc.sendMessage;
        const baseSendMessage = originalSendMessage;
        let hasConnectedOnce = false;

        // Wrap sendMessage to use queue on failure (but not for connection message)
        XeonBotInc.sendMessage = async function(jid, content, options = {}) {
            try {
                return await originalSendMessage.call(this, jid, content, options);
            } catch (error) {
                console.log(`⚠️ Message send failed, queueing for retry: ${error.message}`);
                messageQueue.addMessage(jid, content, 1);
                throw error;
            }
        };

        // sendMessageDirect - bypasses queue (for connection message)
        XeonBotInc.sendMessageDirect = async function(jid, content, options = {}) {
            return await baseSendMessage.call(this, jid, content, options);
        };

        // Message handling
        XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek.message) return;
                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message;
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, chatUpdate);
                    return;
                }
                if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return;

                // Clear message retry cache to prevent memory bloat
                if (XeonBotInc?.msgRetryCounterCache) {
                    XeonBotInc.msgRetryCounterCache.clear();
                }

                try {
                    await handleMessages(XeonBotInc, chatUpdate, true);
                } catch (err) {
                    console.error("Error in handleMessages:", err);
                    // Only try to send error message if we have a valid chatId
                    if (mek.key && mek.key.remoteJid) {
                        await XeonBotInc.sendMessage(mek.key.remoteJid, {
                            text: '❌ An error occurred while processing your message.',
                            }).catch(console.error);
                    }
                }
            } catch (err) {
                console.error("Error in messages.upsert:", err);
            }
        });

        // Add these event handlers for better functionality
        XeonBotInc.decodeJid = (jid) => {
            if (!jid) return jid;
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {};
                return decode.user && decode.server && decode.user + '@' + decode.server || jid;
            } else return jid;
        };

        XeonBotInc.ev.on('contacts.update', update => {
            for (let contact of update) {
                let id = XeonBotInc.decodeJid(contact.id);
                if (store && store.contacts) store.contacts[id] = { id, name: contact.notify };
            }
        });

        XeonBotInc.getName = (jid, withoutContact = false) => {
            let id = XeonBotInc.decodeJid(jid);
            withoutContact = XeonBotInc.withoutContact || withoutContact;
            let v;
            if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
                v = store.contacts[id] || {};
                if (!(v.name || v.subject)) v = XeonBotInc.groupMetadata(id) || {};
                resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'));
            });
            else v = id === '0@s.whatsapp.net' ? {
                id,
                name: 'WhatsApp'
            } : id === XeonBotInc.decodeJid(XeonBotInc.user.id) ?
                XeonBotInc.user :
                (store.contacts[id] || {});
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international');
        };

        XeonBotInc.public = true;

        XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store);

        // Handle pairing code
        if (pairingCode && !XeonBotInc.authState.creds.registered) {
            if (useMobile) throw new Error('Cannot use pairing code with mobile api');

            let phoneNum;
            if (!!global.phoneNumber) {
                phoneNum = global.phoneNumber;
            } else {
                phoneNum = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number 😍\nFormat: 252638697036 (without + or spaces) : `)));
            }

            // Clean the phone number - remove any non-digit characters
            phoneNum = phoneNum.replace(/[^0-9]/g, '');

            // Validate the phone number using awesome-phonenumber
            const pn = require('awesome-phonenumber');
            if (!pn('+' + phoneNum).isValid()) {
                console.log(chalk.red('Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, etc.) without + or spaces.'));
                process.exit(1);
            }

            setTimeout(async () => {
                try {
                    let code = await XeonBotInc.requestPairingCode(phoneNum);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)));
                    console.log(chalk.yellow(`\nPlease enter this code in your WhatsApp app:\n1. Open WhatsApp\n2. Go to Settings > Linked Devices\n3. Tap "Link a Device"\n4. Enter the code shown above`));
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    console.log(chalk.red('Failed to get pairing code. Please check your phone number and try again.'));
                }
            }, 3000);
        }

        // Connection handling
        XeonBotInc.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect } = s;
            if (connection == "open") {
                console.log(chalk.magenta(` `));
                console.log(chalk.yellow(`🍁CONNECTED TO => ` + JSON.stringify(XeonBotInc.user, null, 2)));

                // Mark as connected and process queued messages
                messageQueue.setConnected(true);
                await messageQueue.processQueue(XeonBotInc);

                const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                
                // Send connection message only on first connect (bypasses queue)
                if (!hasConnectedOnce) {
                    hasConnectedOnce = true;
                    await XeonBotInc.sendMessageDirect(botNumber, {
                        text: `
┏❐═⭔ *CONNECTED SUCCESSFULLY* ⭔═❐
┃⭔ *Bot:* NAGIIP STAR MD 
┃⭔ *Time:* ${new Date().toLocaleString()}
┃⭔ *Status:* Active
┃⭔ *User:* ${botNumber}
┗❐═⭔════════⭔═❐

ᴘʟᴇᴀsᴇ ᴊᴏɪɴ ᴛʜᴇ ɢʀᴏᴜᴘ ʙᴇʟᴏᴡ
https://chat.whatsapp.com/Iwz5WfqtgGhHYlI5sZyfFK?mode=wwt`,
                    }).catch(err => console.log('⚠️ Could not send connection message:', err.message));
                }

                // Process queued messages periodically when connected
                setInterval(() => messageQueue.processQueue(XeonBotInc), 10000);

                await delay(1999);
                
                // Improved console connection message
                console.log(chalk.yellow(`\n\n╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮`));
                console.log(chalk.bold.blue(`│     🔥 NAGIIP STAR MD BOT 🔥     │`));
                console.log(chalk.yellow(`╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n`));
                
                console.log(chalk.cyan(`╔════════════════════════════════════╗`));
                console.log(chalk.green(`║  ✅ CONNECTION SUCCESSFUL! ✅     ║`));
                console.log(chalk.cyan(`╠════════════════════════════════════╣`));
                console.log(chalk.magenta(`║ 👤 Owner: Nagiip Star              ║`));
                console.log(chalk.magenta(`║ 📱 Number: ${owner}               ║`));
                console.log(chalk.magenta(`║ 💎 Version: ${settings.version || '3.0.0'}                    ║`));
                console.log(chalk.magenta(`║ ⏰ Time: ${new Date().toLocaleString()}  ║`));
                console.log(chalk.magenta(`║ 🔥 Status: ON FIRE!                ║`));
                console.log(chalk.cyan(`╚════════════════════════════════════╝\n`));
                
                console.log(chalk.green(`${global.themeemoji || '•'} 🍁 Nagiip Star is on fire 🔥`));
                console.log(chalk.blue(`${global.themeemoji || '•'} All systems operational!`));
            }
            if (connection === 'close') {
                messageQueue.setConnected(false);
                console.log(chalk.yellow('⚠️ Connection lost - messages will be queued for retry'));
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    try {
                        rmSync('./session', { recursive: true, force: true });
                    } catch { }
                    console.log(chalk.red('Session logged out. Please re-authenticate.'));
                    startXeonBotInc();
                } else {
                    console.log(chalk.yellow('Reconnecting...'));
                    startXeonBotInc();
                }
            }
        });

        // Anticall handler using improved version
        const { handleCall } = require('./plugins/anticall-improved');
        XeonBotInc.ev.on('call', async (calls) => {
            try {
                for (const call of calls) {
                    const callData = {
                        from: call.from || call.peerJid || call.chatId,
                        id: call.id,
                        status: call.status || 'offer'
                    };
                    await handleCall(XeonBotInc, callData);
                }
            } catch (e) {
                console.error('Error handling call:', e);
            }
        });

        XeonBotInc.ev.on('creds.update', saveCreds);

        XeonBotInc.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(XeonBotInc, update);
        });

        XeonBotInc.ev.on('messages.upsert', async (m) => {
            if (m.messages[0].key && m.messages[0].key.remoteJid === 'status@broadcast') {
                await handleStatus(XeonBotInc, m);
            }
        });

        XeonBotInc.ev.on('status.update', async (status) => {
            await handleStatus(XeonBotInc, status);
        });

        XeonBotInc.ev.on('messages.reaction', async (status) => {
            await handleStatus(XeonBotInc, status);
        });

        return XeonBotInc;
    }

    // Start WhatsApp connection
    console.log(chalk.green('\n🤖 STARTING WHATSAPP CONNECTION...\n'));
    await startXeonBotInc();
}

// Start the bot
startBot().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});

let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    console.log(`Update ${__filename}`);
    delete require.cache[file];
    require(file);
});
