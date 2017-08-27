import os from 'os'
import crypto from 'crypto'
import msgpack from 'msgpack'
import fps from 'fps'
import memwatch from 'memwatch-next'
import {EventBus, LoggerFactory} from 'weplay-common'
import RomListeners from './RomListeners'
import EmulatorFactory from './EmulatorFactory'

const SAVE_INTERVAL_DELAY = process.env.WEPLAY_SAVE_INTERVAL || 60000
const DESTROY_DELAY = 10000
const CHECK_INTERVAL = 2000

class EmulatorService {
  constructor(discoveryUrl, discoveryPort, statusPort) {
    this.uuid = require('uuid/v1')()
    this.logger = LoggerFactory.get('weplay-emulator-service', this.uuid)
    memwatch.on('stats', (stats) => {
      this.logger.info('CompressorService stats', stats)
    })
    memwatch.on('leak', (info) => {
      this.logger.error('CompressorService leak', info)
    })
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = undefined
    }

    this.checkInterval = setInterval(() => {
      this.gc()
    }, CHECK_INTERVAL)
    this.romListeners = new RomListeners()
    this.emu = null
    this.system = null
    this.romState = null
    this.romHash = null
    this.romData = null

    this.roomsTimestamp = {}
    this.ticker = fps({every: 200})
    this.ticker.on('data', framerate => {
      this.logger.info('EmulatorService[%s] fps %s load %s mem %s free %s', this.romHash, Math.floor(framerate), os.loadavg().join('/'), os.totalmem(), os.freemem())
    })
    this.bus = new EventBus({
      url: discoveryUrl,
      port: discoveryPort,
      statusPort,
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
        {name: 'rom', event: 'connect', handler: this.romListeners.onRomConnect.bind(this)},
        {name: 'rom', event: 'disconnect', handler: this.romListeners.onRomDisconnect.bind(this)},
        {name: 'rom', event: 'data', handler: this.romListeners.onRomData.bind(this)},
        {name: 'rom', event: 'hash', handler: this.romListeners.onRomHash.bind(this)},
        {name: 'rom', event: 'state', handler: this.romListeners.onRomState.bind(this)}]
    }, () => {
      this.logger.info('EmulatorService connected to discovery server', {
        discoveryUrl,
        uuid: this.uuid
      })
      this.onConnect()
    })
  }

  gc() {
    for (const room in this.roomsTimestamp) {
      if (this.isOlderThan(this.roomsTimestamp[room], CHECK_INTERVAL)) {
        if (room === this.romHash) {
          try {
            this.unload(true, room)
          } catch (e) {
            this.logger.error(e)
          }
        }
      }
    }
    // if (!this.roomsTimestamp[this.romHash] && this.romHash) {
    //   this.bus.emit('rom', 'query', this.romHash)
    // }
    this.roomsTimestamp = {}
  }

  isOlderThan(ts, limit) {
    return Date.now() - ts > limit
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
    const md5 = crypto.createHash('md5')
    return md5.update(state).digest('hex')
  }

  start() {
    this.logger.info('loading emulator', this.system)

    try {
      if (this.emu) this.emu.destroy()
      this.emu = EmulatorFactory.getEmu(this.system)
      let frameCounter = 0

      this.emu.on('error', (e) => {
        this.logger.error(e)
        this.unload()
      })

      this.emu.on('frame', frame => {
        frameCounter++
        this.sendFrame(frame, frameCounter)
      })
      this.emu.on('audio', audio => {
        this.sendAudio(audio)
      })
      if (this.romState) {
        this.logger.info('init from state', this.digest(this.romState))
        this.emu.initWithState(msgpack.unpack(this.romState))
      } else if (this.romData) {
        this.logger.info('init from rom')
        this.emu.initWithRom(this.romData)
      } else {
        this.logger.error('internal state error')
        this.unload()
        return
      }
      this.emu.run()

      this.logger.info('save delay %d', SAVE_INTERVAL_DELAY)

      if (this.saveInterval) clearInterval(this.saveInterval)
      const hash = this.romHash
      this.saveInterval = setInterval(() => {
        this.saveState(hash)
      }, SAVE_INTERVAL_DELAY)
      this.running = true
      // this.bus.emit('compressor', 'streamJoinRequested', this.romHash)
    } catch (e) {
      this.logger.error(e)
      this.unload()
    }
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
    if (this.saveInterval) clearInterval(this.saveInterval)
    this.romHash && this.saveState()
    if (this.emu) {
      this.emu.destroy()
    }
    if (this.romHash) {
      this.bus.emit('rom', 'free', this.romHash)
      this.bus.destroyStream(this.romHash, `frame${this.romHash}`)
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
    this.roomsTimestamp[this.romHash] = Date.now()
    this.ticker.tick()
    this.bus.stream(this.romHash, `frame${this.romHash}`, frame)
  }

  sendAudio(audio) {
    this.roomsTimestamp[this.romHash] = Date.now()
    this.bus.stream(this.romHash, `audio${this.romHash}`, audio)
  }

  saveState(romHash) {
    if (this.emu && romHash && this.running) {
      const snap = this.emu.snapshot()
      if (snap) {
        // this.romState = msgpack.pack(snap)
        this.bus.emit('rom', 'state', msgpack.pack({hash: romHash, snapshot: msgpack.pack(snap)}))
        this.logger.info(`> state ${romHash}`)
      }
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
    delete this.roomsTimestamp[request]
    if (request === this.romHash) {
      try {
        this.unload(true, request)
      } catch (e) {
        this.logger.error(e)
      }
    }
    this.logger.info('EmulatorService.streamLeaveRequested DONE', {
      socket: socket.id,
      request: JSON.stringify(request)
    })
  }

  streamJoinRequested(socket, request) {
    if (request) {
      this.logger.debug('EmulatorService.streamJoinRequested', {
        socket: socket.id,
        request: JSON.stringify(request),
        current: this.romHash
      })
      if (!this.romHash) {
        this.bus.emit('rom', 'query', request)
        socket.join(this.romHash)
      } else if (this.romHash === request) {
        this.logger.debug('EmulatorService.streamJoinRequested. Ignoring request for same stream.', {
          socket: socket.id,
          request: JSON.stringify(request),
          current: this.romHash
        })
        socket.join(this.romHash)
      } else {
        this.logger.error('EmulatorService.streamJoinRequested. Rejecting request for a new stream.', {
          socket: socket.id,
          request: JSON.stringify(request),
          current: this.romHash
        })
        socket.emit('streamRejected', request)
      }
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

export default EmulatorService
