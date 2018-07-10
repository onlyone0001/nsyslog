const
	Transporter = require('../'),
	UDPClient = require('./udp'),
	TCPClient = require('./tcp'),
	TLSClient = require('./tls'),
	URL = require('url'),
	moment = require("moment"),
	extend = require("extend"),
	jsexpr = require("jsexpr");

const MONTHS = [
	"Jan","Feb","Mar","Apr",
	"May","Jun","Jul","Aug",
	"Sep","Oct","Nov","Dec"
]

const FACILITY = {
	"kern":0, "user":1, "mail":2,
	"daemon":3, "auth":4, "syslog":5,
	"lpr":6, "news":7, "uucp":8,
	"cron":9, "authpriv":10,"ftp":11,
	"ntp":12, "security":13, "console":14,
	"solaris-cron":15, "local0":16, "local1":17,
	"local2":18, "local3":19, "local4":20,
	"local5":21, "local6":22, "local7":23
};

const LEVEL = {
	"emerg":0, "alert":1,	"crit":2,	"error":3,
	"warn":4, "notice":5,	"info":6,	"debug":7
}

const DEF_CONF = {
	"format" : "${originalMessage}",
	"level" : LEVEL.info,
	"facility" : FACILITY.user,
	"url" : "udp://localhost:514",
	"hostname" : "localhost",
	"application" : "localdomain",
	"tls" : {
		key: './config/server.key',
		cert: './config/server.crt',
		rejectUnauthorized : false
	}
}

class SyslogTransporter extends Transporter {
	constructor(id) {
		super(id);
	}

	configure(config, callback) {
		config = config || {};

		this.config = config;
		this.msg = jsexpr.expr(config.format || DEF_CONF.format);

		this.level = jsexpr.expr(`${config.level===undefined? DEF_CONF.level : config.level}`);
		this.facility = jsexpr.expr(`${config.facility===undefined? DEF_CONF.facility : config.facility}`);
		this.url = config.url || DEF_CONF.url;
		this.hostname = jsexpr.expr(config.hostname || DEF_CONF.hostname);
		this.application = jsexpr.expr(config.application || DEF_CONF.application);
		this.tlsoptions = extend({},DEF_CONF.tls,config.tls);
		this.stream = config.stream || DEF_CONF.stream;

		callback();
	}

	start(callback) {
		let url = URL.parse(this.url);
		if(url.protocol.startsWith("udp")) {
			this.client = new UDPClient(url.hostname,url.port,this.stream);
		}
		else if(url.protocol.startsWith("tcp")) {
			this.client = new TCPClient(url.hostname,url.port,this.stream);
		}
		else if(url.protocol.startsWith("tls")) {
			this.client = new TLSClient(url.hostname,url.port,this.stream,this.tlsoptions);
		}
		callback();
	}

	stop(callback) {
		this.client.close(callback);
	}

	transport(entry, callback) {
		let
			level = this.level(entry),
			facility = this.facility(entry),
			msg = this.msg(entry),
			hostname = this.hostname(entry),
			application = this.application(entry),
			date = moment().format("MMM D HH:mm:ss");

		level = isNaN(parseInt(level))? (LEVEL[level]||DEF_CONF.level) : parseInt(level);
		facility = isNaN(parseInt(facility))? (LEVEL[facility]||DEF_CONF.facility) : parseInt(facility);
		let pri = level * 8 + facility;

		let message = `<${pri}>${date} ${hostname} ${application}: ${msg}`;

		this.client.send(message,err=>{
			callback(err,entry);
		});
	}
}

module.exports = SyslogTransporter;