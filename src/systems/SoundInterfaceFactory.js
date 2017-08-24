var pcm = require('pcm-util')
var toWav = require('audiobuffer-to-wav')
var stream = require('stream')

let self

class SoundInterface {
  constructor(channels,
              sampleRate,
              minBufferSize,
              maxBufferSize,
              underRunCallback,
              heartbeatCallback,
              postheartbeatCallback,
              volume,
              failureCallback) {

    // this.bufferStream = new stream.PassThrough()
    // this.emitStream = new stream.PassThrough()
    // this.emitStream.on('data', (data) => {
    //   this.emit('audio', data)
    // })

    this.minBufferSize = minBufferSize
    this.maxBufferSize = maxBufferSize
    this.channels = channels
    this.sampleRate = sampleRate
    this.toWavArrayBufferCount = 0
    this.tempAudioBuffer = new Float32Array()
  }

  writeAudioNoCallback(buffer) {
    this.toWavArrayBuffered(buffer)
    //this.toPcmArrayBuffer(buffer)
  }

  toMP3ArrayBuffer(buffer) {
    self.bufferStream.write(Buffer.from(buffer))
    self.bufferStream.pipe(self.encoder)
  }

  toWavArrayBuffer1(buffer) {
    const audioBuffer = pcm.toAudioBuffer(buffer, {
      channels: this.channels || 2,
      sampleRate: this.sampleRate || 44100,
      interleaved: true,
      float: true,
      signed: true,
      bitDepth: 16,
      byteOrder: 'LE',
      max: 32767,
      min: -32768,
      samplesPerFrame: 1024
    })
    const arrayBuffer = toWav(audioBuffer)
    self.emit('audio', arrayBuffer)
  }

  toWavArrayBuffer(buffer) {
    const audioBuffer = pcm.toAudioBuffer(buffer, {
      channels: this.channels || 2,
      sampleRate: this.sampleRate || 44100,
      interleaved: true,
      float: true,
      signed: true,
      bitDepth: 16,
      byteOrder: 'LE',
      max: 32767,
      min: -32768,
      samplesPerFrame: 1024
    })
    const arrayBuffer = toWav(audioBuffer)
    self.emit('audio', arrayBuffer)
  }

  toWavArrayBuffered(buffer) {
    this.tempAudioBuffer = this.tempAudioBuffer.concat(buffer)
    if (this.toWavArrayBufferCount && this.toWavArrayBufferCount >= 40) {
      const audioBuffer = pcm.toAudioBuffer(this.tempAudioBuffer, {
        channels: this.channels || 2,
        sampleRate: this.sampleRate || 44100,
        interleaved: true,
        float: true,
        signed: true,
        bitDepth: 16,
        byteOrder: 'LE',
        max: 32767,
        min: -32768,
        samplesPerFrame: 1024
      })
      const arrayBuffer = toWav(audioBuffer)
      self.emit('audio', arrayBuffer)
      this.toWavArrayBufferCount = 0
      this.tempAudioBuffer = new Float32Array()
    } else {
      this.toWavArrayBufferCount++
    }
  }

  toPcmArrayBuffer(buffer) {
    this.tempAudioBuffer = this.tempAudioBuffer.concat(buffer)
    if (this.toWavArrayBufferCount && this.toWavArrayBufferCount === 3) {
      const audioBuffer = pcm.toAudioBuffer(this.tempAudioBuffer, {
        channels: this.channels || 2,
        sampleRate: this.sampleRate || 44100,
        interleaved: true,
        float: true,
        signed: true,
        bitDepth: 16,
        byteOrder: 'LE',
        max: 32767,
        min: -32768,
        samplesPerFrame: 1024
      })
      self.emit('audio', Buffer.from(audioBuffer))
      this.toWavArrayBufferCount = 0
      this.tempAudioBuffer = new Float32Array()
    } else {
      this.toWavArrayBufferCount++
    }
  }

  changeVolume(volume) {
    console.log(volume)
  }

  remainingBuffer() {
  }
}

module.exports = {
  get: function get(ref) {
    self = ref
    return SoundInterface
  }
}
