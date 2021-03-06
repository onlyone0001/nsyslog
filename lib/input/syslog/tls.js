const
	tls = require('tls'),
	extend = require('extend'),
	TLS = require('../../tls'),
	logger = require('../../logger');

const
	BUFFER_TO = 100,
	BUFFER_IVAL = 100,
	RX = /<\d+>/g,
	RXPRI = /<\d+>/g;

const DEF_OPTS = {
	key: './config/server.key',
	cert: './config/server.crt',
	rejectUnauthorized : false
};

class TLSSyslog {
	constructor(protocol,host,port,options) {
		this.host = host || undefined;
		this.port = port || 514;
		this.protocol = protocol || "tcp";
		this.sockets = {};
		this.ival = null;
		this.server = null;
		this.eserver = {protocol:this.protocol, port:this.port, host:this.host};
		this.options = extend({},DEF_OPTS,options);
	}

	entry(s,message) {
		return {
			timestamp:Date.now(),
			server : this.eserver,
			client: {address:s.address},
			originalMessage:message
		};
	}

	startInterval(callback) {
		let sockets = this.sockets;

		this.ival = setInterval(()=>{
			let tf = Date.now();
			for(let sid in sockets) {
				let s = sockets[sid];
				if((tf-s.t)>=BUFFER_TO) {
					if(s.buffer.length) {
						let entry = this.entry(s,s.buffer);
						callback(null,entry);
					}
					s.buffer = "";
				}
			}
		},BUFFER_IVAL);
	}

	async start(callback) {
		let eserver = this.eserver;
		let options = this.options;

		try {
			options = await TLS.configure(options,options.$path);
		}catch(err) {
			callback(err);
		}

		this.startInterval(callback);

		this.server = tls.createServer(options,sock => {
			let ts = Date.now();
			let s = {
				sid : `${ts}_${Math.random()*1000}`,
				t:ts, buffer:"", msg:"",
				sock, address:sock.remoteAddress
			};
			this.sockets[s.sid] = s;

			sock.on('data', data => {
				s.t = Date.now();
				s.buffer += data.toString();

				// Cortar el trozo del principio que no tiene prioridad, en caso
				// de que estos mensajes sí la tengan (es un trozo inválido, lo ignoramos)
				let sidx = s.buffer.search(RX);
				if(sidx>0) s.buffer = s.buffer.substring(sidx);

				// Buscamos mensajes con prioridad
				let tpris = s.buffer.match(RXPRI);
				if(tpris!=null) {
					let lines = s.buffer.split(RXPRI);
					lines.shift();	// El primer elemento es vacio por la forma de separar

					// Leemos todas las lineas menos la última, que puede estar aun incompleta
					while(lines.length>1) {
						let line = tpris.shift()+lines.shift();
						let entry = this.entry(s, line);
						callback(null,entry);
					}

					// Ahora el bugger solo tiene el ultimo trozo de linea
					s.buffer = tpris.shift()+lines.shift();
				}
			});

			sock.on('close', data => {
				// Se cierra antes de procesar todo el buffer pendiente
				// Así que cogemos el remanente y los separamos por los tokens
				// de prioridad
				let tpris = s.buffer.match(RXPRI);

				// Si no hay token, lo mandamos todo como una sola linea
				if(!tpris) {
					if(s.buffer.length) {
						let entry = {
							timestamp:Date.now(),
							server : eserver,
							client: {address:s.address},
							originalMessage:s.buffer
						};
						callback(null,entry);
					}
				}
				else {
					// Ajustamos las longitudes de ambos arrays (quitamos el remanente del
					// principio del buffer, que no se corresponde con ningun mensaje)
					let tline = s.buffer.split(RXPRI);
					while(tline.length>tpris.length) tline.shift();
					tline.forEach((line,i)=>{
						line = tpris[i]+line;
						let entry = this.entry(s, line);
						callback(null,entry);
					});
				}
				delete this.sockets[s.sid];
			});

			sock.on('error', logger.error.bind(logger));

		}).listen(this.port, this.host);
	}

	stop(callback) {
		Object.keys(this.sockets).
			map(k=>this.sockets[k]).
			forEach(s=>s.sock.destroy());

		this.server.close(callback);
	}

	pause(callback) {
		this.paused = true;
		callback();
	}

	resume(callback) {
		this.paused = false;
		callback();
	}

}

module.exports = TLSSyslog;
