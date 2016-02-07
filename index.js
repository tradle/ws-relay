
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
    // byRootHash: 'Function'
  }, opts)

  EventEmitter.call(this)

  this._queues = {}
  this._pendingHandshakes = {}
  this._socketsByRootHash = {}
  // this._lookup = opts.byRootHash

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
  var clientRootHash
  socket.on('error', function (err) {
    debug('disconnecting, socket for client ' + clientRootHash + ' experienced an error', err)
    socket.disconnect()
  })

  // TODO: handshake before allowing them to subscribe
  socket.once('subscribe', function (rootHash) {
    debug('got "subscribe" from ' + rootHash)
    var existing = self._socketsByRootHash[rootHash]
    if (existing) {
      if (existing !== socket) {
        debug('disconnecting second socket for ' + rootHash)
        socket.disconnect()
      }

      return
    }

    clientRootHash = rootHash
    self.emit('connect', clientRootHash)

    self._socketsByRootHash[clientRootHash] = socket
    socket._tradleRootHash = clientRootHash
    socket.on('message', function (msg, cb) {
      debug('got message from ' + clientRootHash)

      try {
        typeforce({
          to: 'String',
          message: 'String'
        }, msg)
      } catch (err) {
        debug('received invalid message from', clientRootHash, err)
        return socket.emit('error', { message: 'invalid message', data: msg })
      }

      msg.from = clientRootHash
      msg.callback = cb
      self._forwardMessage(msg)
    })
  })

  socket.once('disconnect', function () {
    if (!clientRootHash) return

    debug(clientRootHash + ' disconnected')
    self.emit('disconnect', clientRootHash)
    delete self._socketsByRootHash[clientRootHash]
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
//   this._socketsByRootHash[rootHash] = socket
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
  return Object.keys(this._socketsByRootHash)
}

Server.prototype._forwardMessage = function (msgInfo) {
  typeforce({
    from: 'String',
    to: 'String',
    message: 'String',
    callback: '?Function'
  }, msgInfo)

  var to = msgInfo.to
  var socket = this._socketsByRootHash[to]
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

Server.prototype.hasClient = function (rootHash) {
  return rootHash in this._socketsByRootHash
}

Server.prototype.destroy = function () {
  if (this._destroyed) return Q.reject(new Error('already destroyed'))

  this._destroyed = true
  debug('destroying')

  for (var rootHash in this._socketsByRootHash) {
    var s = this._socketsByRootHash[rootHash]
    s.disconnect()
    // s.removeAllListeners()
  }

  delete this._socketsByRootHash
  this._io.close()
  this._server.close()
  return Q()
}
