const os = require('os')
const crypto = require('crypto')
const msgpack = require('msgpack')
const fps = require('fps')

class RomListeners {
  onRomConnect() {
    this.logger.info('onRomConnect', this.romHash)
    if (this.romHash) {
      this.bus.emit('rom', 'query', this.romHash)
    }
  }

  onRomDisconnect() {
    this.logger.info('onRomDisconnect', this.romHash)
    if (this.romHash) {
      this.bus.emit('rom', 'query', this.romHash)
    }
  }

  onRomData(data) {
    const newRomHash = this.digest(data)
    this.logger.info('onRomData', {romHash: newRomHash})
    if (!this.romData) {
      this.romData = data
      this.shouldStart()
    }
  }

  onRomState(state) {
    this.logger.info('onRomState', {romHash: this.romHash})
    if (!this.romState) {
      this.romState = state
      this.shouldStart()
    }
  }

  onRomHash(hashData) {
    this.logger.info('EmulatorService.onRomHash', hashData)
    if (!this.romHash || !this.romHash === hashData.hash) {
      this.romName = hashData.name
      this.romHash = hashData.hash
      this.system = hashData.system
      this.shouldStart()
    }
  }
}

module.exports = RomListeners
