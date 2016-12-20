'use strict';

const fs = require('fs');
const Emulator = require('./emulator');
const join = require('path').join;
const crypto = require('crypto');
const msgpack = require('msgpack');
const debug = require('debug')('weplay:worker');
const uuid = require('node-uuid').v4();
const logger = require('weplay-common').logger('weplay-emulator');

const throttle = process.env.WEPLAY_THROTTLE || 200;
process.title = 'weplay-emulator';

// redis
const redis = require('weplay-common').redis();
const sub = require('weplay-common').redis();


var digest = function (state) {
    var md5 = crypto.createHash('md5');
    return md5.update(state).digest('hex');
};


// save saveInterval
const saveIntervalDelay = process.env.WEPLAY_SAVE_INTERVAL || 60000;

// load emulator
let emu;
var romHash;
var romData;
var state;
var loaded = false;
var retryCount = 0;
var saveInterval;

function load() {
    logger.info('loading emulator');
    if (emu)emu.destroy();
    emu = new Emulator();
    var frameCounter = 0;
    emu.on('error', () => {
        logger.error('restarting emulator');
        emu.destroy();
        setTimeout(load, 1000);
    });

    emu.on('frame', frame => {
        frameCounter++;
        redis.publish('weplay:frame:raw', frame);
        redis.publish(`weplay:frame:raw:${romHash}`, frame);
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
        const snap = emu.snapshot();
        if (snap) {
            logger.info('publishing state');
            const pack = msgpack.pack(snap);
            redis.publish(`weplay:state:${romHash}`, pack);
        }
    }, saveIntervalDelay); //saveIntervalDelay

}

sub.psubscribe('weplay:move:*');
sub.on('pmessage', (pattern, channel, move) => {
    var room = channel.toString().split(":")[2];
    if (room != romHash) return;
    redis.get(`weplay:move-last:emu:${uuid}`, (err, last) => {
        if (last) {
            last = last.toString();
            if (Date.now() - last < throttle) {
                return;
            }
        }``
        //logger.debug('move', {key: keys[key], move: key, socket: {nick: socket.nick, id: socket.id}});
        redis.set(`weplay:move-last:emu:${uuid}`, Date.now());

        logger.info('move', {move: move.toString()});
        emu.move(move.toString());
        redis.publish(`weplay:move-last:hash:${romHash}`, move.toString());
    });

});


sub.subscribe(`weplay:emu:${uuid}:rom:data`);
sub.on('message', (channel, rom) => {
    if (`weplay:emu:${uuid}:rom:data` != channel) return;
    loaded = true;
    logger.info(`weplay:emu:${uuid}:rom:data`, {romHash: romHash});
    romData = rom;
    load();
});


sub.subscribe(`weplay:emu:${uuid}:rom:hash`);
sub.on('message', (channel, serverRomHash) => {
    if (`weplay:emu:${uuid}:rom:hash` != channel) return;
    logger.info(`weplay:emu:rom:hash`, {romHash: serverRomHash.toString()});
    romHash = serverRomHash.toString();
});

sub.subscribe(`weplay:emu:${uuid}:rom:state`);
sub.on('message', (channel, serverRomState) => {
    if (`weplay:emu:${uuid}:rom:state` != channel) return;
    loaded = true;
    state = serverRomState;
    load();
});

sub.subscribe('weplay:discover:init');
sub.on('message', (channel, id) => {
    if ('weplay:discover:init' != channel) return;
    logger.info('weplay:discover:init', {uuid: id});
    loaded = false;
    retryCount = 0;
    romHash = undefined;
    romData = undefined;
    state = undefined;
    discover();
});

sub.subscribe(`weplay:emu:${uuid}:subscribe:done`);
sub.on(`weplay:emu:${uuid}:subscribe:done`, (channel, id) => {
    if (`weplay:emu:${uuid}:subscribe:done` != channel) return;
    logger.info(`weplay:emu:subscribe:done`, {uuid: id});
    loaded = true;
    retryCount = 0;
});


function discover() {
    logger.info('weplay:emu:subscribe', {uuid: uuid, retry: retryCount++});
    redis.publish('weplay:emu:subscribe', uuid);
    setTimeout(() => {
        if (!loaded)discover();
    }, 10000); //saveIntervalDelay
}

discover();