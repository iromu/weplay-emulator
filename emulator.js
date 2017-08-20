const gameboy = require('gameboy')
const Canvas = require('canvas')
const Emitter = require('events').EventEmitter
var pcm = require('pcm-util')
var toWav = require('audiobuffer-to-wav')
var lame = require('lame')
var stream = require('stream')

class Emulator {
  constructor() {
    if (!(this instanceof Emulator)) return new Emulator()
    this.joyPadEventTimeoutByKey = {}
    this.canvas = new Canvas(160, 144)
    this.bufferStream = new stream.PassThrough()
    this.emitStream = new stream.PassThrough()
    this.emitStream.on('data', (data) => {
      this.emit('audio', data)
    })

    // create the Encoder instance
    this.encoder = new lame.Encoder({
      // input
      channels: 2,        // 2 channels (left and right)
      bitDepth: 16,       // 16-bit samples
      sampleRate: 44100,  // 44,100 Hz sample rate

      // output
      bitRate: 128,
      outSampleRate: 22050,
      mode: lame.STEREO // STEREO (default), JOINTSTEREO, DUALCHANNEL or MONO
    })
    this.encoder.on('data', (data) => {
      self.emit('audio', data)
    })
    const self = this
    this.soundInterface = class {
      constructor(channels,
                  sampleRate,
                  minBufferSize,
                  maxBufferSize,
                  underRunCallback,
                  heartbeatCallback,
                  postheartbeatCallback,
                  volume,
                  failureCallback) {
        this.minBufferSize = minBufferSize
        this.maxBufferSize = maxBufferSize
        this.channels = channels
        this.sampleRate = sampleRate
      }

      writeAudioNoCallback(buffer) {
        this.toWavArrayBuffer(buffer)
      }

      toMP3ArrayBuffer(buffer) {
        self.bufferStream.write(Buffer.from(buffer))
        self.bufferStream.pipe(self.encoder)
      }

      toWavArrayBuffer(buffer) {
        const audioBuffer = pcm.toAudioBuffer(buffer, {
          channels: this.channels || 2,
          sampleRate: this.sampleRate || 44100,
          interleaved: true,
          float: true,
          signed: true,
          bitDepth: 8,
          byteOrder: 'LE',
          max: this.maxBufferSize || 32767,
          min: this.minBufferSize || -32768,
          samplesPerFrame: 1024
        })
        const arrayBuffer = toWav(audioBuffer)
        self.emit('audio', arrayBuffer)
      }

      changeVolume(volume) {
        console.log(volume)
      }

      remainingBuffer() {
      }
    }
    this.gbOpts = {drawEvents: true, sound: this.soundInterface}
  }

  initWithRom(rom) {
    this.gameboy = gameboy(this.canvas, rom, this.gbOpts)
    this.gameboy.start()
    // this.gameboy.audioHandle.on('sound', (buf) => {
    //   console.log('initWithRom sound')
    //   this.emit('sound', buf)
    // })
  }

  initWithState(state) {
    if (!this.gameboy) {
      this.gameboy = gameboy(this.canvas, '', this.gbOpts)
    }
    this.gameboy.returnFromState(state)
    // this.gameboy.audioHandle.on('sound', (buf) => {
    //   console.log('initWithState sound')
    //   this.emit('sound', buf)
    // })
  }

  run() {
    const gb = this.gameboy
    gb.stopEmulator = 1 //  not stopped
    this.loop = setInterval(gb.run.bind(gb), 8)
    const self = this
    gb.on('draw', () => {
      self.canvas.toBuffer((err, buf) => {
        if (err) throw err
        self.emit('frame', buf)
      })
    })
    this.running = true
  }

  snapshot() {
    if (!this.running) return
    return this.gameboy.saveState()
  }

  move(key) {
    if (!this.running) return this
    if (key >= 0 && key < 8) {
      const gb = this.gameboy
      gb.JoyPadEvent(key, true)
      // Extend timeout
      if (this.joyPadEventTimeoutByKey[key]) {
        clearTimeout(this.joyPadEventTimeoutByKey[key])
        this.joyPadEventTimeoutByKey[key] = undefined
      }
      this.joyPadEventTimeoutByKey[key] = setTimeout(() => {
        gb.JoyPadEvent(key, false)
        clearTimeout(this.joyPadEventTimeoutByKey[key])
        this.joyPadEventTimeoutByKey[key] = undefined
      }, 50)
    }
    return this
  }

  destroy() {
    if (this.destroyed) return this
    clearInterval(this.loop)
    //  ignore stacked key timers from Emulator#move
    this.gameboy.JoyPadEvent = () => {
      // ignored
    }
    this.destroyed = true
    this.running = false
    this.canvas = null
    // this.gameboy = null
    return this
  }
}

// eslint-disable-next-line no-proto
Emulator.prototype.__proto__ = Emitter.prototype

module.exports = Emulator
