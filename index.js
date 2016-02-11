
var EventEmitter = require('events').EventEmitter
var util = require('util')
var debug = require('debug')('websocket-relay')
var Q = require('q')
var http = require('http')
var typeforce = require('typeforce')
// var clone = require('xtend')
var io = require('socket.io')
var constants = require('@tradle/constants')

function Server (opts) {
  var self = this

  typeforce({
    port: '?Number',
    path: '?String',
    server: '?Object'
  }, opts)

  EventEmitter.call(this)

  this._queues = {}
  this._pendingHandshakes = {}
  this._socketsByFingerprint = {}
  this._server = opts.server
  if (!this._server) {
    if (!opts.port) throw new Error('expected "server" or "port"')

    this._server = http.createServer(function (req, res) {
      res.writeHead(500)
      res.end('This is a websockets endpoint!')
    })

    this._server.listen(opts.port)
  }

  this._io = io(this._server, { path: opts.path || '/' }) //.of('/' + opts.rootHash)
  this._io.on('connection', this._onconnection.bind(this))
}

util.inherits(Server, EventEmitter)
module.exports = Server

Server.prototype._onconnection = function (socket) {
  var self = this
  var clientOTRFingerprint
  socket.on('error', function (err) {
    debug('disconnecting, socket for client ' + clientOTRFingerprint + ' experienced an error', err)
    socket.disconnect()
  })

  // TODO: handshake before allowing them to subscribe
  socket.once('subscribe', function (otrFingerprint) {
    debug('got "subscribe" from ' + otrFingerprint)
    var existing = self._socketsByFingerprint[otrFingerprint]
    if (existing) {
      if (existing !== socket) {
        debug('disconnecting second socket for ' + otrFingerprint)
        socket.disconnect()
      }

      return
    }

    clientOTRFingerprint = otrFingerprint
    self.emit('connect', clientOTRFingerprint)

    self._socketsByFingerprint[clientOTRFingerprint] = socket
    socket._theirOTRFingerprint = clientOTRFingerprint
    socket.on('message', function (msg, cb) {
      debug('got message from ' + clientOTRFingerprint)

      try {
        typeforce({
          to: 'String',
          message: 'String'
        }, msg)
      } catch (err) {
        debug('received invalid message from', clientOTRFingerprint, err)
        return socket.emit('error', { message: 'invalid message', data: msg })
      }

      msg.from = clientOTRFingerprint
      msg.callback = cb
      self._forwardMessage(msg)
    })
  })

  socket.once('disconnect', function () {
    if (!clientOTRFingerprint) return

    debug(clientOTRFingerprint + ' disconnected')
    self.emit('disconnect', clientOTRFingerprint)
    delete self._socketsByFingerprint[clientOTRFingerprint]
  })
}

// Server.prototype._handshake = function (socket, rootHash) {
//   var self = this
//   var pending = this._pendingHandshakes[rootHash]
//   if (pending) return pending.promise

//   var serverNonce
//   var identityInfo
//   var verifyingKey
//   var challengeRespDefer = Q.defer()
//   var handshakeDefer = Q.defer()
//   socket.once('disconnect', function () {
//     challengeRespDefer.reject()
//     handshakeDefer.reject()
//   })

//   socket.once('handshake', challengeRespDefer.resolve)
//   this.once('welcome:' + rootHash, handshakeDefer.resolve)

//   this._lookup(rootHash)
//     .then(function (result) {
//       identityInfo = result
//       var pubkeys = result.identity.toJSON().pubkeys
//       verifyingKey = pubkeys.filter(function (k) {
//         return k.type === 'ec' && k.purpose === 'sign'
//       })[0]

//       serverNonce = crypto.randomBytes(32).toString('hex')
//       debug('handshake 1. sending challenge', rootHash)
//       socket.emit('handshake', {
//         serverNonce: serverNonce,
//         key: verifyingKey.fingerprint
//       })

//       return Q.race([
//         Q.Promise(function (resolve, reject) {
//           setTimeout(function () {
//             reject(new Error('handshake timed out'))
//           }, HANDSHAKE_TIMEOUT).unref()
//         }),
//         challengeRespDefer.promise
//       ])
//     })
//     .then(function (data) {
//       debug('handshake 2. received challenge response from', rootHash)
//       if (data.serverNonce !== serverNonce) {
//         throw new Error('nonce mismatch')
//       }

//       var sig = data[SIG]
//       if (!sig) throw new Error('missing signature')

//       delete data[SIG]
//       var responseStr = utils.stringify(data)
//       verifyingKey = kiki.toKey(verifyingKey)
//       if (!verifyingKey.verify(responseStr, sig)) {
//         throw new Error('client gave bad signature')
//       }
//     })
//     .then(function () {
//       debug('handshake 3. client authenticated', rootHash)

//       // http://stackoverflow.com/questions/17476294/how-to-send-a-message-to-a-particular-client-with-socket-io#comment39387846_17535099
//       // each customer joins the room corresponding to their ROOT_HASH
//       self._addSocket[rootHash]
//       // corresponding client side code:
//       // var socket = io.connect('http://localhost');
//       // socket.emit('join', {[ROOT_HASH]: '...'})
//     })
//     .catch(function (err) {
//       console.error(err, err.stack)
//       throw err
//     })

//   this._pendingHandshakes[rootHash] = {
//     socket: socket,
//     promise: handshakeDefer.promise
//   }

//   return handshakeDefer.promise
// }

// Server.prototype._addSocket = function (rootHash, socket) {
//   var self = this
//   delete this._pendingHandshakes[rootHash]
//   this._socketsByFingerprint[rootHash] = socket
//   socket.join(rootHash)
//   socket.emit('welcome')
//   socket.on('message', function (msg, cb) {
//     var toRootHash = msg.toRootHash
//     debug('forwarding msg from', rootHash, 'to', toRootHash)
//     self._forwardMessage({
//       form: rootHash,
//       to: toRootHash,
//       message: msg.data,
//       callback: cb
//     })
//   })

//   this.emit('welcome:' + rootHash)

//   var queued = this._queues[rootHash]
//   if (queued && queued.length) {
//     queued = queued.slice()
//     this._queued[rootHash].length = 0
//     queued.forEach(self._forwardMessage, self)
//   }
// }

Server.prototype.getConnectedClients = function () {
  return Object.keys(this._socketsByFingerprint)
}

Server.prototype._forwardMessage = function (msgInfo) {
  typeforce({
    from: 'String',
    to: 'String',
    message: 'String',
    callback: '?Function'
  }, msgInfo)

  var to = msgInfo.to
  var socket = this._socketsByFingerprint[to]
  if (socket) {
    return socket.emit('message', {
      from: msgInfo.from,
      message: msgInfo.message
    }, msgInfo.callback)
  }

  if (msgInfo.callback) {
    msgInfo.callback({ error: { message: 'Recipient not found' } })
  }
}

Server.prototype.hasClient = function (fingerprint) {
  return fingerprint in this._socketsByFingerprint
}

Server.prototype.destroy = function () {
  if (this._destroyed) return Q.reject(new Error('already destroyed'))

  this._destroyed = true
  debug('destroying')

  for (var fingerprint in this._socketsByFingerprint) {
    var s = this._socketsByFingerprint[fingerprint]
    s.disconnect()
    // s.removeAllListeners()
  }

  delete this._socketsByFingerprint
  this._io.close()
  this._server.close()
  return Q()
}
