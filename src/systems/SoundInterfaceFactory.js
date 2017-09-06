import pcm from 'pcm-util'
import toWav from 'audiobuffer-to-wav'

let self

class SoundInterface {
  constructor(channels, sampleRate, minBufferSize, maxBufferSize) {
    this.minBufferSize = minBufferSize
    this.maxBufferSize = maxBufferSize
    this.channels = channels
    this.sampleRate = sampleRate
    this.toWavArrayBufferCount = 0
    this.tempAudioBuffer = new Float32Array()
  }

  writeAudioNoCallback(buffer) {
    this.toWavArrayBuffered(buffer)
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
    if (this.toWavArrayBufferCount && this.toWavArrayBufferCount >= 15) {
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

  changeVolume(volume) {
    console.log(volume)
  }

  remainingBuffer() {
  }
}

export default {
  get: function get(ref) {
    self = ref // bind() meh
    return SoundInterface
  }
}
