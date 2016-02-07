
var path = require('path')
var http = require('http')
var test = require('tape')
var Q = require('q')
var ROOT_HASH = require('@tradle/constants').ROOT_HASH
var utils = require('@tradle/utils')
var DSA = require('@tradle/otr').DSA
var WebSocketRelay = require('../')
var WebSocketClient = require('@tradle/ws-client')
var billPub = require('./fixtures/bill-pub')
var billPriv = require('./fixtures/bill-priv')
var tedPub = require('./fixtures/ted-pub')
var tedPriv = require('./fixtures/ted-priv')
var rufusPub = require('./fixtures/rufus-pub')
var rufusPriv = require('./fixtures/rufus-priv')
var BASE_PORT = 22222
var billRootHash
var tedRootHash
var rufusRootHash
var people = {}

test('setup', function (t) {
  Q.all([billPub, tedPub, rufusPub].map(function (identity) {
    return Q.ninvoke(utils, 'getStorageKeyFor', new Buffer(utils.stringify(identity)))
  })).spread(function (b, t, r) {
    b = b.toString('hex')
    t = t.toString('hex')
    r = r.toString('hex')

    billRootHash = b
    tedRootHash = t
    rufusRootHash = r

    people[b] = people.bill = {
      pub: billPub,
      priv: billPriv
    }

    people[t] = people.ted = {
      pub: tedPub,
      priv: tedPriv
    }

    people[r] = people.rufus = {
      pub: rufusPub,
      priv: rufusPriv
    }
  })
  .done(t.end)
})

test('websockets with relay', function (t) {
  var port = BASE_PORT++

  var relayPath = '/custom/relay/path'
  var server = http.createServer(function (req, res) {
    res.writeHead(500)
    res.end('This is a websockets endpoint!')
  })

  server.listen(port)
  var relay = new WebSocketRelay({
    server: server,
    path: relayPath
  })

  var relayURL = 'http://127.0.0.1:' + port + path.join('/', relayPath)
  var rufus = new WebSocketClient({
    url: relayURL,
    otrKey: getDSAKey(rufusPriv),
    rootHash: rufusRootHash,
  })

  var bill = new WebSocketClient({
    url: relayURL,
    otrKey: getDSAKey(billPriv),
    rootHash: billRootHash,
  })

  var rufusInfo = {
    identity: rufusPub
  }

  rufusInfo[ROOT_HASH] = rufusRootHash

  var billInfo = {
    identity: billPub
  }

  billInfo[ROOT_HASH] = billRootHash

  var togo = 2

  bill.send(rufusRootHash, toBuffer({
    hey: 'rufus'
  }), rufusInfo).done()

  rufus.send(billRootHash, toBuffer({
    hey: 'bill'
  }), billInfo).done()

  bill.on('message', function (msg) {
    done()
    t.equal(JSON.parse(msg).hey, 'bill')
  })

  rufus.on('message', function (msg) {
    done()
    t.equal(JSON.parse(msg).hey, 'rufus')
  })

  function done () {
    if (--togo) return

    Q.all([
      relay.destroy(),
      bill.destroy(),
      rufus.destroy()
    ]).done(function () {
      t.end()
      // Socket.IO takes ~30 seconds to clean up (timeout its connections)
      // no one wants to wait that long for tests to finish
      process.exit(0)
    })
  }
})

function toBuffer (obj) {
  return new Buffer(utils.stringify(obj))
}

function getDSAKey (keys) {
  var key = keys.filter(function (k) {
    return k.type === 'dsa'
  })[0]

  return DSA.parsePrivate(key.priv)
}
