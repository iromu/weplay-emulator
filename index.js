process.title = 'weplay-emulator'

const discoveryUrl = process.env.DISCOVERY_URL || 'http://localhost:3010'
const discoveryPort = process.env.DISCOVERY_PORT || 3030
const statusPort = process.env.STATUS_PORT || 8082

const EmulatorService = require('./EmulatorService')
const service = new EmulatorService(discoveryUrl, discoveryPort, statusPort)

require('weplay-common').cleanup(service.destroy.bind(service))
