'use strict';

const fs = require('fs');
const Emulator = require('./emulator');
const join = require('path').join;
const crypto = require('crypto');
const msgpack = require('msgpack');
const debug = require('debug')('weplay:worker');
const uuid = require('node-uuid').v4();
const logger = require('weplay-common').logger('weplay-emulator', uuid);

const throttle = process.env.WEPLAY_THROTTLE || 200;
process.title = 'weplay-emulator';

// redis
const redis = require('weplay-common').redis();
const redisSub = require('weplay-common').redis();

const EventBus = require('weplay-common').EventBus;
let bus = new EventBus(redis, redisSub);

const digest = state => {
    const md5 = crypto.createHash('md5');
    return md5.update(state).digest('hex');
};


// save saveInterval
const saveIntervalDelay = process.env.WEPLAY_SAVE_INTERVAL || 60000;

// load emulator
let emu;
let romHash;
let romData;
let state;
let loaded = false;
let retryCount = 0;
let saveInterval;
let running = false;
let connections = 0;
let destroyEmuTimeout;
let destroyEmuTimeoutDelay = 10000;

var saveState = function () {
    if (emu) {
        const snap = emu.snapshot();
        if (snap) {
            logger.info(`> weplay:state:${romHash}`);
            const pack = msgpack.pack(snap);
            state = pack;
            bus.publish(`weplay:state:${romHash}`, pack);
        }
    }
};
function load() {
    logger.debug('loading emulator');

    if (emu)emu.destroy();
    emu = new Emulator();
    let frameCounter = 0;

    emu.on('error', () => {
        logger.error('restarting emulator');
        emu.destroy();
        setTimeout(load, 1000);
    });

    emu.on('frame', frame => {
        frameCounter++;
        //bus.publish('weplay:frame:raw', frame);
        if (romHash)
            bus.publish(`weplay:frame:raw:${romHash}`, frame);
    });

    if (state) {
        logger.info('init from state', {state: digest(state)});
        emu.initWithState(msgpack.unpack(state));
    } else {
        logger.info('init from rom');
        emu.initWithRom(romData);
    }

    emu.run();

    logger.info('save delay %d', saveIntervalDelay);

    if (saveInterval)clearInterval(saveInterval);
    saveInterval = setInterval(() => {
        saveState();
    }, saveIntervalDelay); //saveIntervalDelay
    running = true;
}


bus.subscribe(`weplay:emu:${uuid}:subscribe:done`, (channel, id) => {
    logger.info(`< weplay:emu:${uuid}:subscribe:done`, {uuid: id.toString()});
    loaded = true;
    retryCount = 0;
});

bus.subscribe(`weplay:emu:${uuid}:rom:data`, (channel, rom) => {
    logger.info(`< weplay:emu:${uuid}:rom:data`);
    loaded = true;
    logger.info(`weplay:emu:${uuid}:rom:data`, {romHash});
    romData = rom;
});


bus.subscribe(`weplay:emu:${uuid}:rom:hash`, (channel, _romHash) => {
    _romHash = _romHash.toString();
    logger.info(`< weplay:emu:${uuid}:rom:hash`, {romHash: _romHash});
    if (romHash !== _romHash) {
        if (romHash)destroyListenRoomEvents();
        romHash = _romHash;
        listenRoomEvents();
    }
});

bus.subscribe(`weplay:emu:${uuid}:rom:state`, (channel, serverRomState) => {
    logger.info(`< weplay:emu:${uuid}:rom:state`);
    loaded = true;
    state = serverRomState;
});

bus.subscribe('weplay:discover:init', (channel, id) => {
    logger.info('< weplay:discover:init', {uuid: id.toString()});
    loaded = false;
    retryCount = 0;
    discover();
});


var keepEmulatorRunning = function () {
    if (destroyEmuTimeout)clearTimeout(destroyEmuTimeout);
    if (!emu)load();
};
var destroyEmu = function () {
    if (saveInterval)clearInterval(saveInterval);
    if (!destroyEmuTimeout) {
        saveState();
        destroyEmuTimeout = setTimeout(() => {
            logger.debug('destroy emulator');
            if (emu) {
                emu.destroy();
                emu = undefined;
            }
            clearTimeout(destroyEmuTimeout);
            destroyEmuTimeout = undefined;
        }, destroyEmuTimeoutDelay);
    }
};
var healthCheck = function () {
    if (connections > 0) {
        logger.debug('keepEmulatorRunning?');
        keepEmulatorRunning();
    } else {
        logger.debug('destroy emulator?');
        if (emu) {
            destroyEmu();
        }
    }
};

var checker = (channel, data) => {
    const room = channel.toString().split(":")[2];
    if (room !== romHash) return;

    data = data.toString();
    const action = channel.toString().split(":")[1];
    switch (action) {
        case 'join':
            connections++;
            logger.debug(`< weplay:join:${romHash}`, {clientId: data, connections: connections});
            break;
        case 'leave':
            connections = connections === 0 ? 0 : connections - 1;
            logger.debug(`< weplay:leave:${romHash}`, {clientId: data, connections: connections});
            break;
        case 'connections':
            connections = data;
            break;
    }
    healthCheck();
};


function destroyListenRoomEvents() {
    logger.debug('destroyListenRoomEvents', romHash);
    bus.unsubscribe(`weplay:move:${romHash}`);
    bus.unsubscribe(`weplay:join:${romHash}`);
}

function listenRoomEvents() {
    logger.debug('listenRoomEvents', romHash);
    connections = 0;
    bus.subscribe(`weplay:move:${romHash}`, (channel, move) => {
        const room = channel.toString().split(":")[2];
        if (!romHash || room != romHash || !emu || !move) return;
        redis.get(`weplay:move-last:emu:${uuid}`, (err, last) => {
            if (last) {
                last = last.toString();
                if (Date.now() - last < throttle) {
                    return;
                }
            }
            redis.set(`weplay:move-last:emu:${uuid}`, Date.now());

            logger.debug(`< weplay:move:${romHash}`, {move: move.toString()});
            emu.move(move.toString());
            bus.publish(`weplay:move-last:hash:${romHash}`, move.toString());
        });

    });


    bus.subscribe(`weplay:join:${romHash}`, checker);
    bus.subscribe(`weplay:leave:${romHash}`, checker);
    bus.subscribe(`weplay:connections:${romHash}`, checker);

}


function discover() {
    logger.info('> weplay:emu:subscribe', {uuid, retry: retryCount++});
    bus.publish('weplay:emu:subscribe', uuid);
    setTimeout(() => {
        if (!loaded)discover();
    }, 10000); //saveIntervalDelay
}

require('weplay-common').cleanup(function destroyData() {
    logger.info('Destroying data.');
    bus.publish('weplay:emu:unsubscribe', uuid);
    bus.destroy();
    if (emu)emu.destroy();
});

discover();
