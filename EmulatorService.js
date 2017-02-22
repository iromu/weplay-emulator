const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const EventBus = require('weplay-common').EventBus;
const Emulator = require('./emulator');
const msgpack = require('msgpack');
const debug = require('debug')('weplay:worker');

const throttle = process.env.WEPLAY_THROTTLE || 200;
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

        this.bus = new EventBus({
            url: discoveryUrl,
            port: discoveryPort,
            name: 'emu',
            id: this.uuid,
            clientListeners: [
                {name: 'rom', event: 'connect', handler: this.onRomConnect.bind(this)},
                {name: 'rom', event: 'disconnect', handler: this.onRomDisconnect.bind(this)},
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
        this.logger.info('EmulatorService init()');
        this.bus.emit('rom', 'request');
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
            logger.error('restarting emulator');
            this.emu.destroy();
            setTimeout(load, 1000);
        });

        this.bus.emit('compressor', 'hash', this.romHash);
        this.emu.on('frame', frame => {
            frameCounter++;
            this.sendFrame(frame);
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
        this.bus.publish(`${this.romHash}:frame`, {hash: this.romHash, frame: frame});
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

    onRomHash(hash) {
        this.logger.info('EmulatorService.onRomHash', hash);
        if (!this.romHash || !this.romHash === hash) {
            this.romHash = hash;
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