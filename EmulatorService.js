const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const msgpack = require('msgpack');
const fps = require('fps');

const EventBus = require('weplay-common').EventBus;
const Emulator = require('./emulator');
const debug = require('debug')('weplay:worker');

const throttle = process.env.WEPLAY_THROTTLE || 200;

const autoload = process.env.AUTOLOAD || false;
process.title = 'weplay-emulator';

const saveIntervalDelay = process.env.WEPLAY_SAVE_INTERVAL || 60000;
const destroyEmuTimeoutDelay = 10000;

class EmulatorService {

    constructor(discoveryUrl, discoveryPort) {
        this.uuid = require('node-uuid').v4();
        this.logger = require('weplay-common').logger('weplay-emulator-service', this.uuid);

        this.emu = null;
        this.romState = null;
        this.romHash = null;
        this.romData = null;

        this.ticker = fps({every: 200});
        this.ticker.on('data', framerate => {
            this.logger.info('EmulatorService[%s] fps %s', this.uuid, Math.floor(framerate));
        });
        this.bus = new EventBus({
            url: discoveryUrl,
            port: discoveryPort,
            name: 'emu',
            id: this.uuid,
            serverListeners: {
                'streamJoinRequested': (socket, request)=> {
                    if (this.romHash === request) {
                        this.logger.info('EmulatorService.streamJoinRequested', {
                            socket: socket.id,
                            request: JSON.stringify(request)
                        });
                        socket.join(this.romHash);
                    } else {
                        this.logger.error('EmulatorService.streamJoinRequested', {
                            socket: socket.id,
                            request: JSON.stringify(request)
                        });
                    }
                }

            },
            clientListeners: [
                //{name: 'rom', event: 'connect', handler: this.onRomConnect.bind(this)},
                //{name: 'rom', event: 'disconnect', handler: this.onRomDisconnect.bind(this)},
                {name: 'rom', event: 'data', handler: this.onRomData.bind(this)},
                {name: 'rom', event: 'hash', handler: this.onRomHash.bind(this)},
                {name: 'rom', event: 'state', handler: this.onRomState.bind(this)}]
        }, ()=> {
            this.logger.info('EmulatorService connected to discovery server', {
                discoveryUrl: discoveryUrl,
                uuid: this.uuid
            });
            this.init();
        });
    }

    init() {
        this.destroy();
        this.logger.info('EmulatorService init()');
        if (autoload) {
            this.bus.emit('rom', 'request');
        }
    }

    shouldStart() {
        if (this.romHash && (this.romState || this.romData)) {
            this.start();
        }
    }

    digest(state) {
        var md5 = crypto.createHash('md5');
        return md5.update(state).digest('hex');
    }

    start() {
        this.logger.debug('loading emulator');
        if (this.emu)this.emu.destroy();
        this.emu = new Emulator();
        let frameCounter = 0;

        this.emu.on('error', () => {
            this.logger.error('restarting emulator');
            this.emu.destroy();
            setTimeout(load, 1000);
        });

        this.emu.on('frame', frame => {
            frameCounter++;
            this.sendFrame(frame, frameCounter);
        });

        try {
            if (this.romState) {
                this.logger.info('init from state', this.digest(this.romState));
                this.emu.initWithState(msgpack.unpack(this.romState));
            } else {
                this.logger.info('init from rom');
                this.emu.initWithRom(this.romData);
            }
            this.emu.run();

            this.logger.info('save delay %d', saveIntervalDelay);

            if (this.saveInterval)clearInterval(this.saveInterval);
            this.saveInterval = setInterval(() => {
                this.saveState();
            }, saveIntervalDelay);
            this.running = true;


            this.bus.emit('compressor', 'streamJoinRequested', this.romHash);
        } catch (e) {
            this.logger.error(e);
        }

    }

    unload(force) {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
            this.saveInterval = undefined;
        }

        if (force) {
            if (this.destroyEmuTimeout) {
                clearTimeout(this.destroyEmuTimeout);
                this.destroyEmuTimeout = undefined;
                this.saveState();
                logger.debug('destroy emulator');
                if (this.emu) {
                    this.emu.destroy();
                    this.emu = undefined;
                }
            }
        } else if (!this.destroyEmuTimeout) {
            this.saveState();
            this.destroyEmuTimeout = setTimeout(() => {
                logger.debug('destroy emulator');
                if (this.emu) {
                    this.emu.destroy();
                    this.emu = undefined;
                }
                clearTimeout(this.destroyEmuTimeout);
                this.destroyEmuTimeout = undefined;
            }, destroyEmuTimeoutDelay);
        }
        this.romHash = null;
        this.romState = null;
        this.romData = null;
    }

    sendFrame(frame) {
        this.ticker.tick();
        //this.logger.debug('sendFrame');
        this.bus.stream(this.romHash, 'frame', frame);
        //this.bus.emit('compressor', 'frame', {hash: this.romHash, frame: frame});
    }

    saveState() {
        if (this.emu) {
            const snap = this.emu.snapshot();
            if (snap) {
                const pack = msgpack.pack(snap);
                this.romState = pack;
                this.bus.emit('rom', 'state', pack);
                this.logger.info(`> state ${this.romHash}`, this.digest(this.romState));
            }
        }
    }

    // ROM Service Listeners

    onRomConnect() {
        this.logger.info('onRomConnect');
        this.romDisconnected = false;
        this.bus.emit('rom', 'request');
    }

    onRomDisconnect() {
        this.romDisconnected = true;
        this.logger.info('onRomDisconnect');
        this.bus.emit('rom', 'request');
    }

    onRomData(data) {
        const newRomHash = this.digest(data);
        this.logger.info('onRomData', {romHash: newRomHash});
        if (!this.romData || !this.romHash === newRomHash) {
            this.romData = data;
            this.shouldStart();
        }
    }

    onRomState(state) {
        this.logger.info('onRomState', {romHash: this.romHash});
        this.romState = state;
        this.shouldStart();
    }

    onRomHash(hashData) {
        this.logger.info('EmulatorService.onRomHash', hashData);
        if (!this.romHash || !this.romHash === hashData.hash) {
            this.romHash = hashData.hash;
            this.shouldStart();
        }
    }

    destroy() {
        if (this.destroyEmuTimeout) {
            clearTimeout(this.destroyEmuTimeout);
            this.destroyEmuTimeout = undefined;
        }
        this.unload(true);
    }
}
module.exports = EmulatorService;