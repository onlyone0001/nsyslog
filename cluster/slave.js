const
	extend = require("extend"),
	parser = require("nsyslog-parser");

const CMD = {
	parse : "parse",
	process : "process"
}

var cfg = null;

function start() {
	process.on('message',(message) => {
		if(message.command==CMD.parse) parseEntry(message);
		else if(message.command==CMD.process) processEntry(message);
		else error(message);
	});
}

function parseEntry(message) {
	var entry = message.entry;
	var id = message.id;
	var res = parser(entry.originalMessage);
	entry = extend(entry,res);
	process.send({id:id,entry:entry});
}

function processEntry(message) {
	var entry = message.entry;
	var idproc = message.options.idproc;
	var idflow = message.options.idflow;
	var id = message.id;
	try {
		cfg.
			flows.find(f=>f.id==idflow).
			processors.find(p=>p.id==idproc).
			process(entry,(err,res)=>{
				process.send({id:id,entry:res,error:err});
			});
	}catch(err) {
		process.send({id:id,entry:entry,error:err});
	}
}

module.exports = {
	configure : function(config) {cfg=config;},
	start : start
}