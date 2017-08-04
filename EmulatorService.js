// const path = require('path')
// const fs = require('fs')

const os = require('os')
const crypto = require('crypto')
const msgpack = require('msgpack')
const fps = require('fps')

const EventBus = require('weplay-common').EventBus
const Emulator = require('./emulator')
// const debug = require('debug')('weplay:worker')

// const throttle = process.env.WEPLAY_THROTTLE || 200

// process.title = 'weplay-emulator'

const saveIntervalDelay = process.env.WEPLAY_SAVE_INTERVAL || 60000
const DESTROY_DELAY = 10000

class EmulatorService {
  constructor(discoveryUrl, discoveryPort, statusPort) {
    this.uuid = require('node-uuid').v4()
    this.logger = require('weplay-common').logger('weplay-emulator-service', this.uuid)

    this.emu = null
    this.romState = null
    this.romHash = null
    this.romData = null

    this.ticker = fps({every: 200})
    this.ticker.on('data', framerate => {
      this.logger.info('EmulatorService[%s] fps %s load %s mem %s free %s', this.romHash, Math.floor(framerate), os.loadavg().join('/'), os.totalmem(), os.freemem())
    })
    this.bus = new EventBus({
      url: discoveryUrl,
      port: discoveryPort,
      statusPort: statusPort,
      name: 'emu',
      id: this.uuid,
      serverListeners: {
        'move': (socket, request) => {
          // console.log('move Request', request)
          if (this.emu) {
            this.emu.move(request)
          }
        },
        'streamJoinRequested': this.streamJoinRequested.bind(this),
        'streamCreateRequested': this.streamCreateRequested.bind(this),
        'streamLeaveRequested': this.streamLeaveRequested.bind(this)
      },
      clientListeners: [
        // {name: 'rom', event: 'connect', handler: this.onRomConnect.bind(this)},
        // {name: 'rom', event: 'disconnect', handler: this.onRomDisconnect.bind(this)},
        {name: 'gateway', event: 'move', handler: this.onMove.bind(this)},
        {name: 'rom', event: 'data', handler: this.onRomData.bind(this)},
        {name: 'rom', event: 'hash', handler: this.onRomHash.bind(this)},
        {name: 'rom', event: 'state', handler: this.onRomState.bind(this)}]
    }, () => {
      this.logger.info('EmulatorService connected to discovery server', {
        discoveryUrl: discoveryUrl,
        uuid: this.uuid
      })
      this.onConnect()
    })
  }

  onConnect() {
    // this.destroy()
    this.logger.info('EmulatorService init()')
    // if (autoload) {
    //   this.bus.emit('rom', 'request')
    // }
  }

  shouldStart() {
    if (this.romHash && (this.romState || this.romData)) {
      this.start()
    }
  }

  digest(state) {
    var md5 = crypto.createHash('md5')
    return md5.update(state).digest('hex')
  }

  start() {
    this.logger.debug('loading emulator')
    if (this.emu) this.emu.destroy()
    this.emu = new Emulator()
    let frameCounter = 0

    this.emu.on('error', () => {
      this.logger.error('restarting emulator')
      this.emu.destroy()
      setTimeout(this.start, 1000)
    })

    this.emu.on('frame', frame => {
      frameCounter++
      this.sendFrame(frame, frameCounter)
    })
    this.listenRoomEvents()
    try {
      if (this.romState) {
        this.logger.info('init from state', this.digest(this.romState))
        this.emu.initWithState(msgpack.unpack(this.romState))
      } else {
        this.logger.info('init from rom')
        this.emu.initWithRom(this.romData)
      }
      this.emu.run()

      this.logger.info('save delay %d', saveIntervalDelay)

      if (this.saveInterval) clearInterval(this.saveInterval)
      this.saveInterval = setInterval(() => {
        this.saveState()
      }, saveIntervalDelay)
      this.running = true
      // this.bus.emit('compressor', 'streamJoinRequested', this.romHash)
    } catch (e) {
      this.logger.error(e)
      this.bus.emit('rom', 'free', this.romHash)
      this.bus.destroyStream(this.romHash, 'frame' + this.romHash)
    }
  }

  listenRoomEvents() {
    this.logger.info('listenRoomEvents', this.romHash)
  }

  unload(force, request) {
    if (this.saveInterval) {
      clearInterval(this.saveInterval)
      this.saveInterval = undefined
    }

    if (force) {
      if (this.destroyEmuTimeout) {
        clearTimeout(this.destroyEmuTimeout)
        this.destroyEmuTimeout = undefined
      }
      this.destroyEmulator(request)
    } else if (!this.destroyEmuTimeout) {
      this.destroyEmuTimeout = setTimeout(() => {
        this.destroyEmulator(request)
        clearTimeout(this.destroyEmuTimeout)
        this.destroyEmuTimeout = undefined
      }, DESTROY_DELAY)
    }
  }

  destroyEmulator(request) {
    this.logger.debug('destroy emulator')
    this.saveState()
    if (this.emu) {
      this.emu.destroy()
      this.emu = undefined
    }
    if (this.romHash) {
      this.bus.emit('rom', 'free', this.romHash)
      this.bus.destroyStream(this.romHash, 'frame' + this.romHash)
    }
    // if (request) {
    //   this.bus.emit('rom', 'free', request)
    //   this.bus.destroyStream(request, 'frame' + request)
    // }
    this.romHash = null
    this.romState = null
    this.romData = null
  }

  sendFrame(frame) {
    this.ticker.tick()
    // this.logger.debug('sendFrame');
    this.bus.stream(this.romHash, 'frame' + this.romHash, frame)
    // this.bus.emit('compressor', 'frame', {hash: this.romHash, frame: frame});
  }

  saveState() {
    if (this.emu) {
      const snap = this.emu.snapshot()
      if (snap) {
        const pack = msgpack.pack(snap)
        this.romState = pack
        this.bus.emit('rom', 'state', pack)
        this.logger.info(`> state ${this.romHash}`, this.digest(this.romState))
      }
    }
  }

  // ROM Service Listeners

  onRomConnect() {
    this.logger.info('onRomConnect')
    this.romDisconnected = false
    this.bus.emit('rom', 'request')
  }

  onRomDisconnect() {
    this.romDisconnected = true
    this.logger.info('onRomDisconnect')
    this.bus.emit('rom', 'request')
  }

  onRomData(data) {
    const newRomHash = this.digest(data)
    this.logger.info('onRomData', {romHash: newRomHash})
    if (!this.romData || !this.romHash === newRomHash) {
      this.romData = data
      this.shouldStart()
    }
  }

  onMove(data) {
    this.logger.info('onMove', {data: data})
  }

  onRomState(state) {
    this.logger.info('onRomState', {romHash: this.romHash})
    this.romState = state
    this.shouldStart()
  }

  onRomHash(hashData) {
    this.logger.info('EmulatorService.onRomHash', hashData)
    if (!this.romHash || !this.romHash === hashData.hash) {
      this.romHash = hashData.hash
      this.shouldStart()
    }
  }

  streamCreateRequested(socket, request) {
    this.logger.info('EmulatorService.streamCreateRequested', {
      socket: socket.id,
      request: JSON.stringify(request)
    })
  }

  streamLeaveRequested(socket, request) {
    this.logger.info('EmulatorService.streamLeaveRequested', {
      socket: socket.id,
      request: JSON.stringify(request)
    })
    if (request === this.romHash) {
      this.unload(true, request)
    }
    this.logger.info('EmulatorService.streamLeaveRequested DONE', {
      socket: socket.id,
      request: JSON.stringify(request)
    })
  }

  streamJoinRequested(socket, request) {
    if (request) {
      this.logger.info('EmulatorService.streamJoinRequested', {
        socket: socket.id,
        request: JSON.stringify(request)
      })
      if (!this.romHash) {
        this.romHash = request
        this.bus.emit('rom', 'query', request)
      } else {
        this.logger.error('EmulatorService.streamJoinRequested. Ignoring request for a new stream.', {
          socket: socket.id,
          request: JSON.stringify(request)
        })
        socket.emit('streamRejected', request)
      }
      socket.join(this.romHash)
    }
  }

  destroy() {
    if (this.destroyEmuTimeout) {
      clearTimeout(this.destroyEmuTimeout)
      this.destroyEmuTimeout = undefined
    }
    this.unload(true)
  }
}

module.exports = EmulatorService
