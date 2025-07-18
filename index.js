require('dotenv').config();

var os = require('os');
var nodeStatic = require('node-static');
var http = require('http');
var socketIO = require('socket.io');
var axios = require('axios');

const PORT = process.env.PORT || 3000;
var fileServer = new(nodeStatic.Server)(__dirname, {
  cache: 0,
  gzip: true
});

var app = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  if (req.url === '/') {
    req.url = '/index.html';
  }
  fileServer.serve(req, res, function(err) {
    if (err) {
      res.writeHead(err.status || 500, { 'Content-Type': 'text/plain' });
      res.end('Error serving ' + req.url + ': ' + err.message);
    }
  });
}).listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

var io = socketIO(app, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    transports: ['websocket', 'polling'],
    credentials: true
  },
  allowEIO3: true,
  path: '/socket.io/',
  serveClient: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 10000,
  maxHttpBufferSize: 1e8
});
io.sockets.on('connection', function(socket) {
  function log() {
    var array = ['Message from server:'];
    array.push.apply(array, arguments);
    socket.emit('log', array);
  }
  socket.on('message', function(message) {
    log('Client said: ', message);
    socket.broadcast.emit('message', message);
  });
  socket.on('send_to_server_raw', async function(message) {
    console.log("server received raw message", message);
    socket.broadcast.emit('to_client_raw', message);
  });
  socket.on('test', async function(data) {
    let text, source, target;
    try {
      const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
      text = jsonData.text;
      source = jsonData.source;
      target = jsonData.target;
      console.log('Translation request:', { text, source, target });
      if (!text) {
        throw new Error('Missing text to translate');
      }
      if (!source || !target) {
        throw new Error('Missing source or target language');
      }
      const response = await axios({
        method: 'POST',
        url: 'https://translation.googleapis.com/language/translate/v2',
        params: {
          key: process.env.GOOGLE_TRANSLATE_API_KEY
        },
        data: {
          q: text,
          source: source.toLowerCase(),
          target: target.toLowerCase(),
          format: 'text'
        }
      });
      if (response.data && response.data.data && response.data.data.translations) {
        const translatedText = response.data.data.translations[0].translatedText;
        console.log('Translation:', translatedText);
        socket.emit('translated', translatedText);
      }
    } catch (error) {
      console.error('Translation error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        requestData: {
          text,
          source,
          target,
          apiKey: process.env.GOOGLE_TRANSLATE_API_KEY?.substring(0, 10) + '...'
        }
      });
      socket.emit('translation_error', error.response?.data?.error?.message || error.message);
    }
  });
  socket.on('create or join', function(room) {
    log('Received request to create or join room ' + room);
    var clientsInRoom = io.sockets.adapter.rooms[room];
    var numClients = clientsInRoom ? Object.keys(clientsInRoom.sockets).length : 0;
    log('Room ' + room + ' now has ' + numClients + ' client(s)');
    if (numClients === 0) {
      socket.join(room);
      log('Client ID ' + socket.id + ' created room ' + room);
      socket.emit('created', room, socket.id);
    } else if (numClients === 1) {
      log('Client ID ' + socket.id + ' joined room ' + room);
      io.sockets.in(room).emit('join', room);
      socket.join(room);
      socket.emit('joined', room, socket.id);
      io.sockets.in(room).emit('ready');
    } else {
      socket.emit('full', room);
    }
  });
  socket.on('ipaddr', function() {
    var ifaces = os.networkInterfaces();
    for (var dev in ifaces) {
      ifaces[dev].forEach(function(details) {
        if (details.family === 'IPv4' && details.address !== '127.0.0.1') {
          socket.emit('ipaddr', details.address);
        }
      });
    }
  });
  socket.on('bye', function(){
    console.log('received bye');
  });
});
